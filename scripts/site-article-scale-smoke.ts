import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync } from 'node:fs';

const dbPath = `/tmp/keywords-site-article-scale-${process.pid}.sqlite`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { rmSync(path, { force: true }); } catch {}
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_ANALYTICS_FILE = `/tmp/keywords-site-article-scale-${process.pid}-missing.json`;
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT = '500';

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

const stringField = (value: string) => ({ stringValue: value });
const integerField = (value: number) => ({ integerValue: String(value) });
const nullField = () => ({ nullValue: null });

function seedArticle(index: number) {
  const id = `seed-${index}`;
  docs.set(`${root}articles/${id}`, {
    name: `${root}articles/${id}`,
    fields: {
      siteId: stringField('site-scale'),
      localPageId: nullField(),
      canonicalUrl: stringField(`https://example.com/seed-${index}`),
      repo: stringField('nomuonji/site-scale'),
      repoPath: stringField(`content/seed-${index}.mdx`),
      currentCommitSha: nullField(),
      slug: stringField(`seed-${index}`),
      title: stringField(`Seed ${index}`),
      primaryKeywordId: nullField(),
      secondaryKeywordIds: { arrayValue: { values: [] } },
      status: stringField('draft'),
      publishedAt: nullField(),
      lastUpdatedAt: nullField(),
      revision: integerField(1),
      createdAt: stringField('2026-09-17T00:00:00.000Z'),
      updatedAt: stringField('2026-09-17T00:00:00.000Z')
    },
    updateTime: `seed-${index}`
  });
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
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
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `revision-${++sequence}` });
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

  if (/\/(sites|articles|metricSnapshots|optimizationEvents)$/.test(path)) {
    const collection = path.split('/').at(-1)!;
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}${collection}/`));
    const limit = Number(parsed.searchParams.get('pageSize') ?? 50);
    return Response.json({ documents: all.slice(0, limit), ...(all.length > limit ? { nextPageToken: 'more' } : {}) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { projectSiteOperationsMetrics } = await import('../packages/commands/src/site-operations-bridge.js');
  const { siteArticleList, siteArticleSave, siteRegistrySave } = await import('../packages/commands/src/remote-site-operations.js');
  const { sqlite } = getDatabase();
  const t = '2026-09-17T00:00:00.000Z';

  sqlite.prepare(`INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run('project-scale', 'Project Scale', 'example.com', 'existing_site', 'production', t, t);

  const sources = [];
  const pages = [];
  for (let index = 1; index <= 101; index++) {
    const url = `https://example.com/article-${index}`;
    const sourceRef = `content/posts/article-${index}.mdx`;
    sqlite.prepare(`INSERT INTO pages(id,project_id,title,slug,kind,status,plan_mode,url,source,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`page-${index}`, 'project-scale', `Article ${index}`, `article-${index}`, 'article', 'published', 'existing_page_improvement', url, 'blog_local', t, t, t);
    sources.push({
      source_ref: sourceRef,
      source_sha256: String(index).padStart(64, '0').slice(-64),
      title: `Article ${index}`,
      expected_url: url,
      draft: false,
      declared_date: null,
      headings: [`Article ${index}`],
      local_build_present: true
    });
    pages.push({
      local_build_url: url,
      canonical_url: null,
      canonical_status: 'unverified',
      title: `Article ${index}`,
      source_refs: [sourceRef],
      source_mapping_status: 'mapped',
      build_ref: `dist/article-${index}/index.html`,
      build_sha256: String(index + 1000).padStart(64, '0').slice(-64),
      build_file_modified_at: t,
      robots: [],
      internal_links: [],
      publication_status: 'unverified',
      index_status: 'unverified'
    });
  }

  const snapshot = {
    schema_version: 1,
    kind: 'blog_site_context',
    observed_at: t,
    blog_site_id: 'blog-site-scale',
    canonical_origin: 'https://example.com',
    language: 'ja',
    country: 'jp',
    mapping_sha256: '0'.repeat(64),
    route_evidence: [],
    eligibility: {
      remediation_status: 'clear', clearance_gate: 'listed_for_scoped_clearance', new_content_allowed: true,
      reason: 'fixture', quality_status: 'verified', index_health: 'healthy'
    },
    sources,
    pages,
    coverage: {
      source_count: sources.length,
      local_build_page_count: pages.length,
      unmapped_build_pages: 0,
      sources_absent_from_build: 0,
      duplicate_expected_urls: [],
      complete_site_coverage: true
    },
    warnings: []
  };

  sqlite.prepare(`INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('project-scale', 'blog-site-scale', 'https://example.com', 'ja', 'jp', JSON.stringify(snapshot), 'fixture-hash', t);

  await siteRegistrySave({
    id: 'site-scale', expectedRevision: 0, localProjectId: 'project-scale', name: 'Site Scale', repository: 'nomuonji/site-scale',
    productionUrl: 'https://example.com', deploymentProvider: 'vercel', status: 'active'
  });

  const projected = await projectSiteOperationsMetrics('project-scale');
  assert.equal(projected.status, 'projected');
  if (projected.status !== 'projected') throw new Error(`Expected projected result, got ${projected.status}`);
  assert.equal(projected.articleRegistrySync.status, 'synced');
  assert.equal(projected.articleRegistrySync.created, 101);
  assert.equal(projected.articleRegistrySync.considered, 101);
  assert.equal(projected.articleMappings.registered, 101);
  assert.equal(projected.articleMappings.byLocalPageId, 101);
  assert.equal(projected.articleMappings.byCanonicalUrl, 101);

  const listed = await siteArticleList({ siteId: 'site-scale', limit: 500 });
  assert.equal(listed.items.length, 101);
  assert.equal(listed.truncated, false);

  for (let index = 102; index <= 501; index++) seedArticle(index);
  const bounded = await siteArticleList({ siteId: 'site-scale', limit: 500 });
  assert.equal(bounded.items.length, 500);
  assert.equal(bounded.truncated, true);
  await assert.rejects(
    () => siteArticleSave({
      id: 'blocked-scale-write', expectedRevision: 0, siteId: 'site-scale', localPageId: 'blocked-page',
      canonicalUrl: 'https://example.com/blocked-scale-write', repo: 'nomuonji/site-scale', repoPath: 'content/blocked.mdx', slug: 'blocked-scale-write', title: 'Blocked scale write'
    }),
    /too large for a complete identity check/
  );

  console.log('site article scale smoke passed');
} finally {
  globalThis.fetch = originalFetch;
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
