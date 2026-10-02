# Sites Operator SEO Worker Manual

> Canonical execution runbook. Always call `seo_agent_context(role=executor)` first. The live versioned policy and selected Sites Operator task take precedence over this document.

## 1. Worker responsibility

The Worker owns **implementation through verified merge to the repository default branch**.

The Worker does **not** own the hosting platform, production deployment, cache propagation, or unrelated pre-existing build/deployment failures. Production verification is recorded separately so a human or a later checker can inspect it without keeping the SEO implementation task open.

| Responsibility | Worker |
| --- | --- |
| Select/claim a real `ready` task | yes |
| Verify current repository state and task scope | yes |
| Implement the requested bounded change | yes |
| Validate the change with available targeted/build/CI evidence | yes |
| Create/update PR and satisfy required repository gates | yes |
| Merge to main when permitted | **yes** |
| Record actual main result SHA | **yes** |
| Set SEO task `completed` after verified main merge | **yes** |
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

- `pending`: production has not been positively checked yet. This is the normal state when the Worker finishes at main merge.
- `verified`: someone checked the production URL and confirmed the intended result. Record `checkedAt`; record `deployedCommitSha` when it is available.
- `failed`: an actual production/deployment check found a failure or stale/unpublished result. Record a concise diagnostic in `detail`.
- `not_required`: the task has no public deployment requirement.

A completed task may therefore be `completed + pending` or `completed + failed`. That is intentional.

## 3. Start and claim

1. Call `seo_agent_context(role=executor)`.
2. Inspect safe resumable `in_progress` work first. Resume only your own prior run or an explicit handoff after confirming no active competing executor.
3. Otherwise list `ready` tasks (and eligible legacy `issued` tasks), fetch the selected task, verify active site mapping, current default-branch HEAD, target files, relevant PRs/commits, and existing task history.
4. If the task is stale, duplicate, already delivered or contradicted, do not manufacture a change.
5. Claim with `seo_task_update` using the fresh `expectedRevision`, status `in_progress`, and a `worker_claimed` / `worker_resumed` history entry. Read it back.

Revision conflicts require a fresh read and reconciliation; never blindly retry.

## 4. Implement and validate

Implement only the documented scope. Preserve URL/canonical/internal-link/redirect requirements unless the task explicitly changes them. Verify factual claims against the sources required by the task.

Validate the **change itself** using the repository's available mechanisms:

- targeted tests/typechecks/builds where available;
- configured GitHub checks/CI;
- diff review against acceptance criteria;
- generated route/content checks when relevant.

Never claim a check ran when it did not.

### Expansion task delivery

Expansion tasks are implementation work, not research-only assignments.

- `site_expansion`: implement the exact bounded utility/page family/product-facing addition in the Task. Keep scope narrow; do not turn it into a broad redesign or generic article unless the Task explicitly requires an editorial page.
- `data_expansion`: update canonical structured data only after verifying the required authoritative sources. Preserve source URLs, checked dates, unknown values and candidate/public separation defined by the repository. Run the repository's data validation and freshness checks. Discovery or a candidate-list edit alone is not completion when the Task requires public promotion.
- `schema_expansion`: update types/schema, validators, templates and generated outputs needed by the documented need. Preserve existing records and routes where practical, prevent unbounded/thin generated permutations, and verify representative generated pages plus repository build/validation.

Always read the registry `siteShape` and repository-specific operating contract when present. Site shape guides implementation but does not override the selected Task or current code.

### Reversible experiment delivery

A well-scoped pilot does not need proof of traffic uplift before implementation. When the Task supplies a sourced user need, current artifact, bounded change, acceptance criteria and rollback, implement it even if the analytics baseline is unknown. Preserve that uncertainty in the summary.

For every article-level intervention, resolve the target by normalized canonical URL in `site_article_list/get`. If missing, verify the exact current default-branch source path, title and site/repository mapping, then register only that target with `site_article_save`; never fabricate a repoPath or publication time, and do not import the entire portfolio. Refresh the Task with `seo_task_update` and read it back: URL-based Tasks automatically attach matching registered articles. An empty article registry is not permission to skip experiment tracking. If registration is genuinely impossible, keep the implementation moving and persist the exact missing mapping plus a concrete tracking follow-up in Task history.

