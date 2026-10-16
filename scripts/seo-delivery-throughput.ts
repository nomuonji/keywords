/**
 * Bounded, shared delivery-controller throughput policy.
 * Keep permission/safety failures terminal; only recognized transport outages
 * should be retried automatically. This module is independent of Worker identity.
 */
export function transientDeliveryError(message: string): boolean {
  return /\bGitHub (?:408|409|429|5\d\d)\b|\b(?:ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNABORTED)\b|\b(?:fetch failed|socket hang up|network timeout)\b|GitHub 403[^\n]*(?:rate limit exceeded|secondary rate limit)/i.test(message);
}

/** GitHub computes PR mergeability asynchronously; false is a decision, null is not. */
export function retryMergeability(mergeable: boolean | null | undefined, attempt: number, limit = 3): boolean {
  return mergeable == null && attempt < limit;
}

/** Routine runs do not rescan 100 completed tasks and retry deleting old refs. */
export function cleanupSweepLimit(value: string | undefined): number {
  const n = Number(value ?? '0');
  return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.trunc(n))) : 0;
}

/** Rate-limit circuit breaker: do not amplify a 429 with error-history writes. */
export function firestoreRateLimited(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error
      && (error as { status?: number }).status === 429) return true;
  return /Firestore request failed \(429\)/.test(String(error));
}
