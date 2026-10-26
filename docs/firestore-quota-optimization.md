# Sites Operator Firestore read budget

The 2026-10-22 change reduces repeated document reads without lowering SEO
measurement or Worker schedules and without caching claims or mutation gates.

## Task queries

`seoTaskList` sends all supplied equality filters (`siteId`, `status`,
`deploymentVerification.status`, `taskType`) to Firestore in one AND query.
The old path selected one field and discarded other matches locally, so
completed+pending could read ready/cancelled tasks and site+status could read
the site's full task history. Equality-only queries use single-field index
merging; no new compound index or migration is required. The existing final
normalization, filters and descending updatedAt sort are retained.

The unfiltered browser feed reads exactly the requested limit instead of up
to five times that count (60 instead of 300 at the UI default). Article-only
filtering retains the old bounded overfetch because membership is still
checked locally. Filtered queries still read up to 1000 matching records to
preserve updatedAt ordering without compound indexes; at that ceiling they
fail explicitly rather than silently returning truncated results. This is
not a claim that all task reads are now O(limit).

Regression coverage includes 1100 unrelated pending records plus one
completed/pending record: the combined query returns that task and reads one
document. This is a deterministic adapter test, not production usage telemetry.

## Public UI projections

Successful existing public GET views for sites, article metadata, indexation
history and task summaries use `Vercel-CDN-Cache-Control: max-age=120,
stale-while-revalidate=60`. The browser revalidates, while repeated viewers of
the same URL share the CDN response for two minutes (up to one further minute
while revalidating). Errors and a degraded indexation overview remain uncached.
The UI already exposes the response's generatedAt. Per-site history and
article views remain separated by their query strings.

These headers must never be used on authenticated MCP, claim/heartbeat,
revision-sensitive point reads or mutation endpoints. The public routes
already exposed their projections before this change; no new data is exposed.

## Exhaustion handling

A known daily quota 429 opens the existing in-process circuit for five minutes
instead of 30 seconds. Transient or unknown 429s retain bounded backoff, and
503 retry behavior is unchanged. The circuit is local to one warm process;
it is not a durable project-wide quota controller and a new process may probe
again. This reduces futile retry traffic; it cannot restore an exhausted quota.

## Verification and limits

Check CI and production's exact commit, then make one representative combined
MCP list request. Repeat the same public GET URL to observe CDN HIT/STALE and
its unchanged generatedAt within the cache window. Do not use changing cache
busters to test a hit. Observe the next normal day of Firestore reads/writes
and 429 incidence; no percentage reduction for the whole project is asserted.
Other operators may share the same Firebase project, so their load is outside
this bounded patch. Sites and Keywords data can now be split into separate
projects: see docs/firestore-project-split.md.

References:

- https://firebase.google.com/docs/firestore/query-data/index-overview
- https://vercel.com/docs/caching/cache-control-headers
