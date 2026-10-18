import { z } from 'zod';
import { isIP } from 'node:net';
import { fetchPublicJson, fetchWebDocument, type SerpSnapshot } from '../../research/src/index.js';
import { serpResearchCached, serpResearchCachedShape } from './remote-keyword-research.js';

const multiPartSuffixes = new Set([
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'ed.jp',
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au',
  'co.kr', 'or.kr', 'com.br', 'com.mx', 'com.cn', 'com.tw'
]);
const sharedHosting = [
  'github.io', 'pages.dev', 'vercel.app', 'netlify.app', 'blogspot.com',
  'wordpress.com', 'medium.com', 'note.com', 'substack.com', 'wixsite.com'
];

/** Conservative domain grouping. Unknown public suffixes may be grouped inaccurately. */
export function registeredDomain(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (sharedHosting.some(suffix => host === suffix || host.endsWith('.' + suffix))) return null;
  if (isIP(host) || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.includes('..')) return null;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  const suffix = labels.slice(-2).join('.');
  const take = multiPartSuffixes.has(suffix) ? 3 : 2;
  return labels.length >= take ? labels.slice(-take).join('.') : null;
}

export const youngDomainSerpResearchShape = {
  queries: z.array(z.string().trim().min(2).max(200)).min(1).max(5),
  country: z.string().min(2).max(2).default('jp'),
  language: z.string().min(2).max(10).default('ja'),
  num: z.number().int().min(5).max(10).default(10),
  maxCacheAgeHours: z.number().min(1).max(720).default(168),
  ageDays: z.number().int().min(30).max(730).default(365),
  maxRdapChecks: z.number().int().min(1).max(8).default(8),
  maxPageReads: z.number().int().min(0).max(4).default(2),
  excludeDomains: z.array(z.string().min(3).max(253)).max(30).default([]),
  provider: z.enum(['api', 'brave']).default('api')
};

type SerpHit = {
  query: string; position: number | null; title: string; url: string;
  provider: string; upstreamProvider: string | null; observedAt: string;
};
type DomainRecord = {
  domain: string; hosts: string[]; queryCount: number;
  bestPosition: number | null; appearances: SerpHit[];
};

type RdapPayload = {
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  ldhName?: string; objectClassName?: string;
};
export function readRegistrationEvent(payload: RdapPayload, now = Date.now()) {
  const dates = (payload.events ?? [])
    .filter(event => event.eventAction?.toLowerCase() === 'registration')
    .map(event => ({ date: event.eventDate, ms: Date.parse(event.eventDate ?? '') }))
    .filter(event => Number.isFinite(event.ms) && event.ms <= now);
  // RDAP is registration history, never evidence of first publication or site age.
  const earliest = dates.sort((a, b) => a.ms - b.ms)[0];
  return earliest ? { registrationDate: new Date(earliest.ms).toISOString(), domainAgeDays: Math.floor((now - earliest.ms) / 86_400_000) } : { registrationDate: null, domainAgeDays: null };
}

async function rdapLookup(domain: string) {
  const source = 'https://rdap.org/domain/' + domain;
  const response = await fetchPublicJson<RdapPayload>({ url: source, maxBytes: 150_000 });
  return { payload: response.data, url: response.finalUrl };
}

type Dependencies = {
  serp: (input: Parameters<typeof serpResearchCached>[0]) => Promise<any>;
  rdap: (domain: string) => Promise<{ payload: RdapPayload; url: string }>;
  page: typeof fetchWebDocument;
};
const liveDependencies: Dependencies = { serp: serpResearchCached, rdap: rdapLookup, page: fetchWebDocument };

/**
 * A bounded, read-only evidence packet. Neither a young registration date
 * nor a top SERP appearance demonstrates Google success or an SEO cause.
 */
