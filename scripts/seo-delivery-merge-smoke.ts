import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seoDeliveryMergePayload } from '../packages/commands/src/seo-delivery-merge.js';
import { transientDeliveryError, retryMergeability, cleanupSweepLimit, firestoreRateLimited } from './seo-delivery-throughput.js';
import { preparedHandoffRequired, preparedRefBaseError, preparedRefHandoffPreflight, preparedRefHandoffScopeError, verifiedBranchHandoffPreflight, BRANCH_HANDOFF_MARKER, selectSeoGitTransport, verifiedBranchMainDriftIsNonInterfering, verifiedCorrectiveMainNetDiff } from './seo-prepared-ref-handoff-gate.js';
import type { SeoTaskRecord, SiteRecord } from '../packages/db/src/site-operations-schema.js';

const sample={id:'task-123',title:'[CF-Pages-Skip] Fix real content',siteId:'wiki-shikaku-wiki'};
for(const method of ['squash','merge'] as const){
  const payload=seoDeliveryMergePayload(sample,'abc123',method);
  assert.equal(payload.sha,'abc123');
  assert.equal(payload.merge_method,method);
  assert.match(payload.commit_title,/Fix real content/);
  assert.equal(payload.commit_message.includes('task-123'),true);
  assert.equal(JSON.stringify(payload).includes('[CF-Pages-Skip]'),false);
}
assert.throws(()=>seoDeliveryMergePayload(sample,'abc123','rebase'),/requires a merge\/squash method/);
console.log('seo-delivery merge smoke passed: explicit skip-free main commit, traceable task, rebase fails closed');

 
// These tests cover authorization boundaries, not merely an implementation copy.
// The initial rollout is disabled without an explicit post-review cutoff.
const rollout = '2026-10-13T06:00:00.000Z';
const task = {
  id: 'fresh-task-01', siteId: 'site-a', repo: 'nomuonji/site-a',
  createdAt: '2026-10-13T06:01:00.000Z', status: 'in_progress',
  executionClaim: { actor: 'chatgpt_seo_worker', runId: 'new-claim-01' },
  deliveryHandoff: {
    state: 'push_pending', branch: 'seo/fresh-task-01',
    baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40),
    validationSummary: 'Action-Ref-Handoff: v1\nChecked content change',
    lastError: ''
  },
  history: []
} as unknown as SeoTaskRecord;
const sites = [{id:'site-a',status:'active',repository:'nomuonji/site-a'}] as SiteRecord[];
const preflight = (t: SeoTaskRecord = task, enabled = '1', since = rollout, registry = sites) =>
  preparedRefHandoffPreflight(t, registry, enabled, since);
assert.equal(preflight(), null);
assert.equal(preparedHandoffRequired(task), true);
assert.equal(preparedHandoffRequired({createdAt:'2026-10-13T05:49:59.999Z'}), false);
assert.equal(preparedHandoffRequired({createdAt:'2026-10-13T05:50:00.000Z'}), true);
assert.equal(preparedHandoffRequired({createdAt:'not-a-date'}), true);
assert.match(preflight({ ...task, createdAt: '2026-10-13T05:49:59.999Z' }, '1', '2026-01-01T00:00:00.000Z')!, /predates/);
// Only an existing task branch with a recorded CI failure may accept an
// exact-parent corrective commit. Initial refs must be rooted at current main.
const base='b'.repeat(40), advancedMain='d'.repeat(40);
assert.equal(preparedRefBaseError(task,null,base,base),null);
assert.match(preparedRefBaseError(task,null,advancedMain,base)!,/advanced/);
assert.match(preparedRefBaseError(task,base,advancedMain,base)!,/CI-failed/);
assert.equal(preparedRefBaseError({...task,history:[{event:'delivery_failed',actor:'seo_delivery_controller',detail:'PR CI failed',at:'2026-10-13T07:00:00Z'}]},base,advancedMain,base),null);
assert.equal(preparedRefBaseError({...task,history:[{event:'implementation_blocked',actor:'seo_worker',detail:'truncated legacy branch',at:'2026-10-13T07:00:00Z'}]},base,advancedMain,base),null);

