# Sites Operator SEO Worker Manual

> Canonical execution runbook. Always call `seo_agent_context(role=executor)` first. The live versioned policy and selected Sites Operator task take precedence over this document.

## 1. Worker responsibility

The Worker owns **implementation through a crash-recoverable `seo/*` push sequence: `push_pending` before remote push, then verified `branch_ready` after remote HEAD readback**.

The Worker does **not** create/update pull requests or merge to the repository default branch. Those mutations belong to an external GitHub delivery lane. The Worker also does not own the hosting platform, production deployment, cache propagation, or unrelated pre-existing build/deployment failures. A later delivery/reconciliation step records completion only after the exact change is observed on the default branch.

| Responsibility | Worker |
| --- | --- |
| Select/claim a real `ready` task | yes |
| Verify current repository state and task scope | yes |
| Implement the requested bounded change | yes |
| Validate the change with available targeted/build/CI evidence | yes |
| Create local `seo/*` commit and persist `deliveryHandoff=push_pending` before remote push | **yes** |
| Push/update dedicated `seo/*` implementation branch | **yes** |
| Verify remote HEAD, persist `deliveryHandoff=branch_ready`, release execution claim | **yes** |
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
   - `deliveryHandoff.state = push_pending`: inspect the recorded branch/head SHA first. If the remote `seo/*` branch already exists at that exact SHA, promote to `branch_ready` rather than reimplementing; the central delivery controller can perform the same exact-HEAD reconciliation. If the remote branch is absent or still at an older SHA, the active Worker may still be pushing; after the short lease expires, reclaim only if needed.
   - `deliveryHandoff.state = branch_ready | pr_open`: external delivery is active; do **not** reclaim merely to create/merge a PR.
   - `deliveryHandoff.state = ci_failed`: reclaim for a corrective Worker pass, inspect the failed CI evidence, fix the same implementation branch, and repeat the `push_pending -> branch_ready` sequence.
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

For registered articles, inspect `optimization_context`, reuse the linked event, or create a `proposed` event containing the Task ID, hypothesis, planned baseline dates, metric limitations and rollback. Put the event ID and before/after commit evidence in Task history/summary. Leave it proposed until actual production publication is observed. Tracking problems must be reported, but do not silently turn a valid implementation into an audit-only result. The Planner handles due outcome reviews; the Worker finishes its run after verified `seo/*` branch push and durable delivery handoff, while the Task remains `in_progress` until external default-branch delivery is later observed.

### Pre-existing unrelated failures

A failing validation step is not automatically caused by the Worker.

When a targeted/local/repository check fails:

1. identify the failing file/stage and compare it with the Task diff;
2. check whether the same failure is reproducible or already present on the default-branch baseline when evidence is available;
3. if the failure is caused by this Task, fix it before the branch handoff;
4. if it is clearly pre-existing and unrelated, record the exact failure in the delivery checkpoint without expanding the SEO Task into unrelated repair work.

The Worker does not create or mutate PRs to obtain preview checks. PR/merge CI, preview deployment checks, and merge-gate handling belong to the external delivery lane. A later reconciler may inspect their evidence when deciding whether the exact implementation reached the default branch.

## 5. Crash-recoverable branch push and centralized delivery handoff

A verified implementation branch plus a structured handoff is the successful Worker result. The push itself is protected by a write-ahead checkpoint.

1. Use a dedicated `seo/*` branch for the Task. Reuse the existing Task branch when resuming.
2. Self-review the complete diff against the Task acceptance criteria.
3. Run available targeted/local repository validation.
4. Create the local commit **before** pushing. Every Worker-created commit on an `seo/*` branch must start its subject with `[CF-Pages-Skip]`.
5. Read the exact local commit SHA that will become the remote branch HEAD.
6. **Before remote push**, call `seo_task_update` with the active `claimRunId` and persist:
   - `state: "push_pending"`;
   - `branch`;
   - `headSha` = exact local commit SHA about to be pushed;
   - `baseSha`;
   - `validationSummary`;
   - `handedOffAt: null`;
   - null PR fields and empty `lastError`;
   - append `delivery_push_pending`.
