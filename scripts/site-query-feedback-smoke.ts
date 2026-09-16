import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL = 'https://keyword-proxy.test/demand';
process.env.KEYWORDS_SITE_QUERY_MIN_IMPRESSIONS = '20';
process.env.KEYWORDS_SITE_QUERY_MIN_GROWTH_RATIO = '1.5';
process.env.KEYWORDS_SITE_QUERY_FEEDBACK_LIMIT = '20';
process.env.KEYWORDS_SITE_QUERY_MAX_SERP_CHECKS = '5';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
let serpRequests = 0;
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

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  if (url === 'https://keyword-proxy.test/demand') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const results = (body.keywords ?? []).map((keyword: string) => keyword === 'rising query'
      ? { keyword, avgMonthlySearches: 500, averageCpcMicros: 1_800_000, competitionIndex: 40, competition: 'MEDIUM' }
      : { keyword, avgMonthlySearches: 10, averageCpcMicros: 300_000, competitionIndex: 20, competition: 'LOW' });
    return Response.json({ results });
  }
  if (url.includes('api.search.brave.com') || url.includes('serper.dev')) {
    serpRequests++;
    return Response.json({ error: 'SERP should not be called in this smoke' }, { status: 500 });
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

  if ((init?.method ?? 'GET') === 'PATCH') {
    const document = { name: path, fields: body.fields ?? {}, updateTime: `revision-${++sequence}` };
    docs.set(path, document);
    return Response.json(document);
  }

  if (/\/(sites|articles|metricSnapshots|optimizationEvents|keywordTreasury)$/.test(path)) {
    const collection = path.split('/').at(-1)!;
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}${collection}/`));
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const { metricSnapshotSave, siteRegistrySave } = await import('../packages/commands/src/remote-site-operations.js');
  const { nextSiteQueryFeedback } = await import('../packages/commands/src/site-query-feedback.js');
  const { keywordResearchPipeline, keywordTreasurySave } = await import('../packages/commands/src/keyword-research-pipeline.js');

  await siteRegistrySave({
    id: 'site-feedback', expectedRevision: 0, localProjectId: 'project-feedback', name: 'Feedback Site',
    repository: 'nomuonji/site-feedback', productionUrl: 'https://feedback.example.com', deploymentProvider: 'vercel', status: 'active'
  });
  await metricSnapshotSave({
    siteId: 'site-feedback', provider: 'gsc', periodStart: '2026-09-01', periodEnd: '2026-09-07',
    metrics: { clicks: 30, impressions: 1000, ctr: 0.03, averagePosition: 12 },
    queries: [
      { query: 'stable query', clicks: 10, impressions: 400, ctr: 0.025, averagePosition: 9 },
      { query: 'rising query', clicks: 3, impressions: 100, ctr: 0.03, averagePosition: 18 }
    ],
    sourceVersion: 'feedback-prev', capturedAt: '2026-09-08T00:00:00.000Z'
  });
  const current = await metricSnapshotSave({
    siteId: 'site-feedback', provider: 'gsc', periodStart: '2026-09-08', periodEnd: '2026-09-14',
    metrics: { clicks: 42, impressions: 1300, ctr: 42 / 1300, averagePosition: 10.8 },
    queries: [
      { query: 'stable query', clicks: 11, impressions: 420, ctr: 11 / 420, averagePosition: 8.8 },
      { query: 'rising query', clicks: 8, impressions: 220, ctr: 8 / 220, averagePosition: 13 },
      { query: 'new query', clicks: 4, impressions: 90, ctr: 4 / 90, averagePosition: 16 }
    ],
    sourceVersion: 'feedback-current', capturedAt: '2026-09-15T00:00:00.000Z'
  });

  const feedback = await nextSiteQueryFeedback('project-feedback');
  assert.equal(feedback.status, 'ready');
  if (feedback.status !== 'ready') throw new Error('Expected ready feedback');
  assert.equal(feedback.snapshotId, current.id);
  assert.equal(feedback.maxSerpChecks, 5);
  assert.deepEqual(feedback.candidates.map((item: any) => item.query).sort(), ['new query', 'rising query']);

  const pipeline = await keywordResearchPipeline({
    keywords: feedback.candidates.map((item: any) => item.query),
    criteria: { minVolume: 50 },
    maxSerpChecks: 0
  });
  assert.equal(pipeline.demand.providerRoute, 'proxy');
  assert.deepEqual(pipeline.screening.passedKeywords, ['rising query']);
  assert.deepEqual(pipeline.selectedForSerp, []);
  assert.equal(pipeline.serpChecks.length, 0);
  assert.equal(serpRequests, 0);

  const saved = await keywordTreasurySave({ candidates: [{
    keyword: 'rising query',
    status: 'shortlisted',
    source: 'gsc_feedback',
    avgMonthlySearches: 500,
    averageCpcMicros: 1_800_000,
    competitionIndex: 40,
    demandResearchedAt: pipeline.demand.fetchedAt,
    evidence: {
      siteId: feedback.siteId,
      snapshotId: feedback.snapshotId,
      previousSnapshotId: feedback.previousSnapshotId,
      gsc: feedback.candidates.find((item: any) => item.query === 'rising query'),
      providerRoute: pipeline.demand.providerRoute
    }
  }] });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, 'gsc_feedback');
  assert.equal(saved[0].avgMonthlySearches, 500);
  assert.equal((saved[0].evidence as any).snapshotId, feedback.snapshotId);

  console.log('site query feedback smoke passed: bounded GSC opportunities -> Ads-first screening -> zero unrequested SERP -> selected Treasury save with provenance');
} finally {
  globalThis.fetch = originalFetch;
}
