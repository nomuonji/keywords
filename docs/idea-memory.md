# Idea Memory

Keywords Operator owns idea and feedback records in its existing Firestore project. The new collections are `ideaMemory` and `ideaFeedback`; SEO theme candidates and scheduled site operations are unchanged.

## Chat workflow

Before market or site ideation, call `idea_memory_context` and `idea_memory_feedback_profile`, following their cursors if relevant, then call `idea_memory_search` for each serious candidate. A result marked `related_not_duplicate` may still be a new idea. A `near_duplicate` requires a clear difference, new dated evidence, or an explicit request to reconsider. Search is a bounded lexical and structural comparison, so review its reasons before claiming novelty.

After presenting ideas, send up to 50 materially distinct ideas per `idea_memory_batch_upsert` call with a stable `runId`. Each idea needs an audience, task, data unit (`entities`), information mechanism, and interaction. IDs may be supplied or derived from those structural fields. Use the same ID and run ID on retry. Repeating an unchanged batch adds no writes; a conflicting concurrent update fails the atomic commit and should be re-read before retrying. `status` can only be `unreviewed` on batch creation. The batch never asserts a user verdict.

Call `idea_feedback_append` with a unique `idempotencyKey` for each feedback event. Only `scope=specific_idea` accepts an `ideaId` and `statusAfter`; a direct user statement is required to change an idea verdict. Record whole-batch, research-quality, process, and presentation criticism under their own scopes. A market assessment is evidence, not a user preference. Events are append-only. Use `idea_memory_feedback_profile` to retrieve the newest events, with pagination for older history.

The earlier `market-idea-feedback` research session is read alongside the new collection. Its four previously presented ideas remain `unreviewed`; its three anti-pattern entries remain criticism of the proposal or exploration method. The live reader refers to those records directly, avoiding a second copy and preserving the existing ledger. New feedback can point at a legacy idea ID, while its event lives in `ideaFeedback`.

Search uses automatically indexed two-character normalized tokens to find at most 100 candidate documents, then compares titles, audience, task, data unit, structure and interaction. The token index adds no external service or paid embedding cost. Search responses expose the number examined and mark the query as bounded. Very large histories may require narrowing the candidate or paging context; the result is a review aid, not a proof that no similar idea exists.

Firestore 429 and transient 503 behavior follows the shared adapter's bounded retry policy. Do not retry quota exhaustion indefinitely or turn a failed write into a claimed saved result. Keep `market-idea-feedback` as the fallback for clients that have not refreshed their tool list.

## Agent pre-submission score: strict filtering without user homework (2026-10-16)

The My Portal canonical `idea-final-judge` Chat Skill owns the final pass/fail rubric. **Generate freely, judge before proposing, and present only passing ideas**. A failed idea is not quota-filling content and is not recorded as a presented idea. When no idea passes in a bounded run, persist continuation notes and report the exploration unfinished; never lower the quality threshold or mark zero qualified proposals as a success.

To preserve accountability, `idea_memory_batch_upsert` accepts an optional `agentReview` object on a **newly presented** canonical idea:

```json
{
  "rubricVersion": "idea-final-judge-v3",
  "assessedAt": "2026-10-16T00:00:00.000Z",
  "verdict": "pass",
  "axes": {"appeal": 5, "dbValue": 4, "seo": 3, "revenue": 2, "contentFeasibility": 5, "upkeep": 4},
  "requiredAxes": ["dbValue", "contentFeasibility", "upkeep"],
  "strongestObjection": "Short, concrete reason why this might fail",
  "passRationale": "Why the actual first experience overcomes that objection"
}
```

All six axes use the existing 1–5 scale; omit an unverified or inapplicable score rather than invent one. Appeal must be **5/5** and each explicitly required purpose-specific axis must be **4/5 or more**, or the structured self-score is rejected. Other noncompensatory criteria of the Judge Skill (specific first experience, real differentiation, feasible data/maintenance) still apply. `contentFeasibility` is distinct from ongoing `upkeep`: it measures copyright, image/video licenses, portrait/trademark and reuse permissions, access to primary material, work to create original content, and suitability for lawful automation (5=easy; 1=very difficult). Consider rights that cannot be secured a release blocker, not a low score to offset with traffic/revenue. Prior `idea-final-judge-v2` snapshots and historical five-axis feedback remain valid and unmodified; new submissions use rubric v3. The score is an **agent hypothesis**, not proof of demand, actual revenue, a human verdict, or an independent model review.

At initial idea registration, the supplied `agentReview` snapshot is stored with the idea and shown read-only in the Idea Review detail drawer (with a discreet indication in the list). Subsequent `idea_memory_batch_upsert` re-presentations **cannot overwrite or backfill** that snapshot; human review, outlet-specific verdicts and organization patches do not modify it. Older ideas without this field remain visibly unscored; never retroactively label an evaluation as pre-submission. The API field is optional for backward compatibility with existing MCP clients; until clients expose the refreshed schema, the chat Skill's gate remains the primary filter. Missing agentReview does **not** imply that a proposal was approved by the Judge. No extra collection or per-row Firestore reads are introduced.

