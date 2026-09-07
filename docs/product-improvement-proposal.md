# Keywords 実用化・使いやすさ改善案

作成日: 2026-09-08

調査対象: `main`（`d43a33c`）時点の README、Web UI、既存コマンド層、および直前の操作記録

状態: 実装提案。この記事自体の変更はDB移行、外部サービス設定、課金、公開を伴わない。

## 0. 結論

`keywords` のバックエンドには、すでに SEO ワークスペースとして重要な部品が揃っている。問題は機能不足そのものより、**ユーザーが目的を渡してから、Agent が調査し、人間が根拠を見て判断するまでの1本の業務フローがUI上に存在しないこと**にある。

したがって、次の実装では「既存コマンドを全部Webフォーム化する」方向には進めない。

`keywords` は引き続き **Agent-native / human-governed** とし、Web UI は次の役割に絞る。

- 人間が目的・制約・対象を設定する
- Agent に仕事を渡す
- 実行中・停止中・確認待ちを把握する
- 候補と根拠を比較して採否を決める
- 企画をレビューする
- 次回、前回の続きから再開する

最初の実用化ゴールは、次の1本の流れを説明なしで完了できることとする。

```text
Project brief
    ↓
新しいキーワードを探す
    ↓
Agent work session / research
    ↓
候補 + 根拠 + 未確認事項
    ↓
採用 / 保留 / 除外 / 追加調査
    ↓
Cluster / existing page check
    ↓
Page plan
    ↓
Human review
```

記事本文生成、CMS投稿、外部公開は引き続き対象外とする。

---

## 1. 製品原則

### 1.1 Agent-native を崩さない

Google Ads、SERP、GSC、サイト同期などの各機能を人間が順番に手動操作するSEOダッシュボードにはしない。

人間は「何を探したいか」「どこまで調査してよいか」を指定し、Agent は既存の共有コマンドを使って必要な調査だけを行う。UI は Agent の操作を置き換えるのではなく、**依頼・監督・レビューのコントロールプレーン**とする。

### 1.2 証拠と解釈を分ける

取得値、SERP、サイト情報などの観測事実と、「狙う価値がある」「同じ検索意図である」といった判断を別モデルとして扱う。

特に広告 competition を SEO 難易度として表示しない。未取得、取得不能、0、推定値を区別する。

### 1.3 人間承認を境界として維持する

Agent は調査、整理、タスク化、企画提案までは行えるが、既存の human-only review 境界を迂回しない。

「承認」は記事公開を意味しない。今回のスコープでは、企画をワークスペース上で承認済みにするところまでとする。

### 1.4 途中で止まっても壊れない

外部API失敗、Agent切断、ブラウザ再読込、プロセス再起動が起きても、成功済み結果を失わず、同じ処理を二重登録せず、残りから再開できる設計にする。

### 1.5 既存の共有コマンド境界を守る

Web、CLI、API、MCP、Operator が独自SQL更新を持たない原則を維持する。状態遷移、予算、監査、冪等性は `packages/commands` 側で保証する。

---

## 2. 現状評価

README 上では Agent work loop、Human Review、Operator、GSC履歴、サイト同期、Ads/SERP/Web research、content planning まで実装済みである。一方、現在のWeb UIではそれらが多数のカードとして並列に露出しており、**機能は存在するがユーザー業務として接続されていない**。

| 観点 | 現状 | 問題 |
|---|---|---|
| Project | 名前・domain中心 | 調査対象、読者、言語、地域、除外範囲が定義できない |
| Home | 多数の機能カードを一画面表示 | 初回も再訪時も「次に何をするか」が弱い |
| Research | CLI/MCPには Ads/SERP/Web がある | Web上に「目的から探索を始める」入口がない |
| Operator | `tick` は次の共有タスクを作る | ボタン名から作業そのものを実行するように見える |
| Agent execution | work sessionはある | タスク作成、claim、実行待ち、Agent不在の区別がUIで弱い |
| Keywords | 未クラスタ語を一部表示 | 1000語規模の検索・絞込・状態管理ができない |
| Evidence | source一覧はある | どの値・候補・判断の根拠か追跡しにくい |
| Metrics | GSC履歴比較がある | 比較期間・property・search type・取得上限の説明が不足 |
| Refresh | 子コンポーネント単位で再取得 | Operator実行後に親のtask件数等が古いまま残り得る |
| Forms | async後にイベント参照してreset | 実装依存の不安定要因。失敗時の入力保持も統一されていない |
| Project switch | 複数fetchをまとめて管理していない | 古いprojectの応答が新project表示へ混ざる競合余地がある |
| Review | `window.prompt` を利用 | cancelと送信の境界が不明瞭で、review操作として弱い |
| Operations | SQLiteはGit外 | コード保存とユーザーデータ保全が別であることがUIから分かりにくい |

