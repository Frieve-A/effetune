import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'modulation', 'frequency_shifter.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'frequency-shifter-test';
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
      const range = { type: 'range', value: String(value), disabled: false, dataset: {} };
      const number = { type: 'number', value: String(value), disabled: false };
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
      const position = (Math.log10(value) - Math.log10(minimum)) /
        (Math.log10(maximum) - Math.log10(minimum)) * 100;
      const range = {
        type: 'range', value: String(position), disabled: false,
        dataset: {
          rangeFineMin: String(minimum),
          rangeFineMax: String(maximum),
          rangeFineStep: String(step)
        }
      };
      const number = { type: 'number', value: String(value), disabled: false };
      return {
        label, minimum, maximum, step, onChange, unit, hidden: false,
        querySelector(selector) {
          if (selector === 'input[type="range"]') return range;
          if (selector === 'input[type="number"]') return number;
          return null;
        }
      };
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
  vm.runInNewContext(source, context, { filename: 'frequency_shifter.js' });
  return context.window.FrequencyShifterPlugin;
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
    if (!range) continue;
    if (range.dataset?.rangeFineMin) {
      const minimum = Number(range.dataset.rangeFineMin);
      const maximum = Number(range.dataset.rangeFineMax);
      const expectedPosition = (Math.log10(value) - Math.log10(minimum)) /
        (Math.log10(maximum) - Math.log10(minimum)) * 100;
      assert.equal(range.value, String(expectedPosition), `${key} logarithmic range`);
    } else {
      assert.equal(range.value, String(value), `${key} range`);
    }
  }
}

function processorParameters(plugin, overrides = {}) {
  return {
    ...plugin.getParameters(), sampleRate: 48000, channelCount: 2, blockSize: 128,
    ...overrides
  };
}

test('Frequency Shifter canonicalizes barber bounds atomically and keeps styles app-only', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.setParameters({ mx: 30, mn: 900, md: 'Barber-pole', dr: 'Down' });
  assert.equal(plugin.mn, 30);
  assert.equal(plugin.mx, 900);
  assert.equal(plugin.style, 'Custom');
  assert.equal('style' in plugin.getParameters(), false);
  assertControls(plugin, {
    style: 'Custom', md: 'Barber-pole', sh: 8, cf: 440, mn: 30,
    mx: 900, rt: 0.15, dr: 'Down', sp: 0, mix: 100
  });

  plugin.setStyle('Ring Modulator');
  assert.equal(plugin.style, 'Ring Modulator');
  assert.equal(plugin.md, 'Ring Mod');
  assert.equal(plugin.cf, 440);
  assertControls(plugin, {
    style: 'Ring Modulator', md: 'Ring Mod', sh: 8, cf: 440, mn: 20,
    mx: 800, rt: 0.15, dr: 'Up', sp: 0, mix: 100
  });
  assert.deepEqual(Array.from(Plugin.searchAliases), [
    'Ring Modulator', 'Ring Mod', 'Barber-pole Frequency Shifter',
    'Barber Pole Frequency Shifter'
  ]);
});

test('Frequency Shifter exposes only controls used by the selected mode', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.channel = '3';
  plugin.createUI();
  assert.equal(plugin._modeRows.shiftRow.hidden, false);
  assert.equal(plugin._modeRows.carrierRow.hidden, true);
  assert.equal(plugin._uiControls.sp.querySelector('input[type="range"]').disabled, true);
  assert.equal(plugin._uiControls.sp.querySelector('input[type="number"]').disabled, true);
  plugin.channel = null;
  plugin.onChannelSelectionChanged();
  assert.equal(plugin._uiControls.sp.querySelector('input[type="range"]').disabled, false);
  assert.equal(plugin._uiControls.sp.querySelector('input[type="number"]').disabled, false);
  plugin.setMd('Barber-pole');
  assert.equal(plugin._modeRows.shiftRow.hidden, true);
  assert.equal(plugin._modeRows.minimumRow.hidden, false);
  assert.equal(plugin._modeRows.directionRow.hidden, false);
});

test('Frequency Shifter uses logarithmic controls only for positive frequency rates', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  for (const key of ['cf', 'rt']) {
    const range = plugin._uiControls[key].querySelector('input[type="range"]');
    assert.ok(range.dataset.rangeFineMin, `${key} logarithmic minimum`);
    assert.ok(range.dataset.rangeFineMax, `${key} logarithmic maximum`);
  }
  for (const key of ['sh', 'mn', 'mx']) {
    const range = plugin._uiControls[key].querySelector('input[type="range"]');
    assert.equal(range.dataset?.rangeFineMin, undefined, `${key} remains linear`);
  }

  plugin.setParameters({ cf: 1000, rt: 0.2, sh: 0, mn: 0, mx: 5000 });
  assertControls(plugin, { cf: 1000, rt: 0.2, sh: 0, mn: 0, mx: 5000 });
});

