import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(path.join(repoRoot, 'plugins', 'modulation', 'chorus.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'chorus-test';
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
    isAllowedEnum(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
    getParameters() {
      return {
        type: this.constructor.name, id: this.id, enabled: this.enabled,
        ...(this.inputBus !== null && { inputBus: this.inputBus }),
        ...(this.outputBus !== null && { outputBus: this.outputBus }),
        ...(this.channel !== null && { channel: this.channel })
      };
    }
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
        },
        querySelectorAll() { return []; }
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
    createRadioGroup(label, values, value, onChange) {
      const radios = values.map(option => ({ type: 'radio', value: option, checked: option === value }));
      return {
        label, values, onChange, hidden: false,
        querySelector() { return null; },
        querySelectorAll(selector) { return selector === 'input[type="radio"]' ? radios : []; }
      };
    }
    createSelectControl(label, values, value, onChange) {
      const select = { value };
      return {
        label, values, onChange, hidden: false,
        querySelector(selector) { return selector === 'select' ? select : null; },
        querySelectorAll() { return []; }
      };
    }
  }
  const document = {
    createElement() {
      return {
        children: [], className: '', hidden: false,
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  const context = { PluginBase, document, window: {}, Float32Array, Float64Array };
  vm.runInNewContext(source, context, { filename: 'chorus.js' });
  return context.window.ChorusPlugin;
}

function readControl(row) {
  const select = row.querySelector('select');
  if (select) return select.value;
  const number = row.querySelector('input[type="number"]');
  if (number) return number.value;
  return row.querySelectorAll('input[type="radio"]').find(radio => radio.checked)?.value;
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

function parameters(plugin, overrides = {}) {
  const { type, ...values } = plugin.getParameters();
  return { ...values, sampleRate: 48000, blockSize: 127, channelCount: 2, ...overrides };
}

test('Chorus validates one atomic snapshot and serializes canonical Depth', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'ChorusPlugin', id: 'chorus-test', md: 'Chorus', rt: 0.8, dl: 12, dp: 3,
    vc: 3, ss: 60, fb: 0, mx: 45, enabled: true
  });
  plugin.id = 'chorus-host-state';
  plugin.inputBus = 2;
  plugin.outputBus = 3;
  plugin.channel = 'L';
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.getParameters())).inputBus,
    2
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.getParameters())).outputBus,
    3
  );
  assert.equal(plugin.getParameters().id, 'chorus-host-state');
  assert.equal(plugin.getParameters().channel, 'L');

  plugin.setParameters({ dp: 20, dl: 3, vc: 99, fb: -120 });
  assert.deepEqual({ dl: plugin.dl, dp: plugin.dp, vc: plugin.vc, fb: plugin.fb },
    { dl: 3, dp: 3, vc: 6, fb: -75 });
  plugin.setParameters({ dl: 10, dp: Number.NaN });
  assert.equal(plugin.dp, 3, 'invalid Depth keeps the previous canonical value');

  const reversed = new Plugin();
  reversed.setParameters({ dl: 2, dp: 9 });
  const canonical = new Plugin();
  canonical.setParameters({ dp: 2, dl: 2 });
  assert.deepEqual({ dl: reversed.dl, dp: reversed.dp }, { dl: canonical.dl, dp: canonical.dp });
});