現在のコードでは `App.tsx` が snapshot、keywords、clusters、tasks、decisions、sources、insights、pages、cannibalization、policies を順番に取得している。UIの情報量増加に伴い、単一画面へ全状態を集約する方式は継続しない。

また、直前のテストプロジェクト「Planning Smoke」に登録した6語は探索デモであり、実サイト向け推奨データとして扱わない。テスト語の需要・言語・競合評価も本番判断へ流用しない。

---

## 3. 最初に作るべき製品フロー

### 3.1 Project brief

新規プロジェクト作成後、次を最低限設定する。

- mode: `existing_site` / `topic_only`
- site/domain（任意。topic_onlyでは不要）
- topic / product / service
- target audience
- language
- country / region
- excluded topics / terms

GSC、Ads、SERP等は「必須設定」ではなく capability として表示する。接続状態は最低でも次を区別する。

```text
not_configured
checking
available
expired
rate_limited
failed
```

認証情報の値はDBへ保存しない。UIには接続可否、最終成功時刻、設定方法だけを表示する。

### 3.2 Discovery job

ホームの主要CTAを **「新しいキーワードを探す」** とする。

ただし、Adsフォーム、SERPフォーム、suggestフォームを個別に並べない。ユーザーが入力するのは調査目的である。

最低入力:

- seed keywords または target URL
- exploration goal
- language / region（Project briefを初期値）
- excluded terms
- max candidates
- research budget / max external requests

開始時に、利用可能な provider と利用できない理由を表示する。

実行すると discovery job を作成し、共有 work session / task と接続する。初期実装では外部MCP Agentを実行者としてよい。Agent が接続されていない場合は「実行中」ではなく **waiting for agent** と表示する。

### 3.3 Agent research

Agent は固定順序ですべてのAPIを叩かない。

1. seedから候補生成
2. workspace内の重複・既存ページ確認
3. 候補の粗い需要確認
4. 上位候補だけSERP確認
5. 必要な候補のみ追加調査
6. 予算到達または判断材料充足で停止

外部リクエスト数と候補件数を work budget に含める。コマンド1回を「1 action」と数えるだけでは、1コマンド内部で大量取得できるため不十分である。

### 3.4 Candidate review

探索完了後、ユーザーに provider の生データを見せるのではなく、候補を比較可能な形で出す。

候補ごとに最低限表示するもの:

- keyword
- candidate status
- demand observation
- source / observed at / language / region
- search intent hypothesis
- existing page overlap
- SERP research status
- evidence count
- unresolved questions

人間の操作:

```text
shortlist
hold
reject
research_more
```

`shortlist` は「記事化決定」ではなく、次の planning 対象に入れる意味とする。

### 3.5 Planning / review

shortlistされた候補から cluster と既存pageを確認し、新規ページか既存ページ改善かを選ぶ。

Page planには最低限次を含める。

- target audience
- question / job to be solved
- primary keyword
- secondary keywords
- search intent
- existing competing pages
- unique information / angle
- evidence references
- unresolved assumptions
- rationale

その状態で Human Review に送り、approve / needs_edit / reject を行う。

---

## 4. 優先バックログ

P0は「誤判断を防ぎ、探索→候補確認まで通すために必要」、P1は「企画まで日常利用するために必要」、P2は「運用実績を見て強化」とする。

| ID | 優先 | 項目 | 完了条件 |
|---|---|---|---|
| B01 | P0 | UI state / refresh 修正 | mutation後に関連件数・一覧が同じ状態を示す |
| B02 | P0 | Project brief + capability診断 | topic-onlyでも探索開始できる |
| B03 | P0 | Discovery jobモデルと共有コマンド | Web/MCP/CLIが同じjob状態を扱える |
| B04 | P0 | Agent handoff + budget enforcement | Agent不在、実行中、停止、review待ちを区別できる |
| B05 | P0 | Evidence / metric semantics | 広告競合とSEO判断、0と未取得を混同しない |
| B06 | P0 | Discovery UI | 1つのseedから候補取得・途中失敗・再開まで確認できる |
| B07 | P1 | Keyword workspace | 1000語規模で検索・絞込・候補状態変更ができる |
| B08 | P1 | Planning + Human Review | shortlistから根拠付きpage planを承認できる |
| B09 | P1 | Site/GSC reliability | 比較条件、同期結果、取得上限、失敗状態を説明できる |
| B10 | P1 | Navigation / Japanese UX | 初見ユーザーが主要フローを迷わない |
| B11 | P1 | Startup / DB backup / diagnostics | 再起動・別プロセス・復元後も同じworkspaceを辿れる |
| B12 | P2 | Continuous discovery / learning | 採用率・保留理由・後日成果から探索条件を改善できる |

