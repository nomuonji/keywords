import assert from 'node:assert/strict';
import { verifyGeneratedPage } from './seo-site-ci.js';

const url = 'https://example.com/guides/a/';
const check = [{ url, containsText: 'Evidence-based article correction', internalLinks: ['https://example.com/guides/b/'] }];
const page = `<!doctype html><html><head><link rel="canonical" href="${url}"></head><body><main>Evidence-based article correction <a href="/guides/b/">Related</a></main></body></html>`;
assert.doesNotThrow(() => verifyGeneratedPage(page, url, check));
assert.throws(() => verifyGeneratedPage(page.replace('Evidence-based article correction', 'Old text'), url, check), /text missing/);
assert.throws(() => verifyGeneratedPage(page.replace('/guides/b/', '/other/'), url, check), /internal link missing/);
assert.throws(() => verifyGeneratedPage(page.replace(url, 'https://example.com/other/'), url, check), /Canonical mismatch/);
// No exact-string assertions is normal; generated page and canonical must still be valid.
assert.doesNotThrow(() => verifyGeneratedPage(page, url, []));
assert.throws(() => verifyGeneratedPage(page.replace(url, 'https://example.com/other/'), url, []), /Canonical mismatch/);
assert.throws(() => verifyGeneratedPage('<html><head></head></html>', url, []), /body missing/);
console.log('Central generated-page route/canonical smoke passed (optional assertions)');
