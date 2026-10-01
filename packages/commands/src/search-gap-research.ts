import { z } from 'zod';
import { fetchWebDocument } from '../../research/src/index.js';
import { serpResearchCached, serpResearchCachedShape } from './remote-keyword-research.js';

export const publicEvidenceUrl = z.string().url().max(2000)
  .refine(url => /^https?:\/\//i.test(url), 'Evidence URL must use http or https');

export const searchGapResearchShape = {
  ...serpResearchCachedShape,
  maxCacheAgeHours: z.number().min(1).max(720).default(24),
  question: z.string().trim().min(1).max(2000),
  maxPages: z.number().int().min(1).max(5).default(3),
  maxCharsPerPage: z.number().int().min(1000).max(20000).default(12000),
  evidenceUrls: z.array(publicEvidenceUrl).max(3).default([])
};

/** Read adapters supply evidence; the agent must still compare answers and record its inference. */
export async function searchGapResearch(input: unknown) {
  const args = z.object(searchGapResearchShape).strict().parse(input);
  const { question, maxPages, maxCharsPerPage, evidenceUrls, ...serpInput } = args;
  const serp = await serpResearchCached(serpInput);
  const urls = [...new Set(serp.results.map(result => result.link))].slice(0, maxPages);
  const read = async (url: string) => {
    try {
      const document = await fetchWebDocument({ url, maxChars: maxCharsPerPage });
      return { url, ...document, httpStatus: document.status, status: 'read' as const };
    } catch {
      // Do not echo credential-bearing request diagnostics. Failure is not an answer gap.
      return { url, status: 'unavailable' as const, error: 'Public page could not be read; no absence conclusion is supported.' };
    }
  };
  const documents = await Promise.all([...new Set([...urls, ...evidenceUrls])].map(read));
  return {
    question, serp,
    pages: urls.map(url => documents.find(document => document.url === url)!),
    observations: [...new Set(evidenceUrls)].map(url => documents.find(document => document.url === url)!),
    guidance: [
      'Compare the actual text with the question. Domain names, dates and title matches do not establish an unmet need.',
      'Extract a dated source excerpt and describe what the page answers and what remains unresolved. A partial/truncated or unavailable page cannot prove whole-page absence.',
      'Brave is an exploration source, not a Google ranking snapshot. Confirm Google results through the default API proxy by omitting provider; inspect provider/upstreamProvider provenance. Explicit provider=serper requires separate legacy Serper credentials and is not an alias for the proxy.',
      'Use the discovery to choose the next query and preserve that reason in the existing theme research ledger. This tool does not shortlist, save a candidate, or create a task.'
    ]
  };
}
