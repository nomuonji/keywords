import { z } from 'zod';
import {
  metricSnapshotList,
  optimizationEventList,
  optimizationEventUpdate,
  remoteSitesStatus,
  siteRegistryResolve
} from './remote-site-operations.js';
import type { MetricSnapshot, OptimizationEvent, SiteRecord } from '../../db/src/site-operations-schema.js';

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const positiveInteger = z.number().int().min(1);
const evaluationResult = z.enum(['improved', 'neutral', 'worsened', 'inconclusive']);

export const optimizationEvaluationContextShape = {
  siteId: entityId,
  eventId: entityId
};

export const siteQueryOpportunitiesShape = {
  siteId: entityId,
  minImpressions: z.number().int().min(1).max(1_000_000).default(20),
  minGrowthRatio: z.number().min(1).max(100).default(1.5),
  limit: positiveInteger.max(100).default(30)
};

export const localOptimizationEvaluationShape = {
  projectId: entityId,
  eventId: entityId
};

export const localOptimizationRecordShape = {
  projectId: entityId,
  eventId: entityId,
  expectedRevision: z.number().int().min(1),
  result: evaluationResult,
  notes: z.string().trim().max(3000).default('')
};

function dateDays(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function dateOnly(value: string | null) {
  return value ? value.slice(0, 10) : null;
}

function numberMetric(snapshot: MetricSnapshot | null, name: string) {
  const value = snapshot?.metrics?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricDelta(before: number | null, after: number | null) {
  if (before === null || after === null) return { before, after, absolute: null, relative: null };
  const absolute = after - before;
  const relative = before === 0 ? null : absolute / Math.abs(before);
  return { before, after, absolute, relative };
}

function gscComparison(before: MetricSnapshot | null, after: MetricSnapshot | null) {
  return {
    clicks: metricDelta(numberMetric(before, 'clicks'), numberMetric(after, 'clicks')),
    impressions: metricDelta(numberMetric(before, 'impressions'), numberMetric(after, 'impressions')),
    ctr: metricDelta(numberMetric(before, 'ctr'), numberMetric(after, 'ctr')),
    averagePosition: metricDelta(numberMetric(before, 'averagePosition'), numberMetric(after, 'averagePosition'))
  };
}

/**
 * Build a deterministic evidence packet for one implemented optimization.
 * It intentionally does not decide improved/neutral/worsened: the persisted
 * hypothesis is semantic, while this function only proves whether compatible
 * before/after observations exist and exposes their deltas.
 */
export async function optimizationEvaluationContext(input: unknown) {
  const args = z.object(optimizationEvaluationContextShape).strict().parse(input);
  const events = (await optimizationEventList({ siteId: args.siteId, limit: 100 })).items as OptimizationEvent[];
  const event = events.find(item => item.id === args.eventId);
  if (!event) throw new Error('Optimization event not found in the bounded site history');

  const snapshots = (await metricSnapshotList({ siteId: args.siteId, articleId: event.articleId, provider: 'gsc', limit: 100 })).items
    .filter(item => item.completeness === 'complete') as MetricSnapshot[];
  const baselineDays = dateDays(event.baselinePeriod.start, event.baselinePeriod.end);
  const baseline = snapshots.find(item => item.periodStart === event.baselinePeriod.start && item.periodEnd === event.baselinePeriod.end) ?? null;
  const changedDate = dateOnly(event.changedAt);
  const evaluateDate = dateOnly(event.evaluateAfter);
  const compatiblePost = snapshots
    .filter(item => dateDays(item.periodStart, item.periodEnd) === baselineDays)
    .filter(item => !changedDate || item.periodStart > changedDate)
    .filter(item => !evaluateDate || item.periodEnd >= evaluateDate)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const post = compatiblePost[0] ?? null;

  const matured = Boolean(event.evaluateAfter && Date.now() >= Date.parse(event.evaluateAfter));
  const warnings: string[] = [];
  if (event.phase !== 'implemented' || event.result !== 'pending') warnings.push(`Event is ${event.phase}/${event.result}; it is not an active pending optimization.`);
  if (!event.changedAt || !event.evaluateAfter) warnings.push('Implementation/evaluation timestamps are missing.');
  if (!matured) warnings.push(`Evaluation wait has not matured${event.evaluateAfter ? `; evaluate after ${event.evaluateAfter}` : ''}.`);
  if (!baseline) warnings.push('No complete article-level GSC snapshot exactly matches the persisted baselinePeriod.');
  if (!post) warnings.push('No complete equal-length article-level GSC period fully after the change and reaching the evaluation date is available yet.');

  return {
    siteId: args.siteId,
    event,
    policy: {
      requiresCompleteGsc: true,
      equalPeriodLength: true,
      postPeriodStartsAfterChangedDate: true,
      postPeriodReachesEvaluateAfter: true,
      automaticVerdict: false
    },
    matured,
    baselinePeriodDays: baselineDays,
    baseline,
    post,
    deltas: gscComparison(baseline, post),
    readyForAgentEvaluation: event.phase === 'implemented' && event.result === 'pending' && matured && Boolean(baseline && post),
    warnings,
    nextAction: !matured ? 'wait' : !baseline || !post ? 'collect_more_compatible_gsc' : 'compare_deltas_to_the_persisted_hypothesis_then_record_result_with_optimization_event_update'
  };
}

async function siteForLocalProject(projectId: string) {
  const status = remoteSitesStatus();
  if (!status.firestoreConfigured || !status.projectConfigured) return null;
  const resolved = await siteRegistryResolve({ localProjectId: projectId });
  return resolved.site as SiteRecord | null;
}

/** Local runner/MCP adapter: resolve the Firestore site from the SQLite project. */
export async function localOptimizationEvaluationContext(input: unknown) {
  const args = z.object(localOptimizationEvaluationShape).strict().parse(input);
  const site = await siteForLocalProject(args.projectId);
  if (!site) throw new Error('No Sites Operator site is linked to this local project');
  return optimizationEvaluationContext({ siteId: site.id, eventId: args.eventId });
}

function flattenedEvaluationMetrics(context: Awaited<ReturnType<typeof optimizationEvaluationContext>>) {
  const result: Record<string, number | null> = {};
  for (const [name, delta] of Object.entries(context.deltas)) {
    result[`${name}Before`] = delta.before;
    result[`${name}After`] = delta.after;
    result[`${name}Delta`] = delta.absolute;
    result[`${name}Relative`] = delta.relative;
  }
  return result;
}

/**
 * Persist only the semantic verdict chosen by the Agent. Numerical evidence is
 * recomputed from the compatible saved snapshots so the Agent cannot invent it.
 */
export async function localOptimizationRecordResult(input: unknown) {
  const args = z.object(localOptimizationRecordShape).strict().parse(input);
  const context = await localOptimizationEvaluationContext({ projectId: args.projectId, eventId: args.eventId });
  if (!context.readyForAgentEvaluation || !context.baseline || !context.post) {
    throw new Error(`Optimization is not ready for evaluation: ${context.warnings.join(' ') || context.nextAction}`);
  }
  if (context.event.revision !== args.expectedRevision) {
    throw new Error(`Revision conflict: expected ${args.expectedRevision}, current ${context.event.revision}`);
  }
  const evidence = `Evaluation evidence: baseline=${context.baseline.id} (${context.baseline.periodStart}..${context.baseline.periodEnd}); post=${context.post.id} (${context.post.periodStart}..${context.post.periodEnd}).`;
  const updated = await optimizationEventUpdate({
    id: args.eventId,
    expectedRevision: args.expectedRevision,
    result: args.result,
    evaluationMetrics: flattenedEvaluationMetrics(context),
    notes: [args.notes, evidence].filter(Boolean).join('\n').slice(0, 4000)
  });
  invalidateSiteOptimizationDueCache(args.projectId);
  return updated;
}

const dueCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof computeNextSiteOptimizationEvaluation>> }>();

function dueCacheMs() {
  const configured = Number(process.env.KEYWORDS_SITE_OPTIMIZATION_CHECK_MINUTES ?? 30);
  const minutes = Number.isFinite(configured) ? Math.max(1, Math.min(configured, 360)) : 30;
  return minutes * 60_000;
}

export function invalidateSiteOptimizationDueCache(projectId: string) {
  dueCache.delete(projectId);
}

async function computeNextSiteOptimizationEvaluation(projectId: string) {
  const site = await siteForLocalProject(projectId);
  if (!site) return { status: 'skipped' as const, reason: 'site_not_linked_or_firestore_unavailable', projectId };
  const events = (await optimizationEventList({ siteId: site.id, phase: 'implemented', result: 'pending', limit: 100 })).items as OptimizationEvent[];
  const due = events
    .filter(event => event.evaluateAfter && Date.parse(event.evaluateAfter) <= Date.now())
    .sort((a, b) => Date.parse(a.evaluateAfter ?? '') - Date.parse(b.evaluateAfter ?? ''));
  for (const event of due) {
    const evaluation = await optimizationEvaluationContext({ siteId: site.id, eventId: event.id });
    if (evaluation.readyForAgentEvaluation) {
      return { status: 'ready' as const, projectId, site, event, evaluation };
    }
  }
  return {
    status: due.length ? 'waiting_for_compatible_metrics' as const : 'none_due' as const,
    projectId,
    site,
    dueEventIds: due.map(event => event.id)
  };
}

/** Bounded/cached probe used by the local Operator; ready work is never cached. */
export async function nextSiteOptimizationEvaluation(projectId: string) {
  const cached = dueCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await computeNextSiteOptimizationEvaluation(projectId);
  if (value.status !== 'ready') dueCache.set(projectId, { expiresAt: Date.now() + dueCacheMs(), value });
  return value;
}

type QueryMetric = {
  query: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
};

function queryMap(snapshot: MetricSnapshot) {
  return new Map((snapshot.queries ?? []).map(row => [row.query.trim().toLowerCase(), row as QueryMetric]));
}

function compatibleSitePair(snapshots: MetricSnapshot[]) {
  const complete = snapshots
    .filter(item => item.provider === 'gsc' && item.articleId === null && item.completeness === 'complete')
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const latest = complete[0];
  if (!latest) return null;
  const days = dateDays(latest.periodStart, latest.periodEnd);
  const previous = complete.find(item => item.id !== latest.id && dateDays(item.periodStart, item.periodEnd) === days && item.periodEnd < latest.periodStart);
  return previous ? { latest, previous, periodDays: days } : null;
}

/**
 * Surface newly-observed/rising GSC query candidates from compatible,
 * non-overlapping site periods. Site snapshots retain a bounded top-query set,
 * so absence from the previous snapshot is not proof that a query never existed.
 * This tool deliberately does not call Google Ads/SERP or write Treasury.
 */
export async function siteQueryOpportunities(input: unknown) {
  const args = z.object(siteQueryOpportunitiesShape).strict().parse(input);
  const snapshots = (await metricSnapshotList({ siteId: args.siteId, provider: 'gsc', limit: 100 })).items as MetricSnapshot[];
  const pair = compatibleSitePair(snapshots);
  if (!pair) return {
    siteId: args.siteId,
    comparable: false,
    reason: 'Two complete, equal-length, non-overlapping site-level GSC snapshots are required.',
    candidates: [],
    nextAction: 'collect_more_compatible_gsc'
  };

  const current = queryMap(pair.latest);
  const previous = queryMap(pair.previous);
  const candidates: Array<Record<string, unknown>> = [];
  for (const [key, row] of current) {
    const impressions = row.impressions ?? 0;
    if (impressions < args.minImpressions) continue;
    const before = previous.get(key);
    const previousImpressions = before?.impressions ?? 0;
    const growthRatio = previousImpressions > 0 ? impressions / previousImpressions : null;
    const newlyObserved = !before;
    const isRising = Boolean(before && growthRatio !== null && growthRatio >= args.minGrowthRatio);
    if (!newlyObserved && !isRising) continue;
    candidates.push({
      query: row.query,
      kind: newlyObserved ? 'newly_observed_query' : 'rising_query',
      current: row,
      previous: before ?? null,
      impressionGrowthRatio: growthRatio,
      impressionDelta: impressions - previousImpressions,
      clickDelta: (row.clicks ?? 0) - (before?.clicks ?? 0),
      observationCaveat: newlyObserved ? 'Absent from the bounded previous saved query set; this is not proof the query never existed in Search Console.' : null
    });
  }
  candidates.sort((a: any, b: any) => Number(b.impressionDelta) - Number(a.impressionDelta));

  return {
    siteId: args.siteId,
    comparable: true,
    periodDays: pair.periodDays,
    latest: { id: pair.latest.id, periodStart: pair.latest.periodStart, periodEnd: pair.latest.periodEnd, sourceVersion: pair.latest.sourceVersion },
    previous: { id: pair.previous.id, periodStart: pair.previous.periodStart, periodEnd: pair.previous.periodEnd, sourceVersion: pair.previous.sourceVersion },
    criteria: { minImpressions: args.minImpressions, minGrowthRatio: args.minGrowthRatio },
    queryCoverage: 'bounded_saved_top_queries',
    candidates: candidates.slice(0, args.limit),
    nextAction: 'Pass selected query strings to Keywords Operator keyword_screen_batch (Google Ads first), then use keyword_research_pipeline only for shortlisted terms. This tool never spends SERP quota or writes Treasury.'
  };
}
