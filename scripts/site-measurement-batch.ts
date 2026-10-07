import { readFileSync } from 'node:fs';
import { getDatabase } from '../packages/db/src/index.js';
import { commands } from '../packages/commands/src/index.js';
import { operationCommands } from '../packages/commands/src/operation.js';
import { siteCommands } from '../packages/commands/src/site.js';
import { blogCommands } from '../packages/commands/src/blog.js';
import { metricsCommands } from '../packages/commands/src/metrics.js';
import { captureProjectGa4Metrics } from '../packages/commands/src/ga4-metrics.js';
import { refreshSeoPlanningDigest } from '../packages/commands/src/seo-planning-digest-refresh.js';
import { recoveryContext, recoveryDate, dateOffset } from '../packages/commands/src/recovery-context.js';
import { siteRegistryResolve } from '../packages/commands/src/remote-site-operations.js';
import { siteIndexationInventorySave, siteIndexationList } from '../packages/commands/src/site-indexation.js';

/**
 * On-demand site measurement batch. Runs anywhere the workspace code and
 * credentials are available: the local PC, an agent session, or a
 * (github-hosted or self-hosted) Actions runner. No resident daemon.
 *
 * SITE_JOBS_JSON: [{ projectId, name?, domain?, snapshotFile?, sitemapUrl?, gscProperty? }]
 *   projectId is the stable local identity linked from the Sites registry.
 *   name/domain are used only when the project row does not exist yet
 *   (ephemeral runners start from an empty database).
 *   snapshotFile: fresh Blog site-context snapshot to refresh the binding
 *   (needs the Blog workspace; omitted on github-hosted runners, where the
 *   planning still works from sitemap/GSC URL inventory).
 *   sitemapUrl: explicit sitemap; omitted lets sitemap discovery run.
 *   gscProperty: explicit Search Console property for this site.
 * The sequence runs per site: ensure project, optional binding refresh,
 * sitemap inventory, 7d/28d/90d GSC+GA4 capture, then ONE compact Firestore
 * planning digest overwrite. Raw rows remain ephemeral and are not mirrored
 * as one Firestore record per page/period.
 */
const jobs = JSON.parse(process.env.SITE_JOBS_JSON ?? '[]') as Array<{ projectId: string; name?: string; domain?: string; snapshotFile?: string; sitemapUrl?: string; gscProperty?: string }>;
const ctx = { actor: 'system' as const, actorId: process.env.KEYWORDS_AGENT_ID ?? 'site-measurement-batch' };
const { sqlite } = getDatabase();

function capturedGscRowCounts(projectId: string, siteUrl: string, periods: Array<{ startDate: string; endDate: string }>) {
  const periodFilter = periods.map(() => '(start_date=? AND end_date=?)').join(' OR ');
  const periodParams = periods.flatMap(period => [period.startDate, period.endDate]);
  const query = sqlite.prepare(`SELECT COUNT(*) AS count FROM keyword_metric_snapshots
    WHERE project_id=? AND site_url=? AND (${periodFilter})`);
  const page = sqlite.prepare(`SELECT COUNT(*) AS count FROM page_metric_snapshots
    WHERE project_id=? AND site_url=? AND (${periodFilter})`);
  const queryPage = sqlite.prepare(`SELECT COUNT(*) AS count FROM query_page_metric_snapshots
    WHERE project_id=? AND site_url=? AND (${periodFilter})`);
  return {
    queries: Number((query.get(projectId, siteUrl, ...periodParams) as { count: number }).count),
    pages: Number((page.get(projectId, siteUrl, ...periodParams) as { count: number }).count),
    queryPages: Number((queryPage.get(projectId, siteUrl, ...periodParams) as { count: number }).count)
  };
}

async function ensureProject(job: { projectId: string; name?: string; domain?: string }) {
  const projects = (await commands.project.list(ctx)) as Array<{ id: string }>;
  if (projects.some(project => project.id === job.projectId)) return { reused: true };
  if (!job.name) throw new Error(`Project ${job.projectId} does not exist and no name/domain was supplied to create it`);
  await commands.project.create(ctx, { id: job.projectId, name: job.name, domain: job.domain, environment: 'production' });
  return { reused: false };
}

function normalizeInventoryUrl(input: string) {
  const url = new URL(input);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}
