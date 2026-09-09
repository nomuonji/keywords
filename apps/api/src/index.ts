import { portfolioCommands } from '@keywords/commands/portfolio';
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
import { measurementCommands } from '@keywords/commands/measurement';
import { operationCommands } from '@keywords/commands/operation';
import { operationDiscoveryCommands } from '@keywords/commands/operation-discovery';
import { executorCommands } from '@keywords/commands/executor';
import { operatorCommands } from '@keywords/commands/operator';
import { autopilotCommands } from '@keywords/commands/autopilot';
import { registerProductRoutes } from './product.js';
import { registerBlogRoutes } from './blog.js';

const app = new Hono();
const humanToken = process.env.KEYWORDS_API_HUMAN_TOKEN?.trim();
const agentToken = process.env.KEYWORDS_API_AGENT_TOKEN?.trim();
if (humanToken && agentToken && humanToken === agentToken) throw new Error('Human and agent API tokens must be different');
const authConfigured = Boolean(humanToken || agentToken);
const host = process.env.KEYWORDS_API_HOST ?? '127.0.0.1';
const loopback = ['127.0.0.1','::1','localhost'].includes(host);
if (!loopback && !authConfigured) throw new Error('Remote API binding requires KEYWORDS_API_HUMAN_TOKEN and/or KEYWORDS_API_AGENT_TOKEN');
const allowedOrigins = (process.env.KEYWORDS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean);
app.use('*', cors({ origin: allowedOrigins, allowHeaders: ['Content-Type','Authorization','X-Keywords-Work-Session-Id'], allowMethods: ['GET','HEAD','OPTIONS','POST','PATCH','DELETE'] }));

function bearer(c: any) { const header = c.req.header('authorization') ?? ''; return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''; }
function actorContext(c: any) {
  if (!authConfigured) return { actor: 'human' as const, actorId: process.env.KEYWORDS_API_HUMAN_ID ?? 'http-local', workSessionId: c.req.header('x-keywords-work-session-id') };
  const token = bearer(c);
  if (humanToken && token === humanToken) return { actor: 'human' as const, actorId: process.env.KEYWORDS_API_HUMAN_ID ?? 'http-human', workSessionId: c.req.header('x-keywords-work-session-id') };
  if (agentToken && token === agentToken) return { actor: 'agent' as const, actorId: process.env.KEYWORDS_API_AGENT_ID ?? 'http-agent', workSessionId: c.req.header('x-keywords-work-session-id') };
  return null;
}
app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.method === 'OPTIONS') return next();
  const actor = actorContext(c); if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const isWrite = !['GET','HEAD','OPTIONS'].includes(c.req.method.toUpperCase());
  if (actor.actor === 'agent' && isWrite && !c.req.path.startsWith('/operations')) return c.json({ error: 'Agent HTTP writes must use the delegated /operations API.' }, 403);
  return next();
});

app.get('/health', c => c.json({ ok: true, mode: loopback ? 'local' : 'remote', authConfigured }));
const ctx = (c: any) => { const actor = actorContext(c); if (!actor) throw new Error('Unauthorized'); return actor; };
const body = (c: any) => c.req.json();
registerBlogRoutes(app,ctx,body);

app.get('/portfolio', async c => c.json(await portfolioCommands.context()));
app.get('/projects', async c => c.json(await commands.project.list(ctx(c))));
app.post('/projects', async c => c.json(await commands.project.create(ctx(c), await body(c)), 201));
app.get('/projects/:projectId/snapshot', async c => c.json(await commands.project.snapshot(ctx(c), c.req.param('projectId'))));

