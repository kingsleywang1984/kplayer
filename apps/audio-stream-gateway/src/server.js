const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const storage = require('./storage/r2Storage');

const app = express();

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MUSIC_CATEGORY_ID = '10';
const YOUTUBE_MAX_RESULTS = 5;
const COOKIES_FILE_PATH = path.join('/tmp', 'youtube-cookies.txt');

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

app.get('/search', async (req, res) => {
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

app.get('/tracks', async (_req, res, next) => {
  try {
    const tracks = await storage.listTracks();
    res.json({ tracks });
  } catch (error) {
    next(error);
  }
});

app.get('/groups', async (_req, res, next) => {
  try {
    const groups = await storage.listGroups();
    res.json({ groups });
  } catch (error) {
    next(error);
  }
});

app.delete('/tracks/:videoId', async (req, res, next) => {
  try {
    const rawId = req.params.videoId;
    const videoId = getVideoId(rawId) ?? rawId;
    const deleted = await storage.deleteTrack(videoId);
    if (!deleted) {
      return res.status(404).json({ message: 'Track not found' });
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/groups', async (req, res, next) => {
  try {
    const { name, trackIds } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Group name is required' });
    }
    const sanitizedTrackIds = Array.isArray(trackIds) ? trackIds : [];
    const groups = await storage.listGroups();
    const newGroup = {
      id: randomUUID(),
      name: name.trim(),
      trackIds: sanitizedTrackIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    groups.push(newGroup);
    await storage.saveGroups(groups);
    res.status(201).json(newGroup);
  } catch (error) {
    next(error);
  }
});

app.put('/groups/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, trackIds } = req.body ?? {};
    const groups = await storage.listGroups();
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
    await storage.saveGroups(groups);
    res.json(groups[index]);
  } catch (error) {
    next(error);
  }
});

app.delete('/groups/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const groups = await storage.listGroups();
    const nextGroups = groups.filter((group) => group.id !== groupId);
    if (nextGroups.length === groups.length) {
      return res.status(404).json({ message: 'Group not found' });
    }
    await storage.saveGroups(nextGroups);
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

// Helper function to build yt-dlp args with cookies if available
function buildYtDlpArgs(baseArgs) {
  const args = [...baseArgs];
  if (fs.existsSync(COOKIES_FILE_PATH)) {
    args.push('--cookies', COOKIES_FILE_PATH);
    console.log('[yt-dlp] Using cookies file');
  }
  return args;
}

async function fetchVideoInfo(videoId) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return new Promise((resolve, reject) => {
    const args = buildYtDlpArgs([
      '--dump-single-json',
      '--no-warnings',
      '--skip-download',
      youtubeUrl,
    ]);
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

app.get('/stream/:videoId', async (req, res, next) => {
  const rawVideoId = req.params.videoId;
  const videoId = getVideoId(rawVideoId);

  if (!videoId) {
    return res.status(400).json({ message: 'Invalid video id' });
  }

  try {
    const existingMetadata = await storage.getTrackMetadata(videoId);
    let cacheKey = existingMetadata?.storageKey;
    let objectExists = false;

    if (cacheKey) {
      objectExists = await storage.checkFileExists(cacheKey);
    }

    if (!objectExists) {
      cacheKey = `audio/${videoId}.mp3`;
      objectExists = await storage.checkFileExists(cacheKey);
    }

    if (objectExists) {
      // Track is cached - return R2 signed URL
      console.log(`[Stream] Serving ${videoId} from cache (R2 URL)`);
      const signedUrl = await storage.getSignedFileUrl(cacheKey, 3600); // 1 hour expiry
      return res.json({
        cached: true,
        url: signedUrl,
        videoId,
        metadata: existingMetadata
      });
    }

    // Track is not cached - check if caching is already in progress
    if (cachingJobs.has(videoId)) {
      const job = cachingJobs.get(videoId);

      // Check if caching failed with an error
      if (job.error) {
        console.log(`[Stream] Cache job failed for ${videoId}: ${job.error}`);
        cachingJobs.delete(videoId); // Clean up failed job
        return res.status(500).json({
          cached: false,
          caching: false,
          error: job.error,
          videoId
        });
      }

      console.log(`[Stream] Cache job already in progress for ${videoId}`);
      return res.status(202).json({
        cached: false,
        caching: true,
        message: 'Caching in progress',
        videoId
      });
    }

    // Start background caching job
    console.log(`[Stream] Starting background cache job for ${videoId}`);
    const objectKey = buildObjectKey(videoId, videoId);
    cacheKey = objectKey;

    // Mark job as in progress
    cachingJobs.set(videoId, { startTime: Date.now(), cacheKey });

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
      ]);

      const ytDlp = spawn('yt-dlp', downloadArgs);
      let hasError = false;

      ytDlp.stderr.on('data', (data) => {
        const message = data.toString();
        if (message.trim()) {
          console.warn(`[Cache] yt-dlp warning for ${videoId}: ${message.trim()}`);
        }
      });

      ytDlp.on('error', (error) => {
        console.error(`[Cache] Failed to spawn yt-dlp for ${videoId}`, error);
        hasError = true;
        const job = cachingJobs.get(videoId);
        if (job) {
          job.error = `Failed to start download: ${error.message}`;
        }
      });

      ytDlp.on('close', (code) => {
        if (code !== 0 && !hasError) {
          console.error(`[Cache] yt-dlp exited with code ${code} for ${videoId}`);
          hasError = true;
          const job = cachingJobs.get(videoId);
          if (job) {
            job.error = `Download failed with exit code ${code}`;
          }
        }
      });

      const transcoder = ffmpeg(ytDlp.stdout)
        .audioBitrate(128)
        .format('mp3')
        .on('error', (error) => {
          // "Output stream closed" means the stream finished successfully
          // This is not a fatal error - the upload likely completed
          if (error.message && error.message.includes('Output stream closed')) {
            console.log(`[Cache] Stream closed for ${videoId} (upload likely completed)`);
            return;
          }

          console.error(`[Cache] Transcode failed for ${videoId}`, error);
          hasError = true;
          const job = cachingJobs.get(videoId);
          if (job) {
            job.error = `Audio conversion failed: ${error.message}`;
          }
          ytDlp.kill('SIGKILL');
        });

      const transcoderOutput = new PassThrough();
      const cacheStream = new PassThrough();

      transcoder.pipe(transcoderOutput);
      transcoderOutput.pipe(cacheStream);

      // Fetch metadata in background
      fetchVideoInfo(videoId)
        .then(async (videoInfo) => {
          const thumbnails = Array.isArray(videoInfo.thumbnails) ? videoInfo.thumbnails : [];
          const thumbnailUrl = videoInfo.thumbnail ?? thumbnails[thumbnails.length - 1]?.url ?? null;
          const metadataPayload = {
            videoId,
            storageKey: cacheKey,
            title: videoInfo.title ?? videoId,
            author: videoInfo.uploader ?? videoInfo.channel ?? 'Unknown artist',
            durationSeconds: typeof videoInfo.duration === 'number' ? videoInfo.duration : null,
            thumbnailUrl,
            createdAt: new Date().toISOString(),
          };
          await storage.saveTrackMetadata(metadataPayload);
          console.log(`[Cache] Metadata saved for ${videoId}`);
        })
        .catch((error) => {
          console.error(`[Cache] Failed to fetch metadata for ${videoId}`, error);
          // Save minimal metadata as fallback
          return storage.saveTrackMetadata({
            videoId,
            storageKey: cacheKey,
            title: videoId,
            author: 'Unknown',
            durationSeconds: null,
            thumbnailUrl: null,
            createdAt: new Date().toISOString(),
          });
        });

      // Upload to R2
      try {
        await storage.uploadStream(cacheKey, cacheStream);
        console.log(`[Cache] Successfully cached ${videoId} in R2`);
        cachingJobs.delete(videoId);
      } catch (error) {
        console.error(`[Cache] Failed to upload ${videoId} to R2`, error);
        const job = cachingJobs.get(videoId);
        if (job) {
          job.error = `Storage upload failed: ${error.message}`;
        }
      }
    })(); // Immediately invoke async function

  } catch (error) {
    next(error);
  }
});

// YouTube Cookies Management
app.post('/api/youtube-cookies', async (req, res) => {
  try {
    const { cookies } = req.body;

    if (!cookies || typeof cookies !== 'string') {
      return res.status(400).json({ message: 'Invalid cookies format' });
    }

    // Write cookies to local file in Netscape format (yt-dlp compatible)
    fs.writeFileSync(COOKIES_FILE_PATH, cookies, 'utf8');
    console.log('[Cookies] YouTube cookies saved to local file');

    // Also save to R2 for persistence across server restarts
    try {
      await storage.saveYouTubeCookies(cookies);
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

app.get('/api/youtube-cookies/status', (req, res) => {
  try {
    const exists = fs.existsSync(COOKIES_FILE_PATH);

    if (!exists) {
      return res.json({
        hasCookies: false,
        message: 'No cookies found. Please login to YouTube.'
      });
    }

    const stats = fs.statSync(COOKIES_FILE_PATH);
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

app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error', err);
  if (res.headersSent) {
    return res.end();
  }
  return res.status(500).json({ message: 'Internal Server Error' });
});

/**
 * Load YouTube cookies from R2 if local file doesn't exist
 * This ensures cookies persist across server restarts on ephemeral platforms like Render
 */
async function loadCookiesOnStartup() {
  // Check if local cookies file exists
  if (fs.existsSync(COOKIES_FILE_PATH)) {
    console.log('[Startup] Local YouTube cookies file found');
    return;
  }

  console.log('[Startup] No local cookies file found, checking R2...');

  try {
    const cookiesFromR2 = await storage.loadYouTubeCookies();

    if (cookiesFromR2) {
      // Write cookies from R2 to local file
      fs.writeFileSync(COOKIES_FILE_PATH, cookiesFromR2, 'utf8');
      console.log('[Startup] YouTube cookies restored from R2 to local file');
    } else {
      console.log('[Startup] No cookies found in R2. User will need to login.');
    }
  } catch (error) {
    console.error('[Startup] Failed to load cookies from R2', error);
  }
}

// Start server with cookie restoration
(async () => {
  await loadCookiesOnStartup();

  app.listen(config.port, () => {
    console.log(`Audio Stream Gateway listening on port ${config.port}`);
  });
})();
