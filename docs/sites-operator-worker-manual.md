# Sites Operator SEO Worker Manual

> Canonical execution runbook. Always call `seo_agent_context(role=executor)` first. The live versioned policy and selected Sites Operator task take precedence over this document.

## Central CI and event handoff (2026-10-16)

After source and acceptance readback, save the existing `seo_task_update` `push_pending` checkpoint once and stop. The Sites Operator backend sends an opaque Task-ID wakeup after the durable save. A failed or missing event credential does not undo the Task; the existing 30-minute central cron retries. Workers do not dispatch Actions, create PRs or merge.

The Task rationale/evidence defines the substantive change. Optional `acceptanceChecks` provide targeted text/link assertions but are **not** a prerequisite for Task delivery. The central controller checks out the exact commit SHA, runs an approved Astro/Docusaurus/Next build, and checks generated target HTML/canonical before merge; it applies optional assertions when explicitly present. A failed or unavailable build remains unmerged for a bounded correction; do not relabel it success. Public deployment and the Optimization Event window are later, separate checks.

## Validation stage ownership — mandatory for every Worker run (2026-10-17)

**Do not require a Worker-local build.** Worker source review and central exact-SHA CI are separate stages. A ready Task must not be skipped solely because the Worker runner lacks `npm`, installed dependencies, a local build, a rendered page, DNS/network access for cloning/installing dependencies, or access to the live production URL. Do not invent a local-build preflight gate.

1. **Worker, before `push_pending`:** inspect current GitHub source and Task history; check facts against task-required primary sources, remove unsupported claims, inspect the **entire changed source/body**, frontmatter/config, source canonical/link intent, target-file scope, and Git commit/tree/blob readback. Run any meaningful available targeted static checks, but do not run local build just to satisfy a made-up requirement. Fix actual source defects rather than passing them through.
2. **Central GitHub Actions, before merge:** install dependencies and perform the approved Astro/Docusaurus/Next build, target generated HTML/route/canonical verification, configured text/link assertions and exact SHA/mergeability checks. Central CI failure prevents merge and can return the Task for a **genuine** corrective Worker pass; do not report the failed check as passed.
3. **Post-merge:** check actual production deployment, live HTML/canonical and subsequent Search observations separately. Unpublished or unverified deployment is `pending`, not completed publication.
4. **Interpret Task wording by stage:** historical Task rationale/evidence may say "Worker build", "MDX/build", "mobile/desktop render", "published HTML" or "public canonical check". Preserve the *substantive acceptance requirement*, but assign generated build/render checks to central CI and public checks to the post-merge lane. Such text is **not** an instruction for Worker to install npm, fetch production or prove rendered HTML before claiming or saving `push_pending`. Distinguish `source verified`, `central CI pending`, and `production pending` in `validationSummary`/history.
5. **Real blocker exception:** if a Task requires evidence not verifiable from its sources/current code and **not covered by configured central CI or post-merge verification** (such as manual interaction essential to an unsupported platform), report exactly that missing coverage and keep the unclaimed Task ready. Do not call every inaccessible rendered page a blocker: the central approved profile exists specifically to test those pages. If one Task truly cannot be validated, check other eligible Tasks. Do not relax factual verification, safety denials, source quality, Task scope, or the Git transport/readback gate.

## Editorial recovery acceptance contract (2026-10-13)

When a selected existing-page recovery or new editorial Task includes an `indexation_content_quality` audit:

- Read the Manager's **specific** existing-body deficit, user question, observed competitor/source evidence, known technical/indexation state and full acceptance criteria; check current HEAD to avoid redoing a completed change.
- Rewrite the **same canonical page** into content that actually answers the missing question. Verify material claims using the given primary/official sources, make comparisons and decision aids usable, and preserve site-specific editorial tone. Adding words, headings or keywords alone does not constitute an improvement.
- Re-read the **complete changed article source/body** after implementation, not just the patch. Verify every source-checkable article criterion, including source metadata/canonical and links. Central Actions validates the generated page/build/canonical before merge, and actual production is checked after merge. If a source-level item is unmet, revise within this Task (usually at most two bounded passes); record pending downstream checks accurately instead of treating them as a Worker blocker or pretending they passed.
- A Google Search result is not required before handoff: there is no way to guarantee that Google will index the update. Do not call Google URL Inspection or create another scheduler. Persist branch/validation handoff as before; publication outcome and next recrawl observation belong to the Manager's post-release loop.
- For technical-only tasks (e.g. robots/noindex/404), repair the verified technical defect rather than inventing an editorial rewrite. If competitor body retrieval is unavailable, do not fabricate it.

This adds **a quality acceptance obligation**, not a new Worker policy-planning role, another Task database or a change to the centralized `seo/*` delivery contract.

## Runtime and article-registry safety boundary (2026-10-14)

- **Source and metadata are distinct.** SEO Task implementation changes the GitHub repository's canonical data/pages; `site_article_list/get` reads Sites Operator article registry metadata. `site_article_save` and registry bulk-save are NOT editing tools for source pages. **An SEO Worker must not call them.** Do not register a missing article as a prerequisite for implementation. Record the missing article mapping in Task history for later independently authorized review by Planner/human; this tracking gap must not silently transform implementation into audit-only work.
- **Check actual tool capability in this run before claim.** Prefer `create_blob`, `create_tree`, `create_commit` plus raw commit/tree/blob readback. Any authorized SEO Worker may select the narrowly authorized `create_branch` + `push_files` fallback with full Git/source readback and exact task-bound branch, as detailed in §5. If neither complete route is actually callable, the Worker **must not claim** a Task; report the capability gap. Never switch methods after a safety/authorization refusal, force-update a ref, push main, create a PR, merge, or use an article registry write as a source edit.
### Git-object readback: supported ChatGPT GitHub connector route (verified 2026-10-15)

The required commit/tree/blob readback **is available** through the GitHub connector even when no tool literally named `get_tree` or `get_git_commit` is advertised. **Do not mark preflight unavailable based solely on dedicated tool-name discovery or the limited normalized fields of `fetch_commit`.** Inspect the existing read-only `GitHub.fetch` tool, which accepts approved `api.github.com` Git data endpoints.

In a ChatGPT runner with the currently verified connector, use read-only requests (substitute the selected repo and an existing SHA):

1. **Commit and single parent:** `GitHub.fetch({url:"https://api.github.com/repos/OWNER/REPO/git/commits/COMMIT_SHA"})`. Parse returned JSON content. Verify `sha`, `tree.sha`, and `parents.length===1` with `parents[0].sha===baseSha`. This is Git's *Git commit object* endpoint, not the ordinary normalized `fetch_commit` payload.
2. **Tree:** `GitHub.fetch({url:"https://api.github.com/repos/OWNER/REPO/git/trees/TREE_SHA?recursive=1"})`. Parse returned JSON content; compare `sha` with the commit's `tree.sha`, require `truncated!==true` for a complete scope check, inspect changed paths/types/modes/blob SHAs.
3. **Blob content:** `GitHub.fetch_blob({repository_full_name:"OWNER/REPO",blob_sha:"BLOB_SHA"})` (or the approved read-only Git blob URL). The connector normally returns the decoded **file contents**, rather than a `sha` field. Compare the blob SHA to the corresponding tree entry and read back the actual content for scoped acceptance checks. Do not mistake absence of a redundant blob-SHA field for an unavailable readback function.
4. **Pre-claim probe:** demonstrate read-only access with an existing repository HEAD commit, its tree and one existing source blob **in the actual runner**. Discover the Git-object creation tools (`create_blob`, `create_tree`, `create_commit`) first; if they are not exposed, discover the branch tools (`create_branch`, `push_files`) and the same readback operations. Select one complete transport before claiming. A dry-run probe does not write a test commit. After implementing, perform the same readbacks against the newly created unreferenced objects before `push_pending`.

