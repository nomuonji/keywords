# Consumer models (market-research premise)

A consumer model is the premise a market-research pass assumes **before** it observes anything: which
behaviour variables to look at, what counts as evidence, and what the model refuses to treat as evidence.
Research without a named premise silently mixes different theories of the buyer, so the premise is stored
as a first-class object instead of living in a prompt.

This is the keyword side owning the market-research *thinking method*. Authoring of the premise is not a
routine research write.

## Where it lives

| Layer | Location | Purpose |
| --- | --- | --- |
| Runtime canonical | Firestore `consumerModels` (+ `consumerModels/{id}/versions/{version}`) | Read by the local stdio MCP **and** the remote treasury MCP |
| Frozen migration seed | `consumer-models/*.v1.json` | Original text from My Portal plus the audit of what was and was not migrated |

Firestore, not local SQLite, because the remote MCP is serverless and cannot persist SQLite. If the model
definitions lived only in the local workspace database, the remote deployment would see a different (empty)
premise after any local-only period. Both runtimes address the same collection through
`firestoreForTarget('keywords', ...)`, the same route the keyword treasury already uses.

The seed is **frozen at the migration version**. Later definition changes move the Firestore revision
forward and write a new immutable version document; they do not rewrite the seed.

## Tools

Local stdio MCP:

- `consumer_model_list`, `consumer_model_get` — read (allowed even while agent operations are paused)
- `consumer_model_save`, `consumer_model_archive` — writes, in `budgetedTools`, so they need an active shared `Operation`
- `consumer_model_import_seed` — reads a seed file from the repo; local runtime only, idempotent by content hash

Remote treasury MCP (`KEYWORDS_MCP_TOOL_NAMES`, server 1.30.0):

- `consumer_model_list`, `consumer_model_get`, `consumer_model_save`, `consumer_model_archive`

The remote has no `consumer_model_import_seed`: its function bundle has no repository working directory.

## Where the premise is consumed

The premise is declared **per run, explicitly**. There is no project-level binding: deciding which model a
site's research should assume is orchestration, not measurement, so it stays outside the operator.

| Layer | Field | Meaning |
| --- | --- | --- |
| `discovery_jobs.consumer_model_ids_json` | per run | the premise recorded for that run |
| `discovery_candidates.consumer_model_ids_json` | per candidate | copied from the job at insert, so lineage survives later job edits |
| Treasury document `consumerModelIds` | per saved keyword | `keyword_treasury_save({candidates:[{..., consumerModelIds:[...]}]})` |

`operation_discovery_start({ ..., consumerModelIds: ['daishu-consumer'] })` and the human
`discovery.start` path both take the ids directly. Ids are validated as slugs (deduplicated, invalid
values rejected) but not resolved against Firestore, so a Firestore outage cannot block a research run.
A run that names no model records an empty premise rather than an implied one — the absence is visible,
not guessed.

## Not implemented yet

- Aggregating adoption per model (how many candidates from premise X reached the treasury). The lineage
  fields exist; no rollup view reads them yet.
- A values layer: the model stores variables and questions, not observations. Without per-variable
  observations the `changeGate` ("observations that the previous version could not explain") cannot be
  satisfied, so a general rule can never be revised on evidence.
- Generic angles such as `やり方` still produce weak combinations against person categories.


## Generation layer (v1.2+)

A model is not only a measurement instrument. It also states *how this collective decides* and *which
angles make them react*, so research seeds can be produced instead of invented each time.

| Field | Meaning |
| --- | --- |
| `thinking[]` | claims about how the collective decides, each with its own `label` (start at `HYPOTHESIS`) and `evidenceRefs` |
| `preferences` | `like[]` / `avoid[]` — what it gravitates to and drops |
| `seeds[]` | angles: `{ key, label, template, kind, appliesTo }`. `template` must contain `{item}`; `appliesTo` narrows which pool categories the angle may cross with |

`appliesTo` exists because a blind cross product produces nonsense ("person + 代わり"). An angle without
`appliesTo` applies everywhere, which is only correct for genuinely universal angles.

## Seed pools (material, not evidence)

Concrete subjects live in SQLite `consumer_model_seeds`, not in the Firestore definition: pools churn
weekly while a model changes rarely, and every generated seed must stay traceable to the pool item.

