# Sites optimization PDCA

Updated: 2026-09-16

This document records the existing-page optimization loop that connects local Search Console diagnosis, mapped Blog article delivery, the Firestore Sites control plane, and the existing traffic-aware evaluation worker.

## Closed loop

```text
query-level GSC decline
        ↓
investigate_query_drop Operation
        ↓
site_optimization_candidate
        ↓
fresh complete article-level GSC confirmation
        ↓
inspect real mapped article
        ↓
site_optimization_create
  phase = proposed
  baseline = pinned current complete GSC snapshot
  one observation / diagnosis / hypothesis
        ↓
one existing-page change only
        ↓
blog_writeDraft -> blog_validateDraft -> real site build
        ↓
Git push + live verification persisted in operation_artifacts
        ↓
site_optimization_mark_implemented
  server verifies caller Operation proof
  phase = implemented
  result = pending
  afterCommit = persisted pushed commit
        ↓
14 / 21 / 28 day traffic-aware wait
        ↓
evaluate_site_optimization Operation
        ↓
site_optimization_evaluation_context
        ↓
Agent semantic verdict
        ↓
site_optimization_record_result
        ↓
next action
```

The query-level decline is only a trigger. It is not itself enough to authorize an edit. Before an article can enter the optimization workflow, `site_optimization_candidate` requires a linked Sites record, an exact mapped article, and two complete equal-length non-overlapping article-level GSC snapshots. The newest snapshot must also be fresh.

## Proposal trigger

Defaults:

```text
KEYWORDS_SITE_OPTIMIZATION_PROBE_MINUTES=60
KEYWORDS_SITE_OPTIMIZATION_MAX_SNAPSHOT_AGE_HOURS=48
KEYWORDS_SITE_OPTIMIZATION_MIN_IMPRESSIONS=100
KEYWORDS_SITE_OPTIMIZATION_MIN_PREVIOUS_CLICKS=5
KEYWORDS_SITE_OPTIMIZATION_CLICK_DROP_RATIO=0.30
KEYWORDS_SITE_OPTIMIZATION_POSITION_DROP=2
KEYWORDS_SITE_OPTIMIZATION_CTR_DROP=0.01
```

A candidate is surfaced when at least one of the following is observed against the prior equal-length period:

- clicks fall by at least the configured ratio and the previous period had enough clicks;
- average position worsens by at least the configured threshold while the current period has enough impressions;
- CTR falls by at least the configured absolute threshold while the current period has enough impressions.

These thresholds select work only. They do not diagnose the cause, choose the edit, or determine the later optimization verdict.

## One hypothesis before one change

The Agent must inspect the actual mapped article and supporting evidence first. If a change is justified, it calls `site_optimization_create` before editing. The command derives `baselinePeriod` from the pinned complete GSC snapshot rather than accepting an Agent-supplied period.

The proposed event persists:

- exact site/article identity;
- pinned baseline snapshot and optional comparison snapshot provenance;
- observation;
- diagnosis;
- one falsifiable hypothesis;
- one action type;
- pre-change commit when available.

A proposed or implemented/pending event blocks another optimization on the same article. This prevents overlapping edits from destroying attribution.

`new_article` is intentionally not accepted by the local optimization command or its MCP schema. This loop is for an existing mapped page. New content remains a separate Keywords/Site Concept decision.

## Implementation boundary

A proposed event is not equivalent to an implemented change. The article still passes the existing Blog artifact and build pipeline.

The autonomous MCP path will not accept an Agent assertion that deployment happened. Before `site_optimization_mark_implemented` can update the event, it resolves the exact caller work session and mapped `localPageId`, then reads the persisted `operation_artifacts` evidence for that same Operation. All of the following must be true:

- `validator_status = passed`;
- `build_status = passed`;
- `verified_at` is present;
- the persisted validator result itself has `status = passed`;
- `delivery.status = pushed`;
- `delivery.commit` exactly matches the submitted `afterCommit`;
- `publication.status = published`, which comes from the existing direct live URL/canonical verification path.

A different work session, missing artifact, local-only build, `no_changes`, failed push, mismatched commit, or failed live verification is rejected. In those cases the optimization stays `proposed`; the system does not manufacture an implementation timestamp.

The lower-level Sites command remains reusable by trusted internal/manual paths, while the persistent autonomous Agent MCP is the path that applies this delivery-proof gate.

Once the proof is accepted, the implementation update reuses the existing `optimization_event_update` behavior. `evaluateAfter` therefore receives the existing 14-day persisted minimum, while the analysis layer may extend the effective wait to 21 or 28 days for lower-traffic baselines.

## Operation and budget safety

Mutation commands require an active shared Operation/work session. They also re-check the persisted action budget in the command layer and record audited `runs` entries:

```text
site_optimization.create
site_optimization.mark_implemented
```

The persisted run ledger is the authoritative action-budget check, so direct command use cannot silently bypass the shared Operation budget. The MCP also requires an active work session before exposing either mutation to the persistent Agent.

## Failure behavior

- no linked Sites record -> no optimization proposal;
- no exact mapped article -> no proposal;
- stale, partial, missing, unequal or overlapping GSC evidence -> no proposal;
- material decline but existing proposed/implemented optimization -> block another edit;
- diagnosis does not justify a change -> persist a no-change finding / checkpoint instead of creating an event;
- validation or build failure -> keep the event proposed;
- no persisted Git push -> keep the event proposed;
- submitted `afterCommit` differs from the persisted pushed commit -> reject implementation;
- pushed commit exists but live verification fails -> keep the event proposed;
- proof belongs to another work session / Operation -> reject implementation;
- post-change evidence is not mature -> evaluation remains pending;
- sparse evidence after the traffic-aware window -> Agent may record `inconclusive` rather than inventing success/failure.

## Source-of-truth boundaries

```text
Git / Markdown / MDX
  article body, commit history, rollback

SQLite
  Operation, action budget, local runner, artifacts, build/delivery/live proof,
  raw/materialized observations

Firestore Sites control plane
  article identity, normalized metric snapshots, durable optimization hypotheses/results
```

This loop does not introduce a second scheduler or a second analytics collector. It attaches optimization provenance to the existing `investigate_query_drop`, Blog delivery, metrics projection, and `evaluate_site_optimization` paths.
