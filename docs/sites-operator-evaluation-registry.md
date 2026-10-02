# Sites Operator SEO Evaluation Registry

The Sites Operator evaluation registry stores **versioned operating hypotheses used to make SEO decisions**. It is not a reconstruction of Google's ranking algorithm and it must not be treated as one.

Canonical implementation:

- `packages/commands/src/seo-evaluation-registry.ts`
- MCP reads: `seo_evaluator_list`, `seo_evaluator_get`
- Planner bootstrap: `seo_agent_context(role=planner)`
- Durable task reference: optional `evaluation` on `seo_task_create`

## Epistemic model

Keep these layers separate:

1. **Evidence** — primary Google policy/guidance, research, secondary analysis, or internal observations.
2. **Inference** — what Sites Operator provisionally concludes from that evidence.
3. **Evaluator** — the operational decision rule, hard gates, qualitative signals, anti-metrics, falsification conditions, and review triggers.
4. **Decision record** — a specific SEO task may store the exact evaluator ID/version, source IDs, confidence, and case-specific inference that supported the decision.
5. **Outcome** — optimization and analytics records later test whether the operational assumption remains useful.

An evaluator is deliberately falsifiable. A later policy update or portfolio outcome can justify a new evaluator version without rewriting the history of decisions made under an older version.

## Source hierarchy

Use source strength explicitly.

- **Primary Search policy / official Search guidance:** strongest source for what Google publicly prohibits or recommends.
- **Google or other relevant research:** useful evidence about possible detection/abuse-analysis approaches, but not proof that the same mechanism is used in Search.
- **Secondary reporting / analysis:** context only unless independently confirmed.
- **Internal observations / experiments:** evidence about our portfolio, not proof of Google's causal mechanism.

When sources conflict, do not silently average them. Preserve the conflict and lower confidence until stronger evidence resolves it.

## No composite score

Do not reduce the registry to a single SEO score.

- hard gates may block a decision;
- softer signals remain qualitative;
- metrics are evidence, not the objective by themselves;
- article count, word count, task count, and publishing velocity are not success metrics.

The mission remains sustainable organic traffic growth. Evaluators exist to stop local task-generation pressure from replacing that mission.

## Initial evaluators

### `content_incremental_value@1.0.0`

Active content decision gate.

Core inference: Google Search policy focuses on scaled low-value/search-manipulation behavior while official guidance does not prohibit useful AI-assisted content. Sites Operator therefore requires a concrete incremental user-value thesis for new or substantially expanded content.

Primary evidence:

- Google Web Search spam policies — scaled content abuse
- Google Search guidance about AI-generated content

This is an internal operational mapping of public policy, not a claim that "incremental value" is a literal ranking factor.

### `database_indexation_quality@1.0.0`

Active database/programmatic indexation gate.

Core inference: the underlying dataset and the Search-facing URL surface are separate products. A structured site may contain many records while exposing only the page families that satisfy a recurring user need and add distinct utility. Raw internal-link count or database-backed architecture is not treated as a penalty signal by itself; the evaluator instead checks what those links expose, whether faceted/filter routes create duplicate or unbounded URL spaces, and whether sitemap/robots/canonical/internal-link behavior matches the intended indexable set.

Primary evidence:

- Google Crawling Infrastructure — faceted navigation guidance
- Google Search Central — URL canonicalization
- Google Crawling Infrastructure — crawl budget guidance
- Google Search Central — internal-link/site-structure guidance
- Google Web Search spam policies — scaled content abuse

Important limitation: this is an internal synthesis of public crawl/index guidance, not a claim that Google has a single "database quality" ranking factor or a universal page/link-count threshold.

### `scaled_content_operation_risk@1.0.0`

Experimental portfolio-risk lens.

Core inference: operation-level patterns may be relevant to abuse detection, so cross-site templating, semantic overlap, and synchronized high-volume production are worth monitoring when they coincide with low user value.

Important limitation: the 2026 SAFE research concerns adversarial synthetic media and coordinated channel abuse. It does **not** establish that SAFE is a Google Search ranking/spam component. Search Engine Journal's connection to the September 2026 spam update remains secondary-source interpretation. This evaluator therefore cannot block a task by itself.

## Task provenance

When an evaluator materially informs a new task, persist:

```json
{
  "evaluation": {
    "evaluatorId": "content_incremental_value",
    "evaluatorVersion": "1.0.0",
    "decision": "proceed",
    "confidence": "medium_to_high",
    "evidenceSourceIds": [
      "google_scaled_content_policy",
      "google_ai_content_guidance"
    ],
    "inference": "The target answers a distinct observed intent and adds a primary-source comparison not present in the existing portfolio."
  }
}
```

The task's ordinary `evidence` field still contains target-specific facts. The `evaluation` object records the **decision framework provenance**, not a duplicate of page evidence.

Rejected candidates do not need fake tasks merely to create provenance. Planner reports should cite the evaluator/reason when a candidate is rejected; a separate durable decision ledger can be added later if rejected-decision history becomes operationally valuable.

## Versioning rules

Create a new evaluator version when its decision rule, hard gates, source interpretation, or falsification conditions materially change.

Do not mutate the meaning of an old version after tasks have referenced it. Mark the previous version non-current and add the replacement.

Review is triggered by:

- material Google Search policy changes;
- new primary evidence about Search enforcement;
- relevant Google abuse/research publications;
- sustained portfolio outcomes that contradict the current operational inference;
- evidence that agents are gaming evaluator wording rather than improving user value.

## Current source set

The registry currently includes:

- https://developers.google.com/search/docs/essentials/spam-policies#scaled-content
- https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
- https://developers.google.com/crawling/docs/faceted-navigation
- https://developers.google.com/search/docs/crawling-indexing/canonicalization
- https://developers.google.com/crawling/docs/crawl-budget
- https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure
- https://research.google/pubs/the-synthetic-gap-automating-forensic-investigation-of-ai-slop-with-the-scaled-abuse-forensics-examiner-safe/
- https://www.searchenginejournal.com/google-has-deployed-a-new-ai-spam-detector-called-safe/590918/

Each source is stored with its source type, strength, supported claims, caveats, and checked date inside the canonical registry.
