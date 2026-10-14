import assert from 'node:assert/strict';
import { distributionCaseDiscovery, distributionCaseDiscoveryShape, parseHatenaDistributionRss, parseHackerNewsDistribution, headlineFormatClues } from '../packages/commands/src/distribution-case-discovery.js';

const now = Date.parse('2026-10-14T09:00:00.000Z');
const rss = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:hatena="http://www.hatena.ne.jp/info/xmlns#">
<item rdf:about="https://example.jp/r">
<title><![CDATA[初心者のギター練習　無料チェックリスト]]></title>
<link>https://example.jp/guitar/list?ref=hotentry&amp;x=1</link>
<dc:date>2026-10-14T02:00:00Z</dc:date><hatena:bookmarkcount>187</hatena:bookmarkcount>
</item>
<item><title>上位のスマホレビュー</title><link>https://media.example.jp/review</link><dc:date>2026-10-12T02:00:00Z</dc:date></item>
<item><title>古い情報</title><link>https://old.example.jp/post</link><dc:date>2026-01-01T00:00:00Z</dc:date></item>
<item><title>偽装アドレス</title><link>http://localhost:5000/internal</link></item>
</rdf:RDF>`;
const feed = {id:'hatena_general', family:'cross_category_curation',url:'https://b.hatena.ne.jp/hotentry.rss',market:'JP'};
const parsed = parseHatenaDistributionRss(rss,feed,now,7);
assert.equal(parsed.length,2);
assert.equal(parsed[0].title,'初心者のギター練習 無料チェックリスト');
assert.equal(parsed[0].destinationUrl,'https://example.jp/guitar/list?ref=hotentry&x=1');
assert.deepEqual(parsed[0].engagement.map(m=>m.value),[187]);
assert.equal(parsed[0].observedVisits,null);
assert.equal(parsed[1].engagement.length,0);
const fandomRss = `<?xml version="1.0"?><rdf:RDF xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:hatena="http://www.hatena.ne.jp/info/xmlns#">
<item><title>ライブ後の個人レポート</title><link>https://creative.example.net/fan-report</link>
<dc:subject>VTuber</dc:subject><dc:subject>推し活</dc:subject><dc:date>2026-10-14T02:00:00Z</dc:date>
<hatena:bookmarkcount>11</hatena:bookmarkcount></item>
<item><title>原神のイベント分析</title><link>https://fan-research.example.net/genshin</link>
<dc:subject>原神</dc:subject><dc:subject>ゲーム</dc:subject><dc:date>2026-10-14T02:00:00Z</dc:date></item>
</rdf:RDF>`;
const parsedFandom = parseHatenaDistributionRss(fandomRss,feed,now,7);
assert.deepEqual(parsedFandom[0].observedTags,['VTuber','推し活']);
assert.deepEqual(parsedFandom[1].observedTags,['原神','ゲーム']);

const hn = parseHackerNewsDistribution([
 {id:456,type:'story',url:'https://guitaro.example.org',title:'Show HN: New guitar learning tool',score:120,descendants:26,time:Math.round(now/1000)-3600},
 {id:457,type:'story',url:'https://other.example.org',title:'Very old',time:Math.round(now/1000)-3600*24*45},
 {id:458,type:'comment',url:'https://other.example.org',title:'Not a story',time:Math.round(now/1000)}
],now,7);
assert.equal(hn.length,1);
assert.equal(hn[0].sourcePostUrl,'https://news.ycombinator.com/item?id=456');
assert.deepEqual(hn[0].engagement.map(x=>x.metric),['upvotes','comments']);
const calls:string[] = [];
const loadText=async(url:string)=>{
 calls.push(url);
 return rss;
};
const loadJson=async(url:string)=>{
 calls.push(url);
 if(url.endsWith('showstories.json'))return [456,457,458];
 if(url.endsWith('456.json'))return {id:456,type:'story',url:'https://guitaro.example.org',title:'Show HN: New guitar learning tool',score:120,descendants:26,time:Math.round(now/1000)-3600};
 if(url.endsWith('457.json'))return {id:457,type:'story',url:'https://other.example.org',title:'Very old',time:Math.round(now/1000)-3600*24*45};
 return null;
};
const packet = await distributionCaseDiscovery({maxCases:9},{fetchText:loadText,fetchJson:loadJson,clock:()=>now});
assert.equal(packet.status,'observed_real_distribution_edges');
assert.equal(packet.sources.length,10);
assert.ok(packet.sources.some(x=>x.sourceId==='hatena_fun'));
assert.ok(packet.sources.some(x=>x.sourceId==='hatena_life'));
assert.equal(packet.scope.estimatedSerpCalls,0);
assert.equal(packet.scope.estimatedFirestoreReads,0);
assert.equal(packet.scope.maxUpstreamFetches,22);
assert.equal(packet.cases.length,3);
assert.equal(packet.cases[0].sourceId,'hatena_general');
assert.equal(packet.cases[1].sourceId,'hacker_news_show');
assert.equal(packet.cases[2].sourceId,'hatena_general');
assert.equal(packet.cases[0].repeatsInSample,9);
assert.equal(packet.cases[0].distinctFeedCategoryCount,9);
assert.equal(packet.cases[0].distinctPlatformCount,1);
assert.equal(packet.cases[0].sameDomainEntriesInSample,9);
assert.ok(packet.cases[0].headlineFormatClues.some(h=>h.kind==='utility_or_free_tool'&&h.matchedText==='無料'));
assert.ok(packet.cases[0].headlineFormatClues.some(h=>h.kind==='practical_walkthrough'));
assert.equal(packet.cases[0].timestampProvenance,'rss_entry_timestamp');
assert.equal(packet.cases[1].timestampProvenance,'hn_story_timestamp');
assert.ok(packet.cases.every(c=>c.observedConversions===null && c.placementEligibility==='not_yet_verified'));
const focused=await distributionCaseDiscovery({topic:'ギター',includeGlobalTech:false},{fetchText:loadText,clock:()=>now});
assert.equal(focused.cases.length,1);
assert.equal(focused.scope.maxUpstreamFetches,9);
assert.equal(focused.cases[0].title,'初心者のギター練習 無料チェックリスト');
const rotated = await distributionCaseDiscovery({rotation:3,includeGlobalTech:false,maxCases:2},{fetchText:loadText,clock:()=>now});
assert.equal(rotated.cases[0].sourceId,'hatena_knowledge');
assert.equal(rotated.scope.estimatedSerpCalls,0);
assert.deepEqual(headlineFormatClues('速報 明日の天気').map(x=>x.kind),['news_or_editorial']);
const oneOutage = await distributionCaseDiscovery({includeGlobalTech:false}, {
 fetchText: async(url:string) => {
  if (url.includes('/life.rss')) throw Error('timeout');
  return rss;
 }, clock:()=>now
});
assert.equal(oneOutage.sources.filter(x=>x.status==='unavailable').length,1);
assert.equal(oneOutage.status,'observed_real_distribution_edges');
assert.ok(oneOutage.cases.every(x=>x.observedVisits===null));
const outage=await distributionCaseDiscovery({includeGlobalTech:false},{fetchText:async()=>{throw Error('HTTP 503')},clock:()=>now});
assert.equal(outage.status,'insufficient_observations');
assert.ok(outage.sources.every(x=>x.status==='unavailable'));

const nichePacket = await distributionCaseDiscovery({focus:'fandom',niche:'VTuber',maxCases:8},{
 fetchText:async(url:string)=>url.includes('/game.rss') ? fandomRss : rss,
 clock:()=>now
});
assert.equal(nichePacket.focus,'fandom');
assert.equal(nichePacket.sources.length,3);
assert.equal(nichePacket.scope.maxUpstreamFetches,3);
assert.deepEqual(nichePacket.scope.attemptedFeedCategories,['hatena_fun','hatena_entertainment','hatena_game']);
assert.equal(nichePacket.cases.length,1);
assert.equal(nichePacket.cases[0].title,'ライブ後の個人レポート');
assert.equal(nichePacket.cases[0].observedTags[0],'VTuber');
assert.equal(nichePacket.cases[0].permissionToPublish,'unknown');
assert.ok(nichePacket.observedCommunityTags.some(x=>x.tag==='VTuber'&&x.evidenceType==='rss_dc_subject'));
const unseenNiche = await distributionCaseDiscovery({focus:'entertainment',niche:'架空の界隈XYZ'},{
 fetchText:async()=>fandomRss,clock:()=>now
});
assert.equal(unseenNiche.status,'insufficient_observations');
assert.equal(unseenNiche.nicheCoverage.assessment,'no_observed_match_in_sample');
assert.equal(unseenNiche.cases.length,0);
const topicTag = await distributionCaseDiscovery({focus:'fandom',topic:'原神'},{
 fetchText:async()=>fandomRss,clock:()=>now
});
assert.equal(topicTag.cases.length,1);
assert.equal(topicTag.cases[0].observedTags[0],'原神');
const defaultShape = distributionCaseDiscoveryShape.focus;
assert.equal(defaultShape.parse('entertainment'),'entertainment');
assert.throws(()=>defaultShape.parse('celebrity_guesswork'));
assert.throws(()=>distributionCaseDiscoveryShape.maxCases.parse(80));
console.log('distribution case discovery smoke passed');