test('Frequency Shifter keeps every mode on the same FIR group delay', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  for (const mode of ['Shift', 'Ring Mod', 'Barber-pole']) {
    const audio = new Float32Array(256);
    audio[0] = 1;
    const state = {};
    run(audio, processorParameters(plugin, {
      md: mode, mix: 0, channelCount: 2, blockSize: 128
    }), state);
    assert.deepEqual(Array.from(audio.slice(0, 114)), new Array(114).fill(0));
    assert.equal(audio[114], 1);
    assert.equal(state.groupDelay, 114);
  }
});

function toneMagnitude(audio, start, sampleRate, frequency) {
  let real = 0;
  let imaginary = 0;
  for (let frame = start; frame < audio.length; ++frame) {
    const phase = 2 * Math.PI * frequency * frame / sampleRate;
    real += audio[frame] * Math.cos(phase);
    imaginary -= audio[frame] * Math.sin(phase);
  }
  return Math.hypot(real, imaginary);
}

test('Frequency Shifter rejects the image sideband throughout its useful input band', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const shift = 100;
  for (const sampleRate of [48000, 96000, 192000]) {
    for (const inputFrequency of [200, 500, 5000, 15000]) {
      const frameCount = sampleRate / 2;
      const audio = new Float32Array(frameCount);
      for (let frame = 0; frame < frameCount; ++frame) {
        audio[frame] = Math.sin(2 * Math.PI * inputFrequency * frame / sampleRate);
      }
      run(audio, processorParameters(plugin, {
        sampleRate, channelCount: 1, blockSize: frameCount,
        md: 'Shift', sh: shift, sp: 0, mix: 100
      }), {});
      const start = sampleRate / 4;
      const desired = toneMagnitude(audio, start, sampleRate, inputFrequency + shift);
      const image = toneMagnitude(audio, start, sampleRate, inputFrequency - shift);
      const rejectionDb = 20 * Math.log10(desired / image);
      const minimumDb = inputFrequency === 200 ? 20 : 30;
      assert.ok(rejectionDb >= minimumDb,
        `${sampleRate} Hz, ${inputFrequency} Hz input: ${rejectionDb.toFixed(2)} dB image rejection`);
    }
  }
});

test('Frequency Shifter mode and direction events remain finite through the wet gate', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const state = {};
  const audio = new Float32Array(256);
  for (let index = 0; index < audio.length; ++index) audio[index] = Math.sin(index * 0.07);
  run(audio, processorParameters(plugin), state);
  const allocatedHistory = state.history;
  run(audio, processorParameters(plugin, { dr: 'Down' }), state);
  assert.equal(state.transitionPosition, 128);
  run(audio, processorParameters(plugin, {
    md: 'Barber-pole', mn: 1200, mx: 20, dr: 'Down', sp: 180
  }), state);
  run(audio, processorParameters(plugin, {
    md: 'Ring Mod', cf: 10000, dr: 'Up', sp: 0
  }), state);
  const oddChannels = new Float32Array(3 * 128);
  run(oddChannels, processorParameters(plugin, {
    md: 'Ring Mod', channelCount: 3, blockSize: 128
  }), state);
  assert.equal(state.history, allocatedHistory);
  assert.equal(audio.every(Number.isFinite), true);
  assert.equal(oddChannels.every(Number.isFinite), true);
});

