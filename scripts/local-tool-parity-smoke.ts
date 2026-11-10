/**
 * Remote/local drift guard.
 *
 * The skill `treasure-keyword-discovery` speaks in remote-era tool names. This
 * smoke fails in three situations that used to be silent:
 *  1. the catalog claims a local tool that the local MCP does not register,
 *  2. a capability is catalogued as unavailable locally but is now registered
 *     (the catalog would be lying and the agent would skip a real option),
 *  3. the remote contract no longer contains a name the catalog maps from
 *     (someone renamed a remote tool and the mapping is stale).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KEYWORD_CAPABILITIES, keywordCapabilityCatalog, resolveKeywordTool } from '../packages/commands/src/tool-parity.js';

const localSrc = 'apps/mcp/src';
const localToolNames = new Set<string>();
for (const file of readdirSync(localSrc).filter(name => name.endsWith('.ts'))) {
  const source = readFileSync(join(localSrc, file), 'utf8');
  for (const match of source.matchAll(/name:\s*'([a-z0-9_]+)'/g)) localToolNames.add(match[1]);
}

const remoteContract = readFileSync('api/mcp-contract.ts', 'utf8');
const remoteToolNames = new Set([...remoteContract.matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]));

assert.ok(localToolNames.size > 40, `local tool scan found only ${localToolNames.size} names`);

// 1. Every capability that claims a local tool must really be registered.
for (const item of KEYWORD_CAPABILITIES) {
  for (const local of item.local) {
    assert.ok(localToolNames.has(local), `catalog claims local tool "${local}" for "${item.capability}" but apps/mcp/src does not register it`);
  }
}

// 2. A capability marked unavailable locally must not be registered after all.
for (const item of KEYWORD_CAPABILITIES.filter(entry => !entry.local.length)) {
  assert.ok(!localToolNames.has(item.skillName), `"${item.skillName}" is catalogued as unavailable locally but is now registered; update KEYWORD_CAPABILITIES`);
}

// 3. Names mapped from the remote contract must still exist there.
for (const item of KEYWORD_CAPABILITIES.filter(entry => entry.remote)) {
  assert.ok(remoteToolNames.has(item.skillName), `remote contract no longer contains "${item.skillName}" mapped by the capability catalog`);
}

// 4. Resolution works in both directions and never invents a tool.
assert.equal(resolveKeywordTool('serp_research')?.local[0], 'research_serp');
assert.equal(resolveKeywordTool('research_serp')?.skillName, 'serp_research');
assert.equal(resolveKeywordTool('market_discovery_run')?.local.length, 0);
assert.equal(resolveKeywordTool('not_a_tool'), null);

const catalog = keywordCapabilityCatalog();
assert.ok(catalog.aliases.serp_research === 'research_serp');
assert.ok(catalog.unavailableLocally.some(item => item.skillName === 'search_gap_research'));
assert.ok(catalog.capabilities.every(item => item.whenMissing.trim().length > 0), 'every unavailable capability needs a documented fallback');

console.log(`local tool parity smoke ok (${localToolNames.size} local tools, ${KEYWORD_CAPABILITIES.length} capabilities, ${catalog.unavailableLocally.length} remote-only)`);
