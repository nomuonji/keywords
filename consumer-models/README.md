# Consumer Models (市場調査の前提モデル)

市場調査を始めるときに「どのコンシューマーモデルを想定して観測するか」を固定するためのディレクトリ。

## 二層構造

| 層 | 場所 | 役割 |
| --- | --- | --- |
| 実行時の正本 | Firestore `consumerModels` / `consumerModelVersions`（keywords 所有） | ローカルMCPとリモートMCPの両方が読む |
| 移行seed | このディレクトリの `*.v1.json` | My Portal からの移行原文と、何を移して何を捨てたかの監査記録 |

seed は **v1.0 の移行時点で凍結**する。以後の定義変更は Firestore 側で revision を進める。
seed と Firestore の対応は `provenance.seedPath` と `provenance.seedSha256` で示す。

## なぜ Firestore か

リモート（Vercel）は serverless で SQLite を永続化できない。モデル定義をローカルSQLiteに置くと、
リモート復旧時に同じモデルが見えず「そのまま再開」が成立しない。Firestore は既存の
`keyword_treasury_save` / `seo_case_*` と同じ経路（`firestoreForTarget('keywords', ...)`）で
ローカル・リモート双方から到達できる。

## 移行方針

My Portal の正本カードには「そのとき考えた文脈」が全部入っている。市場調査の前提として
必要な部分だけを移し、My Portal 固有の管理機構は移さない。捨てた項目は
`provenance.droppedItems` に理由付きで残す。

## ファイル

- `daishu-consumer.v1.json` — 大衆消費者モデル v1.0（My Portal `xB6TLnSpY4copFYU7XaR` 由来）
  - sha256: `c95ce444d8b49e3691f591e03f5cc1db58ee4bc4341789b5aa15510620beef17`
  - 移行時点で凍結。以後の変更は Firestore 側で revision を進める。

## 移行したもの / しなかったもの（v1.0）

**移した**（市場調査の前提として必要）
- モデル定義（状況依存の作業モデル、属性で決めつけない）
- ターゲットの切り方（状況 × 商品 × 媒体）
- 行動メカニズムの変数10種と観測可能な問い
- Reach / Conversion の分離
- 証拠ラベル6種、requiredMetadata、独立性ルール、非証拠リスト
- 反証条件とアンチパターン
- 横断スキャンの調査手順（クラスター数・独立URL目安・収集件数目安・深掘り順序）
- モデル改訂ゲート

**移さなかった**（My Portal 固有、または調査の前提ではない）
- 個別カード種別7種 → keywords は discovery_candidates / sources / pages / decisions が担う
- 候補台帳 `OMHfc7pNvUTLwGoK9kC1` / カタログ `bjOWtn95gWAABcp0TIAO` のID参照 → フェーズ2
- 管理スキーマ追記・managementSchemaRevision → Firestore revision で代替
- 制作表現ルール（風刺・皮肉など） → 調査の前提ではない
- 日次ジョブの起動/claim/finish 手順 → operation / discovery_job が担う
- Space / idea 参照と 2026-10-29 の運用追記履歴

捨てた項目はすべて `provenance.droppedItems` に理由付きで記録してある。原文は My Portal 側に履歴として残す。
