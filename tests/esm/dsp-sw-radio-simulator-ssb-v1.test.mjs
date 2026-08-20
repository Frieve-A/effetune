// Phase 1 gate for the SW Radio Simulator SSB reception feature: legacy-preset
// compatibility of the new `mo` / `bf` keys, the Tuning and Receiver tab layout with
// its mode-dependent disabled states, and the physics of the JavaScript reference
// path (sideband shift sign, unwanted-sideband suppression, carrier residual,
// and the mutual inertness contracts of `bf` in AM and `de` / `dt` in SSB).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { XorShift64 } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginSourcePath = path.join(repoRoot, 'plugins', 'lofi', 'sw_radio_simulator.js');

// A representative 2.3.0 preset: every key that release serialized, none of the
// 2.4.0 additions, and deliberately non-default values throughout.
const PRESET_2_3_0 = Object.freeze({
  tb: 3.2, pe: 70, md: 110, cp: 12, sg: -30, sk: 80, fd: 2.5, ds: 4, st: 10,
  in: -30, io: 0.5, tn: -1.2, bw: 3, de: 'Synchronous', ag: 'Slow', dt: 200,
  hm: -40, hz: '60', sp: 'Table', og: -6, mx: 80
});

function matchesSelector(node, selector) {
  if (selector.startsWith('.')) {
    return String(node.className || '').split(/\s+/).includes(selector.slice(1));
  }
  const typed = /^([a-z]+)\[type="([a-z]+)"\]$/.exec(selector);
  if (typed) return node.tagName === typed[1] && node.type === typed[2];
  return node.tagName === selector;
}