// Recovery is permitted only for a new corrective prepared-commit receipt
// AFTER a failure, with final net diff from live main and no refusal.
const incident = {event:'delivery_failed',actor:'seo_delivery_controller',detail:'Invalid provenance',at:'2026-10-13T07:00:00Z'};
const correction = {event:'delivery_push_pending',actor:'seo_worker',detail:'Verified corrective one-parent commit',at:'2026-10-13T07:10:00Z'};
const repairTask = {...task,history:[incident,correction],deliveryHandoff:{...task.deliveryHandoff,state:'pr_open'}} as SeoTaskRecord;
const mainSha='a'.repeat(40);
const net={status:'ahead',ahead_by:4,behind_by:0,merge_base_commit:{sha:mainSha},files:[{filename:'src/data/tools.json'}]};
assert.equal(verifiedCorrectiveMainNetDiff(repairTask, mainSha, net),true);
assert.equal(verifiedCorrectiveMainNetDiff({...repairTask,history:[correction,incident]},mainSha,net),false);
assert.equal(verifiedCorrectiveMainNetDiff({...repairTask,history:[incident]},mainSha,net),false);
assert.equal(verifiedCorrectiveMainNetDiff(repairTask,mainSha,{...net,behind_by:1}),false);
assert.equal(verifiedCorrectiveMainNetDiff(repairTask,mainSha,{...net,merge_base_commit:{sha:base}}),false);
assert.equal(verifiedCorrectiveMainNetDiff(repairTask,mainSha,{...net,files:[{filename:'.github/workflows/ci.yml'}]}),false);
assert.equal(verifiedCorrectiveMainNetDiff({...repairTask,history:[incident,correction,{event:'safety_write_rejected_task_cancelled',actor:'seo_worker',detail:'denied',at:'2026-10-13T08:00:00Z'}]},mainSha,net),false);
assert.equal(verifiedCorrectiveMainNetDiff({...repairTask,deliveryHandoff:{...repairTask.deliveryHandoff,validationSummary:'Action-Branch-Handoff: v1\\nwrong transport'}},mainSha,net),false);

assert.equal(preflight({ ...task, executionClaim: { ...task.executionClaim!, actor: 'seo_worker' } }), null);
assert.equal(preflight({ ...task, executionClaim: null, deliveryHandoff: { ...task.deliveryHandoff, state: 'branch_ready' } }), null);
assert.equal(preflight({ ...task, executionClaim: null, deliveryHandoff: { ...task.deliveryHandoff, state: 'pr_open' } }), null);
assert.match(preflight({ ...task, executionClaim: null, deliveryHandoff: { ...task.deliveryHandoff, state: 'push_pending' } })!, /explicitly opted-in/);
assert.match(preflight({ ...task, executionClaim: { ...task.executionClaim!, actor: 'unknown_worker' } })!, /explicitly opted-in/);
assert.match(preflight({ ...task, deliveryHandoff: { ...task.deliveryHandoff, validationSummary: 'ordinary Groq branch push' } })!, /explicitly opted-in/);
assert.match(preflight(task,'0')!, /not been enabled/);
assert.match(preflight(task,'1','')!, /cutoff/);
assert.match(preflight({ ...task, createdAt: '2026-10-13T05:59:59.999Z' })!, /predates/);
assert.match(preflight({ ...task, repo: 'nomuonji/another-site' })!, /repository/);
assert.match(preflight(task,'1',rollout,[])!, /registry/);
assert.match(preflight({ ...task, deliveryHandoff: { ...task.deliveryHandoff, branch: 'seo/another-task' } })!, /task-bound/);
assert.match(preflight({ ...task, deliveryHandoff: { ...task.deliveryHandoff, branch: 'seo/..\\/main' } })!, /task-bound/);
assert.match(preflight({ ...task, deliveryHandoff: { ...task.deliveryHandoff, baseSha: 'c'.repeat(40) } })!, /SHA/);
assert.match(preflight({ ...task, deliveryHandoff: { ...task.deliveryHandoff, lastError: 'permission denied' } })!, /unresolved error/);
assert.match(preflight({ ...task, history: [{event:'safety_rejected',detail:'GitHub ref update blocked'}] as SeoTaskRecord['history'] })!, /refusal/);