**Human interaction stays minimal.** GOOD / ボツ / 保留 can be submitted directly from the list with one click. The existing optional human six-axis detail form remains available but is never required to evaluate ideas. Human rating events are separately append-only and are not silently treated as AI scores. Run-to-run calibration can use simple human verdicts; a detailed human grading chore is not a prerequisite.

## Tags, nonexclusive production destinations and derivative assets (v1.20)
The authoritative idea remains one `ideaMemory/{ideaId}` record. New optional fields:
- `tags: string[]` — freely chosen subject labels (up to 20, max 60 characters per tag)
- `destinations: string[]` — nonexclusive production/application outlet keys. Initial UI choices are `new_site_db`, `existing_site_growth`, `product_affiliate`, `traffic_distribution`, `product_business`, `social_content`, `youtube_video`. The service accepts extensible keys; the UI labels are defaults, not a permanent taxonomy.
- `assetRefs: {id,destination,kind,title,stage,owner,targetRef?,contentRef?}[]` — metadata/pointers for up to 40 derivative deliverables. `assetCount` is a cheap list-view projection. No scripts, videos or source code live inside this idea document. `proposed` does not mean created or published; `handed_off` requires targetRef, and actual delivery confirmation belongs to the destination owner.
- `revision` — optimistic-write version, already present in the idea model. Update organization with the `idea_memory_patch` MCP tool or authenticated Web `action=organize` POST. It accepts `ideaId`, `expectedRevision` and replacement `tags`, `destinations`, `assetRefs` arrays. Omitted fields remain unchanged. A rejected or liked verdict, initial presentation history, and external market observation are never mutated by this action.

Agent batch saves may provide initial tags/destinations, but existing manually curated tags and destinations take precedence on repeats. A derived asset may point to the originating idea while being implemented and evaluated in a specific production system. No route assignment creates an external post, file, video, A8 affiliation, or site publication.

The owner-only Ideas screen provides outlet filtering, tagging, multi-outlet assignment and pointer addition in the existing lazy-loaded detail dialog. Existing records without these fields render as unassigned and require no mass backfill. The summary API masks long `assetRefs` and includes only `assetCount`. Authentication, same-origin enforcement, field validation, revision checks and Firestore document preconditions apply to organization writes as to feedback.

Feedback `ideaFeedback` remains append-only. Newly captured optional UI score axes `{appeal,dbValue,seo,revenue,contentFeasibility,upkeep}` are saved as numeric 1–5 fields within the feedback event. Pre-existing text-only score histories remain unmodified and readable. These subjective idea ratings are distinct from market verification, content-quality judgements and subsequent SNS/YouTube analytics.

The outlet registry can gain future types without changing older idea IDs or creating destination-specific idea databases. The first phase implements typed reference links, **not** content production orchestration or automatic cross-operator writes. See GitHub Issue #208.

## Unified discovery workspace / outlet-specific evaluation (v1.21)
Four previously top-level screens (`?view=market` market observations, `?view=research` theme falsification ledger, `?view=structures` site designs, `?view=ideas` Idea Memory) now appear under one **発見・企画** navigation section, at `?view=discover&tab=ideas|market|research|structures`. Old URLs are backward-compatible entry points for each tab. The stores have not been merged blindly: observations, validation candidates and site page structures retain their owners, while the canonical idea, tags, human feedback and destination links live in `ideaMemory`.

Each assigned destination has a separate optional `ideaMemory.destinationVerdicts.{destinationKey}` human review status. `ideaFeedback` keeps an append-only event with optional `destination`; events without `destination` continue to mean an idea-wide verdict and keep updating `status`. An outlet event can only be created for a real destination on the idea by `direct_user` specific-idea feedback. It updates that outlet verdict and never overwrites the global `status`, another destination's verdict, the validation ledger or downstream actual publishing. On the owner screen, the seven destination tabs select which verdict the inline GOOD/ボツ/保留 buttons update; detail review offers an explicit "アイデア全体 / each assigned destination" selector. Historical all-idea feedback and legacy textual scores remain intact. The summary API includes only `destinationVerdicts`, not full feedback history.

Scheduled idea discovery has been switched at the existing ChatGPT automation to general-market observation, cross-outlet tagging and routing; scheduling cadence is unchanged. The automation is the owner of its prompt, not this GitHub repo. Future records use the existing `idea_memory_batch_upsert` initial `tags` / `destinations`, with `idea_memory_patch` as a revision-controlled update when available. Routing to a destination is a proposal and does not dispatch to Tweets, YouTube production, Affiliate approval or Sites execution.
