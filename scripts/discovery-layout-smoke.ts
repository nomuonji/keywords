import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../apps/web/src/App.tsx');
const ideas = read('../apps/web/src/IdeaReview.tsx');
const market = read('../apps/web/src/MarketDiscovery.tsx');

assert.match(app, /view==='discover'/);
assert.match(app, /<IdeaReview\/>/, 'Idea Memory remains the single primary destination');
assert.match(app, /<details className="discoveryEvidenceTools">/, 'specialist research must be progressive disclosure');
assert.doesNotMatch(app, /discoveryHubTabs|const discoveryTabs/, 'do not restore four equivalent top-level tabs');
assert.match(app, /type DiscoveryTool='market'\|'research'\|'structures'/);
assert.match(app, /const legacyDiscoveryViews=\['ideas','market','research','structures'\]/, 'old deep links stay supported');
for (const name of ['MarketDiscovery','ThemeResearch','SiteStructures']) {
  assert.ok(app.includes('<' + name + '/>'), name + ' original specialist ledger stays available');
}
assert.match(market, /楽天カテゴリ別ランキング観測/, 'market evidence must not imply it represents all markets');
assert.match(ideas, /ideaActionScope/, 'quick review explicitly identifies the selected outlet');
assert.match(ideas, /destinationVerdicts/, 'outlet-level feedback stays separate from global verdict');
console.log('Discovery hub regression passed: one primary idea view, three optional specialist ledgers, per-outlet review and old links.');
