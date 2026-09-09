# ヘッドレス記事生成 改善仕様 — 実装完了状態

最終更新: 2026-09-09

この文書は Keywords を、UI/API の常時操作なしで worker が記事成果物を生成・検証・再開できる実行基盤へ移行するための仕様と、その実装状態を示す正本である。

関連文書:

- [core-autonomy-audit.md](core-autonomy-audit.md)
- [agent-driven-operations-implementation-status.md](agent-driven-operations-implementation-status.md)
- [autonomous-seo-autopilot.md](autonomous-seo-autopilot.md)

## 結論

H1〜H8 のコード実装と、CI で再現可能な受入条件は完了した。

現在の生成完了条件は、単なる page plan / Agent の exit 0 / quality score ではない。記事制作 Operation は、実ファイル、artifact hash、source IDs、独立 validator、site build、manifest が揃わなければ complete できない。

また、Autopilot の publication authorization は verified local artifact がない状態では DB 境界でも作成できない。

2026-09-09 の CI run #441 では、runtime acceptance suite と domain/db/research/commands/api/cli/mcp/web の全 typecheck が成功した。runtime suite 内では headless artifact、validator cache、scheduler lease、executor cooldown、revision/no-progress、explicit pause、Autopilot handoff、Blog receipt idempotency、backup/restore、web production build まで通している。

## 実装済みアーキテクチャ

```text
 Human config / optional UI
            |
            v
   SQL + shared commands
      /             \
     v               v
Headless worker   API / MCP / CLI
     |
     v
Persistent Agent runtime
     |
     v
Blog working tree
  - atomic draft save
  - content hash
  - independent validator
  - site build
     |
     v
artifact manifest
     |
     +----> Operation local complete
     |
     +----> authorized Blog handoff (autoPublish only)
                   |
                   v
             idempotent receipt
```

UI は観測窓であり、記事生成の前提ではない。

## H1 — Scheduler single owner ✅

実装:

- persistent worker を既定 scheduler owner にした。
- API は `apps/api/src/entry.ts` を標準起動点とし、`KEYWORDS_AUTOPILOT_SCHEDULER_OWNER=api` を明示した場合だけ legacy API scheduler を有効化できる。
- public `@keywords/commands/autopilot` は lease wrapper を通す。
- manual/API tick も `headlessCommands.runAutopilotTick()` の project lease を取得する。
- `autopilot_state` に tick lease owner / expiry / start / finish を保存する。
- worker は `next_tick_at` を見て due project だけを tick する。

受入:

- 同一 project への同時 tick では1実行だけが lease を取得し、もう一方は `tick_locked` になる。

## H2 — Executor health / cooldown ✅

実装:

executor と site の障害を分離した。

executor 共通障害として分類するもの:

- provider rate limit / usage limit
- provider authentication failure
- executable missing / CLI bootstrap failure
- MCP bootstrap failure
- runtime mismatch
- provider outage / executor-wide network failure

executor は以下の状態を持つ。

- online
- busy
- cooldown
- unavailable
- offline

保存項目:

- failure class
- failure count
- cooldown until
- last error
- last failure at

cooldown 中は claim しない。共通障害によって複数 project を site blocked に増殖させない。

受入:

- provider rate-limit fixture 後の claim は `executor_cooldown` で拒否される。

## H3 — Artifact completion guard ✅

`operation_artifacts` を追加し、記事制作 Operation の実成果物を共有 SQL 状態へ接続した。

保存する主項目:

- operation / project / page / article ID
- artifact path
- content SHA-256
- source IDs
- validator version/status/result hash/result
- build command/status/result hash
- before/after hash
- manifest JSON
- revision key/count
- validation attempts
- no-progress count
- generated / verified / updated timestamps

`operation.complete` は content Operation の required artifact が verified でない場合に拒否する。

exit 0 でも artifact 不足なら `artifact_missing` または `quality_revision_required` として同じ Operation を再開する。

## H4 — Draft writer vertical slice ✅

`blog_writeDraft` / `headlessCommands.writeDraft()` を実装した。

保存手順:

1. Blog root 外への path traversal を拒否
2. temp file へ write
3. file handle sync
4. close
5. 同一 filesystem 内 rename
6. 最終 file hash を計算
7. artifact manifest を upsert

同じ Operation / article ID / content hash の再実行は同じ artifact identity を更新するため、再開で重複記事を作らない。

CI fixture は一時 Blog working tree に実 Markdown file を作成して検証する。

## H5 — Independent validator ✅

`blog_validateDraft` / `headlessCommands.validateDraft()` を実装した。

最低限の独立チェック:

- file exists / non-empty
- frontmatter
- page/article identity
- source-backed claim presence
- numeric/entity consistency
- reader-question coverage
- duplicate/cannibalization signal
- prohibited fabrication patterns
- link syntax / target checks
- site build command

validator の正本は Agent の自己採点ではなく、保存済み本文と保存済み source evidence である。

cache key は article content hash、source packet、validator version を含む revision key に結び付く。同一 revision key は再検査結果を再利用する。

## H6 — Revision state machine ✅

`packages/commands/src/revision.ts` と runner reconciliation を実装した。

挙動:

- `needs_edit` の page と artifact を同じ Operation に再接続する。
- 実行中 executor が所有している session は置換しない。
- 既存 revision session が running の場合は idempotently reuse する。
- 前回 revision が終了した後も content hash と gate fingerprint が変わらない場合だけ no-progress と数える。
- revision 上限 / no-progress 上限で human review boundary へ送る。
- quality revision では failed checks を引き継ぎ、全記事の新規 identity は作らない。

自動 resume allowlist:

- `quality_revision_required`
- `artifact_missing`

自動 resume しないもの:

