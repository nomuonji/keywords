# ChatGPT Sites 移行・MCP 接続ハンドオフ（2026-11-15）

## 目的と現在地

**依頼**: `nomuonji/keywords` の Web UI を ChatGPT Sites で公開し、同じキーワード正本を読む/更新する MCP を ChatGPT のプラグインで使えるようにする。旧 Vercel が動かない状況でも、複製 DB やモック画面で「復旧」を装わない。

**確認済み**:
- 正しい GitHub リポジトリ名は **`nomuonji/keywords`**（`nomuonji/keyword` は GitHub 404）。
- 現状は Node.js 22 npm workspaces。フロントは `apps/web` の React/Vite、公開 UI の API 起点は `apps/web/src/api.ts`。
- Vercel 用 `vercel.json` は `apps/web/dist` を配信、`/mcp` を `/api/mcp` に転送する。
- リモート MCP は `api/mcp.ts`（Hono + WebStandard Streamable HTTP MCP）。`api/mcp-contract.ts` がツール名の一覧。別の `/sites-mcp` は SEO Sites Operator で、**ChatGPT Sites 製品とは別物**。
- リモートの権限は `KEYWORDS_REMOTE_MCP_TOKEN` を用いた署名/OAuth PKCE または Bearer。Google Ads / SERP 等の外部情報、Firestore、環境秘密情報に依存。クライアントソースに秘密鍵を直接含めない。
- 本来の `packages/db` がローカル SQLite とリモート Firestore の二層を扱い、`packages/commands` が更新規則を所有する。Sites 移行を理由に Firestore の正本を新設・複製しない。

**このドキュメントの範囲**: Work モードでの Sites 作成、実行互換性の確認、公開、MCP プラグイン作成・接続を引き継ぐ。**このドキュメントを追加しただけでは Site は作成・公開されず、MCP プラグインも接続されない。**

## ChatGPT Work / @Sites に渡す実行指示

> GitHub `nomuonji/keywords` を読み込んで、ChatGPT Sites で使用できる **Keywords 管理 Web サイト**を作成し、MCP をサイトに追加してプラグイン化してください。まず AGENTS.md、README.md、apps/web/src/api.ts、api/mcp.ts、api/mcp-contract.ts、packages/db/src/firestore.ts、packages/commands 内の実際の実装を読み、サーバー/フレームワーク互換性・認証・データ接続可否を確認してください。旧Vercelを本番依存にせず、現在の既存 Firestore データと権限境界を再利用してください。構造変更を伴う場合は独立ブランチで修正し、検証後に ChatGPT Sites の非公開デプロイと本番のMCPプラグイン作成まで完了してください。対応外の Node / Firestore / ネットワーク機能がある場合は、動作しない機能を「対応済み」とせず、移植可能な部分と別途必要なバックエンドを明記してください。プラグインをインストールする必要があるときはユーザーにそのカードを表示してください。

## 移行の実装契約

1. **先に調べる**: Sites ランタイムに Node.js 22、`node:crypto`、Hono、Streamable HTTP MCP、Google/Firebase SDK、Web UI の静的アセット、永続ストレージがサポートされるかを実際のビルドと実行で確認する。互換性が不明なまま monorepo を丸ごと移し替えない。
2. **画面の機能確認**: `apps/web` の各ページが利用する `/api/*` のレスポンスを特定し、サイト側で正しく接続できるものに限って有効化する。リモートは読み取り専用 Firestore、ローカル専用の書き込みは明示的に分離されている。静的画面が描画されたことと、実データ操作が可能なことを混同しない。
3. **MCP の優先順位**: 同じ Firestore の実データを返す read-only ツール（例: status、treasury list/search、研究セッション list/get、サイト構成 list/get）を先に動かす。そのあと既存ルール・認可を通る保存系を追加する。既存のツール名・引数・結果形式は可能な限り `api/mcp-contract.ts` に合わせる。ツールを削る/名称変更する場合は差分を報告し、既存の Sites Operator を名前が似ているだけで統合しない。
4. **権限と機密性**: サイトの訪問者に Firestore/Google Ads の秘密鍵や `KEYWORDS_REMOTE_MCP_TOKEN` を配布しない。MCPの各呼び出しが認証済みのアカウント権限を使うことを確かめる。書き込み/削除系ツールは無認証で公開しない。サイトを一般公開するかどうかは、**個人の運用データを非公開にしたまま実現できること**を検証してから決める。
5. **旧デプロイは保全**: Vercel の URL、`/sites-mcp`、DNS、既存 OAuth の redirect URI を未検証のまま変更しない。Sites 側の新しいホスト名でOAuth metadata / token / callback / resource URLを検証する。旧本番へ自動切替するのは避ける。
6. **外部サービスの制限**: Sites が既存 Firestore の安全な直接接続をサポートしないなら、Google Drive等への勝手なデータ移動やクライアント秘密鍵埋め込みは禁止。どの機能に専用バックエンドが必要か切り分け、その時点の制約と選択肢を報告する。旧Vercelが停止していることを前提に、Vercel経由だけの画面は完成扱いにしない。
7. **動作確認**: 本番URLでUIロード（ネットワークエラーなし）、権限なしでのMCP呼出し拒否、認可後のMCP `initialize`/`tools/list`、少なくとも1件のFirestore読み取りと、明示的な試験データでの認可済み書き込み、再読み込み後の永続化を確認する。既存に関連した `npm run test:remote-keyword` と必要に応じ `npm run test:mcp` は既存実装を変更する場合に実行する。
8. **完成条件**: ChatGPT Sites の公開URL、Site本体の表示証跡、プラグインカード/接続結果、実MCPの少なくとも1ツールの正常実行、必要な環境設定・既存ツールとの差分を残す。これが揃うまでは「サイト公開」「MCP復旧」と報告しない。

## ChatGPT Sites の公式資料

- [ChatGPT Sites の作成と利用](https://help.openai.com/ja-jp/articles/20001339-creating-and-using-chatgpt-sites)
- [ChatGPT Sites でのプラグインのホスティング](https://help.openai.com/ja-jp/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

Sites は ChatGPT の Work モードで作成・公開する。MCPツールを Site に追加して所有者が公開すると、プラグインカードからインストールと接続ができる。サイトを公開するだけではプラグインの認証/インストールは完了しない。
