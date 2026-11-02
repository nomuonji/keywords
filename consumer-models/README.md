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
- `gomi-consumer.v1.json` — ゴミ人間モデル v0.12（移行ではなく、keywords 側で作成）
  - Firestore 側はこの seed より先に進んでいる（2026-11-02 時点で v0.15）。再 import すると新しい revision を上書きするので、変更は Firestore の現行版に対して行う
  - `provenance.source: "authored"`。droppedItems に改訂の経緯（不倫→罪悪感→摩擦→外注）を残す。

## 買い手と検索語（v0.9 追加）

コンシューマーモデルは「このペルソナがどう買うか」の前提であり、**買い手はペルソナ自身**。
ペルソナにコストを負わされた側（企業・配偶者・従業員）は別モデルで扱う。この取り違えが
実際に起きたため、定義と検査に次の2つを足した。

- `buyer.pays` / `buyer.doesNotPay` — 誰が払い、誰を買い手にしてはいけないか
- `searchEvidence[]` — 実測した検索語。`side` で出自を分ける
  - `self` … ペルソナ本人の検索欄
  - `surrounding` … コストを負わされた周囲の人の検索欄（混ぜると被害者のモデルになる）
  - `unknown` … 性癖・一般層など、どちらでもないもの

`consumer_model_save` は `searchEvidence` に `self` が1件も無い場合、または `buyer` 未設定の場合に
`warnings` を返す（保存は止めない）。`scripts/consumer-model-seed-smoke.ts` は seed 側で同じ条件を検査する。

`consumer_model_list` は `keywordCount` / `selfKeywordCount` を返すので、どのモデルが実測を持っているかが一覧で分かる。

## 本人の声と、両方の側が打つ語（v0.12 追加）

persona は作文なので、放っておくと周囲の人の愚痴から書かれた人物像になる。実際にそうなっていたため、次を足した。

- `voices[]` — 本人側の一人称の投稿。`url` と原文の `quote`（125字以内）、`fit`（`fits` / `partial` / `contradicts`）、何が読み取れるかの `reading` を持つ。モデルに反する投稿も `contradicts` として残す
- `searchEvidence[].bidLowYen` / `bidHighYen` — 上位表示の入札レンジ。historical metrics は averageCpc をほぼ返さないので、金が動くかはこちらで見る
- `searchEvidence[].sideCertainty: "mixed"` — 両方の側が打つ語（例: 退職代行は劣悪な職場から逃げる側も打つ）。`note` に誰が打つかを書き、その volume をこのモデルの需要に数えない
- `personas[].selfImage` / `whyTolerated` / `triggers[]` — 本人の自己像、周りが離れない理由、きっかけ→検索語→支払いの流れ

## 定番のイメージから離れる（observedShift）

定番の入口（不倫・上司／ランキング1位／正しさ／家族バレ）で検索語を選ぶと、モデルはイメージをなぞるだけになる。
行動の語（バレた・言えない・返さない／安い理由・買ってよかった／グッズ・同人／決済）を Google サジェストで あ〜ん 総当たりし、
イメージに無い枝を Ads で量と入札を測り、知恵袋で本人の投稿を当てる。

### 生活の語を掘る道具

モデルの外側の話題（その層をネタにした語）ではなく、モデルの人が生活の中で打つ語を掘るときは、次の順で使う。

1. `scripts/comment-corpus.ts` — Yahoo!ニュースのコメントランキング上位の記事から、コメント本文と共感・なるほど・うーん数を集める（ユーザー名・ID は保存しない。個人の履歴は追わない）
2. `scripts/comment-self-lines.ts` — 体験の語り（私も・夫が・〜年前に・入院した 等）だけを共感順に抜く。ここで生活の具体物と出来事を読む
3. `scripts/suggest-soup.ts` — 2で読んだ生活の断片を、本人の言葉のまま種にしてサジェストを あ〜ん 総当たりする。サジェストに出る語は実際に打たれている
4. `scripts/kw-volumes.ts` — 枝の量と入札レンジを測る。長い語は Ads が値を返さないことが多いが、3に出ていれば存在の証拠として残す
5. 見つけた語を `seed-pools/` に OBSERVED（出典の記事ID付き）で入れ、`consumer_model_seeds` の材料にする

コメントは記事の題材に引かれた経験者が書くので、生活の固まりは集めた記事の題材に偏る。比率を読むときは題材を増やしてから読む。
単一の題材より、同じ人の中で生活の固まりが交わる点（例: 病気の後 × 住宅ローン借り換え → ワイド団信）に入札の付く語がある。

ずれは `definition.observedShift[]` に `{ from, to, evidence[] }` で残す。`from` が一般的なイメージ、`to` が実測で分かったこと。
反証された旧仮説は消さず、`thinking` に `COUNTEREVIDENCE` として残す。

seed smoke は、persona の `searchWords` が searchEvidence に無い（未計測）か `surrounding` 側の語である場合に失敗する。`consumer_model_save` は同じ条件と、persona があるのに voices が無い場合に `warnings` を返す。


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
