// One-time move of product images from public/uploads to Cloudflare R2.
//
// Run it AFTER the local database has been copied to Neon. For every media file
// still marked "local" it uploads the original and each resized format to R2,
// then points the database row at the R2 address, exactly as the aws-s3 upload
// provider would have done. Running it twice is safe: moved rows are skipped.
//
// Usage (Git Bash, from shopkart-server/):
//   node --env-file=.env.render scripts/migrate-uploads-to-r2.mjs          # dry run
//   node --env-file=.env.render scripts/migrate-uploads-to-r2.mjs --apply  # do it
//
// Needs DATABASE_URL (Neon) and the R2_* variables in that env file.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const apply = process.argv.includes('--apply');
const required = ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const uploadsDir = path.resolve('public/uploads');
const publicUrl = process.env.R2_PUBLIC_URL.replace(/\/+$/, '');
const s3 = new S3Client({
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Uploads one local file (e.g. /uploads/small_bag_123.png) and returns its R2 URL.
async function moveFile({ url, hash, ext, mime }) {
  const key = `${hash}${ext}`;
  const localPath = path.join(uploadsDir, path.basename(url));
  if (!fs.existsSync(localPath)) throw new Error(`file not found: ${localPath}`);

  if (apply) {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: fs.readFileSync(localPath),
        ContentType: mime,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  }
  return `${publicUrl}/${key}`;
}

const { rows } = await db.query(
  `SELECT id, name, hash, ext, mime, url, formats FROM files WHERE provider = 'local' ORDER BY id`
);
console.log(`${rows.length} local file(s) to move${apply ? '' : ' (dry run, add --apply to upload)'}`);

let moved = 0;
for (const file of rows) {
  try {
    const url = await moveFile(file);
    const formats = file.formats ? { ...file.formats } : null;
    for (const [size, format] of Object.entries(formats || {})) {
      formats[size] = { ...format, url: await moveFile(format) };
    }

    if (apply) {
      await db.query(
        `UPDATE files SET url = $1, formats = $2, provider = 'aws-s3' WHERE id = $3`,
        [url, formats ? JSON.stringify(formats) : null, file.id]
      );
    }
    moved++;
    console.log(`  ok   #${file.id} ${file.name} -> ${url}`);
  } catch (error) {
    console.log(`  skip #${file.id} ${file.name}: ${error.message}`);
  }
}

await db.end();
console.log(`${apply ? 'Moved' : 'Would move'} ${moved} of ${rows.length} file(s).`);
