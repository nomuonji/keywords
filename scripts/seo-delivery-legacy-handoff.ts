import { seoTaskClaim, seoTaskGet, seoTaskUpdate } from '../packages/commands/src/remote-site-operations.js';

const taskId = process.env.SEO_DELIVERY_MIGRATE_TASK_ID?.trim() ?? '';
const branch = process.env.SEO_DELIVERY_MIGRATE_BRANCH?.trim() ?? '';
const headSha = process.env.SEO_DELIVERY_MIGRATE_HEAD_SHA?.trim() ?? '';
const baseSha = process.env.SEO_DELIVERY_MIGRATE_BASE_SHA?.trim() ?? '';
const validationSummary = process.env.SEO_DELIVERY_MIGRATE_VALIDATION?.trim() ?? 'Legacy Worker validation evidence preserved during structured delivery migration.';

if (!taskId || !branch || !headSha || !baseSha) {
  throw new Error('SEO_DELIVERY_MIGRATE_TASK_ID, BRANCH, HEAD_SHA and BASE_SHA are required');
}
if (!branch.startsWith('seo/')) throw new Error('Legacy delivery branch must use seo/*');
if (!/^[a-f0-9]{7,64}$/i.test(headSha) || !/^[a-f0-9]{7,64}$/i.test(baseSha)) throw new Error('Invalid Git SHA');

const current = await seoTaskGet({ id: taskId });
if (current.status === 'completed' || current.deliveryHandoff.state === 'merged') {
  console.log(`Task ${taskId} already completed/merged; no migration needed.`);
  process.exit(0);
}
if (['branch_ready', 'pr_open'].includes(current.deliveryHandoff.state)) {
  console.log(`Task ${taskId} already has deliveryHandoff=${current.deliveryHandoff.state}; no migration needed.`);
  process.exit(0);
}
if (current.status !== 'in_progress') throw new Error(`Task ${taskId} must be in_progress; got ${current.status}`);
if (current.executionClaim) throw new Error(`Task ${taskId} has an execution claim; do not migrate while a Worker may be active`);

const runId = `legacy-handoff-${taskId}`.slice(0, 120);
const claimed = await seoTaskClaim({
  id: taskId,
  expectedRevision: current.revision,
  runId,
  actor: 'seo_delivery_migration',
  leaseMinutes: 15
});
const at = new Date().toISOString();
const handedOff = await seoTaskUpdate({
  id: taskId,
  expectedRevision: claimed.revision,
  claimRunId: runId,
  deliveryHandoff: {
    state: 'branch_ready',
    branch,
    headSha,
    baseSha,
    validationSummary,
    handedOffAt: at,
    prNumber: null,
    prUrl: null,
    lastError: '',
    updatedAt: at
  },
  executionSummary: [
    current.executionSummary,
    `Legacy pushed branch migrated to structured delivery handoff: ${branch}@${headSha}; base=${baseSha}. Validation: ${validationSummary}`
  ].filter(Boolean).join('\n'),
  appendHistory: {
    actor: 'seo_delivery_migration',
    event: 'delivery_handoff_ready',
    detail: `Migrated legacy Worker branch to central delivery: branch=${branch}; head=${headSha}; base=${baseSha}.`
  }
});
console.log(`Migrated ${taskId}: deliveryHandoff=${handedOff.deliveryHandoff.state}; executionClaim=${handedOff.executionClaim ? 'present' : 'released'}; revision=${handedOff.revision}`);
