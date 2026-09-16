import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { analyzeSerp, searchSerp, type SerpAnalysis, type SerpSnapshot, type SerpProvider } from '../../research/src/index.js';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import type { ResearchSession, ResearchSessionStatus, SerpUsage } from '../../db/src/remote-keyword-schema.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const keywordId = z.string().regex(/^[a-f0-9]{32}$/);
const text = z.string().trim().min(1).max(4000);
const textArray = z.array(text).max(200);
const sessionStatus = z.enum(['active', 'paused', 'completed', 'archived']);

export const researchSessionCreateShape = {
  id: id.optional(),
  title: z.string().trim().min(1).max(200),
  objective: text,
  seedThemes: textArray.optional(),
  hypotheses: textArray.optional(),
  findings: textArray.optional(),
  nextActions: textArray.optional(),
  siteConceptIds: z.array(id).max(100).optional(),
  notes: z.string().max(4000).optional(),
  status: sessionStatus.optional()
};
export const researchSessionGetShape = { id: id.optional(), latest: z.boolean().optional() };
export const researchSessionListShape = {
  status: sessionStatus.optional(),
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  pageToken: z.string().max(4000).optional()
};
export const researchSessionUpdateShape = {
  id,
  expectedRevision: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  objective: text.optional(),
  seedThemes: textArray.optional(),
  hypotheses: textArray.optional(),
  researchedKeywordIds: z.array(keywordId).max(1000).optional(),
  shortlistedKeywordIds: z.array(keywordId).max(1000).optional(),
  rejectedKeywordIds: z.array(keywordId).max(1000).optional(),
  findings: textArray.optional(),
  nextActions: textArray.optional(),
  siteConceptIds: z.array(id).max(200).optional(),
  notes: z.string().max(4000).optional(),
  status: sessionStatus.optional(),
  addResearchedKeywordIds: z.array(keywordId).max(500).optional(),
  addShortlistedKeywordIds: z.array(keywordId).max(500).optional(),
  addRejectedKeywordIds: z.array(keywordId).max(500).optional(),
  addFindings: textArray.optional(),
  addNextActions: textArray.optional(),
  addSiteConceptIds: z.array(id).max(100).optional()
};

export const serpUsageStatusShape = {};
export const serpResearchCachedShape = {
  query: z.string().trim().min(1).max(500),
  country: z.string().min(2).max(2).optional(),
  language: z.string().min(2).max(10).optional(),
  location: z.string().max(200).optional(),
  num: z.number().int().min(1).max(20).optional(),
  provider: z.enum(['brave', 'serper']).optional(),
  forceRefresh: z.boolean().optional()
};

export const keywordScreenCriteriaShape = {
  minVolume: z.number().min(0).optional(),
  minCpcMicros: z.number().min(0).optional(),
  minCompetitionIndex: z.number().min(0).max(100).optional(),
  maxCompetitionIndex: z.number().min(0).max(100).optional()
};

export type DemandMetric = {
  keyword: string;
  avgMonthlySearches?: number | null;
  averageCpcMicros?: number | null;
  competition?: string | number | null;
  competitionIndex?: number | null;
  [key: string]: unknown;
};
export type ScreenCriteria = {
  minVolume?: number;
  minCpcMicros?: number;
  minCompetitionIndex?: number;
  maxCompetitionIndex?: number;
};

