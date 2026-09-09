# 記事制作を中心にした自律実行監査

最終確認: 2026-09-09 / `main` (`d96882f51d9b32c2a81c308d01df49f3ebb31c96`)

この文書は、Keywords の自律SEO機能を「Operation が動くか」ではなく「人間の通常操作なしで、実際の記事成果物を安全に完成できるか」という基準で監査したもの。UI は任意の観測窓とし、生成の前提にしない。ヘッドレス実行の目標アーキテクチャと実装順は [headless-generation-improvement.md](headless-generation-improvement.md) を参照する。

## 結論

現状は **自律実行の制御基盤は成立しているが、自律記事生成の完成条件には未到達**。

すでに修正済みなのは、executor が実行不能な先頭候補で止まる問題、停止中の子 `work_session` を claim してしまう問題、`autopilot-smoke` が指定DBを削除し得るテスト危険性。これらは未解決P0として扱わない。

一方、以下は現在も記事生成を「完成」と呼べない主要因である。

1. API と runner の両方が Autopilot を tick し、scheduler の責任が二重化している。
2. 外部agentが終了コード0なら、本文成果物を確認せず親Operationを complete できる。
3. executor 自体の利用上限・認証・起動失敗をサイト固有blockedへ変換し、共通障害の連鎖を起こし得る。
4. 品質ゲートは保存済みsource IDの存在確認等は行うが、publication score / evidence score 等の中心値をagent提出packetに依存しており、記事本文そのものの独立検証ではない。
5. Keywords → Blog は handoff/receipt の制御面を持つが、「1記事の本文を実ファイルへ保存→内容検証→build→差分記録」までの縦通し受入試験がない。
6. `revise`、blocked、awaiting review の再開条件が粗く、品質待ち以外の停止理由まで再開対象になり得る。

## 監査範囲

確認対象:

- `packages/commands/src/executor.ts`
- `packages/commands/src/autopilot.ts`
- `packages/commands/src/autonomy.ts`
- `packages/commands/src/operator.ts`
- `scripts/autopilot-runner.ts`
- `scripts/autopilot-smoke.ts`
- `scripts/executor-selection-smoke.ts`
- `apps/api/src/index.ts`
- `.github/workflows/ci.yml`
- Blog連携の既存commands / handoff契約

今回確認していないもの:

- 全接続サイトの公開疎通
- 実Blog repository上で生成された記事本文品質
- 実ブラウザでのUI受入
- 実executorの利用上限発生時の長時間挙動
- 公開後の検索成果

したがって、型チェックやfixture smokeの成功を実記事生成・公開成功・SEO成功とはみなさない。

## 到達目標

ユーザーは初回に対象サイト、編集方針、費用・本数上限、公開モードを設定する。以後の通常フローはagentが材料収集、企画、執筆、保存、検証、修正まで進める。ユーザーの通常操作は完成記事を見ること、停止すること、例外判断だけに限定する。

状態は最低でも次の3つに分離する。

- **生成完了**: 本文ファイル、対象記事ID、版、根拠、検証結果、差分が揃う。
- **公開完了**: 許可された公開操作を行い、実配信を確認する。
- **検索成果**: 後日の実測値で評価する。

Operation終了、企画承認、handoff作成、プロセス終了コード0は生成完了ではない。

## 実装状態

