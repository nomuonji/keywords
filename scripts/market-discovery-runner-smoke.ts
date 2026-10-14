import assert from 'node:assert/strict';
import { marketDiscoveryRun, assessDiscoveryGate } from '../packages/commands/src/market-discovery-runner.js';

let distributionCalls = 0;
let signalCalls = 0;
let productCalls = 0;
let gapCalls = 0;
let demandCalls = 0;
const fakeDistribution = async () => {
  distributionCalls++;
  return {
    cases: Array.from({ length: 8 }, (_, i) => ({
      sourcePlatform: 'hatena_bookmark', sourceId: 'hatena_life',
      sourcePostUrl: 'https://b.hatena.ne.jp/entry/' + i,
      discoverySourceUrl: 'https://b.hatena.ne.jp/hotentry/life',
      title: 'Observed subject ' + i,
      destinationUrl: 'https://example' + i + '.org/study',
      publishedAt: '2026-10-14T00:00:00.000Z',
      engagement: [{ metric: 'bookmarks', value: 20 }], observedTags: ['daily-life']
    })),
    observedNiches: [{ name: 'daily-life', exampleUrl: 'https://example0.org/study' }]
  };
};
const fakeSignals = async () => {
  signalCalls++;
  return {
    warnings: [],
    results: [{ source: 'google_trends', url: 'https://trends.google.com/trending?geo=JP', observations: [
      { source: 'google_trends', label: 'Arts', url: 'https://trends.google.com/trending?geo=JP',
        observedAt: '2026-10-14T00:00:00.000Z', metrics: { approxTraffic: 1000 } },
      { source: 'google_trends', label: 'Local history', url: 'https://trends.google.com/trending?geo=JP',
        observedAt: '2026-10-14T00:00:00.000Z', metrics: { approxTraffic: 500 } }
    ] }]
  };
};
const fakeProducts = async () => { productCalls++; throw Error('ranking provider unavailable'); };
const broad = await marketDiscoveryRun({ phase: 'observe', objective: 'Explore diverse database site ideas', maxObservations: 16 }, {
  distribution: fakeDistribution as any, signals: fakeSignals as any, products: fakeProducts as any
});
if (broad.phase !== 'observe') throw Error('expected observation');
assert.equal(broad.observations.length, 10);
assert.deepEqual(broad.coverage.observedPlatforms, ['hatena_bookmark', 'google_trends']);
assert.equal(broad.coverage.observedRecords, 10);
assert.ok(!('sufficientForInitialHypotheses' in broad.coverage));
assert.equal(broad.observations.filter(x => x.family === 'ranked_commerce').length, 0);
assert.equal(productCalls, 0);
assert.equal(gapCalls, 0);
assert.equal(broad.writes, 0);

const narrow = await marketDiscoveryRun({ phase: 'observe', sources: ['open_signals'], maxObservations: 1 }, {
  distribution: fakeDistribution as any, signals: fakeSignals as any
});
if (narrow.phase !== 'observe') throw Error('expected observation');
assert.equal(narrow.observations.length, 1);
assert.equal(narrow.coverage.totalBeforeLimit, 2);
assert.equal(distributionCalls, 1);

const partial = await marketDiscoveryRun({ phase: 'observe', sources: ['curated_links', 'open_signals'] }, {
  distribution: fakeDistribution as any,
  signals: (async () => { throw Error('HTTP 429'); }) as any
});
if (partial.phase !== 'observe') throw Error('expected observation');
assert.equal(partial.observations.length, 8);
assert.equal(partial.coverage.unavailableSources.length, 1);
assert.equal(partial.coverage.unavailableSources[0].source, 'open_signals');

