# keyword_suggest（シードからのキーワード展開）

既存のKeywords Operatorのツールは、渡したキーワードの需要やSERPを調べるものだけで、シードから候補を広げる手段がなかった。`keyword_suggest` はその入口を担う。

## 仕組み

- 実体は `nomuonji/api` の `POST /api/keyword-suggest`。Keywords側はURLだけを持つ（`KEYWORD_SUGGEST_API_URL`、未設定ならGoogle Adsプロキシと同一オリジンから導出）。
- `sources`
  - `google` / `youtube`: Googleの公開オートコンプリート（非公式エンドポイント）。シード＋`expand`（`kana`=あ〜わ、`alphabet`=a〜z、`full`=両方＋数字）＋`modifiers`で展開する。
  - `ads`: Google Ads Keyword Plannerの `generateKeywordIdeas`。検索数付き。
  - `bing`: Bing Webmasterの `GetRelatedKeywords`。Bing全体の表示回数（`bingMonthlyImpressions`、`bingDays`で集計日数）。アダルト系も伏せられない。
- `position: "before" | "both"`（または `expand: "pre"`）で「＿ シード」の前付けも補完する（地名・人名・原因が拾える。Googleのみ）。
- サジェストの予算は1回400要求。基本→文字展開→修飾語の順に全シードへ均等に割り当て、落ちた分は `autocomplete.skippedByTier` / `skippedBySeed` に出る。
- `adsMatch`（既定 `seed`）でシードを含まないAdsアイデアを落とす。
- `modifierPreset: "intent_ja"` は「後悔・代わり・何歳から・捨て方・一人暮らし」など、シード中心の調査で漏れやすい状況語を付けて展開する。英語は `intent_en`。
- 結果は重複を統合し、複数ソース→多くの接頭辞から出た順→サジェスト順位で並ぶ。`hits` は何本の接頭辞からその語が出たか。
- `includeVolumes: true` でAdsの月間検索数を付与（最大1000語）。`"auto"` はAdsで測れない語（成人向け等）を最大40語Bingの表示回数で補う。`volumeSource` で出どころが分かる（Bingの値はGoogle検索数ではない）。
- `includeVolumes` 指定時は `seedVolumes` にシード自体の検索数（`"auto"` ならAdsが0のシードをBingで補う）。
- 全行に `matchesSeed`（シードを含むか）。Bing関連語の `false` 行は隣接テーマ・ブランド。
- SERPプロキシが `degraded: true`（0件・別検索の結果）を返した場合、Keywords側はその結果をキャッシュせず、`analysis.limitations` に `DEGRADED SERP` を付ける。
- SERPプロキシは1回25秒の時間予算で動き、超えると `503 serp_timeout`、全プロバイダの無料枠切れは `503 serp_quota_exhausted`。
- SERPの枠（月）: Reserp 4,500 → Bright Data 4,500 → Brave 900（Braveは月5ドルのクレジット≒1,000件。Brave独自の検索結果でGoogleの順位ではない）。`KEYWORDS_SERP_*_BUDGET` で変更でき、総上限の既定は合計の9,900。
- Keywords の `serp_research` は、まだ枠の残っているプロバイダだけを順番指定（`providers`）でプロキシに渡し、実際に答えたプロバイダを `serpUsage/{月}.byProvider` に原子的に加算する。`serp_usage_status` の `providers` に使用数・枠・残りが出る。`/api/serp-search` を直接叩いた分はこのカウンタに入らない。
- Braveが答えた結果には `engine: "brave"` と `analysis.limitations` の注記が付く。Googleの検索をBraveで代替した結果のキャッシュは最大1日（Googleが復帰したら置き換わる）。

## 注意

- サジェストは「どう検索されるか」の証拠であり、検索数ではない。需要は `includeVolumes` か `keyword_screen_batch`、機会判断は `serp_research` で確かめる。
- 非公式エンドポイントのため、429や非JSON応答で途中打ち切りになることがある（`warnings` に出る）。1呼び出しのサジェスト要求は最大400本。
- 読み取り専用。採用候補は `keyword_treasury_save` で保存する。