| 状態 | 優先 | 項目 | 現状 | 次の処置 |
|---|---:|---|---|---|
| ✅ 修正済み | P0 | executor が実行不能な先頭候補で停止 | `candidate()` は候補列を権限判定して最初の実行可能項目を選ぶ | 回帰試験をCIへ追加 |
| ✅ 修正済み | P0 | 停止中子sessionをclaim | `work_session_id` がある場合 `ws.status='running'` のみ対象 | blocked / paused / awaiting_review を継続して除外 |
| ✅ 修正済み | P0 | 存在しない `operation_controls.enabled` 参照 | executor は `operation_controls.paused` と autonomy/delegation を使用 | schema変更時の回帰を維持 |
| ✅ 修正済み | P1 | `autopilot-smoke` のDB削除危険 | `mkdtempSync()` 配下の一時DBを強制 | 他smokeも同方針に統一 |
| ❌ 未解決 | P0 | scheduler二重化 | APIは既定5分で `autopilotCommands.tick()`、runnerも既定30秒で全ON projectをtick | scheduler ownerを1つに固定。手動tickも同じ排他制御へ |
| ❌ 未解決 | P0 | 成果物未確認のcomplete | runnerはagent終了コード0かつ work が blocked/review でなければ親Operationをcomplete | artifact manifest / required checks を照合してからcomplete |
| ❌ 未解決 | P0 | executor共通障害の誤分類 | 非0終了を対象Operationのblockedに変換 | executor health / cooldown / backoffを導入し、サイト状態と分離 |
| ❌ 未解決 | P0 | 実記事の縦通し未証明 | handoff契約とfixtureはあるが、実本文ファイル完成までの受入がない | 1接続サイトで draft→file→review→build→artifact記録を実証 |
| ⚠️ 部分実装 | P0 | 品質ゲート | source ID存在、future date、target conflict等は検証するが、主要スコアはagent packet由来 | 本文・原典から独立算出する検証器を公開判断へ追加 |
| ❌ 未解決 | P1 | reviseと再採点 | fingerprint再利用はあるが、本文版が変わらない限り待つ仕組みではない | content/artifact hash + validator versionで再検査条件を固定 |
| ❌ 未解決 | P1 | 停止理由別resume | gate後に activeAfter が非activeなら理由を限定せずresumeし得る | `pause_reason` / `blocker_class` を明示し品質待ちだけ再開 |
| ⚠️ 部分実装 | P1 | operator優先順位 | 未完session/taskを優先する一方、sitemap/GSC/構造化/探索も同一候補列で競合 | production work と maintenance work の予算・queueを論理分離 |
| ❌ 未解決 | P1 | 実働予算 | runner heartbeat と作成時刻中心で、成果進展のない実働を直接止めない | active runtime / external request / progress timestampを永続化 |
| ❌ 未解決 | P1 | portfolioのexecutor表示 | connectedAgentsはprojectごとのactive executor表示から数える | executor実体を正本にunique集計し、cooldown/limit状態も表示 |
| ❌ 未解決 | P1 | queuedの意味 | active Operationで接続executorが見えないprojectをqueued扱いできる | runnable / paused / disabled / executor_unavailable を分離 |
| ❌ 未解決 | P1 | UIの情報設計 | Operation中心の画面が残り、完成記事中心にはなっていない | 記事・制作中・要判断を主画面にし内部制御は詳細へ |
| ⚠️ 部分実装 | P1 | runtime受入 | CIは多数のsmokeを実行するが executor-selection smoke はCIに未接続、実記事強制終了試験もない | 新しいheadless acceptance suiteへ統合 |

## P0の詳細

### 1. schedulerを一本化する

現在はAPIプロセスが `KEYWORDS_AUTOPILOT_INTERVAL_MINUTES` で定期tickし、`scripts/autopilot-runner.ts` も独自poll loopで `enabledProjects()` をtickする。APIとrunnerを同時に起動した場合、同じprojectへ別周期のtickが入る。

目標:

- production scheduler ownerはworkerだけにする。
- APIは観測・設定・明示的なmanual triggerのみ。
- manual triggerはschedulerと同じproject lease / tick lockを取得する。
- `autopilot_state.next_tick_at` を実際のclaim条件として使う。
- 同じprojectのtickが並行実行されないことをDBで保証する。

### 2. Operation完了を成果物契約へ接続する

runnerの現状は「agent processが0で終了した」を強く信頼しすぎている。記事制作Operationには最低限、次を成果物manifestとして持たせる。

- article/page ID
- repository / working tree識別子
- 本文ファイルpath
- content hash
- source IDs
- validator version
- build/check結果
- diffまたはbefore/after hash
- generated_at / verified_at

`operation.complete` は対象Operationのcompletion criteriaに必要なartifactが存在し、検証済みの場合だけ許可する。artifactがない0終了は `incomplete` として再開可能にする。

### 3. executor障害とsite障害を分離する

次はsite blockedにしてはいけない。

- CLI利用上限
- executor認証失敗
- executable not found
- MCP起動失敗
- model/provider unavailable
- Node/runtime不一致
- executor全体のネットワーク障害

これらはexecutor healthへ記録し、一定時間cooldownする。cooldown中は新規site claimを止め、すでにblocked化したsiteを増やさない。DNS、特定originの4xx/5xx、Blog binding不整合などsite固有障害だけproject側へ記録する。

### 4. 実記事1本の縦通しを先に完成させる

全サイト展開前に、1サイトで次を通す。

