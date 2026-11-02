# マーケ術ライブラリ

観測した「売れ方の型」を、効く理由・実例・出典・使ってはいけない条件ごと保存し、記事タイトル・サムネ・商品名・CTA・SNSを考える前に引き出すための台帳。

- 画面: Keywords Web の「マーケ術」タブ
- 保存先: Firestore `marketingTechniques`（Keywordsプロジェクト）
- コマンド: `packages/commands/src/marketing-techniques.ts`
- MCP: `technique_list` / `technique_get` / `technique_save` / `technique_use` / `technique_archive`

## なぜ台帳にするか

スクリーンショットやXの投稿で見つけた手法は、その場では理解できても、記事を書くときに思い出せない。思い出すためのメモではなく、**同じ判断を再現するための記録**として残す。

そのため1件ごとに次を必須にしている。

| フィールド | 意味 |
| --- | --- |
| `name` | 手法の呼び名（例: 振るモデルチェンジ） |
| `lever` | 効いている心理レバー（意外性 / 希少性 / 性的訴求 など） |
| `summary` | 一言でなにをするか |
| `mechanism` | なぜ効くと考えられるか |
| `example` | 観測した具体例。数字は出典の主張として書く |
| `evidenceLevel` | observed / reported / literature / hypothesis |
| `sourceUrl` / `sourceLabel` / `observedAt` | 出典。URLが無い場合は「未記録」と明示する |
| `surfaces` | どの面で使えるか（記事タイトル / サムネ / 商品名 / CTA / パッケージ など） |
| `fitWhen` | 効く条件 |
| `avoidWhen` | 使ってはいけない条件・法規制・炎上リスク |
| `usages` | 実際に使った記録（面・対象・結果メモ） |

`avoidWhen` が空の手法は登録しない。使ってよい条件だけを覚えると、規制の強い商材やブランド毀損の場面でそのまま事故になる。

## 証拠レベルの使い分け

- `observed` — 自分で見て確認した。効果数値まで確認できた場合だけ、その数値を書く。
- `reported` — 他者の投稿・記事がそう主張している。**効果は未検証**として扱う。
- `literature` — 書籍・論文・公的資料。主張の出典を `sourceLabel` に書く。
- `hypothesis` — 出典のない推測。事実として引用しない。

「売上が100億円」のような数字は、確認できていなければ `example` に「〜と投稿で語られている」と帰属を付けて書く。

## エージェントの使い方

1. タイトル・サムネ・商品名・CTA・SNSの企画を始める前に `technique_list` を読む（`query` で対象商材、`lever` で狙う心理を絞る）。
2. 使う候補が決まったら `technique_get` で `avoidWhen` を確認する。使わない条件に触れるなら採用しない。
3. 実際に使ったら `technique_use` で面・対象・結果メモを追記する。使った回数と結果が溜まると、効く・効かないの判断材料になる。
4. 新しい手法を見つけたら `technique_save`。効果を観測していないなら `evidenceLevel: reported` か `hypothesis`。

`technique_list` は仮説の一覧であって、成果の保証ではない。検索順位やCVRの改善判断は、実際の計測（GSC / GA4 / 実験）で行う。

## 初期シード

コードに2件のシードを持つ（`BUILTIN_TECHNIQUES`）。Firestoreに同じIDで保存すると上書きされ、`origin` が `firestore` になる。

- `tech-subliminal-sexual-cue` — サブリミナル的・性的訴求
- `tech-shake-model-change` — 振るモデルチェンジ（ドリトッチ）

シードは出典と `avoidWhen` を伴う観測メモとして扱い、無条件に推奨するものではない。
