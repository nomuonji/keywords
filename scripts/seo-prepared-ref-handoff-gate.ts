import type { SeoTaskRecord, SiteRecord } from '../packages/db/src/site-operations-schema.js';

/**
 * Release gate for the shared SEO Worker prepared-commit Actions transport.
 * No runtime authorization is inferred from the self-reported actor/marker alone.
 * The controller must opt in with a post-review cutoff; historic rejected work
 * must not become eligible just because someone rewrites a checkpoint.
 */
// New assignments use one shared commit-object -> Actions ref handoff. Legacy
// already-running deliveries are allowed to drain; this is not retrospective
// authorization for old or previously rejected task content.
export const PREPARED_REF_CUTOVER_UTC = '2026-10-13T05:50:00.000Z';

export function preparedHandoffRequired(task: Pick<SeoTaskRecord, 'createdAt'>): boolean {
  const created = Date.parse(task.createdAt);
  return !Number.isFinite(created) || created >= Date.parse(PREPARED_REF_CUTOVER_UTC);
}

/**
 * Verify the base for either a first prepared branch or a CI-corrective fast-forward.
 * A corrective commit may start from the existing task branch ONLY after a
 * recorded CI delivery failure; arbitrary stale-base branches fail closed.
 */
export function preparedRefBaseError(
  task: Pick<SeoTaskRecord, 'history'>,
  existingSha: string | null,
  defaultHead: string,
  baseSha: string
): string | null {
  if (existingSha === null && defaultHead !== baseSha) return 'default branch has advanced; Worker rebase required';
  if (existingSha === baseSha && defaultHead !== baseSha
      && !task.history?.some(event => event.event === 'delivery_failed' || event.event === 'implementation_blocked')) {
    return 'non-default base is allowed only for a recorded failed implementation or delivery';
  }
  return null;
}

/**
 * Existing broken task branches can only be corrected by a single-parent,
 * non-force fast-forward from their exact current HEAD. After reconciliation,
 * compare the FINAL tree against live main and require a new corrective Worker
 * handoff after the recorded failure. Old multi-commit branch histories alone
 * are never accepted as new clean handoffs.
 */
export function verifiedCorrectiveMainNetDiff(
  task: Pick<SeoTaskRecord, 'id' | 'history' | 'deliveryHandoff'>,
  currentMainSha: string,
  comparison: {
    status: string; ahead_by: number; behind_by: number;
    merge_base_commit?: { sha: string } | null;
    files?: readonly { filename: string }[];
  }
): boolean {
  const events = task.history ?? [];
  const lastFailure = events.reduce((index, event, i) =>
    event.event === 'delivery_failed' || event.event === 'implementation_blocked' ? i : index, -1
  );
  const lastCorrection = events.reduce((index, event, i) =>
    event.event === 'delivery_push_pending'
    && (event.actor === 'seo_worker' || event.actor === 'chatgpt_seo_worker') ? i : index, -1
  );
  const lastRunnerRetry = events.reduce((index, event, i) =>
    event.event === 'central_ci_og_permission_retry'
    || event.event === 'central_ci_checkout_permission_retry' ? i : index, -1
  );
  const files = comparison.files ?? [];
  return task.deliveryHandoff?.validationSummary.startsWith('Action-Ref-Handoff: v1\n') === true
    && !preparedHandoffHasRecordedRefusal(task)
    && lastFailure >= 0
    && (lastCorrection > lastFailure
      || (lastCorrection >= 0 && lastRunnerRetry > lastFailure))
    && /^[a-f0-9]{40}$/.test(currentMainSha)
    && comparison.status === 'ahead'
    && comparison.ahead_by >= 1 && comparison.ahead_by <= 10
    && comparison.behind_by === 0
    && comparison.merge_base_commit?.sha === currentMainSha
    && files.length > 0 && files.length <= 50
    && preparedRefHandoffScopeError(files.map(file => file.filename)) === null;
}

