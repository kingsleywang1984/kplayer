const {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const config = require('../config');

const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey
  }
});

const TRACKS_INDEX_KEY = 'metadata/tracks.json';
const GROUPS_INDEX_KEY = 'metadata/groups.json';
const YOUTUBE_COOKIES_KEY = 'metadata/youtube-cookies.txt';

async function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

async function saveJson(key, data) {
  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });
  await s3Client.send(command);
}

async function getJson(key) {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
  });
  try {
    const result = await s3Client.send(command);
    const body = await streamToString(result.Body);
    return JSON.parse(body);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
      return null;
    }
    if (error?.Code === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

async function checkFileExists(key) {
  const command = new HeadObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key
  });

  try {
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
      return false;
    }

    if (error?.Code === 'NoSuchKey') {
      return false;
    }

    throw error;
  }
}

async function getFileStream(key) {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key
  });
  const result = await s3Client.send(command);
  return result.Body;
}

async function getSignedFileUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return url;
}

function uploadStream(key, bodyStream) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.r2.bucketName,
      Key: key,
      Body: bodyStream,
      ContentType: 'audio/mpeg'
    }
  });

  return upload.done();
}

async function getTrackIndex() {
  return (await getJson(TRACKS_INDEX_KEY)) ?? {};
}

async function saveTrackMetadata(metadata) {
  const index = await getTrackIndex();
  const existing = index[metadata.videoId];
  index[metadata.videoId] = {
    ...existing,
    ...metadata,
    createdAt: existing?.createdAt ?? metadata.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await saveJson(TRACKS_INDEX_KEY, index);
}

async function getTrackMetadata(videoId) {
  const index = await getTrackIndex();
  return index[videoId] ?? null;
}

async function listTracks() {
  const index = await getTrackIndex();
  return Object.values(index).sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

async function getGroupsIndex() {
  return (await getJson(GROUPS_INDEX_KEY)) ?? [];
}

async function saveGroups(groups) {
  await saveJson(GROUPS_INDEX_KEY, groups);
}

async function listGroups() {
  return await getGroupsIndex();
}

async function deleteTrack(videoId) {
  const index = await getTrackIndex();
  const metadata = index[videoId];
  if (!metadata) {
    return false;
  }

  if (metadata.storageKey) {
    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: config.r2.bucketName,
        Key: metadata.storageKey,
      });
      await s3Client.send(deleteCommand);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.Code !== 'NoSuchKey') {
        throw error;
      }
    }
  }

  delete index[videoId];
  await saveJson(TRACKS_INDEX_KEY, index);

  const groups = await getGroupsIndex();
  let mutated = false;
  const updatedGroups = groups.map((group) => {
    const filteredIds = (group.trackIds ?? []).filter((id) => id !== videoId);
    if (filteredIds.length !== group.trackIds?.length) {
      mutated = true;
      return { ...group, trackIds: filteredIds, updatedAt: new Date().toISOString() };
    }
    return group;
  });
  if (mutated) {
    await saveJson(GROUPS_INDEX_KEY, updatedGroups);
  }

  return true;
}

/**
 * Save YouTube cookies to R2 for persistence across server restarts
 */
async function saveYouTubeCookies(cookieData) {
  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: YOUTUBE_COOKIES_KEY,
    Body: cookieData,
    ContentType: 'text/plain',
  });
  await s3Client.send(command);
  console.log('[R2] YouTube cookies saved to R2');
}

/**
 * Load YouTube cookies from R2
 * Returns null if cookies don't exist
 */
async function loadYouTubeCookies() {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: YOUTUBE_COOKIES_KEY,
  });
  try {
    const result = await s3Client.send(command);
    const body = await streamToString(result.Body);
    console.log('[R2] YouTube cookies loaded from R2');
    return body;
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      console.log('[R2] No YouTube cookies found in R2');
      return null;
    }
    throw error;
  }
}

/**
 * Delete persisted YouTube cookies from R2
 */
async function deleteYouTubeCookies() {
  const command = new DeleteObjectCommand({
    Bucket: config.r2.bucketName,
    Key: YOUTUBE_COOKIES_KEY,
  });
  try {
    await s3Client.send(command);
    console.log('[R2] YouTube cookies deleted from R2');
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
      console.log('[R2] YouTube cookies not present in R2');
      return;
    }
    throw error;
  }
}

module.exports = {
  checkFileExists,
  getFileStream,
  getSignedFileUrl,
  uploadStream,
  saveTrackMetadata,
  getTrackMetadata,
  listTracks,
  listGroups,
  saveGroups,
  deleteTrack,
  saveYouTubeCookies,
  loadYouTubeCookies,
  deleteYouTubeCookies,
};
