import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'keywords-sites-bootstrap-'));
const siteRoot = join(workspace, 'site');
const dbPath = join(workspace, 'keywords.sqlite');
mkdirSync(join(siteRoot, 'content'), { recursive: true });
writeFileSync(join(siteRoot, 'content', 'draft.md'), '# Draft\n', 'utf8');
writeFileSync(join(siteRoot, 'content', 'live.md'), '# Live\n', 'utf8');
execFileSync('git', ['init'], { cwd: siteRoot, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: siteRoot });
execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: siteRoot });
execFileSync('git', ['add', '.'], { cwd: siteRoot });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: siteRoot, stdio: 'ignore' });
execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/nomuonji/site-fixture.git'], { cwd: siteRoot });

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_BLOG_ROOT = siteRoot;
process.env.KEYWORDS_BLOG_SITE_ID = 'site-fixture';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';

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
  if ('arrayValue' in input) return (input.arrayValue?.values ?? []).map(decodeField);
  if ('mapValue' in input) return Object.fromEntries(Object.entries(input.mapValue?.fields ?? {}).map(([key, value]) => [key, decodeField(value)]));
  return null;
};
const decoded = (doc: any) => ({ id: String(doc.name).split('/').pop(), ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, decodeField(item)])) });

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

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { repositoryFromGitRemote, bootstrapSiteOperationsRegistry } = await import('../packages/commands/src/site-operations-bootstrap.js');
  const { sqlite } = getDatabase();
  const t = '2026-09-16T00:00:00.000Z';

  assert.equal(repositoryFromGitRemote('git@github.com:nomuonji/site-fixture.git'), 'nomuonji/site-fixture');
  assert.equal(repositoryFromGitRemote('https://github.com/nomuonji/site-fixture.git'), 'nomuonji/site-fixture');
  assert.equal(repositoryFromGitRemote('https://gitlab.com/nomuonji/site-fixture.git'), null);

  sqlite.prepare(`INSERT INTO projects(id,name,domain,mode,environment,language,country,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('project-bootstrap', 'Bootstrap Project', 'example.com', 'existing_site', 'production', 'ja', 'jp', t, t);
  sqlite.prepare(`INSERT INTO pages(id,project_id,title,slug,kind,status,plan_mode,url,source,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-draft', 'project-bootstrap', 'Draft Article', 'draft', 'existing', 'local', 'new_page', 'https://example.com/draft/', 'blog_local', t, t, t);
  sqlite.prepare(`INSERT INTO pages(id,project_id,title,slug,kind,status,plan_mode,url,source,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-live', 'project-bootstrap', 'Live Article', 'live', 'existing', 'published', 'new_page', 'https://example.com/live/', 'sitemap', t, t, t);

  const h = 'a'.repeat(64);
  const snapshot = {
    schema_version: 1,
    kind: 'blog_site_context',
    observed_at: t,
    blog_site_id: 'site-fixture',
    canonical_origin: 'https://example.com',
    language: 'ja',
    country: 'jp',
    mapping_sha256: h,
    route_evidence: [],
    eligibility: { remediation_status: 'clear', clearance_gate: 'listed_for_scoped_clearance', new_content_allowed: true, reason: 'fixture', quality_status: 'ok', index_health: 'ok' },
    sources: [
      { source_ref: 'content/draft.md', source_sha256: h, title: 'Draft Article', expected_url: 'https://example.com/draft/', draft: null, declared_date: null, headings: ['Draft'], local_build_present: true },
      { source_ref: 'content/live.md', source_sha256: h, title: 'Live Article', expected_url: 'https://example.com/live/', draft: null, declared_date: null, headings: ['Live'], local_build_present: true }
    ],
    pages: [],
    coverage: { source_count: 2, local_build_page_count: 2, unmapped_build_pages: 0, sources_absent_from_build: 0, duplicate_expected_urls: [], complete_site_coverage: true },
    warnings: []
  };
  sqlite.prepare(`INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('project-bootstrap', 'site-fixture', 'https://example.com', 'ja', 'jp', JSON.stringify(snapshot), h, t);
  sqlite.prepare(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('import-bootstrap', 'project-bootstrap', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-08', '2026-09-14', 'UTC', 'web', '["query","page"]', 'succeeded', 'complete', 'fixture', 'fixture-v1', t, '{}', t);

  const first = await bootstrapSiteOperationsRegistry('project-bootstrap');
  assert.equal(first.status, 'bootstrapped');
  assert.equal(first.siteWrite, true);
  assert.equal(first.site.repository, 'nomuonji/site-fixture');
  assert.equal(first.site.productionUrl, 'https://example.com');
  assert.equal(first.site.searchConsoleProperty, 'sc-domain:example.com');
  assert.equal(first.site.status, 'active');
  assert.deepEqual(first.articles, { created: 2, updated: 0, unchanged: 0, skipped: 0 });

  const siteDoc = [...docs.values()].find(doc => doc.name.startsWith(`${root}sites/`));
  const articles = [...docs.values()].filter(doc => doc.name.startsWith(`${root}articles/`)).map(decoded);
  assert.ok(siteDoc);
  assert.equal(articles.length, 2);
  assert.equal(articles.find((item: any) => item.localPageId === 'page-draft')?.status, 'draft');
  assert.equal(articles.find((item: any) => item.localPageId === 'page-live')?.status, 'published');
  assert.equal(articles.find((item: any) => item.localPageId === 'page-draft')?.repoPath, 'content/draft.md');
  const siteRevision = (decoded(siteDoc) as any).revision;

  const second = await bootstrapSiteOperationsRegistry('project-bootstrap');
  assert.equal(second.siteWrite, false);
  assert.deepEqual(second.articles, { created: 0, updated: 0, unchanged: 2, skipped: 0 });
  const siteAgain = decoded([...docs.values()].find(doc => doc.name.startsWith(`${root}sites/`))!);
  assert.equal((siteAgain as any).revision, siteRevision, 'idempotent bootstrap must not increment site revision');

  sqlite.prepare("UPDATE pages SET source='sitemap',status='published' WHERE id='page-draft'").run();
  const third = await bootstrapSiteOperationsRegistry('project-bootstrap');
  assert.equal(third.articles.updated, 1);
  const finalArticles = [...docs.values()].filter(doc => doc.name.startsWith(`${root}articles/`)).map(decoded);
  assert.equal(finalArticles.find((item: any) => item.localPageId === 'page-draft')?.status, 'published');

  console.log('site operations bootstrap smoke passed: confirmed binding -> Git identity -> idempotent site/article registry; local build stays draft until live evidence');
  sqlite.close();
} finally {
  globalThis.fetch = originalFetch;
  rmSync(workspace, { recursive: true, force: true });
}
