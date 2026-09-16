import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '@keywords/db';
import { isBudgetedCommand } from './budget.js';
import {
  metricSnapshotList,
  optimizationContext,
  optimizationEventCreate,
  optimizationEventList,
  optimizationEventUpdate,
  remoteSitesStatus,
  siteArticleList,
  siteRegistryResolve
} from './remote-site-operations.js';
import { invalidateSiteOptimizationDueCache } from './site-operations-analysis.js';
import type { MetricSnapshot, OptimizationEvent, SiteArticleRecord, SiteRecord } from '../../db/src/site-operations-schema.js';

const { sqlite } = getDatabase();
const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const commitSha = z.string().regex(/^[a-f0-9]{7,64}$/i);
const actionType = z.enum(['content_expand', 'title_snippet', 'internal_links', 'cta_ui', 'freshness', 'indexing', 'new_article', 'other']);
const note = z.string().trim().min(1).max(4000);
const optionalNote = z.string().trim().max(3000).default('');
const isoTime = z.string().datetime({ offset: true });
const now = () => new Date().toISOString();
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);

export const localSiteOptimizationContextShape = {
  projectId: entityId,
  articleId: entityId
};

export const localSiteOptimizationCreateShape = {
  projectId: entityId,
  eventId: entityId,
  articleId: entityId,
  baselineSnapshotId: entityId,
  comparisonSnapshotId: entityId.optional(),
  observation: note,
  diagnosis: note,
  hypothesis: note,
  actionType,
  beforeCommit: commitSha.nullable().optional(),
  notes: optionalNote
};

export const localSiteOptimizationImplementShape = {
  projectId: entityId,
  eventId: entityId,
  expectedRevision: z.number().int().min(1),
  afterCommit: commitSha,
  changedAt: isoTime.optional(),
  notes: optionalNote
};

export const localSiteOptimizationCandidateShape = {
  projectId: entityId
};

function boundedEnv(name: string, fallback: number, min: number, max: number) {
  const configured = Number(process.env[name] ?? fallback);
  return Number.isFinite(configured) ? Math.max(min, Math.min(configured, max)) : fallback;
}

function proposalPolicy() {
  return {
    maxSnapshotAgeHours: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_MAX_SNAPSHOT_AGE_HOURS', 48, 1, 720),
    minImpressions: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_MIN_IMPRESSIONS', 100, 1, 1_000_000),
    minPreviousClicks: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_MIN_PREVIOUS_CLICKS', 5, 0, 1_000_000),
    clickDropRatio: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_CLICK_DROP_RATIO', 0.30, 0.01, 0.95),
    positionDrop: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_POSITION_DROP', 2, 0.1, 100),
    ctrDrop: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_CTR_DROP', 0.01, 0.001, 1),
    probeMinutes: boundedEnv('KEYWORDS_SITE_OPTIMIZATION_PROBE_MINUTES', 60, 1, 1440)
  };
}

