/**
 * Best-effort wakeup only. The persisted SEO Task is the source of truth.
 * GitHub receives an opaque ID and revision, never source text or secrets.
 */
export async function dispatchSeoDelivery(taskId: string, revision: number): Promise<void> {
  const token = process.env.SEO_DELIVERY_DISPATCH_TOKEN?.trim();
  if (!token) {
    console.warn('SEO delivery dispatch disabled: SEO_DELIVERY_DISPATCH_TOKEN is unset; cron will recover the checkpoint.');
    return;
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Invalid SEO delivery dispatch identity');
  }
  try {
    const response = await fetch('https://api.github.com/repos/nomuonji/keywords/dispatches', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28'
      },
      body: JSON.stringify({
        event_type: 'seo_push_pending',
        client_payload: { task_id: taskId, revision }
      })
    });
    if (response.status !== 204) {
      console.warn(`SEO delivery dispatch failed (HTTP ${response.status}); persisted checkpoint remains for cron recovery.`);
      return;
    }
    console.log(`SEO delivery dispatch accepted for Task ${taskId} revision ${revision}.`);
  } catch (error) {
    console.warn(`SEO delivery dispatch transport failed (${error instanceof Error ? error.name : 'unknown'}); checkpoint remains for cron recovery.`);
  }
}
