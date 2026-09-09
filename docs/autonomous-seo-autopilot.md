# Autonomous SEO Autopilot

最終更新: 2026-09-09

## 目的

Keywords を「人が毎回指示・承認するSEOツール」ではなく、Agentが継続的に調査・企画・改善・公開搬送・観測を回し、人間は Operations パネルから状態と例外だけを監視する運用へ移行する。

通常の記事運用では人間を待たない。ただし、記事量産ループとは性質が異なる破壊的操作（削除、URL移動、DNS、credential、policy有効化等）は引き続き自動化対象外とする。

## 自律ループ

```text
Operator / Search data
        ↓
Autopilot control plane
        ↓
Operation 作成
        ↓
Persistent Agent が claim
        ↓
調査 / Evidence / Page Plan
        ↓
Source Packet + Fact Ledger
        ↓
Deterministic Quality Gate
   ├ reject → archive
   ├ revise → proposedへ戻す
   └ publish → approved
        ↓
Authorized Blog Handoff
        ↓
Delivery Operation
        ↓
Blog-side Agent / receipt
        ↓
Published / Observing / Evaluated
        ↓
Search Console / Outcome
        ↓
次の Operator 判断
```

Agent自身の文章上の自己評価を公開許可として採用しない。`brief.autonomy` に保存された構造化Evidenceを control plane が検証し、別レイヤーで公開可否を決定する。

## Evidence contract

Autopilot対象の記事企画は `blog_prepare` のbriefに次を持つ。

- `page_type`: reference / troubleshooting / experience / comparison / analysis / field_note
- `evidence_score`: 0〜100
- `commodity_risk`: 0〜5
- `information_gain`: 最低2件を既定値とする
- `source_packet`
  - official source IDs
  - first-party source IDs
  - research source IDs
  - competitor-gap source IDs
  - reader-question source IDs
- `fact_ledger`
  - claim
  - source ID
  - checked date
  - confidence
- `publication_gate`
  - source quality: 0〜20
  - evidence: 0〜20
  - originality: 0〜20
  - intent match: 0〜15
  - accuracy: 0〜15
  - editorial quality: 0〜10

既定の公開条件は以下。

```text
Evidence Score >= 50
Commodity Risk <= 3
Information Gain >= 2
Publication Gate >= 80 / 100
Fact Ledger >= 1
全source IDが同一projectに実在
future-dated fact = 0
unresolved questions = 0
exact keyword target conflict = 0
```

公開ゲートが65未満、Commodity Risk超過、source不整合、future-dated fact等の重大問題は `reject`。それ以外の不足は `revise`。すべて通過した場合だけ `publish` となる。

## Manual modeとの共存

従来の手動モードは残す。

- Autopilot OFF: `page.review` のhuman approval + legacy `blog.export`
- Autopilot ON: `page.autopilot_review` + `createAutonomousHandoff`

legacy `blog.export` は引き続き `publication_authorized:false`。自律経路だけが、deterministic gate通過後に `publication_authorized:true` と `authorization.mode=deterministic_autonomy_gate` を持つ。

## 量産制御

「生成できるだけ公開する」構成にしない。プロジェクトごとにrolling 24hの上限を持つ。

既定:

- 新規記事: 2 / 24h
- 大幅更新: 4 / 24h

Autopilotは更新・問題解決・実測に基づく改善を優先し、Commodity記事の大量公開を品質ゲートで落とす。

## Persistent Agent

Control planeはAPI process内のschedulerで定期tickする。実際の調査・企画・Blog搬送は常駐executorがOperationをclaimして実行する。

環境変数:

```env
KEYWORDS_AUTOPILOT_SCHEDULER=1
KEYWORDS_AUTOPILOT_INTERVAL_MINUTES=5
KEYWORDS_AUTOPILOT_RUN_ON_START=1

KEYWORDS_AGENT_COMMAND=<agent CLI>
KEYWORDS_AGENT_ARGS_JSON=[]
KEYWORDS_AGENT_ID=mcp
KEYWORDS_AGENT_CWD=
KEYWORDS_EXECUTOR_LEASE_SECONDS=900
KEYWORDS_AUTOPILOT_RUNNER_POLL_SECONDS=30
```

起動:

```bash
npm run autopilot
```

`KEYWORDS_AGENT_ARGS_JSON` 内の `{prompt}` はOperation promptに置換する。`{prompt}` がない場合はstdinへpromptを渡す。

Runnerは以下を行う。

1. executor register
2. enabled projectをtick
3. claim-next
4. 外部Agent CLIを起動
5. heartbeat / lease維持
6. Agent終了時にOperationをcloseまたはblock
7. release
8. control planeを再tick
9. 次のOperationへ

authorized Blog handoffには最大3回の自動delivery attemptを与える。3回ともhandoffが進まない場合だけパネルのSafety Boundaryへ出す。

## Operations panel

Operations Homeは入力フォーム中心ではなくmonitor-first UIにする。

表示対象:

- Autopilot LIVE / OFF / PAUSED / ERROR
- 現在のstageとsummary
- 最終tick / 次回tick
- Agent executor ONLINE/OFFLINE / lease
- pipeline件数
  - discovery
  - research/execution
  - quality gate
  - ready
  - delivery
  - observing
- 現在のOperationとwork session
- 各記事候補のquality gate
  - publication score
  - Evidence Score
  - Commodity Risk
  - Information Gain
  - Fact数
  - reject/revise理由
- Blog handoff / publication / observation state
- 24h新規記事・更新上限
- operation event stream
- manual safety boundary

人間の通常操作は原則以下だけ。

- Autopilot ON / OFF
- Emergency Stop / Resume
- 異常時のSafety Boundary確認

## 自動化しない境界

記事制作・通常更新のループから外す。

- 記事削除
- URL移動 / redirect設計変更
- DNS変更
- credential / secret変更
- policy candidateの有効化
- 大規模なサイト構造破壊を伴う統合
- initial Blog site bindingのsilent変更

これらは品質スコアでは安全性を代替できないため、人間または別の明示的な高権限フローに残す。

## 運用上の前提

Keywordsの既定DBはSQLiteである。API schedulerとpersistent runnerは同じ運用環境・同じDBを使う前提。複数remote writerへ無条件に展開しない。遠隔常時運用へ移す場合は既存 `remote_readiness` の永続DB・認証・backup/recovery・lease条件を満たすこと。
