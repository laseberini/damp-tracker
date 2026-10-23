// Removes everything the first (Cloudflare) version created in your Cloudflare account:
// the damp-tracker Pages site, the damp-tracker D1 database and the damp-tracker-photos
// R2 bucket (after emptying it). Wrangler asks you to confirm the deletes.
//
//   node cleanup-cloudflare.mjs
//
// The free Zero Trust plan is left alone. Cancel it under Billing if you want.

import { spawnSync } from 'node:child_process';

const PHOTOS = ['seed-photo-1', 'seed-photo-2-3', 'seed-photo-4-6', 'seed-photo-7', 'seed-photo-8', 'seed-photo-9', 'seed-photo-10'];

function wrangler(...args) {
  console.log(`\n> wrangler ${args.join(' ')}`);
  const r = spawnSync('npx', ['--yes', 'wrangler@4', ...args], { stdio: 'inherit', shell: true });
  return r.status === 0;
}

wrangler('pages', 'project', 'delete', 'damp-tracker');
for (const p of PHOTOS) wrangler('r2', 'object', 'delete', `damp-tracker-photos/areas/seed-area-stairwell/${p}.jpg`, '--remote');
wrangler('r2', 'bucket', 'delete', 'damp-tracker-photos');
wrangler('d1', 'delete', 'damp-tracker');
console.log('\nDone. Check https://dash.cloudflare.com → Workers & Pages, D1 and R2 are empty of damp-tracker.');