function dateDays(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function metric(snapshot: MetricSnapshot, key: string) {
  const value = snapshot.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ratioDrop(previous: number | null, latest: number | null) {
  if (previous === null || latest === null || previous <= 0) return null;
  return (previous - latest) / previous;
}

async function linkedSite(projectId: string) {
  const status = remoteSitesStatus();
  if (!status.firestoreConfigured || !status.projectConfigured) return null;
  const resolved = await siteRegistryResolve({ localProjectId: projectId });
  return resolved.site as SiteRecord | null;
}

function activeSession(projectId: string) {
  return one(`SELECT ws.id,ws.max_actions
    FROM operation_requests o
    JOIN operation_projects op ON op.operation_id=o.id
    JOIN work_sessions ws ON ws.id=op.work_session_id
    WHERE op.project_id=? AND o.status='active' AND ws.status='running'
    ORDER BY o.updated_at DESC LIMIT 1`, projectId) as { id: string; max_actions: number } | undefined;
}

function assertActionBudget(projectId: string) {
  const session = activeSession(projectId);
  if (!session) throw new Error('Site optimization writes require an active shared Operation/work session.');
  const used = rows('SELECT command FROM runs WHERE work_session_id=?', session.id).filter(row => isBudgetedCommand(String(row.command))).length;
  if (used >= Number(session.max_actions ?? 0)) throw new Error('Active work session action budget is exhausted.');
  return session;
}

async function auditedWrite<T>(projectId: string, command: string, input: unknown, fn: () => Promise<T>) {
  const session = assertActionBudget(projectId);
  const id = randomUUID();
  const createdAt = now();
  const started = Date.now();
  try {
    const output = await fn();
    run(`INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,output_json,duration_ms,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, projectId, session.id, 'agent', process.env.KEYWORDS_AGENT_ID ?? 'mcp', command, 'succeeded', JSON.stringify(input ?? null), JSON.stringify(output ?? null), Date.now() - started, createdAt);
    return output;
  } catch (error) {
    run(`INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,error,duration_ms,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, projectId, session.id, 'agent', process.env.KEYWORDS_AGENT_ID ?? 'mcp', command, 'failed', JSON.stringify(input ?? null), error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), Date.now() - started, createdAt);
    throw error;
  }
}

function deterministicEventId(siteId: string, articleId: string, baselineSnapshotId: string) {
  const digest = createHash('sha256').update(`${siteId}:${articleId}:${baselineSnapshotId}`).digest('hex').slice(0, 28);
  return `auto_${digest}`;
}

function equalEventSemantics(event: OptimizationEvent, input: z.infer<z.ZodObject<any>>, baseline: MetricSnapshot) {
  return event.articleId === input.articleId
    && event.baselinePeriod.start === baseline.periodStart
    && event.baselinePeriod.end === baseline.periodEnd
    && event.observation === input.observation
    && event.diagnosis === input.diagnosis
    && event.hypothesis === input.hypothesis
    && event.actionType === input.actionType;
}

export async function localSiteOptimizationContext(input: unknown) {
  const args = z.object(localSiteOptimizationContextShape).strict().parse(input);
  const site = await linkedSite(args.projectId);
  if (!site) throw new Error('No Sites Operator site is linked to this local project.');
  const articles = (await siteArticleList({ siteId: site.id, limit: 100 })).items as SiteArticleRecord[];
  const article = articles.find(item => item.id === args.articleId);
  if (!article) throw new Error('Article is not registered on the linked site.');
  const context = await optimizationContext({ siteId: site.id, articleId: article.id, metricLimit: 30, eventLimit: 30 });
  const pendingProposed = (context.optimizationEvents as OptimizationEvent[]).find(event => event.phase === 'proposed' && event.result === 'pending') ?? null;
  return {
    projectId: args.projectId,
    site,
    article,
    ...context,
    changeAllowed: Boolean(context.changeAllowed && !pendingProposed),
    pendingProposed,
    policy: {
      ...context.policy,
      proposalBeforeEdit: true,
      implementationAfterVerifiedDeploy: true,
      oneHypothesisPerChange: true
    }
  };
}

const proposalCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof computeNextSiteOptimizationCandidate>> }>();

export function invalidateSiteOptimizationProposalCache(projectId: string) {
  proposalCache.delete(projectId);
}

