import assert from 'node:assert/strict';
import { measurementCandidate } from './site-measurement-registry.js';
import type { SiteRecord } from '../packages/db/src/site-operations-schema.js';

// Domain properties, URL-prefix properties, missing GSC and stable bindings.
const site = (id: string, overrides: Partial<SiteRecord> = {}) => ({
  id,
  name: id,
  status: 'active',
  revision: 1,
  localProjectId: null,
  productionUrl: `https://${id}.antonbase.com/`,
  searchConsoleProperty: 'sc-domain:antonbase.com',
  repository: `nomuonji/${id}`,
  deploymentProvider: 'other',
  siteShape: 'article',
  ga4PropertyId: null,
  siteConceptId: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides
}) as SiteRecord;

const first = measurementCandidate(site('new-blog'));
assert.equal(first.job?.siteId, 'new-blog');
assert.equal(first.job?.domain, 'new-blog.antonbase.com');
assert.equal(first.job?.gscProperty, 'sc-domain:antonbase.com');
assert.equal(first.needsLink, true);
assert.match(first.job!.projectId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
assert.equal(measurementCandidate(site('new-blog')).job?.projectId, first.job?.projectId);
assert.notEqual(measurementCandidate(site('another-blog')).job?.projectId, first.job?.projectId);

const old = measurementCandidate(site('bloom-life', { localProjectId: '116982be-0439-436f-892f-d80cd6de67e5' }));
assert.equal(old.job?.projectId, '116982be-0439-436f-892f-d80cd6de67e5');
assert.equal(old.needsLink, false);

const prefix = measurementCandidate(site('manner', { searchConsoleProperty: 'https://manner.antonbase.com/' }));
assert.equal(prefix.job?.gscProperty, 'https://manner.antonbase.com/');

assert.equal(measurementCandidate(site('no-gsc', { searchConsoleProperty: null })).reason, 'gsc_property_not_registered');
assert.equal(measurementCandidate(site('draft', { status: 'building' })).reason, 'not_active');
assert.equal(measurementCandidate(site('unsafe', { productionUrl: 'http://localhost/' })).job?.domain, 'localhost');
// The sitemap downloader independently protects against local/private hosts.
console.log('site measurement registry smoke passed: dynamic sites, preserved bindings, stable IDs, GSC eligibility');
