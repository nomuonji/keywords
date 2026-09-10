# Blog連携の実装・運用手順

2026-09-08。連携コード実装済み。ライブのSEO成果・公開・全サイトの接続完了を意味しない。

2026-09-11追加: 回復計測・新規拡張の保留・サイト別runtime・計測専用workerの運用は[SEO回復を優先する自動運転](seo-recovery-operations.md)を参照。

## 実装した範囲

共有commandsを通じたサイト現状取込、既存pagesとの照合、追加価値brief、自律品質ゲート（手動モードでは企画承認）、版付きhandoff、Blogのenqueue/claim/stage連携、結果receipt、query×page計測、観測評価、Operatorへの次タスク、Web/MCP/CLI/APIを接続した。

探索は既存Ads/Web/GSCに加え、SERP providerのrelated searchesとPAAを外部語として保存・再展開する。検索回数は捏造せず、raw phrase/source/parent/depthを残す。一般の公開資料やレビューの語はobserveで記録できるが、検索需要とは別区分になる。Google autocomplete専用adapterは追加していない。

キーワード探索は二つのモードを持つ。通常のoperation経由の探索は`demand_policy=required`で、Google Ads Keyword Planner（または設定済みproxy）から月間検索数を取得できない場合は開始しない。プロバイダーには人が入力した種語と、その種語に明示的に含まれる代表トークンだけを送って関連候補を広げる。SERP related/PAAだけを使う場合は`demand_policy=surface_only`を明示した観測専用runとし、候補には`search_surface_observed`を保存する。検索ボリューム未取得の候補はshortlist・page planへ進めない。候補には種語からの`novelty_score`も保存し、種語そのものは探索成果として登録しない。

記事の本文作成・資料の内容判断はエージェントの作業で、本文を無制限に量産する関数はない。Autopilot有効時は追加価値briefと決定論的な自律品質ゲートを通して人を待たずに進み、Autopilot無効時だけ人の企画承認を要求する。Blogの編集レビュー・近似内容監査・既存build gateは別に通す。削除・URL移動・DNS・credential・policy有効化などの破壊的または権限変更を伴う操作は引き続き人の確認を要する。

新規記事の`blog_writeDraft`は、書き込み前にprimary keyword、月間検索数、競合、需要source、選定理由をDB上で確認する。検索面で見つけただけの語や未計測値は通過させない。推定月間流入はGSCクリック、または保存済みCTR×検索数がある場合だけ表示し、根拠がなければ未算出とする。既存artifactの改稿は初回ゲートを再利用する。

記事一覧の段階は別々に扱う。`local_file`はBlog作業フォルダにあるがKeywordsへ未登録の本文、`artifact`はKeywordsが登録・検証している本文、`verified`はartifactの品質検証が完了した状態、`published`は公開後の記録が保存された状態である。どの段階でも人が確認して削除でき、削除時はBlog作業フォルダの本文を物理削除し、記事一覧から非表示にする。ただし`runs`と`decisions`の監査記録は残り、公開中サイトの公開停止やURL削除は行わない。

## 起動環境

Node.js 22以上と、そのNodeに対応したbetter-sqlite3が必要。今回のPCでは標準nodeがv20、同梱node v24.19.0でSQLiteの動作を確認した。標準nodeでCLIが無言終了する場合はバージョンを揃える。

PowerShellで今回確認済みの実行例:

```powershell
$keywordsNode = 'C:/Users/youph/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $keywordsNode node_modules/tsx/dist/cli.mjs apps/cli/src/index.ts project list
```

初回のBlogテーブル追加前に、既存DBの隣へ `.pre-blog-<時刻>-<pid>.sqlite` を自動で整合バックアップする。DBファイルは機密情報を含む作業データなのでリポジトリに追加しない。今回の検証では一時DBを使い、利用中のDBへテスト企画を入れていない。

## 初回接続

1. Blogのexportを再実行して新しいsite contextを用意する。古いsnapshotは7日を超えると取り込めない。
2. Keywordsでサイトのhost・language・countryが一致するprojectを選ぶ。初回bindingはWebの「検索実績 → Blogとの連携」のファイル選択、または人のCLI操作で確認する。
3. 以降の同じbindingの更新はAgentでも可能。別サイトへの無言の付け替えはできない。

```powershell
& $keywordsNode node_modules/tsx/dist/cli.mjs apps/cli/src/index.ts blog importContext <projectId> --file <site-context.json>
& $keywordsNode node_modules/tsx/dist/cli.mjs apps/cli/src/index.ts blog context <projectId>
& $keywordsNode node_modules/tsx/dist/cli.mjs apps/cli/src/index.ts blog contract <projectId>
```

contractはsnapshot/brief/receiptの厳密なJSON schemaを返す。CLIでAgentとして操作する場合は `--actor agent --actor-id <executor> --session <sessionId>` を指定する。MCPはAgentとして実行し、人専用の初回binding/企画承認を代行できない。

