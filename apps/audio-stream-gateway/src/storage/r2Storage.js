const {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const config = require('../config');

// One client for every bucket: same account, same credentials, only the Bucket differs.
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

function isMissing(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === 'NotFound' ||
    error?.Code === 'NoSuchKey'
  );
}

async function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

async function saveJson(bucket, key, data) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });
  await s3Client.send(command);
}

async function getJson(bucket, key) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  try {
    const result = await s3Client.send(command);
    const body = await streamToString(result.Body);
    return JSON.parse(body);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Returns the size in bytes of an object, or null when it does not exist.
 * Used to reject zero-byte objects left behind by a failed transcode.
 */
async function getFileSize(bucket, key) {
  const command = new HeadObjectCommand({ Bucket: bucket, Key: key });

  try {
    const result = await s3Client.send(command);
    return typeof result.ContentLength === 'number' ? result.ContentLength : null;
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function deleteObject(bucket, key) {
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });

  try {
    await s3Client.send(command);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }
}

async function getFileStream(bucket, key) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const result = await s3Client.send(command);
  return result.Body;
}

async function getSignedFileUrl(bucket, key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return url;
}

function uploadStream(bucket, key, bodyStream) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: bodyStream,
      ContentType: 'audio/mpeg'
    }
  });

  return upload.done();
}

async function getTrackIndex(bucket) {
  return (await getJson(bucket, TRACKS_INDEX_KEY)) ?? {};
}

async function saveTrackMetadata(bucket, metadata) {
  const index = await getTrackIndex(bucket);
  const existing = index[metadata.videoId];
  index[metadata.videoId] = {
    ...existing,
    ...metadata,
    createdAt: existing?.createdAt ?? metadata.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await saveJson(bucket, TRACKS_INDEX_KEY, index);
}

async function getTrackMetadata(bucket, videoId) {
  const index = await getTrackIndex(bucket);
  return index[videoId] ?? null;
}

async function listTracks(bucket) {
  const index = await getTrackIndex(bucket);
  return Object.values(index).sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

async function getGroupsIndex(bucket) {
  return (await getJson(bucket, GROUPS_INDEX_KEY)) ?? [];
}

async function saveGroups(bucket, groups) {
  await saveJson(bucket, GROUPS_INDEX_KEY, groups);
}

async function listGroups(bucket) {
  return await getGroupsIndex(bucket);
}

async function deleteTrack(bucket, videoId) {
  const index = await getTrackIndex(bucket);
  const metadata = index[videoId];
  if (!metadata) {
    return false;
  }

  if (metadata.storageKey) {
    await deleteObject(bucket, metadata.storageKey);
  }

  delete index[videoId];
  await saveJson(bucket, TRACKS_INDEX_KEY, index);

  const groups = await getGroupsIndex(bucket);
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
    await saveJson(bucket, GROUPS_INDEX_KEY, updatedGroups);
  }

  return true;
}

async function putText(bucket, key, body, contentType = 'text/plain') {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3Client.send(command);
}

async function getText(bucket, key) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  try {
    const result = await s3Client.send(command);
    return await streamToString(result.Body);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * YouTube cookies live inside the tenant's own bucket, so each access code carries its own
 * YouTube session rather than borrowing somebody else's.
 */
async function saveYouTubeCookies(bucket, cookieData) {
  await putText(bucket, YOUTUBE_COOKIES_KEY, cookieData);
  console.log(`[R2] YouTube cookies saved to ${bucket}`);
}

async function loadYouTubeCookies(bucket) {
  const body = await getText(bucket, YOUTUBE_COOKIES_KEY);
  console.log(body ? `[R2] YouTube cookies loaded from ${bucket}` : `[R2] No YouTube cookies found in ${bucket}`);
  return body;
}

async function deleteYouTubeCookies(bucket) {
  await deleteObject(bucket, YOUTUBE_COOKIES_KEY);
  console.log(`[R2] YouTube cookies removed from ${bucket}`);
}

/**
 * A mistyped bucket name is otherwise indistinguishable from an empty library: every read
 * comes back 404 and the tenant simply sees no music. Checking at startup turns that into
 * an obvious error instead of a silent one.
 */
async function bucketExists(bucket) {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    if (isMissing(error) || error?.name === 'NoSuchBucket') {
      return false;
    }
    throw error;
  }
}

/**
 * Every caller goes through here, so a request cannot reach storage without having first
 * resolved which tenant - and therefore which bucket - it belongs to.
 */
function forBucket(bucket) {
  if (!bucket) {
    throw new Error('A bucket is required to access storage');
  }

  return {
    bucket,
    getText: (key) => getText(bucket, key),
    putText: (key, body, contentType) => putText(bucket, key, body, contentType),
    getFileSize: (key) => getFileSize(bucket, key),
    deleteObject: (key) => deleteObject(bucket, key),
    getFileStream: (key) => getFileStream(bucket, key),
    getSignedFileUrl: (key, expiresIn) => getSignedFileUrl(bucket, key, expiresIn),
    uploadStream: (key, bodyStream) => uploadStream(bucket, key, bodyStream),
    saveTrackMetadata: (metadata) => saveTrackMetadata(bucket, metadata),
    getTrackMetadata: (videoId) => getTrackMetadata(bucket, videoId),
    listTracks: () => listTracks(bucket),
    listGroups: () => listGroups(bucket),
    saveGroups: (groups) => saveGroups(bucket, groups),
    deleteTrack: (videoId) => deleteTrack(bucket, videoId),
    saveYouTubeCookies: (cookieData) => saveYouTubeCookies(bucket, cookieData),
    loadYouTubeCookies: () => loadYouTubeCookies(bucket),
    deleteYouTubeCookies: () => deleteYouTubeCookies(bucket),
  };
}

module.exports = { forBucket, bucketExists };
