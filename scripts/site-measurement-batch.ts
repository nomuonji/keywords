import { readFileSync } from 'node:fs';
import { commands } from '../packages/commands/src/index.js';
import { operationCommands } from '../packages/commands/src/operation.js';
import { siteCommands } from '../packages/commands/src/site.js';
import { blogCommands } from '../packages/commands/src/blog.js';
import { metricsCommands } from '../packages/commands/src/metrics.js';
import { captureProjectGa4Metrics } from '../packages/commands/src/ga4-metrics.js';
import { projectSiteOperationsMetrics } from '../packages/commands/src/site-operations-bridge.js';
import { recoveryContext, recoveryDate, dateOffset } from '../packages/commands/src/recovery-context.js';

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
 *   projection degrades gracefully to site-level snapshots).
 *   sitemapUrl: explicit sitemap; omitted lets sitemap discovery run.
 *   gscProperty: explicit Search Console property for this site.
 * The worker-identical sequence runs per site: ensure project, binding
 * refresh (when a snapshot is supplied), sitemap sync, two equal GSC weeks,
 * GA4 collection, and Firestore projection. Local evidence is always
 * preserved; cloud projection failures are reported, never fatal.
 */
const jobs = JSON.parse(process.env.SITE_JOBS_JSON ?? '[]') as Array<{ projectId: string; name?: string; domain?: string; snapshotFile?: string; sitemapUrl?: string; gscProperty?: string }>;
const ctx = { actor: 'system' as const, actorId: process.env.KEYWORDS_AGENT_ID ?? 'site-measurement-batch' };

async function ensureProject(job: { projectId: string; name?: string; domain?: string }) {
  const projects = (await commands.project.list(ctx)) as Array<{ id: string }>;
  if (projects.some(project => project.id === job.projectId)) return { reused: true };
  if (!job.name) throw new Error(`Project ${job.projectId} does not exist and no name/domain was supplied to create it`);
  await commands.project.create(ctx, { id: job.projectId, name: job.name, domain: job.domain, environment: 'production' });
  return { reused: false };
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
        objective: `On-demand measurement for ${label}: binding refresh when supplied, sitemap sync, two GSC weeks, GA4, Firestore projection.`,
        completionCriteria: ['Sitemap inventory synced', 'Two equal GSC weekly periods captured', 'GA4 attempted without discarding GSC', 'Firestore projection attempted with local evidence preserved'],
        budget: { maxActions: 24, maxExternalRequests: 40, maxCandidateWrites: 0, maxProjects: 1, maxRuntimeMinutes: 30 },
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
      const endDate = recoveryDate();
      const context = recoveryContext(job.projectId);
      const siteUrl = job.gscProperty ?? context.latest?.property;
      const previousPeriod = { key: 'previous', startDate: dateOffset(endDate, -13), endDate: dateOffset(endDate, -7) };
      const currentPeriod = { key: 'current', startDate: dateOffset(endDate, -6), endDate };
      const previous = await metricsCommands.capture(sctx, { projectId: job.projectId, siteUrl, startDate: previousPeriod.startDate, endDate: previousPeriod.endDate, timezone: 'America/Los_Angeles' });
      const current = await metricsCommands.capture(sctx, { projectId: job.projectId, siteUrl, startDate: currentPeriod.startDate, endDate: currentPeriod.endDate, timezone: 'America/Los_Angeles' });
      let ga4: unknown;
      try {
        ga4 = await captureProjectGa4Metrics(sctx, { projectId: job.projectId, periods: [previousPeriod, currentPeriod] });
      } catch {
        ga4 = { status: 'failed', reason: 'ga4_collection_failed' };
      }
      let projection: unknown;
      try {
        projection = await projectSiteOperationsMetrics(job.projectId);
      } catch (error) {
        projection = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
      await operationCommands.complete({ ...sctx, workSessionId: undefined }, {
        operationId: started.operation.id,
        summary: `On-demand measurement for ${label}: import=${JSON.stringify(imported)?.slice(0, 200)}; sitemap ${sync.discovered} URLs; GSC captured; GA4 ${(ga4 as any)?.status}; projection ${JSON.stringify(projection)?.slice(0, 300)}.`,
      });
      summary.push({ projectId: label, ok: true, operationId: started.operation.id, projectReused: ensured.reused, sitemapUrls: sync.discovered, ga4: (ga4 as any)?.status, projection });
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
