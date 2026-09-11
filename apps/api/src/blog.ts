import { blogCommands } from '@keywords/commands/blog';
import { discoveryCommands } from '@keywords/commands/discovery';
export function registerBlogRoutes(app:any,ctx:(c:any)=>any,body:(c:any)=>Promise<any>) {
 app.post('/projects/:projectId/discovery-jobs/:jobId/observe',async(c:any)=>c.json(await discoveryCommands.observe(ctx(c),{...(await body(c)),projectId:c.req.param('projectId'),jobId:c.req.param('jobId')})));
 app.get('/projects/:projectId/blog',async(c:any)=>c.json(await blogCommands.context(ctx(c),{projectId:c.req.param('projectId')})));
 for(const operation of ['contract','importContext','prepare','export','get','receipt','verifyPublished','capture','evaluate'] as const)
  app.post(`/projects/:projectId/blog/${operation}`,async(c:any)=>c.json(await (blogCommands[operation] as any)(ctx(c),{...(await body(c)),projectId:c.req.param('projectId')})));
 app.post('/projects/:projectId/discovery-jobs/:jobId/expand',async(c:any)=>c.json(await discoveryCommands.expand(ctx(c),{...(await body(c)),projectId:c.req.param('projectId'),jobId:c.req.param('jobId')})));
 app.get('/projects/:projectId/discovery-jobs/:jobId/observations',async(c:any)=>c.json(await discoveryCommands.observations(ctx(c),{projectId:c.req.param('projectId'),jobId:c.req.param('jobId')})));
}
