# ヘッドレス記事生成 改善仕様

最終確認: 2026-09-09

この文書は、Keywords を「UIを操作して工程を進めるSEOアプリ」ではなく、**UIやAPIサーバーを常時起動しなくても、workerが自律的に記事成果物を作り、中断から再開できる実行基盤**へ寄せるための実装仕様である。

現状の監査結果は [core-autonomy-audit.md](core-autonomy-audit.md) を参照する。

## 現在地

現時点で成立しているもの:

- SQLを正本にしたOperation / work session / executor / handoff管理
- executorのlease / generation / stale recovery
- autonomy/delegationを見て実行可能候補を選ぶclaim
- blocked/paused系の子sessionをclaimしない候補選択
- Blog handoffの冪等性とpublication authorization
- deterministic gateによるpage approve/rejectの制御面
- 一時DBを使うautopilot fixture smoke

まだ成立していないもの:

- scheduler責任の一本化
- executor共通障害のcircuit breaker / cooldown
- 記事本文artifactを完了条件にする仕組み
- 本文のatomic saveとartifact manifest
- 本文と原典を独立検証するvalidator
- reviseを本文版/hashへ結び付ける再検査制御
- 実Blog repositoryでの1記事縦通し
- 強制終了からのartifact単位resume試験
- 記事中心の最小UI

したがって、現状は「自律制御基盤あり」であり、「自律記事生成完成」ではない。

## 設計原則

### 1. UIは観測窓

UIを閉じても生成が継続する。UIからのクリック、ブラウザのpoll、APIサーバーの常駐を生成の前提にしない。

UIの役割は次だけに絞る。

- 完成記事を見る
- 制作中記事を見る
- blockerを見る
- executor全体障害を見る
- 停止する
- 例外判断をする

### 2. 実行正本はSQL + commands

CLI / MCP / API / UI / worker は同じcommandsと同じSQL状態を読む。どの入口から操作しても独自のqueueや独自状態機械を作らない。

### 3. 記事成果物はファイルが正本

記事本文はBlog側の実ファイルを正本とする。Keywords側は次を保持する。

- article/page ID
- artifact path
- artifact hash
- source IDs
- validator結果
- build結果
- Blog handoff ID
- receipt / outcome

本文のコピーを別DB正本として増やさない。

### 4. Operation終了と成果物完成を分けない

記事制作Operationは、必要artifactが存在し検証済みでなければcompleteできない。

プロセス終了コード0、企画承認、page proposed、handoff作成だけではcompleteにしない。

### 5. exactly-onceを仮定しない

外部操作、ファイル保存、Blog deliveryはすべて再実行され得る前提にする。同一article ID / handoff ID / version hashによって、at-least-once実行でも二重生成・二重公開を防ぐ。

## 目標アーキテクチャ

```text
              ┌──────────────┐
              │ Human config │
              └──────┬───────┘
                     │
                     v
┌───────────┐   ┌───────────────┐   ┌────────────────┐
│ Optional  │-->| SQL + commands│<--│ Headless worker│
│ UI / API  │   │ source of truth│   └───────┬────────┘
└───────────┘   └──────┬────────┘           │
                       │                    │ claim/run/resume
                       │                    v
                       │             ┌───────────────┐
                       │             │ Agent runtime │
                       │             └──────┬────────┘
                       │                    │
                       v                    v
                ┌──────────────────────────────┐
                │ Blog working tree / article │
                │ files / build / validators  │
                └──────────────┬───────────────┘
                               │ authorized only
                               v
                        ┌──────────────┐
                        │ Publication  │
                        └──────────────┘
```

## scheduler設計

### 現状

- API: `KEYWORDS_AUTOPILOT_INTERVAL_MINUTES` を使うschedulerを既定で有効化
- runner: `KEYWORDS_AUTOPILOT_RUNNER_POLL_SECONDS` ごとにenabled projectをtick

この二重責任を廃止する。

### 目標

productionでのscheduler ownerは **headless worker 1系統**。

APIの役割:

- config変更
- status取得
- explicit manual tick

manual tickもworkerと同じDB lockを取る。

最低限、projectごとに次を持つ。

- `next_tick_at`
- `tick_lease_owner`
- `tick_lease_expires_at`
- `last_tick_started_at`
- `last_tick_finished_at`

claim条件:

1. autonomy enabled
2. project not explicitly paused
3. `next_tick_at <= now`
4. active tick leaseなし、またはexpired
5. executor healthがrunnable

workerは全ON projectを毎pollごとに無条件tickしない。

## executor health

site状態とexecutor状態を分ける。

### executor側に持つ状態

- `online`
- `busy`
- `cooldown`
- `unavailable`
- `offline`

### 共通障害分類

以下はexecutor共通障害。

- provider利用上限
- 認証失敗
- CLI起動失敗
- executable missing
- MCP bootstrap失敗
- runtime version mismatch
- provider outage

共通障害時:

1. 現在のOperationをsite blockedへ変換しない
2. executorへfailure classを記録
3. `retry_after` を保存
4. cooldown中は新規claimしない
5. siteごとの失敗履歴を増やさない

### site固有障害

