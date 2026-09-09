# Agent-driven Operations Implementation Status

最終更新: 2026-09-09

この文書は [`agent-driven-operations-improvement-plan.md`](./agent-driven-operations-improvement-plan.md) と [`headless-generation-improvement.md`](./headless-generation-improvement.md) の実装状態を示す正本である。

## 結論

K01〜K20 の Agent-native 運用基盤と、H1〜H8 の headless article generation 改善は実装済み。

通常の記事制作は、Autopilot ON の project では次の境界で自動実行できる。

```text
Operation
  -> research / brief
  -> actual article file
  -> independent validator
  -> site build
  -> verified artifact manifest
  -> local complete
  -> deterministic publication boundary
  -> authorized Blog handoff
  -> idempotent receipt
  -> outcome / measurement
```

企画だけ、Agent exit 0だけ、page approvalだけでは記事制作Operationはcompleteできない。

## K01〜K20

| ID | 状態 | 実装内容 |
|---|---|---|
| K01 | ✅ | HTTP actor、pause、delegation、work/operation budgetを共有guardで制御。 |
| K02 | ✅ | measurement scope/version/completenessを保存しcompatible periodだけ比較。 |
| K03 | ✅ | 自然文依頼をOperationへ変換。request key / conversation refで冪等化。 |
| K04 | ✅ | discoveryをOperation / shared work sessionへ接続。 |
| K05 | ✅ | executor register/heartbeat/claim/generation/lease/stale recovery。 |
| K06 | ✅ | 既存ページ改善をresearch→artifact→delivery→outcomeへ接続。 |
| K07 | ✅ | monitor UIに加え記事成果物中心のArticles viewを追加。 |
| K08 | ✅ | Review/Planning/Blogの根拠・版をshared workへ接続。 |
| K09 | ✅ | project domain / Blog binding originのsilent rebindを拒否。 |
| K10 | ✅ | measurement imports共通契約とpartial/failed状態。 |
| K11 | ✅ | Operator/UIで共通measurement comparisonを利用。 |
| K12 | ✅ | manual handoffとauthorized Autopilot handoffを分離。version hash/idempotency維持。 |
| K13 | ✅ | operation outcomesへ仮説・実施・公開・評価予定・metrics・attributionを保存。 |
| K14 | ✅ | diagnosticsへDB/runtime/provider/auth/executor/operation状態を追加。 |
| K15 | ✅ | operation eventsをdedupe保存。 |
| K16 | ✅ | persistent runnerがclaim→Agent→heartbeat→artifact照合→releaseまで実行。 |
| K17 | ✅ | candidate triageを独立capability化。 |
| K18 | ✅ | improved/regressed/inconclusive/unmeasurableを実測値と保存。 |
| K19 | ✅ | API/MCP/CLI/UIをOperation中心の共有commandsへ統一。 |
| K20 | ✅ | remote readinessでDB/auth/origin/executor条件を検査。 |

## H1〜H8

| ID | 状態 | 実装内容 |
|---|---|---|
| H1 Scheduler single owner | ✅ | workerを既定owner化。API標準entryはworker owner時にAPI scheduler停止。external/manual tickも同じSQL lease。 |
| H2 Executor health/cooldown | ✅ | provider/runtime共通障害をexecutor cooldownへ分離。cooldown中claim拒否。 |
| H3 Artifact completion guard | ✅ | `operation_artifacts` と `operation.complete` guard。verified artifactなしではcontent Operation完了不可。 |
| H4 Draft writer | ✅ | Blog working treeへtemp→fsync→rename→hashでatomic write。 |
| H5 Independent validator | ✅ | 本文/source/frontmatter/数値/読者質問/捏造/link/buildを独立検証しrevision keyでcache。 |
| H6 Revision state machine | ✅ | 同一Operation内revision、session idempotency、no-progress上限、human escalation、resume allowlist。 |
| H7 Blog delivery E2E boundary | ✅ | verified local artifact後だけauthorized handoff。DB triggerとidempotent receiptで二重公開境界を保護。 |
| H8 Minimal article UI | ✅ | 完成記事・制作中・要判断・executor healthを成果物中心に表示。 |

