import { getDatabase } from '@keywords/db';
import { autonomyControl } from './autonomy.js';
import { operationControl } from './guard.js';
import { gscMeasurementReadiness } from './gsc-property.js';
import { googleAdsConfigured } from './workspace.js';
import { remoteSitesStatus, siteArticleList, siteRegistryResolve } from './remote-site-operations.js';
import type { SiteArticleRecord, SiteRecord } from '../../db/src/site-operations-schema.js';

const { sqlite } = getDatabase();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);

function sameOrigin(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function gitPushAllowed(blogSiteId: string | null) {
  const enabled = process.env.KEYWORDS_AUTO_GIT_PUSH === '1';
  const allowlist = (process.env.KEYWORDS_AUTO_GIT_PUSH_SITES ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return {
    enabled,
    allowlistConfigured: allowlist.length > 0,
    allowed: Boolean(enabled && blogSiteId && (!allowlist.length || allowlist.includes(blogSiteId)))
  };
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function capability(blockers: Array<string | null | undefined>) {
  const normalized = unique(blockers);
  return { ready: normalized.length === 0, blockers: normalized };
}

function action(code: string, message: string, tool?: string) {
  return { code, message, ...(tool ? { tool } : {}) };
}

async function projectReadiness(project: any) {
  const sitesRuntime = remoteSitesStatus();
  const autonomy = autonomyControl(project.id);
  const operations = operationControl(project.id);
  const binding = one('SELECT blog_site_id,origin,observed_at FROM blog_bindings WHERE project_id=?', project.id) as { blog_site_id: string; origin: string; observed_at: string } | undefined;
  const bindingFresh = Boolean(binding?.observed_at && Date.now() - Date.parse(binding.observed_at) <= 7 * 86_400_000);
  const gsc = gscMeasurementReadiness(project.id);
  const origin = gsc.origin;
  const gitPush = gitPushAllowed(binding?.blog_site_id ?? null);
  const gscCredentials = gsc.credentialsConfigured;
  const gscSiteUrlConfigured = gsc.configuredPropertyPresent;
  const gscScopeResolvable = gsc.scopeResolvable;
  const agentCommandConfigured = Boolean(process.env.KEYWORDS_AGENT_COMMAND?.trim());
  const schedulerEnabled = process.env.KEYWORDS_AUTOPILOT_SCHEDULER !== '0';
  const adsConfigured = googleAdsConfigured();

  let site: SiteRecord | null = null;
  let siteLookupFailed = false;
  let articles: SiteArticleRecord[] = [];
  if (sitesRuntime.firestoreConfigured && sitesRuntime.projectConfigured) {
    try {
      site = (await siteRegistryResolve({ localProjectId: project.id })).site as SiteRecord | null;
      if (site) articles = (await siteArticleList({ siteId: site.id, limit: 100 })).items as SiteArticleRecord[];
    } catch {
      // Keep the preflight secret-safe. SDK/backend error strings are deliberately
      // not surfaced because they can contain request or authentication context.
      siteLookupFailed = true;
    }
  }

  const mappedArticles = articles.filter(article => article.localPageId && article.canonicalUrl && article.repoPath);
  const publishedMappedArticles = mappedArticles.filter(article => article.status === 'published');
  const originMatches = Boolean(site && binding && sameOrigin(site.productionUrl, binding.origin));

  const controlPlaneBlockers: Array<string | null> = [
    !sitesRuntime.firestoreConfigured ? 'firebase_project_not_configured' : null,
    !sitesRuntime.projectConfigured ? 'firebase_service_account_not_configured' : null,
    siteLookupFailed ? 'site_registry_unavailable' : null,
    !site && !siteLookupFailed ? 'site_not_linked' : null,
    site && !site.repository ? 'site_repository_missing' : null,
    site && !site.productionUrl ? 'site_production_url_missing' : null,
    site && ['paused','archived'].includes(site.status) ? `site_status_${site.status}` : null
  ];
  const measurementBlockers: Array<string | null> = [
    ...controlPlaneBlockers,
    !gscCredentials ? 'gsc_credentials_not_configured' : null,
    !gscScopeResolvable ? 'gsc_property_scope_unresolvable' : null
  ];
  const articleOptimizationBlockers: Array<string | null> = [
    ...measurementBlockers,
    !binding ? 'blog_binding_missing' : null,
    binding && !bindingFresh ? 'blog_binding_stale' : null,
    site && binding && !originMatches ? 'blog_site_origin_mismatch' : null,
    mappedArticles.length === 0 ? 'mapped_article_registry_empty' : null,
    !gitPush.enabled ? 'auto_git_push_disabled' : null,
    gitPush.enabled && !gitPush.allowed ? 'blog_site_not_allowed_for_git_push' : null
  ];
  const queryFeedbackBlockers: Array<string | null> = [
    ...measurementBlockers,
    !adsConfigured ? 'google_ads_not_configured' : null
  ];
  const autopilotBlockers: Array<string | null> = [
    !autonomy.enabled ? 'autopilot_disabled_for_project' : null,
    operations.paused ? 'project_operations_paused' : null,
    !schedulerEnabled ? 'autopilot_scheduler_disabled' : null,
    !agentCommandConfigured ? 'persistent_agent_command_missing' : null
  ];

  const capabilities = {
    controlPlane: capability(controlPlaneBlockers),
    measurement: capability(measurementBlockers),
    articleOptimization: capability(articleOptimizationBlockers),
    queryFeedback: capability(queryFeedbackBlockers),
    autopilotExecution: capability(autopilotBlockers)
  };

  const nextActions: Array<{ code: string; message: string; tool?: string }> = [];
  if (!sitesRuntime.firestoreConfigured) nextActions.push(action('configure_firebase_project', 'Configure FIREBASE_PROJECT_ID for the Sites control plane.'));
  if (sitesRuntime.firestoreConfigured && !sitesRuntime.projectConfigured) nextActions.push(action('configure_firebase_service_account', 'Configure the Firebase service account in the runtime environment.'));
  if (sitesRuntime.firestoreConfigured && sitesRuntime.projectConfigured && !site && !siteLookupFailed) nextActions.push(action('register_real_site', `Register this deployed site once with localProjectId=${project.id}, explicit repository and productionUrl.`, 'site_registry_save'));
  if (siteLookupFailed) nextActions.push(action('repair_site_registry_access', 'Sites registry lookup failed. Check the Firestore connection and service-account access in the runtime environment.'));
  if (!binding) nextActions.push(action('confirm_blog_binding', 'Import/confirm the real Blog repository binding before automatic article sync or edits.', 'blog_importContext'));
  else if (!bindingFresh) nextActions.push(action('refresh_blog_binding', 'Refresh the confirmed Blog binding; the saved snapshot is older than seven days.', 'blog_importContext'));
  if (site && binding && !originMatches) nextActions.push(action('repair_origin_mapping', `Registered productionUrl (${site.productionUrl}) and Blog origin (${binding.origin}) must have the same origin.`));
  if (!gscCredentials) nextActions.push(action('configure_gsc_credentials', 'Configure Search Console credentials for autonomous measurement.'));
  if (!gscScopeResolvable) nextActions.push(action('configure_project_origin_or_gsc_property', 'Set a valid project domain / confirmed Blog origin, or configure GOOGLE_SEARCH_CONSOLE_SITE_URL, so the shared property resolver can select the correct Search Console property.'));
  if (site && binding && originMatches && mappedArticles.length === 0) nextActions.push(action('project_article_registry', 'Run a fresh metrics projection after the confirmed Blog binding so mapped article metadata can sync into Sites.'));
  if (!gitPush.enabled) nextActions.push(action('enable_git_delivery', 'Set KEYWORDS_AUTO_GIT_PUSH=1 when autonomous verified article delivery is desired.'));
  else if (!gitPush.allowed) nextActions.push(action('allow_blog_site_git_delivery', `Add Blog site ${binding?.blog_site_id ?? '(missing)'} to KEYWORDS_AUTO_GIT_PUSH_SITES, or leave the allowlist empty to allow all confirmed Blog sites.`));
  if (!adsConfigured) nextActions.push(action('configure_google_ads', 'Configure Google Ads demand access before enabling the GSC-query feedback research loop.'));
  if (!autonomy.enabled) nextActions.push(action('enable_project_autopilot', 'Enable Autopilot for this project through the human configuration path.'));
  if (operations.paused) nextActions.push(action('resume_project_operations', `Project operations are paused${operations.reason ? `: ${operations.reason}` : '.'}`));
  if (!schedulerEnabled) nextActions.push(action('enable_autopilot_scheduler', 'Remove KEYWORDS_AUTOPILOT_SCHEDULER=0 so the existing scheduler can tick.'));
  if (!agentCommandConfigured) nextActions.push(action('configure_persistent_agent', 'Configure KEYWORDS_AGENT_COMMAND so queued Operations have a persistent executor.'));

  const readyForClosedLoop = capabilities.measurement.ready && capabilities.articleOptimization.ready && capabilities.autopilotExecution.ready;

  return {
    project: { id: project.id, name: project.name, domain: project.domain, mode: project.mode, environment: project.environment },
    site: site ? {
      id: site.id, status: site.status, repository: site.repository, productionUrl: site.productionUrl,
      deploymentProvider: site.deploymentProvider, searchConsoleProperty: site.searchConsoleProperty, ga4PropertyId: site.ga4PropertyId
    } : null,
    siteLookupError: siteLookupFailed ? 'site_registry_unavailable' : null,
    blog: binding ? { siteId: binding.blog_site_id, origin: binding.origin, observedAt: binding.observed_at, fresh: bindingFresh, originMatchesRegisteredSite: originMatches } : null,
    articleRegistry: { total: articles.length, mapped: mappedArticles.length, publishedMapped: publishedMappedArticles.length, boundedAt: 100 },
    runtime: {
      firestoreConfigured: sitesRuntime.firestoreConfigured && sitesRuntime.projectConfigured,
      gscCredentialsConfigured: gscCredentials,
      gscSiteUrlConfigured,
      gscPropertyDiscoveryAvailable: gsc.propertyDiscoveryAvailable,
      gscScopeResolvable,
      googleAdsConfigured: adsConfigured,
      autoGitPush: gitPush,
      autopilot: { enabled: autonomy.enabled, autoApprove: autonomy.autoApprove, autoPublish: autonomy.autoPublish, cadenceMinutes: autonomy.cadenceMinutes },
      operationPaused: operations.paused,
      schedulerEnabled,
      persistentAgentCommandConfigured: agentCommandConfigured
    },
    capabilities,
    readyForClosedLoop,
    nextActions
  };
}

/**
 * Read-only operational preflight. It exposes configuration state, never secret values.
 * With no projectId it checks every local existing_site project.
 */
export async function siteOperationsReadiness(input: { projectId?: string } = {}) {
  const projects = input.projectId
    ? rows('SELECT id,name,domain,mode,environment FROM projects WHERE id=?', input.projectId)
    : rows("SELECT id,name,domain,mode,environment FROM projects WHERE mode='existing_site' ORDER BY name");
  if (input.projectId && !projects.length) throw new Error('Project not found');
  const results = [];
  for (const project of projects) results.push(await projectReadiness(project));
  return {
    generatedAt: new Date().toISOString(),
    scope: input.projectId ? 'project' : 'existing_sites',
    projects: results,
    summary: {
      total: results.length,
      closedLoopReady: results.filter(result => result.readyForClosedLoop).length,
      measurementReady: results.filter(result => result.capabilities.measurement.ready).length,
      optimizationReady: results.filter(result => result.capabilities.articleOptimization.ready).length,
      queryFeedbackReady: results.filter(result => result.capabilities.queryFeedback.ready).length,
      autopilotReady: results.filter(result => result.capabilities.autopilotExecution.ready).length
    },
    policy: {
      readOnly: true,
      noSecretsReturned: true,
      siteRegistrationRemainsExplicit: true,
      globalGscPropertyOptionalWhenProjectOriginCanBeDiscovered: true,
      articleBodySourceOfTruth: 'git_repository',
      cloudControlPlane: 'firestore',
      localExecutionPlane: 'sqlite'
    }
  };
}