As of 2026-10-15, the connector was **actually read-tested** against `nomuonji/bungu-blog` main commit `274e9120e90bfc60512319003a989930fe42f22c` (Git commit parent and tree) and `nomuonji/book-discovery` commit `05300dc7f010d141b686525a33ced2a6c681d61f` (commit, complete recursive tree and source blobs). These are *read-only capability checks*, **not** permission to replay either previously refused Task or to attach any unreferenced commit to a branch.

If `GitHub.fetch` or Git-object readback is truly denied/unavailable in a different runner, record the specific failing read-only tool, endpoint family and response. Stop **before claim** if neither complete transport has its required readback. Do not repeat denied mutations through another route, disable schedules, or falsely report a successful handoff.

- **Safety denials are final for that operation and content.** When any action receives an OpenAI/tool/authorization safety refusal, stop without retrying the refused content through GitHub or another route, even if that route is ordinarily legitimate. Read-only verification is allowed. Where independently permitted, record the failure and cancel/quarantine the rejected SEO Task so an expired lease does not trigger a different Worker to repeat it. Otherwise report the blocker without trying another write. The documented 2026-10-14 drone-pilot Task `21531a6b-6f80-4801-ae3a-6b4c671cc13d` was cancelled after a `site_article_save` denial in the ChatGPT scheduled run; do not reopen or recreate that refused action without separate authorization and safety resolution.
- **Refusal incident ledger (2026-10-16).** Distinguish (1) missing/unexposed tools (`preflight_git_objects_unavailable`), (2) ordinary CI/delivery errors (`delivery_failed` / `delivery_controller_error`), and (3) an **actual tool-level safety or authorization refusal**. Only (3) becomes the typed `safety_write_rejected_task_cancelled` event. Where independently allowed, persist `status=cancelled` and append exactly one structured history event with the refused *tool/action*, reported timestamp, original refusal code/reason **or UNKNOWN**, affected repository/task/commit, provenance, and review requirement. Preserve GitHub objects and prior validation receipts without attaching refs or making PRs. A history-write refusal must not be worked around via another transport; report it for independently authorized incident migration. The site Manager and central Actions exclude cancelled Tasks; the Sites Operator create/claim gates prohibit replay of the same denied task/dedupe key. Do not use hard-coded task-ID deny lists or treat a text comment/log (including `No safety refusal`) as evidence of clearance. A new independently permissible scope requires its own authorization and evidence, never a cloned retry of the refused content.
- **2026-10-15 Book Discovery incident disposition (migrated 2026-10-16).** `seo-book-night-circus-canonical-slug-20261015` and `seo-book-swanns-way-seven-parts-editions-20261015`: prior ChatGPT runs reported `seo_task_update` safety refusals while saving `push_pending`; precise refusal reason is UNKNOWN. Both tasks now carry `safety_write_rejected_task_cancelled` history and status `cancelled`. The previously prepared commit SHA and validation receipts remain for read-only audit; neither prepared commit has been delivered by central Actions. Do not infer authorization from later successful metadata writes.

## 1. Worker responsibility

The Worker implements and validates one real Task, then uses its **preselected, capability-supported** Git transport: (A) verified unreferenced Git commit or (B) verified one-commit task-bound branch. Both write a `deliveryHandoff=push_pending` checkpoint. Central GitHub Actions attaches A's commit or independently verifies B's existing branch, then promotes `branch_ready`. Workers never create PRs or merge, and previously refused changes cannot be replayed through another transport.

**Unrelated main drift exception (central Actions only).** After a verified task-bound branch fallback, the central controller may continue if main has advanced exclusively through at most ten commits affecting only disjoint `sns-bot/*_state.json` files. It independently verifies GitHub's base/compare result, the Worker diff, branch HEAD and PR mergeability before merging. Any source/config overlap, divergent ancestry, unknown change, or safety/authorization refusal remains blocked. The Worker must still branch from the exact current main during its own claim; this exception never authorizes it to rebase, force-push or replay rejected content.