test('Frequency Shifter normalizes moving barber state when equal bounds become stationary', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const state = {};
  const sampleRate = 48000;
  const blockSize = 512;
  let inputFrame = 0;
  const processTone = (blocks, overrides, collect = false) => {
    const output = [];
    for (let block = 0; block < blocks; ++block) {
      const audio = new Float32Array(2 * blockSize);
      for (let frame = 0; frame < blockSize; ++frame) {
        const sample = Math.sin(2 * Math.PI * 1000 * inputFrame++ / sampleRate);
        audio[frame] = sample;
        audio[blockSize + frame] = sample;
      }
      run(audio, processorParameters(plugin, {
        sampleRate, channelCount: 2, blockSize, md: 'Barber-pole', mix: 100,
        ...overrides
      }), state);
      if (collect) output.push(...audio.subarray(0, blockSize));
    }
    return output;
  };

  processTone(48, { mn: 20, mx: 900, rt: 2, dr: 'Up', sp: 90 });
  processTone(32, { mn: 173, mx: 173, rt: 2, dr: 'Up', sp: 90 });
  assert.equal(state.activeStationary, true);
  assert.equal(new Set(state.barberCarriers).size, 1);
  const stationaryPhase = state.barberPhase;
  const stationary = processTone(96, { mn: 173, mx: 173, rt: 2, dr: 'Up', sp: 90 }, true);
  assert.equal(state.barberPhase, stationaryPhase);
  assert.equal(new Set(state.barberCarriers).size, 1);

  const rms = [];
  for (let offset = 0; offset + 1024 <= stationary.length; offset += 1024) {
    let energy = 0;
    for (let index = offset; index < offset + 1024; ++index) {
      energy += stationary[index] * stationary[index];
    }
    rms.push(Math.sqrt(energy / 1024));
  }
  assert.ok(Math.max(...rms) / Math.min(...rms) < 1.05);

  processTone(1, { mn: 173, mx: 173, rt: 2, dr: 'Down', sp: 90 });
  assert.equal(state.activeDirection, -1);
  assert.equal(state.activeStationary, true);
  const moving = processTone(1, { mn: 20, mx: 900, rt: 2, dr: 'Down', sp: 90 }, true);
  assert.equal(state.activeStationary, false);
  assert.ok(new Set(state.barberCarriers).size > 1);
  assert.equal(moving.every(Number.isFinite), true);
});

test('Frequency Shifter stages the latest topology without restarting an active envelope', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', 'context', plugin.processor);
  const state = {};
  const process = (frames, overrides = {}) => run(
    new Float32Array((overrides.channelCount || 2) * frames),
    processorParameters(plugin, { blockSize: frames, ...overrides }), state);

  process(1);
  process(32, { md: 'Barber-pole', dr: 'Down' });
  assert.equal(state.transitionPosition, 32);
  assert.equal(state.activeMode, 0);
  assert.equal(state.pendingMode, 2);
  assert.equal(state.pendingDirection, -1);

  process(32, { md: 'Ring Mod', dr: 'Up' });
  assert.equal(state.transitionPosition, 64);
  assert.equal(state.activeMode, 0);
  assert.equal(state.pendingMode, 1);
  process(1, { md: 'Ring Mod', dr: 'Up' });
  assert.equal(state.transitionPosition, 65);
  assert.equal(state.activeMode, 1);

  process(63, { md: 'Barber-pole', dr: 'Down' });
  assert.equal(state.transitionPosition, 0);
  assert.equal(state.activeMode, 1);
  assert.equal(state.pendingMode, 2);

  process(32, { md: 'Ring Mod', dr: 'Up' });
  assert.equal(state.transitionPosition, 32);
  process(32, { md: 'Ring Mod', dr: 'Up' });
  assert.equal(state.transitionPosition, 64);
  process(1, { md: 'Ring Mod', dr: 'Up' });
  assert.equal(state.transitionPosition, 65);
  assert.equal(state.activeMode, 1);

  process(63, { md: 'Barber-pole', dr: 'Up' });
  process(64, { md: 'Barber-pole', dr: 'Up' });
  process(1, { md: 'Barber-pole', dr: 'Up' });
  assert.equal(state.activeMode, 2);
  assert.equal(state.activeDirection, 1);
  assert.equal(state.transitionPosition, 65);

  process(63, { md: 'Barber-pole', dr: 'Down' });
  assert.equal(state.transitionPosition, 0);
  process(32, { md: 'Barber-pole', dr: 'Up' });
  process(32, { md: 'Barber-pole', dr: 'Up' });
  process(1, { md: 'Barber-pole', dr: 'Up' });
  assert.equal(state.activeDirection, 1);
  assert.ok(Array.from(state.barberCarriers).some(value => value !== 0));

  process(63, { md: 'Barber-pole', dr: 'Down' });
  process(64, { md: 'Barber-pole', dr: 'Down' });
  process(1, { md: 'Barber-pole', dr: 'Down' });
  assert.equal(state.activeDirection, -1);

  const allocatedHistory = state.history;
  process(8, { md: 'Ring Mod', dr: 'Up', channelCount: 3 });
  assert.equal(state.history, allocatedHistory);
  assert.equal(state.activeMode, 1);
  assert.equal(state.activeDirection, 1);
  assert.equal(state.pendingMode, 1);
  assert.equal(state.transitionPosition, 128);
});
