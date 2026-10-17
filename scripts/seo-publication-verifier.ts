import {
  seoTaskList, seoTaskGet, seoTaskUpdate, siteRegistryGet,
  optimizationEventList, optimizationEventUpdate
} from '../packages/commands/src/remote-site-operations.js';
import type { SeoTaskRecord } from '../packages/db/src/site-operations-schema.js';
import { firestoreRateLimited } from './seo-delivery-throughput.js';
import { matchingPagesProject, completedProductionPagesDeployment, duePublicationBatch, publicationTargetIds, publicationWaitBudget, type PagesProject, type PagesDeployment } from './seo-publication-evidence.js';

const token = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim() ?? '';
const proofToken = process.env.SEO_PUBLICATION_GITHUB_TOKEN?.trim() || token;
const api = (repo: string, path: string) => `https://api.github.com/repos/${repo}${path}`;
const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${proofToken}`, 'x-github-api-version': '2022-11-28' };

async function gh<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Error(`GitHub deployment evidence HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function successfulDeployment(task: SeoTaskRecord): Promise<{ sha: string; at: string } | null> {
  if (!task.resultCommitSha || !/^[a-f0-9]{40}$/.test(task.resultCommitSha)) return null;
  const deployments = await gh<Array<{ id: number; sha: string; environment: string; created_at: string }>>(
    api(task.repo, '/deployments?environment=production&per_page=20')
  );
  for (const item of deployments) {
    if (!/^[a-f0-9]{40}$/.test(item.sha)) continue;
    const relation = item.sha === task.resultCommitSha ? 'identical'
      : (await gh<{ status: string }>(api(task.repo, `/compare/${task.resultCommitSha}...${item.sha}`))).status;
    if (relation !== 'identical' && relation !== 'ahead') continue;
    const statuses = await gh<Array<{ state: string; created_at: string }>>(
      api(task.repo, `/deployments/${item.id}/statuses?per_page=1`)
    );
    if (statuses[0]?.state === 'success') return { sha: item.sha, at: statuses[0].created_at };
  }
  return null;
}


// Cloudflare Pages is the actual deployment provider for most managed sites.
// GitHub Deployments is not populated by every Pages integration, so checking
// only GitHub leaves otherwise published Tasks pending indefinitely.
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const pagesApi = (path: string) => `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/pages${path}`;

