import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { field, value } from '../packages/db/src/firestore.js';
import { keywordResearchPipeline } from '../packages/commands/src/keyword-research-pipeline.js';
import { researchSessionCreate, screenDemandResults } from '../packages/commands/src/remote-keyword-research.js';
import { themeCandidateUpsert, themeCandidateChallenge, themeResearchContext } from '../packages/commands/src/theme-research.js';
import { seoTaskCreate, seoTaskGet } from '../packages/commands/src/remote-site-operations.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.KEYWORDS_REMOTE_MCP_TOKEN = 'test-only-token';
process.env.BRAVE_API_KEY = 'test-brave-key';
process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL = 'https://volume.example.test';
process.env.KEYWORDS_SERP_MONTHLY_LIMIT = '20';
process.env.KEYWORDS_SERP_SOFT_LIMIT = '15';
process.env.KEYWORDS_SERP_RESERVE = '5';
delete process.env.KEYWORDS_ALLOW_PRIVATE_FETCH;
const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
let serpCalls = 0;
let adsUnavailable = false;
const pageReads: string[] = [];
const originalFetch = globalThis.fetch;
const now = new Date().toISOString();
const sourceUrl = 'https://8.8.8.8/question';
const pageUrl = 'https://8.8.8.8/article';
const observed = { keyword: 'unmeasured question', sourceUrl, observedAt: now, excerpt: 'I cannot find whether these pens work with this paper.', researchReason: 'Investigate the paper condition rather than a generic best-pen list.' };
const discovery = {
  siteId: 'site-a', audience: 'Left-handed notebook users', question: 'Which documented pen/paper combinations are available?',
  observations: [{ kind: 'question' as const, url: sourceUrl, observedAt: now, excerpt: observed.excerpt }],
  serpReviews: [{ query: observed.keyword, provider: 'brave' as const, researchedAt: now, pages: [{ url: pageUrl, readAt: now, excerpt: 'This article lists pens without the documented paper conditions.', coverage: 'partial' as const, answers: 'Pen names', remainingGap: 'The reviewed section does not explain paper conditions; full-page absence is unconfirmed.' }] }],
  unmetNeed: 'The observed question needs documented conditions.', deliverable: 'A sourced table of manufacturer-stated conditions, with unknowns explicitly shown.',
  feasibility: 'Use public documentation only; no invented testing.', falsification: 'Reject if existing pages already answer the question or official sources provide no useful comparison.',
  nextQueries: [{ query: 'pen paper documented conditions', reason: 'The observation shifts the investigation from pen names to paper conditions.' }]
};