// A free-form incident explanation (including a negated denial) must not
// become a safety authorization signal.
for (const detail of [
  'No safety refusal; capability gap only.',
  'No permission denied: Git-object tools unavailable.',
  'Check whether authorization was rejected; nothing was attempted.'
]) {
  assert.equal(preflight({
    ...task,
    history: [{event:'preflight_git_objects_unavailable',actor:'grok_seo_worker',detail,at:'2026-10-15T00:00:00Z'}]
  }), null);
}
// Only explicit typed denial events (not incidental words in "detail") block
// ordinary new Tasks, including the historic cancelled-task event identifier.
for (const event of ['safety_rejected','safety_write_rejected_task_cancelled','authorization_denied','permission_refused','tool_safety_write_blocked']) {
  assert.match(preflight({
    ...task,
    history: [{event,actor:'seo_worker',detail:'Explicit denial',at:'2026-10-15T00:00:00Z'}]
  })!, /refusal/);
}
// The two historical incidents were migrated to a typed, durable event in
// Sites Operator and cancelled. No hidden ID-only release/deny list remains.
for (const id of [
  'seo-book-night-circus-canonical-slug-20261015',
  'seo-book-swanns-way-seven-parts-editions-20261015'
]) {
  const historical = { ...task, id, deliveryHandoff: { ...task.deliveryHandoff, branch: `seo/${id}` } } as SeoTaskRecord;
  assert.equal(preflight(historical), null); // ID alone is never a policy decision.
  assert.match(preflight({
    ...historical,
    history: [{event:'safety_write_rejected_task_cancelled',actor:'seo_delivery_incident_migration',detail:'2026-10-15 seo_task_update refused; exact code unknown',at:'2026-10-16T00:04:00Z'}]
  })!, /independent review/);
}

const branchTask = {
  ...task,
  executionClaim: { ...task.executionClaim!, actor: 'seo_worker' },
  deliveryHandoff: { ...task.deliveryHandoff, validationSummary: BRANCH_HANDOFF_MARKER + 'Checked current main, one-parent commit, tree and source.' },
  history: [{ event: 'delivery_branch_push_pending', actor: 'seo_worker', at: '2026-10-15T00:00:00Z', detail: 'read back branch head, parent and changed source' }]
} as SeoTaskRecord;
const branchCheck = (t: SeoTaskRecord = branchTask) => verifiedBranchHandoffPreflight(t, sites, '1', rollout);
assert.equal(branchCheck(), null);
const chatgptBranchTask = {
  ...branchTask,
  executionClaim: {...branchTask.executionClaim!, actor: 'chatgpt_seo_worker'},
  history: [{...branchTask.history[0], actor: 'chatgpt_seo_worker'}]
} as SeoTaskRecord;
assert.equal(branchCheck(chatgptBranchTask), null);
assert.match(branchCheck({...branchTask, executionClaim: {...branchTask.executionClaim!, actor: 'chatgpt_seo_worker'}})!, /matching/);
assert.match(branchCheck({...chatgptBranchTask, history: branchTask.history})!, /matching/);
assert.match(branchCheck({...branchTask, executionClaim: {...branchTask.executionClaim!, actor: 'unknown_worker'}})!, /authorized/);
assert.match(branchCheck({...branchTask, history: []})!, /structured/);
assert.match(branchCheck({...branchTask, status: 'cancelled'})!, /Checkpoint/);
assert.match(branchCheck({...branchTask, deliveryHandoff: {...branchTask.deliveryHandoff, branch: 'seo/other-task'}})!, /task-bound/);
assert.match(branchCheck({...branchTask, deliveryHandoff: {...branchTask.deliveryHandoff, lastError: 'permission denied'}})!, /unresolved/);
assert.match(branchCheck({...branchTask, history: [...branchTask.history, { event: 'authorization_denied', actor: 'seo_worker', at: '2026-10-15T00:00:01Z', detail: 'do not replay' }]})!, /refusal/);
for (const id of ['seo-book-night-circus-canonical-slug-20261015','seo-book-swanns-way-seven-parts-editions-20261015']) {
  const historical = {...branchTask, id, deliveryHandoff: {...branchTask.deliveryHandoff, branch: `seo/${id}`}};
  assert.equal(branchCheck(historical), null);
  assert.match(branchCheck({...historical, history: [...historical.history, {
    event: 'safety_write_rejected_task_cancelled', actor: 'seo_delivery_incident_migration',
    detail: 'Reported tool-level refusal, scope recorded for independent review', at: '2026-10-16T00:04:00Z'
  }]})!, /independent review/);
}

