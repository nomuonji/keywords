import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { field } from '../packages/db/src/firestore.js';
import {
  siteIndexationInspect,
  siteIndexationInventorySave,
  siteIndexationList,
  siteIndexationSnapshotSave,
  siteIndexationSummary
} from '../packages/commands/src/site-indexation.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN = 'test-gsc-token';
process.env.SITES_INDEXATION_DAILY_BUDGET = '2';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let revision = 0;
const originalFetch = globalThis.fetch;

docs.set(`${root}sites/site-i`, {
  name: `${root}sites/site-i`,
  fields: {
    id: field('site-i'),
    localProjectId: field(null),
    siteShape: field('database'),
    name: field('Indexation Test'),
    repository: field('nomuonji/site-i'),
    productionUrl: field('https://shikaku.antonbase.com/'),
    deploymentProvider: field('other'),
    ga4PropertyId: field(null),
    searchConsoleProperty: field('sc-domain:antonbase.com'),
    status: field('active'),
    revision: field(1),
    createdAt: field('2026-10-01T00:00:00.000Z'),
    updatedAt: field('2026-10-01T00:00:00.000Z')
  },
  updateTime: 'seed-site'
});

function relativePath(url: string) {
  const parsed = new URL(url);
  const marker = '/documents/';
  const index = parsed.pathname.indexOf(marker);
  if (index < 0) return '';
  return decodeURIComponent(parsed.pathname.slice(index + marker.length));
}

function listCollection(path: string) {
  const prefix = `${root}${path}/`;
  return [...docs.values()].filter(doc => {
    if (!String(doc.name).startsWith(prefix)) return false;
    return String(doc.name).slice(prefix.length).split('/').length === 1;
  });
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = String(init?.method ?? 'GET').toUpperCase();

  if (url === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'firestore-test-token', expires_in: 3600 });
  }

  if (url === 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return Response.json({
      inspectionResult: {
        indexStatusResult: {
          verdict: 'PASS',
          coverageState: 'Submitted and indexed',
          robotsTxtState: 'ALLOWED',
          indexingState: 'INDEXING_ALLOWED',
          pageFetchState: 'SUCCESSFUL',
          lastCrawlTime: '2026-10-06T00:00:00Z',
          googleCanonical: body.inspectionUrl,
          userCanonical: body.inspectionUrl
        }
      }
    });
  }

  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network request: ${url}`);
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.endsWith(':commit') && method === 'POST') {
    for (const write of body.writes ?? []) {
      revision++;
      docs.set(write.update.name, { ...write.update, updateTime: `revision-${revision}` });
    }
    return Response.json({});
  }

  const path = relativePath(url);

  if (method === 'PATCH') {
    revision++;
    const name = `${root}${path}`;
    docs.set(name, { name, fields: body.fields, updateTime: `revision-${revision}` });
    return Response.json(docs.get(name));
  }

  if (method === 'GET') {
    const segments = path.split('/').filter(Boolean);
    if (segments.length % 2 === 1) {
      return Response.json({ documents: listCollection(path) });
    }
    const doc = docs.get(`${root}${path}`);
    return doc ? Response.json(doc) : Response.json({}, { status: 404 });
  }

  throw new Error(`Unhandled Firestore request: ${method} ${url}`);
};

try {
  const inventory = await siteIndexationInventorySave({
    siteId: 'site-i',
    records: [
      {
        url: 'https://shikaku.antonbase.com/licenses/a/',
        pageFamily: 'qualification',
        indexable: true,
        sourceFingerprint: 'sha-a',
        lastPublishedAt: '2026-10-01T00:00:00.000Z',
        lastChangedAt: '2026-10-01T00:00:00.000Z'
      },
      {
        url: 'https://shikaku.antonbase.com/licenses/b/',
        pageFamily: 'qualification',
        indexable: true,
        sourceFingerprint: 'sha-b',
        lastPublishedAt: '2026-10-01T00:00:00.000Z',
        lastChangedAt: '2026-10-01T00:00:00.000Z'
      }
    ]
  });
  assert.equal(inventory.received, 2);
  assert.equal(inventory.created, 2);
  assert.equal(inventory.failed, 0);

  const listedBefore = await siteIndexationList({ siteId: 'site-i', limit: 100 });
  assert.equal(listedBefore.items.length, 2);
  assert.ok(listedBefore.items.every(item => item.nextInspectionAt));

  const first = await siteIndexationInspect({
    siteId: 'site-i',
    urls: ['https://shikaku.antonbase.com/licenses/a/']
  });
  assert.equal(first.inspected, 1);
  assert.equal(first.failed, 0);
  assert.equal(first.results[0].observedIndexState, 'indexed');
  assert.equal(first.quota.used, 1);
  assert.equal(first.quota.remaining, 1);

  const summary = await siteIndexationSummary({ siteId: 'site-i' });
  assert.equal(summary.indexableCount, 2);
  assert.equal(summary.inspectedCount, 1);
  assert.equal(summary.indexedObservedCount, 1);
  assert.equal(summary.inspectionCoverage, 0.5);
  assert.equal(summary.observedIndexationRate, 1);
  assert.equal(summary.byPageFamily.qualification.indexableCount, 2);
  assert.equal(summary.quota?.used, 1);

  const second = await siteIndexationInspect({
    siteId: 'site-i',
    urls: ['https://shikaku.antonbase.com/licenses/b/']
  });
  assert.equal(second.inspected, 1);
  assert.equal(second.quota.used, 2);
  assert.equal(second.quota.remaining, 0);

  const blocked = await siteIndexationInspect({
    siteId: 'site-i',
    urls: ['https://shikaku.antonbase.com/licenses/a/']
  });
  assert.equal(blocked.inspected, 0);
  assert.equal(blocked.skipped, 1);
  assert.equal(blocked.quota.reserved, 0);

  const listedAfter = await siteIndexationList({ siteId: 'site-i', limit: 100 });
  assert.equal(listedAfter.items.length, 2, 're-inspection must overwrite the URL cache rather than append URL-level history');

  const snapshot = await siteIndexationSnapshotSave({ siteId: 'site-i' });
  assert.equal(snapshot.siteId, 'site-i');
  assert.equal(snapshot.summary.indexedObservedCount, 2);
  assert.equal(listCollection('indexationSnapshots').length, 1);

  console.log('site indexation smoke passed: mutable URL cache, shared quota, page-family summary and weekly snapshot');
} finally {
  globalThis.fetch = originalFetch;
}
