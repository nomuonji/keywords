# Sites Operator SEO Worker Manual

> Canonical execution runbook. Always call `seo_agent_context(role=executor)` first. The live versioned policy and selected Sites Operator task take precedence over this document.

## Editorial recovery acceptance contract (2026-10-13)

When a selected existing-page recovery or new editorial Task includes an `indexation_content_quality` audit:

- Read the Manager's **specific** existing-body deficit, user question, observed competitor/source evidence, known technical/indexation state and full acceptance criteria; check current HEAD to avoid redoing a completed change.
- Rewrite the **same canonical page** into content that actually answers the missing question. Verify material claims using the given primary/official sources, make comparisons and decision aids usable, and preserve site-specific editorial tone. Adding words, headings or keywords alone does not constitute an improvement.
- Re-read the **changed output** after implementation, not just the patch. Verify each article-specific acceptance item and the ordinary canonical, metadata, links and build checks. If an acceptance item is unmet, revise within this Task (usually at most two bounded editorial passes), or state the exact evidence/implementation blocker rather than pretending it passed.
- A Google Search result is not required before handoff: there is no way to guarantee that Google will index the update. Do not call Google URL Inspection or create another scheduler. Persist branch/validation handoff as before; publication outcome and next recrawl observation belong to the Manager's post-release loop.
- For technical-only tasks (e.g. robots/noindex/404), repair the verified technical defect rather than inventing an editorial rewrite. If competitor body retrieval is unavailable, do not fabricate it.

This adds **a quality acceptance obligation**, not a new Worker policy-planning role, another Task database or a change to the centralized `seo/*` delivery contract.

## 1. Worker responsibility

The Worker implements and validates one real Task, then creates a **verified unreferenced GitHub commit** and records `deliveryHandoff=push_pending`. For all new Tasks (both ChatGPT and Groq), the central GitHub Action alone attaches the commit to a `seo/*` branch and promotes `branch_ready`. Previously in-flight direct-push deliveries may drain; do not replay earlier rejected changes.

The Worker does **not** create/update pull requests or merge to the repository default branch. Those mutations belong to an external GitHub delivery lane. The Worker also does not own the hosting platform, production deployment, cache propagation, or unrelated pre-existing build/deployment failures. A later delivery/reconciliation step records completion only after the exact change is observed on the default branch.

| Responsibility | Worker |
| --- | --- |
| Select/claim a real `ready` task | yes |
| Verify current repository state and task scope | yes |
| Implement the requested bounded change | yes |
| Validate the change with available targeted/build/CI evidence | yes |
| Create verified unreferenced GitHub commit (blob/tree/commit) and persist task-bound `push_pending` | **yes** |
| Create/update remote `seo/*` branch reference or push | **no** — central Action |
| Verify remote HEAD and persist `branch_ready`, release execution claim | **no** — central Action |
| Create/update PR | **no** — centralized delivery controller |
| Gate on PR CI and merge to main | **no** — centralized delivery controller |
| Record actual main result SHA / set `completed` | **no** — centralized delivery controller after merge |
| Verify production/public URL | optional |
| Repair unrelated hosting/deployment/platform defects | **no** |

No GitHub Issue is required.

## 2. Two independent states

### Implementation status

- `ready`: validated work waiting for an executor.
- `in_progress`: claimed and being implemented.
- `completed`: **the requested implementation is verified on main** and `resultCommitSha` is recorded.
- `superseded` / `cancelled`: no implementation should continue.
- Legacy `proposed` / `issued` remain readable for compatibility.

`completed` does **not** mean “production verified.”

### Deployment verification

Every task also has:

`deploymentVerification.status = pending | verified | failed | not_required`

- `pending`: production has not been positively checked yet. This remains normal after the Worker hands off an implementation branch and after a later default-branch merge until production is positively observed.
- `verified`: someone checked the production URL and confirmed the intended result. Record `checkedAt`; record `deployedCommitSha` when it is available.
- `failed`: an actual production/deployment check found a failure or stale/unpublished result. Record a concise diagnostic in `detail`.
- `not_required`: the task has no public deployment requirement.

A completed task may therefore be `completed + pending` or `completed + failed`. That is intentional.

