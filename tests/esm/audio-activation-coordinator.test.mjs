import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AudioActivationCoordinator,
  canonicalizeActivationDescriptor
} from '../../js/audio/audio-activation-coordinator.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function createHarness(options = {}) {
  const nodeA = { id: 'a' };
  const nodeB = { id: 'b' };
  const messages = [];
  const graph = {
    audioGraphGeneration: 3,
    workletGraphGeneration: 5,
    topologyRevision: 7
  };
  const nodes = options.nodes || [nodeA, nodeB];
  const coordinator = new AudioActivationCoordinator({
    getGraphSnapshot: () => ({ ...graph }),
    getActiveWorklets: () => [...nodes],
    broadcast: message => messages.push(message),
    freshRenderTimeoutMs: 100
  });
  return { coordinator, graph, messages, nodeA, nodeB, nodes };
}

function playerIntent(generation, config = {}) {
  return {
    intentKind: 'player',
    intentIdentity: {
      playerIntentGeneration: generation,
      sourceGeneration: generation,
      trackKey: `track-${generation}`,
      trackIndex: generation,
      intendedPosition: 0
    },
    resumeKind: 'player-only-play',
    backend: 'buffer-source',
    requiredResourceKeys: ['worklet', 'audio-context', 'worklet'],
    activationAffectingConfig: config
  };
}

async function sendFreshRender(harness, request, sequences = [1, 1]) {
  const entries = harness.nodes.map((node, index) => [node, sequences[index] ?? 1]);
  for (const [node, renderSequence] of entries) {
    harness.coordinator.recordWorkletEvent({
      type: 'powerObservation',
      observationRequestId: request.observationRequestId,
      workletGraphGeneration: request.workletGraphGeneration,
      topologyRevision: request.topologyRevision,
      state: 'active',
      processingDirective: 'full-process',
      renderSequence
    }, node);
  }
  await flush();
}

test('staged activation captures a canonical structural identity and commits only after every current worklet renders', async () => {
  const harness = createHarness();
  const { coordinator, nodeA, nodeB } = harness;
  coordinator.recordWorkletEvent({
    type: 'powerObservation',
    workletGraphGeneration: 5,
    topologyRevision: 7,
    state: 'active',
    processingDirective: 'full-process',
    renderSequence: 10
  }, nodeA);
  coordinator.recordWorkletEvent({
    type: 'powerObservation',
    workletGraphGeneration: 5,
    topologyRevision: 7,
    state: 'active',
    processingDirective: 'full-process',
    renderSequence: 20
  }, nodeB);

  const stage = await coordinator.stageIntent(playerIntent(11, { outputChannels: 2 }));
  assert.equal(stage.generation, 1);
  assert.equal(stage.activationIdentity.playerIntentGeneration, 11);
  assert.deepEqual(stage.activationIdentity.requiredResourceKeys, ['audio-context', 'worklet']);
  assert.deepEqual(stage.activationIdentity.activationAffectingConfig, { outputChannels: 2 });
  assert.equal(Object.isFrozen(stage.activationIdentity), true);
  assert.equal(Object.isFrozen(stage.activationIdentity.requiredResourceKeys), true);
  assert.equal(Object.keys(stage.activationIdentity).length, 5);
  assert.deepEqual(stage.candidateIntentIdentity, stage.descriptor);
  assert.equal(Object.isFrozen(stage.candidateIntentIdentity), true);
  assert.equal(
    canonicalizeActivationDescriptor(stage.candidateIntentIdentity),
    canonicalizeActivationDescriptor(stage.descriptor)
  );

  let commits = 0;
  let settled = false;
  const activation = coordinator.activate(stage, {
    acquire: async () => ({ source: 'candidate' }),
    isCandidateCurrent: () => true,
    commit: candidate => {
      commits++;
      return candidate.source;
    }
  }).then(result => {
    settled = true;
    return result;
  });
  await flush();
  const request = harness.messages.at(-1);
  assert.equal(request.type, 'requestPowerObservation');

  coordinator.recordWorkletEvent({
    type: 'powerObservation',
    observationRequestId: request.observationRequestId,
    workletGraphGeneration: 5,
    topologyRevision: 7,
    state: 'active',
    processingDirective: 'full-process',
    renderSequence: 11
  }, nodeA);
  await flush();
  assert.equal(settled, false);
  assert.equal(commits, 0);

  coordinator.recordWorkletEvent({
    type: 'powerObservation',
    observationRequestId: request.observationRequestId,
    workletGraphGeneration: 5,
    topologyRevision: 7,
    state: 'active',
    processingDirective: 'full-process',
    renderSequence: 21
  }, nodeB);
  const result = await activation;
  assert.equal(result.activated, true);
  assert.equal(result.value, 'candidate');
  assert.equal(commits, 1);
  assert.equal(coordinator.getActiveDescriptor().generation, 1);
  assert.deepEqual(
    coordinator.getActiveDescriptor().candidateIntentIdentity,
    stage.candidateIntentIdentity
  );

  // The structural identity is stable: staging the same intent again yields a
  // deep-equal candidate identity.
  const again = await coordinator.stageIntent(playerIntent(11, { outputChannels: 2 }));
  assert.deepEqual(again.candidateIntentIdentity, stage.candidateIntentIdentity);
});

