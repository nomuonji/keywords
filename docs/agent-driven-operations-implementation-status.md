# Agent-driven Operations Implementation Status

この文書は [`agent-driven-operations-improvement-plan.md`](./agent-driven-operations-improvement-plan.md) の実装状態を示す正本です。計画書は設計意図と背景を残し、この文書は「現在コードとして何が動くか」を記録します。

最終更新: 2026-09-09

## 結論

K01〜K20で要求されたソフトウェア上の基盤は実装済みです。公開・削除・DNS変更・新しい方針の有効化など、人の明示承認を要求していた境界は自動化していません。また、K20の「遠隔常時運用」は遠隔ホストへの移行そのものを自動実行する項目ではなく、ローカル運用の実測後に安全に判断するための readiness 判定までを実装しています。

実装は既存SQLite、`work_sessions`、`tasks`、`review_requests`、`discovery_jobs`、Blog handoffを利用します。Agent専用の第二DB・第二キューは作っていません。

## K01〜K20

| ID | 状態 | 実装内容 |
|---|---|---|
| K01 | 実装済み | HTTP actorをBearer tokenから確定。任意headerでhumanへ昇格不可。project pause、delegation、work-session action budget、operation external/candidate/cost budgetを共通guardへ集約。HTTP Agent writeは`/operations`配下へ限定し、MCP低水準writeはactive Operationまたはclaim済みlegacy discoveryを必須化。 |
| K02 | 実装済み | GSC観測にprovider/property/target origin/page filter/timezone/search type/dimensions/completeness/source versionを付与。domain propertyでは対象origin filterを生成し、別hostを比較しない。complete・同scope・同日数・非重複期間だけ比較。 |
| K03 | 実装済み | `operation_start`で自然文依頼をOperationへ変換。request keyとconversation refで再送・「続き」を既存Operationへ戻し、既存work session/taskへ接続。 |
| K04 | 実装済み | Agentは`discovery.start` delegationが有効なOperation内だけ探索開始可能。human偽装不要。HTTP/MCPではstartとclaimを同じ高水準経路で接続。 |
| K05 | 実装済み | executor register/heartbeat/claim/claim-next/release、generation fencing、lease、stale recoveryを実装。未接続とrunningを区別。 |
| K06 | 実装済み | 既存ページ改善をOperation→調査→判断→Blog handoff→公開待ち→outcomeへ流せる。実サイトへの公開は既存の明示承認境界を維持するため、ソフトウェア導入時に自動実行しない。 |
| K07 | 実装済み | Web Homeを「今日の運用」に変更。自然文依頼、判断待ち、進行中、executor状態、結果、次候補、delegationを1画面に集約。 |
| K08 | 実装済み | 既存Review/Planning/Blogの根拠・差分・版情報を共有work/Operationへ接続。Operation画面から判断待ちを確認可能。 |
| K09 | 実装済み | 既存site bindingとproject domain/origin照合を維持し、別サイトへのsilent rebindを拒否。サイト同期はOperation経路から利用可能。 |
| K10 | 実装済み | `measurement_imports`をcollector共通契約として追加。partial/failedを版付きで保存し、最後のcomplete materializationを消さない。 |
| K11 | 実装済み | Operatorが独自snapshot比較をやめ、共通measurement comparisonを使用。画面/Agentで比較条件を統一。 |
| K12 | 実装済み | 承認済みBlog handoffを`operation_blog_handoff`のstructured payloadとして直接搬送。version hash/idempotencyを維持し、`publication_authorized:false`を保持。 |
| K13 | 実装済み | `operation_outcomes`に仮説、実施/公開/評価予定、状態、metrics、attribution notes、next actionを保存。due outcomeをOperator候補へ戻す。 |
| K14 | 実装済み | maintenance diagnosticsに実DB path、quick check、runtime、provider、auth、executor lease、operation/measurement件数を追加。既存SQLite backup/restore smokeを維持。 |
| K15 | 実装済み | `operation_events`は判断待ち、完了、重大blocker、meaningful outcome等をdedupeして保存。通常heartbeatや変化なしtickを通知イベントにしない。 |
| K16 | 実装済み | 常駐executor用のclaim-next、generation/lease、heartbeat、release、stale recoveryをAPI/MCPから利用可能。無限retryを前提にせずremote readinessにretry上限を表示。 |
| K17 | 実装済み | `candidate.triage`を独立delegationとして追加。Agentがhumanを名乗らずに、明示委任された仕分けだけdecision記録付きで実行可能。 |
| K18 | 実装済み | outcomeに実測metricsと`unmeasurable`/`inconclusive`を保存でき、未計測を成功値で埋めない。 |
| K19 | 実装済み | Web通常導線をOperation中心に整理し、旧keyword-first Homeを削除。高水準API/MCP/CLI名を`operation_*`、`measurement_*`、`executor_*`へ整理し、低水準toolは調査・legacy互換用途として残す。 |
| K20 | 実装済み（判断ゲート） | `remote_readiness`でDB、API auth、allowed origins、persistent executor条件を検査。ローカルSQLiteを複数remote writerへ無条件展開せず、`KEYWORDS_REMOTE_DB_READY=1`等を明示した場合だけremote-host eligibleと判定。 |