## エージェントの作業順

1. `operator_context` / `work_context` / projectのpolicyを確認する。既存sessionやtaskを再利用する。
2. `blog_context`、必要なら`blog_contract`を読む。古いsite contextは更新する。
3. 既存discovery jobをclaim。通常runでは先に`discovery_ads_ideas`で月間検索数を取得し、必要なら`blog_expand`でrelated searches/PAAを追加の観測として保存する。返った観測IDをparentIdにして再展開できる。深さ2、job予算、lease、飽和停止を守る。
4. 手元のsourceに含まれる表現は`blog_observe`で原文通り保存。資料の言い換えを観測語にしない。`blog_observations`で系譜を読む。
5. 原典の実読と既存coverage照合から既存の`page_plan`を作る。既存URLが答えられるならexisting_page_improvementを選ぶ。
6. `blog_prepare`でbriefを付ける。材料・検索需要・SERP比較・主張と原典箇所・維持担当・実施したresearch skill・採点理由を含める。変更すると承認はproposedへ戻る。
7. Autopilot有効時は人を待たず、自律品質ゲートが根拠・重複・情報価値・本文品質を判定する。Autopilot無効時のみ、人がコンテンツ計画またはBlog連携画面で根拠を確認し、page reviewを行う。未解決質問や資料なしではどちらのモードでも進めない。
8. `blog_export`で確定版を取得。Blogでdry-run後に明示applyする。
9. Blogの既存執筆・fast check・stage・batch-verifyを行い、編集レビューと近似内容監査を添付する。
10. Blogからlocal_verifiedを返す。公開は別途許可された操作で行い、公開HTMLの一致を確認してpublishedを返す。
11. query×pageをcaptureしevaluate。結果はreceiptで記録する。小標本はinconclusiveで次回観測を設定する。

新規企画は限定解除サイトのみ。以前のhandoffが未完、結果が不十分・悪化、または改善の比較が再現していないと新規拡大を止める。Blog側の品質・indexゲートも別途必要で、Keywordsの承認は解除ではない。

## コマンドとHTTP対応

CLI: `blog <operation> <projectId> --file <arguments.json>`。get/export等の小さい入力は `--json '{"pageId":"..."}'` も使える。

| operation | 入力（projectId以外） | 意味 |
|---|---|---|
| contract / context | なし | 契約・共有状態 |
| importContext | snapshot（CLIは生snapshotファイルも可） | ローカル情報取込 |
| prepare | pageId, brief | 根拠と追加価値を企画へ固定 |
| export | pageId | 承認済みpackage |
| get | handoffId | payload・現在のvalidity・receipts |
| receipt | receipt（CLIは生receiptファイルも可） | 受領・検証・公開・結果 |
| capture | startDate,endDate,siteUrl,任意searchType | origin限定のquery×page履歴 |
| evaluate | handoffId,baselineId,followupId | 同条件・同日数の公開前後比較 |
| expand | jobId,seedまたはparentId,任意idempotencyKey | 外部語から再探索 |
| observe | jobId,sourceId,rawPhrase,任意parentId | 原文・証拠区分の記録 |
| observations | jobId | 観測一覧 |

HTTPは `GET /projects/:projectId/blog`、書き込み等は `POST /projects/:projectId/blog/<operation>`。探索は既存discovery-jobs配下の`expand`/`observe`/`observations`。すべて共有commandsを使用する。MCP名は`blog_`＋operation。

## 失敗・復帰

- source hashが変わった: 最新site contextで企画を再確認。ファイルを巻き戻して合わせない。
- 承認版が変わった: 旧packageを再利用しない。新briefを再承認する。
- enqueue成功後に通信が切れた: 同じpackageをreceive --applyで再送。handoff IDで同じitemを返す。
- stage/build失敗: 既存autopilot手順で修正。local_verifiedを先に送らない。
- state lock競合: 他の書き込み終了後に再試行。プロセス終了でOSロックが解放される。
- GSC失敗: 前回成功分を保持する。欠損は0や減少へ変換しない。
- 公開HTMLが一致しない: publishedにしない。配信差分・実際の公開を確認する。

## 検証

`scripts/blog-smoke.ts` は常に一時DBを作成し、承認・版・再送・query×page・探索・pauseを検証する。既存7系統smoke、型チェック、Web buildも通過確認済み。Blog側はexport 5件＋bridge/audit/lock 3件、うちbridgeは実際のKeywords CLIとautopilotを別プロセスで往復する。

```powershell
& $keywordsNode node_modules/tsx/dist/cli.mjs scripts/blog-smoke.ts
npm run build
```

ブラウザ検証は `scripts/blog-ui-smoke.py`。隔離したfixture DB、別API/Viteポートで実行する。2026-09-08にサイト取込、企画承認、handoffダウンロードまでのUI smokeを通過した。実SEO成果や外部API契約の有効性をfixtureテストで保証したとは扱わない。
