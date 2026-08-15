import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function createControlRow(kind, value, logarithmic = false) {
  const select = kind === 'select' ? { value } : null;
  const range = kind === 'number'
    ? { value: String(value), disabled: false, dataset: logarithmic
      ? { rangeFineMin: '0.05', rangeFineMax: '20000' }
      : {} }
    : null;
  const number = kind === 'number' ? { value: String(value), disabled: false } : null;
  return {
    style: {},
    querySelector(selector) {
      if (selector === 'select') return select;
      if (selector === 'input[type="range"]') return range;
      if (selector === 'input[type="number"]') return number;
      return null;
    }
  };
}

async function loadPlugin(fileName, className) {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'modulation', fileName), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = `${className}-test`;
      this.channel = null;
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    _setValidatedParameters(params) {
      if (params.enabled !== undefined) this.enabled = params.enabled;
    }
    getParameters() { return { type: this.constructor.name, enabled: this.enabled }; }
    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
    createSelectControl(label, options, value) {
      return createControlRow('select', value);
    }
    createParameterControl(label, minimum, maximum, step, value) {
      return createControlRow('number', value);
    }
    createLogarithmicParameterControl(label, minimum, maximum, step, value) {
      const row = createControlRow('number', value, true);
      row.querySelector('input[type="range"]').dataset.rangeFineMin = String(minimum);
      row.querySelector('input[type="range"]').dataset.rangeFineMax = String(maximum);
      return row;
    }
  }
  const document = {
    createElement() {
      return {
        children: [],
        className: '',
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  const context = { PluginBase, document, window: {}, Float32Array, Float64Array, Uint8Array };
  vm.runInNewContext(source, context, { filename: fileName });
  return context.window[className];
}

function render(plugin, data, parameters, context = {}) {
  const processor = new Function('data', 'parameters', 'context', plugin.processor);
  return processor(data, parameters, context);
}

test('Auto Pan validates state, keeps Style application-only, and exposes immutable styles', async () => {
  const Plugin = await loadPlugin('auto_pan.js', 'AutoPanPlugin');
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'AutoPanPlugin', enabled: true, rt: 0.35, dp: 45, ct: 0, wd: 70, wf: 'Sine', ph: 0
  });
  assert.equal('styleName' in plugin.getParameters(), false);
  assert.equal(Object.isFrozen(Plugin.factoryStyles), true);
  assert.equal(Object.isFrozen(Plugin.factoryStyles['Wide Auto Pan']), true);
  plugin.setParameters({ enabled: false });
  assert.equal(plugin.styleName, 'Gentle Auto Pan');

  plugin.setParameters({ rt: 100, dp: -5, ct: 250, wd: 150, wf: 'invalid', ph: -10 });
  assert.deepEqual([plugin.rt, plugin.dp, plugin.ct, plugin.wd, plugin.wf, plugin.ph],
    [20, 0, 100, 100, 'Sine', 0]);
  assert.equal(plugin.styleName, 'Custom');
  plugin.applyStyle('Fast Auto Pan');
  assert.equal(plugin.styleName, 'Fast Auto Pan');
  assert.equal(plugin.wf, 'Triangle');
  assert.equal(plugin.rt, 4);
});

test('Auto Pan is transparent at zero depth and leaves mono and odd tails unchanged', async () => {
  const Plugin = await loadPlugin('auto_pan.js', 'AutoPanPlugin');
  const plugin = new Plugin();
  const neutral = new Float32Array([0.25, -0.5, 0.75, -1, 0.1, 0.2]);
  const neutralCopy = neutral.slice();
  render(plugin, neutral, {
    enabled: true, sampleRate: 48000, blockSize: 3, channelCount: 2,
    rt: 20, dp: 0, ct: 100, wd: 100, wf: 'Triangle', ph: 360
  });
  assert.deepEqual(neutral, neutralCopy);

  const mono = new Float32Array([0.2, -0.4, 0.6, -0.8]);
  const monoCopy = mono.slice();
  render(plugin, mono, {
    enabled: true, sampleRate: 48000, blockSize: 4, channelCount: 1,
    rt: 4, dp: 100, ct: 0, wd: 100, wf: 'Sine', ph: 0
  });
  assert.deepEqual(mono, monoCopy);

  const five = new Float32Array(5 * 8).fill(1);
  render(plugin, five, {
    enabled: true, sampleRate: 48000, blockSize: 8, channelCount: 5,
    rt: 1, dp: 100, ct: 0, wd: 100, wf: 'Sine', ph: 0
  });
  assert.deepEqual(five.slice(0, 8), five.slice(16, 24));
  assert.deepEqual(five.slice(8, 16), five.slice(24, 32));
  assert.deepEqual(five.slice(32), new Float32Array(8).fill(1));
});

