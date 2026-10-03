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

const siteStatusSchema = z.object(cloudflarePagesSiteStatusShape).strict();
const deploymentLogsSchema = z.object(cloudflarePagesDeploymentLogsShape).strict();
const previewBranchesSchema = z.object(cloudflarePagesPreviewBranchesShape).strict();

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
    permissions: 'Pages Read is sufficient for diagnostics; Pages Edit is required to change preview branch controls'
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
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null) as CloudflareEnvelope<T> | null;
  if (!response.ok || !body?.success) {
    const detail = body?.errors?.map(item => item.message || String(item.code ?? '')).filter(Boolean).join('; ');
    throw new Error(`Cloudflare API request failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
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
  const { project, resolution } = await resolveProject(site);
  const deployments = await listDeployments(project.name, args.environment, args.limit);
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

export async function cloudflarePagesDeploymentLogs(input: unknown, site: SiteTarget) {
  const args = deploymentLogsSchema.parse(input);
  if (args.siteId !== site.id) throw new Error('Resolved site does not match requested siteId');
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