## 3. Start and claim

A Worker execution is an **ephemeral run**, not a durable identity. A later scheduled session is not "the same Worker" and does not need an explicit handoff from a prior session.

1. Call `seo_agent_context(role=executor)` and read the minimal `executionGate` (the macro investment policy is deliberately excluded). The current Macro Policy is enforced by `seo_task_claim`; do not infer a freeze or new investment permission from an old hard-coded incident category. Claim only a real assigned task. The Worker does not allocate portfolio resources. A task already in `in_progress` (including a valid same-run claim refresh or lease-safe reclaim) and a task in `push_pending` / `branch_ready` / `pr_open` continue through their existing execution and delivery paths; this is not a hard emergency stop.
2. List `in_progress` work before new `ready` work. Read both `executionClaim` and `deliveryHandoff`.
   - `deliveryHandoff.state = push_pending`: for post-cutover prepared handoffs, the central Action owns the commit/ref reconciliation, even if the branch is already visible. Do not reclaim or promote it merely because the remote ref is absent or awaiting the next Actions run. For a legacy pre-cutover direct-push checkpoint, use the prior exact-HEAD recovery contract without replaying rejected changes.
   - `deliveryHandoff.state = branch_ready | pr_open`: external delivery is active; do **not** reclaim merely to create/merge a PR.
   - `deliveryHandoff.state = ci_failed`: reclaim only for real implementation/CI correction. For a prepared-ref Task, create one corrective Git commit whose sole parent is the **current exact task branch HEAD**, then save a fresh `push_pending` checkpoint for the Action; do not force-update the branch.
   - otherwise, `executionClaim = null` or expired: legacy/stale implementation work is reclaimable when still valid.
   - unexpired claim: another execution may still be active; do not seize it.
3. For reclaimable work, inspect the current GitHub default branch, implementation branch, Task history/handoff and acceptance scope. Continue from the furthest verified artifact instead of starting over.
4. If no valid stale work should be resumed, inspect candidate `ready` tasks before claiming. For an article-linked Task, read `optimization_context` first. If `changeAllowed=false` because an implemented experiment is still in cooldown/evaluation, skip that Task without claiming it and select another executable ready Task; report the known cooldown so Planner can defer it out of ready inventory.
5. Enter execution with `seo_task_claim(id, expectedRevision)` only after the selected Task is currently executable. The response contains an ephemeral `executionClaim.runId`; keep it only for this run.
6. Pass that value as `claimRunId` on every `seo_task_update` while the task remains `in_progress`. Long-running phases should call `seo_task_heartbeat` before the lease can expire. Successful in-progress updates also refresh the lease.
7. Completion/cancellation/supersession clears the claim automatically.

The claim exists only to prevent overlapping executions. It must never be interpreted as a person, account or persistent agent identity. Revision conflicts require a fresh read and reconciliation; never blindly retry.

## 4. Implement and validate

Implement only the documented scope. Preserve URL/canonical/internal-link/redirect requirements unless the task explicitly changes them. Verify factual claims against the sources required by the task.

Validate the **change itself** using the repository's available mechanisms:

- targeted tests/typechecks/builds where available;
- configured GitHub checks/CI;
- diff review against acceptance criteria;
- generated route/content checks when relevant.

Never claim a check ran when it did not.

### Task size, completeness and quality

A larger Task is not permission to implement superficially. The Worker owns the **whole documented outcome**.

- Read every target artifact and acceptance criterion before editing. Do not quietly complete only the easiest part of a bundled Task.
- For a substantial article revision, validate the full page-level outcome: factual/source integrity, search-job answer, internal links, metadata/canonical/indexability where relevant, and repository build/checks.
- For a bundled `data_expansion`, verify every included record against the required authoritative source pattern and preserve unknowns individually. Do not validate one representative record and assume the rest are correct.
- For hub/site-expansion work, verify the actual decision flow as well as underlying data, routes, accessibility/no-JS behavior when relevant, canonical/indexability and build output.
- For technical/schema work, validate the repository invariant across the files and representative generated outputs named by the Task.
- Self-review the complete diff for omissions, accidental scope creep and inconsistent treatment across bundled artifacts before `push_pending`.

