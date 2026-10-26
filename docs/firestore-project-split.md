# Keywords / Sites Firebase project split

Keywords Operator and Sites Operator share one deployment and one Firestore
client (`packages/db/src/firestore.ts`), but their data can live in two
Firebase projects so each gets its own free-tier daily read/write budget.

## Ownership

Requests are routed by the collection they touch, not by which endpoint calls
them. Sites-owned top-level collections (`SITES_FIRESTORE_COLLECTIONS`):

`sites` (with every `sites/{id}/…` subcollection), `articles`,
`optimizationEvents`, `seoPlanningDigests`, `siteDirections`, `seoTasks`,
`growthInitiatives`, `distributionExperiments`, `seoRecoveryControls`,
`seoRecoverySites`, `seoPortfolioPolicies`, `indexationSnapshots`,
`indexationQuotaDays`, `metricSnapshots`.

Everything else stays in the legacy project, now the Keywords project:
`researchSessions`, `ideaMemory`, `ideaFeedback`, `keywordTreasury`,
`serpUsage`, `serpCache`, `siteStructures`, `seoCaseSites`, `seoSource*`,
`marketSignalSnapshots`, and any collection not listed above.

- Cross-operator reads route automatically: Sites reading a Site Concept in
  `siteStructures` reads the Keywords project; the Keywords censored-demand
  GSC calibration reading `seoPlanningDigests` reads the Sites project.
- `runs` audit records follow the commit they are written in.
- One commit or batchGet cannot mix Sites and Keywords documents. The client
  refuses such a request before sending it; none exists today.
- Document names inside commit/batchGet bodies are rewritten to the routed
  project, so `firestoreDocumentName` callers need no changes.
- Daily-quota 429 circuits are per project: an exhausted Sites project no
  longer blocks Keywords, and the reverse.
- New Sites collections must be added to `SITES_FIRESTORE_COLLECTIONS`, or
  they silently stay in the Keywords project (still working, but on the
  Keywords budget).

## Build-time tests

`npm run build` runs its Firestore smoke tests through
`scripts/without-sites-firestore-env.mjs`, which strips the `SITES_*`
variables so the deterministic doubles never inherit the deployment's live
routing settings.

## Configuration

| Where | Name | Value |
|---|---|---|
| Vercel + GitHub secret | `FIREBASE_SERVICE_ACCOUNT_JSON` | legacy / Keywords project (unchanged) |
| Vercel + GitHub secret | `SITES_FIREBASE_SERVICE_ACCOUNT_JSON` | key of the new Sites project's service account (Firebase console → Project settings → Service accounts → Generate new private key; any account with Cloud Datastore User works) |
| Vercel env / GitHub var (optional) | `SITES_FIREBASE_PROJECT_ID` | defaults to the service account's `project_id` |
| Vercel env + GitHub var | `SITES_FIRESTORE_TARGET` | `legacy` (default) or `sites` — the cutover switch |

`SITES_FIRESTORE_TARGET=sites` without Sites credentials fails every Sites
request loudly instead of silently writing to the legacy project.

**Interlock.** The flag alone never moves traffic onto an empty project. Sites
requests keep using the legacy project until the migration's `copy` has
finished, which it records in the Sites project at
`_migrations/sites-firestore-split` (for exactly this source/target pair).
Each process checks that record at most once a minute while waiting, then
switches by itself and never switches back. So the flag can be set before,
during or after the copy; the actual cutover is the moment the copy finishes.
`remote_sites_status` and `remote_keyword_status` expose `firestoreRouting`
(mode, both project ids, no secrets).

## Migration runbook

The new project needs a Firestore database in Native mode, `(default)` id.

Run the **Sites Firestore migration** workflow (`workflow_dispatch`).

1. `inventory` — read-only. Lists every collection with legacy/Sites counts
   and the reads the copy will need. Writes nothing.
2. `copy` — before cutover. Copies all Sites documents to the new project.
   Resumable: it stops before `max_source_reads` (default 30,000 of the
   legacy project's 50,000/day) or `max_target_writes` (18,000 of 20,000/day),
   or on a daily-quota 429, and the next run continues from the checkpoint
   stored in the Sites project at `_migrations/sites-firestore-split`.
   Legacy `sites/{id}/indexationUrls` rows already folded into an
   `indexationBundle` are not copied (they are only read when no bundle
   exists). Refused once the copy has finished (that record is the cutover; redoing
   the copy would overwrite live data — use `delta`). `restart` only restarts
   an unfinished copy.
3. Cutover — needs `SITES_FIRESTORE_TARGET=sites` in Vercel (redeploy) and as
   a GitHub Actions variable. If it is already set, cutover happens on its own
   within about a minute of the copy finishing.
4. `delta` — re-reads the legacy project and brings over everything that
   changed there since the copy started (writes made before every writer
   switched): creates, updates and deletes. A document that changed in both
   projects keeps the Sites version and is reported as a conflict; documents
   created live in the Sites project are never touched. Resumable per
   collection.
5. `verify` — counts per collection; `deep` compares every document's fields.
   After cutover, differences are expected only for documents the live Sites
   Operator wrote since.

The legacy project's copy of Sites data is never deleted by this tooling. It
is the rollback source: set `SITES_FIRESTORE_TARGET=legacy` to go back (writes
made in the Sites project after cutover would then have to be copied back by
hand). Delete it only after the split has been stable for a while.
