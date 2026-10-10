# AGENTS.md

## このプロジェクトで「作業開始して」が意味すること

このリポジトリにおける「作業」「作業開始して」「作業して」「SEO作業を進めて」「続きから進めて」は、説明や作業候補の提示を求める言葉ではない。**アプリを起動または既存の起動状態へ接続し、SEO改善の運用ループをその場で最後まで実行する指示**である。

この指示を受けたら、次の順で直ちに進める。

1. Keywords API（`http://127.0.0.1:8787/health`）とWeb画面の起動状態を確認し、未起動なら `scripts/start-local.ps1` で起動する。起動済みなら二重起動せず、その状態を再利用する。
2. Blog接続済みサイトの計測・回復運用が必要なら `scripts/start-maintenance.ps1` を起動する。同じworkerが動いている場合は二重起動しない。
3. `operator_context` と `work_context` を読み、既存のwork session/taskを再利用する。未完了sessionがなければ `work_start` する。ユーザーが具体的な対象を指定していない場合は、operatorが選んだ最優先タスクを実行対象にする。
4. プロジェクトのpolicyとSEO回復・Blog連携の境界を確認し、調査、既存ページ改善、構造化変更、計測など、許可された作業を判断して実行する。回復待ちで新規記事が禁止されていても、計測、既存ページの検査、根拠付き改善、またはno-change記録まで進める。禁止状態を理由に、作業候補だけを返して終わらない。
5. 変更・検証・checkpoint・`work_complete` まで通す。人の承認、明示pause、予算超過、公開・pushなどの不可逆境界に到達した場合だけ、そこで停止して具体的な理由と次の一手を報告する。

アプリの起動確認、状態同期、調査、構造化されたworkspace変更、build検証、監査記録は、この「作業」に含まれる。ユーザーに「何をしますか」「どのサイトですか」と聞き返すのは、対象を安全に特定できる情報が本当にない場合を除き禁止する。

## 収益テーマ継続リサーチ

商品制作なしの新規SEO収益テーマを継続探索する場合は、過去チャットを推測で再構築せず、まず remote MCP の `theme_research_context` を読み、正本 research session `seo-theme-research` の続きから進める。`bootstrapRequired: true` の場合は、新しい調査を始める前に `legacyFindings` を候補台帳へ移す。詳細は `docs/theme-research.md`。

このリサーチでは総合スコア・自動ランキング・単一指標による勝者選定を作らない。検索量、成果単価、EPC、確定率、SERP観測などの数値は証拠として保存し、残存理由、致命傷、未確認点、次の反証を文章で更新する。候補を落とした理由は保持し、新しい証拠なしに killed 候補を再提案しない。観察から次の検索を変える探索は既存台帳の `discovery` に保存する。管理サイトでは `seo-discovery-{siteId}` を使い、新規収益テーマ台帳と混ぜない。スケジュール実行では実際の証拠がある批判検証結果または具体的な取得阻害要因を残し、次のセッションがチャット履歴なしで再開できる状態を残す。

## 市場intent回帰

`packages/commands/src/market-intelligence.ts` のintent分類・query分解・commercialization適用条件を変更するときは、`npm run test:market-intent` を必ず通す。fixtureは特定テーマ専用にせず、B2B/B2C・日本語/英語・entity・investment・qualification・commercial・problem・solution・how-to・polysemy・negative controlを横断する。

新しい実市場調査で誤分類を発見した場合は、その単語だけを場当たり修正して終わらせない。まず再現seedを `scripts/market-intent-regression-smoke.ts` に追加し、一般化できるintent signalか、特定entity/domain固有の意味かを切り分けてから分類器を変更する。広い語彙を追加する場合は、同時に過剰一致のnegative controlも追加する。

## 市場シグナル観測

新規プロダクト・コンテンツ・収益テーマの発想を始めるとき、モデルの一般知識だけから需要を推測しない。単純な現在値だけでよい場合は `market_signal_scan`、商品機会・訴求・ポジショニングまで考える依頼ではまず `market_intelligence_research` を使う。queryを指定した調査では broad trend を根拠に流用せず、hypothesis-led mode の query-relevant Hacker News / SERP関連検索・PAA / Google Ads需要 / App Store商品化を使う。さらに related search / PAA / SERP / demand / query-relevant外部シグナルを intent tree に分解し、problem_need / solution_product / how_to / commercial / entity / investment / career_qualification / news / research_information / ambiguous を混同しない。root queryがambiguousな場合は最初からproblem/solution/commercial等を主枝に決め打ちしない。`senseSelectionRequired` に従い、取得したintent branchesと需要を見て分析対象の意味・intentを選び、market thesisを書く前にそのintentが明示されたqueryで `market_intelligence_research` を再実行する。同名ブランド・別カテゴリ・語の向き（例: Xを守る／Xを使って守る）を字面一致だけで同市場扱いしない。generic queryでは problem/solution/how-to/commercial を主枝とし、entityはout_of_scope、investmentとcareer/qualificationはadjacent_market、research/news/ambiguousはcontextualとして保持する。元query自体が資格・投資・entity等を明示している場合は、その枝を主枝へ切り替える。queryなしの場合だけ全体トレンドを探索起点として扱う。後者はGoogle Trends / TikTok Creative Center / Hacker Newsに加え、TikTok Top Adsの公開クリエイティブ、Pinterest Trendsの公開面（best-effort）、Apple App Storeの商品化状況を束ね、訴求mechanicとmarket thesis用の証拠枠を返す。定期実行は前提にしない。詳細は `docs/market-signals.md`。

