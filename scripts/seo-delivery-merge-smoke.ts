import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seoDeliveryMergePayload } from '../packages/commands/src/seo-delivery-merge.js';
import { preparedHandoffRequired, preparedRefBaseError, preparedRefHandoffPreflight, preparedRefHandoffScopeError, verifiedBranchHandoffPreflight, BRANCH_HANDOFF_MARKER, selectSeoGitTransport } from './seo-prepared-ref-handoff-gate.js';
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
// Two known prior tool-level safety refusals were not persisted in Task history.
// Fixing a text false positive must never release their prepared commits.
for (const id of [
  'seo-book-night-circus-canonical-slug-20261015',
  'seo-book-swanns-way-seven-parts-editions-20261015'
]) {
  assert.match(preflight({
    ...task, id,
    deliveryHandoff: {...task.deliveryHandoff, branch: `seo/${id}`},
    history: [{event:'preflight_git_objects_unavailable',actor:'grok_seo_worker',detail:'No safety refusal; capability gap only.',at:'2026-10-15T00:00:00Z'}]
  })!, /refusal/);
}

// Any authorized SEO Worker may use the same verified fallback on a NEW unrefused Task.
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
  assert.match(branchCheck({...branchTask, id, deliveryHandoff: {...branchTask.deliveryHandoff, branch: `seo/${id}`}})!, /refusal/);
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
console.log('Shared prepared-ref gate passed: cutover, historic refusal, site/task/branch binding, safe corrective fast-forward, restricted paths');

// Satellite GitHub Actions are not a delivery dependency. All PR delivery
// is driven by the public keywords controller; the target hosting platform
// builds on default-branch push and separate publication verification follows.
const controller = readFileSync(new URL('./seo-delivery-controller.ts', import.meta.url), 'utf8');
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
