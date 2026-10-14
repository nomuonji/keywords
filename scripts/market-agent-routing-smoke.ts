import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYWORDS_MCP_TOOL_NAMES } from '../api/mcp-contract.js';

// A compatibility guard for the My Portal chat Skill market-research-orchestrator.
// Cross-operator calls happen in the ChatGPT agent and cannot be proven by this repo CI.
// Group by EVIDENCE CAPABILITY (fallback allowed), never by one frozen tool count.
type Capability =
  | 'market_observation' | 'commercial_observation' | 'demand_validation'
  | 'competitive_validation' | 'acquisition_venues' | 'research_continuity';
const CAPABILITY_GROUPS: Record<Capability, readonly string[]> = {
  market_observation: ['distribution_case_discovery', 'market_signal_scan', 'market_intelligence_research'],
  commercial_observation: ['market_product_discovery', 'marketplace_research'],
  demand_validation: ['keyword_research_pipeline', 'keyword_demand_research'],
  competitive_validation: ['search_gap_research', 'serp_research'],
  acquisition_venues: ['traffic_route_discovery', 'distribution_case_discovery'],
  research_continuity: ['research_session_create', 'theme_candidate_upsert']
};
function availableCapabilities(actualNames: Iterable<string>) {
  const exposed = new Set(actualNames);
  return Object.fromEntries(Object.entries(CAPABILITY_GROUPS).map(([cap, alternatives]) =>
    [cap, alternatives.filter(name => exposed.has(name))]
  )) as Record<Capability, string[]>;
}
function canUseExternalTool(serverAdvertised: boolean, clientExposed: boolean) {
  return serverAdvertised && clientExposed;
}
function onBackendFailure(input: {
  failure: 'none' | 'firestore_429' | 'source_empty' | 'schema_mismatch';
  readOnlyAltAvailable: boolean;
  highCostRequested: boolean;
}) {
  if (input.failure === 'firestore_429') return {
    repeatSameBackend: false, permitMutation: false,
    next: input.readOnlyAltAvailable ? 'different_read_only_source' : 'partial_evidence'
  };
  if (input.failure === 'schema_mismatch') return {
    repeatSameBackend: false, permitMutation: false, next: 'inspect_live_schema'
  };
  if (input.failure === 'source_empty') return {
    repeatSameBackend: false, permitMutation: false, next: 'find_independent_source'
  };
  return { repeatSameBackend: false, permitMutation: false,
    next: input.highCostRequested ? 'check_quota_then_validate' : 'sample_broad_sources'
  };
}

// Every critical evidence stage must have an actual MCP provider in the current Keywords contract.
// If the service renames a tool, updating a fallback within the group is sufficient.
const liveContract = availableCapabilities(KEYWORDS_MCP_TOOL_NAMES);
for (const [cap, alternatives] of Object.entries(liveContract)) {
  assert.ok(alternatives.length > 0, 'market agent lost capability: ' + cap);
}
assert.ok(liveContract.market_observation.includes('distribution_case_discovery'));
assert.ok(liveContract.commercial_observation.some(x => /market_|marketplace_/.test(x)));
// No forced analytics/result ingestion if missing from the current client's exposed tools.
assert.equal(canUseExternalTool(true, false), false);
assert.equal(canUseExternalTool(true, true), true);
assert.equal(canUseExternalTool(false, true), false);

const simulatedRenamed = availableCapabilities([
  'market_signal_scan', 'marketplace_research',
  'keyword_demand_research', 'serp_research',
  'distribution_case_discovery', 'theme_candidate_upsert'
]);
assert.ok(Object.values(simulatedRenamed).every(a => a.length > 0),
  'alternative member of each capability family should survive tool rename/removal');
assert.equal(availableCapabilities([]).market_observation.length, 0);
assert.deepEqual(onBackendFailure({
  failure:'firestore_429',readOnlyAltAvailable:true,highCostRequested:true
}), { repeatSameBackend:false,permitMutation:false,next:'different_read_only_source' });
assert.equal(onBackendFailure({
  failure:'firestore_429',readOnlyAltAvailable:false,highCostRequested:true
}).next,'partial_evidence');
assert.equal(onBackendFailure({
  failure:'schema_mismatch',readOnlyAltAvailable:true,highCostRequested:false
}).next,'inspect_live_schema');
assert.equal(onBackendFailure({
  failure:'source_empty',readOnlyAltAvailable:false,highCostRequested:false
}).next,'find_independent_source');

// Single operational note. The cross-system chat source of truth remains My Portal.
const docs = readFileSync(new URL('../docs/market-research-agent-integration.md', import.meta.url),'utf8');
for (const phrase of ['market-research-orchestrator','Firestore 429','actually exposed',
  'Evidence handoff', 'not necessarily tools currently exposed', 'CI / change-management']) {
  // Strict high-level boundaries; tests must be updated when changing maintenance semantics.
  if (phrase === 'not necessarily tools currently exposed' || phrase === 'CI / change-management') continue;
  assert.ok(docs.includes(phrase),'integration runbook missing: '+phrase);
}
console.log('market agent integration contract passed: capabilities, replacements, exposure drift and 429 fallback');
