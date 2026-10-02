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

const siteStatusSchema = z.object(cloudflarePagesSiteStatusShape).strict();
const deploymentLogsSchema = z.object(cloudflarePagesDeploymentLogsShape).strict();

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
    permissions: 'Pages Read is sufficient for status and build-log diagnostics'
  };
}

async function cloudflare<T>(path: string): Promise<CloudflareEnvelope<T>> {
  const config = cloudflareConfiguration();
  if (!config.configured || !config.accountId || !config.apiToken) {
    throw new Error('Cloudflare Pages diagnostics are not configured. Set CLOUDFLARE_ACCOUNT_ID and a CLOUDFLARE_API_TOKEN with Pages Read permission in the Sites Operator deployment environment.');
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}${path}`, {
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      accept: 'application/json'
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

async function listProjects() {
  const projects: any[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const envelope = await cloudflare<any[]>(`/pages/projects?per_page=100&page=${page}`);
    projects.push(...(Array.isArray(envelope.result) ? envelope.result : []));
    const totalPages = envelope.result_info?.total_pages ?? page;
    if (page >= totalPages) break;
  }
  return projects;
}

async function resolveProject(site: SiteTarget) {
  if (!site.repository) throw new Error(`Site ${site.id} has no repository in the Sites Operator registry`);
  const [repoOwner, repoName] = site.repository.split('/');
  const projects = await listProjects();
  const repoMatches = projects.filter(project => {
    const source = project?.source?.config;
    return String(source?.owner ?? '').toLowerCase() === repoOwner.toLowerCase()
      && String(source?.repo_name ?? '').toLowerCase() === repoName.toLowerCase();
  });
  if (repoMatches.length > 1) throw new Error(`Multiple Cloudflare Pages projects map exactly to repository ${site.repository}; resolve the registry/project mapping before using diagnostics`);
  if (repoMatches.length === 1) return { project: repoMatches[0], resolution: 'repository_exact' as const };

  const productionHost = normalizedHost(site.productionUrl);
  const domainMatches = productionHost ? projects.filter(project => {
    const hosts = [
      ...(Array.isArray(project?.domains) ? project.domains : []),
      project?.subdomain
    ].map(normalizedHost).filter(Boolean);
    return hosts.includes(productionHost);
  }) : [];
  if (domainMatches.length > 1) throw new Error(`Multiple Cloudflare Pages projects map to production host ${productionHost}; resolve the registry/project mapping before using diagnostics`);
  if (domainMatches.length === 1) return { project: domainMatches[0], resolution: 'production_domain_exact' as const };

  throw new Error(`No Cloudflare Pages project matched site ${site.id} by exact repository (${site.repository}) or production domain (${productionHost ?? 'none'})`);
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
      previewDeploymentSetting: project.source.config?.preview_deployment_setting ?? null
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
