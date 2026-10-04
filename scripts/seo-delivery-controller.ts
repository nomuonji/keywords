import {
  seoTaskGet,
  seoTaskList,
  seoTaskUpdate,
  siteRegistryList
} from '../packages/commands/src/remote-site-operations.js';
import type { SeoTaskDeliveryHandoff, SeoTaskRecord } from '../packages/db/src/site-operations-schema.js';

const token = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim() ?? '';
const dryRun = process.env.SEO_DELIVERY_DRY_RUN === '1';
const maxTasks = Math.max(1, Math.min(Number(process.env.SEO_DELIVERY_MAX_TASKS ?? 20), 100));
const noCheckGraceMs = Math.max(60_000, Math.min(Number(process.env.SEO_DELIVERY_NO_CHECK_GRACE_MS ?? 120_000), 30 * 60_000));

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
  head: { sha: string; ref: string };
  base: { ref: string };
};

type CheckSummary = {
  pending: string[];
  failed: string[];
  passed: string[];
  observed: number;
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

function latestStatuses(statuses: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const status of statuses) {
    const key = String(status.context ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(status);
  }
  return result;
}

async function optionalGitHubSignal<T>(url: string): Promise<T | null> {
  try {
    return await gh<T>(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/GitHub 403 Forbidden/.test(message)) {
      console.log(`Optional GitHub signal unavailable: ${url}`);
      return null;
    }
    throw error;
  }
}

async function checkSummary(repo: string, sha: string): Promise<CheckSummary> {
  const actionParams = new URLSearchParams({ head_sha: sha, per_page: '100' });
  const [actions, checks, combined] = await Promise.all([
    gh<{ workflow_runs: any[] }>(api(repo, `/actions/runs?${actionParams}`)),
    optionalGitHubSignal<{ check_runs: any[] }>(api(repo, `/commits/${sha}/check-runs?per_page=100`)),
    optionalGitHubSignal<{ statuses: any[] }>(api(repo, `/commits/${sha}/status`))
  ]);
  const pending: string[] = [];
  const failed: string[] = [];
  const passed: string[] = [];

  for (const run of actions.workflow_runs ?? []) {
    const name = `actions:${run.name ?? run.id}`;
    if (run.status !== 'completed') pending.push(name);
    else if (['success', 'neutral', 'skipped'].includes(run.conclusion)) passed.push(name);
    else failed.push(`${name}=${run.conclusion ?? 'unknown'}`);
  }

  for (const run of checks?.check_runs ?? []) {
    const rawName = String(run.name ?? run.id);
    // Hosting preview checks are intentionally not part of the SEO delivery gate.
    // seo/* preview deployments may be disabled to avoid duplicate build spend.
    if (/cloudflare pages/i.test(rawName) || /vercel/i.test(rawName) || /netlify/i.test(rawName)) {
      passed.push(`hosting-preview-ignored:${rawName}`);
      continue;
    }
    const name = `check:${rawName}`;
    if (run.status !== 'completed') pending.push(name);
    else if (['success', 'neutral', 'skipped'].includes(run.conclusion)) passed.push(name);
    else failed.push(`${name}=${run.conclusion ?? 'unknown'}`);
  }

  for (const status of latestStatuses(combined?.statuses ?? [])) {
    const name = `status:${status.context ?? 'unknown'}`;
    if (status.state === 'pending') pending.push(name);
    else if (status.state === 'success') passed.push(name);
    else failed.push(`${name}=${status.state ?? 'unknown'}`);
  }

  return { pending, failed, passed, observed: pending.length + failed.length + passed.length };
}

function mergeMethod(info: GitHubRepo): 'squash' | 'merge' | 'rebase' {
  if (info.allow_squash_merge !== false) return 'squash';
  if (info.allow_merge_commit !== false) return 'merge';
  return 'rebase';
}

async function mergePull(repo: string, number: number, headSha: string, method: 'squash' | 'merge' | 'rebase') {
  return gh<{ sha?: string; merged: boolean; message?: string }>(api(repo, `/pulls/${number}/merge`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: headSha, merge_method: method })
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
    deliveryHandoff: handoff,
    executionSummary: [current.executionSummary, `Delivery controller failure: ${message}`].filter(Boolean).join('\n'),
    appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_failed', detail: message.slice(0, 2000) }
  });
}

