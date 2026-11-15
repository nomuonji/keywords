# Vercel + ChatGPT Sites 併用・同一MCP/データ接続（2026-11-15）

## 目的と現在地

**確定した依頼（ユーザー訂正）**: **移植・置換ではない**。`nomuonji/keywords` を **既存のVercel版と新しいChatGPT Sites版の両方から使えるようにする**。同じキーワードデータ、MCPツール契約、認可ルールを利用し、片方の変更がもう片方に反映される併用構成をつくる。Vercel側のデプロイ・URL・MCP設定は撤去/無効化/転送しない。現時点でVercelが障害中でも、新しいSites側はVercelを中継せずに独立して動作できる必要がある。

**確認済み**:
- 正しい GitHub リポジトリ名は **`nomuonji/keywords`**（`nomuonji/keyword` は GitHub 404）。
- 現状は Node.js 22 npm workspaces。フロントは `apps/web` の React/Vite、公開 UI の API 起点は `apps/web/src/api.ts`。
- Vercel 用 `vercel.json` は `apps/web/dist` を配信、`/mcp` を `/api/mcp` に転送する。
- リモート MCP は `api/mcp.ts`（Hono + WebStandard Streamable HTTP MCP）。`api/mcp-contract.ts` がツール名の一覧。別の `/sites-mcp` は SEO Sites Operator で、**ChatGPT Sites 製品とは別物**。
- リモートの権限は `KEYWORDS_REMOTE_MCP_TOKEN` を用いた署名/OAuth PKCE または Bearer。Google Ads / SERP 等の外部情報、Firestore、環境秘密情報に依存。クライアントソースに秘密鍵を直接含めない。
- 本来の `packages/db` がローカル SQLite とリモート Firestore の二層を扱い、`packages/commands` が更新規則を所有する。Sites を追加するために Firestore の正本を新設・複製しない。

**このドキュメントの範囲**: Work モードでの **2拠点併用**の構成・Sites追加・互換性確認・公開・MCPプラグイン作成・接続を引き継ぐ。**このドキュメントを追加しただけでは Site は作成・公開されず、MCP プラグインも接続されない。**

## 必須構成（並行運用、置換禁止）

```text
     既存のVercelホスト                 新規ChatGPT Sitesホスト
  Web UI + 既存API/MCP                Web UI + Sites MCP
             |                                 |
             |  同じcommands契約/認可           |  同じcommands契約/認可
             +--------------+------------------+
                            |
                既存Firestore（唯一の正本）
                   + 外部調査ソース/API
```

- **Vercelはそのまま**: 既存の GitHub連携/CI、`vercel.json`、プロダクションURL、`/mcp`、`/sites-mcp`、OAuthクライアント/設定を保持。Sites側を作ってもVercelの設定を削除・書換・ドメイン切替しない。既存Vercelの障害は別途扱う。
- **Sitesは追加の入口**: ChatGPT Sitesで新たに Web UI とMCPを公開するが、独立したキーワードDBや独自の架空APIは作らない。ホストが異なっても同じ既存Firestoreのコレクション、文書ID、書き込み条件、監査を使う。可能なら共有`packages/commands`ロジックを再利用。公開できないサーバー機能は分けて報告する。
- **経路独立**: Vercel停止中もSitesからFirestoreへの認証済み接続・MCPツールが動く。SitesでVercelの`/api/*`や`/mcp`を単にプロキシする実装では達成とみなさない。
- **同一MCP契約**: `api/mcp-contract.ts`を互換性の正本として、Sites側MCPで可能なツールの**名前/引数/結果/認証**を一致させる。差分があれば表にして明示する。既存の`/sites-mcp`（SEO Sites Operator）は別機能であり、ChatGPT Sitesという製品とは混同しない。
- **安全性**: Sites/Vercelそれぞれのサーバー側でFirebase資格情報とOAuth秘密情報を管理し、ブラウザへ配布しない。MCPは各ホストが独立した認可・PKCEトークン発行/検証を持ち、callbackとresource URLをホストごとに正しく登録する。署名用の秘密値やクライアント設定を暗黙に共有しない。公開UIから管理情報を匿名閲覧できないようにする。
- **データ一貫性**: 二重書き込み/定期コピー/Firestoreの別プロジェクト化は禁止。二つの画面からの同時編集は既存のrevision/競合検出を尊重し、必要なら共有コマンド層に統一する。認証済みでAから変更→Bに反映、Bから変更→Aに反映されることを実データで確認する。
- **現状のUIの制約**: `apps/web/src/api.ts` は本番の遠隔APIを読み取り中心に扱う構造。画面に書き込み操作が無いものを、追加ホストでも勝手に「書き込み可」と説明しない。書き込みは既存の権限付きMCP/commandsで検証し、UI拡張をするなら両方のホストに同じ実装を配布する。

## ChatGPT Work / @Sites への実行指示（この部分を渡す）