The Worker does **not** create/update pull requests or merge to the repository default branch. Those mutations belong to an external GitHub delivery lane. The Worker also does not own the hosting platform, production deployment, cache propagation, or unrelated pre-existing build/deployment failures. A later delivery/reconciliation step records completion only after the exact change is observed on the default branch.

| Responsibility | Worker |
| --- | --- |
| Select/claim a real `ready` task | yes |
| Verify current repository state and task scope | yes |
| Implement the requested bounded change | yes |
| Validate facts, changed source, targeted static criteria and Git object readback | **yes**; local build is not required |
| Install dependencies; build; verify generated target HTML/canonical | **no** — central Actions before merge |
| Verify production public page after merge | optional follow-up; not a handoff gate |
| Create verified unreferenced GitHub commit (blob/tree/commit) and persist task-bound `push_pending` | **yes** |
| Create/update remote `seo/*` branch reference or push | **no** — central Action |
| Verify remote HEAD and persist `branch_ready`, release execution claim | **no** — central Action |
| Create/update PR | **no** — centralized delivery controller |
| Verify exact PR/head/main and merge | **no** — centralized delivery controller; no peripheral GitHub Actions |
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
   - otherwise, `executionClaim = null` or expired: implementation work is reclaimable only if still valid, not cancelled/superseded, and no past safety or authorization denial prohibits the action. An expired lease by itself is never permission to retry rejected content.
   - unexpired claim: another execution may still be active; do not seize it.
3. For reclaimable work, inspect the current GitHub default branch, implementation branch, Task history/handoff and acceptance scope. Continue from the furthest verified artifact instead of starting over.
4. If no valid stale work should be resumed, inspect candidate `ready` tasks before claiming. For an article-linked Task, read `optimization_context` first. If `changeAllowed=false` because an implemented experiment is still in cooldown/evaluation, skip that Task without claiming it and select another executable ready Task. Report the exact `cooldownUntil` once; the Manager owns moving an unclaimed `ready` Task to `proposed` with one `cooldown_deferred` event and restoring it only after the due evaluation and current HEAD/PR checks. The Worker must not repeatedly append identical environment/cooldown preflight histories or claim the deferred Task.
5. Before claiming, verify this runner exposes a **complete A transport** (Git-object writers plus readback) or, only when A's writers are absent, a **complete B transport** (`create_branch`, `push_files`, commit/tree/branch/source readback). Select by capability, never model/actor. If neither is usable or any action was safety/authorization-denied, do not claim. Enter execution with `seo_task_claim(id, expectedRevision)` only after the selected Task is currently executable. The response contains an ephemeral `executionClaim.runId`; keep it only for this run.
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

### Autonomous validation fallback (2026-10-15)

- Missing Worker-local `npm install`, build tooling, generated HTML, or production URL access is **never a stop by itself** on a supported central-CI site. Verify source/diff, facts, available static invariants and Git readback. Categorize all acceptance items by stage; `central CI pending` does not mean `Worker blocked`.
- For approved Astro/Docusaurus/Next central CI profiles, generated output/build/canonical checks are intentionally **deferred to the central pre-merge Action**, not a missing pre-handoff Worker receipt. If source changes and source-verifiable criteria pass, create the exact verified Git commit and `push_pending` even without local build/render proof. Central CI then blocks a failing implementation before merge. Hosting builds again after main push; neither downstream check may be marked passed early.
- Only a required check unsupported by **both** the central CI profile and the proper post-merge production check may block a Worker handoff when it cannot be meaningfully source-verified. Name the exact unsupported check and evaluate other eligible Tasks; do not generalize from absent local tooling.
- For a repeated environment-only blocker, avoid duplicate history writes and redundant connectivity probes unless evidence has changed. Evaluate other eligible tasks; finish with a concise zero-work report only when none can be validated adequately.
- These fallbacks do not relax safety/authorization refusals, Task scope, claim isolation, Git-object/readback preflight, the prohibition on ref writes outside the narrowly scoped B transport, PR writes and merges, or central commit-integrity and GitHub mergeability gates. Do not alter ChatGPT automation schedules because of a task-level blocker.


