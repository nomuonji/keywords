import { getDatabase } from '@keywords/db';
import { siteOperationsReadiness } from './site-operations-readiness.js';

const { sqlite } = getDatabase();

const actionCodesByBlocker: Record<string, string[]> = {
  firebase_project_not_configured: ['configure_firebase_project'],
  firebase_service_account_not_configured: ['configure_firebase_service_account'],
  site_registry_unavailable: ['repair_site_registry_access'],
  site_not_linked: ['register_real_site'],
  gsc_credentials_not_configured: ['configure_gsc_credentials'],
  gsc_property_scope_unresolvable: ['configure_project_origin_or_gsc_property'],
  blog_binding_missing: ['confirm_blog_binding'],
  blog_binding_stale: ['refresh_blog_binding'],
  blog_site_origin_mismatch: ['repair_origin_mapping'],
  mapped_article_registry_empty: ['project_article_registry'],
  auto_git_push_disabled: ['enable_git_delivery'],
  blog_site_not_allowed_for_git_push: ['allow_blog_site_git_delivery']
};

export type AutopilotContentMutationPreflight = {
  projectId: string;
  applicable: boolean;
  allowed: boolean;
  capability: 'articleOptimization' | null;
  blockers: string[];
  nextActions: Array<{ code: string; message: string; tool?: string }>;
  checkedAt: string;
};

/**
 * Fail-closed gate for autonomous content mutation and delivery on existing sites.
 * Measurement, inventory, research and evaluation operations deliberately do not
 * call this gate so they can gather the evidence needed to clear blockers.
 */
export async function autopilotContentMutationPreflight(projectId: string): Promise<AutopilotContentMutationPreflight> {
  const project = sqlite.prepare('SELECT id,mode FROM projects WHERE id=?').get(projectId) as { id: string; mode: string } | undefined;
  if (!project) throw new Error('Project not found');
  if (project.mode !== 'existing_site') {
    return {
      projectId,
      applicable: false,
      allowed: true,
      capability: null,
      blockers: [],
      nextActions: [],
      checkedAt: new Date().toISOString()
    };
  }

  try {
    const readiness = await siteOperationsReadiness({ projectId });
    const entry = readiness.projects[0];
    if (!entry) {
      return {
        projectId,
        applicable: true,
        allowed: false,
        capability: 'articleOptimization',
        blockers: ['site_operations_readiness_unavailable'],
        nextActions: [],
        checkedAt: new Date().toISOString()
      };
    }
    const blockers = [...entry.capabilities.articleOptimization.blockers];
    const relevantActionCodes = new Set(blockers.flatMap(blocker => actionCodesByBlocker[blocker] ?? []));
    return {
      projectId,
      applicable: true,
      allowed: entry.capabilities.articleOptimization.ready,
      capability: 'articleOptimization',
      blockers,
      nextActions: entry.nextActions.filter(action => relevantActionCodes.has(action.code)),
      checkedAt: new Date().toISOString()
    };
  } catch {
    // Do not surface SDK/backend error strings here. A preflight lookup failure is
    // itself a blocker, while measurement/research paths remain independently usable.
    return {
      projectId,
      applicable: true,
      allowed: false,
      capability: 'articleOptimization',
      blockers: ['site_operations_readiness_unavailable'],
      nextActions: [],
      checkedAt: new Date().toISOString()
    };
  }
}
