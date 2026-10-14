import assert from 'node:assert/strict';
import { marketProductDiscovery, marketProductDiscoveryShape } from '../packages/commands/src/market-product-discovery.js';

const observations = Array.from({ length: 9 }, (_, index) => ({
  date: '2026-10-14', rootGenreId: String(index + 100), rootName: 'Root ' + index,
  genreId: String(index + 1000), genreName: 'Category ' + index, selection: 'stratified',
  items: [{ itemCode: 'shop:item-' + index, rank: 2 }]
}));
// Two dated observations permit a real overlap check without invented metrics.
observations.unshift({
  date: '2026-10-13', rootGenreId: '100', rootName: 'Root 0',
  genreId: '1000', genreName: 'Category 0', selection: 'stratified',
  items: [{ itemCode: 'shop:item-0', rank: 3 }]
});
const urls: string[] = [];
const load = async (url: string) => {
  urls.push(url);
  if (url.includes('raw.githubusercontent.com')) {
    return { schemaVersion: 1, date: '2026-10-14', generatedAt: '2026-10-14T00:00:00Z', observations };
  }
  const genre = new URL(url).searchParams.get('genreId');
  return { items: [15, 3, 1, 2].map(rank => ({
    itemCode: 'shop:item-' + genre + ':' + rank,
    itemName: 'real ' + genre + ' number ' + rank,
    itemUrl: 'https://item.rakuten.co.jp/shop/item' + rank,
    rank
  })) };
};
const clock = () => Date.parse('2026-10-14T05:00:00Z');

const packet = await marketProductDiscovery({ maxCategories: 6, productsPerCategory: 2 }, { load, clock });
assert.equal(packet.ok, true);
assert.equal(packet.categories.length, 6);
assert.equal(new Set(packet.categories.map(c => c.rootGenreId)).size, 6, 'unrelated root genres');
assert.equal(packet.resourceUse.firestoreReads, 0);
assert.equal(packet.resourceUse.serpCalls, 0);
assert.equal(packet.resourceUse.expectedRankingApiCalls, 6);
assert.equal(urls.length, 7, 'snapshot + six bounded live calls');
assert.ok(packet.categories.every(c => c.status === 'rank_observed'));
assert.ok(packet.categories.every(c => c.items.length === 2 && c.items[0].rank === 1));
assert.ok(packet.categories.every(c => c.items.every((item: { sellerUrl: string }) => item.sellerUrl?.includes('rakuten.co.jp'))));
assert.ok(!JSON.stringify(packet).includes('salesCount'), 'do not invent sales units');
const overview = await marketProductDiscovery({ mode: 'overview' }, { load, clock });
assert.equal(overview.resourceUse.expectedRankingApiCalls, 0);
assert.equal(urls.length, 8, 'overview reads only the prior snapshot');
assert.ok(overview.categories.every(c => c.items.length === 0));
const filtered = await marketProductDiscovery({ genreIds: ['1000'], maxCategories: 8 }, { load, clock });
assert.equal(filtered.categories.length, 1);
assert.equal(filtered.categories[0].genreId, '1000');
assert.equal(filtered.categories[0].overlapWithPrevious, 1);
const unavailable = await marketProductDiscovery({}, { load: async () => { throw Error('HTTP 503'); }, clock });
assert.deepEqual({ ok: unavailable.ok, status: unavailable.status }, { ok: false, status: 'observation_unavailable' });
assert.throws(() => marketProductDiscoveryShape.maxCategories.parse(100));
console.log('market product discovery MCP smoke ok');
