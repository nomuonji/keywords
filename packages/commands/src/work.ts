import { and, count, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext, WorkCheckpointState, WorkSessionStatus } from '@keywords/domain';
import { isBudgetedCommand } from './budget.js';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string, workSessionId?: string): CommandContext => ({ ...ctx, projectId, workSessionId: workSessionId ?? ctx.workSessionId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id();
  const started = Date.now();
  const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({
      id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null,
      command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null),
      durationMs: Date.now() - started, createdAt
    });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({
      id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null,
      command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started, createdAt
    });
    throw error;
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string | null): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

async function requireProject(projectId: string) {
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new Error('Project not found');
  return project;
}

async function snapshotCounts(projectId: string) {
  const [keywords, unclusteredKeywords, clusters, proposedPages, approvedPages, openTasks, openInsights, activePolicies] = await Promise.all([
    db.select({ value: count() }).from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'))).get(),
    db.select({ value: count() }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'), isNull(schema.clusterKeywords.keywordId))).get(),
    db.select({ value: count() }).from(schema.clusters).where(and(eq(schema.clusters.projectId, projectId), eq(schema.clusters.status, 'active'))).get(),
    db.select({ value: count() }).from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.status, 'proposed'))).get(),
    db.select({ value: count() }).from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.status, 'approved'))).get(),
    db.select({ value: count() }).from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), ne(schema.tasks.status, 'done'))).get(),
    db.select({ value: count() }).from(schema.insights).where(and(eq(schema.insights.projectId, projectId), eq(schema.insights.status, 'open'))).get(),
    db.select({ value: count() }).from(schema.policyRules).where(and(eq(schema.policyRules.projectId, projectId), eq(schema.policyRules.status, 'active'))).get()
  ]);
  return {
    keywords: Number(keywords?.value ?? 0),
    unclusteredKeywords: Number(unclusteredKeywords?.value ?? 0),
    clusters: Number(clusters?.value ?? 0),
    proposedPages: Number(proposedPages?.value ?? 0),
    approvedPages: Number(approvedPages?.value ?? 0),
    openTasks: Number(openTasks?.value ?? 0),
    openInsights: Number(openInsights?.value ?? 0),
    activePolicies: Number(activePolicies?.value ?? 0)
  };
}

function diffCounts(baseline: Record<string, number>, current: Record<string, number>) {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  return Object.fromEntries([...keys].map(key => [key, (current[key] ?? 0) - (baseline[key] ?? 0)]));
}

async function actionUsage(sessionId: string) {
  const rows = await db.select({ command: schema.runs.command, status: schema.runs.status }).from(schema.runs).where(eq(schema.runs.workSessionId, sessionId));
  const actions = rows.filter(row => isBudgetedCommand(row.command));
  return {
    actions: actions.length,
    succeeded: actions.filter(row => row.status === 'succeeded').length,
    failed: actions.filter(row => row.status === 'failed').length
  };
}

async function sessionView(session: typeof schema.workSessions.$inferSelect) {
  const [usage, checkpoints] = await Promise.all([
    actionUsage(session.id),
    db.select().from(schema.workCheckpoints).where(eq(schema.workCheckpoints.sessionId, session.id)).orderBy(desc(schema.workCheckpoints.createdAt)).limit(12)
  ]);
  return {
    ...session,
    completionCriteria: parseStringArray(session.completionCriteriaJson),
    baseline: parseRecord(session.baselineJson),
    completionCriteriaJson: undefined,
    baselineJson: undefined,
    usage,
    remainingActions: Math.max(0, session.maxActions - usage.actions),
    checkpoints
  };
}

async function unfinishedSession(projectId: string) {
  return db.select().from(schema.workSessions)
    .where(and(
      eq(schema.workSessions.projectId, projectId),
      or(eq(schema.workSessions.status, 'running'), eq(schema.workSessions.status, 'awaiting_review'), eq(schema.workSessions.status, 'blocked'))
    ))
    .orderBy(desc(schema.workSessions.updatedAt))
    .get();
}