test('Chorus system presets use ordinary parameters and mode rows remain conditional', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const ui = plugin.createUI();
  assert.equal(ui.className, 'chorus-plugin-ui plugin-parameter-ui');
  assert.equal(plugin._modeRows.voices.hidden, false);
  assert.equal(plugin._modeRows.spread.hidden, true);
  assert.deepEqual(plugin._uiControls.rt.querySelector('input[type="range"]').dataset, {
    rangeFineMin: '0.05', rangeFineMax: '10', rangeFineStep: '0.01'
  });
  const presets = Plugin.getSystemPresetGroups()[0].presets;
  plugin.setParameters(presets.find(preset => preset.id === 'jet-flanger').params);
  assert.deepEqual({ md: plugin.md, dl: plugin.dl, dp: plugin.dp, fb: plugin.fb },
    { md: 'Flanger', dl: 1.5, dp: 1.4, fb: -75 });
  assert.equal(plugin._modeRows.voices.hidden, true);
  assert.equal(plugin._modeRows.spread.hidden, false);
  assert.equal(plugin._modeRows.feedback.hidden, false);
  assert.equal(plugin._modeRows.mix.hidden, false);
  assertControls(plugin, {
    md: 'Flanger', rt: 0.18, dl: 1.5, dp: 1.4,
    vc: 1, ss: 70, fb: -75, mx: 55
  });
  plugin.setParameters({ dl: 2, dp: 9 });
  assertControls(plugin, { dl: 2, dp: 2 });
  plugin.setParameters(presets.find(preset => preset.id === 'vibrato').params);
  assert.equal(plugin._modeRows.mix.hidden, true);
  assert.deepEqual(Array.from(Plugin.searchAliases), ['Stereo Chorus', 'Ensemble', 'Flanger', 'Vibrato']);
});

test('Chorus hides Stereo Spread unless the mode uses it and the channel selection has a pair', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ md: 'Flanger' });
  plugin.channel = 'R';
  plugin.createUI();
  assert.equal(plugin._modeRows.spread.hidden, true, 'single-channel creation hides spread');

  plugin.channel = '56';
  plugin.onChannelSelectionChanged();
  assert.equal(plugin._modeRows.spread.hidden, false, 'a selected pair shows spread');

  plugin.setParameters({ md: 'Chorus' });
  assert.equal(plugin._modeRows.spread.hidden, true, 'mode visibility still applies');
  plugin.channel = 'A';
  plugin.onChannelSelectionChanged();
  assert.equal(plugin._modeRows.spread.hidden, true, 'all channels do not override the mode');
});

test('Chorus reference processor is dry-transparent at Mix 0 and deterministic', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const input = new Float32Array(254);
  for (let index = 0; index < input.length; ++index) input[index] = Math.sin(index * 0.17) * 0.4;
  const dry = input.slice();
  const dryResult = process({}, dry, parameters(plugin, { mx: 0 }));
  assert.deepEqual(dryResult, input);

  const first = input.slice();
  const second = input.slice();
  process({}, first, parameters(plugin, { md: 'Ensemble', vc: 6, dl: 5, dp: 20, mx: 70 }));
  process({}, second, parameters(plugin, { md: 'Ensemble', vc: 6, dl: 5, dp: 5, mx: 70 }));
  assert.deepEqual(first, second, 'processor repeats the authoritative Delay/Depth rule');
  assert.ok(first.every(Number.isFinite));

  const narrow = input.slice();
  const hiddenSpread = input.slice();
  process({}, narrow, parameters(plugin, { md: 'Chorus', ss: 0 }));
  process({}, hiddenSpread, parameters(plugin, { md: 'Chorus', ss: 100 }));
  assert.deepEqual(narrow, hiddenSpread, 'Chorus mode ignores its hidden Stereo Spread value');
});

test('Chorus reference processor handles discrete transitions without non-finite output', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const context = {};
  for (const mode of ['Chorus', 'Ensemble', 'Flanger', 'Vibrato', 'Stereo Chorus']) {
    const block = new Float32Array(254);
    block.fill(0.25);
    process(context, block, parameters(plugin, { md: mode, vc: mode === 'Ensemble' ? 6 : 2,
      dl: 2, dp: 1.8, fb: 75, mx: 100 }));
    assert.ok(block.every(Number.isFinite), `${mode} stays finite`);
  }
});

