import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateReleasePerformanceEvidence,
  releasePerformanceBudget,
  RELEASE_PERFORMANCE_AUTOMATION_VERSION,
  sealReleasePerformanceEvidence
} from '../../tools/library-scale/release-performance-contract.mjs';

const WORKLOADS = [
  'production-open',
  'production-query-corpus',
  'production-rare-search',
  'production-ordinal-anchor-jump',
  'production-noop-scan',
  'production-one-percent-scan',
  'production-playback-transport',
  'production-playlist-bulk',
  'production-artwork',
  'production-mixed-audio'
];

function passingEvidence(backend = 'electron') {
  const metrics = {};
  for (const [metric, budget] of Object.entries(releasePerformanceBudget(backend))) {
    metrics[metric] = {
      comparator: budget.comparator,
      limit: budget.limit,
      value: budget.comparator === 'gte' ? budget.limit :
        budget.comparator === 'eq' ? budget.limit : budget.limit - 1
    };
  }
  return sealReleasePerformanceEvidence({
    schemaVersion: 1,
    kind: 'library-scale-production-performance',
    automationVersion: RELEASE_PERFORMANCE_AUTOMATION_VERSION,
    backend,
    commitSha: 'a'.repeat(40),
    workflowRunId: '81',
    fixture: { count: 1_000_000, seed: 1592598566, digest: `sha256:${'b'.repeat(64)}` },
    productionAdapter: {
      id: backend === 'electron'
        ? 'electron-library-catalog-utility-v1'
        : 'web-catalog-worker-v2',
      qualified: true
    },
    runtime: { version: '1' },
    machine: { id: 'fixed-reference' },
    workloads: Object.fromEntries(WORKLOADS.map(id => [id, { completed: true, production: true }])),
    metrics,
    audioWorklet: { measured: true, measurementSeconds: 60 }
  });
}

test('release performance evidence accepts only the sealed fixed production matrix', () => {
  const evidence = passingEvidence();
  assert.deepEqual(evaluateReleasePerformanceEvidence(evidence, {
    expectedBackend: 'electron',
    expectedCommitSha: 'a'.repeat(40),
    expectedWorkflowRunId: '81'
  }), { valid: true, passed: true, errors: [] });
});

test('release performance evidence rejects missing workloads, toy adapters, and budget substitution', () => {
  const missingWorkload = passingEvidence();
  delete missingWorkload.workloads['production-mixed-audio'];
  missingWorkload.artifactDigest = sealReleasePerformanceEvidence(missingWorkload).artifactDigest;
  assert.equal(evaluateReleasePerformanceEvidence(missingWorkload).valid, false);

  const toyAdapter = passingEvidence();
  toyAdapter.productionAdapter.qualified = false;
  toyAdapter.artifactDigest = sealReleasePerformanceEvidence(toyAdapter).artifactDigest;
  assert.match(evaluateReleasePerformanceEvidence(toyAdapter).errors.join('\n'), /production adapter/);

  const substitutedBudget = passingEvidence();
  substitutedBudget.metrics.commonQueryFirstPageP95Ms.limit += 10_000;
  substitutedBudget.artifactDigest = sealReleasePerformanceEvidence(substitutedBudget).artifactDigest;
  assert.match(evaluateReleasePerformanceEvidence(substitutedBudget).errors.join('\n'), /published budget/);
});

test('release performance evidence rejects an over-budget metric and any post-seal mutation', () => {
  const slow = passingEvidence('web');
  slow.metrics.rareSearchFirstPageP95Ms.value = 351;
  slow.artifactDigest = sealReleasePerformanceEvidence(slow).artifactDigest;
  assert.match(evaluateReleasePerformanceEvidence(slow).errors.join('\n'), /rareSearchFirstPageP95Ms exceeds/);

  const mutated = passingEvidence();
  mutated.metrics.mixedAudioUnderruns.value = 1;
  assert.match(evaluateReleasePerformanceEvidence(mutated).errors.join('\n'), /artifactDigest/);
});