---

## 5. P0詳細

### B01 UI state / refresh

まず既存UIの信頼性を直す。

- mutation後に関連queryをまとめてinvalidate/reloadする
- `operator.tick` 後に operatorカードだけでなく tasks / snapshot counts / work state も更新する
- project ID を取得キーに含める
- project切替時は旧requestをcancelするかgeneration tokenで無効化する
- submit開始時にform element / valuesを保持し、成功後だけresetする
- 失敗時は入力を保持する
- mutation buttonは二重submitを防止する
- cancelされたreviewを送信しない
- loading / empty / error / stale を別状態にする

現状の `App.tsx` の全データ逐次取得は分割する。各画面が必要なデータだけ取得し、Home用summary endpointまたはsummary commandを用意する。

受け入れ条件:

- 再読み込みなしで件数と一覧が一致する
- project切替中に旧projectのデータが出ない
- 連打・retryで同一mutationが二重登録されない
- review cancelで状態が変わらない

### B02 Project brief / capability診断

Project設定は単なるname/domainではなく、Agentの調査境界として使う。

Agentがユーザー確認なしに language / region / audience を変更しない。探索単位で上書きする場合は、そのjobの実行条件として保存する。

接続診断では、GSCなしでも topic-only discovery が可能であることを明示する。Ads unavailableなら、そのjobで利用できる他のresearch手段を示す。

### B03 Discovery job

探索を単なる一括keyword importとして扱わない。1回の探索を追跡可能なjobとして保存する。

提案する概念モデル:

```text
discovery_job
- id
- project_id
- objective
- seeds / target_url
- language
- region
- exclusions
- candidate_limit
- external_request_limit
- status
- created_by
- created_at
- started_at
- finished_at
- work_session_id
- task_id
- summary
```

status案:

```text
queued
waiting_for_agent
running
blocked
awaiting_review
completed
failed
cancelled
```

正確なtable分割は実装時に決めてよいが、UIだけの一時状態にはしない。

同一jobの再開、retry、Agent再接続が同じjobへ戻るようにする。

### B04 Agent handoff / budget

Operatorは「次に何をすべきか」を選ぶ機能であり、SEO作業の実行器にはしない。この境界は維持する。

Discovery開始時は共有task / work sessionを作り、Agentがclaimして実行する。

必要な保証:

- task claimは一意
- leaseまたはheartbeatで死亡したexecutorを回収可能
- awaiting_review中は勝手に続行しない
- project境界を越えるIDはcommand層で拒否
- max actionsだけでなくexternal requests / candidate writesも上限化
- 予算予約 → 外部取得 → DB保存 → 予算精算の順で扱う
- 外部通信中に長時間DB transactionを保持しない

初期版でアプリ内LLM runnerは不要。外部MCP Agentで成立するUXを先に作る。

### B05 Evidence / metric semantics

既存の `source` と `insight` の考え方は維持するが、keyword observationとの関係を明確にする。

最低限、数値観測には次を持たせる。

```text
provider
metric_type
value
observed_at
language
region
period
requested_keyword
returned_keyword
source_id
```

状態は少なくとも以下を区別する。

```text
not_researched
unavailable
zero
observed
estimated
stale
```

Google Ads competitionはUI上で「広告競合度」とする。これをSEO難易度として使う既存 `lowCompetitionDemand` lens は、名称・説明・優先順位利用を再検討する。

SERPは最低限 query、日時、国・言語、rank、URL、title を保持する。Agentの所見は source / observation への参照を持つ。

「Google suggest 0件」「Bing relatedに出た」などを検索需要の有無の断定には使わない。

### B06 Discovery UI

1画面で次を確認できるようにする。

上部:

- objective
- seeds
- scope
- providers available
- budget
- status
- Agent / executor

実行中:

- completed steps
- collected candidates
- requests used / limit
- blockers
- next action

完了後:

- new candidates
- already known
- rejected by rule
- needs research
- failed observations

jobのログ全文や内部command名を主画面には出さない。必要ならdiagnostics drawerへ置く。

---

