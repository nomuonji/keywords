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
process.env.KEYWORDS_ALLOW_PRIVATE_FETCH = '1';
process.env.SITES_INDEXATION_DAILY_BUDGET = '2';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let revision = 0;
const inspectedUrls: string[] = [];
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
    inspectedUrls.push(body.inspectionUrl);
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

  if (method === 'POST' && path.endsWith(':runQuery')) {
    const query = body.structuredQuery;
    const collectionPath = path.replace(/:runQuery$/, '') + '/' + query.from[0].collectionId;
    let candidates = listCollection(collectionPath);
    const filter = query.where;
    if (filter?.unaryFilter) {
      assert.equal(filter.unaryFilter.op, 'IS_NULL');
      const key = filter.unaryFilter.field.fieldPath;
      candidates = candidates.filter(doc => !doc.fields[key] || doc.fields[key].nullValue === null);
    } else if (filter?.fieldFilter) {
      const key = filter.fieldFilter.field.fieldPath;
      const max = filter.fieldFilter.value.stringValue;
      candidates = candidates.filter(doc => doc.fields[key]?.stringValue && doc.fields[key].stringValue <= max);
    }
    return Response.json(candidates.slice(0, query.limit).map(document => ({ document })));
  }

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

  const revisionAfterCreate = revision;
  const repeatedInventory = await siteIndexationInventorySave({
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
  assert.equal(repeatedInventory.updated, 0);
  assert.equal(repeatedInventory.unchanged, 2);
  assert.equal(revision, revisionAfterCreate, 'unchanged daily inventory reconciliation must not write Firestore documents');

  // Identity stays one URL record, while actual Inspection target keeps the
  // sitemap slash. A target change must invalidate the previous observation.
  const changedTarget = await siteIndexationInventorySave({
    siteId: 'site-i', records: [{ url: 'https://shikaku.antonbase.com/licenses/a', pageFamily: 'qualification', indexable: true }]
  });
  assert.equal(changedTarget.created, 0);
  assert.equal(changedTarget.updated, 1);
  const repairedTarget = await siteIndexationInventorySave({
    siteId: 'site-i', records: [{ url: 'https://shikaku.antonbase.com/licenses/a/', pageFamily: 'qualification', indexable: true }]
  });
  assert.equal(repairedTarget.created, 0);
  assert.equal(repairedTarget.updated, 1);

  const listedBefore = await siteIndexationList({ siteId: 'site-i', limit: 100 });
  assert.equal(listedBefore.items.length, 2);
  assert.ok(listedBefore.items.every(item => item.nextInspectionAt));
  assert.ok(listedBefore.items.every(item => item.inspectionUrl.endsWith('/')));
  assert.ok(listedBefore.items.some(item => item.url.endsWith('/licenses/a')), 'identity URL omits trailing slash');

  // Credential-less ChatGPT/MCP calls must not consume the shared property quota.
  const authKeys = [
    'GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN',
    'GOOGLE_OAUTH_ACCESS_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN',
    'GOOGLE_OAUTH_REFRESH_TOKEN'
  ] as const;
  const savedAuth = authKeys.map(key => process.env[key]);
  try {
    for (const key of authKeys) delete process.env[key];
    await assert.rejects(
      siteIndexationInspect({ siteId: 'site-i', urls: ['https://shikaku.antonbase.com/licenses/a/'] }),
      /credentials are not configured; URL Inspection quota was not reserved/
    );
    assert.equal(listCollection('indexationQuotaDays').length, 0,
      'missing OAuth must fail before writing the shared quota ledger');
    assert.equal(inspectedUrls.length, 0, 'no Google URL Inspection call should run without credentials');
  } finally {
    authKeys.forEach((key, i) => {
      if (savedAuth[i] === undefined) delete process.env[key];
      else process.env[key] = savedAuth[i];
    });
  }

  const first = await siteIndexationInspect({
    siteId: 'site-i',
    urls: ['https://shikaku.antonbase.com/licenses/a/']
  });
  assert.equal(first.inspected, 1);
  assert.equal(first.failed, 0);
  assert.equal(first.results[0].observedIndexState, 'indexed');
  assert.equal(first.results[0].inspectionUrl, 'https://shikaku.antonbase.com/licenses/a/');
  assert.deepEqual(inspectedUrls, ['https://shikaku.antonbase.com/licenses/a/'],
    'URL Inspection MUST receive exact sitemap/canonical path, not slashless identity');
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

  const removed = await siteIndexationInventorySave({
    siteId: 'site-i',
    records: [{ url: 'https://shikaku.antonbase.com/licenses/b/', pageFamily: 'qualification', indexable: false, inventoryState: 'removed' }]
  });
  assert.equal(removed.updated, 1);
  const afterRemoval = await siteIndexationList({ siteId: 'site-i', limit: 100 });
  const removedRow = afterRemoval.items.find(item => item.url.includes('/licenses/b'));
  assert.equal(removedRow?.nextInspectionAt, null);

  const restored = await siteIndexationInventorySave({
    siteId: 'site-i',
    records: [{ url: 'https://shikaku.antonbase.com/licenses/b/', pageFamily: 'qualification', indexable: true, inventoryState: 'current' }]
  });
  assert.equal(restored.updated, 1);
  const afterRestore = await siteIndexationList({ siteId: 'site-i', limit: 100 });
  const restoredRow = afterRestore.items.find(item => item.url.includes('/licenses/b'));
  assert.ok(restoredRow?.nextInspectionAt, 'reactivated URLs must return to the due queue');

  // An inventory with a legacy +48h hold must not stay idle while property
  // quota is available. A truly fresh published page still gets a 6h buffer.
  const sourceSite = docs.get(`${root}sites/site-i`);
  docs.set(`${root}sites/site-j`, {
    ...sourceSite, name: `${root}sites/site-j`,
    fields: { ...sourceSite.fields,
      id: field('site-j'),
      productionUrl: field('https://new.antonbase.com/'),
      searchConsoleProperty: field('sc-domain:new.antonbase.com')
    }
  });
  const freshAt = new Date().toISOString();
  await siteIndexationInventorySave({
    siteId: 'site-j', records: [
      { url: 'https://new.antonbase.com/old/', pageFamily: 'guide', indexable: true,
        lastPublishedAt: '2026-09-01T00:00:00.000Z' },
      { url: 'https://new.antonbase.com/fresh/', pageFamily: 'guide', indexable: true,
        lastPublishedAt: freshAt }
    ]
  });
  const newRows = (await siteIndexationList({ siteId: 'site-j' })).items;
  const oldRow = newRows.find(row => row.inspectionUrl.endsWith('/old/'))!;
  const freshRow = newRows.find(row => row.inspectionUrl.endsWith('/fresh/'))!;
  assert.ok(Date.parse(oldRow.nextInspectionAt!) <= Date.now(),
    'old pages must be inspectable on the next quota-available sweep');
  assert.ok(Date.parse(freshRow.nextInspectionAt!) > Date.now(),
    'truly new pages get a short crawl grace period');
  const legacy = docs.get(`${root}sites/site-j/indexationUrls/${oldRow.id}`);
  legacy.fields.nextInspectionAt = field('2026-12-31T00:00:00.000Z');
  const ordinary = await siteIndexationInspect({ siteId: 'site-j', limit: 2 });
  assert.equal(ordinary.inspected, 0, 'legacy hold produces no normal due URLs');
  const accelerated = await siteIndexationInspect({ siteId: 'site-j', limit: 2, accelerateUninspected: true });
  assert.equal(accelerated.inspected, 1, 'spare property quota should cover old held URL');
  assert.equal(accelerated.results[0].inspectionUrl, 'https://new.antonbase.com/old/');
  assert.equal(accelerated.quota.used, 1);
  assert.ok(!inspectedUrls.includes('https://new.antonbase.com/fresh/'),
    'fresh pages must not consume quota during initial crawl buffer');
  assert.equal((await siteIndexationInspect({ siteId: 'site-j', limit: 2, accelerateUninspected: true })).inspected, 0,
    'already inspected and fresh pages are not repeatedly polled');
  const finalRows = (await siteIndexationList({ siteId: 'site-j' })).items;
  assert.equal(finalRows.filter(row => row.lastInspectedAt).length, 1);
  assert.equal(finalRows.filter(row => !row.lastInspectedAt).length, 1);
  assert.equal((await siteIndexationSummary({ siteId: 'site-j' })).inspectedCount, 1);

  console.log('site indexation smoke passed: initial coverage priority, legacy backlog, 6h fresh grace, idempotent inventory, quota, and snapshot');
} finally {
  globalThis.fetch = originalFetch;
}