async function compactContext(projectId: string, requestedSessionId?: string) {
  const project = await requireProject(projectId);
  const [counts, activePolicies, policyCandidates, agentTasks, reviewPages, openInsights, keywordRows] = await Promise.all([
    snapshotCounts(projectId),
    db.select({ id: schema.policyRules.id, scope: schema.policyRules.scope, rule: schema.policyRules.rule }).from(schema.policyRules).where(and(eq(schema.policyRules.projectId, projectId), eq(schema.policyRules.status, 'active'))).orderBy(desc(schema.policyRules.updatedAt)).limit(20),
    db.select({ id: schema.policyRules.id, scope: schema.policyRules.scope, rule: schema.policyRules.rule }).from(schema.policyRules).where(and(eq(schema.policyRules.projectId, projectId), eq(schema.policyRules.status, 'candidate'))).orderBy(desc(schema.policyRules.updatedAt)).limit(10),
    db.select({ id: schema.tasks.id, title: schema.tasks.title, description: schema.tasks.description, status: schema.tasks.status, priority: schema.tasks.priority, relatedType: schema.tasks.relatedType, relatedId: schema.tasks.relatedId }).from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeType, 'agent'), ne(schema.tasks.status, 'done'))).orderBy(desc(schema.tasks.priority), desc(schema.tasks.updatedAt)).limit(12),
    db.select({ id: schema.pages.id, title: schema.pages.title, clusterId: schema.pages.clusterId, rationale: schema.pages.rationale, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.status, 'proposed'))).orderBy(desc(schema.pages.updatedAt)).limit(12),
    db.select({ id: schema.insights.id, type: schema.insights.type, text: schema.insights.text, confidence: schema.insights.confidence, sourceId: schema.insights.sourceId }).from(schema.insights).where(and(eq(schema.insights.projectId, projectId), eq(schema.insights.status, 'open'))).orderBy(desc(schema.insights.createdAt)).limit(10),
    db.select({
      id: schema.keywords.id, text: schema.keywords.text, avgMonthly: schema.keywords.avgMonthly, competition: schema.keywords.competition,
      gscImpressions: schema.keywords.gscImpressions, gscPosition: schema.keywords.gscPosition, clusterId: schema.clusterKeywords.clusterId
    }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected')))
  ]);

  const byImpressions = (a: typeof keywordRows[number], b: typeof keywordRows[number]) => (b.gscImpressions ?? 0) - (a.gscImpressions ?? 0);
  const byDemand = (a: typeof keywordRows[number], b: typeof keywordRows[number]) => (b.avgMonthly ?? 0) - (a.avgMonthly ?? 0);
  const opportunity = (row: typeof keywordRows[number]) => ({ id: row.id, text: row.text, clusterId: row.clusterId, avgMonthly: row.avgMonthly, competition: row.competition, impressions: row.gscImpressions, position: row.gscPosition });
  const opportunities = {
    highDemandUnclustered: keywordRows.filter(row => !row.clusterId && (row.avgMonthly ?? 0) > 0).sort(byDemand).slice(0, 6).map(opportunity),
    strikingDistance: keywordRows.filter(row => row.gscPosition !== null && row.gscPosition >= 4 && row.gscPosition <= 20 && (row.gscImpressions ?? 0) > 0).sort(byImpressions).slice(0, 6).map(opportunity),
    searchConsoleGaps: keywordRows.filter(row => row.gscPosition !== null && row.gscPosition > 20 && (row.gscImpressions ?? 0) > 0).sort(byImpressions).slice(0, 6).map(opportunity)
  };

  const rawSession = requestedSessionId
    ? await db.select().from(schema.workSessions).where(and(eq(schema.workSessions.id, requestedSessionId), eq(schema.workSessions.projectId, projectId))).get()
    : await unfinishedSession(projectId);
  const session = rawSession ? await sessionView(rawSession) : null;

  let next: Record<string, unknown>;
  if (session?.status === 'awaiting_review') {
    next = { kind: 'await_human_review', reason: 'The current work session is paused at a human review boundary.' };
  } else if (session?.status === 'blocked') {
    next = { kind: 'resolve_blocker', reason: session.summary ?? 'The current work session is blocked.', nextAction: session.lastNextAction };
  } else if (session && session.remainingActions <= 0) {
    next = { kind: 'finish_session', reason: 'The session action budget is exhausted. Checkpoint or complete instead of starting new work.' };
  } else if (agentTasks[0]) {
    next = { kind: 'task', task: agentTasks[0] };
  } else if (opportunities.highDemandUnclustered[0]) {
    next = { kind: 'structure_demand', opportunity: opportunities.highDemandUnclustered[0] };
  } else if (opportunities.strikingDistance[0]) {
    next = { kind: 'inspect_striking_distance', opportunity: opportunities.strikingDistance[0] };
  } else if (opportunities.searchConsoleGaps[0]) {
    next = { kind: 'inspect_search_console_gap', opportunity: opportunities.searchConsoleGaps[0] };
  } else if (openInsights[0]) {
    next = { kind: 'resolve_insight', insight: openInsights[0] };
  } else if (policyCandidates[0]) {
    next = { kind: 'await_policy_review', count: policyCandidates.length };
  } else if (reviewPages[0]) {
    next = { kind: 'await_page_review', count: reviewPages.length };
  } else {
    next = { kind: 'no_action', reason: 'No prioritized agent task or normalized opportunity is currently visible.' };
  }

  return {
    generatedAt: now(),
    project: { id: project.id, name: project.name, domain: project.domain },
    counts,
    session,
    activePolicies,
    policyCandidates,
    agentTasks,
    reviewQueue: reviewPages,
    openInsights,
    opportunities,
    next
  };
}

