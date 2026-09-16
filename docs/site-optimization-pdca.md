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
Git delivery + live verification
        ↓
site_optimization_mark_implemented
  phase = implemented
  result = pending
  afterCommit = real pushed commit
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

`new_article` is intentionally not accepted by the local optimization command. This loop is for an existing mapped page. New content remains a separate Keywords/Site Concept decision.

## Implementation boundary

A proposed event is not equivalent to an implemented change. The article still passes the existing Blog artifact and build pipeline.

`site_optimization_mark_implemented` is called only after the execution workflow has a real pushed commit and live delivery verification. It requires the actual `afterCommit`. If build, Git delivery, or live verification fails, the event remains `proposed` and the Operation records the blocker; the system must not pretend the change was implemented.

The implementation command reuses the existing `optimization_event_update` behavior. `evaluateAfter` therefore receives the existing 14-day persisted minimum, while the analysis layer may extend the effective wait to 21 or 28 days for lower-traffic baselines.

## Operation and budget safety

Mutation commands require an active shared Operation/work session. They also re-check the persisted action budget in the command layer and record audited `runs` entries:

```text
site_optimization.create
site_optimization.mark_implemented
```

This is deliberate redundancy with the MCP execution guard: a direct command call cannot silently bypass the shared Operation budget.

## Failure behavior

- no linked Sites record -> no optimization proposal;
- no exact mapped article -> no proposal;
- stale, partial, missing, unequal or overlapping GSC evidence -> no proposal;
- material decline but existing proposed/implemented optimization -> block another edit;
- diagnosis does not justify a change -> persist a no-change finding / checkpoint instead of creating an event;
- validation or deployment fails -> keep the event proposed;
- pushed commit exists but live verification fails -> keep the event proposed;
- post-change evidence is not mature -> evaluation remains pending;
- sparse evidence after the traffic-aware window -> Agent may record `inconclusive` rather than inventing success/failure.

## Source-of-truth boundaries

```text
Git / Markdown / MDX
  article body, commit history, rollback

SQLite
  Operation, action budget, local runner, artifacts, raw/materialized observations

Firestore Sites control plane
  article identity, normalized metric snapshots, durable optimization hypotheses/results
```

This loop does not introduce a second scheduler or a second analytics collector. It attaches optimization provenance to the existing `investigate_query_drop`, Blog delivery, metrics projection, and `evaluate_site_optimization` paths.
