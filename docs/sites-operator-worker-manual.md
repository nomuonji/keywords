# Sites Operator SEO Worker Manual

> Status: **runbook only**. This document specifies how a future human-operated or separately authorized Worker should execute existing Sites Operator SEO records. It does **not** enable or schedule an implementation Worker, create GitHub Issues, grant GitHub access, or establish automatic merges.

Sites Operator is the canonical SEO task/control plane. GitHub is the source of truth for article/code changes and commit/PR evidence. New SEO tasks are saved directly as **`ready` records**; a GitHub Issue is never required. This manual describes the **execution** half of that arrangement, not planning or measurement collection.

**Authority order:** current `seo_agent_context(role=executor)` > the selected live `seo_task_get` record and its evidence > current target-repository code/accepted requirements > this runbook. If these conflict, follow the live policy and report the inconsistency. Do not silently broaden a task.

## 1. What the Worker may and may not do

| Responsibility | Source or boundary |
| --- | --- |
| Choose work | `seo_task_list(status=ready)`; legacy `issued` tasks remain eligible after revalidation. |
| Verify requirements | `seo_task_get(id)` (title, rationale, evidence, target URLs, task type, history, revision); read an optional legacy linked Issue only when present. |
| Verify scope and source | `site_registry_get(id=siteId)` and current default-branch GitHub repository, files, relevant PRs/commits and deployment evidence. |
| Track progress and evidence | `seo_task_update` with a **fresh** `expectedRevision`; read back via `seo_task_get`. |
| Implement and verify | Edit only the material change specified by the task; use repository build/checks and existing deployment workflow when separately authorized. |
| Off limits | No mandatory Issue creation, no direct GSC/GA4 acquisition, no use of My Portal/site-monitor as SEO control planes, no invented checks or delivery proof. |

**Implementation automation is deferred.** These are instructions for a future Worker or a manual execution session. They do not assume the ChatGPT scheduled-task environment can write to GitHub: scheduled-context writes have previously failed safety checks. A rejected action must not be automatically resent through another route.

## 2. Record lifecycle and legacy compatibility

| Status | Meaning for the Worker |
| --- | --- |
| `proposed` | Legacy pre-Issue backlog; the **Planner**, not the Worker, revalidates it to `ready` or `superseded`. |
| `ready` | The Planner has recorded an evidence-backed action in Sites Operator; implementation may be claimed after current-state validation. |
| `issued` | Legacy task with an existing Issue; treat as implementation-eligible after checking the live task and optional Issue. Do **not** open another Issue. |
| `in_progress` | An executor has claimed/started work. This does not prove a PR was opened, merged, deployed or verified. |
| `completed` | All applicable acceptance requirements have independent delivery evidence; record the main-branch result commit and concise verification details. |
| `superseded` | Task is invalid, duplicate, contradicted or already delivered; preserve the reason and source of proof. |
| `cancelled` | Intentionally abandoned; record the explicit decision and reason. |

There is **no `blocked` status**, no owner/lease field and no built-in automatic stale-claim reaper in the current API. Record temporary blockers as a history entry (for example `execution_blocked`); leave the status unchanged or `in_progress` if already claimed. Do not represent a timeout as authorization to steal someone else's work. Multiple Workers must coordinate ownership externally until an explicit lease/claim API exists.

## 3. Startup and selection

1. Call `seo_agent_context(role=executor)` **first on every run**. Use its current versioned policy and run contract. Re-read this manual from the canonical main branch if needed.
2. List `ready` tasks. Check relevant legacy `issued` tasks separately. Inspect `in_progress` records before selecting a target to avoid overlapping an active implementation. Do not auto-promote `proposed` tasks or invent new ones.
3. Choose a genuine actionable task rather than manufacturing test work. Fetch its full record by ID. Inspect prior history, target URLs, repository, evidence, acceptance criteria if present and current `revision`.
4. Confirm the site is managed and active using `site_registry_get`. Inspect **current** repository default-branch HEAD, exact target files, metadata/canonicals, related PRs, merged commits and current production state when relevant. For legacy records, read the linked Issue as additional context, not as the task's identity.
5. Check whether the task is already implemented, actively worked by another executor, contradicted or stale. If already delivered, attach precise evidence and arrange `superseded` rather than repeating the edit; if unsure, report uncertainty and stop before writing. Avoid duplicate PRs or changes for the same URL/intervention.

### Claim the selected task

Claim with `seo_task_update` only after the read-only checks; transition `ready` or legacy `issued` to `in_progress` and append `worker_claimed` with the executor identity, observed GitHub HEAD and intended scope. Supply the **revision from the immediately preceding `seo_task_get`**. Read back the task, confirming status, incremented revision and history before editing.

Example shape (illustrative values; use real live IDs and revision):

```json
{
  "id": "<existing-task-id>",
  "expectedRevision": 3,
  "status": "in_progress",
  "appendHistory": {
    "actor": "seo_worker",
    "event": "worker_claimed",
    "detail": "Reviewed current main HEAD <sha>, prior changes, target URL and task evidence; starting only the documented intervention."
  }
}
```

If a revision conflict occurs, fetch the task again and reconcile against the other update; **do not blindly retry** with a new revision. Because the API does not have a lease field, this claim is optimistic state tracking, **not** exclusive locking. If the task is already `in_progress`, do not take it over without an explicit recovery decision.

## 4. Make the smallest justified change