/**
 * Historical refusals belong to structured Sites Operator Task history.
 * The two 2026-10-15 Book Discovery incidents were migrated on 2026-10-16
 * to safety_write_rejected_task_cancelled and the Tasks were cancelled.
 * Never use hard-coded task IDs as a hidden authorization or retry policy.
 * A refused write still may not be replayed via a different transport.
 *
 * If the refusal itself prevented history persistence, stop and report the
 * incident for separately authorized migration. Do not infer clearance from
 * a missing event until the incident is reconciled.
 */
/**
 * Only stable event identifiers can attest to a refusal. Free-form history
 * details include negated phrases such as "No safety refusal" and must never
 * be parsed as an authorization decision.
 */
export function preparedHandoffHasRecordedRefusal(
  task: Pick<SeoTaskRecord, 'id' | 'history'>
): boolean {
  return (task.history ?? []).some(({ event }) =>
    /^(?:safety|authorization|permission|authz|tool_safety|worker_safety)(?:_[a-z0-9]+)*_(?:rejected|rejection|refused|refusal|denied|blocked)(?:_[a-z0-9]+)*$/i.test(event)
  );
}

export function preparedRefHandoffPreflight(
  task: SeoTaskRecord,
  activeSites: readonly Pick<SiteRecord, 'id' | 'repository' | 'status'>[],
  enabled: string | undefined,
  notBefore: string | undefined
): string | null {
  if (enabled !== '1') return 'Prepared-commit Actions ref handoff has not been enabled for production';
  const cutoff = Date.parse(notBefore ?? '');
  if (!notBefore || !Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== notBefore) {
    return 'Prepared-commit Actions handoff requires an explicit ISO UTC rollout cutoff';
  }
  const created = Date.parse(task.createdAt);
  if (!Number.isFinite(created) || created < Math.max(cutoff, Date.parse(PREPARED_REF_CUTOVER_UTC))) {
    return 'Task predates the explicitly authorized rollout; historical work is not eligible';
  }
  const site = activeSites.find(row => row.id === task.siteId && row.status === 'active');
  if (!site || site.repository !== task.repo) {
    return 'Task repository does not match its active Sites Operator site registry entry';
  }
  const handoff = task.deliveryHandoff;
  if (task.status !== 'in_progress' || !handoff
      || !['push_pending', 'branch_ready', 'pr_open'].includes(handoff.state)
      || (handoff.state === 'push_pending'
          && !['seo_worker', 'chatgpt_seo_worker'].includes(task.executionClaim?.actor ?? ''))
      || !handoff.validationSummary.startsWith('Action-Ref-Handoff: v1\n')) {
    return 'Checkpoint is not an explicitly opted-in SEO Worker prepared-commit handoff';
  }
  if (handoff.branch !== `seo/${task.id}` || !/^seo\/[a-zA-Z0-9_-]{1,100}$/.test(handoff.branch)) {
    return 'Branch is not the exact task-bound seo/<task-id> ref';
  }
  if (!handoff.baseSha || !handoff.headSha
      || !/^[a-f0-9]{40}$/.test(handoff.baseSha)
      || !/^[a-f0-9]{40}$/.test(handoff.headSha)
      || handoff.baseSha === handoff.headSha) {
    return 'Invalid base/head SHA in prepared-commit checkpoint';
  }
  if (preparedHandoffHasRecordedRefusal(task)) {
    return 'Task has an explicit safety/authorization refusal event; independent review required, no delegated retry';
  }
  if (handoff.lastError) return 'Checkpoint has an unresolved error; no delegated retry is authorized';
  return null;
}

/**
 * Capability-based fallback for a Worker without Git-object creation APIs.
 * Both supported executor claim identities may provide an already-pushed
 * task-bound branch. The marker identifies the transport, not the model.
 * The controller independently verifies commit provenance, safe paths, ref
 * and Task before promotion; this cannot retry a safety-refused operation.
 */