function preserveSitemapUrl(input: string) {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

function pageFamilyFor(input: string) {
  const url = new URL(input);
  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) return '/';
  if (parts.length === 1) return '/(root-level)/*';
  return `/${parts[0]}/*`;
}

function sitemapUrlsObservedAt(projectId: string, syncedAt: string) {
  const rows = sqlite.prepare('SELECT url FROM pages WHERE project_id=? AND url IS NOT NULL AND last_seen_at=?').all(projectId, syncedAt) as Array<{ url: string }>;
  // Dedupe by stable identity, but retain the EXACT sitemap URL for Inspection.
  // Stripping trailing slashes here caused Google to inspect redirect variants
  // instead of the URLs that appear in Search.
  const byIdentity = new Map<string, string>();
  for (const row of rows) byIdentity.set(normalizeInventoryUrl(row.url), preserveSitemapUrl(row.url));
  return [...byIdentity.values()].sort();
}

async function cachedIndexationInventory(siteId: string) {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const result = await siteIndexationList({ siteId, limit: 500, ...(pageToken ? { pageToken } : {}) }) as any;
    items.push(...result.items);
    pageToken = result.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

async function reconcileIndexationInventory(projectId: string, sitemapUrls: string[], complete: boolean) {
  const resolved = await siteRegistryResolve({ localProjectId: projectId }) as any;
  const site = resolved.site;
  if (!site) return { status: 'skipped', reason: 'site_not_registered', currentUrls: sitemapUrls.length };

  const cached = await cachedIndexationInventory(site.id);
  const cachedByUrl = new Map(cached.map((row: any) => [normalizeInventoryUrl(row.url), row]));
  const current = new Map(sitemapUrls.map(url => [normalizeInventoryUrl(url), preserveSitemapUrl(url)]));
  const changes: any[] = [];

  for (const [identity, inspectionUrl] of current) {
    const previous: any = cachedByUrl.get(identity);
    const pageFamily = pageFamilyFor(identity);
    if (!previous || previous.inventoryState !== 'current' || previous.indexable !== true ||
        previous.pageFamily !== pageFamily || previous.inspectionUrl !== inspectionUrl) {
      changes.push({ url: inspectionUrl, pageFamily, indexable: true, inventoryState: 'current' });
    }
  }

  const currentCachedCount = cached.filter((row: any) => row.inventoryState === 'current').length;
  const emptyCompleteSitemapGuard = complete && current.size === 0 && currentCachedCount > 0;
  const allowRemovals = complete && !emptyCompleteSitemapGuard;
  if (allowRemovals) {
    for (const [url, previous] of cachedByUrl) {
      const row: any = previous;
      if (!current.has(url) && row.inventoryState === 'current') {
        changes.push({ url, pageFamily: row.pageFamily ?? pageFamilyFor(url), indexable: false, inventoryState: 'removed' });
      }
    }
  }

  let created = 0, updated = 0, unchanged = 0, failed = 0;
  for (let offset = 0; offset < changes.length; offset += 200) {
    const result = await siteIndexationInventorySave({ siteId: site.id, records: changes.slice(offset, offset + 200) }) as any;
    created += Number(result.created ?? 0);
    updated += Number(result.updated ?? 0);
    unchanged += Number(result.unchanged ?? 0);
    failed += Number(result.failed ?? 0);
  }

  return {
    status: failed ? 'partial' : 'synced',
    siteId: site.id,
    sitemapComplete: complete,
    currentUrls: current.size,
    cachedUrls: cached.length,
    changes: changes.length,
    created,
    updated,
    unchanged,
    failed,
    removalsSuppressed: !allowRemovals,
    removalSuppressionReason: !complete ? 'sitemap_incomplete' : emptyCompleteSitemapGuard ? 'complete_sitemap_returned_zero_urls' : null
  };
}

async function main() {
  const summary: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    const label = job.projectId;
    try {
      const ensured = await ensureProject(job);
      const started = await operationCommands.start(ctx, {
        requestText: `On-demand site measurement: ${label}.`,
        projectIds: [job.projectId],
        scope: 'single',
        objective: `External SEO planning measurement for ${label}: sitemap + 7d/28d/90d GSC/GA4 + one compact planning digest overwrite.`,
        completionCriteria: ['Sitemap inventory synced', '7d/28d/90d GSC windows captured', 'GA4 organic landing-page data attempted', 'Exactly one compact latest planning digest written for the site'],
        budget: { maxActions: 40, maxExternalRequests: 60, maxCandidateWrites: 0, maxProjects: 1, maxRuntimeMinutes: 30 },
      });
      const child = (started as { children?: Array<{ workSessionId?: string | null }> }).children?.[0];
      let workSessionId = child?.workSessionId ?? null;
      if (!workSessionId) {
        const existing = await operationCommands.context(ctx, { operationId: (started as any).operation.id });
        workSessionId = (existing as any).projects?.[0]?.workSessionId ?? null;
      }
      if (!workSessionId) throw new Error('Operation has no work session for this project');
      const sctx = { ...ctx, workSessionId };
      let imported: unknown = null;
      if (job.snapshotFile) {
        const snapshot = JSON.parse(readFileSync(job.snapshotFile, 'utf8'));
        imported = await blogCommands.importContext(sctx, { projectId: job.projectId, snapshot });
      }
      const sync = await siteCommands.syncSitemap(sctx, { projectId: job.projectId, sitemapUrl: job.sitemapUrl });
      const sitemapInventoryUrls = sitemapUrlsObservedAt(job.projectId, sync.syncedAt);
      const endDate = recoveryDate();
      const context = recoveryContext(job.projectId);
      const siteUrl = job.gscProperty ?? context.latest?.property;
      const periods = [
        { key: 'current7', startDate: dateOffset(endDate, -6), endDate },
        { key: 'previous7', startDate: dateOffset(endDate, -13), endDate: dateOffset(endDate, -7) },
        { key: 'current28', startDate: dateOffset(endDate, -27), endDate },
        { key: 'previous28', startDate: dateOffset(endDate, -55), endDate: dateOffset(endDate, -28) },
        { key: 'trailing90', startDate: dateOffset(endDate, -89), endDate }
      ];
      const gscCaptures: Array<Record<string, unknown>> = [];
      for (const period of periods) {
        const capture = await metricsCommands.capture(sctx, {
          projectId: job.projectId,
          siteUrl,
          startDate: period.startDate,
          endDate: period.endDate,
          timezone: 'America/Los_Angeles'
        });
        gscCaptures.push({ key: period.key, ...capture });
      }
      let ga4: unknown;
      try {
        ga4 = await captureProjectGa4Metrics(sctx, { projectId: job.projectId, periods });
      } catch {
        ga4 = { status: 'failed', reason: 'ga4_collection_failed' };
      }
      const capturedRows = capturedGscRowCounts(job.projectId, String(siteUrl ?? ''), periods);
      const digest = await refreshSeoPlanningDigest(job.projectId, endDate);
      let indexationInventory: any;
      try {
        indexationInventory = await reconcileIndexationInventory(job.projectId, sitemapInventoryUrls, sync.complete);
      } catch (error) {
        indexationInventory = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
      const indexationOk = !['failed', 'partial'].includes(String(indexationInventory.status));
      await operationCommands.complete({ ...sctx, workSessionId: undefined }, {
        operationId: started.operation.id,
        summary: `SEO planning measurement for ${label}: import=${JSON.stringify(imported)?.slice(0, 160)}; sitemap=${sync.discovered}; windows=7d/28d/90d; GSC captures=${gscCaptures.length}; GA4=${(ga4 as any)?.status}; compact digest selected=${digest.selectedCount}/inventory=${digest.inventoryCount}; local rows queries=${capturedRows.queries}, pages=${capturedRows.pages}, queryPages=${capturedRows.queryPages}; indexation inventory=${indexationInventory.status}, changes=${indexationInventory.changes ?? 'n/a'}. Firestore analytics remain one overwrite-only digest per site; URL indexation state is reconciled only when sitemap inventory changes.`,
      });
      summary.push({ projectId: label, ok: indexationOk, operationId: started.operation.id, projectReused: ensured.reused, sitemapUrls: sync.discovered, ga4: (ga4 as any)?.status, digest, localRows: capturedRows, indexationInventory });
    } catch (error) {
      summary.push({ projectId: label, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ ok: summary.every(item => item.ok), sites: summary }, null, 2));
  if (!summary.every(item => item.ok)) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
