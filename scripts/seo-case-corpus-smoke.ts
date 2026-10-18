import assert from 'node:assert/strict';
import { field, value, FirestoreError } from '../packages/db/src/firestore.js';
import { deriveSeoCaseMarket, inferSeoCaseSiteLanguage, evaluateSeoCaseGate, seoCaseCollect, seoCaseGet, seoCaseId, seoCaseList, seoCaseSummary, SEO_CASE_GATE_VERSION } from '../packages/commands/src/seo-case-corpus.js';

process.env.FIREBASE_PROJECT_ID = 'test';
const docs = new Map<string, any>();
let commits = 0;
const now = '2026-10-18T00:00:00.000Z';
const text = 'A detailed, public article that answers a specific reader question with original comparisons, documented constraints and source links. '.repeat(3);
const appearance = (domain: string, query: string, position: number, provider = 'api', upstreamProvider: string | null = 'reserp') => ({
  query, position, title: 'A detailed comparison', url: 'https://' + domain + '/comparison',
  provider, upstreamProvider, observedAt: now
});
const recent = {
  domain: 'new-piano.example', hosts: ['www.new-piano.example'], registrationStatus: 'recent_registration',
  registrationDate: '2026-07-01T00:00:00.000Z', domainAgeDays: 109, rdapUrl: 'https://rdap.example/piano',
  bestPosition: 3, queryCount: 2, appearances: [
    appearance('new-piano.example','piano app comparison',3),
    appearance('new-piano.example','piano app for adults',5)
  ]
};
const mid = {
  ...recent, domain: 'niche-guides.example', bestPosition: 8, queryCount: 1,
  appearances: [appearance('niche-guides.example','specialist lessons for adults',8)]
};
const unknown = {
  ...recent, domain: 'unknown.example', registrationStatus: 'unknown', registrationDate: null, domainAgeDays: null, bestPosition: 6, queryCount: 1,
  appearances: [appearance('unknown.example','piano app comparison',6)]
};
const branded = { ...recent, domain: 'brand-name.example', bestPosition: 1, queryCount: 1,
  appearances: [appearance('brand-name.example','brand-name.example',1)] };
const brave = { ...recent, domain: 'braveonly.example', bestPosition: 1, queryCount: 1,
  appearances: [appearance('braveonly.example','piano comparisons',1,'brave',null)] };
const thin = { ...recent, domain: 'thin.example', bestPosition: 1, queryCount: 1,
  appearances: [appearance('thin.example','piano comparisons',1)] };
const old = { ...recent, domain: 'old.example', registrationDate: '2018-01-01T00:00:00.000Z', domainAgeDays: 3200, bestPosition: 2,
  appearances: [appearance('old.example','piano comparisons',2)] };
const candidates = [unknown, branded, brave, thin, recent, mid, old];
const page = (domain: string, body = text, finalUrl = 'https://' + domain + '/comparison') => ({
  status: 'read', domain, url: 'https://' + domain + '/comparison', finalUrl, title: 'Detailed evidence',
  text: body, truncated: false, fetchedAt: now
});
const pages = [page(recent.domain), page(mid.domain), page(branded.domain), page(brave.domain), page(thin.domain,'Thin page')];
const discovery = { recentRegistrationCandidates: [branded, brave, thin, recent, mid, old],
  unknownRegistrationCandidates: [unknown], olderRegistrationCount: 3, uncheckedDomainCount: 2,
  pageReviews: pages, coverage: { completedQueries: 2, stoppedEarly: false }, errors: [] };
const byDomain = (domain: string) => candidates.find(item => item.domain === domain)!;

assert.equal(evaluateSeoCaseGate(recent,pages,now).passed,true);
assert.equal(evaluateSeoCaseGate(recent,pages,now).evidenceStrength,'strong_observation');
assert.equal(evaluateSeoCaseGate(mid,pages,now).evidenceStrength,'single_top10_observation');
assert.equal(evaluateSeoCaseGate(unknown,pages,now).passed,false);
assert.ok(evaluateSeoCaseGate(unknown,pages,now).reasons.includes('registration_unverified'));
assert.ok(evaluateSeoCaseGate(branded,pages,now).reasons.includes('no_nonbranded_google_proxy_top10'));
assert.ok(evaluateSeoCaseGate(brave,pages,now).reasons.includes('no_nonbranded_google_proxy_top10'));
assert.ok(evaluateSeoCaseGate(thin,pages,now).reasons.includes('page_body_unverified_or_thin'));
assert.ok(evaluateSeoCaseGate(old,pages,now).reasons.includes('registration_older_than_365_days'));
assert.ok(evaluateSeoCaseGate(recent,[page(recent.domain, text,'https://another.example/a')],now).reasons.includes('page_body_unverified_or_thin'));
assert.ok(evaluateSeoCaseGate(recent,[page(recent.domain,'Access denied. '+text)],now).reasons.includes('page_body_unverified_or_thin'));
assert.ok(evaluateSeoCaseGate({ ...recent, appearances: [appearance(recent.domain,'piano app comparison',11)] },pages,now).reasons.includes('no_nonbranded_google_proxy_top10'));
// A descriptive domain word matching the general topic is not navigation.
assert.equal(evaluateSeoCaseGate({ ...recent, domain: 'piano.example', appearances: [appearance('piano.example','best piano lessons for adults',4)] },[page('piano.example')],now).passed,true);
assert.equal(SEO_CASE_GATE_VERSION,'2026-10-18-v1');
// Site language and SERP geographic target are independent; the latter must
// never be forged for older records that did not save search configurations.
const japanesePage = 'この小さな専門サイトでは日本の読者が調べる特殊な計算方法や注意点を、原典と一緒に詳しく紹介しています。'.repeat(4);
assert.equal(inferSeoCaseSiteLanguage(japanesePage), 'ja');
assert.equal(inferSeoCaseSiteLanguage(text), 'en');
assert.equal(inferSeoCaseSiteLanguage('abc'), 'unknown');
const legacyMarket = deriveSeoCaseMarket({ pageEvidence: [{ title: 'Aquarium Tool', excerpt: text }] });
assert.equal(legacyMarket.audienceRegion, 'overseas_likely');
assert.equal(legacyMarket.searchCountry, null);
assert.equal(legacyMarket.searchLanguage, null);
assert.equal(legacyMarket.provenance, 'derived_from_legacy_excerpt');
const japaneseMarket = deriveSeoCaseMarket({ pageEvidence: [{ title: '日本の専門サイト', excerpt: japanesePage }] });
assert.equal(japaneseMarket.audienceRegion, 'japan_likely');
assert.equal(japaneseMarket.searchCountry, null);


