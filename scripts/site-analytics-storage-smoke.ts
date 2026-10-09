import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { remoteSitesStatus } from '../packages/commands/src/remote-site-operations.js';
import { SITES_MCP_SERVER_VERSION, SITES_MCP_TOOL_NAMES } from '../api/sites-mcp-contract.js';

const status: any = remoteSitesStatus();
assert.equal(SITES_MCP_SERVER_VERSION, '0.22.0');
assert.equal(SITES_MCP_TOOL_NAMES.includes('site_metric_snapshot_save' as any), false, 'legacy metric snapshot writes must not be public MCP');
assert.equal(SITES_MCP_TOOL_NAMES.includes('site_metric_snapshot_list' as any), true, 'legacy read compatibility remains available');
assert.equal(status.analyticsStoragePolicy.durableAnalytics, 'seoPlanningDigests/{siteId}');
assert.equal(status.analyticsStoragePolicy.durableUrlAnalytics, 'none');
assert.equal(status.analyticsStoragePolicy.legacyMetricSnapshots, 'read_only_compatibility_only');
assert.equal(status.analyticsStoragePolicy.legacySiteDigests, 'unused');
assert.equal(status.collections.includes('metricSnapshots'), false, 'legacy snapshots are not a current collection contract');
assert.equal(status.legacyCollections.metricSnapshots, 'read_only_compatibility_for_historical_optimization_evidence');
assert.equal(status.indexationStoragePolicy.urlCachePurpose, 'current_inventory_and_indexation_state_not_access_analytics_history');

const maintenance = readFileSync(new URL('../packages/commands/src/maintenance-execution.ts', import.meta.url), 'utf8');
assert.match(maintenance, /refreshSeoPlanningDigest/);
assert.doesNotMatch(maintenance, /site-operations-bridge/);
assert.doesNotMatch(maintenance, /metricSnapshotSave/);

const remote = readFileSync(new URL('../packages/commands/src/remote-site-operations.ts', import.meta.url), 'utf8');
assert.match(remote, /digest\?\.generatedAt && digest\.siteMetrics\?\.current7/, 'pre-migration digests must fall back instead of returning empty canonical metrics');

const api = readFileSync(new URL('../api/sites-mcp.ts', import.meta.url), 'utf8');
assert.doesNotMatch(api, /registerTool\('site_metric_snapshot_save'/);
assert.match(api, /legacy historical GSC\/GA4 snapshots retained only for optimization-evidence compatibility/);

console.log('site analytics storage smoke passed: one durable site digest, no durable URL analytics, legacy snapshot reads only, indexation cache kept separate');
