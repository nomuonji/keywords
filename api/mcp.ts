import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import * as z from 'zod/v4';
// Keep these imports relative: Vercel bundles a root-level serverless function
// independently of npm workspace links.
import { keywordDemand, treasuryConfiguration, treasuryList, treasurySave, treasurySearch } from '../packages/keyword-treasury/src/index.js';
import { analyzeSerp } from '../packages/research/src/index.js';
import { marketplaceAdapterCapabilities, marketplaceResearch, supportedMarketplaceAdapters } from '../packages/research/src/marketplace.js';
import { MARKET_SENSOR_SOURCE_IDS, marketSensorCapabilities, marketSignalScan } from '../packages/research/src/market-sensors.js';
import { googleAdsDirectConfiguration, googleAdsKeywordHistoricalMetricsDirect, sanitizeGoogleAdsError } from './google-ads-direct.js';
import { KEYWORDS_MCP_SERVER_VERSION, KEYWORDS_MCP_TOOL_NAMES } from './mcp-contract.js';
import { siteStructureSave, siteStructureGet, siteStructureList, siteStructurePatch, siteStructureSaveShape, siteStructureGetShape, siteStructureListShape, siteStructurePatchShape } from '../packages/commands/src/site-structure.js';
import {
  keywordScreenCriteriaShape,
  researchSessionCreate, researchSessionCreateShape,
  researchSessionGet, researchSessionGetShape,
  researchSessionList, researchSessionListShape,
  researchSessionUpdate, researchSessionUpdateShape,
  screenDemandResults,
  serpQuotaConfiguration,
  serpResearchCached,
  serpUsageStatus
} from '../packages/commands/src/remote-keyword-research.js';
import { themeResearchContext, themeResearchContextShape, themeCandidateUpsert, themeCandidateUpsertShape, themeCandidateChallenge, themeCandidateChallengeShape } from '../packages/commands/src/theme-research.js';
import {
  seoSourceGet, seoSourceGetShape,
  seoSourcePoolContext, seoSourcePoolContextShape,
  seoSourceSave, seoSourceSaveShape,
  seoSourceScanRecord, seoSourceScanRecordShape
} from '../packages/commands/src/seo-source-pool.js';
import { keywordResearchPipeline, keywordResearchPipelineShape } from '../packages/commands/src/keyword-research-pipeline.js';
import { searchGapResearch, searchGapResearchShape } from '../packages/commands/src/search-gap-research.js';
import { trendArticleResearch, trendArticleResearchShape } from '../packages/commands/src/trend-article-research.js';
import { marketIntelligenceResearch, marketIntelligenceResearchShape, marketSignalSnapshotSave, marketSignalSnapshotSaveShape, marketSignalSnapshotCompare, marketSignalSnapshotCompareShape } from '../packages/commands/src/market-intelligence.js';

const app = new Hono();
const configuredToken = process.env.KEYWORDS_REMOTE_MCP_TOKEN?.trim();
if (!configuredToken) throw new Error('KEYWORDS_REMOTE_MCP_TOKEN is required for the remote MCP');
const token: string = configuredToken;
const groqToken = process.env.KEYWORDS_GROQ_MCP_TOKEN?.trim() || null;
const corsOrigin = process.env.KEYWORDS_REMOTE_MCP_ALLOWED_ORIGIN?.trim() || '*';
let googleAdsProxyLastError: string | null = null;
let googleAdsDirectLastError: string | null = null;

