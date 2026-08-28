import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'modulation', 'rotary_speaker.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'rotary-speaker-test';
      this.inputBus = null;
      this.outputBus = null;
      this.channel = null;
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    _setValidatedParameters(params) {
      if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
      if (params.inputBus !== undefined) this.inputBus = params.inputBus;
      if (params.outputBus !== undefined) this.outputBus = params.outputBus;
      if (params.channel !== undefined) this.channel = params.channel;
    }
    getParameters() { return { type: this.constructor.name, enabled: this.enabled }; }
    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
    createParameterControl(label, minimum, maximum, step, value, onChange, unit) {
      const range = { type: 'range', value: String(value), dataset: {} };
      const number = { type: 'number', value: String(value) };
      return {
        label, minimum, maximum, step, onChange, unit, hidden: false,
        querySelector(selector) {
          if (selector === 'input[type="range"]') return range;
          if (selector === 'input[type="number"]') return number;
          return null;
        }
      };
    }
    createLogarithmicParameterControl(label, minimum, maximum, step, value, onChange, unit) {
      const row = this.createParameterControl(label, minimum, maximum, step, value, onChange, unit);
      const range = row.querySelector('input[type="range"]');
      range.dataset.rangeFineMin = String(minimum);
      range.dataset.rangeFineMax = String(maximum);
      range.dataset.rangeFineStep = String(step);
      range.value = String((Math.log10(value) - Math.log10(minimum)) /
        (Math.log10(maximum) - Math.log10(minimum)) * 100);
      return row;
    }
    createSelectControl(label, options, value, onChange) {
      const select = { value };
      return {
        label, options, onChange, hidden: false,
        querySelector(selector) { return selector === 'select' ? select : null; }
      };
    }
  }
  const document = {
    createElement(tagName) {
      return {
        tagName, children: [], className: '', hidden: false,
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  const context = { PluginBase, document, window: {} };
  vm.runInNewContext(source, context, { filename: 'rotary_speaker.js' });
  return context.window.RotarySpeakerPlugin;
}

function readControl(row) {
  const select = row.querySelector('select');
  if (select) return select.value;
  return row.querySelector('input[type="number"]').value;
}

function assertControls(plugin, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(readControl(plugin._uiControls[key]), String(value), `${key} control`);
    const range = plugin._uiControls[key].querySelector('input[type="range"]');
    if (range?.dataset.rangeFineMin) {
      const minimum = Number(range.dataset.rangeFineMin);
      const maximum = Number(range.dataset.rangeFineMax);
      const expectedPosition = (Math.log10(value) - Math.log10(minimum)) /
        (Math.log10(maximum) - Math.log10(minimum)) * 100;
      assert.equal(Number(range.value), expectedPosition, `${key} logarithmic range`);
    } else if (range) {
      assert.equal(range.value, String(value), `${key} range`);
    }
  }
}

function processorParameters(plugin, overrides = {}) {
  return {
    ...plugin.getParameters(), sampleRate: 48000, channelCount: 2, blockSize: 256,
    ...overrides
  };
}

test('Rotary Speaker validates its compact ABI and system presets', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  assert.deepEqual(plugin._uiControls.xo.querySelector('input[type="range"]').dataset, {
    rangeFineMin: '200', rangeFineMax: '2000', rangeFineStep: '1'
  });
  plugin.setParameters({ ss: 'Fast', sp: 999, ac: -1, xo: 99999, rb: -999 });
  assert.equal(plugin.ss, 'Fast');
  assert.equal(plugin.sp, 200);
  assert.equal(plugin.ac, 0.1);
  assert.equal(plugin.xo, 2000);
  assert.equal(plugin.rb, -100);
  assertControls(plugin, {
    ss: 'Fast', sp: 200, ac: 0.1, xo: 2000,
    rb: -100, sw: 75, dd: 45, ad: 55, mx: 70
  });

  plugin.setParameters(Plugin.getSystemPresetGroups()[0].presets
    .find(preset => preset.id === 'vintage-rotor-slow').params);
  assert.equal(plugin.ss, 'Slow');
  assertControls(plugin, {
    ss: 'Slow', sp: 100, ac: 2.8, xo: 800,
    rb: -5, sw: 80, dd: 50, ad: 60, mx: 75
  });
  assert.deepEqual(Array.from(Plugin.searchAliases), ['Rotary']);
});

test('Rotary Speaker is bit-transparent at zero mix', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setMx(0);
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const audio = new Float32Array(512);
  for (let index = 0; index < audio.length; ++index) audio[index] = Math.sin(index * 0.03);
  const expected = audio.slice();
  run(audio, processorParameters(plugin), {});
  assert.deepEqual(audio, expected);
});

