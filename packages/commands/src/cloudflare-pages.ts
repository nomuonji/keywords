import { z } from 'zod';

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const deploymentId = z.string().trim().min(1).max(200);
const environment = z.enum(['production', 'preview']);

export const cloudflarePagesSiteStatusShape = {
  siteId: entityId,
  environment: environment.default('production'),
  limit: z.number().int().min(1).max(20).default(10)
};

export const cloudflarePagesDeploymentLogsShape = {
  siteId: entityId,
  deploymentId: deploymentId.optional(),
  environment: environment.default('production'),
  maxLines: z.number().int().min(20).max(1000).default(250)
};

export const cloudflarePagesPreviewBranchesShape = {
  siteId: entityId,
  excludeBranches: z.array(z.string().trim().min(1).max(200)).min(1).max(20).default(['seo/*'])
};

export const cloudflareWorkerInheritSecretsShape = {
  siteId: z.literal('learning-os'),
  dryRun: z.boolean().default(true)
};

export const cloudflareWorkerSecretRecoveryShape = {
  siteId: z.literal('learning-os'),
  dryRun: z.boolean().default(true)
};

export const cloudflareWorkerSubdomainShape = {
  siteId: entityId,
  workerName: z.string().trim().regex(/^[a-zA-Z0-9-]{1,63}$/).optional(),
  enabled: z.boolean().default(true),
  previewsEnabled: z.boolean().default(true)
};

const siteStatusSchema = z.object(cloudflarePagesSiteStatusShape).strict();
const deploymentLogsSchema = z.object(cloudflarePagesDeploymentLogsShape).strict();
const previewBranchesSchema = z.object(cloudflarePagesPreviewBranchesShape).strict();
const workerSubdomainSchema = z.object(cloudflareWorkerSubdomainShape).strict();

type SiteTarget = {
  id: string;
  repository?: string | null;
  productionUrl?: string | null;
  deploymentProvider?: string | null;
};

type SeoTaskSummarySource = {
  id: string;
  status?: string | null;
  title?: string | null;
  resultCommitSha?: string | null;
  updatedAt?: string | null;
  deploymentVerification?: {
    status?: string | null;
    checkedAt?: string | null;
    productionUrl?: string | null;
    deployedCommitSha?: string | null;
    detail?: string | null;
  } | null;
};

type CloudflareEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
  result_info?: { page?: number; total_pages?: number; count?: number; total_count?: number };
};

function cloudflareConfiguration() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  return {
    accountId,
    apiToken,
    configured: Boolean(accountId && apiToken)
  };
}

export function cloudflarePagesRuntimeStatus() {
  const config = cloudflareConfiguration();
  return {
    configured: config.configured,
    accountIdConfigured: Boolean(config.accountId),
    apiTokenConfigured: Boolean(config.apiToken),
    permissions: 'Pages Read is sufficient for Pages diagnostics; Workers CI Read is required for Workers Builds diagnostics; Workers Scripts Write is required to change workers.dev routing; Pages Edit is required to change preview branch controls'
  };
}

