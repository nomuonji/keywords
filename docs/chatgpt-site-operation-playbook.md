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

## Every run: read cheap, change one article at most

1. `optimization_context({siteId})` for each operated site. This is served
   from the projection digest (bounded reads). Note `changeAllowed`,
   `activeOptimization`, and `latestMetrics` per site.
2. `site_query_opportunities({siteId})` for sites with no active optimization.
   These are newly observed or rising queries from saved snapshots.
3. Pick at most ONE target per run: a declining query mapped to a
   registered article (`site_article_list`), or a rising query worth a
   bounded improvement. Skip sites where `changeAllowed` is false.
4. Read the article file in the site repo. Make the smallest edit that
   tests your hypothesis (title/snippet, one section, internal links, or
   freshness). One implemented change per article, never two.
5. Commit and push. Sites deploy automatically.
6. Fetch the live URL yourself: expect HTTP 200 and a canonical URL that
   exactly matches the article URL. If it does not match, do not record
   the change as implemented; note it and stop.
7. `optimization_event_create` with phase implemented (set `changedAt` to
   the push time and it becomes implemented automatically): observation
   (the numbers you saw), diagnosis, hypothesis, actionType, before/after
   commit SHAs, and `baselinePeriod` copied from the latest saved snapshot
   periods in step 1. Never invent demand, numbers, or facts.

## Evaluation runs (only after the wait matures)

8. If an event's `evaluateAfter` has passed, call
   `optimization_evaluation_context` for that article. The server recomputes
   baseline-vs-post deltas from saved snapshots; use those numbers only.
9. Record exactly one verdict with `optimization_event_update`:
   `improved`, `neutral`, `worsened`, or `inconclusive`, with a one-line
   reason and the next action. Do not change the article again in the same
   run; pick the next target next time.

## Quota hygiene (hard rules)

- Site status always comes from `optimization_context` without `articleId`
  (digest-backed). Never scan full snapshot or article history to "check".
- Read one article's history only when you are about to evaluate it.
- Metric captures run on the weekly staggered schedule outside this task;
  never re-capture from here. If data looks stale, note it and continue
  with what is saved; missing data is never treated as zero.
- If a write fails with throttling, stop the run and leave everything for
  the next scheduled execution. Retries are built into the backend.