globalThis.fetch = async (input, init) => {
  const urlString = String(input);
  if (urlString === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  if (urlString.startsWith('https://volume.example.test')) {
    if (adsUnavailable) throw new Error('test demand outage');
    return Response.json({ results: [
      { keyword: 'high demand', avgMonthlySearches: 1000, averageCpcMicros: 2000000, competitionIndex: 10 },
      { keyword: 'unmeasured question', avgMonthlySearches: null, averageCpcMicros: null, competitionIndex: null }
    ] });
  }
  if (urlString.startsWith('https://api.search.brave.com/')) {
    serpCalls++;
    return Response.json({ web: { results: [
      { title: 'Pen list', url: pageUrl, description: 'Useful pens' },
      { title: 'Unavailable source', url: 'https://8.8.8.8/missing', description: 'A source' },
      { title: 'Private result', url: 'http://127.0.0.1/private', description: 'Must not be fetched' }
    ] } });
  }
  if (urlString.startsWith('https://8.8.8.8/')) {
    pageReads.push(urlString);
    if (urlString.endsWith('/missing')) return new Response('unavailable', { status: 403 });
    return new Response(`<html><title>Evidence</title><main>${'Manufacturer condition. '.repeat(200)}</main></html>`, { headers: { 'content-type': 'text/html' } });
  }
  assert.ok(urlString.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${urlString}`);
  const url = new URL(urlString);
  const path = url.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (urlString.endsWith(':commit')) {
    for (const write of body.writes) {
      const previous = docs.get(write.update.name);
      if ((write.currentDocument?.exists === false && previous) || (write.currentDocument?.updateTime && previous?.updateTime !== write.currentDocument.updateTime)) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `revision-${++sequence}` });
    return Response.json({});
  }
  if (urlString.endsWith(':runQuery')) {
    const query = body.structuredQuery;
    const filter = query.where.fieldFilter;
    return Response.json([...docs.values()].filter(doc => doc.name.startsWith(`${root}${query.from[0].collectionId}/`) && value(doc.fields[filter.field.fieldPath]) === value(filter.value)).map(document => ({ document })));
  }
  if (init?.method === 'PATCH') {
    const previous = docs.get(path);
    if ((url.searchParams.get('currentDocument.exists') === 'false' && previous) || (url.searchParams.get('currentDocument.updateTime') && previous?.updateTime !== url.searchParams.get('currentDocument.updateTime'))) return Response.json({}, { status: 409 });
    const next = { name: path, fields: body.fields, updateTime: `revision-${++sequence}` };
    docs.set(path, next);
    return Response.json(next);
  }
  if (path.endsWith('/researchSessions') || path.endsWith('/themeCandidates')) {
    return Response.json({ documents: [...docs.values()].filter(doc => doc.name.startsWith(`${path}/`) && !doc.name.slice(path.length + 1).includes('/')) });
  }
  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const screening = screenDemandResults([{ keyword: 'unknown', avgMonthlySearches: null, competitionIndex: null }], { maxCompetitionIndex: 60 });
  assert.equal(screening.results[0].competitionIndex, null);
  assert.equal(screening.results[0].passed, false, 'unknown advertising competition must not become zero');

  const { default: mcp } = await import('../api/mcp.js');
  const call = async (name: string, args: object) => {
    const response = await mcp.request('/mcp', { method: 'POST', headers: { authorization: 'Bearer test-only-token', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    const result = (await response.json() as any).result;
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const pipeline = await call('keyword_research_pipeline', { keywords: ['high demand', observed.keyword], criteria: { minVolume: 100 }, maxSerpChecks: 2, observedCandidates: [observed] });
  assert.deepEqual(pipeline.selectedForSerp, [observed.keyword, 'high demand']);
  assert.equal(pipeline.selection[0].selectionBasis, 'observation');
  assert.equal(pipeline.selection[0].screenScore, null);
  assert.equal(pipeline.demand.results[1].avgMonthlySearches, null);
  assert.equal(serpCalls, 2, 'observation reserve must remain inside the total SERP cap');
  await assert.rejects(keywordResearchPipeline({ keywords: ['high demand'], observedCandidates: [observed] }), /must be included/);

  const gap = await call('search_gap_research', { query: observed.keyword, question: discovery.question, maxPages: 3, maxCharsPerPage: 1000, evidenceUrls: [sourceUrl] });
  assert.equal(serpCalls, 2, 'recent SERP must be reused');
  assert.equal(gap.pages[0].status, 'read');
  assert.equal(gap.pages[0].truncated, true);
  assert.equal(gap.pages[0].text.length, 1000);
  assert.equal(gap.pages[1].status, 'unavailable');
  assert.equal(gap.pages[2].status, 'unavailable');
  assert.equal(pageReads.length, 3, 'private URL must be rejected before the fetch');
  assert.equal(gap.observations[0].status, 'read');
  const cache = [...docs.values()].find(doc => doc.name.includes('/serpCache/') && value(doc.fields.query) === observed.keyword)!;
  cache.fields.fetchedAt = field(new Date(Date.now() - 48 * 3600000).toISOString());
  await call('search_gap_research', { query: observed.keyword, question: discovery.question, maxPages: 1 });
  assert.equal(serpCalls, 3, 'final body investigation must reject a two-day-old cache by default');

  adsUnavailable = true;
  const fallback = await keywordResearchPipeline({ keywords: [observed.keyword], observedCandidates: [observed], maxSerpChecks: 1 }, async () => { throw new Error('test demand outage'); });
  assert.equal(fallback.demand.provider, 'unavailable');
  assert.equal(fallback.selection[0].selectionBasis, 'observation');
  await assert.rejects(keywordResearchPipeline({ keywords: ['high demand'] }, async () => { throw new Error('test demand outage'); }), /test demand outage/);

  const session = await researchSessionCreate({ id: 'seo-discovery-site-a', title: 'Site A opportunities', objective: 'Discover unmet questions' });
  const added = await themeCandidateUpsert({ sessionId: session.id, expectedRevision: 1, candidateId: 'paper-conditions', title: 'Paper condition question', thesis: 'Investigate documented conditions', discovery });
  const ctx = await themeResearchContext({ sessionId: session.id });
  assert.equal(ctx.themeLedgerVersion, 2);
  assert.deepEqual(ctx.candidates[0].discovery?.nextQueries, discovery.nextQueries);
  await assert.rejects(themeCandidateUpsert({ sessionId: session.id, expectedRevision: added.revision, candidateId: 'unsupported', title: 'Unsupported', thesis: 'A guess', status: 'pilot_ready' }), /requires discovery evidence/);
  const promoted = await themeCandidateChallenge({ sessionId: session.id, expectedRevision: added.revision, candidateId: added.candidate.id, attack: 'Can public documents support it?', conclusion: 'A small sourced comparison can be tested, with absence uncertainty retained.', statusAfter: 'pilot_ready', discovery, nextChallenge: 'Check source completeness before production.' });
  assert.deepEqual(promoted.challenge.discovery, discovery);
  await assert.rejects(themeCandidateUpsert({ sessionId: session.id, expectedRevision: 1, candidateId: added.candidate.id, thesis: 'Stale edit' }), /Revision conflict/);

  docs.set(`${root}sites/site-a`, { name: `${root}sites/site-a`, fields: { id: field('site-a'), status: field('active'), repository: field('nomuonji/site-a') } });
  const taskInput = { siteId: 'site-a', repo: 'nomuonji/site-a', targetUrls: ['https://example.com/conditions'], taskType: 'revise', title: 'Add documented conditions', rationale: 'Bounded, sourced comparison with explicit unknowns.', evidence: ['Current HEAD and source excerpts support a scoped addition.'], dedupeKey: 'conditions', research: { sessionId: session.id, candidateId: added.candidate.id, candidateRevision: promoted.candidate.revision } };
  await assert.rejects(seoTaskCreate({ ...taskInput, research: { ...taskInput.research, candidateRevision: 1 } }), /revision changed/);
  const task = await seoTaskCreate(taskInput);
  assert.deepEqual(task.research?.discovery, discovery);
  const revised = await themeCandidateUpsert({ sessionId: session.id, expectedRevision: promoted.revision, candidateId: added.candidate.id, discovery: { ...discovery, deliverable: 'A different later idea' } });
  assert.equal(revised.candidate.revision, promoted.candidate.revision + 1);
  assert.equal((await seoTaskGet({ id: task.id })).research?.discovery.deliverable, discovery.deliverable, 'later research edits must not rewrite task justification');
  const { default: humanFeed } = await import('../api/theme-research.js');
  const sessions = await (await humanFeed.request('/api/theme-research?resource=sessions')).json() as any;
  assert.equal(sessions.items[0].id, session.id);
  const uiContext = await (await humanFeed.request(`/api/theme-research?sessionId=${session.id}`)).json() as any;
  assert.equal(uiContext.candidates[0].discovery.deliverable, 'A different later idea');
  console.log('search discovery smoke passed: real MCP selection, bounded quota, unknown demand/outage, page-body truncation/failure/private-fetch protection, fresh cache, audited ledger/revisions, immutable task evidence and UI feed');
} finally {
  globalThis.fetch = originalFetch;
}