test('Auto Pan waveform transition preserves the old trajectory on the event sample', async () => {
  const Plugin = await loadPlugin('auto_pan.js', 'AutoPanPlugin');
  const plugin = new Plugin();
  const parameters = {
    enabled: true, sampleRate: 48000, blockSize: 32, channelCount: 2,
    rt: 2, dp: 100, ct: 0, wd: 100, wf: 'Sine', ph: 0
  };
  const firstContext = {};
  render(plugin, new Float32Array(64).fill(1), parameters, firstContext);
  const controlContext = structuredClone(firstContext);
  const eventContext = structuredClone(firstContext);
  const control = new Float32Array([1, 1]);
  const event = new Float32Array([1, 1]);
  render(plugin, control, { ...parameters, blockSize: 1 }, controlContext);
  render(plugin, event, { ...parameters, blockSize: 1, wf: 'Triangle' }, eventContext);
  assert.deepEqual(event, control);
});

test('Auto Pan applies the latest fade-up request only at the next dry midpoint', async () => {
  const Plugin = await loadPlugin('auto_pan.js', 'AutoPanPlugin');
  const plugin = new Plugin();
  const base = {
    enabled: true, sampleRate: 1000, blockSize: 1, channelCount: 2,
    rt: 20, dp: 100, ct: 0, wd: 100, wf: 'Sine', ph: 37
  };
  const contexts = [{}, {}, {}];
  const process = (context, frames, waveform) => render(
    plugin, new Float32Array(frames * 2).fill(1),
    { ...base, blockSize: frames, wf: waveform }, context);

  for (const context of contexts) {
    process(context, 1, 'Sine');
    process(context, 4, 'Triangle');
    assert.equal(context.currentWaveform, 'Triangle');
    assert.equal(context.transitionPosition, 4, 'the first waveform is fading up');
  }

  const [latest, cancelled, unchanged] = contexts;
  const latestCompletion = process(latest, 3, 'Sine');
  const cancelledCompletion = process(cancelled, 3, 'Sine');
  const unchangedCompletion = process(unchanged, 3, 'Triangle');
  assert.deepEqual(latestCompletion, unchangedCompletion,
    'a fade-up request does not switch the full-wet waveform directly');
  assert.deepEqual(cancelledCompletion, unchangedCompletion);
  assert.equal(latest.currentWaveform, 'Triangle');
  assert.equal(latest.transitionPosition, 0, 'the pending request starts a new fade-down');

  const latestBeforeMidpoint = process(latest, 3, 'Sine');
  const cancelledBeforeMidpoint = process(cancelled, 3, 'Triangle');
  assert.deepEqual(latestBeforeMidpoint, cancelledBeforeMidpoint,
    're-specification and cancellation remain inactive before the dry midpoint');
  assert.equal(latest.currentWaveform, 'Triangle');
  assert.equal(cancelled.currentWaveform, 'Triangle');

  const latestMidpoint = process(latest, 1, 'Sine');
  const cancelledMidpoint = process(cancelled, 1, 'Triangle');
  assert.deepEqual(latestMidpoint, cancelledMidpoint,
    'waveform adoption occurs on the dry midpoint sample');
  assert.equal(latest.currentWaveform, 'Sine');
  assert.equal(cancelled.currentWaveform, 'Triangle');
  assert.notDeepEqual(process(latest, 1, 'Sine'), process(cancelled, 1, 'Triangle'),
    'the re-specified waveform becomes audible only after the midpoint');
});

test('Auto Filter retains independent bounds and switches conditional standard rows', async () => {
  const Plugin = await loadPlugin('auto_filter.js', 'AutoFilterPlugin');
  const plugin = new Plugin();
  plugin.setParameters({ hf: 100, lf: 8000 });
  assert.equal(plugin.lf, 8000);
  assert.equal(plugin.hf, 100);
  plugin.setParameters({ lf: 1200, hf: 1200 });
  assert.equal(plugin.lf, 1200);
  assert.equal(plugin.hf, 1200);
  assert.equal('styleName' in plugin.getParameters(), false);
  assert.deepEqual(Array.from(Plugin.searchAliases), ['Envelope Filter', 'Auto Wah', 'Wah']);
  plugin.applyStyle('Auto Filter Sweep');
  plugin.setParameters({ enabled: false });
  assert.equal(plugin.styleName, 'Auto Filter Sweep');

  plugin.createUI();
  assert.equal(plugin._uiControls.rt.style.display, '');
  assert.equal(plugin._uiControls.sn.style.display, 'none');
  assert.equal(plugin._uiControls.sp.querySelector('input[type="range"]').disabled, false);
  plugin.setParameters({ md: 'Envelope' });
  assert.equal(plugin._uiControls.rt.style.display, 'none');
  assert.equal(plugin._uiControls.sn.style.display, '');
  assert.equal(plugin._uiControls.sp.querySelector('input[type="range"]').disabled, true);
  plugin.applyStyle('Auto Wah');
  assert.equal(plugin.styleName, 'Auto Wah');
  assert.equal(plugin.ft, 'Band-pass');

  const singleChannel = new Plugin();
  singleChannel.channel = 'L';
  singleChannel.createUI();
  assert.equal(singleChannel._uiControls.sp.style.display, '');
  assert.equal(singleChannel._uiControls.sp.querySelector('input[type="range"]').disabled, true);
  assert.equal(singleChannel._uiControls.sp.querySelector('input[type="number"]').disabled, true);
  singleChannel.channel = '34';
  singleChannel.onChannelSelectionChanged();
  assert.equal(singleChannel._uiControls.sp.querySelector('input[type="range"]').disabled, false);
  assert.equal(singleChannel._uiControls.sp.querySelector('input[type="number"]').disabled, false);
});