async function cloudflare<T>(path: string): Promise<T> {
  const response = await fetch(pagesApi(path), {
    headers: { authorization: `Bearer ${cloudflareApiToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    // Include only Cloudflare numeric error codes in Actions logs, never
    // request headers, credentials, account IDs or arbitrary API error text.
    const failure = await response.json().catch(() => null) as { errors?: Array<{ code?: number }> } | null;
    const codes = (failure?.errors ?? []).map(error => error.code).filter(code => typeof code === 'number');
    throw Error(`Cloudflare Pages HTTP ${response.status}${codes.length ? ` codes=${codes.join(',')}` : ''}`);
  }
  const data = await response.json() as { success: boolean; errors?: unknown; result?: T };
  if (!data.success || data.result === undefined) throw Error('Cloudflare Pages reported an unsuccessful response');
  return data.result;
}

let pagesProjects: Promise<PagesProject[]> | null = null;
async function listPagesProjects(): Promise<PagesProject[]> {
  if (!pagesProjects) {
    pagesProjects = (async () => {
      // Reuse the proven unpaged endpoint used by Sites Operator's
      // cloudflare_pages_site_status. This Pages endpoint rejects our custom
      // page/per_page options with API code 8000024.
      return cloudflare<PagesProject[]>('/projects');
    })();
  }
  return pagesProjects;
}

async function successfulPagesDeployment(task: SeoTaskRecord, productionUrl: string): Promise<{ sha: string; at: string } | null> {
  if (!cloudflareAccountId || !cloudflareApiToken || !task.resultCommitSha) return null;
  const project = matchingPagesProject(await listPagesProjects(), task.repo, new URL(productionUrl).hostname);
  if (!project) return null;
  const deployments = await cloudflare<PagesDeployment[]>(
    `/projects/${encodeURIComponent(project.name)}/deployments?env=production&per_page=20`);
  for (const deployment of deployments) {
    const sha = completedProductionPagesDeployment(deployment);
    if (!sha) continue;
    const relation = sha === task.resultCommitSha ? 'identical'
      : (await gh<{ status: string }>(api(task.repo, `/compare/${task.resultCommitSha}...${sha}`))).status;
    if (relation === 'identical' || relation === 'ahead') {
      return { sha, at: deployment.created_on ?? new Date().toISOString() };
    }
  }
  return null;
}

function canonical(html: string): string | null {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => match[0])
    .find(value => /\brel=["']canonical["']/i.test(value));
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

async function publicEvidence(task: SeoTaskRecord, productionUrl: string): Promise<string> {
  const checks = task.acceptanceChecks ?? [];
  if (!task.targetUrls.length) throw Error('missing_target_urls');
  const origin = new URL(productionUrl).origin;
  for (const raw of task.targetUrls) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.origin !== origin) throw Error('target_outside_registered_site');
    const accepted = checks.filter(check => check.url === raw);
    // Legacy tasks may have no Manager text assertions. Verify actual live HTML
    // and canonical anyway; optional text/link assertions run when provided.
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw Error(`public_http_${response.status}`);
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== origin) throw Error('public_redirect_outside_site');
    const html = (await response.text()).slice(0, 2_000_000);
    if (html.length < 300 || !/<(?:main|article|body)\b/i.test(html)) throw Error('public_body_missing');
    const actual = canonical(html);
    // A slashless URL may legitimately redirect to its trailing-slash canonical.
    // Validate the actual served route, not the pre-redirect request URL.
    if (!actual || new URL(actual, finalUrl).href !== finalUrl.href) throw Error('public_canonical_mismatch');
    for (const check of accepted) {
      if (!html.includes(check.containsText)) throw Error('public_acceptance_text_missing');
      for (const link of check.internalLinks) {
        const path = new URL(link).pathname;
        if (!html.includes(link) && !html.includes(path)) throw Error('public_internal_link_missing');
      }
    }
  }
  return `public HTTP/body/canonical passed for ${task.targetUrls.length} target(s); ${checks.length ? 'explicit text/link acceptance checked' : 'no manager text assertions configured'}`;
}

async function connectEvent(task: SeoTaskRecord, publishedAt: string) {
  for (const articleId of task.articleIds.slice(0, 5)) {
    const events = (await optimizationEventList({ siteId: task.siteId, articleId, phase: 'proposed', limit: 20 })).items;
    const matches = events.filter(event => event.afterCommit === task.resultCommitSha || event.afterCommit === task.deliveryHandoff.headSha);
    if (matches.length !== 1) continue; // do not guess a relation from article ID alone
    const event = matches[0];
    await optimizationEventUpdate({
      id: event.id, expectedRevision: event.revision, phase: 'implemented',
      changedAt: publishedAt,
      evaluateAfter: new Date(Date.parse(publishedAt) + 14 * 86_400_000).toISOString()
    });
  }
}

type PublicationResult = 'verified' | 'pending' | 'failed' | 'skipped';
async function verify(task: SeoTaskRecord, immediate = false): Promise<PublicationResult> {
  if (task.status !== 'completed' || task.deploymentVerification.status === 'verified') return 'skipped';
  const site = await siteRegistryGet({ id: task.siteId });
  if (site.status !== 'active' || site.repository !== task.repo) {
    console.log(`${task.id}: inactive site or repository mismatch; pending.`);
    return 'pending';
  }
  let deployed: { sha: string; at: string } | null = null;
  if (site.deploymentProvider === 'cloudflare_pages') {
    try {
      deployed = await successfulPagesDeployment(task, site.productionUrl);
    } catch (error) {
      // A broken Pages API must not hide existing successful GitHub evidence.
      console.warn(`${task.id}: Cloudflare evidence unavailable: ${String(error)}; trying GitHub deployments.`);
    }
  }
  deployed ??= await successfulDeployment(task);
  if (!deployed) {
    console.log(`${task.id}: no successful production deployment with matching/descendant SHA; pending.`);
    return 'pending';
  }
  let detail: string;
  try {
    detail = await publicEvidence(task, site.productionUrl);
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
    const current = await seoTaskGet({ id: task.id });
    const unverifiable = /^(?:missing_|target_outside_registered_site|public_http_(?:429|5\d\d)|fetch failed|this operation was aborted|timeout)/i.test(detail);
    const nextStatus = unverifiable ? 'pending' : 'failed';
    if (immediate) {
      // Pages can report deploy success before the custom-domain body catches
      // up. Don't persist a false failure during the immediate poll window.
      // Scheduled recovery will record a persistent mismatch if it remains.
      console.log(`${task.id}: immediate page evidence not ready (${detail}); keeping pending.`);
      return 'pending';
    }
    if (current.status === 'completed'
        && (current.deploymentVerification.status !== nextStatus || current.deploymentVerification.detail !== detail)) {
      await seoTaskUpdate({ id: task.id, expectedRevision: current.revision,
        deploymentVerification: { status: nextStatus, checkedAt: new Date().toISOString(), productionUrl: site.productionUrl, deployedCommitSha: deployed.sha, detail }
      });
    }
    console.log(`${task.id}: deployment exists but publication check failed: ${detail}`);
    return nextStatus;
  }
  const current = await seoTaskGet({ id: task.id });
  if (current.status !== 'completed' || current.resultCommitSha !== task.resultCommitSha
      || current.deploymentVerification.status === 'verified') return 'skipped';
  await seoTaskUpdate({ id: task.id, expectedRevision: current.revision,
    deploymentVerification: { status: 'verified', checkedAt: new Date().toISOString(),
      productionUrl: site.productionUrl, deployedCommitSha: deployed.sha, detail: `${detail}; deployment=${deployed.sha}` }
  });
  await connectEvent(task, deployed.at);
  console.log(`${task.id}: verified ${deployed.sha}; optimization window linked where uniquely matched.`);
  return 'verified';
}


async function verifyNewlyCompletedTasks(ids: string[]) {
  const deadline = Date.now() + publicationWaitBudget(process.env.SEO_PUBLICATION_WAIT_MS);
  const outstanding = new Set(ids);
  const pollInterval = 20_000;
  console.log(`Immediate publication verification for ${outstanding.size} newly merged Task(s).`);
  do {
    for (const id of [...outstanding]) {
      try {
        const task = await seoTaskGet({ id });
        if (task.status !== 'completed' || task.deploymentVerification.status === 'verified') {
          outstanding.delete(id);
          continue;
        }
        const result = await verify(task, true);
        if (result === 'verified' || result === 'skipped' || result === 'failed') outstanding.delete(id);
      } catch (error) {
        if (firestoreRateLimited(error)) {
          console.warn('Firestore 429: defer immediate publication checks to scheduled recovery.');
          return;
        }
        console.warn(`${id}: immediate publication evidence unavailable: ${String(error)}`);
        // Missing repository deployment records do not appear by retrying
        // with the same credentials; let scheduled recovery handle this case.
        if (/GitHub deployment evidence HTTP (?:403|404)/.test(String(error))) outstanding.delete(id);
      }
    }
    if (!outstanding.size || Date.now() >= deadline) break;
    const wait = Math.min(pollInterval, Math.max(0, deadline - Date.now()));
    if (!wait) break;
    await new Promise(resolve => setTimeout(resolve, wait));
  } while (outstanding.size);
  if (outstanding.size) {
    console.log(`Immediate publication timeout: ${[...outstanding].join(',')}; left pending for scheduled recovery.`);
  } else {
    console.log('Immediate publication checks complete; no pending poll targets.');
  }
}

if (token) {
  if (!cloudflareAccountId || !cloudflareApiToken) {
    console.error('::error::Publication verifier is missing CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_API_TOKEN in the keywords Actions environment. Most sites publish via Cloudflare Pages; configure the repository variable and read-only repository secret to enable provider-specific production proof. GitHub deployments alone are not sufficient for these sites.');
    // Do not report a healthy green publication run when its provider cannot
    // be queried. Continue bounded GitHub fallback work, but surface the blocker.
    process.exitCode = 1;
  }
  try {
    const immediateIds = publicationTargetIds(process.env.SEO_PUBLICATION_TARGET_TASK_IDS);
    if (immediateIds.length) {
      await verifyNewlyCompletedTasks(immediateIds);
    } else {
    const [pending, failed] = await Promise.all([
      seoTaskList({ status: 'completed', deploymentVerificationStatus: 'pending', limit: 100 }),
      seoTaskList({ status: 'completed', deploymentVerificationStatus: 'failed', limit: 100 })
    ]);
    // Sweep different due Tasks every 2h even when a blocked Task cannot
    // produce fresh evidence (and therefore must not be rewritten to Firestore).
    const due = duePublicationBatch([...pending.items, ...failed.items], Date.now(), 12);
    let quotaStopped = false;
    for (const task of due) {
      try { await verify(task); }
      catch (error) {
        if (firestoreRateLimited(error)) { console.warn('Firestore 429: publication batch stopped.'); quotaStopped = true; break; }
        console.error(`${task.id}: publication evidence unavailable: ${String(error)}`);
      }
    }
    // A Task verification and its Optimization Event update are separate
    // documents. Reconcile recent verified Tasks after a transient event write
    // failure; connectEvent itself only advances a unique proposed match.
    if (!quotaStopped) {
    const verified = await seoTaskList({ status: 'completed', deploymentVerificationStatus: 'verified', limit: 100 });
    for (const task of verified.items
      .filter(item => item.articleIds.length && item.deploymentVerification.checkedAt
        && Date.now() - Date.parse(item.deploymentVerification.checkedAt) < 30 * 86_400_000)
      .slice(0, 4)) {
      try { await connectEvent(task, task.deploymentVerification.checkedAt!); }
      catch (error) {
        if (firestoreRateLimited(error)) { console.warn('Firestore 429: event reconciliation stopped.'); break; }
        console.error(`${task.id}: event reconciliation unavailable: ${String(error)}`);
      }
    }
    }
    console.log(`Publication verifier considered ${due.length} due Task(s).`);
    }
  } catch (error) {
    if (firestoreRateLimited(error)) console.warn('Firestore 429: publication batch skipped.');
    else throw error;
  }
} else {
  console.warn('SEO_DELIVERY_GITHUB_TOKEN missing; publication verifier idle.');
}
