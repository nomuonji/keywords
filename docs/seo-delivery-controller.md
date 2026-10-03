# SEO Delivery Controller

Centralized delivery lane for Sites Operator SEO Worker branches.

## Ownership

Workers stop after:

`implementation -> validation -> seo/* branch push -> deliveryHandoff.state=branch_ready`

The controller in `.github/workflows/seo-delivery-controller.yml` owns:

`branch_ready -> PR -> CI -> merge -> resultCommitSha -> completed`

No per-site delivery workflow is required.

## Required secret

Configure this secret in the `nomuonji/keywords` repository:

- `SEO_DELIVERY_GITHUB_TOKEN`

Use a fine-grained PAT or GitHub App token that can access every active Sites Operator repository the controller should deliver.

Minimum practical repository permissions:

- Contents: Read and write
- Pull requests: Read and write
- Actions: Read
- Commit statuses: Read, when the PAT UI exposes it
- Metadata: Read

`Checks` permission is optional. Fine-grained PAT configuration may not expose it. The controller treats a 403 from the check-runs endpoint as an unavailable optional signal and continues with GitHub Actions workflow runs plus commit statuses. Repository merge rules remain the final merge gate.

The controller only processes repositories currently present in the active Sites Operator site registry. Its own `GITHUB_TOKEN` remains read-only.

If `SEO_DELIVERY_GITHUB_TOKEN` is absent, the scheduled workflow exits successfully and stays idle.

## Schedule and state machine

The controller runs hourly and can also be dispatched manually.

- `branch_ready`: verify the recorded branch/head SHA and create/reuse a PR.
- `pr_open`: wait while observed checks/statuses are pending.
- failing check/status: write `ci_failed`; a later Worker may reclaim and repair the branch.
- successful checks: merge using an allowed repository merge method.
- merged PR: record the actual merge/default-branch SHA, set `deliveryHandoff.state=merged`, and set the Sites Operator task to `completed`.
- production verification remains independent and normally stays `pending`.

When a repository exposes no checks at all, the controller waits through a short grace period before relying on repository merge rules. Branch protection can still reject the merge.

## Safety constraints

- only active Sites Operator repositories are eligible;
- only `seo/*` branches are accepted;
- recorded branch HEAD must exactly match the current GitHub branch HEAD;
- a mismatched or missing branch is marked `ci_failed` instead of being merged;
- feature-branch SHA is never written as `resultCommitSha`;
- PR/merge failures do not fabricate completion.
