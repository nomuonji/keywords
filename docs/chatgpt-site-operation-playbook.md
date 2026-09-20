# ChatGPT site-operation playbook (remote, scheduled)

Paste this into a ChatGPT scheduled task with the Keywords MCP (`/mcp`,
`/sites-mcp`) and the site GitHub repositories connected. No local PC,
no resident daemon, no human in the loop. Quota-safe by construction.

## Jurisdiction

- Article bodies and deploys belong to the GitHub site repos. Edit and push
  there directly; sites auto-deploy from Git.
- Keywords (Firestore) holds the registry, metric snapshots, digests, and
  optimization history. It never owns article text.
- Never write credentials, tokens, or measurement IDs anywhere except the
  GitHub repo files that already contain them.

## Every run: read cheap, process every safely actionable independent item

1. `optimization_context({siteId})` for each operated site. This is served
   from the projection digest (bounded reads). Note `changeAllowed`,
   `activeOptimization`, and `latestMetrics` per site.
2. Evaluate matured pending optimizations first. For each event whose
   `evaluateAfter` has passed, call `optimization_evaluation_context`,
   then record exactly one evidence-backed verdict with
   `optimization_event_update`. Do not edit that same article again in
   the same run.
3. `site_query_opportunities({siteId})` for sites with no blocking active
   optimization on the candidate article. These are newly observed or rising
   queries from saved snapshots.
4. Build a work queue of independent targets. There is no fixed per-run or
   per-day article count. Process as many targets as can be completed safely
   within the run. Skip any site/article where `changeAllowed` is false,
   evidence is stale/partial/insufficient, identity is ambiguous, or a shared
   system failure makes further writes unsafe.
5. For each selected target, read the article file in the site repo. Make the
   smallest edit that tests one explicit hypothesis (title/snippet, one
   section, internal links, freshness, indexation, or similar bounded work).
   One implemented hypothesis/change type per article, never two concurrent
   unevaluated changes on the same article.
6. Commit and push each completed target. Sites deploy automatically.
7. Fetch each live URL yourself: expect HTTP 200 and a canonical URL that
   exactly matches the article URL. If it does not match, do not record that
   target as implemented; note the blocker and continue only if the failure
   is isolated rather than systemic.
8. `optimization_event_create` with phase implemented (set `changedAt` to
   the real push time): observation (the numbers you saw), diagnosis,
   hypothesis, actionType, before/after commit SHAs, and `baselinePeriod`
   copied from the latest saved snapshot periods. Never invent demand,
   numbers, or facts.

## Evaluation rules

- A matured optimization may be evaluated in the same scheduled run as other
  independent work, but the evaluated article is not edited again in that run.
- Use only server-recomputed baseline-vs-post evidence from
  `optimization_evaluation_context`.
- Record exactly one verdict: `improved`, `neutral`, `worsened`, or
  `inconclusive`, with a concise reason and next action.

## Start-today interim rules (while Firestore is throttled)

- Reads and event writes may fail. When they do, keep working only on
  independent Git changes whose safety can still be established, and keep
  notes in the chat: site, article URL, hypothesis, before/after commit SHAs,
  push date. Backfill the `optimization_event` after recovery with the real
  `changedAt` and baseline period (late recording is supported).
- Enforce one-pending-per-article manually until events work again: never
  touch an article twice before its wait matures.
- Thin-data guidance: most sites currently have near-zero query and session
  volume. Prefer content expansion and indexation basics over
  micro-optimization, and expect `inconclusive` verdicts. The 2026-09-18
  local snapshot (SQLite) holds the latest complete weeks per site; ask the
  local agent for top queries/landings when the digest is unavailable.

## Quota hygiene (hard rules)

- Site status always comes from `optimization_context` without `articleId`
  (digest-backed). Never scan full snapshot or article history to "check".
- Read one article's detailed history only when you are about to evaluate or
  modify that article.
- Metric captures run on the weekly staggered schedule outside this task;
  never re-capture from here. If data looks stale, note it and continue with
  what is saved; missing data is never treated as zero.
- If a Firestore write fails with throttling, stop further Firestore writes for
  the run instead of retrying aggressively. Continue Git-only work only when
  it does not risk violating one-pending-per-article state.
