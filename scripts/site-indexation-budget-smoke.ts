import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectionSlice } from './site-indexation-policy.js';

const workflow = readFileSync('.github/workflows/site-indexation.yml', 'utf8');
const scheduler = readFileSync('scripts/site-indexation-sweep.ts', 'utf8');

function envNumber(key: string) {
  const match = workflow.match(new RegExp(`^\\s+${key}: '(\\d+)'$`, 'm'));
  assert.ok(match, `GitHub Actions must define ${key}`);
  return Number(match[1]);
}

const cron = workflow.match(/- cron: '17 ([0-9,]+) \* \* \*'/);
assert.ok(cron, 'inspection schedule must specify UTC hour slots');
const hours = cron[1].split(',').map(Number).sort((a, b) => a - b);
assert.deepEqual(hours, [1, 7, 13, 19], 'four 6-hourly sweeps avoid daily measurement');
assert.match(scheduler, /const RUN_INTERVAL_HOURS = 6;/);

const perRun = envNumber('SITE_INDEXATION_PROPERTY_RUN_BUDGET');
const global = envNumber('SITE_INDEXATION_GLOBAL_RUN_BUDGET');
const guard = envNumber('SITES_INDEXATION_DAILY_BUDGET');
const chunk = envNumber('SITE_INDEXATION_SITE_CHUNK');
const scheduledDaily = perRun * hours.length;

assert.equal(perRun, 450);
assert.equal(scheduledDaily, 1800, 'use most of the 2,000/day Google per-property cap');
assert.ok(scheduledDaily <= guard && guard <= 1900, 'guard must reserve room for manual checks and third-party calls');
assert.ok(2000 - scheduledDaily >= 200, 'at least 200 daily Google requests reserved as headroom');
assert.ok(global >= perRun && global <= 10000, 'global guard must not strangle one property');
assert.ok(chunk > 0 && chunk <= 50, 'per-site chunk must respect inspect command schema');
assert.match(scheduler, /at.getUTCHours\\(\\) >= 18/, 'weekly snapshot must occur only on the 19 UTC run');

// Shared-domain fairness: 14 antonbase.com sites must all get a first slice,
// rather than the first 9 consuming all 450 URLs in 50-URL chunks.
let remaining = perRun;
const portions: number[] = [];
for (let unvisited = 14; unvisited > 0; unvisited--) {
  const share = inspectionSlice(remaining, unvisited, chunk);
  portions.push(share);
  remaining -= share;
}
assert.equal(remaining, 0, 'all quota should be distributed when all sites have due URLs');
assert.equal(portions.length, 14);
assert.ok(Math.max(...portions) - Math.min(...portions) <= 1,
  'each site must receive a nearly equal first-pass share');
assert.ok(portions.every(n => n > 0), 'no site may starve behind large domains');
assert.equal(inspectionSlice(450, 2, 50), 50, 'large per-site backlogs still respect 50-URL API batch cap');

console.log(JSON.stringify({
  scheduledRunsPerDay: hours.length,
  scheduledMaxPerPropertyPerDay: scheduledDaily,
  dailySharedGuardPerProperty: guard,
  GoogleQPDHeadroom: 2000 - scheduledDaily,
  allPropertiesRunGuard: global
}));