### Task size, completeness and quality

A larger Task is not permission to implement superficially. The Worker owns the **whole documented outcome**.

- Read every target artifact and acceptance criterion before editing. Do not quietly complete only the easiest part of a bundled Task.
- For a substantial article revision, verify the complete edited source/body, factual/source integrity, search-job answer, internal links, source metadata and canonical/indexability configuration; central Actions owns repository build and generated page checks.
- For a bundled `data_expansion`, verify every included record against the required authoritative source pattern and preserve unknowns individually. Do not validate one representative record and assume the rest are correct.
- For hub/site-expansion work, verify source-level decision flow, data and route configuration and known accessibility/no-JS obligations; central CI or subsequent production checks verify generated routes, rendered accessibility behavior, canonical/indexability and build output.
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

For each editorial Task, first extract from the Manager's Task the exact reader question, the current article's specific deficit, the observed difference from actual competitor bodies, the expected user value, and the testable acceptance criteria. Before editing, recheck the current GitHub source and whether the competitor evidence is still relevant; do not treat an old hypothesis or stale competitor observation as established fact. Verify material claims against primary/official sources, then read back the entire changed body and check source-level criteria; hand off generated/rendered acceptance to central exact-SHA CI and public acceptance to post-merge publication verification. Record in the existing Task execution summary/history what changed, what evidence and criteria were checked, and what remains unverified. Report implementation evidence only; the Manager evaluates Google outcomes after publication.

For an article-level intervention, use `site_article_list/get` in **read-only mode** to resolve existing article registry metadata by normalized canonical URL. GitHub remains the sole source of actual article body/code. When the registry has no corresponding record, verify the current default-branch source path, title, canonical URL and site/repo association, then record a concise missing-mapping tracking note in SEO Task history. **Do not call `site_article_save`, bulk registry writes, or attempt equivalent registration from an SEO Worker**, whether before or after claim. Registration and publication verification are separate, independently authorized Planner/human processes; do not fabricate repoPath/publication time, do not import the whole portfolio, and do not silently skip the missing mapping. A registry gap alone does not block an otherwise permitted source implementation.

For registered articles, inspect `optimization_context`, reuse the linked event, or create a `proposed` event containing the Task ID, hypothesis, planned baseline dates, metric limitations and rollback. Put the event ID and before/after commit evidence in Task history/summary. Leave it proposed until actual production publication is observed. Tracking problems must be reported, but do not silently turn a valid implementation into an audit-only result. The Planner handles due outcome reviews; the Worker finishes its run after verified A-or-B Git commit/branch creation and durable `push_pending` handoff, while the Task remains `in_progress` until external default-branch delivery is later observed.

### Pre-existing unrelated failures

A failing validation step is not automatically caused by the Worker.

When a targeted/local/repository check fails:

1. identify the failing file/stage and compare it with the Task diff;
2. check whether the same failure is reproducible or already present on the default-branch baseline when evidence is available;
3. if the failure is caused by this Task, fix it before the branch handoff;
4. if it is clearly pre-existing and unrelated, record the exact failure in the delivery checkpoint without expanding the SEO Task into unrelated repair work.

The Worker does not create or mutate PRs to obtain preview checks. PR/merge CI, preview deployment checks, and merge-gate handling belong to the external delivery lane. A later reconciler may inspect their evidence when deciding whether the exact implementation reached the default branch.

## 5. Unified prepared-commit Actions handoff (new Tasks)

