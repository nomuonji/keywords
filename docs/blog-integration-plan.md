# Blogサイト群との連携 — Keywords側実装計画

作成日: 2026-09-08 / 状態: 設計・実装完了（外部公開とライブSEO成果の確認は未実施）
実装更新: 同日、サイト取込から企画・結果・探索・計測の接続を実装。現行の機能と制限は [運用手順](blog-integration-operations.md) を参照。以下は計画策定時点の設計を残したもので、ライブSEOの成果確認は別工程。

改訂: 同日、第9〜12節に未知語探索・証拠の区分・量産防止の必須要件を追加。共有commands、schema、各adapter、Blog bridgeは実装済み。policyの有効化や本番キャンペーン開始は別の人の判断で行う。

対象: `D:\youph\Blog\keywords` と `D:\youph\Blog`。
連携契約・Blog側バックログの正本は [SEO_KEYWORDS_INTEGRATION_PLAN.md](../../../Blog/SEO_KEYWORDS_INTEGRATION_PLAN.md)。この文書は既存の [実用化改善完了記録](product-improvement-proposal.md) の次の独立スコープであり、完了済みB01〜B12を再実装する計画ではない。

## 1. 目的と製品境界

調査結果を「採用されたキーワード」で終わらせず、実サイトの改善と公開後の観測に結びつける。Keywordsは調査・企画・レビュー・学習を持ち、検証済みartifactをBlog Gitリポジトリへcommit・pushする。Git接続済みの本番サイトでは、push後にKeywordsが公開URLを直接検証し、Blog側の応答なしで公開後観測へ進める。CMS投稿そのものは扱わない。

Agent-nativeの原則を維持する。UI、CLI、MCP、Operatorは同じcommandsとSQLを利用する。新しいagent専用DBやタスクJSONを追加しない。JSON受け渡しは監査可能な輸送物であり、状態の正本は共有SQLとBlogの既存実行台帳に分担する。

## 2. 既存機能と不足の区別

確認したもの: AGENTS、README、product-improvement-proposal、commandsのoperator/metrics/workspace等。DB実データ・外部接続・全テストの動作は今回未検証。

| 既存資産 | 今回加える接続 |
|---|---|
| project brief / provider capability | Blog site ID・許可・品質・言語との対応 |
| discovery job / claim / lease / heartbeat / budget | 実サイトの不足意図を入力し、成果の戻り先を固定 |
| candidate / source / cluster / page plan | 承認版・独自材料・既存改稿先をwork packageに固定 |
| Human Review / decisions / policy | 企画承認を維持し、公開許可との意味を分離 |
| sitemap・GSC由来の実URLを同一pagesで管理 | 未公開ローカル内容・生成元・hashの照合 |
| queryとpageそれぞれのGSC履歴 | query×pageの関係、変更版別の観測結果 |
| continuous discovery summary | 公開時点・実績との明示的な対応。採用率とSEO成功率を分離 |
| Operatorが理由付きtaskを作る | Blog返却結果・観測期限を材料にする。実行エンジンにはしない |

## 3. 責務配置

- `packages/db`: site binding、handoff、receipt/outcome、必要なquery×page履歴のschemaとmigration。既存pages/tasks/work_sessionsを参照し、複製しない。
- `packages/domain`: バージョン付き交換型と検証型。
- `packages/research`: GSC query×page等の外部読み取り。SQLを変更しない。
- `packages/commands`: binding更新、context受領、承認版export、直接公開検証/receipt記録、予算・権限・再送・監査。
- `apps/api`, `apps/cli`, `apps/mcp`: 同じcommandのadapter。直接SQLを書かない。
- `apps/web`: 人の対応確認、企画レビュー、Blog状態・結果・保留理由の表示。
- Blog側adapter: ローカルinventory、autopilot.py、品質証拠への接続。Keywordsから任意のシェルを実行しない。

