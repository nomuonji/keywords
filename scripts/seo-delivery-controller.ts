import {
  seoTaskGet,
  seoTaskList,
  seoTaskUpdate,
  siteRegistryList,
  siteRegistryGet
} from '../packages/commands/src/remote-site-operations.js';
import type { SeoTaskDeliveryHandoff, SeoTaskRecord } from '../packages/db/src/site-operations-schema.js';
import { seoDeliveryMergePayload } from '../packages/commands/src/seo-delivery-merge.js';
import { verifySeoSiteBuild } from './seo-site-ci.js';
import { transientDeliveryError, retryMergeability, cleanupSweepLimit, firestoreRateLimited } from './seo-delivery-throughput.js';
import { preparedHandoffRequired, preparedRefBaseError, preparedRefHandoffPreflight, preparedRefHandoffScopeError, BRANCH_HANDOFF_MARKER, verifiedBranchHandoffPreflight, verifiedBranchMainDriftIsNonInterfering, verifiedCorrectiveMainNetDiff, preparedHandoffHasRecordedRefusal } from './seo-prepared-ref-handoff-gate.js';

const token = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim() ?? '';
const ACTIONS_MARKER = 'Action-Ref-Handoff: v1\n';
const isBranchFallback = (task: SeoTaskRecord) => task.deliveryHandoff?.validationSummary.startsWith(BRANCH_HANDOFF_MARKER) === true;
const isPrepared = (task: SeoTaskRecord) => task.deliveryHandoff?.validationSummary.startsWith(ACTIONS_MARKER) === true;
const dryRun = process.env.SEO_DELIVERY_DRY_RUN === '1';
const maxTasks = Math.max(1, Math.min(Number(process.env.SEO_DELIVERY_MAX_TASKS ?? 20), 100));
const cleanupLimit = cleanupSweepLimit(process.env.SEO_DELIVERY_CLEANUP_SWEEP_LIMIT);

type GitHubRepo = {
  default_branch: string;
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
};

type GitHubPull = {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head: { sha: string; ref: string };
  base: { ref: string };
};

const ghHeaders = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
  'user-agent': 'keywords-seo-delivery-controller'
};

async function gh<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...ghHeaders, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body === 'object' && body?.message ? body.message : text || response.statusText;
    throw new Error(`GitHub ${response.status} ${response.statusText}: ${message}`);
  }
  return body as T;
}

const api = (repo: string, suffix = '') => `https://api.github.com/repos/${repo}${suffix}`;

async function repoInfo(repo: string) {
  return gh<GitHubRepo>(api(repo));
}

async function branchSha(repo: string, branch: string) {
  const ref = await gh<{ object: { sha: string } }>(api(repo, `/git/ref/heads/${encodeURIComponent(branch)}`));
  return ref.object.sha;
}

function ownerOf(repo: string) {
  return repo.split('/')[0];
}

async function findPull(repo: string, branch: string, base: string) {
  const params = new URLSearchParams({
    state: 'all',
    head: `${ownerOf(repo)}:${branch}`,
    base,
    per_page: '20'
  });
  const pulls = await gh<GitHubPull[]>(api(repo, `/pulls?${params}`));
  return pulls.sort((a, b) => b.number - a.number)[0] ?? null;
}

async function createPull(task: SeoTaskRecord, base: string, handoff: SeoTaskDeliveryHandoff) {
  return gh<GitHubPull>(api(task.repo, '/pulls'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `[SEO] ${task.title}`,
      head: handoff.branch,
      base,
      draft: false,
      body: [
        `Sites Operator task: \`${task.id}\``,
        `Site: \`${task.siteId}\``,
        '',
        'Automated delivery from the centralized Keywords/Sites Operator lane.',
        '',
        `Worker branch HEAD: \`${handoff.headSha}\``,
        `Worker base SHA: \`${handoff.baseSha}\``,
        `Validation: ${handoff.validationSummary || 'No additional summary recorded.'}`,
        '',
        'The Worker did not create or merge this PR; this controller owns PR/CI/merge delivery.'
      ].join('\n')
    })
  });
}

async function pullByNumber(repo: string, number: number) {
  return gh<GitHubPull>(api(repo, `/pulls/${number}`));
}

function mergeMethod(info: GitHubRepo): 'squash' | 'merge' | 'rebase' {
  if (info.allow_squash_merge !== false) return 'squash';
  if (info.allow_merge_commit !== false) return 'merge';
  return 'rebase';
}

async function mergePull(task: SeoTaskRecord, number: number, headSha: string, method: 'squash' | 'merge' | 'rebase') {
  return gh<{ sha?: string; merged: boolean; message?: string }>(api(task.repo, `/pulls/${number}/merge`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    // The Worker's source commit intentionally contains [CF-Pages-Skip] to
    // suppress preview builds. Never inherit that marker into main.
    body: JSON.stringify(seoDeliveryMergePayload(task, headSha, method))
  });
}

function nextHandoff(current: SeoTaskDeliveryHandoff, patch: Partial<SeoTaskDeliveryHandoff>): SeoTaskDeliveryHandoff {
  return { ...current, ...patch, updatedAt: new Date().toISOString() };
}

