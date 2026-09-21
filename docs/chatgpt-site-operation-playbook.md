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
5. For each selected target, read the article file in the site repo. Make the
   smallest edit that tests one explicit hypothesis (title/snippet, one
   section, internal links, freshness, indexation, or similar bounded work).
   One implemented hypothesis/change type per article, never two concurrent
   unevaluated changes on the same article. Unregistered articles are
   registered on demand here: when you open an optimization event for one,
   or when you publish a new article, create its record with
   `site_article_save` (one write) so later evaluations can attribute
   metrics to it.

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
