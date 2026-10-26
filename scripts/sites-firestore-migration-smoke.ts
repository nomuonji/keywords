import assert from 'node:assert/strict';
import { FirestoreError, type FirestoreTarget } from '../packages/db/src/firestore.js';
import { runSitesFirestoreMigration, type Transport } from '../packages/commands/src/sites-firestore-migration.js';

// In-memory double of two Firestore projects. Never touches the network.
process.env.FIREBASE_PROJECT_ID = 'kw-p';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'kw-p' });
process.env.SITES_FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'sites-p' });
delete process.env.SITES_FIREBASE_PROJECT_ID;
delete process.env.SITES_FIRESTORE_TARGET;

let clock = Date.parse('2026-10-26T00:00:00Z');
const tick = () => new Date(clock += 1000).toISOString();
type Doc = { fields: any; updateTime: string };
const projects: Record<FirestoreTarget, Map<string, Doc>> = { keywords: new Map(), sites: new Map() };
const projectId: Record<FirestoreTarget, string> = { keywords: 'kw-p', sites: 'sites-p' };
const reads: Record<FirestoreTarget, number> = { keywords: 0, sites: 0 };
const writes: Record<FirestoreTarget, number> = { keywords: 0, sites: 0 };
let readLimit: Record<FirestoreTarget, number> = { keywords: Infinity, sites: Infinity };

