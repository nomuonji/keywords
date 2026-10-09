import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SITES_MCP_SERVER_VERSION, SITES_MCP_TOOL_NAMES } from './sites-mcp-contract.js';
import { seoAgentContext, seoAgentContextShape } from '../packages/commands/src/seo-agent-policy.js';
import {
  growthInitiativeCreate, growthInitiativeCreateShape,
  growthInitiativeGet, growthInitiativeGetShape,
  growthInitiativeList, growthInitiativeListShape,
  growthInitiativeUpdate, growthInitiativeUpdateShape,
  distributionExperimentCreate, distributionExperimentCreateShape,
  distributionExperimentGet, distributionExperimentGetShape,
  distributionExperimentList, distributionExperimentListShape,
  distributionExperimentUpdate, distributionExperimentUpdateShape
} from '../packages/commands/src/growth-operations.js';
import {
  SEO_EVALUATION_REGISTRY_VERSION,
  seoEvaluatorGet,
  seoEvaluatorGetShape,
  seoEvaluatorList,
  seoEvaluatorListShape
} from '../packages/commands/src/seo-evaluation-registry.js';
import {
  metricSnapshotList, metricSnapshotListShape,
  optimizationContext, optimizationContextShape,
  optimizationEventCreate, optimizationEventCreateShape, optimizationEventList, optimizationEventListShape, optimizationEventUpdate, optimizationEventUpdateShape,
  remoteSitesStatus,
  seoTaskClaim, seoTaskClaimShape, seoTaskCreate, seoTaskCreateShape, seoTaskGet, seoTaskGetShape, seoTaskHeartbeat, seoTaskHeartbeatShape, seoTaskList, seoTaskListShape, seoTaskUpdate, seoTaskUpdateShape,
  seoRecoveryStatus, seoRecoveryStatusShape, seoRecoveryPortfolioUpdate, seoRecoveryPortfolioUpdateShape, seoRecoverySiteUpdate, seoRecoverySiteUpdateShape,
  seoPortfolioPolicyGet, seoPortfolioPolicyGetShape, seoPortfolioPolicyUpdate, seoPortfolioPolicyUpdateShape, seoPortfolioAllocationStatus, seoPortfolioAllocationStatusShape,
  siteArticleGet, siteArticleGetShape, siteArticleList, siteArticleListShape, siteArticleSave, siteArticleSaveShape,
  siteRegistryGet, siteRegistryGetShape, siteRegistryList, siteRegistryListShape, siteRegistryResolve, siteRegistryResolveShape, siteRegistrySave, siteRegistrySaveShape,
  siteDirectionGet, siteDirectionGetShape, siteDirectionCreate, siteDirectionCreateShape, siteDirectionList, siteDirectionListShape, siteDirectionUpdate, siteDirectionUpdateShape
} from '../packages/commands/src/remote-site-operations.js';
import {
  seoPlanningDigestGet, seoPlanningDigestGetShape, seoPlanningDigestList, seoPlanningDigestListShape
} from '../packages/commands/src/seo-planning-digest.js';
import {
  siteIndexationInspect, siteIndexationInspectShape,
  siteIndexationInventorySave, siteIndexationInventorySaveShape,
  siteIndexationList, siteIndexationListShape,
  siteIndexationSnapshotSave, siteIndexationSnapshotSaveShape,
  siteIndexationSummary, siteIndexationSummaryShape
} from '../packages/commands/src/site-indexation.js';
import {
  optimizationEvaluationContext,
  optimizationEvaluationContextShape,
  siteQueryOpportunities,
  siteQueryOpportunitiesShape
} from '../packages/commands/src/site-operations-analysis.js';
import {
  cloudflarePagesDeploymentLogs,
  cloudflarePagesDeploymentLogsShape,
  cloudflarePagesRuntimeStatus,
  cloudflarePagesSetPreviewBranchExclusions,
  cloudflarePagesPreviewBranchesShape,
  cloudflarePagesSiteStatus,
  cloudflarePagesSiteStatusShape,
  cloudflareWorkerSetSubdomain,
  cloudflareWorkerSubdomainShape,
  cloudflareWorkerSecretRecovery,
  cloudflareWorkerSecretRecoveryShape,
  cloudflareWorkerInheritSecrets,
  cloudflareWorkerInheritSecretsShape
} from '../packages/commands/src/cloudflare-pages.js';