- DNS
- origin接続失敗
- Blog binding不整合
- 特定siteのbuild失敗
- 特定siteのcredential権限不足

依存するproject/articleだけを止める。

## 最短の制作経路

workerは固定pipelineを毎回最初から実行しない。現在のartifact状態から欠けたcommandだけ選ぶ。

### Step 1: 既存作業を優先

優先順位:

1. 保存済みdraftのvalidator失敗
2. draft保存途中からのresume
3. sourceが揃ったarticleの執筆
4. source不足のarticle
5. 未処理の高価値content task
6. 新規探索
7. 全体保守

「記事完成に近いもの」を新規探索より先にする。

### Step 2: 必要なsourceだけ集める

保存済みsourceで十分ならweb探索しない。不足する主張だけ追加調査する。

保存するのは記事に使う根拠。候補URLを大量にDBへ蓄積すること自体を成果にしない。

### Step 3: 本文を実ファイルへ保存

企画だけでprocessを終了しない。同じarticle IDの中で本文へ進む。

保存要件:

- temp fileへ書く
- fsync可能なら行う
- 同一filesystem上でrename
- rename後にhash計算
- artifact manifestへ記録

部分書き込みを成功扱いしない。

### Step 4: 独立validator

validatorはagentの自己採点とは別に実行する。

最低限:

- file exists / non-empty
- frontmatter/schema
- article ID / target site一致
- source-backed claim check
- numeric/entity consistency
- duplicate/cannibalization check
- reader question coverage
- prohibited fabrication patterns
- link validation
- site build/lint

validator結果は本文hash + validator versionでcacheする。

### Step 5: 局所修正

failed checkだけを修正対象にする。全文再生成を既定にしない。

本文hashが変わらなければ同じvalidatorを再実行しない。

### Step 6: local complete

次が揃った時だけ生成完了。

- article file
- artifact hash
- required sources
- validator pass
- build pass
- diff/before-after hash
- manifest persisted

ここで初めてOperation completeを許可する。

### Step 7: optional publication

`autoPublish=true` かつpublication gate通過時のみ既存Blog deliveryへ進む。

生成完了と公開完了を別イベントとして記録する。

## artifact manifest

例:

```json
{
  "schema_version": 1,
  "operation_id": "...",
  "project_id": "...",
  "article_id": "...",
  "page_id": "...",
  "artifact_path": "content/articles/example.md",
  "content_sha256": "...",
  "source_ids": ["..."],
  "validator": {
    "version": "article-validator-v1",
    "status": "passed",
    "result_hash": "..."
  },
  "build": {
    "command": "...",
    "status": "passed",
    "result_hash": "..."
  },
  "before_hash": "...",
  "after_hash": "...",
  "generated_at": "...",
  "verified_at": "..."
}
```

DBにはmanifestそのもの、またはmanifestへの安定参照とhashを保持する。

## 中断と再開

### 永続化するもの

- article ID
- completed step
- next command
- artifact path/hash
- source IDs
- validator status/hash/version
- blocker class
- remaining action budget
- remaining external-request budget
- active runtime consumed
- last progress timestamp
- executor retry_after

### 永続化しないもの

- private reasoning
- 会話全文
- 再構築可能な長いsystem prompt
- 同じsource本文の重複コピー

### 中断別の復旧

| 中断 | 再開 |
|---|---|
| source収集済み、draftなし | 保存済みsourceから執筆 |
| temp file作成中 | tempを破棄して同じarticle IDで再保存 |
| rename後、DB更新前 | file hashを照合しmanifest補完 |
| DBにartifact参照あり、fileなし | complete禁止。再保存または欠損記録 |
| validator途中 | 未完checkだけ実行 |
| validator pass後、Operation未完 | hash照合してcomplete |
| Blog handoff送信後、応答喪失 | 同じhandoff IDで照会/再送 |
| worker crash | lease expiry後に同じoperation/articleを再claim |
| executor rate limit | executor cooldown解除後に再開 |
| explicit pause | 自動resumeしない |
| human decision | resolution event後のみresume |

## blocker分類

単一の `blocked` だけでは再開制御が粗すぎる。意味として最低限次を区別する。

- `quality_revision_required`
- `site_dependency_failed`
- `executor_unavailable`
- `human_decision_required`
- `explicit_pause`
- `budget_exhausted`
- `artifact_missing`

DB表現はenum列追加でもmetadataでもよいが、resumeのallowlist判定を機械的にできることを必須にする。

## revise制御

現行gateはfingerprintで同じdecisionの重複保存は抑えるが、本文版そのものを再検査条件にしていない。

目標:

```text
revision_key = hash(article_content_hash + source_packet_hash + validator_version)
```

- revision_keyが同じなら再採点しない
- `revise` は具体的failed checksを持つ
- 修正後にcontent hashが変わった時だけ再検査
- 同一articleのrevision回数に上限
- 上限到達時はhuman boundaryへ送る

## 品質判定

現行gateの良い部分は残す。

- source ID integrity
- fact ledger存在
- date sanity
- unresolved question
- target conflict
- publication capacity

ただしagent提出の `evidence_score`、`commodity_risk`、publication component scoresだけでは公開しない。

