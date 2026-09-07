# Keywords 実用化・使いやすさ改善 — 実装完了記録

作成日: 2026-09-08  
完了日: 2026-09-08  
状態: **✅ IMPLEMENTED / COMPLETE**  
対象ブランチ: `main`  
完了時 `main` HEAD: `bb97db7`  
最終CI: GitHub Actions `ci` run #321 — **success**

> この文書は当初 `keywords` の実用化・使いやすさ改善提案として作成したが、提案した実装範囲 B01〜B12 はすべて `main` へ反映済みである。以降は「未実装の提案書」ではなく、実装方針・完了内容・受け入れ条件を残す完了記録として扱う。

---

## 0. 完了サマリー

今回の改善で、`keywords` は多数のSEO機能を個別に操作する開発用workspaceから、次の一連の業務フローを共有状態のまま扱える **Agent-native / human-governed SEO workspace** へ移行した。

```text
Project brief
    ↓
新しいキーワードを探す
    ↓
Discovery job
    ↓
Agent claim / research / heartbeat
    ↓
候補 + Evidence + 未確認事項
    ↓
shortlist / hold / reject / research_more
    ↓
Keyword workspace
    ↓
Cluster / existing page check
    ↓
Page plan
    ↓
Human review
    ↓
継続探索への学習フィードバック
```

記事本文生成、CMS投稿、外部公開は今回のスコープ外のままであり、Human Review の境界も維持している。

### 実装完了した主要領域

- Project brief / provider capability 診断
- Discovery job の永続モデル
- Agent claim / lease / heartbeat / 期限切れexecutor回収
- external request / candidate write の上限管理
- idempotency key による外部調査の重複防止
- Candidate review と Evidence 追跡
- Keyword workspace の検索・pagination・filter・bulk review
- Keyword detail の Evidence / GSC / page / decision history
- Cluster → Page plan → Human Review
- GSC比較条件と取得完全性の明示
- Site sync / Operator / navigation の整理
- SQLite diagnostics / backup / restore
- Continuous discovery / learning feedback
- Web state reliability / project switch / form / review cancel 修正

---

## 1. 製品原則 — 実装後も維持する境界

### 1.1 Agent-native / human-governed

Google Ads、SERP、GSC、サイト同期を人間が固定順序で操作するダッシュボードにはしない。

人間は目的・制約・予算を定義し、Agent が共有コマンドを通じて必要な調査を行う。Web UI は依頼・監督・候補判断・Human Review のコントロールプレーンとして機能する。

### 1.2 証拠と解釈を分離

観測値と判断を別物として扱う。

特に Google Ads competition は「広告競合度」であり、SEO難易度として扱わない。`0`、未取得、取得不能、推定、古い観測を同一視しない。

### 1.3 Human Review を迂回しない

Agent / MCP は調査・整理・企画提案まで行えるが、人間専用レビューを迂回できない。

Page plan の承認は公開操作ではなく、workspace上の企画承認である。

### 1.4 途中停止と再開に耐える

外部API失敗、Agent切断、ブラウザ再読込、プロセス再起動を前提に状態をSQLへ保存する。

成功済み結果を保持し、idempotency / budget / lease によって二重処理や暴走を防ぐ。

### 1.5 共有command境界

責務は次のまま維持する。

- `packages/db`: schema / migration / query primitives
- `packages/research`: 外部読み取りとresponse normalization
- `packages/commands`: mutation / state transition / budget / idempotency / ownership / audit
- `apps/api`: transport adapter
- `apps/cli`: human/operator adapter
- `apps/mcp`: Agent adapter
- `apps/web`: human control/review UI
- Operator: next justified task の選定。execution engine ではない

---

## 2. 実装完了バックログ