## Scheduler ownership

標準:

```text
KEYWORDS_AUTOPILOT_SCHEDULER_OWNER=worker
KEYWORDS_AUTOPILOT_SCHEDULER=0
```

`apps/api/src/entry.ts` は owner が `api` でない限りAPI schedulerを停止する。

public `@keywords/commands/autopilot` は leased wrapper をexportするため、API/manual tickもworkerと同じproject tick lockを使用する。

## Article artifact contract

記事制作Operationのlocal completeに必要なもの:

- real article file
- content SHA-256
- page/article identity
- source IDs
- independent validator pass
- site build pass
- before/after hash
- persisted manifest
- verified timestamp

`operation.complete` はこの状態を検査する。

Autopilot handoffではさらにDB triggerが verified artifact を要求する。

## Executor failure boundary

executor共通障害:

- provider rate limit/auth/outage
- CLI executable/bootstrap
- MCP bootstrap
- runtime mismatch
- executor-wide network failure

これらはexecutor cooldownへ保存し、projectをsite blockedへ変換しない。

site固有障害だけproject blockerへ送る。

## Revision / resume

自動resume対象:

- `quality_revision_required`
- `artifact_missing`

自動resume対象外:

- `site_dependency_failed`
- `executor_unavailable`
- `human_decision_required`
- `explicit_pause`
- `budget_exhausted`

同じrevision sessionは再利用する。終了後も本文hashとgate fingerprintが変わらない場合だけno-progressを増やし、上限でhuman reviewへ送る。

## Persistent runner

`npm run autopilot`:

1. executor register
2. health/cooldown確認
3. revision reconciliation
4. auto-resume allowlist処理
5. due tick
6. claim-next
7. Agent process
8. heartbeat
9. artifact completion check
10. runtime accounting
11. executor release
12. post-operation tick/revision reconciliation

SIGTERM / SIGINT時は新規claimを停止しactive Agentへgraceful stopを送る。

## UI

記事トップ画面:

- 完成記事
- 制作中記事
- validator failed checks
- revision count
- 要判断/blocker
- executor cooldown / failure class

低水準Operation/lease/runは成果物より優先して表示しない。

## CI

2026-09-09 CI run #441:

- runtime acceptance suite: ✅
- typecheck/domain: ✅
- typecheck/db: ✅
- typecheck/research: ✅
- typecheck/commands: ✅
- typecheck/api: ✅
- typecheck/cli: ✅
- typecheck/mcp: ✅
- typecheck/web: ✅

runtime suite:

- migration
- planning
- policy
- work loop
- review
- operator
- agent operations
- executor selection
- autopilot artifact requirement
- headless article generation
- validator cache
- executor cooldown
- scheduler tick lease
- revision idempotency/no-progress
- explicit pause preservation
- product workflow
- Blog lifecycle/receipt idempotency
- portfolio
- backup/restore
- web production build

すべてpass。

## Manual modeとの互換性

Autopilot OFF projectは従来のhuman boundaryを維持する。

- manual `page.review` はhuman-only
- legacy `blog.export` はhuman approval要求
- legacy handoffはpublication authorizationを自動付与しない

Autopilotは既存manual boundaryを破壊せず追加laneとして動く。

## 実装完了と本番確認の区別

実装は完了しているが、この作業では本番外部siteへpublishしていない。

環境依存で未確認:

- 実Blog repositoryを`KEYWORDS_BLOG_ROOT`へ接続した生成
- 本番site build
- 本番autoPublish
- 実URL HTTP/canonical確認
- 実provider制限下での長時間回復
- 公開後SEO成果

これらはコードの未実装ではなくdeployment verificationである。

## 最終状態

**K01〜K20: 実装済み。**

**H1〜H8: 実装済み。**

**CIで再現可能な自律記事生成: green。**
