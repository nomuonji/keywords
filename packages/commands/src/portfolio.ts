import { getDatabase, schema } from '@keywords/db';
import { hostOf, readPortfolio } from '@keywords/research/portfolio';
import { headlessCommands } from './headless.js';

const { db, sqlite } = getDatabase();
const hasTable = (name: string) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };

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
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (projectId) { clauses.push('a.project_id=?'); args.push(projectId); }
    if (query) {
      clauses.push("(LOWER(COALESCE(p.title,a.article_id)) LIKE ? OR LOWER(pr.name) LIKE ? OR LOWER(COALESCE(k.text,'')) LIKE ?)");
      const pattern = `%${query}%`; args.push(pattern, pattern, pattern);
    }
    if (status === 'complete') clauses.push("a.validator_status='passed' AND a.build_status='passed' AND a.verified_at IS NOT NULL");
    if (status === 'in_progress') clauses.push("NOT (a.validator_status='passed' AND a.build_status='passed' AND a.verified_at IS NOT NULL)");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const base = `FROM operation_artifacts a
      LEFT JOIN pages p ON p.id=a.page_id
      JOIN projects pr ON pr.id=a.project_id
      LEFT JOIN keywords k ON k.id=(SELECT pk.keyword_id FROM page_keywords pk WHERE pk.page_id=a.page_id ORDER BY CASE pk.role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1)`;
    const total = Number((sqlite.prepare(`SELECT COUNT(*) AS n ${base} ${where}`).get(...args) as any)?.n ?? 0);
    const rows = sqlite.prepare(`SELECT a.*,p.title,p.slug,p.status AS page_status,p.url,k.id AS keyword_id,k.text AS keyword_text,k.avg_monthly,k.gsc_clicks,k.gsc_impressions,k.gsc_position,pr.name AS project_name,pr.domain AS project_domain,
      (SELECT d.reason FROM decisions d JOIN discovery_candidates dc ON dc.id=d.target_id WHERE d.target_type='discovery_candidate' AND d.action='operation.candidate_triage' AND d.verdict='shortlisted' AND dc.keyword_id=k.id ORDER BY d.created_at DESC LIMIT 1) AS selection_reason
      ${base} ${where} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const items = rows.map(row => {
      const validatorResult = parse<any>(row.validator_result_json, null);
      return {
        id: row.id,
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
        keyword: row.keyword_id ? { id: row.keyword_id, text: row.keyword_text, avgMonthly: row.avg_monthly, clicks: row.gsc_clicks, impressions: row.gsc_impressions, position: row.gsc_position, selectionReason: row.selection_reason ?? null } : null,
        outcome: outcomeFor(row.operation_id, row.project_id)
      };
    });
    return { generatedAt: new Date().toISOString(), total, limit, offset, items };
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