function fields(data: object) { return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)])); }
function parseDoc<T>(doc: any): T {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as T;
}
function unique<T>(items: T[]) { return [...new Set(items)]; }
function normalizedQuery(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
function nowIso() { return new Date().toISOString(); }
function currentMonth(date = new Date()) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function integerEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

export function serpQuotaConfiguration() {
  const monthlyLimit = integerEnv('KEYWORDS_SERP_MONTHLY_LIMIT', 2000, 1, 1_000_000);
  const softLimit = integerEnv('KEYWORDS_SERP_SOFT_LIMIT', Math.min(1500, monthlyLimit), 1, monthlyLimit);
  const reserve = integerEnv('KEYWORDS_SERP_RESERVE', Math.min(500, Math.max(0, monthlyLimit - softLimit)), 0, monthlyLimit - 1);
  const cacheTtlDays = integerEnv('KEYWORDS_SERP_CACHE_TTL_DAYS', 30, 1, 365);
  return { monthlyLimit, softLimit, reserve, cacheTtlDays, normalCutoff: Math.max(0, Math.min(softLimit, monthlyLimit - reserve)) };
}

async function readDocument(path: string) {
  try { return await firestore(path); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}

function emptyUsage(month: string): SerpUsage {
  const now = nowIso();
  return { month, actualApiRequests: 0, cacheHits: 0, forcedApiRequests: 0, blockedRequests: 0, createdAt: now, updatedAt: now };
}
async function getUsageDocument(month = currentMonth()) {
  const doc = await readDocument(`/serpUsage/${month}`);
  return { doc, usage: doc ? parseDoc<SerpUsage>(doc) : emptyUsage(month) };
}
async function writeUsage(previousDoc: any, usage: SerpUsage) {
  const path = `/serpUsage/${usage.month}?${previousDoc ? `currentDocument.updateTime=${encodeURIComponent(previousDoc.updateTime)}` : 'currentDocument.exists=false'}`;
  return firestore(path, { method: 'PATCH', body: JSON.stringify({ fields: fields(usage) }) });
}
async function mutateUsage(mutate: (usage: SerpUsage) => SerpUsage) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { doc, usage } = await getUsageDocument();
    const next = mutate({ ...usage, updatedAt: nowIso() });
    try {
      const saved = await writeUsage(doc, next);
      return parseDoc<SerpUsage>(saved);
    } catch (error) {
      if (error instanceof FirestoreError && [409, 412].includes(error.status)) continue;
      throw error;
    }
  }
  throw new Error('SERP usage counter contention: retry the request');
}

export async function serpUsageStatus() {
  const { usage } = await getUsageDocument();
  const config = serpQuotaConfiguration();
  const used = Number(usage.actualApiRequests ?? 0);
  const remaining = Math.max(0, config.monthlyLimit - used);
  const normalRemaining = Math.max(0, Math.min(config.normalCutoff - used, remaining));
  const state = used >= config.monthlyLimit ? 'hard_limited' : used >= config.normalCutoff ? 'soft_limited' : 'normal';
  return { ...usage, ...config, remaining, normalRemaining, state, normalRequestsAllowed: state === 'normal', forcedRequestsAllowed: used < config.monthlyLimit };
}

async function reserveApiRequest(forceRefresh: boolean) {
  let allowed = false;
  let status: Awaited<ReturnType<typeof serpUsageStatus>> | null = null;
  try {
    const usage = await mutateUsage(current => {
      const config = serpQuotaConfiguration();
      const used = Number(current.actualApiRequests ?? 0);
      const hardBlocked = used >= config.monthlyLimit;
      const softBlocked = !forceRefresh && used >= config.normalCutoff;
      if (hardBlocked || softBlocked) return { ...current, blockedRequests: Number(current.blockedRequests ?? 0) + 1 };
      allowed = true;
      return { ...current, actualApiRequests: used + 1, forcedApiRequests: Number(current.forcedApiRequests ?? 0) + (forceRefresh ? 1 : 0) };
    });
    status = { ...await serpUsageStatus(), actualApiRequests: usage.actualApiRequests, blockedRequests: usage.blockedRequests, forcedApiRequests: usage.forcedApiRequests };
  } catch (error) {
    throw error;
  }
  if (!allowed) {
    const reason = status?.state === 'hard_limited' ? 'SERP monthly hard limit reached' : 'SERP soft limit/reserve reached; use forceRefresh=true only for an explicit high-value check';
    throw new Error(reason);
  }
}
async function recordCacheHit() {
  await mutateUsage(current => ({ ...current, cacheHits: Number(current.cacheHits ?? 0) + 1 }));
}

function serpCacheId(input: { query: string; country?: string; language?: string; location?: string; num?: number; provider?: SerpProvider }) {
  const cacheKey = JSON.stringify({
    query: normalizedQuery(input.query),
    country: input.country?.toUpperCase() ?? null,
    language: input.language?.toLowerCase() ?? null,
    location: input.location?.trim().toLowerCase() ?? null,
    provider: input.provider ?? 'brave',
    num: input.num ?? 10
  });
  return { cacheKey, id: createHash('sha256').update(cacheKey).digest('hex') };
}

