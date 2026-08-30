const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const requiredKeys = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT'
];

const missing = requiredKeys.filter((key) => !process.env[key]);
if (missing.length) {
  const missingList = missing.join(', ');
  throw new Error(`Missing required environment variables: ${missingList}`);
}

const DEFAULT_TOKEN_TTL_MINUTES = 7 * 24 * 60;

/**
 * ACCESS_CODES maps an access code to the R2 bucket it unlocks, so each code sees its own
 * library, groups and YouTube session:
 *
 *   ACCESS_CODES={"code-a":"kplayer-alice","code-b":{"bucket":"kplayer-bob","label":"Bob"}}
 *
 * Two codes pointing at one bucket are deliberately the same tenant - one library, two keys.
 */
function parseAccessCodes(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`ACCESS_CODES is not valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ACCESS_CODES must be a JSON object mapping access code to bucket');
  }

  const entries = Object.entries(parsed);
  if (!entries.length) {
    throw new Error('ACCESS_CODES is empty');
  }

  const byCode = new Map();
  entries.forEach(([code, value], index) => {
    // Never name the code itself in an error - these end up in logs.
    const where = `ACCESS_CODES entry #${index + 1}`;
    if (!code.trim()) {
      throw new Error(`${where} has an empty access code`);
    }

    const rawBucket = typeof value === 'string' ? value : value?.bucket;
    const bucket = typeof rawBucket === 'string' ? rawBucket.trim() : '';
    if (!bucket) {
      throw new Error(`${where} has no bucket`);
    }

    byCode.set(code, {
      id: bucket,
      bucket,
      label: (typeof value === 'object' && value?.label) || bucket,
    });
  });

  return byCode;
}

function buildTenants() {
  if (process.env.ACCESS_CODES) {
    return { enabled: true, byCode: parseAccessCodes(process.env.ACCESS_CODES) };
  }

  const bucket = process.env.R2_BUCKET_NAME ? process.env.R2_BUCKET_NAME.trim() : '';

  // Single-tenant fallback: one code guarding the one bucket, as before.
  if (process.env.ACCESS_CODE) {
    if (!bucket) {
      throw new Error('ACCESS_CODE is set but R2_BUCKET_NAME is missing');
    }
    return {
      enabled: true,
      byCode: new Map([[process.env.ACCESS_CODE, { id: bucket, bucket, label: bucket }]]),
    };
  }

  // No access control at all - every request falls back to the one bucket.
  if (!bucket) {
    throw new Error('Set either ACCESS_CODES or R2_BUCKET_NAME');
  }
  return { enabled: false, byCode: new Map() };
}

const tenants = buildTenants();
const tenantsById = new Map();
for (const tenant of tenants.byCode.values()) {
  tenantsById.set(tenant.id, tenant);
}

const defaultBucket = process.env.R2_BUCKET_NAME ? process.env.R2_BUCKET_NAME.trim() : null;

/**
 * Tokens must survive a restart, so the secret cannot be random. Deriving it from the codes
 * keeps it stable and secret without demanding another environment variable, while
 * ACCESS_TOKEN_SECRET allows rotating it independently of them.
 */
function resolveTokenSecret() {
  if (process.env.ACCESS_TOKEN_SECRET) {
    return process.env.ACCESS_TOKEN_SECRET;
  }
  const material = [...tenants.byCode.keys()].sort().join(' ');
  return crypto.createHash('sha256').update(`kplayer-token:${material}`).digest('hex');
}

const tokenTtlMinutes = Number(process.env.ACCESS_TOKEN_TTL_MINUTES) || DEFAULT_TOKEN_TTL_MINUTES;

const config = {
  port: Number(process.env.PORT) || 3000,
  r2: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    bucketName: defaultBucket,
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
  },
  accessControl: {
    enabled: tenants.enabled,
    tenantsByCode: tenants.byCode,
    tenantsById,
    tokenSecret: resolveTokenSecret(),
    tokenTtlMs: tokenTtlMinutes * 60 * 1000,
  },
  // Used only when access control is disabled.
  defaultTenant: defaultBucket
    ? { id: defaultBucket, bucket: defaultBucket, label: defaultBucket }
    : null,
};

module.exports = config;