test('a newer stage makes a late candidate stale without replacing the active descriptor', async () => {
  const harness = createHarness({ nodes: [{ id: 'only' }] });
  const active = await harness.coordinator.stageIntent(playerIntent(1));
  const activePromise = harness.coordinator.activate(active, { isCandidateCurrent: () => true });
  await flush();
  await sendFreshRender(harness, harness.messages.at(-1));
  assert.equal((await activePromise).activated, true);

  let releaseAcquire;
  const acquire = new Promise(resolve => { releaseAcquire = resolve; });
  let cleaned = 0;
  const stale = await harness.coordinator.stageIntent(playerIntent(2));
  const staleActivation = harness.coordinator.activate(stale, {
    acquire: () => acquire,
    isCandidateCurrent: () => true,
    cleanup: () => { cleaned++; }
  });
  await flush();
  const newest = await harness.coordinator.stageIntent(playerIntent(3));
  releaseAcquire({ source: 'late' });

  const result = await staleActivation;
  assert.equal(result.activated, false);
  assert.equal(result.error.code, 'activation-generation-stale');
  assert.equal(cleaned, 1);
  assert.equal(harness.coordinator.getActiveDescriptor().generation, active.generation);
  assert.equal(newest.state, 'staged');
});

test('graph changes and non-full observations fail closed before publication', async () => {
  const harness = createHarness({ nodes: [{ id: 'only' }] });
  const stage = await harness.coordinator.stageIntent(playerIntent(4));
  let commits = 0;
  let cleaned = 0;
  const activation = harness.coordinator.activate(stage, {
    isCandidateCurrent: () => true,
    commit: () => { commits++; },
    cleanup: () => { cleaned++; }
  });
  await flush();
  const request = harness.messages.at(-1);
  harness.graph.topologyRevision++;
  await sendFreshRender(harness, request);
  const result = await activation;

  assert.equal(result.activated, false);
  assert.equal(result.error.code, 'activation-graph-stale');
  assert.equal(commits, 0);
  assert.equal(cleaned, 1);
  assert.equal(harness.coordinator.getActiveDescriptor(), null);

  const monitoringStage = await harness.coordinator.stageIntent(playerIntent(5));
  const monitoring = harness.coordinator.activate(monitoringStage, {
    isCandidateCurrent: () => true
  });
  await flush();
  const monitoringRequest = harness.messages.at(-1);
  harness.coordinator.recordWorkletEvent({
    type: 'powerObservation',
    observationRequestId: monitoringRequest.observationRequestId,
    workletGraphGeneration: monitoringRequest.workletGraphGeneration,
    topologyRevision: monitoringRequest.topologyRevision,
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    renderSequence: 2
  }, harness.nodes[0]);
  assert.equal((await monitoring).activated, false);
});

test('canonical descriptor serialization is stable across object key order', () => {
  assert.equal(
    canonicalizeActivationDescriptor({ z: 1, a: { y: 2, x: 3 } }),
    canonicalizeActivationDescriptor({ a: { x: 3, y: 2 }, z: 1 })
  );
});
