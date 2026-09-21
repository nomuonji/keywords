import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { field } from '../packages/db/src/firestore.js';
import {
  optimizationContext,
  readSiteDigest,
  refreshSiteDigest,
} from '../packages/commands/src/remote-site-operations.js';

// Deterministic Firestore double. Never loads .env or touches production data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
const originalFetch = globalThis.fetch;
let calls = 0;
const decodeField = (value: any): any => value?.stringValue ?? value?.integerValue ?? value?.doubleValue ?? value?.booleanValue ?? null;

docs.set(`${root}sites/site-d`, {
  name: `${root}sites/site-d`,
  fields: {
    id: field('site-d'), localProjectId: field('local-p'), name: field('Site D'), repository: field('nomuonji/site-d'),
    productionUrl: field('https://example.com'), deploymentProvider: field('other'),
    ga4PropertyId: field(null), searchConsoleProperty: field(null),
    status: field('active'), revision: field(1), createdAt: field('2026-09-01T00:00:00.000Z'), updatedAt: field('2026-09-01T00:00:00.000Z'),
  },
  updateTime: 'seed-1',
});

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  calls++;
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const method = String(init?.method ?? 'GET').toUpperCase();

  if (url.endsWith(':commit') && method === 'POST') {
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `revision-${calls}` });
    return Response.json({});
  }
  if (url.endsWith(':runQuery') && method === 'POST') {
    const query = body.structuredQuery;
    const collection = query.from[0].collectionId;
    const filter = query.where.fieldFilter;
    const expected = decodeField(filter.value);
    const rows = [...docs.values()]
      .filter(doc => doc.name.startsWith(`${root}${collection}/`) && decodeField(doc.fields?.[filter.field.fieldPath]) === expected)
      .slice(0, Number(query.limit ?? 500))
      .map(document => ({ document }));
    return Response.json(rows);
  }
  if (method === 'PATCH') {
    docs.set(path, { name: path, fields: body.fields, updateTime: `revision-${calls}` });
    return Response.json(docs.get(path));
  }
  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  // No digest yet: site-level context falls back to the full scan path.
  const fallback = await optimizationContext({ siteId: 'site-d' });
  assert.equal(fallback.servedFrom, 'scan');
  assert.equal(await readSiteDigest('site-d'), null);

  const gsc = { id: 'snap-gsc', siteId: 'site-d', articleId: null, provider: 'gsc', periodStart: '2026-09-01', periodEnd: '2026-09-07', metrics: { clicks: 9 }, queries: [], completeness: 'complete', sourceVersion: 'v1', capturedAt: '2026-09-10T00:00:00.000Z' };
  const digest = await refreshSiteDigest({ site: { id: 'site-d' }, latestSiteGsc: gsc, articleCount: 3, warnings: ['Deferred content/x.mdx: lazy sync test'] });
  assert.equal(digest.siteId, 'site-d');
  assert.equal(digest.articleCount, 3);
  assert.equal(digest.deferredCount, 1);
  assert.deepEqual(digest.latestSiteGsc, gsc);
  assert.deepEqual(digest.activeOptimizations, []);

  const stored = await readSiteDigest('site-d');
  assert.equal(stored?.generatedAt, digest.generatedAt);

  // Digest path: two bounded reads (site + digest) instead of history scans.
  calls = 0;
  const fast = await optimizationContext({ siteId: 'site-d' });
  assert.equal(fast.servedFrom, 'digest');
  assert.equal(fast.changeAllowed, true);
  assert.equal(fast.activeOptimization, null);
  assert.equal((fast as { deferredCount: number }).deferredCount, 1);
  assert.deepEqual((fast.latestMetrics as any).gsc?.id, 'snap-gsc');
  assert.ok(calls <= 3, `digest fast path should stay bounded (used ${calls} calls)`);

  // Article-level context still uses the scan path.
  const articleScoped = await optimizationContext({ siteId: 'site-d', articleId: 'article-missing' }).catch((error: unknown) => error);
  assert.ok(articleScoped instanceof Error, 'unknown article must keep failing closed');

  console.log('site digest smoke passed: digest refresh, bounded fast path with fallback, and closed article scope');
} finally {
  globalThis.fetch = originalFetch;
}
