import { Hono } from 'hono';
import { siteStructureGet, siteStructureList } from '../packages/commands/src/site-structure.js';

// Browser access is read-only, matching the existing public keyword treasury.
const app = new Hono();
app.get('/api/site-structures', async c => {
  try {
    const id = c.req.query('id');
    const result = id ? await siteStructureGet({ id }) : await siteStructureList({ limit: Number(c.req.query('limit') ?? 50), pageToken: c.req.query('pageToken') });
    return c.json(result, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Site structure not found') return c.json({ error: message }, 404);
    if (error instanceof Error && error.name === 'ZodError') return c.json({ error: 'Invalid site structure query' }, 400);
    return c.json({ error: 'サイト構想を取得できませんでした。Firestoreの接続設定を確認してください。' }, 503);
  }
});
export default app;