export const BRANCH_HANDOFF_MARKER = 'Action-Branch-Handoff: v1\n';
/**
 * Decide the transport BEFORE claiming a Task. Missing tool exposure is a
 * capability gap; a denied write is never a reason to try another route.
 * Actor/model identities are intentionally absent from this decision.
 */
export function selectSeoGitTransport(capabilities: {
  preparedWriters: boolean;
  branchWriters: boolean;
  commitTreeSourceReadback: boolean;
  branchRefAndDiffReadback: boolean;
  hasSafetyOrAuthorizationRefusal: boolean;
}): 'prepared' | 'verified_branch' | null {
  if (capabilities.hasSafetyOrAuthorizationRefusal
      || !capabilities.commitTreeSourceReadback) return null;
  if (capabilities.preparedWriters) return 'prepared';
  return capabilities.branchWriters && capabilities.branchRefAndDiffReadback
    ? 'verified_branch'
    : null;
}



export function verifiedBranchHandoffPreflight(
  task: SeoTaskRecord,
  activeSites: readonly Pick<SiteRecord, 'id' | 'repository' | 'status'>[],
  enabled: string | undefined,
  notBefore: string | undefined
): string | null {
  const handoff = task.deliveryHandoff;
  if (!handoff?.validationSummary.startsWith(BRANCH_HANDOFF_MARKER)) {
    return 'Verified branch fallback requires its exact transport marker';
  }
  // Preserve existing claim identities for backward compatibility; never
  // grant fallback access based on a Worker/model name or a self-claimed label.
  const recognizedActors = ['seo_worker', 'chatgpt_seo_worker'];
  const activeActor = task.executionClaim?.actor ?? '';
  if (handoff.state === 'push_pending' && !recognizedActors.includes(activeActor)) {
    return 'Verified branch fallback requires an active authorized SEO Worker claim';
  }
  if (!(task.history ?? []).some(event =>
    event.event === 'delivery_branch_push_pending'
    && recognizedActors.includes(event.actor)
    && (handoff.state !== 'push_pending' || event.actor === activeActor))) {
    return 'Verified branch fallback requires a structured receipt matching the Worker claim actor';
  }
  const preparedEquivalent = {
    ...task,
    deliveryHandoff: {
      ...handoff,
      validationSummary: 'Action-Ref-Handoff: v1\n' + handoff.validationSummary.slice(BRANCH_HANDOFF_MARKER.length)
    }
  } as SeoTaskRecord;
  return preparedRefHandoffPreflight(preparedEquivalent, activeSites, enabled, notBefore);
}

/** Conservative content-only scope for unattended initial rollout. */
export function preparedRefHandoffScopeError(files: readonly string[]): string | null {
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
 * a prepared-commit delivery merge. Require a successful PR-triggered Actions run that
 * actually references the specific PR under delivery.
 */
export function preparedHandoffHasPassedPrCi(
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

/**
 * Allow central branch-fallback delivery past a strictly unrelated bot-state
 * update, without rewriting the Worker commit or weakening refusal gates.
 * Source/config/unknown default-branch changes still require fresh validation.
 */
export function verifiedBranchMainDriftIsNonInterfering(
  baseSha: string,
  comparison: {
    status: string;
    ahead_by: number;
    behind_by: number;
    merge_base_commit?: { sha: string } | null;
    files?: readonly { filename: string }[];
  },
  workerChangedPaths: readonly string[]
): boolean {
  const files = comparison.files ?? [];
  return comparison.status === 'ahead'
    && comparison.behind_by === 0
    && comparison.ahead_by >= 1
    && comparison.ahead_by <= 10
    && comparison.merge_base_commit?.sha === baseSha
    && files.length > 0
    && files.length <= 10
    && workerChangedPaths.length > 0
    && files.every(({ filename }) =>
      /^sns-bot\/[A-Za-z0-9_-]+_state\.json$/.test(filename)
      && !workerChangedPaths.includes(filename)
    );
}
