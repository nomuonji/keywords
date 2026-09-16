import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { getDatabase } from '@keywords/db';
import { field, firestore, value } from '../../db/src/firestore.js';
import type { SiteArticleRecord, SiteRecord } from '../../db/src/site-operations-schema.js';
import { readBlogRuntime } from '../../research/src/blog-runtime.js';
import { snapshotSchema } from './blog-contract.js';
import {
  remoteSitesStatus,
  siteArticleSave,
  siteRegistryResolve,
  siteRegistrySave
} from './remote-site-operations.js';

const { sqlite } = getDatabase();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function hashId(prefix: string, value: string) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function canonicalKey(value: string) {
  const url = new URL(value);
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, shell: false, encoding: 'utf8', timeout: 30_000, maxBuffer: 100_000, env: process.env });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '').trim() || null;
}

/** Parse only a GitHub owner/repository identity. Unknown remotes fail closed. */
export function repositoryFromGitRemote(remote: string | null | undefined) {
  const raw = remote?.trim();
  if (!raw) return null;
  const scp = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (scp) {
    const candidate = `${scp[1]}/${scp[2]}`;
    return repositoryPattern.test(candidate) ? candidate : null;
  }
  try {
    const url = new URL(raw);
    if (!['github.com', 'www.github.com', 'ssh.github.com'].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const candidate = `${parts[0]}/${parts[1]}`;
    return repositoryPattern.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function repositoryOverride() {
  const configured = process.env.KEYWORDS_SITE_REPOSITORY?.trim();
  if (!configured) return null;
  if (process.env.KEYWORDS_BLOG_WORKSPACE_ROOT?.trim()) {
    throw new Error('KEYWORDS_SITE_REPOSITORY is a single-site override and cannot be used with KEYWORDS_BLOG_WORKSPACE_ROOT');
  }
  if (!repositoryPattern.test(configured)) throw new Error('KEYWORDS_SITE_REPOSITORY must use owner/repository form');
  return configured;
}

function repositoryForRoot(root: string) {
  const configured = repositoryOverride();
  if (configured) return configured;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const repository = repositoryFromGitRemote(remote);
  if (!repository) throw new Error('The bound Blog root has no unambiguous GitHub origin remote; Sites registry bootstrap will not guess a repository');
  return repository;
}

function fileCommit(root: string, repoPath: string) {
  return git(root, ['log', '-1', '--format=%H', '--', repoPath]);
}

function pathInside(root: string, repoPath: string) {
  const absolute = resolve(root, repoPath);
  if (!existsSync(absolute)) return false;
  const lexical = relative(root, absolute);
  if (!lexical || lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) return false;
  const physicalPath = realpathSync(absolute);
  const physical = relative(root, physicalPath);
  return Boolean(physical) && physical !== '..' && !physical.startsWith(`..${sep}`) && !isAbsolute(physical) && statSync(physicalPath).isFile();
}

function decodeDocument(doc: any) {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as SiteArticleRecord;
}

async function articlesByField(fieldPath: 'localPageId' | 'canonicalUrl', expected: string) {
  const result = await firestore(':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'articles' }],
    where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: field(expected) } },
    limit: 10
  } }) });
  return (Array.isArray(result) ? result : []).flatMap((row: any) => row.document ? [decodeDocument(row.document)] : []);
}

async function resolveArticle(siteId: string, localPageId: string, canonicalUrl: string) {
  const localMatches = (await articlesByField('localPageId', localPageId)).filter(item => item.siteId === siteId);
  if (localMatches.length > 1) throw new Error(`Multiple remote articles map localPageId ${localPageId}`);
  if (localMatches[0]) return localMatches[0];
  const urlMatches = (await articlesByField('canonicalUrl', canonicalUrl)).filter(item => item.siteId === siteId);
  if (urlMatches.length > 1) throw new Error(`Multiple remote articles map canonicalUrl ${canonicalUrl}`);
  return urlMatches[0] ?? null;
}

function changedSite(current: SiteRecord | null, desired: Pick<SiteRecord, 'localProjectId' | 'name' | 'repository' | 'productionUrl' | 'deploymentProvider' | 'searchConsoleProperty' | 'status'>) {
  if (!current) return true;
  return Object.entries(desired).some(([key, expected]) => (current as any)[key] !== expected);
}

