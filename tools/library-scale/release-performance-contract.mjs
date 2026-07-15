import crypto from 'node:crypto';

export const RELEASE_PERFORMANCE_SCHEMA_VERSION = 1;
export const RELEASE_PERFORMANCE_AUTOMATION_VERSION = 'library-scale-production-v1';
export const RELEASE_FIXTURE_COUNT = 1_000_000;

const COMMON_BUDGETS = Object.freeze({
  libraryFirstRowP95Ms: { comparator: 'lt', limit: { electron: 300, web: 500 } },
  rendererHeapIncreaseMiB: { comparator: 'lt', limit: { electron: 100, web: 120 } },
  rendererLongestTaskMs: { comparator: 'lt', limit: { electron: 50, web: 50 } },
  commonQueryFirstPageP95Ms: { comparator: 'lt', limit: { electron: 100, web: 150 } },
  rareSearchFirstPageP95Ms: { comparator: 'lt', limit: { electron: 250, web: 350 } },
  scrollFpsMin: { comparator: 'gte', limit: { electron: 55, web: 55 } },
  domNodesMax: { comparator: 'lt', limit: { electron: 500, web: 500 } },
  arbitraryJumpMaxMs: { comparator: 'lt', limit: { electron: 200, web: 300 } },
  noopScanParsed: { comparator: 'eq', limit: { electron: 0, web: 0 } },
  noopScanPathsPerSecond: { comparator: 'gte', limit: { electron: 25_000, web: 10_000 } },
  noopScanElapsedMs: { comparator: 'lte', limit: { electron: 40_000, web: 100_000 } },
  onePercentUpdateElapsedMs: { comparator: 'lte', limit: { electron: 60_000, web: 150_000 } },
  scanFirstProgressMs: { comparator: 'lte', limit: { electron: 500, web: 500 } },
  scanCancelTerminalMs: { comparator: 'lte', limit: { electron: 1_000, web: 1_000 } },
  scanPauseTerminalMs: { comparator: 'lte', limit: { electron: 1_000, web: 1_000 } },
  scanServicePeakMiB: { comparator: 'lt', limit: { electron: 400, web: 300 } },
  bulkFirstProgressMs: { comparator: 'lte', limit: { electron: 500, web: 500 } },
  bulkReceiptP95Ms: { comparator: 'lte', limit: { electron: 100, web: 150 } },
  bulkReceiptMaxMs: { comparator: 'lte', limit: { electron: 500, web: 500 } },
  bulkCancelAckMs: { comparator: 'lte', limit: { electron: 250, web: 250 } },
  bulkCancelQuiescentMs: { comparator: 'lte', limit: { electron: 1_000, web: 1_000 } },
  bulkCancelVisibleP95Ms: { comparator: 'lte', limit: { electron: 1_000, web: 2_000 } },
  bulkCancelVisibleMaxMs: { comparator: 'lte', limit: { electron: 5_000, web: 5_000 } },
  clickToAudioP95Ms: { comparator: 'lt', limit: { electron: 300, web: 500 } },
  artworkVisibleP95Ms: { comparator: 'lt', limit: { electron: 500, web: 750 } },
  mixedDbLockWaitP95Ms: { comparator: 'lt', limit: { electron: 50, web: 50 } },
  mixedDbLockWaitMaxMs: { comparator: 'lt', limit: { electron: 250, web: 250 } },
  mixedAudioUnderruns: { comparator: 'eq', limit: { electron: 0, web: 0 } },
  mixedUnexpectedPlaybackMutations: { comparator: 'eq', limit: { electron: 0, web: 0 } }
});

const REQUIRED_WORKLOADS = Object.freeze([
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
]);

const PRODUCTION_ADAPTER_IDS = Object.freeze({
  electron: 'electron-library-catalog-utility-v1',
  web: 'web-catalog-worker-v2'
});

export function releasePerformanceBudget(backend) {
  assertBackend(backend);
  return Object.fromEntries(Object.entries(COMMON_BUDGETS).map(([metric, budget]) => [metric, {
    comparator: budget.comparator,
    limit: budget.limit[backend]
  }]));
}

