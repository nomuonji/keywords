import { Hono } from 'hono';
import { siteArticleList } from '../packages/commands/src/remote-site-operations.js';

// Public read-only browser endpoint for the remote articles view.
// Lists article registry records (metadata only) for one site, newest first.
// Bodies remain in Git, credentials stay behind the authenticated MCP, and
// the list is bounded (default 50, max 100) so one view costs a bounded
// number of reads.
const app = new Hono();
app.get('/api/remote-articles', async c => {
  const siteId = c.req.query('siteId') ?? '';
  if (!siteId) return c.json({ error: 'siteId is required' }, 400);
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 50), 100));
  const items = await siteArticleList({ siteId, status: c.req.query('status') || undefined, limit });
  return c.json({ siteId, items: items.items }, 200, { 'cache-control': 'no-store' });
});
export default app;