async function computeNextSiteOptimizationCandidate(projectId: string) {
  const site = await linkedSite(projectId);
  if (!site) return { status: 'skipped' as const, reason: 'site_not_linked_or_firestore_unavailable', projectId };
  const policy = proposalPolicy();
  const [articleResponse, metricResponse, eventResponse] = await Promise.all([
    siteArticleList({ siteId: site.id, limit: 100 }),
    metricSnapshotList({ siteId: site.id, provider: 'gsc', limit: 100 }),
    optimizationEventList({ siteId: site.id, limit: 100 })
  ]);
  const articles = articleResponse.items as SiteArticleRecord[];
  const metrics = (metricResponse.items as MetricSnapshot[]).filter(item => item.articleId && item.completeness === 'complete');
  const events = eventResponse.items as OptimizationEvent[];
  const activeArticleIds = new Set(events.filter(event => event.result === 'pending' && ['proposed', 'implemented'].includes(event.phase)).map(event => event.articleId));
  const candidates: any[] = [];
  const blocked: any[] = [];

  for (const article of articles) {
    if (!article.localPageId || !article.repoPath || !article.canonicalUrl) continue;
    const snapshots = metrics.filter(item => item.articleId === article.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.capturedAt.localeCompare(a.capturedAt));
    const latest = snapshots[0];
    if (!latest) continue;
    const ageMs = Date.now() - Date.parse(latest.capturedAt);
    if (!Number.isFinite(ageMs) || ageMs < -300_000 || ageMs > policy.maxSnapshotAgeHours * 3_600_000) continue;
    const periodDays = dateDays(latest.periodStart, latest.periodEnd);
    const previous = snapshots.find(item => item.id !== latest.id && dateDays(item.periodStart, item.periodEnd) === periodDays && item.periodEnd < latest.periodStart);
    if (!previous) continue;

    const latestClicks = metric(latest, 'clicks');
    const previousClicks = metric(previous, 'clicks');
    const latestImpressions = metric(latest, 'impressions');
    const previousImpressions = metric(previous, 'impressions');
    const latestCtr = metric(latest, 'ctr');
    const previousCtr = metric(previous, 'ctr');
    const latestPosition = metric(latest, 'averagePosition');
    const previousPosition = metric(previous, 'averagePosition');
    const clickDrop = ratioDrop(previousClicks, latestClicks);
    const signals: string[] = [];
    if ((previousClicks ?? 0) >= policy.minPreviousClicks && clickDrop !== null && clickDrop >= policy.clickDropRatio) signals.push('click_decline');
    if ((latestImpressions ?? 0) >= policy.minImpressions && latestPosition !== null && previousPosition !== null && latestPosition - previousPosition >= policy.positionDrop) signals.push('position_decline');
    if ((latestImpressions ?? 0) >= policy.minImpressions && latestCtr !== null && previousCtr !== null && previousCtr - latestCtr >= policy.ctrDrop) signals.push('ctr_decline');
    if (!signals.length) continue;

    const score = (signals.includes('click_decline') ? 4 + Math.min(3, (clickDrop ?? 0) * 5) : 0)
      + (signals.includes('position_decline') ? 3 + Math.min(3, ((latestPosition ?? 0) - (previousPosition ?? 0)) / 3) : 0)
      + (signals.includes('ctr_decline') ? 2 + Math.min(2, ((previousCtr ?? 0) - (latestCtr ?? 0)) * 20) : 0);
    const candidate = {
      projectId,
      siteId: site.id,
      articleId: article.id,
      localPageId: article.localPageId,
      canonicalUrl: article.canonicalUrl,
      repoPath: article.repoPath,
      title: article.title,
      eventId: deterministicEventId(site.id, article.id, latest.id),
      baselineSnapshotId: latest.id,
      comparisonSnapshotId: previous.id,
      periodDays,
      signals,
      score,
      latest: { id: latest.id, periodStart: latest.periodStart, periodEnd: latest.periodEnd, capturedAt: latest.capturedAt, clicks: latestClicks, impressions: latestImpressions, ctr: latestCtr, averagePosition: latestPosition },
      previous: { id: previous.id, periodStart: previous.periodStart, periodEnd: previous.periodEnd, capturedAt: previous.capturedAt, clicks: previousClicks, impressions: previousImpressions, ctr: previousCtr, averagePosition: previousPosition },
      deltas: {
        clicks: latestClicks !== null && previousClicks !== null ? latestClicks - previousClicks : null,
        impressions: latestImpressions !== null && previousImpressions !== null ? latestImpressions - previousImpressions : null,
        ctr: latestCtr !== null && previousCtr !== null ? latestCtr - previousCtr : null,
        averagePosition: latestPosition !== null && previousPosition !== null ? latestPosition - previousPosition : null,
        clickDropRatio: clickDrop
      }
    };
    if (activeArticleIds.has(article.id)) blocked.push(candidate);
    else candidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score || (b.latest.impressions ?? -1) - (a.latest.impressions ?? -1) || a.articleId.localeCompare(b.articleId));
  if (candidates[0]) return {
    status: 'ready' as const,
    projectId,
    site,
    candidate: candidates[0],
    policy,
    nextAction: 'inspect_mapped_article_then_persist_one_proposed_optimization_before_editing'
  };
  if (blocked.length) return {
    status: 'blocked_by_active_optimization' as const,
    projectId,
    site,
    articleIds: [...new Set(blocked.map(item => item.articleId))],
    policy,
    nextAction: 'finish_or_cancel_the_existing_article_optimization_before_another_change'
  };
  return { status: 'no_material_article_decline' as const, projectId, site, policy };
}

export async function nextSiteOptimizationCandidate(projectId: string) {
  const cached = proposalCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await computeNextSiteOptimizationCandidate(projectId);
  if (value.status !== 'ready') proposalCache.set(projectId, { expiresAt: Date.now() + proposalPolicy().probeMinutes * 60_000, value });
  return value;
}

export async function localSiteOptimizationCandidate(input: unknown) {
  const args = z.object(localSiteOptimizationCandidateShape).strict().parse(input);
  return nextSiteOptimizationCandidate(args.projectId);
}

