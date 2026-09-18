import { Hono } from 'hono';
import { readSiteDigest, siteRegistryList } from '../packages/commands/src/remote-site-operations.js';

// Public read-only browser endpoint for the remote Sites overview.
// Returns the site registry with each site's projection digest (bounded:
// one list plus one digest read per site). Full snapshot/event history,
// credentials, and all mutations stay behind the authenticated Sites MCP.
// Article bodies remain in Git and are never returned here.
const app = new Hono();
app.get('/api/remote-sites', async c => {
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 50), 100));
  const registry = await siteRegistryList({ limit });
  const sites = [];
  for (const site of registry.items as Array<Record<string, unknown>>) {
    let digest: unknown = null;
    try {
      digest = await readSiteDigest(String(site.id));
    } catch {
      digest = null;
    }
    sites.push({
      id: site.id,
      name: site.name,
      repository: site.repository,
      productionUrl: site.productionUrl,
      deploymentProvider: site.deploymentProvider,
      status: site.status,
      ga4PropertyId: site.ga4PropertyId ?? null,
      searchConsoleProperty: site.searchConsoleProperty ?? null,
      localProjectId: site.localProjectId ?? null,
      digest
    });
  }
  return c.json({ generatedAt: new Date().toISOString(), sites }, 200, { 'cache-control': 'no-store' });
});
export default app;
