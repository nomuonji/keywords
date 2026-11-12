# お宝キーワード探索法 — 本文は My Portal にある

**EXPLORATION BASE: my-portal exploration_base `treasure-keyword-note`**
**CANONICAL: My Portal の探索拠点（method.body）**

探索法の本文（何をどう測るか、合格の線、手順、弱い枠の数え方、版の履歴）は、
2026-11-12 の tsk-v26 から My Portal の探索拠点に置いている。
`exploration_base_get({id:"treasure-keyword-note", view:"full"})` の `method.body` で読み、
My Portal の画面では「探索拠点 → お宝KW探索 → 詳しく見る → 探索法」で見られる。
ゴール、制約、見立て、実行記録も同じ拠点にある。

このリポジトリに残すのは、コードでなければならないものだけ。

| 内容 | 場所 |
|---|---|
| 弱い枠の数え方の実装 | `scripts/treasure-score.ts` |
| 数え方を黙って変えられないようにする検査（転職 後悔=7、ペットロス=3、空き家 売却=0） | `scripts/treasure-score-smoke.ts`（`npm run test:treasure`） |
| SERP・需要の測定コード | `packages/research`、`scripts/serp-reserp.py` |
| サイクルごとの判定記録 | `docs/treasure-cycles/` |

各 run は、候補の evidence とサイクル記録に `methodVersion`（拠点の method.version）を残す。

数え方を変えるときは、拠点に新しい版を登録し、同じ変更を `treasure-score.ts` とその検査にも入れる。

tsk-v25 までこの文書が本文で、合格条件・版・勝ちパターンの台帳は `docs/method/*.json` にあった。
どちらも commit 991c705 以前の git 履歴で読める。
