import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(`../../plugins/${name}`, import.meta.url), 'utf8');
const roles = ['SFZNotePlayerPlugin', 'SoundFontPlayerPlugin'];
const invalid = [{ unsupportedOpcodes: ['unknown_authored_setting'] }, { incomplete: true }];

function createPlugin(role, descriptor) {
  class PluginBase {
    constructor() { this.assets = new Map(); }
    registerProcessor() {}
    getParameters() { return {}; }
    getWasmAssets() { return this.assets; }
    clearWasmAsset(slot) { this.assets.delete(slot); }
    setWasmAsset(slot, asset) { this.assets.set(slot, asset); }
  }
  const diagnostics = [];
  const window = {};
  const context = vm.createContext({ window, PluginBase, console: { error: (...args) => diagnostics.push(args) } });
  for (const file of ['sfz-instrument.js', 'others/sfz_note_player.js', 'others/soundfont_player.js']) {
    vm.runInContext(source(file), context);
  }
  const plugin = new window[role]();
  Object.assign(plugin, { sf: 'a'.repeat(24),
    _getLibraryService: async () => ({ prepare: async () => ({ name: 'Instrument', descriptor }) }),
    _getSfzPreparationOptions: async () => ({}),
    _setInstrumentPresentation() {}, _clearVoiceDisplay() {}, _renderStatus() {},
    _renderPresetSelection() {}, updateParameters() {}, _stopPreview() {},
    _finishInitialAssetLoad() {} });
  return { plugin, diagnostics };
}

test('both SoundFont roles reject unsupported or incomplete banks before live publication', async () => {
  for (const role of roles) for (const descriptor of invalid) {
    const { plugin, diagnostics } = createPlugin(role, descriptor);
    await plugin._loadBank();
    assert.equal(plugin.assets.size, 0, `${role} must not publish a partial instrument`);
    assert.equal(plugin._error, 'unsupportedRuntime', `${role} must use the existing localized load failure`);
    assert.equal(plugin._errorMessage().includes('unknown_authored_setting'), false);
    assert.equal(plugin._pending, null);
    assert.ok(diagnostics.length > 0);
  }
});

test('both SoundFont roles reject partial offline banks without updating selection', async () => {
  for (const role of roles) for (const descriptor of invalid) {
    const { plugin } = createPlugin(role, descriptor);
    assert.throws(() => plugin.validatePreparedSfzBank({ descriptor }, false));
    if (role === 'SoundFontPlayerPlugin') {
      await assert.rejects(plugin.createOfflineDspState());
    } else {
      plugin._nativeHydration = { nativeHydration: true };
      await plugin.resolveOfflineDspAssetRequirement();
      assert.equal(plugin.assets.size, 0);
      assert.equal(plugin._error, 'unsupportedRuntime');
    }
  }
});

test('complete banks still publish in both roles and validate offline without presentation changes', async () => {
  for (const role of roles) {
    const descriptor = { payload: new ArrayBuffer(32), footprintBytes: 32 };
    const { plugin } = createPlugin(role, descriptor);
    let presentations = 0;
    plugin._setInstrumentPresentation = () => presentations++;
    assert.doesNotThrow(() => plugin.validatePreparedSfzBank({ descriptor }, false));
    assert.equal(presentations, 0);
    await plugin._loadBank();
    assert.equal(plugin._error, '');
    assert.equal(plugin.assets.get(0).externalAssetSignature, plugin.sf);
  }
});