test('Auto Filter mix zero is transparent and extreme LFO/envelope settings remain finite', async () => {
  const Plugin = await loadPlugin('auto_filter.js', 'AutoFilterPlugin');
  const plugin = new Plugin();
  const dry = new Float32Array([0.25, -0.5, 0.75, -1, 0.1, 0.2]);
  const dryCopy = dry.slice();
  const base = {
    enabled: true, sampleRate: 48000, blockSize: 3, channelCount: 2,
    md: 'LFO', ft: 'Low-pass', lf: 20000, hf: 20, rs: 20, mx: 0,
    rt: 20, wf: 'Triangle', sp: 180, sn: 60, at: 1, rl: 10, dr: 'Down'
  };
  render(plugin, dry, base);
  assert.deepEqual(dry, dryCopy);

  for (const mode of ['LFO', 'Envelope']) {
    const audio = new Float32Array(5 * 257);
    for (let index = 0; index < audio.length; ++index) audio[index] = Math.sin(index * 0.17);
    render(plugin, audio, { ...base, md: mode, mx: 100, blockSize: 257, channelCount: 5 });
    assert.equal(audio.every(Number.isFinite), true);
  }
});

test('Auto Filter discrete changes retain the old wet formula on the event sample', async () => {
  const Plugin = await loadPlugin('auto_filter.js', 'AutoFilterPlugin');
  const plugin = new Plugin();
  const parameters = {
    enabled: true, sampleRate: 48000, blockSize: 64, channelCount: 2,
    md: 'LFO', ft: 'Low-pass', lf: 200, hf: 4000, rs: 2, mx: 100,
    rt: 0.5, wf: 'Sine', sp: 0, sn: 24, at: 20, rl: 250, dr: 'Up'
  };
  const firstContext = {};
  render(plugin, new Float32Array(128).fill(0.5), parameters, firstContext);
  const controlContext = structuredClone(firstContext);
  const eventContext = structuredClone(firstContext);
  const control = new Float32Array([0.5, 0.5]);
  const event = new Float32Array([0.5, 0.5]);
  render(plugin, control, { ...parameters, blockSize: 1 }, controlContext);
  render(plugin, event, { ...parameters, blockSize: 1, ft: 'High-pass' }, eventContext);
  assert.deepEqual(event, control);
});

test('Auto Filter restarts the latest topology transition within a long block', async () => {
  const Plugin = await loadPlugin('auto_filter.js', 'AutoFilterPlugin');
  const plugin = new Plugin();
  const context = {};
  const base = {
    enabled: true, sampleRate: 1000, blockSize: 1, channelCount: 1,
    md: 'LFO', ft: 'Low-pass', lf: 100, hf: 400, rs: 2, mx: 100,
    rt: 0.5, wf: 'Sine', sp: 0, sn: 24, at: 20, rl: 250, dr: 'Up'
  };
  const process = (frames, overrides = {}) => render(
    plugin, new Float32Array(frames).fill(0.25),
    { ...base, ...overrides, blockSize: frames }, context);

  process(1);
  process(4, { md: 'Envelope', ft: 'Band-pass', dr: 'Down' });
  assert.equal(context.currentMode, 'Envelope');
  assert.equal(context.transitionPosition, 4, 'the first topology is fading up');

  process(4, { md: 'LFO', ft: 'High-pass', wf: 'Triangle' });
  assert.equal(context.currentMode, 'Envelope', 'pending topology waits for the next midpoint');
  assert.equal(context.pendingFilterType, 'High-pass');
  assert.equal(context.transitionPosition, 1,
    'the next fade-down begins before the long block returns');

  process(2, { md: 'LFO', ft: 'High-pass', wf: 'Triangle' });
  assert.equal(context.currentMode, 'Envelope');
  assert.equal(context.transitionPosition, 3);
  process(1, { md: 'LFO', ft: 'High-pass', wf: 'Triangle' });
  assert.equal(context.currentMode, 'LFO');
  assert.equal(context.currentFilterType, 'High-pass');
  assert.equal(context.currentWaveform, 'Triangle');
});
