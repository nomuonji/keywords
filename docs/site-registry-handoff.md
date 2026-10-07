# Site registry handoff (phased onboarding → remote operation)

Updated: 2026-09-20. Owner: agent Vega (local) + ChatGPT (remote MCP).
Source of truth for registry state is Firestore; this file tracks PHASES only.
Do not record secrets here. IDs are local project UUIDs (stable, registry-linked).

## Phase 0 — done (2026-09-18, local)

- [x] 16 real sites registered in Firestore (`site_registry_save`, rev 1 each)
- [x] Blog bindings refreshed from fresh snapshots (14 + whisky-jp/otonano)
- [x] Sitemap inventory synced with verified URLs (all 16 live sitemaps probed)
- [x] Autopilot enabled x16 (agent autonomy; worker stays stopped)
- [x] 15 stale worker operations cancelled (human-authorized agent execution)
- [x] `records` collection kind implemented, tested, applied to
      book-discovery / free-consult / job-world mappings (Blog-local files)
- [x] Firestore retry/backoff, write pacing, site digest fast path (+ smokes)
- [x] On-demand batch script + site-measurement workflow + secrets, trial green
- [x] danjoron excluded (no DNS, no git repo); kokeniwa untouched (out of scope)

## Phase 1 — pending Firestore quota recovery (auto)

Local evidence is complete and preserved; only cloud projection is queued.
Next scheduled run (Tue 18:00 UTC, group A) retries idempotently. Verify Wed AM:

- [ ] whisky-jp: projection (import/sync/GA4 done 9/18, articles ~291)
- [ ] otonano_reset: projection (import/sync done 9/18; GA4 property missing)
- [ ] book-discovery / free-consult / job-world: projection with records bindings (465/70/150 sources)
- [ ] chonmage-en/ja: GA4 capture + projection (GSC weeks complete 9/18)
- [ ] shikaku: GA4 retry (article registry deferred by design, 623 > 500 bound)
- [x] bungu / omiyage: GA4 property IDs resolved and registered
      (bungu 549938997, omiyage 549962224; from on-page G-IDs via Admin API)
- [ ] bungu / omiyage: capture + projection
- [ ] Verify digests: `optimization_context` returns `servedFrom: digest` per site

Verify with (reads only):
`optimization_context({siteId})` → servedFrom, changeAllowed, latestMetrics.

## Phase 2 — ChatGPT-driven scheduled PDCA (remote)

Needs: ChatGPT scheduled task + connected GitHub site repos + MCP auth.
The scheduled task is not limited to one article per day or one article per
run. Each execution should evaluate matured events first, then process as many
independent, safely actionable targets as can be completed. The hard boundary
is per article: never create a second implemented, unevaluated optimization on
the same article.

Flow: digest read → matured-event evaluation → build independent work queue →
bounded article edits + pushes → live URL/canonical verification →
`optimization_event_create` with real SHAs/baseline periods. Server enforces
one-pending-per-article and window maturity; direct Git changes must preserve
the same invariant.

- [x] Write the remote scheduled-operation playbook
- [x] Create the ChatGPT scheduled Site SEO Operations task
- [ ] Run first production improvements end to end and confirm event persistence
- [ ] shikaku scope decision: site-level only, or bounded article subset

### Runtime evidence (2026-09-28)

- Scheduled Manager runs using Methods v22, v25, and v26 completed their
  start/claim/finish cycle. The v26 run (`pZX3aGfEWTowHliXGebT`) read all five
  ready candidates, recorded why each lacked sufficient material evidence,
  and dispatched **zero** Worker changes. This proves scheduled Manager
  execution and honest no-action handling; it does not prove the SEO work loop.
- The Worker history contains a separate chonmage-en delivery Work Item
  (`YG4rXEQAgmNF2UU8xdCa`), marked `live_verified` for Shinjuku Nightlife and
  Golden Gai. Its first seven-day outcome evaluation is due **2026-10-05
  09:00 JST**. This is distinct from BUNGU; its implementation commit was not
  identified in the available record. Publication acceptance is proven for
  that item, but the result evaluation is not yet mature.
- The Worker also archived at least four read-only analysis tasks, including
  the ja.chon-mage exposure diagnosis, en.chon-mage internal-link audit,
  multi-site thin/rich cohort analysis, and shikaku thin-content cohort review.
  These are completed investigations, not content changes.
