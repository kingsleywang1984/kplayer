const path = require('path');
const fs = require('fs');
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
  'R2_ENDPOINT',
  'R2_BUCKET_NAME'
];

const missing = requiredKeys.filter((key) => !process.env[key]);
if (missing.length) {
  const missingList = missing.join(', ');
  throw new Error(`Missing required environment variables: ${missingList}`);
}

const config = {
  port: Number(process.env.PORT) || 3000,
  r2: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    bucketName: process.env.R2_BUCKET_NAME
  }
};

module.exports = config;
