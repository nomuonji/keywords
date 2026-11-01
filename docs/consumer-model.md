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
- Importing the My Portal candidate register and catalogue.


## Contract

- `id` is a lowercase slug and is the Firestore document id, so import and update are deterministic.
- Updates require `expectedRevision`; a stale revision fails instead of silently overwriting.
- Every save freezes `consumerModels/{id}/versions/{version}`. A published definition cannot be rewritten
  by a later edit; a changed definition needs a new version.
- `save` rejects a model with no behaviour variables or no research procedure — a premise without an
  observation plan is not usable by research.
- Definitions keep `objectives.reach` and `objectives.conversion` separate, because reach (stop/click/share)
  and conversion (purchase/application/revenue) must never be scored in the same column.
- `evidencePolicy.nonEvidence` records what is *not* market evidence (the operator's personal taste, past
  posts, prior rejected ideas, candidate lists). This is a hard boundary for the research that consumes
  the model.
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
