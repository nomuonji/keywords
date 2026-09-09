# Keywordsを日々の運用に使うための改善書 — 実装完了記録

作成日: 2026-09-09  
最終更新: 2026-09-09  
状態: **実装済み**

対象: Keywords / analytics-dashboard連携 / Blog連携 / Agent実行基盤

詳細な現在状態:

- [Agent-driven Operations Implementation Status](agent-driven-operations-implementation-status.md)
- [記事制作を中心にした自律実行監査](core-autonomy-audit.md)
- [ヘッドレス記事生成 改善仕様](headless-generation-improvement.md)

## 1. 結論

この文書で提案した「ユーザーがSEO工程のフォームを順番に操作する」のではなく、自然文の依頼を共有Operationへ変換し、Agentが調査・計画・実行・検証・再開を進め、Webは確認と例外判断を中心にする構成は実装した。

さらに実装過程で、自律記事生成を本当に成立させるためのH1〜H8を追加実装した。

現在の通常フロー:

```text
自然文の依頼
  -> Operation / shared work session
  -> executor claim / lease
  -> research / evidence
  -> page plan / brief
  -> actual article file
  -> independent validator
  -> site build
  -> verified artifact manifest
  -> local complete
  -> publication boundary
  -> authorized Blog handoff (許可時のみ)
  -> idempotent receipt
  -> measurement / outcome
```

記事制作では、企画作成、Agent process exit 0、page approvalだけではOperationをcompleteできない。

## 2. ユーザーが使うときの完成像

通常はCodex/MCPから目的を伝える。

例:

> 今週いちばん改善する価値があるページを選んで進めて。公開は設定済みの範囲だけ。

Agent側が共有状態から対象、過去の作業、計測、方針、予算、既存artifactを読み、許可範囲内で開始する。

ユーザーが日常的に入力し直す必要がないもの:

- project ID
- site ID
- language / country
- work session ID
- handoff ID
- executor ID
- source ID
- internal lease state

人の操作を残すもの:

- 新しい方針の有効化
- 明示pause
- 許可外の公開・削除・大きなURL変更
- revision/no-progress上限に達した例外判断
- credentialや外部契約など、Agentだけでは解消できない境界

## 3. 実装状態 K01〜K20

| ID | 状態 | 実装結果 |
|---|---|---|
| K01 | ✅ | actor、delegation、pause、budgetをshared commandsで検査。Agentのhuman偽装を正規経路にしない。 |
| K02 | ✅ | GSC/measurementの対象origin、scope、期間、completenessを共通化。compatible periodだけ比較。 |
| K03 | ✅ | 自然文依頼をOperationへ変換。request key/conversation refで再送を照合。 |
| K04 | ✅ | Agentが委任/autonomy範囲内でdiscoveryを正規開始可能。 |
| K05 | ✅ | executor register/heartbeat/generation/claim/lease/stale recovery。 |
| K06 | ✅ | 既存改善をresearch→plan→Blog→outcomeまでOperationへ接続。 |
| K07 | ✅ | Operations UIと記事成果物中心のArticles UI。 |
| K08 | ✅ | review/decision/source/briefを同じworkへ関連付け。 |
| K09 | ✅ | site/Blog bindingのorigin照合とsilent rebind拒否。 |
| K10 | ✅ | measurement import/captureの共通契約。partial/failedをsuccessと分離。 |
| K11 | ✅ | Operatorと表示で共通measurement比較を使用。 |
| K12 | ✅ | versioned Blog handoff/receiptを自動搬送laneへ接続。 |
| K13 | ✅ | hypothesis、implemented/published/evaluation、metrics、attribution、next actionをoutcomeへ保存。 |
| K14 | ✅ | diagnostics/remote-readinessでDB/API/auth/executor/provider状態を確認。 |
| K15 | ✅ | meaningful eventをdedupe保存。 |
| K16 | ✅ | persistent executor runner。再起動後もSQL/lease/artifactから再開。 |
| K17 | ✅ | candidate triageを独立delegation capability化。 |
| K18 | ✅ | improved/regressed/inconclusive/unmeasurableを実測と保存。 |
| K19 | ✅ | API/MCP/CLI/UIを共有commands/Operationへ接続。 |
| K20 | ✅ | remote host移行前のreadiness boundaryを実装。 |

## 4. Headless article generation H1〜H8

K01〜K20だけでは「Agentが仕事を動かせる」までで、実記事成果物の完成保証が弱かったため追加した。

| ID | 状態 | 実装結果 |
|---|---|---|
| H1 | ✅ | scheduler single owner。workerを既定ownerにし、manual/API tickも同じSQL lease。 |
| H2 | ✅ | executor health/cooldown。provider/runtime共通障害をsite blockerと分離。 |
| H3 | ✅ | article artifact manifestとOperation completion guard。 |
| H4 | ✅ | Blog working treeへのatomic draft writer。 |
| H5 | ✅ | sourceと本文を使うindependent validator + site build。 |
| H6 | ✅ | revision state machine、resume allowlist、no-progress/human boundary。 |
| H7 | ✅ | verified local artifact後だけauthorized Blog handoff可能。receiptは冪等。 |
| H8 | ✅ | 完成記事・制作中・要判断・executor状態を主画面に表示。 |

## 5. Schedulerと実行担当

標準設定:

```text
KEYWORDS_AUTOPILOT_SCHEDULER_OWNER=worker
KEYWORDS_AUTOPILOT_SCHEDULER=0
```

`npm run autopilot` のpersistent workerが通常のscheduler ownerになる。

