import { z } from 'zod';
import { metricSnapshotList, optimizationEventList } from './remote-site-operations.js';
import type { MetricSnapshot, OptimizationEvent } from '../../db/src/site-operations-schema.js';

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const positiveInteger = z.number().int().min(1);

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
 * Surface new/rising GSC queries from compatible, non-overlapping site periods.
 * This is a candidate feed only. It deliberately does not call Google Ads/SERP
 * and does not write Keyword Treasury; Keywords Operator owns those budgets.
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
    const isNew = !before;
    const isRising = Boolean(before && growthRatio !== null && growthRatio >= args.minGrowthRatio);
    if (!isNew && !isRising) continue;
    candidates.push({
      query: row.query,
      kind: isNew ? 'new_query' : 'rising_query',
      current: row,
      previous: before ?? null,
      impressionGrowthRatio: growthRatio,
      impressionDelta: impressions - previousImpressions,
      clickDelta: (row.clicks ?? 0) - (before?.clicks ?? 0)
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
    candidates: candidates.slice(0, args.limit),
    nextAction: 'Pass selected query strings to Keywords Operator keyword_screen_batch (Google Ads first), then use keyword_research_pipeline only for shortlisted terms. This tool never spends SERP quota or writes Treasury.'
  };
}