| ID | 優先 | 項目 | 状態 | 完了内容 |
|---|---|---|---|---|
| B01 | P0 | UI state / refresh 修正 | ✅ 完了 | mutation後refresh、project switch race、form保持、double-submit、review cancel等を修正 |
| B02 | P0 | Project brief + capability診断 | ✅ 完了 | topic-onlyを含むProject briefとprovider状態を共有状態化 |
| B03 | P0 | Discovery jobモデルと共有コマンド | ✅ 完了 | Web / MCP / CLI が同じDiscovery jobを操作 |
| B04 | P0 | Agent handoff + budget enforcement | ✅ 完了 | claim、lease、heartbeat、回収、external request / candidate write上限を実装 |
| B05 | P0 | Evidence / metric semantics | ✅ 完了 | Evidence link、観測状態、広告競合とSEO判断の分離を実装 |
| B06 | P0 | Discovery UI | ✅ 完了 | job作成、waiting/running/review、進捗、結果内訳、回収を表示 |
| B07 | P1 | Keyword workspace | ✅ 完了 | server-side pagination、検索、sort、filter、multi-select、bulk review、detailを実装 |
| B08 | P1 | Planning + Human Review | ✅ 完了 | shortlist → cluster → evidence-backed Page plan → Human Review を接続 |
| B09 | P1 | Site/GSC reliability | ✅ 完了 | property/search type/period互換比較、row limit/completeness、同期状態を改善 |
| B10 | P1 | Navigation / Japanese UX | ✅ 完了 | 目的ベースの画面分割と日本語中心の主要導線へ整理 |
| B11 | P1 | Startup / DB backup / diagnostics | ✅ 完了 | DB診断、整合バックアップ、restore、復元後再読込を実装 |
| B12 | P2 | Continuous discovery / learning | ✅ 完了 | reject/hold理由、provider採用率、planning/GSC結果から次回探索の材料を生成 |

**B01〜B12: 12 / 12 完了。**

---

## 3. 完成した製品フロー

### 3.1 Project brief

プロジェクトごとに以下を保持できる。

- `existing_site` / `topic_only`
- site/domain
- topic
- target audience
- language
- country / region
- excluded terms
- discovery cadence
- candidate limit
- external request limit

Providerは必須依存ではなく capability として扱い、利用不可でも可能な範囲のworkflowを継続できる。

### 3.2 Discovery job

人間がseed keywordまたはtarget URLと探索目的を渡すとDiscovery jobを作成する。

状態は永続化され、少なくとも次を区別する。

```text
waiting_for_agent
running
blocked
awaiting_review
completed
failed
cancelled
```

`waiting_for_agent` と `running` はUIでも明確に分離している。

### 3.3 Agent execution

Discovery executionには以下を実装した。

- 一意claim
- executor ID
- lease
- heartbeat
- expired executor recovery
- work session / task connection
- Human Review待機中の自動続行防止

Agentが停止しても、期限切れleaseを回収して同じjobから再開できる。

### 3.4 Budget / idempotency

external request はDB上で予約してから外部通信を行う。

- request reservation
- max external requests
- idempotency key
- succeeded / failed / in-progress の区別
- 同一keyの二重消費防止
- candidate write の原子的上限管理

候補上限については、**candidate slot確保後にのみ新規Keywordをupsert**する順序へ修正済みであり、上限外の語がKeyword Workspaceへ漏れないこともsmoke testで検証している。

### 3.5 Candidate review

候補はDiscovery job単位で次の状態を持つ。

```text
discovered
shortlisted
hold
rejected
research_more
planned
```

Human Reviewでは判断理由を保存する。

Discovery summaryでは以下を区別する。

- new candidates
- already known
- rejected by rule
- needs research
- failed observations
- request budget
- candidate write budget

### 3.6 Keyword workspace

全件一括表示を避け、server-side paginationを前提としたworkspaceへ変更した。

実装済み:

- text search
- sort
- candidate status filter
- cluster filter
- existing page filter
- research status filter
- provider filter
- multi-select
- bulk shortlist / hold / reject

Keyword detailでは次をまとめて確認できる。

- candidate history
- Evidence
- GSC observations
- cluster / page relations
- human/system decisions

### 3.7 Planning / Human Review

shortlistされたcandidateからclusterへ割り当て、Page planを作成できる。

Page planには次を保持・表示する。

- target audience
- question / job to be solved
- primary / secondary keywords
- search intent
- existing competing pages
- unique angle
- Evidence references
- unresolved assumptions
- rationale
- existing page improvement target

Human Reviewでは proposal、keywords、competing pages、Evidence、未確認事項、approval impactを同じ文脈で確認できる。

承認によるpublish side effectはない。

### 3.8 Site / GSC

GSCのdecline比較は次の互換条件を満たすsnapshot同士だけを比較する。

- Search Console property
- search type
- period length
- non-overlapping periods

UIにはproperty、search type、期間、row limit、取得完全性を表示する。

上限到達を「0件」や「完全取得」と誤解しない。

### 3.9 Continuous discovery

継続探索summaryでは以下を次の探索判断に利用できる。

- shortlist / hold / reject / planned件数
- reject理由
- hold理由
- provider別performance
- planning化されたcandidate
- 後日GSCで観測できる成果
- 次回探索の調整候補

継続探索は勝手に外部APIを実行せず、期限到来をOperatorが理由付きタスクとして扱う。

---

## 4. UI構成

