import { discoveryCommands } from '@keywords/commands/discovery';
import { workspaceCommands } from '@keywords/commands/workspace';
import { maintenanceCommands } from '@keywords/commands/maintenance';

export function registerProductRoutes(app: any, ctx: (c: any) => any, body: (c: any) => Promise<any>) {
  app.get('/projects/:projectId/brief', async (c: any) => c.json(await workspaceCommands.brief(ctx(c), c.req.param('projectId'))));
  app.patch('/projects/:projectId/brief', async (c: any) => c.json(await workspaceCommands.updateBrief(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') })));
  app.get('/projects/:projectId/capabilities', async (c: any) => c.json(await workspaceCommands.capabilities(ctx(c), c.req.param('projectId'))));
  app.get('/projects/:projectId/keywords/search', async (c: any) => c.json(await workspaceCommands.keywordSearch(ctx(c), {
    projectId: c.req.param('projectId'), q: c.req.query('q'), candidateStatus: c.req.query('candidateStatus'), clusterId: c.req.query('clusterId'),
    limit: Number(c.req.query('limit') ?? 50), offset: Number(c.req.query('offset') ?? 0)
  })));
  app.get('/projects/:projectId/evidence/:targetType/:targetId', async (c: any) => c.json(await workspaceCommands.evidence(ctx(c), { projectId: c.req.param('projectId'), targetType: c.req.param('targetType'), targetId: c.req.param('targetId') })));
  app.get('/projects/:projectId/continuous-discovery', async (c: any) => c.json(await workspaceCommands.continuousSummary(ctx(c), c.req.param('projectId'))));

  app.get('/projects/:projectId/discovery-jobs', async (c: any) => c.json(await discoveryCommands.list(ctx(c), c.req.param('projectId'), Number(c.req.query('limit') ?? 30))));
  app.post('/projects/:projectId/discovery-jobs', async (c: any) => c.json(await discoveryCommands.start(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId') }), 201));
  app.get('/projects/:projectId/discovery-jobs/:jobId', async (c: any) => c.json(await discoveryCommands.detail(ctx(c), { projectId: c.req.param('projectId'), jobId: c.req.param('jobId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/claim', async (c: any) => c.json(await discoveryCommands.claim(ctx(c), { projectId: c.req.param('projectId'), jobId: c.req.param('jobId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/candidates/import', async (c: any) => c.json(await discoveryCommands.importCandidates(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/ads-ideas', async (c: any) => c.json(await discoveryCommands.adsIdeas(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/candidates/:candidateId/serp', async (c: any) => c.json(await discoveryCommands.serp(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId'), candidateId: c.req.param('candidateId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/candidates/:candidateId/web-evidence', async (c: any) => c.json(await discoveryCommands.webEvidence(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId'), candidateId: c.req.param('candidateId') })));
  app.patch('/projects/:projectId/discovery-jobs/:jobId/candidates/:candidateId', async (c: any) => c.json(await discoveryCommands.annotate(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId'), candidateId: c.req.param('candidateId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/finish-research', async (c: any) => c.json(await discoveryCommands.finishResearch(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/candidates/:candidateId/review', async (c: any) => c.json(await discoveryCommands.reviewCandidate(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId'), candidateId: c.req.param('candidateId') })));
  app.post('/projects/:projectId/discovery-jobs/:jobId/cancel', async (c: any) => c.json(await discoveryCommands.cancel(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), jobId: c.req.param('jobId') })));

  app.get('/maintenance/diagnostics', async (c: any) => c.json(await maintenanceCommands.diagnostics(ctx(c))));
  app.post('/maintenance/backup', async (c: any) => c.json(await maintenanceCommands.backup(ctx(c), await body(c))));
}
