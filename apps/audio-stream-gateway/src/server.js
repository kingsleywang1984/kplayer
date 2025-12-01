const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const config = require('./config');
const storage = require('./storage/r2Storage');

const app = express();

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const MUSIC_CATEGORY_ID = '10';
const YOUTUBE_MAX_RESULTS = 5;

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

async function fetchVideoInfo(videoId) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return new Promise((resolve, reject) => {
    const infoProcess = spawn('yt-dlp', [
      '--dump-single-json',
      '--no-warnings',
      '--skip-download',
      youtubeUrl,
    ]);

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

app.get('/stream/:videoId', async (req, res, next) => {
  const rawVideoId = req.params.videoId;
  const videoId = getVideoId(rawVideoId);

  if (!videoId) {
    return res.status(400).json({ message: 'Invalid video id' });
  }

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

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');

  try {
    if (objectExists) {
      console.log(`[Stream] Serving ${videoId} from cache`);
      const cachedObject = await storage.getFileStream(cacheKey);

      cachedObject.on('error', (error) => {
        console.error(`[Stream] Cache read failed for ${videoId}`, error);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(error);
        }
      });

      return cachedObject.pipe(res);
    }

    console.log(`[Stream] Cache miss for ${videoId}, fetching from YouTube`);
    const videoInfo = await fetchVideoInfo(videoId);
    const objectKey = buildObjectKey(videoInfo.title ?? videoId, videoId);
    cacheKey = objectKey;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const ytDlp = spawn('yt-dlp', [
      '-f', 'bestaudio/best',
      '-o', '-',
      '--quiet',
      '--no-warnings',
      youtubeUrl
    ]);

    ytDlp.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.trim()) {
        console.warn(`[Stream] yt-dlp warning for ${videoId}: ${message.trim()}`);
      }
    });

    ytDlp.on('error', (error) => {
      console.error(`[Stream] Failed to spawn yt-dlp for ${videoId}`, error);
      if (!res.headersSent) {
        res.status(502).json({ message: 'Unable to download from YouTube' });
      } else {
        res.destroy(error);
      }
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`yt-dlp exited with code ${code}`);
        console.error(`[Stream] yt-dlp exit error for ${videoId}`, error);
        if (!res.headersSent) {
          res.status(502).json({ message: 'Unable to download from YouTube' });
        } else {
          res.destroy(error);
        }
      }
    });

    const transcoder = ffmpeg(ytDlp.stdout)
      .audioBitrate(128)
      .format('mp3')
      .on('error', (error) => {
        console.error(`[Stream] Transcode failed for ${videoId}`, error);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Unable to create audio stream' });
        } else {
          res.destroy(error);
        }
        ytDlp.kill('SIGKILL');
      });

    const transcoderOutput = new PassThrough();
    const responseStream = new PassThrough();
    const cacheStream = new PassThrough();

    transcoder.pipe(transcoderOutput);
    transcoderOutput.pipe(responseStream);
    transcoderOutput.pipe(cacheStream);

    const uploadPromise = storage
      .uploadStream(cacheKey, cacheStream)
      .then(async () => {
        console.log(`[Stream] Cached ${videoId} in R2`);
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
      })
      .catch((error) => {
        console.error(`[Stream] Failed to upload ${videoId} to R2`, error);
      });

    responseStream.on('error', (error) => {
      console.error(`[Stream] Response stream error for ${videoId}`, error);
      res.destroy(error);
    });

    req.on('close', () => {
      if (!res.writableEnded) {
        console.log(`[Stream] Client disconnected; aborting ${videoId}`);
        ytDlp.kill('SIGKILL');
        if (typeof transcoder.kill === 'function') {
          transcoder.kill('SIGKILL');
        }
        responseStream.destroy();
        cacheStream.destroy();
      }
    });

    responseStream.pipe(res);

    try {
      await uploadPromise;
    } catch (error) {
      console.error(`[Stream] Upload promise failed: ${videoId}`, error);
    }
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error', err);
  if (res.headersSent) {
    return res.end();
  }
  return res.status(500).json({ message: 'Internal Server Error' });
});

app.listen(config.port, () => {
  console.log(`Audio Stream Gateway listening on port ${config.port}`);
});
