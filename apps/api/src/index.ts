import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { commands } from '@keywords/commands';
import { planningCommands } from '@keywords/commands/planning';
import { policyCommands } from '@keywords/commands/policy';
import { workCommands } from '@keywords/commands/work';
import { reviewCommands } from '@keywords/commands/review';
import { siteCommands } from '@keywords/commands/site';
import { metricsCommands } from '@keywords/commands/metrics';
import { operatorCommands } from '@keywords/commands/operator';

const app = new Hono();
app.use('*', cors());
app.get('/health', c => c.json({ ok: true }));
const ctx = (c: any) => ({
  actor: (c.req.header('x-keywords-actor') === 'agent' ? 'agent' : 'human') as 'human' | 'agent',
  actorId: c.req.header('x-keywords-actor-id'),
  workSessionId: c.req.header('x-keywords-work-session-id')
});
const body = (c: any) => c.req.json();

app.get('/projects', async c => c.json(await commands.project.list(ctx(c))));
app.post('/projects', async c => c.json(await commands.project.create(ctx(c), await body(c)), 201));
app.get('/projects/:projectId/snapshot', async c => c.json(await commands.project.snapshot(ctx(c), c.req.param('projectId'))));

app.get('/projects/:projectId/operator', async c => c.json(await operatorCommands.inspect(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/operator/tick', async c => c.json(await operatorCommands.tick(ctx(c), c.req.param('projectId'))));
app.get('/projects/:projectId/site', async c => c.json(await siteCommands.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/site/sync', async c => c.json(await siteCommands.syncSitemap(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));
app.get('/projects/:projectId/metrics/context', async c => c.json(await metricsCommands.context(ctx(c), c.req.param('projectId'), Number(c.req.query('limit') ?? 25))));
app.post('/projects/:projectId/metrics/capture', async c => c.json(await metricsCommands.capture(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));

app.get('/projects/:projectId/work/context', async c => {
  const projectId = c.req.param('projectId');
  const context = await workCommands.context(ctx(c), { projectId, sessionId: c.req.query('sessionId') });
  const sessionId = context.session?.id;
  const reviewRequests = await reviewCommands.list(ctx(c), { projectId, sessionId, status: 'open', limit: 20 });
  return c.json({ ...context, reviewRequests });
});
app.get('/projects/:projectId/work/sessions', async c => c.json(await workCommands.list(ctx(c), c.req.param('projectId'), Number(c.req.query('limit') ?? 20))));
app.post('/projects/:projectId/work/sessions', async c => c.json(await workCommands.start(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/work/sessions/:sessionId/resume', async c => c.json(await workCommands.resume(ctx(c), { projectId: c.req.param('projectId'), sessionId: c.req.param('sessionId') })));
app.post('/projects/:projectId/work/sessions/:sessionId/checkpoint', async c => c.json(await workCommands.checkpoint(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), sessionId: c.req.param('sessionId') })));
app.post('/projects/:projectId/work/sessions/:sessionId/complete', async c => c.json(await workCommands.complete(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), sessionId: c.req.param('sessionId') })));
app.post('/projects/:projectId/work/sessions/:sessionId/cancel', async c => c.json(await workCommands.cancel(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), sessionId: c.req.param('sessionId') })));
app.get('/projects/:projectId/review-requests', async c => c.json(await reviewCommands.list(ctx(c), { projectId: c.req.param('projectId'), status: c.req.query('status'), sessionId: c.req.query('sessionId'), limit: Number(c.req.query('limit') ?? 50) })));
app.post('/projects/:projectId/review-requests', async c => c.json(await reviewCommands.request(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/review-requests/:reviewId/resolve', async c => c.json(await reviewCommands.resolve(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), reviewId: c.req.param('reviewId') })));

app.get('/projects/:projectId/policies/context', async c => c.json(await policyCommands.context(ctx(c), c.req.param('projectId'), Number(c.req.query('decisions') ?? 30))));
app.get('/projects/:projectId/policies', async c => c.json(await policyCommands.list(ctx(c), c.req.param('projectId'), c.req.query('status'))));
app.post('/projects/:projectId/policies', async c => c.json(await policyCommands.propose(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/policies/:policyId/review', async c => c.json(await policyCommands.review(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), policyId: c.req.param('policyId') })));
app.post('/projects/:projectId/policies/:policyId/retire', async c => c.json(await policyCommands.retire(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), policyId: c.req.param('policyId') })));
app.get('/projects/:projectId/research/context', async c => c.json(await commands.research.context(ctx(c), c.req.param('projectId'))));
app.get('/projects/:projectId/research/opportunities', async c => c.json(await commands.research.opportunities(ctx(c), c.req.param('projectId'), Number(c.req.query('limit') ?? 25))));
app.get('/projects/:projectId/sources', async c => c.json(await commands.source.list(ctx(c), c.req.param('projectId'), c.req.query('type'))));
app.post('/projects/:projectId/sources', async c => c.json(await commands.source.record(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/research/web', async c => c.json(await commands.research.webFetch(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/research/serp', async c => c.json(await commands.research.serp(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/research/google-ads/keyword-ideas', async c => c.json(await commands.research.googleAdsKeywordIdeas(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/research/search-console', async c => c.json(await commands.research.searchConsole(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.get('/projects/:projectId/topics', async c => c.json(await commands.topic.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/topics', async c => c.json(await commands.topic.create(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.get('/projects/:projectId/keywords', async c => c.json(await commands.keyword.list(ctx(c), c.req.param('projectId'), c.req.query('status'))));
app.post('/projects/:projectId/keywords', async c => c.json(await commands.keyword.create(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/keywords/:keywordId/reject', async c => c.json(await commands.keyword.reject(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), keywordId: c.req.param('keywordId') })));
app.get('/projects/:projectId/clusters', async c => c.json(await commands.cluster.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/clusters', async c => c.json(await commands.cluster.create(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/projects/:projectId/clusters/:clusterId/keywords/:keywordId', async c => c.json(await commands.cluster.addKeyword(ctx(c), { projectId: c.req.param('projectId'), clusterId: c.req.param('clusterId'), keywordId: c.req.param('keywordId') })));
app.post('/projects/:projectId/clusters/:clusterId/keywords', async c => c.json(await planningCommands.clusterBulkAssign(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), clusterId: c.req.param('clusterId') })));
app.post('/projects/:projectId/clusters/:clusterId/merge', async c => c.json(await commands.cluster.merge(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), targetClusterId: c.req.param('clusterId') })));
app.get('/projects/:projectId/pages', async c => c.json(await commands.page.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/pages/plan', async c => c.json(await planningCommands.pagePlan(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.get('/projects/:projectId/pages/cannibalization', async c => c.json(await planningCommands.pageCannibalization(ctx(c), { projectId: c.req.param('projectId'), limit: Number(c.req.query('limit') ?? 50) })));
app.get('/projects/:projectId/pages/:pageId/targets', async c => c.json(await planningCommands.pageTargets(ctx(c), { projectId: c.req.param('projectId'), pageId: c.req.param('pageId') })));
app.post('/projects/:projectId/pages/:pageId/review', async c => c.json(await planningCommands.pageReview(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), pageId: c.req.param('pageId') })));
app.get('/projects/:projectId/insights', async c => c.json(await commands.insight.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/insights', async c => c.json(await commands.insight.create(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.get('/projects/:projectId/tasks', async c => c.json(await commands.task.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/tasks', async c => c.json(await commands.task.create(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.patch('/projects/:projectId/tasks/:taskId/status', async c => c.json(await commands.task.setStatus(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), taskId: c.req.param('taskId') })));
app.get('/projects/:projectId/decisions', async c => c.json(await commands.decision.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/decisions', async c => c.json(await commands.decision.record(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.get('/projects/:projectId/runs', async c => c.json(await commands.run.list(ctx(c), c.req.param('projectId'))));
app.onError((error, c) => c.json({ error: error instanceof Error ? error.message : String(error) }, 500));

const schedulerCtx = { actor: 'system' as const, actorId: 'operator-scheduler' };
async function scheduledTick() {
  const projects = await commands.project.list(schedulerCtx);
  for (const project of projects) {
    try { await operatorCommands.tick(schedulerCtx, project.id); }
    catch (error) { console.error(`Operator tick failed for ${project.id}:`, error); }
  }
}
const intervalMinutes = Math.max(0, Number(process.env.KEYWORDS_OPERATOR_INTERVAL_MINUTES ?? 0));
if (intervalMinutes > 0) {
  setInterval(() => void scheduledTick(), intervalMinutes * 60_000).unref();
  if (process.env.KEYWORDS_OPERATOR_RUN_ON_START === '1') void scheduledTick();
  console.log(`Keywords operator scheduler enabled every ${intervalMinutes} minutes`);
}

const port = Number(process.env.KEYWORDS_API_PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`Keywords API listening on http://localhost:${port}`);
