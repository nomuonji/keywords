# コンシューマーモデルを使った市場分析（ターゲットと視点の設定）

コンシューマーモデルは、市場分析の前提です。ただし、モデルの一般的なイメージ（「この層ならこう検索するはず」）から検索語を決めると、分析はイメージをなぞるだけになります。この文書は、モデルを使った分析を毎回同じ型で始め、同じ形で終えるための手順を定めます。

分析は次の3つを宣言してから始めます。

1. **ターゲット**：どのモデルの、どの persona（または segment）を、どちら側（`self`／`surrounding`）から見るか
2. **視点**：下の6つのうちどれで見るか
3. **問い**：この分析で決めたいこと（例：「最初に作るページを1つ決める」）。問いが無いと、集める作業に止めどころがありません

宣言は `consumer_model_frame` で行います。読み取り専用で、新しい保存先は作りません。結果は既存の保存先に書き戻します。

## 1. ターゲット

| 項目 | 決め方 |
| --- | --- |
| `modelId` | 別名でもよい（`kusorip` など） |
| `personaKey` / `segment` | どちらも無いと、モデル全体が対象になり、集める種がイメージに戻りやすい（警告が出る） |
| `side` | 既定は `self`（本人＝買い手）。`surrounding` は、周りの人や被害を受ける側から見る場合。その結論は、このモデルの販売計画（Conversion）にしてはいけない（警告が出る） |

買い手は、モデルの `buyer.pays` に書かれた人だけです。周りの人や被害を受ける側を買い手にしません。

## 2. 視点

視点は固定の6つです。どれも、その層の一般的なイメージでは予測できなかった発見を、実際に生んだものです。自由記述の「切り口」にすると、イメージに戻ります。

| 視点 | 答える問い | 集め方 | 止めどころ |
| --- | --- | --- | --- |
| `self_search` 本人の検索欄 | 本人が自分で打つ語と、イメージに無い枝 | 行動の語・事後形の語をサジェストで あ〜ん 総当たりする。題材の名詞から始めない | side の比率と、お金の動く枝が変わらなくなったら |
| `life_corpus` 生活の語 | 生活の中で打つ具体的な語 | コメント欄 → 経験談の抽出 → 本人の言葉のままサジェストの種にする | 記事の題材を変えても、新しい生活の固まりが出なくなったら |
| `money_moment` お金が動く局面 | どの出来事の直後にお金を出すか | persona の `triggers` を起点に、事後形（ばれた・された・届いた・退院後）を掘る | 各きっかけについて、入札の有無が確定したら |
| `intersection` 交点 | 同じ人の中で、2つの生活の固まりが交わる点 | 片方の語のサジェストに、もう片方の条件（健康状態・年齢・家族）が出るかを見る | 主要な組み合わせを一巡したら |
| `observed_output` 実物の観察 | 実際に何を書き・買い・選んでいるか | 書き込む場の型と反応の数を、分母つきで記録する。本人の投稿を `voices` に入れる | 題材を2つ以上変えても、型の順位が変わらなくなったら |
| `surrounding_mirror` 周囲の目 | 周りが付ける呼び名と、本人の行動とのずれ | 周りの人の検索語 | 呼び名が一通り出たら（結果は `observedShift.from` の根拠にだけ使う） |

## 3. 枠（`consumer_model_frame` が返すもの）

- `target`：解決済みの persona（自己像を含む）、side、buyer
- `viewpoint`：集め方・測り方・止めどころ・よくある失敗
- `baseline`：モデルがすでに持っているもの
  - `personaRows`：その persona の検索語
  - `countableRows` / `countableVolume`：数えてよい行（`sideCertainty: mixed` を除く）
  - `mixedRowsNotCounted`：脇に置く行（モデル外の人も打つ語）
  - `moneyRows`：入札が付く行
  - `voices`：本人の投稿（URL・引用・当てはまり具合のみ）
  - `observedShift`：これまでの「イメージ → 実測」の記録
- `startingPoints`：出発点。計測済み・記録済みのものだけで、イメージは入らない
  - `triggers`：persona のきっかけ
  - `measuredSelfWords`：計測済みの本人側の語
  - `lifeClusters`：ローカルのみ。モデルに紐づく OBSERVED／REPORTED のシードプールを、カテゴリごとにまとめたもの
  - `phrases`：persona の口癖
- `gaps.untestedVariables`：ローカルのみ。まだ観測の無い変数
- `deliverables`：結果の形と、書き戻し先
- `warnings`：ターゲットが未指定、side が `surrounding`、観測が0件、交点用のプールが無い、など

リモート（サーバーレス）には SQLite が無いので、`lifeClusters` と `gaps` は返りません。

## 4. 集めて、測る

道具（`consumer-models/README.md` にも記載）：

- `scripts/suggest-soup.ts`：サジェストの総当たり。ここに出る語は、実際に打たれている（存在の証拠）
- `scripts/kw-volumes.ts`：量と入札レンジ。長い語は Ads が値を返さないことが多い。null でもサジェストに出ていれば残す
- `scripts/comment-corpus.ts` → `scripts/comment-self-lines.ts`：生活の語のコーパスと、経験談の抽出。ユーザー名・ID は保存しない。個人の履歴は追わない
- `scripts/serp-score.ts`：検索結果の弱さ
- 知恵袋：本人の一人称の投稿（125字以内の引用、URL付き）

## 5. 結果の形

結果は、1件ごとに次の形で書きます。単一の総合スコアにはしません。

```
{ from（イメージ）, to（観測）, evidence[], target, viewpoint,
  money（入札・払う人）, falsifier（何が出たら覆るか）, fatalFlaws[] }
```

## 6. 書き戻し先

| 結果 | 書き戻し先 |
| --- | --- |
| イメージ → 実測 | `consumer_model_save`：`definition.observedShift` |
| 計測した語 | `consumer_model_save`：`searchEvidence`（side・sideCertainty・入札） |
| 本人の投稿 | `consumer_model_save`：`voices`（反する投稿も `contradicts` で残す） |
| 変数ごとの観測 | `consumer_model_observe`（label・分母・限界、`runRef` にこの分析の operation／session） |
| 生活の語 | `consumer_seed_pool_import`（OBSERVED、出典付き、`modelId` 付き） |
| キーワード候補 | `operation_discovery_start({ consumerModelIds: [modelId] })` |

発見をモデルの定義（`definition`）に書くだけで、変数ごとの観測（`consumer_model_observe`）に残さないと、`gaps.untestedVariables` が埋まりません。2026-11-02 のヤフコメ・クソリプモデルは、まさにこの状態でした（観測0件）。

## 例

```
consumer_model_frame({
  modelId: 'kusorip', personaKey: 'commentary-elder', viewpoint: 'intersection',
  question: '解説型の書き手に向けて、お金の動く生活の交点を1つ選ぶ'
})
```

→ `lifeClusters` に「病気の後の生活」「住宅ローンの来歴」「病気とお金の交点」が並び、`moneyRows` に「ワイド団信 157〜629円」が出ます。次の一手は、「病気の後 × 住宅ローン借り換え」以外の組み合わせを一巡することです。
