import type { SeoTaskRecord, SiteRecord } from '../packages/db/src/site-operations-schema.js';

/**
 * Explicit release gate for the NEW ChatGPT Actions lane.
 * No runtime authorization is inferred from the self-reported actor/marker alone.
 * The controller must opt in with a post-review cutoff; historic rejected work
 * must not become eligible just because someone rewrites a checkpoint.
 */
export function chatgptRefHandoffPreflight(
  task: SeoTaskRecord,
  activeSites: readonly Pick<SiteRecord, 'id' | 'repository' | 'status'>[],
  enabled: string | undefined,
  notBefore: string | undefined
): string | null {
  if (enabled !== '1') return 'ChatGPT Actions ref handoff has not been enabled for production';
  const cutoff = Date.parse(notBefore ?? '');
  if (!notBefore || !Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== notBefore) {
    return 'ChatGPT Actions ref handoff requires an explicit ISO UTC rollout cutoff';
  }
  const created = Date.parse(task.createdAt);
  if (!Number.isFinite(created) || created < cutoff) {
    return 'Task predates the explicitly authorized rollout; historical work is not eligible';
  }
  const site = activeSites.find(row => row.id === task.siteId && row.status === 'active');
  if (!site || site.repository !== task.repo) {
    return 'Task repository does not match its active Sites Operator site registry entry';
  }
  const handoff = task.deliveryHandoff;
  if (task.status !== 'in_progress' || handoff?.state !== 'push_pending'
      || task.executionClaim?.actor !== 'chatgpt_seo_worker'
      || !handoff.validationSummary.startsWith('Action-Ref-Handoff: v1\n')) {
    return 'Checkpoint is not an explicitly opted-in ChatGPT Worker handoff';
  }
  if (handoff.branch !== `seo/${task.id}` || !/^seo\/[a-zA-Z0-9_-]{1,100}$/.test(handoff.branch)) {
    return 'Branch is not the exact task-bound seo/<task-id> ref';
  }
  if (!handoff.baseSha || !handoff.headSha
      || !/^[a-f0-9]{40}$/.test(handoff.baseSha)
      || !/^[a-f0-9]{40}$/.test(handoff.headSha)
      || handoff.baseSha === handoff.headSha) {
    return 'Invalid base/head SHA in ChatGPT checkpoint';
  }
  if (handoff.lastError) return 'Checkpoint has an unresolved error; no delegated retry is authorized';
  if ((task.history ?? []).some(event =>
    /safety.{0,30}(reject|deni|refus|block)|authoriz.{0,30}(reject|deni|refus|block)|permission.{0,30}(reject|deni|refus|block)/i
      .test(event.event + ' ' + event.detail))) {
    return 'Task contains a recorded refusal; delegated retry is prohibited';
  }
  return null;
}

/** Conservative content-only scope for unattended initial rollout. */
export function chatgptRefHandoffScopeError(files: readonly string[]): string | null {
  if (!files.length || files.length > 50) return 'Prepared commit has no files or exceeds 50 changed files';
  const seen = new Set<string>();
  for (const path of files) {
    if (!path || seen.has(path) || path.length > 240 || path.startsWith('/')
        || path.includes('\\') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      return `Unsafe or duplicate changed path: ${path}`;
    }
    seen.add(path);
    if (path.startsWith('.github/') || /(^|\/)\./.test(path)
        || /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|wrangler\..*|Dockerfile|\.env.*)$/i.test(path)
        || /(^|\/)(secrets?|credentials?|tokens?)(\/|\.)/i.test(path)
        || path === 'docs/sites-operator-worker-manual.md') {
      return `Changed path requires an independent authorized review: ${path}`;
    }
  }
  return null;
}

/**
 * A neutral/skipped preview or an unrelated push workflow must not authorize
 * a ChatGPT delivery merge. Require a successful PR-triggered Actions run that
 * actually references the specific PR under delivery.
 */
export function chatgptHandoffHasPassedPrCi(
  runs: readonly {
    event?: string;
    status?: string;
    conclusion?: string | null;
    pull_requests?: readonly { number?: number }[];
  }[],
  prNumber: number
): boolean {
  return runs.some(run =>
    run.event === 'pull_request'
    && run.status === 'completed'
    && run.conclusion === 'success'
    && run.pull_requests?.some(pr => pr.number === prNumber) === true
  );
}
