import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { field } from '../packages/db/src/firestore.js';
import {
  metricSnapshotSave,
  optimizationContext,
  optimizationEventCreate,
  optimizationEventUpdate,
  siteArticleSave,
  siteRegistryGet,
  siteRegistryResolve,
  siteRegistrySave
} from '../packages/commands/src/remote-site-operations.js';

// Deterministic Firestore double. Never loads .env or touches production data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.KEYWORDS_REMOTE_MCP_TOKEN = 'test-only-token';
const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
const originalFetch = globalThis.fetch;
const decodeField = (value: any): any => value?.stringValue ?? value?.integerValue ?? value?.doubleValue ?? value?.booleanValue ?? null;

docs.set(`${root}siteStructures/concept-a`, { name: `${root}siteStructures/concept-a`, fields: { title: field('Concept A'), revision: field(1) }, updateTime: 'seed-1' });

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
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
    const rows = [...docs.values()]
      .filter(doc => doc.name.startsWith(`${root}${collection}/`) && decodeField(doc.fields?.[filter.field.fieldPath]) === expected)
      .slice(0, Number(query.limit ?? 500))
      .map(document => ({ document }));
    return Response.json(rows);
  }

  if (/\/(sites|articles|metricSnapshots|optimizationEvents)$/.test(path)) {
    const collection = path.split('/').at(-1)!;
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}${collection}/`));
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const site = await siteRegistrySave({
    id: 'site-a', expectedRevision: 0, siteConceptId: 'concept-a', localProjectId: 'local-project-a', name: 'Site A', repository: 'nomuonji/site-a',
    productionUrl: 'https://example.com', deploymentProvider: 'vercel', ga4PropertyId: 'properties/123',
    searchConsoleProperty: 'sc-domain:example.com', status: 'active'
  });
  assert.equal(site.revision, 1);
  assert.equal(site.productionUrl, 'https://example.com/');
  assert.equal((await siteRegistryGet({ id: 'site-a' })).siteConceptId, 'concept-a');
  assert.equal((await siteRegistryResolve({ localProjectId: 'local-project-a' })).site?.id, 'site-a');
  assert.equal((await siteRegistryResolve({ productionUrl: 'https://EXAMPLE.com:443/?utm_source=smoke#fragment' })).site?.id, 'site-a');
  assert.equal((await siteRegistryResolve({ localProjectId: 'missing-project' })).site, null);
  await assert.rejects(siteRegistrySave({ id: 'site-a', expectedRevision: 0, status: 'paused' }), /Revision conflict/);
  await assert.rejects(siteRegistrySave({ id: 'site-b', expectedRevision: 0, siteConceptId: 'missing', name: 'x', repository: 'nomuonji/x', productionUrl: 'https://x.example' }), /Unknown siteConceptId/);
  await assert.rejects(siteRegistrySave({ id: 'site-b', expectedRevision: 0, localProjectId: 'local-project-a', name: 'x', repository: 'nomuonji/x', productionUrl: 'https://x.example' }), /already linked/);
  await assert.rejects(siteRegistrySave({
    id: 'site-c', expectedRevision: 0, localProjectId: 'local-project-c', name: 'Duplicate Site', repository: 'nomuonji/site-c',
    productionUrl: 'https://example.com/?utm_source=duplicate#fragment'
  }), /productionUrl is already linked/);

  const article = await siteArticleSave({
    id: 'article-a', expectedRevision: 0, siteId: 'site-a', localPageId: 'local-page-a', canonicalUrl: 'https://example.com/article-a',
    repo: 'nomuonji/site-a', repoPath: 'content/posts/article-a.mdx', currentCommitSha: 'a'.repeat(40), slug: 'article-a', title: 'Article A',
    primaryKeywordId: 'b'.repeat(32), status: 'published', publishedAt: '2026-08-01T00:00:00.000Z', lastUpdatedAt: '2026-09-01T00:00:00.000Z'
  });
  assert.equal(article.repoPath, 'content/posts/article-a.mdx');
  assert.equal(article.localPageId, 'local-page-a');
  await assert.rejects(siteArticleSave({ id: 'bad-path', expectedRevision: 0, siteId: 'site-a', repo: 'nomuonji/site-a', repoPath: '../secret', slug: 'bad', title: 'bad' }));
  await assert.rejects(siteArticleSave({ id: 'article-b', expectedRevision: 0, siteId: 'site-a', localPageId: 'local-page-a', repo: 'nomuonji/site-a', repoPath: 'content/posts/b.mdx', slug: 'b', title: 'B' }), /already linked/);
  const normalizedArticle = await siteArticleSave({
    id: 'article-a', expectedRevision: article.revision, siteId: 'site-a', canonicalUrl: 'https://EXAMPLE.com:443/article-a/?utm_source=smoke#fragment'
  });
  assert.equal(normalizedArticle.canonicalUrl, 'https://example.com/article-a');
  await assert.rejects(siteArticleSave({
    id: 'article-c', expectedRevision: 0, siteId: 'site-a', canonicalUrl: 'https://example.com/article-a/',
    repo: 'nomuonji/site-a', repoPath: 'content/posts/c.mdx', slug: 'c', title: 'C'
  }), /canonicalUrl is already linked/);

  const gscInput = {
    siteId: 'site-a', articleId: 'article-a', provider: 'gsc' as const, periodStart: '2026-09-01', periodEnd: '2026-09-07',
    metrics: { clicks: 12, impressions: 400, ctr: 0.03, averagePosition: 8.4 },
    queries: [{ query: 'example query', clicks: 8, impressions: 200, ctr: 0.04, averagePosition: 7.1 }],
    completeness: 'complete' as const, sourceVersion: 'gsc:2026-09-01:2026-09-07:v1', capturedAt: '2026-09-10T00:00:00.000Z'
  };
  const gsc = await metricSnapshotSave(gscInput);
  assert.equal(gsc.reused, false);
  assert.equal((await metricSnapshotSave(gscInput)).reused, true);
  await metricSnapshotSave({
    siteId: 'site-a', articleId: 'article-a', provider: 'ga4', periodStart: '2026-09-01', periodEnd: '2026-09-07',
    metrics: { sessions: 30, users: 26, engagedSessions: 22, engagementRate: 0.73, keyEvents: 2 },
    sourceVersion: 'ga4:2026-09-01:2026-09-07:v1', capturedAt: '2026-09-10T00:01:00.000Z'
  });

  const active = await optimizationEventCreate({
    id: 'opt-a', siteId: 'site-a', articleId: 'article-a', observation: 'Impressions exist but CTR is low.', diagnosis: 'Snippet does not match query intent.',
    hypothesis: 'A more specific title will improve CTR without changing the page intent.', actionType: 'title_snippet', baselinePeriod: { start: '2026-08-18', end: '2026-08-31' },
    beforeCommit: 'a'.repeat(40), afterCommit: 'c'.repeat(40), phase: 'implemented', notes: 'One change only.'
  });
  assert.equal(active.result, 'pending');
  assert.ok(active.evaluateAfter && Date.parse(active.evaluateAfter) > Date.parse(active.changedAt!));
  const context = await optimizationContext({ siteId: 'site-a', articleId: 'article-a' });
  assert.equal(context.changeAllowed, false);
  assert.equal((context.latestMetrics.gsc as any)?.provider, 'gsc');
  assert.equal((context.latestMetrics.ga4 as any)?.provider, 'ga4');
  await assert.rejects(optimizationEventCreate({
    id: 'opt-b', siteId: 'site-a', articleId: 'article-a', observation: 'Another signal', diagnosis: 'Another diagnosis', hypothesis: 'Another hypothesis',
    actionType: 'content_expand', baselinePeriod: { start: '2026-08-18', end: '2026-08-31' }, phase: 'implemented'
  }), /unevaluated optimization/);
  await assert.rejects(optimizationEventUpdate({ id: 'opt-a', expectedRevision: 1, result: 'improved', evaluationMetrics: { ctrDelta: 0.01 } }), /has not matured/);
  const cancelled = await optimizationEventUpdate({ id: 'opt-a', expectedRevision: 1, phase: 'cancelled', notes: 'Cancelled before evaluation.' });
  assert.equal(cancelled.result, 'inconclusive');

  const oldChangedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const oldEvaluateAfter = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const mature = await optimizationEventCreate({
    id: 'opt-mature', siteId: 'site-a', articleId: 'article-a', observation: 'Position was 11.', diagnosis: 'Coverage gap.',
    hypothesis: 'Adding one missing comparison section will improve ranking.', actionType: 'content_expand', baselinePeriod: { start: '2026-07-01', end: '2026-07-14' },
    changedAt: oldChangedAt, evaluateAfter: oldEvaluateAfter, phase: 'implemented'
  });
  const evaluated = await optimizationEventUpdate({ id: 'opt-mature', expectedRevision: mature.revision, result: 'improved', evaluationMetrics: { positionDelta: -2.4 } });
  assert.equal(evaluated.phase, 'evaluated');

  const { siteArticleCreateMany } = await import('../packages/commands/src/remote-site-operations.js');
  let commitCalls = 0;
  const countingFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).endsWith(':commit')) commitCalls++;
    return countingFetch(input, init);
  }) as typeof fetch;
  try {
    const batched = await siteArticleCreateMany({
      siteId: 'site-a',
      records: [
        { id: 'article-batch-1', localPageId: 'local-batch-1', canonicalUrl: 'https://example.com/batch-1', repo: 'nomuonji/site-a', repoPath: 'content/b1.mdx', slug: 'batch-1', title: 'Batch 1' },
        { id: 'article-batch-2', localPageId: 'local-batch-2', canonicalUrl: 'https://example.com/batch-2', repo: 'nomuonji/site-a', repoPath: 'content/b2.mdx', slug: 'batch-2', title: 'Batch 2' },
        { id: 'article-batch-3', localPageId: 'local-batch-3', canonicalUrl: 'https://example.com/batch-3', repo: 'nomuonji/site-a', repoPath: 'content/b3.mdx', slug: 'batch-3', title: 'Batch 3' }
      ]
    });
    assert.equal(batched.created.length, 3);
    assert.ok(batched.created.every(article => article.revision === 1 && article.status === 'draft'));
    assert.equal(commitCalls, 1);
    await assert.rejects(siteArticleCreateMany({
      siteId: 'site-a',
      records: [
        { id: 'article-batch-4', localPageId: 'local-batch-4', canonicalUrl: 'https://example.com/batch-4', repo: 'nomuonji/site-a', repoPath: 'content/b4.mdx', slug: 'batch-4', title: 'Batch 4' },
        { id: 'article-batch-5', localPageId: 'local-batch-5', canonicalUrl: 'https://example.com/batch-4', repo: 'nomuonji/site-a', repoPath: 'content/b5.mdx', slug: 'batch-5', title: 'Batch 5' }
      ]
    }), /already linked/);
    await assert.rejects(siteArticleCreateMany({
      siteId: 'site-a',
      records: [{ id: 'article-batch-6', localPageId: 'local-page-a', canonicalUrl: 'https://example.com/batch-6', repo: 'nomuonji/site-a', repoPath: 'content/b6.mdx', slug: 'batch-6', title: 'Batch 6' }]
    }), /already linked/);
    await assert.rejects(siteArticleCreateMany({
      siteId: 'site-a',
      records: [{ id: 'x'.repeat(101), localPageId: 'local-batch-7', canonicalUrl: 'https://example.com/batch-7', repo: 'nomuonji/site-a', repoPath: 'content/b7.mdx', slug: 'batch-7', title: 'Batch 7' }]
    }));
  } finally {
    globalThis.fetch = countingFetch;
  }

  const { default: mcp } = await import('../api/sites-mcp.js');
  assert.equal((await mcp.request('/sites-mcp', { method: 'POST' })).status, 401);
  assert.equal((await mcp.request('/sites-mcp/health')).status, 200);
  const call = async (method: string, params: object, bearer = 'test-only-token') => {
    const response = await mcp.request('/sites-mcp', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    assert.equal(response.status, 200);
    return (await response.json() as any).result;
  };
  const listing = await call('tools/list', {});
  assert.equal(listing.tools.length, 16);
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_registry_resolve'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'optimization_context'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'optimization_evaluation_context'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_query_opportunities'));
  const status = await call('tools/call', { name: 'remote_sites_status', arguments: {} });
  assert.equal(status.structuredContent.sourceOfTruth.articleBody, 'git_repository');
  const mapped = await call('tools/call', { name: 'site_registry_resolve', arguments: { localProjectId: 'local-project-a' } });
  assert.equal(mapped.structuredContent.site.id, 'site-a');

  // Verify compatibility with access tokens signed by the existing Keywords OAuth server.
  const body = Buffer.from(JSON.stringify({ kind: 'access', exp: Math.floor(Date.now() / 1000) + 300, clientId: 'smoke' })).toString('base64url');
  const signedAccess = `${body}.${createHmac('sha256', 'test-only-token').update(body).digest('base64url')}`;
  const oauthStatus = await call('tools/call', { name: 'remote_sites_status', arguments: {} }, signedAccess);
  assert.equal(oauthStatus.structuredContent.serverVersion, '0.3.0');

  console.log('site operations smoke passed: normalized site/article identities, explicit local mappings, idempotent metrics, optimization cooldown/evaluation and separate MCP contract');
} finally {
  globalThis.fetch = originalFetch;
}