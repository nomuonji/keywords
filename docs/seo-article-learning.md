# SEO Article Learning Lab

**Purpose:** Train and evaluate *editorial judgment* using frozen real article bodies, not add another SEO score or claim to reverse-engineer Google's ranking systems. This is in `nomuonji/keywords`; Keywords Operator owns SERP/research evidence; Sites Operator owns URL Inspection and GSC evidence. No new server, Firestore reads/writes, scheduler, or auto-publishing.

## What is implemented

- `data/seo-article-lab/cases/batch-*.json`: source articles from our owned `nomuonji/chonmage-en` blog, full GitHub HEAD snapshots with exact source URLs, repo paths, Git blob SHAs, intended query and reader task.
- `data/seo-article-lab/outcomes/batch-*.json`: frozen exact-canonical URL Inspection observations, which side Google indexed, crawl/inspection timestamps.
- **16 initial article comparisons**: 6 training cases + 10 held-out cases. The **30 training / 10 held-out / 3 real page pilots** proposed target is NOT completed yet.
- Source article pages include entertainment/travel guides and artist biographies. All comparisons originate from one site. These initial observations are useful for calibration and tool debugging, **not** generalizable evidence of what Google prefers.
- Indexed vs crawled-but-not-indexed is **NOT** a valid expert editorial label. Many competing causes influence indexing (publication age, query demand, authority, links, canonical/crawl timing). Current GitHub source text is not verified as the revision last crawled by Google. All seed cases are marked `unverified_revision`. Never turn indexation into an article-quality score.

## Commands

Run with Node.js 22+ from repository root:

```
node scripts/seo-article-lab.mjs validate
node scripts/seo-article-lab.mjs list
node scripts/seo-article-lab.mjs prepare lab-train-01 > /tmp/editorial-prompt.md
node scripts/seo-article-lab.mjs submit lab-train-01 /tmp/prediction.json
node scripts/seo-article-lab.mjs reveal lab-train-01
node scripts/seo-article-lab.mjs report
npm run test:seo-article-lab
```

`prepare` includes both full article bodies and their *own* target queries but withholds URLs, GSC metrics, canonical observations and answer keys. Run predictions in an independent context that **does not read** the answer-key files; they live in a public repository, so the blind protocol is procedural, not a secret-store guarantee. Article A and B are balanced 50/50 by indexing observation. `submit` requires exact quoted text from A and B, a credible counterargument, missing evidence and a concrete editorial artifact; it records a case-hash and a sealed, non-overwritable prediction to local `.seo-article-lab-results/` (`SEO_LAB_RESULTS_DIR` can override). `reveal` opens training outcomes only **after** a sealed prediction. The 10 held-out outcomes remain locked until all holdout predictions are sealed. These controls prevent accidental feedback during an honest workflow, not adversarial access.

## Prediction format

```json
{
  "winner": "A",
  "confidence": "medium",
  "evidence": [
    {"side": "A", "quote": "exact passage of 12+ characters from source A", "reason": "explain reader benefit and evidence quality"},
    {"side": "B", "quote": "exact passage of 12+ characters from source B", "reason": "explain relevance, defect or missing information"}
  ],
  "counterargument": "The strongest reason that the other article might be preferable.",
  "proposedArtifact": "A verifiable table, calculation, tool or first-party finding with specific evidence.",
  "missingEvidence": "List official/primary sources and other facts required before editing."
}
```

## Agent learning loop

1. **Blind prediction:** Make a defensible editorial assessment, cite both article bodies, acknowledge insufficient evidence, identify a concrete improvement. Do not infer Google success from keyword coverage or length.
2. **Seal:** Submit before seeing outcomes. Hash binds the prediction to an immutable text snapshot; reusing the same article across train and holdout is rejected.
3. **Feedback:** Reveal *observed* indexing only on train. Compare prediction and outcome, explicitly separate reader utility from SEO/indexing and list confounders. Do not backfit an explanation to the result.
4. **Human-independent quality labels:** Have an independent reviewer, blind to indexation, evaluate factual accuracy, claims, genuine reader utility and differentiation with verified primary sources. Without these labels, outcome alignment does NOT show improvement in writing quality.
5. **True holdout:** Freeze the rubric/prompt *before* scoring held-out cases. Use a fresh evaluator context with no answer-key access; log all abstentions. Do not revise the grader after outcomes are unsealed.
6. **3 publication pilots (later):** For 3 existing URLs, make a *pre-publication* prediction and evidence-backed content artifact, run normal site approval/CI/publication flow, independently review rendered content, then separately observe Google recrawl, indexation and complete equal-length GSC windows. No pilot has been executed yet; do not assert ranking improvement or causal success without comparable controls.

## Expansion and integration

To reach the planned **30 train + 10 holdout**, add 24 genuinely independent training comparisons from other site types (books, qualifications, careers, tools etc.) with frozen full article bodies and verified observational provenance. Do not pad by permuting the same articles. Prefer pairs with matched intent/page types and known revision dates; seek independent editorial labels before updating any rubric. Keep both performance labels and editorial labels separate, including for false positives.

Sites Operator's `indexation_content_quality` and `content_incremental_value` gates remain authoritative. This lab supplements judgment rather than altering Planner/Worker delivery, task claiming, public URLs, or SEO allocation. The study cannot guarantee indexing or a top Search ranking. If evidence is absent, preserve `insufficient` rather than hallucinating a winner.
