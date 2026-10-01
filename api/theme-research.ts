import { Hono } from 'hono';
import { researchSessionList } from '../packages/commands/src/remote-keyword-research.js';
import { themeResearchContext } from '../packages/commands/src/theme-research.js';
import { seoSourcePoolContext } from '../packages/commands/src/seo-source-pool.js';

const app = new Hono();

app.get('/api/theme-research', async c => {
  try {
    if (c.req.query('resource') === 'sessions') {
      const result = await researchSessionList({ limit: 100 });
      return c.json({ ...result, items: result.items.filter((session: any) => session.id === 'seo-theme-research' || session.id.startsWith('seo-discovery-')) }, 200, { 'cache-control': 'no-store' });
    }
    if (c.req.query('resource') === 'seo-source-pool') {
      const result = await seoSourcePoolContext({
        sourceType: c.req.query('sourceType') || undefined,
        topic: c.req.query('topic') || undefined,
        includePaused: c.req.query('includePaused') === 'true',
        includeArchived: c.req.query('includeArchived') === 'true',
        staleAfterDays: c.req.query('staleAfterDays') ? Number(c.req.query('staleAfterDays')) : undefined,
        scanLimitPerSource: c.req.query('scanLimitPerSource') ? Number(c.req.query('scanLimitPerSource')) : undefined
      });
      return c.json(result, 200, { 'cache-control': 'no-store' });
    }

    const result = await themeResearchContext({
      sessionId: c.req.query('sessionId') || undefined,
      includeKilled: c.req.query('includeKilled') !== 'false'
    });
    return c.json(result, 200, { 'cache-control': 'no-store' });
  } catch {
    return c.json({ error: 'リサーチ情報を取得できませんでした。Firestoreの接続設定を確認してください。' }, 503);
  }
});

export default app;
