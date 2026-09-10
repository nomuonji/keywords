import { portfolioCommands } from '@keywords/commands/portfolio';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { commands } from '@keywords/commands';
import { siteCommands } from '@keywords/commands/site';
import { metricsCommands } from '@keywords/commands/metrics';
import { recoveryCommands } from '@keywords/commands/recovery';
import { measurementCommands } from '@keywords/commands/measurement';
import { operationCommands } from '@keywords/commands/operation';
import { operationDiscoveryCommands } from '@keywords/commands/operation-discovery';
import { executorCommands } from '@keywords/commands/executor';
import { autopilotCommands } from '@keywords/commands/autopilot';
import { registerProductRoutes } from './product.js';
import { registerBlogRoutes } from './blog.js';
import { dashboardCommands } from '@keywords/commands/dashboard';

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

// Cross-system Blog transport remains a first-class boundary.
registerBlogRoutes(app, ctx, body);

// Human-facing observability and minimal site management.
app.get('/portfolio', async c => c.json(await portfolioCommands.context()));
app.get('/dashboard', async c => c.json(await dashboardCommands.context(ctx(c))));
app.get('/projects', async c => c.json(await commands.project.list(ctx(c))));
app.post('/projects', async c => c.json(await commands.project.create(ctx(c), await body(c)), 201));
app.get('/autopilot/portfolio', async c => c.json(await autopilotCommands.portfolio()));
app.get('/projects/:projectId/autopilot', async c => c.json(await autopilotCommands.status(ctx(c), c.req.param('projectId'))));
app.post('/projects/:projectId/autopilot/configure', async c => c.json(await autopilotCommands.configure(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));
app.post('/autopilot/run-today', async c => c.json(await autopilotCommands.runToday(ctx(c), await body(c))));

// Agent execution has one public lane: Operation -> artifact -> validation -> delivery -> outcome.
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
app.get('/operations/projects/:projectId/recovery', async c => c.json(await recoveryCommands.context(ctx(c), { projectId: c.req.param('projectId') })));
app.post('/operations/projects/:projectId/recovery/capture', async c => c.json(await recoveryCommands.capture(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));

registerProductRoutes(app, ctx, body);
app.onError((error, c) => c.json({ error: error instanceof Error ? error.message : String(error) }, 500));

// Scheduling belongs to the persistent worker. The API does not own background timers.
const port = Number(process.env.KEYWORDS_API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: host });
console.log(`Keywords API listening on http://${host}:${port}`);