- The BUNGU Custom 823 rewrite reached GitHub main at
  `3201f1f63a82db6589d0953084bd24b93960f0c5`; its verification marker reached
  main at `6767cd7336c12585af52a9355922e12d9a83bc8d`. A later Manager Run
  (`WqgLm6F2krTg1wBuxx87`) verified the Custom 823 page and marker plus two
  Stationery Awards pages in production (HTTP 200, canonical, index/follow,
  expected content). However, safety checks rejected the state reconciliation
  writes, so the two BUNGU Work Items and related Incident were not archived or
  resolved in Agent HQ. Production delivery is verified; control-plane task
  completion is not.
- Measurement coverage improved from the earlier v22 observation of GSC
  snapshots on 1/14 registered sites to 14/14 registered sites in a later v25
  run. The portfolio still has only 14/16 sites registered; GA4 completeness
  and aligned periods remain insufficient for a 16-site comparison.
- One chonmage-en delivery is awaiting matured outcome readback; three BUNGU
  production pages were verified but their Work Item state reconciliation did
  not persist. The latest v26 Manager run dispatched no new Worker change, so
  repeatable end-to-end completion remains unproven. Phase 2 remains open.
- The separate Luna Worker recurrence later failed before method resolution
  and queue claim when My Portal returned `Quota exceeded`. This is a current
  execution blocker, but it does not explain the earlier zero dispatches: the
  v26 Manager run completed and chose zero because the five candidates did not
  meet its material-evidence gate.
- `nomuonji/keywords` PR #50 adds safe, idempotent publication-receipt
  registration for article-level measurement. It is open and CI-green, but
  has not been merged, deployed, or production-readback verified.
- A separate candidate-selection defect was confirmed in code: the Manager
  inspected only the first 100 article/metric/event rows, while explicit article
  context and proposal writes also searched only that first page. This could
  hide actionable pages on larger sites. The branch now reads up to 1,000 rows
  for selection and fetches explicitly named articles by ID; the regression
  smoke places a qualified article beyond row 100. Targeted smoke, typecheck,
  and full build pass. The Firestore query is still bounded at 1,000 rows, so
  cursor pagination remains open for larger registries. This fix is code- and
  CI-pending, not yet deployed.

## Phase 3 — optional hardening (only if quota still bites)

- [ ] Firestore jobQueue: ChatGPT writes measurement requests, scheduled
      workflow picks them up (ChatGPT cannot trigger Actions directly)
- [ ] Blaze with budget cap ($1–5) if free-tier quota keeps exhausting
- [ ] Metric snapshot retention policy (history unbounded in Firestore scans)

## Standing rules

- Worker stays stopped. `start-maintenance.ps1` is not used.
- Measurement cadence: weekly staggered (workflow groups a/b/c) + on-demand.
- Raw rows live in SQLite only; Firestore keeps registry, idempotent
  snapshots, top-200 queries embedded, and one digest per site.
- Article bodies live in GitHub site repos; keywords never owns them.
- There is no fixed daily article quota for ChatGPT operations. Throughput is
  bounded by evidence quality, deploy verification, Firestore health, and the
  one-pending-per-article invariant.
- bungu/omiyage GA4 properties now known (see Phase 1); kampo/shikaku-style
  `github_pages` mentions in docs are unverified, registry uses `other`
  except whisky-jp (`cloudflare_pages`, README-evidenced).

## Modeling decisions

- Articles stay one-document-per-article (2026-09-18). Bundling all of a
  site's articles into one document was rejected: whole-doc conflicts on
  concurrent writes, 1MB cap risk at shikaku scale, lost server-side
  queryability, and steady-state writes are already ~zero via idempotent
  reuse. Transport is bundled instead (`auditWriteBatch`, max 200
  records/commit, one audit record per batch, single-save fallback on
  conflict), which captures nearly all backfill savings without model churn.
- Registry means "articles under PDCA management" (2026-09-19,
  `KEYWORDS_ARTICLE_SYNC_MODE=lazy` in scheduled runs). New records are
  created explicitly via `site_article_save` when an optimization event
  opens or an article publishes; scheduled projections only refresh
  registered articles and defer the rest. Backfill-all upfront was
  abandoned: it burned the shared quota with no operational benefit.