assert.equal(branchCheck({...branchTask, executionClaim: null, deliveryHandoff: {...branchTask.deliveryHandoff, state: 'branch_ready'}}), null);
assert.equal(branchCheck({...branchTask, executionClaim: null, deliveryHandoff: {...branchTask.deliveryHandoff, state: 'pr_open'}}), null);
console.log('Worker-independent branch fallback gate passed: exact marker, claim/receipt match, refusal quarantine and branch binding');

// Capability, not model, decides transport. Select only BEFORE claim.
const transport = (overrides: Partial<Parameters<typeof selectSeoGitTransport>[0]> = {}) =>
  selectSeoGitTransport({
    preparedWriters: true,
    branchWriters: true,
    commitTreeSourceReadback: true,
    branchRefAndDiffReadback: true,
    hasSafetyOrAuthorizationRefusal: false,
    ...overrides
  });
assert.equal(transport(), 'prepared');
assert.equal(transport({preparedWriters:false}), 'verified_branch');
assert.equal(transport({preparedWriters:false,branchWriters:false}), null);
assert.equal(transport({preparedWriters:false,branchRefAndDiffReadback:false}), null);
assert.equal(transport({preparedWriters:false,commitTreeSourceReadback:false}), null);
assert.equal(transport({hasSafetyOrAuthorizationRefusal:true}), null);
assert.equal(transport({preparedWriters:false,hasSafetyOrAuthorizationRefusal:true}), null);
console.log('Capability-only transport selection passed: A preferred, B for missing writers, no denial fallback');

assert.equal(preparedRefHandoffScopeError(['src/content/article.md','src/pages/index.astro']), null);
for (const unsafe of ['.github/workflows/ci.yml','docs/sites-operator-worker-manual.md','src/../main.ts','src/.env','src/secret/key','package.json','/root.md','src//other.md','src\\\\other.md']) {
  assert.ok(preparedRefHandoffScopeError([unsafe]), `Unsafe change must be refused: ${unsafe}`);
}
assert.match(preparedRefHandoffScopeError([])!, /no files/);
assert.match(preparedRefHandoffScopeError(['a.md','a.md'])!, /duplicate/);
console.log('Shared prepared-ref gate passed: cutover, durable refusal events, site/task/branch binding, safe corrective fast-forward, restricted paths');

// Satellite GitHub Actions are not a delivery dependency. All PR delivery
// is driven by the public keywords controller; the target hosting platform
// builds on default-branch push and separate publication verification follows.
const controller = readFileSync(new URL('./seo-delivery-controller.ts', import.meta.url), 'utf8');
const gateSource = readFileSync(new URL('./seo-prepared-ref-handoff-gate.ts', import.meta.url), 'utf8');
const deliveryWorkflow = readFileSync(new URL('../.github/workflows/seo-delivery-controller.yml', import.meta.url), 'utf8');
for (const sourcePath of ['scripts/seo-delivery-controller.ts', 'scripts/seo-prepared-ref-handoff-gate.ts', 'packages/commands/src/seo-delivery-merge.ts']) {
  assert.ok(deliveryWorkflow.includes(`      - '${sourcePath}'`), `Central delivery must run on production changes to ${sourcePath}`);
}