export async function localSiteOptimizationCreate(input: unknown) {
  const args = z.object(localSiteOptimizationCreateShape).strict().parse(input);
  return auditedWrite(args.projectId, 'site_optimization.create', args, async () => {
    const site = await linkedSite(args.projectId);
    if (!site) throw new Error('No Sites Operator site is linked to this local project.');
    const articles = (await siteArticleList({ siteId: site.id, limit: 100 })).items as SiteArticleRecord[];
    const article = articles.find(item => item.id === args.articleId);
    if (!article) throw new Error('Article is not registered on the linked site.');
    const snapshots = (await metricSnapshotList({ siteId: site.id, articleId: article.id, provider: 'gsc', limit: 100 })).items as MetricSnapshot[];
    const baseline = snapshots.find(item => item.id === args.baselineSnapshotId);
    if (!baseline || baseline.completeness !== 'complete') throw new Error('Pinned baselineSnapshotId must be a complete article-level GSC snapshot.');
    if (args.comparisonSnapshotId && !snapshots.some(item => item.id === args.comparisonSnapshotId && item.completeness === 'complete')) throw new Error('comparisonSnapshotId must identify a complete snapshot for the same article.');

    const events = (await optimizationEventList({ siteId: site.id, articleId: article.id, limit: 100 })).items as OptimizationEvent[];
    const existingById = events.find(event => event.id === args.eventId);
    if (existingById) {
      if (!equalEventSemantics(existingById, args as any, baseline)) throw new Error('Optimization event ID already exists with different pinned semantics.');
      return { ...existingById, reused: true };
    }
    const active = events.find(event => event.result === 'pending' && ['proposed', 'implemented'].includes(event.phase));
    if (active) throw new Error(`Article already has an active optimization (${active.id}); finish or cancel it before proposing another change.`);

    const provenance = `Pinned evidence: baselineSnapshotId=${baseline.id}${args.comparisonSnapshotId ? `; comparisonSnapshotId=${args.comparisonSnapshotId}` : ''}.`;
    const created = await optimizationEventCreate({
      id: args.eventId,
      siteId: site.id,
      articleId: article.id,
      observation: args.observation,
      diagnosis: args.diagnosis,
      hypothesis: args.hypothesis,
      actionType: args.actionType,
      beforeCommit: args.beforeCommit === undefined ? article.currentCommitSha : args.beforeCommit,
      baselinePeriod: { start: baseline.periodStart, end: baseline.periodEnd },
      phase: 'proposed',
      notes: [args.notes, provenance].filter(Boolean).join('\n').slice(0, 4000)
    });
    invalidateSiteOptimizationProposalCache(args.projectId);
    return { ...created, reused: false, baselineSnapshotId: baseline.id, comparisonSnapshotId: args.comparisonSnapshotId ?? null };
  });
}

export async function localSiteOptimizationMarkImplemented(input: unknown) {
  const args = z.object(localSiteOptimizationImplementShape).strict().parse(input);
  return auditedWrite(args.projectId, 'site_optimization.mark_implemented', args, async () => {
    const site = await linkedSite(args.projectId);
    if (!site) throw new Error('No Sites Operator site is linked to this local project.');
    const events = (await optimizationEventList({ siteId: site.id, limit: 100 })).items as OptimizationEvent[];
    const event = events.find(item => item.id === args.eventId);
    if (!event) throw new Error('Optimization event not found on the linked site.');
    if (event.phase === 'implemented' && event.result === 'pending') {
      if (event.afterCommit !== args.afterCommit) throw new Error('Optimization is already implemented with a different afterCommit.');
      return { ...event, reused: true };
    }
    if (event.phase !== 'proposed' || event.result !== 'pending') throw new Error(`Only a pending proposed optimization can be marked implemented; current state is ${event.phase}/${event.result}.`);
    if (event.revision !== args.expectedRevision) throw new Error(`Revision conflict: expected ${args.expectedRevision}, current ${event.revision}.`);
    const evidence = `Implementation recorded after verified delivery by the execution workflow; afterCommit=${args.afterCommit}.`;
    const updated = await optimizationEventUpdate({
      id: event.id,
      expectedRevision: args.expectedRevision,
      phase: 'implemented',
      afterCommit: args.afterCommit,
      changedAt: args.changedAt ?? now(),
      notes: [event.notes, args.notes, evidence].filter(Boolean).join('\n').slice(0, 4000)
    });
    invalidateSiteOptimizationDueCache(args.projectId);
    invalidateSiteOptimizationProposalCache(args.projectId);
    return { ...updated, reused: false };
  });
}