前回との差を見る必要がある場合だけ、ユーザーの依頼または明確な調査目的に基づいて `market_signal_snapshot_save` を明示的に呼ぶ。snapshotは自動保存しない。後で `market_signal_snapshot_compare` を使い、同一ソース・同一ラベルの数値差、ランキング面への新規出現/消失をvelocityのトリガーとして読む。

アフィリエイト市場やSNS出力パターンを比較する依頼では、query付き `market_intelligence_research` に `researchGoal: "social_affiliate"` を指定する。query付き調査はTikTok / YouTube Shorts（必要ならInstagram Reels）の公開インデックス上の実在コンテンツを観測し、取得できるTikTok公開ページでは再生・いいね等をbest-effortで補完する。`coverage.conclusionAllowed=false` の場合は、SEO/SERP側だけで市場順位や推奨を確定してはならない。0件取得は市場不在ではなく取得不能/証拠不足として扱う。SNSの検索順位はネイティブ人気順位ではないため、formatSignalsは出力パターン観測に使い、engagementはmetricProvenance付きの値だけを根拠にする。

Google Trendsの検索トラフィック、TikTokの投稿数・閲覧数・広告CTR percentile、HNのscore/comments、App Storeの評価件数はそれぞれ異なる種類の注意・行動・商品化シグナルであり、売上や支払意思を直接示さない。複数ソースの反復パターンから行動・欲望・見せ方を抽出する。ただしmarket thesisを書く前に対象intent branchを明示し、別枝の検索量を合算しない。副枝は捨てず、別市場として独立検証するときだけ別thesisへ昇格させる。Top Adsからはcomparison / social proof / problem-solution / demonstration等の訴求mechanicを読むが、これはcross-categoryの訴求参考値であり対象queryの需要証拠ではない。App Store Searchもlexical search evidenceに留め、タイトルとdescriptionExcerptの意味が選択したsenseと合うことを確認してから商品化根拠へ使う。その後に audience / format / context / social loop / output artifact / distribution / business model のどこを横にずらせるかを考える。観測した商品をそのまま模倣せず、copy_like / adjacent / speculative を明示する。単一の総合Opportunity Scoreへ潰さない。

## SEO情報源ウォッチ

SEO界隈の人物・Xアカウント・ブログ・ニュースレター等を継続観測するときは、チャット履歴だけで監視対象を再構築せず、remote Keywords MCP の `seo_source_pool_context` を最初に読む。ユーザーが「最近あいつら何か有益なこと言ってる？」「このSEOアカウントを貯めておいて」などと依頼した場合は `docs/seo-source-watch-pool.md` に従う。

Sourceは権威リストではなく観測対象である。発信者の評判だけで主張を採用せず、公開URLと簡潔な要約をFindingに保存する。Google Searchの仕様・ポリシー主張は一次情報を優先して別途確認する。新規性がなければ `nothing_new` を正当なScan結果として残し、無理に示唆を作らない。評価関数への反映は Source → Scan → Finding → independent verification → Evaluation Registry の順とし、インフルエンサー投稿を直接ルール化しない。

## Product principle

This repository is an agent-native SEO workspace. Do not add a second, agent-only state model. Human UI actions, CLI operations, MCP tool calls, and scheduled operator ticks must execute the same commands against the same SQL database.

## Boundaries

