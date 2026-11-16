import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPipelineModels } from '../../extension/model.js';
import {
  capturePreparationStatuses, observePreparationStatus,
  mirrorPreparationStatus, refreshPreparationStatuses
} from '../../extension/preparation-status-bridge.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const firAssetEqSource = fs.readFileSync(new URL('../../plugins/fir-asset-eq.js', import.meta.url), 'utf8');
const effects = [
  ['eq/five_band_fir_peq', 'FiveBandFIRPEQPlugin'],
  ['eq/group_delay_eq', 'GroupDelayEqPlugin'],
  ['eq/group_delay_peq', 'GroupDelayPEQPlugin'],
  ['eq/room_eq', 'RoomEqPlugin'],
  ['spatial/crosstalk_cancellation', 'CrosstalkCancellationPlugin'],
  ['basics/fir_crossover', 'FIRCrossoverPlugin']
];

function loadPlugin(file, className) {
  class PluginBase {
    constructor(name) {
      Object.assign(this, { name, id: 1, enabled: true, channel: null, inputBus: null, outputBus: null });
    }
    registerProcessor() {}
    updateParameters() {}
    setPowerUiEnabled() {}
    getParameters() { return { type: this.constructor.name, id: this.id, enabled: this.enabled }; }
    getSerializableParameters() { return this.getParameters(); }
    setSerializedParameters() {}
    setWasmAsset() { return this.revision = (this.revision || 0) + 1; }
    _isCurrentWasmAssetOperation(slot, revision) { return slot === 0 && revision === this.revision; }
  }
  const context = {
    PluginBase, window: {}, console, setTimeout: () => 1, clearTimeout() {},
    Float32Array, ArrayBuffer, Map, Set
  };
  vm.runInNewContext(`${firAssetEqSource}\n${fs.readFileSync(new URL(`../../plugins/${file}.js`, import.meta.url), 'utf8')}\nthis.Plugin = ${className};`, context);
  return context.Plugin;
}

for (const [file, className] of effects) {
  test(`${className} accepts extension-prepared completion and restores its editor status`, async () => {
    const Plugin = loadPlugin(file, className);
    const host = new Plugin();
    const editor = new Plugin();
    editor._statusElement = { textContent: '', dataset: {} };
    let statuses = [];
    observePreparationStatus(host, () => { statuses = capturePreparationStatuses([host]); });
    mirrorPreparationStatus(editor, () => statuses);
    // Isolate the extension's handoff from DSP design; exercise the real effect's
    // status handler and renderers with the revision returned by setWasmAsset.
    host.createOfflineDspState = async () => ({ parameters: {}, assets: new Map([[0, {}]]) });
    const manager = {
      nextPluginId: 2,
      pluginClasses: { [host.name]: Plugin },
      isPluginAvailable: () => true,
      createPlugin: () => host
    };
    await withGlobals({ window: { dspParamPackers: new Map([[className, () => {}]]) } }, async () => {
      await createPipelineModels([{ nm: host.name, id: 1 }], manager);
    });
    host._setStatus('Designing filter…', 'preparing');
    editor._setStatus('Designing filter…', 'preparing');
    assert.equal(editor._statusState, 'preparing');
    host.onWasmAssetState(0, 3, host.revision);
    assert.equal(host._statusState, 'ready');
    refreshPreparationStatuses([editor]);
    assert.equal(editor._statusState, 'ready');
    assert.equal(editor._assetState, 3);
    assert.equal(editor._statusElement.dataset.state, 'ready');
    editor._setStatus('Designing filter…', 'preparing');
    editor._assetState = 1;
    editor._renderStatus?.();
    assert.equal(editor._statusState, 'ready');
    assert.equal(editor._statusElement.dataset.state, 'ready');

    const reopened = new Plugin();
    mirrorPreparationStatus(reopened, () => statuses);
    reopened._setStatus('Designing filter…', 'preparing');
    assert.equal(reopened._statusState, 'ready');
    host._setStatus('The filter could not be prepared.', 'error');
    refreshPreparationStatuses([editor]);
    assert.equal(editor._statusState, 'error');
    host.enabled = false;
    editor.enabled = false;
    host._setStatus('Designing filter…', 'preparing');
    refreshPreparationStatuses([editor]);
    assert.equal(editor._statusMessage, 'Processing is bypassed for this effect.');
    assert.equal(editor._statusState, '');
    host._setStatus('The filter could not be prepared.', 'error');
    refreshPreparationStatuses([editor]);
    assert.equal(editor._statusState, 'error');
  });
}
