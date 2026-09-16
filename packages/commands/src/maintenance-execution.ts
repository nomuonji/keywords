import type { CommandContext } from '@keywords/domain';
import { recoveryCommands } from './recovery.js';
import { recoveryContext, recoveryDate, dateOffset } from './recovery-context.js';
import { siteCommands } from './site.js';
import { metricsCommands } from './metrics.js';
import { operationCommands } from './operation.js';
import { captureProjectGa4Metrics } from './ga4-metrics.js';
import { projectSiteOperationsMetrics } from './site-operations-bridge.js';

export const MAINTENANCE_KINDS = ['capture_recovery', 'sync_site', 'capture_metrics'] as const;

/** The worker runs deterministic collection without spending an LLM turn on an API call. */
export async function executeMaintenance(ctx: CommandContext, claim: { operationId: string; projectId: string; workSessionId?: string | null; operatorKind?: string | null }) {
  if (!MAINTENANCE_KINDS.includes(claim.operatorKind as any)) return { handled: false };
  const scoped = { ...ctx, projectId: claim.projectId, workSessionId: claim.workSessionId ?? undefined };
  const state: any = await operationCommands.context(scoped, { operationId: claim.operationId });
  const child = state.projects.find((item: any) => item.projectId === claim.projectId);
  if (state.status !== 'active' || child?.work?.status !== 'running') throw new Error('Maintenance operation is paused or finished');
  let result: unknown;
  if (claim.operatorKind === 'capture_recovery') {
    result = await recoveryCommands.capture(scoped, { projectId: claim.projectId });
  } else if (claim.operatorKind === 'sync_site') {
    result = await siteCommands.syncSitemap(scoped, { projectId: claim.projectId });
  } else {
    const endDate = recoveryDate(), context = recoveryContext(claim.projectId);
    // Equal, non-overlapping complete weeks. Neither a failed nor a partial import is materialized.
    const siteUrl = context.latest?.property;
    const previousPeriod = { key: 'previous', startDate: dateOffset(endDate, -13), endDate: dateOffset(endDate, -7) };
    const currentPeriod = { key: 'current', startDate: dateOffset(endDate, -6), endDate };
    const previous = await metricsCommands.capture(scoped, { projectId: claim.projectId, siteUrl, startDate: previousPeriod.startDate, endDate: previousPeriod.endDate, timezone: 'America/Los_Angeles' });
    const current = await metricsCommands.capture(scoped, { projectId: claim.projectId, siteUrl, startDate: currentPeriod.startDate, endDate: currentPeriod.endDate, timezone: 'America/Los_Angeles' });
    // GA4 is additive. A GA4 configuration/API failure must not discard already
    // persisted Search Console evidence or prevent its cloud projection.
    let ga4Collection: unknown;
    try {
      ga4Collection = await captureProjectGa4Metrics(scoped, { projectId: claim.projectId, periods: [previousPeriod, currentPeriod] });
    } catch {
      ga4Collection = { status: 'failed', reason: 'ga4_collection_failed' };
    }
    // Firestore projection is an additive cloud control-plane step. A missing
    // Firebase credential or unlinked site returns `skipped`; a projection
    // failure is reported without discarding the already-persisted local metrics.
    let cloudProjection: unknown;
    try {
      cloudProjection = await projectSiteOperationsMetrics(claim.projectId);
    } catch (error) {
      cloudProjection = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    result = { previous, current, ga4Collection, cloudProjection };
  }
  await operationCommands.complete({ ...scoped, workSessionId: undefined }, { operationId: claim.operationId,
    summary: claim.operatorKind === 'capture_recovery' ? 'Persisted fixed-cohort URL inspection and scoped weekly visibility observations. Recovery/expansion eligibility and the next observation are derived from those sources; no article was generated.' : 'Persisted the requested external inventory/measurement evidence through shared commands.' });
  return { handled: true, result };
}
