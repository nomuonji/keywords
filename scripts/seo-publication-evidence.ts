export type PagesProject = {
  name: string;
  domains?: string[];
  source?: { config?: { owner?: string; repo_name?: string } };
};

export type PagesDeployment = {
  environment?: string;
  skipped?: boolean;
  created_on?: string;
  latest_stage?: { name?: string; status?: string };
  deployment_trigger?: { metadata?: { commit_hash?: string } };
};

export function matchingPagesProject(projects: PagesProject[], repository: string, hostname: string): PagesProject | null {
  const [owner, name] = repository.toLowerCase().split('/');
  const byRepo = projects.filter(project =>
    project.source?.config?.owner?.toLowerCase() === owner
    && project.source?.config?.repo_name?.toLowerCase() === name);
  if (byRepo.length === 1) return byRepo[0];
  if (byRepo.length > 1) return null;
  const byDomain = projects.filter(project =>
    project.domains?.some(domain => domain.toLowerCase() === hostname.toLowerCase()));
  return byDomain.length === 1 ? byDomain[0] : null;
}

export function completedProductionPagesDeployment(deploy: PagesDeployment): string | null {
  if (deploy.environment !== 'production' || deploy.skipped
      || deploy.latest_stage?.name !== 'deploy'
      || deploy.latest_stage.status !== 'success') return null;
  const sha = deploy.deployment_trigger?.metadata?.commit_hash ?? '';
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
}
