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
docs.set(`${root}siteDigests/site-r`, {
  name: `${root}siteDigests/site-r`,
  fields: {
    siteId: field('site-r'), generatedAt: field('2026-09-18T00:00:00.000Z'), articleCount: field(7),
    latestSiteGsc: field(null), latestSiteGa4: field(null), activeOptimizations: field([]), warnings: field([]),
  },
  updateTime: 'seed-2',
});

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  if (path === 'projects/test/databases/(default)/documents/sites') {
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}sites/`));
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }
  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { default: app } = await import('../api/remote-sites.js');
  const response = await app.request('/api/remote-sites');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { generatedAt: string; sites: Array<Record<string, unknown>> };
  assert.equal(body.sites.length, 1);
  const site = body.sites[0];
  assert.equal(site.id, 'site-r');
  assert.equal(site.name, 'Site R');
  assert.equal((site.digest as { articleCount: number }).articleCount, 7);
  assert.ok(!JSON.stringify(body).includes('test-access-token'), 'no credentials in response');
  console.log('remote sites smoke passed: registry plus digest in bounded reads, read-only, no secrets');
} finally {
  globalThis.fetch = originalFetch;
}
