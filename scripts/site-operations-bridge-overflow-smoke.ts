import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync } from 'node:fs';

const dbPath = `/tmp/keywords-sites-overflow-${process.pid}.sqlite`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { rmSync(path, { force: true }); } catch {}
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_ANALYTICS_FILE = `/tmp/keywords-sites-overflow-missing-${process.pid}.json`;
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
const originalFetch = globalThis.fetch;

const decodeField = (input: any): any => {
  if (!input || typeof input !== 'object') return null;
  if ('stringValue' in input) return input.stringValue;
  if ('integerValue' in input) return Number(input.integerValue);
  if ('doubleValue' in input) return input.doubleValue;
  if ('booleanValue' in input) return input.booleanValue;
  if ('nullValue' in input) return null;
  if ('arrayValue' in input) return (input.arrayValue.values ?? []).map(decodeField);
  if ('mapValue' in input) return Object.fromEntries(Object.entries(input.mapValue.fields ?? {}).map(([key, value]) => [key, decodeField(value)]));
  return null;
};

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  }
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network request: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.endsWith(':commit')) {
    for (const write of body.writes) {
      const previous = docs.get(write.update.name);
      if (write.currentDocument?.exists === false && previous) return Response.json({}, { status: 409 });
      if (write.currentDocument?.updateTime && previous?.updateTime !== write.currentDocument.updateTime) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) {
      docs.set(write.update.name, { ...write.update, updateTime: `revision-${++sequence}` });
    }
    return Response.json({});
  }

  if (url.endsWith(':runQuery')) {
    const query = body.structuredQuery;
    const collection = query.from[0].collectionId;
    const filter = query.where.fieldFilter;
    const expected = decodeField(filter.value);
    const result = [...docs.values()]
      .filter(doc => doc.name.startsWith(`${root}${collection}/`) && decodeField(doc.fields?.[filter.field.fieldPath]) === expected)
      .slice(0, Number(query.limit ?? 500))
      .map(document => ({ document }));
    return Response.json(result);
  }

  if (/\/sites$/.test(path)) {
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}sites/`));
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { siteRegistrySave } = await import('../packages/commands/src/remote-site-operations.js');
  const { projectSiteOperationsMetrics } = await import('../packages/commands/src/site-operations-bridge.js');
  const { sqlite } = getDatabase();
  const t = '2026-09-17T00:00:00.000Z';

  sqlite.prepare(`INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run('project-overflow', 'Overflow Project', 'example.com', 'existing_site', 'production', t, t);

  const pageInsert = sqlite.prepare(`INSERT INTO pages(id,project_id,title,slug,kind,status,plan_mode,url,source,last_seen_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const pageMetricInsert = sqlite.prepare(`INSERT INTO page_metric_snapshots(id,project_id,page_id,url,site_url,start_date,end_date,search_type,clicks,impressions,ctr,position,observed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const sources = [];
  for (let index = 1; index <= 101; index++) {
    const suffix = String(index).padStart(3, '0');
    const pageId = `page-${suffix}`;
    const url = `https://example.com/article-${suffix}`;
    const sourceRef = `content/posts/article-${suffix}.mdx`;
    pageInsert.run(pageId, 'project-overflow', `Article ${suffix}`, `article-${suffix}`, 'article', 'published', 'existing_page_improvement', url, 'blog_local', t, t, t);
    pageMetricInsert.run(`metric-${suffix}`, 'project-overflow', pageId, url, 'sc-domain:example.com', '2026-09-08', '2026-09-14', 'web', 1, 10, 0.1, 8 + index / 1000, t);
    sources.push({
      source_ref: sourceRef,
      source_sha256: String(index).padStart(64, '0').slice(-64),
      title: `Article ${suffix}`,
      expected_url: url,
      draft: false,
      declared_date: null,
      headings: [`Article ${suffix}`],
      local_build_present: true
    });
  }

  const snapshot = {
    schema_version: 1,
    kind: 'blog_site_context',
    observed_at: t,
    blog_site_id: 'blog-overflow',
    canonical_origin: 'https://example.com',
    language: 'ja',
    country: 'jp',
    mapping_sha256: 'a'.repeat(64),
    route_evidence: [],
    eligibility: {
      remediation_status: 'clear',
      clearance_gate: 'listed_for_scoped_clearance',
      new_content_allowed: true,
      reason: 'fixture',
      quality_status: 'verified',
      index_health: 'healthy'
    },
    sources,
    pages: [],
    coverage: {
      source_count: sources.length,
      local_build_page_count: sources.length,
      unmapped_build_pages: 0,
      sources_absent_from_build: 0,
      duplicate_expected_urls: [],
      complete_site_coverage: true
    },
    warnings: []
  };
  sqlite.prepare(`INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at)
    VALUES(?,?,?,?,?,?,?,?)`)
    .run('project-overflow', 'blog-overflow', 'https://example.com', 'ja', 'jp', JSON.stringify(snapshot), 'fixture-hash', t);

  sqlite.prepare(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('gsc-overflow', 'project-overflow', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-08', '2026-09-14', 'America/Los_Angeles', 'web', '["query","page"]', 'succeeded', 'complete', 'GSC overflow fixture', 'overflow-source-v1', t, '{}', t);
  sqlite.prepare(`INSERT INTO keyword_metric_snapshots(id,project_id,keyword_id,query,site_url,start_date,end_date,search_type,clicks,impressions,ctr,position,observed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('query-overflow', 'project-overflow', null, 'overflow query', 'sc-domain:example.com', '2026-09-08', '2026-09-14', 'web', 10, 1000, 0.01, 8.1, t);

  await siteRegistrySave({
    id: 'site-overflow',
    expectedRevision: 0,
    localProjectId: 'project-overflow',
    name: 'Overflow Site',
    repository: 'nomuonji/overflow-site',
    productionUrl: 'https://example.com',
    deploymentProvider: 'vercel',
    searchConsoleProperty: 'sc-domain:example.com',
    status: 'active'
  });

  const first: any = await projectSiteOperationsMetrics('project-overflow');
  assert.equal(first.status, 'projected');
  assert.equal(first.articleMappings.registered, 101);
  assert.equal(first.articleRegistrySync.considered, 101);
  assert.equal(first.articleRegistrySync.created, 101);
  assert.equal(first.gsc.articles.saved, 101);
  assert.ok(!first.warnings.some((message: string) => /bounded to 100|deferred|sync failed/i.test(message)));

  const articleDocs = [...docs.values()].filter(doc => doc.name.startsWith(`${root}articles/`));
  const articleMetricDocs = [...docs.values()].filter(doc =>
    doc.name.startsWith(`${root}metricSnapshots/`)
    && decodeField(doc.fields?.provider) === 'gsc'
    && typeof decodeField(doc.fields?.articleId) === 'string');
  assert.equal(articleDocs.length, 101);
  assert.equal(articleMetricDocs.length, 101);

  const second: any = await projectSiteOperationsMetrics('project-overflow');
  assert.equal(second.articleMappings.registered, 101);
  assert.equal(second.articleRegistrySync.reused, 101);
  assert.deepEqual(second.gsc.articles, { saved: 0, reused: 101 });
  assert.ok(!second.warnings.some((message: string) => /bounded to 100|deferred|sync failed/i.test(message)));

  console.log('site operations overflow smoke: ok');
} finally {
  globalThis.fetch = originalFetch;
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