command名・テーブルは実装済み。正本は packages/commands/src/blog.ts、packages/commands/src/blog-contract.ts、packages/db/src/blog-schema.ts と docs/blog-integration-operations.md。本書の提案時点の記述だけを根拠に未実装の操作を増やさない。

## 4. Keywords側バックログ

| ID | 優先 | 実施内容 | 完了条件 / 依存 |
|---|---|---|---|
| KW-01 | P0 | site bindingとcapabilityの設計。projectとBlog siteを対応 | host・言語・GSC property/filter・profile版を検証。未対応サイトはexportできない。BL-01と同時に仕様確定 |
| KW-02 | P0 | Blog site contextの取込 | 既存pagesを再利用。ローカル未公開と公開実URLを区別、hash・生成元・品質証拠へ辿れる。BL-02に依存 |
| KW-03 | P0 | 証拠付き企画をBlog向けに固定 | 既存改稿先、独自価値、調査条件、未確認事項、観測仮説、承認版を検証。独自材料なし・意図重複は保留 |
| KW-04 | P0 | 承認済みwork package exportを共有command化 | human-only承認を維持。版/ID/idempotency、対象サイトとURLを固定。秘密・任意shellを含めない。BL-03に対応 |
| KW-05 | P0 | Blog receiptの共有command取込と再照合 | local_verifiedとpublishedを区別、二重イベントを抑止、順序逆転で状態を巻き戻さない。BL-04に対応 |
| KW-06 | P1 | query×page取得と変更版別outcome | 国/デバイス等を使う場合の条件、期間、欠損、完全性、取得日を保持。特定企画→実際の着地URLを評価可能 |
| KW-07 | P1 | Operatorとcontinuous discoveryへ結果を戻す | 次の一件を理由付きで提示。観測待ちには新しい改稿を重ねず、blocked/reviewを尊重 |
| KW-08 | P1 | Web/CLI/MCPの最小表示と操作 | 調査根拠、承認版、Blog結果、観測予定、保留理由を一貫表示。汎用チャット画面は不要 |

KW-03で不足する需要根拠の取得手段が見つかった場合だけresearch adapterを追加する。既存SERP/Web/Adsで足りる部分は再利用し、サジェスト観測の有無を明示する。架空のサジェストを補完しない。

## 5. 状態・承認・再開

既存discovery/work sessionの状態を維持し、handoffは承認済み企画の配送履歴として関連付ける。Keywordsで調査タスクが完了しても、Blog作業・公開・SEO評価が完了したとは表示しない。

1. Operatorが既存taskと未完sessionを確認する。tickは実行を開始しない。
2. Agentはwork sessionと予算内で調査・企画を完成させる。
3. 既存Human Reviewで企画を承認する。Agentは承認できない。
4. 承認されたplan revisionをexport。Blogが受信前に有効な承認版を検証する。
5. Blogが受領・ローカル検証・公開待ち・公開を別イベントで返す。
6. 公開確認後に観測し、結果から次のtaskまたはpolicy候補を提案する。

承認後の企画変更は旧版の承認を流用しない。Blog着手後の取り消しは共有タスクの競合として扱い、自動ロールバックや削除を行わない。既存記事のpublished状態は企画承認の証拠にしない。

work sessionがawaiting_review / blockedなら既存ルール通り停止する。外部配信待ちの長時間処理はcheckpointと参照IDを残し、leaseを無期限に保持しない。再開時はSQLとBlog receiptから照合する。

## 6. 計測と調査へのフィードバック

`metrics.ts`の既存query単独/page単独履歴を残し、query×pageは別の観測粒度として追加する。query単独の値を複数pageへ複製しない。GSC property、search type、期間長、非重複期間に加え、host/path・国・device等の条件を比較キーへ含める。

行上限、ページング、匿名化や欠落、比較読み込み上限を評価結果へ伝える。queryが返らなかった状態を検索ゼロへ変換しない。途中取得失敗は前回の正常snapshotを失わせず、完了した取得単位をtransactionで保存する。取り込み再試行で履歴や集計を二重に増やさない。

