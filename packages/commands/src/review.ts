import { and, count, desc, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { planningCommands } from './planning.js';
import { policyCommands } from './policy.js';

const { db, sqlite } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string, workSessionId?: string): CommandContext => ({ ...ctx, projectId, workSessionId: workSessionId ?? ctx.workSessionId });

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

function parseOptions(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}
function defaultOptions(targetType: string) { if (targetType === 'page') return ['approved', 'needs_edit', 'rejected']; if (targetType === 'policy') return ['active', 'rejected']; return ['approved', 'rejected']; }
async function requireSession(projectId: string, sessionId: string) {
  const session = await db.select().from(schema.workSessions).where(and(eq(schema.workSessions.id, sessionId), eq(schema.workSessions.projectId, projectId))).get();
  if (!session) throw new Error('Work session not found in project');
  if (session.status === 'completed' || session.status === 'cancelled') throw new Error(`Cannot request review from ${session.status} work session`);
  return session;
}
async function requireTarget(projectId: string, targetType: string, targetId?: string) {
  if (!targetId) return;
  if (targetType === 'page') {
    const page = await db.select({ id: schema.pages.id, status: schema.pages.status }).from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.id, targetId))).get();
    if (!page) throw new Error('Review target page not found'); if (page.status !== 'proposed') throw new Error('Only proposed pages should be sent for review');
  }
  if (targetType === 'policy') {
    const policy = await db.select({ id: schema.policyRules.id, status: schema.policyRules.status }).from(schema.policyRules).where(and(eq(schema.policyRules.projectId, projectId), eq(schema.policyRules.id, targetId))).get();
    if (!policy) throw new Error('Review target policy not found'); if (policy.status !== 'candidate') throw new Error('Only candidate policies should be sent for review');
  }
}
function normalize(row: typeof schema.reviewRequests.$inferSelect) { return { ...row, options: parseOptions(row.optionsJson), optionsJson: undefined }; }

function synchronizeResolvedReview(workSessionId: string, remaining: number, t: string) {
  if (remaining) return;
  const operationProjects = sqlite.prepare("SELECT operation_id,project_id FROM operation_projects WHERE work_session_id=? AND status='awaiting_review'").all(workSessionId) as Array<{ operation_id: string; project_id: string }>;
  for (const child of operationProjects) {
    sqlite.prepare("UPDATE operation_projects SET status='running',blocker=NULL,blocker_class=NULL,last_progress_at=?,updated_at=? WHERE operation_id=? AND project_id=?").run(t, t, child.operation_id, child.project_id);
    const stillPaused = sqlite.prepare("SELECT 1 FROM operation_projects WHERE operation_id=? AND status IN ('blocked','awaiting_review') LIMIT 1").get(child.operation_id);
    if (!stillPaused) sqlite.prepare("UPDATE operation_requests SET status='active',completed_at=NULL,updated_at=? WHERE id=?").run(t, child.operation_id);
  }
}