Do not reduce quality to fit the execution window. If the selected Task is materially broader than its evidence/acceptance criteria allow, or cannot be completed and validated as one coherent branch, do not publish a partial `branch_ready` handoff and do not invent completion evidence. Record the exact scope defect/blocker so Planner can re-scope or split it. Conversely, do not split a coherent Task merely because it touches several files or records.

### Direction-linked implementation

A Task may carry `directionId` when it materially implements a human-decided site strategy. It may also expose `policyRevisionAtCreation` / `allocationBucket` as historical provenance; neither authorizes changing the Manager's investment decision.

Before changing code/content for such a Task:

1. read the exact Site Direction record;
2. confirm it belongs to the Task's `siteId`;
3. confirm status is `decided`;
4. treat `decision` and `constraints` as implementation boundaries;
5. record the direction ID in Task history/summary when delivering the change.

If the direction is open, monitor, rejected or superseded, do not infer authorization from the Task text alone. Stop the strategic implementation and report the mismatch so Planner/human can reconcile the records.

A decided Direction record is immutable. A later strategic change should be a new record, with the old one marked superseded, preserving why earlier Tasks were issued.

### Expansion task delivery

Expansion tasks are implementation work, not research-only assignments.

- `site_expansion`: implement the exact bounded utility/page family/product-facing addition in the Task. Keep scope narrow; do not turn it into a broad redesign or generic article unless the Task explicitly requires an editorial page.
- `data_expansion`: update canonical structured data only after verifying the required authoritative sources. Preserve source URLs, checked dates, unknown values and candidate/public separation defined by the repository. Run the repository's data validation and freshness checks. Discovery or a candidate-list edit alone is not completion when the Task requires public promotion.
- `schema_expansion`: update types/schema, validators, templates and generated outputs needed by the documented need. Preserve existing records and routes where practical, prevent unbounded/thin generated permutations, and verify representative generated pages plus repository build/validation.

Always read the registry `siteShape` and repository-specific operating contract when present. Site shape guides implementation but does not override the selected Task or current code.

### Reversible experiment delivery

A well-scoped pilot does not need proof of traffic uplift before implementation. When the Task supplies a sourced user need, current artifact, bounded change, acceptance criteria and rollback, implement it even if the analytics baseline is unknown. Preserve that uncertainty in the summary.

For every article-level intervention, resolve the target by normalized canonical URL in `site_article_list/get`. If missing, verify the exact current default-branch source path, title and site/repository mapping, then register only that target with `site_article_save`; never fabricate a repoPath or publication time, and do not import the entire portfolio. Refresh the Task with `seo_task_update` and read it back: URL-based Tasks automatically attach matching registered articles. An empty article registry is not permission to skip experiment tracking. If registration is genuinely impossible, keep the implementation moving and persist the exact missing mapping plus a concrete tracking follow-up in Task history.

For registered articles, inspect `optimization_context`, reuse the linked event, or create a `proposed` event containing the Task ID, hypothesis, planned baseline dates, metric limitations and rollback. Put the event ID and before/after commit evidence in Task history/summary. Leave it proposed until actual production publication is observed. Tracking problems must be reported, but do not silently turn a valid implementation into an audit-only result. The Planner handles due outcome reviews; the Worker finishes its run after verified unreferenced Git commit creation and durable `push_pending` handoff, while the Task remains `in_progress` until external default-branch delivery is later observed.

### Pre-existing unrelated failures

A failing validation step is not automatically caused by the Worker.

When a targeted/local/repository check fails:

1. identify the failing file/stage and compare it with the Task diff;
2. check whether the same failure is reproducible or already present on the default-branch baseline when evidence is available;
3. if the failure is caused by this Task, fix it before the branch handoff;
4. if it is clearly pre-existing and unrelated, record the exact failure in the delivery checkpoint without expanding the SEO Task into unrelated repair work.

The Worker does not create or mutate PRs to obtain preview checks. PR/merge CI, preview deployment checks, and merge-gate handling belong to the external delivery lane. A later reconciler may inspect their evidence when deciding whether the exact implementation reached the default branch.

## 5. Unified prepared-commit Actions handoff (new Tasks)