| Pool | Source | Label | Count |
| --- | --- | --- | --- |
| `intuition` | the operator's own candidate list (My Portal `OMHfc7pNvUTLwGoK9kC1`, "偏見100％") | `HYPOTHESIS` | 70 |
| `observed-trend` | public rankings/surveys (My Portal `bjOWtn95gWAABcp0TIAO`, sources S1–S11) | `REPORTED` | 320 |

Files: `consumer-models/seed-pools/*.json`. Import is idempotent per pool + text, so re-importing a file
never duplicates items.

- `consumer_seed_pool_import` — upsert items (budgeted write)
- `consumer_seed_pool_list` — read items with provenance label
- `consumer_model_seeds({ modelId, poolId?, count?, label?, category?, rotationKey? })` — cross angles with
  material. Every seed returns `{ text, angle, item, itemLabel, itemSource, itemOrigin }`, and ordering
  rotates by `rotationKey` so repeat runs differ.

A pool item is material, never evidence. A `REPORTED` item means "a public ranking mentioned it", not
"people buy it".

## Readings (how a model grows)

A definition alone can only be re-typed. Readings live in SQLite `consumer_model_observations`, one row
per `(target_type, target_key)` with its own evidence label:

| Field | Meaning |
| --- | --- |
| `target_type` / `target_key` | `variable:attention`, `angle:meaning`, `thinking:3` |
| `finding` | what was actually seen, in that target's terms |
| `label` | `OBSERVED` / `REPORTED` / `INFERRED` / `HYPOTHESIS` / `COUNTEREVIDENCE` / `UNKNOWN` |
| `value`, `subject_id`, `source_url`, `observed_at`, `population`, `denominator`, `limitation` | the measurement and its boundaries |

- `consumer_model_observe` — record one reading (budgeted write)
- `consumer_model_evidence` — counts per target and label, counterevidence count, recent findings,
  **and the targets that have never been tested**

`consumer_model_evidence` is the honest view: it reports `coverage` (e.g. angles 7/15, variables 0/10) and
`untested`. A model whose variables have zero readings is not validated, however complete it looks.
Readings are what a later `changeGate` revision points at; the definition never silently absorbs them.

## Contract

- `id` is a lowercase slug and is the Firestore document id, so import and update are deterministic.
- Updates require `expectedRevision`; a stale revision fails instead of silently overwriting.
- Every save freezes `consumerModels/{id}/versions/{version}`. A published definition cannot be rewritten
  by a later edit; a changed definition needs a new version.
- `save` rejects a model with no behaviour variables or no research procedure — a premise without an
  observation plan is not usable by research.
- `save` rejects a seed angle whose template has no `{item}` — it could never be crossed with a pool and
  would sit unused.
- Definitions keep `objectives.reach` and `objectives.conversion` separate, because reach (stop/click/share)
  and conversion (purchase/application/revenue) must never be scored in the same column.
- `evidencePolicy.nonEvidence` records what is *not* market evidence (search volume as demand, own-site
  rankings, the requester's taste, candidate lists, single anecdotes). This is a hard boundary for the
  research that consumes the model.
- Contemptuous or derogatory search terms are legitimate *research input* (real demand exists). The rule
  against mocking tone is an output/production rule, not a constraint on observation.
- Changing the general rules needs the `changeGate` (independent sources across data types, counterevidence,
  scope, verification method). A routine research pass may only produce a proposal, not a new version.

## Not migrated here

The My Portal canonical card carried a lot of its own management context. Kept out of the model on purpose,
with reasons recorded in `provenance.droppedItems` of the seed:

- seven idea-card kinds (candidate register, object inventory, case study, hypothesis cluster, observation,
  experiment, change proposal) — the workspace already has `discovery_candidates`, `sources`, `pages`,
  `decisions`
- the candidate register / inventory ids — those are unverified candidate queues, not model definition;
  importing them is separate work
- management-schema metadata, production wording rules, and the routine-job lifecycle

## Not implemented yet

- Project-level binding (`which model does this project assume by default`) and passing the premise into
  `operation_discovery_start` / `discovery_context`. Until that exists, a research pass reads the model
  explicitly with `consumer_model_get` and records it itself.
- Lineage from a discovery candidate to the model that produced it, and model-level outcome counts.
- Importing the My Portal candidate register and catalogue.