## 6. P1詳細

### B07 Keyword workspace

現在の `slice(0,12)` 型表示を廃止し、全件workspaceを作る。

必要機能:

- server-side pagination
- text search
- sort
- filters
- multi-select
- bulk shortlist / hold / reject
- cluster filter
- existing-page filter
- researched / unresearched filter
- source/provider filter

Keyword detailでは、観測値、SERP、GSC、cluster、page、evidence、判断履歴を1つにまとめる。

1000語以上でも全件をブラウザへ一括転送しない。

### B08 Planning / Human Review

Cluster detailから所属keywordとexisting/proposed pagesを辿れるようにする。

Agentが cluster merge や keyword move を提案する場合も、共有commands経由で監査する。

Cannibalizationは固定スコアだけで自動確定せず、URL overlapやSERP intentを根拠として提示する。

Page reviewは `window.prompt` を廃止し、review drawer/modalで次を同時表示する。

- proposal
- target keywords
- competing workspace pages
- evidence
- unresolved assumptions
- approval impact

### B09 Site / GSC reliability

GSC比較は「直近2件」というだけで組み合わせない。

同じ以下の条件で比較する。

- property
- search type
- period length
- dimension level

7日 vs 28日など期間長が違う値から単純declineを作らない。未完了期間、取得上限、pagination不足をUIで明示する。

site syncは次を区別する。

```text
new
updated
seen
not_observed
failed
```

`not_observed` を削除扱いにしない。slug一致だけで別URLを安易に同一pageへ結び付けない。

### B10 Navigation / Japanese UX

Web UIは次の6領域へ分ける。

| 画面 | 役割 |
|---|---|
| ホーム | 次の作業、実行中、確認待ち、最近の成果 |
| 探索 | Discovery jobの作成・実行状況・結果 |
| キーワード | 候補の検索・比較・選別 |
| コンテンツ | Cluster、existing pages、page plans |
| レビュー | Human Review Inbox |
| 設定 | Project brief、接続、運用、データ保全 |

GSCは必要に応じて「検索実績」サブ画面としてContent/Homeから開けるようにする。内部データモデル名をそのまま主要ナビゲーションには使わない。

日本語を初期表示にし、例えば以下のように目的ベースで命名する。

```text
Work sessions → 作業履歴
Sources → 調査の根拠
Operator → 次の作業
Policy memory → 運用ルール
```

### B11 起動 / DB保全

診断コマンドで次を確認できるようにする。

- Node / package manager
- lockfile整合
- DB absolute path
- migration status
- API reachability
- provider env availability
- writable data directory

API、CLI、MCPがworking directoryの違いで別SQLiteを開かないようにする。

SQLite backup / restoreを正式な操作として用意する。Git repositoryのpushとworkspace data backupは別物であることを設定画面とREADMEに明記する。

---

## 7. 状態モデルの整理

UIで曖昧になりやすい状態を先に定義する。

### Candidate status

提案:

```text
candidate     未判断
shortlisted   planning対象
held          今は保留
rejected      対象外
planned       page planへ接続済み
```

`keyword` 自体と「今回のdiscoveryでのcandidate判断」を分ける必要がある場合は、join modelを置く。既存keyword rowのstatusへすべて押し込むかはDB設計時に決める。

### Research status

```text
not_researched
researching
sufficient
needs_more
unavailable
failed
stale
```

### Execution status

```text
queued
waiting_for_agent
running
blocked
awaiting_review
completed
failed
cancelled
```

UIでは `waiting_for_agent` と `running` を絶対に同じ表示にしない。

---

## 8. Command / package boundary

既存アーキテクチャを維持する。

- `packages/db`: schema / migration / query primitives
- `packages/research`: 外部読み取りとresponse normalization。workspace mutationはしない
- `packages/commands`: mutation、状態遷移、budget、idempotency、project ownership、audit
- `apps/api`: transport adapter
- `apps/cli`: human/operator adapter
- `apps/mcp`: Agent adapter
- `apps/web`: human control/review UI
- `Operator`: next justified taskの選定。execution engineではない

新しい discovery 系も同じ構造にする。

概念上必要な共有command:

```text
discovery.create
discovery.start
discovery.context
discovery.checkpoint
discovery.add_candidates
discovery.record_observations
discovery.finish
discovery.fail
candidate.review
candidate.bulk_review
```

名称は既存命名規則に合わせて実装時に確定する。

外部入力のvalidation、project ownership、状態遷移、idempotency keyはAPI層ではなく共有command層で保証する。

---

## 9. 実装単位