For Tasks created at or after the authorized rollout cutoff (2026-10-13T05:50:00.000Z), use capability-based transport selection. **A is preferred** when the complete Git-object creation/readback APIs are exposed. **B is available to any authorized Worker** only when A's creation APIs are absent and `create_branch`, `push_files`, commit/tree/branch/source readback are available in that same runner. Choose once **before claim**; inability to run or a refusal received during A is not permission to retry through B. This does not authorize replay of previously denied operations. Workers never create PRs, merge or mark delivery completed.

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
6. Read back the Sites Operator Task. Confirm exact checkpoint SHA, marker, branch, active claim and revision. **Stop the Worker run**. Under A, remote branch creation is not a Worker action; under B, the single verified task-bound branch is created by the Worker. PR creation and merge always remain central.
7. The central scheduled GitHub Action independently checks the active Site Registry, task creation cutoff, claim, task-bound branch, prior refusal history, Git object parent and allowable diff. It non-force fast-forwards `seo/<task-id>`, reads back the exact remote HEAD, sets `branch_ready` and releases the Worker claim, then creates/reuses PR, revalidates exact head/base SHA and GitHub mergeability, merges, writes resultCommitSha/completed, and cleans the branch. No peripheral-repository Actions or central site build are started. Actual host build success and live publication are checked separately after merging. If base/main advances before an initial ref is created or a concurrent ref wins, **stop and re-evaluate**; no force push or automatic replay.
8. If Actions reports `ci_failed`, the Worker may perform a genuinely new corrective pass with fresh evidence and a new valid child commit of the existing branch HEAD. Old PRs with merge conflicts are not automatically rewritten by the Worker.

### Reliable transfer of large data files (operational procedure)

The 2026-10-17 Render/Job World incidents exposed a practical `push_files` argument-size problem: a large JSON body arrived truncated, even though the original intended data was complete. **Do not treat a successful push response as proof that the transmitted file is intact.** This is a transport issue, not a reason to invent additional SEO acceptance criteria.

- For a Task that rewrites an existing substantial structured dataset, prefer A's `create_blob` with the **full file content**, `create_tree` based on the exact existing task-branch/default-branch tree, and `create_commit`; then fetch the new blob and verify the complete bytes, record count and preservation of unrelated records. Only write `push_pending` after the actual created Git objects match the intended data.
- If A is unavailable, B remains usable for modest file edits that can actually be transmitted in full and read back. **Do not feed a multi-kilobyte JSON replacement through a runner's known truncating `push_files` argument channel.** Leave it for an A-capable execution rather than replace most of a data file with a placeholder or truncated text. This chooses a working transport instead of making new safety/policy checks.
- If a previously started corrective execution discovers a transport limitation, record one `implementation_blocked` event and preserve `ci_failed` as a recoverable handoff state, releasing its own claim via the supported `seo_task_update` so another capable Worker need not wait for the old lease to expire. Do not replay an explicitly refused write using another mechanism. Preserve existing Task state and all unrelated file content.
- A corrective A commit has the **current exact broken task branch HEAD** as its only parent, restores the complete main dataset, makes the intended focused edit, removes unrelated artifacts in the final tree and leaves remote ref changes and PR/merge to central Actions. Never force-update the old branch.

### B fallback for any authorized Worker: already-pushed, verified task branch

Use this only for a **new, executable, unrefused** SEO Task when the actual runner lacks the complete low-level Git-object writers but has a working branch-push/readback toolset. No fallback after an actual safety/authorization refusal, even if that refusal was not written into Task history. This is not permission to retry previously quarantined Book Discovery work. If neither complete transport is available, do not claim.

