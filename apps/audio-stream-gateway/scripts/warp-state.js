#!/usr/bin/env node
/**
 * Reads and writes the Cloudflare WARP identity in R2.
 *
 * Enrolling draws an address from Cloudflare's pool, and YouTube accepts some of those and
 * refuses others. Registering afresh on every boot therefore re-rolls that dice each time
 * the platform restarts the service, which it does often - an identity that works today is
 * gone tomorrow for no reason visible from the outside. Keeping a known-good one in R2
 * makes the behaviour reproducible, so a failure means something actually changed.
 *
 * Usage: warp-state.js load <path> | save <path>
 */

const fs = require('fs');
const path = require('path');

const config = require(path.join(__dirname, '..', 'src', 'config'));
const storage = require(path.join(__dirname, '..', 'src', 'storage', 'r2Storage'));

const STATE_KEY = 'metadata/warp-account.toml';

/**
 * The identity is infrastructure rather than anyone's music, but it has to live somewhere.
 * WARP_STATE_BUCKET names that place explicitly; otherwise the buckets are sorted and the
 * first taken. Sorting rather than trusting configuration order matters: numeric access
 * codes are integer-like object keys, so JSON.parse hands them back in numeric order
 * rather than the order they were written, and "the first tenant" is not what it looks
 * like in the file - the identity landed in the wrong bucket before this was sorted.
 */
function stateBucket() {
  if (process.env.WARP_STATE_BUCKET) {
    return process.env.WARP_STATE_BUCKET;
  }

  const buckets = [...config.accessControl.tenantsById.values()].map((tenant) => tenant.bucket);
  if (config.defaultTenant) {
    buckets.push(config.defaultTenant.bucket);
  }

  if (!buckets.length) {
    throw new Error('No bucket available to store the WARP identity');
  }

  return buckets.sort()[0];
}

async function main() {
  const [action, file] = process.argv.slice(2);
  if (!action || !file) {
    throw new Error('Usage: warp-state.js load|save <path>');
  }

  const bucket = stateBucket();
  const store = storage.forBucket(bucket);

  if (action === 'load') {
    const body = await store.getText(STATE_KEY);
    if (!body) {
      process.exit(1);
    }
    fs.writeFileSync(file, body, 'utf8');
    return;
  }

  if (action === 'save') {
    await store.putText(STATE_KEY, fs.readFileSync(file, 'utf8'), 'text/plain');
    console.error(`[WARP] identity stored in ${bucket}`);
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

main().catch((error) => {
  console.error(`[WARP] ${error.message}`);
  process.exit(1);
});