export async function serpResearchCached(input: z.infer<z.ZodObject<typeof serpResearchCachedShape>>) {
  const args = z.object(serpResearchCachedShape).strict().parse(input);
  const provider = args.provider ?? 'brave';
  const num = args.num ?? 10;
  const config = serpQuotaConfiguration();
  const { cacheKey, id: cacheId } = serpCacheId({ ...args, provider, num });
  const cachedDoc = await readDocument(`/serpCache/${cacheId}`);
  const cached = cachedDoc ? parseDoc<any>(cachedDoc) : null;
  const cutoff = Date.now() - config.cacheTtlDays * 24 * 60 * 60 * 1000;
  if (!args.forceRefresh && cached && Date.parse(String(cached.fetchedAt)) >= cutoff) {
    await recordCacheHit();
    return { ...(cached.snapshot as SerpSnapshot), analysis: cached.analysis as SerpAnalysis, cache: { hit: true, cacheId, fetchedAt: cached.fetchedAt, expiresAt: cached.expiresAt }, usage: await serpUsageStatus() };
  }

  await reserveApiRequest(Boolean(args.forceRefresh));
  const snapshot = await searchSerp({ query: args.query, country: args.country, language: args.language, location: args.location, num, provider });
  const analysis = analyzeSerp(snapshot);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.cacheTtlDays * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = cached?.createdAt ?? now;
  await firestore(`/serpCache/${cacheId}`, { method: 'PATCH', body: JSON.stringify({ fields: fields({ id: cacheId, cacheKey, query: args.query, country: args.country ?? null, language: args.language ?? null, location: args.location ?? null, provider, num, fetchedAt: snapshot.fetchedAt, expiresAt, snapshot, analysis, createdAt, updatedAt: now }) }) });
  return { ...snapshot, analysis, cache: { hit: false, cacheId, fetchedAt: snapshot.fetchedAt, expiresAt }, usage: await serpUsageStatus() };
}

function sessionId() { return `rs-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`; }
async function readSession(sessionIdValue: string) {
  const doc = await readDocument(`/researchSessions/${id.parse(sessionIdValue)}`);
  return doc ? { doc, session: parseDoc<ResearchSession>(doc) } : null;
}
async function commitSession(session: ResearchSession, previousDoc: any, command: string) {
  const runId = randomUUID();
  const now = nowIso();
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    { update: { name: firestoreDocumentName(`researchSessions/${session.id}`), fields: fields(session) }, currentDocument: previousDoc ? { updateTime: previousDoc.updateTime } : { exists: false } },
    { update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command, targetId: session.id, actor: 'remote_mcp', revision: session.revision, createdAt: now, outcome: 'succeeded' }) }, currentDocument: { exists: false } }
  ] }) });
  return { ...session, runId };
}