1. 対象記事を選択
2. 必要なsourceだけ収集
3. article draftを実ファイルへatomic save
4. 本文と原典を検証
5. site固有build / lint / link check
6. 失敗箇所だけ修正
7. artifact manifestを保存
8. Operationをcomplete
9. autoPublish許可時のみ既存Blog deliveryへ進む
10. receiptで公開と配信を確認

ここまで通る前に「自律記事生成完成」と記載しない。

## 品質ゲートの修正方針

現行 `evaluateAutonomyGate()` は次の機械的検査を持つ点は有効である。

- source IDがproject内に存在するか
- fact ledgerが存在するか
- future dateが混入していないか
- unresolved questionが残っていないか
- keyword target conflictがないか
- publication capacityを超えていないか

ただし、`evidence_score`、`commodity_risk`、6項目の `publication_gate` はagent提出値である。これを公開許可の決定要因に残す場合でも、少なくとも次を独立検証する。

- fact ledgerのclaimが本文に存在するか
- claimのsource locatorから根拠を再取得できるか
- 数値・固有名詞・比較表現が原典と一致するか
- 既存記事との重複率
- 読者の問いに本文が直接答えているか
- 捏造された体験・レビュー・測定がないか
- target siteのbuildが通るか

agent自己評価は補助情報に留め、独立検証器がfailedならhandoffを作らない。

## 中断と再開

再開情報として保存すべきもの:

- article/page ID
- completion step
- artifact path/hash
- source IDs
- validator result/hash
- blocker class
- next command
- remaining action/external/runtime budget
- executor cooldown until

保存しないもの:

- 私的な思考過程
- 会話全量
- 再生成可能な長いprompt

blockedを単一状態として扱わず、少なくとも以下を分ける。

- `quality_revision_required`
- `external_site_failure`
- `executor_unavailable`
- `human_decision_required`
- `explicitly_paused`
- `budget_exhausted`

自動resumeできる理由をallowlist化する。

## UIで残すもの

主画面は「記事」を中心にする。

表示するもの:

- 完成記事
- 制作中記事
- 最終進展時刻
- 本文 / diff / sources / checks
- executor全体の障害
- ユーザー判断が必要な例外

通常画面から外すもの:

- operation ID
- lease
- run全件
- keyword全件編集
- cluster手動操作
- work session手動操作
- policy内部状態
- handoffの生payload

これらは削除せず、詳細・保守画面、CLI、MCPへ残す。

## 受入条件

### Headless P0 acceptance

- UI/APIを起動せずworkerだけで1記事をローカル完成できる。
- APIを同時起動しても同projectのtickが二重実行されない。
- 外部agentが0終了してもartifactがなければOperationはcompleteにならない。
- executor利用上限が発生しても後続siteへblocked記録を連鎖させない。
- disabledな先頭候補、blocked/paused子sessionを飛ばして後続の実行可能候補をclaimできる。
- draft保存直後、validator途中、Blog receipt応答前で強制終了しても同一article IDから再開する。
- 同じhandoffを再送しても二重記事・二重公開を作らない。
- 本文版が変わっていない `revise` を無限再採点しない。

### CI

最低限次をruntime suiteへ追加する。

- `scripts/executor-selection-smoke.ts`
- scheduler single-owner / tick-lock smoke
- exit-0-without-artifact smoke
- executor cooldown smoke
- artifact-resume smoke
- revision-hash smoke
- Blog real-file fixture smoke

## 実装順

1. scheduler single owner + tick lock
2. executor health / common-failure cooldown
3. artifact manifest + completion guard
4. 実記事draftのatomic saveとresume
5. 本文独立validator + revision hash
6. Blog build / receiptまでの縦通し
7. CIへheadless acceptance追加
8. 記事中心UIへ縮小
9. 複数siteへ段階展開

## 成果指標

成果として数える:

- ローカル完成記事数
- 公開完了記事数
- 最初の本文までの時間
- ローカル完成までの時間・費用
- articleごとの修正回数
- 中断後の重複作業量
- 通常制作への人間介入回数
- 無進展retry回数

成果として数えない:

- tick数
- Operation数
- ON site数
- page plan数
- handoff作成数
- agent process終了数

## 現在の判定

**制御面: 部分完成 / 記事生成面: 未完成 / 公開自律性: 未完成**。

次のマイルストーンは、新しい機能を増やすことではなく、1記事について「worker claim → 本文ファイル → 独立検証 → artifact確認 → Operation complete」を確実に通し、途中強制終了から再開できる状態にすること。