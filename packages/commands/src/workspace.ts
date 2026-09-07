import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CapabilityStatus, CommandContext, ProjectMode } from '@keywords/domain';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });
const parseStrings = (value: string | null) => { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };

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

async function requireProject(projectId: string) {
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new Error('Project not found');
  return project;
}

function briefView(project: typeof schema.projects.$inferSelect) {
  return {
    id: project.id, name: project.name, domain: project.domain, mode: project.mode as ProjectMode,
    topic: project.topic, audience: project.audience, language: project.language, country: project.country,
    region: project.region, excludedTerms: parseStrings(project.excludedTermsJson),
    discoveryCadenceDays: project.discoveryCadenceDays, discoveryMaxCandidates: project.discoveryMaxCandidates,
    discoveryMaxExternalRequests: project.discoveryMaxExternalRequests, lastDiscoveryAt: project.lastDiscoveryAt,
    updatedAt: project.updatedAt
  };
}

const providerConfig = () => ({
  serp: Boolean(process.env.KEYWORDS_SERPER_API_KEY || process.env.SERPER_API_KEY),
  google_ads: Boolean((process.env.GOOGLE_ADS_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN) && process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID),
  search_console: Boolean((process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN) && process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL),
  sitemap: true,
  public_web: true
});

export async function recordProviderCapability(projectId: string, provider: string, status: CapabilityStatus, error?: unknown) {
  const t = now();
  const existing = await db.select().from(schema.providerCapabilities).where(and(eq(schema.providerCapabilities.projectId, projectId), eq(schema.providerCapabilities.provider, provider))).get();
  const message = error ? (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500) : null;
  const errorCode = message?.match(/HTTP\s+(\d{3})/)?.[1] ?? null;
  const row = {
    id: existing?.id ?? id(), projectId, provider, status, lastCheckedAt: t,
    lastSuccessAt: status === 'available' ? t : existing?.lastSuccessAt ?? null,
    lastErrorCode: status === 'available' ? null : errorCode,
    lastErrorMessage: status === 'available' ? null : message,
    updatedAt: t
  };
  if (existing) await db.update(schema.providerCapabilities).set(row).where(eq(schema.providerCapabilities.id, existing.id));
  else await db.insert(schema.providerCapabilities).values(row);
  return row;
}

