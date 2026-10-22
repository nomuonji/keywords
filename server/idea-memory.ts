import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { recordDelete, treasuryPrune, treasuryDeleteSelected } from '../packages/commands/src/delete-records.js';
import { ideaFeedbackAppend, ideaMemoryFeedbackProfile, ideaReviewDetail, ideaReviewList, ideaMemoryPatch } from '../packages/commands/src/idea-memory.js';

const app = new Hono();
const cookieName = 'keywords_idea_review';
const sessionSeconds = 7 * 24 * 60 * 60;
const adminSecret = () => (process.env.IDEA_REVIEW_ADMIN_TOKEN || process.env.KEYWORDS_REMOTE_MCP_TOKEN || '').trim();

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function makeSession(expires: number, secret: string): string {
  const content = String(expires);
  return content + '.' + createHmac('sha256', secret).update('idea-review:' + content).digest('base64url');
}
function cookie(request: Request): string {
  return (request.headers.get('cookie') || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
}
function authenticated(request: Request): boolean {
  const secret = adminSecret();
  if (!secret) return false;
  const stored = cookie(request);
  const [expireText, sig, extra] = stored.split('.');
  const expires = Number(expireText);
  if (!expireText || !sig || extra || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  return equals(stored, makeSession(expires, secret));
}
function cookieHeader(request: Request, value: string, seconds: number): string {
  return cookieName + '=' + value + '; HttpOnly; SameSite=Strict; Path=/api/theme-research; Max-Age=' + seconds
    + (new URL(request.url).protocol === 'https:' ? '; Secure' : '');
}
function safeError(error: unknown): { error: string; status: 400 | 409 | 503 } {
  const status = Number((error as { status?: number })?.status);
  if (status === 404) return { error: 'アイデアが見つかりません。', status: 400 };
  if (status === 409 || (error instanceof Error && /precondition/i.test(error.message))) {
    return { error: 'ほかの更新と競合しました。再読み込みして再評価してください。', status: 409 };
  }
  if (error instanceof Error && (error.name === 'ZodError' || /validation/i.test(error.message))) {
    return { error: '評価入力に誤りがあります。', status: 400 };
  }
  return { error: 'Idea Memoryへの接続に失敗しました。時間を置いて再試行してください。', status: 503 };
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return typeof origin === 'string' && origin === new URL(request.url).origin;
}
function boundedInt(input: string | undefined, fallback: number, max: number): number {
  const n = Number(input);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
}

app.get('/api/theme-research', async (c, next) => {
  if (!['idea-session', 'idea-inbox', 'idea-detail', 'idea-feedback'].includes(c.req.query('resource') ?? '')) return next();
  if (c.req.query('resource') === 'idea-session') {
    return c.json({ authenticated: authenticated(c.req.raw), configured: !!adminSecret() },
      200, { 'cache-control': 'no-store' });
  }
  if (!authenticated(c.req.raw)) return c.json({ error: '認証が必要です。' }, 401);
  try {
    if (c.req.query('resource') === 'idea-feedback') {
      const result = await ideaMemoryFeedbackProfile({ limit: boundedInt(c.req.query('limit'), 100, 100),
        cursor: c.req.query('cursor') || undefined });
      return c.json({ events: result.events, nextCursor: result.nextCursor }, 200, { 'cache-control': 'no-store' });
    }
    if (c.req.query('resource') === 'idea-detail') {
      const ideaId = c.req.query('id') || '';
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(ideaId)) return c.json({error:'アイデアIDが不正です。'}, 400);
      const item = await ideaReviewDetail(ideaId);
      return item ? c.json(item, 200, {'cache-control':'no-store'}) :
        c.json({error:'指定したアイデアが見つかりません。'}, 404);
    }
    const result = await ideaReviewList({
      limit: boundedInt(c.req.query('limit'), 60, 100),
      cursor: c.req.query('cursor') || undefined,
      summary: c.req.query('summary') === '1'
    });
    return c.json(result, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    const reason = safeError(error);
    return c.json({ error: reason.error }, reason.status);
  }
});

app.post('/api/theme-research', async c => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: '不正なリクエストです。' }, 403);
  let input: Record<string, unknown>;
  try {
    input = await c.req.json<Record<string, unknown>>();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('bad body');
  } catch { return c.json({ error: 'JSON形式が不正です。' }, 400); }
  if (input.action === 'login') {
    const secret = adminSecret();
    if (!secret) return c.json({ error: '管理者用の認証キーがサーバーに設定されていません。' }, 503);
    const password = typeof input.password === 'string' ? input.password : '';
    if (!password || !equals(password, secret)) return c.json({ error: '認証キーが正しくありません。' }, 401);
    const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
    c.header('Set-Cookie', cookieHeader(c.req.raw, makeSession(expires, secret), sessionSeconds));
    c.header('Cache-Control', 'no-store');
    return c.json({ authenticated: true });
  }
  if (input.action === 'logout') {
    c.header('Set-Cookie', cookieHeader(c.req.raw, '', 0));
    return c.json({ authenticated: false }, 200, { 'cache-control': 'no-store' });
  }
  if (!authenticated(c.req.raw)) return c.json({ error: '認証が必要です。' }, 401);
  if (input.action === 'delete-record' || input.action === 'prune-keywords' || input.action === 'delete-selected-keywords') {
    try {
      const result = input.action === 'delete-record'
        ? await recordDelete({kind:input.kind,id:input.id,expectedLabel:input.expectedLabel,...(input.expectedRevision===undefined?{}:{expectedRevision:input.expectedRevision})})
        : input.action === 'delete-selected-keywords'
          ? await treasuryDeleteSelected({targets:input.targets,...(input.expectedDeleteCount===undefined?{}:{expectedDeleteCount:input.expectedDeleteCount})})
          : await treasuryPrune({keepKeywords:input.keepKeywords,...(input.expectedDeleteCount===undefined?{}:{expectedDeleteCount:input.expectedDeleteCount})});
      return c.json(result,200,{'cache-control':'no-store'});
    } catch (error) {
      const status=Number((error as {status?:number})?.status);
      if (status===400 || status===404 || status===409) return c.json({error:(error as Error).message},status);
      const reason=safeError(error);return c.json({error:reason.error},reason.status);
    }
  }
  if (input.action === 'organize') {
    try {
      // Same auth / same-origin boundary as feedback; no public metadata mutation.
      const result = await ideaMemoryPatch({
        ideaId: input.ideaId, expectedRevision: input.expectedRevision,
        ...(input.tags === undefined ? {} : {tags: input.tags}),
        ...(input.destinations === undefined ? {} : {destinations: input.destinations}),
        ...(input.assetRefs === undefined ? {} : {assetRefs: input.assetRefs})
      });
      return c.json(result, 200, {'cache-control':'no-store'});
    } catch (error) {
      const reason = safeError(error);
      return c.json({error: reason.error}, reason.status);
    }
  }
  if (input.action !== 'review') return c.json({ error: '不明な操作です。' }, 400);

  const statusByRating = {
    good: { status: 'liked', polarity: 'positive', label: 'GOOD' },
    reject: { status: 'rejected', polarity: 'negative', label: 'ボツ' },
    hold: { status: 'deferred', polarity: 'neutral', label: '保留' },
    reset: { status: 'unreviewed', polarity: 'neutral', label: '未評価に戻す' }
  } as const;
  const rating = typeof input.rating === 'string' && input.rating in statusByRating
    ? statusByRating[input.rating as keyof typeof statusByRating] : null;
  const ideaId = String(input.ideaId ?? '');
  const idempotencyKey = String(input.idempotencyKey ?? '');
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  const destination = typeof input.destination === 'string' ? input.destination : '';
  if (destination && !/^[a-z][a-z0-9_-]{1,59}$/.test(destination)) {
    return c.json({error:'評価する展開先が不正です。'},400);
  }
  if (!rating || !/^[a-zA-Z0-9_-]{1,100}$/.test(ideaId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(idempotencyKey) || comment.length > 1000) {
    return c.json({ error: '評価内容が不正です。' }, 400);
  }
  const axes = input.axes && typeof input.axes === 'object' && !Array.isArray(input.axes)
    ? input.axes as Record<string, unknown> : {};
  const names: Record<string, string> = { appeal: '面白さ', dbValue: 'DBの必然性', seo: 'SEO', revenue: '収益性', contentFeasibility: 'コンテンツ制作の容易さ', upkeep: '更新・維持の容易さ' };
  const scores: string[] = [];
  for (const [key, label] of Object.entries(names)) {
    const n = Number(axes[key]);
    if (Number.isInteger(n) && n >= 1 && n <= 5) scores.push(label + ':' + n + '/5');
  }
  const feedback = ['Web管理画面評価=' + rating.label, destination ? '展開先='+destination : 'アイデア全体',
    scores.join('、'), comment].filter(Boolean).join(' | ');
  const axesForStorage = Object.fromEntries(Object.keys(names).filter(key => axes[key] !== undefined).map(key => [key, Number(axes[key])]));
  if (Object.values(axesForStorage).some(n => !Number.isInteger(n) || n < 1 || n > 5)) {
    return c.json({error:'採点は1〜5の整数で指定してください。'},400);
  }
  const sourceDate = new Date().toISOString();
  try {
    const result = await ideaFeedbackAppend({
      ideaId, scope: 'specific_idea', statusAfter: rating.status,
      ...(destination ? { destination } : {}),
      polarity: rating.polarity, reason: comment || rating.label,
      feedback, source: 'direct_user', sourceDate, idempotencyKey,
      ...(Object.keys(axesForStorage).length ? {axes: axesForStorage} : {}),
      reconsiderWhen: rating.status === 'rejected' ? 'ユーザーの明示的な再検討希望、または根本的に異なる実証が出るまで再提示しない' : undefined
    });
    return c.json({ outcome: result.outcome, event: result.event, status: rating.status }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    const reason = safeError(error);
    return c.json({ error: reason.error }, reason.status);
  }
});
export default app;
