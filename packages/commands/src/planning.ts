import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const slugify = (value: string) => normalize(value).replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '');
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id();
  const started = Date.now();
  const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({
      id: runId,
      projectId: ctx.projectId ?? null,
      workSessionId: ctx.workSessionId ?? null,
      actor: ctx.actor,
      actorId: ctx.actorId ?? null,
      command,
      status: 'succeeded',
      inputJson: JSON.stringify(input ?? null),
      outputJson: JSON.stringify(output ?? null),
      durationMs: Date.now() - started,
      createdAt
    });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({
      id: runId,
      projectId: ctx.projectId ?? null,
      workSessionId: ctx.workSessionId ?? null,
      actor: ctx.actor,
      actorId: ctx.actorId ?? null,
      command,
      status: 'failed',
      inputJson: JSON.stringify(input ?? null),
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      createdAt
    });
    throw error;
  }
}

async function requireCluster(projectId: string, clusterId: string) {
  const cluster = await db.select().from(schema.clusters).where(and(eq(schema.clusters.id, clusterId), eq(schema.clusters.projectId, projectId))).get();
  if (!cluster) throw new Error('Cluster not found in project');
  if (cluster.status !== 'active') throw new Error('Cluster is not active');
  return cluster;
}

async function requireKeywords(projectId: string, keywordIds: string[]) {
  const unique = [...new Set(keywordIds.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), inArray(schema.keywords.id, unique)));
  if (rows.length !== unique.length) throw new Error('One or more keywords do not belong to the project');
  const rejected = rows.filter(row => row.status === 'rejected');
  if (rejected.length) throw new Error(`Rejected keywords cannot be targeted: ${rejected.map(row => row.text).join(', ')}`);
  return rows;
}