const app = new Hono();
const configuredToken = process.env.KEYWORDS_REMOTE_MCP_TOKEN?.trim();
if (!configuredToken) throw new Error('KEYWORDS_REMOTE_MCP_TOKEN is required for the Sites Operator remote MCP');
const token: string = configuredToken;
const corsOrigin = process.env.KEYWORDS_REMOTE_MCP_ALLOWED_ORIGIN?.trim() || '*';

app.use('*', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version'], exposeHeaders: ['Mcp-Protocol-Version'] }));
function origin(c: any) { return new URL(c.req.url).origin; }
function unb64(value: string) { return Buffer.from(value, 'base64url').toString('utf8'); }
function verified(value: string, kind: string) {
  const [body, signature] = value.split('.'); if (!body || !signature) return null;
  const expected = createHmac('sha256', token).update(body).digest('base64url');
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try { const payload = JSON.parse(unb64(body)); return payload.kind === kind && typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000) ? payload : null; } catch { return null; }
}
function sameSecret(value: string) { return value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token)); }
function isAuthorized(value: string) { return sameSecret(value) || Boolean(verified(value, 'access')); }
const requireToken = async (c: any, next: any) => {
  const supplied = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  // Reuse the existing Keywords OAuth authorization server and its signed access
  // tokens. This keeps one secret and one Firebase project while MCP duties stay separate.
  if (!isAuthorized(supplied)) {
    c.header('WWW-Authenticate', `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"`);
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
};
app.use('/sites-mcp', requireToken); app.use('/api/sites-mcp', requireToken);

const structured = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : value && typeof value === 'object' ? value as Record<string, unknown> : { value }
});
function runtimeStatus() {
  return {
    ...remoteSitesStatus(),
    serverVersion: SITES_MCP_SERVER_VERSION,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
    evaluationRegistry: {
      version: SEO_EVALUATION_REGISTRY_VERSION,
      sourceOfTruth: 'versioned_git_registry'
    },
    integrations: {
      cloudflarePages: cloudflarePagesRuntimeStatus()
    },
    deployment: {
      platform: process.env.VERCEL ? 'vercel' : 'unknown',
      environment: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null
    },
    toolCount: SITES_MCP_TOOL_NAMES.length,
    tools: [...SITES_MCP_TOOL_NAMES]
  };
}