- `site_dependency_failed`
- `executor_unavailable`
- `human_decision_required`
- `explicit_pause`
- `budget_exhausted`

CI では同じ revision session が二重生成されないこと、同じ本文＋同じ gate が no-progress boundary に到達すること、explicit pause が解除されないことを検証する。

## H7 — Blog delivery E2E boundary ✅

local complete と publication を分離した。

Autopilot handoff の条件:

- autonomy gate publish
- page approval
- verified local article artifact
- validator passed
- site build passed
- publication capacity available
- target origin / Blog binding valid

DB trigger `autonomous_handoff_requires_verified_artifact` により、`publication_authorized=true` の handoff を verified artifact なしで INSERT すること自体を拒否する。

Blog receipt は event ID / handoff ID / version hash で冪等化されている。同一 event の再送は duplicate として扱い、同じ event ID の内容衝突は拒否する。

published 遷移には HTTP status / canonical verification を含む publication evidence が必要で、応答喪失後の同一 receipt 再送でも二重 publish transition を作らない。

## H8 — Minimal article UI ✅

`ArticlesOverview` を追加し、主画面を成果物中心にした。

表示:

- 完成記事
- 制作中記事
- failed checks / revision count
- 要判断・停止理由
- blocker class
- executor status / cooldown

Operation / lease / run の低水準情報は主目的ではなく、記事成果物の監視を中心にしている。

## Worker lifecycle

`scripts/autopilot-runner.ts` の実行ループ:

1. executor register
2. executor health / cooldown確認
3. revision reconciliation
4. auto-resume可能 blocker のみresume
5. due projectをscheduler lease付きtick
6. revision reconciliation
7. claim-next
8. Agent process起動
9. heartbeat
10. artifact状態を照合してcomplete/incomplete判定
11. runtime consumedを保存
12. executor release
13. post-operation tick
14. revision reconciliation

SIGTERM / SIGINT:

- 新規claimを停止
- active AgentへSIGTERM
- runnerは新しい仕事を取らず終了方向へ進む
- crash時は既存lease expiryとartifact hashから同じOperationを再claimできる

## Secret boundary

- token / credential は process environment または既存 provider から読む。
- artifact manifestへsecretを保存しない。
- Agent promptにsecret値を展開しない。
- runnerの共通障害記録はerror summaryを対象とし、provider credentialそのものをDB正本にしない。

## Acceptance suite

CI runtime suiteで以下を継続実行する。

1. migration smoke
2. planning smoke
3. policy smoke
4. work-loop smoke
5. review smoke
6. operator smoke
7. agent-operations smoke
8. executor-selection smoke
9. autopilot smoke
10. headless-generation smoke
11. revision smoke
12. product workflow smoke
13. Blog integration smoke
14. portfolio smoke
15. backup / restore
16. web production build

Headless固有の確認:

- artifactなしのcomplete拒否
- atomic article write
- independent validator pass
- site build pass
- validator cache reuse
- verified artifactなしのauthorized handoff DB拒否
- executor cooldown claim拒否
- site blockerとexecutor blockerの分離
- scheduler tick lease
- revision session idempotency
- no-progress escalation
- explicit pause preservation
- Autopilot handoff前のartifact requirement
- Blog export/receipt idempotency

## Definition of Done

実装・CIで再現可能な自律記事生成条件:

- [x] workerで使う article writer が実ファイルへatomic saveする
- [x] sourceと本文の独立validatorがある
- [x] site build passがlocal complete条件
- [x] artifact manifestをSQLへ保存
- [x] artifact確認なしのOperation complete不可
- [x] workerを既定scheduler ownerに固定
- [x] manual/API tickも同じscheduler leaseを使用
- [x] executor common-failure cooldown
- [x] 同一Operation/article identityで中断後再開可能
- [x] validator resultをrevision keyでcache
- [x] explicit pause / human boundaryを自動resumeしない
- [x] 同一revision sessionを重複生成しない
- [x] 同一本文・同一gateの無限revisionをno-progress boundaryで停止
- [x] local complete後だけautonomous handoff可能
- [x] receipt再送を冪等処理
- [x] 上記をCIで再現

## 本番環境でのみ確認できる項目

以下はコード実装の未完ではなく、接続先・credential・実サイトを必要とする deployment verification である。この作業では本番サイトへの公開操作を実行していないため、事実として未確認のまま残す。

- [ ] 実運用 Blog repository / 実サイトでの1記事生成・build
- [ ] 本番 autoPublish site での実配信
- [ ] 実HTTP/canonical の配信後確認
- [ ] 実executor provider rate-limit発生時の長時間回復挙動
- [ ] 公開後の検索成果

これらを確認していなくても H1〜H8 の実装が欠けていることを意味しない。本番公開を伴うため、環境・権限・対象サイトを明示した運用試験として別に扱う。

## 運用設定

標準:

```text
KEYWORDS_AUTOPILOT_SCHEDULER_OWNER=worker
KEYWORDS_AUTOPILOT_SCHEDULER=0
KEYWORDS_BLOG_ROOT=<real blog working tree>
KEYWORDS_BLOG_BUILD_COMMAND=<site build command>
KEYWORDS_MAX_ARTICLE_REVISIONS=3
KEYWORDS_MAX_NO_PROGRESS_RETRIES=2
```

API schedulerをfallbackとして使う場合だけ:

```text
KEYWORDS_AUTOPILOT_SCHEDULER_OWNER=api
```

persistent workerとAPI schedulerを同時にprimary ownerとして運用しない。

## 状態

**H1 → H8: 実装済み。**

今後の作業は新しい実装フェーズではなく、本番接続先ごとのdeployment verification、運用品質計測、validatorルールの継続改善である。
