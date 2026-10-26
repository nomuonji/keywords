import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { firestore, firestoreDocumentName, firestoreRoutingStatus, routeFirestoreRequest, resetSitesCutoverCache, FirestoreError } from '../packages/db/src/firestore.js';

// Deterministic double for the Keywords/Sites Firebase project split.
// Never loads .env or touches production data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'kw@example.com', private_key: pem, project_id: 'kw-project' });
process.env.FIREBASE_PROJECT_ID = 'kw-project';
delete process.env.SITES_FIREBASE_PROJECT_ID;
process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS = '0';

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; body: any }> = [];
let interlockReads = 0;
let migrationState: unknown = null; // _migrations/sites-firestore-split in the Sites project
let respond: (url: string) => { status: number; body?: unknown } = () => ({ status: 200, body: {} });
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  if (url.endsWith('/documents/_migrations/sites-firestore-split')) {
    assert.equal(project(url), 'sites-project', 'interlock state is read from the Sites project');
    interlockReads++;
    return migrationState ? Response.json({ fields: { state: { stringValue: JSON.stringify(migrationState) } } }) : Response.json({}, { status: 404 });
  }
  calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
  const result = respond(url);
  return Response.json(result.body ?? {}, { status: result.status });
};
const project = (url: string) => url.split('/projects/')[1].split('/')[0];
const commit = (...paths: string[]) => ({ method: 'POST', body: JSON.stringify({ writes: paths.map(path => ({ update: { name: firestoreDocumentName(path), fields: {} } })) }) });

