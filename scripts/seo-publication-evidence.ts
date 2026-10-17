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

/** Restrict immediate checks to exact Task IDs emitted by the merge controller. */
export function publicationTargetIds(input: string | undefined, limit = 10): string[] {
  if (!input?.trim()) return [];
  const values = input.split(',').map(value => value.trim());
  if (values.length > limit || values.some(value => !/^[a-zA-Z0-9_-]{1,100}$/.test(value))) {
    throw Error('Invalid immediate publication Task IDs');
  }
  return [...new Set(values)];
}

/** A bounded wait; even an accidentally huge configuration cannot hold Actions indefinitely. */
export function publicationWaitBudget(value: string | undefined): number {
  const duration = Number(value ?? '240000');
  if (!Number.isFinite(duration) || duration < 0) throw Error('Invalid publication wait budget');
  return Math.min(240_000, Math.trunc(duration));
}