API標準起動は `apps/api/src/entry.ts` を通り、ownerが`api`でない場合はAPI内部schedulerを停止する。

外部から呼ぶ `@keywords/commands/autopilot` はleased wrapperをexportするため、manual/API tickもworkerと同じproject leaseを取得する。

同じprojectへ同時tickしてもDB leaseにより一方だけが実行される。

## 6. Executor failure boundary

次はproject/siteの失敗にしない。

- provider rate limit / usage limit
- provider auth failure
- provider outage
- executable missing
- MCP bootstrap failure
- runtime mismatch
- executor-wide network failure

executor自身にfailure class/count/cooldown until/last errorを保存し、cooldown中は新規claimしない。

site-specificなDNS/origin、Blog binding、site build等だけproject blockerへ送る。

## 7. 記事成果物契約

記事制作Operationは、次が揃わなければlocal completeにならない。

- article/page ID
- actual article path
- content SHA-256
- source IDs
- validator version/status/result hash
- site build command/status/result
- before/after hash
- generated/verified timestamps

記事fileはtemp fileへwriteし、fsync後にrenameする。

`operation.complete` はrequired artifactを照合する。Agent processが正常終了しても、artifactがなければ`artifact_missing`、validator/build未通過なら`quality_revision_required`として再開対象にする。

## 8. Independent validator

Agentの自己採点だけをpublication authorityにしない。

独立チェック:

- file exists / non-empty
- frontmatter
- page/article identity
- source-backed claims
- numeric/entity consistency
- reader-question coverage
- duplicate/cannibalization
- prohibited fabrication patterns
- links
- site build

validator resultはcontent hash/source packet/validator versionから作るrevision keyでcacheする。

## 9. Revision / pause / human boundary

blocker class:

- `quality_revision_required`
- `artifact_missing`
- `site_dependency_failed`
- `executor_unavailable`
- `human_decision_required`
- `explicit_pause`
- `budget_exhausted`

自動resumeするのはquality/artifactの2種類だけ。

revisionは同じOperation/article identityを維持する。

- running revision sessionがあれば再利用
- executorがlive ownership中なら置換しない
- 終了したrevisionでcontent hashとgate fingerprintが同じならno-progressを増加
- revision/no-progress上限でhuman reviewへ移行
- explicit pauseを自動解除しない

## 10. Blog publication boundary

local completeとpublication completeを分離する。

`publication_authorized=true` のBlog handoffにはverified article artifactが必要。

DB triggerでもvalidator/build未通過artifactしかない場合のauthorized handoff INSERTを拒否する。

Blog receipt:

- event IDで冪等
- 同じevent再送はduplicate
- 同じevent IDの内容変更はcollisionとして拒否
- published transitionにはHTTP/canonical evidenceが必要

応答喪失時に同じreceiptを再送しても二重publish transitionを作らない。

## 11. UI

通常の主画面は内部工程ではなく成果物を中心にする。

表示:

- 完成記事
- 制作中記事
- validator failed checks
- revision count
- 要判断/blocker class
- executor status/cooldown/retry condition

keyword/cluster/run/lease等の詳細は必要時に見る。

## 12. CI acceptance

2026-09-09 CI run #441 で以下がgreen。

workspace typecheck:

- domain
- db
- research
- commands
- api
- cli
- mcp
- web

runtime acceptance:

- migration
- planning
- policy
- work loop
- review
- operator
- agent operations
- executor selection
- autopilot artifact requirement
- headless article file/validator/build
- validator cache
- executor cooldown
- scheduler tick lease
- revision session idempotency
- no-progress escalation
- explicit pause preservation
- product workflow
- Blog lifecycle/receipt idempotency
- portfolio
- DB backup/restore
- web production build

## 13. 受け入れシナリオの最終状態

1. 会話からOperationを開始できる — ✅
2. Agent未接続/実行不能を実行中と誤表示しない — ✅
3. 再送・再接続で同じOperation/job/handoffを重複作成しない — ✅
4. pause/budget/reviewを別入口から越えない — ✅
5. measurement scopeを別hostへ混ぜない — ✅
6. 古いapproval/versionをそのまま利用しない — ✅
7. 公開許可やverified artifactがなければpublication境界で停止 — ✅
8. receipt/outcome/measurementを元の仕事へ接続 — ✅
9. revision指示を同じOperationへ戻す — ✅
10. API/CLI/MCP/Blog既存契約をCIで維持 — ✅

## 14. Manual modeとの互換性

Autopilot OFF projectは従来のhuman boundaryを維持する。

- human-only page review
- legacy Blog exportのhuman approval
- publication authorizationなしのmanual handoff

Autopilot実装のためにmanual workflowを削除していない。

## 15. 本番環境でのみ確認できる項目

以下は今回のコード実装の未完ではなく、対象site/credentialを必要とするdeployment verificationである。

- 実Blog repositoryを`KEYWORDS_BLOG_ROOT`へ接続した生成
- 本番site build
- autoPublish許可siteへの実公開
- 実公開URLのHTTP/canonical確認
- 実provider rate limitでの長時間cooldown復旧
- 公開後SEO成果

本番作用を伴うため、この実装作業では実行していない。

## 16. 最終状態

**K01〜K20: 実装済み。**

**H1〜H8: 実装済み。**

**CIで再現可能な日常Agent運用とheadless記事生成: green。**

今後は新しい基盤実装ではなく、実サイトごとのdeployment verificationと運用データを使った改善が中心になる。
