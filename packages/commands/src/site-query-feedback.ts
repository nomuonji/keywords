import { remoteSitesStatus, siteRegistryResolve } from './remote-site-operations.js';
import { siteQueryOpportunities } from './site-operations-analysis.js';
import type { SiteRecord } from '../../db/src/site-operations-schema.js';

const cache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof compute>> }>();

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

function cacheMs() {
  return numberEnv('KEYWORDS_SITE_QUERY_FEEDBACK_CHECK_MINUTES', 60, 5, 1440) * 60_000;
}

async function compute(projectId: string) {
  const status = remoteSitesStatus();
  if (!status.firestoreConfigured || !status.projectConfigured) {
    return { status: 'skipped' as const, reason: 'firestore_not_configured', projectId };
  }
  const resolved = await siteRegistryResolve({ localProjectId: projectId });
  const site = resolved.site as SiteRecord | null;
  if (!site) return { status: 'skipped' as const, reason: 'site_not_linked', projectId };

  const minImpressions = Math.round(numberEnv('KEYWORDS_SITE_QUERY_MIN_IMPRESSIONS', 20, 1, 1_000_000));
  const minGrowthRatio = numberEnv('KEYWORDS_SITE_QUERY_MIN_GROWTH_RATIO', 1.5, 1, 100);
  const limit = Math.round(numberEnv('KEYWORDS_SITE_QUERY_FEEDBACK_LIMIT', 20, 1, 50));
  const maxSerpChecks = Math.round(numberEnv('KEYWORDS_SITE_QUERY_MAX_SERP_CHECKS', 5, 0, 10));
  const result = await siteQueryOpportunities({ siteId: site.id, minImpressions, minGrowthRatio, limit });
  if (!result.comparable || !result.latest || !result.previous || !result.criteria || !result.queryCoverage || !result.periodDays) {
    return { status: 'waiting_for_compatible_metrics' as const, projectId, siteId: site.id, result };
  }
  if (!result.candidates.length) {
    return { status: 'no_candidates' as const, projectId, siteId: site.id, snapshotId: result.latest.id, result };
  }
  return {
    status: 'ready' as const,
    projectId,
    siteId: site.id,
    snapshotId: result.latest.id,
    previousSnapshotId: result.previous.id,
    periodDays: result.periodDays,
    queryCoverage: result.queryCoverage,
    candidates: result.candidates,
    criteria: result.criteria,
    maxSerpChecks
  };
}

export function invalidateSiteQueryFeedbackCache(projectId: string) {
  cache.delete(projectId);
}

/** Bounded Firestore probe used by the local Operator. Ready work is never cached. */
export async function nextSiteQueryFeedback(projectId: string) {
  const cached = cache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await compute(projectId);
  if (value.status !== 'ready') cache.set(projectId, { expiresAt: Date.now() + cacheMs(), value });
  return value;
}
