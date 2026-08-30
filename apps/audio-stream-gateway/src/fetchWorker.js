#!/usr/bin/env node
/**
 * Fetches the tracks the gateway could not.
 *
 * YouTube refuses these downloads from cloud egress and allows the identical request from
 * a home connection - measured repeatedly: the same video, the same yt-dlp build and the
 * same cookies succeed from a residential address and fail from the deployed service. So
 * this runs where the downloads are allowed, writing to the same R2 buckets the gateway
 * reads, using the same caching code so keys and metadata cannot drift apart.
 *
 * Run it after queueing downloads in the app; the tracks appear in the library when it
 * finishes. A video id can also be passed directly to fetch it without queueing first.
 *
 *   node src/fetchWorker.js                            drain every tenant's queue
 *   node src/fetchWorker.js --tenant oz <videoId> ...   fetch these into one tenant
 *   node src/fetchWorker.js --tenant oz                 drain just that tenant's queue
 */

const fs = require('fs');

const config = require('./config');
const storage = require('./storage/r2Storage');
const trackCache = require('./trackCache');
const queue = require('./downloadQueue');

function allTenants() {
  if (config.accessControl.enabled) {
    return [...config.accessControl.tenantsById.values()];
  }
  return config.defaultTenant ? [config.defaultTenant] : [];
}

/**
 * Draining queues covers every tenant, because each queue already says who wanted what.
 * Named video ids do not carry that, and fetching them for everyone would put a copy in
 * every bucket - so those require --tenant unless there is only one to choose from.
 */
function parseArgs(argv) {
  const videoIds = [];
  let tenantName = null;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--tenant') {
      tenantName = argv[i + 1];
      i += 1;
    } else {
      videoIds.push(argv[i]);
    }
  }

  const available = allTenants();
  let selected = available;

  if (tenantName) {
    selected = available.filter(
      (tenant) => tenant.label === tenantName || tenant.bucket === tenantName
    );
    if (!selected.length) {
      const names = available.map((tenant) => tenant.label).join(', ');
      throw new Error(`No tenant called "${tenantName}". Available: ${names}`);
    }
  } else if (videoIds.length && available.length > 1) {
    const names = available.map((tenant) => tenant.label).join(', ');
    throw new Error(
      `Naming videos needs --tenant, or they would be stored for everyone. Available: ${names}`
    );
  }

  return { videoIds, tenants: selected };
}

/**
 * The gateway restores each tenant's cookies at startup; this process has to do the same,
 * or downloads would run without the session the tenant logged in with.
 */
async function restoreCookies(tenant, store) {
  const cookiesPath = trackCache.cookiesPathFor(tenant);
  if (fs.existsSync(cookiesPath)) {
    return;
  }
  const cookies = await store.loadYouTubeCookies().catch(() => null);
  if (cookies) {
    fs.writeFileSync(cookiesPath, cookies, 'utf8');
  }
}

async function alreadyCached(store, videoId) {
  const metadata = await store.getTrackMetadata(videoId);
  if (!metadata?.storageKey) {
    return false;
  }
  const size = await store.getFileSize(metadata.storageKey);
  return size !== null && size >= trackCache.MIN_CACHED_BYTES;
}

async function fetchOne(tenant, store, videoId) {
  if (await alreadyCached(store, videoId)) {
    console.log(`[Fetch] ${videoId} is already cached for ${tenant.label}`);
    await queue.remove(store, videoId);
    return true;
  }

  console.log(`[Fetch] ${videoId} for ${tenant.label}...`);
  const result = await trackCache.cacheTrack({
    videoId,
    tenant,
    store,
    cacheKey: trackCache.buildObjectKey(videoId, videoId),
  });

  if (!result.ok) {
    console.error(`[Fetch] ${videoId} failed: ${result.error}`);
    return false;
  }

  // Only drop it from the queue once the audio is really in the bucket, so a partial run
  // can simply be run again.
  await queue.remove(store, videoId);
  console.log(`[Fetch] ${videoId} done (${result.bytes} bytes)`);
  return true;
}

async function main() {
  const { videoIds, tenants } = parseArgs(process.argv.slice(2));
  let attempted = 0;
  let succeeded = 0;

  for (const tenant of tenants) {
    const store = storage.forBucket(tenant.bucket);
    await restoreCookies(tenant, store);

    const pending = videoIds.length
      ? videoIds
      : (await queue.list(store)).map((entry) => entry.videoId);

    if (!pending.length) {
      console.log(`[Fetch] Nothing pending for ${tenant.label}`);
      continue;
    }

    console.log(`[Fetch] ${pending.length} pending for ${tenant.label}`);
    for (const videoId of pending) {
      attempted += 1;
      if (await fetchOne(tenant, store, videoId)) {
        succeeded += 1;
      }
    }
  }

  console.log(`[Fetch] ${succeeded}/${attempted} fetched`);
  // A failure here is worth a non-zero exit so a wrapper script can say so plainly.
  process.exit(attempted > 0 && succeeded < attempted ? 1 : 0);
}

main().catch((error) => {
  console.error(`[Fetch] ${error.message}`);
  process.exit(1);
});
