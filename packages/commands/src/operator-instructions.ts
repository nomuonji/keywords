/** Task-specific instructions are carried by the shared Operation, not private agent state. */
export function operatorInstructions(next: Record<string, unknown>) {
  const kind = String(next.kind ?? 'no_action');
  const observation = kind === 'capture_recovery';
  const measurement = ['capture_metrics','observe_outcome','blog_observation_due'].includes(kind);
  const inventory = kind === 'sync_site';
  const recovery = kind === 'recover_existing_page';
  const objective = `${String(next.title ?? kind)}. ${String(next.reason ?? '')}`.slice(0, 1000);
  const common = 'Read work_context, policy_context and operation_context. Respect existing pauses, human reviews, scoped new-content clearance and action budgets. Never invent experience, measurements, citations, publication or Google quality verdicts. Never delete pages, move URLs, change DNS or activate policy rules.';
  const instructions = observation
    ? 'Call recovery_context, then recovery_capture. The command selects a stable cohort, discovers the matching Search Console property if needed, and persists URL inspections and 21 complete days. Read the returned recovery state and record the next observation date. This is a measurement-only operation; no page plan or article is required.'
    : inventory
    ? 'Call site_sync. Use the previously successful sitemap or robots.txt discovery when the default sitemap is absent. Preserve previous observations on network failure or truncated import. This is an inventory operation; do not create a page plan or article.'
    : measurement
    ? 'Read the persisted outcome/handoff and measurement context. Capture comparable complete periods for the bound origin, preserving source IDs and the publication date. Use blog_evaluate for a Blog handoff. Small samples are inconclusive, with a future observation date. Do not invent a result or create an article for this measurement operation.'
    : recovery
    ? `Read recovery_context and source ${String(next.observationSourceId ?? '')}. Inspect the actual existing page ${String(next.targetUrl ?? next.relatedId ?? '')}, its mapped local source and relevant first-party evidence. Determine the concrete reason the page does not satisfy its reader task. Use existing_page_improvement with targetPageId=${String(next.relatedId ?? '')}; keep the URL. Write and validate any article change through blog_writeDraft/blog_validateDraft and the site's real build. If a change is not justified, persist an insight linked to the observation explaining why. Do not create filler, an unmapped Markdown article, or a new keyword page. Structural changes outside the article adapter require an explicit reviewable proposal. Record a hypothesis and a pending outcome for an actual change; local validation is not publication or SEO recovery.`
    : 'Gather evidence that can change the decision, then make the smallest justified improvement. For content, read blog_contract, prepare the evidence brief, write the actual mapped artifact with blog_writeDraft and verify with blog_validateDraft and the real site build. A page plan alone is not completion. Read recovery_context before proposing expansion. Record the next measurable condition.';
  return { objective, instructions: `${common}\n\n${instructions}`, measurementOnly: observation || measurement || inventory,
    completionCriteria: observation ? ['Persist the fixed-cohort recovery observation through recovery_capture.', 'Keep incomplete/API failure results distinct from zero visibility.', 'Record the next observation date.']
      : inventory ? ['Persist a successful same-origin sitemap inventory through site_sync.', 'Do not treat a local snapshot as live publication.']
      : recovery ? ['Persist a validated existing-page improvement or a source-linked no-change finding.', 'Keep the target URL and record the next measurable condition.']
      : ['Persist the evidence and the result appropriate to this operation.', 'Verify any article change with its real site build before completion.', 'Record a measurable next condition.'] };
}
