# Agent-driven Operations — Implementation Status

最終更新: 2026-09-29

## Remote scheduled SEO loop — evidence and remaining gap (2026-09-29)

This repository's GitHub measurement workflow is not the Agent HQ SEO Manager
or Luna Worker scheduler. Scheduled Manager Methods v22/v25/v26 have completed
their own control-plane runs. In the latest recorded v26 run, the Manager read
five ready candidates, wrote per-candidate no-action reasons, and dispatched
zero Worker changes because the evidence did not justify a material edit. A
later Worker attempt could not resolve its active Method or claim work because
My Portal returned `Quota exceeded`.

The manager's safe no-action behavior and scheduled claim/finish path are
verified. The requested autonomous outcome loop is **not** verified: no one
scheduled production run has been evidenced from actionable task selection
through Worker execution, repository delivery, live acceptance, persisted
optimization event, and a matured evaluation. The first end-to-end production
improvement remains pending under Phase 2 in `site-registry-handoff.md`.

The later v25 measurement read improved GSC snapshot coverage from 1/14 to
14/14 registered sites. The portfolio remains 14/16 registered, and this
measurement improvement alone does not demonstrate an optimization or its
effect. PR #50 (`Sync verified Blog publication receipts`) adds a prerequisite
for newly published pages to enter the exact article registry; it is open and
CI-green, not merged or deployed. My Portal's SystemChangeSet could not be
updated during the quota incident, so this repository record preserves the
code and runtime evidence pending control-plane reconciliation.

## 2026-09-29 publication registry handoff

Verified Blog publication receipts can now create a missing Sites article record when the approved handoff ID/version/origin, published HTTP 200 + canonical evidence, unique local page, and one exact source path+SHA in the confirmed Blog snapshot agree. Deterministic IDs make retries idempotent; paused/archived records and ambiguous or incomplete source mappings remain unchanged. This closes the gap where newly published pages never entered article-level SEO measurement. It does not mass-backfill snapshot content or make measurement jobs run optimization work.

Validation for this follow-up: `npm run test:site-operations-bridge`, `npm run typecheck`, and full `npm run build` passed locally. It is prepared on the existing GitHub PR branch and awaits remote CI/Manager review; it has not been deployed.

## 状態

Agent運用基盤とheadless記事生成は実装済み。今回、過剰だった操作UIと重複HTTP導線を削除し、正規フローを1本に寄せた。

```text
Operation
 -> keyword/evidence
 -> article artifact
 -> validation/build
 -> local complete
 -> Blog delivery
 -> receipt
 -> outcome/measurement
```

## Human UI

通常画面は3つ。

| 画面 | 見るもの |
|---|---|
| 運用 | Agent activity、keyword採否と理由、最近の記事、公開後評価 |
| 記事 | 大量記事の検索/絞り込み、制作・検証・公開・評価の詳細 |
| サイト | site状態、記事/公開/評価集計、Agent、Autopilot設定 |

旧Discovery/Keyword/Planning/Work/Review/Blog/SEO/Autopilot専用画面は削除済み。

## Scale

### Articles

- server-side query
- project/status filter
- 50件/page
- compact rows
- expandable details

### Sites

- search
- attention-first sorting
- ON/OFF/attention filter
- compact rows
- expandable settings/state

全siteをsidebarへ並べたり、全記事を一括取得したりしない。

## Agent observability

人間から見える情報:

- Agentの現在作業
- blocker / next action
- selected/rejected keyword
- keyword selection reason
- generated article
- validator/build/revision
- publication status
- post-publication outcome/metrics

内部IDや低水準runを通常画面の主役にしない。

## Public API

Agent writeの正規経路は `/operations`。

低水準commands/MCPは内部能力として残すが、旧画面直結HTTP CRUDは削除した。

APIにbackground schedulerはない。scheduler ownerは `npm run autopilot` のpersistent workerのみ。

## Safety / completion

- verified artifactなしのOperation complete不可
- independent validator + site build必須
- executor common failureはcooldownへ分離
- explicit pause/human boundaryを自動resumeしない
- same-content revision loopはno-progressで停止
- authorized Blog handoffはverified artifact必須
- receiptは冪等

## CI

2026-09-09 cleanup branch run #485:

- runtime acceptance: pass
- domain/db/research/commands/api/cli/mcp/web typecheck: pass
- production web build: pass
- article paging/search: pass
- keyword selection reason: pass

## 残るもの

本番Blog/site/providerを必要とするdeployment verificationのみ。

- 実repositoryでの生成/build
- 実publish/canonical確認
- 実provider limit下の長時間復旧
- 公開後SEO成果

