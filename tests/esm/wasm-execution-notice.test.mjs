import assert from 'node:assert/strict';
import test from 'node:test';
import { createWasmExecutionNotice, updateWasmExecutionNotice } from '../../js/ui/pipeline/wasm-execution-notice.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class WasmPlugin {
  static executionCapabilities = { requiresWasm: true };
  id = 7;
}

function withNoticeGlobals(window, callback) {
  return withGlobals({ window, document: {
    createElement: () => ({ attributes: {}, textContent: '', hidden: false,
      setAttribute(name, value) { this.attributes[name] = value; } })
  } }, callback);
}

function send(plugin, state, reason = null, overrides = {}) {
  updateWasmExecutionNotice(plugin, {
    validated: true, pluginId: plugin.id, pluginType: plugin.constructor.name,
    state, reason, ...overrides
  });
}

test('WASM notice preserves validated state across UI rebuilds and clears on recovery', async () => {
  await withNoticeGlobals({}, () => {
    const plugin = new WasmPlugin();
    send(plugin, 'bypassed', 'wasmUnavailable');
    const first = createWasmExecutionNotice(plugin);
    assert.equal(first.attributes.role, 'status');
    assert.equal(first.attributes['aria-live'], 'polite');
    assert.equal(first.hidden, false);
    assert.match(first.textContent, /not running.*WebAssembly/);
    assert.match(first.textContent, /reset audio or reload EffeTune/);
    const rebuilt = createWasmExecutionNotice(plugin);
    assert.notEqual(rebuilt, first);
    assert.equal(rebuilt.textContent, first.textContent);
    send(plugin, 'active');
    assert.equal(rebuilt.hidden, true);
    assert.equal(rebuilt.textContent, '');
    send(plugin, 'bypassed', 'runtimeFallback');
    assert.equal(rebuilt.hidden, false);
    send(plugin, 'pending');
    assert.equal(rebuilt.hidden, true);
    send(plugin, 'bypassed', 'engineStopped');
    assert.equal(rebuilt.hidden, true);
  });
});

test('WASM notice shows localized settings guidance before a disabled engine reports state', async () => {
  await withNoticeGlobals({ audioPreferences: { useWasmDsp: false }, uiManager: {
    t: key => key === 'status.wasmEffectDisabled' ? 'WebAssembly 音声処理を使用するを有効にしてください。' : key
  } }, () => {
    const plugin = new WasmPlugin();
    const notice = createWasmExecutionNotice(plugin);
    assert.equal(notice.hidden, false);
    assert.match(notice.textContent, /有効にしてください/);
    send(plugin, 'bypassed', 'rolloutDisabled');
    assert.match(notice.textContent, /有効にしてください/);
  });
});

test('WASM notice ignores unvalidated or mismatched messages and stays hidden during normal startup', async () => {
  await withNoticeGlobals({}, () => {
    const plugin = new WasmPlugin();
    const notice = createWasmExecutionNotice(plugin);
    assert.equal(notice.hidden, true);
    for (const override of [{ validated: false }, { pluginId: 99 }, { pluginType: 'AnotherPlugin' }]) {
      send(plugin, 'bypassed', 'wasmUnavailable', override);
      assert.equal(notice.hidden, true);
    }
    send(plugin, 'bypassed', 'wasmUnavailable');
    assert.equal(notice.hidden, false);
  });
});

test('common notice suppresses duplicate execution warnings and preserves filter and compatibility status', async () => {
  await withNoticeGlobals({}, () => {
    const plugin = new WasmPlugin();
    let executionText = 'Old execution warning';
    plugin._executionStatusText = () => executionText;
    plugin._renderStatusMessage = () => {
      plugin.status = plugin._executionStatusText() || 'Filter prepared';
    };
    send(plugin, 'bypassed', 'wasmUnavailable');
    createWasmExecutionNotice(plugin);
    assert.equal(plugin.status, 'Filter prepared');
    const wrapped = plugin._executionStatusText;
    createWasmExecutionNotice(plugin);
    assert.equal(plugin._executionStatusText, wrapped);
    send(plugin, 'bypassed', 'unsupportedSampleRate');
    executionText = 'This sample rate is not supported.';
    plugin._renderStatusMessage();
    assert.equal(plugin.status, executionText);
    send(plugin, 'active');
    executionText = '';
    plugin._renderStatusMessage();
    assert.equal(plugin.status, 'Filter prepared');
  });
});