export const workspaceCommands = {
  brief: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'workspace.brief', { projectId }, async () => briefView(await requireProject(projectId))),

  updateBrief: async (ctx: CommandContext, input: {
    projectId: string; name?: string; domain?: string | null; mode?: ProjectMode; topic?: string | null; audience?: string | null;
    language?: string; country?: string; region?: string | null; excludedTerms?: string[]; discoveryCadenceDays?: number;
    discoveryMaxCandidates?: number; discoveryMaxExternalRequests?: number;
  }) => withRun(projectCtx(ctx, input.projectId), 'workspace.update_brief', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Project brief changes require a human actor');
    const current = await requireProject(input.projectId);
    const mode = input.mode ?? current.mode;
    const domain = input.domain === undefined ? current.domain : input.domain?.trim() || null;
    if (mode === 'existing_site' && !domain) throw new Error('existing_site mode requires a domain');
    const language = (input.language ?? current.language).trim().toLowerCase();
    const country = (input.country ?? current.country).trim().toLowerCase();
    if (!language || !country) throw new Error('Language and country are required');
    const values = {
      name: input.name?.trim() || current.name, domain, mode,
      topic: input.topic === undefined ? current.topic : input.topic?.trim() || null,
      audience: input.audience === undefined ? current.audience : input.audience?.trim() || null,
      language, country, region: input.region === undefined ? current.region : input.region?.trim() || null,
      excludedTermsJson: input.excludedTerms === undefined ? current.excludedTermsJson : JSON.stringify([...new Set(input.excludedTerms.map(x => x.trim()).filter(Boolean))]),
      discoveryCadenceDays: Math.max(1, Math.min(Math.floor(input.discoveryCadenceDays ?? current.discoveryCadenceDays), 365)),
      discoveryMaxCandidates: Math.max(1, Math.min(Math.floor(input.discoveryMaxCandidates ?? current.discoveryMaxCandidates), 500)),
      discoveryMaxExternalRequests: Math.max(1, Math.min(Math.floor(input.discoveryMaxExternalRequests ?? current.discoveryMaxExternalRequests), 50)),
      updatedAt: now()
    };
    await db.update(schema.projects).set(values).where(eq(schema.projects.id, input.projectId));
    return briefView({ ...current, ...values });
  }),

  capabilities: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'workspace.capabilities', { projectId }, async () => {
    const project = await requireProject(projectId);
    const persisted = await db.select().from(schema.providerCapabilities).where(eq(schema.providerCapabilities.projectId, projectId));
    const byProvider = new Map(persisted.map(row => [row.provider, row]));
    const configured = providerConfig();
    return Object.entries(configured).map(([provider, ready]) => {
      const previous = byProvider.get(provider);
      let status: CapabilityStatus = ready ? 'available' : 'not_configured';
      if (ready && previous && ['expired', 'rate_limited', 'failed'].includes(previous.status)) status = previous.status as CapabilityStatus;
      if (provider === 'sitemap' && project.mode === 'existing_site' && !project.domain) status = 'not_configured';
      return {
        provider, status, configured: ready,
        reason: status === 'not_configured' ? (provider === 'sitemap' ? 'Set a project domain to sync a sitemap.' : 'Required environment variables are not configured.') : previous?.lastErrorMessage ?? null,
        lastCheckedAt: previous?.lastCheckedAt ?? null, lastSuccessAt: previous?.lastSuccessAt ?? null
      };
    });
  }),

  keywordSearch: async (ctx: CommandContext, input: { projectId: string; q?: string; candidateStatus?: string; clusterId?: string; limit?: number; offset?: number }) => withRun(projectCtx(ctx, input.projectId), 'workspace.keyword_search', input, async () => {
    await requireProject(input.projectId);
    const allKeywords = await db.select({ keyword: schema.keywords, clusterId: schema.clusterKeywords.clusterId, clusterTitle: schema.clusters.title })
      .from(schema.keywords)
      .leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId))
      .leftJoin(schema.clusters, eq(schema.clusterKeywords.clusterId, schema.clusters.id))
      .where(eq(schema.keywords.projectId, input.projectId))
      .orderBy(desc(schema.keywords.avgMonthly), schema.keywords.text)
      .limit(10_000);
    const candidateRows = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.projectId, input.projectId)).orderBy(desc(schema.discoveryCandidates.updatedAt)).limit(20_000);
    const latestCandidate = new Map<string, typeof candidateRows[number]>();
    for (const row of candidateRows) if (row.keywordId && !latestCandidate.has(row.keywordId)) latestCandidate.set(row.keywordId, row);
    const q = input.q?.trim().toLowerCase();
    const filtered = allKeywords.filter(row => {
      const candidate = latestCandidate.get(row.keyword.id);
      if (q && !row.keyword.text.toLowerCase().includes(q)) return false;
      if (input.clusterId && row.clusterId !== input.clusterId) return false;
      if (input.candidateStatus && candidate?.status !== input.candidateStatus) return false;
      return true;
    });
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200));
    const items = filtered.slice(offset, offset + limit).map(row => {
      const candidate = latestCandidate.get(row.keyword.id);
      return { ...row, candidate: candidate ? { id: candidate.id, jobId: candidate.jobId, status: candidate.status, searchIntent: candidate.searchIntent, serpStatus: candidate.serpStatus, evidenceCount: candidate.evidenceCount, demandValue: candidate.demandValue, demandProvider: candidate.demandProvider, demandObservedAt: candidate.demandObservedAt } : null };
    });
    return { total: filtered.length, offset, limit, items };
  }),

  evidence: async (ctx: CommandContext, input: { projectId: string; targetType: string; targetId: string }) => withRun(projectCtx(ctx, input.projectId), 'workspace.evidence', input, async () => {
    const links = await db.select({ link: schema.sourceLinks, source: schema.sources }).from(schema.sourceLinks).innerJoin(schema.sources, eq(schema.sourceLinks.sourceId, schema.sources.id)).where(and(eq(schema.sourceLinks.projectId, input.projectId), eq(schema.sourceLinks.targetType, input.targetType), eq(schema.sourceLinks.targetId, input.targetId))).orderBy(desc(schema.sourceLinks.createdAt));
    return links.map(({ link, source }) => ({ kind: link.kind, source: { ...source, metadata: source.metadataJson ? JSON.parse(source.metadataJson) : null, metadataJson: undefined } }));
  }),

  continuousSummary: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'workspace.continuous_summary', { projectId }, async () => {
    const project = await requireProject(projectId);
    const jobs = await db.select().from(schema.discoveryJobs).where(eq(schema.discoveryJobs.projectId, projectId)).orderBy(desc(schema.discoveryJobs.createdAt)).limit(50);
    const candidates = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.projectId, projectId)).limit(20_000);
    const counts = Object.fromEntries(['discovered','shortlisted','hold','rejected','research_more'].map(status => [status, candidates.filter(c => c.status === status).length]));
    const reviewed = (counts.shortlisted ?? 0) + (counts.hold ?? 0) + (counts.rejected ?? 0);
    const last = jobs[0] ?? null;
    const dueAt = project.lastDiscoveryAt ? new Date(new Date(project.lastDiscoveryAt).getTime() + project.discoveryCadenceDays * 86_400_000).toISOString() : null;
    return { jobs: jobs.length, candidateCounts: counts, adoptionRate: reviewed ? (counts.shortlisted ?? 0) / reviewed : null, lastJob: last, schedule: { cadenceDays: project.discoveryCadenceDays, lastDiscoveryAt: project.lastDiscoveryAt, dueAt, due: !dueAt || Date.now() >= new Date(dueAt).getTime() } };
  })
};
