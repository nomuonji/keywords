# 記事制作を中心にした自律実行監査 — 最終実装監査

最終更新: 2026-09-09

この文書は Keywords の自律SEO機能を「Operationが動くか」ではなく、**人間の通常操作なしで実記事成果物を安全に完成できるか**という基準で監査する。

実装仕様は [headless-generation-improvement.md](headless-generation-improvement.md) を参照する。

## 結論

前回監査でP0/P1として指摘した、headless記事生成を阻害するコード上の主要断絶は解消した。

現在は次が成立している。

- workerを既定scheduler ownerにしたsingle-owner運用
- manual/API tickを含むproject tick lease
- executor common failureのcooldownとsite failureの分離
- 実記事fileのatomic save
- artifact manifest / SHA-256
- Agent自己評価とは別のarticle validator
- site buildを含むlocal-complete gate
- artifactなしのOperation complete拒否
- verified artifactなしのautonomous handoffをDB境界で拒否
- blocker classごとのauto-resume allowlist
- revision sessionのidempotency
- same-content / same-gate no-progress boundary
- explicit pause / human decision boundaryの保持
- Blog handoff / receiptの冪等性
- 記事中心のUI
- persistent runnerのgraceful shutdownとruntime記録

2026-09-09 CI run #441 でruntime acceptance suiteと全workspace typecheckが成功した。

したがって、**「自律記事生成のコード実装は未完成」という前回結論は撤回する。**

ただし、本番Blog repositoryや実公開先への配信はこの実装作業では行っていない。これはコード未実装ではなく、対象site/credentialを必要とするdeployment verificationとして分離する。

## 監査範囲

確認対象:

- `packages/commands/src/headless.ts`
- `packages/commands/src/revision.ts`
- `packages/commands/src/executor.ts`
- `packages/commands/src/operation.ts`
- `packages/commands/src/autopilot.ts`
- `packages/commands/src/autopilot-locked.ts`
- `packages/commands/src/autonomy.ts`
- `packages/commands/src/review.ts`
- `scripts/autopilot-runner.ts`
- `scripts/headless-generation-smoke.ts`
- `scripts/revision-smoke.ts`
- `scripts/autopilot-smoke.ts`
- `scripts/blog-smoke.ts`
- `apps/api/src/entry.ts`
- `apps/web/src/ArticlesOverview.tsx`
- `.github/workflows/ci.yml`

## 指摘事項の最終状態

| 優先 | 旧指摘 | 最終状態 | 実装 |
|---|---|---|---|
| P0 | scheduler二重化 | ✅ 解消 | workerが既定owner。API標準entryはworker owner時にAPI schedulerを停止。public tickはSQL lease wrapperを通す。 |
| P0 | 成果物未確認のcomplete | ✅ 解消 | `operation.complete` がrequired artifactのverified状態を検査。exit 0だけではcomplete不可。 |
| P0 | executor共通障害のsite blocked化 | ✅ 解消 | failure classifier / cooldown / retry-afterをexecutorへ保存。cooldown中claimなし。 |
| P0 | 実記事縦通し未証明 | ✅ CI fixtureで解消 | 一時Blog working treeへ実Markdown fileを書き、validator/build/manifest/completeまで通す。 |
| P0 | 品質ゲートがAgent自己採点中心 | ✅ 公開境界を補強 | independent validator + build pass + DB triggerをpublication authorization必須条件にした。 |
| P1 | revise無限再採点 | ✅ 解消 | revision session reuse、content hash + gate fingerprint、no-progress上限、human escalation。 |
| P1 | 停止理由別resumeが粗い | ✅ 解消 | blocker classを永続化し、`quality_revision_required` / `artifact_missing` だけ自動resume。 |
| P1 | 実働予算/進展が弱い | ✅ 改善 | `runtime_consumed_ms`、last progress、artifact revision/attempt/no-progressを保存。 |
| P1 | executor状態表示が弱い | ✅ 改善 | Articles UIでrunnable/cooldown/failure class/retry時刻を表示。 |
| P1 | UIがOperation中心 | ✅ 解消 | 完成記事・制作中・要判断・executorを主画面化。 |
| P1 | runtime受入不足 | ✅ 解消 | executor-selection、headless、revision、explicit-pause、Blog idempotencyをCIへ接続。 |

