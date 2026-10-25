# keyword_suggest（シードからのキーワード展開）

既存のKeywords Operatorのツールは、渡したキーワードの需要やSERPを調べるものだけで、シードから候補を広げる手段がなかった。`keyword_suggest` はその入口を担う。

## 仕組み

- 実体は `nomuonji/api` の `POST /api/keyword-suggest`。Keywords側はURLだけを持つ（`KEYWORD_SUGGEST_API_URL`、未設定ならGoogle Adsプロキシと同一オリジンから導出）。
- `sources`
  - `google` / `youtube`: Googleの公開オートコンプリート（非公式エンドポイント）。シード＋`expand`（`kana`=あ〜わ、`alphabet`=a〜z、`full`=両方＋数字）＋`modifiers`で展開する。
  - `ads`: Google Ads Keyword Plannerの `generateKeywordIdeas`。検索数付き。
- `modifierPreset: "intent_ja"` は「後悔・代わり・何歳から・捨て方・一人暮らし」など、シード中心の調査で漏れやすい状況語を付けて展開する。英語は `intent_en`。
- 結果は重複を統合し、複数ソース→多くの接頭辞から出た順→サジェスト順位で並ぶ。`hits` は何本の接頭辞からその語が出たか。
- `includeVolumes: true` でAdsの月間検索数を付与（最大1000語）。

## 注意

- サジェストは「どう検索されるか」の証拠であり、検索数ではない。需要は `includeVolumes` か `keyword_screen_batch`、機会判断は `serp_research` で確かめる。
- 非公式エンドポイントのため、429や非JSON応答で途中打ち切りになることがある（`warnings` に出る）。1呼び出しのサジェスト要求は最大400本。
- 読み取り専用。採用候補は `keyword_treasury_save` で保存する。