test('Stereo Chorus is active on a fresh stereo context and applies Stereo Spread', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const context = {};
  const frameCount = 4096;
  const audio = new Float32Array(frameCount * 2);
  for (let frame = 0; frame < frameCount; ++frame) {
    const sample = Math.sin(frame * 0.017) * 0.5;
    audio[frame] = sample;
    audio[frameCount + frame] = sample;
  }
  process(context, audio, parameters(plugin, {
    blockSize: frameCount, channelCount: 2, md: 'Stereo Chorus', rt: 0.65,
    dl: 15, dp: 4, vc: 2, ss: 80, mx: 100
  }));

  assert.equal(context.chorusMode, 'Stereo Chorus');
  assert.equal(context.chorusTransition, 0, 'fresh context starts directly in the requested topology');
  assert.ok(audio.every(Number.isFinite));
  assert.ok(audio.subarray(0, frameCount).some((sample, frame) =>
    sample !== audio[frameCount + frame]),
  'active Stereo Chorus offsets the right channel when Stereo Spread is non-zero');
});

test('Chorus changes the wet topology only at the dry midpoint', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const unchanged = {};
  const changed = {};
  const base = parameters(plugin, { blockSize: 128, md: 'Chorus', vc: 3, mx: 100 });
  const warm = new Float32Array(256);
  warm.fill(0.2);
  process(unchanged, warm.slice(), base);
  process(changed, warm.slice(), base);

  const reference = warm.slice();
  const event = warm.slice();
  process(unchanged, reference, base);
  process(changed, event, { ...base, md: 'Flanger', vc: 1, dl: 2, dp: 1, fb: 50 });
  assert.equal(event[0], reference[0], 'the event sample remains on the old wet trajectory');
  assert.equal(changed.chorusMode, 'Chorus');
  assert.equal(changed.chorusTransition, 1);

  process(changed, warm.slice(), { ...base, md: 'Flanger', vc: 1, dl: 2, dp: 1, fb: 50 });
  assert.equal(changed.chorusMode, 'Flanger');
  assert.equal(changed.chorusTransition, 2);
});

test('Chorus restarts the latest topology transition within a long block', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const processReference = new Function('context', 'data', 'parameters', plugin.processor);
  const context = {};
  const base = parameters(plugin, {
    sampleRate: 1000, blockSize: 1, channelCount: 1, md: 'Chorus', vc: 3, mx: 100
  });
  const process = (frames, overrides = {}) => processReference(
    context, new Float32Array(frames).fill(0.2),
    { ...base, ...overrides, blockSize: frames });

  process(1);
  process(6, { md: 'Flanger', vc: 1, dl: 2, dp: 1, fb: 50 });
  assert.equal(context.chorusMode, 'Flanger');
  assert.equal(context.chorusTransition, 2);
  assert.equal(context.chorusTransitionPosition, 1, 'the first topology is fading up');

  process(5, { md: 'Ensemble', vc: 6 });
  assert.equal(context.chorusMode, 'Flanger', 'pending topology waits for the next midpoint');
  assert.equal(context.chorusPendingMode, 'Ensemble');
  assert.equal(context.chorusTransition, 1);
  assert.equal(context.chorusTransitionPosition, 1,
    'the next fade-down begins before the long block returns');

  process(3, { md: 'Ensemble', vc: 6 });
  assert.equal(context.chorusMode, 'Flanger');
  assert.equal(context.chorusTransitionPosition, 4);
  process(1, { md: 'Ensemble', vc: 6 });
  assert.equal(context.chorusMode, 'Ensemble');
  assert.equal(context.chorusVoices, 6);
  assert.equal(context.chorusTransition, 2);
});

test('Ensemble voice modulation remains continuous when the base phase wraps', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const frameCount = 6000;
  const audio = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; ++frame) audio[frame] = frame / frameCount;
  process({}, audio, parameters(plugin, {
    sampleRate: 48000, channelCount: 1, blockSize: frameCount,
    md: 'Ensemble', rt: 10, dl: 20, dp: 6, vc: 6, ss: 0, mx: 100
  }));
  assert.ok(Math.abs(audio[4800] - audio[4799]) < 0.003,
    'the 10 Hz base-phase wrap must not reset the decorrelated voice angles');
});
