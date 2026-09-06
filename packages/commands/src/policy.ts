import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id();
  const started = Date.now();
  const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({
      id: runId, projectId: ctx.projectId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null,
      command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null),
      durationMs: Date.now() - started, createdAt
    });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({
      id: runId, projectId: ctx.projectId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null,
      command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started, createdAt
    });
    throw error;
  }
}

function parseIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function requireDecisions(projectId: string, decisionIds: string[]) {
  const unique = [...new Set(decisionIds.filter(Boolean))];
  if (!unique.length) throw new Error('At least one source decision is required');
  if (unique.length > 30) throw new Error('A policy candidate can cite at most 30 decisions');
  const rows = await db.select().from(schema.decisions).where(and(eq(schema.decisions.projectId, projectId), inArray(schema.decisions.id, unique)));
  if (rows.length !== unique.length) throw new Error('One or more source decisions do not belong to the project');
  return rows;
}

export const policyCommands = {
  context: async (ctx: CommandContext, projectId: string, recentDecisionLimit = 30) => withRun(projectCtx(ctx, projectId), 'policy.context', { projectId, recentDecisionLimit }, async () => {
    const limit = Math.max(1, Math.min(recentDecisionLimit, 100));
    const [rules, recentDecisions] = await Promise.all([
      db.select().from(schema.policyRules).where(eq(schema.policyRules.projectId, projectId)).orderBy(desc(schema.policyRules.updatedAt)).limit(100),
      db.select({
        id: schema.decisions.id,
        action: schema.decisions.action,
        targetType: schema.decisions.targetType,
        targetId: schema.decisions.targetId,
        verdict: schema.decisions.verdict,
        reason: schema.decisions.reason,
        createdAt: schema.decisions.createdAt
      }).from(schema.decisions).where(eq(schema.decisions.projectId, projectId)).orderBy(desc(schema.decisions.createdAt)).limit(limit)
    ]);
    const normalized = rules.map(rule => ({ ...rule, sourceDecisionIds: parseIds(rule.sourceDecisionIdsJson), sourceDecisionIdsJson: undefined }));
    return {
      active: normalized.filter(rule => rule.status === 'active'),
      candidates: normalized.filter(rule => rule.status === 'candidate'),
      retired: normalized.filter(rule => rule.status === 'retired').slice(0, 20),
      recentDecisions
    };
  }),

  list: async (ctx: CommandContext, projectId: string, status?: string) => withRun(projectCtx(ctx, projectId), 'policy.list', { projectId, status }, async () => {
    const where = status ? and(eq(schema.policyRules.projectId, projectId), eq(schema.policyRules.status, status)) : eq(schema.policyRules.projectId, projectId);
    const rows = await db.select().from(schema.policyRules).where(where).orderBy(desc(schema.policyRules.updatedAt));
    return rows.map(rule => ({ ...rule, sourceDecisionIds: parseIds(rule.sourceDecisionIdsJson), sourceDecisionIdsJson: undefined }));
  }),

  propose: async (ctx: CommandContext, input: { projectId: string; scope?: string; rule: string; rationale?: string; sourceDecisionIds: string[] }) => withRun(projectCtx(ctx, input.projectId), 'policy.propose', input, async () => {
    const rule = input.rule.trim();
    if (!rule) throw new Error('Policy rule is required');
    if (rule.length > 1000) throw new Error('Policy rule is too long');
    const decisions = await requireDecisions(input.projectId, input.sourceDecisionIds);
    const t = now();
    const row = {
      id: id(),
      projectId: input.projectId,
      scope: input.scope?.trim() || 'general',
      rule,
      rationale: input.rationale?.trim() || null,
      status: 'candidate',
      sourceDecisionIdsJson: JSON.stringify(decisions.map(decision => decision.id)),
      proposedBy: ctx.actorId ?? ctx.actor,
      reviewedBy: null,
      createdAt: t,
      updatedAt: t
    };
    await db.insert(schema.policyRules).values(row);
    return { ...row, sourceDecisionIds: decisions.map(decision => decision.id), sourceDecisionIdsJson: undefined };
  }),

  review: async (ctx: CommandContext, input: { projectId: string; policyId: string; verdict: 'active' | 'rejected'; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'policy.review', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Policy review requires a human actor');
    const rule = await db.select().from(schema.policyRules).where(and(eq(schema.policyRules.projectId, input.projectId), eq(schema.policyRules.id, input.policyId))).get();
    if (!rule) throw new Error('Policy rule not found');
    if (rule.status !== 'candidate') throw new Error('Only candidate policies can be reviewed');
    if (input.verdict === 'rejected' && !input.reason?.trim()) throw new Error('Rejecting a policy requires a reason');
    const t = now();
    await db.update(schema.policyRules).set({ status: input.verdict, reviewedBy: ctx.actorId ?? 'human', updatedAt: t }).where(eq(schema.policyRules.id, rule.id));
    const decision = {
      id: id(), projectId: input.projectId, actor: ctx.actor, action: 'policy.review', targetType: 'policy', targetId: rule.id,
      verdict: input.verdict, reason: input.reason?.trim() || null,
      metadataJson: JSON.stringify({ scope: rule.scope, rule: rule.rule, sourceDecisionIds: parseIds(rule.sourceDecisionIdsJson) }), createdAt: t
    };
    await db.insert(schema.decisions).values(decision);
    return { id: rule.id, status: input.verdict, decisionId: decision.id };
  }),

  retire: async (ctx: CommandContext, input: { projectId: string; policyId: string; reason: string }) => withRun(projectCtx(ctx, input.projectId), 'policy.retire', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Policy retirement requires a human actor');
    const reason = input.reason.trim();
    if (!reason) throw new Error('Retiring a policy requires a reason');
    const rule = await db.select().from(schema.policyRules).where(and(eq(schema.policyRules.projectId, input.projectId), eq(schema.policyRules.id, input.policyId))).get();
    if (!rule) throw new Error('Policy rule not found');
    if (rule.status !== 'active') throw new Error('Only active policies can be retired');
    const t = now();
    await db.update(schema.policyRules).set({ status: 'retired', reviewedBy: ctx.actorId ?? 'human', updatedAt: t }).where(eq(schema.policyRules.id, rule.id));
    const decision = {
      id: id(), projectId: input.projectId, actor: ctx.actor, action: 'policy.retire', targetType: 'policy', targetId: rule.id,
      verdict: 'retired', reason, metadataJson: JSON.stringify({ scope: rule.scope, rule: rule.rule }), createdAt: t
    };
    await db.insert(schema.decisions).values(decision);
    return { id: rule.id, status: 'retired', decisionId: decision.id };
  })
};