export function evaluateReleasePerformanceEvidence(value, {
  expectedBackend,
  expectedCommitSha,
  expectedWorkflowRunId
} = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, passed: false, errors: ['Evidence must be an object'] };
  }
  const backend = value.backend;
  if (!['electron', 'web'].includes(backend)) errors.push('backend must be electron or web');
  if (expectedBackend && backend !== expectedBackend) errors.push('backend does not match the shard');
  if (value.schemaVersion !== RELEASE_PERFORMANCE_SCHEMA_VERSION) errors.push('schemaVersion is unsupported');
  if (value.kind !== 'library-scale-production-performance') errors.push('kind is invalid');
  if (value.automationVersion !== RELEASE_PERFORMANCE_AUTOMATION_VERSION) errors.push('automationVersion is invalid');
  if (expectedCommitSha && value.commitSha !== expectedCommitSha) errors.push('commitSha does not match the candidate');
  if (expectedWorkflowRunId && String(value.workflowRunId) !== String(expectedWorkflowRunId)) {
    errors.push('workflowRunId does not match the reference run');
  }
  if (!/^[0-9a-f]{40}$/.test(value.commitSha ?? '')) errors.push('commitSha must be an exact lowercase SHA');
  if (!/^[1-9][0-9]*$/.test(String(value.workflowRunId ?? ''))) errors.push('workflowRunId is invalid');
  if (value.fixture?.count !== RELEASE_FIXTURE_COUNT || !Number.isSafeInteger(value.fixture?.seed)) {
    errors.push('fixture identity is not the fixed million-track fixture');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(value.fixture?.digest ?? '')) {
    errors.push('fixture digest is invalid');
  }
  if (value.productionAdapter?.qualified !== true ||
      value.productionAdapter?.id !== PRODUCTION_ADAPTER_IDS[backend]) {
    errors.push('production adapter identity is missing or unqualified');
  }
  if (!value.runtime || typeof value.runtime !== 'object' || !value.machine || typeof value.machine !== 'object') {
    errors.push('runtime and machine identity are required');
  }
  for (const workload of REQUIRED_WORKLOADS) {
    if (value.workloads?.[workload]?.completed !== true || value.workloads[workload].production !== true) {
      errors.push(`workloads.${workload} is missing or is not a production run`);
    }
  }
  if (!sameKeys(value.workloads, REQUIRED_WORKLOADS)) {
    errors.push('workloads do not match the exact published matrix');
  }
  if (backend === 'electron' || backend === 'web') {
    const budgets = releasePerformanceBudget(backend);
    if (!sameKeys(value.metrics, Object.keys(budgets))) {
      errors.push('metrics do not match the exact published budget matrix');
    }
    for (const [metric, budget] of Object.entries(budgets)) {
      const measurement = value.metrics?.[metric];
      if (!measurement || !Number.isFinite(measurement.value)) {
        errors.push(`metrics.${metric} is missing`);
        continue;
      }
      if (measurement.comparator !== budget.comparator || measurement.limit !== budget.limit) {
        errors.push(`metrics.${metric} does not use the published budget`);
        continue;
      }
      if (!compare(measurement.value, budget.comparator, budget.limit)) {
        errors.push(`metrics.${metric} exceeds the published budget`);
      }
    }
  }
  if (!value.audioWorklet || value.audioWorklet.measured !== true ||
      !Number.isFinite(value.audioWorklet.measurementSeconds) || value.audioWorklet.measurementSeconds < 60) {
    errors.push('AudioWorklet mixed-workload evidence is missing');
  }
  const digest = value.artifactDigest;
  if (typeof digest !== 'string' || digest !== computeReleasePerformanceDigest(value)) {
    errors.push('artifactDigest does not match the evidence');
  }
  return { valid: errors.length === 0, passed: errors.length === 0, errors };
}

export function sealReleasePerformanceEvidence(value) {
  const sealed = structuredClone(value);
  delete sealed.artifactDigest;
  sealed.artifactDigest = computeReleasePerformanceDigest(sealed);
  return sealed;
}

export function computeReleasePerformanceDigest(value) {
  const clone = structuredClone(value);
  delete clone.artifactDigest;
  return `sha256:${crypto.createHash('sha256').update(stableJson(clone)).digest('hex')}`;
}

function compare(value, comparator, limit) {
  if (comparator === 'lt') return value < limit;
  if (comparator === 'lte') return value <= limit;
  if (comparator === 'gte') return value >= limit;
  if (comparator === 'eq') return value === limit;
  return false;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertBackend(backend) {
  if (backend !== 'electron' && backend !== 'web') throw new TypeError('backend must be electron or web');
}

function sameKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
