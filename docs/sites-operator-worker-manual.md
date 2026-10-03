# Sites Operator SEO Worker Manual

> Canonical execution runbook. Always call `seo_agent_context(role=executor)` first. The live versioned policy and selected Sites Operator task take precedence over this document.

## 1. Worker responsibility

The Worker owns **implementation through a verified push to a dedicated `seo/*` branch plus a structured Sites Operator `deliveryHandoff.state=branch_ready` handoff**.

The Worker does **not** create/update pull requests or merge to the repository default branch. Those mutations belong to an external GitHub delivery lane. The Worker also does not own the hosting platform, production deployment, cache propagation, or unrelated pre-existing build/deployment failures. A later delivery/reconciliation step records completion only after the exact change is observed on the default branch.

| Responsibility | Worker |
| --- | --- |
| Select/claim a real `ready` task | yes |
| Verify current repository state and task scope | yes |
| Implement the requested bounded change | yes |
| Validate the change with available targeted/build/CI evidence | yes |
| Push/update dedicated `seo/*` implementation branch | **yes** |
| Persist structured `deliveryHandoff=branch_ready` and release execution claim | **yes** |
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

1. Call `seo_agent_context(role=executor)`.
2. List `in_progress` work before new `ready` work. Read both `executionClaim` and `deliveryHandoff`.
   - `deliveryHandoff.state = branch_ready | pr_open`: external delivery is active; do **not** reclaim merely to create/merge a PR.
   - `deliveryHandoff.state = ci_failed`: reclaim for a corrective Worker pass, inspect the failed CI evidence, fix the same implementation branch, and publish a fresh `branch_ready` handoff.
   - otherwise, `executionClaim = null` or expired: legacy/stale implementation work is reclaimable when still valid.
   - unexpired claim: another execution may still be active; do not seize it.
3. For reclaimable work, inspect the current GitHub default branch, implementation branch, Task history/handoff and acceptance scope. Continue from the furthest verified artifact instead of starting over.
4. If no valid stale work should be resumed, select a `ready` task (or eligible legacy `issued` task) and perform the same current-state checks.
5. Enter execution with `seo_task_claim(id, expectedRevision)`. The response contains an ephemeral `executionClaim.runId`; keep it only for this run.
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

### Direction-linked implementation

A Task may carry `directionId` when it materially implements a human-decided site strategy.

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

## 5. Branch push and centralized delivery handoff

A verified implementation branch plus a structured handoff is the successful Worker result.

1. Use a dedicated `seo/*` branch for the Task. Reuse the existing Task branch when resuming; do not create duplicate branches for the same intervention.
2. Self-review the complete diff against the Task acceptance criteria.
3. Run available targeted/local repository validation. Record pre-existing unrelated failures accurately.
4. Push or update the `seo/*` branch and read back its HEAD SHA.
5. **Do not call GitHub PR creation/update, auto-merge, or merge mutations from the Worker.**
6. Immediately call `seo_task_update` with the active `claimRunId` and the complete structured handoff:
   - `state: "branch_ready"`;
   - `branch`;
   - `headSha`;
   - `baseSha` (default-branch SHA used as implementation base);
   - `validationSummary`;
   - `handedOffAt`;
   - `prNumber: null`, `prUrl: null`, `lastError: ""`;
   - `updatedAt`.
7. Append `delivery_handoff_ready` history and keep the Task `in_progress`.
8. Read the Task back and verify `deliveryHandoff.state=branch_ready`, the exact branch/head SHA, and `executionClaim=null`. Writing `branch_ready` intentionally releases the Worker lease.

Example:

```json
{
  "id": "<task-id>",
  "expectedRevision": 7,
  "claimRunId": "<executionClaim.runId>",
  "deliveryHandoff": {
    "state": "branch_ready",
    "branch": "seo/example-change",
    "headSha": "<branch-head-sha>",
    "baseSha": "<base-sha>",
    "validationSummary": "<actual validation result>",
    "handedOffAt": "2026-10-04T00:00:00.000Z",
    "prNumber": null,
    "prUrl": null,
    "lastError": "",
    "updatedAt": "2026-10-04T00:00:00.000Z"
  },
  "executionSummary": "Implementation pushed and handed off to centralized delivery.",
  "appendHistory": {
    "actor": "seo_worker",
    "event": "delivery_handoff_ready",
    "detail": "Structured branch handoff recorded; centralized delivery controller owns PR/CI/merge/completion."
  }
}
```

Do not set `resultCommitSha` to a feature-branch SHA.

The centralized `keywords` GitHub Action then owns:

`branch_ready -> PR creation -> pr_open -> CI gate -> main merge -> resultCommitSha -> completed`

If CI fails it records `deliveryHandoff.state=ci_failed`. A later Worker may reclaim that Task to correct the implementation, then replace the failed handoff with a fresh `branch_ready` and new head SHA.

## 6. Completion is controller-owned

A successful Worker branch handoff is **not** `completed`.

The centralized delivery controller in `nomuonji/keywords` is responsible for:

1. validating that the repository is an active Sites Operator repository;
2. verifying the recorded `seo/*` branch HEAD still matches the handoff;
3. creating or reusing the PR;
4. recording `deliveryHandoff.state=pr_open`;
5. waiting for observed PR checks/statuses to finish;
6. refusing merge on pending/failing CI;
7. merging when checks pass and repository rules permit;
8. reading the merge result SHA;
9. setting `status=completed`, `resultCommitSha=<actual merge/default-branch SHA>`, and `deliveryHandoff.state=merged`;
10. appending `delivery_merged` history.

Therefore, a Worker must **not spend a later run solely to mark a successfully merged handoff completed**.

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
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor) and follow its latest policy/run contract and canonical Worker Manual. Treat this session as a new ephemeral run. Inspect in_progress executionClaim + deliveryHandoff first: never reclaim branch_ready/pr_open work just to create or merge a PR; reclaim ci_failed for corrective implementation, and reclaim other valid unleased/expired work as allowed. Keep executionClaim.runId for this run and use claimRunId on in-progress updates. Implement and validate one real task, push/update its dedicated seo/* branch, then persist a complete structured deliveryHandoff.state=branch_ready with branch, headSha, baseSha, validationSummary, handedOffAt and null PR fields. Append delivery_handoff_ready and read back the record; branch_ready must release executionClaim. Do not create/update PRs or merge to main. Leave the Task in_progress: centralized Keywords GitHub Actions owns PR, CI, merge, resultCommitSha and completed. Production verification remains separate.
```
