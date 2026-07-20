import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeTemporalCapabilities,
  computeGraphAmplitudeBound,
  computeLinearPipelineWakeBound,
  computeMatrixAmplitudeBound,
  computeParallelAmplitudeBound,
  computeRuntimePipelineGraphBound,
  createPowerTopologySnapshot,
  getZeroOutputProof,
  getReachableEnabledPlugins,
  isCurrentZeroOutputProof
} from '../../js/audio/power-topology.js';

test('gain bounds include coherent fan-in, matrix row sums, parallel buses, and Volume gain', () => {
  const nodes = Array.from({ length: 9 }, (_, index) => ({ id: `in-${index}`, gain: 1 }));
  nodes.push({ id: 'out', gain: 1 });
  const graph = computeGraphAmplitudeBound({
    inputNodeIds: nodes.slice(0, 9).map(node => node.id),
    nodes,
    edges: nodes.slice(0, 9).map(node => ({ from: node.id, to: 'out', coefficient: 1 })),
    physicalOutputNodeIds: ['out']
  });
  assert.equal(graph.finite, true);
  assert.equal(graph.amplitude, 9);
  assert.ok(Math.abs(graph.db - 19.08485) < 0.0001);
  assert.equal(computeMatrixAmplitudeBound([[1, -2, 0.5], [0.25, 0.25, 0.25]]), 3.5);
  assert.equal(computeParallelAmplitudeBound([1, 2, 3]), 6);

  const volume = {
    enabled: true,
    id: 1,
    constructor: { name: 'VolumePlugin' },
    getPowerGainUpperBoundDb: () => 24
  };
  const pipeline = computeLinearPipelineWakeBound([volume], 9);
  assert.equal(pipeline.finite, true);
  assert.ok(Math.abs(pipeline.db - 43.08485) < 0.0001);
});

test('unknown gain and graph cycles fail closed', () => {
  assert.equal(computeLinearPipelineWakeBound([{ enabled: true }]).finite, false);
  const cyclic = computeGraphAmplitudeBound({
    inputNodeIds: ['a'],
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [
      { from: 'a', to: 'b', coefficient: 1 },
      { from: 'b', to: 'a', coefficient: 1 }
    ],
    physicalOutputNodeIds: ['b']
  });
  assert.equal(cyclic.finite, false);
});

test('reduced-rate IR bounds keep power wake decisions on the conservative path', () => {
  const reducedRateIr = {
    enabled: true,
    inputBus: 0,
    outputBus: 0,
    constructor: { name: 'IRReverbPlugin' },
    powerGainUpperBoundDb: null
  };
  const linear = computeLinearPipelineWakeBound([reducedRateIr]);
  assert.equal(linear.finite, false);
  assert.equal(linear.reason, 'unbounded-plugin');

  const runtime = computeRuntimePipelineGraphBound({ plugins: [reducedRateIr] });
  assert.equal(runtime.finite, false);
  assert.equal(runtime.reason, 'unbounded-plugin');
});

