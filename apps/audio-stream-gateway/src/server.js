const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { Transform } = require('stream');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const storage = require('./storage/r2Storage');

const app = express();

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MUSIC_CATEGORY_ID = '10';
const YOUTUBE_MAX_RESULTS = 5;

// Each tenant keeps its own YouTube session, so cookies cannot share one path.
function cookiesPathFor(tenant) {
  const safeId = tenant.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join('/tmp', `youtube-cookies-${safeId}.txt`);
}

// An mp3 smaller than this cannot be real audio - it means the transcode produced
// nothing (e.g. yt-dlp was blocked) and the object must not be treated as cached.
const MIN_CACHED_BYTES = 4096;
// A caching job whose process died leaves a dangling entry; after this it is retried.
const MAX_JOB_AGE_MS = 15 * 60 * 1000;

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_, res) => {
  res.json({ status: 'ok' });
});

const isAccessControlEnabled = config.accessControl.enabled;

// Says whether a code is needed and how many are configured - enough to tell a loaded
// ACCESS_CODES from a silent fallback without shell access, and nothing more. It used to
// return a hash of the code, which is public and offline-crackable.
app.get('/api/access-control/status', (_req, res) => {
  res.json({
    enabled: isAccessControlEnabled,
    tenants: config.accessControl.tenantsById.size,
  });
});

app.post('/api/access-control/verify', (req, res) => {
  if (!isAccessControlEnabled) {
    return res.json({ success: true, token: null, expiresAt: null });
  }

  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) {
    return res.status(400).json({ success: false, message: 'Access code required' });
  }

  const tenant = auth.findTenantByCode(code);
  if (!tenant) {
    return res.status(401).json({ success: false, message: 'Access code invalid' });
  }

  const { token, expiresAt } = auth.issueToken(tenant);
  console.log(`[Access] Issued token for ${tenant.label}`);
  return res.json({ success: true, token, expiresAt, label: tenant.label });
});

// Everything below reads or writes a tenant's bucket, or spends its YouTube quota, so it
// all requires a token. req.tenant is set by the middleware and is the only way to a bucket.
app.get('/search', auth.requireTenant, async (req, res) => {
  if (!config.youtube?.apiKey) {
    return res.status(503).json({ message: 'YouTube search is not configured' });
  }

  const query = String(req.query.q ?? '').trim();
  if (!query) {
    return res.status(400).json({ message: 'Missing search query' });
  }

  try {
    const results = await searchYouTubeSongs(query);
    res.json({ results });
  } catch (error) {
    console.error('YouTube search failed', error);
    res.status(502).json({ message: 'Failed to search YouTube' });
  }
});

app.get('/tracks', auth.requireTenant, async (req, res, next) => {
  try {
    const tracks = await storage.forBucket(req.tenant.bucket).listTracks();
    res.json({ tracks });
  } catch (error) {
    next(error);
  }
});

app.get('/groups', auth.requireTenant, async (req, res, next) => {
  try {
    const groups = await storage.forBucket(req.tenant.bucket).listGroups();
    res.json({ groups });
  } catch (error) {
    next(error);
  }
});