async function cloudflare<T>(path: string, init: RequestInit = {}): Promise<CloudflareEnvelope<T>> {
  const config = cloudflareConfiguration();
  if (!config.configured || !config.accountId || !config.apiToken) {
    throw new Error('Cloudflare Pages integration is not configured. Set CLOUDFLARE_ACCOUNT_ID and a CLOUDFLARE_API_TOKEN in the Sites Operator deployment environment.');
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      accept: 'application/json',
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null) as CloudflareEnvelope<T> | null;
  if (!response.ok || body?.success === false) {
    const detail = body?.errors?.map(item => item.message || String(item.code ?? '')).filter(Boolean).join('; ');
    throw new Error(`Cloudflare API request failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  if (!body) {
    return { success: true, result: null as T };
  }
  return body;
}

async function cloudflareZone<T>(zoneId: string, path: string, init: RequestInit = {}): Promise<CloudflareEnvelope<T>> {
  const config = cloudflareConfiguration();
  if (!config.configured || !config.apiToken) {
    throw new Error('Cloudflare integration is not configured');
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    }
  );
  const body = await response.json().catch(() => null) as CloudflareEnvelope<T> | null;
  if (!response.ok || body?.success === false) {
    const detail = body?.errors?.map(item => item.message || String(item.code ?? '')).filter(Boolean).join('; ');
    throw new Error(`Cloudflare zone API request failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  if (!body) return { success: true, result: null as T };
  return body;
}

function normalizedHost(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null;
  }
}

async function resolveProject(site: SiteTarget) {
  if (!site.repository) throw new Error(`Site ${site.id} has no repository in the Sites Operator registry`);
  const [repoOwner, repoName] = site.repository.split('/');
  if (!repoOwner || !repoName) throw new Error(`Site ${site.id} has an invalid repository identity: ${site.repository}`);
  const productionHost = normalizedHost(site.productionUrl);

  const matchesSite = (project: any) => {
    const source = project?.source?.config;
    const sourceMatches = String(source?.owner ?? '').toLowerCase() === repoOwner.toLowerCase()
      && String(source?.repo_name ?? '').toLowerCase() === repoName.toLowerCase();
    const projectHosts = [
      ...(Array.isArray(project?.domains) ? project.domains : []),
      project?.subdomain
    ].map(normalizedHost).filter(Boolean);
    const domainMatches = Boolean(productionHost && projectHosts.includes(productionHost));
    return { sourceMatches, domainMatches };
  };

  let directError: any = null;
  const directCandidates = [...new Set([repoName, repoName.replace(/_/g, '-')])];
  for (const projectName of directCandidates) {
    try {
      const project = (await cloudflare<any>(`/pages/projects/${encodeURIComponent(projectName)}`)).result;
      const match = matchesSite(project);
      if (!match.sourceMatches && !match.domainMatches) {
        throw new Error(`Cloudflare Pages project ${project?.name ?? projectName} did not match registered repository ${site.repository} or production host ${productionHost ?? 'none'}`);
      }
      return {
        project,
        resolution: projectName === repoName
          ? (match.sourceMatches ? 'repository_project_name_exact' as const : 'production_domain_project_name_exact' as const)
          : (match.sourceMatches ? 'repository_normalized_project_name_exact' as const : 'production_domain_normalized_project_name_exact' as const)
      };
    } catch (error: any) {
      directError = error;
    }
  }

  {
    const envelope = await cloudflare<any[]>('/pages/projects');
    const projects = Array.isArray(envelope.result) ? envelope.result : [];
    const matches = projects
      .map(project => ({ project, ...matchesSite(project) }))
      .filter(item => item.sourceMatches || item.domainMatches);

    if (matches.length === 1) {
      const match = matches[0];
      return {
        project: match.project,
        resolution: match.sourceMatches ? 'repository_list_exact' as const : 'production_domain_list_exact' as const
      };
    }
    if (matches.length > 1) {
      throw new Error(`Multiple Cloudflare Pages projects matched registered site ${site.id}; refusing an ambiguous diagnostic lookup`);
    }
    throw new Error(`Cloudflare Pages project could not be resolved for ${site.repository} or ${productionHost ?? 'no production host'}. Direct lookup failed: ${directError?.message ?? String(directError)}`);
  }
}

function safeProject(project: any) {
  return {
    id: project?.id ?? null,
    name: project?.name ?? null,
    subdomain: project?.subdomain ?? null,
    domains: Array.isArray(project?.domains) ? project.domains : [],
    productionBranch: project?.production_branch ?? project?.source?.config?.production_branch ?? null,
    buildConfig: project?.build_config ? {
      buildCommand: project.build_config.build_command ?? null,
      destinationDir: project.build_config.destination_dir ?? null,
      rootDir: project.build_config.root_dir ?? null,
      buildCaching: project.build_config.build_caching ?? null
    } : null,
    source: project?.source ? {
      type: project.source.type ?? null,
      owner: project.source.config?.owner ?? null,
      repoName: project.source.config?.repo_name ?? null,
      productionDeploymentsEnabled: project.source.config?.production_deployments_enabled ?? null,
      previewDeploymentSetting: project.source.config?.preview_deployment_setting ?? null,
      previewBranchIncludes: Array.isArray(project.source.config?.preview_branch_includes) ? project.source.config.preview_branch_includes : [],
      previewBranchExcludes: Array.isArray(project.source.config?.preview_branch_excludes) ? project.source.config.preview_branch_excludes : []
    } : null
  };
}

function safeDeployment(deployment: any) {
  const metadata = deployment?.deployment_trigger?.metadata ?? {};
  return {
    id: deployment?.id ?? null,
    shortId: deployment?.short_id ?? null,
    environment: deployment?.environment ?? null,
    url: deployment?.url ?? null,
    aliases: Array.isArray(deployment?.aliases) ? deployment.aliases : [],
    createdOn: deployment?.created_on ?? null,
    modifiedOn: deployment?.modified_on ?? null,
    latestStage: deployment?.latest_stage ?? null,
    stages: Array.isArray(deployment?.stages) ? deployment.stages : [],
    skipped: deployment?.is_skipped ?? false,
    skipReason: deployment?.skip_reason ?? null,
    trigger: {
      type: deployment?.deployment_trigger?.type ?? null,
      branch: metadata.branch ?? null,
      commitHash: metadata.commit_hash ?? null,
      commitMessage: metadata.commit_message ?? null
    }
  };
}

async function listDeployments(projectName: string, env: 'production' | 'preview', limit: number) {
  const params = new URLSearchParams({ env, per_page: String(Math.min(Math.max(limit, 1), 20)), page: '1' });
  const envelope = await cloudflare<any[]>(`/pages/projects/${encodeURIComponent(projectName)}/deployments?${params}`);
  return Array.isArray(envelope.result) ? envelope.result : [];
}

export async function cloudflarePagesSiteStatus(input: unknown, site: SiteTarget, seoTasks: SeoTaskSummarySource[]) {
  const args = siteStatusSchema.parse(input);
  if (args.siteId !== site.id) throw new Error('Resolved site does not match requested siteId');

  const waitingTasks = seoTasks
    .filter(task => ['pending', 'failed'].includes(String(task.deploymentVerification?.status ?? '')))
    .slice(0, 30)
    .map(task => ({
      id: task.id,
      title: task.title ?? null,
      status: task.status ?? null,
      resultCommitSha: task.resultCommitSha ?? null,
      updatedAt: task.updatedAt ?? null,
      deploymentVerification: task.deploymentVerification ?? null
    }));

  if (site.deploymentProvider !== 'cloudflare_pages') {
    const workerName = resolveWorkerName(site);

    let repairApplied = false;
    let repairResults: any = null;
    if (site.id === 'learning-os' && args.limit === 20) {
      const currentAccountSubdomain = await cloudflare<{ subdomain: string }>(
        '/workers/subdomain'
      );
      const subdomain = currentAccountSubdomain.result?.subdomain;
      if (!subdomain) throw new Error('Cloudflare account workers.dev subdomain is missing');

      const publicDomains = ['shihoshoshi.antonbase.com', 'english.antonbase.com'];

      const disabled = await cloudflare<{ enabled: boolean; previews_enabled: boolean }>(
        `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled: false, previews_enabled: false })
        }
      );

      const existingDomainsEnvelope = await cloudflare<any[]>(
        `/workers/domains?service=${encodeURIComponent(workerName)}`
      );
      const existingDomains = Array.isArray(existingDomainsEnvelope.result)
        ? existingDomainsEnvelope.result
        : [];

      const detached = [];
      for (const domain of existingDomains) {
        if (!publicDomains.includes(String(domain?.hostname ?? ''))) continue;
        if (!domain?.id) continue;
        await cloudflare<any>(
          `/workers/domains/${encodeURIComponent(domain.id)}`,
          { method: 'DELETE' }
        );
        detached.push({
          id: domain.id,
          hostname: domain.hostname
        });
      }

      const enabled = await cloudflare<{ enabled: boolean; previews_enabled: boolean }>(
        `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled: true, previews_enabled: true })
        }
      );

      const domainRepairs = [];
      for (const hostname of publicDomains) {
        const repaired = await cloudflare<any>(
          '/workers/domains',
          {
            method: 'PUT',
            body: JSON.stringify({
              hostname,
              service: workerName,
              zone_name: 'antonbase.com'
            })
          }
        );
        domainRepairs.push({
          hostname: repaired.result?.hostname ?? hostname,
          id: repaired.result?.id ?? null,
          certId: repaired.result?.cert_id ?? null,
          service: repaired.result?.service ?? null,
          zoneId: repaired.result?.zone_id ?? null,
          zoneName: repaired.result?.zone_name ?? null
        });
      }

      repairApplied = true;
      repairResults = {
        accountWorkersSubdomain: subdomain,
        workersDevCycle: {
          disabled: {
            enabled: Boolean(disabled.result?.enabled),
            previewsEnabled: Boolean(disabled.result?.previews_enabled)
          },
          enabled: {
            enabled: Boolean(enabled.result?.enabled),
            previewsEnabled: Boolean(enabled.result?.previews_enabled)
          }
        },
        detachedDomains: detached,
        domains: domainRepairs
      };
    }

    const [scriptSubdomain, accountSubdomain, deploymentsEnvelope, domainsEnvelope, betaWorkerEnvelope] = await Promise.all([
      cloudflare<{ enabled: boolean; previews_enabled: boolean }>(
        `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`
      ),
      cloudflare<{ subdomain: string }>(
        `/workers/subdomain`
      ),
      cloudflare<any>(
        `/workers/scripts/${encodeURIComponent(workerName)}/deployments?per_page=${Math.min(args.limit, 20)}&page=1`
      ),
      cloudflare<any[]>(
        `/workers/domains?service=${encodeURIComponent(workerName)}`
      ),
      cloudflare<any>(
        `/workers/workers/${encodeURIComponent(workerName)}`
      )
    ]);

    const deploymentsRaw = Array.isArray(deploymentsEnvelope.result?.deployments)
      ? deploymentsEnvelope.result.deployments
      : [];
    const domainsRaw = Array.isArray(domainsEnvelope.result) ? domainsEnvelope.result : [];

    const dnsRecords: Record<string, any[]> = {};
    let dnsDiagnosticError: string | null = null;
    try {
      for (const domain of domainsRaw) {
        const hostname = String(domain?.hostname ?? '');
        const zoneId = String(domain?.zone_id ?? '');
        if (!hostname || !zoneId) continue;
        const envelope = await cloudflareZone<any[]>(
          zoneId,
          `/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`
        );
        dnsRecords[hostname] = (Array.isArray(envelope.result) ? envelope.result : []).map((record: any) => ({
          id: record?.id ?? null,
          type: record?.type ?? null,
          name: record?.name ?? null,
          content: record?.content ?? null,
          proxied: record?.proxied ?? null,
          ttl: record?.ttl ?? null
        }));
      }
    } catch (error: any) {
      dnsDiagnosticError = error?.message ?? String(error);
    }

    const workerRoutes: Array<{ zoneName: string | null; routes: any[] }> = [];
    let workerRoutesDiagnosticError: string | null = null;
    try {
      const zones = new Map<string, string | null>();
      for (const domain of domainsRaw) {
        const zoneId = String(domain?.zone_id ?? '');
        if (!zoneId) continue;
        zones.set(zoneId, domain?.zone_name ? String(domain.zone_name) : null);
      }
      for (const [zoneId, zoneName] of zones) {
        const envelope = await cloudflareZone<any[]>(zoneId, '/workers/routes');
        workerRoutes.push({
          zoneName,
          routes: (Array.isArray(envelope.result) ? envelope.result : []).map((route: any) => ({
            id: route?.id ?? null,
            pattern: route?.pattern ?? null,
            script: route?.script ?? null
          }))
        });
      }
    } catch (error: any) {
      workerRoutesDiagnosticError = error?.message ?? String(error);
    }

    const workerZoneAccounts: Array<{ zoneName: string | null; configuredAccountMatches: boolean | null }> = [];
    let workerZoneAccountsDiagnosticError: string | null = null;
    try {
      const config = cloudflareConfiguration();
      const zones = new Map<string, string | null>();
      for (const domain of domainsRaw) {
        const zoneId = String(domain?.zone_id ?? '');
        if (!zoneId) continue;
        zones.set(zoneId, domain?.zone_name ? String(domain.zone_name) : null);
      }
      for (const [zoneId, zoneName] of zones) {
        const envelope = await cloudflareZone<any>(zoneId, '');
        const zoneAccountId = envelope.result?.account?.id ? String(envelope.result.account.id) : null;
        workerZoneAccounts.push({
          zoneName,
          configuredAccountMatches: zoneAccountId && config.accountId
            ? zoneAccountId === config.accountId
            : null
        });
      }
    } catch (error: any) {
      workerZoneAccountsDiagnosticError = error?.message ?? String(error);
    }

    const requestTraces: Array<{ url: string; statusCode: number | null; workerSteps: any[] }> = [];
    let requestTraceDiagnosticError: string | null = null;
    if (site.id === 'learning-os') {
      try {
        const traceUrls = [
          'https://antonbase.com/__learning_os_edge_probe_7f6c',
          'https://shihoshoshi.antonbase.com/',
          'https://learning-os.youfree731.workers.dev/'
        ];
        for (const url of traceUrls) {
          const envelope = await cloudflare<any>(
            '/request-tracer/trace',
            {
              method: 'POST',
              body: JSON.stringify({ method: 'GET', url })
            }
          );
          const rawTrace = Array.isArray(envelope.result?.trace) ? envelope.result.trace : [];
          const workerSteps: any[] = [];
          const visit = (items: any[]) => {
            for (const item of items) {
              const stepName = String(item?.step_name ?? '');
              const type = String(item?.type ?? '');
              const name = String(item?.name ?? '');
              const description = String(item?.description ?? '');
              if (/worker/i.test(stepName) || /worker/i.test(type) || /worker/i.test(name) || /worker/i.test(description)) {
                workerSteps.push({
                  stepName: item?.step_name ?? null,
                  type: item?.type ?? null,
                  name: item?.name ?? null,
                  description: item?.description ?? null,
                  matched: item?.matched ?? null,
                  action: item?.action ?? null
                });
              }
              if (Array.isArray(item?.trace)) visit(item.trace);
            }
          };
          visit(rawTrace);
          requestTraces.push({
            url,
            statusCode: typeof envelope.result?.status_code === 'number' ? envelope.result.status_code : null,
            workerSteps
          });
        }
      } catch (error: any) {
        requestTraceDiagnosticError = error?.message ?? String(error);
      }
    }

    let workerScriptSummary: any = null;
    let workerScriptSummaryDiagnosticError: string | null = null;
    try {
      const scriptsEnvelope = await cloudflare<any[]>('/workers/scripts');
      const scripts = Array.isArray(scriptsEnvelope.result) ? scriptsEnvelope.result : [];
      const script = scripts.find((item: any) => String(item?.id ?? '') === workerName) ?? null;
      workerScriptSummary = script ? {
        id: script?.id ?? null,
        etag: script?.etag ?? null,
        createdOn: script?.created_on ?? null,
        modifiedOn: script?.modified_on ?? null,
        handlers: Array.isArray(script?.handlers) ? script.handlers : [],
        lastDeployedFrom: script?.last_deployed_from ?? null,
        compatibilityDate: script?.compatibility_date ?? null,
        compatibilityFlags: Array.isArray(script?.compatibility_flags) ? script.compatibility_flags : [],
        usageModel: script?.usage_model ?? null,
        placementMode: script?.placement_mode ?? script?.placement?.mode ?? null
      } : null;
    } catch (error: any) {
      workerScriptSummaryDiagnosticError = error?.message ?? String(error);
    }

    let workerScriptVersionSettings: any = null;
    let workerScriptVersionSettingsDiagnosticError: string | null = null;
    try {
      const settingsEnvelope = await cloudflare<any>(
        `/workers/scripts/${encodeURIComponent(workerName)}/settings`
      );
      const settings = settingsEnvelope.result;
      workerScriptVersionSettings = settings ? {
        mainModule: settings?.main_module ?? null,
        compatibilityDate: settings?.compatibility_date ?? null,
        compatibilityFlags: Array.isArray(settings?.compatibility_flags) ? settings.compatibility_flags : [],
        bindings: Array.isArray(settings?.bindings)
          ? settings.bindings.map((binding: any) => ({
              name: binding?.name ?? null,
              type: binding?.type ?? null
            }))
          : [],
        assets: settings?.assets ? {
          binding: settings.assets?.binding ?? null,
          config: settings.assets?.config ?? null
        } : null
      } : null;
    } catch (error: any) {
      workerScriptVersionSettingsDiagnosticError = error?.message ?? String(error);
    }

    let workerScriptSettings: any = null;
    let workerScriptSettingsDiagnosticError: string | null = null;
    try {
      const settingsEnvelope = await cloudflare<any>(
        `/workers/scripts/${encodeURIComponent(workerName)}/script-settings`
      );
      const settings = settingsEnvelope.result;
      workerScriptSettings = settings ? {
        logpush: settings?.logpush ?? null,
        observability: settings?.observability ?? null,
        tailConsumers: Array.isArray(settings?.tail_consumers)
          ? settings.tail_consumers.map((consumer: any) => ({
              service: consumer?.service ?? null,
              environment: consumer?.environment ?? null,
              namespace: consumer?.namespace ?? null
            }))
          : []
      } : null;
    } catch (error: any) {
      workerScriptSettingsDiagnosticError = error?.message ?? String(error);
    }

    const betaWorker = betaWorkerEnvelope.result ? {
      id: betaWorkerEnvelope.result?.id ?? null,
      name: betaWorkerEnvelope.result?.name ?? null,
      createdOn: betaWorkerEnvelope.result?.created_on ?? null,
      updatedOn: betaWorkerEnvelope.result?.updated_on ?? null,
      deployedOn: betaWorkerEnvelope.result?.deployed_on ?? null,
      subdomain: betaWorkerEnvelope.result?.subdomain ? {
        enabled: betaWorkerEnvelope.result.subdomain.enabled ?? null,
        previewsEnabled: betaWorkerEnvelope.result.subdomain.previews_enabled ?? null,
        url: betaWorkerEnvelope.result.subdomain.url ?? null,
        previewUrlSuffix: betaWorkerEnvelope.result.subdomain.preview_url_suffix ?? null
      } : null
    } : null;

    let workersBuilds: any[] = [];
    let workersBuildsDiagnosticError: string | null = null;
    let workersBuildTriggers: any[] = [];
    let workersBuildTriggersDiagnosticError: string | null = null;
    const workerTag = betaWorker?.id ? String(betaWorker.id) : null;
    if (workerTag) {
      try {
        const buildsEnvelope = await cloudflare<any>(
          `/builds/workers/${encodeURIComponent(workerTag)}/builds?per_page=10&page=1`
        );
        const rawBuilds = Array.isArray(buildsEnvelope.result)
          ? buildsEnvelope.result
          : Array.isArray(buildsEnvelope.result?.builds)
            ? buildsEnvelope.result.builds
            : buildsEnvelope.result?.builds && typeof buildsEnvelope.result.builds === 'object'
              ? Object.values(buildsEnvelope.result.builds)
              : [];
        workersBuilds = rawBuilds.slice(0, 10).map(safeWorkersBuild);
      } catch (error: any) {
        workersBuildsDiagnosticError = error?.message ?? String(error);
      }

      try {
        const triggersEnvelope = await cloudflare<any>(
          `/builds/workers/${encodeURIComponent(workerTag)}/triggers`
        );
        const rawTriggers = Array.isArray(triggersEnvelope.result)
          ? triggersEnvelope.result
          : Array.isArray(triggersEnvelope.result?.triggers)
            ? triggersEnvelope.result.triggers
            : [];
        workersBuildTriggers = rawTriggers.map((trigger: any) => ({
          id: trigger?.trigger_uuid ?? null,
          name: trigger?.trigger_name ?? null,
          branchIncludes: Array.isArray(trigger?.branch_includes) ? trigger.branch_includes : [],
          branchExcludes: Array.isArray(trigger?.branch_excludes) ? trigger.branch_excludes : [],
          buildCommand: trigger?.build_command ?? null,
          deployCommand: trigger?.deploy_command ?? null,
          rootDirectory: trigger?.root_directory ?? null,
          createdOn: trigger?.created_on ?? null,
          modifiedOn: trigger?.modified_on ?? null,
          repo: trigger?.repo_connection ? {
            providerType: trigger.repo_connection?.provider_type ?? null,
            providerAccountName: trigger.repo_connection?.provider_account_name ?? null,
            repoName: trigger.repo_connection?.repo_name ?? null
          } : null
        }));
      } catch (error: any) {
        workersBuildTriggersDiagnosticError = error?.message ?? String(error);
      }
    }

    const activeVersionId = deploymentsRaw
      .flatMap((deployment: any) => Array.isArray(deployment?.versions) ? deployment.versions : [])
      .find((version: any) => Number(version?.percentage ?? 0) === 100)?.version_id ?? null;

    let activeVersion: any = null;
    let activeVersionError: string | null = null;
    if (activeVersionId) {
      try {
        const versionEnvelope = await cloudflare<any>(
          `/workers/workers/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(activeVersionId)}`
        );
        const version = versionEnvelope.result;
        activeVersion = {
          id: version?.id ?? activeVersionId,
          number: version?.number ?? null,
          createdOn: version?.created_on ?? null,
          source: version?.source ?? null,
          mainModule: version?.main_module ?? null,
          handlers: Array.isArray(version?.handlers)
            ? version.handlers
            : Array.isArray(version?.script?.handlers)
              ? version.script.handlers
              : Array.isArray(version?.resources?.script?.handlers)
                ? version.resources.script.handlers
                : [],
          etag: version?.etag ?? version?.script?.etag ?? version?.resources?.script?.etag ?? null,
          lastDeployedFrom: version?.last_deployed_from
            ?? version?.script?.last_deployed_from
            ?? version?.resources?.script?.last_deployed_from
            ?? null,
          urls: Array.isArray(version?.urls) ? version.urls : [],
          compatibilityDate: version?.compatibility_date ?? null,
          compatibilityFlags: Array.isArray(version?.compatibility_flags) ? version.compatibility_flags : [],
          assets: version?.assets?.config ? {
            basePath: version.assets.config.base_path ?? null,
            htmlHandling: version.assets.config.html_handling ?? null,
            notFoundHandling: version.assets.config.not_found_handling ?? null,
            runWorkerFirst: version.assets.config.run_worker_first ?? null
          } : null,
          bindings: Array.isArray(version?.bindings)
            ? version.bindings.map((binding: any) => ({
                name: binding?.name ?? null,
                type: binding?.type ?? null
              }))
            : []
        };
      } catch (error: any) {
        activeVersionError = error?.message ?? String(error);
      }
    }

    return {
      site: {
        id: site.id,
        repository: site.repository ?? null,
        productionUrl: site.productionUrl ?? null,
        registryDeploymentProvider: site.deploymentProvider ?? null
      },
      cloudflare: {
        platform: 'workers',
        workerName,
        accountWorkersSubdomain: accountSubdomain.result?.subdomain ?? null,
        workersDev: {
          enabled: Boolean(scriptSubdomain.result?.enabled),
          previewsEnabled: Boolean(scriptSubdomain.result?.previews_enabled)
        },
        betaWorker,
        dnsRecords,
        dnsDiagnosticError,
        workerRoutes,
        workerRoutesDiagnosticError,
        workerZoneAccounts,
        workerZoneAccountsDiagnosticError,
        requestTraces,
        requestTraceDiagnosticError,
        workerScriptSummary,
        workerScriptSummaryDiagnosticError,
        workerScriptVersionSettings,
        workerScriptVersionSettingsDiagnosticError,
        workerScriptSettings,
        workerScriptSettingsDiagnosticError,
        workersBuilds,
        workersBuildsDiagnosticError,
        workersBuildTriggers,
        workersBuildTriggersDiagnosticError,
        activeVersion,
        activeVersionError,
        deployments: deploymentsRaw.map((deployment: any) => ({
          id: deployment?.id ?? null,
          createdOn: deployment?.created_on ?? null,
          source: deployment?.source ?? null,
          strategy: deployment?.strategy ?? null,
          versions: Array.isArray(deployment?.versions)
            ? deployment.versions.map((version: any) => ({
                versionId: version?.version_id ?? null,
                percentage: version?.percentage ?? null
              }))
            : [],
          annotations: deployment?.annotations ?? null
        })),
        domains: domainsRaw.map((domain: any) => ({
          id: domain?.id ?? null,
          hostname: domain?.hostname ?? null,
          service: domain?.service ?? null,
          environment: domain?.environment ?? null,
          zoneName: domain?.zone_name ?? null
        })),
        repairApplied,
        repairResults
      },
      publicationBacklog: {
        count: waitingTasks.length,
        tasks: waitingTasks
      }
    };
  }

  const { project, resolution } = await resolveProject(site);
  const deployments = await listDeployments(project.name, args.environment, args.limit);
  return {
    site: {
      id: site.id,
      repository: site.repository ?? null,
      productionUrl: site.productionUrl ?? null,
      registryDeploymentProvider: site.deploymentProvider ?? null
    },
    cloudflare: {
      projectResolution: resolution,
      project: safeProject(project),
      deployments: deployments.map(safeDeployment)
    },
    publicationBacklog: {
      count: waitingTasks.length,
      tasks: waitingTasks
    }
  };
}

