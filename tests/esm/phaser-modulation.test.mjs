import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(path.join(repoRoot, 'plugins', 'modulation', 'phaser.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'phaser-test';
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
      const range = { type: 'range', value: String(value), disabled: false, dataset: {} };
      const number = { type: 'number', value: String(value), disabled: false };
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
  vm.runInNewContext(source, context, { filename: 'phaser.js' });
  return context.window.PhaserPlugin;
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

test('Phaser validates enums, ranges, and even stage counts', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'PhaserPlugin', id: 'phaser-test', md: 'Classic', rt: 0.5, cf: 1000, rg: 3,
    st: 6, fb: 20, sp: 90, dr: 'Up', mx: 50, enabled: true
  });
  plugin.id = 'phaser-host-state';
  plugin.inputBus = 4;
  plugin.outputBus = 5;
  plugin.channel = 'R';
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.getParameters())),
    {
      type: 'PhaserPlugin', id: 'phaser-host-state', enabled: true,
      inputBus: 4, outputBus: 5, channel: 'R', md: 'Classic', rt: 0.5,
      cf: 1000, rg: 3, st: 6, fb: 20, sp: 90, dr: 'Up', mx: 50
    }
  );
  plugin.setParameters({ md: 'invalid', rt: 20, cf: 1, rg: 9, st: 7, fb: -100, sp: 300,
    dr: 'invalid', mx: -1 });
  assert.deepEqual({ md: plugin.md, rt: plugin.rt, cf: plugin.cf, rg: plugin.rg, st: plugin.st,
    fb: plugin.fb, sp: plugin.sp, dr: plugin.dr, mx: plugin.mx },
  { md: 'Classic', rt: 10, cf: 80, rg: 6, st: 8, fb: -90, sp: 180, dr: 'Up', mx: 0 });
  assert.equal(plugin.style, 'Custom');
});

test('Phaser styles and barber Direction visibility use standard rows', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.channel = 'R';
  const ui = plugin.createUI();
  assert.equal(ui.className, 'phaser-plugin-ui plugin-parameter-ui');
  assert.equal(plugin._directionRow.hidden, true);
  assert.deepEqual(plugin._uiControls.rt.querySelector('input[type="range"]').dataset, {
    rangeFineMin: '0.05', rangeFineMax: '10', rangeFineStep: '0.01'
  });
  assert.deepEqual(plugin._uiControls.cf.querySelector('input[type="range"]').dataset, {
    rangeFineMin: '80', rangeFineMax: '8000', rangeFineStep: '1'
  });
  assert.equal(plugin._uiControls.sp.querySelector('input[type="range"]').disabled, true);
  assert.equal(plugin._uiControls.sp.querySelector('input[type="number"]').disabled, true);
  plugin.channel = '78';
  plugin.onChannelSelectionChanged();
  assert.equal(plugin._uiControls.sp.querySelector('input[type="range"]').disabled, false);
  assert.equal(plugin._uiControls.sp.querySelector('input[type="number"]').disabled, false);
  plugin.applyStyle('Barber-pole Down');
  assert.equal(plugin.md, 'Barber-pole');
  assert.equal(plugin.dr, 'Down');
  assert.equal(plugin.style, 'Barber-pole Down');
  assert.equal(plugin._directionRow.hidden, false);
  assertControls(plugin, {
    style: 'Barber-pole Down', md: 'Barber-pole', rt: 0.35, cf: 1000,
    rg: 5, st: 8, fb: 30, sp: 60, dr: 'Down', mx: 55
  });
  plugin.setParameters({ md: 'Classic', rt: 20, cf: 1, rg: 9, st: 7, fb: -100,
    sp: 300, dr: 'Up', mx: -1 });
  assertControls(plugin, {
    style: 'Custom', md: 'Classic', rt: 10, cf: 80, rg: 6,
    st: 8, fb: -90, sp: 180, dr: 'Up', mx: 0
  });
  assert.deepEqual(Array.from(Plugin.searchAliases), ['Barber-pole Phaser', 'Barber Pole Phaser']);
});

test('Phaser barber windows preserve zero-range unity and phase-independent power', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const barber = parameters(plugin, {
    md: 'Barber-pole', rt: 0.05, cf: 1400, rg: 0, st: 2, fb: 0, sp: 0, mx: 100,
    channelCount: 1, blockSize: 1
  });
  const renderProjection = (phase, activeVoices) => {
    const context = {};
    process(context, new Float32Array(1), barber);
    context.phaserPhase = phase;
    context.phaserState.fill(0);
    context.phaserFeedback.fill(0);
    for (const voice of activeVoices) {
      context.phaserState[voice * 12 + 1] = 1;
    }
    const output = new Float32Array(1);
    process(context, output, barber);
    return output[0];
  };

  for (const cycle of [0, 0.071, 0.193, 0.337, 0.781]) {
    const phase = cycle * 2 * Math.PI;
    const unity = renderProjection(phase, [0, 1, 2]);
    assert.ok(Math.abs(unity - 1) < 1e-6, `zero-range unity at cycle ${cycle}`);
    let normalizedPower = 0;
    for (let voice = 0; voice < 3; ++voice) {
      const projection = renderProjection(phase, [voice]);
      normalizedPower += projection * projection;
    }
    assert.ok(Math.abs(normalizedPower - 0.5) < 1e-6,
      `non-correlated window power at cycle ${cycle}: ${normalizedPower}`);
  }
});

