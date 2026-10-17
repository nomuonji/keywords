/**
 * Google URL Inspection may return transient 5xx/transport errors while other
 * URLs in the same scheduled sweep succeed. This classification changes only
 * the sweep's process exit code; failed URLs are never marked inspected.
 */
const GOOGLE_INSPECTION_5XX = /\bHTTP\s+(?:500|502|503|504)\s+from\s+https:\/\/searchconsole\.googleapis\.com\/v1\/urlInspection\/index:inspect\b/i;
const GOOGLE_TRANSPORT_FAILURE = /(?:the operation was aborted due to timeout|\btimed?\s*out\b|\btimeout\b|\bETIMEDOUT\b|\bECONNRESET\b|socket hang up|network connection (?:reset|closed))/i;
const NOT_GOOGLE_TRANSIENT = /(?:firestore|firebase|\bHTTP\s+(?:400|401|403|404|429)\b|invalid_grant|unauthorized|forbidden|permission denied|not configured|resource_exhausted|quota exceeded)/i;

export function isTemporaryGoogleInspectionFailure(
  error: string,
  source: 'url-inspection-result' | 'site-operation' = 'url-inspection-result'
): boolean {
  if (NOT_GOOGLE_TRANSIENT.test(error)) return false;
  if (GOOGLE_INSPECTION_5XX.test(error)) return true;
  // Per-URL failures returned by siteIndexationInspect are Google API reads.
  // A whole-site thrown exception might instead be a storage/network fault.
  return source === 'url-inspection-result' && GOOGLE_TRANSPORT_FAILURE.test(error);
}

export function classifyGoogleInspectionFailures(
  failed: number,
  reported: readonly { error: string }[]
): { transient: number; other: number; unreported: number } {
  const total = Math.max(0, failed);
  const inspected = reported.slice(0, total);
  const transient = inspected.filter(row => isTemporaryGoogleInspectionFailure(row.error)).length;
  return {
    transient,
    // The inspection API truncates failure details; missing details remain
    // visible as unclassified, not silently assumed to be temporary.
    other: total - transient,
    unreported: Math.max(0, total - inspected.length)
  };
}
