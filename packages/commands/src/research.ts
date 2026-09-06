import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { fetchWebDocument, googleAdsKeywordIdeas, searchConsoleQuery, searchSerp } from '@keywords/research';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id();
  const started = Date.now();
  const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt });
    throw error;
  }
}

const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function saveSource(input: { projectId: string; type: string; label: string; url?: string | null; metadata?: unknown }) {
  const row = { id: id(), projectId: input.projectId, type: input.type, label: input.label.trim(), url: input.url?.trim() || null, metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata), createdAt: now() };
  if (!row.label) throw new Error('Source label is required');
  await db.insert(schema.sources).values(row);
  return row;
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

async function upsertKeyword(projectId: string, input: { text: string; source: string; avgMonthly?: number | null; competition?: number | null; cpcMicros?: number | null }) {
  const normalized = normalize(input.text);
  if (!normalized) return { created: false, id: null };
  const existing = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, normalized))).get();
  if (existing) {
    await db.update(schema.keywords).set({
      avgMonthly: input.avgMonthly ?? existing.avgMonthly,
      competition: input.competition ?? existing.competition,
      cpcMicros: input.cpcMicros ?? existing.cpcMicros,
      updatedAt: now()
    }).where(eq(schema.keywords.id, existing.id));
    return { created: false, id: existing.id };
  }
  const createdAt = now();
  const row = { id: id(), projectId, topicId: null, text: input.text.trim(), normalized, source: input.source, status: 'active', avgMonthly: input.avgMonthly ?? null, competition: input.competition ?? null, cpcMicros: input.cpcMicros ?? null, createdAt, updatedAt: createdAt };
  await db.insert(schema.keywords).values(row);
  return { created: true, id: row.id };
}

export const sourceCommands = {
  list: async (ctx: CommandContext, projectId: string, type?: string) => withRun(projectCtx(ctx, projectId), 'source.list', { projectId, type }, async () => {
    const where = type ? and(eq(schema.sources.projectId, projectId), eq(schema.sources.type, type)) : eq(schema.sources.projectId, projectId);
    const rows = await db.select().from(schema.sources).where(where).orderBy(desc(schema.sources.createdAt)).limit(100);
    return rows.map(row => ({ ...row, metadata: parseMetadata(row.metadataJson), metadataJson: undefined }));
  }),
  record: async (ctx: CommandContext, input: { projectId: string; type: string; label: string; url?: string; metadata?: unknown }) => withRun(projectCtx(ctx, input.projectId), 'source.record', input, async () => saveSource(input))
};

export const researchCommands = {
  context: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'research.context', { projectId }, async () => {
    const topKeywords = await db.select({ id: schema.keywords.id, text: schema.keywords.text, avgMonthly: schema.keywords.avgMonthly, competition: schema.keywords.competition, clusterId: schema.clusterKeywords.clusterId }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'))).orderBy(desc(schema.keywords.avgMonthly)).limit(100);
    const unclustered = await db.select({ id: schema.keywords.id, text: schema.keywords.text, avgMonthly: schema.keywords.avgMonthly, source: schema.keywords.source }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'), isNull(schema.clusterKeywords.keywordId))).orderBy(desc(schema.keywords.avgMonthly)).limit(100);
    const insights = await db.select().from(schema.insights).where(and(eq(schema.insights.projectId, projectId), eq(schema.insights.status, 'open'))).orderBy(desc(schema.insights.createdAt)).limit(30);
    const sources = await db.select().from(schema.sources).where(eq(schema.sources.projectId, projectId)).orderBy(desc(schema.sources.createdAt)).limit(12);
    return { topKeywords, unclusteredKeywords: unclustered, openInsights: insights, recentSources: sources.map(source => ({ id: source.id, type: source.type, label: source.label, url: source.url, createdAt: source.createdAt, metadata: parseMetadata(source.metadataJson) })) };
  }),
  webFetch: async (ctx: CommandContext, input: { projectId: string; url: string; maxChars?: number }) => withRun(projectCtx(ctx, input.projectId), 'research.web_fetch', input, async () => {
    const document = await fetchWebDocument({ url: input.url, maxChars: input.maxChars });
    const source = await saveSource({ projectId: input.projectId, type: 'web', label: document.title || document.finalUrl, url: document.finalUrl, metadata: { document } });
    return { source, document };
  }),
  serp: async (ctx: CommandContext, input: { projectId: string; query: string; country?: string; language?: string; location?: string; num?: number }) => withRun(projectCtx(ctx, input.projectId), 'research.serp', input, async () => {
    const result = await searchSerp(input);
    const source = await saveSource({ projectId: input.projectId, type: 'serp', label: `SERP: ${input.query}`, metadata: { result } });
    return { source, result };
  }),
  googleAdsKeywordIdeas: async (ctx: CommandContext, input: { projectId: string; customerId?: string; seedKeywords?: string[]; url?: string; languageId?: string; geoTargetIds?: string[]; network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS'; importKeywords?: boolean }) => withRun(projectCtx(ctx, input.projectId), 'research.google_ads_keyword_ideas', input, async () => {
    const result = await googleAdsKeywordIdeas(input);
    const source = await saveSource({ projectId: input.projectId, type: 'google_ads', label: `Google Ads keyword ideas: ${(input.seedKeywords ?? []).join(', ') || input.url || 'seed'}`, url: input.url ?? null, metadata: { request: { seedKeywords: input.seedKeywords ?? [], url: input.url ?? null, languageId: input.languageId ?? null, geoTargetIds: input.geoTargetIds ?? [] }, result } });
    let created = 0;
    let updated = 0;
    if (input.importKeywords !== false) {
      for (const idea of result.ideas) {
        const outcome = await upsertKeyword(input.projectId, { text: idea.text, source: 'google_ads', avgMonthly: idea.avgMonthly, competition: idea.competitionIndex === null ? null : idea.competitionIndex / 100, cpcMicros: idea.averageCpcMicros });
        if (outcome.created) created++; else updated++;
      }
    }
    return { source, result, imported: { created, updated } };
  }),
  searchConsole: async (ctx: CommandContext, input: { projectId: string; siteUrl?: string; startDate: string; endDate: string; dimensions?: string[]; rowLimit?: number; startRow?: number; searchType?: string; importQueries?: boolean }) => withRun(projectCtx(ctx, input.projectId), 'research.search_console', input, async () => {
    const result = await searchConsoleQuery(input);
    const source = await saveSource({ projectId: input.projectId, type: 'search_console', label: `Search Console: ${result.startDate} → ${result.endDate}`, url: result.siteUrl.startsWith('http') ? result.siteUrl : null, metadata: { result } });
    let created = 0;
    let existing = 0;
    const queryIndex = result.dimensions.indexOf('query');
    if (input.importQueries !== false && queryIndex >= 0) {
      for (const row of result.rows) {
        const query = row.keys[queryIndex];
        if (!query) continue;
        const outcome = await upsertKeyword(input.projectId, { text: query, source: 'search_console' });
        if (outcome.created) created++; else existing++;
      }
    }
    return { source, result, imported: { created, existing } };
  })
};
