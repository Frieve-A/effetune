import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = ['plugin-base.js', 'sfz-instrument.js', 'others/sfz_note_player.js', 'others/soundfont_player.js']
  .map(path => fs.readFileSync(new URL(`../../plugins/${path}`, import.meta.url), 'utf8')).join('\n');

function instrument(type, t) {
  const diagnostics = [];
  const node = { port: { addEventListener() {}, removeEventListener() {}, postMessage() {} } };
  const window = { workletNode: node };
  vm.runInNewContext(sources, { window, document: {}, console: { error: (...args) => diagnostics.push(args), warn() {} },
    MutationObserver: class { observe() {} disconnect() {} }, performance: { now: () => 0 },
    setTimeout, clearTimeout, __EFFECTUNE_WASM_ONLY__: true });
  const plugin = new window[type]();
  t.after(() => plugin.cleanup());
  plugin.id = 7;
  plugin.sf = 'a'.repeat(24);
  plugin._status = { textContent: '', hidden: true, dataset: {} };
  const current = (revision, epoch) => {
    plugin._wasmAssetOperationRevisions.set(0, revision);
    plugin._wasmAssetLogicalReplayEpochs.set(0, epoch);
  };
  current(3, 8);
  const state = (phase, revision = 3, epoch = 8) => plugin._handleMessage({ currentTarget: node.port,
    data: { type: 'assetState', pluginId: plugin.id, slot: 0, state: phase,
      operationRevision: revision, replayEpoch: epoch } });
  return { plugin, state, current, diagnostics };
}

for (const type of ['SoundFontPlayerPlugin', 'SFZNotePlayerPlugin']) {
  test(`${type} exposes a persistent plain playback failure after ACTIVE through the real epoch-filtered callback`, t => {
    const { plugin, state, diagnostics } = instrument(type, t);
    state(3);
    assert.equal(plugin._status.hidden, type !== 'SoundFontPlayerPlugin');
    if (type === 'SoundFontPlayerPlugin') {
      assert.match(plugin._status.textContent, /Ready to play/);
      assert.equal(plugin._status.dataset.state, 'ready');
    }
    state(4, 3, 7);
    assert.equal(plugin._error, '', 'A stale replay epoch cannot stop the current source UI');
    state(4, 2, 8);
    assert.equal(plugin._error, '', 'A stale operation cannot stop the current source UI');
    state(4);
    assert.equal(plugin._error, 'playback');
    assert.equal(plugin._status.hidden, false);
    assert.match(plugin._status.textContent, /instrument stopped.*Load it again or choose another instrument/);
    assert.doesNotMatch(plugin._status.textContent, /script|opcode|bytecode|frame|state|pc=|ERROR/);
    assert.equal(diagnostics.length, 1);
    const message = plugin._status.textContent;
    for (const phase of [1, 2, 3, 4]) {
      state(phase);
      assert.equal(plugin._status.textContent, message, `Phase${phase} must not erase the terminal failure`);
    }
    plugin.setParameters({ sf: plugin.sf });
    assert.equal(plugin._status.hidden, false, 'A same-source parameter/status refresh must retain the failure');
    assert.equal(plugin._status.textContent, message);
    plugin._showError({ code: 'storage', message: 'private refresh diagnostic' }, false);
    assert.equal(plugin._status.textContent, message, 'An unrelated list refresh cannot replace the playback failure');
  });

  test(`${type} preserves initial-load meaning and clears runtime failure only for a new current source`, t => {
    const { plugin, state, current } = instrument(type, t);
    state(4);
    assert.equal(plugin._error, 'prepare');
    if (type === 'SoundFontPlayerPlugin') {
      assert.equal(plugin._status.hidden, false, 'The Main status panel always explains preparation failures');
      assert.match(plugin._status.textContent, /could not be loaded/);
      assert.equal(plugin._status.dataset.state, 'error');
    } else assert.equal(plugin._status.hidden, true, 'Note Player automatic initial preparation remains quiet');
    state(3);
    state(4);
    assert.equal(plugin._status.hidden, false);
    current(4, 9);
    plugin.sf = 'b'.repeat(24);
    state(1, 4, 9);
    state(3, 4, 9);
    assert.equal(plugin._error, '');
    assert.equal(plugin._status.hidden, type !== 'SoundFontPlayerPlugin');
    if (type === 'SoundFontPlayerPlugin') assert.match(plugin._status.textContent, /Ready to play/);
    state(4, 3, 8);
    assert.equal(plugin._error, '', 'Late failure of the replaced source is ignored');
    plugin.onWasmAssetRejected(0, 'sample-read', 3);
    assert.equal(plugin._status.hidden, type !== 'SoundFontPlayerPlugin');
  });

  test(`${type} keeps a sample-read failure more specific than the generic runtime failure`, t => {
    const { plugin, state } = instrument(type, t);
    state(3);
    state(4);
    plugin.onWasmAssetRejected(0, 'sample-read', 3);
    assert.equal(plugin._error, 'sampleRead');
    const message = plugin._status.textContent;
    assert.match(message, /sample data could not be loaded/);
    state(4);
    state(2);
    state(3);
    plugin.onWasmAssetRejected(0, 'rejected', 3);
    assert.equal(plugin._error, 'sampleRead');
    assert.equal(plugin._status.textContent, message);
    assert.equal(plugin._status.hidden, false);
  });
}

test('main-player worklet snapshots carry current runtime retirement without changing user parameters', t => {
  const { plugin, state, current } = instrument('SoundFontPlayerPlugin', t);
  assert.equal(plugin.getWorkletPluginData().runtimeAssetErrorRevision, -1);
  state(3); state(4);
  const snapshot = plugin.getWorkletPluginData();
  assert.equal(snapshot.runtimeAssetErrorRevision, 3);
  assert.equal(snapshot.enabled, true);
  assert.equal(Object.hasOwn(plugin.getParameters(), 'runtimeAssetErrorRevision'), false);
  state(3);
  assert.equal(plugin.getWorkletPluginData().runtimeAssetErrorRevision, 3,
    'Internal same-revision replay cannot revive a failed source');
  current(4, 9);
  assert.equal(plugin.getWorkletPluginData().runtimeAssetErrorRevision, -1,
    'An explicit new user operation is admitted normally before its ready notification');
});
