import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { briefSchema } from './blog-contract.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const clampInt = (value: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(Number(value)) ? Number(value) : fallback)));

export const AUTOPILOT_ACTOR_ID = 'autopilot';
export const AUTOPILOT_SAFE_CAPABILITIES = new Set([
  'operation.start', 'discovery.start', 'candidate.triage', 'measurement.capture', 'site.sync', 'blog.prepare', 'blog.transport', 'outcome.record'
]);

export interface AutonomyControl {
  projectId: string;
  enabled: boolean;
  autoApprove: boolean;
  autoPublish: boolean;
  cadenceMinutes: number;
  maxDailyNewArticles: number;
  maxDailyUpdates: number;
  minEvidenceScore: number;
  maxCommodityRisk: number;
  minInformationGain: number;
  minPublicationScore: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface AutonomyGateCheck { key: string; ok: boolean; actual: unknown; required: unknown; }
export interface AutonomyGateResult {
  projectId: string;
  pageId: string;
  decision: 'publish' | 'revise' | 'reject';
  score: number;
  evidenceScore: number;
  commodityRisk: number;
  informationGain: number;
  checks: AutonomyGateCheck[];
  reasons: string[];
  pageType: string | null;
  factCount: number;
  sourceCount: number;
}

export function autonomyControl(projectId: string): AutonomyControl {
  const project = one('SELECT id FROM projects WHERE id=?', projectId);
  if (!project) throw new Error('Project not found');
  const row = one('SELECT * FROM autopilot_controls WHERE project_id=?', projectId);
  return {
    projectId,
    enabled: Boolean(row?.enabled),
    autoApprove: row ? Boolean(row.auto_approve) : true,
    autoPublish: row ? Boolean(row.auto_publish) : true,
    cadenceMinutes: Number(row?.cadence_minutes ?? 15),
    maxDailyNewArticles: Number(row?.max_daily_new_articles ?? 2),
    maxDailyUpdates: Number(row?.max_daily_updates ?? 4),
    minEvidenceScore: Number(row?.min_evidence_score ?? 50),
    maxCommodityRisk: Number(row?.max_commodity_risk ?? 3),
    minInformationGain: Number(row?.min_information_gain ?? 2),
    minPublicationScore: Number(row?.min_publication_score ?? 80),
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ?? null
  };
}

export function configureAutonomy(ctx: CommandContext, input: {
  projectId: string;
  enabled?: boolean;
  autoApprove?: boolean;
  autoPublish?: boolean;
  cadenceMinutes?: number;
  maxDailyNewArticles?: number;
  maxDailyUpdates?: number;
  minEvidenceScore?: number;
  maxCommodityRisk?: number;
  minInformationGain?: number;
  minPublicationScore?: number;
}) {
  if (ctx.actor !== 'human') throw new Error('Autopilot configuration requires an authenticated human actor');
  const current = autonomyControl(input.projectId);
  const next = {
    enabled: input.enabled ?? current.enabled,
    autoApprove: input.autoApprove ?? current.autoApprove,
    autoPublish: input.autoPublish ?? current.autoPublish,
    cadenceMinutes: clampInt(input.cadenceMinutes, current.cadenceMinutes, 1, 1440),
    maxDailyNewArticles: clampInt(input.maxDailyNewArticles, current.maxDailyNewArticles, 0, 100),
    maxDailyUpdates: clampInt(input.maxDailyUpdates, current.maxDailyUpdates, 0, 200),
    minEvidenceScore: clampInt(input.minEvidenceScore, current.minEvidenceScore, 0, 100),
    maxCommodityRisk: clampInt(input.maxCommodityRisk, current.maxCommodityRisk, 0, 5),
    minInformationGain: clampInt(input.minInformationGain, current.minInformationGain, 0, 8),
    minPublicationScore: clampInt(input.minPublicationScore, current.minPublicationScore, 0, 100)
  };
  const t = now();
  run(`INSERT INTO autopilot_controls(project_id,enabled,auto_approve,auto_publish,cadence_minutes,max_daily_new_articles,max_daily_updates,min_evidence_score,max_commodity_risk,min_information_gain,min_publication_score,updated_by,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,auto_approve=excluded.auto_approve,auto_publish=excluded.auto_publish,cadence_minutes=excluded.cadence_minutes,max_daily_new_articles=excluded.max_daily_new_articles,max_daily_updates=excluded.max_daily_updates,min_evidence_score=excluded.min_evidence_score,max_commodity_risk=excluded.max_commodity_risk,min_information_gain=excluded.min_information_gain,min_publication_score=excluded.min_publication_score,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    input.projectId, next.enabled ? 1 : 0, next.autoApprove ? 1 : 0, next.autoPublish ? 1 : 0, next.cadenceMinutes, next.maxDailyNewArticles, next.maxDailyUpdates, next.minEvidenceScore, next.maxCommodityRisk, next.minInformationGain, next.minPublicationScore, ctx.actorId ?? 'human', t);
  return autonomyControl(input.projectId);
}

export function autonomyAllows(projectId: string, capability: string) {
  const control = autonomyControl(projectId);
  return control.enabled && AUTOPILOT_SAFE_CAPABILITIES.has(capability);
}

export function autonomyPublicationUsage(projectId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const handoffs = rows('SELECT payload_json,status,created_at FROM blog_handoffs WHERE project_id=? AND created_at>=?', projectId, since);
  let newArticles = 0, updates = 0;
  for (const handoff of handoffs) {
    const payload = parse<Record<string, unknown>>(handoff.payload_json, {});
    if (payload.action === 'new_article') newArticles += 1;
    if (payload.action === 'substantial_revision') updates += 1;
  }
  return { windowHours: 24, newArticles, updates };
}

export function publicationCapacity(projectId: string, action: 'new_article' | 'substantial_revision') {
  const control = autonomyControl(projectId);
  const usage = autonomyPublicationUsage(projectId);
  const limit = action === 'new_article' ? control.maxDailyNewArticles : control.maxDailyUpdates;
  const used = action === 'new_article' ? usage.newArticles : usage.updates;
  return { allowed: control.enabled && control.autoPublish && used < limit, limit, used, remaining: Math.max(0, limit - used), usage };
}

export function evaluateAutonomyGate(projectId: string, pageId: string): AutonomyGateResult {
  const control = autonomyControl(projectId);
  const page = one('SELECT * FROM pages WHERE id=? AND project_id=?', pageId, projectId);
  if (!page) throw new Error('Page not found');
  const row = one('SELECT packet_json FROM blog_briefs WHERE page_id=? AND project_id=?', pageId, projectId);
  if (!row) return {
    projectId, pageId, decision: 'revise', score: 0, evidenceScore: 0, commodityRisk: 5, informationGain: 0,
    checks: [{ key: 'source_packet', ok: false, actual: 'missing', required: 'autonomy evidence packet' }],
    reasons: ['Autonomy evidence packet is missing.'], pageType: null, factCount: 0, sourceCount: 0
  };
  const brief = briefSchema.parse(parse(row.packet_json, {}));
  const packet = brief.autonomy;
  if (!packet) return {
    projectId, pageId, decision: 'revise', score: 0, evidenceScore: 0, commodityRisk: 5, informationGain: 0,
    checks: [{ key: 'source_packet', ok: false, actual: 'missing', required: 'autonomy evidence packet' }],
    reasons: ['Autonomy evidence packet is missing.'], pageType: null, factCount: 0, sourceCount: 0
  };

  const publicationScore = packet.publication_gate.source_quality + packet.publication_gate.evidence + packet.publication_gate.originality + packet.publication_gate.intent_match + packet.publication_gate.accuracy + packet.publication_gate.editorial_quality;
  const sourceIds = new Set<string>([
    ...packet.source_packet.official_source_ids,
    ...packet.source_packet.first_party_source_ids,
    ...packet.source_packet.research_source_ids,
    ...packet.source_packet.competitor_gap_source_ids,
    ...packet.source_packet.reader_question_source_ids,
    ...packet.fact_ledger.map(item => item.source_id)
  ]);
  const validSources = sourceIds.size ? rows(`SELECT id FROM sources WHERE project_id=? AND id IN (${[...sourceIds].map(() => '?').join(',')})`, projectId, ...sourceIds).map(row => String(row.id)) : [];
  const missingSources = [...sourceIds].filter(id => !validSources.includes(id));
  const futureFacts = packet.fact_ledger.filter(item => Date.parse(item.checked_at) > Date.now() + 86_400_000);
  const checks: AutonomyGateCheck[] = [
    { key: 'autopilot_enabled', ok: control.enabled, actual: control.enabled, required: true },
    { key: 'evidence_score', ok: packet.evidence_score >= control.minEvidenceScore, actual: packet.evidence_score, required: `>=${control.minEvidenceScore}` },
    { key: 'commodity_risk', ok: packet.commodity_risk <= control.maxCommodityRisk, actual: packet.commodity_risk, required: `<=${control.maxCommodityRisk}` },
    { key: 'information_gain', ok: packet.information_gain.length >= control.minInformationGain, actual: packet.information_gain.length, required: `>=${control.minInformationGain}` },
    { key: 'publication_score', ok: publicationScore >= control.minPublicationScore, actual: publicationScore, required: `>=${control.minPublicationScore}` },
    { key: 'fact_ledger', ok: packet.fact_ledger.length > 0, actual: packet.fact_ledger.length, required: '>=1' },
    { key: 'source_integrity', ok: missingSources.length === 0, actual: missingSources, required: 'all source IDs exist in project' },
    { key: 'fact_dates', ok: futureFacts.length === 0, actual: futureFacts.length, required: 0 },
    { key: 'unresolved_questions', ok: brief.unresolved_questions.length === 0, actual: brief.unresolved_questions.length, required: 0 }
  ];
  const reasons = checks.filter(check => !check.ok).map(check => `${check.key}: ${JSON.stringify(check.actual)} (required ${JSON.stringify(check.required)})`);
  let decision: AutonomyGateResult['decision'] = 'publish';
  if (!control.enabled || packet.commodity_risk > control.maxCommodityRisk || publicationScore < 65 || missingSources.length || futureFacts.length) decision = 'reject';
  else if (checks.some(check => !check.ok)) decision = 'revise';
  return {
    projectId, pageId, decision, score: publicationScore, evidenceScore: packet.evidence_score, commodityRisk: packet.commodity_risk,
    informationGain: packet.information_gain.length, checks, reasons, pageType: packet.page_type, factCount: packet.fact_ledger.length, sourceCount: sourceIds.size
  };
}

export function autonomyStatusRows() {
  return rows('SELECT project_id FROM autopilot_controls WHERE enabled=1 ORDER BY updated_at DESC').map(row => String(row.project_id));
}