function changedArticle(current: SiteArticleRecord | null, desired: Pick<SiteArticleRecord, 'siteId' | 'localPageId' | 'canonicalUrl' | 'repo' | 'repoPath' | 'currentCommitSha' | 'slug' | 'title' | 'status'>) {
  if (!current) return true;
  return Object.entries(desired).some(([key, expected]) => (current as any)[key] !== expected);
}

function liveEvidence(projectId: string, page: any) {
  if (['sitemap', 'search_console'].includes(String(page.source)) && page.status === 'published') return true;
  return Boolean(one('SELECT id FROM page_metric_snapshots WHERE project_id=? AND (page_id=? OR url=?) LIMIT 1', projectId, page.id, page.url));
}

function searchConsoleProperty(projectId: string, origin: string) {
  return one(`SELECT property FROM measurement_imports
    WHERE project_id=? AND provider='gsc' AND completeness='complete'
      AND (target_origin=? OR target_origin IS NULL)
    ORDER BY captured_at DESC LIMIT 1`, projectId, origin)?.property ?? null;
}

function siteStatus(current: SiteRecord | null, hasLiveEvidence: boolean) {
  if (current?.status === 'paused' || current?.status === 'archived') return current.status;
  if (hasLiveEvidence) return 'active' as const;
  return current?.status ?? 'building' as const;
}

function mapping(article: SiteArticleRecord) {
  return { id: article.id, localPageId: article.localPageId, canonicalUrl: article.canonicalUrl };
}

/**
 * Bootstrap Firestore Sites identity from an already human-confirmed Blog binding.
 * No name/domain/repository inference is allowed: ambiguous or missing evidence is
 * skipped or rejected rather than silently creating a parallel identity.
 */
