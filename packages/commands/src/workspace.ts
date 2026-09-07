import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CapabilityStatus, CommandContext, ProjectMode } from '@keywords/domain';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });
const parseStrings = (value: string | null) => { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const parseArray = (value: string | null) => { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

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

function reasonFrequency(rows: Array<{ reason: string | null }>) {
  const counts = new Map<string, number>();
  for (const row of rows) { const reason = row.reason?.trim(); if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count }));
}

export const workspaceCommands = {
  brief: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'workspace.brief', { projectId }, async () => briefView(await requireProject(projectId))),

  updateBrief: async (ctx: CommandContext, input: {
    projectId: string; name?: string; domain?: string | null; mode?: ProjectMode; topic?: string | null; audience?: string | null;
    language?: string; country?: string; region?: string | null; excludedTerms?: string[]; discoveryCadenceDays?: number;
    discoveryMaxCandidates?: number; discoveryMaxExternalRequests?: number;
  }) => withRun(projectCtx(ctx, input.projectId), 'workspace.update_brief', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Project brief changes require a human actor');
    const current = await requireProject(input.projectId); const mode = input.mode ?? current.mode; const domain = input.domain === undefined ? current.domain : input.domain?.trim() || null;
    if (mode === 'existing_site' && !domain) throw new Error('existing_site mode requires a domain');
    const language = (input.language ?? current.language).trim().toLowerCase(); const country = (input.country ?? current.country).trim().toLowerCase(); if (!language || !country) throw new Error('Language and country are required');
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
    await db.update(schema.projects).set(values).where(eq(schema.projects.id, input.projectId)); return briefView({ ...current, ...values });
  }),

  capabilities: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'workspace.capabilities', { projectId }, async () => {
    const project = await requireProject(projectId); const persisted = await db.select().from(schema.providerCapabilities).where(eq(schema.providerCapabilities.projectId, projectId)); const byProvider = new Map(persisted.map(row => [row.provider, row])); const configured = providerConfig();
    return Object.entries(configured).map(([provider, ready]) => {
      const previous = byProvider.get(provider); let status: CapabilityStatus = ready ? 'available' : 'not_configured'; if (ready && previous && ['expired', 'rate_limited', 'failed'].includes(previous.status)) status = previous.status as CapabilityStatus; if (provider === 'sitemap' && project.mode === 'existing_site' && !project.domain) status = 'not_configured';
      return { provider, status, configured: ready, reason: status === 'not_configured' ? (provider === 'sitemap' ? 'Set a project domain to sync a sitemap.' : 'Required environment variables are not configured.') : previous?.lastErrorMessage ?? null, lastCheckedAt: previous?.lastCheckedAt ?? null, lastSuccessAt: previous?.lastSuccessAt ?? null };
    });
  }),

  keywordSearch: async (ctx: CommandContext, input: {
    projectId: string; q?: string; candidateStatus?: string; clusterId?: string; existingPage?: 'with' | 'without';
    researchStatus?: 'researched' | 'unresearched' | 'failed'; provider?: string; sort?: 'demand_desc' | 'keyword_asc' | 'gsc_impressions_desc' | 'updated_desc';
    limit?: number; offset?: number;
  }) => withRun(projectCtx(ctx, input.projectId), 'workspace.keyword_search', input, async () => {
    await requireProject(input.projectId);
    const [allKeywords, candidateRows, pageTargetRows] = await Promise.all([
      db.select({ keyword: schema.keywords, clusterId: schema.clusterKeywords.clusterId, clusterTitle: schema.clusters.title })
        .from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).leftJoin(schema.clusters, eq(schema.clusterKeywords.clusterId, schema.clusters.id))
        .where(eq(schema.keywords.projectId, input.projectId)).limit(50_000),
      db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.projectId, input.projectId)).orderBy(desc(schema.discoveryCandidates.updatedAt)).limit(100_000),
      db.select({ keywordId: schema.pageKeywords.keywordId, pageId: schema.pages.id }).from(schema.pageKeywords).innerJoin(schema.pages, eq(schema.pageKeywords.pageId, schema.pages.id)).where(and(eq(schema.pages.projectId, input.projectId), ne(schema.pages.status, 'archived')))
    ]);
    const latestCandidate = new Map<string, typeof candidateRows[number]>(); for (const row of candidateRows) if (row.keywordId && !latestCandidate.has(row.keywordId)) latestCandidate.set(row.keywordId, row);
    const pageCounts = new Map<string, number>(); for (const row of pageTargetRows) pageCounts.set(row.keywordId, (pageCounts.get(row.keywordId) ?? 0) + 1);
    const q = input.q?.trim().toLowerCase();
    let filtered = allKeywords.filter(row => {
      const candidate = latestCandidate.get(row.keyword.id); const hasPage = (pageCounts.get(row.keyword.id) ?? 0) > 0 || parseArray(candidate?.existingPageOverlapJson ?? null).length > 0;
      const researched = Boolean(candidate && (candidate.serpStatus === 'researched' || candidate.evidenceCount > 0));
      if (q && !row.keyword.text.toLowerCase().includes(q)) return false;
      if (input.clusterId && row.clusterId !== input.clusterId) return false;
      if (input.candidateStatus && candidate?.status !== input.candidateStatus) return false;
      if (input.existingPage === 'with' && !hasPage) return false;
      if (input.existingPage === 'without' && hasPage) return false;
      if (input.researchStatus === 'researched' && !researched) return false;
      if (input.researchStatus === 'unresearched' && researched) return false;
      if (input.researchStatus === 'failed' && candidate?.serpStatus !== 'failed') return false;
      if (input.provider && (candidate?.demandProvider ?? row.keyword.source) !== input.provider) return false;
      return true;
    });
    switch (input.sort ?? 'demand_desc') {
      case 'keyword_asc': filtered = filtered.sort((a, b) => a.keyword.text.localeCompare(b.keyword.text)); break;
      case 'gsc_impressions_desc': filtered = filtered.sort((a, b) => (b.keyword.gscImpressions ?? -1) - (a.keyword.gscImpressions ?? -1)); break;
      case 'updated_desc': filtered = filtered.sort((a, b) => b.keyword.updatedAt.localeCompare(a.keyword.updatedAt)); break;
      default: filtered = filtered.sort((a, b) => (b.keyword.avgMonthly ?? -1) - (a.keyword.avgMonthly ?? -1) || a.keyword.text.localeCompare(b.keyword.text));
    }
    const offset = Math.max(0, Math.floor(input.offset ?? 0)); const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200));
    const items = filtered.slice(offset, offset + limit).map(row => { const candidate = latestCandidate.get(row.keyword.id); return { ...row, existingPageCount: pageCounts.get(row.keyword.id) ?? 0, candidate: candidate ? { id: candidate.id, jobId: candidate.jobId, status: candidate.status, searchIntent: candidate.searchIntent, serpStatus: candidate.serpStatus, evidenceCount: candidate.evidenceCount, demandValue: candidate.demandValue, demandProvider: candidate.demandProvider, demandObservedAt: candidate.demandObservedAt, existingPageOverlap: parseArray(candidate.existingPageOverlapJson) } : null }; });
    const providers = [...new Set(allKeywords.map(row => latestCandidate.get(row.keyword.id)?.demandProvider ?? row.keyword.source).filter(Boolean))].sort();
    const clusters = [...new Map(allKeywords.filter(row => row.clusterId).map(row => [row.clusterId!, { id: row.clusterId!, title: row.clusterTitle ?? row.clusterId! }])).values()].sort((a, b) => a.title.localeCompare(b.title));
    return { total: filtered.length, offset, limit, sort: input.sort ?? 'demand_desc', facets: { providers, clusters }, items };
  }),

  keywordDetail: async (ctx: CommandContext, input: { projectId: string; keywordId: string }) => withRun(projectCtx(ctx, input.projectId), 'workspace.keyword_detail', input, async () => {
    const keyword = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, input.projectId), eq(schema.keywords.id, input.keywordId))).get(); if (!keyword) throw new Error('Keyword not found');
    const [cluster, candidates, pages, snapshots] = await Promise.all([
      db.select({ id: schema.clusters.id, title: schema.clusters.title, intent: schema.clusters.intent }).from(schema.clusterKeywords).innerJoin(schema.clusters, eq(schema.clusterKeywords.clusterId, schema.clusters.id)).where(eq(schema.clusterKeywords.keywordId, keyword.id)).get(),
      db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.projectId, input.projectId), eq(schema.discoveryCandidates.keywordId, keyword.id))).orderBy(desc(schema.discoveryCandidates.updatedAt)).limit(50),
      db.select({ id: schema.pages.id, title: schema.pages.title, status: schema.pages.status, kind: schema.pages.kind, url: schema.pages.url, role: schema.pageKeywords.role }).from(schema.pageKeywords).innerJoin(schema.pages, eq(schema.pageKeywords.pageId, schema.pages.id)).where(and(eq(schema.pageKeywords.keywordId, keyword.id), eq(schema.pages.projectId, input.projectId))),
      db.select().from(schema.keywordMetricSnapshots).where(and(eq(schema.keywordMetricSnapshots.projectId, input.projectId), eq(schema.keywordMetricSnapshots.keywordId, keyword.id))).orderBy(desc(schema.keywordMetricSnapshots.endDate)).limit(20)
    ]);
    const candidateIds = candidates.map(row => row.id); const [links, decisions] = candidateIds.length ? await Promise.all([
      db.select({ link: schema.sourceLinks, source: schema.sources }).from(schema.sourceLinks).innerJoin(schema.sources, eq(schema.sourceLinks.sourceId, schema.sources.id)).where(and(eq(schema.sourceLinks.projectId, input.projectId), eq(schema.sourceLinks.targetType, 'discovery_candidate'), inArray(schema.sourceLinks.targetId, candidateIds))).orderBy(desc(schema.sourceLinks.createdAt)),
      db.select().from(schema.decisions).where(and(eq(schema.decisions.projectId, input.projectId), inArray(schema.decisions.targetId, [...candidateIds, keyword.id]))).orderBy(desc(schema.decisions.createdAt)).limit(100)
    ]) : [[], []];
    return { keyword, cluster: cluster ?? null, candidates: candidates.map(row => ({ ...row, existingPageOverlap: parseArray(row.existingPageOverlapJson), unresolvedQuestions: parseStrings(row.unresolvedQuestionsJson), existingPageOverlapJson: undefined, unresolvedQuestionsJson: undefined })), pages, evidence: links.map(({ link, source }) => ({ candidateId: link.targetId, kind: link.kind, source: { ...source, metadata: source.metadataJson ? JSON.parse(source.metadataJson) : null, metadataJson: undefined } })), decisions, metricSnapshots: snapshots };
  }),

  evidence: async (ctx: CommandContext, input: { projectId: string; targetType: string; targetId: string }) => withRun(projectCtx(ctx, input.projectId), 'workspace.evidence', input, async () => {
    const links = await db.select({ link: schema.sourceLinks, source: schema.sources }).from(schema.sourceLinks).innerJoin(schema.sources, eq(schema.sourceLinks.sourceId, schema.sources.id)).where(and(eq(schema.sourceLinks.projectId, input.projectId), eq(schema.sourceLinks.targetType, input.targetType), eq(schema.sourceLinks.targetId, input.targetId))).orderBy(desc(schema.sourceLinks.createdAt));
    return links.map(({ link, source }) => ({ kind: link.kind, source: { ...source, metadata: source.metadataJson ? JSON.parse(source.metadataJson) : null, metadataJson: undefined } }));
  }),

  continuousSummary: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'workspace.continuous_summary', { projectId }, async () => {
    const project = await requireProject(projectId);
    const [jobs, candidates, reviewDecisions] = await Promise.all([
      db.select().from(schema.discoveryJobs).where(eq(schema.discoveryJobs.projectId, projectId)).orderBy(desc(schema.discoveryJobs.createdAt)).limit(100),
      db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.projectId, projectId)).orderBy(desc(schema.discoveryCandidates.updatedAt)).limit(100_000),
      db.select().from(schema.decisions).where(and(eq(schema.decisions.projectId, projectId), eq(schema.decisions.action, 'discovery.candidate_review'))).orderBy(desc(schema.decisions.createdAt)).limit(10_000)
    ]);
    const statuses = ['discovered','shortlisted','hold','rejected','research_more','planned']; const counts = Object.fromEntries(statuses.map(status => [status, candidates.filter(c => c.status === status).length]));
    const reviewed = (counts.shortlisted ?? 0) + (counts.hold ?? 0) + (counts.rejected ?? 0) + (counts.planned ?? 0); const last = jobs[0] ?? null; const dueAt = project.lastDiscoveryAt ? new Date(new Date(project.lastDiscoveryAt).getTime() + project.discoveryCadenceDays * 86_400_000).toISOString() : null;
    const providerMap = new Map<string, { provider: string; total: number; accepted: number; held: number; rejected: number; planned: number }>();
    for (const c of candidates) { const provider = c.demandProvider ?? 'unknown'; const row = providerMap.get(provider) ?? { provider, total: 0, accepted: 0, held: 0, rejected: 0, planned: 0 }; row.total++; if (c.status === 'shortlisted' || c.status === 'planned') row.accepted++; if (c.status === 'hold') row.held++; if (c.status === 'rejected') row.rejected++; if (c.status === 'planned') row.planned++; providerMap.set(provider, row); }
    const providerPerformance = [...providerMap.values()].map(row => ({ ...row, acceptanceRate: row.total ? row.accepted / row.total : null })).sort((a, b) => (b.acceptanceRate ?? -1) - (a.acceptanceRate ?? -1));
    const plannedCandidates = candidates.filter(c => c.status === 'planned' && c.keywordId).slice(0, 100); const plannedKeywordIds = [...new Set(plannedCandidates.map(c => c.keywordId!).filter(Boolean))];
    const plannedKeywords = plannedKeywordIds.length ? await db.select({ id: schema.keywords.id, text: schema.keywords.text, source: schema.keywords.source, gscClicks: schema.keywords.gscClicks, gscImpressions: schema.keywords.gscImpressions, gscPosition: schema.keywords.gscPosition, gscUpdatedAt: schema.keywords.gscUpdatedAt }).from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), inArray(schema.keywords.id, plannedKeywordIds))) : [];
    const rejectReasons = reasonFrequency(reviewDecisions.filter(row => row.verdict === 'rejected')); const holdReasons = reasonFrequency(reviewDecisions.filter(row => row.verdict === 'hold'));
    const suggestions: string[] = [];
    if (reviewed >= 5 && (counts.rejected ?? 0) / reviewed >= 0.5) suggestions.push('候補の半数以上が除外されています。上位の除外理由をProject briefの除外語・探索目的へ反映してください。');
    if ((counts.hold ?? 0) >= 3) suggestions.push('保留候補が多いため、次回探索では候補数を増やすよりSERP/Evidence確認を厚くする余地があります。');
    const bestProvider = providerPerformance.find(row => row.total >= 3 && (row.acceptanceRate ?? 0) >= 0.5); if (bestProvider) suggestions.push(`${bestProvider.provider}由来候補の採用率が高いため、次回探索で同Providerの調査予算を優先する根拠があります。`);
    if (plannedKeywords.some(row => (row.gscImpressions ?? 0) > 0)) suggestions.push('企画化済み候補にSearch Console実績が入り始めています。実績のあるテーマ/Providerを次回seed選定の根拠にできます。');
    return {
      jobs: jobs.length, candidateCounts: counts, adoptionRate: reviewed ? ((counts.shortlisted ?? 0) + (counts.planned ?? 0)) / reviewed : null, lastJob: last,
      schedule: { cadenceDays: project.discoveryCadenceDays, lastDiscoveryAt: project.lastDiscoveryAt, dueAt, due: !dueAt || Date.now() >= new Date(dueAt).getTime() },
      learning: { rejectReasons, holdReasons, providerPerformance, plannedOutcomes: plannedKeywords, suggestedAdjustments: suggestions }
    };
  })
};