assert.doesNotMatch(gateSource, /HISTORICALLY_REFUSED_TASK_IDS/);
assert.doesNotMatch(controller, /checkSummary\s*\(|passedPullRequestActions|NO_CHECK_GRACE_MS/);
assert.doesNotMatch(controller, /api\(repo, `\/actions\/runs/);
assert.match(controller, /freshPr\.mergeable !== true/);
assert.match(controller, /currentMainSha !==|handoff\.baseSha !== currentMainSha/);
assert.match(controller, /currentTask\.deliveryHandoff\.headSha !== handoff\.headSha/);
assert.match(controller, /mergePull\(task, pr\.number, handoff\.headSha/);
assert.match(controller, /verifyWorkerBranch\(task, actualBranchSha\)/);
assert.match(controller, /verifiedBranchHandoffPreflight\(/);
assert.doesNotMatch(controller, /task\.executionClaim\?\.actor === 'chatgpt_seo_worker'/);
assert.match(controller, /compare\.ahead_by !== 1/);
assert.match(controller, /preparedRefHandoffScopeError\(compare\.files\.map/);
console.log('Central-only SEO delivery passed: no satellite Actions, exact PR SHA/main checks and GitHub mergeability retained.');

const botBase = 'a'.repeat(40);
const drift = (files: string[], overrides: Record<string, unknown> = {}) => ({
  status: 'ahead', ahead_by: 1, behind_by: 0,
  merge_base_commit: { sha: botBase },
  files: files.map(filename => ({ filename })), ...overrides
});
assert.equal(verifiedBranchMainDriftIsNonInterfering(botBase, drift(['sns-bot/certifications_state.json']), ['docs/qualifications.md']), true);
assert.equal(verifiedBranchMainDriftIsNonInterfering(botBase, drift(['sns-bot/certifications_state.json']), ['sns-bot/certifications_state.json']), false);
for (const forbidden of ['src/pages/index.astro', 'package.json', '.github/workflows/ci.yml', 'sns-bot/certifications_state.json.bak']) {
  assert.equal(verifiedBranchMainDriftIsNonInterfering(botBase, drift([forbidden]), ['docs/qualifications.md']), false);
}
assert.equal(verifiedBranchMainDriftIsNonInterfering(botBase, drift(['sns-bot/certifications_state.json'], { merge_base_commit: { sha: 'wrong' } }), ['docs/qualifications.md']), false);
assert.equal(verifiedBranchMainDriftIsNonInterfering(botBase, drift(['sns-bot/certifications_state.json'], { behind_by: 1 }), ['docs/qualifications.md']), false);
assert.equal(verifiedBranchMainDriftIsNonInterfering(botBase, drift(['sns-bot/certifications_state.json'], { ahead_by: 11 }), ['docs/qualifications.md']), false);
assert.match(controller, /compatibleFallbackMainDrift/);
assert.match(controller, /freshPr\.mergeable !== true/);
console.log('Stale-main branch fallback proof passed: disjoint, bounded bot-state change only; denial quarantine unchanged.');

// Throughput regression: transient outages must not permanently poison a
// write-ahead checkpoint. Unknown/authz/safety denials remain terminal.
for (const msg of ['GitHub 500 Internal Server Error', 'GitHub 429 Too Many Requests', 'fetch failed', 'getaddrinfo EAI_AGAIN github.com', 'GitHub 403 rate limit exceeded']) {
  assert.equal(transientDeliveryError(msg), true, msg);
}
for (const msg of ['GitHub 403 Resource not accessible by integration', 'GitHub 401 Bad credentials', 'OpenAI safety checks refused write', 'GitHub 422 Invalid ref']) {
  assert.equal(transientDeliveryError(msg), false, msg);
}
assert.equal(retryMergeability(null, 0), true);
assert.equal(retryMergeability(undefined, 2), true);
assert.equal(retryMergeability(null, 3), false);
assert.equal(retryMergeability(false, 0), false);
assert.equal(retryMergeability(true, 0), false);
assert.equal(cleanupSweepLimit(undefined), 0);
assert.equal(cleanupSweepLimit('0'), 0);
assert.equal(cleanupSweepLimit('5'), 5);
assert.equal(cleanupSweepLimit('99'), 10);
assert.equal(cleanupSweepLimit('NaN'), 0);
assert.match(controller, /retryMergeability\(freshPr\.mergeable, attempt\)/);
assert.match(controller, /delivery_controller_transient/);
assert.match(controller, /if \(cleanupLimit > 0\)/);
console.log('SEO throughput regression passed: bounded PR mergeability retry, no transient checkpoint latch, opt-in branch cleanup');

assert.equal(firestoreRateLimited(new Error('Firestore request failed (429)')), true);
assert.equal(firestoreRateLimited({ status: 429 }), true);
assert.equal(firestoreRateLimited(new Error('GitHub 429 Too Many Requests')), false);
assert.equal(firestoreRateLimited({ status: 403 }), false);
assert.equal(controller.split("seoTaskList({ status: 'in_progress', limit: 100 })").length - 1, 1,
  'Only one global in_progress Task query is allowed per delivery cycle');
assert.match(controller, /const candidates: SeoTaskRecord\[\] = \[\]/);
assert.match(controller, /const current = await seoTaskGet\(\{ id: task\.id \}\)/);
assert.match(controller, /if \(firestoreRateLimited\(error\)\)/);
assert.match(controller, /Firestore quota exhausted/);
console.log('SEO Firestore quota guard passed: one active-list read, revalidation by point reads, rate-limit circuit breaker');
