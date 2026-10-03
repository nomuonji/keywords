import {
  seoTaskClaim,
  seoTaskList,
  seoTaskUpdate
} from '../packages/commands/src/remote-site-operations.js';

const token = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim() ?? '';
if (!token) throw new Error('SEO_DELIVERY_GITHUB_TOKEN is required');

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
  'user-agent': 'keywords-seo-delivery-backlog-migrate'
};

async function gh<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers });
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

function parseImplementationPushed(task: any) {
  const history = [...(task.history ?? [])].reverse();
  for (const event of history) {
    if (event.event !== 'implementation_pushed') continue;
    const detail = String(event.detail ?? '');
    const match = detail.match(/Branch\s+(seo\/[A-Za-z0-9._\/-]+)\s+at\s+([a-f0-9]{7,64})\s+from\s+main\s+([a-f0-9]{7,64})/i);
    if (match) return { branch: match[1], headSha: match[2].toLowerCase(), baseSha: match[3].toLowerCase(), detail };
  }
  return null;
}

async function claim(task: any, suffix: string) {
  const runId = `legacy-backlog-${suffix}-${task.id}`.slice(0, 120);
  const claimed = await seoTaskClaim({
    id: task.id,
    expectedRevision: task.revision,
    runId,
    actor: 'seo_delivery_backlog_migration',
    leaseMinutes: 15
  });
  return { claimed, runId };
}

async function returnToReady(task: any, reason: string) {
  const { claimed, runId } = await claim(task, 'reset');
  const updated = await seoTaskUpdate({
    id: task.id,
    expectedRevision: claimed.revision,
    claimRunId: runId,
    status: 'ready',
    executionSummary: [
      task.executionSummary,
      `Legacy in_progress backlog normalized: returned to ready. Reason: ${reason}`
    ].filter(Boolean).join('\n'),
    appendHistory: {
      actor: 'seo_delivery_backlog_migration',
      event: 'legacy_backlog_reset_ready',
      detail: reason.slice(0, 2000)
    }
  });
  console.log(`RESET_READY ${task.id} ${task.repo}: ${reason}; revision=${updated.revision}`);
}

async function handoff(task: any, pushed: { branch: string; headSha: string; baseSha: string; detail: string }) {
  let ref: { object: { sha: string } };
  try {
    ref = await gh<{ object: { sha: string } }>(api(task.repo, `/git/ref/heads/${encodeURIComponent(pushed.branch)}`));
  } catch (error) {
    await returnToReady(task, `Recorded implementation branch ${pushed.branch} is unavailable; refusing to infer delivery from stale history. ${String(error)}`);
    return;
  }

  const actualHead = String(ref.object.sha).toLowerCase();
  if (!(actualHead === pushed.headSha || actualHead.startsWith(pushed.headSha) || pushed.headSha.startsWith(actualHead))) {
    await returnToReady(task, `Recorded implementation HEAD ${pushed.headSha} does not match current branch HEAD ${actualHead}; refusing automatic merge of an unverified branch.`);
    return;
  }

  const { claimed, runId } = await claim(task, 'handoff');
  const at = new Date().toISOString();
  const updated = await seoTaskUpdate({
    id: task.id,
    expectedRevision: claimed.revision,
    claimRunId: runId,
    deliveryHandoff: {
      state: 'branch_ready',
      branch: pushed.branch,
      headSha: actualHead,
      baseSha: pushed.baseSha,
      validationSummary: `Legacy implementation_pushed evidence verified against current GitHub branch HEAD. Original evidence: ${pushed.detail}`.slice(0, 4000),
      handedOffAt: at,
      prNumber: null,
      prUrl: null,
      lastError: '',
      updatedAt: at
    },
    executionSummary: [
      task.executionSummary,
      `Legacy pushed implementation migrated to central delivery: ${pushed.branch}@${actualHead}; base=${pushed.baseSha}.`
    ].filter(Boolean).join('\n'),
    appendHistory: {
      actor: 'seo_delivery_backlog_migration',
      event: 'delivery_handoff_ready',
      detail: `Verified legacy implementation branch and migrated to central delivery: branch=${pushed.branch}; head=${actualHead}; base=${pushed.baseSha}.`
    }
  });
  console.log(`HANDOFF ${task.id} ${task.repo}: ${pushed.branch}@${actualHead}; revision=${updated.revision}`);
}

async function main() {
  const items = (await seoTaskList({ status: 'in_progress', limit: 100 })).items
    .filter((task: any) => (task.deliveryHandoff?.state ?? 'none') === 'none');

  console.log(`Legacy backlog candidates: ${items.length}`);
  let handedOff = 0;
  let reset = 0;
  let skipped = 0;

  for (const task of items) {
    if (task.executionClaim) {
      console.log(`SKIP_ACTIVE ${task.id}: active execution claim present`);
      skipped += 1;
      continue;
    }

    const pushed = parseImplementationPushed(task);
    if (pushed) {
      await handoff(task, pushed);
      handedOff += 1;
      continue;
    }

    await returnToReady(
      task,
      'No durable implementation_pushed event with exact seo/* branch, implementation HEAD SHA and base main SHA was recorded. Prior claim/article-registration state alone is insufficient delivery evidence.'
    );
    reset += 1;
  }

  console.log(`Backlog migration finished: candidates=${items.length}; handoff_attempts=${handedOff}; reset_ready=${reset}; skipped_active=${skipped}`);
}

await main();
