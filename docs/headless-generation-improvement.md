# ヘッドレス記事生成 — 現行仕様

最終更新: 2026-09-09

## 目的

Keywords のコアは、Agent がキーワード選定から記事生成、検証、公開引き渡し、公開後評価までを継続実行できることにある。UI は操作工程を増やす場所ではなく、その流れを目視するための観測窓とする。

## 正規フロー

```text
Operation
  -> keyword / evidence selection
  -> brief
  -> article file
  -> independent validator
  -> site build
  -> verified artifact
  -> local complete
  -> authorized Blog handoff
  -> idempotent receipt
  -> outcome / measurement
```

Agent の exit 0、企画作成、page approval だけでは記事制作は完了しない。

## Scheduler

Scheduler owner は persistent worker だけ。

```text
npm run autopilot
```

API は background timer を持たない。旧 API scheduler、owner切替設定、fallback entrypoint は削除済み。

worker は project ごとの SQL lease を取得して due project を tick する。同一 project の同時 tick は `tick_locked` で排他される。

## Executor

provider/runtime 共通障害は site blocker にしない。

- rate limit
- auth failure
- provider outage
- executable / MCP bootstrap failure
- runtime mismatch
- executor-wide network failure

これらは executor health/cooldown に記録し、cooldown 中は新規 claim を止める。

## Article artifact

記事制作 Operation の complete 条件:

- real article file
- article/page identity
- content SHA-256
- source IDs
- validator result
- site build result
- before/after hash
- verified timestamp

保存は temp write -> fsync -> rename -> hash の順で行う。

`operation.complete` は verified artifact がなければ拒否する。

## Independent validator

Agent の自己採点とは別に、保存済み本文と source evidence を検査する。

- file/frontmatter
- article identity
- source-backed claims
- numeric/entity consistency
- reader-question coverage
- duplicate/cannibalization
- fabrication pattern
- links
- site build

同じ content/source/validator version は revision key で再利用する。

## Revision / resume

自動再開する blocker は次だけ。

- `quality_revision_required`
- `artifact_missing`

自動再開しないもの:

- `site_dependency_failed`
- `executor_unavailable`
- `human_decision_required`
- `explicit_pause`
- `budget_exhausted`

revision は同じ Operation/article identity を維持する。live session は再利用し、同じ本文・同じ gate で進展がなければ no-progress を増やし、上限で human review に送る。

## Publication boundary

`publication_authorized=true` の handoff には verified local artifact が必要。

DB trigger でも validator/build 未通過の authorized handoff を拒否する。

Blog receipt は event ID/version で冪等化し、published 遷移には HTTP/canonical evidence を要求する。

## UI

通常UIは3画面だけ。

### 運用

- Agent が今やっていること
- blocker / next action
- 採用・見送りキーワード
- キーワード選定理由
- 最近生成された記事
- 公開後評価

### 記事

大量記事を前提に、50件単位の server-side paging を使用する。

- 全文検索
- site filter
- 制作中 / 検証済み filter
- compact row
- 必要な行だけ展開

展開時に、キーワード選定理由、validator/build、revision、公開後評価を同じ場所で確認できる。

### サイト

大量siteを左sidebarへ全表示しない。

- 検索
- 要対応優先sort
- ON/OFF filter
- 記事数 / 公開数 / 評価待ち / 改善 / 悪化
- GSC変化
- Agent状態
- Autopilot / autoPublish設定

詳細は行展開に格納する。

## 削除した旧UI

以下は独立画面として削除した。

- Autopilot control room
- Discovery workspace
- Keyword workspace
- Planning workspace
- Work / Review workspace
- Blog workspace
- SEO operations workspace
- Portfolio workspace
- legacy Settings workspace

内部 commands は Agent の実行能力として残す。ユーザーに工程別画面を操作させない。

## Public API

public write lane は原則 `/operations` に集約した。

旧 workspace/discovery/keyword/planning/work/review/policy/operator 等の画面直結 HTTP routes は削除した。低水準 commands/MCP は内部実行・診断用として残す。

人間向け public surface は主に:

- `/portfolio`
- `/articles`
- `/projects`
- `/autopilot/portfolio`
- project Autopilot設定
- `/operations/...`
- Blog transport boundary
- diagnostics / backup

## CI

2026-09-09 cleanup branch CI run #485:

- runtime acceptance: pass
- domain: pass
- db: pass
- research: pass
- commands: pass
- api: pass
- cli: pass
- mcp: pass
- web: pass

runtime suite では artifact、validator、revision、tick lease、executor cooldown、Blog idempotency に加え、大量記事向け article search/paging と keyword selection reason の取得も検証する。

## 本番環境でのみ確認するもの

- 実 Blog repository での記事生成/build
- 本番 autoPublish
- 実公開URLのHTTP/canonical確認
- 実 provider 制限からの長時間復旧
- 公開後SEO成果

これらはコード未実装ではなく deployment verification である。