const fullName = (target: FirestoreTarget, path: string) => `projects/${projectId[target]}/databases/(default)/documents/${path}`;
const relative = (name: string) => name.slice(name.indexOf('/documents/') + '/documents/'.length);
const put = (target: FirestoreTarget, path: string, data: Record<string, unknown>) => projects[target].set(path, { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }])), updateTime: tick() });
const view = (target: FirestoreTarget, path: string) => ({ name: fullName(target, path), fields: projects[target].get(path)!.fields, updateTime: projects[target].get(path)!.updateTime });
function charge(target: FirestoreTarget, n: number) {
  reads[target] += Math.max(1, n);
  if (reads[target] > readLimit[target]) throw new FirestoreError(429, 'daily_quota', target);
}
const children = (target: FirestoreTarget, collectionPath: string) => [...projects[target].keys()].filter(path => path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/')).sort();

const transport: Transport = async (target, rawPath, init) => {
  const [path, query = ''] = rawPath.split('?');
  const params = new URLSearchParams(query);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  const store = projects[target];
  if (path === ':commit') {
    const batch = body.writes as any[];
    for (const write of batch) {
      const name = relative(write.update?.name ?? write.delete);
      assert.ok((write.update?.name ?? write.delete).startsWith(`projects/${projectId[target]}/`), 'document name must carry the target project');
      const existing = store.get(name);
      if (write.currentDocument?.exists === false && existing) throw new FirestoreError(400);
      if (write.currentDocument?.updateTime && existing?.updateTime !== write.currentDocument.updateTime) throw new FirestoreError(400);
    }
    for (const write of batch) {
      if (write.delete) store.delete(relative(write.delete)); else store.set(relative(write.update.name), { fields: write.update.fields, updateTime: tick() });
      writes[target]++;
    }
    return { writeResults: [] };
  }
  if (path === ':batchGet') {
    charge(target, body.documents.length);
    return body.documents.map((name: string) => store.has(relative(name)) ? { found: view(target, relative(name)) } : { missing: name });
  }
  if (path.endsWith(':runAggregationQuery')) {
    const parent = path.slice(1, -':runAggregationQuery'.length);
    const collectionId = body.structuredAggregationQuery.structuredQuery.from[0].collectionId;
    const n = children(target, parent ? `${parent}/${collectionId}` : collectionId).length;
    charge(target, Math.ceil(n / 1000));
    return [{ result: { aggregateFields: { n: { integerValue: String(n) } } } }];
  }
  if (path.endsWith(':listCollectionIds')) {
    charge(target, 1);
    const doc = path.slice(1, -':listCollectionIds'.length);
    return { collectionIds: [...new Set([...store.keys()].filter(p => p.startsWith(`${doc}/`)).map(p => p.slice(doc.length + 1).split('/')[0]))] };
  }
  const segments = path.slice(1).split('/');
  if (segments.length % 2 === 0) { // document
    charge(target, 1);
    if (!store.has(path.slice(1))) throw new FirestoreError(404);
    return view(target, path.slice(1));
  }
  const collection = path.slice(1);
  let names = children(target, collection);
  if (params.get('showMissing') === 'true') {
    const phantom = [...store.keys()].filter(p => p.startsWith(`${collection}/`)).map(p => p.split('/').slice(0, segments.length + 1).join('/'));
    names = [...new Set([...names, ...phantom])].sort();
  }
  const offset = Number(params.get('pageToken') ?? 0); const size = Number(params.get('pageSize') ?? 300);
  const page = names.slice(offset, offset + size);
  charge(target, page.length);
  return { documents: page.map(name => store.has(name) ? view(target, name) : { name: fullName(target, name) }), ...(offset + size < names.length ? { nextPageToken: String(offset + size) } : {}) };
};
const now = () => new Date(clock);
const sitesData = () => [...projects.sites.keys()].filter(path => !path.startsWith('_migrations/')).sort();

// --- seed the legacy project ---------------------------------------------
put('keywords', 'sites/a', { name: 'A' });
put('keywords', 'sites/a/indexationBundle/current', { format: 'single', data: 'zip' });
put('keywords', 'sites/a/indexationUrls/u1', { url: 'https://a/1' }); // folded into the bundle: not copied
put('keywords', 'sites/b/indexationUrls/u2', { url: 'https://b/2' }); // phantom parent, no bundle: copied
put('keywords', 'sites/b/sitemapSubmission/state', { status: 'submitted' });
for (let i = 1; i <= 250; i++) put('keywords', `seoTasks/t${i}`, { status: 'ready', n: i });
put('keywords', 'optimizationEvents/e1', { result: 'pending' });
put('keywords', 'seoPortfolioPolicies/organic-search', { revision: 3 });
put('keywords', 'researchSessions/r1', { kind: 'keywords' }); // Keywords data: never copied
put('keywords', 'siteStructures/c1', { kind: 'concept' });
put('keywords', 'runs/x', { actor: 'sites_remote_mcp' });

// 1. inventory is read-only.
let report = await runSitesFirestoreMigration({ mode: 'inventory', transport, now });
assert.equal(report.outcome, 'completed');
assert.equal(writes.sites, 0);
const counts = Object.fromEntries(report.units!.map(unit => [unit.path, unit.source]));
assert.equal(counts.seoTasks, 250);
assert.equal(counts['sites/b/indexationUrls'], 1);
assert.equal(counts['sites/a/indexationUrls'], undefined);
assert.ok(report.skipped.some(item => item.startsWith('sites/a/indexationUrls')));

// 2. copy pauses at the legacy read budget and resumes from its checkpoint.
report = await runSitesFirestoreMigration({ mode: 'copy', transport, now, maxSourceReads: 120 });
assert.equal(report.outcome, 'paused_budget', report.message);
const partial = sitesData().length;
assert.ok(partial > 0 && partial < 255, `partial copy ${partial}`);
// A daily-quota 429 on the legacy project also pauses cleanly.
readLimit = { keywords: reads.keywords + 5, sites: Infinity };
report = await runSitesFirestoreMigration({ mode: 'copy', transport, now });
assert.equal(report.outcome, 'paused_quota', report.message);
readLimit = { keywords: Infinity, sites: Infinity };
report = await runSitesFirestoreMigration({ mode: 'copy', transport, now });
assert.equal(report.outcome, 'completed', report.message);
const expected = [...projects.keywords.keys()].filter(path => !path.startsWith('researchSessions/') && !path.startsWith('siteStructures/') && !path.startsWith('runs/') && path !== 'sites/a/indexationUrls/u1').sort();
assert.deepEqual(sitesData(), expected);
for (const path of expected) assert.deepEqual(projects.sites.get(path)!.fields, projects.keywords.get(path)!.fields, path);
assert.ok(projects.keywords.has('seoTasks/t1'), 'legacy data is never deleted');

// 3. guards: no second copy, no copy after cutover.
report = await runSitesFirestoreMigration({ mode: 'copy', transport, now });
assert.equal(report.outcome, 'refused');
process.env.SITES_FIRESTORE_TARGET = 'sites';
report = await runSitesFirestoreMigration({ mode: 'copy', transport, now, restart: true });
assert.equal(report.outcome, 'refused');

// 4. gap writes in legacy (before every writer switched) and live writes in the Sites project.
put('keywords', 'seoTasks/t1', { status: 'claimed', n: 1 });            // changed in legacy only -> updated
projects.keywords.delete('seoTasks/t2');                                 // deleted in legacy -> deleted
put('keywords', 'seoTasks/t999', { status: 'ready', n: 999 });          // created in legacy -> created
put('keywords', 'seoTasks/t3', { status: 'cancelled', n: 3 });          // changed in both -> Sites version kept
put('sites', 'seoTasks/t3', { status: 'completed', n: 3 });
put('sites', 'seoTasks/t1000', { status: 'ready', n: 1000 });           // created live in Sites -> kept
put('keywords', 'sites/c/sitemapSubmission/state', { status: 'new' });  // new site during the gap -> created
report = await runSitesFirestoreMigration({ mode: 'delta', transport, now });
assert.equal(report.outcome, 'completed', report.message);
assert.equal(projects.sites.get('seoTasks/t1')!.fields.status.stringValue, 'claimed');
assert.equal(projects.sites.has('seoTasks/t2'), false);
assert.equal(projects.sites.get('seoTasks/t999')!.fields.n.integerValue, '999');
assert.equal(projects.sites.get('seoTasks/t3')!.fields.status.stringValue, 'completed');
assert.equal(projects.sites.has('seoTasks/t1000'), true);
assert.equal(projects.sites.has('sites/c/sitemapSubmission/state'), true);
assert.equal(report.created, 2);
assert.equal(report.updated, 1);
assert.equal(report.deleted, 1);
assert.equal(report.conflicts.length, 1);
assert.match(report.conflicts[0], /seoTasks\/t3/);

// 5. verify reports the expected live-only difference and nothing else.
report = await runSitesFirestoreMigration({ mode: 'verify', transport, now });
const mismatched = report.units!.filter(unit => unit.status !== 'match').map(unit => unit.path);
assert.deepEqual(mismatched, ['seoTasks']);
report = await runSitesFirestoreMigration({ mode: 'verify', transport, now, deep: true });
assert.deepEqual(report.conflicts.sort(), ['seoTasks/t1000: only in Sites project', 'seoTasks/t3: fields differ']);

// 6. Same project on both sides is refused before anything runs.
process.env.SITES_FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'kw-p' });
await assert.rejects(runSitesFirestoreMigration({ mode: 'inventory', transport, now }), /are the same/);

console.log(`sites firestore migration smoke passed (legacy reads ${reads.keywords}, sites writes ${writes.sites})`);