async function updateDelivery(taskId: string, handoff: SeoTaskDeliveryHandoff, event: string, detail: string, executionSummary?: string) {
  const current = await seoTaskGet({ id: taskId });
  return seoTaskUpdate({
    id: taskId,
    expectedRevision: current.revision,
    claimRunId: current.executionClaim?.runId,
    deliveryHandoff: handoff,
    executionSummary: executionSummary ?? current.executionSummary,
    appendHistory: { actor: 'seo_delivery_controller', event, detail }
  });
}

async function markFailed(task: SeoTaskRecord, message: string) {
  const current = await seoTaskGet({ id: task.id });
  const handoff = nextHandoff(current.deliveryHandoff, { state: 'ci_failed', lastError: message });
  if (dryRun) {
    console.log(`[dry-run] would mark ${task.id} ci_failed: ${message}`);
    return;
  }
  await seoTaskUpdate({
    id: task.id,
    expectedRevision: current.revision,
    claimRunId: current.executionClaim?.runId,
    deliveryHandoff: handoff,
    appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_failed', detail: message.slice(0, 2000) }
  });
}

async function recordControllerError(task: SeoTaskRecord, message: string) {
  // An exhausted Firestore quota cannot persist its own incident. Avoid an
  // additional read+write storm; the Actions log is the truthful blocker.
  if (firestoreRateLimited(message)) {
    console.log(`Firestore quota exhausted for ${task.id}; no redundant history update.`);
    return;
  }
  const current = await seoTaskGet({ id: task.id });
  if (!current.deliveryHandoff || current.deliveryHandoff.state === 'none' || current.deliveryHandoff.state === 'merged') return;
  const detail = message.slice(0, 2000);

  // A transient GitHub/network outage must NOT poison lastError: the
  // handoff preflight treats lastError as a terminal checkpoint failure.
  // Log one incident per hour rather than writing the same error every run.
  if (transientDeliveryError(message)) {
    const seenRecently = (current.history ?? []).some(entry =>
      entry.event === 'delivery_controller_transient'
      && entry.detail === detail
      && Number.isFinite(Date.parse(entry.at))
      && Date.now() - Date.parse(entry.at) >= 0
      && Date.now() - Date.parse(entry.at) < 60 * 60_000
    );
    if (seenRecently) {
      console.log(`Transient delivery outage already recorded for ${task.id}; handoff remains retryable.`);
      return;
    }
    if (dryRun) {
      console.log(`[dry-run] transient controller error for ${task.id}: ${detail}`);
      return;
    }
    await seoTaskUpdate({
      id: task.id,
      expectedRevision: current.revision,
      claimRunId: current.executionClaim?.runId,
      appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_controller_transient', detail }
    });
    return;
  }

  // Unknown and permission/safety/authorization failures remain fail-closed.
  // Do not automatically retry a denied operation under another transport.
  const handoff = nextHandoff(current.deliveryHandoff, { lastError: detail });
  if (dryRun) {
    console.log(`[dry-run] terminal controller error for ${task.id}: ${detail}`);
    return;
  }
  await seoTaskUpdate({
    id: task.id,
    expectedRevision: current.revision,
    claimRunId: current.executionClaim?.runId,
    deliveryHandoff: handoff,
    appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_controller_error', detail }
  });
}

/**
 * A controller-side isolated Docker copy may be read-only even though source
 * validation succeeded. After the runner permission fix, retry a single
 * existing PR at its EXACT head without asking a Worker to rewrite content.
 * All other CI failures remain ci_failed for corrective Worker inspection.
 */
function retryableOgAssetPermissionFailure(task: SeoTaskRecord): boolean {
  const h = task.deliveryHandoff;
  const history = task.history ?? [];
  const ogError = h?.lastError?.startsWith('Central site CI: docker failed')
    && h.lastError.includes("EACCES: permission denied, open '/work/public/og/")
    && !history.some(entry => entry.event === 'central_ci_og_permission_retry');
  const chmodError = h?.lastError?.startsWith('Central site CI: docker failed')
    && h.lastError.includes("chmod: changing permissions of '/work/")
    && h.lastError.includes('Operation not permitted')
    && !history.some(entry => entry.event === 'central_ci_checkout_permission_retry');
  return task.status === 'in_progress'
    && task.executionClaim === null
    && h?.state === 'ci_failed'
    && Boolean(h.prNumber && h.prUrl && h.headSha && h.branch)
    && Boolean(ogError || chmodError)
    && !preparedHandoffHasRecordedRefusal(task);
}

async function resumeOgPermissionFailure(task: SeoTaskRecord): Promise<SeoTaskRecord | null> {
  const current = await seoTaskGet({ id: task.id });
  if (!retryableOgAssetPermissionFailure(current)) return null;
  const site = await siteRegistryGet({ id: current.siteId });
  if (site.status !== 'active' || site.repository !== current.repo) return null;
  const info = await repoInfo(current.repo);
  const h = current.deliveryHandoff;
  const pr = await pullByNumber(current.repo, h.prNumber!);
  if (pr.state !== 'open' || pr.merged || pr.head.sha !== h.headSha
      || pr.head.ref !== h.branch || pr.base.ref !== info.default_branch
      || pr.html_url !== h.prUrl) return null;
  if (await branchSha(current.repo, h.branch!) !== h.headSha) return null;
  if (dryRun) {
    console.log(`[dry-run] would resume exact-HEAD isolated OG permission retry for ${current.id}`);
    return null;
  }
  return seoTaskUpdate({
    id: current.id,
    expectedRevision: current.revision,
    deliveryHandoff: nextHandoff(h, { state: 'pr_open', lastError: '' }),
    appendHistory: {
      actor: 'seo_delivery_controller',
      event: h.lastError.includes('chmod: changing permissions of')
        ? 'central_ci_checkout_permission_retry' : 'central_ci_og_permission_retry',
      detail: `Retrying PR #${pr.number} at exact ${h.headSha} once after central disposable checkout permissions were fixed; no Worker ref/source write.`
    }
  });
}