Monitor由来CTRは保存例で百分率、GSC API由来は比率なので、共通形式は0〜1と単位を宣言し境界で変換する。表示時だけ%にする。GSCのquery行合計とproperty総数、GA4全流入と自然検索、各providerの採用率と検索成果を混同しない。

結果には「何をいつ変更したか」「比較窓」「狙ったqueryと着地URL」「表示/クリックの差」「判断保留理由」「次の観測日」を持たせる。採用・公開・実績の段階別分母を固定して集計し、未公開候補をSEO失敗に含めない。

次回探索では成果のある意図・提供価値・材料を参考にするが、1件の偶然の増加でpolicyを自動有効化しない。既存decisions → policy候補 → human activationを維持する。

## 7. 最小受け入れ試験

| シナリオ | 必要な結果 |
|---|---|
| 正常系 | 1企画が承認、Blog検証、公開確認、outcomeまで同じIDで追跡できる |
| 同一package再送・receipt再送 | queue、runの実処理、完了数が二重化しない。再送の監査は残る |
| export後にplan更新/承認撤回 | 旧承認版の新規実行が止まる |
| 未承認サイトへnew_article | clearedでもサイト別許可がなければBlogで拒否し、Keywordsに理由が戻る |
| ローカル原稿変更・別Agent実行 | hash/leaseの競合を検出して止め、上書きしない |
| Blog処理成功後に通信断 | 同一itemを照合してreceiptだけ再送できる |
| 日英/サブドメイン/同名slug | 他projectのpageや計測へ紐付けない |
| GSC欠損・途中失敗・比較条件違い | ゼロや減少に変換せず、前回正常履歴と保留理由が残る |
| build成功・未公開 | publishedにならず、7/28/90日観測を開始しない |
| 予算切れ・review待ち | 後続の調査・変更が停止し、既存work loopで再開できる |

型・migration・commands境界の試験を先に行い、既存CIの関連smokeとbuildを通す。DB変更前は既存backup/restore手順を使う。外部実データ試験は1サイトに限定する。

## 8. 今回の完了と次回の着手点

今回は両フォルダへの計画文書配置のみ。DB、記事、queue、Operator設定、既存承認、公開状態は変更しない。

次回実装の着手点はKW-01 / BL-01。最初の目標は既存記事1件の受け渡しであり、全サイト登録やキーワード大量投入ではない。連携の正しさを確認してから、観測結果に基づいて範囲を広げる。検索成果の保証を実装の受け入れ条件にせず、成果が検証可能になることを条件にする。

## 9. 未知の実検索語を拾う探索エンジン

AIが考えた語に検索ボリュームを付けるだけでは要件未達。AIは観測する場所の選定、語の解釈、意図の分類、追加調査の判断を担当し、語の実在性は外部観測で支える。

### 9.1 入力経路を分ける

| 経路 | 収集するもの | 証明できる範囲・制限 |
|---|---|---|
| GSC | 主対象として設定していない表示query、本文にない修飾語、複数URLへの分散 | 自サイトが表示された観測。市場全体を網羅せず、匿名化・取得上限あり |
| 検索サービスのサジェスト・関連検索等 | providerが実際に返した文字列、入力語、国/言語、取得時点 | 検索サービス上の観測。検索回数、順位獲得、人気順の保証ではない |
| Ads keyword ideas等 | 種語以外の返却語、対象条件、月次値と集計範囲 | provider推計。類似語の集約や欠損を区別 |
| 質問・レビュー・コミュニティ | 公開投稿の具体的な困りごと、俗称、比較対象、失敗状況 | 読者の表現の存在。別途検索需要を検証する |
| 公式一覧・仕様・発売情報 | 型番、資格名称、版、制度変更、対象条件 | 対象の存在や変更。検索需要・競合不在は未確認 |

