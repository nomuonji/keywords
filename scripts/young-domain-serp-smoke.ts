import assert from 'node:assert/strict';
import { readRegistrationEvent, registeredDomain, youngDomainSerpResearch } from '../packages/commands/src/young-domain-serp-research.js';

assert.equal(registeredDomain('www.blog.example.co.jp'), 'example.co.jp');
assert.equal(registeredDomain('www.example.com'), 'example.com');
assert.equal(registeredDomain('example.github.io'), null);
assert.equal(registeredDomain('localhost'), null);
assert.equal(registeredDomain('127.0.0.1'), null);
assert.equal(registeredDomain('bad..com'), null);

const recentDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
const oldDate = new Date(Date.now() - 1_500 * 86_400_000).toISOString();
assert.equal(readRegistrationEvent({ events: [{ eventAction: 'registration', eventDate: recentDate }] }).domainAgeDays, 45);
assert.equal(readRegistrationEvent({ events: [{ eventAction: 'last changed', eventDate: recentDate }] }).domainAgeDays, null);
assert.equal(readRegistrationEvent({ events: [{ eventAction: 'registration', eventDate: oldDate }, { eventAction: 'registration', eventDate: recentDate }] }).domainAgeDays, 1500);

let rdapCalls: string[] = [];
let pageCalls: string[] = [];
let serpCalls: string[] = [];
const deps = {
  serp: async ({ query, provider }: { query: string; provider?: string }) => {
    serpCalls.push(query);
    assert.equal(provider, 'api');
    if (query === 'rate limit') throw new Error('SERP quota reached');
    return {
      query, provider: 'api', upstreamProvider: 'reserp', fetchedAt: '2026-10-18T00:00:00.000Z',
      results: query === 'one'
        ? [
          { position: 1, title: 'Established article', link: 'https://oldmedia.com/a', domain: 'oldmedia.com', snippet: '' },
          { position: 2, title: 'New specialist', link: 'https://www.newsite.com/a', domain: 'newsite.com', snippet: '' },
          { position: 4, title: 'Hosted platform', link: 'https://somebody.github.io/post', domain: 'somebody.github.io', snippet: '' }
        ]
        : [
          { position: 1, title: 'New comparison', link: 'https://blog.newsite.com/b', domain: 'blog.newsite.com', snippet: '' },
          { position: 3, title: 'Unknown registration', link: 'https://unknownsite.com/c', domain: 'unknownsite.com', snippet: '' }
        ],
      peopleAlsoAsk: [], relatedSearches: []
    } as any;
  },
  rdap: async (domain: string) => {
    rdapCalls.push(domain);
    if (domain === 'unknownsite.com') throw Error('not supported');
    return {
      url: 'https://rdap.example/' + domain,
      payload: { events: [{ eventAction: 'registration', eventDate: domain === 'newsite.com' ? recentDate : oldDate }] }
    };
  },
  page: async ({ url }: { url: string }) => {
    pageCalls.push(url);
    return { title: 'Evidence', text: 'Actual extracted page body', truncated: false, finalUrl: url, fetchedAt: '2026-10-18T00:00:00.000Z' } as any;
  }
};
const result = await youngDomainSerpResearch({
  queries: ['one', 'two'], ageDays: 365, maxRdapChecks: 8, maxPageReads: 2
}, deps as any);
assert.deepEqual(serpCalls, ['one', 'two']);
assert.equal(result.coverage.completedQueries, 2);
assert.equal(result.coverage.domainCandidatesSeen, 3);
assert.equal(result.coverage.rdapChecked, 3);
assert.deepEqual(new Set(rdapCalls), new Set(['newsite.com', 'oldmedia.com', 'unknownsite.com']));
assert.equal(result.recentRegistrationCandidates.length, 1);
assert.equal(result.recentRegistrationCandidates[0].domain, 'newsite.com');
assert.equal(result.recentRegistrationCandidates[0].queryCount, 2);
assert.equal(result.recentRegistrationCandidates[0].bestPosition, 1);
assert.equal(result.recentRegistrationCandidates[0].appearances[0].upstreamProvider, 'reserp');
assert.equal(result.olderRegistrationCount, 1);
assert.equal(result.unknownRegistrationCandidates[0].domain, 'unknownsite.com');
assert.equal(result.pageReviews.length, 2);
assert.ok(pageCalls.every(url => !url.includes('oldmedia.com')));

serpCalls = []; rdapCalls = []; pageCalls = [];
const stopped = await youngDomainSerpResearch({ queries: ['one', 'rate limit', 'two'], maxRdapChecks: 1, maxPageReads: 0 }, deps as any);
assert.equal(stopped.coverage.stoppedEarly, true);
assert.deepEqual(serpCalls, ['one', 'rate limit']);
assert.equal(stopped.coverage.completedQueries, 1);
assert.equal(stopped.coverage.rdapChecked, 1);
assert.equal(stopped.pageReviews.length, 0);

console.log('young domain SERP discovery smoke: ok');