app.use('*', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Mcp-Protocol-Version'], exposeHeaders: ['Mcp-Protocol-Version'] }));
function origin(c: any) { return new URL(c.req.url).origin; }
function b64(value: string) { return Buffer.from(value).toString('base64url'); }
function unb64(value: string) { return Buffer.from(value, 'base64url').toString('utf8'); }
function signed(kind: string, claims: Record<string, unknown>) {
  const body = b64(JSON.stringify({ kind, exp: Math.floor(Date.now() / 1000) + (kind === 'refresh' ? 60 * 60 * 24 * 30 : kind === 'access' ? 60 * 60 : 5 * 60), ...claims }));
  return `${body}.${createHmac('sha256', token).update(body).digest('base64url')}`;
}
function verified(value: string, kind: string) {
  const [body, signature] = value.split('.'); if (!body || !signature) return null;
  const expected = createHmac('sha256', token).update(body).digest('base64url');
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try { const payload = JSON.parse(unb64(body)); return payload.kind === kind && typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000) ? payload : null; } catch { return null; }
}
function sameValue(value: string, expected: string | null) {
  return Boolean(expected) && value.length === expected!.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected!));
}
function isAuthorizedBearer(value: string) {
  return sameValue(value, token) || sameValue(value, groqToken) || Boolean(verified(value, 'access'));
}
function isAuthorizedApiKey(value: string) {
  return sameValue(value, groqToken ?? token);
}
function sameSecret(value: string) { return sameValue(value, token); }
function query(c: any, name: string) { return c.req.query(name) ?? ''; }
function safeRedirect(value: string) { try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) ? url : null; } catch { return null; } }
function form(c: any, values: Record<string, string>) { return c.html(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Keywords Treasury</title><style>body{font-family:system-ui;max-width:34rem;margin:5rem auto;padding:1.5rem;color:#17211f}input,button{width:100%;padding:.75rem;margin:.5rem 0;font:inherit}button{background:#176b52;color:white;border:0;border-radius:.4rem}small{color:#52615c}</style><h1>Keywords Treasury を接続</h1><p>ChatGPT が共有キーワードストックを読み書きできるようにします。</p><form method="post" action="${origin(c)}/oauth/authorize">${Object.entries(values).map(([key,value])=>`<input type="hidden" name="${key}" value="${value.replaceAll('&','&amp;').replaceAll('"','&quot;')}">`).join('')}<label>アクセスキー<input name="access_key" type="password" autocomplete="current-password" required autofocus></label><small>Vercel の <code>KEYWORDS_REMOTE_MCP_TOKEN</code> の値を入力してください。</small><button type="submit">許可して接続</button></form></html>`); }
const requireToken = async (c: any, next: any) => {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const apiKey = c.req.header('x-api-key')?.trim() ?? '';
  if (!isAuthorizedBearer(bearer) && !isAuthorizedApiKey(apiKey)) {
    c.header('WWW-Authenticate', `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"`);
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
};
app.use('/mcp', requireToken); app.use('/api/mcp', requireToken);
const structured = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : value && typeof value === 'object' ? value as Record<string, unknown> : { value }
});

function runtimeStatus() {
  const googleAdsDirect = googleAdsDirectConfiguration();
  return {
    ...treasuryConfiguration(),
    serverVersion: KEYWORDS_MCP_SERVER_VERSION,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
    deployment: {
      platform: process.env.VERCEL ? 'vercel' : 'unknown',
      environment: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null
    },
    toolCount: KEYWORDS_MCP_TOOL_NAMES.length,
    tools: [...KEYWORDS_MCP_TOOL_NAMES],
    authentication: {
      oauthPkce: true,
      legacyStaticBearer: true,
      groqStaticTokenConfigured: Boolean(groqToken),
      groqHeaders: ['Authorization: Bearer <token>', 'x-api-key: <token>']
    },
    googleAdsDemandProviderOrder: ['proxy', 'direct'],
    googleAdsDirectConfigured: googleAdsDirect.configured,
    googleAdsDirectConfiguration: googleAdsDirect,
    googleAdsProxyLastError,
    googleAdsDirectLastError,
    googleAdsDemandHealth: {
      proxy: googleAdsProxyLastError ? 'last_attempt_failed' : 'ok_or_not_yet_failed',
      directFallback: googleAdsDirectLastError ? 'last_attempt_failed' : 'unknown_or_last_attempt_succeeded'
    },
    serpQuotaConfiguration: serpQuotaConfiguration(),
    marketplaceResearch: {
      supportedMarketplaces: supportedMarketplaceAdapters(),
      capabilities: marketplaceAdapterCapabilities()
    },
    marketSensors: marketSensorCapabilities(),
    marketIntelligence: {
      onDemandOnly: true,
      snapshotPersistence: 'explicit_call_only',
      tools: ['market_intelligence_research', 'market_signal_snapshot_save', 'market_signal_snapshot_compare'],
      supplementalSources: ['serp_query_context', 'google_ads_query_demand', 'social_serp_observation', 'indexed_social_snippet_metrics', 'tiktok_public_page_metrics', 'youtube_public_page_metrics', 'tiktok_top_ads', 'pinterest_trends', 'app_store'],
      evidenceCoverageGate: {
        enabled: true,
        socialAffiliateRequiresQueryMarketAndSocialContent: true,
        unavailableSourceMeansMissingEvidence: true
      },
      queryModes: {
        noQuery: 'broad_market_scan',
        withQuery: 'hypothesis_led_query_research'
      },
      intentDecomposition: {
        enabled: true,
        branches: ['problem_need', 'solution_product', 'how_to', 'commercial', 'entity', 'investment', 'career_qualification', 'news', 'research_information', 'ambiguous'],
        thesisUsesPrimaryBranchOnly: true,
        preservesAdjacentBranches: true,
        semanticSenseSelectionForAmbiguousQueries: true,
        appStoreEvidenceScope: 'lexical_search_only'
      }
    }
  };
}

type DemandInput = { keywords: string[]; languageConstant?: string; geoTargetConstants?: string[]; includeAdultKeywords?: boolean };
async function demandWithFallback(input: DemandInput) {
  let proxyProviderError: string | null = null;
  let proxyRetryUsed = false;
  try {
    const result = await keywordDemand(input);
    googleAdsProxyLastError = null;
    return { ...result, fallbackUsed: false, proxyRetryUsed, providerRoute: 'proxy' as const };
  } catch (error) {
    proxyProviderError = sanitizeGoogleAdsError(error);
    googleAdsProxyLastError = proxyProviderError;
  }

  if (proxyProviderError && /(?:provider failed \(5\d\d|NOT_FOUND|BAD_RESOURCE_ID|timeout|temporar|fetch failed|ECONN)/i.test(proxyProviderError)) {
    proxyRetryUsed = true;
    try {
      const result = await keywordDemand(input);
      googleAdsProxyLastError = null;
      return { ...result, fallbackUsed: false, proxyRetryUsed, providerRoute: 'proxy' as const };
    } catch (error) {
      proxyProviderError = sanitizeGoogleAdsError(error);
      googleAdsProxyLastError = proxyProviderError;
    }
  }

  try {
    const result = await googleAdsKeywordHistoricalMetricsDirect({ keywords: input.keywords, languageId: input.languageConstant, geoTargetIds: input.geoTargetConstants, includeAdultKeywords: input.includeAdultKeywords });
    googleAdsDirectLastError = null;
    return { ...result, fallbackUsed: true, proxyRetryUsed, providerRoute: 'direct_fallback' as const, proxyProviderError };
  } catch (error) {
    const directProviderError = sanitizeGoogleAdsError(error);
    googleAdsDirectLastError = directProviderError;
    throw new Error(`Google Ads proxy failed: ${proxyProviderError}; direct fallback failed: ${directProviderError}`);
  }
}

function server() {
  const mcp = new McpServer({ name: 'keywords-treasury', version: KEYWORDS_MCP_SERVER_VERSION });
  const [statusTool, demandTool, serpResearchTool, serpAnalyzeTool, saveTool, listTool] = KEYWORDS_MCP_TOOL_NAMES;
  mcp.registerTool(statusTool, { description: 'Check the live remote MCP version, deployment, tool contract, treasury configuration, Google Ads provider order, and SERP quota configuration. No secrets are returned.' }, async () => structured(runtimeStatus()));
  mcp.registerTool(demandTool, { description: 'Get normalized Google Ads historical demand for up to 50 exact supplied keywords. Uses the configured Google Ads proxy first, then direct Google Ads only if the proxy fails. This is the low-cost first-stage screening source and does not save candidates.', inputSchema: { keywords: z.array(z.string().min(1)).min(1).max(50), languageConstant: z.string().optional(), geoTargetConstants: z.array(z.string()).optional(), includeAdultKeywords: z.boolean().optional() } }, async input => structured(await demandWithFallback(input)));
  mcp.registerTool(serpResearchTool, { description: 'High-cost second-stage SERP research with Firestore cache and monthly quota enforcement. Cache is used by default; forceRefresh bypasses cache and may consume reserve capacity until the hard monthly limit.', inputSchema: { query: z.string().min(1).max(500).optional(), keyword: z.string().min(1).max(500).optional(), country: z.string().min(2).max(2).optional(), language: z.string().min(2).max(10).optional(), location: z.string().max(200).optional(), num: z.number().int().min(1).max(20).optional(), count: z.number().int().min(1).max(20).optional(), provider: z.enum(['api', 'brave', 'serper']).optional(), forceRefresh: z.boolean().optional() } }, async input => {
    const query = input.query ?? input.keyword; if (!query) throw new Error('query or keyword is required');
    return structured(await serpResearchCached({ query, country: input.country, language: input.language, location: input.location, num: input.num ?? input.count, provider: input.provider, forceRefresh: input.forceRefresh }));
  });
  mcp.registerTool(serpAnalyzeTool, { description: 'Compute legacy search-surface hints only. Domain, title and date heuristics are not a content-gap judgment; use search_gap_research for page-body evidence.', inputSchema: { snapshot: z.object({ query: z.string().min(1), country: z.string().nullable().optional(), language: z.string().nullable().optional(), provider: z.enum(['api', 'brave', 'serper']), fetchedAt: z.string(), peopleAlsoAsk: z.array(z.string()).optional(), relatedSearches: z.array(z.string()).optional(), results: z.array(z.object({ position: z.number().nullable(), title: z.string(), link: z.string(), domain: z.string().optional(), snippet: z.string().nullable() })).max(20) }) } }, async ({ snapshot }) => {
    const results = snapshot.results.map(result => ({ ...result, position: result.position ?? null, snippet: result.snippet ?? null, domain: result.domain || (() => { try { return new URL(result.link).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } })() }));
    return structured(analyzeSerp({ ...snapshot, country: snapshot.country ?? null, language: snapshot.language ?? null, results, peopleAlsoAsk: snapshot.peopleAlsoAsk ?? [], relatedSearches: snapshot.relatedSearches ?? [] }));
  });
  mcp.registerTool(saveTool, { description: 'Save evidence-backed keyword candidates to Firestore. Structured demand/SERP metrics are first-class fields while free-form evidence remains available for supplemental context.', inputSchema: { candidates: z.array(z.object({ keyword: z.string().min(1), seed: z.string().optional(), status: z.enum(['inbox', 'shortlisted', 'rejected', 'published']).optional(), notes: z.string().max(4000).optional(), volume: z.number().nullable().optional(), competition: z.union([z.string(), z.number()]).nullable().optional(), allintitle: z.number().nullable().optional(), serpWeakness: z.number().nullable().optional(), source: z.string().optional(), evidence: z.record(z.string(), z.unknown()).optional(), avgMonthlySearches: z.number().nullable().optional(), averageCpcMicros: z.number().nullable().optional(), competitionIndex: z.number().nullable().optional(), opportunityScore: z.number().nullable().optional(), weakDomainCount: z.number().nullable().optional(), forumCount: z.number().nullable().optional(), stalePageCount: z.number().nullable().optional(), exactTitleCount: z.number().nullable().optional(), demandResearchedAt: z.string().nullable().optional(), serpResearchedAt: z.string().nullable().optional(), country: z.string().nullable().optional(), language: z.string().nullable().optional() })).min(1).max(100) } }, async ({ candidates }) => structured(await treasurySave(candidates)));
  mcp.registerTool(listTool, { description: 'Backward-compatible simple list of keyword candidates saved in Firestore.', inputSchema: { status: z.enum(['inbox', 'shortlisted', 'rejected', 'published']).optional(), query: z.string().optional(), limit: z.number().min(1).max(100).optional() } }, async input => structured(await treasuryList(input)));
  mcp.registerTool('site_structure_list', { description: 'List shared Firestore site concepts and page structures, newest first. Follow nextPageToken to retrieve more.', inputSchema: siteStructureListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteStructureList(input)));
  mcp.registerTool('site_structure_get', { description: 'Read a site concept, page hierarchy, data model/source/template/refresh strategy, revision, and linked treasury keywords. Use before editing.', inputSchema: siteStructureGetShape, annotations: { readOnlyHint: true } }, async input => structured(await siteStructureGet(input)));
  mcp.registerTool('site_structure_save', { description: 'Create or full-edit a site concept. Existing nodes/links are replaced only when supplied; use site_structure_patch for normal incremental edits. Supports DB-driven SEO metadata: dataModel, sourceStrategy, pageTemplates and refreshPolicy.', inputSchema: siteStructureSaveShape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async input => structured(await siteStructureSave(input)));

  mcp.registerTool('research_session_create', { description: 'Create durable Firestore research context containing objective, seed themes, hypotheses, findings and next actions so a later ChatGPT session can resume without reconstructing chat history.', inputSchema: researchSessionCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await researchSessionCreate(input)));
  mcp.registerTool('research_session_get', { description: 'Get a research session. Omit id to resume the latest active session, falling back to the latest session of any status.', inputSchema: researchSessionGetShape, annotations: { readOnlyHint: true } }, async input => structured(await researchSessionGet(input)));
  mcp.registerTool('research_session_list', { description: 'List recent research sessions, optionally filtered by status/query.', inputSchema: researchSessionListShape, annotations: { readOnlyHint: true } }, async input => structured(await researchSessionList(input)));
  mcp.registerTool('research_session_update', { description: 'Update a research session with optimistic revision control. Additive fields let agents append researched/shortlisted/rejected keyword IDs, findings, next actions and site concepts without resending the full session.', inputSchema: researchSessionUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await researchSessionUpdate(input)));
  mcp.registerTool('theme_research_context', { description: 'Resume the durable theme/opportunity research ledger. Managed-site exploration uses explicit sessionId=seo-discovery-{siteId}; default seo-theme-research remains the new-monetization ledger. Read this first in every new or scheduled session. Returns surviving/challenged/killed/pilot-ready candidates with narrative verdicts, fatal risks, unknowns, evidence facts, challenge history and next falsification targets. This is deliberately qualitative: never derive a composite score or automatic winner from it.', inputSchema: themeResearchContextShape, annotations: { readOnlyHint: true } }, async input => structured(await themeResearchContext(input)));
  mcp.registerTool('theme_candidate_upsert', { description: 'Add or revise one theme/opportunity in the shared research ledger. The discovery packet stores real observations, page-body reviews, unmet need, feasible deliverable, falsification and evidence-driven next queries. pilot_ready requires this packet. Preserve a narrative thesis, why it still survives, fatal risks, unknowns, observed facts and the next challenge. Numeric facts may be stored as evidence, but this tool has no score or ranking field.', inputSchema: themeCandidateUpsertShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await themeCandidateUpsert(input)));
  mcp.registerTool('theme_candidate_challenge', { description: 'Record one adversarial validation round against an existing theme. State the attack, evidence, defense, conclusion, resulting status and next challenge. Killed candidates stay in the ledger so later sessions do not repeat rejected ideas without materially new evidence.', inputSchema: themeCandidateChallengeShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await themeCandidateChallenge(input)));
  mcp.registerTool('seo_source_pool_context', { description: 'Read the human-curated SEO source watch pool with due-for-review status, recent scan summaries, and useful findings. Use this before asking whether watched SEO practitioners or publications have said anything worth investigating recently. This tool does not fetch X or the web itself.', inputSchema: seoSourcePoolContextShape, annotations: { readOnlyHint: true, openWorldHint: true } }, async input => structured(await seoSourcePoolContext(input)));
  mcp.registerTool('seo_source_get', { description: 'Read one watched SEO source and its recent scan history.', inputSchema: seoSourceGetShape, annotations: { readOnlyHint: true } }, async input => structured(await seoSourceGet(input)));
  mcp.registerTool('seo_source_save', { description: 'Add or edit one SEO watch source such as an X account, website, newsletter, or YouTube channel. Reputation is metadata only; it never turns claims into accepted SEO policy.', inputSchema: seoSourceSaveShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoSourceSave(input)));
  mcp.registerTool('seo_source_scan_record', { description: 'Record the result of inspecting one watched source over a time window. Save URL-backed concise finding summaries, relevance, confidence, verification need, and possible evaluator links; do not copy full post bodies.', inputSchema: seoSourceScanRecordShape, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }, async input => structured(await seoSourceScanRecord(input)));
  mcp.registerTool('serp_usage_status', { description: 'Show current-month SERP actual API requests, cache hits, monthly limit, soft limit, reserve, remaining quota and whether normal/forced requests are allowed.', annotations: { readOnlyHint: true } }, async () => structured(await serpUsageStatus()));
  mcp.registerTool('keyword_treasury_search', { description: 'Search Firestore treasury by demand, CPC, competition, opportunity, status, theme/seed, research date and whether a keyword is already linked to any site concept. Old treasury documents remain searchable through compatibility fallbacks.', inputSchema: { query: z.string().optional(), seed: z.string().optional(), status: z.enum(['inbox', 'shortlisted', 'rejected', 'published']).optional(), minVolume: z.number().min(0).optional(), maxVolume: z.number().min(0).optional(), minCpc: z.number().min(0).optional(), maxCpc: z.number().min(0).optional(), minCompetition: z.number().min(0).max(100).optional(), maxCompetition: z.number().min(0).max(100).optional(), minOpportunityScore: z.number().min(0).max(100).optional(), linkedToSite: z.boolean().optional(), researchedAfter: z.string().optional(), researchedBefore: z.string().optional(), sortBy: z.enum(['updatedAt', 'keyword', 'avgMonthlySearches', 'averageCpcMicros', 'competitionIndex', 'opportunityScore']).optional(), sortOrder: z.enum(['asc', 'desc']).optional(), pageToken: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } }, async input => structured(await treasurySearch(input)));
  mcp.registerTool('site_structure_patch', { description: 'Incrementally edit a site concept without resending the full nodes/links arrays. Supports add/update/remove node, add/remove link, and link/unlink keyword operations with optimistic revision control.', inputSchema: siteStructurePatchShape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } }, async input => structured(await siteStructurePatch(input)));
  mcp.registerTool('keyword_screen_batch', { description: 'Low-cost first-stage screening. Fetch Google Ads demand for up to 50 keywords and return criteria-passing keywords plus a deterministic shortlist recommended for later SERP checks. This tool never calls SERP.', inputSchema: { keywords: z.array(z.string().min(1)).min(1).max(50), criteria: z.object(keywordScreenCriteriaShape).strict().optional(), languageConstant: z.string().optional(), geoTargetConstants: z.array(z.string()).optional(), includeAdultKeywords: z.boolean().optional() } }, async input => {
    const demand = await demandWithFallback(input);
    const screening = screenDemandResults(demand.results, input.criteria ?? {});
    return structured({ demand, screening });
  });
  mcp.registerTool('keyword_research_pipeline', {
    description: 'Bounded demand and observation-led research. Reserve up to maxObservationChecks of the same maxSerpChecks budget for dated real-world observations, even when search volume is low, missing or the Ads provider is unavailable. Remaining checks use demand screening. No automatic promotion or save.',
    inputSchema: keywordResearchPipelineShape,
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await keywordResearchPipeline(input, demandWithFallback)));
  mcp.registerTool('market_signal_scan', {
    description: 'Read current public market signals on demand before ideation. Without query it scans broad Google Trends RSS, TikTok Creative Center public trends, and Hacker News. With query, Hacker News switches to relevance search; broad Google/TikTok surfaces remain context only. For actual query-focused market research use market_intelligence_research.',
    inputSchema: {
      sources: z.array(z.enum(MARKET_SENSOR_SOURCE_IDS)).min(1).max(3).optional(),
      query: z.string().trim().min(1).max(200).optional(),
      geo: z.string().length(2).optional(),
      limit: z.number().int().min(1).max(20).optional(),
      tiktokPeriodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
      hackerNewsFeed: z.enum(['top', 'new', 'best']).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await marketSignalScan(input)));

  mcp.registerTool('market_intelligence_research', {
    description: 'On-demand marketing intelligence research. Without query it performs broad market scanning. With query it runs hypothesis-led SERP/demand research plus query-relevant indexed TikTok/YouTube Shorts content (and optional Instagram Reels). Social discovery prefers Brave site-restricted search, falls back to the general SERP API, and preserves indexed snippet engagement plus best-effort public-page metrics with provenance. researchGoal=social_affiliate activates an evidence-coverage gate: missing social observations prevents market ranking/recommendation instead of being treated as zero demand. Intent branches remain separated, TikTok Top Ads stays cross-category creative reference only, and App Store evidence stays lexical. Read-only: does not save snapshots, candidates, or ideas.',
    inputSchema: marketIntelligenceResearchShape,
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await marketIntelligenceResearch(input)));

  mcp.registerTool('market_signal_snapshot_save', {
    description: 'Explicitly capture and persist one on-demand marketing intelligence snapshot for later velocity comparison. This is never called automatically or on a schedule. It re-runs current evidence collection at save time so the stored snapshot has server-derived provenance.',
    inputSchema: marketSignalSnapshotSaveShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async input => structured(await marketSignalSnapshotSave(input)));

  mcp.registerTool('market_signal_snapshot_compare', {
    description: 'Compare a saved market snapshot with another saved snapshot or with a fresh live research packet. Returns entry/exit changes and comparable numeric metric deltas as velocity triggers; it does not save the live comparison or turn velocity into an automatic opportunity score.',
    inputSchema: marketSignalSnapshotCompareShape,
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await marketSignalSnapshotCompare(input)));

  mcp.registerTool('marketplace_research', {
    description: 'Read-only marketplace keyword research through a shared adapter layer. BOOTH is the first source. Returns search result counts, autocomplete suggestions, observed product cards, prices, wish-list counts when available, shop/category concentration, related tags, and optional cross-sort overlap. This tool does not compute a composite winner score or save/promote candidates.',
    inputSchema: {
      marketplace: z.string().min(1).max(50).optional(),
      query: z.string().min(1).max(200),
      page: z.number().int().min(1).max(10).optional(),
      sorts: z.array(z.string().min(1).max(50)).min(1).max(3).optional(),
      includeSuggestions: z.boolean().optional(),
      maxProducts: z.number().int().min(1).max(60).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await marketplaceResearch(input)));
  mcp.registerTool('search_gap_research', {
    description: 'Read a bounded SERP plus actual top-page bodies and optional observation source URLs for a concrete user question. Returns text, truncation, failures and provider provenance; the agent must compare answers and save its findings in the existing theme ledger. Does not invent an answer gap or save/promote a candidate.',
    inputSchema: searchGapResearchShape,
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await searchGapResearch(input)));
  mcp.registerTool('trend_article_research', {
    description: 'Read-only research bundle for an X/web trend article. Combines historical keyword demand, bounded cached SERP evidence, optional site structure context, and literal existing-page overlap hints. Fresh zero-volume terms remain eligible for SERP checks. Does not save, publish, or mutate site structure.',
    inputSchema: trendArticleResearchShape,
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async input => structured(await trendArticleResearch(input)));
  return mcp;
}
const health = (c: any) => c.json({ ok: true, service: 'keywords-treasury-mcp', ...runtimeStatus() });
const handleMcp = async (c: any) => { const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true }); const instance = server(); await instance.connect(transport); return transport.handleRequest(c.req.raw); };
app.get('/health', health); app.get('/mcp/health', health); app.get('/api/mcp/health', health);
app.all('/mcp', handleMcp); app.all('/api/mcp', handleMcp);
app.get('/.well-known/oauth-protected-resource', c => c.json({ resource: origin(c), authorization_servers: [origin(c)], scopes_supported: ['keyword-treasury'] }));
app.get('/.well-known/oauth-authorization-server', c => c.json({ issuer: origin(c), authorization_endpoint: `${origin(c)}/oauth/authorize`, token_endpoint: `${origin(c)}/oauth/token`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['keyword-treasury'] }));
app.get('/oauth/authorize', c => { const redirectUri = safeRedirect(query(c, 'redirect_uri')); const clientId = query(c, 'client_id'); const codeChallenge = query(c, 'code_challenge'); if (query(c, 'response_type') !== 'code' || !redirectUri || !clientId || !codeChallenge || query(c, 'code_challenge_method') !== 'S256') return c.text('Invalid OAuth authorization request', 400); return form(c, { redirect_uri: redirectUri.toString(), client_id: clientId, state: query(c, 'state'), code_challenge: codeChallenge, code_challenge_method: 'S256' }); });
app.post('/oauth/authorize', async c => { const body = await c.req.parseBody(); const redirectUri = safeRedirect(String(body.redirect_uri ?? '')); const clientId = String(body.client_id ?? ''); const challenge = String(body.code_challenge ?? ''); if (!redirectUri || !clientId || !challenge || !sameSecret(String(body.access_key ?? ''))) return c.text('Authorization denied', 401); const code = signed('code', { redirectUri: redirectUri.toString(), clientId, challenge }); redirectUri.searchParams.set('code', code); if (body.state) redirectUri.searchParams.set('state', String(body.state)); return c.redirect(redirectUri.toString()); });
app.post('/oauth/token', async c => { const body = await c.req.parseBody(); const grant = String(body.grant_type ?? ''); if (grant === 'refresh_token') { const refresh = verified(String(body.refresh_token ?? ''), 'refresh'); if (!refresh) return c.json({ error: 'invalid_grant' }, 400); return c.json({ access_token: signed('access', { clientId: refresh.clientId }), token_type: 'Bearer', expires_in: 3600, scope: 'keyword-treasury' }); }
  const code = verified(String(body.code ?? ''), 'code'); const verifier = String(body.code_verifier ?? ''); const redirectUri = String(body.redirect_uri ?? ''); const clientId = String(body.client_id ?? ''); const actualChallenge = createHash('sha256').update(verifier).digest('base64url'); if (grant !== 'authorization_code' || !code || code.redirectUri !== redirectUri || code.clientId !== clientId || code.challenge !== actualChallenge) return c.json({ error: 'invalid_grant' }, 400); return c.json({ access_token: signed('access', { clientId }), refresh_token: signed('refresh', { clientId }), token_type: 'Bearer', expires_in: 3600, scope: 'keyword-treasury' }); });
export default app;