## 生成完了の定義

記事制作Operationは次が揃ったときだけlocal completeになる。

1. article fileが存在しnon-empty
2. page/article identityが一致
3. content SHA-256がmanifestへ保存
4. required source IDsが保存される
5. independent validatorがpass
6. site buildがpass
7. before/after hashが保存される
8. verified timestampが保存される

page proposed、page approved、Agent process exit 0、handoff作成だけでは生成完了ではない。

## Scheduler監査

標準owner:

```text
KEYWORDS_AUTOPILOT_SCHEDULER_OWNER=worker
KEYWORDS_AUTOPILOT_SCHEDULER=0
```

API標準起動は `apps/api/src/entry.ts` を通る。ownerが`api`でなければAPI schedulerを停止する。

外部からimportする `@keywords/commands/autopilot` は `autopilot-locked.ts` を経由し、manual/API tickも `headlessCommands.runAutopilotTick()` のleaseを使用する。

CIでは同projectへ同時tickした際、1件が`tick_locked`になることを確認する。

## Executor障害監査

executor common failure:

- provider rate limit
- provider auth
- provider outage
- executable missing
- MCP bootstrap
- runtime mismatch
- executor-wide network failure

これらはexecutor cooldownへ送る。

site-specific failure:

- DNS/origin固有障害
- Blog binding不整合
- site build失敗
- site固有権限不足

これらだけをproject側blockerとして扱う。

CIではrate-limit後のclaimが`executor_cooldown`になることを確認する。

## Artifact / validator監査

記事保存はtemp→fsync→rename→hashの順で行う。

validatorは少なくとも次を独立検査する。

- file exists / non-empty
- frontmatter
- article/page一致
- source-backed claim
- numeric/entity consistency
- reader question coverage
- duplicate/cannibalization
- prohibited fabrication pattern
- link validation
- site build

validator resultはrevision keyでcacheされ、同じ本文を無意味に再検査しない。

## Revision / resume監査

blocker class:

- `quality_revision_required`
- `artifact_missing`
- `site_dependency_failed`
- `executor_unavailable`
- `human_decision_required`
- `explicit_pause`
- `budget_exhausted`

自動resume allowlistは最初の2つだけ。

revisionは同じOperation / article identityを維持する。running revision sessionがある場合は再利用し、終了後もcontent hashとgate fingerprintが同じならno-progressとして数える。上限に到達するとreview requestへ送る。

CIでは:

- live revision sessionの重複なし
- same content / same gateでno-progress escalation
- explicit pauseが解除されない

を確認する。

## Publication監査

Autopilotの`publication_authorized=true` handoffにはverified local artifactを必須とする。

アプリケーション層だけでなくDB triggerでも、validator/build未通過artifactしかないpageへのauthorized handoff INSERTを拒否する。

Blog receiptは同一event再送をduplicateとして受理し、同じevent IDで内容が変わるcollisionは拒否する。published transitionにはHTTP/canonical evidenceが必要。

## CI最終確認

run #441 runtime suiteで確認した主な結果:

- migration: pass
- planning: pass
- policy: pass
- work-loop: pass
- review: pass
- operator: pass
- agent operations: pass
- executor selection: pass
- autopilot artifact requirement: pass
- headless artifact / validator / cooldown / tick lease: pass
- revision / no-progress / explicit pause: pass
- product workflow: pass
- Blog lifecycle / receipt idempotency: pass
- portfolio: pass
- DB backup/restore: pass
- web production build: pass

workspace typecheck:

- domain: pass
- db: pass
- research: pass
- commands: pass
- api: pass
- cli: pass
- mcp: pass
- web: pass

## 残る確認事項

以下はコード監査上の未実装項目ではない。

- 実Blog repositoryを`KEYWORDS_BLOG_ROOT`へ接続した本番draft生成
- 本番site build
- autoPublish許可siteでの実公開
- 公開URLの実HTTP/canonical確認
- 実provider rate limitでの長時間cooldown復旧
- 公開後SEO成果

本番作用を伴うため、対象site、credential、publication policyを指定したdeployment verificationとして実施する。

## 最終判定

**コード実装: 合格。**

**CIで再現可能なheadless article generation: 合格。**

**本番外部siteへの実配信: この実装作業では未実施。**
