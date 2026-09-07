import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt });
    throw error;
  }
}

async function inspect(projectId: string) {
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new Error('Project not found');
  const [review, session, openTask, livePage, latestSnapshot, latestSitemap, unclustered, snapshots] = await Promise.all([
    db.select().from(schema.reviewRequests).where(and(eq(schema.reviewRequests.projectId, projectId), eq(schema.reviewRequests.status, 'open'))).orderBy(desc(schema.reviewRequests.createdAt)).get(),
    db.select().from(schema.workSessions).where(and(eq(schema.workSessions.projectId, projectId), or(eq(schema.workSessions.status, 'running'), eq(schema.workSessions.status, 'awaiting_review'), eq(schema.workSessions.status, 'blocked')))).orderBy(desc(schema.workSessions.updatedAt)).get(),
    db.select().from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeType, 'agent'), ne(schema.tasks.status, 'done'))).orderBy(desc(schema.tasks.priority), desc(schema.tasks.updatedAt)).get(),
    db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), ne(schema.pages.url, ''))).orderBy(desc(schema.pages.lastSeenAt)).get(),
    db.select().from(schema.sources).where(and(eq(schema.sources.projectId, projectId), eq(schema.sources.type, 'gsc_snapshot'))).orderBy(desc(schema.sources.createdAt)).get(),
    db.select().from(schema.sources).where(and(eq(schema.sources.projectId, projectId), eq(schema.sources.type, 'sitemap'))).orderBy(desc(schema.sources.createdAt)).get(),
    db.select({ id: schema.keywords.id, text: schema.keywords.text, avgMonthly: schema.keywords.avgMonthly }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'), isNull(schema.clusterKeywords.keywordId))).orderBy(desc(schema.keywords.avgMonthly)).limit(10),
    db.select().from(schema.keywordMetricSnapshots).where(eq(schema.keywordMetricSnapshots.projectId, projectId)).orderBy(desc(schema.keywordMetricSnapshots.endDate), desc(schema.keywordMetricSnapshots.impressions)).limit(1500)
  ]);

  const candidates: Array<Record<string, unknown>> = [];
  if (review) candidates.push({ kind: 'await_review', rank: 1, title: review.title, reason: 'A human review request is open; autonomous work should not cross this boundary.', relatedType: 'review_request', relatedId: review.id });
  if (session) candidates.push({ kind: 'resume_session', rank: 2, title: session.objective, reason: `An unfinished work session is ${session.status}.`, relatedType: 'work_session', relatedId: session.id });
  if (openTask) candidates.push({ kind: 'existing_task', rank: 3, title: openTask.title, reason: `The shared agent queue already has an open priority-${openTask.priority} task.`, relatedType: 'task', relatedId: openTask.id });

  const byQuery = new Map<string, typeof snapshots>();
  for (const row of snapshots) {
    const list = byQuery.get(row.query) ?? [];
    if (!list.some(item => item.endDate === row.endDate) && list.length < 2) list.push(row);
    byQuery.set(row.query, list);
  }
  const drops = [...byQuery.entries()].flatMap(([query, rows]) => rows.length >= 2 ? [{ query, latest: rows[0], previous: rows[1] }] : [])
    .filter(item => (item.latest.position - item.previous.position >= 3 && item.previous.impressions > 0) || (item.previous.clicks >= 5 && item.latest.clicks <= item.previous.clicks * 0.7))
    .sort((a, b) => b.previous.impressions - a.previous.impressions);
  if (drops[0]) {
    const drop = drops[0];
    const keyword = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, drop.query.trim().toLowerCase().replace(/\s+/g, ' ')))).get();
    candidates.push({ kind: 'investigate_query_drop', rank: 4, title: `Investigate search decline: ${drop.query}`, reason: `Latest captured period changed from position ${drop.previous.position.toFixed(1)} / ${drop.previous.clicks} clicks to ${drop.latest.position.toFixed(1)} / ${drop.latest.clicks} clicks.`, relatedType: 'keyword', relatedId: keyword?.id ?? null });
  }

  const staleMs = 7 * 24 * 60 * 60 * 1000;
  if (!livePage || !latestSitemap || Date.now() - new Date(latestSitemap.createdAt).getTime() > staleMs) candidates.push({ kind: 'sync_site', rank: 5, title: 'Refresh live site URL inventory', reason: livePage ? 'The latest sitemap sync is older than 7 days.' : 'No live site URL inventory has been imported yet.', relatedType: 'site', relatedId: projectId });
  if (!latestSnapshot || Date.now() - new Date(latestSnapshot.createdAt).getTime() > staleMs) candidates.push({ kind: 'capture_metrics', rank: 6, title: 'Capture fresh Search Console metrics', reason: latestSnapshot ? 'The latest GSC snapshot is older than 7 days.' : 'No historical GSC snapshot has been captured yet.', relatedType: 'metrics', relatedId: projectId });
  if (unclustered[0]?.avgMonthly) candidates.push({ kind: 'structure_demand', rank: 7, title: `Resolve unclustered demand: ${unclustered[0].text}`, reason: `${unclustered[0].avgMonthly} average monthly searches are recorded with no cluster assignment.`, relatedType: 'keyword', relatedId: unclustered[0].id });
  candidates.sort((a, b) => Number(a.rank) - Number(b.rank));
  return { generatedAt: now(), project: { id: project.id, name: project.name, domain: project.domain }, candidates, next: candidates[0] ?? { kind: 'no_action', reason: 'No operator action is currently justified.' } };
}

export const operatorCommands = {
  inspect: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'operator.inspect', { projectId }, async () => inspect(projectId)),

  tick: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'operator.tick', { projectId }, async () => {
    const state = await inspect(projectId);
    const next = state.next as Record<string, unknown>;
    const kind = String(next.kind ?? 'no_action');
    if (['no_action', 'await_review', 'resume_session', 'existing_task'].includes(kind)) return { ...state, createdTask: null };
    const relatedType = String(next.relatedType ?? kind);
    const relatedId = next.relatedId ? String(next.relatedId) : null;
    const duplicate = await db.select().from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeType, 'agent'), ne(schema.tasks.status, 'done'), eq(schema.tasks.relatedType, relatedType), relatedId ? eq(schema.tasks.relatedId, relatedId) : isNull(schema.tasks.relatedId))).get();
    if (duplicate) return { ...state, createdTask: null, existingTaskId: duplicate.id };
    const t = now();
    const priority = kind === 'investigate_query_drop' ? 90 : kind === 'sync_site' || kind === 'capture_metrics' ? 70 : 60;
    const task = { id: id(), projectId, title: String(next.title ?? 'Operator-selected SEO task'), description: String(next.reason ?? ''), status: 'todo', priority, assigneeType: 'agent', relatedType, relatedId, createdAt: t, updatedAt: t };
    await db.insert(schema.tasks).values(task);
    return { ...state, createdTask: task };
  })
};