test('Phaser reference processor is dry-transparent and deterministic', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const input = new Float32Array(254);
  for (let index = 0; index < input.length; ++index) input[index] = Math.sin(index * 0.11) * 0.5;
  const dry = input.slice();
  process({}, dry, parameters(plugin, { mx: 0 }));
  assert.deepEqual(dry, input);

  const first = input.slice();
  const second = input.slice();
  const barber = parameters(plugin, { md: 'Barber-pole', dr: 'Down', st: 12, fb: -90, mx: 100 });
  process({}, first, barber);
  process({}, second, barber);
  assert.deepEqual(first, second);
  assert.ok(first.every(Number.isFinite));

  const up = input.slice();
  const hiddenDirection = input.slice();
  process({}, up, parameters(plugin, { md: 'Classic', dr: 'Up' }));
  process({}, hiddenDirection, parameters(plugin, { md: 'Classic', dr: 'Down' }));
  assert.deepEqual(up, hiddenDirection, 'Classic mode ignores its hidden Direction value');
});

test('Phaser reference processor keeps maximum feedback and discrete transitions finite', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const context = {};
  const modes = [
    { md: 'Classic', dr: 'Up', st: 12 },
    { md: 'Barber-pole', dr: 'Up', st: 8 },
    { md: 'Barber-pole', dr: 'Down', st: 4 },
    { md: 'Classic', dr: 'Down', st: 2 }
  ];
  for (const discrete of modes) {
    const block = new Float32Array(254);
    block[0] = 1;
    process(context, block, parameters(plugin, { ...discrete, rt: 10, cf: 8000, rg: 6,
      fb: 90, sp: 180, mx: 100 }));
    assert.ok(block.every(Number.isFinite));
  }
});

test('Phaser switches stages and mode only after the wet path reaches dry', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const process = new Function('context', 'data', 'parameters', plugin.processor);
  const unchanged = {};
  const changed = {};
  const base = parameters(plugin, { blockSize: 128, md: 'Classic', st: 6, mx: 100 });
  const warm = new Float32Array(256);
  warm.fill(0.15);
  process(unchanged, warm.slice(), base);
  process(changed, warm.slice(), base);

  const reference = warm.slice();
  const event = warm.slice();
  process(unchanged, reference, base);
  process(changed, event, { ...base, md: 'Barber-pole', st: 12, dr: 'Down' });
  assert.equal(event[0], reference[0], 'the event sample remains on the old wet trajectory');
  assert.equal(changed.phaserMode, 'Classic');
  assert.equal(changed.phaserTransition, 1);

  process(changed, warm.slice(), { ...base, md: 'Barber-pole', st: 12, dr: 'Down' });
  assert.equal(changed.phaserMode, 'Barber-pole');
  assert.equal(changed.phaserStages, 12);
  assert.equal(changed.phaserDirection, 'Down');
  assert.equal(changed.phaserTransition, 2);
});

test('Phaser restarts the latest topology transition within a long block', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const processReference = new Function('context', 'data', 'parameters', plugin.processor);
  const context = {};
  const base = parameters(plugin, {
    sampleRate: 1000, blockSize: 1, channelCount: 1,
    md: 'Classic', st: 6, dr: 'Up', mx: 100
  });
  const process = (frames, overrides = {}) => processReference(
    context, new Float32Array(frames).fill(0.15),
    { ...base, ...overrides, blockSize: frames });

  process(1);
  process(6, { md: 'Barber-pole', st: 12, dr: 'Down' });
  assert.equal(context.phaserMode, 'Barber-pole');
  assert.equal(context.phaserTransition, 2);
  assert.equal(context.phaserTransitionPosition, 1, 'the first topology is fading up');

  process(5, { md: 'Classic', st: 4, dr: 'Up' });
  assert.equal(context.phaserMode, 'Barber-pole', 'pending topology waits for the next midpoint');
  assert.equal(context.phaserPendingMode, 'Classic');
  assert.equal(context.phaserTransition, 1);
  assert.equal(context.phaserTransitionPosition, 1,
    'the next fade-down begins before the long block returns');

  process(3, { md: 'Classic', st: 4, dr: 'Up' });
  assert.equal(context.phaserMode, 'Barber-pole');
  assert.equal(context.phaserTransitionPosition, 4);
  process(1, { md: 'Classic', st: 4, dr: 'Up' });
  assert.equal(context.phaserMode, 'Classic');
  assert.equal(context.phaserStages, 4);
  assert.equal(context.phaserTransition, 2);
});
