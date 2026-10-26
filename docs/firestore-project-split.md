# Firebase projects: Keywords and Sites

Keywords Operator and Sites Operator run in one deployment and share one
Firestore client (`packages/db/src/firestore.ts`), but their data lives in two
Firebase projects so each has its own free-tier daily read/write budget.

| Project | Id | Credentials |
|---|---|---|
| Keywords | `precise-armor-390514` | `FIREBASE_SERVICE_ACCOUNT_JSON` (`FIREBASE_PROJECT_ID`) |
| Sites | `googlapi-397305` | `SITES_FIREBASE_SERVICE_ACCOUNT_JSON` (`SITES_FIREBASE_PROJECT_ID`, optional) |

Both are set in Vercel and as GitHub Actions secrets (the Sites workflows read
both). `remote_sites_status` and `remote_keyword_status` report
`firestoreRouting` with both project ids (no secrets).

## Which data lives where

Requests are routed by the collection they touch, not by which endpoint calls
them. Sites owns these top-level collections (`SITES_FIRESTORE_COLLECTIONS`),
including every subcollection under them:

`sites` (and `sites/{id}/…`), `articles`, `optimizationEvents`,
`seoPlanningDigests`, `siteDirections`, `seoTasks`, `growthInitiatives`,
`distributionExperiments`, `seoRecoveryControls`, `seoRecoverySites`,
`seoPortfolioPolicies`, `indexationSnapshots`, `indexationQuotaDays`,
`metricSnapshots`.

Everything else is Keywords data: `researchSessions`, `ideaMemory`,
`ideaFeedback`, `keywordTreasury`, `serpUsage`, `serpCache`, `siteStructures`,
`seoCaseSites`, `seoSource*`, `marketSignalSnapshots`, and any collection not
listed above.

- Cross-operator reads route automatically: Sites reading a Site Concept in
  `siteStructures` reads the Keywords project; the Keywords censored-demand
  GSC calibration reading `seoPlanningDigests` reads the Sites project.
- `runs` audit records follow the commit they are written in.
- One commit or batchGet cannot mix Sites and Keywords documents; the client
  refuses it before sending.
- Document names in commit/batchGet bodies are rewritten to the routed
  project, so `firestoreDocumentName` callers need no changes.
- Daily-quota 429 circuits are per project.
- Without Sites credentials, Sites requests fail with a clear error instead of
  falling back to the Keywords project.
- **Adding a Sites collection:** add it to `SITES_FIRESTORE_COLLECTIONS`.
  Otherwise it silently lands in the Keywords project.

## Tests and local development

`FIRESTORE_SINGLE_PROJECT=1` keeps every collection in the Keywords project.
The Firestore doubles in the smoke tests model one project, so `npm run build`
runs them through `scripts/with-single-firestore-project.mjs`, and the CI
runtime job sets the variable. Never set it in production.

## Leftover Sites data in the Keywords project

Until 2026-10-26 everything lived in `precise-armor-390514`. The Sites
collections there are now an unused rollback copy. Nothing in the application
reads or writes them.

They are labeled in that project itself: the document
**`_LEGACY_SITES_DATA_safe_to_delete/README`** lists every leftover collection
with document counts, where the data moved, and which collections must be
kept. At marking time the 15 leftover collections held 4,207 documents and the
newest of them was last updated at 2026-10-26T09:45:57Z, before the copy
started.

To delete them later:

1. Open that README in the Firebase console for `precise-armor-390514`.
2. Confirm no document in the listed collections is newer than
   `newestDocumentUpdateTimeAtMarking`. A newer one means something still
   writes there; stop and investigate.
3. Delete exactly the collections in `collectionsSafeToDelete` (`sites`
   includes all `sites/*` subcollections), then delete the
   `_LEGACY_SITES_DATA_safe_to_delete` collection.
4. Do not delete anything else: the rest of that project is live Keywords data.

Keeping the copy costs nothing against the daily read/write quota.

## History

On 2026-10-26 the Sites data (1,978 documents, 82 collections) was copied to
`googlapi-397305`, production switched over, a delta pass found no changes,
and a field-by-field comparison of every document matched. GitHub Actions runs
40308315824 (inventory), 40308597449 (copy), 40309032530 (delta),
40309290627 (deep verify) and 40310743478 (legacy marker). The one-off
migration workflow and the temporary cutover switch were removed afterwards;
they remain in git history (PRs #267–#269). The Sites project keeps one
historical record of the run at `_migrations/sites-firestore-split`; nothing
reads it.