async function recordControllerError(task: SeoTaskRecord, message: string) {
  const current = await seoTaskGet({ id: task.id });
  if (!current.deliveryHandoff || current.deliveryHandoff.state === 'none' || current.deliveryHandoff.state === 'merged') return;
  const handoff = nextHandoff(current.deliveryHandoff, { lastError: message });
  if (dryRun) {
    console.log(`[dry-run] controller error for ${task.id}: ${message}`);
    return;
  }
  await seoTaskUpdate({
    id: task.id,
    expectedRevision: current.revision,
    deliveryHandoff: handoff,
    appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_controller_error', detail: message.slice(0, 2000) }
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
  await seoTaskUpdate({
    id: task.id,
    expectedRevision: current.revision,
    status: 'completed',
    resultCommitSha: mergeSha,
    deliveryHandoff: handoff,
    executionSummary: [
      current.executionSummary,
      `Central delivery merged PR #${pr.number} to main/default branch at ${mergeSha}. Production verification remains ${current.deploymentVerification.status}.`
    ].filter(Boolean).join('\n'),
    appendHistory: {
      actor: 'seo_delivery_controller',
      event: 'delivery_merged',
      detail: `PR #${pr.number} merged; default-branch resultCommitSha=${mergeSha}. Task completed automatically by central delivery controller.`
    }
  });
  await deleteMergedBranch(task.repo, current.deliveryHandoff.branch ?? '');
}

async function processTask(task: SeoTaskRecord) {
  const handoff = task.deliveryHandoff;
  if (!handoff || !['branch_ready', 'pr_open'].includes(handoff.state)) return;
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
      await updateDelivery(task.id, updated, 'delivery_pr_opened', `PR #${pr.number} opened for ${handoff.branch} -> ${base}; waiting for CI.`);
    }
    task = await seoTaskGet({ id: task.id });
  }

  const checks = await checkSummary(task.repo, handoff.headSha);
  if (checks.failed.length) {
    await markFailed(task, `CI failed for ${handoff.headSha}: ${checks.failed.join(', ')}`);
    return;
  }
  if (checks.pending.length) {
    console.log(`Waiting: ${task.id} PR #${pr.number} has pending checks: ${checks.pending.join(', ')}`);
    return;
  }

  const prOpenAt = Date.parse(task.deliveryHandoff.updatedAt ?? task.updatedAt);
  if (checks.observed === 0 && Number.isFinite(prOpenAt) && Date.now() - prOpenAt < noCheckGraceMs) {
    console.log(`Waiting: ${task.id} PR #${pr.number} has no check signal yet; grace period active.`);
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] would merge ${task.id} PR #${pr.number}; observed checks=${checks.observed}`);
    return;
  }

  let mergeResult: { sha?: string; merged: boolean; message?: string };
  try {
    mergeResult = await mergePull(task.repo, pr.number, handoff.headSha, mergeMethod(info));
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

async function cleanupMergedSeoBranches(allowedRepos: Set<string>) {
  const completed = (await seoTaskList({ status: 'completed', limit: 100 })).items
    .filter(task => allowedRepos.has(task.repo))
    .filter(task => task.deliveryHandoff?.state === 'merged')
    .filter(task => task.deliveryHandoff?.branch?.startsWith('seo/'));

  for (const task of completed) {
    await deleteMergedBranch(task.repo, task.deliveryHandoff.branch ?? '');
  }
}

async function main() {
  if (!token) {
    console.log('SEO_DELIVERY_GITHUB_TOKEN is not configured; central delivery controller is idle.');
    return;
  }

  const activeSites = await siteRegistryList({ status: 'active', limit: 100 });
  const allowedRepos = new Set(activeSites.items.map(site => site.repository));
  const tasks = (await seoTaskList({ status: 'in_progress', limit: 100 })).items
    .filter(task => allowedRepos.has(task.repo))
    .filter(task => ['branch_ready', 'pr_open'].includes(task.deliveryHandoff?.state ?? 'none'))
    .slice(0, maxTasks);

  console.log(`SEO delivery controller found ${tasks.length} eligible task(s).`);
  for (const task of tasks) {
    try {
      await processTask(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Task ${task.id} controller error: ${message}`);
      try { await recordControllerError(task, message); } catch (recordError) {
        console.error(`Could not persist controller error for ${task.id}: ${String(recordError)}`);
      }
    }
  }

  await cleanupMergedSeoBranches(allowedRepos);
}

await main();
