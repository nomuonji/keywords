import { Hono } from 'hono';
import { seoSourcePoolContext } from '../packages/commands/src/seo-source-pool.js';

const app = new Hono();

app.get('/api/seo-source-pool', async c => {
  try {
    const result = await seoSourcePoolContext({
      sourceType: c.req.query('sourceType') || undefined,
      topic: c.req.query('topic') || undefined,
      includePaused: c.req.query('includePaused') === 'true',
      includeArchived: c.req.query('includeArchived') === 'true',
      staleAfterDays: c.req.query('staleAfterDays') ? Number(c.req.query('staleAfterDays')) : undefined,
      scanLimitPerSource: c.req.query('scanLimitPerSource') ? Number(c.req.query('scanLimitPerSource')) : undefined
    });
    return c.json(result, 200, { 'cache-control': 'no-store' });
  } catch {
    return c.json({ error: 'SEO情報源プールを取得できませんでした。' }, 503);
  }
});

export default app;
