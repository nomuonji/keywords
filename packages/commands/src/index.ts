import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext, ProjectSnapshot, TaskStatus } from '@keywords/domain';
import { researchCommands, sourceCommands } from './research.js';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const slugify = (value: string) => normalize(value).replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '');

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

function projectCtx(ctx: CommandContext, projectId: string): CommandContext { return { ...ctx, projectId }; }

export const commands = {
  project: {
    list: async (ctx: CommandContext) => withRun(ctx, 'project.list', {}, async () => db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt))),
    create: async (ctx: CommandContext, input: { name: string; domain?: string }) => withRun(ctx, 'project.create', input, async () => {
      const createdAt = now();
      const row = { id: id(), name: input.name.trim(), domain: input.domain?.trim() || null, createdAt, updatedAt: createdAt };
      if (!row.name) throw new Error('Project name is required');
      await db.insert(schema.projects).values(row);
      return row;
    }),
    delete: async (ctx: CommandContext, projectId: string) => withRun(ctx, 'project.delete', { projectId }, async () => {
      const project = await db.select({ id: schema.projects.id, name: schema.projects.name, domain: schema.projects.domain }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
      if (!project) throw new Error('Project not found');
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
      return { deleted: true, project };
    }),
    snapshot: async (ctx: CommandContext, projectId: string): Promise<ProjectSnapshot> => withRun(projectCtx(ctx, projectId), 'project.snapshot', { projectId }, async () => {
      const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
      if (!project) throw new Error('Project not found');
      const topicsCount = Number((await db.select({ value: count() }).from(schema.topics).where(eq(schema.topics.projectId, projectId)).get())?.value ?? 0);
      const keywordsCount = Number((await db.select({ value: count() }).from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'))).get())?.value ?? 0);
      const unclustered = Number((await db.select({ value: count() }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'), isNull(schema.clusterKeywords.keywordId))).get())?.value ?? 0);
      const clustersCount = Number((await db.select({ value: count() }).from(schema.clusters).where(and(eq(schema.clusters.projectId, projectId), eq(schema.clusters.status, 'active'))).get())?.value ?? 0);
      const proposedPages = Number((await db.select({ value: count() }).from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.status, 'proposed'))).get())?.value ?? 0);
      const openTasks = Number((await db.select({ value: count() }).from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), ne(schema.tasks.status, 'done'))).get())?.value ?? 0);
      const openInsights = Number((await db.select({ value: count() }).from(schema.insights).where(and(eq(schema.insights.projectId, projectId), eq(schema.insights.status, 'open'))).get())?.value ?? 0);
      const recentRuns = await db.select({ id: schema.runs.id, actor: schema.runs.actor, command: schema.runs.command, status: schema.runs.status, createdAt: schema.runs.createdAt, durationMs: schema.runs.durationMs }).from(schema.runs).where(eq(schema.runs.projectId, projectId)).orderBy(desc(schema.runs.createdAt)).limit(12);
      return { project: { id: project.id, name: project.name, domain: project.domain }, counts: { topics: topicsCount, keywords: keywordsCount, unclusteredKeywords: unclustered, clusters: clustersCount, proposedPages, openTasks, openInsights }, recentRuns };
    })
  },
  topic: {
    list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'topic.list', { projectId }, async () => db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(schema.topics.title)),
    create: async (ctx: CommandContext, input: { projectId: string; title: string }) => withRun(projectCtx(ctx, input.projectId), 'topic.create', input, async () => {
      const t = now(); const row = { id: id(), projectId: input.projectId, title: input.title.trim(), status: 'active', createdAt: t, updatedAt: t };
      await db.insert(schema.topics).values(row); return row;
    })
  },
  keyword: {
    list: async (ctx: CommandContext, projectId: string, status?: string) => withRun(projectCtx(ctx, projectId), 'keyword.list', { projectId, status }, async () => {
      const where = status ? and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.status, status)) : eq(schema.keywords.projectId, projectId);
      return db.select({ keyword: schema.keywords, clusterId: schema.clusterKeywords.clusterId }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(where).orderBy(desc(schema.keywords.avgMonthly), schema.keywords.text);
    }),
    create: async (ctx: CommandContext, input: { projectId: string; text: string; source?: string; topicId?: string; avgMonthly?: number; competition?: number }) => withRun(projectCtx(ctx, input.projectId), 'keyword.create', input, async () => {
      const t = now(); const n = normalize(input.text); if (!n) throw new Error('Keyword text is required');
      const existing = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, input.projectId), eq(schema.keywords.normalized, n))).get();
      if (existing) return existing;
      const row = { id: id(), projectId: input.projectId, topicId: input.topicId ?? null, text: input.text.trim(), normalized: n, source: input.source ?? ctx.actor, status: 'active', avgMonthly: input.avgMonthly ?? null, competition: input.competition ?? null, cpcMicros: null, createdAt: t, updatedAt: t };
      await db.insert(schema.keywords).values(row); return row;
    }),
    reject: async (ctx: CommandContext, input: { projectId: string; keywordId: string; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'keyword.reject', input, async () => {
      await db.update(schema.keywords).set({ status: 'rejected', updatedAt: now() }).where(and(eq(schema.keywords.id, input.keywordId), eq(schema.keywords.projectId, input.projectId)));
      if (input.reason) await db.insert(schema.decisions).values({ id: id(), projectId: input.projectId, actor: ctx.actor, action: 'keyword.reject', targetType: 'keyword', targetId: input.keywordId, verdict: 'rejected', reason: input.reason, metadataJson: null, createdAt: now() });
      return { id: input.keywordId, status: 'rejected' };
    })
  },
  cluster: {
    list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'cluster.list', { projectId }, async () => db.select({ cluster: schema.clusters, keywordCount: count(schema.clusterKeywords.keywordId) }).from(schema.clusters).leftJoin(schema.clusterKeywords, eq(schema.clusters.id, schema.clusterKeywords.clusterId)).where(eq(schema.clusters.projectId, projectId)).groupBy(schema.clusters.id).orderBy(schema.clusters.title)),
    create: async (ctx: CommandContext, input: { projectId: string; title: string; intent?: string; keywordIds?: string[] }) => withRun(projectCtx(ctx, input.projectId), 'cluster.create', input, async () => {
      const t = now(); const row = { id: id(), projectId: input.projectId, title: input.title.trim(), intent: input.intent ?? 'mixed', status: 'active', createdAt: t, updatedAt: t };
      await db.insert(schema.clusters).values(row);
      if (input.keywordIds?.length) await db.insert(schema.clusterKeywords).values(input.keywordIds.map(keywordId => ({ clusterId: row.id, keywordId }))).onConflictDoNothing();
      return row;
    }),
    addKeyword: async (ctx: CommandContext, input: { projectId: string; clusterId: string; keywordId: string }) => withRun(projectCtx(ctx, input.projectId), 'cluster.add_keyword', input, async () => {
      await db.delete(schema.clusterKeywords).where(eq(schema.clusterKeywords.keywordId, input.keywordId));
      await db.insert(schema.clusterKeywords).values({ clusterId: input.clusterId, keywordId: input.keywordId });
      return { clusterId: input.clusterId, keywordId: input.keywordId };
    }),
    merge: async (ctx: CommandContext, input: { projectId: string; targetClusterId: string; sourceClusterIds: string[] }) => withRun(projectCtx(ctx, input.projectId), 'cluster.merge', input, async () => {
      const sources = input.sourceClusterIds.filter(x => x !== input.targetClusterId); if (!sources.length) return { targetClusterId: input.targetClusterId, moved: 0 };
      const rows = await db.select().from(schema.clusterKeywords).where(inArray(schema.clusterKeywords.clusterId, sources));
      for (const row of rows) { await db.delete(schema.clusterKeywords).where(eq(schema.clusterKeywords.keywordId, row.keywordId)); await db.insert(schema.clusterKeywords).values({ clusterId: input.targetClusterId, keywordId: row.keywordId }).onConflictDoNothing(); }
      await db.update(schema.clusters).set({ status: 'archived', updatedAt: now() }).where(and(eq(schema.clusters.projectId, input.projectId), inArray(schema.clusters.id, sources)));
      return { targetClusterId: input.targetClusterId, moved: rows.length, archived: sources };
    })
  },
  page: {
    list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'page.list', { projectId }, async () => db.select().from(schema.pages).where(eq(schema.pages.projectId, projectId)).orderBy(desc(schema.pages.updatedAt))),
    propose: async (ctx: CommandContext, input: { projectId: string; title: string; slug?: string; clusterId?: string; kind?: string }) => withRun(projectCtx(ctx, input.projectId), 'page.propose', input, async () => {
      const t = now(); const row = { id: id(), projectId: input.projectId, clusterId: input.clusterId ?? null, title: input.title.trim(), slug: input.slug?.trim() || slugify(input.title), kind: input.kind ?? 'article', status: 'proposed', createdAt: t, updatedAt: t };
      await db.insert(schema.pages).values(row); return row;
    }),
    setStatus: async (ctx: CommandContext, input: { projectId: string; pageId: string; status: 'proposed' | 'approved' | 'archived' }) => withRun(projectCtx(ctx, input.projectId), 'page.set_status', input, async () => {
      await db.update(schema.pages).set({ status: input.status, updatedAt: now() }).where(and(eq(schema.pages.projectId, input.projectId), eq(schema.pages.id, input.pageId))); return { id: input.pageId, status: input.status };
    })
  },
  source: sourceCommands,
  research: researchCommands,
  insight: {
    list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'insight.list', { projectId }, async () => db.select().from(schema.insights).where(eq(schema.insights.projectId, projectId)).orderBy(desc(schema.insights.createdAt))),
    create: async (ctx: CommandContext, input: { projectId: string; type: string; text: string; confidence?: number; sourceId?: string }) => withRun(projectCtx(ctx, input.projectId), 'insight.create', input, async () => {
      const row = { id: id(), projectId: input.projectId, type: input.type, text: input.text.trim(), confidence: input.confidence ?? null, status: 'open', sourceId: input.sourceId ?? null, createdBy: ctx.actor, createdAt: now() }; await db.insert(schema.insights).values(row); return row;
    })
  },
  task: {
    list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'task.list', { projectId }, async () => db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId)).orderBy(desc(schema.tasks.priority), desc(schema.tasks.updatedAt))),
    create: async (ctx: CommandContext, input: { projectId: string; title: string; description?: string; priority?: number; assigneeType?: string; relatedType?: string; relatedId?: string }) => withRun(projectCtx(ctx, input.projectId), 'task.create', input, async () => {
      const t = now(); const row = { id: id(), projectId: input.projectId, title: input.title.trim(), description: input.description ?? null, status: 'todo', priority: input.priority ?? 50, assigneeType: input.assigneeType ?? 'agent', relatedType: input.relatedType ?? null, relatedId: input.relatedId ?? null, createdAt: t, updatedAt: t }; await db.insert(schema.tasks).values(row); return row;
    }),
    setStatus: async (ctx: CommandContext, input: { projectId: string; taskId: string; status: TaskStatus }) => withRun(projectCtx(ctx, input.projectId), 'task.set_status', input, async () => {
      await db.update(schema.tasks).set({ status: input.status, updatedAt: now() }).where(and(eq(schema.tasks.projectId, input.projectId), eq(schema.tasks.id, input.taskId))); return { id: input.taskId, status: input.status };
    })
  },
  decision: {
    list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'decision.list', { projectId }, async () => db.select().from(schema.decisions).where(eq(schema.decisions.projectId, projectId)).orderBy(desc(schema.decisions.createdAt)).limit(100)),
    record: async (ctx: CommandContext, input: { projectId: string; action: string; targetType: string; targetId?: string; verdict: string; reason?: string; metadata?: unknown }) => withRun(projectCtx(ctx, input.projectId), 'decision.record', input, async () => {
      const row = { id: id(), projectId: input.projectId, actor: ctx.actor, action: input.action, targetType: input.targetType, targetId: input.targetId ?? null, verdict: input.verdict, reason: input.reason ?? null, metadataJson: input.metadata ? JSON.stringify(input.metadata) : null, createdAt: now() }; await db.insert(schema.decisions).values(row); return row;
    })
  },
  run: {
    list: async (_ctx: CommandContext, projectId: string) => db.select().from(schema.runs).where(eq(schema.runs.projectId, projectId)).orderBy(desc(schema.runs.createdAt)).limit(100)
  }
};

export type Commands = typeof commands;