test('temporal capability aggregation separates skip from same-quantum monitoring safety', () => {
  const stateless = { id: 1, enabled: true, temporalCapability: 'stateless' };
  assert.deepEqual(analyzeTemporalCapabilities([stateless]), {
    capabilities: [{ pluginId: 1, capability: 'stateless', descriptor: null }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    blockerReason: null
  });

  const resetWithoutDescriptor = { id: 2, enabled: true, temporalCapability: 'reset-on-resume' };
  const resetResult = analyzeTemporalCapabilities([resetWithoutDescriptor]);
  assert.equal(resetResult.temporalSkipEligible, true);
  assert.equal(resetResult.monitoringFastWakeEligible, true);
  assert.equal(resetResult.blockerReason, null);
  assert.deepEqual(resetResult.capabilities[0].descriptor, {
    primitive: 'canonical-reset',
    allocationFree: false,
    fixedOperations: 1
  });

  const mustProcess = { id: 3, enabled: true, temporalCapability: 'must-process' };
  const blocked = analyzeTemporalCapabilities([mustProcess]);
  assert.equal(blocked.temporalSkipEligible, false);
  assert.equal(blocked.monitoringFastWakeEligible, false);
  assert.equal(blocked.blockerReason, 'temporal-must-process');

  const undeclaredAge = analyzeTemporalCapabilities([{
    id: 4,
    enabled: true,
    temporalCapability: 'age-by-skipped-frames'
  }]);
  assert.equal(undeclaredAge.temporalSkipEligible, false);
  const explicitAge = analyzeTemporalCapabilities([{
    id: 4,
    enabled: true,
    temporalCapability: 'age-by-skipped-frames',
    monitoringPreparationDescriptor: {
      primitive: 'analytic-age',
      allocationFree: true,
      fixedOperations: 1,
      parameterTimeline: 'topology-invalidates-skip',
      resetFallback: 'canonical-reset',
      stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
    }
  }]);
  assert.equal(explicitAge.temporalSkipEligible, true);
  assert.equal(explicitAge.monitoringFastWakeEligible, false);
});

test('runtime graph bounds follow reachable sections and fail closed on unproven bus routing', () => {
  const sectionOff = { enabled: false, constructor: { name: 'SectionPlugin' } };
  const hiddenUnknown = { enabled: true, constructor: { name: 'UnknownPlugin' } };
  const sectionOn = { enabled: true, constructor: { name: 'SectionPlugin' } };
  const volume = {
    enabled: true,
    inputBus: 0,
    outputBus: 0,
    constructor: { name: 'VolumePlugin' },
    getPowerGainUpperBoundDb: () => 24
  };
  assert.deepEqual(
    getReachableEnabledPlugins([sectionOff, hiddenUnknown, sectionOn, volume]),
    [volume]
  );

  const serial = computeRuntimePipelineGraphBound({
    plugins: [sectionOff, hiddenUnknown, sectionOn, volume],
    outputGainUpperBound: 1,
    physicalOutputCount: 9
  });
  assert.equal(serial.finite, true);
  assert.ok(Math.abs(serial.db - 24) < 0.0001);

  const matrix = computeRuntimePipelineGraphBound({
    plugins: [{
      ...volume,
      getPowerGainUpperBoundDb: () => 0,
      powerChannelMatrix: [[1, -2], [0.5, 0.5]]
    }]
  });
  assert.equal(matrix.amplitude, 3);

  const unprovenBus = computeRuntimePipelineGraphBound({
    plugins: [{ ...volume, inputBus: 1, outputBus: 0 }]
  });
  assert.equal(unprovenBus.finite, false);
  assert.equal(unprovenBus.reason, 'unbounded-routing');

  const bypass = computeRuntimePipelineGraphBound({
    plugins: [hiddenUnknown],
    masterBypass: true,
    outputGainUpperBound: 0.5,
    physicalOutputCount: 2
  });
  assert.equal(bypass.finite, true);
  assert.equal(bypass.amplitude, 0.5);
});

test('zero-output proof includes every physical output only for its source generation', () => {
  const snapshot = createPowerTopologySnapshot({
    topologyRevision: 4,
    workletGraphGeneration: 2,
    plugins: [],
    physicalOutputCount: 2,
    finalOutputGain: 0,
    finalOutputGainPostDominatesAllOutputs: true,
    hasPostGainInjection: false
  });
  const proof = getZeroOutputProof(snapshot);
  assert.equal(proof.proofKind, 'final-output-gain-zero');
  assert.deepEqual(proof.coveredPhysicalOutputIds, [
    'physical-output-0',
    'physical-output-1'
  ]);
  assert.equal(isCurrentZeroOutputProof(proof, snapshot), true);
  assert.equal(isCurrentZeroOutputProof(proof, createPowerTopologySnapshot({
    topologyRevision: 5,
    workletGraphGeneration: 2,
    physicalOutputCount: 2,
    finalOutputGain: 0,
    finalOutputGainPostDominatesAllOutputs: true,
    hasPostGainInjection: false
  })), false);
  assert.equal(isCurrentZeroOutputProof({
    ...proof,
    coveredPhysicalOutputIds: ['physical-output-0']
  }, snapshot), false);
});

test('post-dominating mute proof rejects bypass, parallel, downstream, and bus paths', () => {
  const make = overrides => createPowerTopologySnapshot({
    topologyRevision: 8,
    workletGraphGeneration: 3,
    physicalOutputCount: 1,
    finalOutputGain: 1,
    finalOutputGainPostDominatesAllOutputs: true,
    hasPostGainInjection: false,
    plugins: [{ id: 1, enabled: true, constructor: { name: 'MutePlugin' } }],
    ...overrides
  });
  assert.equal(getZeroOutputProof(make()).proofKind, 'post-dominating-mute');
  assert.equal(getZeroOutputProof(make({ masterBypass: true })).proven, false);
  assert.equal(getZeroOutputProof(make({ parallelPipelineActive: true })).proven, false);
  assert.equal(getZeroOutputProof(make({
    plugins: [
      { id: 1, enabled: true, constructor: { name: 'MutePlugin' } },
      { id: 2, enabled: true, constructor: { name: 'VolumePlugin' } }
    ]
  })).proven, false);
  assert.equal(getZeroOutputProof(make({
    plugins: [{
      id: 1,
      enabled: true,
      inputBus: 1,
      constructor: { name: 'MutePlugin' }
    }]
  })).proven, false);
});
