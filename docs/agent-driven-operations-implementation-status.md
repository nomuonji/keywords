# Agent-driven Operations Implementation Status

この文書は [`agent-driven-operations-improvement-plan.md`](./agent-driven-operations-improvement-plan.md) の実装状態を示す正本です。Autopilotの詳細は [`autonomous-seo-autopilot.md`](./autonomous-seo-autopilot.md) を参照してください。

最終更新: 2026-09-09

## 結論

K01〜K20で要求されたAgent-native運用基盤に加え、通常の記事制作・更新については **人間が毎回承認しなくても回るAutopilot lane** を実装しています。

現在の運用は二本立てです。

- **Manual mode**: 従来どおりhuman review / human page approvalを使う。
- **Autopilot mode**: AgentがEvidenceを集め、独立したdeterministic quality gateが `publish / revise / reject` を決定し、通過した版だけにpublication authorizationを与える。

記事削除、URL移動、DNS、credential、policy有効化などの破壊的・高権限操作はAutopilotに委任しません。

実装は既存SQLite、`work_sessions`、`tasks`、`review_requests`、`discovery_jobs`、Blog handoffを利用します。Agent専用の第二DB・第二キューは作っていません。Autopilotのcontrol/stateも同じDBに保存します。

## K01〜K20

| ID | 状態 | 実装内容 |
|---|---|---|
| K01 | 実装済み | HTTP actorをBearer tokenから確定。project pause、delegation、work-session action budget、operation budgetを共通guardへ集約。Autopilot ON時は安全なcontent capabilityだけをcontrol planeから自動委任。 |
| K02 | 実装済み | GSC観測にprovider/property/target origin/page filter/timezone/search type/dimensions/completeness/source versionを付与し、compatible observationだけ比較。 |
| K03 | 実装済み | `operation_start`で自然文依頼をOperationへ変換。request key / conversation refで重複を防止。Autopilotも同じOperationを生成する。 |
| K04 | 実装済み | discoveryはOperationに接続し、Agentがhumanを偽装せず開始・claim可能。 |
| K05 | 実装済み | executor register/heartbeat/claim/claim-next/release、generation fencing、lease、stale recovery。 |
| K06 | 実装済み | 既存ページ改善をOperation→調査→quality gate→Blog handoff→publication receipt→outcomeへ接続。 |
| K07 | 実装済み | Operations Homeをmonitor-first UIへ変更。Autopilot状態、pipeline、現在Operation、executor、quality gate、delivery、observation、event streamを1画面に集約。 |
| K08 | 実装済み | Review/Planning/Blogの根拠・差分・版情報を共有work/Operationへ接続。Autopilotではpage content判断をdeterministic gateで解決。 |
| K09 | 実装済み | site bindingとproject domain/origin照合を維持し、別サイトへのsilent rebindを拒否。 |
| K10 | 実装済み | `measurement_imports`をcollector共通契約として追加。partial/failedを区別。 |
| K11 | 実装済み | OperatorとUIで共通measurement comparisonを利用。 |
| K12 | 実装済み | Manual handoffは従来どおりauthorizationなし。Autopilot handoffはdeterministic gate通過版だけ `publication_authorized:true` を持ち、version hash/idempotencyを維持。 |
| K13 | 実装済み | `operation_outcomes`に仮説、実施/公開/評価予定、状態、metrics、attribution notes、next actionを保存。 |
| K14 | 実装済み | diagnosticsにDB path、runtime、provider、auth、executor lease、operation/measurement件数を追加。 |
| K15 | 実装済み | `operation_events`へ開始・品質判定・delivery attempt・重大blocker・outcome等をdedupe保存。 |
| K16 | 実装済み | 常駐executorとpersistent runnerを実装。runnerはOperationをclaimし、Agent CLIを起動してheartbeat・close・release・次tickまで行う。 |
| K17 | 実装済み | `candidate.triage`を独立capabilityとして実装。Autopilot ONではsafe capability setに含める。 |
| K18 | 実装済み | outcomeに実測metricsと`unmeasurable`/`inconclusive`を保存し、未計測を成功値で埋めない。 |
| K19 | 実装済み | UI/API/MCP/CLIをOperation中心に整理し、低水準toolは調査・互換用途として残す。 |
| K20 | 実装済み（判断ゲート） | `remote_readiness`でDB、API auth、origins、persistent executor条件を検査。SQLite複数remote writerを既定にしない。 |

