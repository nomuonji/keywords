// On-demand discovery of traffic surfaces observed around a concrete product, problem, or audience.
// This tool finds indexed candidate venues; it never treats indexed content as referral traffic,
// permission to promote, audience size, sales, or conversion evidence.
import { z } from 'zod';
import { serpResearchCached } from './remote-keyword-research.js';

export const trafficRouteDiscoveryShape = {
  topic: z.string().trim().min(3).max(120),
  geo: z.string().length(2).optional(),
  rotation: z.number().int().min(0).max(12).optional(),
  maxProbes: z.number().int().min(1).max(4).optional(),
  resultsPerProbe: z.number().int().min(3).max(10).optional(),
  audience: z.enum(['general','fandom','creator_community']).optional()
};
type Input = { topic: string; geo?: string; rotation?: number; maxProbes?: number; resultsPerProbe?: number; audience?: 'general' | 'fandom' | 'creator_community' };
type Result = { link?: string; url?: string; title?: string; domain?: string; position?: number; snippet?: string | null };
type SearchResult = { fetchedAt?: string; results?: Result[]; cache?: { hit?: boolean }; provider?: string };
type Probe = { id: string; family: string; sites: string[]; mechanic: string; uncertainty: string };
const SURFACES: Probe[] = [
  { id: 'q_and_a', family: 'problem_solving_communities', sites: ['chiebukuro.yahoo.co.jp', 'oshiete.goo.ne.jp'], mechanic: 'Answer an actual unmet question with useful evidence, not a drive-by product link.', uncertainty: 'Are promotional or source links permitted in this thread/community?' },
  { id: 'communities', family: 'interest_communities', sites: ['reddit.com', 'quora.com'], mechanic: 'Participate where buyers are already asking, if community rules allow it.', uncertainty: 'Community-specific promotion policy and Japanese audience match must be verified.' },
  { id: 'creator_articles', family: 'third_party_editorial', sites: ['note.com', 'ameblo.jp'], mechanic: 'Publish a useful original comparison/case study, or collaborate with an existing author.', uncertainty: 'Discoverability, affiliate disclosures and external linking must be verified.' },
  { id: 'video', family: 'video_discovery', sites: ['youtube.com', 'tiktok.com'], mechanic: 'Demonstrate a real usage scene or buyer decision, with a permitted click path.', uncertainty: 'Views are not outbound visits; inspect exact external-link affordances.' },
  { id: 'visual', family: 'visual_discovery', sites: ['pinterest.com', 'lemon8-app.com'], mechanic: 'Make searchable idea/instruction visuals linking to a relevant useful destination where allowed.', uncertainty: 'Image rights, audience relevance and actual outbound-link capability require verification.' },
  { id: 'curation', family: 'curation_and_bookmarks', sites: ['b.hatena.ne.jp', 'togetter.com'], mechanic: 'Earn editorial pickup from an independently useful reference or comparison.', uncertainty: 'A visible page is not proof that editors will recommend or link to it.' },
  { id: 'niche_marketplaces', family: 'marketplace_discovery', sites: ['booth.pm', 'minne.com'], mechanic: 'Observe where a narrowly defined buyer browses; assess an allowed listing or partnership.', uncertainty: 'Selling and affiliate/link policies, eligibility and fees require verification.' },
  { id: 'review_comparison', family: 'product_comparison', sites: ['kakaku.com', 'my-best.com'], mechanic: 'Find purchase-intent comparison pages; investigate legitimate referral or content partnerships.', uncertainty: 'Editorial presence does not establish a self-service publishing path.' },
  { id: 'technical', family: 'professional_and_developer', sites: ['qiita.com', 'zenn.dev'], mechanic: 'Contribute a reproducible technical answer if the product truly fits that community.', uncertainty: 'No product promotion without substantive technical relevance and local rules.' },
  { id: 'directories', family: 'discovery_directories', sites: ['producthunt.com', 'alternativeto.net'], mechanic: 'Investigate a legitimate tool listing or category directory placement.', uncertainty: 'Listing eligibility, paid placement and target-market fit are not established.' },
  { id: 'forums', family: 'enthusiast_forums', sites: ['5ch.net', 'girlschannel.net'], mechanic: 'Observe language and pain points of a niche community; do not automate promotional posts.', uncertainty: 'Links and promotional participation may be restricted or inappropriate.' },
  { id: 'newsletter', family: 'newsletter_and_owned_media', sites: ['substack.com', 'note.com'], mechanic: 'Identify topic-specific writers for possible editorial coverage or permissioned partnerships.', uncertainty: 'No evidence of collaboration access, deliverability or referral volume.' }
];
const FAN_SURFACES: Probe[] = [
  { id:'fan_art_communities', family:'fan_art', sites:['pixiv.net','poipiku.com'], mechanic:'Observe actual fan creations and creator profiles before investigating opt-in links or partnerships.', uncertainty:'A fan illustration or profile is NOT a permission to promote or republish copyrighted works.' },
  { id:'fan_goods_and_events', family:'fan_goods', sites:['booth.pm','suzuri.jp'], mechanic:'Observe actual fan goods, events and creator storefronts to investigate licensed listings and traffic discovery.', uncertainty:'The existence of merchandise is not proof that third-party referral/affiliate links are permitted.' },
  { id:'fan_discussions', family:'fan_discussion', sites:['reddit.com','note.com'], mechanic:'Study documented discussions and creator commentary; any participation must respect each community policy.', uncertainty:'Presence of fans is not evidence that promotions or outbound links are welcome.' },
  { id:'fan_video', family:'fan_video', sites:['youtube.com','nicovideo.jp'], mechanic:'Observe concrete fan videos, coverage and creator channels; check actual permitted outbound destinations.', uncertainty:'Views do not equal site visits, and video/copyright rules differ by franchise.' }
];
const CREATOR_SURFACES: Probe[] = [
  { id:'creator_portfolios', family:'creative_portfolios', sites:['pixiv.net','note.com'], mechanic:'Find creators producing original community-specific references or tools and their actual author destinations.', uncertainty:'The creative works and fan assets may be copyrighted; collaboration or referrals require permission.' },
  { id:'creator_products', family:'creator_stores', sites:['booth.pm','suzuri.jp'], mechanic:'Observe actual storefronts or publications and check legitimate creator collaboration routes.', uncertainty:'Publishing merchandise requires rights clearance and review of platform listing terms.' },
  { id:'creator_video', family:'creative_video', sites:['youtube.com','nicovideo.jp'], mechanic:'Identify existing original creator demonstration formats and inspect reachable external links.', uncertainty:'Engagement and viewer intent are unproven until measured.' }
];
// One general discovery probe can reveal a venue not named in our initial taxonomy.
const OPEN_DISCOVERY: Probe = { id: 'open_discovery', family: 'unknown_referral_surfaces', sites: [], mechanic: 'Identify actual venues repeatedly publishing or discussing this buying problem.', uncertainty: 'A surfaced website is only a lead; a usable acquisition mechanism is not established.' };
const knownSites = new Set([...SURFACES,...FAN_SURFACES,...CREATOR_SURFACES].flatMap(p => p.sites));
function safeLink(link: unknown): string | null {
  try { if (typeof link !== 'string') return null; const url = new URL(link); if (url.protocol !== 'https:' && url.protocol !== 'http:') return null; if (url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null; return url.href; } catch { return null; }
}
function hostname(link: string) { return new URL(link).hostname.toLowerCase().replace(/^www\./, ''); }
function taggedSite(host: string, sites: string[]) { return sites.find(site => host === site || host.endsWith('.' + site)) ?? null; }
export function trafficRouteQueries(topic: string, rotation = 0, maxProbes = 3, audience: 'general' | 'fandom' | 'creator_community' = 'general'): Array<Probe & { query: string }> {
  const surfaces = audience === 'fandom' ? FAN_SURFACES : audience === 'creator_community' ? CREATOR_SURFACES : SURFACES;
  const order = [...surfaces.slice(rotation % surfaces.length), ...surfaces.slice(0, rotation % surfaces.length)];
  const selected = order.slice(0, Math.max(0, maxProbes - 1));
  return [
    { ...OPEN_DISCOVERY, query: topic + (audience === 'fandom' ? ' (ファン OR 二次創作 OR 推し OR 考察 OR 参加)' : audience === 'creator_community' ? ' (作品 OR 制作 OR 公開 OR 創作)' : ' (質問 OR 口コミ OR 比較 OR 体験談)') },
    ...selected.map(p => ({ ...p, query: '(' + p.sites.map(site => 'site:' + site).join(' OR ') + ') ' + topic }))
  ];
}
export async function trafficRouteDiscovery(
  input: Input,
  deps: { research?: (input: { query: string; country: string; language: string; num: number; provider: 'api'; forceRefresh: false; maxCacheAgeHours: number }) => Promise<SearchResult> } = {}
) {
  const args = z.object(trafficRouteDiscoveryShape).strict().parse(input);
  const topic = args.topic.replace(/\s+/g, ' ');
  const geo = (args.geo || 'JP').toUpperCase();
  const probes = trafficRouteQueries(topic, args.rotation ?? 0, args.maxProbes ?? 3, args.audience ?? 'general');
  const research = deps.research ?? serpResearchCached;
  const findings: Array<{
    probeId: string; family: string; platform: string | null; discoveredDomain: string;
    title: string; url: string; snippet: string | null; rank: number | null;
    evidenceType: 'search_indexed_page'; query: string;
  }> = [];
  const results = [];
  for (const probe of probes) {
    try {
      const packet = await research({
        query: probe.query, country: geo, language: geo === 'JP' ? 'ja' : 'en',
        num: args.resultsPerProbe ?? 8, provider: 'api', forceRefresh: false, maxCacheAgeHours: 72
      });
      const observed = [];
      for (const raw of (Array.isArray(packet.results) ? packet.results : []) as Result[]) {
        const url = safeLink(raw.link ?? raw.url);
        if (!url) continue;
        const host = hostname(url);
        if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com') || host === 'threads.net' || host.endsWith('.threads.net')) continue;
        const matched = taggedSite(host, probe.sites);
        if (probe.sites.length && !matched) continue; // OR search can return unrelated domains.
        const title = String(raw.title || '').slice(0, 240);
        if (!title) continue;
        const source = {
          probeId: probe.id, family: probe.family,
          platform: matched ?? taggedSite(host, [...knownSites]) ?? null,
          discoveredDomain: host, title, url,
          snippet: String(raw.snippet || '').slice(0, 400) || null,
          rank: Number.isInteger(raw.position) && (raw.position ?? 0) > 0 ? raw.position! : null,
          evidenceType: 'search_indexed_page' as const, query: probe.query
        };
        if (!findings.some(item => item.url === url)) {
          findings.push(source);
          observed.push(source);
        }
      }
      results.push({
        id: probe.id, family: probe.family, query: probe.query,
        status: observed.length ? 'indexed_pages_observed' : 'no_matching_indexed_pages',
        indexedPageCount: observed.length, exampleMechanicToInvestigate: probe.mechanic,
        verificationRequired: probe.uncertainty, cacheHit: packet.cache?.hit ?? null,
        provider: packet.provider ?? null,
        evidence: observed
      });
    } catch (error) {
      results.push({
        id: probe.id, family: probe.family, query: probe.query,
        status: 'source_unavailable', indexedPageCount: 0,
        exampleMechanicToInvestigate: probe.mechanic, verificationRequired: probe.uncertainty,
        warning: error instanceof Error ? error.message.slice(0,180) : 'search_failed',
        evidence: []
      });
    }
  }
  return {
    topic, geo, audience:args.audience ?? 'general', retrievedAt: new Date().toISOString(), snapshotType: 'on_demand_search_index_observations',
    stage: findings.length ? 'candidate_surfaces_only' : 'insufficient_evidence',
    execution: { provider: 'existing_cached_serp', probeCount: probes.length, maximumSerpRequests: probes.length, writesNewResearchLedger: false, usesExistingFirestoreSerpCacheAndQuota: true },
    observations: { indexedPages: findings.length, distinctDomains: new Set(findings.map(x => x.discoveredDomain)).size },
    findings, probes: results,
    interpretation: [
      'An indexed page establishes a topic-adjacent venue, not traffic, market share, buyer intent, allowed promotion or a working outbound route.',
      'Classify venue => precise user action => permitted link/CTA => landing page => measurable acquisition. Check each step with primary evidence.',
      'Do not recommend automated community spam, scraped contacts, hidden advertorials or paid placements without approval.',
      'Platform absence in this bounded scan is not evidence of zero demand. Rotate or investigate an observed new domain.',
      'Compare with X, Threads and organic SEO only after checking incremental reach and measurable referrals.'
    ]
  };
}
