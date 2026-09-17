import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const previous = process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT;
try {
  delete process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT;
  const { articleSyncLimit } = await import('../packages/commands/src/site-operations-bridge.js');
  assert.equal(articleSyncLimit(), 500);

  process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT = '250';
  assert.equal(articleSyncLimit(), 250);
  process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT = '9999';
  assert.equal(articleSyncLimit(), 500);

  const source = readFileSync(new URL('../packages/commands/src/site-operations-bridge.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('snapshot.sources.slice(0, limit)'), 'article sync must not silently truncate the Blog source registry');
  assert.match(source, /article_sync_limit_exceeded/, 'oversized registries must fail closed instead of partially syncing');
  assert.match(source, /syncedArticles\.length \? syncedArticles/, 'metric projection must consume the complete synchronized article set');
  console.log('site article scale smoke ok');
} finally {
  if (previous === undefined) delete process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT;
  else process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT = previous;
}
