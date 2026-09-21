# Site registry handoff (phased onboarding → remote operation)

Updated: 2026-09-18. Owner: agent Vega (local) + ChatGPT (remote MCP).
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

## Phase 2 — first ChatGPT-driven PDCA cycle (remote)

Needs: ChatGPT scheduled task + connected GitHub site repos + MCP auth.
Playbook (TBD as pastable instructions): digest read → diagnose →
one-article edit + push in the site repo → live URL check →
`optimization_event_create` (implemented, real SHAs, baseline = saved
snapshot periods) → wait 14/28d → `optimization_evaluation_context` →
`optimization_event_update` verdict. Server enforces one-pending-per-article
and window maturity; keywords gates are bypassed on direct pushes.

- [ ] Write the playbook and run one pilot article improvement end to end
- [ ] shikaku scope decision: site-level only, or bounded article subset

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
