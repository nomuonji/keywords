# 伏せ字キーワードの需要推定（Bing較正）

Google Ads Keyword Planner は `includeAdultKeywords: true` でも、一部の成人向けの語（例: 風俗、デリヘル、ソープランド）を 0 で返す。0 は「需要なし」ではなく「値を伏せている」。

## ツール

- `bing_keyword_stats` … nomuonji/api `/api/bing-keyword-stats` 経由で Bing Webmaster の週次表示回数と月換算値（平均週次 × 52/12）を返す。保存しない。
- `censored_keyword_demand_estimate` … Google 規模の月間検索数を推定する。保存しない。

## 推定の流れ

1. 対象語と基準語（既定プリセット `jp_adult_nightlife` ＋ `anchorKeywords`）の Google Ads 値を取得。
2. 対象語・基準語の Bing 表示回数を取得。
3. 基準語ごとに `Google ÷ Bing` の倍率を計算し、**頭語（1語）と修飾付き（地名＋業種など複数語）で別々に**中央値と四分位を取る。各クラス3語未満なら全体の倍率を使う。
4. `gscSiteId` を指定した場合、そのサイトの直近28日GSCで上位（既定3位以内）・一定表示以上のクエリを基準語にした倍率も出す。上位表示の表示回数は検索数の下限。
5. 対象語ごとに `anchorEstimate` / `gscEstimate`（low–mid–high）と `recommended` を返す。

`recommended.source` の優先順: `google_ads`（伏せられていない） > `gsc_observed`（自サイトが上位表示） > `bing_gsc_calibrated` > `bing_anchor_calibrated` > `none`。

## 精度の目安（2026-10-23 実測）

- 頭語の倍率は約160〜240倍、修飾付きは約330〜670倍。日本の Bing は PC 中心で、スマホが多い地名検索ほど Bing に出にくいため。
- 基準語の leave-one-out 誤差の中央値は約54%。順位と桁を信じ、絶対値は low–high の幅で扱う。
- Bing の履歴は約半年分。表示回数が少ない語（例: 風俗 求人）は Bing でも `no_data`。

## 設定

- Keywords 側: 追加設定なし。`BING_KEYWORD_STATS_API_URL` が無ければ `GOOGLE_ADS_KEYWORD_VOLUME_API_URL` と同じオリジンの `/api/bing-keyword-stats` を使う。
- nomuonji/api 側: Vercel 環境変数 `BING_WEBMASTER_API_KEY`。
