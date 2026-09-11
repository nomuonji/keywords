import { Hono } from 'hono';
import { treasuryList } from '../packages/keyword-treasury/src/index.js';

// This is intentionally the only public browser endpoint. It is read-only;
// all research and Firestore mutations remain behind the authenticated MCP.
const app = new Hono();
app.get('/api/treasury', async c => {
  const items = await treasuryList({
    status: c.req.query('status'),
    query: c.req.query('query'),
    limit: Number(c.req.query('limit') ?? 100)
  });
  return c.json(items, 200, { 'cache-control': 'no-store' });
});
export default app;
