# SEO回復を優先する自動運転

> 2026-10-08: 現行の全ポートフォリオ統御は Sites Operator の `seo_recovery_status / seo_recovery_portfolio_update / seo_recovery_site_update` が正本。以下のSQLiteベース `recovery.capture` は観測・解除判定の補助ロジックとして残す。回復モード中のgrowth task create/claimはFirestore control plane側でhard gateされる。

## 現行Site Operator回復モード

このモードはSEO運用の緩やかな異常時制御であり、緊急停止システムではない。今回のindexation/visibility異常以外にも、content_quality、technical_integrity、measurement_integrity、otherのカテゴリを記録できる。現行の自動検知器が自動発火できるのは検索可視性／indexation系の異常のみ。

- **新規取得のみ制限**: recovery中、未clearedサイトのgrowth Taskの新規作成と新規claimを停止する。
- **既存タスクは継続**: すでにclaim済みの実装、push_pending、branch_ready、pr_open、CI、main mergeは現行の検証・配送経路のまま流す。自動キャンセル・自動PRクローズ・自動マージ停止を行わない。
- **平時への復帰**: portfolio更新時に新しい`resolutionEvidence`を明示してmode=normalへ戻す。新規取得の制限は解除されるが、既存タスクを一斉に生成・復帰させる処理はない。次のPlanner runで現状を再評価する。
- **伝達経路**: `seo_agent_context.recovery`が現在のmode、category、site state、effective gateを含む。サイト別確認や変更には`seo_recovery_status`等を使う。
- **カテゴリと対応の分離**: 異常を分類して記録する処理と、growthの新規取得を停止する対応は分離した概念であり、今後異なる対策を実装するときも一律の非常停止を前提にしない。

- Firestore `seoRecoveryControls/organic-search` がportfolio modeの正本。
- `seoRecoverySites/{siteId}` がincident単位のsite stateと暫定strategy、release criteriaを保持する。
- portfolioが`recovery`なら、未clearサイトでは `new_article / site_expansion / data_expansion / schema_expansion` を新規作成できず、既存ready taskもclaimできない。
- 許可されるのは原則 `revise / merge / delete / internal_links / technical` の回復作業。ただし broad delete/noindex/positioning変更等は従来どおりSite Directionのhuman gateが必要。
- 通常時のready 8件、3–5件/run、discovery必須はrecovery mode中は停止する。task数・公開速度は回復KPIにしない。
- 原因は断定しない。直接のURL Inspection/GSC観測とGoogleの公開policyを制御根拠にし、特定spam updateや非公開検出器を原因と決めつけない。
- 解除はincident-specific。別incidentのclearanceは再利用しない。

2026-09-11更新。Keywordsの共有SQL・commands・work sessionを使う。別のエージェント用進捗ファイルは作らない。

## 判断の順序

既存の停止・レビュー・進行中作業を確認する。新しい回復サンプルを選ぶ前に、必要なら公開sitemapのURL一覧を同期する。BlogのローカルsnapshotだけにあるURLはサンプルに使わない。

`recovery_capture`は公開sitemapまたはSearch Consoleに観測履歴があるURLから、経路の偏りを抑えた最大20 URLを選ぶ。同じコホートを次回も使う。404ページ、タグ・著者一覧などは除く。URL Inspection APIの保存済みインデックス状態と、対象originだけに絞った21日間のSearch Consoleデータをsourceに保存する。Googleの日付に合わせAmerica/Los_Angeles・3日前までの確定期間を使う。

新規拡張には次の全条件が必要。

- 20 URLの検査が成功し、70%以上が登録済み。
- 検査結果にcanonical・取得・robotsの問題がない。
- 連続する2回の週比較で表示回数が増加。
- Blog側の限定解除とサイト品質のhealthy判定があり、snapshotも新しい。
- 計測から7日以内である。

この閾値は運用上の解除条件であり、Googleの品質判定を再現するスコアではない。API失敗・権限不足・部分取得は、未登録や流入ゼロに置き換えない。正常な観測は7日後、部分取得は6時間後に再観測できる。同日の重複実行は同じoperationに戻り、成功済みの個別検査は24時間再利用する。

回復待ちでは新規ページの代わりに、観測sourceと既存URLを指定した改善operationを作る。実際のページ・重複・資料を読んでから改稿する。変更が必要ない場合は、観測sourceを参照するinsightを保存する。計画だけ・外部プロセスの正常終了だけでは記事や計測の完了にしない。登録率や表示回数の改善は、別の次回観測で判断する。

## 実行

Windowsでは次で計測専用workerを非表示で起動する。同じworkerが動いていれば二重起動しない。Node.js 22以上が必要。

```powershell
./scripts/start-maintenance.ps1
```

計測専用workerは、AutopilotがONでBlogと接続済みのprojectについて、sitemap同期・検索実績・回復観測を共有commandsで実行する。外部LLMやサブエージェントを起動しない。既存記事の判断・改稿はこのCodexタスク自身が行う。PC再起動後などworkerが消えている場合も同じ起動コマンドを使う。

1サイトで1回だけ動かす場合:

```powershell
$env:KEYWORDS_AGENT_ID = 'codex-maintenance'
npm run autopilot -- --maintenance-only --once --project <projectId>
```

常駐workerが実行中なら、同じexecutor IDのワンショットを同時起動しない。状態はWebのサイト一覧、`recovery context <projectId>`、`operation context --project <projectId>`で確認する。stdout/stderrは`data/maintenance-logs/`に残る。

`KEYWORDS_BLOG_WORKSPACE_ROOT`は`.seo-autopilot/sites.json`と`integration/sites/*.json`を持つBlogルートを指す。記事の保存先・URLテンプレート・build commandは接続先サイトの設定から取得する。グローバルな別サイトのルートに代替保存しない。既存ページのsource mappingが不明、またはsnapshot以後にファイルが変化していたら書き込みを止める。

## 停止・中断

旧workerの「External agent process exited with code 1.」だけを理由に止まった計測operationは、計測に外部エージェントが不要になったため再開できる。DNS・sitemapの実障害、人のレビュー、明示pause、予算超過はこの復旧対象に含めない。再開は同じoperation/sessionを使い、runsとcheckpointへ記録する。

実行時間の予算はキュー待ち時間を含まない。leaseが切れた場合は期限までの実働時間を保存し、次のclaimへ引き継ぐ。読取だけのcontext取得はaction budgetを消費しない。work completionには開始時からの差分を残す。古いsessionに開始時の個数が保存されていない場合は、差分を捏造せずnullとする。

## 動作確認済みの実測

資格Wikiの2026-09-11取得では20 URL中2 URLが登録済み。2026-08-18〜09-07の週別表示回数は112、2、0。source IDは`7d3334a1-d3cf-4e72-8fad-100a92e16cb7`。同じURLの末尾スラッシュ違いを含むcanonicalの食い違いも検出し、状態は`technical_repair`となった。保存済み検査のcanonical差が現在の公開HTMLでも残っているかは、改稿前に別途確認する。

これは流入回復の成果報告ではなく、改善対象を決める基準点である。本文の独自性や読者への価値は、自己申告の採点だけで証明しない。公開・インデックス復帰・検索流入増加は、それぞれ実際のreceiptと観測で確かめる。