7. Read the Task back and verify `status=in_progress`, `deliveryHandoff.state=push_pending`, the exact expected SHA, and that the execution claim still exists. The push-pending lease is shortened to 15 minutes.
8. Push/update the remote `seo/*` branch.
9. Read the remote branch HEAD from GitHub.
   - If it does not exactly equal the recorded `headSha`, do **not** publish `branch_ready`.
   - If it exactly matches, update the same handoff to `state: "branch_ready"`, set `handedOffAt`, append `delivery_handoff_ready`, and keep Task `status=in_progress`.
10. Read the Task back and verify `branch_ready` plus `executionClaim=null`. Writing `branch_ready` intentionally releases the Worker lease.
11. **Do not call GitHub PR creation/update, auto-merge, or merge mutations from the Worker.**

If the Worker dies after step 8 but before step 9/10, the central delivery controller checks the remote branch. It may promote `push_pending -> branch_ready` **only when the remote HEAD exactly equals the pre-push `headSha`**. Therefore a successful push is not lost merely because the Worker session ends before the post-push write.

Example pre-push checkpoint:

```json
{
  "id": "<task-id>",
  "expectedRevision": 7,
  "claimRunId": "<executionClaim.runId>",
  "deliveryHandoff": {
    "state": "push_pending",
    "branch": "seo/example-change",
    "headSha": "<exact-local-commit-sha>",
    "baseSha": "<base-sha>",
    "validationSummary": "<actual validation result>",
    "handedOffAt": null,
    "prNumber": null,
    "prUrl": null,
    "lastError": "",
    "updatedAt": "2026-10-04T00:00:00.000Z"
  },
  "appendHistory": {
    "actor": "seo_worker",
    "event": "delivery_push_pending",
    "detail": "Write-ahead checkpoint persisted before remote push."
  }
}
```

After exact remote HEAD verification, publish `branch_ready`. Do not set `resultCommitSha` to a feature-branch SHA.

The centralized `keywords` GitHub Action owns:

`push_pending reconciliation -> branch_ready -> PR creation -> pr_open -> repository CI gate -> main merge -> resultCommitSha -> completed -> seo/* branch deletion`

Hosting preview checks are not merge gates. Genuine implementation/repository-CI failures use `ci_failed`, while Task status remains `in_progress`.

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

If `deliveryHandoff.state=ci_failed`, the Worker may reclaim the Task because corrective implementation work is again required. After fixing and pushing the same dedicated branch, publish a fresh `branch_ready` handoff.

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
- final Worker-side Sites Operator status/revision (normally `in_progress + branch_ready`);
- deploymentVerification status separately;
- any unrelated build/deploy problem as a separate note.

A good final line is:

> Implementation pushed to `seo/*`; `deliveryHandoff=branch_ready` recorded and Worker claim released. Central delivery owns PR/CI/merge/completion.

Do not say “completed” merely because the implementation branch was pushed. Only say “completed” after the exact change is observed on the repository default branch. Do not say “production verified” without an actual production check.

### Minimal bootstrap

```text
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor) and follow its latest policy/run contract and canonical Worker Manual. Treat this session as a new ephemeral run. Inspect in_progress executionClaim + deliveryHandoff first. For push_pending, compare the recorded expected headSha with the remote seo/* branch before doing new implementation; exact remote match can be promoted to branch_ready. Never reclaim branch_ready/pr_open just to create or merge a PR; reclaim ci_failed only for genuine implementation/repository-CI correction. Implement and validate one real task, create a local seo/* commit whose subject begins [CF-Pages-Skip], then BEFORE remote push persist deliveryHandoff.state=push_pending with branch, exact local headSha, baseSha and validationSummary. Read it back, push, read the remote branch HEAD, and only on exact SHA match persist branch_ready with handedOffAt; branch_ready releases executionClaim. Do not create/update PRs or merge to main. Task status stays in_progress through push_pending/branch_ready/pr_open; centralized Keywords GitHub Actions owns PR, repository CI, merge, resultCommitSha, completed, and merged branch deletion.
```
