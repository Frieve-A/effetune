import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadPluginBase({ packer } = {}) {
  const source = fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8');
  const warnings = [];
  const messages = [];
  const windowRef = {
    dspParamPackers: packer ? new Map([['PluginBase', packer]]) : new Map(),
    workletNode: {
      port: {
        addEventListener() {},
        removeEventListener() {},
        postMessage(message) {
          messages.push(message);
        }
      }
    }
  };
  const context = {
    window: windowRef,
    document: {},
    Float32Array,
    Uint8Array,
    ArrayBuffer,
    console: {
      error() {},
      log() {},
      warn(...args) {
        warnings.push(args);
      }
    },
    performance: { now: () => 0 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(`${source}\nthis.PluginBaseRef = PluginBase;`, context);
  return { PluginBase: context.PluginBaseRef, messages, warnings, windowRef };
}

function createPlugin(runtime) {
  const plugin = new runtime.PluginBase('DSP Test', 'Packed parameter test');
  plugin.id = 'plugin-7';
  plugin.inputBus = 1;
  plugin.outputBus = 2;
  plugin.channel = '34';
  plugin.getParameters = () => ({ gain: 0.25, enabled: true });
  return plugin;
}

test('PluginBase adds packed parameters to direct worklet updates', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 0xf1234567,
      pack(parameters) {
        return new Float32Array([parameters.gain]);
      }
    }
  });
  const plugin = createPlugin(runtime);

  plugin.updateParameters();

  assert.equal(runtime.messages.length, 1);
  const payload = runtime.messages[0].plugin;
  assert.equal(payload.type, 'PluginBase');
  assert.equal(payload.wasmParamsHash, 0xf1234567);
  assert.deepEqual(Array.from(payload.wasmParams), [0.25]);
  assert.deepEqual(payload.parameters, { gain: 0.25, enabled: true });
});

test('PluginBase keeps JS payloads usable and reports a broken packer once', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 1,
      pack() {
        throw new Error('bad layout');
      }
    }
  });
  const plugin = createPlugin(runtime);

  const first = plugin.getWorkletPluginData();
  const second = plugin.getWorkletPluginData();

  assert.equal(Object.hasOwn(first, 'wasmParams'), false);
  assert.equal(Object.hasOwn(second, 'wasmParamsHash'), false);
  assert.equal(runtime.warnings.length, 1);
  assert.match(runtime.warnings[0][0], /^\[dsp-wasm] Parameter packing failed/);
});

test('PluginBase includes bounded structured parameter bytes atomically', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 0x07080f45,
      byteCapacity: 3076,
      pack() {
        return new Float32Array(0);
      },
      packBytes() {
        return Uint8Array.of(1, 0, 2, 0, 0, 0, 0, 1, 1, 0);
      }
    }
  });
  const payload = createPlugin(runtime).getWorkletPluginData();

  assert.equal(payload.wasmParamsHash, 0x07080f45);
  assert.deepEqual(Array.from(payload.wasmParams), []);
  assert.deepEqual(Array.from(payload.wasmParamBytes), [1, 0, 2, 0, 0, 0, 0, 1, 1, 0]);
});

test('PluginBase drops both numeric and structured data when byte packing is invalid', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 0x07080f45,
      byteCapacity: 4,
      pack() {
        return new Float32Array(0);
      },
      packBytes() {
        return new Uint8Array(5);
      }
    }
  });
  const plugin = createPlugin(runtime);
  const first = plugin.getWorkletPluginData();
  const second = plugin.getWorkletPluginData();

  assert.equal(Object.hasOwn(first, 'wasmParams'), false);
  assert.equal(Object.hasOwn(first, 'wasmParamBytes'), false);
  assert.equal(Object.hasOwn(second, 'wasmParamsHash'), false);
  assert.equal(runtime.warnings.length, 1);
});