function server() {
  const mcp = new McpServer({ name: 'sites-operator', version: SITES_MCP_SERVER_VERSION });
  mcp.registerTool('remote_sites_status', { description: 'Check Sites Operator version, deployment, source-of-truth policy, Firestore configuration and tool contract. No secrets are returned.' }, async () => structured(runtimeStatus()));
  mcp.registerTool('seo_agent_context', { description: 'Role-specific contract: planner is the active scheduled SEO Manager; executor is a separate Worker with only a minimal operational gate. The archived My Portal Manager is not an actor.', inputSchema: seoAgentContextShape, annotations: { readOnlyHint: true } }, async input => {
    const context = seoAgentContext(input);
    const recovery = await seoRecoveryStatus({});
    return structured(context.role === 'planner'
      ? { ...context, recovery, macroPolicy: await seoPortfolioPolicyGet({}) }
      : { ...context, executionGate: { incidentCategory: recovery.portfolio.incidentCategory, mode: recovery.portfolio.mode,
        growthFrozenByDefault: recovery.effectivePolicy.growthFrozenByDefault,
        blockedTaskTypesUntilSiteClearance: recovery.effectivePolicy.blockedTaskTypesUntilSiteClearance,
        inFlightPolicy: recovery.effectivePolicy.inFlightPolicy,
        reminder: 'seo_task_claim enforces current policy; implement the task, not the manager strategy' } });
  });
  mcp.registerTool('seo_evaluator_list', { description: 'List versioned Sites Operator SEO evaluators. Evaluators are operational hypotheses with explicit epistemic status, not hidden Google ranking claims.', inputSchema: seoEvaluatorListShape, annotations: { readOnlyHint: true } }, async input => structured(seoEvaluatorList(input)));
  mcp.registerTool('seo_evaluator_get', { description: 'Read one SEO evaluator version with its decision rule, hard gates, qualitative signals, inference confidence, falsification conditions, and registered evidence sources/caveats.', inputSchema: seoEvaluatorGetShape, annotations: { readOnlyHint: true } }, async input => structured(seoEvaluatorGet(input)));
  mcp.registerTool('site_registry_list', { description: 'List real deployed/building sites. Site Concepts remain separate planning records in siteStructures.', inputSchema: siteRegistryListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteRegistryList(input)));
  mcp.registerTool('site_registry_get', { description: 'Read one real site and its repository, production URL, deployment provider, local project link and analytics identifiers.', inputSchema: siteRegistryGetShape, annotations: { readOnlyHint: true } }, async input => structured(await siteRegistryGet(input)));
  mcp.registerTool('site_registry_resolve', { description: 'Resolve a real site by explicit localProjectId or exact productionUrl. Returns site=null when no mapping exists; never guesses from names.', inputSchema: siteRegistryResolveShape, annotations: { readOnlyHint: true } }, async input => structured(await siteRegistryResolve(input)));
  mcp.registerTool('site_registry_save', { description: 'Create or update a real site with optimistic revision control, including siteShape (article/database/product/hybrid/other) for expansion planning. localProjectId explicitly links the Firestore site to the existing SQLite project; this does not create or edit a Site Concept.', inputSchema: siteRegistrySaveShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteRegistrySave(input)));
  mcp.registerTool('site_direction_get', { description: 'Read one durable site-direction discussion/decision record.', inputSchema: siteDirectionGetShape, annotations: { readOnlyHint: true } }, async input => structured(await siteDirectionGet(input)));
  mcp.registerTool('site_direction_create', { description: 'Open or monitor a strategic site-direction question. This records evidence and a decision question; it does not authorize implementation.', inputSchema: siteDirectionCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteDirectionCreate(input)));
  mcp.registerTool('site_direction_list', { description: 'List durable site-direction records by site, status or topic so planners can inherit prior discussions and decisions.', inputSchema: siteDirectionListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteDirectionList(input)));
  mcp.registerTool('site_direction_update', { description: 'Update a site-direction record with optimistic revision control. Mark decided only after human discussion; decided/rejected records may later be superseded.', inputSchema: siteDirectionUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteDirectionUpdate(input)));
  mcp.registerTool('seo_portfolio_policy_get', { description: 'Read active, versioned objective/allocation/risk/constraints/evaluation policy. The scheduled SEO Manager owns capital allocation, not the Worker.', inputSchema: seoPortfolioPolicyGetShape, annotations: { readOnlyHint: true } }, async input => structured(await seoPortfolioPolicyGet(input)));
  mcp.registerTool('seo_portfolio_policy_update', { description: 'Replace the whole macro-policy under expectedRevision and audited decisionReason; future manager runs and task gates immediately observe the new policy.', inputSchema: seoPortfolioPolicyUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoPortfolioPolicyUpdate(input)));
  mcp.registerTool('seo_portfolio_allocation_status', { description: 'Read planned effort distribution by current policy buckets, including legacy unallocated tasks; estimates do not assert elapsed cost or organic gains.', inputSchema: seoPortfolioAllocationStatusShape, annotations: { readOnlyHint: true } }, async input => structured(await seoPortfolioAllocationStatus(input)));
  mcp.registerTool('seo_recovery_status', { description: 'Read the durable portfolio operational incident, per-site recovery states, and effective new-work gate. Also embedded in seo_agent_context for reliable initial delivery.', inputSchema: seoRecoveryStatusShape, annotations: { readOnlyHint: true } }, async input => structured(await seoRecoveryStatus(input)));
  mcp.registerTool('seo_recovery_portfolio_update', { description: 'Enter or resolve a categorized SEO operations incident with optimistic revision control. The active versioned macro-policy determines category-specific new growth admission; in-progress claims and PR delivery continue. Returning to normal requires resolution evidence.', inputSchema: seoRecoveryPortfolioUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoRecoveryPortfolioUpdate(input)));
  mcp.registerTool('seo_recovery_site_update', { description: 'Persist one site recovery state, strategy, evidence, and release criteria for the current portfolio incident.', inputSchema: seoRecoverySiteUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoRecoverySiteUpdate(input)));
  mcp.registerTool('cloudflare_pages_site_status', {
    description: 'Diagnose publication state for one Sites Operator site through Cloudflare Pages. Resolves the Pages project by exact Git repository first, then exact production domain, and returns safe project/build settings, recent deployment stages, and SEO tasks still pending or failed publication verification. Requires CLOUDFLARE_ACCOUNT_ID and a Pages Read API token; secrets are never returned.',
    inputSchema: cloudflarePagesSiteStatusShape,
    annotations: { readOnlyHint: true }
  }, async input => {
    const site = await siteRegistryGet({ id: input.siteId });
    const taskResult = await seoTaskList({ siteId: input.siteId, limit: 100 }) as { items: any[] };
    return structured(await cloudflarePagesSiteStatus(input, site as any, taskResult.items));
  });
  mcp.registerTool('cloudflare_pages_set_preview_branch_exclusions', {
    description: 'Update one Cloudflare Pages project so selected preview branch patterns (default seo/*) do not trigger preview deployments. Preserves production deployments and other preview branches. Requires Pages Edit permission.',
    inputSchema: cloudflarePagesPreviewBranchesShape,
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async input => {
    const site = await siteRegistryGet({ id: input.siteId });
    return structured(await cloudflarePagesSetPreviewBranchExclusions(input, site as any));
  });

  mcp.registerTool('cloudflare_worker_set_subdomain', {
    description: 'Enable or disable the production workers.dev route and preview URLs for one Cloudflare Worker. Infers the Worker name from the registered repository unless workerName is provided explicitly. Requires Workers Scripts Write permission.',
    inputSchema: cloudflareWorkerSubdomainShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  }, async input => {
    const site = await siteRegistryGet({ id: input.siteId });
    return structured(await cloudflareWorkerSetSubdomain(input, site as any));
  });

  mcp.registerTool('cloudflare_worker_inherit_secrets', {
    description: 'Inherit four Learning OS secret bindings from retained Version 16 into the current Worker using Cloudflare official version_id inheritance. Defaults to read-only preflight; dryRun=false requires exact verified versions and current fetch handler. Does not read or expose secret values.',
    inputSchema: cloudflareWorkerInheritSecretsShape,
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async input => {
    const site = await siteRegistryGet({ id: input.siteId });
    return structured(await cloudflareWorkerInheritSecrets(input, site as any));
  });

  mcp.registerTool('cloudflare_worker_secret_recovery', {
    description: 'Strictly guarded Learning OS rollback to retained-secret Version 16 and cleanup of empty-secret Version 17. Defaults to read-only dryRun=true; mutations require dryRun=false and an exact verified preflight. Restricted to known version IDs and learning-os site.',
    inputSchema: cloudflareWorkerSecretRecoveryShape,
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, async input => {
    const site = await siteRegistryGet({ id: input.siteId });
    return structured(await cloudflareWorkerSecretRecovery(input, site as any));
  });

  mcp.registerTool('cloudflare_pages_deployment_logs', {
    description: 'Read Cloudflare build logs for a Sites Operator site. Cloudflare Pages sites use Pages deployment history; non-Pages sites use Workers Builds when a deploymentId/build UUID is supplied. Returns only safe deployment metadata and bounded log lines; it does not retry or mutate Cloudflare.',
    inputSchema: cloudflarePagesDeploymentLogsShape,
    annotations: { readOnlyHint: true }
  }, async input => {
    const site = await siteRegistryGet({ id: input.siteId });
    return structured(await cloudflarePagesDeploymentLogs(input, site as any));
  });
  mcp.registerTool('site_article_list', { description: 'List article registry records for a real site. Article bodies remain in Git and are never returned from Firestore.', inputSchema: siteArticleListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteArticleList(input)));
  mcp.registerTool('site_article_get', { description: 'Read one article registry record including repoPath/currentCommitSha, optional localPageId/canonicalUrl and keyword links, without article body text.', inputSchema: siteArticleGetShape, annotations: { readOnlyHint: true } }, async input => structured(await siteArticleGet(input)));
  mcp.registerTool('site_article_save', { description: 'Create or update an article registry record with optimistic revision control. localPageId/canonicalUrl can explicitly connect local GSC page observations; the Git repository remains the content source of truth.', inputSchema: siteArticleSaveShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteArticleSave(input)));
  mcp.registerTool('site_metric_snapshot_list', { description: 'Read legacy historical GSC/GA4 snapshots retained only for optimization-evidence compatibility. Current analytics are served from seo_planning_digest_* and no new snapshot writes are exposed.', inputSchema: metricSnapshotListShape, annotations: { readOnlyHint: true } }, async input => structured(await metricSnapshotList(input)));
  mcp.registerTool('site_indexation_inventory_save', { description: 'Upsert the current indexable URL inventory for one site without creating per-day history. One mutable cache document is kept per URL; changed/new URLs are scheduled for later URL Inspection.', inputSchema: siteIndexationInventorySaveShape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }, async input => structured(await siteIndexationInventorySave(input)));
  mcp.registerTool('site_indexation_inspect', { description: 'Inspect explicit URLs or the next due URL set through Search Console URL Inspection, cache the latest result, and enforce the shared per-property daily budget before calling Google.', inputSchema: siteIndexationInspectShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteIndexationInspect(input)));
  mcp.registerTool('site_indexation_list', { description: 'List current per-URL indexation cache records for one site. This reads cached observations and never calls Google.', inputSchema: siteIndexationListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteIndexationList(input)));
  mcp.registerTool('site_indexation_summary', { description: 'Aggregate the current URL cache into site and page-family indexation coverage, indexed/not-indexed observations, due counts and the shared property quota status. This never calls Google.', inputSchema: siteIndexationSummaryShape, annotations: { readOnlyHint: true } }, async input => structured(await siteIndexationSummary(input)));
  mcp.registerTool('site_indexation_snapshot_save', { description: 'Persist one overwrite-style weekly site/page-family indexation summary. Re-running within the same UTC week replaces the same snapshot slot rather than appending URL-level history.', inputSchema: siteIndexationSnapshotSaveShape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }, async input => structured(await siteIndexationSnapshotSave(input)));
  mcp.registerTool('seo_planning_digest_get', { description: 'Read the latest compact 7d/28d/90d article-planning digest for one managed site. Analytics acquisition is externalized and this read never calls Google.', inputSchema: seoPlanningDigestGetShape, annotations: { readOnlyHint: true } }, async input => structured(await seoPlanningDigestGet(input)));
  mcp.registerTool('seo_planning_digest_list', { description: 'List freshness and coverage summaries for compact site planning digests without returning all article rows.', inputSchema: seoPlanningDigestListShape, annotations: { readOnlyHint: true } }, async input => structured(await seoPlanningDigestList(input)));
  mcp.registerTool('seo_task_get', { description: 'Read one persisted SEO task with implementation evidence, execution claim lease, separate deployment-verification state, and execution history. GitHub Issue links are optional historical references.', inputSchema: seoTaskGetShape, annotations: { readOnlyHint: true } }, async input => structured(await seoTaskGet(input)));
  mcp.registerTool('seo_task_create', { description: 'Create a deduplicated, evidence-backed ready SEO task directly in Sites Operator; optional evaluation provenance records the exact evaluator/version/source IDs used for the decision. No GitHub Issue is required.', inputSchema: seoTaskCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoTaskCreate(input)));
  mcp.registerTool('seo_task_list', { description: 'List SEO tasks by site/article/type/status and deploymentVerificationStatus, including executionClaim metadata for in-progress recovery.', inputSchema: seoTaskListShape, annotations: { readOnlyHint: true } }, async input => structured(await seoTaskList(input)));
  mcp.registerTool('seo_task_claim', { description: 'Claim ready/issued work or reclaim stale/unleased in_progress work with a temporary run lease. The lease identifies only this execution run, not a persistent worker identity.', inputSchema: seoTaskClaimShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoTaskClaim(input)));
  mcp.registerTool('seo_task_heartbeat', { description: 'Renew an SEO task execution lease for the same run while implementation is actively progressing.', inputSchema: seoTaskHeartbeatShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoTaskHeartbeat(input)));
  mcp.registerTool('seo_task_update', { description: 'Transition task state, append history, and persist structured delivery handoff state. Worker writes push_pending with the exact local commit SHA before remote push; branch_ready after exact remote HEAD verification releases the execution claim. Central delivery advances PR/CI state and marks completed only after merge.', inputSchema: seoTaskUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await seoTaskUpdate(input)));
  mcp.registerTool('optimization_event_create', { description: 'Persist one SEO hypothesis/change event. Only one implemented, unevaluated change may exist per article.', inputSchema: optimizationEventCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await optimizationEventCreate(input)));
  mcp.registerTool('optimization_event_list', { description: 'List persisted SEO observations, hypotheses, changes and outcomes.', inputSchema: optimizationEventListShape, annotations: { readOnlyHint: true } }, async input => structured(await optimizationEventList(input)));
  mcp.registerTool('optimization_event_update', { description: 'Mark a hypothesis implemented/evaluated/cancelled with optimistic revision control. An implemented change defaults to a 14-day evaluation wait and cannot be scored early.', inputSchema: optimizationEventUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await optimizationEventUpdate(input)));
  mcp.registerTool('optimization_context', { description: 'Read latest GSC/GA4 observations plus the active hypothesis/cooldown before changing an article.', inputSchema: optimizationContextShape, annotations: { readOnlyHint: true } }, async input => structured(await optimizationContext(input)));
  mcp.registerTool('optimization_evaluation_context', { description: 'Build a read-only evaluation evidence packet for one optimization. Requires complete equal-length article GSC before/after periods and never invents an automatic improved/neutral/worsened verdict.', inputSchema: optimizationEvaluationContextShape, annotations: { readOnlyHint: true } }, async input => structured(await optimizationEvaluationContext(input)));
  mcp.registerTool('growth_initiative_create', { description: 'Persist a source-backed site-level growth hypothesis. Creates researching/candidate only; does not approve, deploy or publish anything.', inputSchema: growthInitiativeCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await growthInitiativeCreate(input)));
  mcp.registerTool('growth_initiative_get', { description: 'Read one versioned growth initiative, publication proof and observed measurements.', inputSchema: growthInitiativeGetShape, annotations: { readOnlyHint: true } }, async input => structured(await growthInitiativeGet(input)));
  mcp.registerTool('growth_initiative_list', { description: 'List portfolio growth initiatives by site/status, including candidates, live assets and evaluations.', inputSchema: growthInitiativeListShape, annotations: { readOnlyHint: true } }, async input => structured(await growthInitiativeList(input)));
  mcp.registerTool('growth_initiative_update', { description: 'Update a growth initiative with revision and approval, production proof, or sourced postlaunch outcome. Never runs a Worker or changes SEO Macro Policy.', inputSchema: growthInitiativeUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await growthInitiativeUpdate(input)));
  mcp.registerTool('distribution_experiment_create', { description: 'Plan a channel-specific distribution experiment linked to one registered site initiative. Creates an idea only, with no external posting.', inputSchema: distributionExperimentCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await distributionExperimentCreate(input)));
  mcp.registerTool('distribution_experiment_get', { description: 'Read one experiment and its actual native-platform publication evidence.', inputSchema: distributionExperimentGetShape, annotations: { readOnlyHint: true } }, async input => structured(await distributionExperimentGet(input)));
  mcp.registerTool('distribution_experiment_list', { description: 'List distribution experiment records by site, initiative or state.', inputSchema: distributionExperimentListShape, annotations: { readOnlyHint: true } }, async input => structured(await distributionExperimentList(input)));
  mcp.registerTool('distribution_experiment_update', { description: 'Record a real publication receipt and later metrics, requiring live first-party asset, exact state transitions and revision. Does not call a social publisher.', inputSchema: distributionExperimentUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await distributionExperimentUpdate(input)));
  mcp.registerTool('site_query_opportunities', { description: 'Compare complete equal-length non-overlapping site GSC periods and surface new/rising queries. This never calls Google Ads/SERP or writes Treasury; selected queries must go back through Keywords Operator screening.', inputSchema: siteQueryOpportunitiesShape, annotations: { readOnlyHint: true } }, async input => structured(await siteQueryOpportunities(input)));
  return mcp;
}

const health = (c: any) => c.json({ ok: true, service: 'sites-operator-mcp', ...runtimeStatus() });
const handleMcp = async (c: any) => { const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true }); const instance = server(); await instance.connect(transport); return transport.handleRequest(c.req.raw); };
app.get('/health', health); app.get('/sites-mcp/health', health); app.get('/api/sites-mcp/health', health);
app.all('/sites-mcp', handleMcp); app.all('/api/sites-mcp', handleMcp);
export default app;