async function requireSources(projectId: string, sourceIds: string[]) {
  const unique = [...new Set(sourceIds.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await db.select({ id: schema.sources.id }).from(schema.sources).where(and(eq(schema.sources.projectId, projectId), inArray(schema.sources.id, unique)));
  if (rows.length !== unique.length) throw new Error('One or more evidence sources do not belong to the project');
  return unique;
}

async function targetConflictWarnings(projectId: string, keywordIds: string[], clusterId?: string | null, excludePageId?: string) {
  const warnings: Array<Record<string, unknown>> = [];
  if (keywordIds.length) {
    const base = and(eq(schema.pages.projectId, projectId), ne(schema.pages.status, 'archived'), inArray(schema.pageKeywords.keywordId, keywordIds));
    const existing = await db.select({
      keywordId: schema.pageKeywords.keywordId,
      pageId: schema.pages.id,
      pageTitle: schema.pages.title,
      pageStatus: schema.pages.status,
      role: schema.pageKeywords.role
    }).from(schema.pageKeywords)
      .innerJoin(schema.pages, eq(schema.pageKeywords.pageId, schema.pages.id))
      .where(excludePageId ? and(base, ne(schema.pages.id, excludePageId)) : base);
    for (const row of existing) warnings.push({ type: 'keyword_target_overlap', severity: 'high', ...row });
  }
  if (clusterId) {
    const base = and(eq(schema.pages.projectId, projectId), eq(schema.pages.clusterId, clusterId), ne(schema.pages.status, 'archived'));
    const siblings = await db.select({ pageId: schema.pages.id, pageTitle: schema.pages.title, pageStatus: schema.pages.status })
      .from(schema.pages)
      .where(excludePageId ? and(base, ne(schema.pages.id, excludePageId)) : base);
    for (const row of siblings) warnings.push({ type: 'same_cluster_page', severity: 'medium', ...row });
  }
  return warnings;
}

export const planningCommands = {
  clusterBulkAssign: async (ctx: CommandContext, input: { projectId: string; clusterId: string; keywordIds: string[] }) => withRun(projectCtx(ctx, input.projectId), 'cluster.bulk_assign', input, async () => {
    await requireCluster(input.projectId, input.clusterId);
    const keywords = await requireKeywords(input.projectId, input.keywordIds);
    for (const keyword of keywords) {
      await db.delete(schema.clusterKeywords).where(eq(schema.clusterKeywords.keywordId, keyword.id));
      await db.insert(schema.clusterKeywords).values({ clusterId: input.clusterId, keywordId: keyword.id });
    }
    return { clusterId: input.clusterId, assigned: keywords.length, keywordIds: keywords.map(row => row.id) };
  }),

  pagePlan: async (ctx: CommandContext, input: {
    projectId: string;
    title: string;
    slug?: string;
    clusterId?: string;
    kind?: string;
    rationale?: string;
    primaryKeywordId?: string;
    secondaryKeywordIds?: string[];
    sourceIds?: string[];
  }) => withRun(projectCtx(ctx, input.projectId), 'page.plan', input, async () => {
    const title = input.title.trim();
    if (!title) throw new Error('Page title is required');
    if (input.clusterId) await requireCluster(input.projectId, input.clusterId);
    const primary = input.primaryKeywordId ? [input.primaryKeywordId] : [];
    const secondary = (input.secondaryKeywordIds ?? []).filter(keywordId => keywordId !== input.primaryKeywordId);
    const keywordIds = [...new Set([...primary, ...secondary])];
    const keywords = await requireKeywords(input.projectId, keywordIds);
    const sourceIds = await requireSources(input.projectId, input.sourceIds ?? []);
    const warnings = await targetConflictWarnings(input.projectId, keywordIds, input.clusterId);
    const t = now();
    const page = {
      id: id(),
      projectId: input.projectId,
      clusterId: input.clusterId ?? null,
      title,
      slug: input.slug?.trim() || slugify(title),
      kind: input.kind ?? 'article',
      status: 'proposed',
      rationale: input.rationale?.trim() || null,
      evidenceJson: sourceIds.length ? JSON.stringify({ sourceIds }) : null,
      createdAt: t,
      updatedAt: t
    };
    await db.insert(schema.pages).values(page);
    if (keywords.length) {
      await db.insert(schema.pageKeywords).values(keywords.map(keyword => ({
        pageId: page.id,
        keywordId: keyword.id,
        role: keyword.id === input.primaryKeywordId ? 'primary' : 'secondary'
      })));
    }
    return {
      page,
      targets: keywords.map(keyword => ({ id: keyword.id, text: keyword.text, role: keyword.id === input.primaryKeywordId ? 'primary' : 'secondary' })),
      sourceIds,
      warnings
    };
  }),

  pageTargets: async (ctx: CommandContext, input: { projectId: string; pageId: string }) => withRun(projectCtx(ctx, input.projectId), 'page.targets', input, async () => {
    const page = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, input.projectId), eq(schema.pages.id, input.pageId))).get();
    if (!page) throw new Error('Page not found');
    const targets = await db.select({
      keywordId: schema.keywords.id,
      text: schema.keywords.text,
      role: schema.pageKeywords.role,
      avgMonthly: schema.keywords.avgMonthly,
      competition: schema.keywords.competition,
      gscImpressions: schema.keywords.gscImpressions,
      gscPosition: schema.keywords.gscPosition
    }).from(schema.pageKeywords)
      .innerJoin(schema.keywords, eq(schema.pageKeywords.keywordId, schema.keywords.id))
      .where(eq(schema.pageKeywords.pageId, input.pageId));
    return { page, targets, evidence: page.evidenceJson ? JSON.parse(page.evidenceJson) : null };
  }),

  pageCannibalization: async (ctx: CommandContext, input: { projectId: string; limit?: number }) => withRun(projectCtx(ctx, input.projectId), 'page.cannibalization', input, async () => {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const targetRows = await db.select({
      keywordId: schema.keywords.id,
      keyword: schema.keywords.text,
      pageId: schema.pages.id,
      pageTitle: schema.pages.title,
      pageStatus: schema.pages.status,
      role: schema.pageKeywords.role
    }).from(schema.pageKeywords)
      .innerJoin(schema.pages, eq(schema.pageKeywords.pageId, schema.pages.id))
      .innerJoin(schema.keywords, eq(schema.pageKeywords.keywordId, schema.keywords.id))
      .where(and(eq(schema.pages.projectId, input.projectId), ne(schema.pages.status, 'archived')))
      .orderBy(desc(schema.keywords.avgMonthly));

    const byKeyword = new Map<string, typeof targetRows>();
    for (const row of targetRows) byKeyword.set(row.keywordId, [...(byKeyword.get(row.keywordId) ?? []), row]);
    const exactTargetConflicts = [...byKeyword.values()]
      .filter(rows => new Set(rows.map(row => row.pageId)).size > 1)
      .slice(0, limit)
      .map(rows => ({
        keywordId: rows[0].keywordId,
        keyword: rows[0].keyword,
        severity: rows.some(row => row.role === 'primary') ? 'high' : 'medium',
        pages: rows.map(row => ({ id: row.pageId, title: row.pageTitle, status: row.pageStatus, role: row.role }))
      }));

    const pageRows = await db.select({
      pageId: schema.pages.id,
      pageTitle: schema.pages.title,
      pageStatus: schema.pages.status,
      clusterId: schema.pages.clusterId,
      clusterTitle: schema.clusters.title
    }).from(schema.pages)
      .leftJoin(schema.clusters, eq(schema.pages.clusterId, schema.clusters.id))
      .where(and(eq(schema.pages.projectId, input.projectId), ne(schema.pages.status, 'archived')));
    const byCluster = new Map<string, typeof pageRows>();
    for (const row of pageRows) if (row.clusterId) byCluster.set(row.clusterId, [...(byCluster.get(row.clusterId) ?? []), row]);
    const sameClusterConflicts = [...byCluster.values()]
      .filter(rows => rows.length > 1)
      .slice(0, limit)
      .map(rows => ({
        clusterId: rows[0].clusterId,
        clusterTitle: rows[0].clusterTitle,
        severity: 'medium',
        pages: rows.map(row => ({ id: row.pageId, title: row.pageTitle, status: row.pageStatus }))
      }));

    return { exactTargetConflicts, sameClusterConflicts, checkedPages: pageRows.length, checkedTargets: targetRows.length };
  }),

  pageReview: async (ctx: CommandContext, input: {
    projectId: string;
    pageId: string;
    verdict: 'approved' | 'rejected' | 'needs_edit';
    reason?: string;
    overrideConflicts?: boolean;
  }) => withRun(projectCtx(ctx, input.projectId), 'page.review', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Page review requires a human actor');
    const page = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, input.projectId), eq(schema.pages.id, input.pageId))).get();
    if (!page) throw new Error('Page not found');
    const targets = await db.select({ keywordId: schema.pageKeywords.keywordId }).from(schema.pageKeywords).where(eq(schema.pageKeywords.pageId, page.id));
    const warnings = await targetConflictWarnings(input.projectId, targets.map(row => row.keywordId), page.clusterId, page.id);
    const blocking = warnings.filter(warning => warning.type === 'keyword_target_overlap');
    if (input.verdict === 'approved' && blocking.length && !input.overrideConflicts) {
      throw new Error(`Approval blocked by ${blocking.length} exact keyword target overlap(s). Resolve them or explicitly override with a reason.`);
    }
    if (input.verdict === 'approved' && input.overrideConflicts && !input.reason?.trim()) throw new Error('Conflict override requires a reason');
    const status = input.verdict === 'approved' ? 'approved' : input.verdict === 'rejected' ? 'archived' : 'proposed';
    await db.update(schema.pages).set({ status, updatedAt: now() }).where(eq(schema.pages.id, page.id));
    const decision = {
      id: id(),
      projectId: input.projectId,
      actor: ctx.actor,
      action: 'page.review',
      targetType: 'page',
      targetId: page.id,
      verdict: input.verdict,
      reason: input.reason?.trim() || null,
      metadataJson: JSON.stringify({ previousStatus: page.status, status, overrideConflicts: Boolean(input.overrideConflicts), warnings }),
      createdAt: now()
    };
    await db.insert(schema.decisions).values(decision);
    return { pageId: page.id, status, verdict: input.verdict, warnings, decisionId: decision.id };
  })
};