function defaultObjective(next: Record<string, unknown>) {
  switch (next.kind) {
    case 'task': return `Complete the highest-priority agent task: ${(next.task as { title?: string } | undefined)?.title ?? 'assigned task'}`;
    case 'structure_demand': return 'Resolve the top unclustered search-demand opportunity into an evidence-backed cluster/page decision.';
    case 'inspect_striking_distance': return 'Investigate the highest-impression striking-distance query and create the smallest justified workspace change.';
    case 'inspect_search_console_gap': return 'Investigate the highest-impression Search Console gap and decide whether it needs a cluster, page plan, or documented insight.';
    case 'resolve_insight': return 'Resolve the highest-priority open insight into a task, structured change, or explicit no-action conclusion.';
    default: return 'Review current project state and leave it in a more decision-ready state without crossing human approval boundaries.';
  }
}

function defaultCriteria(next: Record<string, unknown>) {
  switch (next.kind) {
    case 'task': return ['Move the selected task to done or review, or checkpoint a concrete blocker.', 'Persist any evidence or structured workspace changes used to reach the outcome.'];
    case 'structure_demand': return ['Validate intent before clustering.', 'Create or update structured cluster/page/insight state only when supported by evidence.', 'Stop at human review if a page proposal is created.'];
    default: return ['Make only evidence-backed, auditable workspace changes.', 'Do not cross human review boundaries.', 'Finish with a concise outcome summary and next action if one remains.'];
  }
}

async function requireSession(projectId: string, sessionId: string) {
  const session = await db.select().from(schema.workSessions).where(and(eq(schema.workSessions.id, sessionId), eq(schema.workSessions.projectId, projectId))).get();
  if (!session) throw new Error('Work session not found in project');
  return session;
}