まず利用可能な経路をcapabilityで診断する。API/provider、許可された取得手段、URL、国/言語、鮮度、ページング、レート制限、費用、リクエスト上限を登録する。未対応のsuggest機能を既存実装済みと表示しない。

取得は認められたAPI/providerまたは限定的なブラウザ確認を使う。検索結果の無許可な自動大量取得、制限回避、API失敗時の架空補完をしない。認証・個人情報を保存せず、公開投稿は必要最小限の表現と出典を残す。

### 9.2 外部語から再帰的に広げる

1. project brief、既存coverage、除外テーマ、材料を確認する。
2. 外部観測からseedを取得する。AI仮説は別扱いで保存する。
3. plain・疑問形・前後修飾・表記ゆれ・対象別辞書の展開を、対応する取得手段と予算内で行う。生成した組合せ自体は観測済み語にしない。
4. 生の返却文字列を保存する。日本語の表記ゆれや俗称を早期に丸めて失わず、正規化キーと元表記を併存させる。
5. 新しく見つかった修飾語・固有名詞・読者状況を次のseedとして1段再展開する。入力元→親語→展開方法→観測の系譜を保存する。
6. 新しい意図が見つかった経路を優先する。ただし同じproviderの出力を複数回得ても独立した需要根拠とは数えない。
7. 意図単位で既存ページ・未公開原稿・企画と照合してから、上位候補のSERPと実ページを読む。

初期の上限案は深さ2、外部リクエスト30回/セッション、保存候補20件、詳しく評価する意図5件。既存work/discovery予算の小さい方を守る。上限は目標件数ではない。2回連続の展開で新規意図が得られない経路は停止し、別経路へ切り替えるか完了する。

初回は可能なら性質の異なる2経路を使い、少なくとも1つは自サイトGSC以外を含める。使えない場合はcoverage不足を明記し、全体探索完了とは表示しない。結果ゼロを失敗扱いして予算や候補上限を増やさない。

### 9.3 証拠の保存と候補の通過条件

既存sources/candidatesに関連する観測として、次の追加項目を検討する。別のagent台帳は作らない。

`raw_phrase, normalized_key, origin_type, provider, source_ref, parent_observation_id, expansion_method, observed_at, country, language, request_id, observation_status, demand_status, metric_period, raw_metric_ref, unknowns, next_check_at`。

- observation_status: observed / generated_hypothesis / failed / unavailable。失敗を空結果と区別。
- demand_status: gsc_observed / provider_estimated / search_surface_observed / audience_expression_only / unverified。単一の真偽値へ潰さない。
- queryをAIが読みやすく書き換えたら、raw_phraseとは別のinterpretationにする。
- 候補の保留理由: demand_unverified / intent_covered / no_added_value / site_ineligible / stale_evidence / source_unavailable等を既存review理由へ接続。

shortlistからpage planへ進む前に「検索に関する証拠」「SERPの具体的不足」「提供できる材料」「同一意図の既存ページ有無」を揃える。投稿・公式名・AI仮説だけの候補はresearch_moreまたはhold。極小需要の候補を捨てるのではなく、需要不確実性を残して確認を続ける。

SERP評価は上位URL、取得条件、ページ形式、直接回答、対象者、欠けた判断材料、代替解決手段を保存する。allintitleやQ&A上位だけの採点では通さない。AIOや動画で満たされる意図なら、その形式を上回る訪問理由があるか検証する。

## 10. 機能の成功を測る基準

探索数やshortlist数だけを増やさない。次を別々に表示する。

- 外部由来の新規意図数 / 詳細評価した意図数。表記ゆれの件数を新規意図にしない。
- 外部観測で確認された候補数 / 確認を試みた候補数。証拠区分別に表示。
- 既知・重複率、経路別の新規意図、1つの適格企画までの費用/時間。
- 需要ありでも追加価値不足で止めた件数。正常な停止として扱う。
- 企画承認率、公開到達率、公開後の成果を段階別に表示。人が好んだ企画をSEO成功としない。

