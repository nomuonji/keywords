import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { field } from '../packages/db/src/firestore.js';

// Deterministic Firestore double. Never loads .env or touches production data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
const originalFetch = globalThis.fetch;

docs.set(`${root}sites/site-r`, {
  name: `${root}sites/site-r`,
  fields: {
    id: field('site-r'), localProjectId: field(null), name: field('Site R'), repository: field('nomuonji/site-r'),
    productionUrl: field('https://example.com'), deploymentProvider: field('other'),
    ga4PropertyId: field(null), searchConsoleProperty: field(null),
    status: field('active'), revision: field(1), createdAt: field('2026-09-01T00:00:00.000Z'), updatedAt: field('2026-09-01T00:00:00.000Z'),
  },
  updateTime: 'seed-1',
});
docs.set(`${root}seoPlanningDigests/site-r`, {
  name: `${root}seoPlanningDigests/site-r`,
  fields: {
    siteId: field('site-r'), repository: field('nomuonji/site-r'), productionUrl: field('https://example.com/'),
    generatedAt: field('2026-09-18T00:00:00.000Z'), measurementEnd: field('2026-09-15'), inventoryCount: field(7),
    selectedCount: field(5), notObservedInComplete90dGscCount: field(2), statuses: field({ gsc90: 'complete' })
  },
  updateTime: 'seed-2',
});