export const reviewCommands = {
  list: async (ctx: CommandContext, input: { projectId: string; status?: string; sessionId?: string; limit?: number }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'review.list', input, async () => {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200)); const conditions = [eq(schema.reviewRequests.projectId, input.projectId)];
    if (input.status) conditions.push(eq(schema.reviewRequests.status, input.status)); if (input.sessionId) conditions.push(eq(schema.reviewRequests.workSessionId, input.sessionId));
    const rows = await db.select().from(schema.reviewRequests).where(and(...conditions)).orderBy(desc(schema.reviewRequests.createdAt)).limit(limit); return rows.map(normalize);
  }),

  request: async (ctx: CommandContext, input: { projectId: string; sessionId?: string; targetType: string; targetId?: string; title: string; question?: string; options?: string[] }) => withRun(projectCtx(ctx, input.projectId, input.sessionId), 'review.request', input, async () => {
    const sessionId = input.sessionId ?? ctx.workSessionId; if (!sessionId) throw new Error('Review request requires a work session');
    const session = await requireSession(input.projectId, sessionId); await requireTarget(input.projectId, input.targetType, input.targetId);
    const title = input.title.trim(); if (!title) throw new Error('Review request title is required');
    const options = [...new Set((input.options?.length ? input.options : defaultOptions(input.targetType)).map(value => value.trim()).filter(Boolean))].slice(0, 8); if (options.length < 2) throw new Error('Review request needs at least two resolution options');
    const t = now(); const row = { id: id(), projectId: input.projectId, workSessionId: session.id, targetType: input.targetType, targetId: input.targetId ?? null, title, question: input.question?.trim() || null, optionsJson: JSON.stringify(options), status: 'open', resolution: null, reason: null, requestedBy: ctx.actorId ?? ctx.actor, createdAt: t, resolvedAt: null };
    await db.insert(schema.reviewRequests).values(row); const checkpointSummary = `Human review requested: ${title}`;
    await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: session.id, state: 'awaiting_review', summary: checkpointSummary, nextAction: title, createdAt: t });
    await db.update(schema.workSessions).set({ status: 'awaiting_review', summary: checkpointSummary, lastNextAction: title, updatedAt: t }).where(eq(schema.workSessions.id, session.id));
    sqlite.prepare("UPDATE operation_projects SET status='awaiting_review',blocker_class='human_decision_required',updated_at=? WHERE work_session_id=? AND status!='completed'").run(t, session.id);
    return normalize(row);
  }),

  resolve: async (ctx: CommandContext, input: { projectId: string; reviewId: string; resolution: string; reason?: string; overrideConflicts?: boolean }) => withRun(projectCtx(ctx, input.projectId), 'review.resolve', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Review resolution requires a human actor');
    const request = await db.select().from(schema.reviewRequests).where(and(eq(schema.reviewRequests.id, input.reviewId), eq(schema.reviewRequests.projectId, input.projectId))).get();
    if (!request) throw new Error('Review request not found'); if (request.status !== 'open') throw new Error('Review request is already resolved');
    const options = parseOptions(request.optionsJson); if (!options.includes(input.resolution)) throw new Error(`Resolution must be one of: ${options.join(', ')}`);
    const targetCtx = projectCtx(ctx, input.projectId, request.workSessionId ?? undefined); let targetResult: unknown = null;
    if (request.targetType === 'page' && request.targetId) {
      if (!['approved', 'rejected', 'needs_edit'].includes(input.resolution)) throw new Error('Unsupported page review resolution');
      targetResult = await planningCommands.pageReview(targetCtx, { projectId: input.projectId, pageId: request.targetId, verdict: input.resolution as 'approved' | 'rejected' | 'needs_edit', reason: input.reason, overrideConflicts: input.overrideConflicts });
    } else if (request.targetType === 'policy' && request.targetId) {
      if (!['active', 'rejected'].includes(input.resolution)) throw new Error('Unsupported policy review resolution');
      targetResult = await policyCommands.review(targetCtx, { projectId: input.projectId, policyId: request.targetId, verdict: input.resolution as 'active' | 'rejected', reason: input.reason });
    } else {
      const decision = { id: id(), projectId: input.projectId, actor: ctx.actor, action: 'review.resolve', targetType: request.targetType, targetId: request.targetId, verdict: input.resolution, reason: input.reason?.trim() || null, metadataJson: JSON.stringify({ reviewRequestId: request.id, title: request.title }), createdAt: now() };
      await db.insert(schema.decisions).values(decision); targetResult = { decisionId: decision.id };
    }
    const t = now(); await db.update(schema.reviewRequests).set({ status: 'resolved', resolution: input.resolution, reason: input.reason?.trim() || null, resolvedAt: t }).where(eq(schema.reviewRequests.id, request.id));
    if (request.workSessionId) {
      const remaining = Number((await db.select({ value: count() }).from(schema.reviewRequests).where(and(eq(schema.reviewRequests.workSessionId, request.workSessionId), eq(schema.reviewRequests.status, 'open'))).get())?.value ?? 0);
      const summary = `Human review resolved: ${request.title} → ${input.resolution}`;
      await db.insert(schema.workCheckpoints).values({ id: id(), sessionId: request.workSessionId, state: remaining ? 'awaiting_review' : 'working', summary, nextAction: remaining ? 'Resolve remaining review requests' : 'Re-read work_context and continue', createdAt: t });
      await db.update(schema.workSessions).set({ status: remaining ? 'awaiting_review' : 'running', summary, lastNextAction: remaining ? 'Resolve remaining review requests' : 'Re-read work_context and continue', updatedAt: t }).where(eq(schema.workSessions.id, request.workSessionId));
      synchronizeResolvedReview(request.workSessionId, remaining, t);
    }
    const updated = await db.select().from(schema.reviewRequests).where(eq(schema.reviewRequests.id, request.id)).get(); return { review: updated ? normalize(updated) : null, targetResult };
  })
};
