import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';

const dbPath = `/tmp/keywords-sites-bridge-${process.pid}.sqlite`;
const analyticsPath = `/tmp/keywords-sites-bridge-${process.pid}.json`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, analyticsPath]) {
  try { rmSync(path, { force: true }); } catch {}
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_ANALYTICS_FILE = analyticsPath;
process.env.GOOGLE_ANALYTICS_ACCESS_TOKEN = 'ga4-secret-fixture-token';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';

// Compatibility fixture: direct GA4 imports below must take precedence over it.
writeFileSync(analyticsPath, JSON.stringify({
  generatedAt: '2026-09-16T00:00:00.000Z',
  period: { start: '2026-09-08', end: '2026-09-14', previousStart: '2026-09-01', previousEnd: '2026-09-07' },
  sites: [{
    name: 'Example', host: 'example.com', error: false,
    gsc: { current: { total: { clicks: 12, impressions: 400, ctr: 0.03, position: 8.4 } }, previous: { total: { clicks: 10, impressions: 380, ctr: 0.026, position: 9.1 } } },
    ga4: { current: { total: { sessions: 999, activeUsers: 999, engagement: 0.99, views: 999 } }, previous: { total: { sessions: 998, activeUsers: 998, engagement: 0.98, views: 998 } } }
  }]
}), 'utf8');

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
const ga4RequestBodies: any[] = [];
const bearerErrorFixture = 'fixture-bearer-secret-value';
const originalFetch = globalThis.fetch;
const decodeField = (input: any): any => {
  if (!input || typeof input !== 'object') return null;
  if ('stringValue' in input) return input.stringValue;
  if ('integerValue' in input) return Number(input.integerValue);
  if ('doubleValue' in input) return input.doubleValue;
  if ('booleanValue' in input) return input.booleanValue;
  if ('nullValue' in input) return null;
  return null;
};
const decodeMap = (input: any) => {
  const fields = input?.mapValue?.fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeField(value)]));
};

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  if (url.startsWith('https://analyticsdata.googleapis.com/v1beta/properties/123:runReport')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    ga4RequestBodies.push(body);
    const startDate = body.dateRanges?.[0]?.startDate;
    if (startDate === '2026-08-25') return Response.json({ error: { message: 'fixture failure' } }, { status: 503 });
    const organic = body.dimensionFilter?.filter?.fieldName === 'sessionDefaultChannelGroup';
    if (organic && startDate === '2026-08-11') throw new Error(`Synthetic GA4 failure: Authorization: Bearer ${bearerErrorFixture}`);
    const landing = body.dimensions?.[0]?.name === 'landingPage';
    const current = startDate === '2026-09-08';
    const partial = startDate === '2026-08-18';
    if (organic) {
      assert.deepEqual(body.dimensions, [{ name: 'sessionDefaultChannelGroup' }]);
      assert.deepEqual(body.dimensionFilter, { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search', matchType: 'EXACT' } } });
      return Response.json({
        dimensionHeaders: [{ name: 'sessionDefaultChannelGroup' }],
        metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }, { name: 'screenPageViews' }],
        rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [
          { value: current ? '17' : partial ? '4' : '12' },
          { value: current ? '15' : partial ? '4' : '10' },
          { value: current ? '0.71' : partial ? '0.49' : '0.62' },
          { value: current ? '39' : partial ? '9' : '24' }
        ] }],
        rowCount: 1
      });
    }
    if (landing) {
      assert.notEqual(body.dimensionFilter?.filter?.fieldName, 'sessionDefaultChannelGroup', 'landing-page report remains an explicitly all-channel series');
      const pageMetrics = current
        ? ['13', '11', '0.66', '29']
        : partial ? ['3', '3', '0.50', '7'] : ['9', '8', '0.61', '21'];
      const rows = [{
        dimensionValues: [{ value: current ? '/article-a/' : '/article-a' }],
        metricValues: pageMetrics.map(value => ({ value }))
      }];
      if (current) rows.push({
        dimensionValues: [{ value: '/unmapped' }],
        metricValues: [{ value: '2' }, { value: '2' }, { value: '0.4' }, { value: '4' }]
      });
      return Response.json({
        dimensionHeaders: [{ name: 'landingPage' }],
        metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }, { name: 'screenPageViews' }],
        rows,
        rowCount: partial ? 2 : rows.length
      });
    }
    return Response.json({
      metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }, { name: 'screenPageViews' }],
      rows: [{ metricValues: [
        { value: current ? '31' : partial ? '8' : '25' },
        { value: current ? '27' : partial ? '7' : '22' },
        { value: current ? '0.74' : partial ? '0.55' : '0.68' },
        { value: current ? '71' : partial ? '18' : '56' }
      ] }],
      rowCount: 1
    });
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
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { optimizationContext, siteRegistrySave } = await import('../packages/commands/src/remote-site-operations.js');
  const { captureGa4Period } = await import('../packages/commands/src/ga4-metrics.js');
  const { projectSiteOperationsMetrics } = await import('../packages/commands/src/site-operations-bridge.js');
  const { sqlite } = getDatabase();
  const t = '2026-09-15T00:00:00.000Z';

  sqlite.prepare(`INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run('project-a', 'Project A', 'example.com', 'existing_site', 'production', t, t);
  sqlite.prepare(`INSERT INTO pages(id,project_id,title,slug,kind,status,plan_mode,url,source,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-a', 'project-a', 'Article A', 'article-a', 'article', 'published', 'existing_page_improvement', 'https://example.com/article-a', 'blog_local', t, t, t);

  const blogSnapshot = {
    schema_version: 1,
    kind: 'blog_site_context',
    observed_at: t,
    blog_site_id: 'blog-site-a',
    canonical_origin: 'https://example.com',
    language: 'ja',
    country: 'jp',
    mapping_sha256: '0'.repeat(64),
    route_evidence: [],
    eligibility: {
      remediation_status: 'clear', clearance_gate: 'listed_for_scoped_clearance', new_content_allowed: true,
      reason: 'fixture', quality_status: 'verified', index_health: 'healthy'
    },
    sources: [{
      source_ref: 'content/posts/article-a.mdx', source_sha256: '1'.repeat(64), title: 'Article A',
      expected_url: 'https://example.com/article-a', draft: false, declared_date: null, headings: ['Article A'], local_build_present: true
    }],
    pages: [{
      local_build_url: 'https://example.com/article-a', canonical_url: null, canonical_status: 'unverified', title: 'Article A',
      source_refs: ['content/posts/article-a.mdx'], source_mapping_status: 'mapped', build_ref: 'dist/article-a/index.html',
      build_sha256: '2'.repeat(64), build_file_modified_at: t, robots: [], internal_links: [], publication_status: 'unverified', index_status: 'unverified'
    }],
    coverage: { source_count: 1, local_build_page_count: 1, unmapped_build_pages: 0, sources_absent_from_build: 0, duplicate_expected_urls: [], complete_site_coverage: true },
    warnings: []
  };
  sqlite.prepare(`INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('project-a', 'blog-site-a', 'https://example.com', 'ja', 'jp', JSON.stringify(blogSnapshot), 'fixture-hash', t);

  sqlite.prepare(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('import-a', 'project-a', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-08', '2026-09-14', 'America/Los_Angeles', 'web', '["query","page"]', 'succeeded', 'complete', 'GSC snapshot', 'local-source-v1', t, '{}', t);
  sqlite.prepare(`INSERT INTO keyword_metric_snapshots(id,project_id,keyword_id,query,site_url,start_date,end_date,search_type,clicks,impressions,ctr,position,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('query-a', 'project-a', null, 'example query', 'sc-domain:example.com', '2026-09-08', '2026-09-14', 'web', 8, 200, 0.04, 7.1, t);
  sqlite.prepare(`INSERT INTO keyword_metric_snapshots(id,project_id,keyword_id,query,site_url,start_date,end_date,search_type,clicks,impressions,ctr,position,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('query-b', 'project-a', null, 'second query', 'sc-domain:example.com', '2026-09-08', '2026-09-14', 'web', 4, 200, 0.02, 9.7, t);
  sqlite.prepare(`INSERT INTO page_metric_snapshots(id,project_id,page_id,url,site_url,start_date,end_date,search_type,clicks,impressions,ctr,position,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-metric-a', 'project-a', 'page-a', 'https://example.com/article-a', 'sc-domain:example.com', '2026-09-08', '2026-09-14', 'web', 10, 300, 10 / 300, 8.2, t);

  await siteRegistrySave({
    id: 'site-a', expectedRevision: 0, localProjectId: 'project-a', name: 'Site A', repository: 'nomuonji/site-a',
    productionUrl: 'https://example.com', deploymentProvider: 'vercel', searchConsoleProperty: 'sc-domain:example.com', ga4PropertyId: 'properties/123', status: 'active'
  });

  const systemCtx = { actor: 'system' as const, actorId: 'bridge-smoke', projectId: 'project-a' };
  const previousGa4 = await captureGa4Period(systemCtx, { projectId: 'project-a', propertyId: '123', targetOrigin: 'https://example.com', startDate: '2026-09-01', endDate: '2026-09-07' });
  const currentGa4 = await captureGa4Period(systemCtx, { projectId: 'project-a', propertyId: 'properties/123', targetOrigin: 'https://example.com', startDate: '2026-09-08', endDate: '2026-09-14' });
  const partialLandingGa4 = await captureGa4Period(systemCtx, { projectId: 'project-a', propertyId: '123', targetOrigin: 'https://example.com', startDate: '2026-08-18', endDate: '2026-08-24' });
  assert.deepEqual(previousGa4.metrics, { sessions: 25, activeUsers: 22, engagement: 0.68, views: 56 });
  assert.deepEqual(currentGa4.metrics, { sessions: 31, activeUsers: 27, engagement: 0.74, views: 71 });
  assert.equal(previousGa4.landingPages.status, 'complete');
  assert.equal(currentGa4.landingPages.status, 'complete');
  assert.equal(partialLandingGa4.landingPages.status, 'partial');
  assert.deepEqual(currentGa4.organicMetrics, { sessions: 17, activeUsers: 15, engagement: 0.71, views: 39 });
  assert.equal(currentGa4.organicStatus, 'complete', currentGa4.organicError ?? undefined);
  assert.deepEqual(currentGa4.metricScopes, { sessions: 'all channels', organicMetrics: 'Organic Search', landingPages: 'all channels' });
  assert.equal(ga4RequestBodies.filter(body => body.dimensionFilter?.filter?.fieldName === 'sessionDefaultChannelGroup').length, 3);
  const ga4Payloads = sqlite.prepare("SELECT payload_json FROM measurement_imports WHERE project_id=? AND provider='ga4' AND completeness='complete'").all('project-a') as Array<{ payload_json: string }>;
  assert.equal(ga4Payloads.length, 3);
  const capturedPayload = JSON.parse(ga4Payloads.find(row => JSON.parse(row.payload_json).organicStatus === 'complete')!.payload_json);
  assert.equal(capturedPayload.metrics.sessions, 31, 'the existing sessions field remains all-channel');
  assert.equal(capturedPayload.organicMetrics.sessions, 17, 'Organic Search has a separate field');
  assert.deepEqual(capturedPayload.metricScopes, { sessions: 'all channels', organicMetrics: 'Organic Search', landingPages: 'all channels' });
  assert.ok(!JSON.stringify(ga4Payloads).includes('ga4-secret-fixture-token'), 'measurement persistence must not contain credentials');

  await assert.rejects(() => captureGa4Period(systemCtx, { projectId: 'project-a', propertyId: '123', targetOrigin: 'https://example.com', startDate: '2026-08-25', endDate: '2026-08-31' }), /GA4 collection failed/);
  const failedGa4 = sqlite.prepare("SELECT payload_json FROM measurement_imports WHERE project_id=? AND provider='ga4' AND completeness='failed' ORDER BY captured_at DESC LIMIT 1").get('project-a') as { payload_json: string };
  assert.deepEqual(JSON.parse(failedGa4.payload_json), { error: 'ga4_collection_failed' });
  assert.ok(!failedGa4.payload_json.includes('fixture failure'));

  const first = await projectSiteOperationsMetrics('project-a');
  assert.equal(first.status, 'projected');
  assert.equal(first.articleRegistrySync.status, 'synced');
  assert.equal(first.articleRegistrySync.created, 1);
  assert.equal(first.articleRegistrySync.updated, 0);
  assert.equal(first.articleRegistrySync.reused, 0);
  assert.deepEqual(first.gsc.site, { saved: 1, reused: 0 });
  assert.deepEqual(first.gsc.articles, { saved: 1, reused: 0 });
  assert.deepEqual(first.ga4, { saved: 3, reused: 0 });
  assert.deepEqual(first.ga4Organic, { saved: 3, reused: 0 });
  assert.deepEqual(first.ga4Articles, { saved: 2, reused: 0 });
  assert.deepEqual(first.ga4Acquisition, {
    source: 'direct_data_api', importsConsidered: 3, projected: 3, articleProjected: 2, unmappedLandingRows: 1, ambiguousArticleRows: 0
  });
  assert.equal(first.articleMappings.byLocalPageId, 1);
  assert.ok(first.warnings.some(message => message.includes('no complete landing-page set')));
  assert.ok(first.warnings.some(message => message.includes('did not exactly match')));

  const articleDocs = [...docs.values()].filter(doc => doc.name.startsWith(`${root}articles/`));
  assert.equal(articleDocs.length, 1);
  assert.equal(decodeField(articleDocs[0].fields?.localPageId), 'page-a');
  assert.equal(decodeField(articleDocs[0].fields?.canonicalUrl), 'https://example.com/article-a');
  assert.equal(decodeField(articleDocs[0].fields?.repoPath), 'content/posts/article-a.mdx');
  assert.equal(decodeField(articleDocs[0].fields?.status), 'draft', 'local Blog mapping must not invent publication state');
  const articleId = articleDocs[0].name.split('/').at(-1)!;

  const publishedAt = '2026-09-16T12:34:56.000Z';
  const targetUrl = 'https://example.com/article-a';
  const handoffPayload = { target_urls: [targetUrl] };
  const receiptPayload = (eventId: string, httpStatus: number, canonical: string) => ({
    schema_version: 1, event_id: eventId, handoff_id: eventId, version_hash: `${eventId}-version`,
    status: 'published', occurred_at: publishedAt, evidence_refs: ['fixture:published'], final_urls: [targetUrl],
    publication: { confirmed_at: publishedAt, checks: [{ url: targetUrl, http_status: httpStatus, canonical }] }
  });
  const insertHandoff = (id: string, withReceipt: boolean, httpStatus = 200, canonical = targetUrl) => {
    sqlite.prepare(`INSERT INTO blog_handoffs(id,project_id,page_id,version_hash,payload_json,status,published_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, 'project-a', 'page-a', `${id}-version`, JSON.stringify(handoffPayload), 'published', withReceipt ? publishedAt : null, publishedAt, publishedAt);
    if (withReceipt) sqlite.prepare(`INSERT INTO blog_receipts(event_id,handoff_id,payload_hash,payload_json,created_at) VALUES(?,?,?,?,?)`)
      .run(id, id, `${id}-hash`, JSON.stringify(receiptPayload(id, httpStatus, canonical)), publishedAt);
  };

  // A handoff without a receipt and a malformed publication receipt never
  // promote the mapped record. The malformed fixture combines non-200 and
  // canonical mismatch evidence and must be rejected with a visible warning.
  insertHandoff('handoff-without-receipt', false);
  insertHandoff('handoff-invalid-publication', true, 404, 'https://example.com/wrong');
  const rejectedPublication: any = await projectSiteOperationsMetrics('project-a');
  assert.equal(rejectedPublication.publicationReceiptSync.updated, 0);
  assert.equal(rejectedPublication.publicationReceiptSync.skipped, 1);
  assert.ok(rejectedPublication.publicationReceiptSync.warnings.some((message: string) => message.includes('evidence is incomplete')));
  assert.equal(decodeField(docs.get(`${root}articles/${articleId}`).fields?.status), 'draft');

  insertHandoff('handoff-valid-publication', true);
  const articleDuplicate = JSON.parse(JSON.stringify(docs.get(`${root}articles/${articleId}`)));
  articleDuplicate.name = `${root}articles/${articleId}-duplicate`;
  articleDuplicate.fields.id = { stringValue: `${articleId}-duplicate` };
  articleDuplicate.updateTime = 'duplicate-fixture';
  docs.set(articleDuplicate.name, articleDuplicate);
  const ambiguousPublication: any = await projectSiteOperationsMetrics('project-a');
  assert.equal(ambiguousPublication.publicationReceiptSync.updated, 0);
  assert.ok(ambiguousPublication.publicationReceiptSync.warnings.some((message: string) => message.includes('do not identify one existing article record')));
  assert.deepEqual(ambiguousPublication.gsc.articles, { saved: 0, reused: 0 }, 'ambiguous article identities are excluded from page-level GSC projection');
  assert.equal(ambiguousPublication.ga4Articles.saved, 0, 'ambiguous article identities are excluded from page-level GA4 projection');
  assert.equal(decodeField(docs.get(`${root}articles/${articleId}`).fields?.status), 'draft');
  docs.delete(articleDuplicate.name);

  const auditRunsBeforePublish = [...docs.values()].filter(doc => decodeField(doc.fields?.command) === 'site_article_save').length;
  const syncedPublication: any = await projectSiteOperationsMetrics('project-a');
  assert.equal(syncedPublication.publicationReceiptSync.updated, 1);
  assert.equal(syncedPublication.publicationReceiptSync.reused, 0);
  assert.equal(syncedPublication.publicationReceiptSync.auditRunIds.length, 1);
  const publishedArticle = docs.get(`${root}articles/${articleId}`);
  assert.equal(decodeField(publishedArticle.fields?.status), 'published');
  assert.equal(decodeField(publishedArticle.fields?.publishedAt), publishedAt);
  assert.equal(decodeField(publishedArticle.fields?.repoPath), 'content/posts/article-a.mdx', 'receipt sync preserves article source metadata');
  assert.equal([...docs.values()].filter(doc => decodeField(doc.fields?.command) === 'site_article_save').length, auditRunsBeforePublish + 1);
  assert.ok(docs.has(`${root}runs/${syncedPublication.publicationReceiptSync.auditRunIds[0]}`), 'publication update writes a durable audit run');
  assert.ok([...docs.values()].some(doc => doc.name.startsWith(`${root}metricSnapshots/`)
    && decodeField(doc.fields?.sourceVersion) === `sqlite:gsc:local-source-v1:article:${articleId}`),
    'the exact registered article remains the downstream GSC projection target');

  const metricDocsAfterFirst = [...docs.values()].filter(doc => doc.name.startsWith(`${root}metricSnapshots/`));
  assert.equal(metricDocsAfterFirst.length, 10);
  const siteGsc = metricDocsAfterFirst.find(doc => decodeField(doc.fields?.provider) === 'gsc' && decodeField(doc.fields?.articleId) === null);
  assert.ok(siteGsc, 'site-level GSC snapshot should be projected');
  assert.equal(decodeField(siteGsc.fields?.sourceVersion), 'sqlite:gsc:local-source-v1');
  const directGa4Docs = metricDocsAfterFirst.filter(doc => decodeField(doc.fields?.provider) === 'ga4');
  assert.equal(directGa4Docs.length, 8);
  assert.ok(directGa4Docs.every(doc => String(decodeField(doc.fields?.sourceVersion)).startsWith('sqlite:ga4:')), 'direct GA4 must win over analytics-dashboard fallback');
  const organicGa4Docs = directGa4Docs.filter(doc => String(decodeField(doc.fields?.sourceVersion)).endsWith(':channel=Organic%20Search'));
  assert.equal(organicGa4Docs.length, 3);
  assert.ok(organicGa4Docs.some(doc => decodeMap(doc.fields?.metrics).organicSessions === 17), 'organic snapshot has its own organicSessions field');
  const articleGa4Docs = directGa4Docs.filter(doc => decodeField(doc.fields?.articleId) === articleId);
  assert.equal(articleGa4Docs.length, 2, 'only complete landing-page periods should project article GA4');

  const articleContext = await optimizationContext({ siteId: 'site-a', articleId, metricLimit: 30, eventLimit: 30 });
  assert.ok(articleContext.latestMetrics.ga4, 'article optimization context should now include article-level GA4');
  assert.equal(articleContext.latestMetrics.ga4.articleId, articleId);
  assert.equal(articleContext.latestMetrics.ga4.provider, 'ga4');
  assert.deepEqual(articleContext.latestMetrics.ga4.metrics, { sessions: 13, activeUsers: 11, engagement: 0.66, views: 29 });

  const second = await projectSiteOperationsMetrics('project-a');
  assert.equal(second.articleRegistrySync.status, 'synced');
  assert.equal(second.articleRegistrySync.created, 0);
  assert.equal(second.articleRegistrySync.reused, 1);
  assert.equal(second.publicationReceiptSync.updated, 0);
  assert.equal(second.publicationReceiptSync.reused, 1, 'repeated projection is idempotent');
  assert.equal([...docs.values()].filter(doc => decodeField(doc.fields?.command) === 'site_article_save').length, auditRunsBeforePublish + 1);
  assert.deepEqual(second.gsc.site, { saved: 0, reused: 1 });
  assert.deepEqual(second.gsc.articles, { saved: 0, reused: 1 });
  assert.deepEqual(second.ga4, { saved: 0, reused: 3 });
  assert.deepEqual(second.ga4Organic, { saved: 0, reused: 3 });
  assert.deepEqual(second.ga4Articles, { saved: 0, reused: 2 });
  assert.deepEqual(second.ga4Acquisition, {
    source: 'direct_data_api', importsConsidered: 3, projected: 3, articleProjected: 2, unmappedLandingRows: 1, ambiguousArticleRows: 0
  });
  assert.equal([...docs.values()].filter(doc => doc.name.startsWith(`${root}articles/`)).length, 1);
  assert.equal([...docs.values()].filter(doc => doc.name.startsWith(`${root}metricSnapshots/`)).length, 10);

  // Page-level GSC evidence remains projectable when the matching import has
  // no query rows (a valid Search Console response can have this shape).
  const pageOnlyAt = '2026-09-22T00:00:00.000Z';
  sqlite.prepare(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-only-import', 'project-a', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-15', '2026-09-21', 'America/Los_Angeles', 'web', '["query","page"]', 'succeeded', 'complete', 'GSC page-only fixture', 'page-only-source-v1', pageOnlyAt, '{}', pageOnlyAt);
  sqlite.prepare(`INSERT INTO page_metric_snapshots(id,project_id,page_id,url,site_url,start_date,end_date,search_type,clicks,impressions,ctr,position,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-only-metric', 'project-a', 'page-a', 'https://example.com/article-a', 'sc-domain:example.com', '2026-09-15', '2026-09-21', 'web', 3, 40, 0.075, 6.4, pageOnlyAt);
  const pageOnlyProjection: any = await projectSiteOperationsMetrics('project-a');
  assert.equal(pageOnlyProjection.status, 'projected');
  assert.equal(pageOnlyProjection.gsc.articles.saved, 1, 'page metrics project even when queryRows is empty');
  assert.ok([...docs.values()].some(doc => doc.name.startsWith(`${root}metricSnapshots/`)
    && decodeField(doc.fields?.sourceVersion) === `sqlite:gsc:page-only-source-v1:article:${articleId}`));

  // A complete GSC response with no query or page rows is still a measured
  // observation. Preserve it as an explicit complete zero site snapshot so
  // downstream readers do not silently keep using stale GSC data.
  const emptyGscAt = '2026-09-29T00:00:00.000Z';
  const insertGscImport = sqlite.prepare(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertGscImport.run('empty-gsc-import', 'project-a', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-22', '2026-09-28', 'America/Los_Angeles', 'web', '["query","page"]', 'succeeded', 'complete', 'GSC empty fixture', 'empty-source-v1', emptyGscAt, JSON.stringify({ queryRows: 0, pageRows: 0, queryComplete: true, pageComplete: true }), emptyGscAt);
  insertGscImport.run('partial-empty-gsc-import', 'project-a', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-21', '2026-09-27', 'America/Los_Angeles', 'web', '["query","page"]', 'partial', 'partial', 'GSC partial empty fixture', 'partial-empty-source-v1', '2026-09-29T00:00:01.000Z', JSON.stringify({ queryRows: 0, pageRows: 0, queryComplete: false, pageComplete: true }), '2026-09-29T00:00:01.000Z');
  insertGscImport.run('failed-empty-gsc-import', 'project-a', 'gsc', 'sc-domain:example.com', 'https://example.com', '[]', '2026-09-20', '2026-09-26', 'America/Los_Angeles', 'web', '["query","page"]', 'failed', 'failed', 'GSC failed empty fixture', 'failed-empty-source-v1', '2026-09-29T00:00:02.000Z', JSON.stringify({ error: 'fixture failure' }), '2026-09-29T00:00:02.000Z');
  const emptyGscProjection: any = await projectSiteOperationsMetrics('project-a');
  assert.equal(emptyGscProjection.status, 'projected');
  assert.ok(emptyGscProjection.latestSiteSnapshots.gsc, 'complete empty GSC capture must refresh the site-level snapshot');
  assert.deepEqual(emptyGscProjection.latestSiteSnapshots.gsc.metrics, {
    clicks: 0, impressions: 0, ctr: null, averagePosition: null
  });
  assert.equal(emptyGscProjection.latestSiteSnapshots.gsc.completeness, 'complete');
  assert.equal(emptyGscProjection.latestSiteSnapshots.gsc.sourceVersion, 'sqlite:gsc:empty-source-v1');
  const emptyGscDoc = [...docs.values()].find(doc => doc.name.startsWith(`${root}metricSnapshots/`)
    && decodeField(doc.fields?.sourceVersion) === 'sqlite:gsc:empty-source-v1');
  assert.ok(emptyGscDoc, 'empty complete GSC observation must be persisted in Firestore');
  assert.deepEqual(emptyGscProjection.gsc.site, { saved: 1, reused: 2 });
  const repeatedEmptyProjection: any = await projectSiteOperationsMetrics('project-a');
  assert.deepEqual(repeatedEmptyProjection.gsc.site, { saved: 0, reused: 3 }, 'empty GSC projection must remain idempotent');
  assert.equal(repeatedEmptyProjection.latestSiteSnapshots.gsc.sourceVersion, 'sqlite:gsc:empty-source-v1');
  assert.ok(![...docs.values()].some(doc => doc.name.startsWith(`${root}metricSnapshots/`)
    && ['sqlite:gsc:partial-empty-source-v1', 'sqlite:gsc:failed-empty-source-v1'].includes(String(decodeField(doc.fields?.sourceVersion)))),
    'partial or failed empty imports must not be projected as zero snapshots');

  // Lazy mode refreshes registered articles but defers new ones to explicit
  // registration (optimization event or publication).
  sqlite.prepare('INSERT INTO pages(id,project_id,title,slug,kind,status,url,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('page-b', 'project-a', 'Article B', 'article-b', 'existing', 'local', 'https://example.com/article-b', 'blog_local', t, t);
  const snapshotRow = sqlite.prepare('SELECT snapshot_json FROM blog_bindings WHERE project_id=?').get('project-a') as { snapshot_json: string };
  const snapshotDoc = JSON.parse(snapshotRow.snapshot_json);
  snapshotDoc.sources.push({
    source_ref: 'content/posts/article-b.mdx', source_sha256: '3'.repeat(64), title: 'Article B',
    expected_url: 'https://example.com/article-b', draft: false, declared_date: null, headings: [], local_build_present: false
  });
  sqlite.prepare('UPDATE blog_bindings SET snapshot_json=?,snapshot_hash=?,observed_at=? WHERE project_id=?')
    .run(JSON.stringify(snapshotDoc), 'fixture-hash-2', t, 'project-a');
  process.env.KEYWORDS_ARTICLE_SYNC_MODE = 'lazy';
  try {
    const lazy = await projectSiteOperationsMetrics('project-a');
    assert.equal(lazy.articleRegistrySync.status, 'synced');
    assert.equal(lazy.articleRegistrySync.created, 0);
    assert.equal(lazy.articleRegistrySync.reused, 1);
    assert.ok(lazy.articleRegistrySync.warnings.some(message => message.includes('Deferred content/posts/article-b.mdx')));
    assert.equal([...docs.values()].filter(doc => doc.name.startsWith(`${root}articles/`)).length, 1);
  } finally {
    delete process.env.KEYWORDS_ARTICLE_SYNC_MODE;
  }

  const bearerFailureCapture = await captureGa4Period(systemCtx, { projectId: 'project-a', propertyId: '123', targetOrigin: 'https://example.com', startDate: '2026-08-11', endDate: '2026-08-17' });
  assert.equal(bearerFailureCapture.status, 'captured', 'an Organic Search failure must not discard all-channel data');
  assert.equal(bearerFailureCapture.organicStatus, 'failed');
  assert.equal(bearerFailureCapture.organicError, 'Synthetic GA4 failure: Authorization: Bearer [redacted]');
  assert.ok(!bearerFailureCapture.organicError?.includes(bearerErrorFixture), 'organic error summaries must redact Bearer credentials');
  assert.deepEqual(bearerFailureCapture.metrics, { sessions: 25, activeUsers: 22, engagement: 0.68, views: 56 });

  console.log('site operations bridge smoke passed: verified publication receipts update exact articles idempotently, ambiguous identities are skipped, GSC article metrics remain mapped, and Firestore stays idempotent');
} finally {
  globalThis.fetch = originalFetch;
  for (const path of [analyticsPath, dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
