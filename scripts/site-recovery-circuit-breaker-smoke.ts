import assert from 'node:assert/strict';
import { evaluateRecoverySignal, shouldTripPortfolioCircuit } from '../packages/commands/src/seo-recovery-watch.js';

const now = Date.parse('2026-10-08T00:00:00.000Z');
const digest = (previous7: number, current7: number, previous28 = 200, current28 = 150, generatedAt = '2026-10-07T23:00:00.000Z') => ({
  generatedAt,
  statuses: {
    current7: { gsc: { completeness: 'complete' } },
    previous7: { gsc: { completeness: 'complete' } },
    current28: { gsc: { completeness: 'complete' } },
    previous28: { gsc: { completeness: 'complete' } }
  },
  siteMetrics: {
    current7: { gsc: { impressions: current7 } },
    previous7: { gsc: { impressions: previous7 } },
    current28: { gsc: { impressions: current28 } },
    previous28: { gsc: { impressions: previous28 } }
  }
});
const indexation = (rate: number, inspected = 20, coverage = 0.6) => ({ inspectedCount: inspected, inspectionCoverage: coverage, observedIndexationRate: rate });

const healthy = evaluateRecoverySignal('healthy', digest(100, 90), indexation(0.8), now);
assert.equal(healthy.severeVisibilityDrop, false);
assert.equal(healthy.severeIndexation, false);

const combinedA = evaluateRecoverySignal('a', digest(100, 10), indexation(0.05), now);
const combinedB = evaluateRecoverySignal('b', digest(80, 10), indexation(0.10), now);
assert.equal(combinedA.severeCombined, true);
assert.equal(shouldTripPortfolioCircuit([combinedA]).trip, false);
assert.equal(shouldTripPortfolioCircuit([combinedA, combinedB]).trip, true);

const idxA = evaluateRecoverySignal('i1', digest(60, 50), indexation(0.05), now);
const idxB = evaluateRecoverySignal('i2', digest(0, 0, 0, 0), indexation(0.10), now);
const idxC = evaluateRecoverySignal('i3', digest(0, 0, 0, 0), indexation(0.15), now);
const broad = shouldTripPortfolioCircuit([idxA, idxB, idxC]);
assert.equal(broad.trip, true);
assert.equal(broad.severeIndexationCount, 3);
assert.equal(broad.baselineAmongIndexation, true);

const noBaseline = shouldTripPortfolioCircuit([
  evaluateRecoverySignal('n1', digest(0, 0, 0, 0), indexation(0.05), now),
  evaluateRecoverySignal('n2', digest(0, 0, 0, 0), indexation(0.05), now),
  evaluateRecoverySignal('n3', digest(0, 0, 0, 0), indexation(0.05), now)
]);
assert.equal(noBaseline.trip, false);

const sparse = evaluateRecoverySignal('sparse', digest(100, 0), indexation(0.0, 10, 1), now);
assert.equal(sparse.severeIndexation, false, 'fewer than 20 inspected URLs must never trip indexation circuit');

const stale = evaluateRecoverySignal('stale', digest(100, 0, 200, 0, '2026-10-01T00:00:00.000Z'), indexation(0.05), now);
assert.equal(stale.digestFresh, false);
assert.equal(stale.severeVisibilityDrop, false, 'stale GSC digest must not create a visibility-collapse signal');

console.log('site recovery circuit breaker smoke passed');