function createElement(tagName) {
  const element = {
    tagName,
    children: [],
    attributes: {},
    listeners: {},
    className: '',
    style: {},
    hidden: false,
    textContent: '',
    disabled: false,
    checked: false,
    value: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    },
    addEventListener(type, handler) {
      (this.listeners[type] ||= []).push(handler);
    },
    dispatch(type, detail = {}) {
      for (const handler of this.listeners[type] || []) {
        handler({ target: this, ...detail });
      }
    },
    querySelectorAll(selector) {
      const found = [];
      const walk = node => {
        for (const child of node.children || []) {
          if (matchesSelector(child, selector)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  };
  element.classList = {
    contains: name => String(element.className || '').split(/\s+/).includes(name),
    add(name) {
      if (!this.contains(name)) element.className = `${element.className} ${name}`.trim();
    },
    remove(name) {
      element.className = String(element.className || '')
        .split(/\s+/).filter(token => token && token !== name).join(' ');
    },
    toggle(name, force) {
      const next = force === undefined ? !this.contains(name) : force;
      if (next) this.add(name);
      else this.remove(name);
      return next;
    }
  };
  return element;
}

function buildParameterRow(label, unit, inputs) {
  const row = createElement('div');
  row.className = 'parameter-row';
  const labelElement = createElement('label');
  labelElement.textContent = `${label}${unit ? ' (' + unit + ')' : ''}:`;
  row.appendChild(labelElement);
  for (const input of inputs) row.appendChild(input);
  return row;
}

async function loadPlugin({ id = 12, clock = null } = {}) {
  const source = await fs.readFile(pluginSourcePath, 'utf8');
  const now = clock ?? { value: 1000 };

  class PluginBase {
    constructor() {
      this.enabled = true;
      this.id = id;
      this.uiRefreshHooks = [];
    }
    registerProcessor(processor) { this.processorString = processor; }
    // Mirrors plugin-base's UI-follow seam: createUI registers refresh hooks that
    // re-read the model, and each hook asks whether the user is holding a control
    // before it writes. Nothing here fires the hooks, so the guards answer "no".
    registerUIRefresh(fn) { this.uiRefreshHooks.push(fn); }
    isHeldByUser() { return false; }
    isGraphPointerActive() { return false; }
    updateParameters() {}
    cleanup() {}
    canRunAnimation() { return true; }
    requestPowerAnimationFrame() { return 0; }
    getSerializableParameters() { return { ...this.getParameters() }; }
    getWorkletPluginData(parameters) { return parameters; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return parsed < minimum ? minimum : (parsed > maximum ? maximum : parsed);
    }
    isAllowedEnum(value, allowed, previous) {
      return allowed.includes(value) ? value : previous;
    }
    createParameterControl(label, min, max, step, value, setter, unit = '') {
      const slider = createElement('input');
      slider.type = 'range';
      slider.value = String(value);
      const number = createElement('input');
      number.type = 'number';
      number.value = String(value);
      number.addEventListener('input', event => {
        const parsed = parseFloat(event.target.value);
        if (Number.isFinite(parsed)) setter(parsed);
      });
      return buildParameterRow(label, unit, [slider, number]);
    }
    createLogarithmicParameterControl(label, min, max, step, value, setter, unit = '') {
      return this.createParameterControl(label, min, max, step, value, setter, unit);
    }
    // Mirrors plugin-base's checkbox row: a `parameter-row checkbox-row` holding the
    // `${label}:` element plus a single checkbox input.
    createCheckboxControl(label, checked, setter) {
      const checkbox = createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!checked;
      checkbox.addEventListener('change', event => setter(event.target.checked));
      const row = buildParameterRow(label, '', [checkbox]);
      row.className = 'parameter-row checkbox-row';
      return row;
    }
    createRadioGroup(label, options, value, setter) {
      const row = createElement('div');
      row.className = 'parameter-row radio-group';
      const labelElement = createElement('label');
      labelElement.textContent = `${label}:`;
      row.appendChild(labelElement);
      for (const option of options) {
        const optionValue = typeof option === 'string' ? option : option.value;
        const radio = createElement('input');
        radio.type = 'radio';
        radio.value = optionValue;
        radio.checked = optionValue === value;
        radio.addEventListener('change', event => {
          if (event.target.checked) setter(event.target.value);
        });
        row.appendChild(radio);
        const optionLabel = createElement('label');
        optionLabel.textContent = optionValue;
        row.appendChild(optionLabel);
      }
      return row;
    }
    createResponsiveGraph({ className } = {}) {
      const container = createElement('div');
      container.className = `graph-container ${className || ''}`.trim();
      const canvas = createElement('canvas');
      canvas.getContext = () => null;
      container.appendChild(canvas);
      return { container, canvas, resize() {}, dispose() {} };
    }
  }

  const context = {
    PluginBase,
    document: { createElement },
    performance: { now: () => now.value },
    cancelAnimationFrame: () => {},
    window: {}
  };
  vm.runInNewContext(source, context);
  return { plugin: new context.window.SWRadioSimulatorPlugin(), context, now };
}

function singleBinAmplitude(samples, start, length, sampleRate, frequency) {
  let real = 0;
  let imaginary = 0;
  const step = 2 * Math.PI * frequency / sampleRate;
  for (let index = 0; index < length; index++) {
    const angle = step * index;
    const sample = samples[start + index];
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return 2 * Math.sqrt(real * real + imaginary * imaginary) / length;
}

// Band power across +/-halfBins 1 Hz bins - wide enough to hold a tone smeared
// by the Doppler-spread fading taps while staying far from its mirror.
function bandPower(samples, start, length, sampleRate, frequency, halfBins = 3) {
  let power = 0;
  for (let bin = -halfBins; bin <= halfBins; bin++) {
    const amplitude = singleBinAmplitude(samples, start, length, sampleRate, frequency + bin);
    power += amplitude * amplitude;
  }
  return power;
}

test('SW Radio Simulator SSB keys default to AM, honour 2.3.0 presets, and clamp', async () => {
  const { plugin } = await loadPlugin();
  assert.equal(plugin.mo, 'AM');
  assert.equal(plugin.bf, 0);

  // A 2.3.0 preset carries no mo / bf: the mode stays AM at a zero BFO offset
  // while every legacy key keeps its exact 2.3.0 behaviour.
  plugin.setParameters(PRESET_2_3_0);
  assert.equal(plugin.mo, 'AM');
  assert.equal(plugin.bf, 0);
  for (const [key, value] of Object.entries(PRESET_2_3_0)) {
    assert.equal(plugin[key], value, `legacy key ${key} round-trips`);
  }

  // Re-serialization adds the new keys at their defaults and still omits fr.
  const serialized = plugin.getSerializableParameters();
  assert.equal(serialized.mo, 'AM');
  assert.equal(serialized.bf, 0);
  assert.equal('fr' in serialized, false);
  for (const [key, value] of Object.entries(PRESET_2_3_0)) {
    assert.equal(serialized[key], value);
  }

  // Missing keys never overwrite a live SSB selection (partial updates and
  // legacy presets alike leave mo / bf untouched).
  plugin.setParameters({ mo: 'USB', bf: -250 });
  plugin.setParameters(PRESET_2_3_0);
  assert.equal(plugin.mo, 'USB');
  assert.equal(plugin.bf, -250);

  // Enum and range validation.
  plugin.setParameters({ mo: 'CW' });
  assert.equal(plugin.mo, 'USB');
  plugin.setParameters({ mo: 'LSB' });
  assert.equal(plugin.mo, 'LSB');
  plugin.setParameters({ bf: -1e9 });
  assert.equal(plugin.bf, -1000);
  plugin.setParameters({ bf: 1e9 });
  assert.equal(plugin.bf, 1000);
  plugin.setParameters({ bf: 'not a number' });
  assert.equal(plugin.bf, 1000);

  // The worklet payload carries the new keys and still strips fr.
  const runtime = plugin.getWorkletPluginData(plugin.getParameters());
  assert.equal(runtime.mo, 'LSB');
  assert.equal(runtime.bf, 1000);
  assert.equal('fr' in runtime, false);
  assert.equal('fr' in plugin.getParameters(), true);
});

test('SW Radio Simulator Tuning/Receiver tabs order their rows and gate them by mode', async () => {
  const clock = { value: 5000 };
  const { plugin } = await loadPlugin({ clock });
  const container = plugin.createUI();

  const tabs = container.querySelectorAll('.sw-radio-simulator-tab');
  assert.deepEqual(tabs.map(tab => tab.textContent),
    ['Station', 'Propagation', 'Tuning', 'Receiver', 'Output']);
  assert.ok(tabs.every(tab => tab.getAttribute('role') === 'tab'));

  const panels = container.querySelectorAll('.sw-radio-simulator-tab-content');
  assert.equal(panels.length, 5);
  // Tuning owns everything that picks the signal; Receiver owns what happens to it after
  // the IF, so the mode-gated rows now straddle two panels.
  const tuningRows = panels[2].querySelectorAll('.parameter-row');
  assert.deepEqual(tuningRows.map(row => row.querySelector('label').textContent), [
    'Mode:', 'Tuning (kHz):', 'BFO Offset (Hz):', 'IF Bandwidth (kHz):'
  ]);
  const receiverRows = panels[3].querySelectorAll('.parameter-row');
  assert.deepEqual(receiverRows.map(row => row.querySelector('label').textContent), [
    'Detector:', 'AGC Speed:', 'Detector RC (µs):', 'Hum (dB):', 'Hum Freq:'
  ]);
  const allRows = [...tuningRows, ...receiverRows];

  const rowByLabel = label =>
    allRows.find(row => row.querySelector('label').textContent === label);
  const modeRow = rowByLabel('Mode:');
  const bfoRow = rowByLabel('BFO Offset (Hz):');
  const detectorRow = rowByLabel('Detector:');
  const detectorRcRow = rowByLabel('Detector RC (µs):');
  const expectDisabled = (row, disabled) => {
    assert.equal(row.getAttribute('aria-disabled'), disabled ? 'true' : 'false');
    assert.ok(row.querySelectorAll('input').every(input => input.disabled === disabled));
    assert.equal(row.classList.contains('parameter-disabled'), disabled);
  };

  // AM: the BFO is inert and disabled; the AM detector controls are live.
  expectDisabled(bfoRow, true);
  expectDisabled(detectorRow, false);
  expectDisabled(detectorRcRow, false);

  // Selecting USB through the Mode radio flips the gating and preserves values.
  plugin.setParameters({ bf: 120, de: 'Synchronous', dt: 250 });
  const usbRadio = modeRow.querySelectorAll('input[type="radio"]')
    .find(radio => radio.value === 'USB');
  usbRadio.checked = true;
  usbRadio.dispatch('change');
  assert.equal(plugin.mo, 'USB');
  expectDisabled(bfoRow, false);
  expectDisabled(detectorRow, true);
  expectDisabled(detectorRcRow, true);
  assert.equal(plugin.bf, 120);
  assert.equal(plugin.de, 'Synchronous');
  assert.equal(plugin.dt, 250);

  // Back to AM restores the original gating.
  const amRadio = modeRow.querySelectorAll('input[type="radio"]')
    .find(radio => radio.value === 'AM');
  amRadio.checked = true;
  amRadio.dispatch('change');
  expectDisabled(bfoRow, true);
  expectDisabled(detectorRow, false);
  expectDisabled(detectorRcRow, false);

  // The HUD events card is headed MOD in AM and TX in SSB.
  plugin.onMessage({
    type: 'processBuffer', pluginId: 12,
    measurements: {
      carrierPreAgcDb: -22.5, agcGainDb: 9.5, modPercent: 74, fadeDb: -3.5,
      staticCount: 0, clipCount: 0
    }
  });
  const drawn = [];
  plugin.hudCanvas = {
    width: 900, height: 120, clientWidth: 900,
    getContext: () => ({
      clearRect() {}, fillRect() {}, strokeRect() {},
      fillText: text => drawn.push(String(text))
    })
  };
  plugin.drawHud();
  assert.ok(drawn.includes('MOD / EVENTS'));
  assert.equal(drawn.includes('TX / EVENTS'), false);
  plugin.setParameters({ mo: 'LSB' });
  drawn.length = 0;
  plugin.drawHud();
  assert.ok(drawn.includes('TX / EVENTS'));
  assert.equal(drawn.includes('MOD / EVENTS'), false);

  plugin.cleanup();
});

test('SW Radio Simulator SSB physics: shift sign, sideband suppression, carrier residual, inertness', async () => {
  const { plugin } = await loadPlugin();
  const processor = new Function('data', 'parameters', 'context', plugin.processorString);

  // Clean-path base for the spectral assertions: no static, interference at the
  // floor and offset out of band, fading disabled unless the case asks for it,
  // and the speaker voicing off so the bins measure the detector output.
  const spectralBase = {
    fr: true, enabled: true,
    tb: 4.5, pe: 50, md: 90, cp: 6, sg: -15, sk: 0, fd: 0.5, ds: 1.4, st: 0,
    in: -80, io: 10, mo: 'USB', tn: 0.3, bf: 0, bw: 6, de: 'Envelope',
    ag: 'Fast', dt: 50, hm: -80, hz: '50', sp: 'Off', og: 0, mx: 100
  };
  const SAMPLE_RATE = 48000;
  const TOTAL_FRAMES = Math.round(SAMPLE_RATE * 1.6);
  const WINDOW_START = TOTAL_FRAMES - SAMPLE_RATE;
  const renderSpectral = (overrides, inputAt) => {
    const parameters = {
      ...spectralBase, ...overrides,
      sampleRate: SAMPLE_RATE, blockSize: 128, channelCount: 1
    };
    const runContext = { __seededRandom: () => 0.4142135 };
    const rendered = new Float64Array(TOTAL_FRAMES);
    for (let offset = 0; offset < TOTAL_FRAMES; offset += 128) {
      const block = new Float32Array(128);
      for (let frame = 0; frame < 128; frame++) block[frame] = inputAt(offset + frame);
      const output = processor(block, parameters, runContext);
      rendered.set(output.subarray(0, 128), offset);
    }
    assert.ok(rendered.every(Number.isFinite), 'SSB output stays finite');
    return rendered;
  };
  const tone = amplitude => index =>
    Math.sin(2 * Math.PI * 1000 * index / SAMPLE_RATE) * amplitude;
  const measure = (samples, frequency) =>
    bandPower(samples, WINDOW_START, SAMPLE_RATE, SAMPLE_RATE, frequency);

  // Positive Tuning means that the receiver is tuned above the station. A 1 kHz
  // tone therefore lands on 700 Hz in USB and on 1300 Hz in LSB at +0.3 kHz,
  // while the unwanted sideband stays at least ~50 dB down; 30 dB is asserted.
  for (const sk of [0, 100]) {
    const usb = renderSpectral({ sk, mo: 'USB' }, tone(0.25));
    const lsb = renderSpectral({ sk, mo: 'LSB' }, tone(0.25));
    assert.ok(measure(usb, 700) > 1000 * measure(usb, 1300),
      `USB shifts down when the receiver is tuned high at sk=${sk}`);
    assert.ok(measure(usb, 700) > 1000 * measure(usb, 1000),
      `USB leaves no component at the untranslated tone at sk=${sk}`);
    assert.ok(measure(lsb, 1300) > 1000 * measure(lsb, 700),
      `LSB shifts up when the receiver is tuned high at sk=${sk}`);
  }

  // The BFO alone must produce the same delta with the opposite knob:
  // tn=0, bf=-300 gives delta=+300, so USB still lands on 1300 Hz.
  const bfoOnly = renderSpectral({ tn: 0, bf: -300 }, tone(0.25));
  assert.ok(measure(bfoOnly, 1300) > 1000 * measure(bfoOnly, 700),
    'BFO-only detuning shifts USB up by |bf|');

  // Carrier residual: the suppressed carrier would fall on |delta| = 300 Hz.
  // Silence leaves only the amplified noise floor there, far below the level a
  // leaked carrier would reach once the SSB AGC normalizes it to its -18 dBFS target.
  const silence = renderSpectral({ tn: -0.3, bf: 0 }, () => 0);
  const silenceResidual =
    singleBinAmplitude(silence, WINDOW_START, SAMPLE_RATE, SAMPLE_RATE, 300);
  assert.ok(silenceResidual < 0.01,
    `silent carrier residual stays at the floor, got ${silenceResidual}`);

  // A 0.9 amplitude tone through the full 20 dB limiter maximizes the DC the
  // asymmetric limiter can generate; the low cut must keep it from reappearing
  // as a re-inserted carrier tone at |delta|.
  const driven = renderSpectral({ tn: -0.3, bf: 0, cp: 20 }, tone(0.9));
  const drivenResidual =
    singleBinAmplitude(driven, WINDOW_START, SAMPLE_RATE, SAMPLE_RATE, 300);
  const drivenMain =
    singleBinAmplitude(driven, WINDOW_START, SAMPLE_RATE, SAMPLE_RATE, 1300);
  assert.ok(drivenResidual < drivenMain / 100,
    `limiter-driven carrier residual is ${drivenResidual} against main ${drivenMain}`);

  // Mutual inertness, rendered twice from the identical injected seed:
  // (a) in AM the BFO offset must not touch a single sample or RNG draw, and
  // (b) in SSB the frozen detector selection and RC must be equally inert.
  const renderSeeded = (overrides, seed) => {
    const rng = new XorShift64(BigInt(seed));
    const runContext = { __seededRandom: () => rng.nextFloat() };
    const parameters = {
      ...plugin.getParameters(), fr: true, enabled: true, ...overrides,
      sampleRate: 96000, blockSize: 128, channelCount: 2
    };
    const rendered = [];
    for (let offset = 0; offset < 2048; offset += 128) {
      const block = new Float32Array(128 * 2);
      for (let frame = 0; frame < 128; frame++) {
        block[frame] = Math.sin((offset + frame) * 0.041) * 0.35;
        block[128 + frame] = Math.cos((offset + frame) * 0.017) * 0.28;
      }
      const output = processor(block, parameters, runContext);
      for (let frame = 0; frame < 256; frame++) rendered.push(output[frame]);
    }
    return rendered;
  };
  const amReference = renderSeeded({ mo: 'AM', bf: 0 }, 11);
  assert.deepEqual(renderSeeded({ mo: 'AM', bf: 1000 }, 11), amReference);
  const usbReference = renderSeeded({ mo: 'USB', de: 'Envelope', dt: 50 }, 11);
  assert.deepEqual(renderSeeded({ mo: 'USB', de: 'Synchronous', dt: 500 }, 11), usbReference);
  assert.notDeepEqual(usbReference, amReference);
});