1. `packages/db` owns persistence and schema.
2. `packages/research` owns external read adapters and must not mutate workspace state.
3. `packages/commands` owns mutations and business rules, including persistence of research results.
4. `apps/api`, `apps/cli`, `apps/mcp`, and `apps/web` are adapters.
5. Adapters must not write SQL directly.
6. Every mutating command must produce a `runs` audit record.
7. `operator.inspect` is deterministic prioritization, not an opaque SEO score. `operator.tick` may create one shared agent task but does not execute that SEO task itself.
8. Search Console history belongs in `keyword_metric_snapshots` and `page_metric_snapshots`; latest keyword fields remain a convenience cache, not the historical source of truth.
9. Real site URLs belong in the same `pages` model as page proposals. Sitemap/Search Console imports use `url`, `source`, `last_seen_at`, and published/existing state so proposed and live coverage can be compared directly.
10. Agent work should be grouped into `work_sessions` whenever the user asks the agent to perform a body of SEO work rather than one isolated read/write.
11. A work session stores objective, completion criteria, bounded action budget, checkpoints, command linkage, and a final project-state diff. Checkpoints store concise outcomes and next actions, never private chain-of-thought.
12. Concrete human decisions requested by an agent belong in `review_requests`. A review request pauses its work session and exposes explicit resolution options in the Human Review Inbox.
13. Human approve/reject choices that teach future behavior belong in `decisions`.
14. Durable project-specific operating rules belong in `policy_rules`. Agents may propose candidates from decisions, but only humans may activate, reject, or retire them.
15. Active project policies take precedence over generic SEO heuristics in `skills/`, unless a higher-level product/safety boundary conflicts with them.
16. Research credentials are environment-only; never write access tokens, API keys, developer tokens, or OAuth secrets to SQLite, source metadata, runs, decisions, policy rules, work sessions, checkpoints, or review requests.
17. CMS publication remains out of scope. A verified local artifact may be committed and pushed only through the configured Git delivery path; it must stage only that artifact and record a `runs` audit entry. For Git-connected production sites, Keywords performs the HTTP/canonical check directly after delivery and may mark the handoff `published` without waiting for a Blog-side response. Do not add WordPress, Hatena, Blogger, or other CMS side effects unless product scope explicitly changes.

## Agent safety model

- Read operations: allowed without approval.
- Reversible workspace writes: allowed when requested.
- External research reads: allowed when configured, and should persist useful evidence as a `source`.
- `site_sync` and `metrics_capture` are external reads plus reversible workspace synchronization; they count against a work-session action budget.
- Page proposals: agents may create evidence-backed `page_plan` records but may not approve them.
- Policy learning: agents may call `policy_context` and propose decision-backed policy candidates, but may not activate or retire policies.
- Human review: agents may create and inspect `review_requests`, but there is intentionally no MCP tool for resolving them.
- Work-session pause states are real boundaries. When a session is `awaiting_review` or `blocked`, do not continue writes or external research until the condition is resolved and the session is resumed/synchronized.
- Respect the work-session action budget. Read-only inspection does not consume the action budget; workspace mutations and external research do. When exhausted, checkpoint, request review, or complete instead of expanding scope.
- Destructive or external side effects: design an approval boundary first.
- Public web and sitemap fetches must reject local/private-network targets by default.

## Preferred work loop

For Blog-connected projects, read `docs/blog-integration-operations.md`. Use `blog_contract` to inspect the exchange schemas, attach the value/evidence brief with `blog_prepare` before human page approval, and use shared Blog commands for all imports/exports/receipts. A local snapshot is not live publication or indexation evidence. Use persisted external observations as expansion parents; never promote an AI-generated phrase or audience expression to measured search demand. Do not invoke human CLI roles from an agent to bypass binding or page approval.

For a substantial user instruction such as "do today's SEO work":

1. Call `operator_context` to understand why the system currently prioritizes one item over the others. If the scheduled operator already created a task, do not create a duplicate.
2. Call `work_context` to read the compact operating state.
3. If no unfinished session exists, call `work_start`. Prefer the operator-selected/shared task unless the user's instruction gives a more specific objective.
4. Read active project policies before making strategy choices.
5. If the task is site freshness, use `site_list` and `site_sync`; if it is performance freshness or decline analysis, use `metrics_context` and `metrics_capture` as needed.
6. Claim or move a selected task to `doing` when the session is task-driven.
7. Gather only evidence that can change the decision.
8. Make the smallest justified structured changes through commands.
9. Use `work_checkpoint` after a meaningful phase or when blocked.
10. When a specific human choice is required, call `review_request` with the target, question, and explicit options. This automatically moves the session to `awaiting_review`; do not also create a vague duplicate checkpoint.
11. Stop rather than continuing speculative work across that approval boundary.
12. After the human resolves the request, call `work_context` to synchronize the session and continue only if it is running.
13. Call `work_complete` with a concise outcome summary when the completion criteria are satisfied. The system records the baseline-to-current state diff automatically.

Do not use checkpoint or review-request text as a scratchpad. Record results, evidence-backed conclusions, blockers, the concrete human question, and the next externally useful action only.

When repeated human decisions indicate a durable preference, use their decision IDs to propose a concise project policy candidate. Do not infer a permanent rule from a single incidental judgment unless the human explicitly states it as a general rule. Avoid hard-coded A→B→C pipelines when a command-based loop can express the workflow.