app.delete('/tracks/:videoId', auth.requireTenant, async (req, res, next) => {
  try {
    const rawId = req.params.videoId;
    const videoId = getVideoId(rawId) ?? rawId;
    const deleted = await storage.forBucket(req.tenant.bucket).deleteTrack(videoId);
    if (!deleted) {
      return res.status(404).json({ message: 'Track not found' });
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/groups', auth.requireTenant, async (req, res, next) => {
  try {
    const store = storage.forBucket(req.tenant.bucket);
    const { name, trackIds } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Group name is required' });
    }
    const sanitizedTrackIds = Array.isArray(trackIds) ? trackIds : [];
    const groups = await store.listGroups();
    const newGroup = {
      id: randomUUID(),
      name: name.trim(),
      trackIds: sanitizedTrackIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    groups.push(newGroup);
    await store.saveGroups(groups);
    res.status(201).json(newGroup);
  } catch (error) {
    next(error);
  }
});

app.put('/groups/:groupId', auth.requireTenant, async (req, res, next) => {
  try {
    const store = storage.forBucket(req.tenant.bucket);
    const { groupId } = req.params;
    const { name, trackIds } = req.body ?? {};
    const groups = await store.listGroups();
    const index = groups.findIndex((group) => group.id === groupId);
    if (index === -1) {
      return res.status(404).json({ message: 'Group not found' });
    }
    if (typeof name === 'string') {
      groups[index].name = name.trim();
    }
    if (Array.isArray(trackIds)) {
      groups[index].trackIds = trackIds;
    }
    groups[index].updatedAt = new Date().toISOString();
    await store.saveGroups(groups);
    res.json(groups[index]);
  } catch (error) {
    next(error);
  }
});

app.delete('/groups/:groupId', auth.requireTenant, async (req, res, next) => {
  try {
    const store = storage.forBucket(req.tenant.bucket);
    const { groupId } = req.params;
    const groups = await store.listGroups();
    const nextGroups = groups.filter((group) => group.id !== groupId);
    if (nextGroups.length === groups.length) {
      return res.status(404).json({ message: 'Group not found' });
    }
    await store.saveGroups(nextGroups);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

function getVideoId(candidate = '') {
  const shortCodeMatch = candidate.match(/[a-zA-Z0-9_-]{11}/);
  if (candidate.length === 11 && shortCodeMatch) {
    return candidate;
  }

  const urlMatch = candidate.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const shareMatch = candidate.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shareMatch?.[1]) {
    return shareMatch[1];
  }

  return null;
}

function slugifyTitle(title, fallback) {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  const slug = normalized || fallback;
  return slug;
}

function buildObjectKey(title, videoId) {
  const slug = slugifyTitle(title, videoId);
  return `audio/${slug}-${videoId}.mp3`;
}

// Helper function to build yt-dlp args with the requesting tenant's cookies, if any
function buildYtDlpArgs(baseArgs, tenant) {
  const args = [...baseArgs];
  const cookiesPath = cookiesPathFor(tenant);
  if (fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
    console.log(`[yt-dlp] Using cookies file for ${tenant.label}`);
  }
  return args;
}

async function fetchVideoInfo(videoId, tenant) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return new Promise((resolve, reject) => {
    const args = buildYtDlpArgs([
      '--dump-single-json',
      '--no-warnings',
      '--skip-download',
      youtubeUrl,
    ], tenant);
    const infoProcess = spawn('yt-dlp', args);

    let stdout = '';
    let stderr = '';

    infoProcess.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    infoProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    infoProcess.on('error', (error) => {
      reject(error);
    });

    infoProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp metadata exit code ${code}`));
      }
      try {
        const payload = JSON.parse(stdout);
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function searchYouTubeSongs(query, maxResults = YOUTUBE_MAX_RESULTS) {
  const params = new URLSearchParams({
    key: config.youtube.apiKey,
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: MUSIC_CATEGORY_ID,
    maxResults: String(maxResults),
    order: 'relevance',
    safeSearch: 'none',
    fields: 'items(id/videoId,snippet/title,snippet/description,snippet/channelTitle,snippet/thumbnails/medium,snippet/thumbnails/default,snippet/publishedAt)',
  });

  const response = await fetch(`${YOUTUBE_SEARCH_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`YouTube API error ${response.status}: ${errorPayload}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items
    .map((item) => {
      const videoId = item?.id?.videoId;
      if (!videoId) {
        return null;
      }

      const snippet = item.snippet ?? {};
      const thumbnailUrl =
        snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null;

      return {
        videoId,
        title: snippet.title ?? '未知标题',
        channelTitle: snippet.channelTitle ?? null,
        description: snippet.description ?? null,
        thumbnailUrl,
        publishedAt: snippet.publishedAt ?? null,
      };
    })
    .filter(Boolean);
}

// Track ongoing cache jobs to prevent duplicate downloads
const cachingJobs = new Map();

function lastStderrLines(text, maxLines = 3) {
  const lines = String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return '';
  }
  return `: ${lines.slice(-maxLines).join(' | ')}`;
}

/**
 * Finds a cached object holding real audio. A zero-byte object is the fingerprint of a
 * transcode that failed silently, so it is purged instead of being served - otherwise the
 * client receives a valid URL to an empty file and buffers forever without any error.
 */
async function resolveCachedKey(store, videoId, existingMetadata) {
  const candidates = [
    existingMetadata?.storageKey,
    buildObjectKey(videoId, videoId),
    `audio/${videoId}.mp3`,
  ].filter(Boolean);

  for (const key of new Set(candidates)) {
    const size = await store.getFileSize(key);
    if (size === null) {
      continue;
    }

    if (size < MIN_CACHED_BYTES) {
      console.warn(`[Stream] Discarding empty cache object for ${videoId} (${size} bytes, key ${key})`);
      await store.deleteObject(key).catch((error) => {
        console.error(`[Stream] Failed to delete empty object ${key}`, error);
      });
      continue;
    }

    return key;
  }

  return null;
}

app.get('/stream/:videoId', auth.requireTenant, async (req, res, next) => {
  const rawVideoId = req.params.videoId;
  const videoId = getVideoId(rawVideoId);

  if (!videoId) {
    return res.status(400).json({ message: 'Invalid video id' });
  }

  const tenant = req.tenant;
  const store = storage.forBucket(tenant.bucket);
  // Two tenants caching the same video are two independent jobs writing to two buckets.
  const jobKey = `${tenant.id}:${videoId}`;

  try {
    const existingMetadata = await store.getTrackMetadata(videoId);
    let cacheKey = await resolveCachedKey(store, videoId, existingMetadata);

    if (cacheKey) {
      // Track is cached - return R2 signed URL
      console.log(`[Stream] Serving ${videoId} from cache (R2 URL)`);
      const signedUrl = await store.getSignedFileUrl(cacheKey, 3600); // 1 hour expiry
      return res.json({
        cached: true,
        url: signedUrl,
        videoId,
        metadata: existingMetadata
      });
    }

    // Track is not cached - check if caching is already in progress
    if (cachingJobs.has(jobKey)) {
      const job = cachingJobs.get(jobKey);

      // Check if caching failed with an error
      if (job.error) {
        console.log(`[Stream] Cache job failed for ${videoId}: ${job.error}`);
        cachingJobs.delete(jobKey); // Clean up failed job
        return res.status(500).json({
          cached: false,
          caching: false,
          error: job.error,
          videoId
        });
      }

      // A job older than the cap belongs to a process that died mid-transcode; retry it
      // instead of reporting "caching in progress" forever.
      if (Date.now() - job.startTime < MAX_JOB_AGE_MS) {
        console.log(`[Stream] Cache job already in progress for ${videoId}`);
        return res.status(202).json({
          cached: false,
          caching: true,
          message: 'Caching in progress',
          videoId
        });
      }

      console.warn(`[Stream] Discarding stale cache job for ${videoId}`);
      cachingJobs.delete(jobKey);
    }

    // Start background caching job
    console.log(`[Stream] Starting background cache job for ${videoId}`);
    const objectKey = buildObjectKey(videoId, videoId);
    cacheKey = objectKey;

    // Mark job as in progress
    cachingJobs.set(jobKey, { startTime: Date.now(), cacheKey });

    // Return 202 immediately - don't wait for caching to complete
    res.status(202).json({
      cached: false,
      caching: true,
      message: 'Started caching video',
      videoId
    });

    // Start background caching (async, won't be interrupted by client disconnect)
    (async () => {
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const downloadArgs = buildYtDlpArgs([
        '-f', 'bestaudio/best',
        '-o', '-',
        '--quiet',
        '--no-warnings',
        youtubeUrl
      ], tenant);

      let failure = null;
      let bytesTranscoded = 0;
      let ytDlpStderr = '';
      let ffmpegStderr = '';

      // Keep the first failure - later ones are usually just fallout from it.
      const recordFailure = (message) => {
        if (!failure) {
          failure = message;
        }
      };

      const ytDlp = spawn('yt-dlp', downloadArgs);

      ytDlp.stderr.on('data', (data) => {
        const message = data.toString();
        ytDlpStderr += message;
        if (message.trim()) {
          console.warn(`[Cache] yt-dlp for ${videoId}: ${message.trim()}`);
        }
      });

      const downloadFinished = new Promise((resolve) => {
        ytDlp.on('error', (error) => {
          recordFailure(`Failed to start download: ${error.message}`);
          resolve();
        });

        ytDlp.on('close', (code, signal) => {
          // A signal means we killed it ourselves after a transcode failure, which is
          // already recorded - only a genuine non-zero exit is news.
          if (code !== 0 && !signal) {
            recordFailure(`Download failed (yt-dlp exit ${code})${lastStderrLines(ytDlpStderr)}`);
          }
          resolve();
        });
      });

      // Counts what actually reaches R2 so an empty transcode can never pass as a cache hit.
      // autoDestroy is off because the stream emitting 'close' the moment it ends races
      // with ffmpeg's own exit, and fluent-ffmpeg reports whichever loses as an error.
      const cacheStream = new Transform({
        autoDestroy: false,
        transform(chunk, _encoding, callback) {
          bytesTranscoded += chunk.length;
          callback(null, chunk);
        },
      });

      const transcodeFinished = new Promise((resolve) => {
        ffmpeg(ytDlp.stdout)
          .audioBitrate(128)
          .format('mp3')
          .on('stderr', (line) => {
            ffmpegStderr += `${line}\n`;
          })
          .on('error', (error) => {
            // fluent-ffmpeg raises this when the output stream closes before it sees the
            // process exit - the ordinary end of a successful transcode on a slow box, not
            // a failure. Whether the audio really arrived is decided below by the byte
            // count and the stored object, so treat it as benign here.
            if (error.message?.includes('Output stream closed')) {
              console.log(`[Cache] Output stream closed for ${videoId} after ${bytesTranscoded} bytes`);
              resolve();
              return;
            }

            console.error(`[Cache] Transcode failed for ${videoId}`, error.message);
            recordFailure(`Audio conversion failed: ${error.message}${lastStderrLines(ffmpegStderr)}`);
            ytDlp.kill('SIGKILL');
            // Abort the multipart upload instead of letting it commit an empty object.
            cacheStream.destroy(new Error(failure));
            resolve();
          })
          .on('end', resolve)
          .pipe(cacheStream);
      });

      let uploadError = null;
      const uploadFinished = store.uploadStream(cacheKey, cacheStream).catch((error) => {
        uploadError = error;
      });

      // The upload can resolve before ffmpeg reports its error, so success requires all
      // three to have settled - not just the upload.
      await Promise.all([uploadFinished, transcodeFinished, downloadFinished]);

      if (!failure && uploadError) {
        recordFailure(`Storage upload failed: ${uploadError.message}`);
      }

      if (!failure && bytesTranscoded < MIN_CACHED_BYTES) {
        recordFailure(
          `Downloader produced no audio (${bytesTranscoded} bytes)${lastStderrLines(ytDlpStderr || ffmpegStderr)}`
        );
      }

      // Ground truth for success: the object is in R2 and holds every transcoded byte.
      // Deciding on the absence of an error message instead is what let a completed
      // transcode be thrown away over a harmless "Output stream closed".
      if (!failure) {
        const storedSize = await store.getFileSize(cacheKey);
        if (storedSize !== bytesTranscoded) {
          recordFailure(
            `Cached object is incomplete (stored ${storedSize ?? 'nothing'} of ${bytesTranscoded} bytes)`
          );
        }
      }

      if (failure) {
        console.error(`[Cache] Failed to cache ${videoId}: ${failure}`);
        // Leave nothing behind: an empty object would be served as a valid cache hit, and
        // metadata would make the client believe the track is ready to play.
        await store.deleteObject(cacheKey).catch((error) => {
          console.error(`[Cache] Failed to clean up ${cacheKey}`, error);
        });
        const job = cachingJobs.get(jobKey);
        if (job) {
          job.error = failure;
        }
        return;
      }

      // Deliberately sequential: each yt-dlp run spawns its own JS runtime to solve
      // YouTube's challenge, and two of those alongside ffmpeg exceeds a 512MB instance.
      const videoInfo = await fetchVideoInfo(videoId, tenant).catch((error) => {
        console.error(`[Cache] Failed to fetch metadata for ${videoId}`, error);
        return null;
      });
      const thumbnails = Array.isArray(videoInfo?.thumbnails) ? videoInfo.thumbnails : [];
      await store.saveTrackMetadata({
        videoId,
        storageKey: cacheKey,
        title: videoInfo?.title ?? videoId,
        author: videoInfo?.uploader ?? videoInfo?.channel ?? 'Unknown artist',
        durationSeconds: typeof videoInfo?.duration === 'number' ? videoInfo.duration : null,
        thumbnailUrl: videoInfo?.thumbnail ?? thumbnails[thumbnails.length - 1]?.url ?? null,
        createdAt: new Date().toISOString(),
      });

      console.log(`[Cache] Successfully cached ${videoId} in R2 (${bytesTranscoded} bytes)`);
      cachingJobs.delete(jobKey);
    })().catch((error) => {
      console.error(`[Cache] Unexpected failure while caching ${videoId}`, error);
      const job = cachingJobs.get(jobKey);
      if (job) {
        job.error = `Caching failed: ${error.message}`;
      }
    });

  } catch (error) {
    next(error);
  }
});

// YouTube Cookies Management
app.post('/api/youtube-cookies', auth.requireTenant, async (req, res) => {
  try {
    const { cookies } = req.body;

    if (!cookies || typeof cookies !== 'string') {
      return res.status(400).json({ message: 'Invalid cookies format' });
    }

    // Write cookies to local file in Netscape format (yt-dlp compatible)
    fs.writeFileSync(cookiesPathFor(req.tenant), cookies, 'utf8');
    console.log(`[Cookies] YouTube cookies saved locally for ${req.tenant.label}`);

    // Also save to R2 for persistence across server restarts
    try {
      await storage.forBucket(req.tenant.bucket).saveYouTubeCookies(cookies);
      console.log('[Cookies] YouTube cookies saved to R2 for persistence');
    } catch (r2Error) {
      console.error('[Cookies] Failed to save cookies to R2', r2Error);
      // Continue anyway - local file is saved
    }

    res.json({
      message: 'Cookies saved successfully (local + R2)',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Cookies] Failed to save cookies', error);
    res.status(500).json({ message: 'Failed to save cookies' });
  }
});

app.get('/api/youtube-cookies/status', auth.requireTenant, (req, res) => {
  try {
    const cookiesPath = cookiesPathFor(req.tenant);
    const exists = fs.existsSync(cookiesPath);

    if (!exists) {
      return res.json({
        hasCookies: false,
        message: 'No cookies found. Please login to YouTube.'
      });
    }

    const stats = fs.statSync(cookiesPath);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

    res.json({
      hasCookies: true,
      lastUpdated: stats.mtime.toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      message: ageHours > 168 ? 'Cookies may be expired (>7 days old)' : 'Cookies active'
    });
  } catch (error) {
    console.error('[Cookies] Failed to check status', error);
    res.status(500).json({ message: 'Failed to check cookies status' });
  }
});

app.delete('/api/youtube-cookies', auth.requireTenant, async (req, res) => {
  try {
    const cookiesPath = cookiesPathFor(req.tenant);
    let deletedLocal = false;
    if (fs.existsSync(cookiesPath)) {
      fs.unlinkSync(cookiesPath);
      deletedLocal = true;
      console.log('[Cookies] Local YouTube cookies file deleted');
    }

    try {
      await storage.forBucket(req.tenant.bucket).deleteYouTubeCookies();
    } catch (error) {
      console.error('[Cookies] Failed to delete cookies from R2', error);
      return res.status(500).json({ message: 'Failed to delete cookies from R2' });
    }

    res.json({
      message: 'Cookies deleted',
      deletedLocal,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cookies] Failed to delete cookies', error);
    res.status(500).json({ message: 'Failed to delete cookies' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error', err);
  if (res.headersSent) {
    return res.end();
  }
  // A malformed body is the caller's fault, and body-parser already says so - reporting it
  // as 500 sends the client looking for a server fault that is not there.
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: err.message || 'Bad Request' });
  }
  return res.status(500).json({ message: 'Internal Server Error' });
});

/**
 * Load each tenant's YouTube cookies from its own bucket when the local copy is missing.
 * This ensures cookies persist across server restarts on ephemeral platforms like Render.
 */
function configuredTenants() {
  if (config.accessControl.enabled) {
    return [...config.accessControl.tenantsById.values()];
  }
  return config.defaultTenant ? [config.defaultTenant] : [];
}

async function loadCookiesOnStartup() {
  const tenants = configuredTenants();
  console.log(`[Startup] ${tenants.length} tenant(s) configured`);

  for (const tenant of tenants) {
    try {
      if (!(await storage.bucketExists(tenant.bucket))) {
        // Loud, because the symptom is otherwise just an empty library for that code.
        console.error(
          `[Startup] Bucket "${tenant.bucket}" for ${tenant.label} does not exist or is not reachable - that access code will see nothing`
        );
        continue;
      }
    } catch (error) {
      console.error(`[Startup] Could not check bucket for ${tenant.label}`, error);
    }

    const cookiesPath = cookiesPathFor(tenant);

    if (fs.existsSync(cookiesPath)) {
      console.log(`[Startup] Local YouTube cookies found for ${tenant.label}`);
      continue;
    }

    try {
      const cookiesFromR2 = await storage.forBucket(tenant.bucket).loadYouTubeCookies();

      if (cookiesFromR2) {
        fs.writeFileSync(cookiesPath, cookiesFromR2, 'utf8');
        console.log(`[Startup] YouTube cookies restored for ${tenant.label}`);
      } else {
        console.log(`[Startup] No cookies in R2 for ${tenant.label} - login required`);
      }
    } catch (error) {
      // One unreachable bucket must not stop the rest of the tenants from starting.
      console.error(`[Startup] Failed to load cookies for ${tenant.label}`, error);
    }
  }
}

/**
 * A stale yt-dlp is the most common cause of extraction failures, so make the version
 * visible in the logs rather than only discoverable by shelling into the container.
 */
async function logYtDlpVersion() {
  return new Promise((resolve) => {
    const probe = spawn('yt-dlp', ['--version']);
    let version = '';

    probe.stdout.on('data', (chunk) => {
      version += chunk.toString();
    });

    probe.on('error', () => {
      console.error('[Startup] yt-dlp is not available on PATH - downloads will fail');
      resolve();
    });

    probe.on('close', () => {
      console.log(`[Startup] yt-dlp version ${version.trim() || 'unknown'}`);
      resolve();
    });
  });
}

// Start server with cookie restoration
(async () => {
  await logYtDlpVersion();
  await loadCookiesOnStartup();

  app.listen(config.port, () => {
    console.log(`Audio Stream Gateway listening on port ${config.port}`);
  });
})();