test('Rotary Speaker speed-state changes are continuous targets and stay finite', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const state = {};
  const audio = new Float32Array(512);
  for (let index = 0; index < audio.length; ++index) audio[index] = Math.sin(index * 0.09);
  run(audio, processorParameters(plugin, { ss: 'Slow' }), state);
  const allocatedDelay = state.lowDelay;
  const slowSpeed = state.hornSpeed;
  run(audio, processorParameters(plugin, { ss: 'Fast', ac: 0.1 }), state);
  assert.ok(state.hornSpeed > slowSpeed);
  run(audio, processorParameters(plugin, { ss: 'Stop', ac: 0.1 }), state);
  const oddChannels = new Float32Array(3 * 127);
  run(oddChannels, processorParameters(plugin, {
    ss: 'Stop', channelCount: 3, blockSize: 127
  }), state);
  assert.equal(state.lowDelay, allocatedDelay);
  assert.ok(state.hornSpeed >= 0);
  assert.equal(audio.every(Number.isFinite), true);
  assert.equal('transitionPosition' in state, false);
});

test('Rotary Speaker Fast 200% to Stop 25% converges monotonically within ten seconds', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const state = {};
  const sampleRate = 48000;
  const blockSize = 4096;
  const silence = new Float32Array(blockSize);
  const fast = processorParameters(plugin, {
    sampleRate, channelCount: 1, blockSize, ss: 'Fast', sp: 200, ac: 0.1
  });
  run(silence, fast, state);
  run(silence, fast, state);
  assert.equal(state.drumSpeed, 11.8);
  assert.equal(state.hornSpeed, 13.6);

  let previousDrumSpeed = state.drumSpeed;
  let previousHornSpeed = state.hornSpeed;
  let stoppedAtFrames = null;
  let elapsedFrames = 0;
  while (elapsedFrames < sampleRate * 10) {
    const frames = Math.min(blockSize, sampleRate * 10 - elapsedFrames);
    run(frames === blockSize ? silence : new Float32Array(frames), {
      ...fast, blockSize: frames, ss: 'Stop', sp: 25, ac: 2.2
    }, state);
    elapsedFrames += frames;
    assert.ok(state.drumSpeed <= previousDrumSpeed);
    assert.ok(state.hornSpeed <= previousHornSpeed);
    previousDrumSpeed = state.drumSpeed;
    previousHornSpeed = state.hornSpeed;
    if (stoppedAtFrames === null && state.drumSpeed === 0 && state.hornSpeed === 0) {
      stoppedAtFrames = elapsedFrames;
    }
  }
  assert.ok(stoppedAtFrames !== null && stoppedAtFrames <= sampleRate * 10);
  assert.equal(state.drumSpeed, 0);
  assert.equal(state.hornSpeed, 0);
  const stoppedDrumPhase = state.drumPhase;
  const stoppedHornPhase = state.hornPhase;
  run(silence, { ...fast, ss: 'Stop', sp: 25, ac: 2.2 }, state);
  assert.equal(state.drumPhase, stoppedDrumPhase);
  assert.equal(state.hornPhase, stoppedHornPhase);
});

test('Rotary Speaker produces no output from fresh silence in mono and odd-channel layouts', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  for (const channelCount of [1, 3, 5]) {
    const blockSize = 127;
    const audio = new Float32Array(channelCount * blockSize);
    run(audio, processorParameters(plugin, { channelCount, blockSize, ss: 'Fast' }), {});
    assert.equal(audio.every(sample => sample === 0), true);
  }
});

test('Rotary Speaker applies Stereo Width only to complete microphone pairs', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const blockSize = 256;
  const render = (channelCount, width, amplitude = 100) => {
    const audio = new Float32Array(channelCount * blockSize);
    for (let channel = 0; channel < channelCount; ++channel) {
      for (let frame = 0; frame < blockSize; ++frame) {
        audio[channel * blockSize + frame] = 0.4 + 0.3 * Math.sin(frame * 0.031);
      }
    }
    run(audio, processorParameters(plugin, {
      channelCount, blockSize, ss: 'Stop', sw: width, dd: 70, ad: amplitude, mx: 100
    }), {});
    return audio;
  };

  assert.deepEqual(render(1, 0), render(1, 100));

  const oddWidth0 = render(3, 0);
  const oddWidth100 = render(3, 100);
  assert.deepEqual(
    oddWidth0.slice(2 * blockSize),
    oddWidth100.slice(2 * blockSize)
  );

  const stereoWidth0 = render(2, 0);
  const stereoWidth100 = render(2, 100);
  assert.ok(stereoWidth0.some((sample, index) =>
    Math.abs(sample - stereoWidth100[index]) > 1e-6));

  const monoAmplitude0 = render(1, 0, 0);
  const monoAmplitude100 = render(1, 0, 100);
  assert.ok(monoAmplitude0.some((sample, index) =>
    Math.abs(sample - monoAmplitude100[index]) > 1e-6));
});

test('Rotary Speaker resets poisoned crossover state and flushes it as one finite group', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);

  const poisoned = {};
  run(new Float32Array([Number.NaN]), processorParameters(plugin, {
    channelCount: 1, blockSize: 1, xo: 200, mx: 100
  }), poisoned);
  assert.deepEqual(Array.from(poisoned.filterState.slice(0, 8)), Array(8).fill(0));

  const denormal = {};
  run(new Float32Array([1e-31]), processorParameters(plugin, {
    channelCount: 1, blockSize: 1, xo: 200, mx: 100
  }), denormal);
  assert.deepEqual(Array.from(denormal.filterState.slice(0, 8)), Array(8).fill(0));
});