Both ChatGPT and Groq use the **same** transport for Tasks created at or after the authorized rollout cutoff (2026-10-13T05:50:00.000Z). This is a task creation cutoff, **not** authorization to replay older, refused or unauthorized content. Older already-running `branch_ready`/`pr_open` deliveries may finish under the legacy contract. A Worker that cannot create and verify GitHub Git objects must **not claim a new Task**.

1. Before claiming, check the exact active site/repo, Task state/lease and GitHub default branch. Check the exact desired branch `seo/<task-id>` is absent for a new Task. Do not claim if an existing branch or PR is owned by another Task/run or any applicable write was previously denied.
2. Verify implementation scope and sources, then implement the full bounded change and perform the meaningful repository validation and diff review. The changed paths must be within the actual Task scope and the central Action's allowlist; the Action rejects sensitive configuration, workflows, secrets, lockfiles, deploy files and more than 50 changed paths.
3. Use GitHub's authorized Git object creation operations (blob/tree/commit) to create **one unreferenced commit**. Its sole parent must be the exact observed default branch HEAD. For a genuine `ci_failed` correction of an existing Task branch, use that branch's exact current HEAD as the sole parent, so its update is a non-force fast-forward; preserve existing PR/CI ownership.
4. Every prepared source commit subject starts with `[CF-Pages-Skip]`. Check the exact 40-hex commit SHA, its one parent, and the changed tree/files by reading back the GitHub objects. Do not push or create/update refs, including via `git push`, `update_ref`, or equivalent.
5. After verifying source and commit, write **one** `seo_task_update` using the active `claimRunId`, keeping `status=in_progress` and recording:
   - `deliveryHandoff.state="push_pending"`;
   - `branch="seo/<task-id>"`;
   - `headSha` = verified unreferenced commit SHA, `baseSha` = verified sole parent SHA;
   - `validationSummary` **begins exactly** with `Action-Ref-Handoff: v1\n` followed by actual checks/diff evidence;
   - `handedOffAt:null`, `prNumber:null`, `prUrl:null`, `lastError:""`, and `updatedAt` = real current ISO timestamp;
   - append `delivery_push_pending` history.
6. Read back the Sites Operator Task. Confirm exact checkpoint SHA, marker, branch, active claim and revision. **Stop the Worker run**. Neither remote branch creation nor PR creation/merge is a Worker action.
7. The central scheduled GitHub Action independently checks the active Site Registry, task creation cutoff, claim, task-bound branch, prior refusal history, Git object parent and allowable diff. It non-force fast-forwards `seo/<task-id>`, reads back the exact remote HEAD, sets `branch_ready` and releases the Worker claim, then creates/reuses PR, observes successful repository PR Actions CI, merges, writes resultCommitSha/completed, and cleans the branch. If base/main advances before an initial ref is created or a concurrent ref wins, **stop and re-evaluate**; no force push or automatic replay.
8. If Actions reports `ci_failed`, the Worker may perform a genuinely new corrective pass with fresh evidence and a new valid child commit of the existing branch HEAD. Old PRs with merge conflicts are not automatically rewritten by the Worker.

### Example of the Worker-side final checkpoint

```json
{
  "id": "<task-id>",
  "expectedRevision": 7,
  "claimRunId": "<active-executionClaim.runId>",
  "deliveryHandoff": {
    "state": "push_pending",
    "branch": "seo/<task-id>",
    "headSha": "<verified-new-unreferenced-commit-sha>",
    "baseSha": "<verified-single-parent-sha>",
    "validationSummary": "Action-Ref-Handoff: v1\\nActual validation and diff receipt",
    "handedOffAt": null,
    "prNumber": null,
    "prUrl": null,
    "lastError": "",
    "updatedAt": "<current-iso-timestamp>"
  },
  "appendHistory": {
    "actor": "chatgpt_seo_worker or seo_worker",
    "event": "delivery_push_pending",
    "detail": "Verified GitHub commit objects and wrote the prepared-ref handoff."
  }
}
```

The central Action owns:
`push_pending -> create/update seo/* ref -> verify remote HEAD -> branch_ready -> PR -> CI -> merge -> resultCommitSha -> completed -> merged branch cleanup`.

