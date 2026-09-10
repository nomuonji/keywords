import { createHash, randomUUID } from 'node:crypto';
import { readBlogRuntime, newBlogArticleTarget } from '@keywords/research/blog-runtime';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { assertRecoveryAllowsExpansion } from './recovery-context.js';
import { briefSchema, type BlogSnapshot } from './blog-contract.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clampInt = (value: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(Number(value)) ? Number(value) : fallback)));

export const AUTOPILOT_ACTOR_ID = 'autopilot';
export const AUTOPILOT_SAFE_CAPABILITIES = new Set([
  'operation.start', 'discovery.start', 'candidate.triage', 'measurement.capture', 'site.sync', 'blog.prepare', 'blog.transport', 'outcome.record'
]);

export interface AutonomyControl {
  projectId: string; enabled: boolean; autoApprove: boolean; autoPublish: boolean; cadenceMinutes: number;
  maxDailyNewArticles: number; maxDailyUpdates: number; minEvidenceScore: number; maxCommodityRisk: number;
  minInformationGain: number; minPublicationScore: number; updatedBy: string | null; updatedAt: string | null;
}
export interface AutonomyGateCheck { key: string; ok: boolean; actual: unknown; required: unknown; }
export interface AutonomyGateResult {
  projectId: string; pageId: string; decision: 'publish' | 'revise' | 'reject'; score: number; evidenceScore: number;
  commodityRisk: number; informationGain: number; checks: AutonomyGateCheck[]; reasons: string[]; pageType: string | null;
  factCount: number; sourceCount: number;
}

export function autonomyControl(projectId: string): AutonomyControl {
  if (!one('SELECT id FROM projects WHERE id=?', projectId)) throw new Error('Project not found');
  const row = one('SELECT * FROM autopilot_controls WHERE project_id=?', projectId);
  return { projectId, enabled: Boolean(row?.enabled), autoApprove: row ? Boolean(row.auto_approve) : true, autoPublish: row ? Boolean(row.auto_publish) : true,
    cadenceMinutes: Number(row?.cadence_minutes ?? 15), maxDailyNewArticles: Number(row?.max_daily_new_articles ?? 2), maxDailyUpdates: Number(row?.max_daily_updates ?? 4),
    minEvidenceScore: Number(row?.min_evidence_score ?? 50), maxCommodityRisk: Number(row?.max_commodity_risk ?? 3), minInformationGain: Number(row?.min_information_gain ?? 2),
    minPublicationScore: Number(row?.min_publication_score ?? 80), updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null };
}

