import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { hostOf, readPortfolio } from '@keywords/research/portfolio';
import { articleKeywordResearchEvidence, articleRuntime, safeArtifactPath, headlessCommands } from './headless.js';

const { db, sqlite } = getDatabase();
const hasTable = (name: string) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const hashText = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

function frontmatterValue(frontmatter: string, key: string) {
  return frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}

function localBlogArticles(projectId: string, artifactPaths: Set<string>) {
  const projects = projectId ? [{id:projectId}] : sqlite.prepare('SELECT id FROM projects').all() as Array<{id:string}>;
  return projects.flatMap(project => localBlogArticlesForProject(project.id, artifactPaths));
}

function localBlogArticlesForProject(projectId: string, artifactPaths: Set<string>) {
  let runtime: ReturnType<typeof articleRuntime>;
  try { runtime = articleRuntime(projectId); } catch { return []; }
  const root = runtime.root;
  const scanRef = (process.env.KEYWORDS_BLOG_ARTICLE_SCAN_DIR?.trim() || 'content/posts').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  const scanDir = resolve(root, scanRef);
  const scanRelative = relative(root, scanDir);
  if (!scanRelative || scanRelative === '..' || scanRelative.startsWith('..\\') || scanRelative.startsWith('../')) return [];
  const projects = sqlite.prepare('SELECT id,name,domain FROM projects WHERE id=?').all(projectId) as any[];
  const pages = sqlite.prepare(`SELECT p.id,p.project_id,p.title,p.slug,p.url,pr.name AS project_name,pr.domain AS project_domain
    FROM pages p JOIN projects pr ON pr.id=p.project_id WHERE p.project_id=?`).all(projectId) as any[];
  let rootHost: string | null = null;
  try {
    const site = parse(readFileSync(resolve(root, 'content/site.json'), 'utf8'), {} as any);
    rootHost = site.url ? new URL(String(site.url)).hostname : null;
  } catch {}
  const rootProjects = rootHost ? projects.filter(project => hostOf(project.domain) === rootHost) : [];
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && ['.md', '.mdx'].includes(extname(entry.name).toLowerCase())) files.push(absolute);
    }
  };
  try {
    const scanRoots = runtime.bound ? runtime.collections.map(collection => safeArtifactPath(collection.root, projectId).absolute) : [scanDir];
    for (const directory of new Set(scanRoots)) if (existsSync(directory)) visit(directory);
  } catch { return []; }
  return files.flatMap(absolute => {
    try {
      const path = relative(root, absolute).replaceAll('\\', '/');
      if (artifactPaths.has(`${projectId}:${path}`)) return [];
      safeArtifactPath(path, projectId);
      const content = readFileSync(absolute, 'utf8');
      const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
      const frontmatter = match?.[1] ?? '';
      const filename = basename(path, extname(path));
      const stem = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const page = pages.find(item => {
        try {
          const pageStem = item.url ? new URL(item.url).pathname.replace(/\/+$/, '').split('/').pop() : null;
          return pageStem === stem || (frontmatterValue(frontmatter, 'title') && item.title === frontmatterValue(frontmatter, 'title'));
        } catch { return false; }
      });
      const project = runtime.bound ? projects[0] : page ? projects.find(item => item.id === page.project_id) : rootProjects.length === 1 ? rootProjects[0] : null;
      if (!project || (projectId && project.id !== projectId)) return [];
      const id = `local-file-${hashText(`${projectId}:${path}`).slice(0, 32)}`;
      const stat = statSync(absolute);
      const research = articleKeywordResearchEvidence(project.id, page?.id ?? null);
      return [{
        id, recordType: 'local_file', operationId: null, projectId: project.id, projectName: project.name, projectDomain: project.domain,
        pageId: page?.id ?? null, articleId: page?.id ?? id, title: frontmatterValue(frontmatter, 'title') ?? stem, slug: stem,
        url: page?.url ?? null, path, contentSha256: hashText(content), validatorStatus: 'not_registered', buildStatus: 'not_recorded', verifiedAt: null,
        revisionCount: 0, failedChecks: [], updatedAt: stat.mtime.toISOString(), keyword: research.keyword, keywordResearch: research, outcome: null, content
      }];
    } catch { return []; }
  });
}