## 主要な新しい入口

### MCP

- `operation_context`
- `operation_start`
- `operation_resume`
- `operation_checkpoint`
- `operation_complete`
- `operation_discovery_start`
- `operation_candidate_triage`
- `operation_blog_handoff`
- `operation_outcome_record`
- `executor_register` / `executor_heartbeat` / `executor_claim` / `executor_claim_next` / `executor_release`
- `measurement_context` / `measurement_capture` / `measurement_import`
- `remote_readiness`

MCP Agentは、active Operationまたは人が作成したlegacy discoveryをclaimする前に、低水準のresearch/write toolを直接実行できません。`work_start`による独立session作成もMCP Agentでは無効です。

### HTTP

remote bindではBearer tokenが必要です。Human tokenとAgent tokenは同一値にできません。Agent writeは`/operations`配下だけ許可されます。

主要route:

- `POST /operations`
- `GET /operations/context`
- `POST /operations/:operationId/resume`
- `POST /operations/:operationId/projects/:projectId/discovery`
- `POST /operations/:operationId/projects/:projectId/candidates/triage`
- `POST /operations/:operationId/projects/:projectId/blog/handoff`
- `POST /operations/:operationId/projects/:projectId/outcomes`
- `POST /operations/projects/:projectId/pause`
- `POST /operations/projects/:projectId/delegations`
- `POST /operations/executors/:executorId/claim-next`
- `POST /operations/projects/:projectId/measurements/capture`

### CLI

人間がローカル管理・診断する入口として`operation`と`measurement` subcommandを追加しています。legacy `discovery` commandsも維持しています。

## 認証・承認境界

次は自動委任の対象外です。

- page/content planの人間承認
- policy candidateの有効化
- review requestの人間resolution
- push / 本番公開 / DNS変更
- 記事削除、URL移動、大規模統合
- budget/delegationの拡大・新規有効化

Blog handoffは承認済み版しかexportできず、handoff自体は公開許可を付与しません。

## 計測契約

GSC比較は次を全部満たす観測だけを通常比較します。

1. providerが同じ
2. propertyが同じ
3. target originが同じ
4. page filterが同じ
5. timezoneが同じ
6. search typeが同じ
7. dimension粒度が対応している
8. 期間日数が同じ
9. 期間が重複しない
10. 両方`complete`

`partial`、`failed`、scope不明のlegacy snapshotは保存・表示対象にはできますが、通常の改善/悪化判定には使用しません。

## Executor

Executorは`id + generation`でfencingされます。再registerするとgenerationが増え、古いprocessのheartbeat/claim/releaseは拒否されます。claimにはleaseがあり、期限切れはstale recoveryの対象です。`claim-next`は既存Operation childを取得するだけで、新しい同内容task/jobを生成しません。

## テスト

CIでは既存smoke群に加え、`scripts/agent-operations-smoke.ts`で次を検証します。

- delegationなしAgent startの拒否
- 同じrequest/conversationの再送でOperation/taskが増えない
- pause中のAgent探索拒否
- Operation external-request budgetの原子的予約と上限
- delegated discovery start + claim + 再送idempotency
- candidate triageのdelegation境界
- executor再register後の旧generation拒否
- 同じdomain property内の2 hostが異なるfilterになること
- scope違い/partial観測が比較に混ざらないこと
- Operation完了が共有work/taskへ反映されること

既存migration/planning/policy/work/review/operator/product/Blog/portfolio/backup/restore/build smokeもCIで継続します。

## 遠隔常時運用について

ローカルPC停止中にも継続実行する必要が実測で確認されるまでは、既定はローカルexecutorです。これは未実装ではなく、計画書K20の「必要性と費用を実測してから方式を選ぶ」という停止条件をコード化したものです。

遠隔化する場合も、単にSQLiteファイルを共有ホストへ置いて複数writerを起動する構成はreadyと扱いません。永続DB、認証、backup/recovery、executor leaseの運用条件を満たしたうえで`remote_readiness`を通します。