1. Reconfirm that the task's stated defect still exists on the actual current default branch. Do not use a past blob SHA as proof after main has moved.
2. Check whether an existing relevant branch/PR already has the fix. Reuse an authorized existing branch when appropriate, or use a task-specific branch such as `seo/<task-id-short>-<change>`. Do not modify main directly unless a separate approved workflow explicitly permits it.
3. Implement only the requested material scope. Preserve the intended existing URL, current SEO intent, internal links, metadata and affiliate links unless the task specifically justifies changing them. Verify factual claims using relevant primary sources. Do not introduce unverified product, legal or availability claims.
4. For `merge`/`delete`, identify the valid destination and preserve required redirects, canonicals and incoming internal links before deleting or merging URLs. For `technical`, reproduce the exact defect and confirm that the specified fix resolves it.
5. Run repository-appropriate checks that can actually catch material errors; run the build and targeted checks where available. Do not create tests that merely mirror a low-impact change. Examine the diff, confirm no unrelated files/secrets changed, and inspect any generated routes affected by the task.
6. Create or update a PR when that is the separately authorized repository delivery process. Include the **Sites Operator Task ID**, original target URLs, changed files, main-base commit, rationale, evidence, acceptance checklist, tests/build results and remaining limitations. A GitHub Issue number is optional and not requested for new records.

If GitHub or Sites Operator writes are rejected by an OpenAI safety check, stop the rejected operation. Record the exact tool, stage and diagnostic in the run report and, **only if independently allowed**, append a failure history event to the task. Do not disguise, reword or reroute an equivalent denied operation. If no write succeeds, preserve the existing record and report the failure.

## 5. Delivery and evidence gates

Use distinct evidence for the stages below. Do not conflate a branch commit, open PR, merged commit, build result and publicly deployed content.

| Stage | Evidence to record | Task state |
| --- | --- | --- |
| Implementation branch / PR | Branch name, PR URL if any, HEAD SHA, files changed, tested scope, known gaps. Store these in `executionSummary` and append `implementation_pr_opened` or equivalent history. | Keep `in_progress`. |
| CI / review | Actual check/run URL and conclusion, source-specific review outcome; a pending/missing check is not a pass. | Keep `in_progress` until required gates pass. |
| Merged | Verify actual main-branch ancestry/merge commit, updated target file and acceptance criteria. Record the **main result SHA** (not merely PR head) in `resultCommitSha` when verified. | Keep `in_progress` if required production validation remains. |
| Production verified | Confirm the exact intended live route and substantive changes after deployment; distinguish cache or redirect anomalies from an actual live version. Record URL, observed checks and deployment commit. | Mark `completed` only when every applicable acceptance gate has been met. |

For tasks without a public URL or deployment requirement, `completed` can follow independent verification of all applicable repository/CI requirements. For site-content or live technical tasks, do not assert `live_verified` or mark completion on merge alone when the acceptance scope requires production verification. The pre-existing evaluation/cooldown workflow is separate from delivery; don't invent post-change analytics or claim traffic improvements on completion.

On every state change: `seo_task_get` -> `seo_task_update(id, expectedRevision, ...)` -> `seo_task_get` readback. Keep `executionSummary` concise but actionable. History is bounded; put stable URLs, identifiers and evidence in the summary, not just chat output. If deployment is delayed, leave `in_progress` with a `merged_awaiting_live_verification` event and the exact outstanding checks.

## 6. Supersession, failure and recovery

- **Already fixed / duplicate**: confirm current main and relevant task/PR evidence, then record `superseded` with a precise reason. Do not mark an untouched duplicate task as `completed` or create a placeholder change.
- **Unsafe or invalid requirements**: stop implementation, identify the exact conflicting requirement, append `execution_blocked` when allowed, and seek revision/authorization. Do not silently alter the mission.
- **Transient build/deployment failure**: keep the actual state, append tool/result evidence and define a concrete next retry condition. Recheck repository state on the next run.
- **Optimistic revision conflict**: read the latest record and independently reconcile updates; if another Worker owns the implementation, do not overwrite its evidence.
- **Safety/authorization refusal**: do not bypass the refusal via a proxy, different connector, API, GitHub Actions or another agent. Stop the rejected operation and report the exact diagnostic and unchanged task/PR state.

An incident report should include Task ID and revision, repository, initial and current HEAD, attempted action/tool, exact failure text, what writes (if any) actually succeeded, readback evidence, current task status and an explicit next safe step. **Never claim success from intent alone.**

## 7. Per-run report contract

Report the selected Task ID and original status; whether the claim was confirmed; GitHub branch/PR and actual changed files; checks run and their outcomes; verified main SHA if merged; production verification if required; final Sites Operator status/revision and readback; and any blockers or unfinished work. Report zero completed tasks when completion gates were not met.

### Minimal bootstrap for a future Worker

```text
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor); use its latest policy/run contract and the linked canonical Sites Operator Worker Manual. Inspect ready tasks (and legacy issued tasks), choose one real actionable record, get it by ID, verify the active site, existing work and current GitHub HEAD, then claim with expectedRevision and confirm readback. Implement only the justified scope when this environment is authorized to do so. Run meaningful repository checks and record actual branch/PR, CI, main-merge and production evidence separately. Update Sites Operator with fresh revision and readback. No GitHub Issue is required; do not collect GSC/GA4 directly. Stop on safety refusals rather than rerouting. Never invent a merge, deployment or live verification.
```

**Related:** [Site Operations Architecture](./site-operations-architecture.md), [Analytics Bridge](./site-operations-analytics-bridge.md), [Site Operations Readiness](./site-operations-readiness.md). For current tool schemas, treat the live Sites Operator contract as authoritative.