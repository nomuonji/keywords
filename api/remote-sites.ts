import { Hono } from 'hono';
import { siteRegistryList, siteArticleList } from '../packages/commands/src/remote-site-operations.js';
import { seoPlanningDigestList } from '../packages/commands/src/seo-planning-digest.js';
import { siteIndexationHistory } from '../packages/commands/src/site-indexation.js';

// Public read-only browser endpoint for agent-managed Sites Operator sites.
// Keep this view cheap: one registry read + one compact planning-digest list.
// Full analytics detail stays behind the authenticated MCP and no per-site N+1
// Firestore reads are performed here.
const app = new Hono();

// Consolidated read-only route to stay within Vercel Hobby's function limit.
// The public /api/remote-articles URL is preserved by vercel.json rewrite;
// handle both the original path and the rewritten request shape.
const articleListHandler = async (c: any) => {
  const siteId = c.req.query('siteId') ?? '';
  if (!siteId) return c.json({ error: 'siteId is required' }, 400);
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 50), 100));
  const items = await siteArticleList({ siteId, status: c.req.query('status') || undefined, limit });
  return c.json({ siteId, items: items.items }, 200, { 'cache-control': 'no-store' });
};
app.get('/api/remote-articles', articleListHandler);
app.get('/api/remote-sites', async c => {
  if (c.req.query('__view') === 'articles') return articleListHandler(c);
  if (c.req.query('__view') === 'indexation') {
    const siteId = c.req.query('siteId') ?? '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(siteId)) return c.json({ error: 'Valid siteId is required' }, 400);
    const history = await siteIndexationHistory({ siteId, weeks: 16 });
    return c.json(history, 200, { 'cache-control': 'no-store' });
  }
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 50), 100));
  const registry = await siteRegistryList({ limit });
  let planning: { items: Array<Record<string, unknown>> } = { items: [] };
  try {
    planning = await seoPlanningDigestList({ limit }) as { items: Array<Record<string, unknown>> };
  } catch (error: any) {
    if (Number(error?.status) !== 404) throw error;
  }
  const digestBySite = new Map(planning.items.map(item => [String(item.siteId), item]));
  const sites = (registry.items as Array<Record<string, unknown>>).map(site => ({
    id: site.id,
    name: site.name,
    repository: site.repository,
    productionUrl: site.productionUrl,
    deploymentProvider: site.deploymentProvider,
    status: site.status,
    ga4PropertyId: site.ga4PropertyId ?? null,
    searchConsoleProperty: site.searchConsoleProperty ?? null,
    localProjectId: site.localProjectId ?? null,
    planningDigest: digestBySite.get(String(site.id)) ?? null
  }));
  return c.json({
    generatedAt: new Date().toISOString(),
    semantics: {
      scope: 'Sites Operator registry = agent-managed production sites',
      siteMonitor: 'Human-only portfolio dashboard; not an agent planning source',
      analytics: 'Planning digests are externally refreshed; this endpoint never calls Google'
    },
    sites
  }, 200, { 'cache-control': 'no-store' });
});
export default app;