const fakeGap = async () => {
  gapCalls++;
  return {
    serp: { provider: 'api', results: [
      { title: 'Directory', link: 'https://competa.example/page', snippet: 'existing directory' },
      { title: 'Other', link: 'https://competb.example/page', snippet: 'other directory' }
    ] },
    pages: [
      { url: 'https://competa.example/page', status: 'read', text: 'Current directory already answers part of this need.' },
      { url: 'https://competb.example/page', status: 'read', text: 'Other directory covers the rest.' }
    ],
    observations: [{ url: 'https://competa.example/source', status: 'read', text: 'Source from same publisher.' }]
  };
};
const candidate = {
  name: 'Local history database', audience: 'Residents researching places',
  userNeed: 'Find historical changes for a specific neighborhood',
  databaseUnit: 'dated place record', interaction: 'navigate a map and timeline',
  query: 'local history map', evidenceUrls: ['https://competa.example/source']
};
// A known candidate can be investigated directly; broad observation is not a required stage.
const focused = await marketDiscoveryRun({ phase: 'validate', objective: 'Decide whether to build', candidates: [candidate] }, {
  distribution: (async () => { throw Error('must not observe'); }) as any,
  signals: (async () => { throw Error('must not scan'); }) as any,
  gap: fakeGap as any,
  demand: async () => { demandCalls++; return { results: [] }; }
});
if (focused.phase !== 'validate') throw Error('expected validation');
assert.equal(focused.results[0].gate.status, 'evidence_review_required');
assert.equal(focused.results[0].gate.independence, 'unverified');
assert.equal(focused.results[0].gate.checks.distinctEvidenceHostObserved, false);
assert.equal(focused.results[0].gate.canClaimVerifiedOpportunity, false);
assert.equal(focused.results[0].searchDemand, null);
assert.equal(demandCalls, 0);
assert.equal(gapCalls, 1);
assert.match(focused.results[0].search.competitorPages[0].excerpt ?? '', /already answers/);

const withDemand = await marketDiscoveryRun({ phase: 'validate', candidates: [candidate], withDemand: true }, {
  gap: fakeGap as any, demand: async () => { demandCalls++; return { results: [{ keyword: candidate.query, avgMonthlySearches: 0 }] }; }
});
if (withDemand.phase !== 'validate') throw Error('expected validation');
assert.equal(withDemand.results[0].gate.checks.demandObserved, true);
assert.equal(demandCalls, 1);
assert.equal(withDemand.results[0].gate.canClaimVerifiedOpportunity, false);

const unavailable = await marketDiscoveryRun({ phase: 'validate', candidates: [candidate], withDemand: true }, {
  gap: (async () => { throw Error('HTTP 429'); }) as any,
  demand: async () => { throw Error('HTTP 429'); }
});
if (unavailable.phase !== 'validate') throw Error('expected validation');
assert.equal(unavailable.results[0].gate.status, 'insufficient_evidence');
assert.equal(unavailable.results[0].warnings.length, 2);
assert.equal(unavailable.results[0].search.results.length, 0);
assert.equal(unavailable.results[0].gate.canClaimVerifiedOpportunity, false);

// A narrow, non-DB question can start directly, and a quota error stops the batch.
let callsAfterQuota = 0;
const flexible = await marketDiscoveryRun({ phase: 'validate', candidates: [
  { name: 'Local history activity', query: 'local history activity',
    question: 'Are people asking for neighborhood history events?' },
  { name: 'Community archive', query: 'community archive',
    question: 'Are original records available to the public?' }
] }, { gap: (async () => { callsAfterQuota++; throw Error('HTTP 429 quota exceeded'); }) as any });
if (flexible.phase !== 'validate') throw Error('expected validation');
assert.equal(callsAfterQuota, 1);
assert.deepEqual(flexible.skippedCandidates, ['Community archive']);
assert.equal(flexible.results[0].candidate.databaseUnit, null);
assert.equal(flexible.results[0].gate.canClaimVerifiedOpportunity, false);

const gate = assessDiscoveryGate({
  competitorPages: [{ url: 'https://one.test', status: 'unavailable' }],
  evidencePages: [], resultCount: 2, demandAvailable: false
});
assert.equal(gate.status, 'insufficient_evidence');
assert.ok(gate.missing.includes('no_competitor_body_read'));
await assert.rejects(marketDiscoveryRun({ phase: 'validate', candidates: [] }));
await assert.rejects(marketDiscoveryRun({ phase: 'observe', candidates: [candidate] }));
console.log('adaptive market discovery: selective observation, direct focus, provenance, cost and partial failures passed');