> GitHub `nomuonji/keywords` とこのファイルを読んで、**既存のVercel版を残したまま** ChatGPT Sites版を**追加**してください。これは移行・置き換えではありません。VercelとSitesのUI/MCP双方が既存の同じFirestoreデータと共有コマンドを使い、両方から読み書きできるようにします。Vercelが現在停止中でもSitesは依存せず動く構成にしてください。AGENTS.md、README.md、apps/web/src/api.ts、api/mcp.ts、api/mcp-contract.ts、packages/db/src/firestore.ts、packages/commands内の実装を読み、Sitesで使えるNode/SDK/永続化/MCP互換性をまず実際に検査してください。両ホストにある認証・OAuth・データ更新ルールを保ち、認証なし公開は避けてください。Vercel/旧MCP/DNS/既存DBを無断変更せず、Sites公開・プラグイン作成・実MCP接続と**双方向の同一データ反映**を検証してください。ChatGPT Sitesに未対応の機能があれば具体的な技術的制約を報告し、完成と偽らないでください。ユーザーが必要なプラグインインストールやOAuth認可は画面で依頼してください。

## 並行運用の実装・受け入れ条件

1. **2ホストの状態把握**: 既存VercelのUI/REST/MCPのURLと現在のエラー、既存Firestoreプロジェクト・コレクション・認可設定を秘密情報を漏らさず確認。新しいChatGPT SitesランタイムがNode.js 22、`node:crypto`、Hono、Streamable HTTP MCP、Firebase SDKをサポートするか実測する。互換性が不明なままmonorepo全体を移行しない。
2. **Sitesを追加**: GitHubの既存`apps/web`の画面仕様を参照し、Sitesに独立して動く2つ目のUI/サーバー接続を追加。共有ソース維持が可能なら同一GitHub commitからVercelとSitesにそれぞれデプロイ。現行Vercelのソースの強制変更はしない。SitesはVercelをバックエンドとして呼ぶだけの構成にしない。
3. **同じ正本を使う**: Sitesの権限付きサーバー処理が既存Firestoreへ直結するか、既存の安全な独立バックエンドを利用する。別DB、ローカル専用SQLデータ、ローカルストレージ、モックは「本番の同期データ」と扱わない。既存`packages/commands`の更新・監査ルールを尊重する。
4. **MCP契約互換性**: 両ホストで`initialize`, `tools/list`と少なくとも有用なread/writeツールを比較し、同じデータを返すことを確認。差異がある場合は表を残す。元の`/mcp`や`/sites-mcp`は残す。プラグインがSitesに追加されても既存MCP接続を切らない。
5. **ホストごとのOAuth**: URI、resource metadata、authorization/token/redirectの呼出し先を各ホストに合わせる。CORSだけで認証を代用しない。匿名`tools/call`を禁止し、個人データやキーを公開しない。新しいプラグインカードから認証成功を確認。
6. **双方向確認**: （A）Vercelで認証済み作成/変更した一時検証レコードをSitesで読む。（B）Sitesで認証済み作成/変更した別の検証レコードをVercelで読む。（C）別ブラウザ/セッションで一覧を再読込し、同じ文書ID・値を確認。（D）試験レコードは既存の削除ルールで片付ける。Vercel停止中は（A）（B）を未検証と明記し、「両方稼働」とは報告しない。
7. **既存状態の保持**: 旧OAuth接続、GitHub Actions、Vercel環境変数、DNS、Firestoreデータを破壊せず、Sites側追加だけを行う。内部データの一般公開は禁止。依存する既存の外部Google Ads/SERP計測が止まっていればその機能だけ未対応とし、他のMCP読み書き機能の独立稼働を優先。
8. **必要十分な検査**: サーバー実装が変わる場合に限り、関連した`npm run test:remote-keyword`、`npm run test:mcp`などを選択して実行。Sites側のUI表示・同一正本読み書き・匿名拒否・認証成功・両ホストからの同期・既存機能の非回帰を確認する。
9. **完成条件**: VercelのURLは従来どおり（復旧状態なら実際にアクセス可）、Sitesの公開URL、どちらからも既存Firestoreへアクセスできる実例、Sitesプラグインの接続、Vercel側MCP非破壊、機能差分/残る障害をまとめる。**この引き継ぎ文書を更新しただけではサイト公開やプラグイン接続は済まない。**

## ChatGPT Sites の公式資料

- [ChatGPT Sites の作成と利用](https://help.openai.com/ja-jp/articles/20001339-creating-and-using-chatgpt-sites)
- [ChatGPT Sites でのプラグインのホスティング](https://help.openai.com/ja-jp/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

Sites は ChatGPT の Work モードで作成・公開する。MCPツールを Site に追加して所有者が公開すると、プラグインカードからインストールと接続ができる。サイトを公開するだけではプラグインの認証/インストールは完了しない。
