# Keywords Automation App

React 管理 UI と Express API を 1 つの Node.js プロジェクトにまとめた構成です。Firestore をデータストアに、Gemini・Google Ads API・独自スケジューラでキーワードリサーチ?アウトライン生成?記事投稿までを自動化します。

## ディレクトリ構成

```
index.html          Vite エントリ
src/                React + Firebase 管理 UI
server/             Express API とスケジューラ、Gemini/Ads/Blogger 連携
  lib/core          共有ユーティリティ
  lib/gemini        Gemini クライアント
  lib/ads           キーワードアイデア取得クライアント
  lib/blogger       記事投稿ロジック
  lib/scheduler     Firestore と連携するパイプライン
api/[[...slug]].ts  Vercel 向けサーバレスエントリ (Express app をラップ)
vercel.json         Vite 出力先 (dist/client) を指定
```

## スクリプト

| コマンド | 説明 |
| --- | --- |
| `npm install` | 依存関係をインストール (標準設定) |
| `npm run dev` | Vite 開発サーバ (3000) と Express API (3001) を同時起動 |
| `npm run build` | サーバ (`dist/server`) とフロント (`dist/client`) をビルド |
| `npm run preview` | ビルド済みフロントをローカルで確認 |
| `npm run start` | ビルド済み Express API を起動 |

`scripts/test-google-ads.js` や `test.js` は `npm run build` 済みの成果物を優先し、ビルド前は `ts-node` を使って TypeScript ソースを読み込みます。

## 開発手順

1. `.env` に Firebase・Gemini・Firestore・Google Ads などのサーバ環境変数を設定します。
2. `src/lib/firebase.ts` で参照する Vite 用の値は `.env.local` などに `VITE_FIREBASE_*`、`VITE_API_BASE_URL` (任意、未設定なら `/api`) を記述します。
3. `npm run dev` を実行すると、Vite (http://localhost:3000) が `/api` を http://localhost:3001 へプロキシし、React UI から API を叩けます。

## デプロイ (Vercel)

1. `npm install` → `npm run build` がデフォルトで実行され、`dist/client` にフロント、`dist/server` に Express＋スケジューラが出力されます。
2. `vercel.json` の `outputDirectory` は `dist/client` に設定済みです。
3. `api/[[...slug]].ts` はビルド済みの `dist/server/app.js` を読み込み、Vercel 上の `/api/*` リクエストを Express に委譲します。ビルド前にデプロイすると 500 になるため、必ず `npm run build` を完了させてください。
4. Firebase・Gemini・Google Ads・Tavily などの環境変数を Vercel プロジェクトへ設定します。

## Firestore / 機能

- プロジェクト・テーマ・ノード・キーワード・クラスタ・リンク・ジョブといったドキュメント構成は従来のままです。
- React UI からの操作はすべて `/api/projects/...` 配下の Express ルートへ送信され、サーバ側で Firestore / Gemini / Ads / Blogger ロジックを実行します。
- スケジューラのパイプライン (アイデア取得→クラスタリング→スコアリング→アウトライン→内部リンク→ブログ投稿) も従来通り `server/lib/scheduler` にまとまっています。
