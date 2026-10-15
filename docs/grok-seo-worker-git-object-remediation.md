# Grok / Groq SEO Worker — Git-object capability gap (2026-10-15)

## Observed production evidence

Grok scheduled executions between 2026-10-14 and 2026-10-15 repeatedly read Sites Operator Task `02f9ead6-0f3b-4176-95da-3d261bd67ac8` and recorded `preflight_git_objects_unavailable`; no Task claim or Git commit was produced.

The runner advertises `get_commit`, `get_repository_tree`, `get_file_contents`, `create_branch`, `push_files` and `create_or_update_file`. It **does not advertise callable** `create_blob`, `create_tree` or `create_commit` Git-object writers. The listed substitutes mutate a branch directly, violating the shared `Action-Ref-Handoff: v1` transport contract.

**This is the Grok runner's connector/tool-registration gap, not a GitHub Actions outage and not a problem with the Task itself.** It cannot be fixed by changing `seo_task_claim`, extending a lease, retitling the Task, or rerunning the same preflight hourly.

## Exact connector requirements

Expose these GitHub **Git database** functions to the Grok executor, not merely the Contents API:

| Required tool | GitHub REST operation | Minimum input/output |
| --- | --- | --- |
| `create_blob` | `POST /repos/{owner}/{repo}/git/blobs` | repository, UTF-8 content/encoding → 40-hex blob SHA |
| `create_tree` | `POST /repos/{owner}/{repo}/git/trees` | repo, `base_tree`, scoped `tree[]` with `path/mode/type/sha` → tree SHA |
| `create_commit` | `POST /repos/{owner}/{repo}/git/commits` | repo, `message`, `tree`, one exact `parents[0]` → unreferenced commit SHA |
| `read_commit` | `GET /repos/{owner}/{repo}/git/commits/{sha}` | validate SHA, `tree.sha`, exactly one parent |
| `read_tree` | `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` | validate tree SHA, `truncated=false`, changed paths/blobs |
| `read_blob` | `GET /repos/{owner}/{repo}/git/blobs/{sha}` | decoded content → compare to intended source |

The GitHub credential used by this Grok Git tool installation needs **Contents: read/write** permission on the exact target site repositories, subject to repository policy. Only the central `nomuonji/keywords` delivery controller should update `refs/heads/seo/*`, open PRs, run CI, merge and record completion. **Do not grant Grok `git push`, `update_ref`, `push_files`, `create_branch` or PR/merge permission as a workaround**.

If the Grok connector cannot expose the three unreferenced-object methods, Grok should **not be assigned SEO executor work** until it can. Use an already-capable ChatGPT executor for actionable Tasks; Grok can still provide read-only discovery or inspection through its existing read tools. Scheduling authority and cadence belong to their owners and must not be auto-modified by an SEO Worker.

## Required acceptance probe in Grok's actual runner

1. Discover three callable Git creation functions and commit/tree/blob GET functions. Discovering their names is a prerequisite, not proof they work.
2. Read a known current HEAD, its raw Git commit, complete tree and a source blob through the **same connection used for writing**.
3. On a newly authorized, real `ready` Task with no cooldown or refusal, perform scoped source verification, claim once, prepare a blob/tree/unreferenced commit, and read all three objects back. Commit subject must begin `[CF-Pages-Skip]`; the sole parent must equal the observed default HEAD.
4. Persist `deliveryHandoff=push_pending` with `Action-Ref-Handoff: v1\\n` prefix, exact base/head SHA and branch `seo/<task-id>`. Read the checkpoint back.
5. Verify that central Actions, **not Grok**, attaches the ref, records `branch_ready`, opens PR, observes successful PR CI, merges to main and records `completed`.

No fabricated dry-run commit, no unapproved historical refusal replay, and no regression test that bypasses the canonical Git-object transport.

## Avoid repeat-noise on unsupported runners

When preflight confirms the same missing Git-object tools, report `0 work / capability blocker` for the current run **without appending another identical history event**. The Manager should exclude Tasks that are in cooldown (move unclaimed `ready` to `proposed` with one `cooldown_deferred` and UTC due date) so the Grok Worker does not keep polling a non-executable queue. Do not disable or modify the ChatGPT task schedules.
