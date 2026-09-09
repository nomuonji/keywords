# 自律記事生成 コア監査

最終更新: 2026-09-09

## 結論

自律記事生成のコアは成立している。一方、前回実装後も旧UI・旧HTTP導線が大量に残り、コアを見えにくくしていたため cleanup を実施した。

今回の最終方針は明確に次の2点。

1. Agent の実行能力は残す。
2. 人間に内部工程を操作させる重複UI/APIは削除する。

## コアとして残すもの

- keyword discovery / triage
- source / evidence
- planning / brief
- article writer
- artifact manifest
- independent validator
- site build
- revision
- executor / cooldown
- worker scheduler / tick lease
- pause / human review
- Blog handoff / receipt
- measurement / outcome

これらは Agent が使う内部能力であり、独立した人間向け画面を必要としない。

## 削除したもの

### Web

旧独立画面を物理削除した。

- `AutopilotOverview.tsx`
- `BlogWorkspace.tsx`
- `DiscoveryWorkspace.tsx`
- `GovernanceWorkspace.tsx`
- `KeywordWorkspace.tsx`
- `OperationsHome.tsx`
- `PlanningWorkspace.tsx`
- `PortfolioWorkspace.tsx`
- `ReviewInbox.tsx`
- `SeoOperations.tsx`
- `SettingsWorkspace.tsx`
- `WorkSessions.tsx`
- 旧UI専用types/CSS

Webの正本は3画面と `core-ui.css` に縮小した。

### API

旧画面を直接操作する低水準HTTP routesを削除した。

削除対象には work/review/policy/research/keyword/planning/operator 等の画面直結経路を含む。

Agentのpublic write laneは `/operations` を正規経路とする。内部 commands/MCP は削除していない。

### Scheduler

API内background schedulerを削除した。

- API scheduler timerなし
- `apps/api/src/entry.ts` 削除
- `KEYWORDS_AUTOPILOT_SCHEDULER_OWNER` 等のfallback設定削除
- workerのみがscheduler owner

## 人間が見る情報

削減後も次は必ず目視できる。

### Agent activity

- 何を実行中か
- どのsiteか
- stage/status
- blocker
- next action
- executor接続状態

### Keyword decision

- keyword
- 採用 / 見送り / 保留 / 追加調査
- demand
- 選定理由
- 対象site

### Article

- title
- site
- main keyword
- selection reason
- 制作/検証状態
- validator/build
- revision count
- failed checks
- publication state
- post-publication evaluation

### Site

- article count
- verified/published count
- evaluation pending
- improved/regressed
- GSC click change
- Agent状態
- Autopilot / autoPublish

## 大量データへの表示方針

### Articles

全件を一度に読み込まない。

- server-side search
- site filter
- status filter
- 50件/page
- compact table row
- details展開

### Sites

全siteをsidebarに並べない。

- search
- attention-first sorting
- status filter
- compact row
- details展開

### Operations

トップには全履歴を出さない。

- active/attentionを優先
- Agent activityは上位12件
- keyword decisionsは直近12件
- articles/outcomesは直近10件
- 詳細は記事・site画面へ移る

## 生成完了条件

記事制作Operationは次が揃わなければcompleteできない。

- actual file
- content SHA-256
- source IDs
- validator pass
- site build pass
- before/after hash
- verified timestamp

Agent exit 0や企画承認だけではcompleteではない。

## Publication boundary

verified artifactなしのautonomous handoffはDB triggerでも拒否する。

Blog receiptは冪等化し、publishedにはHTTP/canonical evidenceを要求する。

## Resume boundary

自動resume対象:

- `quality_revision_required`
- `artifact_missing`

自動resumeしない:

- site failure
- executor unavailable
- human decision
- explicit pause
- budget exhaustion

同一本文・同一gateで進展がなければno-progress上限でhuman reviewへ移る。

## CI

cleanup branch CI run #485:

- runtime acceptance: pass
- 全8 workspace typecheck: pass
- web production buildを含む既存runtime suite: pass
- article search/paging: pass
- keyword selection reason: pass

## 最終判定

**コア機能: 維持。**

**重複UI/API: 削除。**

**観測可能性: Agent activity → keyword decision → article → publication outcome の流れに集約。**

本番siteへの実publishはdeployment verificationとして別扱い。
