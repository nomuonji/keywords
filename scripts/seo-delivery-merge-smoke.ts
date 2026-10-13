import assert from 'node:assert/strict';
import { seoDeliveryMergePayload } from '../packages/commands/src/seo-delivery-merge.js';
import { preparedRefHandoffPreflight, preparedRefHandoffScopeError, preparedHandoffHasPassedPrCi } from './seo-prepared-ref-handoff-gate.js';
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
assert.equal(preflight({ ...task, executionClaim: { ...task.executionClaim!, actor: 'seo_worker' } }), null);
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
assert.equal(preparedRefHandoffScopeError(['src/content/article.md','src/pages/index.astro']), null);
for (const unsafe of ['.github/workflows/ci.yml','docs/sites-operator-worker-manual.md','src/../main.ts','src/.env','src/secret/key','package.json','/root.md','src//other.md','src\\\\other.md']) {
  assert.ok(preparedRefHandoffScopeError([unsafe]), `Unsafe change must be refused: ${unsafe}`);
}
assert.match(preparedRefHandoffScopeError([])!, /no files/);
assert.match(preparedRefHandoffScopeError(['a.md','a.md'])!, /duplicate/);
console.log('Common prepared-ref handoff gate smoke passed: disabled-by-default, task/site/branch binding, cutoff, rejection history, path scope');

const prSuccess = {
  event:'pull_request', status:'completed', conclusion:'success',
  pull_requests:[{number:42}]
};
assert.equal(preparedHandoffHasPassedPrCi([prSuccess],42),true);
assert.equal(preparedHandoffHasPassedPrCi([prSuccess],41),false);
assert.equal(preparedHandoffHasPassedPrCi([{...prSuccess,event:'push'}],42),false);
assert.equal(preparedHandoffHasPassedPrCi([{...prSuccess,conclusion:'skipped'}],42),false);
assert.equal(preparedHandoffHasPassedPrCi([{...prSuccess,status:'in_progress'}],42),false);
assert.equal(preparedHandoffHasPassedPrCi([],42),false);
console.log('Common prepared-ref PR CI gate passed: exact PR, successful completed PR Actions run only');
