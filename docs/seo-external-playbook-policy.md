# External SEO Playbook Policy

This document records how external SEO playbooks may be used by the Sites Operator planning flow.
It is a **reference policy**, not a second planner, audit router, evaluator registry, or permission
grant.

## Evidence precedence

When an external playbook conflicts with stronger evidence, use this order:

1. current primary search-engine / regulator documentation for the relevant date and jurisdiction;
2. target-language and target-market SERP, Search Console / analytics, and current production state;
3. the site's own measured experiments and durable optimization history;
4. multiple independent practitioner observations;
5. a single external playbook.

External playbooks are hypotheses and checklists, never hidden ranking rules.

## Locale and jurisdiction

Every imported idea must be treated as one of:

- `universal`: mechanical or measurement principles that are not meaningfully language-specific;
- `en`: supported only for English-language / English-market use;
- `ja`: supported only after Japanese-language / Japanese-market validation;
- `locale-sensitive`: titles, snippets, intent, CTR, SERP features, wording, and page format; verify
  against the actual target country/language SERP and site data;
- `jurisdiction-sensitive`: law, affiliate disclosure, licensed advice, privacy, accessibility;
  verify the actual jurisdiction and current official source before use;
- `rejected`: contradicted by stronger evidence, insufficiently supported, or harmful duplication
  of the current operating system.

Never transfer an English-market heuristic to Japanese content merely because it appears in a
third-party SEO checklist.

## When to consult a reviewed playbook

Do **not** run an external playbook on every Planner cycle. Consult one only when the observed
problem matches it:

- search traffic drop -> traffic-drop diagnosis;
- crawl/indexing/canonical/sitemap issue -> indexing/crawl diagnosis;
- URL/domain/platform migration or consolidation -> migration safety;
- pages already ranking but under-earning clicks -> CTR/snippet diagnosis;
- a concrete internal-link graph gap -> internal-linking review;
- volatile facts becoming stale -> freshness review;
- backlink/manual-action concern -> backlink review;
- a body correction may leave factual claims in title/meta/H1/FAQ stale -> protected-field review.

The playbook may supply questions or failure modes to check. It may not replace the current
Sites Operator task/evaluator rules or create audit-only Worker work.

## SEOO Skill Pack v1.0.0 review

Source: https://www.seoo.tools/ (local pack reviewed 2026-10-02).

### Principles accepted into the reference layer

- prefer current primary sources for checkable factual claims;
- distinguish confirmed observations from inference;
- preserve baselines, intervention history, and re-check criteria;
- avoid stacking changes when causal attribution matters;
- do not preserve false claims merely because SEO fields are considered sensitive;
- flag uncertainty instead of filling it with an invented fact.

Use existing Sites Operator / Keywords Operator records for these principles; do not create a
parallel SEOO log/database.

### Conditional playbooks retained after modification

- `backlink-profile-audit`: retain caution around automated toxic scores and disavow. Do not
  treat foreign-language links as spam merely because of language. Re-check Google's current
  disavow requirements.
- `content-freshness-audit`: useful for pages containing time-varying facts; cadence follows
  fact risk/value rather than a uniform schedule.
- `ctr-snippet-optimization`: retain site-relative CTR comparison, live target-locale SERP review,
  small reversible pilots, and outcome measurement. Position bands and time windows are heuristics.
- `indexing-crawl-health-audit`: retain layered diagnosis of robots/noindex/canonical/sitemap/
  status/rendering. Re-check current Google/Bing documentation.
- `internal-linking-audit`: retain graph/orphan/tier-gap/backfill checks. Do not treat generic
  "link authority" language or a universal minimum-link count as a fact.
- `protected-field-audit`: retain factual-consistency checks after body changes.
- `site-migration-safety`: retain baseline, redirect map, rollback, staging diff, and post-launch
  observation; re-check engine-specific current requirements.
- `traffic-drop-diagnosis`: retain measurement -> onset -> broad/narrow -> own-site/external
  sequence; choose metrics according to the failure mode rather than declaring one metric
  universally sufficient.
- `verify-primary-source`: retain primary-source/date logging; allow multiple authoritative
  sources when jurisdiction, effective date, tier, or issuer differs.

### Reference only / superseded by the current system

- `change-and-decision-log`: principle already covered by durable Sites Operator / My Portal
  records; no additional parallel log.
- `content-opportunity-discovery`: near-miss and structural-gap ideas are useful, but Keywords
  Operator's observation/body-research/falsification ledger remains canonical.
- `seo-growth-stage-strategy`: coverage-versus-optimization is a discussion lens, not a mandatory
  gate and not an automatic "small site = publish more" rule.
- `seo-health-monitoring`: do not build a second monitoring system; current compact planning
  digest / experiment loop remains canonical.
- `site-audit-orchestrator`: never use as a router in production; Sites Operator already owns
  orchestration.

### Excluded from normal SEO planning

- `legal-regulatory-compliance`: jurisdiction-specific legal work is not a default SEO audit.
  Do not default an unknown jurisdiction to US FTC/WCAG. Research the actual jurisdiction and
  current official rules when the content genuinely raises that issue.

### Must be rewritten before operational use

- `duplicate-intent-audit`: reject the claim that duplicate intent itself is what Google's
  scaled-content-abuse policy targets. Use semantic/entity clustering only to find candidates,
  then verify with target-locale SERP overlap, query data, current page value, and redirect/
  canonical consequences.
- `page-quality-audit`: keep factuality, real user value, and no fabricated expertise. Do not
  treat site-level AI disclosure as a general Google SEO requirement, and do not equate a
  restated public table automatically with scaled-content abuse.
- `technical-seo-audit`: separate official requirements from practitioner heuristics. Do not
  use 50-60 characters / fixed pixel widths, exactly one H1, strict heading nesting, or
  "semantic variants signal topical depth" as Google ranking rules.
- `content-creation-standards`: reuse only the parts compatible with current
  `content_incremental_value` and factuality policies; do not add a second blocker checklist.

## Current primary-source corrections captured during review

As of 2026-10-02:

- Google's scaled-content-abuse policy is about generating many pages primarily to manipulate
  rankings, generally with little value/originality; duplicate intent alone is not the definition.
- Google's generative-AI guidance focuses on accuracy, quality, and relevance. Explaining how
  content was created can provide context; a blanket site-level AI disclosure is not stated as a
  general SEO requirement.
- Google does not publish a fixed title character limit; title links are shortened as needed,
  typically to fit the device width.
- Google's disavow tool is advanced and unnecessary for most sites; it is intended for substantial
  spam/artificial/low-quality link situations that caused, or are likely to cause, a manual action.

Re-verify time-sensitive details from primary sources when actually applying a playbook.
