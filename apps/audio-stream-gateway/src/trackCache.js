const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { Transform } = require('stream');
const fs = require('fs');
const path = require('path');

/**
 * Everything involved in turning a video id into a cached mp3. The gateway calls it when a
 * client asks for a track, and the local fetch worker calls the same function - YouTube
 * refuses these downloads from cloud egress but not from a home connection, so the work
 * sometimes has to happen elsewhere. Sharing one implementation is the point: two copies
 * would drift, and the object keys and metadata they write have to match exactly.
 */

// An mp3 smaller than this cannot be real audio - it means the transcode produced
// nothing (e.g. yt-dlp was blocked) and the object must not be treated as cached.
const MIN_CACHED_BYTES = 4096;

// Each tenant keeps its own YouTube session, so cookies cannot share one path.
function cookiesPathFor(tenant) {
  const safeId = tenant.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join('/tmp', `youtube-cookies-${safeId}.txt`);
}

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

function slugifyTitle(title, fallback) {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function buildObjectKey(title, videoId) {
  return `audio/${slugifyTitle(title, videoId)}-${videoId}.mp3`;
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

    infoProcess.on('error', reject);

    infoProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp metadata exit code ${code}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Downloads, transcodes and stores one track. Resolves with the reason on failure rather
 * than throwing, because both callers want to record it rather than crash.
 */
async function cacheTrack({ videoId, tenant, store, cacheKey }) {
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
    return { ok: false, error: failure };
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
  return { ok: true, bytes: bytesTranscoded, cacheKey };
}

module.exports = {
  MIN_CACHED_BYTES,
  cookiesPathFor,
  lastStderrLines,
  slugifyTitle,
  buildObjectKey,
  buildYtDlpArgs,
  fetchVideoInfo,
  cacheTrack,
};
