/**
 * Tracks that the gateway wanted but could not fetch.
 *
 * YouTube refuses these downloads from cloud egress and allows the identical request from
 * a home connection, so the gateway failing is not the end of the story - the work just has
 * to happen somewhere else. Recording what was asked for keeps the app's flow intact: you
 * still search and tap download as before, and the local fetch worker drains what the
 * gateway could not get.
 *
 * The queue lives in the tenant's own bucket, so it is isolated exactly like their tracks.
 */

const QUEUE_KEY = 'metadata/download-queue.json';

async function list(store) {
  const body = await store.getText(QUEUE_KEY);
  if (!body) {
    return [];
  }
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt queue should not stop anything - it is a to-do list, not a record.
    console.warn('[Queue] Ignoring unreadable queue');
    return [];
  }
}

async function save(store, entries) {
  await store.putText(QUEUE_KEY, JSON.stringify(entries, null, 2), 'application/json');
}

async function enqueue(store, videoId) {
  const entries = await list(store);
  const existing = entries.find((entry) => entry.videoId === videoId);
  if (existing) {
    existing.attempts = (existing.attempts ?? 1) + 1;
    existing.lastRequestedAt = new Date().toISOString();
  } else {
    entries.push({
      videoId,
      requestedAt: new Date().toISOString(),
      lastRequestedAt: new Date().toISOString(),
      attempts: 1,
    });
  }
  await save(store, entries);
  console.log(`[Queue] ${videoId} recorded as wanted (${entries.length} pending)`);
}

async function remove(store, videoId) {
  const entries = await list(store);
  const remaining = entries.filter((entry) => entry.videoId !== videoId);
  if (remaining.length !== entries.length) {
    await save(store, remaining);
  }
}

module.exports = { QUEUE_KEY, list, enqueue, remove };