const urlRows = [
  { id: 'one', siteId: 'site-r', url: 'https://example.com/a', inventoryState: 'current', indexable: true, lastInspectedAt: '2026-10-01T00:00:00Z', observedIndexState: 'indexed', pageFamily: '/articles/*', nextInspectionAt: null },
  { id: 'two', siteId: 'site-r', url: 'https://example.com/b', inventoryState: 'current', indexable: true, lastInspectedAt: '2026-10-01T00:00:00Z', observedIndexState: 'not_indexed', pageFamily: '/articles/*', nextInspectionAt: null }
];
docs.set(`${root}sites/site-r/indexationBundle/current`, {
  name: `${root}sites/site-r/indexationBundle/current`,
  fields: { format: field('single'), data: field(gzipSync(Buffer.from(JSON.stringify(urlRows)), { level: 6 }).toString('base64')) },
  updateTime: 'seed-indexation'
});
const thisMonday = new Date();
thisMonday.setUTCHours(0, 0, 0, 0);
thisMonday.setUTCDate(thisMonday.getUTCDate() - (thisMonday.getUTCDay() + 6) % 7);
for (let offset = 1; offset >= 0; offset--) {
  const week = new Date(thisMonday);
  week.setUTCDate(week.getUTCDate() - offset * 7);
  const weekStart = week.toISOString().slice(0, 10);
  const id = createHash('sha256').update(JSON.stringify({ siteId: 'site-r', weekStart })).digest('hex').slice(0, 40);
  docs.set(`${root}indexationSnapshots/${id}`, {
    name: `${root}indexationSnapshots/${id}`,
    fields: {
      id: field(id), siteId: field('site-r'), weekStart: field(weekStart),
      capturedAt: field(week.toISOString()),
      summary: field({
        indexedObservedCount: offset ? 0 : 1,
        notIndexedObservedCount: offset ? 2 : 1,
        inspectedCount: 2, indexableCount: 2,
        observedIndexationRate: offset ? 0 : .5,
        byPageFamily: {}
      })
    }
  });
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  if (path === 'projects/test/databases/(default)/documents/sites' || path === 'projects/test/databases/(default)/documents/seoPlanningDigests') {
    const collection = path.split('/').at(-1)!;
    const all = [...docs.values()].filter(doc => { const prefix = `${root}${collection}/`; return doc.name.startsWith(prefix) && !doc.name.slice(prefix.length).includes('/'); });
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }
  if (path === 'projects/test/databases/(default)/documents:batchGet') {
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body)) as { documents: string[] };
    assert.ok(body.documents.length === 16 || body.documents.length === 1, 'only the selected history or one site bundle is read');
    return Response.json(body.documents.map(name => docs.has(name) ? { found: docs.get(name) } : { missing: name }));
  }
  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { default: app } = await import('../api/remote-sites.js');
  const response = await app.request('/api/remote-sites');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'max-age=120, stale-while-revalidate=60');
  const body = await response.json() as { generatedAt: string; sites: Array<Record<string, unknown>> };
  assert.equal(body.sites.length, 1);
  const site = body.sites[0];
  assert.equal(site.id, 'site-r');
  assert.equal(site.name, 'Site R');
  assert.equal((site.planningDigest as { inventoryCount: number }).inventoryCount, 7);
  assert.equal((site.planningDigest as { selectedCount: number }).selectedCount, 5);
  assert.deepEqual(
    Object.fromEntries(['status', 'indexableCount', 'inspectedCount', 'indexedObservedCount', 'notIndexedObservedCount']
      .map(key => [key, (site.indexation as Record<string, unknown>)[key]])),
    { status: 'ready', indexableCount: 2, inspectedCount: 2, indexedObservedCount: 1, notIndexedObservedCount: 1 }
  );
  assert.equal((body as { indexationUnavailable?: boolean }).indexationUnavailable, false);

  assert.ok(!JSON.stringify(body).includes('test-access-token'), 'no credentials in response');

  const historyResponse = await app.request('/api/remote-sites?__view=indexation&siteId=site-r');
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json() as {
    current: { indexedObservedCount: number; notIndexedObservedCount: number };
    snapshots: Array<{ weekStart: string; summary: { indexedObservedCount: number } }>;
    requestedWeeks: number;
  };
  assert.equal(history.requestedWeeks, 16);
  assert.equal(history.current.indexedObservedCount, 1);
  assert.equal(history.current.notIndexedObservedCount, 1);
  assert.equal(history.snapshots.length, 2);
  assert.ok(history.snapshots[0].weekStart < history.snapshots[1].weekStart);
  assert.deepEqual(history.snapshots.map(item => item.summary.indexedObservedCount), [0, 1]);
  assert.equal((await app.request('/api/remote-sites?__view=indexation&siteId=bad.site')).status, 400);

  // SEO Manager context regression: acquisition choices must not be reduced to edit throughput.
  const { seoAgentContext } = await import('../packages/commands/src/seo-agent-policy.js');
  const manager = seoAgentContext({ role: 'planner' }) as any;
  assert.equal(manager.policyVersion, '1.33.2');
  assert.match(manager.acquisitionReview.requiredDiagnosis, /previous 28d/);
  assert.match(manager.indexation.requiredDecisionCheck, /each site/i);
  assert.match(manager.indexation.credentialBoundary, /GitHub Actions/);
  assert.ok(manager.runContract.start.some((x: string) => x.includes('site_indexation_summary(siteId)')));
  assert.ok(manager.instructions.some((x: string) => x.includes('EVERY site being considered')));
  assert.match(manager.acquisitionReview.publicationOutcomeGate, /production/);
  assert.match(manager.contentQualityAudit.managerAudit, /competitor page bodies/);
  assert.match(manager.contentQualityAudit.triage.join(' '), /lastCrawlTime/);
  assert.match(manager.contentQualityAudit.taskPacket, /seo_task_create/);
  assert.match(manager.contentQualityAudit.persistence, /No per-URL audit DB/);
  assert.match(manager.contentQualityAudit.editorialFeedback, /supported, contradicted or inconclusive/);
  assert.match(manager.contentQualityAudit.editorialFeedback, /optimization_event/);
  assert.ok(manager.instructions.some((x: string) => x.includes('EDITORIAL FEEDBACK:')));
  assert.ok(manager.instructions.some((s: string) => s.includes('CONTENT QUALITY AUDIT TASK')));
  assert.ok(manager.runContract.start.some((s: string) => s.includes('source-backed current-body')));

  assert.match(manager.acquisitionReview.scopeBoundary, /cannot own social/);
  assert.equal(manager.runContract.acquisitionReview.activeObjectiveBoundary.includes('Only GSC Search acquisition'), true);
  const worker = seoAgentContext({ role: 'executor' }) as any;
  assert.equal(worker.acquisitionReview, undefined, 'Worker remains execution-only and does not choose portfolio policy');
  assert.match(worker.contentQualityExecution.gate, /rewrite and recheck/);
  assert.match(worker.contentQualityExecution.decisionTrace, /original reader question/);
  assert.match(worker.contentQualityExecution.decisionTrace, /Worker does not update/);
  assert.ok(worker.instructions.some((s: string) => s.includes('Managers specific user-job')));
  assert.equal(worker.contentQualityAudit, undefined, 'Worker cannot run portfolio audits');

  console.log('remote sites smoke passed: registry, digests, batched current indexation, scheduled snapshots, read-only and no secrets');
} finally {
  globalThis.fetch = originalFetch;
}
