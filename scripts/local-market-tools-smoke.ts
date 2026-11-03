import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marketTools, isMarketTool } from '../apps/mcp/src/market-tools.js';

const names = marketTools.map(tool => tool.name);
assert.deepEqual(names, [
  'market_signal_scan',
  'distribution_case_discovery',
  'market_discovery_run',
  'traffic_route_discovery',
  'market_intelligence_research'
]);
for (const name of names) assert.equal(isMarketTool(name), true, 'local MCP must route ' + name);
assert.equal(isMarketTool('market_signal_snapshot_save'), false, 'local MCP does not expose unrequested snapshot writes');

for (const tool of marketTools) {
  assert.equal(tool.inputSchema.type, 'object');
  assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === 'object');
}
const publicObservationTools = new Set(['market_signal_scan', 'distribution_case_discovery']);
assert.ok([...publicObservationTools].every(name => {
  const tool = marketTools.find(item => item.name === name);
  return Boolean(tool && !tool.inputSchema.required?.length);
}));
assert.deepEqual(
  (marketTools.find(tool => tool.name === 'market_signal_scan')!.inputSchema.properties.sources as any).items.enum,
  ['google_trends', 'tiktok_creative_center', 'hacker_news']
);
assert.deepEqual(
  (marketTools.find(tool => tool.name === 'distribution_case_discovery')!.inputSchema.properties.focus as any).enum,
  ['balanced', 'entertainment', 'fandom', 'everyday', 'technology']
);

const main = readFileSync(new URL('../apps/mcp/src/main.ts', import.meta.url), 'utf8');
assert.match(main, /\.\.\.marketTools/);
assert.match(main, /if \(isMarketTool\(name\)\)/);
assert.match(main, /requiresActionBudget/);
console.log('local market MCP contract passed: free public observations, operation-budgeted validation, and stdio registration');