const request: any = async (path: string, init?: RequestInit) => {
  if (path === ':commit') {
    const writes = JSON.parse(String(init?.body)).writes as any[];
    for (const write of writes) if (write.currentDocument?.exists === false && docs.has(write.update.name)) throw new Error('unexpected duplicate');
    for (const write of writes) docs.set(write.update.name, write.update);
    commits++;
    return {};
  }
  if (path.startsWith('/seoCaseSites?')) {
    const entries = [...docs.values()].filter(v => v.name.includes('/seoCaseSites/'));
    return { documents: entries, nextPageToken: null };
  }
  const key = 'projects/test/databases/(default)/documents' + path;
  if (!docs.has(key)) throw new FirestoreError(404);
  return docs.get(key);
};
const deps: any = { request, discover: async () => discovery, clock: () => now, id: () => 'run-' + (commits+1) };
const first = await seoCaseCollect({ topic: 'piano learning', queries: ['piano app comparison', 'piano app for adults'], maxNewSites: 1 },deps);
assert.equal(first.newlySaved,1);
assert.equal(first.gatePassedCount,2);
assert.equal(first.gateRejectedCount,5);
assert.equal(first.notSavedDueToBatchLimit,1);
assert.equal(first.newCases[0].domain,recent.domain, 'failing candidates must not consume batch capacity');
assert.equal(first.gateRejectedReasons.find((r: any) => r.reason === 'registration_unverified')?.count,1);
assert.ok((first.gateRejectedReasons.find((r: any) => r.reason === 'page_body_unverified_or_thin')?.count ?? 0) >= 1, 'a rejected case may have multiple independent gate failures');
assert.equal(first.qualityGateVersion,SEO_CASE_GATE_VERSION);
assert.equal(commits,1);
const stored = await seoCaseGet({id:seoCaseId(recent.domain)},request);
assert.equal(stored.qualityGate.passed,true);
assert.equal(stored.qualityGate.evidenceStrength,'strong_observation');
assert.equal(stored.pageEvidence[0].excerpt,text.slice(0,1000));
assert.equal(stored.observations[0].upstreamProvider,'reserp');
assert.equal(stored.topics[0],'piano learning');
assert.equal(stored.market.searchCountry,'jp', 'default SERP country must be recorded');
assert.equal(stored.market.searchLanguage,'ja', 'default SERP language must be recorded');
assert.equal(stored.market.siteLanguage,'en');
assert.equal(stored.market.audienceRegion,'overseas_likely', 'English page is not converted into Japan-audience simply because search was in JP');
assert.equal(stored.market.provenance,'recorded_at_collection');
assert.equal(stored.interpretationStatus,'unreviewed', 'the hard gate must not imply site/theme quality');
const second = await seoCaseCollect({ topic:'other research', queries:['specialist lessons for adults'], maxNewSites:8 },deps);
assert.equal(second.newlySaved,1);
assert.equal(second.alreadyInCorpus,1);
assert.equal(commits,2);
const listing = await seoCaseList({},request);
assert.equal(listing.items.length,2);
assert.ok(listing.items.every((item: any) => item.qualityGate.passed === true));
const summary = await seoCaseSummary({},request);
assert.equal(summary.recentRegistration,2);
assert.equal(summary.ageUnknown,0);
assert.equal(summary.audienceRegionCounts.overseas_likely,2);
assert.equal(summary.audienceRegionCounts.japan_likely,0);
assert.equal(summary.legacyMarketInferenceCount,0);
assert.deepEqual(summary.recordedSearchMarkets,[{market:'JP/ja',domainCount:2}]);
const repeated = await seoCaseCollect({ topic:'another', queries:['piano app comparison'] },deps);
assert.equal(repeated.newlySaved,0);
assert.equal(repeated.alreadyInCorpus,2);
assert.equal(commits,2,'duplicate collection must not refresh existing records');
const noUnknown = await seoCaseCollect({topic:'another',queries:['piano app comparison'],includeUnknownAge:false},deps);
assert.equal(noUnknown.gateRejectedCount,4);
assert.equal(noUnknown.newlySaved,0);
assert.equal(field('test').stringValue,'test');
assert.equal(value(field(12)),12);
console.log('SEO case hard gate smoke passed: real rank, age, nonbrand query, body, rejects, exact dedup and no false promotion');
