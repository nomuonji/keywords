import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  metricSnapshotSave,
  optimizationEventCreate,
  siteArticleSave,
  siteRegistrySave
} from '../packages/commands/src/remote-site-operations.js';
import {
  localOptimizationEvaluationContext,
  localOptimizationRecordResult,
  nextSiteOptimizationEvaluation,
  optimizationEvaluationContext,
  siteQueryOpportunities
} from '../packages/commands/src/site-operations-analysis.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.KEYWORDS_REMOTE_MCP_TOKEN = 'test-only-token';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
const originalFetch = globalThis.fetch;
const decodeField = (value: any): any => value?.stringValue ?? value?.integerValue ?? value?.doubleValue ?? value?.booleanValue ?? null;

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
  await siteRegistrySave({
    id: 'site-a', expectedRevision: 0, localProjectId: 'project-a', name: 'Site A', repository: 'nomuonji/site-a',
    productionUrl: 'https://example.com', deploymentProvider: 'vercel', searchConsoleProperty: 'sc-domain:example.com', status: 'active'
  });
  await siteArticleSave({
    id: 'article-a', expectedRevision: 0, siteId: 'site-a', localPageId: 'page-a', canonicalUrl: 'https://example.com/article-a',
    repo: 'nomuonji/site-a', repoPath: 'content/article-a.mdx', currentCommitSha: 'a'.repeat(40), slug: 'article-a', title: 'Article A', status: 'published'
  });

  await metricSnapshotSave({
    siteId: 'site-a', articleId: 'article-a', provider: 'gsc', periodStart: '2026-07-01', periodEnd: '2026-07-07',
    metrics: { clicks: 10, impressions: 300, ctr: 10 / 300, averagePosition: 11 }, sourceVersion: 'article-baseline', capturedAt: '2026-07-08T00:00:00.000Z'
  });
  await metricSnapshotSave({
    siteId: 'site-a', articleId: 'article-a', provider: 'gsc', periodStart: '2026-07-22', periodEnd: '2026-07-28',
    metrics: { clicks: 18, impressions: 360, ctr: 0.05, averagePosition: 8.5 }, sourceVersion: 'article-post', capturedAt: '2026-07-29T00:00:00.000Z'
  });

  const createdEvent = await optimizationEventCreate({
    id: 'opt-eval', siteId: 'site-a', articleId: 'article-a', observation: 'The page ranked around position 11 with stable impressions.',
    diagnosis: 'A missing comparison section may be limiting relevance.', hypothesis: 'Adding that one comparison section should improve ranking while preserving intent.',
    actionType: 'content_expand', baselinePeriod: { start: '2026-07-01', end: '2026-07-07' }, beforeCommit: 'a'.repeat(40), afterCommit: 'b'.repeat(40),
    changedAt: '2026-07-08T12:00:00.000Z', evaluateAfter: '2026-07-22T12:00:00.000Z', phase: 'implemented'
  });

  const evaluation = await optimizationEvaluationContext({ siteId: 'site-a', eventId: 'opt-eval' });
  assert.equal(evaluation.matured, true);
  assert.equal(evaluation.readyForAgentEvaluation, true);
  assert.equal(evaluation.baseline?.sourceVersion, 'article-baseline');
  assert.equal(evaluation.post?.sourceVersion, 'article-post');
  assert.equal(evaluation.deltas.clicks.absolute, 8);
  assert.equal(evaluation.deltas.impressions.absolute, 60);
  assert.ok(Math.abs((evaluation.deltas.averagePosition.absolute ?? 0) - (-2.5)) < 1e-9);
  assert.equal(evaluation.policy.automaticVerdict, false);
  assert.match(evaluation.nextAction, /optimization_event_update/);

  const localEvaluation = await localOptimizationEvaluationContext({ projectId: 'project-a', eventId: 'opt-eval' });
  assert.equal(localEvaluation.siteId, 'site-a');
  assert.equal(localEvaluation.readyForAgentEvaluation, true);
  const dueBefore = await nextSiteOptimizationEvaluation('project-a');
  assert.equal(dueBefore.status, 'ready');
  assert.equal(dueBefore.status === 'ready' ? dueBefore.event.id : null, 'opt-eval');

  await assert.rejects(localOptimizationRecordResult({
    projectId: 'project-a', eventId: 'opt-eval', expectedRevision: createdEvent.revision, result: 'improved',
    notes: 'Position and clicks moved in the direction stated by the hypothesis.',
    evaluationMetrics: { clicksDelta: 999 }
  } as any));

  await metricSnapshotSave({
    siteId: 'site-a', provider: 'gsc', periodStart: '2026-08-01', periodEnd: '2026-08-07',
    metrics: { clicks: 30, impressions: 1000, ctr: 0.03, averagePosition: 12 },
    queries: [
      { query: 'stable query', clicks: 10, impressions: 400, ctr: 0.025, averagePosition: 9 },
      { query: 'rising query', clicks: 3, impressions: 100, ctr: 0.03, averagePosition: 18 }
    ],
    sourceVersion: 'site-prev', capturedAt: '2026-08-08T00:00:00.000Z'
  });
  await metricSnapshotSave({
    siteId: 'site-a', provider: 'gsc', periodStart: '2026-08-08', periodEnd: '2026-08-14',
    metrics: { clicks: 42, impressions: 1300, ctr: 42 / 1300, averagePosition: 10.8 },
    queries: [
      { query: 'stable query', clicks: 11, impressions: 420, ctr: 11 / 420, averagePosition: 8.8 },
      { query: 'rising query', clicks: 8, impressions: 220, ctr: 8 / 220, averagePosition: 13 },
      { query: 'brand new query', clicks: 4, impressions: 90, ctr: 4 / 90, averagePosition: 16 }
    ],
    sourceVersion: 'site-current', capturedAt: '2026-08-15T00:00:00.000Z'
  });

  const opportunities = await siteQueryOpportunities({ siteId: 'site-a', minImpressions: 50, minGrowthRatio: 1.5, limit: 10 });
  assert.equal(opportunities.comparable, true);
  assert.equal(opportunities.periodDays, 7);
  assert.equal(opportunities.queryCoverage, 'bounded_saved_top_queries');
  assert.deepEqual(opportunities.candidates.map((item: any) => item.query).sort(), ['brand new query', 'rising query']);
  const newlyObserved = opportunities.candidates.find((item: any) => item.query === 'brand new query') as any;
  assert.equal(newlyObserved.kind, 'newly_observed_query');
  assert.match(newlyObserved.observationCaveat, /not proof/);
  assert.equal((opportunities.candidates.find((item: any) => item.query === 'rising query') as any).kind, 'rising_query');
  assert.match(String(opportunities.nextAction), /keyword_screen_batch/);
  assert.match(String(opportunities.nextAction), /keyword_research_pipeline/);

  const recorded = await localOptimizationRecordResult({
    projectId: 'project-a', eventId: 'opt-eval', expectedRevision: createdEvent.revision, result: 'improved',
    notes: 'The persisted hypothesis expected stronger ranking while preserving intent; compatible GSC evidence moved in that direction.'
  });
  assert.equal(recorded.phase, 'evaluated');
  assert.equal(recorded.result, 'improved');
  assert.equal(recorded.evaluationMetrics.clicksDelta, 8);
  assert.equal(recorded.evaluationMetrics.impressionsDelta, 60);
  assert.ok(Math.abs((recorded.evaluationMetrics.averagePositionDelta ?? 0) - (-2.5)) < 1e-9);
  assert.match(recorded.notes, /baseline=.*article-baseline|baseline=/);

  const dueAfter = await nextSiteOptimizationEvaluation('project-a');
  assert.equal(dueAfter.status, 'none_due');

  console.log('site operations analysis smoke passed: compatible evaluation, runner mapping, server-derived metrics, no duplicate due work, and quota-safe bounded GSC query feedback');
} finally {
  globalThis.fetch = originalFetch;
}