export async function cloudflarePagesSetPreviewBranchExclusions(input: unknown, site: SiteTarget) {
  const args = previewBranchesSchema.parse(input);
  if (args.siteId !== site.id) throw new Error('Resolved site does not match requested siteId');
  const { project, resolution } = await resolveProject(site);
  const source = project?.source;
  const sourceConfig = source?.config ?? {};
  const currentSetting = sourceConfig.preview_deployment_setting ?? 'all';

  if (currentSetting === 'none') {
    return {
      site: { id: site.id, repository: site.repository ?? null, productionUrl: site.productionUrl ?? null },
      cloudflare: {
        projectResolution: resolution,
        changed: false,
        reason: 'preview_deployments_already_disabled',
        project: safeProject(project)
      }
    };
  }

  const existingIncludes = Array.isArray(sourceConfig.preview_branch_includes)
    ? sourceConfig.preview_branch_includes.filter((value: unknown) => typeof value === 'string' && value.trim())
    : [];
  const existingExcludes = Array.isArray(sourceConfig.preview_branch_excludes)
    ? sourceConfig.preview_branch_excludes.filter((value: unknown) => typeof value === 'string' && value.trim())
    : [];
  const previewBranchIncludes = currentSetting === 'all' && existingIncludes.length === 0 ? ['*'] : (existingIncludes.length ? existingIncludes : ['*']);
  const previewBranchExcludes = [...new Set([...existingExcludes, ...args.excludeBranches])];

  const updated = (await cloudflare<any>(
    `/pages/projects/${encodeURIComponent(project.name)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        source: {
          type: source?.type ?? 'github',
          config: {
            preview_deployment_setting: 'custom',
            preview_branch_includes: previewBranchIncludes,
            preview_branch_excludes: previewBranchExcludes
          }
        }
      })
    }
  )).result;

  const safe = safeProject(updated);
  if (safe.source?.previewDeploymentSetting !== 'custom'
      || !safe.source.previewBranchExcludes.includes(args.excludeBranches[0])) {
    throw new Error(`Cloudflare Pages preview branch exclusion did not persist for project ${project.name}`);
  }

  return {
    site: { id: site.id, repository: site.repository ?? null, productionUrl: site.productionUrl ?? null },
    cloudflare: {
      projectResolution: resolution,
      changed: true,
      project: safe
    }
  };
}

function resolveWorkerName(site: SiteTarget, explicit?: string) {
  if (explicit) return explicit;
  const repository = site.repository?.trim();
  if (!repository) throw new Error(`Site ${site.id} has no repository from which to infer a Worker name`);
  const [, repoName] = repository.split('/');
  if (!repoName || !/^[a-zA-Z0-9-]{1,63}$/.test(repoName)) {
    throw new Error(`Could not infer a valid Worker name from repository ${repository}`);
  }
  return repoName;
}

export async function cloudflareWorkerInheritSecrets(input: unknown, site: SiteTarget) {
  const args = z.object(cloudflareWorkerInheritSecretsShape).strict().parse(input);
  if (site.id !== 'learning-os' || args.siteId !== site.id) {
    throw new Error('Secret inheritance is restricted to learning-os');
  }

  const script = 'learning-os';
  const sourceVersionId = 'c434cfe4-60ac-4854-a0f1-f4a232b87aa0';
  const targetVersionId = 'efa558df-d797-4654-8d83-87ee7f4e60ec';
  const secretNames = ['APP_PASSWORD', 'SESSION_SECRET', 'TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL'];
  const versionPath = `/workers/workers/${script}/versions`;
  const [source, target, versions, deployments, settings, scriptList] = await Promise.all([
    cloudflare<any>(`${versionPath}/${sourceVersionId}`),
    cloudflare<any>(`${versionPath}/${targetVersionId}`),
    cloudflare<any>(`${versionPath}?per_page=25&page=1`),
    cloudflare<any>(`/workers/scripts/${script}/deployments?per_page=1&page=1`),
    cloudflare<any>(`/workers/scripts/${script}/settings`),
    cloudflare<any[]>(`/workers/scripts`)
  ]);
  const sourceBindings = Array.isArray(source.result?.bindings) ? source.result.bindings : [];
  const targetBindings = Array.isArray(target.result?.bindings) ? target.result.bindings : [];
  const settingsBindings = Array.isArray(settings.result?.bindings) ? settings.result.bindings : [];
  const sourceSecretNames = sourceBindings
    .filter((b: any) => b?.type === 'secret_text').map((b: any) => String(b.name));
  const targetSecretNames = targetBindings
    .filter((b: any) => b?.type === 'secret_text').map((b: any) => String(b.name));
  const versionsRaw = Array.isArray(versions.result) ? versions.result
    : Array.isArray(versions.result?.versions) ? versions.result.versions : [];
  const latestVersion = versionsRaw
    .map((v: any) => ({ id: String(v?.id ?? ''), number: Number(v?.number ?? 0) }))
    .sort((a: any, b: any) => b.number - a.number)[0] ?? null;
  const latestDeploy = Array.isArray(deployments.result?.deployments)
    ? deployments.result.deployments[0] : null;
  const activeVersions = (Array.isArray(latestDeploy?.versions) ? latestDeploy.versions : [])
    .filter((v: any) => Number(v?.percentage) === 100)
    .map((v: any) => String(v.version_id));
  const targetScript = (Array.isArray(scriptList.result) ? scriptList.result : [])
    .find((item: any) => String(item?.id ?? '') === script) ?? null;
  const expectedSource = sourceSecretNames.length === secretNames.length
    && secretNames.every(name => sourceSecretNames.includes(name));
  const expectedTarget = targetSecretNames.length === 0
    && targetBindings.some((b: any) => b?.name === 'ASSETS' && b?.type === 'assets');
  const expectedSettings = settingsBindings.length === 1
    && settingsBindings[0]?.name === 'ASSETS'
    && settingsBindings[0]?.type === 'assets';
  const targetModules = Array.isArray(target.result?.modules)
    ? target.result.modules : [];
  const mainModule = String(target.result?.main_module ?? '');
  const modulesReady = Boolean(mainModule)
    && targetModules.some((module: any) =>
      module?.name === mainModule
      && typeof module?.content_base64 === 'string'
      && module.content_base64.length > 0
    )
    && targetModules.every((module: any) =>
      typeof module?.name === 'string'
      && typeof module?.content_base64 === 'string'
      && typeof module?.content_type === 'string'
    );
  const safeToApply =
    modulesReady &&
    source.result?.id === sourceVersionId &&
    target.result?.id === targetVersionId &&
    expectedSource && expectedTarget && expectedSettings &&
    latestVersion?.id === targetVersionId &&
    activeVersions.length === 1 && activeVersions[0] === targetVersionId &&
    Array.isArray(targetScript?.handlers) && targetScript.handlers.includes('fetch');
  const preflight = {
    sourceVersionId,
    targetVersionId,
    sourceSecretNames,
    targetSecretNames,
    latestVersion,
    activeVersionId: activeVersions[0] ?? null,
    targetScriptHandlers: targetScript?.handlers ?? [],
    targetModuleCount: targetModules.length,
    mainModule,
    modulesReady,
    hasAssetsJwt: Boolean(target.result?.assets?.jwt),
    safeToApply
  };
  if (args.dryRun) return { preflight, applied: false };
  if (!safeToApply) throw new Error('Secret inheritance preflight failed: ' + JSON.stringify(preflight));

  const requestedBindings = [
    { type: 'assets', name: 'ASSETS' },
    ...secretNames.map(name => ({ type: 'inherit', name, version_id: sourceVersionId }))
  ];
  const copyVersion: Record<string, unknown> = {
    main_module: mainModule,
    modules: targetModules.map((module: any) => ({
      name: module.name,
      content_base64: module.content_base64,
      content_type: module.content_type
    })),
    bindings: requestedBindings,
    compatibility_date: target.result.compatibility_date,
    compatibility_flags: Array.isArray(target.result.compatibility_flags)
      ? target.result.compatibility_flags : [],
    annotations: { 'workers/message': 'Restore original secret bindings onto known-good Worker bundle' }
  };
  if (target.result?.assets?.jwt) {
    copyVersion.assets = target.result.assets;
  }

  const created = await cloudflare<any>(versionPath, {
    method: 'POST',
    body: JSON.stringify(copyVersion)
  });
  const createdId = String(created.result?.id ?? '');
  if (!/^[a-f0-9-]{36}$/.test(createdId)) {
    throw new Error('Version creation returned no valid version ID; refusing deploy');
  }

  const createdVersion = await cloudflare<any>(`${versionPath}/${createdId}`);
  const confirmedSecrets = (Array.isArray(createdVersion.result?.bindings)
    ? createdVersion.result.bindings : [])
    .filter((b: any) => b?.type === 'secret_text')
    .map((b: any) => String(b.name));
  const hasAssets = (Array.isArray(createdVersion.result?.bindings)
    ? createdVersion.result.bindings : [])
    .some((b: any) => b?.name === 'ASSETS' && b?.type === 'assets');
  const confirmed = secretNames.every(name => confirmedSecrets.includes(name))
    && confirmedSecrets.length === secretNames.length
    && hasAssets;
  if (!confirmed) {
    return {
      preflight,
      applied: true,
      deployed: false,
      createdVersionId: createdId,
      secretsConfirmed: false,
      secretNames: confirmedSecrets,
      reason: 'Created version did not confirm all bindings; refusing deploy'
    };
  }

  await cloudflare<any>(`/workers/scripts/${script}/deployments`, {
    method: 'POST',
    body: JSON.stringify({
      strategy: 'percentage',
      versions: [{ percentage: 100, version_id: createdId }],
      annotations: { 'workers/message': 'Deploy Learning OS with retained secret bindings' }
    })
  });
  const afterDeployments = await cloudflare<any>(
    `/workers/scripts/${script}/deployments?per_page=1&page=1`
  );
  const latestDeployment = Array.isArray(afterDeployments.result?.deployments)
    ? afterDeployments.result.deployments[0] : null;
  const confirmedDeployed = Array.isArray(latestDeployment?.versions)
    && latestDeployment.versions.some((v: any) =>
      v?.version_id === createdId && Number(v?.percentage) === 100
    );
  if (!confirmedDeployed) {
    throw new Error('Created version with secrets but deployment confirmation failed');
  }
  return {
    preflight,
    applied: true,
    deployed: true,
    createdVersionId: createdId,
    secretsConfirmed: confirmed,
    secretNames: confirmedSecrets
  };
}

export async function cloudflareWorkerSecretRecovery(input: unknown, site: SiteTarget) {
  const args = z.object(cloudflareWorkerSecretRecoveryShape).strict().parse(input);
  if (site.id !== 'learning-os' || args.siteId !== site.id) {
    throw new Error('Secret version recovery is restricted to learning-os');
  }

  // Older connected MCP clients may not refresh their tool list until the user
  // reconnects. Reuse this stable tool name for the v18 recovery workflow.
  const latestEnvelope = await cloudflare<any>(
    '/workers/workers/learning-os/versions?per_page=25&page=1'
  );
  const latestRaw = Array.isArray(latestEnvelope.result) ? latestEnvelope.result
    : Array.isArray(latestEnvelope.result?.versions) ? latestEnvelope.result.versions : [];
  const latest = latestRaw
    .map((v: any) => ({ id: String(v?.id ?? ''), number: Number(v?.number ?? 0) }))
    .sort((a: any, b: any) => b.number - a.number)[0] ?? null;
  if (latest?.id === 'efa558df-d797-4654-8d83-87ee7f4e60ec') {
    return cloudflareWorkerInheritSecrets(args, site);
  }

  const workerName = 'learning-os';
  const restoreId = 'c434cfe4-60ac-4854-a0f1-f4a232b87aa0';
  const brokenId = '2a80370c-d39d-4d52-9425-f9ee90c725f0';
  const base = `/workers/workers/${workerName}/versions`;
  const [restore, broken, list, deployments] = await Promise.all([
    cloudflare<any>(`${base}/${restoreId}`),
    cloudflare<any>(`${base}/${brokenId}`),
    cloudflare<any>(`${base}?per_page=25&page=1`),
    cloudflare<any>(`/workers/scripts/${workerName}/deployments?per_page=1&page=1`)
  ]);
  const expectedSecrets = ['APP_PASSWORD', 'SESSION_SECRET', 'TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL'];
  const existingNames = new Set(
    (Array.isArray(restore.result?.bindings) ? restore.result.bindings : [])
      .filter((b: any) => b?.type === 'secret_text')
      .map((b: any) => String(b.name))
  );
  const missingSecrets = expectedSecrets.filter(name => !existingNames.has(name));
  const brokenSecrets = (Array.isArray(broken.result?.bindings) ? broken.result.bindings : [])
    .filter((b: any) => b?.type === 'secret_text')
    .map((b: any) => String(b.name));
  const rawVersions = Array.isArray(list.result) ? list.result
    : Array.isArray(list.result?.versions) ? list.result.versions : [];
  const sortedVersions = rawVersions
    .map((version: any) => ({
      id: String(version?.id ?? ''),
      number: Number(version?.number ?? 0)
    }))
    .sort((a: any, b: any) => b.number - a.number);
  const latestVersion = sortedVersions[0] ?? null;
  const latestDeployment = Array.isArray(deployments.result?.deployments)
    ? deployments.result.deployments[0] : null;
  const activeIds = (latestDeployment?.versions ?? [])
    .filter((v: any) => Number(v.percentage) === 100)
    .map((v: any) => String(v.version_id));
  const safe =
    missingSecrets.length === 0 &&
    brokenSecrets.length === 0 &&
    restore.result?.id === restoreId &&
    broken.result?.id === brokenId &&
    latestVersion?.id === brokenId &&
    activeIds.length === 1 && activeIds[0] === brokenId;
  const preflight = {
    workerName, restoreVersion: restoreId, brokenVersion: brokenId,
    expectedSecretsPresentInRestore: missingSecrets.length === 0,
    missingSecretNames: missingSecrets,
    brokenVersionSecretNames: brokenSecrets,
    latestVersion, activeVersionId: activeIds[0] ?? null,
    safeToApply: safe
  };
  if (args.dryRun) return { preflight, applied: false };
  if (!safe) throw new Error('Recovery preflight failed: ' + JSON.stringify(preflight));

  const deployed = await cloudflare<any>(
    `/workers/scripts/${workerName}/deployments`,
    {
      method: 'POST',
      body: JSON.stringify({
        strategy: 'percentage',
        versions: [{ percentage: 100, version_id: restoreId }],
        annotations: {
          'workers/message': 'Restore retained secret bindings before migrating to cf build output'
        }
      })
    }
  );

  const check = await cloudflare<any>(
    `/workers/scripts/${workerName}/deployments?per_page=1&page=1`
  );
  const top = Array.isArray(check.result?.deployments) ? check.result.deployments[0] : null;
  const restored = Array.isArray(top?.versions)
    && top.versions.some((v: any) => v.version_id === restoreId && Number(v.percentage) === 100);
  if (!restored) throw new Error('Rollback was submitted but active deployment was not confirmed');

  const deleted = await cloudflare<any>(
    `${base}/${brokenId}`,
    { method: 'DELETE' }
  );
  const after = await cloudflare<any>(`${base}?per_page=25&page=1`);
  const afterVersions = Array.isArray(after.result) ? after.result
    : Array.isArray(after.result?.versions) ? after.result.versions : [];

  return {
    preflight,
    applied: true,
    rollbackDeploymentId: deployed.result?.id ?? null,
    deletedBrokenVersion: Boolean(deleted.success),
    retainedVersions: afterVersions
      .slice(0, 8).map((v: any) => ({ id: v.id ?? null, number: v.number ?? null }))
  };
}

export async function cloudflareWorkerSetSubdomain(input: unknown, site: SiteTarget) {
  const args = workerSubdomainSchema.parse(input);
  if (args.siteId !== site.id) throw new Error('Resolved site does not match requested siteId');
  const workerName = resolveWorkerName(site, args.workerName);

  const result = (await cloudflare<{ enabled: boolean; previews_enabled: boolean }>(
    `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`,
    {
      method: 'POST',
      body: JSON.stringify({
        enabled: args.enabled,
        previews_enabled: args.previewsEnabled
      })
    }
  )).result;

  return {
    site: {
      id: site.id,
      repository: site.repository ?? null,
      productionUrl: site.productionUrl ?? null
    },
    cloudflare: {
      workerName,
      workersDev: {
        enabled: Boolean(result?.enabled),
        previewsEnabled: Boolean(result?.previews_enabled)
      }
    }
  };
}

function safeWorkersBuild(build: any) {
  const trigger = build?.build_trigger_metadata ?? {};
  return {
    id: build?.build_uuid ?? null,
    outcome: build?.build_outcome ?? null,
    status: build?.status ?? null,
    createdAt: build?.created_at ?? build?.created_on ?? null,
    completedAt: build?.completed_at ?? build?.completed_on ?? null,
    trigger: {
      source: trigger?.build_trigger_source ?? null,
      branch: trigger?.branch ?? null,
      commitHash: trigger?.commit_hash ?? null,
      commitMessage: trigger?.commit_message ?? null,
      buildCommand: trigger?.build_command ?? null,
      deployCommand: trigger?.deploy_command ?? null,
      rootDirectory: trigger?.root_directory ?? null,
      providerType: trigger?.provider_type ?? null,
      providerAccountName: trigger?.provider_account_name ?? null,
      repoName: trigger?.repo_name ?? trigger?.repo_connection?.repo_name ?? null
    }
  };
}

async function cloudflareWorkersBuildLogs(
  args: z.infer<typeof deploymentLogsSchema>,
  site: SiteTarget
) {
  if (!args.deploymentId) {
    throw new Error('Workers Builds diagnostics currently require deploymentId/build UUID');
  }

  const buildId = args.deploymentId;
  const [buildEnvelope, logsEnvelope] = await Promise.all([
    cloudflare<any>(`/builds/builds/${encodeURIComponent(buildId)}`),
    cloudflare<{ cursor?: string; lines?: unknown[]; truncated?: boolean }>(
      `/builds/builds/${encodeURIComponent(buildId)}/logs`
    )
  ]);

  const rawLines = Array.isArray(logsEnvelope.result?.lines) ? logsEnvelope.result.lines : [];
  const lines = rawLines.slice(-args.maxLines).map((entry: any) => {
    if (Array.isArray(entry)) {
      const [ts, ...rest] = entry;
      return {
        ts: typeof ts === 'number' || typeof ts === 'string' ? ts : null,
        line: rest.map(value => String(value ?? '')).join(' ')
      };
    }
    return { ts: null, line: String(entry ?? '') };
  });

  return {
    site: {
      id: site.id,
      repository: site.repository ?? null,
      productionUrl: site.productionUrl ?? null,
      registryDeploymentProvider: site.deploymentProvider ?? null
    },
    cloudflare: {
      platform: 'workers_builds',
      build: safeWorkersBuild(buildEnvelope.result),
      logs: {
        returnedLines: lines.length,
        truncated: Boolean(logsEnvelope.result?.truncated),
        cursor: logsEnvelope.result?.cursor ?? null,
        lines
      }
    }
  };
}

export async function cloudflarePagesDeploymentLogs(input: unknown, site: SiteTarget) {
  const args = deploymentLogsSchema.parse(input);
  if (args.siteId !== site.id) throw new Error('Resolved site does not match requested siteId');

  if (site.deploymentProvider !== 'cloudflare_pages') {
    return cloudflareWorkersBuildLogs(args, site);
  }

  const { project, resolution } = await resolveProject(site);

  let selected: any | null = null;
  if (args.deploymentId) {
    const envelope = await cloudflare<any>(`/pages/projects/${encodeURIComponent(project.name)}/deployments/${encodeURIComponent(args.deploymentId)}`);
    selected = envelope.result;
  } else {
    const deployments = await listDeployments(project.name, args.environment, 20);
    selected = deployments.find(item => item?.latest_stage?.status === 'failure')
      ?? deployments.find(item => Array.isArray(item?.stages) && item.stages.some((stage: any) => stage?.status === 'failure'))
      ?? deployments[0]
      ?? null;
  }
  if (!selected?.id) throw new Error(`No ${args.environment} Cloudflare Pages deployment was found for project ${project.name}`);

  const envelope = await cloudflare<{ data?: Array<{ line?: string; ts?: string }>; includes_container_logs?: boolean; total?: number }>(
    `/pages/projects/${encodeURIComponent(project.name)}/deployments/${encodeURIComponent(selected.id)}/history/logs`
  );
  const allLines = Array.isArray(envelope.result?.data) ? envelope.result.data : [];
  const lines = allLines.slice(-args.maxLines).map(item => ({
    ts: item.ts ?? null,
    line: item.line ?? ''
  }));

  return {
    site: {
      id: site.id,
      repository: site.repository ?? null,
      productionUrl: site.productionUrl ?? null
    },
    cloudflare: {
      projectResolution: resolution,
      project: safeProject(project),
      deployment: safeDeployment(selected),
      logs: {
        returnedLines: lines.length,
        total: envelope.result?.total ?? allLines.length,
        includesContainerLogs: envelope.result?.includes_container_logs ?? false,
        truncatedToTail: allLines.length > lines.length,
        lines
      }
    }
  };
}