// High-level, delegated agent operations. Agent writes over HTTP are intentionally confined here.
app.get('/operations/context', async c => c.json(await operationCommands.context(ctx(c), { projectId: c.req.query('projectId'), operationId: c.req.query('operationId') })));
app.post('/operations', async c => c.json(await operationCommands.start(ctx(c), await body(c)), 201));
app.post('/operations/:operationId/resume', async c => c.json(await operationCommands.resume(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId') })));
app.post('/operations/:operationId/checkpoint', async c => c.json(await operationCommands.checkpoint(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId') })));
app.post('/operations/:operationId/complete', async c => c.json(await operationCommands.complete(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId') })));
app.post('/operations/:operationId/projects/:projectId/discovery', async c => c.json(await operationDiscoveryCommands.startAndClaim(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId'), projectId: c.req.param('projectId') }), 201));
app.post('/operations/:operationId/projects/:projectId/candidates/triage', async c => c.json(await operationCommands.triageCandidates(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId'), projectId: c.req.param('projectId') })));
app.post('/operations/:operationId/projects/:projectId/blog/handoff', async c => c.json(await operationCommands.prepareBlogHandoff(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId'), projectId: c.req.param('projectId') })));
app.post('/operations/:operationId/projects/:projectId/outcomes', async c => c.json(await operationCommands.recordOutcome(ctx(c), { ...(await body(c)), operationId: c.req.param('operationId'), projectId: c.req.param('projectId') }), 201));
app.get('/operations/outcomes', async c => c.json(await operationCommands.listOutcomes(ctx(c), { projectId: c.req.query('projectId'), status: c.req.query('status'), limit: Number(c.req.query('limit') ?? 50) })));
app.post('/operations/projects/:projectId/pause', async c => c.json(await operationCommands.setPause(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));
app.get('/operations/projects/:projectId/delegations', async c => c.json(await operationCommands.delegationList(ctx(c), c.req.param('projectId'))));
app.post('/operations/projects/:projectId/delegations', async c => c.json(await operationCommands.delegationGrant(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/operations/projects/:projectId/delegations/:delegationId/revoke', async c => c.json(await operationCommands.delegationRevoke(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), delegationId: c.req.param('delegationId') })));
app.get('/operations/executors', async c => c.json(await executorCommands.list(ctx(c))));
app.post('/operations/executors/register', async c => c.json(await operationCommands.executorRegister(ctx(c), await body(c)), 201));
app.post('/operations/executors/:executorId/heartbeat', async c => c.json(await operationCommands.executorHeartbeat(ctx(c), { ...(await body(c)), executorId: c.req.param('executorId') })));
app.post('/operations/executors/:executorId/claim', async c => c.json(await operationCommands.executorClaim(ctx(c), { ...(await body(c)), executorId: c.req.param('executorId') })));
app.post('/operations/executors/:executorId/claim-next', async c => c.json(await executorCommands.claimNext(ctx(c), { ...(await body(c)), executorId: c.req.param('executorId') })));
app.post('/operations/executors/:executorId/release', async c => c.json(await operationCommands.executorRelease(ctx(c), { ...(await body(c)), executorId: c.req.param('executorId') })));
app.post('/operations/executors/recover-stale', async c => c.json(await executorCommands.recoverStale(ctx(c), await body(c))));
app.post('/operations/events/:eventId/acknowledge', async c => c.json(await operationCommands.acknowledgeEvent(ctx(c), { eventId: c.req.param('eventId') })));
app.get('/operations/remote-readiness', async c => c.json(await operationCommands.remoteReadiness(ctx(c))));
app.get('/operations/projects/:projectId/measurements', async c => c.json(await measurementCommands.list(ctx(c), { projectId: c.req.param('projectId'), provider: c.req.query('provider'), limit: Number(c.req.query('limit') ?? 50) })));
app.post('/operations/projects/:projectId/measurements/import', async c => c.json(await measurementCommands.import(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.get('/operations/projects/:projectId/measurements/context', async c => c.json(await measurementCommands.context(ctx(c), c.req.param('projectId'), Number(c.req.query('limit') ?? 25))));
app.post('/operations/projects/:projectId/measurements/capture', async c => c.json(await metricsCommands.capture(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
app.post('/operations/projects/:projectId/site/sync', async c => c.json(await siteCommands.syncSitemap(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));

app.get('/autopilot/portfolio', async c => c.json(await autopilotCommands.portfolio()));
app.post('/autopilot/portfolio/configure', async c => c.json(await autopilotCommands.configurePortfolio(ctx(c), await body(c))));
app.get('/projects/:projectId/autopilot', async c => c.json(await autopilotCommands.status(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/autopilot/configure', async c => c.json(await autopilotCommands.configure(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));
app.post('/projects/:projectId/autopilot/tick', async c => c.json(await autopilotCommands.tick(ctx(c), c.req.param('projectId'))));
app.get('/projects/:projectId/operator', async c => c.json(await operatorCommands.inspect(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/operator/tick', async c => c.json(await operatorCommands.tick(ctx(c), c.req.param('projectId'))));
app.get('/projects/:projectId/site', async c => c.json(await siteCommands.list(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/site/sync', async c => c.json(await siteCommands.syncSitemap(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));
app.get('/projects/:projectId/metrics/context', async c => c.json(await metricsCommands.context(ctx(c), c.req.param('projectId'), Number(c.req.query('limit') ?? 25))));
app.post('/projects/:projectId/metrics/capture', async c => c.json(await metricsCommands.capture(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));

app.get('/projects/:projectId/work/context', async c => { const projectId = c.req.param('projectId'); const context = await workCommands.context(ctx(c), { projectId, sessionId: c.req.query('sessionId') }); const sessionId = context.session?.id; const reviewRequests = await reviewCommands.list(ctx(c), { projectId, sessionId, status: 'open', limit: 20 }); return c.json({ ...context, reviewRequests }); });
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

registerProductRoutes(app, ctx, body);
app.onError((error, c) => c.json({ error: error instanceof Error ? error.message : String(error) }, 500));

const schedulerCtx = { actor: 'system' as const, actorId: 'operator-scheduler' };
async function scheduledTick() { const projects = await commands.project.list(schedulerCtx); for (const project of projects) { try { await operatorCommands.tick(schedulerCtx, project.id); } catch (error) { console.error(`Operator tick failed for ${project.id}:`, error); } } }
const intervalMinutes = Math.max(0, Number(process.env.KEYWORDS_OPERATOR_INTERVAL_MINUTES ?? 0));
if (intervalMinutes > 0) { setInterval(() => void scheduledTick(), intervalMinutes * 60_000).unref(); if (process.env.KEYWORDS_OPERATOR_RUN_ON_START === '1') void scheduledTick(); console.log(`Keywords operator scheduler enabled every ${intervalMinutes} minutes`); }

const autopilotSchedulerCtx = { actor: 'system' as const, actorId: 'autopilot' };
async function scheduledAutopilotTick() { const projectIds = await autopilotCommands.enabledProjects(); for (const projectId of projectIds) { try { await autopilotCommands.tick(autopilotSchedulerCtx, projectId); } catch (error) { console.error(`Autopilot tick failed for ${projectId}:`, error); } } }
const autopilotIntervalMinutes = Math.max(1, Number(process.env.KEYWORDS_AUTOPILOT_INTERVAL_MINUTES ?? 5));
if (process.env.KEYWORDS_AUTOPILOT_SCHEDULER !== '0') { setInterval(() => void scheduledAutopilotTick(), autopilotIntervalMinutes * 60_000).unref(); if (process.env.KEYWORDS_AUTOPILOT_RUN_ON_START !== '0') void scheduledAutopilotTick(); console.log(`Keywords autopilot scheduler enabled every ${autopilotIntervalMinutes} minutes`); }

const port = Number(process.env.KEYWORDS_API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: host });
console.log(`Keywords API listening on http://${host}:${port}`);
