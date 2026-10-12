/** Split one Search Console property's remaining URL Inspection budget fairly. */
export function inspectionSlice(remaining: number, unvisitedSites: number, maxPerSiteCall: number) {
  if (!Number.isInteger(remaining) || remaining < 0) throw new Error('Invalid remaining budget');
  if (!Number.isInteger(unvisitedSites) || unvisitedSites < 1) throw new Error('Invalid unvisited site count');
  if (!Number.isInteger(maxPerSiteCall) || maxPerSiteCall < 1 || maxPerSiteCall > 50) {
    throw new Error('Invalid per-call cap');
  }
  return Math.min(maxPerSiteCall, Math.ceil(remaining / unvisitedSites));
}