export async function bootstrapSiteOperationsRegistry(projectId: string) {
  const remote = remoteSitesStatus();
  if (!remote.firestoreConfigured || !remote.projectConfigured) return { status: 'skipped' as const, reason: 'firestore_not_configured', projectId };

  const project = one('SELECT id,name,domain FROM projects WHERE id=?', projectId);
  if (!project) throw new Error('Project not found');
  const binding = one('SELECT * FROM blog_bindings WHERE project_id=?', projectId);
  if (!binding) return { status: 'skipped' as const, reason: 'blog_binding_missing', projectId };

  const snapshot = snapshotSchema.parse(JSON.parse(binding.snapshot_json));
  if (snapshot.blog_site_id !== binding.blog_site_id || snapshot.canonical_origin !== binding.origin) {
    throw new Error('Blog binding snapshot identity does not match the persisted binding');
  }
  const runtime = readBlogRuntime(binding.blog_site_id, binding.origin);
  const root = realpathSync(runtime.root);
  const repository = repositoryForRoot(root);
  const observedProperty = searchConsoleProperty(projectId, binding.origin);
  const hasLiveSiteEvidence = Boolean(observedProperty || one("SELECT id FROM pages WHERE project_id=? AND source IN ('sitemap','search_console') AND status='published' LIMIT 1", projectId));

  const byProject = (await siteRegistryResolve({ localProjectId: projectId })).site as SiteRecord | null;
  const byUrl = byProject ? null : (await siteRegistryResolve({ productionUrl: binding.origin })).site as SiteRecord | null;
  const currentSite = byProject ?? byUrl;
  if (currentSite?.localProjectId && currentSite.localProjectId !== projectId) {
    throw new Error(`Production URL is already linked to another local project: ${currentSite.localProjectId}`);
  }
  if (currentSite?.repository && currentSite.repository !== repository) {
    throw new Error(`Bound Blog Git repository ${repository} conflicts with Sites registry repository ${currentSite.repository}`);
  }

  const siteId = currentSite?.id ?? hashId('site', projectId);
  const siteDesired = {
    localProjectId: projectId,
    name: String(project.name),
    repository,
    productionUrl: binding.origin,
    deploymentProvider: currentSite?.deploymentProvider ?? 'other' as const,
    searchConsoleProperty: currentSite?.searchConsoleProperty ?? observedProperty,
    status: siteStatus(currentSite, hasLiveSiteEvidence)
  };
  let site: SiteRecord;
  let siteWrite = false;
  if (changedSite(currentSite, siteDesired)) {
    site = await siteRegistrySave({
      id: siteId,
      expectedRevision: currentSite?.revision ?? 0,
      siteConceptId: currentSite?.siteConceptId ?? null,
      localProjectId: siteDesired.localProjectId,
      name: siteDesired.name,
      repository: siteDesired.repository,
      productionUrl: siteDesired.productionUrl,
      deploymentProvider: siteDesired.deploymentProvider,
      ga4PropertyId: currentSite?.ga4PropertyId ?? null,
      searchConsoleProperty: siteDesired.searchConsoleProperty,
      status: siteDesired.status
    }) as SiteRecord;
    siteWrite = true;
  } else site = currentSite!;

  const sources = new Map<string, string[]>();
  for (const source of snapshot.sources) {
    const key = canonicalKey(source.expected_url);
    const refs = sources.get(key) ?? [];
    refs.push(source.source_ref);
    sources.set(key, refs);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const skipped: Array<{ pageId: string; url: string; reason: string }> = [];
  const articleMappings: Array<{ id: string; localPageId: string | null; canonicalUrl: string | null }> = [];
  const localPages = rows("SELECT id,title,slug,status,url,source,last_seen_at FROM pages WHERE project_id=? AND url IS NOT NULL AND url!='' ORDER BY updated_at DESC", projectId);
  for (const page of localPages) {
    let key: string;
    try { key = canonicalKey(page.url); } catch { skipped.push({ pageId: page.id, url: page.url, reason: 'invalid_url' }); continue; }
    if (!key.startsWith(`${binding.origin}/`) && key !== `${binding.origin}/`) continue;
    const refs = [...new Set(sources.get(key) ?? [])];
    if (refs.length !== 1) {
      skipped.push({ pageId: page.id, url: page.url, reason: refs.length ? 'ambiguous_source_mapping' : 'source_mapping_missing' });
      continue;
    }
    const repoPath = refs[0];
    if (!pathInside(root, repoPath)) {
      skipped.push({ pageId: page.id, url: page.url, reason: 'mapped_source_file_missing_or_unsafe' });
      continue;
    }
    try {
      const existing = await resolveArticle(site.id, page.id, page.url);
      const isLive = liveEvidence(projectId, page);
      const status = existing?.status === 'paused' || existing?.status === 'archived'
        ? existing.status
        : isLive ? 'published' as const : existing?.status ?? 'draft' as const;
      const articleDesired = {
        siteId: site.id,
        localPageId: page.id,
        canonicalUrl: page.url,
        repo: repository,
        repoPath,
        currentCommitSha: fileCommit(root, repoPath),
        slug: String(page.slug || '__root__'),
        title: String(page.title || page.url),
        status
      };
      if (!changedArticle(existing, articleDesired)) {
        unchanged++;
        articleMappings.push(mapping(existing!));
        continue;
      }
      const saved = await siteArticleSave({
        id: existing?.id ?? hashId('article', `${site.id}:${page.id}`),
        expectedRevision: existing?.revision ?? 0,
        ...articleDesired,
        primaryKeywordId: existing?.primaryKeywordId ?? null,
        secondaryKeywordIds: existing?.secondaryKeywordIds ?? [],
        publishedAt: existing?.publishedAt ?? null,
        lastUpdatedAt: existing?.lastUpdatedAt ?? null
      }) as SiteArticleRecord;
      articleMappings.push(mapping(saved));
      if (existing) updated++; else created++;
    } catch (error) {
      skipped.push({ pageId: page.id, url: page.url, reason: `remote_article_not_safely_resolved: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) });
    }
  }

  return {
    status: 'bootstrapped' as const,
    projectId,
    site: { id: site.id, revision: site.revision, repository: site.repository, productionUrl: site.productionUrl, status: site.status, searchConsoleProperty: site.searchConsoleProperty },
    siteWrite,
    articles: { created, updated, unchanged, skipped: skipped.length },
    articleMappings,
    skipped: skipped.slice(0, 100),
    policy: {
      requiresConfirmedBlogBinding: true,
      requiresGitHubOriginRemote: !Boolean(repositoryOverride()),
      requiresUniqueSourceMapping: true,
      localBuildIsNotPublicationEvidence: true,
      liveEvidenceMayPromoteStatus: true
    }
  };
}