## 6. Completion is controller-owned

Neither `push_pending` nor a successful Worker `branch_ready` handoff is **`completed`**. Task status remains `in_progress` until main/default-branch merge.

The centralized delivery controller in `nomuonji/keywords` is responsible for:

1. validating that the repository is an active Sites Operator repository;
2. verifying the recorded `seo/*` branch HEAD still matches the handoff;
3. creating or reusing the PR;
4. recording `deliveryHandoff.state=pr_open`;
5. waiting for observed repository PR checks/statuses to finish;
6. refusing merge on genuine repository-CI failures while ignoring Cloudflare Pages / Vercel / Netlify hosting-preview checks;
7. merging when repository checks pass and repository rules permit;
8. reading the merge result SHA;
9. setting `status=completed`, `resultCommitSha=<actual merge/default-branch SHA>`, and `deliveryHandoff.state=merged`;
10. appending `delivery_merged` history;
11. deleting the merged `seo/*` branch.

Therefore, a Worker must **not spend a later run solely to mark a successfully merged handoff completed**. The controller changes Task status from `in_progress` to `completed` only after merge.

If `deliveryHandoff.state=ci_failed`, the Worker may reclaim the Task because corrective implementation work is again required. For a post-cutover task, create a valid child commit of the exact current task branch HEAD and publish a new `push_pending` checkpoint; the central Action handles the non-force ref update and `branch_ready`.

## 7. Optional production observation

Production checking is **optional** for the Worker.

If it is cheap and already available, the Worker may record it, but must not delay implementation completion for it.

### Verified

```json
{
  "id": "<task-id>",
  "expectedRevision": 8,
  "deploymentVerification": {
    "status": "verified",
    "checkedAt": "2026-10-01T00:00:00.000Z",
    "productionUrl": "https://example.com/target",
    "deployedCommitSha": "<sha-if-known>",
    "detail": "Live target contains the merged change."
  },
  "appendHistory": {
    "actor": "human_or_deployment_checker",
    "event": "production_verified",
    "detail": "Verified live target."
  }
}
```

### Failed / not deployed

Use `failed` when an actual check found a production problem:

```json
{
  "deploymentVerification": {
    "status": "failed",
    "productionUrl": "https://example.com/target",
    "detail": "Deployment failed because ...; implementation is still completed on main."
  }
}
```

Do not reopen the SEO implementation task solely because deployment verification failed. Hosting/deployment remediation belongs to a separate incident/task unless the SEO change itself caused the failure.

A later human can list records with `deploymentVerificationStatus=pending` or `failed`, verify them, and update only that field.

## 8. Report contract

Report:

- selected Task ID and initial state;
- whether it was newly claimed or stale/reclaimed, plus the ephemeral claim run ID;
- changed files and implementation branch;
- actual validation performed;
- branch HEAD/base SHA and structured `deliveryHandoff` state;
- validation summary and any CI failure returned by the centralized delivery lane;
- final Worker-side Sites Operator status/revision (normally `in_progress + push_pending`);
- deploymentVerification status separately;
- any unrelated build/deploy problem as a separate note.

A good final line is:

> Verified unreferenced GitHub commit created; `deliveryHandoff=push_pending` recorded and read back. Central Actions owns the ref/PR/CI/merge/completion.

Do not say “completed” merely because the prepared commit was created or a branch was updated. Only say “completed” after the exact change is observed on the repository default branch. Do not say “production verified” without an actual production check.

### Minimal bootstrap

```text
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor), then follow the exact current Task and canonical Worker Manual. Reconcile existing claims and central-delivery handoffs without competing with another Worker. Select one genuine executable Task only. Verify Git object creation capability before claiming; implement and validate; create a task-scoped unreferenced Git commit whose subject begins [CF-Pages-Skip]. Read back commit, parent, tree and changed paths. Persist Action-Ref-Handoff: v1 prepared push_pending with exact seo/<task-id> branch, commit SHA, parent SHA, checks and claimRunId. Verify the Task checkpoint and stop. Do not push/create/update refs or make PR/merge changes. Central GitHub Actions owns remote branch, PR/CI/merge and completed. No Task is a valid zero-work result.
```