For registered articles, inspect `optimization_context`, reuse the linked event, or create a `proposed` event containing the Task ID, hypothesis, planned baseline dates, metric limitations and rollback. Put the event ID and before/after commit evidence in Task history/summary. Leave it proposed until actual production publication is observed. Tracking problems must be reported, but do not silently turn a valid implementation into an audit-only result. The Planner handles due outcome reviews; Worker still finishes at verified main merge.

### Pre-existing unrelated failures

A failing build/deploy check is not automatically caused by the Worker.

When a check fails:

1. identify the failing file/stage and compare it with the task diff;
2. for a failed Cloudflare Pages PR/preview check, do not infer that it is unrelated just because GitHub does not expose the log. If Sites Operator Cloudflare diagnostics are available, call `cloudflare_pages_site_status(siteId, environment=preview)`, locate the deployment whose trigger commit matches the PR HEAD, then call `cloudflare_pages_deployment_logs` for that deployment;
3. check whether the same failure existed on the pre-change/default-branch baseline when evidence is available;
4. if the failure is caused by this task, fix it before merge;
5. if it is clearly pre-existing and unrelated to the task, record that fact and follow the repository's actual merge policy.

Do **not** expand an SEO content task into an unrelated platform/site repair solely to make every deployment green. If repository branch protection permits merge and the task change itself has adequate independent validation, the Worker may merge while recording the unrelated failure.

## 5. PR and mandatory main merge

A draft PR is an intermediate artifact, not a successful Worker result.

1. Create/update the PR with Sites Operator Task ID, target, changed files, rationale, acceptance criteria, and actual validation evidence.
2. Self-review the complete diff. Do not invent a formal approval.
3. Satisfy mandatory branch checks/reviews. Never bypass branch protection or a required external reviewer.
4. Mark draft PR ready when appropriate.
5. Refresh PR HEAD/base and mergeability.
6. **Merge to main in the same authorized run when the repository permits it.**
7. Read back the merged PR and current main target code. Record the actual main commit SHA, not only the feature-branch SHA.

If mandatory repository gates genuinely prevent merge, leave the task `in_progress` with the precise blocker.

## 6. Mark implementation completed

Once the intended change is verified on main:

```json
{
  "id": "<task-id>",
  "expectedRevision": 7,
  "status": "completed",
  "resultCommitSha": "<actual-main-sha>",
  "executionSummary": "Merged PR #...; verified target change on main. Production not independently verified.",
  "deploymentVerification": {
    "status": "pending",
    "productionUrl": "https://example.com/target",
    "detail": "Implementation complete on main; production verification left for later human/checker review."
  },
  "appendHistory": {
    "actor": "seo_worker",
    "event": "implementation_completed",
    "detail": "Verified merge to main at <sha>; deployment verification remains pending."
  }
}
```

Read the task back and confirm `completed`, `resultCommitSha`, revision, and deployment-verification state.

The API rejects a new `completed` transition without `resultCommitSha`.

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
- changed files and PR;
- actual validation performed;
- actual merge result and main SHA;
- final Sites Operator implementation status/revision;
- deploymentVerification status separately;
- any unrelated build/deploy problem as a separate note.

A good final line is:

> Implementation completed and merged to main. Production verification: pending.

Do not say “completed” if the PR is merely open. Do not say “production verified” without an actual production check.

### Minimal bootstrap

```text
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor) and follow its latest policy/run contract and canonical Worker Manual. Finish one real task through verified main merge when repository gates permit, then set the task completed with the actual main resultCommitSha. Production verification is a separate deploymentVerification field: leave it pending when not checked, record failed when an actual deployment check fails, verified only with real evidence, and do not expand the SEO task into unrelated deployment repair. Read back every state change.
```