1. Before claiming, inspect current Task/claim/history, active site registry, optimization cooldown, main HEAD, existing refs/PRs and the exact branch `seo/<task-id>`. Confirm in this runner that `create_branch`, `push_files`, commit/tree/diff and source readback work. There must be no prior safety denial and no existing conflicting branch.
2. Claim the authorized Task once with fresh `expectedRevision`, implement its scoped acceptance criteria, validate the source/diff, and enforce the same changed-path allowlist (no `.github/`, secrets, lockfiles, infrastructure files, or unrelated paths).
3. Create only `seo/<task-id>` at the observed current default-branch SHA `B` using `create_branch`. Use `push_files` **once on that branch** to make one commit with subject `[CF-Pages-Skip] ...`. Never push main, use `update_ref`/force-push, modify another Task branch, create PR, or merge. No `create_or_update_file` substitute for this transport.
4. Read back branch HEAD `H`, raw commit, tree/source and comparison `B...H`. Require one parent exactly `B`, one commit ahead, no behind commits, and only permitted changed paths; current main must still equal `B`. On mismatch, stop without handoff.
5. With the current `claimRunId`, save `deliveryHandoff.state=push_pending`, `branch=seo/<task-id>`, `baseSha=B`, `headSha=H`, `validationSummary` beginning with `Action-Branch-Handoff: v1\n` (one newline) and actual validation evidence. Keep handedOffAt/prNumber/prUrl null, lastError empty and updatedAt current UTC. Append history `{actor:<actual executionClaim.actor>,event:"delivery_branch_push_pending",detail:"...verified exact SHA and source..."}`. The actor must be an authorized executor claim identity (`seo_worker` or `chatgpt_seo_worker`), and the central verifier requires the history actor to match the active claim for `push_pending`. Read Task back and stop.
6. Central `keywords` Actions verifies claim, registry, task creation cutoff, historical refusals, Task-bound branch, one-parent Git commit, base/main SHA, exact branch/ref, changed paths and receipt. It does **not** rewrite the existing B-transport branch; it alone marks `branch_ready`, creates/merges PR and records `completed`. Site builds are performed by Cloudflare or the configured host after main push, with independent publication verification.

Corrective follow-ups must not force-update a B-transport branch. Use a separately authorized and validated correction path. No altered ChatGPT schedules, article registry writes or foreign operational automation changes.

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
`push_pending -> [attach prepared commit OR validate exact B-transport branch] -> branch_ready -> PR -> merge -> resultCommitSha -> completed -> merged branch cleanup`.

## 6. Completion is controller-owned

Neither `push_pending` nor a successful Worker `branch_ready` handoff is **`completed`**. Task status remains `in_progress` until main/default-branch merge.

The centralized delivery controller in `nomuonji/keywords` is responsible for:

1. validating that the repository is an active Sites Operator repository;
2. verifying the recorded `seo/*` branch HEAD still matches the handoff;
3. creating or reusing the PR;
4. recording `deliveryHandoff.state=pr_open`;
5. verifying exact task, commit/branch HEAD, current main SHA, PR head/base and GitHub mergeability;
6. refusing merge if PR cannot be merged cleanly or the exact main/ref/Task changed; no peripheral GitHub Actions checks or hosting-preview builds are a prerequisite. After main push, verify host build and canonical publication independently;
7. merging only when central commit-integrity checks and GitHub repository rules permit;
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

> Verified unreferenced GitHub commit created; `deliveryHandoff=push_pending` recorded and read back. Central Actions owns ref/PR/exact-SHA-and-mergeability-gate/merge/completion; hosting owns production build, which must be verified separately.

Do not say “completed” merely because the prepared commit was created or a branch was updated. Only say “completed” after the exact change is observed on the repository default branch. Do not say “production verified” without an actual production check.

### Minimal bootstrap

```text
Run the Sites Operator SEO Worker once. First call seo_agent_context(role=executor), then follow the exact current Task and canonical Worker Manual. Reconcile existing claims and central-delivery handoffs without competing with another Worker. Select one genuine executable Task only. Verify Git object creation capability before claiming; implement and validate; create a task-scoped unreferenced Git commit whose subject begins [CF-Pages-Skip]. Read back commit, parent, tree and changed paths. Persist Action-Ref-Handoff: v1 prepared push_pending with exact seo/<task-id> branch, commit SHA, parent SHA, checks and claimRunId. Verify the Task checkpoint and stop. Do not push/create/update refs or make PR/merge changes. Central GitHub Actions owns remote branch, PR/CI/merge and completed. No Task is a valid zero-work result.
```
