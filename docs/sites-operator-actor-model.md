# Sites Operator — 現行アクターとマクロ政策の正本

最終実査: 2026-10-08。設計を議論するとき、役職名だけから別のエージェントの存在を推測しない。

## 実際の実行主体（2026-10-08）

| Actor | 実行実体 | 権限と責務 |
| --- | --- | --- |
| **SEO Manager** | 有効なChatGPTスケジュールタスク `Site SEO Task Planner`（JST 0,3,6,9,12,15,18,21時の10分、3時間ごと）。MCP API roleは互換性のため `planner` | 16のactive Sites Operatorサイトを横断し、投資先を選び、SEOタスクを作る。配分・観測・再配分の判断を同一エージェントが行う |
| **Sites Operator** | `nomuonji/keywords` / Sites MCP / Firestore | マクロ政策・サイト方針・検索観測・SEO task・実行ゲート・履歴の正本。判断するLLM自身ではなくデータ／制約／永続状態 |
| **SEO Worker** | 別の実行エージェント。ChatGPT側の旧 `Site SEO Worker` schedule は無効化済み | タスクをclaimし、GitHub内のサイトコードを変更・検証・`seo/*` push。投資配分を独自に決定しない |
| **Central Delivery** | GitHub Actions | WorkerがpushしたブランチからPR/CI/main merge。Sites Operatorに完成receiptを書き戻す |
| **Legacy My Portal SEO Manager** | `site-seo-operations` Manager Jobは2026-09-30にarchived、ChatGPTスケジュールもdisabled | 現行運用に参加しない。旧My Portal queueをSEO現場の正本として読まない |
| **Keywords Operator** | 独立した市場探索／検索需要のエビデンス提供プラグイン | Managerが呼び出すデータソースであり、別のSEO Plannerアクターではない |

「Planner」は**現行のSEO Managerの内部的なAPI role alias**に過ぎない。「Manager→Planner→Worker」という独立3エージェント構成ではない。

## 伝達経路

1. scheduled SEO Managerは、最初に `seo_agent_context(role=planner)`、`seo_portfolio_policy_get`、`seo_portfolio_allocation_status`、`seo_recovery_status` を読む。Static Run Contractよりバージョン付き政策レコードを優先する。
2. Macro Policy = Objective / Allocation / Risk / Constraints / Evaluation。FireStore `seoPortfolioPolicies/organic-search` にrevision付きで保存。40/40/20はひとつの「現行インスタンス」に過ぎず、Managerソフトウェアの定数ではない。
3. Managerは現行GSC/GA4 digest、履歴、既存ready/in_progress、Site Direction、Keywords調査から比較して、実装可能なタスクへ落とす。投資bucketおよび想定effort unitsを記録し、policyRevisionAtCreationをタスクに固定する。
4. Workerは `seo_agent_context(role=executor)` から**最小限の実行契約とゲート情報**だけ受け、選択した `seo_task_get` / `seo_task_claim` で仕事を行う。Managerの投資構成や他サイトの方向性は読み込む必要がない。
5. `seo_task_create` と `seo_task_claim` の入場制限は、コードが特定の40/40/20やsearch_visibility戦略を判定するのではなく、現在のpolicy.constraints.incidentGrowthIntakeに従う。
6. GitHub Actionsへの引き渡し、デプロイ実績、Search観測は従来と同様に持続し、Managerが次回の投資判断に利用する。

## 汎用的な資源配分

- `objective` : GSC clicks / GSC impressions / organic sessions、maximize / stabilize / restore。評価軸は明示的。
- `allocation.buckets[]` : 任意のID/説明/目標割合。合計100%、重複禁止。戦略が変わればカテゴリと比率をレコード更新するだけでよい。
- `risk` : リスク許容度・1run/1repo上限・案件ごとの最大effort units・独立案件分散の方針。自動的なGoogle評価を意味しない。
- `constraints` : incident categoryごとの許可/clearance必須、保護するSEO Task種類、Site Directionの人間判断、配送継続、品質・spam禁止。安全性の不変条件は変更可能な政策でも緩めない。
- `evaluation` : portfolio review / pilot / reallocation window。Googleのクロール期限と混同しない。
- `seo_portfolio_allocation_status` : 現在のready/issued/in_progressに割り当てられた**見積りeffort units**を政策bucketで集計する。作業実績時間でも効果測定でもない。割当てのないlegacy tasksをunknownとして可視化する。

**注意:** Managerはエージェントであり、APIが40/40/20を自動的に最適配分するわけではない。Managerが読み取って判断する。APIは入力妥当性・参照整合・インシデント入場制限を確実に守る。実成果に基づく投資判断はモデルの業務。

## 政策変更時

- 新revisionをaudited CAS（expectedRevision）で保存。40/40/20→保守路線、探索優先、品質回復等への切り替えで新Worker/新Plannerを作らない。
- 新規create/claimは**その時点の現行policy**を読む。旧タスクのpolicyRevisionAtCreationは履歴に固定され、過去の判断根拠を捏造しない。
- ready / issuedはManagerが新revisionで再検証し、必要なら優先順位やキャンセルを調整する。in_progress、branch_ready、pr_openのdeliveryを新政策のみを理由に自動削除しない。強い禁止事項なら専用レビュー。
- 大規模な方向転換、ドメイン統廃合、広範囲noindex、サイト停止は既存Site Directionの人間によるdecided gateを必ず保持する。
- 成果は実際のSearchデータとデプロイreceiptで判断し、unknownを0とみなさない。

## 正本の確認ポイント

- Scheduling: 実際に有効なChatGPT taskのタイトル/enable状態/起動プロンプト。定期ジョブが動く事実はタスク一覧で検証。
- Actor policy: `seo_agent_context(role=planner|executor)`。
- Macro policy: `seo_portfolio_policy_get` revision、`seo_portfolio_allocation_status`。一方の古いrepo文字列だけを正本とみなさない。
- Site actions: `seo_task_create/get/claim` の履歴とGitHubブランチ、中央配送receipt。
- Archived My Portal job: `manager_job_get(id=site-seo-operations)` の archived 状態。指示に従って過去Jobを再開しない。

サイトの役割・スケジュールが将来変わるときは、このレジストリを先に更新し、Policy／Run Contract／Manual／テストに同一のactor topologyが残るようにする。APIの `planner` / `executor` は過去クライアント用の互換名であり、現在アクターが複数いる証拠ではない。
