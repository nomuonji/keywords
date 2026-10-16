import {
  seoTaskList, seoTaskGet, seoTaskUpdate, siteRegistryGet,
  optimizationEventList, optimizationEventUpdate
} from '../packages/commands/src/remote-site-operations.js';
import type { SeoTaskRecord } from '../packages/db/src/site-operations-schema.js';
import { firestoreRateLimited } from './seo-delivery-throughput.js';

const token = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim() ?? '';
const api = (repo: string, path: string) => `https://api.github.com/repos/${repo}${path}`;
const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' };

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

function canonical(html: string): string | null {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => match[0])
    .find(value => /\brel=["']canonical["']/i.test(value));
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

async function publicEvidence(task: SeoTaskRecord, productionUrl: string): Promise<string> {
  const checks = task.acceptanceChecks ?? [];
  if (!checks.length || !task.targetUrls.length) throw Error('missing_manager_fixed_acceptance');
  const origin = new URL(productionUrl).origin;
  for (const raw of task.targetUrls) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.origin !== origin) throw Error('target_outside_registered_site');
    const accepted = checks.filter(check => check.url === raw);
    if (!accepted.length) throw Error('missing_target_acceptance');
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw Error(`public_http_${response.status}`);
    if (new URL(response.url).origin !== origin) throw Error('public_redirect_outside_site');
    const html = (await response.text()).slice(0, 2_000_000);
    if (html.length < 300 || !/<(?:main|article|body)\b/i.test(html)) throw Error('public_body_missing');
    const actual = canonical(html);
    if (!actual || new URL(actual, url).href !== url.href) throw Error('public_canonical_mismatch');
    for (const check of accepted) {
      if (!html.includes(check.containsText)) throw Error('public_acceptance_text_missing');
      for (const link of check.internalLinks) {
        const path = new URL(link).pathname;
        if (!html.includes(link) && !html.includes(path)) throw Error('public_internal_link_missing');
      }
    }
  }
  return `public HTTP/body/canonical/acceptance passed for ${task.targetUrls.length} target(s)`;
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

async function verify(task: SeoTaskRecord) {
  const site = await siteRegistryGet({ id: task.siteId });
  if (site.status !== 'active' || site.repository !== task.repo) return;
  const deployed = await successfulDeployment(task);
  if (!deployed) {
    console.log(`${task.id}: no successful production deployment with matching/descendant SHA; pending.`);
    return;
  }
  let detail: string;
  try {
    detail = await publicEvidence(task, site.productionUrl);
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
    const current = await seoTaskGet({ id: task.id });
    const unverifiable = /^(?:missing_|target_outside_registered_site)/.test(detail);
    const nextStatus = unverifiable ? 'pending' : 'failed';
    if (current.status === 'completed'
        && (current.deploymentVerification.status !== nextStatus || current.deploymentVerification.detail !== detail)) {
      await seoTaskUpdate({ id: task.id, expectedRevision: current.revision,
        deploymentVerification: { status: nextStatus, checkedAt: new Date().toISOString(), productionUrl: site.productionUrl, deployedCommitSha: deployed.sha, detail }
      });
    }
    console.log(`${task.id}: deployment exists but publication check failed: ${detail}`);
    return;
  }
  const current = await seoTaskGet({ id: task.id });
  if (current.status !== 'completed' || current.resultCommitSha !== task.resultCommitSha
      || current.deploymentVerification.status === 'verified') return;
  await seoTaskUpdate({ id: task.id, expectedRevision: current.revision,
    deploymentVerification: { status: 'verified', checkedAt: new Date().toISOString(),
      productionUrl: site.productionUrl, deployedCommitSha: deployed.sha, detail: `${detail}; deployment=${deployed.sha}` }
  });
  await connectEvent(task, deployed.at);
  console.log(`${task.id}: verified ${deployed.sha}; optimization window linked where uniquely matched.`);
}

if (token) {
  try {
    const [pending, failed] = await Promise.all([
      seoTaskList({ status: 'completed', deploymentVerificationStatus: 'pending', limit: 100 }),
      seoTaskList({ status: 'completed', deploymentVerificationStatus: 'failed', limit: 100 })
    ]);
    const due = [...pending.items, ...failed.items]
      .filter(task => !task.deploymentVerification.checkedAt
        || Date.now() - Date.parse(task.deploymentVerification.checkedAt) >= 86_400_000)
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
      .slice(0, 4);
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
  } catch (error) {
    if (firestoreRateLimited(error)) console.warn('Firestore 429: publication batch skipped.');
    else throw error;
  }
} else {
  console.warn('SEO_DELIVERY_GITHUB_TOKEN missing; publication verifier idle.');
}
