// Changes the address of every R2 image in the database, e.g. from
//   https://pub-xxxx.r2.dev/bag_123.png
// to
//   https://shopkart-server-10ey.onrender.com/images/bag_123.png
// The files in R2 stay the same; only the stored URLs change.
//
// Usage (Git Bash, from shopkart-server/), after R2_PUBLIC_URL in .env.render
// has been changed to the new address:
//   node --env-file=.env.render scripts/rewrite-image-urls.mjs          # dry run
//   node --env-file=.env.render scripts/rewrite-image-urls.mjs --apply  # save

import pg from 'pg';

const apply = process.argv.includes('--apply');
const { DATABASE_URL, R2_PUBLIC_URL } = process.env;
if (!DATABASE_URL || !R2_PUBLIC_URL) {
  console.error('DATABASE_URL and R2_PUBLIC_URL must be set.');
  process.exit(1);
}

const base = R2_PUBLIC_URL.replace(/\/+$/, '');
// Keeps only the file name of an address and puts the new base in front.
const rewrite = (url) => `${base}/${url.split('/').pop()}`;

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `SELECT id, name, url, formats FROM files WHERE provider = 'aws-s3' ORDER BY id`
);

let changed = 0;
for (const file of rows) {
  const url = rewrite(file.url);
  const formats = file.formats ? structuredClone(file.formats) : null;
  for (const format of Object.values(formats || {})) format.url = rewrite(format.url);

  if (url === file.url) continue;
  changed++;
  console.log(`  #${file.id} ${file.name}: ${file.url} -> ${url}`);

  if (apply) {
    await db.query(`UPDATE files SET url = $1, formats = $2 WHERE id = $3`, [
      url,
      formats ? JSON.stringify(formats) : null,
      file.id,
    ]);
  }
}

await db.end();
console.log(`${apply ? 'Updated' : 'Would update'} ${changed} of ${rows.length} file(s).`);
