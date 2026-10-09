/** GitHub's default squash message can inherit a Worker preview-skip marker.
 * Main commits must not carry that marker or Cloudflare Pages may skip production. */
export function seoDeliveryMergePayload(
  task: { id: string; title: string; siteId: string },
  headSha: string,
  method: 'squash' | 'merge' | 'rebase'
) {
  if (method === 'rebase') {
    throw new Error('SEO centralized production delivery requires a merge/squash method that can set a clean main commit message. Rebase may preserve [CF-Pages-Skip] from the Worker preview commit.');
  }
  const title = task.title.replace(/\[CF-Pages-Skip\]/gi, '').replace(/\s+/g, ' ').trim();
  const payload = {
    sha: headSha,
    merge_method: method,
    commit_title: `[SEO] ${title.slice(0, 175)}`,
    commit_message: `Sites Operator implementation task: ${task.id}\nSite: ${task.siteId}\nPublish this validated change on the default branch. Preview-only skip markers are deliberately excluded.`
  };
  if (JSON.stringify(payload).includes('[CF-Pages-Skip]')) {
    throw new Error('Main merge message unexpectedly contains Cloudflare preview-skip marker.');
  }
  return payload;
}
