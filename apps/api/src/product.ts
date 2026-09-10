import { maintenanceCommands } from '@keywords/commands/maintenance';
import { portfolioCommands } from '@keywords/commands/portfolio';
import { reviewCommands } from '@keywords/commands/review';

export function registerProductRoutes(app: any, ctx: (c: any) => any, body: (c: any) => Promise<any>) {
  app.get('/articles', async (c: any) => c.json(await portfolioCommands.articleIndex({
    query: c.req.query('q'),
    projectId: c.req.query('projectId'),
    status: c.req.query('status'),
    limit: Number(c.req.query('limit') ?? 50),
    offset: Number(c.req.query('offset') ?? 0)
  })));
  app.get('/articles/:articleId/content', async (c: any) => c.json(await portfolioCommands.articleContent(c.req.param('articleId'))));
  app.post('/articles/:articleId/delete', async (c: any) => c.json(await portfolioCommands.deleteArticle(ctx(c), { ...(await body(c)), articleId: c.req.param('articleId') })));
  app.post('/articles/:articleId/reject', async (c: any) => c.json(await portfolioCommands.deleteArticle(ctx(c), { ...(await body(c)), articleId: c.req.param('articleId') })));
  app.get('/projects/:projectId/reviews', async (c: any) => c.json(await reviewCommands.list(ctx(c), { projectId: c.req.param('projectId'), status: c.req.query('status') ?? 'open', limit: Number(c.req.query('limit') ?? 50) })));
  app.post('/projects/:projectId/reviews/:reviewId/resolve', async (c: any) => c.json(await reviewCommands.resolve(ctx(c), { ...(await body(c)), projectId: c.req.param('projectId'), reviewId: c.req.param('reviewId') })));
  app.get('/maintenance/diagnostics', async (c: any) => c.json(await maintenanceCommands.diagnostics(ctx(c))));
  app.post('/maintenance/backup', async (c: any) => c.json(await maintenanceCommands.backup(ctx(c), await body(c))));
}
