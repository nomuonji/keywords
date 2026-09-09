# Keywords Agent運用改善 — 完了記録

最終更新: 2026-09-09

## 目的

ユーザーがSEO工程をフォームで操作するのではなく、Agentに任せ、必要な判断と成果だけを見る構成にする。

今回の追加方針は **機能を足すより、重複を削ること**。

## 現在のプロダクト面

通常UI:

1. **運用** — Agentが何をしているか、keyword採否、最近の記事、公開後評価
2. **記事** — 記事を大量に検索・絞り込みし、1記事の選定理由から評価まで確認
3. **サイト** — 大量siteの状態と設定を要対応優先で確認

それ以外の旧工程別画面は削除した。

## Agentの正規フロー

```text
自然文依頼
 -> Operation
 -> discovery / evidence / triage
 -> article generation
 -> independent validation
 -> site build
 -> verified artifact
 -> delivery
 -> receipt
 -> evaluation
```

内部のdiscovery/planning/review等は能力として残すが、人間向けに独立操作画面を持たない。

## 観測要件

UIから必ず確認できるもの:

- Agentの作業対象site
- 現在stage
- blocker / next action
- 採用keyword
- 見送りkeyword
- 採用/見送り理由
- demand signal
- article title
- production/validation state
- publish state
- published evaluation
- improved/regressed/pending
- measured metrics / next evaluation action

## 大量データ要件

### Articles

- 50件単位server paging
- search
- site filter
- status filter
- collapsed rowが標準
- keyword reason / validation / outcomeは展開時だけ表示

### Sites

- sidebarへ全件を並べない
- search
- attention-first sort
- ON/OFF/attention filter
- article/published/evaluation/improved/regressedを1行集約
- Agent/settingsは展開表示

### Operations

- active/attention優先
- 全履歴をトップに流さない
- 必要な最新件数だけ表示

## 削除した旧表面

- Discovery workspace
- Keyword workspace
- Planning workspace
- Work/Review workspace
- Blog workspace
- SEO workspace
- Autopilot control room
- legacy Portfolio/Settings screens
- 旧UI専用types/CSS
- 旧画面用の低水準HTTP routes
- API background scheduler/fallback entry
- scheduler owner切替env

## 残した内部能力

- discovery
- keyword scoring/triage
- evidence
- planning
- review/policy
- article writer
- validator/build
- revision
- executor
- Blog handoff/receipt
- measurement/outcome

「処理を消す」のではなく「人間が内部工程を操作する余計な表面を消す」が原則。

## API

Agent public write laneは `/operations`。

人間向け観測は `/portfolio`、`/articles`、site/autopilot状態を中心にする。

APIはschedulerを持たず、persistent workerのみが定期実行する。

## 受入

2026-09-09 cleanup branch CI run #485で:

- runtime acceptance pass
- 全workspace typecheck pass
- production web build pass
- article search/paging pass
- keyword selection reason pass
- headless artifact/validator/revision/lease/cooldown/Blog tests pass

## 今後

新しい管理画面を増やす前に、実運用で以下だけを見る。

- Agentが止まる場所
- keyword選定の質
- 記事完成率
- publish成功率
- evaluation到達率
- improved/regressedの分布

必要性が実測できたものだけ追加する。
