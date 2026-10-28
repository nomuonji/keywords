import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectionSlice, isProactiveInspectionCandidate, proactiveInspectionPriority } from './site-indexation-policy.js';
import { isTemporaryGoogleInspectionFailure, classifyGoogleInspectionFailures } from './site-indexation-transient.js';

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
const proactiveMinAge = envNumber('SITE_INDEXATION_PROACTIVE_MIN_AGE_HOURS');
const scheduledDaily = perRun * hours.length;

assert.equal(perRun, 450);
assert.equal(scheduledDaily, 1800, 'use most of the 2,000/day Google per-property cap');
assert.ok(scheduledDaily <= guard && guard <= 1900, 'guard must reserve room for manual checks and third-party calls');
assert.ok(2000 - scheduledDaily >= 200, 'at least 200 daily Google requests reserved as headroom');
assert.ok(global >= perRun && global <= 10000, 'global guard must not strangle one property');
assert.ok(chunk > 0 && chunk <= 50, 'per-site chunk must respect inspect command schema');
assert.equal(proactiveMinAge, 48, 'spare quota rechecks unresolved URLs no more than once per 48-hour window');
assert.match(scheduler, /siteIndexationList/);
assert.match(scheduler, /proactiveCandidatesRemaining/);

const nowMs = Date.parse('2026-10-28T00:00:00.000Z');
const oldCrawledNotIndexed = {
  inventoryState: 'current',
  indexable: true,
  lastInspectedAt: '2026-10-26T00:00:00.000Z',
  observedIndexState: 'not_indexed',
  coverageState: 'Crawled - currently not indexed',
  indexingState: 'INDEXING_ALLOWED',
  robotsTxtState: 'ALLOWED',
  pageFetchState: 'SUCCESSFUL',
  googleCanonical: 'https://example.com/page/',
  userCanonical: 'https://example.com/page'
};
assert.equal(isProactiveInspectionCandidate(oldCrawledNotIndexed, nowMs, proactiveMinAge), true,
  'old, successfully crawled but unindexed URLs must qualify for spare-quota rechecks');
assert.equal(isProactiveInspectionCandidate({ ...oldCrawledNotIndexed, lastInspectedAt: '2026-10-26T01:00:00.000Z' }, nowMs, proactiveMinAge), false,
  'recent observations must not be rechecked before the cooldown');
assert.equal(isProactiveInspectionCandidate({ ...oldCrawledNotIndexed, observedIndexState: 'indexed' }, nowMs, proactiveMinAge), false,
  'indexed URLs stay on their ordinary cadence');
assert.equal(isProactiveInspectionCandidate({ ...oldCrawledNotIndexed, indexingState: 'BLOCKED_BY_META_TAG' }, nowMs, proactiveMinAge), false,
  'explicit noindex/technical blockers must not be repeatedly inspected');
assert.equal(isProactiveInspectionCandidate({ ...oldCrawledNotIndexed, googleCanonical: 'https://example.com/other' }, nowMs, proactiveMinAge), false,
  'canonical conflicts require a technical fix, not repeated inspections');
assert.equal(isProactiveInspectionCandidate({
  ...oldCrawledNotIndexed,
  coverageState: 'URL is unknown to Google',
  indexingState: 'INDEXING_STATE_UNSPECIFIED',
  robotsTxtState: 'ROBOTS_TXT_STATE_UNSPECIFIED',
  pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED',
  googleCanonical: null,
  userCanonical: null
}, nowMs, proactiveMinAge), true,
  'old URLs unknown to Google are eligible for proactive discovery-state checks');
assert.equal(isProactiveInspectionCandidate({ ...oldCrawledNotIndexed, inventoryState: 'removed' }, nowMs, proactiveMinAge), false,
  'removed URLs must never enter proactive inspection');
assert.equal(proactiveInspectionPriority('Crawled - currently not indexed'), 0);
assert.equal(proactiveInspectionPriority('Discovered - currently not indexed'), 1);
assert.equal(proactiveInspectionPriority('URL is unknown to Google'), 2);
assert.match(scheduler, /at.getUTCHours\(\) >= 18/, 'weekly snapshot must occur only on the 19 UTC run');

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

// Google URL Inspection failures remain visible in run JSON but must not
// invalidate correctly saved observations from other URLs/properties.
const internal = 'HTTP 500 from https://searchconsole.googleapis.com/v1/urlInspection/index:inspect: { "error": { "code": 500, "message": "Internal error encountered." }}';
const timeout = 'The operation was aborted due to timeout';
assert.equal(isTemporaryGoogleInspectionFailure(internal), true);
assert.equal(isTemporaryGoogleInspectionFailure(timeout), true);
assert.equal(isTemporaryGoogleInspectionFailure('HTTP 503 from https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'), true);
assert.equal(isTemporaryGoogleInspectionFailure('HTTP 403 from https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'), false);
assert.equal(isTemporaryGoogleInspectionFailure('Firestore 429 RESOURCE_EXHAUSTED'), false);
assert.equal(isTemporaryGoogleInspectionFailure('The operation was aborted due to timeout', 'site-operation'), false, 'ambiguous site/storage timeouts remain operational failures');
assert.equal(isTemporaryGoogleInspectionFailure('schema is invalid'), false);
const temporaryOnly = classifyGoogleInspectionFailures(2, [{error:internal},{error:timeout}]);
assert.deepEqual(temporaryOnly,{transient:2,other:0,unreported:0});
assert.deepEqual(classifyGoogleInspectionFailures(3,[{error:internal},{error:'HTTP 403 from https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'},{error:timeout}]), {transient:2,other:1,unreported:0});
assert.deepEqual(classifyGoogleInspectionFailures(3,[{error:internal}]), {transient:1,other:2,unreported:2}, 'truncated error details must not be assumed transient');
// The job's exit code depends on nontransient (blocking) failures only.
assert.equal(temporaryOnly.other,0);

console.log(JSON.stringify({
  scheduledRunsPerDay: hours.length,
  scheduledMaxPerPropertyPerDay: scheduledDaily,
  dailySharedGuardPerProperty: guard,
  GoogleQPDHeadroom: 2000 - scheduledDaily,
  allPropertiesRunGuard: global
}));