async function deleteMergedBranch(repo: string, branch: string) {
  if (!branch.startsWith('seo/')) return;
  try {
    await gh(api(repo, `/git/refs/heads/${encodeURIComponent(branch)}`), { method: 'DELETE' });
    console.log(`Deleted merged SEO branch: ${repo}#${branch}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/GitHub 404 Not Found/.test(message) || /GitHub 422 Unprocessable Entity: Reference does not exist/.test(message)) return;
    console.log(`Could not delete merged SEO branch ${repo}#${branch}: ${message}`);
  }
}

async function markCompleted(task: SeoTaskRecord, mergeSha: string, pr: GitHubPull) {
  const current = await seoTaskGet({ id: task.id });
  const handoff = nextHandoff(current.deliveryHandoff, {
    state: 'merged',
    prNumber: pr.number,
    prUrl: pr.html_url,
    lastError: ''
  });
  if (dryRun) {
    console.log(`[dry-run] would complete ${task.id} at ${mergeSha}`);
    return;
  }
  const deliveryNote = `Central delivery merged PR #${pr.number} to main/default branch at ${mergeSha}. Production verification remains ${current.deploymentVerification.status}.`;
  // Failure details are already in Task history; do not make executionSummary
  // grow indefinitely on delivery retries or block a verified merge.
  const sourceSummary = current.executionSummary.split('\nDelivery controller failure:')[0];
  await seoTaskUpdate({
    id: task.id,
    expectedRevision: current.revision,
    claimRunId: current.executionClaim?.runId,
    status: 'completed',
    resultCommitSha: mergeSha,
    deliveryHandoff: handoff,
    executionSummary: [sourceSummary.slice(0, 3999 - deliveryNote.length), deliveryNote].filter(Boolean).join('\n'),
    appendHistory: {
      actor: 'seo_delivery_controller',
      event: 'delivery_merged',
      detail: `PR #${pr.number} merged; default-branch resultCommitSha=${mergeSha}. Task completed automatically by central delivery controller.`
    }
  });
  await deleteMergedBranch(task.repo, current.deliveryHandoff.branch ?? '');
}


function isPreparedRefHandoff(task: SeoTaskRecord): boolean {
  return task.status === 'in_progress'
    && task.deliveryHandoff?.state === 'push_pending'
    && task.deliveryHandoff.validationSummary?.startsWith(ACTIONS_MARKER) === true;
}

// Prepared commits are an opt-in transport usable by either Worker runtime. Never
// be used to replay content for which another tool/safety gate rejected a write.
async function pushPreparedRef(task: SeoTaskRecord, existingSha: string | null): Promise<string | null> {
  if (!isPreparedRefHandoff(task)) return existingSha;
  const h = task.deliveryHandoff;
  if (!h.branch || !h.headSha || !h.baseSha) return existingSha;
  if (!/^seo\/[A-Za-z0-9._/-]+$/.test(h.branch) || !/^[a-f0-9]{40}$/.test(h.baseSha)
      || !/^[a-f0-9]{40}$/.test(h.headSha)) throw Error(`Malformed prepared-commit checkpoint ${task.id}`);
  if (existingSha !== null && existingSha !== h.baseSha && existingSha !== h.headSha) {
    console.log(`Waiting: ${task.id} has a concurrent branch change`);
    return existingSha;
  }
  const repository = await repoInfo(task.repo);
  const defaultHead = await branchSha(task.repo, repository.default_branch);
  // Initial branch bases must match main; CI-failed task branches may safely
  // accept a one-parent corrective child of their exact existing ref.
  const baseError = preparedRefBaseError(task, existingSha, defaultHead, h.baseSha);
  if (baseError) {
    console.log(`Waiting: ${task.id} ${baseError}`);
    return existingSha;
  }
  const commit = await gh<{ message: string; parents: { sha: string }[] }>(
    api(task.repo, `/git/commits/${h.headSha}`)
  );
  if (!commit.message?.startsWith('[CF-Pages-Skip]') || commit.parents?.length !== 1
      || commit.parents[0].sha !== h.baseSha) throw Error(`Invalid prepared commit ${task.id}`);
  const compare = await gh<{
    status: string; ahead_by: number; behind_by: number;
    merge_base_commit: { sha: string }; files: { filename: string }[];
  }>(api(task.repo, `/compare/${h.baseSha}...${h.headSha}`));
  if (compare.status !== 'ahead' || compare.ahead_by !== 1 || compare.behind_by !== 0
      || compare.merge_base_commit?.sha !== h.baseSha
      || !compare.files?.length || compare.files.length > 50) {
    throw Error(`Unbounded/non-fast-forward prepared change ${task.id}`);
  }
  const scopeError = preparedRefHandoffScopeError(compare.files.map(file => file.filename));
  if (scopeError) throw Error(`Unsafe prepared commit ${task.id}: ${scopeError}`);
  // Prevent stale observations from being delivered after a rival Worker
  // or the Task controller has changed its revision/claim/checkpoint.
  const current = await seoTaskGet({ id: task.id });
  if (!isPreparedRefHandoff(current) || current.revision !== task.revision
      || current.deliveryHandoff.headSha !== h.headSha
      || current.deliveryHandoff.baseSha !== h.baseSha) {
    console.log(`Waiting: ${task.id} checkpoint changed`);
    return existingSha;
  }
  if (dryRun) {
    console.log(`[dry-run] would fast-forward ${task.repo} ${h.branch} -> ${h.headSha}`);
    return existingSha;
  }
  // An existing exact branch must pass the same provenance and scope checks.
  if (existingSha === h.headSha) return existingSha;
  const refPath = `/git/refs/heads/${encodeURIComponent(h.branch)}`;
  if (existingSha === null) {
    await gh(api(task.repo, '/git/refs'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${h.branch}`, sha: h.baseSha })
    });
  }
  await gh(api(task.repo, refPath), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: h.headSha, force: false })
  });
  const actual = await branchSha(task.repo, h.branch);
  if (actual !== h.headSha) throw Error(`Prepared ref readback mismatch ${task.id}`);
  console.log(`SEO prepared ref delivered: ${task.id} ${h.branch}@${actual}`);
  return actual;
}

// Permit only bounded, independently compared state-only bot commits on main.
 // This does not apply to prepared refs, safety-refused tasks, source/config
 // drift, or worker edits overlapping the bot's state. GitHub PR mergeability
 // and exact-HEAD checks still apply before any merge.
async function compatibleFallbackMainDrift(
  repo: string, baseSha: string, currentMainSha: string, workerPaths: readonly string[]
): Promise<boolean> {
  if (baseSha === currentMainSha) return true;
  const delta = await gh<{
    status: string; ahead_by: number; behind_by: number;
    merge_base_commit: { sha: string }; files: { filename: string }[];
  }>(api(repo, `/compare/${baseSha}...${currentMainSha}`));
  return verifiedBranchMainDriftIsNonInterfering(baseSha, delta, workerPaths);
}

// A capability-fallback Worker has already written a task-specific branch via
// create_branch + push_files. It must be an EXACT one-commit child of main.
// A receipt is not sufficient: independently inspect commit, compare and diff.
async function verifyWorkerBranch(task: SeoTaskRecord, actualSha: string | null) {
  const h = task.deliveryHandoff;
  if (!h.branch || !h.headSha || !h.baseSha || actualSha !== h.headSha) {
    console.log(`Waiting: ${task.id} Worker branch missing or HEAD mismatch`);
    return null;
  }
  const repository = await repoInfo(task.repo);
  const defaultSha = await branchSha(task.repo, repository.default_branch);
  const commit = await gh<{ message: string; tree: { sha: string }; parents: { sha: string }[] }>(
    api(task.repo, `/git/commits/${h.headSha}`)
  );
  if (!commit.message?.startsWith('[CF-Pages-Skip]') || commit.parents?.length !== 1
      || commit.parents[0].sha !== h.baseSha || !/^[a-f0-9]{40}$/.test(commit.tree?.sha ?? '')) {
    throw Error(`Invalid Worker branch commit provenance ${task.id}`);
  }
  const compare = await gh<{
    status: string; ahead_by: number; behind_by: number;
    merge_base_commit: { sha: string }; files: { filename: string }[];
  }>(api(task.repo, `/compare/${h.baseSha}...${h.headSha}`));
  if (compare.status !== 'ahead' || compare.ahead_by !== 1 || compare.behind_by !== 0
      || compare.merge_base_commit?.sha !== h.baseSha || !compare.files?.length || compare.files.length > 50) {
    throw Error(`Invalid/non-fast-forward Worker branch ${task.id}`);
  }
  const workerPaths = compare.files.map(file => file.filename);
  const unsafe = preparedRefHandoffScopeError(workerPaths);
  if (unsafe) throw Error(`Worker branch has prohibited paths: ${unsafe}`);
  if (!(await compatibleFallbackMainDrift(task.repo, h.baseSha, defaultSha, workerPaths))) {
    console.log(`Worker branch ${task.id} cannot be delivered because main advanced by non-state or overlapping changes`);
    throw new Error(`Worker branch base is stale against current main; fresh validation and a new exact-main-based handoff are required for ${task.id}`);
  }
  const reread = await branchSha(task.repo, h.branch);
  if (reread !== h.headSha) throw Error(`Worker branch changed during verification ${task.id}`);
  return reread;
}

async function reconcilePushPending(task: SeoTaskRecord, activeSites: Awaited<ReturnType<typeof siteRegistryList>>['items']): Promise<SeoTaskRecord> {
  const handoff = task.deliveryHandoff;
  if (handoff?.state !== 'push_pending') return task;
  // Two capability-selected transports: prepared unreferenced commit, or
  // a single exact-main-based pre-pushed seo/* branch from an eligible Worker.
  // Never accept an unmarked post-cutover direct push.
  if (preparedHandoffRequired(task) && !isPreparedRefHandoff(task) && !isBranchFallback(task)) {
    console.log(`Waiting: ${task.id} requires an authorized prepared or verified branch handoff marker`);
    return task;
  }
  if (isPreparedRefHandoff(task)) {
    const gateError = preparedRefHandoffPreflight(
      task, activeSites,
      process.env.SEO_PREPARED_REF_HANDOFF_ENABLED,
      process.env.SEO_PREPARED_REF_HANDOFF_NOT_BEFORE
    );
    if (gateError) {
      console.log(`Waiting: ${task.id} prepared-ref gate: ${gateError}`);
      return task;
    }
  }
  if (isBranchFallback(task)) {
    const branchError = verifiedBranchHandoffPreflight(
      task, activeSites,
      process.env.SEO_PREPARED_REF_HANDOFF_ENABLED,
      process.env.SEO_PREPARED_REF_HANDOFF_NOT_BEFORE
    );
    if (branchError) {
      console.log(`Waiting: ${task.id} verified branch gate: ${branchError}`);
      return task;
    }
  }
  if (!handoff.branch?.startsWith('seo/') || !handoff.headSha || !handoff.baseSha) {
    console.log(`Waiting: ${task.id} has incomplete push_pending metadata; Worker must repair the checkpoint.`);
    return task;
  }

  let actualBranchSha: string | null;
  try {
    actualBranchSha = await branchSha(task.repo, handoff.branch);
  } catch (error) {
    if (!/GitHub 404 Not Found/.test(String(error))) throw error;
    actualBranchSha = null;
  }
  if (isBranchFallback(task)) {
    actualBranchSha = await verifyWorkerBranch(task, actualBranchSha);
  } else if (isPreparedRefHandoff(task) || actualBranchSha !== handoff.headSha) {
    // Only the prepared-commit protocol may create/update a ref centrally.
    actualBranchSha = await pushPreparedRef(task, actualBranchSha);
  }
  if (actualBranchSha === null) {
    console.log(`Waiting: ${task.id} push_pending branch is not visible remotely yet: ${handoff.branch}`);
    return task;
  }
  if (actualBranchSha !== handoff.headSha) {
    // An older remote branch head may still be visible while the Worker is pushing the expected commit.
    console.log(`Waiting: ${task.id} push_pending remote HEAD mismatch; expected=${handoff.headSha}, actual=${actualBranchSha}`);
    return task;
  }

  // A capability-selected transport is never authority to promote a stale
  // checkpoint after a rival Worker/Manager changed the Task during Git readback.
  const current = await seoTaskGet({ id: task.id });
  if (current.status !== 'in_progress' || current.revision !== task.revision
      || current.deliveryHandoff.state !== 'push_pending'
      || current.deliveryHandoff.branch !== handoff.branch
      || current.deliveryHandoff.headSha !== handoff.headSha
      || current.deliveryHandoff.baseSha !== handoff.baseSha
      || current.deliveryHandoff.validationSummary !== handoff.validationSummary) {
    console.log(`Waiting: ${task.id} handoff changed during exact remote-ref verification`);
    return current;
  }
  const currentGateError = isBranchFallback(current)
    ? verifiedBranchHandoffPreflight(current, activeSites,
        process.env.SEO_PREPARED_REF_HANDOFF_ENABLED,
        process.env.SEO_PREPARED_REF_HANDOFF_NOT_BEFORE)
    : isPreparedRefHandoff(current)
      ? preparedRefHandoffPreflight(current, activeSites,
          process.env.SEO_PREPARED_REF_HANDOFF_ENABLED,
          process.env.SEO_PREPARED_REF_HANDOFF_NOT_BEFORE)
      : null;
  if (currentGateError) {
    console.log(`Waiting: ${task.id} transport gate changed during reconciliation: ${currentGateError}`);
    return current;
  }
  const claimRunId = current.executionClaim?.runId;
  if (!claimRunId) {
    console.log(`Waiting: ${task.id} push_pending has exact remote HEAD but no execution claim; a Worker must reclaim before promotion.`);
    return current;
  }

  const at = new Date().toISOString();
  if (dryRun) {
    console.log(`[dry-run] would promote ${task.id} push_pending -> branch_ready after exact remote HEAD verification.`);
    return current;
  }

  const promoted = await seoTaskUpdate({
    id: current.id,
    expectedRevision: current.revision,
    claimRunId,
    deliveryHandoff: {
      ...current.deliveryHandoff,
      state: 'branch_ready',
      handedOffAt: at,
      lastError: '',
      updatedAt: at
    },
    executionSummary: [
      current.executionSummary,
      `Central delivery verified remote branch ${current.deliveryHandoff.branch}@${actualBranchSha} exactly matches the pre-push checkpoint and promoted push_pending to branch_ready.`
    ].filter(Boolean).join('\n'),
    appendHistory: {
      actor: 'seo_delivery_controller',
      event: 'delivery_push_reconciled',
      detail: `Exact remote HEAD matched write-ahead checkpoint; promoted push_pending -> branch_ready for ${current.deliveryHandoff.branch}@${actualBranchSha}.`
    }
  });
  console.log(`Reconciled push_pending: ${task.id} -> branch_ready at ${actualBranchSha}`);
  return promoted;
}

async function processTask(task: SeoTaskRecord, activeSites: Awaited<ReturnType<typeof siteRegistryList>>['items']) {
  const handoff = task.deliveryHandoff;
  if (!handoff || !['branch_ready', 'pr_open'].includes(handoff.state)) return;
  // Post-cutover must use either the validated prepared ref or the task-bound
  // pre-pushed branch (legacy pre-cutover delivery may still drain).
  if (preparedHandoffRequired(task) && !isPrepared(task) && !isBranchFallback(task)) {
    console.log(`Waiting: ${task.id} new task lacks an authorized handoff marker`);
    return;
  }
  if (isPrepared(task)) {
    const gateError = preparedRefHandoffPreflight(
      task, activeSites,
      process.env.SEO_PREPARED_REF_HANDOFF_ENABLED,
      process.env.SEO_PREPARED_REF_HANDOFF_NOT_BEFORE
    );
    if (gateError) {
      console.log(`Waiting: ${task.id} prepared-ref PR/merge gate: ${gateError}`);
      return;
    }
  }
  if (isBranchFallback(task)) {
    const error = verifiedBranchHandoffPreflight(
      task, activeSites,
      process.env.SEO_PREPARED_REF_HANDOFF_ENABLED,
      process.env.SEO_PREPARED_REF_HANDOFF_NOT_BEFORE
    );
    if (error) {
      console.log(`Waiting: ${task.id} verified branch PR/merge gate: ${error}`);
      return;
    }
  }
  if (!handoff.branch?.startsWith('seo/') || !handoff.headSha || !handoff.baseSha) {
    await markFailed(task, 'Invalid delivery handoff: branch_ready/pr_open requires seo/* branch, headSha and baseSha.');
    return;
  }

  const info = await repoInfo(task.repo);
  const base = info.default_branch || 'main';
  let actualBranchSha: string;
  try {
    actualBranchSha = await branchSha(task.repo, handoff.branch);
  } catch (error) {
    await markFailed(task, `Implementation branch missing: ${handoff.branch}. ${String(error)}`);
    return;
  }
  if (actualBranchSha !== handoff.headSha) {
    await markFailed(task, `Branch HEAD mismatch: checkpoint=${handoff.headSha}, actual=${actualBranchSha}. Worker must revalidate and write a fresh handoff.`);
    return;
  }

  let pr = handoff.prNumber ? await pullByNumber(task.repo, handoff.prNumber) : await findPull(task.repo, handoff.branch, base);
  if (!pr) {
    if (dryRun) {
      console.log(`[dry-run] would create PR for ${task.id} ${task.repo} ${handoff.branch} -> ${base}`);
      return;
    }
    pr = await createPull(task, base, handoff);
  }

  if (pr.head.sha !== handoff.headSha) {
    await markFailed(task, `PR head SHA mismatch: checkpoint=${handoff.headSha}, PR=${pr.head.sha}.`);
    return;
  }

  if (pr.merged || pr.merged_at) {
    const mergedSha = pr.merge_commit_sha;
    if (!mergedSha) {
      await markFailed(task, `PR #${pr.number} is merged but GitHub returned no merge_commit_sha.`);
      return;
    }
    await markCompleted(task, mergedSha, pr);
    return;
  }

  if (pr.state === 'closed') {
    await markFailed(task, `PR #${pr.number} was closed without merge.`);
    return;
  }

  if (handoff.state !== 'pr_open' || handoff.prNumber !== pr.number || handoff.prUrl !== pr.html_url) {
    const current = await seoTaskGet({ id: task.id });
    const updated = nextHandoff(current.deliveryHandoff, {
      state: 'pr_open',
      prNumber: pr.number,
      prUrl: pr.html_url,
      lastError: ''
    });
    if (!dryRun) {
      await updateDelivery(task.id, updated, 'delivery_pr_opened', `PR #${pr.number} opened for ${handoff.branch} -> ${base}; central delivery will verify exact Git ref and mergeability without peripheral Actions.`);
    }
    task = await seoTaskGet({ id: task.id });
  }

  // PR CI runs in peripheral repositories are intentionally NOT required.
  // GitHub Actions execution is centralized in the public keywords repository;
  // the hosting provider builds on default-branch push. The Worker has already
  // supplied source-level acceptance evidence in the immutable task handoff,
  // while this controller verified exact commit parent, scoped diff, ref and PR.
  // Production build/HTTP/canonical verification is a separate post-merge gate.
  // Never treat a preview check, failed satellite job or a missing check as proof.
  let freshPr = await pullByNumber(task.repo, pr.number);
  // GitHub often returns mergeable=null immediately after PR creation.
  // Recheck briefly within this cycle instead of waiting for the next
  // 30-minute scheduled run. A true conflict (false) is never retried.
  for (let attempt = 0; retryMergeability(freshPr.mergeable, attempt); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    freshPr = await pullByNumber(task.repo, pr.number);
  }
  if (freshPr.head.sha !== handoff.headSha || freshPr.base.ref !== base) {
    await markFailed(task, `PR #${pr.number} changed HEAD/base during delivery; stop instead of merging an unvalidated change.`);
    return;
  }
  if (freshPr.mergeable !== true) {
    console.log(`Waiting: ${task.id} PR #${pr.number} not yet GitHub-mergeable (mergeable=${String(freshPr.mergeable)}, state=${freshPr.mergeable_state ?? 'unknown'}).`);
    return;
  }
  const currentMainSha = await branchSha(task.repo, base);
  if (handoff.baseSha !== currentMainSha) {
    // Standard fallback accepts only unrelated SNS bot-state main drift.
    // Corrective prepared commits are different: they must fast-forward an
    // EXACT existing task branch after an independently recorded failure.
    // Inspect the final net diff against live main and the full parent chain
    // instead of trusting a previously broken multi-commit branch.
    const fallbackDelta = isBranchFallback(task)
      ? await gh<{ status: string; ahead_by: number; behind_by: number; files: { filename: string }[] }>(
          api(task.repo, `/compare/${handoff.baseSha}...${handoff.headSha}`)
        )
      : null;
    const fallbackCompatible = fallbackDelta?.status === 'ahead'
      && fallbackDelta.ahead_by === 1 && fallbackDelta.behind_by === 0
      && fallbackDelta.files?.length > 0
      && await compatibleFallbackMainDrift(
        task.repo, handoff.baseSha, currentMainSha,
        fallbackDelta.files.map(file => file.filename)
      );

    let correctiveCompatible = false;
    if (!fallbackCompatible && isPrepared(task)) {
      const commit = await gh<{ message: string; parents: { sha: string }[] }>(
        api(task.repo, `/git/commits/${handoff.headSha}`)
      );
      const exactCorrectiveParent = commit.message?.startsWith('[CF-Pages-Skip]')
        && commit.parents?.length === 1
        && commit.parents[0].sha === handoff.baseSha;
      if (exactCorrectiveParent) {
        const net = await gh<{
          status: string; ahead_by: number; behind_by: number;
          merge_base_commit: { sha: string };
          files: { filename: string }[];
        }>(api(task.repo, `/compare/${currentMainSha}...${handoff.headSha}`));
        correctiveCompatible = verifiedCorrectiveMainNetDiff(task, currentMainSha, net);
      }
    }
    if (!fallbackCompatible && !correctiveCompatible) {
      console.log(`Waiting: ${task.id} current-main ancestry or bounded corrective provenance cannot be proved.`);
      return;
    }
    console.log(`Verified ${correctiveCompatible ? 'bounded corrective net diff' : 'SNS bot-state-only drift'} for ${task.id}; exact PR HEAD, mergeability and central build remain mandatory.`);
  }

  // GitHub mergeability only proves that git can merge. Build the exact
  // immutable PR head and inspect generated target HTML before merge.
  const receipt = `head=${handoff.headSha};urls=${task.targetUrls.join('|')}`;
  if (!(task.history ?? []).some(entry => entry.event === 'central_ci_passed' && entry.detail.startsWith(receipt + ';'))) {
    try {
      const summary = await verifySeoSiteBuild(task, handoff.headSha);
      console.log(summary);
      if (!dryRun) {
        const current = await seoTaskGet({ id: task.id });
        if (current.status !== 'in_progress' || current.deliveryHandoff.headSha !== handoff.headSha) return;
        await seoTaskUpdate({
          id: task.id, expectedRevision: current.revision,
          claimRunId: current.executionClaim?.runId,
          // Delivery retains ownership after Worker claim release. Carry the
          // unchanged checkpoint so this remains a delivery-lane update.
          deliveryHandoff: current.deliveryHandoff,
          appendHistory: { actor: 'seo_delivery_controller', event: 'central_ci_passed', detail: receipt + ';' + summary }
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Central site CI failed for ${task.id}: ${reason}`);
      if (!dryRun) await markFailed(task, `Central site CI: ${reason.slice(0, 1400)}`);
      return;
    }
  }

  if (dryRun) {
    console.log(`[dry-run] would merge ${task.id} after exact HEAD, mergeability and central site CI.`);
    return;
  }

  // Last-minute checkpoint verification; do not merge after a stale cancellation
  // or an updated handoff/claim by another actor.
  const currentTask = await seoTaskGet({ id: task.id });
  if (currentTask.status !== 'in_progress' || currentTask.deliveryHandoff.headSha !== handoff.headSha
      || currentTask.deliveryHandoff.prNumber !== pr.number || currentTask.deliveryHandoff.state !== 'pr_open') {
    console.log(`Waiting: ${task.id} delivery Task changed before merge; refusing stale PR action.`);
    return;
  }
  let mergeResult: { sha?: string; merged: boolean; message?: string };
  try {
    mergeResult = await mergePull(task, pr.number, handoff.headSha, mergeMethod(info));
  } catch (error) {
    console.log(`Merge deferred for ${task.id}: ${String(error)}`);
    return;
  }
  if (!mergeResult.merged || !mergeResult.sha) {
    console.log(`Merge deferred for ${task.id}: ${mergeResult.message ?? 'GitHub did not merge the PR'}`);
    return;
  }

  pr = await pullByNumber(task.repo, pr.number);
  await markCompleted(task, mergeResult.sha, pr);
}

async function cleanupMergedSeoBranches(allowedRepos: Set<string>, limit: number) {
  const completed = (await seoTaskList({ status: 'completed', limit: 100 })).items
    .filter(task => allowedRepos.has(task.repo))
    .filter(task => task.deliveryHandoff?.state === 'merged')
    .filter(task => task.deliveryHandoff?.branch?.startsWith('seo/'))
    .slice(0, limit);

  for (const task of completed) {
    await deleteMergedBranch(task.repo, task.deliveryHandoff.branch ?? '');
  }
}

async function main() {
  if (!token) {
    console.log('SEO_DELIVERY_GITHUB_TOKEN is not configured; central delivery controller is idle.');
    return;
  }

  // A dispatch is only a wakeup. Read the latest persisted Task and its exact
  // site mapping; never trust payload repository, SHA, claim or handoff data.
  const notifiedId = process.env.SEO_DELIVERY_TASK_ID?.trim();
  if (notifiedId) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(notifiedId)) throw Error('Invalid dispatch Task ID');
    const task = await seoTaskGet({ id: notifiedId });
    const site = await siteRegistryGet({ id: task.siteId });
    if (site.status !== 'active' || site.repository !== task.repo) {
      console.log(`Ignoring delivery wakeup ${notifiedId}: inactive or mismatched site registry.`);
      return;
    }
    if (task.status !== 'in_progress' || !['push_pending', 'branch_ready', 'pr_open'].includes(task.deliveryHandoff?.state ?? 'none')) {
      console.log(`Ignoring stale or duplicate delivery wakeup ${notifiedId}.`);
      return;
    }
    const sites = [site];
    const reconciled = task.deliveryHandoff.state === 'push_pending'
      ? await reconcilePushPending(task, sites)
      : task;
    if (['branch_ready', 'pr_open'].includes(reconciled.deliveryHandoff?.state ?? 'none')) {
      const current = await seoTaskGet({ id: notifiedId });
      if (current.status === 'in_progress' && current.deliveryHandoff.headSha === reconciled.deliveryHandoff.headSha) {
        await processTask(current, sites);
      }
    }
    return;
  }

  // Query the small delivery queue before reading the site registry. A routine
  // idle cron now performs one status query rather than scanning every site.
  const initialInProgress = (await seoTaskList({ status: 'in_progress', limit: 100 })).items;

  // Keep the exact Task records returned by the initial read. Reusing the
  // reconciliation return value avoids another global Firestore status scan.
  // A point read immediately before each PR operation still revalidates the
  // Task state, refusal history and exact Worker checkpoint.
  const candidates: SeoTaskRecord[] = [];
  for (const pending of initialInProgress) {
    if (retryableOgAssetPermissionFailure(pending)) {
      try {
        const resumed = await resumeOgPermissionFailure(pending);
        if (resumed) candidates.push(resumed);
      } catch (error) {
        if (firestoreRateLimited(error)) {
          console.warn('Firestore 429: stop bounded isolated-build retry without changing schedules.');
          return;
        }
        console.error(`Isolated OG permission retry not completed for ${pending.id}: ${String(error)}`);
      }
      continue;
    }
    if (!['push_pending', 'branch_ready', 'pr_open'].includes(pending.deliveryHandoff?.state ?? 'none')) continue;
    let site;
    try {
      site = await siteRegistryGet({ id: pending.siteId });
    } catch (error) {
      if (firestoreRateLimited(error)) throw error;
      console.warn(`Site lookup failed for ${pending.id}: ${String(error)}`);
      continue;
    }
    if (site.status !== 'active' || site.repository !== pending.repo) continue;
    if (pending.deliveryHandoff?.state !== 'push_pending') {
      if (['branch_ready', 'pr_open'].includes(pending.deliveryHandoff?.state ?? 'none')) candidates.push(pending);
      continue;
    }
    try {
      const reconciled = await reconcilePushPending(pending, [site]);
      if (['branch_ready', 'pr_open'].includes(reconciled.deliveryHandoff?.state ?? 'none')) candidates.push(reconciled);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Push reconciliation error for ${pending.id}: ${message}`);
      if (firestoreRateLimited(error)) {
        console.warn('Firestore 429: stop this delivery cycle without more Firestore requests; task and schedule remain intact.');
        return;
      }
      try {
        // A malformed or stale immutable handoff cannot recover by waiting. Mark
        // the task for corrective Worker execution, without touching its ref.
        if (/^(?:Invalid Worker branch commit provenance|Invalid\/non-fast-forward Worker branch|Worker branch base is stale against current main)/.test(message)) {
          await markFailed(pending, message);
        } else {
          await recordControllerError(pending, message);
        }
      } catch (recordError) {
        console.error(`Could not persist push reconciliation error for ${pending.id}: ${String(recordError)}`);
      }
    }
  }

  const tasks = candidates.slice(0, maxTasks);
  console.log(`SEO delivery controller found ${tasks.length} eligible task(s) after push reconciliation.`);
  for (const task of tasks) {
    try {
      // A Task could be cancelled or otherwise changed since the initial
      // list; never create a PR from a stale in-memory snapshot.
      const current = await seoTaskGet({ id: task.id });
      if (current.status !== 'in_progress'
          || !['branch_ready', 'pr_open'].includes(current.deliveryHandoff?.state ?? 'none')
          || current.deliveryHandoff?.headSha !== task.deliveryHandoff?.headSha) {
        console.log(`Delivery Task ${task.id} changed before PR processing; skipping.`);
        continue;
      }
      const site = await siteRegistryGet({ id: current.siteId });
      if (site.status !== 'active' || site.repository !== current.repo) continue;
      await processTask(current, [site]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Task ${task.id} controller error: ${message}`);
      if (firestoreRateLimited(error)) {
        console.warn('Firestore 429: stop this delivery cycle without additional persistence attempts.');
        return;
      }
      try { await recordControllerError(task, message); } catch (recordError) {
        console.error(`Could not persist controller error for ${task.id}: ${String(recordError)}`);
      }
    }
  }

  // Already cleaned at markCompleted(). A broad completed-task sweep on
  // every run wastes GitHub API calls and slows down real deliveries.
  // Explicit maintenance runs can opt into a small bounded cleanup sweep.
  if (cleanupLimit > 0) {
    const sites = await siteRegistryList({ status: 'active', limit: 100 });
    await cleanupMergedSeoBranches(new Set(sites.items.map(site => site.repository)), cleanupLimit);
  }
}

await main();
