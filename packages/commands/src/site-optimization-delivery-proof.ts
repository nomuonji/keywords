import { getDatabase } from '@keywords/db';

const { sqlite } = getDatabase();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

type ValidatorResult = {
  status?: string;
  delivery?: { status?: string; commit?: string } | null;
  publication?: { status?: string; publishedAt?: string; checks?: unknown[] } | null;
};

/**
 * Prove that the current shared Operation actually validated, pushed and live-verified
 * the mapped existing-page artifact before a Sites optimization may become implemented.
 */
export function assertSiteOptimizationDeliveryProof(input: { projectId: string; pageId: string; afterCommit: string }) {
  const active = one(`SELECT o.id AS operation_id,op.work_session_id
    FROM operation_requests o
    JOIN operation_projects op ON op.operation_id=o.id
    JOIN work_sessions ws ON ws.id=op.work_session_id
    WHERE op.project_id=? AND o.status='active' AND ws.status='running'
    ORDER BY o.updated_at DESC LIMIT 1`, input.projectId) as { operation_id: string; work_session_id: string } | undefined;
  if (!active) throw new Error('Implementation proof requires the active shared Operation.');

  const artifact = one(`SELECT id,validator_status,validator_result_json,build_status,verified_at,updated_at
    FROM operation_artifacts
    WHERE operation_id=? AND project_id=? AND page_id=? AND COALESCE(deleted_at,'')=''
    ORDER BY updated_at DESC LIMIT 1`, active.operation_id, input.projectId, input.pageId) as {
      id: string;
      validator_status: string;
      validator_result_json: string | null;
      build_status: string;
      verified_at: string | null;
      updated_at: string;
    } | undefined;
  if (!artifact) throw new Error('No artifact for the mapped article was validated in the active Operation.');
  if (artifact.validator_status !== 'passed' || artifact.build_status !== 'passed' || !artifact.verified_at) {
    throw new Error('Mapped article artifact is not fully validated and build-verified in the active Operation.');
  }

  const result = parse<ValidatorResult>(artifact.validator_result_json, {});
  if (result.status !== 'passed') throw new Error('Persisted validator result does not prove a passed artifact validation.');
  if (result.delivery?.status !== 'pushed' || !result.delivery.commit) {
    throw new Error('Optimization implementation requires a real Git push from the active artifact validation.');
  }
  if (result.delivery.commit.toLowerCase() !== input.afterCommit.toLowerCase()) {
    throw new Error(`afterCommit does not match the persisted pushed commit (${result.delivery.commit}).`);
  }
  if (result.publication?.status !== 'published') {
    throw new Error('Optimization implementation requires successful live publication verification from the active artifact validation.');
  }

  return {
    operationId: active.operation_id,
    workSessionId: active.work_session_id,
    artifactId: artifact.id,
    commit: result.delivery.commit,
    publicationStatus: result.publication.status,
    verifiedAt: artifact.verified_at,
    validatorUpdatedAt: artifact.updated_at
  };
}