主要ナビゲーションは、低レベルな内部機能名ではなくユーザーの目的を基準に整理した。

```text
ホーム
探索
キーワード
コンテンツ計画
検索実績
作業・レビュー
設定
```

各画面が必要な状態を取得し、旧来の巨大な単一画面へ全情報を集約する設計から離れている。

---

## 5. 受け入れシナリオ — 実装状態

| シナリオ | 状態 | 実装上の保証 |
|---|---|---|
| 初回・サイトなし | ✅ | topic-only Project briefからDiscovery jobを作成可能 |
| Agent未接続 | ✅ | `waiting_for_agent` として保存・表示 |
| 新規探索 | ✅ | candidate / Evidence / unresolved questionsを共有状態化 |
| Ads未設定 | ✅ | capabilityとして扱い、Project全体を不要に失敗させない |
| 外部API途中失敗 | ✅ | 成功済み状態を保持し、reservation/idempotencyで重複防止 |
| 全件既存 | ✅ | already-knownを正常な探索結果として分類 |
| 件数増加 | ✅ | server-side pagination / search / filterを実装 |
| Project切替 | ✅ | 旧requestの混入を防止 |
| Human Review | ✅ | human-only command境界を維持 |
| Review cancel | ✅ | cancelでmutationしない |
| 同時Agent | ✅ | 一意claim + lease ownership |
| Budget | ✅ | external request / candidate writeを原子的に制限 |
| GSC比較 | ✅ | property / search type / period lengthを揃えて比較 |
| 再起動 | ✅ | job/work/review状態はSQLiteから再取得可能 |
| DB復元 | ✅ | backup → restore → project再読込をCIで検証 |
| Candidate cap | ✅ | 上限外candidateのKeyword漏れを回帰テストで防止 |

---

## 6. CI / 検証結果

完了時の最終検証:

- GitHub Actions workflow: `ci`
- run: **#321**
- result: **success**
- validated HEAD: `bb97db7`

成功した検証:

### Typecheck

- `@keywords/domain`
- `@keywords/db`
- `@keywords/research`
- `@keywords/commands`
- `@keywords/api`
- `@keywords/cli`
- `@keywords/mcp`
- `@keywords/web`

### Runtime / smoke

- DB init
- migration smoke
- planning smoke
- policy smoke
- work-loop smoke
- review smoke
- operator smoke
- product workflow smoke
- candidate cap / leak regression
- external request budget / idempotency
- lease recovery
- SQLite backup
- SQLite restore
- restored DB project read
- Web production build

最終的に `main` と実装ブランチは同一HEADへfast-forwardされている。

---

## 7. Definition of Done — 完了判定

当初の実用化Definition of Doneに対する実装判定:

- [x] Project briefから探索を開始できる
- [x] Agentのwaiting / running / stopped / review状態を区別できる
- [x] candidateの由来・Evidence・未確認事項を追跡できる
- [x] 広告競合、SEO所見、需要、existing-page overlapを分離できる
- [x] 大量keywordを検索・絞込・paginationできる
- [x] shortlistからEvidence付きPage planを作りHuman Reviewできる
- [x] 外部API失敗・Agent停止後もjob状態を保持し再開可能
- [x] Web / CLI / MCP / Operatorが共有command境界を利用する
- [x] 外部requestとcandidate writeのbudgetを強制できる
- [x] DB backup / restore後もworkspace参照を維持できる
- [x] 最終CIが成功している
- [x] 完成版が`main`へ反映されている

**実装上のDefinition of Doneは完了。**

なお、「初見ユーザーが実時間で5分以内に操作できるか」のような定量UX指標は、実ユーザーによるユーザビリティ計測の対象であり、今回の実装完了判定とは分離する。

---

## 8. 今回のスコープ外

以下は未完了項目ではなく、当初から今回の実用化スコープ外としたもの。

- 記事本文生成
- WordPress等への自動公開
- 汎用AIチャット画面
- UI上に全providerの低レベルフォームを並べること
- 独自の不透明な総合SEOスコア
- 内蔵LLM runnerを前提とした常駐Agent基盤
- multi-tenant SaaS認証・課金
- Human Reviewの削除

これらを将来追加する場合は、本ドキュメントの未完了作業ではなく**別の提案・別スコープ**として扱う。

---

## 9. 最終状態

`keywords` は今回の改善により、次の状態まで到達した。

> **人間が目的と制約を渡し、Agentが予算内で調査し、Evidence付き候補を人間が選別し、Page planをレビューし、その判断結果を次回探索へ返せるSEO workspace。**

本ドキュメントに記載していた実装改善は **完了済み** である。
