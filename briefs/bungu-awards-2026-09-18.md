# Evidence brief: bungu awards queries (2026-09-18)

Source: local GSC snapshots in keywords SQLite (Firestore is throttled;
this file is the handoff until digests are readable again).
Site: https://bungu.antonbase.com (EN)
Registry: `wiki-bungu` (111 articles mirrored).

## Measured queries (week 2026-08-18~08-24; 9/01~09/14 weeks are near-empty)

| query | impressions | clicks | avg position |
|---|---|---|---|
| japan stationery awards 2026 | 46 | 0 | 6.4 |
| japanese stationery awards 2026 | 24 | 0 | 6.6 |
| hobonichi vs jibun techo | 9 | 0 | 7.7 |
| jibun techo vs hobonichi | 6 | 0 | 6.7 |
| 2026 japan stationery awards | 4 | 1 | 5.3 |
| stationery awards | 3 | 0 | 46.7 |

## Existing coverage (local pages)

- Pillar: `Japan Stationery Awards 2026: winners and what they actually mean`
  `/blog/2026-08-16-japan-stationery-awards-2026/`
- Winners list: `Every 2026 Stationery Award winner actually worth importing`
  `/blog/2026-08-15-awards-winners-worth-importing/`
- Controversy: `The 2026 awards controversy nobody in the West covered`
  `/blog/2026-08-14-awards-controversy/`
- Hub: `/awards/`, category `/blog/category/awards/`, tags
- GAP: no hobonichi-vs-jibun-techo comparison article.

## Task options (pick exactly ONE for this cycle)

- **A (snippet CTR)**: retitle/resnippet the pillar toward the measured
  queries (winners list intent). One edit, no URL change.
- **B (coverage)**: new `hobonichi vs jibun techo` comparison article.
  New URLs only after checking no existing page answers it.

## Rules for this cycle

- One implemented change total. Do not touch a second article.
- After push: fetch the live URL, require HTTP 200 and exact canonical
  match. If it fails, stop and note it.
- Keep notes for later event backfill: hypothesis, before/after commit
  SHAs, push date (UTC), baseline period `2026-08-18~2026-08-24`.
- Do not invent demand or facts. Volumes above are the whole signal;
  most other sites currently measure near zero.
