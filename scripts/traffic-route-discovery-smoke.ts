import assert from 'node:assert/strict';
import { trafficRouteQueries, trafficRouteDiscovery, trafficRouteDiscoveryShape } from '../packages/commands/src/traffic-route-discovery.js';

const first = trafficRouteQueries('登山 テント', 0, 3);
assert.equal(first.length, 3);
assert.equal(first[0].id, 'open_discovery');
assert.ok(first[1].query.includes('site:'));
assert.notEqual(trafficRouteQueries('登山 テント', 1, 3)[1].id, first[1].id);
const fan = trafficRouteQueries('原神 ファンアート', 0, 3, 'fandom');
assert.equal(fan.length,3);
assert.equal(fan[0].id,'open_discovery');
assert.equal(fan[1].id,'fan_art_communities');
assert.ok(fan[1].query.includes('site:pixiv.net'));
assert.equal(fan[2].id,'fan_goods_and_events');
assert.notEqual(trafficRouteQueries('原神 ファンアート', 1, 3, 'fandom')[1].id,fan[1].id);
const creator = trafficRouteQueries('自主制作 ゲーム',0,3,'creator_community');
assert.equal(creator[1].id,'creator_portfolios');

const calls: string[] = [];
const research = async (input: { query: string; country: string; language: string; num: number; provider: 'api'; forceRefresh: false; maxCacheAgeHours: number }) => {
  calls.push(input.query);
  assert.equal(input.country, 'JP');
  assert.equal(input.provider, 'api');
  assert.equal(input.forceRefresh, false);
  if (input.query.includes('site:chiebukuro')) return {
    results: [
      { link: 'https://detail.chiebukuro.yahoo.co.jp/qa/question/a', title: 'テント選びについて質問', snippet: '初心者です', position: 2 },
      { link: 'https://example.com/seo-seller', title: '広告', snippet: 'Not a matching site', position: 3 }
    ], provider: 'api', cache: { hit: true }
  };
  if (input.query.includes('site:reddit.com')) return {
    results: [{ link: 'https://www.reddit.com/r/CampingGear/comments/x', title: 'Camping tent experience', snippet: 'Review', position: 1 }],
    provider: 'api', cache: { hit: false }
  };
  return {
    results: [
      { link: 'https://small-niche-forum.example.org/discussion/123', title: '登山のテント談義', snippet: '実体験', position: 1 },
      { link: 'http://localhost:3300/private', title: 'private', position: 2 }
    ], provider: 'api', cache: { hit: true }
  };
};
const result = await trafficRouteDiscovery({ topic: '登山 テント', maxProbes: 3 }, { research });
assert.equal(result.probes.length, 3);
assert.equal(calls.length, 3);
assert.equal(result.execution.maximumSerpRequests, 3);
assert.equal(result.execution.usesExistingFirestoreSerpCacheAndQuota, true);
assert.equal(result.stage, 'candidate_surfaces_only');
assert.equal(result.findings.length, 3);
assert.ok(result.findings.some(r => r.discoveredDomain === 'small-niche-forum.example.org'), 'open-web discovery finds non-allowlisted host');
assert.ok(result.findings.some(r => r.platform === 'chiebukuro.yahoo.co.jp'));
assert.ok(result.findings.every(r => r.evidenceType === 'search_indexed_page'));
assert.ok(result.findings.every(r => r.rank !== 3), 'scope limits site-restricted results');
assert.ok(!JSON.stringify(result).includes('conversionRate'), 'No fabricated conversions');
const fanPacket = await trafficRouteDiscovery({topic:'原神 ファンアート',audience:'fandom',maxProbes:1},{research:async()=>({results:[{link:'https://www.pixiv.net/artworks/12345',title:'原神 ファンアート',position:1}]})});
assert.equal(fanPacket.audience,'fandom');
assert.equal(fanPacket.execution.maximumSerpRequests,1);
assert.equal(fanPacket.findings.length,1);
assert.equal(fanPacket.findings[0].discoveredDomain,'pixiv.net');
assert.equal(fanPacket.findings[0].evidenceType,'search_indexed_page');
const absent = await trafficRouteDiscovery({ topic: '非常に限定的な趣味', maxProbes: 1 }, { research: async () => ({ results: [] }) });
assert.equal(absent.stage, 'insufficient_evidence');
const fail = await trafficRouteDiscovery({ topic: '登山 テント', maxProbes: 2 }, { research: async () => { throw Error('quota exceeded'); } });
assert.equal(fail.stage, 'insufficient_evidence');
assert.ok(fail.probes.every(p => p.status === 'source_unavailable'));
assert.throws(() => trafficRouteDiscoveryShape.maxProbes.parse(999));
console.log('traffic route discovery smoke passed');
