import { z } from 'zod';
export const hashText = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(8000);
const ref = z.string().min(1).max(1000).refine(v => !v.startsWith('/') && !v.includes('\\') && !v.split('/').some(p => p === '..' || p === '.') && !v.includes(':'), 'Relative source path required');
const url = z.string().url().max(2000);
export const snapshotSchema = z.object({
 schema_version: z.literal(1), kind: z.literal('blog_site_context'), observed_at: z.iso.datetime({ offset: true }),
 blog_site_id: text, canonical_origin: url, language: text, country: text,
 mapping_sha256: hashText, route_evidence: z.array(z.object({path: ref, sha256: hashText})).max(100),
 eligibility: z.object({remediation_status: text, clearance_gate: text, new_content_allowed: z.boolean(), reason: text, quality_status: text, index_health: text}),
 sources: z.array(z.object({source_ref: ref, source_sha256: hashText, title: z.string().max(2000), expected_url: url, draft: z.boolean().nullable(), declared_date: z.string().nullable(), headings: z.array(z.string().max(2000)).max(500), local_build_present: z.boolean()})).max(20000),
 pages: z.array(z.object({local_build_url: url, canonical_url: z.string().nullable(), canonical_status: text, title: z.string().max(2000), source_refs: z.array(ref), source_mapping_status: text, build_ref: ref, build_sha256: hashText, build_file_modified_at: text, robots: z.array(z.string()), internal_links: z.array(z.string().max(2000)).max(20000), publication_status: z.literal('unverified'), index_status: z.literal('unverified')})).max(20000),
 coverage: z.object({source_count: z.number().int(), local_build_page_count: z.number().int(), unmapped_build_pages: z.number().int(), sources_absent_from_build: z.number().int(), duplicate_expected_urls: z.array(url), complete_site_coverage: z.boolean()}),
 warnings: z.array(z.string()).max(100)
});
export const briefSchema = z.object({
 reader_task: text, direct_answer: text, unique_value: text, editorial_owner: text, maintenance_owner: text,
 review_due_at: z.iso.date(), value_source_ids: z.array(text).min(1).max(30),
 demand_source_ids: z.array(text).min(1).max(30),
 demand_status: z.enum(['gsc_observed','provider_estimated','search_surface_observed']),
 serp_comparison: z.array(z.object({source_id: text, missing_answer: text, our_answer: text})).min(1).max(10),
 claim_source_map: z.array(z.object({claim: text, source_id: text, locator: text})).min(1).max(50),
 existing_coverage: text, internal_links: z.array(url).max(30),
 unresolved_questions: z.array(text).max(30),
 research: z.object({skills_used: z.array(text).min(1), score_rationale: text,
   demand: z.number().int().min(0).max(100), serp_opportunity: z.number().int().min(0).max(100),
   site_fit: z.number().int().min(0).max(100), business_value: z.number().int().min(0).max(100),
   freshness: z.number().int().min(0).max(100), effort: z.number().int().min(1).max(100)})
});
export type BlogSnapshot = z.infer<typeof snapshotSchema>;
export type BlogBrief = z.infer<typeof briefSchema>;
export const receiptSchema = z.object({
 schema_version: z.literal(1), event_id: text, handoff_id: text, version_hash: hashText,
 status: z.enum(['accepted','blocked','local_verified','published','observing','evaluated']),
 occurred_at: z.iso.datetime({offset:true}), blog_item_id: text.optional(),
 reason: text.optional(), evidence_refs: z.array(text).max(50),
 final_urls: z.array(url).min(1).max(3),
 publication: z.object({confirmed_at: z.iso.datetime({offset:true}), checks: z.array(z.object({url, http_status: z.literal(200), canonical: url})).min(1).max(3)}).optional(),
 outcome: z.object({verdict: z.enum(['improved','inconclusive','regressed']), baseline_capture_id: text, followup_capture_id: text, summary: text}).optional()
});
export const blogContract = {
 schema_version:1,
 snapshot:z.toJSONSchema(snapshotSchema), brief:z.toJSONSchema(briefSchema), receipt:z.toJSONSchema(receiptSchema),
 semantics:['Local snapshots are not publication evidence.','Page approval includes the prepared brief and is human-only.','Search-surface phrases are not search-volume measurements.','Failed, missing and zero observations are distinct.']
};
