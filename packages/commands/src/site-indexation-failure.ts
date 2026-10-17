/**
 * URL Inspection observations are best-effort external API reads.
 * A transient Google response must not invalidate successful observations
 * from other sites or turn the entire scheduled sweep red. The failed URL
 * stays due because siteIndexationInspect only persists successful results.
 */
export function isTransientIndexationFailure(message: string): boolean {
  const value = message.toLowerCase();
  // Firebase/Firestore failures are operational faults, not Google flakiness.
  if (/firestore|resource_exhausted/.test(value)) return false;
  // Do not hide permission/configuration errors.
  if (/\b(400|401|403|404)\b|permission denied|not configured|invalid_grant|unauthorized|forbidden/.test(value)) return false;
  return /\b(?:429|500|502|503|504)\b|internal error encountered|temporarily unavailable|service unavailable|timeout|timed out|aborted due to timeout|etimedout|econnreset|socket hang up|fetch failed|network.*(?:reset|timeout)/.test(value);
}

export function classifyIndexationFailures(failures: readonly { error: string }[]) {
  let transient = 0;
  for (const item of failures) {
    if (isTransientIndexationFailure(item.error)) transient++;
  }
  return { transient, permanent: failures.length - transient };
}
