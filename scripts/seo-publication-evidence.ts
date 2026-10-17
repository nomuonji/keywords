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

// Rotate across the same durable pending/failed queue rather than repeatedly
// retrying the oldest failed proofs. No extra Firestore cursor/write is needed.
export function duePublicationBatch<T extends { id: string; completedAt?: string | null; deploymentVerification: { checkedAt?: string | null } }>(
  tasks: T[], now: number, limit: number, intervalMs = 2 * 60 * 60 * 1000
): T[] {
  const due = tasks.filter(task => {
    const checkedAt = task.deploymentVerification.checkedAt;
    return !checkedAt || !Number.isFinite(Date.parse(checkedAt))
      || now - Date.parse(checkedAt) >= 86_400_000;
  }).sort((a, b) => String(a.completedAt ?? '').localeCompare(String(b.completedAt ?? '')) || a.id.localeCompare(b.id));
  const count = Math.min(due.length, Math.max(0, Math.floor(limit)));
  if (!count) return [];
  const offset = (Math.floor(now / intervalMs) * count) % due.length;
  return Array.from({ length: count }, (_, i) => due[(offset + i) % due.length]);
}