export function configureAutonomy(ctx: CommandContext, input: { projectId: string; enabled?: boolean; autoApprove?: boolean; autoPublish?: boolean; cadenceMinutes?: number; maxDailyNewArticles?: number; maxDailyUpdates?: number; minEvidenceScore?: number; maxCommodityRisk?: number; minInformationGain?: number; minPublicationScore?: number }) {
  if (ctx.actor !== 'human') throw new Error('Autopilot configuration requires an authenticated human actor');
  const current = autonomyControl(input.projectId);
  const next = { enabled: input.enabled ?? current.enabled, autoApprove: input.autoApprove ?? current.autoApprove, autoPublish: input.autoPublish ?? current.autoPublish,
    cadenceMinutes: clampInt(input.cadenceMinutes, current.cadenceMinutes, 1, 1440), maxDailyNewArticles: clampInt(input.maxDailyNewArticles, current.maxDailyNewArticles, 0, 100),
    maxDailyUpdates: clampInt(input.maxDailyUpdates, current.maxDailyUpdates, 0, 200), minEvidenceScore: clampInt(input.minEvidenceScore, current.minEvidenceScore, 0, 100),
    maxCommodityRisk: clampInt(input.maxCommodityRisk, current.maxCommodityRisk, 0, 5), minInformationGain: clampInt(input.minInformationGain, current.minInformationGain, 0, 8),
    minPublicationScore: clampInt(input.minPublicationScore, current.minPublicationScore, 0, 100) };
  const t = now();
  run(`INSERT INTO autopilot_controls(project_id,enabled,auto_approve,auto_publish,cadence_minutes,max_daily_new_articles,max_daily_updates,min_evidence_score,max_commodity_risk,min_information_gain,min_publication_score,updated_by,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,auto_approve=excluded.auto_approve,auto_publish=excluded.auto_publish,cadence_minutes=excluded.cadence_minutes,max_daily_new_articles=excluded.max_daily_new_articles,max_daily_updates=excluded.max_daily_updates,min_evidence_score=excluded.min_evidence_score,max_commodity_risk=excluded.max_commodity_risk,min_information_gain=excluded.min_information_gain,min_publication_score=excluded.min_publication_score,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    input.projectId, next.enabled ? 1 : 0, next.autoApprove ? 1 : 0, next.autoPublish ? 1 : 0, next.cadenceMinutes, next.maxDailyNewArticles, next.maxDailyUpdates, next.minEvidenceScore, next.maxCommodityRisk, next.minInformationGain, next.minPublicationScore, ctx.actorId ?? 'human', t);
  return autonomyControl(input.projectId);
}

export function autonomyAllows(projectId: string, capability: string) { return autonomyControl(projectId).enabled && AUTOPILOT_SAFE_CAPABILITIES.has(capability); }
export function autonomyPublicationUsage(projectId: string) {
  const since = new Date(Date.now() - 86_400_000).toISOString(); const handoffs = rows('SELECT payload_json FROM blog_handoffs WHERE project_id=? AND created_at>=?', projectId, since);
  let newArticles = 0, updates = 0; for (const h of handoffs) { const p = parse<any>(h.payload_json, {}); if (p.action === 'new_article') newArticles++; if (p.action === 'substantial_revision') updates++; }
  return { windowHours: 24, newArticles, updates };
}
export function publicationCapacity(projectId: string, action: 'new_article' | 'substantial_revision') {
  const control = autonomyControl(projectId), usage = autonomyPublicationUsage(projectId), limit = action === 'new_article' ? control.maxDailyNewArticles : control.maxDailyUpdates, used = action === 'new_article' ? usage.newArticles : usage.updates;
  return { allowed: control.enabled && control.autoPublish && used < limit, limit, used, remaining: Math.max(0, limit - used), usage };
}

function targetConflicts(projectId: string, page: any) {
  return rows(`SELECT DISTINCT other.id,other.title,pk.keyword_id FROM page_keywords pk
    JOIN page_keywords opk ON opk.keyword_id=pk.keyword_id AND opk.page_id<>pk.page_id
    JOIN pages other ON other.id=opk.page_id
    WHERE pk.page_id=? AND other.project_id=? AND other.status!='archived' AND other.id<>COALESCE(?, '') LIMIT 20`, page.id, projectId, page.target_page_id ?? null);
}

export function evaluateAutonomyGate(projectId: string, pageId: string): AutonomyGateResult {
  const control = autonomyControl(projectId), page = one('SELECT * FROM pages WHERE id=? AND project_id=?', pageId, projectId); if (!page) throw new Error('Page not found');
  const row = one('SELECT packet_json FROM blog_briefs WHERE page_id=? AND project_id=?', pageId, projectId);
  if (!row) return { projectId, pageId, decision: 'revise', score: 0, evidenceScore: 0, commodityRisk: 5, informationGain: 0, checks: [{ key: 'source_packet', ok: false, actual: 'missing', required: 'autonomy evidence packet' }], reasons: ['Autonomy evidence packet is missing.'], pageType: null, factCount: 0, sourceCount: 0 };
  const brief = briefSchema.parse(parse(row.packet_json, {})), packet = brief.autonomy;
  if (!packet) return { projectId, pageId, decision: 'revise', score: 0, evidenceScore: 0, commodityRisk: 5, informationGain: 0, checks: [{ key: 'source_packet', ok: false, actual: 'missing', required: 'autonomy evidence packet' }], reasons: ['Autonomy evidence packet is missing.'], pageType: null, factCount: 0, sourceCount: 0 };
  const publicationScore = packet.publication_gate.source_quality + packet.publication_gate.evidence + packet.publication_gate.originality + packet.publication_gate.intent_match + packet.publication_gate.accuracy + packet.publication_gate.editorial_quality;
  const sourceIds = new Set<string>([...packet.source_packet.official_source_ids,...packet.source_packet.first_party_source_ids,...packet.source_packet.research_source_ids,...packet.source_packet.competitor_gap_source_ids,...packet.source_packet.reader_question_source_ids,...packet.fact_ledger.map(x=>x.source_id)]);
  const validSources = sourceIds.size ? rows(`SELECT id FROM sources WHERE project_id=? AND id IN (${[...sourceIds].map(() => '?').join(',')})`, projectId, ...sourceIds).map(r=>String(r.id)) : [];
  const missingSources = [...sourceIds].filter(id => !validSources.includes(id)), futureFacts = packet.fact_ledger.filter(x => Date.parse(x.checked_at) > Date.now() + 86_400_000), conflicts = targetConflicts(projectId, page);
  const checks: AutonomyGateCheck[] = [
    {key:'autopilot_enabled',ok:control.enabled,actual:control.enabled,required:true}, {key:'evidence_score',ok:packet.evidence_score>=control.minEvidenceScore,actual:packet.evidence_score,required:`>=${control.minEvidenceScore}`},
    {key:'commodity_risk',ok:packet.commodity_risk<=control.maxCommodityRisk,actual:packet.commodity_risk,required:`<=${control.maxCommodityRisk}`}, {key:'information_gain',ok:packet.information_gain.length>=control.minInformationGain,actual:packet.information_gain.length,required:`>=${control.minInformationGain}`},
    {key:'publication_score',ok:publicationScore>=control.minPublicationScore,actual:publicationScore,required:`>=${control.minPublicationScore}`}, {key:'fact_ledger',ok:packet.fact_ledger.length>0,actual:packet.fact_ledger.length,required:'>=1'},
    {key:'source_integrity',ok:missingSources.length===0,actual:missingSources,required:'all source IDs exist in project'}, {key:'fact_dates',ok:futureFacts.length===0,actual:futureFacts.length,required:0},
    {key:'unresolved_questions',ok:brief.unresolved_questions.length===0,actual:brief.unresolved_questions.length,required:0}, {key:'target_conflict',ok:conflicts.length===0,actual:conflicts.map(c=>({pageId:c.id,title:c.title,keywordId:c.keyword_id})),required:'no exact keyword target overlap'}
  ];
  const reasons = checks.filter(c=>!c.ok).map(c=>`${c.key}: ${JSON.stringify(c.actual)} (required ${JSON.stringify(c.required)})`);
  let decision: AutonomyGateResult['decision']='publish';
  if (!control.enabled || packet.commodity_risk>control.maxCommodityRisk || publicationScore<65 || missingSources.length || futureFacts.length) decision='reject'; else if (checks.some(c=>!c.ok)) decision='revise';
  return {projectId,pageId,decision,score:publicationScore,evidenceScore:packet.evidence_score,commodityRisk:packet.commodity_risk,informationGain:packet.information_gain.length,checks,reasons,pageType:packet.page_type,factCount:packet.fact_ledger.length,sourceCount:sourceIds.size};
}

export function applyAutonomyDecision(projectId: string, pageId: string, gate = evaluateAutonomyGate(projectId, pageId)) {
  const control = autonomyControl(projectId); if (!control.enabled || !control.autoApprove) throw new Error('Autonomous page approval is disabled');
  const page = one('SELECT * FROM pages WHERE id=? AND project_id=?', pageId, projectId); if (!page) throw new Error('Page not found');
  const verdict = gate.decision === 'publish' ? 'approved' : gate.decision === 'revise' ? 'needs_edit' : 'rejected';
  const status = verdict === 'approved' ? 'approved' : verdict === 'rejected' ? 'archived' : 'proposed', fingerprint = hash({ verdict, gate });
  const previous = one("SELECT metadata_json FROM decisions WHERE project_id=? AND target_type='page' AND target_id=? AND action='page.autopilot_review' ORDER BY created_at DESC LIMIT 1", projectId, pageId);
  if (parse<any>(previous?.metadata_json, {}).fingerprint === fingerprint) return { reused: true, pageId, status, verdict, gate };
  const t=now(); sqlite.transaction(()=>{
    run('UPDATE pages SET status=?,updated_at=? WHERE id=?',status,t,pageId);
    run('INSERT INTO decisions(id,project_id,actor,action,target_type,target_id,verdict,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),projectId,'system','page.autopilot_review','page',pageId,verdict,`Deterministic autonomy gate: ${gate.decision}`,JSON.stringify({fingerprint,previousStatus:page.status,status,gate}),t);
    const reviews=rows("SELECT id,work_session_id FROM review_requests WHERE project_id=? AND target_type='page' AND target_id=? AND status='open'",projectId,pageId);
    for(const review of reviews){
      run("UPDATE review_requests SET status='resolved',resolution=?,reason=?,resolved_at=? WHERE id=?",verdict,`Resolved by deterministic autonomy gate (${gate.decision})`,t,review.id);
      if(review.work_session_id && !one("SELECT id FROM review_requests WHERE work_session_id=? AND status='open' AND id<>? LIMIT 1",review.work_session_id,review.id)){
        run("UPDATE work_sessions SET status='running',summary=?,last_next_action=?,updated_at=? WHERE id=?",`Autonomy gate resolved page review: ${verdict}`,'Re-read operation context and continue',t,review.work_session_id);
        run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),review.work_session_id,'working',`Autonomy gate resolved page review: ${verdict}`,'Re-read operation context and continue',t);
      }
    }
  }).immediate();
  return {reused:false,pageId,status,verdict,gate};
}

function pageVersion(pageId:string){const p=one('SELECT * FROM pages WHERE id=?',pageId);return hash({page:p,targets:rows('SELECT keyword_id,role FROM page_keywords WHERE page_id=? ORDER BY keyword_id',pageId),brief:one('SELECT packet_hash FROM blog_briefs WHERE page_id=?',pageId)});}
function sameOrigin(value:string,origin:string){if(new URL(value).origin!==origin)throw new Error('Cross-origin URL rejected');}

export function createAutonomousHandoff(projectId:string,pageId:string){
  const control=autonomyControl(projectId); if(!control.enabled||!control.autoPublish)throw new Error('Autonomous publication is disabled');
  const gate=evaluateAutonomyGate(projectId,pageId); if(gate.decision!=='publish')throw new Error(`Autonomy gate is ${gate.decision}, not publish`);
  const b=one('SELECT * FROM blog_bindings WHERE project_id=?',projectId); if(!b)throw new Error('Import and confirm a Blog site context first');
  if(Date.now()-Date.parse(b.observed_at)>7*86_400_000)throw new Error('Blog site context is stale; refresh before delivery');
  const snap:BlogSnapshot=parse(b.snapshot_json,{} as BlogSnapshot),p=one('SELECT * FROM pages WHERE id=? AND project_id=?',pageId,projectId); if(!p||p.status!=='approved')throw new Error('Page must pass autonomy approval first');
  const approval=one("SELECT * FROM decisions WHERE project_id=? AND target_id=? AND action='page.autopilot_review' ORDER BY created_at DESC LIMIT 1",projectId,pageId); if(!(approval?.actor==='system'&&approval.verdict==='approved'))throw new Error('Latest deterministic autonomy decision must approve the page');
  const version=pageVersion(pageId),old=one('SELECT * FROM blog_handoffs WHERE page_id=? AND version_hash=?',pageId,version); if(old)return {reused:true,payload:parse(old.payload_json,{})};
  if(one("SELECT id FROM blog_handoffs WHERE page_id=? AND status NOT IN ('evaluated','blocked')",pageId))throw new Error('Previous handoff is still active');
  const brief=briefSchema.parse(parse(one('SELECT packet_json FROM blog_briefs WHERE page_id=?',pageId)?.packet_json,{})),target=p.target_page_id?one('SELECT * FROM pages WHERE id=? AND project_id=?',p.target_page_id,projectId):null;
  const action=p.plan_mode==='existing_page_improvement'?'substantial_revision':'new_article',capacity=publicationCapacity(projectId,action); if(!capacity.allowed)throw new Error(`Autopilot ${action} capacity exhausted (${capacity.used}/${capacity.limit} in 24h)`);
  if(action==='new_article'){if(snap.eligibility.new_content_allowed!==true||snap.eligibility.clearance_gate!=='listed_for_scoped_clearance')throw new Error('Site snapshot does not clear new content');assertRecoveryAllowsExpansion(projectId);}else if(!target?.url)throw new Error('Existing target URL required');
  const targetUrl=target?.url||newBlogArticleTarget(readBlogRuntime(b.blog_site_id,b.origin),b.origin,String(p.slug)).url;sameOrigin(targetUrl,b.origin);
  const matches=snap.sources.filter(s=>s.expected_url===targetUrl); if(matches.length!==(action==='new_article'?0:1))throw new Error('Target source is missing, ambiguous, or already exists');
  if(action==='new_article'&&snap.pages.some(x=>x.local_build_url===targetUrl))throw new Error('URL already exists in local build');
  const targets=rows('SELECT k.id,k.text,pk.role FROM page_keywords pk JOIN keywords k ON k.id=pk.keyword_id WHERE pk.page_id=? ORDER BY k.id',pageId); if(!targets.some(t=>t.role==='primary'))throw new Error('Primary keyword required');
  const payload={schema_version:1,handoff_id:randomUUID(),version_hash:version,project_id:projectId,blog_site_id:b.blog_site_id,plan_id:pageId,approval_ref:approval.id,created_at:now(),action,canonical_origin:b.origin,target_urls:[targetUrl],target_sources:matches.map(s=>({path:s.source_ref,sha256:s.source_sha256})),snapshot_hash:b.snapshot_hash,route_evidence:snap.route_evidence,brief,primary_query:targets.find(t=>t.role==='primary').text,target_queries:targets.map(t=>t.text),keyword_ids:targets.map(t=>t.id),cluster_id:p.cluster_id||p.id,publication_authorized:true,authorization:{mode:'deterministic_autonomy_gate',gate}};
  run('INSERT INTO blog_handoffs(id,project_id,page_id,version_hash,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',payload.handoff_id,projectId,pageId,version,JSON.stringify(payload),'exported',now(),now());
  return {reused:false,payload};
}

export function autonomyStatusRows(){return rows('SELECT project_id FROM autopilot_controls WHERE enabled=1 ORDER BY updated_at DESC').map(r=>String(r.project_id));}
