import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SHIPPED_ENABLED_TYPES } from '../../js/audio/dsp-rollout.js';
import { packBandwidthExtenderPluginParams } from '../../js/audio/dsp-params.generated.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'saturation', 'bandwidth_extender.js'), 'utf8');
  class PluginBase {
    constructor() {
      this.enabled = true;
      this.id = 'bandwidth-extender-test';
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    isAllowedEnum(value, allowed, fallback) {
      return allowed.includes(value) ? value : fallback;
    }
    getSerializableParameters() {
      const params = JSON.parse(JSON.stringify(this.getParameters()));
      const { type, id, inputBus, outputBus, channel, ...serialized } = params;
      if (inputBus !== undefined) serialized.ib = inputBus;
      if (outputBus !== undefined) serialized.ob = outputBus;
      if (channel !== null && channel !== undefined) serialized.ch = channel;
      return serialized;
    }
    setSerializedParameters(params) {
      const { nm, en, id, ib, ob, ch, ...pluginParams } = params;
      this.setParameters({
        type: this.constructor.name,
        enabled: en,
        ...(id !== undefined && { id }),
        ...(ib !== undefined && { inputBus: ib }),
        ...(ob !== undefined && { outputBus: ob }),
        ...(ch !== undefined && { channel: ch }),
        ...pluginParams
      });
    }
    updateParameters() {}
    createParameterControl(label, minimum, maximum, step, value, onChange, unit) {
      return { label, minimum, maximum, step, value, onChange, unit, hidden: false };
    }
    createRadioGroup(label, values, value, onChange) {
      return { label, values, value, onChange, hidden: false };
    }
  }
  const document = {
    createElement() {
      return {
        children: [], hidden: false, textContent: '',
        appendChild(child) { this.children.push(child); },
        setAttribute() {}
      };
    }
  };
  const context = { PluginBase, document, window: {} };
  vm.runInNewContext(source, context, { filename: 'bandwidth_extender.js' });
  return context.window.BandwidthExtenderPlugin;
}

test('Bandwidth Extender exposes independent 0-200% Harmonic and Noise amounts', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.getParameters())),
    { type: 'BandwidthExtenderPlugin', ha: 100, na: 100, cm: 'Auto', cf: 16000, enabled: true }
  );

  const [harmonicControl, noiseControl] = plugin.createUI().children;
  const controlShape = control => ({
    label: control.label,
    minimum: control.minimum,
    maximum: control.maximum,
    step: control.step,
    value: control.value,
    unit: control.unit
  });
  assert.deepEqual(controlShape(harmonicControl), {
    label: 'Harmonic Amount', minimum: 0, maximum: 200, step: 1, value: 100, unit: '%'
  });
  assert.deepEqual(controlShape(noiseControl), {
    label: 'Noise Amount', minimum: 0, maximum: 200, step: 1, value: 100, unit: '%'
  });

  harmonicControl.onChange(200);
  noiseControl.onChange(0);
  assert.deepEqual(
    { ha: plugin.getParameters().ha, na: plugin.getParameters().na },
    { ha: 200, na: 0 }
  );
  plugin.setParameters({ ha: 250, na: -1 });
  assert.deepEqual(
    { ha: plugin.getParameters().ha, na: plugin.getParameters().na },
    { ha: 200, na: 0 }
  );
});

test('Bandwidth Extender serializes and restores independent amounts only', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ ha: 18 });
  plugin.setParameters({ na: 82 });

  const serialized = plugin.getSerializableParameters();
  assert.deepEqual(
    { ha: serialized.ha, na: serialized.na },
    { ha: 18, na: 82 }
  );
  const restored = new Plugin();
  restored.setSerializedParameters({ ha: serialized.ha, na: serialized.na });
  assert.deepEqual(
    { ha: restored.getParameters().ha, na: restored.getParameters().na },
    { ha: 18, na: 82 }
  );

  restored.setParameters({ ha: 45, na: 55 });
  restored.setParameters({ ha: Number.NaN, na: 'invalid' });
  assert.deepEqual(
    { ha: restored.getParameters().ha, na: restored.getParameters().na },
    { ha: 45, na: 55 },
    'invalid amount updates preserve the current values'
  );

  const defaults = new Plugin();
  assert.deepEqual(
    { ha: defaults.getParameters().ha, na: defaults.getParameters().na },
    { ha: 100, na: 100 }
  );

  let restoredParameters;
  const setParameters = defaults.setParameters.bind(defaults);
  defaults.setParameters = params => {
    restoredParameters = params;
    setParameters(params);
  };
  defaults.setSerializedParameters({ ch: 'left', ha: 31, na: 69 });
  assert.equal(restoredParameters.channel, 'left');
  assert.equal(Object.hasOwn(restoredParameters, 'ch'), false);
  assert.deepEqual(
    { ha: defaults.getParameters().ha, na: defaults.getParameters().na },
    { ha: 31, na: 69 },
    'serialized ch remains a structural channel key'
  );
});

test('Bandwidth Extender generated packer defaults and clamps both amounts consistently', () => {
  assert.deepEqual(Array.from(packBandwidthExtenderPluginParams()), [100, 100, 0, 16000]);
  assert.deepEqual(
    Array.from(packBandwidthExtenderPluginParams({ ha: 250, na: -1, cm: 'Manual', cf: 12000 })),
    [200, 0, 1, 12000]
  );
});

test('Bandwidth Extender retains its WASM rollout and reset-on-resume capabilities', async () => {
  const Plugin = await loadPlugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedSampleRates), [
    44100, 48000, 88200, 96000, 176400, 192000
  ]);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedChannelModes), [
    'mono', 'stereo-pair'
  ]);
  assert.equal(new Plugin().getTemporalCapability(), 'reset-on-resume');
  assert.equal(SHIPPED_ENABLED_TYPES.includes('BandwidthExtenderPlugin'), true);
});
