import { Hono } from 'hono';
import { themeResearchContext } from '../packages/commands/src/theme-research.js';

const app = new Hono();

app.get('/api/theme-research', async c => {
  try {
    const result = await themeResearchContext({
      sessionId: c.req.query('sessionId') || undefined,
      includeKilled: c.req.query('includeKilled') !== 'false'
    });
    return c.json(result, 200, { 'cache-control': 'no-store' });
  } catch {
    return c.json({ error: 'テーマリサーチを取得できませんでした。Firestoreの接続設定を確認してください。' }, 503);
  }
});

export default app;