export async function youngDomainSerpResearch(input: unknown, dependencies: Dependencies = liveDependencies) {
  const args = z.object(youngDomainSerpResearchShape).strict().parse(input);
  const queries = [...new Set(args.queries.map(q => q.normalize('NFKC').trim()))];
  const excluded = new Set(args.excludeDomains.map(domain => registeredDomain(domain)).filter((d): d is string => Boolean(d)));
  const snapshots: SerpSnapshot[] = [];
  const errors: Array<{ stage: string; target: string; reason: string }> = [];
  let stoppedEarly = false;
  for (const query of queries) {
    try {
      const result = await dependencies.serp({
        query, country: args.country, language: args.language,
        num: args.num, provider: args.provider, maxCacheAgeHours: args.maxCacheAgeHours
      });
      snapshots.push(result);
    } catch (error) {
      // A quota/429 failure stops the batch; never amplify a depleted provider.
      errors.push({ stage: 'serp', target: query, reason: 'SERP lookup unavailable or quota-limited.' });
      if (/429|limit|quota|reserve|budget/i.test(String(error))) {
        stoppedEarly = true;
        break;
      }
    }
  }
  const found = new Map<string, { hosts: Set<string>; hits: SerpHit[] }>();
  for (const snapshot of snapshots) {
    for (const result of snapshot.results) {
      let host: string;
      try {
        const parsed = new URL(result.link);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      } catch { continue; }
      const domain = registeredDomain(host);
      if (!domain || excluded.has(domain)) continue;
      const record = found.get(domain) ?? { hosts: new Set<string>(), hits: [] };
      record.hosts.add(host);
      record.hits.push({
        query: snapshot.query, position: result.position, title: result.title,
        url: result.link, provider: snapshot.provider,
        upstreamProvider: snapshot.upstreamProvider ?? null, observedAt: snapshot.fetchedAt
      });
      found.set(domain, record);
    }
  }
  const domainRecords: DomainRecord[] = [...found].map(([domain, record]) => ({
    domain, hosts: [...record.hosts],
    queryCount: new Set(record.hits.map(hit => hit.query)).size,
    bestPosition: record.hits.reduce<number | null>((best, hit) =>
      hit.position === null ? best : best === null ? hit.position : Math.min(best, hit.position), null),
    appearances: record.hits
  })).sort((a, b) => b.queryCount - a.queryCount || (a.bestPosition ?? 999) - (b.bestPosition ?? 999));

  // rdap.org documents a 10-requests/10-second public limit. Keep each call <= 8.
  const checked = await Promise.all(domainRecords.slice(0, args.maxRdapChecks).map(async record => {
    try {
      const result = await dependencies.rdap(record.domain);
      const registration = readRegistrationEvent(result.payload);
      return {
        ...record, ...registration, rdapUrl: result.url,
        registrationStatus: registration.domainAgeDays === null ? 'unknown' as const
          : registration.domainAgeDays <= args.ageDays ? 'recent_registration' as const : 'older_registration' as const
      };
    } catch {
      errors.push({ stage: 'rdap', target: record.domain, reason: 'Registration data unavailable; age is unknown.' });
      return {
        ...record, registrationDate: null, domainAgeDays: null, rdapUrl: null,
        registrationStatus: 'unknown' as const
      };
    }
  }));
  const recent = checked.filter(item => item.registrationStatus === 'recent_registration');
  const unknown = checked.filter(item => item.registrationStatus === 'unknown');
  const selected = [...recent, ...unknown].slice(0, args.maxPageReads);
  const pageReviews = await Promise.all(selected.map(async candidate => {
    const hit = [...candidate.appearances].sort((a, b) => (a.position ?? 999) - (b.position ?? 999))[0];
    try {
      const document = await dependencies.page({ url: hit.url, maxChars: 6000 });
      return { domain: candidate.domain, url: hit.url, status: 'read' as const, title: document.title,
        text: document.text, truncated: document.truncated, finalUrl: document.finalUrl, fetchedAt: document.fetchedAt };
    } catch {
      errors.push({ stage: 'page', target: candidate.domain, reason: 'Public page unavailable; no content-gap conclusion is supported.' });
      return { domain: candidate.domain, url: hit.url, status: 'unavailable' as const };
    }
  }));

  return {
    criteria: { queries, country: args.country, language: args.language, num: args.num,
      ageDays: args.ageDays, provider: args.provider, maxRdapChecks: args.maxRdapChecks },
    coverage: { attemptedQueries: snapshots.length + (errors.filter(e => e.stage === 'serp').length),
      completedQueries: snapshots.length, rdapChecked: checked.length,
      domainCandidatesSeen: domainRecords.length, stoppedEarly },
    recentRegistrationCandidates: recent,
    unknownRegistrationCandidates: unknown,
    olderRegistrationCount: checked.filter(item => item.registrationStatus === 'older_registration').length,
    uncheckedDomainCount: Math.max(0, domainRecords.length - checked.length),
    pageReviews,
    errors,
    guidance: [
      'Recent domain registration is not proof of a new website; re-registration, reused domains, old content, link history and brand support require separate checks.',
      'SERP positions are provider snapshots, not traffic, stable rankings, Google Search Console metrics or proof of SEO causation. Brave results must never be represented as Google rankings.',
      'Public suffix grouping uses a limited heuristic, so verify unusual TLDs, multi-tenant domains, and country-specific suffixes manually.',
      'Compare actual page bodies, intent, originality and same-period unsuccessful sites before forming a hypothesis; do not auto-create SEO tasks or mass-publish pages.',
      'This tool performs no recurring monitoring or persistence beyond the existing shared SERP cache/quota ledger.'
    ]
  };
}