## Autopilotで追加したControl Plane

### project controls

`autopilot_controls`:

- enabled
- auto approve
- auto publish
- cadence
- rolling 24h new-article limit
- rolling 24h update limit
- minimum Evidence Score
- maximum Commodity Risk
- minimum Information Gain
- minimum Publication Gate score

`autopilot_state`:

- status / stage
- current Operation / target
- human-readable summary
- latest decision
- last tick / next tick
- last error

### Evidence / publication gate

Autopilot対象のBlog briefは以下を追加で要求します。

- page type
- Evidence Score
- Commodity Risk
- Information Gain
- Source Packet
- Fact Ledger
- six-part Publication Gate

既定:

```text
Evidence >= 50
Commodity Risk <= 3
Information Gain >= 2
Publication Gate >= 80
Fact Ledger >= 1
missing source = 0
future fact = 0
unresolved question = 0
exact keyword target conflict = 0
```

重大な品質問題はreject、不足はrevise、全条件通過だけpublishです。

## Persistent Agent

`npm run autopilot` で常駐runnerを起動します。runnerは `KEYWORDS_AGENT_COMMAND` の外部Agent CLIを使います。

ループ:

1. executor register
2. enabled projectをcontrol-plane tick
3. claim-next
4. Agent CLIへOperation promptを渡す
5. heartbeat
6. Agent終了時にOperation complete/block
7. executor release
8. Autopilotを再tick
9. 次のOperationへ

quality gate通過後のauthorized handoffには専用delivery Operationを自動生成します。handoffが進まない場合のdelivery attemptは3回までに制限し、それでも進まない場合だけSafety Boundaryに上げます。

## 主要な入口

### HTTP

- `GET /projects/:projectId/autopilot`
- `POST /projects/:projectId/autopilot/configure`
- `POST /projects/:projectId/autopilot/tick`
- 既存 `/operations/*`
- 既存 measurement/site/executor routes

### Web

Operations Homeで以下を監視できます。

- Autopilot live state
- Agent ONLINE/OFFLINE
- pipeline counts
- current Operation/work session
- quality gate values / reasons
- authorized handoffs / publication / observation
- 24h publication throttle
- event stream
- manual Safety Boundary

通常操作はAutopilot ON/OFF、Emergency Stop、例外確認に限定します。

## 認証・承認境界

### Autopilot内で自動化する

- content research
- keyword / search-surface discovery
- content planning
- Source Packet / Fact Ledger作成
- page content quality decision
- evidence-backed page approval/revise/reject
- authorized Blog handoff
- Blog delivery attempt
- measurement / outcome loop

### 自動化しない

- 記事削除
- URL移動 / redirect設計の破壊的変更
- DNS変更
- credential / secret変更
- policy candidateの有効化
- initial Blog bindingのsilent変更
- 大規模構造変更など、content quality scoreでは安全性を判定できない操作

## Manual modeとの互換性

Autopilotを有効化しない既存projectは従来どおり動きます。

- manual `page.review` はhuman-only
- legacy `blog.export` はhuman approvalを要求
- legacy handoffは `publication_authorized:false`

Autopilotは別経路としてsystem decisionとauthorized handoffを生成するため、既存のhuman boundaryを弱めずに追加されています。

## テスト

CIでは既存smoke群に加えて `scripts/autopilot-smoke.ts` を実行します。

検証内容:

- Autopilot OFFではautonomous publicationを拒否
- Source Packet / Fact Ledger / scoringを持つ強い候補がpublish判定になる
- system `page.autopilot_review` でapprovedへ遷移
- authorized handoffが `publication_authorized:true` になる
- handoff生成がidempotent
- 24h publication usageを計数
- Commodity Riskが高くEvidenceが弱い候補をreject/archive

既存migration/planning/policy/work/review/operator/agent-operations/product/Blog/portfolio/backup/restore/web buildもCIで継続します。

## 遠隔常時運用

ローカルPC停止中にも回す場合、API schedulerとpersistent runnerを常時稼働するホストへ置く必要があります。ただし、SQLiteを複数remote writerで共有する構成をreadyとは扱いません。

既存 `remote_readiness` の永続DB、認証、backup/recovery、executor lease条件を満たしたうえで移行します。単一ホストでAPIとrunnerが同じSQLiteを使うローカル/小規模運用は既存設計の範囲です。
