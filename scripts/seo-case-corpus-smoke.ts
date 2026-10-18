import assert from 'node:assert/strict';
import { field, value } from '../packages/db/src/firestore.js';
import { seoCaseCollect, seoCaseGet, seoCaseId, seoCaseList, seoCaseSummary } from '../packages/commands/src/seo-case-corpus.js';

process.env.FIREBASE_PROJECT_ID = 'test';
const docs = new Map<string, any>();
let commits = 0;
const now = '2026-10-18T00:00:00.000Z';
const recent = {
  domain: 'new-piano.example', hosts: ['www.new-piano.example'], registrationStatus: 'recent_registration',
  registrationDate: '2026-07-01T00:00:00.000Z', domainAgeDays: 109, rdapUrl: 'https://rdap.example/piano',
  bestPosition: 3, queryCount: 2, appearances: [
    { query: 'piano app comparison', position: 3, title: 'Hands-on comparison', url: 'https://new-piano.example/compare', provider: 'api', upstreamProvider: 'reserp', observedAt: now },
    { query: 'piano app for adults', position: 5, title: 'Adult guide', url: 'https://new-piano.example/adult', provider: 'api', upstreamProvider: 'reserp', observedAt: now }
  ]
};
const unknown = { ...recent, domain: 'unknown.example', registrationStatus: 'unknown', registrationDate: null, domainAgeDays: null, bestPosition: 6, queryCount: 1,
  appearances: [{ query: 'piano app comparison', position: 6, title: 'Unknown domain guide', url: 'https://unknown.example/guide', provider: 'brave', upstreamProvider: null, observedAt: now }] };
const discoveries = { recentRegistrationCandidates: [recent], unknownRegistrationCandidates: [unknown],
  olderRegistrationCount: 7, uncheckedDomainCount: 6,
  pageReviews: [{ status: 'read', domain: recent.domain, url: recent.appearances[0].url, finalUrl: recent.appearances[0].url, title: 'Real source', text: 'Detailed first-party source evidence.', truncated: true, fetchedAt: now }],
  coverage: { completedQueries: 2, stoppedEarly: false }, errors: [] };

const request: any = async (path: string, init?: RequestInit) => {
  if (path === ':commit') {
    const writes = JSON.parse(String(init?.body)).writes as any[];
    for (const write of writes) if (write.currentDocument?.exists === false && docs.has(write.update.name)) throw Error('unexpected duplicate');
    for (const write of writes) docs.set(write.update.name, write.update);
    commits++;
    return {};
  }
  if (path.startsWith('/seoCaseSites?')) {
    const entries = [...docs.values()].filter(v => v.name.includes('/seoCaseSites/'));
    return { documents: entries, nextPageToken: null };
  }
  const key = 'projects/test/databases/(default)/documents' + path;
  if (!docs.has(key)) {
    const { FirestoreError } = await import('../packages/db/src/firestore.js');
    throw new FirestoreError(404);
  }
  return docs.get(key);
};
const deps: any = { request, discover: async () => discoveries, clock: () => now, id: () => 'run-1' };
const first = await seoCaseCollect({ topic: 'piano learning', queries: ['piano app comparison', 'piano app for adults'] }, deps);
assert.equal(first.newlySaved, 2);
assert.equal(first.alreadyInCorpus, 0);
assert.equal(first.candidateCount, 2);
assert.equal(first.skippedForAgeOrBudget, 13);
assert.equal(first.newCases[0].registrationStatus, 'recent_registration');
assert.equal(commits, 1, 'one batch commit stores all first discoveries');
const listed = await seoCaseList({}, request);
assert.equal(listed.items.length, 2);
const stored = await seoCaseGet({ id: seoCaseId(recent.domain) }, request);
assert.equal(stored.pageEvidence[0].excerpt, 'Detailed first-party source evidence.');
assert.equal(stored.observations[0].upstreamProvider, 'reserp');
assert.equal(stored.topics[0], 'piano learning');
assert.equal(stored.interpretationStatus, 'unreviewed');
const summary = await seoCaseSummary({}, request);
assert.equal(summary.recentRegistration, 1);
assert.equal(summary.ageUnknown, 1);
assert.equal(summary.topicCoverage[0].domainCount, 2);
const repeated = await seoCaseCollect({ topic: 'new topic', queries: ['piano app comparison'] }, deps);
assert.equal(repeated.newlySaved, 0);
assert.equal(repeated.alreadyInCorpus, 2);
assert.equal(commits, 1, 'same domains must not produce historical refresh writes');
assert.deepEqual((await seoCaseGet({ id: seoCaseId(recent.domain) }, request)).topics, ['piano learning']);
const noUnknown = await seoCaseCollect({ topic: 'new topic', queries: ['piano app comparison'], includeUnknownAge: false }, deps);
assert.equal(noUnknown.candidateCount, 1);
assert.equal(noUnknown.newlySaved, 0);
assert.equal(commits, 1);
assert.equal(field('test').stringValue, 'test');
assert.equal(value(field(12)), 12);
console.log('seo case corpus smoke: create-only bulk storage, evidence, dedup, filters and summaries passed');