try {
  // 1. Legacy (default): everything goes to the shared project, even Sites collections.
  delete process.env.SITES_FIRESTORE_TARGET;
  delete process.env.SITES_FIREBASE_SERVICE_ACCOUNT_JSON;
  calls = [];
  await firestore('/sites/a');
  await firestore('/researchSessions/b');
  assert.deepEqual(calls.map(call => project(call.url)), ['kw-project', 'kw-project']);
  assert.equal(firestoreRoutingStatus().mode, 'legacy_shared');

  // 2. Cutover without Sites credentials must fail loudly instead of silently splitting writes.
  process.env.SITES_FIRESTORE_TARGET = 'sites';
  await assert.rejects(routeFirestoreRequest('/sites/a'), /SITES_FIREBASE_SERVICE_ACCOUNT_JSON is not configured/);
  assert.equal(firestoreRoutingStatus().configurationError?.includes('not configured'), true);
  process.env.SITES_FIRESTORE_TARGET = 'bogus';
  await assert.rejects(routeFirestoreRequest('/sites/a'), /must be "legacy" or "sites"/);

  // 3a. Interlock: the flag alone does not move traffic before the migration copy has finished.
  process.env.SITES_FIRESTORE_TARGET = 'sites';
  process.env.SITES_FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sites@example.com', private_key: pem, project_id: 'sites-project' });
  calls = [];
  await firestore('/sites/a');
  await firestore('/seoTasks/b');
  await firestore('/researchSessions/c');
  assert.deepEqual(calls.map(call => project(call.url)), ['kw-project', 'kw-project', 'kw-project']);
  assert.equal(interlockReads, 1, 'not-ready result is cached briefly');
  assert.equal(firestoreRoutingStatus().cutover, 'waiting_for_migration_copy');
  assert.equal(firestoreRoutingStatus().mode, 'legacy_shared');
  // An unfinished copy or a state recorded for other projects is not ready either.
  migrationState = { sourceProjectId: 'kw-project', targetProjectId: 'sites-project', copy: { startedAt: '2026-10-26T00:00:00Z' } };
  resetSitesCutoverCache();
  assert.equal(await routeFirestoreRequest('/sites/a'), 'keywords');
  migrationState = { sourceProjectId: 'other', targetProjectId: 'sites-project', copy: { startedAt: '2026-10-26T00:00:00Z', finishedAt: '2026-10-26T01:00:00Z' } };
  resetSitesCutoverCache();
  assert.equal(await routeFirestoreRequest('/sites/a'), 'keywords');
  // Finished copy for these projects: cutover.
  migrationState = { sourceProjectId: 'kw-project', targetProjectId: 'sites-project', copy: { startedAt: '2026-10-26T00:00:00Z', finishedAt: '2026-10-26T01:00:00Z' } };
  resetSitesCutoverCache();
  assert.equal(await routeFirestoreRequest('/sites/a'), 'sites');
  // Once ready, a process never switches back, even if the state disappears.
  migrationState = null;
  interlockReads = 0;
  assert.equal(await routeFirestoreRequest('/seoTasks/x'), 'sites');
  assert.equal(interlockReads, 0);

  // 3b. Split: route by owning collection.
  const status = firestoreRoutingStatus();
  assert.equal(status.cutover, 'active');
  assert.equal(status.mode, 'split');
  assert.equal(status.sitesProjectId, 'sites-project');
  assert.equal(status.keywordsProjectId, 'kw-project');

  calls = [];
  await firestore('/sites/a/indexationBundle/current');
  await firestore('/seoTasks?pageSize=10');
  await firestore('/siteStructures/concept-1'); // Sites reads a Site Concept: stays in Keywords project
  await firestore('/seoPlanningDigests/site-1'); // Keywords reads GSC digest: Sites project
  await firestore('/keywordTreasury?pageSize=100');
  await firestore('/sites/a/indexationUrls?pageSize=1000');
  assert.deepEqual(calls.map(call => project(call.url)), ['sites-project', 'sites-project', 'kw-project', 'sites-project', 'kw-project', 'sites-project']);

  // Queries route by structuredQuery.from; aggregation queries too.
  calls = [];
  await firestore(':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'optimizationEvents' }] } }) });
  await firestore(':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'ideaMemory' }] } }) });
  await firestore(':runAggregationQuery', { method: 'POST', body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'growthInitiatives' }] } } }) });
  assert.deepEqual(calls.map(call => project(call.url)), ['sites-project', 'kw-project', 'sites-project']);

  // 4. Commits: runs follow the commit; document names are rewritten to the routed project.
  calls = [];
  await firestore(':commit', commit('seoTasks/t1', 'runs/r1'));
  assert.equal(project(calls[0].url), 'sites-project');
  for (const write of calls[0].body.writes) assert.ok(write.update.name.startsWith('projects/sites-project/databases/(default)/documents/'), write.update.name);
  calls = [];
  await firestore(':commit', commit('researchSessions/s1', 'runs/r2'));
  assert.equal(project(calls[0].url), 'kw-project');
  for (const write of calls[0].body.writes) assert.ok(write.update.name.startsWith('projects/kw-project/'), write.update.name);
  // A name built while legacy (or by another helper) is still retargeted.
  calls = [];
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: 'projects/kw-project/databases/(default)/documents/sites/a/sitemapSubmission/state', fields: {} }, currentDocument: { exists: false } }, { delete: 'projects/kw-project/databases/(default)/documents/sites/a/indexationBundle/shard-3' }] }) });
  assert.equal(project(calls[0].url), 'sites-project');
  assert.ok(calls[0].body.writes[0].update.name.startsWith('projects/sites-project/'));
  assert.ok(calls[0].body.writes[1].delete.startsWith('projects/sites-project/'));
  assert.deepEqual(calls[0].body.writes[0].currentDocument, { exists: false });
  // Mixed commits cannot be atomic across projects and are refused before any network call.
  calls = [];
  await assert.rejects(firestore(':commit', commit('seoTasks/t1', 'keywordTreasury/k1')), /mixes Sites and Keywords/);
  assert.equal(calls.length, 0);

  // batchGet follows its documents.
  calls = [];
  await firestore(':batchGet', { method: 'POST', body: JSON.stringify({ documents: [firestoreDocumentName('sites/a/indexationBundle/current'), firestoreDocumentName('sites/b/indexationBundle/current')] }) });
  await firestore(':batchGet', { method: 'POST', body: JSON.stringify({ documents: [firestoreDocumentName('keywordTreasury/k1')] }) });
  assert.deepEqual(calls.map(call => project(call.url)), ['sites-project', 'kw-project']);
  assert.ok(calls[0].body.documents.every((name: string) => name.startsWith('projects/sites-project/')));

  // 5. Daily quota circuits are per project: an exhausted Sites project does not block Keywords.
  respond = url => project(url) === 'sites-project' ? { status: 429, body: { error: { message: 'Quota exceeded for free tier daily document reads limit' } } } : { status: 200, body: { ok: true } };
  await assert.rejects(firestore('/seoTasks/x'), (error: unknown) => error instanceof FirestoreError && error.status === 429 && error.target === 'sites');
  calls = [];
  await assert.rejects(firestore('/sites/y'), (error: unknown) => error instanceof FirestoreError && error.kind === 'daily_quota');
  assert.equal(calls.length, 0, 'open circuit must not call the exhausted project again');
  assert.deepEqual(await firestore('/ideaMemory/z'), { ok: true });

  console.log('firestore routing smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