巨大な全面改修ではなく、次の順でPRを分ける。

### PR 1 — Web state reliability

- mutation後refresh統一
- project switch race対策
- form error / cancel / double-submit修正
- loading / empty / error区別
- `Tick` 表示の修正

出口: 現在のUIが表示している状態を信頼できる。

### PR 2 — Project brief / capabilities

- project target schema
- setting commands
- Web設定画面
- provider capability status

出口: siteなしでも調査対象を定義できる。

### PR 3 — Discovery domain / commands

- discovery job schema
- lifecycle commands
- work session / task connection
- budget / idempotency
- smoke tests

出口: CLI/MCPだけでも1つのjobを開始・再開・完了できる。

### PR 4 — Discovery Web flow

- 「新しいキーワードを探す」
- job progress
- Agent waiting / running表示
- result summary

出口: Webからjobを作り、Agent結果まで辿れる。

### PR 5 — Evidence + Keyword workspace

- observation/source relation
- metric semantics修正
- keyword pagination/search/filter
- candidate review

出口: 候補の根拠を見て採否を判断できる。

### PR 6 — Planning / review

- cluster detail
- existing page comparison
- page plan detail
- review UI

出口: shortlist 1件からpage plan承認まで通る。

### PR 7 — Site/GSC hardening

- comparison identity
- pagination/completeness
- sync result states
- recovery tests

### PR 8 — Operations

- diagnostics
- backup / restore
- clean-install verification
- README更新

最初の実用化リリースは **PR 1〜6** を完了条件とする。PR 7〜8は継続利用の品質を上げるため早めに続ける。

---

## 10. 受け入れシナリオ

| シナリオ | 合格条件 |
|---|---|
| 初回・サイトなし | topic、language、regionを指定して探索jobを作れる |
| Agent未接続 | waiting_for_agentとなり、実行中と誤表示しない |
| 新規探索 | seedからcandidate、evidence、未確認事項を取得できる |
| Ads未設定 | job自体を不必要に失敗させず、利用可能手段と不足設定を示す |
| 外部API途中失敗 | 成功済み結果を保持し、retryで重複しない |
| 全件既存 | 0 new candidatesを正常結果として表示する |
| 件数増加 | 1000 keywordsで検索・絞込・paginationできる |
| Project切替 | 遅い旧requestが別projectへ表示されない |
| Human Review | Agent/MCPからhuman-only境界を迂回できない |
| Review cancel | mutationが起きない |
| 同時Agent | 同じtask/jobを二重実行しない |
| Budget | 並行外部requestでも設定上限を超えない |
| GSC比較 | 異なる期間長/property/search typeをdeclineとして混ぜない |
| 再起動 | running/blocked/review状態を復元して続きを確認できる |
| DB復元 | candidate、evidence、job、work session、reviewの参照が保たれる |

外部APIは通常CIでfixtureを使い、設定済み環境だけ少量の実接続 smoke を行う。テストデータと実測データは明示的に分ける。

---

## 11. 今回やらないこと

以下は現時点で追加しない。

- 記事本文生成
- WordPress等への公開
- 汎用AIチャット画面
- UI上に全providerの低レベルフォームを並べること
- 独自の不透明な総合SEOスコア
- 内蔵LLM runnerを前提とした常駐Agent基盤
- multi-tenant SaaS認証・課金
- 「完全自動SEO」のためにHuman Reviewを削ること
- 見た目だけの全面リデザインを先行すること

まずは現在の強みである **共有SQL状態 + Agent work loop + evidence + human review** を、ユーザーが実際に使える1本の体験へ接続する。

---

## 12. 実用化のDefinition of Done

最初の実用化は、機能数ではなく次を満たした時点とする。

1. 初見ユーザーが5分以内にProject briefを作り、探索を開始できる。
2. Agentの実行状態と停止理由をUIから誤解なく把握できる。
3. 1つの探索で候補がどこから来たか、何が未確認か説明できる。
4. 広告競合、SEO所見、検索需要、既存page overlapを混同しない。
5. 1000語規模でも候補を検索・選別できる。
6. shortlistから根拠付きpage planを作り、人間がレビューできる。
7. 外部API失敗・再読み込み・再起動後も同じjobから再開できる。
8. Web、CLI、MCP、Operatorが同じcommand境界と停止条件を使う。

この8条件を満たせば、`keywords` は「多数のSEO機能を持つ開発用workspace」から、**人間が目的を渡し、Agentが調査し、人間が根拠を見て次のコンテンツを決められる実用ツール**になる。