export const workCommands = {
  context: async (ctx: CommandContext, input: { projectId: string; sessionId?: string }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'work.context', input, async () => compactContext(input.projectId, input.sessionId)),

  list: async (ctx: CommandContext, projectId: string, limit = 20) => withRun(projectCtx(ctx, projectId), 'work.list', { projectId, limit }, async () => {
    const rows = await db.select().from(schema.workSessions).where(eq(schema.workSessions.projectId, projectId)).orderBy(desc(schema.workSessions.updatedAt)).limit(Math.max(1, Math.min(limit, 100)));
    return Promise.all(rows.map(sessionView));
  }),

  start: async (ctx: CommandContext, input: { projectId: string; objective?: string; completionCriteria?: string[]; maxActions?: number }) => withRun(projectCtx(ctx, input.projectId), 'work.start', input, async () => {
    await requireProject(input.projectId);
    const existing = await unfinishedSession(input.projectId);
    if (existing) throw new Error(`Unfinished work session already exists: ${existing.id} (${existing.status}). Resume or finish it before starting another.`);
    const context = await compactContext(input.projectId);
    const objective = input.objective?.trim() || defaultObjective(context.next);
    const criteria = (input.completionCriteria ?? []).map(value => value.trim()).filter(Boolean);
    const completionCriteria = criteria.length ? criteria.slice(0, 10) : defaultCriteria(context.next);
    const maxActions = Math.max(1, Math.min(Math.floor(input.maxActions ?? 12), 50));
    const baseline = await snapshotCounts(input.projectId);
    const t = now();
    const row = {
      id: id(), projectId: input.projectId, actorId: ctx.actorId ?? null, objective,
      completionCriteriaJson: JSON.stringify(completionCriteria), baselineJson: JSON.stringify(baseline), status: 'running', maxActions,
      summary: null, lastNextAction: typeof context.next.kind === 'string' ? String(context.next.kind) : null,
      startedAt: t, updatedAt: t, completedAt: null
    };
    await db.insert(schema.workSessions).values(row);
    await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: row.id, state: 'working', summary: `Started: ${objective}`, nextAction: typeof context.next.kind === 'string' ? String(context.next.kind) : null, createdAt: t });
    return sessionView(row);
  }),

  resume: async (ctx: CommandContext, input: { projectId: string; sessionId: string }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'work.resume', input, async () => {
    const session = await requireSession(input.projectId, input.sessionId);
    if (session.status === 'completed' || session.status === 'cancelled') throw new Error(`Cannot resume ${session.status} work session`);
    const t = now();
    await db.update(schema.workSessions).set({ status: 'running', updatedAt: t }).where(eq(schema.workSessions.id, session.id));
    await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: session.id, state: 'working', summary: 'Session resumed after pause.', nextAction: session.lastNextAction, createdAt: t });
    const updated = await requireSession(input.projectId, input.sessionId);
    return sessionView(updated);
  }),

  checkpoint: async (ctx: CommandContext, input: { projectId: string; sessionId: string; state: Exclude<WorkCheckpointState, 'completed'>; summary: string; nextAction?: string }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'work.checkpoint', input, async () => {
    const session = await requireSession(input.projectId, input.sessionId);
    if (session.status === 'completed' || session.status === 'cancelled') throw new Error(`Cannot checkpoint ${session.status} work session`);
    const summary = input.summary.trim();
    if (!summary) throw new Error('Checkpoint summary is required');
    if (summary.length > 2000) throw new Error('Checkpoint summary is too long');
    const status: WorkSessionStatus = input.state === 'awaiting_review' ? 'awaiting_review' : input.state === 'blocked' ? 'blocked' : 'running';
    const t = now();
    await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: session.id, state: input.state, summary, nextAction: input.nextAction?.trim() || null, createdAt: t });
    await db.update(schema.workSessions).set({ status, summary, lastNextAction: input.nextAction?.trim() || null, updatedAt: t }).where(eq(schema.workSessions.id, session.id));
    const updated = await requireSession(input.projectId, input.sessionId);
    return sessionView(updated);
  }),

  complete: async (ctx: CommandContext, input: { projectId: string; sessionId: string; summary: string }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'work.complete', input, async () => {
    const session = await requireSession(input.projectId, input.sessionId);
    if (session.status === 'completed') return sessionView(session);
    if (session.status === 'cancelled') throw new Error('Cancelled work session cannot be completed');
    const summary = input.summary.trim();
    if (!summary) throw new Error('Completion summary is required');
    if (summary.length > 3000) throw new Error('Completion summary is too long');
    const current = await snapshotCounts(input.projectId);
    const baseline = parseRecord(session.baselineJson);
    const diff = diffCounts(baseline, current);
    const t = now();
    await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: session.id, state: 'completed', summary, nextAction: null, createdAt: t });
    await db.update(schema.workSessions).set({ status: 'completed', summary, lastNextAction: null, updatedAt: t, completedAt: t }).where(eq(schema.workSessions.id, session.id));
    const updated = await requireSession(input.projectId, input.sessionId);
    return { ...(await sessionView(updated)), current, diff };
  }),

  cancel: async (ctx: CommandContext, input: { projectId: string; sessionId: string; reason: string }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'work.cancel', input, async () => {
    const session = await requireSession(input.projectId, input.sessionId);
    if (session.status === 'completed') throw new Error('Completed work session cannot be cancelled');
    const reason = input.reason.trim();
    if (!reason) throw new Error('Cancellation reason is required');
    const t = now();
    await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: session.id, state: 'blocked', summary: `Cancelled: ${reason}`, nextAction: null, createdAt: t });
    await db.update(schema.workSessions).set({ status: 'cancelled', summary: reason, lastNextAction: null, updatedAt: t, completedAt: t }).where(eq(schema.workSessions.id, session.id));
    const updated = await requireSession(input.projectId, input.sessionId);
    return sessionView(updated);
  })
};
