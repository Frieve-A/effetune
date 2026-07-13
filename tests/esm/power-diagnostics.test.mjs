import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POWER_DIAGNOSTIC_COUNTER_KEYS,
  POWER_DIAGNOSTICS_KEYS,
  PowerDiagnostics
} from '../../js/audio/power-diagnostics.js';

test('power diagnostics exposes the exact monotonic counter schema', () => {
  let now = 10;
  const diagnostics = new PowerDiagnostics(() => now++);
  assert.equal(diagnostics.increment('pluginVisualRafCallbacks'), true);
  assert.equal(diagnostics.increment('unknown'), false);
  diagnostics.mergeWorkletCounters({
    renderQuanta: 4,
    detectorQuanta: 4,
    fullProcessQuanta: 2,
    telemetryReads: 2,
    telemetryPosts: 1
  }, { workletGraphGeneration: 3, sourceId: 'primary', runtime: 'js' });
  diagnostics.recordEffectiveCommit(3);
  const snapshot = diagnostics.getSnapshot();
  assert.deepEqual(Object.keys(snapshot), [...POWER_DIAGNOSTICS_KEYS]);
  assert.deepEqual(Object.keys(snapshot.counters), [...POWER_DIAGNOSTIC_COUNTER_KEYS]);
  assert.equal(snapshot.counterEpoch, 1);
  assert.equal(snapshot.effectiveCommitSequence, 1);
  assert.equal(snapshot.workletGraphGeneration, 3);
  assert.equal(snapshot.counters.pluginVisualRafCallbacks, 1);
  assert.equal(snapshot.counters.workletRenderBlocks, 4);
  assert.equal(snapshot.counters.fullJsProcessBlocks, 2);
  assert.equal(snapshot.counters.telemetryReads, 2);

  diagnostics.beginEpoch({ workletGraphGeneration: 4 });
  const reset = diagnostics.getSnapshot();
  assert.equal(reset.counterEpoch, 2);
  assert.equal(reset.effectiveCommitSequence, 0);
  assert.equal(reset.workletGraphGeneration, 4);
  assert.ok(Object.values(reset.counters).every(value => value === 0));
});

test('worklet absolute counters are aggregated monotonically across sources and graph resets', () => {
  const diagnostics = new PowerDiagnostics(() => 1);
  const merge = (counters, options) => diagnostics.mergeWorkletCounters(counters, options);

  merge({ renderQuanta: 5, detectorQuanta: 5, fullProcessQuanta: 3 }, {
    workletGraphGeneration: 1,
    sourceId: 'a',
    runtime: 'js'
  });
  merge({ renderQuanta: 7, detectorQuanta: 7, fullProcessQuanta: 4 }, {
    workletGraphGeneration: 1,
    sourceId: 'a',
    runtime: 'js'
  });
  merge({ renderQuanta: 2, detectorQuanta: 2, fullProcessQuanta: 2 }, {
    workletGraphGeneration: 1,
    sourceId: 'b',
    runtime: 'wasm'
  });
  let counters = diagnostics.getSnapshot().counters;
  assert.equal(counters.workletRenderBlocks, 9);
  assert.equal(counters.detectorBlocks, 9);
  assert.equal(counters.fullJsProcessBlocks, 4);
  assert.equal(counters.fullWasmProcessBlocks, 2);

  merge({ renderQuanta: 1, detectorQuanta: 1, fullProcessQuanta: 1 }, {
    workletGraphGeneration: 2,
    sourceId: 'a',
    runtime: 'js'
  });
  counters = diagnostics.getSnapshot().counters;
  assert.equal(counters.workletRenderBlocks, 10);
  assert.equal(counters.fullJsProcessBlocks, 5);
  assert.equal(diagnostics.recordEffectiveCommit(-1), false);
  assert.throws(
    () => diagnostics.beginEpoch({ workletGraphGeneration: -1 }),
    /nonnegative/
  );
});