検索語コーパスの全体を知れないため、未知語の網羅率や「市場の何%を発見した」といった値は出さない。人が採用しやすい語だけへ最適化せず、未検証だがサイト適合する経路にも予算の余地を残す。

## 11. 追加価値ゲートと量産抑止

Blog計画第12節と同じ定義を使う。page plan / exportに `value_asset_refs, reader_task, coverage_comparison, claim_source_map, editorial_owner, maintenance_owner, review_due_at` を追加する。

「比較記事にする」「詳しく解説する」のような宣言は材料ではない。検証済み比較データ、調査方法、実読・実測記録などへの参照が必要。確認可能な公開資料の独自整理も許すが、競合本文の言い換えだけでは通さない。

プログラム上の必須fieldチェックと、資料の実読による編集判断を分ける。生成者がvalue_asset_refsへ適当なURLを入れれば通る設計にしない。存在・内容・主張との関連を検証したreview evidenceを残す。

同一cluster/reader_taskで既存ページが答えられる場合、new_pageを自動提案せずimprovement候補を優先する。型番・地域・誤字の直積、薄い翻訳、タグ/一覧増殖、複数保有サイトへの複製を検出してreviewへ送る。単なる類似度だけで禁止・削除しない。

安全な記事数や安全な文字数という表示は作らない。既存の3URL上限は観測と損失を限定するためで、Google適合の証明ではない。適切な根拠がなければ候補ゼロ・新規ゼロで完了可能にする。

## 12. 追加バックログと受け入れ試験

| ID | 優先 | 作業 | 完了条件 |
|---|---|---|---|
| KW-09 | P0 | 経路capability、観測状態、語の系譜 | raw phraseとAI仮説が混ざらず、第三者が観測元を辿れる |
| KW-10 | P0 | 外部語起点の再展開、重複抑止、飽和停止 | seedにない意図を外部入力から取り込め、予算内で再開可能 |
| KW-11 | P0 | SERP実読・需要不確実性・coverage評価 | 単純スコアで企画を通さず、検索証拠不足はholdになる |
| KW-12 | P0 | 追加価値と近似企画のゲート | 材料不足のnew_pageをexportせず、既存改善へ戻せる |
| KW-13 | P1 | 経路別実績、実験結果と停止条件をOperatorへ接続 | 標本不足や負債増加時に量産タスクを増やさない |

KW-09〜11を初回探索より前、KW-12を初回exportより前に実装する。KW-13とBlog BL-11を次バッチへの拡大より前に実装する。

追加の受け入れ試験:

1. 固定fixtureのseedに含まれない俗称・修飾語をprovider結果から取り込み、出典と再展開を追跡できる。fixture語を実データの成果とは報告しない。
2. AIが作った自然な語でも、外部証拠なしなら需要確認済みにならない。
3. サジェスト単独の観測から検索回数を作らず、Ads 0/未取得を区別する。
4. 語の表記が違っても既存ページと同一意図なら、別URL企画を止めて改稿候補へ戻す。
5. SERPにQ&Aが多いが回答が十分な場合、弱い競合として自動採用しない。
6. 100型番や地名の組合せを入力しても100ページを作らず、意図と材料で個別判定する。
7. 形式上sourcesが揃っていても、資料が主張を支えない・体験を捏造した原稿は合格しない。
8. 経路障害、飽和、予算枯渇、適格候補ゼロが、理由と次回条件付きで正常に停止する。
9. ライブ試行では代表1サイトで外部由来の意図を検証し、採用だけでなく見送り・保留の根拠をレビューする。件数ノルマを設定しない。

公式方針と経験則の区別はBlog計画第14節参照。スキルのallintitle閾値やサジェスト需要断定を無条件に移植しない。既存policyの有効化は人の判断を維持する。
