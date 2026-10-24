import assert from 'node:assert/strict';
import { decideSitemapSubmission, parseRobotsSitemaps, parseSitemapXml, sitemapFingerprint } from '../packages/commands/src/site-sitemap-submission.js';
import { SITES_MCP_TOOL_NAMES } from '../api/sites-mcp-contract.js';

// robots.txt parsing
assert.deepEqual(parseRobotsSitemaps('User-agent: *\nAllow: /\nSitemap: https://a.example.com/sitemap-index.xml\r\nsitemap:https://a.example.com/b.xml\nSitemap: https://a.example.com/b.xml'),
  ['https://a.example.com/sitemap-index.xml', 'https://a.example.com/b.xml']);

// urlset / sitemapindex parsing
const urlset = '<?xml version="1.0"?><urlset xmlns="x"><url><loc>https://a.example.com/x?a=1&amp;b=2</loc><lastmod>2026-10-01</lastmod></url><url><loc> https://a.example.com/y </loc></url></urlset>';
const parsedSet = parseSitemapXml(urlset);
assert.equal(parsedSet.isIndex, false);
assert.deepEqual(parsedSet.entries, [{ loc: 'https://a.example.com/x?a=1&b=2', lastmod: '2026-10-01' }, { loc: 'https://a.example.com/y', lastmod: null }]);
const parsedIndex = parseSitemapXml('<sitemapindex><sitemap><loc>https://a.example.com/sitemap-0.xml</loc></sitemap></sitemapindex>');
assert.equal(parsedIndex.isIndex, true);
assert.equal(parsedIndex.entries.length, 1);

// fingerprint is order independent and lastmod sensitive
const fp = sitemapFingerprint(parsedSet.entries);
assert.equal(fp, sitemapFingerprint([...parsedSet.entries].reverse()));
assert.notEqual(fp, sitemapFingerprint([{ ...parsedSet.entries[0], lastmod: '2026-10-02' }, parsedSet.entries[1]]));

const at = new Date('2026-10-24T00:00:00Z');
const content = { ok: true, fingerprint: 'f1' };
const recent = '2026-10-22T00:00:00Z';
const old = '2026-10-10T00:00:00Z';
const base = { content, canSubmit: true, floorDays: 7, at };

assert.deepEqual(decideSitemapSubmission({ ...base, stored: null, gsc: null }), { submit: true, reason: 'not_registered_in_gsc' });
assert.deepEqual(decideSitemapSubmission({ ...base, stored: { submittedFingerprint: 'f0', lastSubmittedByOperatorAt: recent }, gsc: { lastSubmitted: recent, errors: 0 } }), { submit: true, reason: 'content_changed' });
assert.deepEqual(decideSitemapSubmission({ ...base, stored: { submittedFingerprint: 'f1', lastSubmittedByOperatorAt: recent }, gsc: { lastSubmitted: recent, errors: 2 } }), { submit: true, reason: 'gsc_reported_errors' });
assert.deepEqual(decideSitemapSubmission({ ...base, stored: { submittedFingerprint: 'f1', lastSubmittedByOperatorAt: old }, gsc: { lastSubmitted: old, errors: 0 } }), { submit: true, reason: 'periodic_floor' });
assert.deepEqual(decideSitemapSubmission({ ...base, stored: { submittedFingerprint: 'f1', lastSubmittedByOperatorAt: recent }, gsc: { lastSubmitted: old, errors: 0 } }), { submit: false, reason: 'unchanged_within_floor' });
// Google already has a manually submitted sitemap: no immediate resubmission, change detection starts from now.
assert.deepEqual(decideSitemapSubmission({ ...base, stored: null, gsc: { lastSubmitted: recent, errors: 0 } }), { submit: false, reason: 'unchanged_within_floor' });
assert.deepEqual(decideSitemapSubmission({ ...base, stored: null, gsc: { lastSubmitted: null, errors: 0 } }), { submit: true, reason: 'periodic_floor' });
assert.deepEqual(decideSitemapSubmission({ ...base, canSubmit: false, stored: null, gsc: null }), { submit: false, reason: 'permission_insufficient' });
assert.deepEqual(decideSitemapSubmission({ ...base, content: { ok: false, fingerprint: null }, stored: null, gsc: null, force: true }), { submit: false, reason: 'sitemap_unreachable' });
assert.deepEqual(decideSitemapSubmission({ ...base, stored: { submittedFingerprint: 'f1', lastSubmittedByOperatorAt: recent }, gsc: { lastSubmitted: recent, errors: 0 }, force: true }), { submit: true, reason: 'forced' });

assert.ok(SITES_MCP_TOOL_NAMES.includes('site_sitemap_status' as any), 'status must be readable over MCP');
assert.equal(SITES_MCP_TOOL_NAMES.includes('site_sitemap_submit' as any), false, 'submission runs only in the credentialed scheduled lane');

console.log('site sitemap submission smoke passed');
