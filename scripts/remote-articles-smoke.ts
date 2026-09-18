import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
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
docs.set(`${root}articles/article-r`, {
  name: `${root}articles/article-r`,
  fields: {
    id: field('article-r'), siteId: field('site-r'), localPageId: field('page-r'), canonicalUrl: field('https://example.com/r'),
    repo: field('nomuonji/site-r'), repoPath: field('content/r.mdx'), slug: field('r'), title: field('R'),
    status: field('published'), revision: field(1), updatedAt: field('2026-09-02T00:00:00.000Z'),
  },
  updateTime: 'seed-2',
});

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.endsWith(':runQuery')) {
    const query = body.structuredQuery;
    const collection = query.from[0].collectionId;
    const filter = query.where.fieldFilter;
    const expected = (filter.value as any)?.stringValue ?? null;
    const rows = [...docs.values()]
      .filter(doc => doc.name.startsWith(`${root}${collection}/`) && (doc.fields?.[filter.field.fieldPath] as any)?.stringValue === expected)
      .slice(0, Number(query.limit ?? 500))
      .map(document => ({ document }));
    return Response.json(rows);
  }
  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { default: app } = await import('../api/remote-articles.ts');
  assert.equal((await app.request('/api/remote-articles')).status, 400);
  const response = await app.request('/api/remote-articles?siteId=site-r&limit=50');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { siteId: string; items: Array<Record<string, unknown>> };
  assert.equal(body.siteId, 'site-r');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].canonicalUrl, 'https://example.com/r');
  assert.ok(!JSON.stringify(body).includes('test-access-token'), 'no credentials in response');
  console.log('remote articles smoke passed: bounded per-site registry list, read-only, no secrets');
} finally {
  globalThis.fetch = originalFetch;
}