export async function researchSessionCreate(input: unknown) {
  const args = z.object(researchSessionCreateShape).strict().parse(input);
  const sessionIdValue = args.id ?? sessionId();
  if (await readSession(sessionIdValue)) throw new Error('Research session already exists');
  const now = nowIso();
  const session: ResearchSession = {
    id: sessionIdValue,
    title: args.title,
    objective: args.objective,
    seedThemes: unique(args.seedThemes ?? []),
    hypotheses: unique(args.hypotheses ?? []),
    researchedKeywordIds: [],
    shortlistedKeywordIds: [],
    rejectedKeywordIds: [],
    findings: unique(args.findings ?? []),
    nextActions: unique(args.nextActions ?? []),
    siteConceptIds: unique(args.siteConceptIds ?? []),
    notes: args.notes ?? '',
    status: args.status ?? 'active',
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
  return commitSession(session, null, 'research_session_create');
}

export async function researchSessionList(input: unknown = {}) {
  const args = z.object(researchSessionListShape).strict().parse(input);
  const params = new URLSearchParams({ pageSize: '100', orderBy: 'updatedAt desc' });
  if (args.pageToken) params.set('pageToken', args.pageToken);
  const result = await firestore(`/researchSessions?${params}`);
  const q = args.query?.trim().toLowerCase();
  const sessions = (result.documents ?? []).map((doc: any) => parseDoc<ResearchSession>(doc)).filter((session: ResearchSession) => (!args.status || session.status === args.status) && (!q || session.title.toLowerCase().includes(q) || session.objective.toLowerCase().includes(q) || session.seedThemes.some(theme => theme.toLowerCase().includes(q))));
  return { items: sessions.slice(0, args.limit), nextPageToken: result.nextPageToken ?? null };
}

export async function researchSessionGet(input: unknown = {}) {
  const args = z.object(researchSessionGetShape).strict().parse(input);
  if (args.id) {
    const found = await readSession(args.id);
    if (!found) throw new Error('Research session not found');
    return found.session;
  }
  const active = await researchSessionList({ status: 'active', limit: 1 });
  if (active.items[0]) return active.items[0];
  const latest = await researchSessionList({ limit: 1 });
  if (!latest.items[0]) throw new Error('No research session exists');
  return latest.items[0];
}

export async function researchSessionUpdate(input: unknown) {
  const args = z.object(researchSessionUpdateShape).strict().parse(input);
  const found = await readSession(args.id);
  if (!found) throw new Error('Research session not found');
  const current = found.session;
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: call research_session_get and reapply your update');
  const merge = <T>(base: T[], set: T[] | undefined, add: T[] | undefined) => unique([...(set ?? base), ...(add ?? [])]);
  const session: ResearchSession = {
    ...current,
    title: args.title ?? current.title,
    objective: args.objective ?? current.objective,
    seedThemes: args.seedThemes ?? current.seedThemes,
    hypotheses: args.hypotheses ?? current.hypotheses,
    researchedKeywordIds: merge(current.researchedKeywordIds, args.researchedKeywordIds, args.addResearchedKeywordIds),
    shortlistedKeywordIds: merge(current.shortlistedKeywordIds, args.shortlistedKeywordIds, args.addShortlistedKeywordIds),
    rejectedKeywordIds: merge(current.rejectedKeywordIds, args.rejectedKeywordIds, args.addRejectedKeywordIds),
    findings: merge(current.findings, args.findings, args.addFindings),
    nextActions: merge(current.nextActions, args.nextActions, args.addNextActions),
    siteConceptIds: merge(current.siteConceptIds, args.siteConceptIds, args.addSiteConceptIds),
    notes: args.notes ?? current.notes,
    status: (args.status ?? current.status) as ResearchSessionStatus,
    revision: current.revision + 1,
    updatedAt: nowIso()
  };
  return commitSession(session, found.doc, 'research_session_update');
}

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
export function screenDemandResults(results: DemandMetric[], criteria: ScreenCriteria = {}) {
  const screened = results.map(result => {
    const volume = number(result.avgMonthlySearches) ?? 0;
    const cpc = number(result.averageCpcMicros) ?? 0;
    const competitionIndex = number(result.competitionIndex);
    const reasons: string[] = [];
    let passed = true;
    if (criteria.minVolume !== undefined && volume < criteria.minVolume) { passed = false; reasons.push(`volume<${criteria.minVolume}`); }
    if (criteria.minCpcMicros !== undefined && cpc < criteria.minCpcMicros) { passed = false; reasons.push(`cpc<${criteria.minCpcMicros}`); }
    if (criteria.minCompetitionIndex !== undefined && (competitionIndex === null || competitionIndex < criteria.minCompetitionIndex)) { passed = false; reasons.push(`competition<${criteria.minCompetitionIndex}`); }
    if (criteria.maxCompetitionIndex !== undefined && (competitionIndex === null || competitionIndex > criteria.maxCompetitionIndex)) { passed = false; reasons.push(`competition>${criteria.maxCompetitionIndex}`); }
    const volumeScore = Math.min(45, Math.log10(volume + 1) * 12);
    const cpcUnits = cpc / 1_000_000;
    const cpcScore = Math.min(35, Math.log10(cpcUnits + 1) * 18);
    const difficultyScore = competitionIndex === null ? 5 : Math.max(0, 15 * (1 - competitionIndex / 100));
    const completeness = result.avgMonthlySearches !== null && result.avgMonthlySearches !== undefined && result.averageCpcMicros !== null && result.averageCpcMicros !== undefined ? 5 : 0;
    const screenScore = Math.round((volumeScore + cpcScore + difficultyScore + completeness) * 10) / 10;
    return { ...result, passed, rejectionReasons: reasons, screenScore };
  });
  screened.sort((a, b) => b.screenScore - a.screenScore || String(a.keyword).localeCompare(String(b.keyword)));
  return { results: screened, passedKeywords: screened.filter(item => item.passed).map(item => item.keyword), serpRecommended: screened.filter(item => item.passed && (number(item.avgMonthlySearches) ?? 0) > 0).map(item => item.keyword) };
}