function outcomeFor(operationId: string, projectId: string) {
  if (!hasTable('operation_outcomes')) return null;
  const row = sqlite.prepare('SELECT * FROM operation_outcomes WHERE operation_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1').get(operationId, projectId) as any;
  if (!row) return null;
  return {
    status: row.outcome_status,
    publishedAt: row.published_at,
    evaluationDueAt: row.evaluation_due_at,
    metrics: parse(row.metrics_json, {}),
    nextAction: row.next_action,
    updatedAt: row.updated_at
  };
}

export const portfolioCommands = {
  async articleIndex(input: { query?: string; projectId?: string; status?: string; limit?: number; offset?: number } = {}) {
    const query = input.query?.trim().toLowerCase() ?? '';
    const projectId = input.projectId?.trim() ?? '';
    const status = input.status?.trim() ?? 'all';
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const clauses: string[] = ["COALESCE(a.deleted_at,'')=''"];
    const args: unknown[] = [];
    if (projectId) { clauses.push('a.project_id=?'); args.push(projectId); }
    if (query) {
      clauses.push("(LOWER(COALESCE(p.title,a.article_id)) LIKE ? OR LOWER(pr.name) LIKE ? OR LOWER(COALESCE(k.text,'')) LIKE ?)");
      const pattern = `%${query}%`; args.push(pattern, pattern, pattern);
    }
    if (status === 'complete') clauses.push("a.validator_status='passed' AND a.build_status='passed' AND a.verified_at IS NOT NULL");
    if (status === 'in_progress') clauses.push("NOT (a.validator_status='passed' AND a.build_status='passed' AND a.verified_at IS NOT NULL)");
    if (status === 'regressed') clauses.push("EXISTS (SELECT 1 FROM operation_outcomes oo WHERE oo.operation_id=a.operation_id AND oo.project_id=a.project_id AND oo.outcome_status='regressed')");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const base = `FROM operation_artifacts a
      LEFT JOIN pages p ON p.id=a.page_id
      JOIN projects pr ON pr.id=a.project_id
      LEFT JOIN keywords k ON k.id=(SELECT pk.keyword_id FROM page_keywords pk WHERE pk.page_id=a.page_id ORDER BY CASE pk.role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1)`;
    const rows = status === 'local' ? [] : sqlite.prepare(`SELECT a.*,p.title,p.slug,p.status AS page_status,p.url,k.id AS keyword_id,k.text AS keyword_text,k.avg_monthly,k.gsc_clicks,k.gsc_impressions,k.gsc_position,pr.name AS project_name,pr.domain AS project_domain,
      (SELECT d.reason FROM decisions d JOIN discovery_candidates dc ON dc.id=d.target_id WHERE d.target_type='discovery_candidate' AND d.action='operation.candidate_triage' AND d.verdict='shortlisted' AND dc.keyword_id=k.id ORDER BY d.created_at DESC LIMIT 1) AS selection_reason
      ${base} ${where} ORDER BY a.updated_at DESC`).all(...args) as any[];
    const artifactItems = rows.map(row => {
      const validatorResult = parse<any>(row.validator_result_json, null);
      const keywordResearch = articleKeywordResearchEvidence(row.project_id, row.page_id ?? null);
      return {
        id: row.id,
        recordType: 'artifact',
        operationId: row.operation_id,
        projectId: row.project_id,
        projectName: row.project_name,
        projectDomain: row.project_domain,
        pageId: row.page_id,
        articleId: row.article_id,
        title: row.title ?? row.article_id,
        slug: row.slug ?? null,
        url: row.url ?? null,
        path: row.artifact_path,
        contentSha256: row.content_sha256,
        validatorStatus: row.validator_status,
        buildStatus: row.build_status,
        verifiedAt: row.verified_at,
        revisionCount: Number(row.revision_count ?? 0),
        failedChecks: validatorResult?.failedChecks ?? [],
        updatedAt: row.updated_at,
        keyword: keywordResearch.keyword ?? (row.keyword_id ? { id: row.keyword_id, text: row.keyword_text, avgMonthly: row.avg_monthly, clicks: row.gsc_clicks, impressions: row.gsc_impressions, position: row.gsc_position, selectionReason: row.selection_reason ?? null } : null),
        keywordResearch,
        outcome: outcomeFor(row.operation_id, row.project_id)
      };
    });
    const artifactPaths = new Set(artifactItems.map(item => `${item.projectId}:${item.path}`));
    const localItems = ['all','local'].includes(status) ? localBlogArticles(projectId, artifactPaths).filter(item => {
      if (query) return `${item.title} ${item.projectName} ${item.path} ${item.slug}`.toLowerCase().includes(query);
      return true;
    }).map(({ content: _content, ...item }) => item) : [];
    const items = [...artifactItems, ...localItems].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { generatedAt: new Date().toISOString(), total: items.length, limit, offset, items: items.slice(offset, offset + limit) };
  },

  async articleContent(articleId: string) {
    const artifact = sqlite.prepare("SELECT id FROM operation_artifacts WHERE id=? AND deleted_at IS NULL").get(articleId) as any;
    if (artifact) return headlessCommands.content(articleId);
    const local = localBlogArticles('', new Set()).find(item => item.id === articleId);
    if (!local) throw new Error('Article not found');
    return { artifact: null, path: local.path, exists: true, content: local.content, actualSha256: local.contentSha256, contentMatches: true };
  },

  async deleteArticle(ctx: CommandContext, input: { projectId: string; articleId: string; reason?: string }) {
    if (ctx.actor !== 'human') throw new Error('Article deletion requires a human actor');
    const runId = randomUUID();
    const runInput = { projectId: input.projectId, articleId: input.articleId, reason: input.reason ?? null };
    try {
      const root = articleRuntime(input.projectId).root;
      const local = localBlogArticles(input.projectId, new Set()).find(item => item.id === input.articleId);
      const artifact = sqlite.prepare("SELECT * FROM operation_artifacts WHERE id=? AND project_id=? AND deleted_at IS NULL").get(input.articleId, input.projectId) as any;
      if (!local && !artifact) throw new Error('Article not found or already deleted');
      const path = local?.path ?? artifact.artifact_path;
      const title = local?.title ?? (sqlite.prepare('SELECT title FROM pages WHERE id=? AND project_id=?').get(artifact.page_id, input.projectId) as any)?.title ?? artifact.article_id;
      const absolute = safeArtifactPath(path, input.projectId).absolute;
      const relativePath = relative(root, absolute);
      if (!relativePath || relativePath === '..' || relativePath.startsWith('..\\') || relativePath.startsWith('../') || absolute === root) throw new Error('Article path escapes KEYWORDS_BLOG_ROOT');
      if (!existsSync(absolute)) throw new Error('Local article file no longer exists');
      unlinkSync(absolute);
      const reason = input.reason?.trim() || 'Deleted from the Articles UI after human confirmation.';
      const decisionId = randomUUID();
      sqlite.prepare('INSERT INTO decisions(id,project_id,actor,action,target_type,target_id,verdict,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(decisionId, input.projectId, ctx.actor, 'article.delete', local ? 'local_file' : 'operation_artifact', input.articleId, 'deleted', reason, JSON.stringify({ path, title, recordType: local ? 'local_file' : 'artifact', verified: Boolean(artifact?.verified_at), deleted: true }), now());
      if (artifact) sqlite.prepare("UPDATE operation_artifacts SET deleted_at=?,deleted_by=?,validator_status='deleted',build_status='deleted',verified_at=NULL,updated_at=? WHERE id=?").run(now(), ctx.actorId ?? ctx.actor, now(), artifact.id);
      const output = { articleId: input.articleId, status: 'deleted', deleted: true, path, recordType: local ? 'local_file' : 'artifact', decisionId };
      sqlite.prepare('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(runId, input.projectId, ctx.workSessionId ?? null, ctx.actor, ctx.actorId ?? null, 'article.delete', 'succeeded', JSON.stringify(runInput), JSON.stringify(output), now());
      return output;
    } catch (error) {
      sqlite.prepare('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(runId, input.projectId, ctx.workSessionId ?? null, ctx.actor, ctx.actorId ?? null, 'article.delete', 'failed', JSON.stringify(runInput), error instanceof Error ? error.message : String(error), now());
      throw error;
    }
  },

  async rejectArticle(ctx: CommandContext, input: { projectId: string; articleId: string; reason?: string }) {
    return portfolioCommands.deleteArticle(ctx, input);
  },

  async context() {
    const [snapshot, articles] = await Promise.all([readPortfolio(), headlessCommands.dashboard()]);
    const projects = await db.select().from(schema.projects);
    const tasks = await db.select().from(schema.tasks);
    const reviews = await db.select().from(schema.reviewRequests);
    const sites = [...snapshot.sites];
    const allArtifacts = hasTable('operation_artifacts') ? sqlite.prepare('SELECT project_id,validator_status,build_status,verified_at FROM operation_artifacts').all() as any[] : [];
    const allOutcomes = hasTable('operation_outcomes') ? sqlite.prepare('SELECT project_id,outcome_status,published_at FROM operation_outcomes').all() as any[] : [];
    const keywordChoices = sqlite.prepare(`SELECT d.id,d.project_id,d.verdict,d.reason,d.created_at,dc.keyword,dc.demand_value,dc.search_intent,dc.status,p.name AS project_name
      FROM decisions d JOIN discovery_candidates dc ON dc.id=d.target_id JOIN projects p ON p.id=d.project_id
      WHERE d.action='operation.candidate_triage' ORDER BY d.created_at DESC LIMIT 80`).all().map((row: any) => ({
        id: row.id, projectId: row.project_id, projectName: row.project_name, keyword: row.keyword, verdict: row.verdict, reason: row.reason,
        demand: row.demand_value, searchIntent: row.search_intent, createdAt: row.created_at
      }));
    for (const project of projects) {
      const host = hostOf(project.domain);
      if (host && !sites.some(site => site.host === host)) sites.push({ name: project.name, host, error: false, gsc: { current: null, previous: null }, ga4: { current: null, previous: null } });
    }
    return { ...snapshot, articles, keywordChoices, sites: sites.map(site => {
      const matches = projects.filter(project => hostOf(project.domain) === site.host);
      const projectIds = new Set(matches.map(project => project.id));
      const openTasks = tasks.filter(task => projectIds.has(task.projectId) && !['done', 'cancelled'].includes(task.status)).length;
      const openReviews = reviews.filter(review => projectIds.has(review.projectId) && review.status === 'open').length;
      const artifacts = allArtifacts.filter(row => projectIds.has(row.project_id));
      const outcomes = allOutcomes.filter(row => projectIds.has(row.project_id));
      const current = site.error ? null : site.gsc.current?.clicks ?? null;
      const previous = site.error ? null : site.gsc.previous?.clicks ?? null;
      const clickChange = snapshot.comparable && current !== null && previous !== null && previous > 0 ? (current - previous) / previous * 100 : null;
      const sessions = site.error ? null : site.ga4.current?.sessions ?? null;
      const previousSessions = site.error ? null : site.ga4.previous?.sessions ?? null;
      const sessionChange = snapshot.comparable && sessions !== null && previousSessions !== null && previousSessions > 0 ? (sessions - previousSessions) / previousSessions * 100 : null;
      const signal = site.error ? '取得失敗' : snapshot.stale ? 'データ更新が必要' : openReviews ? 'レビュー待ち' : clickChange !== null && previous! >= 5 && clickChange <= -30 ? '検索流入の減少を確認' : sessionChange !== null && previousSessions! >= 20 && sessionChange <= -30 ? '訪問減少を確認' : current === null ? '検索データなし' : '実績を確認';
      return {
        ...site, clickChange, sessionChange, signal, projects: matches.map(p => ({ id: p.id, name: p.name })), openTasks, openReviews,
        articleCount: artifacts.length,
        verifiedArticles: artifacts.filter(row => row.validator_status === 'passed' && row.build_status === 'passed' && row.verified_at).length,
        publishedArticles: outcomes.filter(row => row.published_at).length,
        pendingEvaluations: outcomes.filter(row => row.outcome_status === 'pending').length,
        improved: outcomes.filter(row => row.outcome_status === 'improved').length,
        regressed: outcomes.filter(row => row.outcome_status === 'regressed').length
      };
    }) };
  }
};