独立validatorが本文とsourceを照合し、その結果をpublication authorizationの必須条件にする。

## operatorとmaintenance

記事制作と保守を完全に同じ候補列で競争させない。

論理的に2 laneへ分ける。

### Production lane

- article draft
- revision
- content verification
- build
- delivery

### Maintenance lane

- sitemap sync
- Search Console capture
- broad discovery
- clustering
- observation

同じSQL正本を使い、新queueを増やす必要はない。task kind / budget class / scheduling policyを分けるだけでよい。

Production laneに未完artifactがある場合、通常はMaintenance laneより優先する。

## 秘密情報

secretをpromptへ埋め込まない。

- token / credentialはprocess envまたは既存credential providerから読む
- runsへsecret値を書かない
- stderr保存時はredactionする
- artifact manifestへcredential pathやtokenを入れない
- agentへ不要なMCP/connectorを起動しない

## shutdown

SIGTERM / SIGINT時:

1. 新規claim停止
2. 実行中agentへgraceful stop通知
3. save可能なartifact/checkpointを保存
4. leaseをrelease
5. timeout後はprocess終了

強制kill後はlease expiryとartifact照合で復旧する。

## 実装フェーズ

### H1 — Scheduler single owner

実装:

- APIのdefault autopilot schedulerを無効化またはworker-ownedへ変更
- project tick lease
- `next_tick_at`によるdue判定
- manual tickも同じlock

受入:

- API + worker同時起動でも同project同時tickなし
- worker再起動後にnext dueから継続

### H2 — Executor health / cooldown

実装:

- failure classifier
- executor `cooldown_until`
- global/provider failureとsite failureの分離
- backoff永続化

受入:

- rate limit 1回で複数siteへblockedが増えない
- cooldown中claimなし
- cooldown解除後に再開

### H3 — Artifact completion guard

実装:

- artifact manifest
- completion criteriaにartifact requirement
- `operation.complete` guard
- exit 0 without artifactをincomplete扱い

受入:

- empty/missing fileでcomplete不可
- valid artifactでcomplete可

### H4 — Draft writer vertical slice

実装:

- 1接続Blog siteを対象
- article path解決
- atomic save
- hash / manifest

受入:

- UI/APIなしで1記事draftが実ファイルに作られる
- 保存直後killから重複なしで復旧

### H5 — Independent validator

実装:

- article validator
- source-backed claim checks
- site build
- result hash/cache

受入:

- fabricated numeric claimをfail
- source不一致をfail
- content hash不変ならvalidator再利用

### H6 — Revision state machine

実装:

- failed check → revision task
- revision_key
- max revisions
- resume reason allowlist

受入:

- 同じ本文を無限再採点しない
- DNS/human pauseをquality gateが勝手にresumeしない

### H7 — Blog delivery E2E

実装:

- local complete後だけhandoff
- receipt idempotency
- publish verification

受入:

- response lost後の再送で二重公開なし
- HTTP/canonical確認なしにpublishedへしない

### H8 — Minimal article UI

実装:

- Articles
- In progress
- Needs attention
- Executor health

内部Operation / lease / runはdetailsへ移す。

## Acceptance suite

CIに最低限追加する。

1. executor selection smoke
2. scheduler lock smoke
3. executor cooldown smoke
4. exit-0-without-artifact smoke
5. artifact atomic-save/resume smoke
6. validator cache smoke
7. revision-key smoke
8. explicit-pause-no-resume smoke
9. Blog handoff response-loss smoke
10. one-article headless vertical fixture

既存 `autopilot-smoke` は制御面fixtureであり、実記事本文生成の代替ではない。

## Definition of Done

「自律記事生成完成」と呼べる条件:

- [ ] worker単独で1記事を実ファイルへ生成
- [ ] sourceと本文の独立検証pass
- [ ] site build pass
- [ ] artifact manifest保存
- [ ] artifact確認なしのOperation complete不可
- [ ] scheduler single owner
- [ ] executor common-failure cooldown
- [ ] draft保存直後killからresume
- [ ] validator途中killからresume
- [ ] Blog receipt応答喪失からidempotent resume
- [ ] explicit pause / human boundaryを自動resumeしない
- [ ] 同一本文の無限revisionなし
- [ ] 上記がCIで再現可能

公開自律性まで完成と呼ぶには、さらに:

- [ ] autoPublish許可siteのみdelivery
- [ ] 実配信確認
- [ ] 二重公開防止
- [ ] publication capacity維持

## 計測

主要指標:

- time to first draft
- time to local complete
- cost per local-complete article
- external requests per article
- revision count
- interrupted-work duplication ratio
- human interventions per article
- no-progress retries
- executor cooldown incidents

数えないもの:

- tick数
- candidate数
- ON project数
- page plan数
- Operation作成数

## 次に実装する順番

`H1 → H2 → H3 → H4 → H5 → H6 → H7 → H8`

優先順位の理由は、UI改善より先に「二重実行しない」「共通障害を連鎖させない」「成果物なしで完了しない」を保証し、その後に1記事の実ファイル縦通しを完成させるため。