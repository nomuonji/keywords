// Only for the existing public, read-only browser projections. Never attach
// these headers to authenticated MCP, task claims, or mutation responses.
// Browsers revalidate; Vercel shares a bounded snapshot across viewers.
export const publicReadCacheHeaders = {
  'cache-control': 'public, max-age=0, must-revalidate',
  'vercel-cdn-cache-control': 'max-age=120, stale-while-revalidate=60'
};
