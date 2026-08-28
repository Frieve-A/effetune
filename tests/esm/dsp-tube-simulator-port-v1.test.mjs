import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  generateOutputs,
  validateParamSpec
} from '../../scripts/gen-dsp-params.mjs';
import {
  applySerializedState,
  getSerializablePluginStateLong,
  getSerializablePluginStateShort
} from '../../js/utils/serialization-utils.js';
import {
  readPluginPresetTables
} from '../tools/tube-simulator-lineamp/calibrate-listening-presets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginSourcePath = path.join(
  repoRoot, 'plugins', 'saturation', 'tube_simulator.js'
);
const schemaPath = path.join(
  repoRoot, 'dsp', 'plugins', 'saturation', 'tube_simulator', 'params.json'
);
const PHASE_A_PROJECTION_PARAMS = Object.freeze({
  dr: -30,
  tp: '12AU7',
  bi: 0,
  pv: 250,
  sz: 10,
  su: 10,
  og: 39,
  mx: 100,
  iv: 2.828,
  nf: 0
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
  let textContent = '';
  const element = {
    tagName,
    children: [],
    attributes: {},
    className: '',
    style: {},
    listeners: {},
    parentNode: null,
    hidden: false,
    textWriteCount: 0,
    get textContent() {
      return textContent;
    },
    set textContent(value) {
      textContent = String(value);
      this.textWriteCount++;
    },
    clientWidth: tagName === 'canvas' ? 800 : 0,
    clientHeight: tagName === 'canvas' ? 300 : 0,
    width: tagName === 'canvas' ? 800 : 0,
    height: tagName === 'canvas' ? 300 : 0,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    contains(candidate) {
      if (candidate === this) return true;
      return this.children.some(child => child.contains?.(candidate));
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
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
    },
    focus() {
      this.focused = true;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      const width = this.clientWidth || 800;
      const height = this.clientHeight || 300;
      return {
        left: 100,
        top: 100,
        right: 100 + width,
        bottom: 100 + height,
        width,
        height
      };
    }
  };
  element.classList = {
    contains(name) {
      return String(element.className || '').split(/\s+/).includes(name);
    },
    add(name) {
      if (!this.contains(name)) {
        element.className = `${element.className} ${name}`.trim();
      }
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
  if (tagName === 'select') {
    let selectValue = '';
    const optionValues = () => {
      const values = [];
      const walk = node => {
        for (const child of node.children || []) {
          if (child.tagName === 'option') values.push(String(child.value));
          else walk(child);
        }
      };
      walk(element);
      return values;
    };
    element.optionValues = optionValues;
    Object.defineProperty(element, 'value', {
      enumerable: true,
      get: () => selectValue,
      // A real <select> silently falls back when the value has no option.
      set(next) {
        selectValue = optionValues().includes(String(next)) ? String(next) : '';
      }
    });
  }
  if (tagName === 'canvas') {
    const context = {
      beginPath() {},
      clearRect() {},
      fill() {},
      fillRect() {},
      rect() {},
      fillText() {},
      // Enough of the real metric for the right-aligned legend: Arial digits and lower-case
      // letters average about half the font size in width.
      measureText(text) {
        return { width: String(text).length * 6 };
      },
      lineTo() {},
      moveTo() {},
      restore() {},
      rotate() {},
      save() {},
      setTransform() {},
      stroke() {},
      strokeRect() {},
      translate() {}
    };
    element.getContext = () => context;
    element.context = context;
  }
  return element;
}

function logSliderPosition(min, max, value) {
  const logMin = Math.log10(min);
  return ((Math.log10(value) - logMin) / (Math.log10(max) - logMin)) * 100;
}

// Mirrors the input / blur / Enter wiring of PluginBase.createParameterControl
// and createLogarithmicParameterControl. The listeners are what make a
// keystroke observable here: a row that only carries inert DOM nodes cannot
// show whether a state -> DOM write-back clobbers a partially typed value.
function buildSliderRow(control, sliderValue, numberValue, wiring) {
  const row = createElement('div');
  row.className = 'parameter-row';
  const slider = createElement('input');
  slider.type = 'range';
  slider.value = sliderValue;
  const number = createElement('input');
  number.type = 'number';
  number.value = numberValue;
  const { kind, min, max, step, setter } = wiring;
  const decimals = step < 0.1 ? 2 : (step < 1 ? 1 : 0);
  const clamp = value => Math.max(min, Math.min(max, value));

  if (kind === 'log') {
    const logMin = Math.log10(min);
    const logRange = Math.log10(max) - logMin;
    slider.addEventListener('input', event => {
      const linear = Math.pow(10, logMin + (parseFloat(event.target.value) / 100) * logRange);
      setter(linear);
      number.value = linear.toFixed(decimals);
    });
    // The logarithmic control clamps and reformats on every keystroke itself.
    number.addEventListener('input', event => {
      const clamped = clamp(parseFloat(event.target.value) || min);
      setter(clamped);
      event.target.value = clamped.toFixed(decimals);
      slider.value = logSliderPosition(min, max, clamped);
    });
  } else {
    let lastApplied = Number.isFinite(parseFloat(numberValue)) ? parseFloat(numberValue) : min;
    slider.addEventListener('input', event => {
      const value = parseFloat(event.target.value);
      if (!Number.isFinite(value)) return;
      setter(value);
      lastApplied = value;
      number.value = event.target.value;
    });
    // Typing may leave the range temporarily; only blur / Enter clamps.
    number.addEventListener('input', event => {
      const value = parseFloat(event.target.value);
      if (!Number.isFinite(value)) return;
      setter(value);
      lastApplied = value;
      slider.value = clamp(value);
    });
    const clampAndUpdate = event => {
      const value = parseFloat(event.target.value);
      const clamped = clamp(Number.isFinite(value) ? value : lastApplied);
      if (clamped !== lastApplied) {
        setter(clamped);
        lastApplied = clamped;
      }
      event.target.value = clamped;
      slider.value = clamped;
    };
    number.addEventListener('blur', clampAndUpdate);
    number.addEventListener('keydown', event => {
      if (event.key === 'Enter') clampAndUpdate(event);
    });
  }

  row.appendChild(createElement('label'));
  row.appendChild(slider);
  row.appendChild(number);
  control.row = row;
  return row;
}

function readInjectedPhaseCReferenceTables(source) {
  const declaration = 'const TUBE_SIMULATOR_PHASE_C_REFERENCE_TABLES = Object.freeze(';
  const begin = source.indexOf(declaration);
  const marker = source.indexOf('// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_END__', begin);
  const end = source.lastIndexOf(');', marker);
  assert.ok(begin >= 0 && marker > begin && end > begin);
  return JSON.parse(source.slice(begin + declaration.length, end));
}

async function createPlugin({ transformSource } = {}) {
  let source = await fs.readFile(pluginSourcePath, 'utf8');
  if (transformSource) source = transformSource(source);
  const rafCallbacks = new Map();
  const rafRequests = [];
  const observers = [];
  let nextRafId = 1;

  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 17;
      this.inputBus = null;
      this.outputBus = null;
      this.channel = null;
      this.controlDefinitions = [];
      this._sectionEnabled = true;
      this._powerUiEnabled = true;
      this._responsiveGraphDisposers = new Set();
    }

    registerProcessor(processor) {
      this.processorString = processor;
    }

    updateParameters() {}

    setEnabled(enabled) {
      this.enabled = enabled !== false;
    }

    _setSectionEnabled(enabled) {
      this._sectionEnabled = enabled !== false;
    }

    setPowerUiEnabled(enabled) {
      this._powerUiEnabled = enabled !== false;
    }

    canRunAnimation() {
      return this.enabled !== false && this._sectionEnabled && this._powerUiEnabled;
    }

    requestPowerAnimationFrame(callback) {
      if (!this.canRunAnimation()) return null;
      return context.requestAnimationFrame(callback);
    }

    createResponsiveGraph({ className, onResize } = {}) {
      const container = createElement('div');
      container.className = `graph-container responsive-graph-container ${className || ''}`.trim();
      const canvas = createElement('canvas');
      container.appendChild(canvas);
      const dispose = () => {
        graph.disposed = true;
        this._responsiveGraphDisposers.delete(dispose);
      };
      const graph = {
        container,
        canvas,
        disposed: false,
        resize() {
          onResize?.({ canvas, cssWidth: 800, cssHeight: 300, dpr: 1 });
        },
        dispose
      };
      this._responsiveGraphDisposers.add(dispose);
      return graph;
    }

    _setupMessageHandler() {}

    parseFiniteNumber(value, minimum, maximum, fallback) {
      const numericValue = typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : value;
      if (!Number.isFinite(numericValue)) return fallback;
      if (numericValue < minimum) return minimum;
      if (numericValue > maximum) return maximum;
      return numericValue;
    }

    getSerializableParameters() {
      const { type, id, ...parameters } = this.getParameters();
      return JSON.parse(JSON.stringify(parameters));
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

    getWorkletPluginData(parameters) {
      const payload = {
        id: this.id,
        type: this.constructor.name,
        enabled: this.enabled,
        parameters,
        inputBus: this.inputBus,
        outputBus: this.outputBus,
        channel: this.channel
      };
      if (this.constructor.executionCapabilities) {
        payload.executionCapabilities = this.constructor.executionCapabilities;
      }
      return payload;
    }

    createParameterControl(label, min, max, step, value, setter, unit = '') {
      const control = { kind: 'linear', label, min, max, step, value, setter, unit };
      this.controlDefinitions.push(control);
      return buildSliderRow(control, value, value, { kind: 'linear', min, max, step, setter });
    }

    createLogarithmicParameterControl(label, min, max, step, value, setter, unit = '') {
      const control = { kind: 'log', label, min, max, step, value, setter, unit };
      this.controlDefinitions.push(control);
      return buildSliderRow(
        control,
        logSliderPosition(min, max, value),
        value.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0)),
        { kind: 'log', min, max, step, setter }
      );
    }

    // Mirrors PluginBase.createCheckboxControl closely enough for the resync and DOM shape
    // assertions: one labelled checkbox input whose change event reaches the setter.
    createCheckboxControl(label, checked, setter) {
      const control = { kind: 'checkbox', label, checked, setter };
      this.controlDefinitions.push(control);
      const row = createElement('div');
      row.className = 'parameter-row checkbox-row';
      const labelEl = createElement('label');
      labelEl.textContent = `${label}:`;
      const checkbox = createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!checked;
      checkbox.addEventListener('change', event => setter(event.target.checked));
      row.appendChild(labelEl);
      row.appendChild(checkbox);
      control.row = row;
      return row;
    }

    createRadioGroup(label, options, value, setter) {
      const control = { kind: 'enum', label, options, value, setter };
      this.controlDefinitions.push(control);
      const row = createElement('div');
      row.className = 'parameter-row radio-group';
      for (const option of options) {
        const optionValue = typeof option === 'string' ? option : option.value;
        const radio = createElement('input');
        radio.type = 'radio';
        radio.value = optionValue;
        radio.checked = optionValue === value;
        row.appendChild(radio);
      }
      control.row = row;
      return row;
    }

    cleanup() {
      for (const dispose of [...this._responsiveGraphDisposers]) dispose();
    }
  }

  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }

    observe(target) {
      this.target = target;
    }

    disconnect() {
      this.disconnected = true;
    }

    setVisible(isIntersecting) {
      this.callback([{ target: this.target, isIntersecting }]);
    }
  }

  const documentListeners = {};
  const document = {
    createElement,
    body: createElement('body'),
    documentElement: { clientWidth: 1280, clientHeight: 720 },
    addEventListener(type, handler) {
      (documentListeners[type] ||= []).push(handler);
    },
    removeEventListener(type, handler) {
      documentListeners[type] = (documentListeners[type] || [])
        .filter(candidate => candidate !== handler);
    },
    dispatch(type, event) {
      for (const handler of documentListeners[type] || []) handler(event);
    }
  };
  const windowListeners = {};
  const window = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    IntersectionObserver: FakeIntersectionObserver,
    addEventListener(type, handler) {
      (windowListeners[type] ||= []).push(handler);
    },
    removeEventListener(type, handler) {
      windowListeners[type] = (windowListeners[type] || [])
        .filter(candidate => candidate !== handler);
    }
  };
  const context = {
    PluginBase,
    document,
    performance: { now: () => 1234 },
    console: { warn() {} },
    IntersectionObserver: FakeIntersectionObserver,
    requestAnimationFrame(callback) {
      const id = nextRafId++;
      rafRequests.push(id);
      rafCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
    window
  };
  context.window.cancelAnimationFrame = context.cancelAnimationFrame;
  vm.runInNewContext(source, context);
  const plugin = new context.window.TubeSimulatorPlugin();
  plugin.__testHarness = { observers, rafCallbacks, rafRequests, window, document };
  return plugin;
}

function findByClass(root, className) {
  if (root?.className?.split(/\s+/).includes(className)) return root;
  for (const child of root?.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function tubeTelemetryFrame({
  frameType = 19,
  formatVersion = 2,
  byteLength = 164,
  nonFiniteIndex = -1,
  offset = 0
} = {}) {
  const payload = new ArrayBuffer(byteLength);
  if (byteLength === 164) {
    // Twenty per channel plus the shared output safety reduction word at index 40.
    const values = [
      1.1, 1.2, 238, -1.5, 190, 0.001, -1.7, 175, 0.0015, ...Array(11).fill(0),
      1.0, 1.15, 236, -1.4, 188, 0.0011, -1.6, 172, 0.0014, ...Array(11).fill(0),
      0
    ];
    const view = new DataView(payload);
    for (let index = 0; index < values.length; index++) {
      view.setFloat32(index * 4, index === nonFiniteIndex ? Number.NaN : values[index] + offset, true);
    }
  }
  return { frameType, formatVersion, payload: new DataView(payload) };
}

function sliceChannelMajor(input, totalFrames, startFrame, blockFrames) {
  const block = new Float32Array(blockFrames * 2);
  for (let channel = 0; channel < 2; channel++) {
    const sourceOffset = channel * totalFrames + startFrame;
    block.set(
      input.subarray(sourceOffset, sourceOffset + blockFrames),
      channel * blockFrames
    );
  }
  return block;
}

function storeChannelMajor(output, block, totalFrames, startFrame, blockFrames) {
  for (let channel = 0; channel < 2; channel++) {
    output.set(
      block.subarray(channel * blockFrames, (channel + 1) * blockFrames),
      channel * totalFrames + startFrame
    );
  }
}

function exactFloat32(left, right) {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength)
    .equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength));
}

async function createReferenceHarness(params, sampleRate = 96000) {
  const plugin = await createPlugin();
  plugin.setParameters(params);
  plugin.fr = true;
  const context = {};
  const processor = new Function(
    'context',
    'data',
    'parameters',
    plugin.processorString
  );

  function processBlock(input) {
    const blockFrames = input.length / 2;
    assert.ok(Number.isInteger(blockFrames) && blockFrames > 0);
    const parameters = {
      ...plugin.getParameters(),
      enabled: true,
      sampleRate,
      channelCount: 2,
      blockSize: blockFrames
    };
    const result = processor(context, input, parameters);
    return ArrayBuffer.isView(result) ? result : input;
  }

  function process(input, partitions = [128]) {
    const totalFrames = input.length / 2;
    const output = new Float32Array(input.length);
    let startFrame = 0;
    let partitionIndex = 0;
    while (startFrame < totalFrames) {
      let blockFrames = partitions[partitionIndex % partitions.length];
      if (blockFrames > totalFrames - startFrame) {
        blockFrames = totalFrames - startFrame;
      }
      const block = sliceChannelMajor(input, totalFrames, startFrame, blockFrames);
      const rendered = processBlock(block);
      storeChannelMajor(output, rendered, totalFrames, startFrame, blockFrames);
      startFrame += blockFrames;
      partitionIndex++;
    }
    return output;
  }

  return {
    plugin,
    context,
    processBlock,
    process,
    setParameters(nextParams) {
      plugin.setParameters(nextParams);
    },
    reset() {
      assert.ok(context.__tubeSimulatorReferenceV1);
      context.__tubeSimulatorReferenceV1.reset();
    },
    checkpoint() {
      assert.ok(context.__tubeSimulatorReferenceV1);
      return context.__tubeSimulatorReferenceV1.checkpoint();
    }
  };
}

test('Tube Simulator freezes the 24-field schema and enum packing', async () => {
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);

  assert.equal(schema.type, 'TubeSimulatorPlugin');
  assert.equal(schema.floatCount, 24);
  assert.deepEqual(
    raw.fields.map(({ key, kind, min, max, default: defaultValue, values }) => ({
      key,
      kind,
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
      default: defaultValue,
      ...(values !== undefined && { values })
    })),
    [
      { key: 'dr', kind: 'float', min: -96, max: 0, default: -44.0059 },
      {
        key: 'tp',
        kind: 'enum',
        default: '12AX7',
        values: ['12AX7', '12AT7', '12AU7', 'Bypass']
      },
      { key: 'bi', kind: 'float', min: -50, max: 50, default: 0 },
      { key: 'pv', kind: 'float', min: 150, max: 300, default: 250 },
      { key: 'sz', kind: 'float', min: 0.6, max: 100, default: 10 },
      { key: 'su', kind: 'float', min: 0.1, max: 47, default: 10 },
      { key: 'og', kind: 'float', min: -48, max: 48, default: -7.372 },
      { key: 'mx', kind: 'float', min: 0, max: 100, default: 100 },
      { key: 'iv', kind: 'float', min: 0.1, max: 300, default: 2.828 },
      { key: 'nf', kind: 'float', min: 0, max: 30, default: 3 },
      {
        key: 'os', kind: 'enum', default: 'Power',
        values: ['Line', 'Power', 'SingleEnded']
      },
      { key: 'pt', kind: 'enum', default: 'EL84', values: ['EL84', 'EL34', '6L6GC', 'KT88'] },
      { key: 'pb', kind: 'float', min: 300, max: 470, default: 329.696 },
      { key: 'kr', kind: 'float', min: 270, max: 500, default: 270 },
      { key: 'st', kind: 'enum', default: '0', values: ['0', '20', '43'] },
      { key: 'zp', kind: 'enum', default: '8.0', values: ['6.0', '6.6', '8.0'] },
      { key: 'sl', kind: 'enum', default: '15', values: ['4', '8', '15', '16'] },
      { key: 'rl', kind: 'float', min: 2, max: 32, default: 15 },
      { key: 'sg', kind: 'float', min: -96, max: 0, default: 0 },
      { key: 'ag', kind: 'bool', default: true },
      { key: 'sd', kind: 'enum', default: '300B', values: ['300B', '2A3'] },
      { key: 'sb', kind: 'float', min: 250, max: 450, default: 400 },
      { key: 'sr', kind: 'float', min: 700, max: 1300, default: 1000 },
      { key: 'sp', kind: 'enum', default: '3.5', values: ['2.5', '3.5', '5.0'] }
    ]
  );

  const generatedJavaScript = [...generateOutputs([schema])]
    .find(([outputPath]) => outputPath.endsWith('dsp-params.generated.js'))?.[1];
  assert.ok(generatedJavaScript);
  const generated = await import(
    `data:text/javascript;base64,${Buffer.from(generatedJavaScript).toString('base64')}`
  );
  const packer = generated.DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');

  assert.deepEqual(
    [...packer.pack({ tp: '12AX7' })],
    [Math.fround(-44.0059), 0, 0, 250, 10, 10, Math.fround(-7.372), 100,
      Math.fround(2.828), 3, 1, 0, Math.fround(329.696), 270, 0, 2, 2, 15, 0, 1,
      0, 400, 1000, 1]
  );
  assert.deepEqual(
    [...packer.pack({
      dr: 99,
      tp: '12AT7',
      bi: -99,
      pv: 999,
      sz: 0,
      su: 99,
      og: -99,
      mx: 101,
      iv: 99,
      nf: 99
    })],
    [0, 1, -50, 300, Math.fround(0.6), 47, -48, 100, 99, 30,
      1, 0, Math.fround(329.696), 270, 0, 2, 2, 15, 0, 1,
      0, 400, 1000, 1]
  );
  assert.equal(packer.pack({ tp: '12AU7' })[1], 2);
  assert.equal(packer.pack({ tp: 'unsupported' })[1], 0);
});

test('Tube Simulator private Power circuits reuse the generated Phase C profiles', async () => {
  const source = await fs.readFile(pluginSourcePath, 'utf8');
  const tables = readInjectedPhaseCReferenceTables(source);
  const plugin = await createPlugin();
  const sharedKeys = [
    'circuitProfileId',
    'ltpRc',
    'gridRc',
    'cathodeRc',
    'screenSupplyRc',
    'powerSupplyRc',
    'outputTubeLutId',
    'optCoefficients',
    'nfbTapNode',
    'nfbTapTurnsRatio',
    'nfbPolarity'
  ];

  for (const parameters of [
    { os: 'Power', pt: '6L6GC', st: '0', zp: '6.6', sl: '8' },
    { os: 'Power', pt: 'KT88', st: '43', zp: '6.0', sl: '8' }
  ]) {
    const profile = tables.profiles.find(candidate =>
      candidate.key.pt === parameters.pt && candidate.key.st === parameters.st &&
      candidate.key.zp === parameters.zp);
    assert.ok(profile);
    const circuit = JSON.parse(JSON.stringify(plugin.derivePrivateCircuit(parameters)));
    for (const key of sharedKeys) assert.deepEqual(circuit[key], profile[key]);
    assert.equal(circuit.screenTapRatio, profile.screenTapTurnsRatio);
    assert.equal(circuit.primaryImpedanceOhm, Number(parameters.zp) * 1000);
    assert.equal(circuit.speakerLoadOhm, Number(parameters.sl));
    assert.equal(
      circuit.selectedSpeakerTurnsRatio,
      Math.sqrt(circuit.primaryImpedanceOhm / circuit.speakerLoadOhm)
    );
  }
});

test('Tube Simulator derives independent 300B and 2A3 single-ended circuits', async () => {
  const plugin = await createPlugin();
  for (const parameters of [
    { os: 'SingleEnded', sd: '300B', sb: 400, sr: 1000, sp: '3.5', sl: '8' },
    { os: 'SingleEnded', sd: '2A3', sb: 300, sr: 750, sp: '2.5', sl: '8' }
  ]) {
    const circuit = plugin.derivePrivateCircuit(parameters);
    assert.match(circuit.circuitProfileId, /^se-triode-v1-/);
    assert.equal(circuit.primaryImpedanceOhm, Number(parameters.sp) * 1000);
    assert.equal(circuit.speakerLoadOhm, Number(parameters.sl));
    assert.equal(circuit.nfbTapNode, 'single-ended-secondary-feedback-winding');
    assert.equal(circuit.nfbTapTurnsRatio, 0.1);
    assert.equal(
      circuit.selectedSpeakerTurnsRatio,
      Math.sqrt(circuit.primaryImpedanceOhm / circuit.speakerLoadOhm)
    );
  }
});

test('Tube Simulator Phase A projection is explicit and independent of Phase B defaults',
  async () => {
    const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    const schema = validateParamSpec(raw, schemaPath);
    const generatedJavaScript = [...generateOutputs([schema])]
      .find(([outputPath]) =>
        outputPath.endsWith('dsp-params.generated.js'))?.[1];
    assert.ok(generatedJavaScript);
    const generated = await import(
      `data:text/javascript;base64,${Buffer.from(generatedJavaScript).toString('base64')}`
    );
    const packer = generated.DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');

    assert.deepEqual(
      [...packer.pack(PHASE_A_PROJECTION_PARAMS)],
      [-30, 2, 0, 250, 10, 10, 39, 100, Math.fround(2.828), 0,
        1, 0, Math.fround(329.696), 270, 0, 2, 2, 15, 0, 1,
        0, 400, 1000, 1]
    );

    const plugin = await createPlugin();
    plugin.setParameters(PHASE_A_PROJECTION_PARAMS);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(PHASE_A_PROJECTION_PARAMS)
          .map(key => [key, plugin.getParameters()[key]])
      ),
      PHASE_A_PROJECTION_PARAMS
    );
  });

test('Tube Simulator defaults, validation, serialization, and reference shell match Phase B', async () => {
  const plugin = await createPlugin();

  assert.equal(plugin.name, 'Tube Simulator');
  assert.deepEqual(
    Object.fromEntries(
      ['dr', 'tp', 'bi', 'pv', 'sz', 'su', 'og', 'mx', 'iv', 'nf']
        .map(key => [key, plugin.getParameters()[key]])
    ),
    {
      dr: -44.0059,
      tp: '12AX7',
      bi: 0,
      pv: 250,
      sz: 10,
      su: 10,
      og: -7.372,
      mx: 100,
      iv: 2.828,
      nf: 3
    }
  );

  plugin.setParameters({
    dr: 99,
    tp: '12AT7',
    bi: -99,
    pv: 999,
    sz: 0,
    su: 99,
    og: -99,
    mx: 101,
    iv: 999,
    nf: 99,
    fr: true
  });
  assert.deepEqual(
    Object.fromEntries(
      ['dr', 'tp', 'bi', 'pv', 'sz', 'su', 'og', 'mx', 'iv', 'nf']
        .map(key => [key, plugin.getParameters()[key]])
    ),
    {
      dr: 0,
      tp: '12AT7',
      bi: -50,
      pv: 300,
      sz: 0.6,
      su: 47,
      og: -48,
      mx: 100,
      iv: 300,
      nf: 30
    }
  );
  plugin.setParameters({ dr: Number.NaN, tp: 'unsupported' });
  assert.equal(plugin.dr, 0);
  assert.equal(plugin.tp, '12AT7');
  assert.equal(plugin.fr, false);

  plugin.fr = true;
  const parameters = plugin.getParameters();
  const serializable = plugin.getSerializableParameters();
  const workletPayload = plugin.getWorkletPluginData(parameters);
  assert.equal(parameters.fr, true);
  assert.equal('fr' in serializable, false);
  assert.equal('fr' in workletPayload.parameters, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(workletPayload.executionCapabilities)),
    {
      requiresWasm: true,
      supportedSampleRates: [44100, 48000, 88200, 96000, 176400, 192000],
      supportedChannelModes: ['stereo-pair']
    }
  );
  assert.equal(plugin.getTemporalCapability(), 'must-process');
  plugin.setParameters({ mx: 0 });
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');

  const processor = new Function('data', 'parameters', 'context', plugin.processorString);
  for (const referenceMode of [false, true]) {
    const audio = new Float32Array([0.25, -0.5, 0.75, -1]);
    const result = processor(audio, {
      ...plugin.getParameters(),
      enabled: true,
      fr: referenceMode
    }, {});
    assert.equal(result, audio);
    assert.deepEqual([...result], [0.25, -0.5, 0.75, -1]);
  }
});

test('Tube Simulator short and long state round trips keep 3+4 worklet routing', async t => {
  const source = await createPlugin();
  source.channel = '34';

  const cases = [
    {
      name: 'short state',
      serialize: getSerializablePluginStateShort,
      channelKey: 'ch'
    },
    {
      name: 'long state',
      serialize: getSerializablePluginStateLong,
      channelKey: 'channel'
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const state = testCase.serialize(source);
      assert.equal(state[testCase.channelKey], '34');

      const restored = await createPlugin();
      applySerializedState(restored, JSON.parse(JSON.stringify(state)));

      assert.equal(restored.channel, '34');
      const workletPayload = restored.getWorkletPluginData({
        ...restored.getParameters(),
        sampleRate: 96000,
        channelCount: 4
      });
      assert.equal(workletPayload.enabled, true);
      assert.equal(workletPayload.channel, '34');
      assert.deepEqual(
        [...workletPayload.channel].map(channel => Number(channel) - 1),
        [2, 3]
      );
    });
  }
});

test('Tube Simulator rejects crafted reference-mode restores and keeps offline fallback pass-through', async () => {
  const plugin = await createPlugin();
  for (const fr of [true, 1, 'true']) {
    plugin.setSerializedParameters({ nm: 'Tube Simulator', en: true, dr: 12, fr });
    assert.equal(plugin.fr, false);
  }

  const context = {};
  const input = Float32Array.from(
    { length: 256 },
    (_, index) => Math.sin(2 * Math.PI * index / 31) * 0.25
  );
  const expected = new Float32Array(input);
  const processor = new Function(
    'context',
    'data',
    'parameters',
    'time',
    plugin.processorString
  );
  const result = processor(context, input, {
    ...plugin.getParameters(),
    sampleRate: 96000,
    channelCount: 2,
    blockSize: 128
  }, 0);

  assert.equal(result, input);
  assert.deepEqual(input, expected);
  assert.equal('__tubeSimulatorReferenceV1' in context, false);
});

const EXPECTED_TAB_CONTROLS = Object.freeze([
  ['input', [
    {
      kind: 'linear', label: 'Input Volume', min: -96, max: 0, step: 0.1,
      unit: 'dB', options: undefined
    },
    {
      kind: 'log', label: 'Input Reference', min: 0.1, max: 300, step: 0.001,
      unit: 'Vpk', options: undefined
    },
    {
      kind: 'log', label: 'Source Z', min: 0.6, max: 100, step: 0.1,
      unit: 'kΩ', options: undefined
    }
  ]],
  ['driver', [
    {
      kind: 'enum', label: 'Driver Type', min: undefined, max: undefined, step: undefined,
      unit: undefined,
      options: [
        { value: '12AX7', label: '12AX7' }, { value: '12AT7', label: '12AT7' },
        { value: '12AU7', label: '12AU7' }, { value: 'Bypass', label: 'Bypass' }
      ]
    },
    {
      kind: 'linear', label: 'Bias', min: -50, max: 50, step: 1,
      unit: '%', options: undefined
    },
    {
      kind: 'linear', label: 'Plate', min: 150, max: 300, step: 1,
      unit: 'V', options: undefined
    },
    {
      kind: 'log', label: 'Supply', min: 0.1, max: 47, step: 0.1,
      unit: 'kΩ', options: undefined
    },
    {
      kind: 'linear', label: 'Negative Feedback', min: 0, max: 30, step: 0.5,
      unit: 'dB', options: undefined
    }
  ]],
  ['power', [
    {
      kind: 'enum', label: 'Output Circuit', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: 'Line', label: 'Line' },
        { value: 'Power', label: 'Push-Pull Power' },
        { value: 'SingleEnded', label: 'SE Triode' }
      ]
    },
    {
      kind: 'enum', label: 'Power Tubes', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: 'EL84', label: 'EL84 ×2' },
        { value: 'EL34', label: 'EL34 ×2' },
        { value: '6L6GC', label: '6L6GC ×2' },
        { value: 'KT88', label: 'KT88 ×2' }
      ]
    },
    {
      kind: 'linear', label: 'Output B+', min: 300, max: 470, step: 0.001,
      unit: 'V', options: undefined
    },
    {
      kind: 'linear', label: 'Cathode Resistor', min: 270, max: 500, step: 1,
      unit: 'Ω / valve', options: undefined
    },
    {
      kind: 'enum', label: 'SE Triode', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: '300B', label: '300B' }, { value: '2A3', label: '2A3' }
      ]
    },
    {
      kind: 'linear', label: 'SE B+', min: 250, max: 450, step: 0.001,
      unit: 'V', options: undefined
    },
    {
      kind: 'linear', label: 'SE Cathode Resistor', min: 700, max: 1300, step: 1,
      unit: 'Ω', options: undefined
    },
  ]],
  ['transformer', [
    {
      kind: 'enum', label: 'Screen Tap', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: '0', label: '0%' }, { value: '20', label: '20%' },
        { value: '43', label: '43%' }
      ]
    },
    {
      kind: 'enum', label: 'Push-Pull Primary', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: '6.0', label: '6.0 kΩ' }, { value: '6.6', label: '6.6 kΩ' },
        { value: '8.0', label: '8.0 kΩ' }
      ]
    },
    {
      kind: 'enum', label: 'SE Primary', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: '2.5', label: '2.5 kΩ' }, { value: '3.5', label: '3.5 kΩ' },
        { value: '5.0', label: '5.0 kΩ' }
      ]
    },
    {
      kind: 'enum', label: 'Assumed Speaker Load', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: '4', label: '4 Ω' }, { value: '8', label: '8 Ω' },
        { value: '15', label: '15 Ω' }, { value: '16', label: '16 Ω' }
      ]
    },
    {
      kind: 'log', label: 'Actual Speaker Load', min: 2, max: 32, step: 0.1,
      unit: 'Ω', options: undefined
    }
  ]],
  ['output', [
    {
      kind: 'linear', label: 'Output Trim', min: -48, max: 48, step: 0.1,
      unit: 'dB', options: undefined
    },
    {
      kind: 'linear', label: 'Output Safety Trim', min: -96, max: 0, step: 0.1,
      unit: 'dB', options: undefined
    },
    {
      kind: 'checkbox', label: 'Auto Gain Reduction', min: undefined,
      max: undefined, step: undefined, unit: undefined, options: undefined
    },
    {
      kind: 'linear', label: 'Wet/Dry Mix', min: 0, max: 100, step: 1,
      unit: '%', options: undefined
    }
  ]]
]);

function describeControl(control) {
  return {
    kind: control.kind,
    label: control.label,
    min: control.min,
    max: control.max,
    step: control.step,
    unit: control.unit,
    options: control.options
      ? [...control.options].map(option =>
        typeof option === 'object' ? { ...option } : option)
      : undefined
  };
}

test('Tube Simulator creates Phase C controls, one responsive graph, and status', async () => {
  const plugin = await createPlugin();
  const container = plugin.createUI();

  assert.equal(container.className, 'tube-simulator-plugin-ui plugin-parameter-ui');
  assert.match(container.attributes['data-instance-id'], /^tube-simulator-\d+-\d+$/);
  // The graph view selector sits outside the tabs, directly above the graph it drives.
  assert.deepEqual(
    plugin.controlDefinitions.map(describeControl),
    [...EXPECTED_TAB_CONTROLS.flatMap(([, controls]) => controls), {
      kind: 'enum', label: 'Graph', min: undefined, max: undefined,
      step: undefined, unit: undefined,
      options: [
        { value: 'driver', label: 'Stage 1 / Stage 2' },
        { value: 'pushPull', label: 'Push / Pull' },
        { value: 'singleEnded', label: 'SE Triode' }
      ]
    }]
  );
  assert.deepEqual(
    Object.keys(plugin._controls).sort(),
    ['ag', 'bi', 'dr', 'iv', 'kr', 'mx', 'nf', 'og', 'os', 'pb', 'pt', 'pv', 'rl',
      'sb', 'sd', 'sg', 'sl', 'sp', 'sr', 'st', 'su', 'sz', 'tp', 'zp']
  );

  // Settings come first and the read-outs follow, the same order every other
  // plug-in in the app uses.
  assert.equal(container.children.length, 5);
  assert.equal(container.children[0].className, 'tube-simulator-panel');
  assert.equal(container.children.some(child => child.className.includes('preset')), false);
  assert.equal(
    container.children[1].className,
    'parameter-row radio-group tube-simulator-hud-view'
  );
  assert.ok(findByClass(container, 'tube-simulator-hud'));
  assert.equal(container.children[2].children.length, 1);
  assert.equal(container.children[2].children[0].tagName, 'canvas');
  assert.equal(container.children[3].className, 'tube-simulator-values');
  assert.equal(container.children[3].children.length, 12);
  assert.deepEqual(
    container.children[3].children.map(item => item.children[0].textContent),
    [
      'STAGE 1 BIAS',
      'STAGE 2 BIAS',
      'B+',
      'STAGE 1 PLATE − B+ SAG',
      'STAGE 2 PLATE − B+ SAG',
      'INPUT REFERENCE (0 dBFS)',
      'STAGE 1 EXTERNAL INPUT (0 dBFS)',
      'POWER LTP BALANCE',
      'POWER B+',
      'SPEAKER OUTPUT (100 ms)',
      'SPEAKER REAL POWER (100 ms)',
      'TRANSFORMER FLUX'
    ]
  );
  assert.equal(container.children[4].className, 'tube-simulator-status');
  assert.equal(container.children[4].attributes.role, 'status');
  assert.equal(container.children[4].attributes['aria-live'], 'polite');
  assert.equal(container.children[4].attributes['aria-atomic'], 'true');
});

test('Tube Simulator keeps the HUD outside five accessible parameter tabs', async () => {
  const plugin = await createPlugin();
  const container = plugin.createUI();
  const panel = findByClass(container, 'tube-simulator-panel');
  const [tabs, contents] = panel.children;

  assert.equal(tabs.attributes.role, 'tablist');
  assert.equal(plugin.selectedTab, 'input');
  assert.equal('selectedTab' in plugin.getParameters(), false);
  assert.equal('selectedTab' in plugin.getSerializableParameters(), false);
  assert.deepEqual(
    tabs.children.map(tab => tab.textContent),
    ['Input', 'Driver', 'Power', 'Transformer', 'Output']
  );
  assert.deepEqual(
    contents.children.map(content => content.attributes.role),
    ['tabpanel', 'tabpanel', 'tabpanel', 'tabpanel', 'tabpanel']
  );
  assert.deepEqual(
    contents.children.map(content => content.hidden),
    [false, true, true, true, true]
  );
  for (const [index, [id, controls]] of EXPECTED_TAB_CONTROLS.entries()) {
    const tab = tabs.children[index];
    const content = contents.children[index];
    assert.match(tab.id, new RegExp(`-${id}-tab$`));
    assert.equal(tab.attributes['aria-controls'], content.id);
    assert.equal(content.attributes['aria-labelledby'], tab.id);
    assert.match(content.className, /tube-simulator-tab-content plugin-parameter-ui/);
    assert.equal(content.children.length, controls.length);
  }

  tabs.children[3].dispatch('click');
  assert.equal(plugin.selectedTab, 'transformer');
  assert.deepEqual(
    tabs.children.map(tab => tab.attributes['aria-selected']),
    ['false', 'false', 'false', 'true', 'false']
  );
  assert.deepEqual(
    contents.children.map(content => content.hidden),
    [true, true, true, false, true]
  );
  assert.deepEqual(
    tabs.children.map(tab => tab.classList.contains('active')),
    [false, false, false, true, false]
  );
  // Tab selection is UI-only state and never reaches the 21-field record.
  assert.equal('selectedTab' in plugin.getSerializableParameters(), false);
});

test('Tube Simulator exposes the listening presets as system preset groups', async () => {
  const plugin = await createPlugin();
  const groups = plugin.constructor.getSystemPresetGroups();
  const expectedGroups = readPluginPresetTables(repoRoot).groups;

  assert.deepEqual(JSON.parse(JSON.stringify(groups)), expectedGroups);
  assert.deepEqual([...groups].map(group => group.label), ['Pre', 'Power', 'Pre+Power']);
  assert.equal(groups.flatMap(group => group.presets).length, 35);
  const systemPresetIds = new Set(groups.flatMap(group => group.presets).map(preset => preset.id));
  for (const preset of plugin.constructor.getCanonicalPresets()) {
    assert.equal(systemPresetIds.has(preset.id), false, `${preset.id} leaked into system presets`);
  }
});

test('Tube Simulator system preset hooks retain canonical application behavior', async () => {
  const plugin = await createPlugin();
  const presetId = 'listening-power-el34-distributed-thd2';

  assert.equal(plugin.getActiveSystemPresetId(), 'listening-power-el84-pentode-thd2');
  assert.equal(plugin.applySystemPreset(presetId), true);
  assert.equal(plugin.getActiveSystemPresetId(), presetId);
  assert.equal(plugin.os, 'Power');
  assert.equal(plugin.pt, 'EL34');
  assert.equal(plugin.st, '43');
  assert.equal(plugin.rl, 8);
  assert.equal(plugin.sg, 0);
  assert.equal(plugin.applySystemPreset('missing-preset'), false);
});

test('Tube Simulator resynchronizes every control DOM node from parameter state', async () => {
  const plugin = await createPlugin();
  const container = plugin.createUI();
  const readRow = key => {
    const row = plugin._controls[key].row;
    return {
      range: row.querySelector('input[type="range"]')?.value,
      number: row.querySelector('input[type="number"]')?.value,
      checked: row.querySelectorAll('input[type="radio"]')
        .filter(input => input.checked).map(input => input.value)
    };
  };

  plugin.applyCanonicalPreset('listening-power-el34-distributed-thd2');
  assert.deepEqual(readRow('tp').checked, ['12AX7']);
  assert.deepEqual(readRow('os').checked, ['Power']);
  assert.deepEqual(readRow('pt').checked, ['EL34']);
  assert.deepEqual(readRow('st').checked, ['43']);
  assert.deepEqual(readRow('zp').checked, ['6.6']);
  assert.deepEqual(readRow('sl').checked, ['8']);
  // Read from the canonical table rather than from copies of its numbers: the supply rail and the
  // feedback setting are derived quantities of the design and move whenever the circuit does.
  const canonical = plugin.constructor.getCanonicalPresets()
    .find(preset => preset.id === 'power-el34-distributed-20-37w').params;
  assert.equal(Number(readRow('pb').range), canonical.pb);
  assert.equal(Number(readRow('pb').number), canonical.pb);
  assert.equal(Number(readRow('nf').range), canonical.nf);
  assert.equal(Number(readRow('kr').number), canonical.kr);

  // Log controls track the plugin-base 0-100 slider mapping, not the raw value.
  plugin.setParameters({ sz: 6, su: 4.7, iv: 2 });
  assert.ok(Math.abs(readRow('sz').range - logSliderPosition(0.6, 100, 6)) < 1e-9);
  assert.equal(readRow('sz').number, '6.0');
  assert.ok(Math.abs(readRow('su').range - logSliderPosition(0.1, 47, 4.7)) < 1e-9);
  assert.equal(readRow('su').number, '4.7');
  assert.equal(readRow('iv').number, '2.00');

  // Restoring a saved project must move the DOM too.
  plugin.setSerializedParameters({
    nm: 'Tube Simulator', en: true,
    dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 9, mx: 100,
    iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320, kr: 270,
    st: '0', zp: '8.0', sl: '8'
  });
  assert.deepEqual(readRow('os').checked, ['Line']);
  assert.deepEqual(readRow('tp').checked, ['12AU7']);
  assert.equal(readRow('dr').number, 0);
});

test('Tube Simulator keeps typed text in the number input that drove the setter', async () => {
  const plugin = await createPlugin();
  plugin.createUI();
  const numberInput = key => plugin._controls[key].row.querySelector('input[type="number"]');
  const sliderInput = key => plugin._controls[key].row.querySelector('input[type="range"]');

  // Plate is 150..300, Output B+ 300..470 and Cathode Resistor 270..500, so
  // every partial keystroke of a legal value is below the lower bound. An
  // unconditional state -> DOM write-back turns "180" into 1 -> 150 -> 1508.
  const typedEntries = [
    { key: 'pv', keystrokes: ['1', '18', '180'], settled: 180 },
    { key: 'pb', keystrokes: ['4', '40', '400'], settled: 400 },
    { key: 'kr', keystrokes: ['3', '33', '330'], settled: 330 }
  ];
  for (const { key, keystrokes, settled } of typedEntries) {
    const number = numberInput(key);
    for (const typed of keystrokes) {
      number.value = typed;
      number.dispatch('input');
      assert.equal(number.value, typed,
        `${key} number input was rewritten while "${typed}" was being typed`);
    }
    assert.equal(plugin[key], settled);
    number.dispatch('keydown', { key: 'Enter' });
    assert.equal(Number(number.value), settled);
    assert.equal(Number(sliderInput(key).value), settled);
  }

  // Only the originating row is exempt: sibling rows still follow the state
  // while an edit is in flight, and the exemption ends with the call.
  const plate = numberInput('pv');
  plate.value = '1';
  plate.dispatch('input');
  assert.equal(plate.value, '1');
  assert.equal(plugin.pv, 150);
  assert.equal(Number(numberInput('pb').value), 400);
  assert.equal(Number(numberInput('kr').value), 330);
  assert.equal(plugin._syncOriginKey, null);

  // Anything that is not the row's own control still refreshes that row.
  plugin.setParameters({ pv: 210 });
  assert.equal(Number(plate.value), 210);
  plugin.applyCanonicalPreset('listening-line-12au7-thd1');
  assert.equal(Number(plate.value), 250);
  assert.equal(Number(numberInput('pb').value), 320);
});

test('Tube Simulator removes inactive output-circuit rows from the layout', async () => {
  const plugin = await createPlugin();
  plugin.createUI();
  const common = [...plugin._powerRows];
  const pushPull = [...plugin._ppRows];
  const singleEnded = [...plugin._seRows];

  assert.equal(common.length, 2);
  assert.equal(pushPull.length, 5);
  assert.equal(singleEnded.length, 4);
  assert.equal(plugin.os, 'Power');
  assert.deepEqual(
    [common, pushPull, singleEnded].map(rows => rows.every(row => row.hidden)),
    [false, false, true]
  );

  plugin.setParameters({ os: 'SingleEnded' });
  assert.deepEqual(
    [common, pushPull, singleEnded].map(rows => rows.every(row => row.hidden)),
    [false, true, false]
  );

  plugin.setParameters({ os: 'Line' });
  assert.deepEqual(
    [common, pushPull, singleEnded].map(rows => rows.every(row => row.hidden)),
    [true, true, true]
  );
  assert.equal(
    [...common, ...pushPull, ...singleEnded].every(row =>
      row.querySelectorAll('input').every(input => !input.disabled)),
    true
  );
  // Hidden values remain part of the serialized 21-field record.
  assert.equal(plugin.getSerializableParameters().pt, 'EL84');
  assert.equal(plugin.getSerializableParameters().sd, '300B');
});

test('Tube Simulator UI wiring pins the tab roles and tab sizing',
  async () => {
    const [source, css, appCss] = await Promise.all([
      fs.readFile(pluginSourcePath, 'utf8'),
      fs.readFile(
        path.join(repoRoot, 'plugins', 'saturation', 'tube_simulator.css'), 'utf8'
      ),
      fs.readFile(path.join(repoRoot, 'effetune.css'), 'utf8')
    ]);
    assert.match(source, /setAttribute\('role', 'tablist'\)/);
    assert.match(source, /setAttribute\('role', 'tabpanel'\)/);
    assert.match(source, /setAttribute\('aria-controls'/);
    assert.match(source, /setAttribute\('aria-labelledby'/);
    assert.match(source, /TUBE_SIMULATOR_LISTENING_PRESETS = Object\.freeze\(/);
    assert.match(source, /label: 'Pre'/);
    assert.match(source, /label: 'Power'/);
    assert.match(source, /label: 'Pre\+Power'/);
    assert.doesNotMatch(source, /'Circuit Preset'/);
    assert.match(css, /body\.layout-mobile \.tube-simulator-tab \{/);
    assert.match(css, /\.tube-simulator-tab-content \{[^}]*min-height: 153px;/s);
    assert.match(
      css,
      /body\.layout-mobile \.tube-simulator-tab-content \{[^}]*min-height: 0;/s
    );
    assert.match(css, /\.tube-simulator-tab-content \.parameter-row\[hidden\] \{/);
    assert.doesNotMatch(css, /\.tube-simulator-dimmed/);
    // The graph selector has to sit closer to the graph it drives than to the panel above it, or
    // it reads as one more parameter row instead of as the graph's own control.
    assert.match(
      css,
      /\.tube-simulator-plugin-ui \.tube-simulator-hud-view \{[^}]*margin-top: 14px;[^}]*margin-bottom: 0;/s
    );
    assert.match(
      css,
      /\.tube-simulator-hud-view \+ \.tube-simulator-hud \{[^}]*margin-top: 2px;/s
    );
    assert.equal(css.includes(['tube', 'simulator', 'preset'].join('-')), false);
    assert.match(appCss, /::\-webkit-scrollbar-thumb \{/);
  });

test('Tube Simulator telemetry parser rejects mismatched and non-finite frames', async () => {
  const plugin = await createPlugin();
  const telemetry = plugin.parseDspTubeTelemetryFrame(tubeTelemetryFrame());

  assert.equal(telemetry.left.vk1, Math.fround(1.1));
  assert.equal(telemetry.left.ia2, Math.fround(0.0015));
  assert.equal(telemetry.right.vbPlus, 236);
  assert.equal(telemetry.right.ia2, Math.fround(0.0014));
  assert.equal(
    plugin.parseDspTubeTelemetryFrame(tubeTelemetryFrame({ frameType: 18 })),
    null
  );
  assert.equal(
    plugin.parseDspTubeTelemetryFrame(tubeTelemetryFrame({ formatVersion: 1 })),
    null
  );
  assert.equal(
    plugin.parseDspTubeTelemetryFrame(tubeTelemetryFrame({ byteLength: 156 })),
    null
  );
  assert.equal(
    plugin.parseDspTubeTelemetryFrame(tubeTelemetryFrame({ nonFiniteIndex: 7 })),
    null
  );
});

test('Tube Simulator HUD plots recent Ia-Vak trajectories over plate curves and load lines', async () => {
  const plugin = await createPlugin();
  // The plate-curve HUD belongs to the 12AU7 line circuit, so this case names it.
  plugin.setParameters({ os: 'Line', tp: '12AU7' });
  const telemetry = plugin.parseDspTubeTelemetryFrame(tubeTelemetryFrame());

  plugin._appendTrajectory(telemetry);
  assert.equal(plugin.trajectories.stage1LeftX[0], Math.fround(190));
  assert.equal(plugin.trajectories.stage1LeftY[0], Math.fround(0.001));
  assert.equal(plugin.trajectories.stage2RightX[0], Math.fround(172));
  assert.equal(plugin.trajectories.stage2RightY[0], Math.fround(0.0014));
  assert.equal(plugin.hudAxes.xMin, 0);
  assert.equal(plugin.hudAxes.xMax, 250);
  assert.equal(plugin.hudCharacteristics.plateCurves.length, 5);
  for (const curve of plugin.hudCharacteristics.plateCurves) {
    assert.equal(curve.xValues[0], 0);
    assert.equal(curve.xValues.at(-1), 250);
    assert.ok(curve.yValues.at(-1) > curve.yValues[0]);
  }
  assert.deepEqual(
    Array.from(plugin.hudCharacteristics.loadLine.xValues),
    [0, 250]
  );
  assert.ok(
    Math.abs(plugin.hudCharacteristics.loadLine.yValues[0] - 250 / 22000) < 1e-9
  );
  assert.equal(plugin.hudCharacteristics.loadLine.yValues[1], 0);

  plugin.setParameters({
    os: 'SingleEnded', sd: '300B', sb: 400, sr: 1000, sp: '3.5', sl: '8', rl: 8
  });
  // The driver is still in the circuit, so the graph stays on it; the single-ended output valve
  // has to be selected before its axes are the ones on screen.
  assert.equal(plugin.hudView, 'driver');
  assert.equal(plugin.hudAxes.xMax, 250);
  plugin._selectHudView('singleEnded');
  plugin._appendTrajectory(telemetry);
  assert.equal(plugin.hudAxes.xMax, 400);
  assert.equal(plugin.hudCharacteristics.plateCurves.length, 7);
  assert.equal(
    plugin.trajectories.pushLeftX[0], telemetry.left.powerPlatePushV
  );
  assert.equal(
    plugin.trajectories.pushRightX[0], telemetry.right.powerPlatePushV
  );
  const seLoadLine = plugin.hudCharacteristics.loadLine;
  assert.ok(seLoadLine.yValues[0] > seLoadLine.yValues[1]);
  assert.ok(Math.abs(
    (seLoadLine.yValues[0] - seLoadLine.yValues[1]) /
      (seLoadLine.xValues[1] - seLoadLine.xValues[0]) - 1 / 3500
  ) < 1e-9);
  const matchedLoadRevision = plugin.hudAxesRevision;
  plugin.setParameters({ rl: 4 });
  const fourOhmLoadLine = plugin.hudCharacteristics.loadLine;
  assert.ok(Math.abs(
    (fourOhmLoadLine.yValues[0] - fourOhmLoadLine.yValues[1]) /
      (fourOhmLoadLine.xValues[1] - fourOhmLoadLine.xValues[0]) - 1 / 1750
  ) < 1e-9);
  assert.equal(plugin.hudAxesRevision, matchedLoadRevision + 1);
  plugin.setParameters({ rl: 16 });
  const sixteenOhmLoadLine = plugin.hudCharacteristics.loadLine;
  assert.ok(Math.abs(
    (sixteenOhmLoadLine.yValues[0] - sixteenOhmLoadLine.yValues[1]) /
      (sixteenOhmLoadLine.xValues[1] - sixteenOhmLoadLine.xValues[0]) - 1 / 7000
  ) < 1e-9);
  assert.equal(plugin.hudAxesRevision, matchedLoadRevision + 2);
  const seCurrentAt400 = sixteenOhmLoadLine.yValues[1];
  plugin.setParameters({ sr: 1500 });
  plugin._appendTrajectory(telemetry);
  assert.notEqual(plugin.hudCharacteristics.loadLine.yValues[1], seCurrentAt400);
  assert.ok(plugin.hudCharacteristics.loadLine.yValues[1] < seCurrentAt400);
  plugin.setParameters({ os: 'Line', tp: '12AU7' });

  for (let index = 0; index < 96; index++) {
    plugin.trajectories.stage1LeftX[index] = index;
    plugin.trajectories.stage1LeftY[index] = 100 + index;
  }
  // Operating points are plotted as points, not as a polyline: the samples are telemetry frames
  // rather than a continuous curve, so every visible point becomes one rect. Each one carries its
  // own age-derived opacity, so it also gets its own path and its own fill.
  const DRAW_NOW = 10000;
  const FRAME_PERIOD_MS = 30;
  // Ages the ring back from the write cursor at a fixed cadence, newest slot first, exactly as a
  // steady telemetry stream would have filled it.
  const stampTrajectoryTimes = () => {
    plugin.trajectoryTimes.fill(0);
    for (let age = 0; age < plugin.trajectoryCount; age++) {
      const ringIndex = (plugin.trajectoryIndex - 1 - age + 2 * 96) % 96;
      plugin.trajectoryTimes[ringIndex] = DRAW_NOW - age * FRAME_PERIOD_MS;
    }
  };
  const drawTrajectory = (options = {}) => {
    const rects = [];
    const opacities = [];
    let fills = 0;
    let fillStyle = null;
    let globalAlpha = 1;
    stampTrajectoryTimes();
    plugin._drawTrajectory({
      beginPath() {},
      rect(x, y, width, height) {
        rects.push([x, y, width, height]);
        opacities.push(globalAlpha);
      },
      fill() {
        fills++;
      },
      set fillStyle(value) {
        fillStyle = value;
      },
      get fillStyle() {
        return fillStyle;
      },
      set globalAlpha(value) {
        globalAlpha = value;
      },
      get globalAlpha() {
        return globalAlpha;
      }
    }, plugin.trajectories.stage1LeftX, plugin.trajectories.stage1LeftY,
    value => value, value => value, '#fff', options.dpr ?? 1, options.narrow ?? false,
    options.now ?? DRAW_NOW);
    return { rects, fills, fillStyle, opacities, globalAlpha };
  };

  // 500 ms of history at a 30 ms cadence is the newest seventeen frames: ages 0 through 480 ms are
  // inside the window and 510 ms is not.
  plugin.trajectoryIndex = 0;
  plugin.trajectoryCount = 96;
  const full = drawTrajectory();
  assert.equal(full.rects.length, 17);
  assert.deepEqual(full.rects[0], [78, 178, 2, 2]);
  assert.deepEqual(full.rects.at(-1), [94, 194, 2, 2]);
  assert.equal(full.fills, 17, 'each point is filled at its own opacity');
  assert.equal(full.fillStyle, '#fff');
  // Oldest first so the newest point lands on top, and every point dimmer than the one after it.
  assert.equal(full.opacities.at(-1), 1, 'the newest operating point must be fully opaque');
  assert.ok(
    full.opacities.every((opacity, index) =>
      index === 0 || opacity > full.opacities[index - 1]),
    'the trail must fade monotonically towards the oldest point'
  );
  assert.ok(Math.abs(full.opacities[0] - Math.exp(-480 / 220)) < 1e-9);
  assert.equal(full.globalAlpha, 1, 'the context must be handed back at full opacity');

  // Frames older than the window are dropped rather than drawn at a vanishing opacity.
  assert.equal(
    drawTrajectory({ now: DRAW_NOW + 16 * FRAME_PERIOD_MS }).rects.length,
    1,
    'only the newest frame is still inside the window once the trail has aged out'
  );
  assert.equal(drawTrajectory({ now: DRAW_NOW + 600 }).rects.length, 0);

  // A full ring whose write cursor sits mid-buffer wraps the visible window around the end. The
  // modulo is what keeps it inside the array: read past the end and mapX(undefined) is NaN, and
  // the points would silently vanish from the plot.
  plugin.trajectoryIndex = 3;
  plugin.trajectoryCount = 96;
  const wrapped = drawTrajectory();
  assert.equal(wrapped.rects.length, 17);
  assert.deepEqual(
    wrapped.rects.map(rect => rect[0] + 1),
    [82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 0, 1, 2],
    'the visible window must wrap around the end of the ring'
  );
  assert.ok(
    wrapped.rects.every(rect => rect.every(Number.isFinite)),
    'a wrapped read produced a non-finite coordinate'
  );

  // Before the ring has filled, only the frames actually written are drawn.
  plugin.trajectoryIndex = 4;
  plugin.trajectoryCount = 4;
  const partial = drawTrajectory();
  assert.equal(partial.rects.length, 4);
  assert.deepEqual(partial.rects.map(rect => rect[0] + 1), [0, 1, 2, 3]);

  // Nothing drawn at all before the first telemetry frame.
  plugin.trajectoryCount = 0;
  assert.equal(drawTrajectory().rects.length, 0);

  // Narrow layouts double the point size, and device pixel ratio scales it again.
  plugin.trajectoryIndex = 0;
  plugin.trajectoryCount = 96;
  const narrow = drawTrajectory({ narrow: true, dpr: 2 });
  assert.deepEqual(narrow.rects[0], [75, 175, 8, 8]);

  const container = plugin.createUI();
  assert.match(
    findByClass(container, 'tube-simulator-hud').children[0].attributes['aria-label'],
    /plate curves, load lines, and operating-point trajectories/
  );
  assert.equal(findByClass(container, 'tube-simulator-hud').children[0].context.fillStyle, '#fff');
  // The trajectories are filled rather than stroked now, so the last stroked element is the load
  // line: its colour and its one-pixel dashed width are what the context is left holding.
  assert.equal(findByClass(container, 'tube-simulator-hud').children[0].context.strokeStyle, '#888');
  assert.equal(findByClass(container, 'tube-simulator-hud').children[0].context.font, '14px Arial');
  assert.equal(findByClass(container, 'tube-simulator-hud').children[0].context.lineWidth, 1);
  plugin.cleanup();
});

test('Tube Simulator graph selector offers the circuit\'s own stages and falls back downstream',
  async () => {
    const plugin = await createPlugin();
    const container = plugin.createUI();
    const canvas = findByClass(container, 'tube-simulator-hud').children[0];
    const row = findByClass(container, 'tube-simulator-hud-view');
    const options = () => row.querySelectorAll('input[type="radio"]').map(input =>
      `${input.value}${input.checked ? '*' : ''}${input.disabled ? '-' : ''}`);
    // Array.from keeps the result in this realm; the panels come out of the plug-in's own.
    const titles = () => Array.from(plugin._hudPanels(), panel => panel.title);
    const status = () => findByClass(container, 'tube-simulator-status').textContent;
    plugin.onMessage({
      type: 'dspExecutionState',
      pluginId: plugin.id,
      pluginType: 'TubeSimulatorPlugin',
      state: 'active',
      reason: null,
      validated: true
    });

    // Push-Pull Power with a driver in front: two groups to choose from, the output one showing.
    assert.deepEqual(options(), ['driver', 'pushPull*', 'singleEnded-']);
    assert.deepEqual(titles(), ['Push', 'Pull']);
    assert.equal(plugin.hudAxes.xMax, plugin.pb);

    // Tick labels are centred on their tick and the rightmost tick sits on the panel edge, so the
    // canvas has to keep room for the half that hangs outside it.
    const drawn = [];
    canvas.context.fillText = (text, x) => {
      drawn.push({ text, x, color: canvas.context.fillStyle });
    };
    plugin._drawHud();
    const rightmostTick = Math.max(...drawn
      .filter(entry => /^\d+$/.test(entry.text))
      .map(entry => entry.x));
    assert.ok(
      canvas.width - rightmostTick >= 16,
      'the highest plate voltage must not be clipped by the edge of the canvas'
    );

    // Both channels are overlaid in every panel, so the trace colours are named once, top right.
    const legend = drawn.filter(entry => entry.text === 'Left' || entry.text === 'Right');
    assert.deepEqual(
      legend.map(entry => `${entry.text} ${entry.color}`),
      ['Right #ffb347', 'Left #69c8ff']
    );
    assert.ok(legend[1].x < legend[0].x, 'Left is drawn to the left of Right');
    assert.ok(
      canvas.width - legend[0].x >= 16,
      'the legend must clear the edge of the canvas'
    );

    plugin._selectHudView('driver');
    assert.deepEqual(options(), ['driver*', 'pushPull', 'singleEnded-']);
    assert.deepEqual(titles(), ['Stage 1', 'Stage 2']);
    assert.equal(plugin.hudAxes.xMax, plugin.pv);
    plugin._selectHudView('singleEnded');
    assert.equal(plugin.hudView, 'driver', 'a group outside the circuit cannot be selected');

    // Bypassing the driver drops the selected group, so the most downstream one takes over.
    plugin.setParameters({ tp: 'Bypass' });
    assert.deepEqual(options(), ['driver-', 'pushPull*', 'singleEnded-']);
    plugin.setParameters({ os: 'SingleEnded' });
    assert.deepEqual(options(), ['driver-', 'pushPull-', 'singleEnded*']);
    // One valve, so one panel across the full width, carrying both channels like every other one.
    assert.deepEqual(titles(), ['Output']);
    assert.equal(plugin._hudPanels()[0].leftX, plugin.trajectories.pushLeftX);
    assert.equal(plugin._hudPanels()[0].rightX, plugin.trajectories.pushRightX);
    assert.equal(plugin.hudAxes.xMax, plugin.sb);

    // A selection that survives a settings change is kept, whatever else becomes available.
    plugin.setParameters({ tp: '12AU7' });
    assert.deepEqual(options(), ['driver', 'pushPull-', 'singleEnded*']);
    plugin.setParameters({ os: 'Line' });
    assert.deepEqual(options(), ['driver*', 'pushPull-', 'singleEnded-']);

    // Line with the driver bypassed runs no valve at all.
    let backgrounds = 0;
    let labels = 0;
    canvas.context.fillRect = () => { backgrounds++; };
    canvas.context.fillText = () => { labels++; };
    plugin.setParameters({ tp: 'Bypass' });
    assert.deepEqual(options(), ['driver-', 'pushPull-', 'singleEnded-']);
    assert.deepEqual(titles(), []);
    assert.equal(plugin.hudAxes, null);
    assert.equal(canvas.attributes['aria-label'], 'No tube stage is active.');
    assert.equal(status(), 'No tube stage is active. Output safety reduction: 0.0 dB.');
    backgrounds = 0;
    labels = 0;
    plugin._drawHud();
    assert.equal(backgrounds, 1, 'an empty graph is painted, not left holding the last trail');
    assert.equal(labels, 0, 'no axis labels are drawn without a stage to plot');

    // A bypassed effect plots nothing either, and keeps the selection for when it comes back.
    plugin.setParameters({ os: 'Power', tp: '12AU7' });
    plugin._selectHudView('driver');
    plugin.setEnabled(false);
    assert.deepEqual(options(), ['driver*-', 'pushPull-', 'singleEnded-']);
    assert.deepEqual(titles(), []);
    assert.equal(status(), 'No tube stage is active.');
    plugin.setEnabled(true);
    assert.deepEqual(options(), ['driver*', 'pushPull', 'singleEnded-']);
    assert.deepEqual(titles(), ['Stage 1', 'Stage 2']);
    plugin.cleanup();
  });

test('Tube Simulator HUD gates animation, keeps a 96-frame main-thread ring, and cleans up', async () => {
  const plugin = await createPlugin();
  // Driver-tube axes react to Bias, so this case runs on the line circuit.
  plugin.setParameters({ os: 'Line' });
  const subscriptions = [];
  let unsubscribeCount = 0;
  plugin.__testHarness.window.dspTelemetryHub = {
    subscribe(tapId, frameType, callback) {
      subscriptions.push({ tapId, frameType, callback });
      return () => { unsubscribeCount++; };
    }
  };
  plugin._setupMessageHandler();
  const container = plugin.createUI();
  const observer = plugin.__testHarness.observers[0];

  assert.match(findByClass(container, 'tube-simulator-status').textContent, /Loading Tube Simulator processing/);
  assert.deepEqual(
    subscriptions.map(({ tapId, frameType }) => ({ tapId, frameType })),
    [{ tapId: 17, frameType: 19 }]
  );
  assert.equal(plugin.__testHarness.rafCallbacks.size, 1);
  observer.setVisible(false);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 0);
  observer.setVisible(true);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 1);
  plugin.setPowerUiEnabled(false);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 0);
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /display is paused/);
  plugin.setPowerUiEnabled(true);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 1);

  const callback = subscriptions[0].callback;
  for (let index = 0; index < 100; index++) {
    callback(tubeTelemetryFrame({ offset: index / 1000 }));
  }
  assert.equal(plugin.trajectoryCount, 96);
  assert.equal(plugin.trajectoryIndex, 4);
  assert.match(plugin.hudValues.stage1Bias.textContent, /^L /);
  // Each stage has its own cell now, and the signed readouts carry an explicit sign and a
  // space-padded integer part so their columns cannot move.
  assert.match(plugin.hudValues.plateSag1.textContent, /^L [+−]\s*\d+\.\d\d \/ R /);
  assert.match(plugin.hudValues.plateSag2.textContent, /^L [+−]\s*\d+\.\d\d \/ R /);
  assert.equal(
    plugin.hudValues.plateSag1.textContent.length,
    plugin.hudValues.plateSag2.textContent.length,
    'the two sag readouts must occupy the same number of columns');
  assert.match(plugin.hudValues.ltpBalance.textContent, /^L [+−]\s*\d+\.\d\d \/ R /);
  // The flux readout shows the magnitude of the flux linkage (the single-ended core carries a
  // standing bias flux), so the sign column is always '+' and the integer part is space-padded
  // to two columns for the swing towards the saturation figures. Three fraction digits keep the
  // sub-10 Wb-turns reading at the same relative resolution the volt-scale readouts get from two.
  assert.match(plugin.hudValues.transformerFlux.textContent, /^L \+[ \d]\d\.\d{3} \/ R /);

  const initialRevision = plugin.hudAxesRevision;
  plugin.setParameters({ dr: 6, og: -3, mx: 75 });
  assert.equal(plugin.hudAxesRevision, initialRevision);
  assert.equal(plugin.trajectoryCount, 96);
  plugin.setParameters({ bi: 12 });
  assert.equal(plugin.hudAxesRevision, initialRevision + 1);
  assert.equal(plugin.trajectoryCount, 0);

  const state = (reason, stateName = 'bypassed') => plugin.onMessage({
    type: 'dspExecutionState',
    pluginId: plugin.id,
    pluginType: 'TubeSimulatorPlugin',
    state: stateName,
    reason,
    validated: true
  });
  const fault = (latched, cause = 'feedbackOscillation') => plugin.onMessage({
    type: 'tubeSimulatorCircuitFault',
    pluginId: plugin.id,
    pluginType: 'TubeSimulatorPlugin',
    latched,
    cause,
    validated: true
  });
  fault(true);
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /Loading Tube Simulator processing/);
  state('unsupportedSampleRate');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /does not support this sample rate/);
  state(null, 'active');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /feedback oscillation was detected/);
  fault(false, 'none');
  // The automatic output safety reduction is always stated, including while it is zero, so that
  // the mechanism is visible before it has ever acted.
  assert.equal(
    findByClass(container, 'tube-simulator-status').textContent,
    'Tube Simulator is active. Output safety reduction: 0.0 dB.');
  state(null, 'active');
  assert.equal(
    findByClass(container, 'tube-simulator-status').textContent,
    'Tube Simulator is active. Output safety reduction: 0.0 dB.');
  state('unsupportedSampleRate');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /does not support this sample rate/);
  state('unsupportedChannelMode');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /not have enough output channels/);
  for (const channel of ['A', 'L', 'R', '3']) {
    plugin.channel = channel;
    state('unsupportedChannelMode');
    assert.match(findByClass(container, 'tube-simulator-status').textContent, /Select Stereo or a channel pair/);
  }
  plugin.channel = '34';
  state('unsupportedChannelMode');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /not have enough output channels/);
  state('wasmUnavailable');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /requires WebAssembly processing/);
  state('rolloutDisabled');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /unavailable in this build/);
  state('runtimeFallback');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /processing engine stopped/);
  state('engineStopped');
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /audio processing has stopped/);
  plugin.onMessage({
    type: 'dspExecutionState',
    pluginId: plugin.id,
    pluginType: 'TubeSimulatorPlugin',
    state: 'active',
    reason: null,
    validated: false
  });
  assert.match(findByClass(container, 'tube-simulator-status').textContent, /audio processing has stopped/);

  plugin.cleanup();
  assert.equal(unsubscribeCount, 1);
  assert.equal(observer.disconnected, true);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 0);
});

test('Tube Simulator reference processor initializes at every supported sample rate', async () => {
  const plugin = await createPlugin();
  const sampleRates = [
    ...plugin.getWorkletPluginData(plugin.getParameters())
      .executionCapabilities.supportedSampleRates
  ];
  const input = Float32Array.from(
    { length: 256 },
    (_, index) => Math.sin(2 * Math.PI * index / 31) * 0.25
  );

  for (const sampleRate of sampleRates) {
    const harness = await createReferenceHarness({}, sampleRate);
    const output = harness.process(input, [17, 31, 7]);
    assert.ok(harness.context.__tubeSimulatorReferenceV1, `${sampleRate} Hz initializes`);
    assert.equal(output.length, input.length);
    assert.ok(output.every(Number.isFinite), `${sampleRate} Hz output remains finite`);
  }
});

test('Tube Simulator reference safety recovery keeps current controls and resets all histories',
  async () => {
    const params = {
      dr: -6, tp: '12AU7', bi: 25, pv: 285, sz: 3.3, su: 22,
      og: -4, mx: 37, iv: 4, nf: 0
    };
    const recovered = await createReferenceHarness(params);
    recovered.processBlock(Float32Array.from([Number.NaN, 0]));
    const checkpoint = recovered.checkpoint();
    const expectedControls = [
      4 * Math.pow(10, -6 / 20), Math.pow(10, -4 / 20), 0.37
    ];
    assert.deepEqual(checkpoint.controls, expectedControls);
    assert.deepEqual(checkpoint.controlTargets, expectedControls);

    const fresh = await createReferenceHarness(params);
    const nextInput = Float32Array.from(
      { length: 256 },
      (_, index) => 0.2 * Math.sin(2 * Math.PI * index / 41)
    );
    const recoveredOutput = recovered.process(nextInput, [127, 1]);
    const freshOutput = fresh.process(nextInput, [127, 1]);
    assert.equal(exactFloat32(recoveredOutput, freshOutput), true);
  });

test('Tube Simulator reference keeps safety attenuation across batched inactive fields',
  async () => {
    const sampleRate = 44100;
    const toneFrames = 48 * 128;
    const tone = new Float32Array(toneFrames * 2);
    const silence = new Float32Array(tone.length);
    for (let channel = 0; channel < 2; channel++) {
      const offset = channel * toneFrames;
      for (let frame = 0; frame < toneFrames; frame++) {
        tone[offset + frame] = Math.sin(2 * Math.PI * 1000 * frame / sampleRate);
      }
    }
    const probeFrames = 256;
    const probe = new Float32Array(probeFrames * 2);
    for (let channel = 0; channel < 2; channel++) {
      const offset = channel * probeFrames;
      for (let frame = 0; frame < probeFrames; frame++) {
        probe[offset + frame] = 0.01 * Math.sin(2 * Math.PI * frame / 37);
      }
    }

    const cases = [
      {
        name: 'Line',
        params: { os: 'Line', dr: -30, og: 48, mx: 100, iv: 2.828, ag: true },
        inactive: { pt: 'KT88', st: '43', sd: '2A3' }
      },
      {
        name: 'Power',
        params: { os: 'Power', dr: -30, og: 48, mx: 100, iv: 2.828, ag: true },
        inactive: { sd: '2A3', sb: 300, sr: 750, sp: '5.0' }
      },
      {
        name: 'SingleEnded',
        params: {
          os: 'SingleEnded', dr: -30, og: 48, mx: 100, iv: 2.828, ag: true,
          sd: '300B', sb: 400, sr: 1000, sp: '3.5'
        },
        inactive: { pt: 'KT88', pb: 470, kr: 500, st: '43', zp: '8.0' }
      }
    ];

    for (const testCase of cases) {
      const reference = await createReferenceHarness(testCase.params, sampleRate);
      const changed = await createReferenceHarness(testCase.params, sampleRate);
      reference.process(tone, [128]);
      changed.process(tone, [128]);
      reference.process(silence, [128]);
      changed.process(silence, [128]);
      const engaged = changed.checkpoint();
      assert.ok(engaged.outputSafety[0] < 1, `${testCase.name} safety attenuation engages`);
      assert.equal(engaged.outputSafety[3], 0, `${testCase.name} safety ramp completes`);
      assert.deepEqual(reference.checkpoint().outputSafety, engaged.outputSafety);

      changed.setParameters(testCase.inactive);
      const referenceOutput = reference.process(probe, [37, 128, 5]);
      const changedOutput = changed.process(probe, [37, 128, 5]);
      const after = changed.checkpoint();
      assert.deepEqual(after.outputSafety, engaged.outputSafety,
        `${testCase.name} inactive fields preserve gain, target, step, and remaining`);
      assert.deepEqual(after.runtimeEvent, engaged.runtimeEvent,
        `${testCase.name} inactive fields preserve the runtime event`);
      assert.deepEqual(after.feedbackTransition, engaged.feedbackTransition,
        `${testCase.name} inactive fields preserve transition state`);
      assert.equal(exactFloat32(changedOutput, referenceOutput), true,
        `${testCase.name} inactive fields preserve audio exactly`);
    }
  });

test('Tube Simulator caches telemetry without HUD work while hidden or power-disabled', async () => {
  const plugin = await createPlugin();
  const subscriptions = [];
  plugin.__testHarness.window.dspTelemetryHub = {
    subscribe(tapId, frameType, callback) {
      subscriptions.push({ tapId, frameType, callback });
      return () => {};
    }
  };
  let drawCount = 0;
  const drawHud = plugin._drawHud.bind(plugin);
  plugin._drawHud = () => {
    drawCount++;
    return drawHud();
  };
  plugin._setupMessageHandler();
  plugin.createUI();
  const observer = plugin.__testHarness.observers[0];
  const callback = subscriptions[0].callback;
  const stage1Bias = plugin.hudValues.stage1Bias;

  observer.setVisible(false);
  const hiddenSnapshot = {
    rafRequests: plugin.__testHarness.rafRequests.length,
    draws: drawCount,
    trajectoryCount: plugin.trajectoryCount,
    trajectoryIndex: plugin.trajectoryIndex,
    text: stage1Bias.textContent,
    textWrites: stage1Bias.textWriteCount
  };
  callback(tubeTelemetryFrame({ offset: 0.25 }));
  assert.equal(plugin.latestTelemetry.left.vk1, Math.fround(1.35));
  assert.deepEqual({
    rafRequests: plugin.__testHarness.rafRequests.length,
    draws: drawCount,
    trajectoryCount: plugin.trajectoryCount,
    trajectoryIndex: plugin.trajectoryIndex,
    text: stage1Bias.textContent,
    textWrites: stage1Bias.textWriteCount
  }, hiddenSnapshot);

  observer.setVisible(true);
  assert.equal(plugin.trajectoryCount, hiddenSnapshot.trajectoryCount + 1);
  assert.notEqual(stage1Bias.textContent, hiddenSnapshot.text);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 1);

  plugin.setPowerUiEnabled(false);
  const powerDisabledSnapshot = {
    rafRequests: plugin.__testHarness.rafRequests.length,
    draws: drawCount,
    trajectoryCount: plugin.trajectoryCount,
    trajectoryIndex: plugin.trajectoryIndex,
    text: stage1Bias.textContent,
    textWrites: stage1Bias.textWriteCount
  };
  callback(tubeTelemetryFrame({ offset: 0.5 }));
  assert.equal(plugin.latestTelemetry.left.vk1, Math.fround(1.6));
  assert.deepEqual({
    rafRequests: plugin.__testHarness.rafRequests.length,
    draws: drawCount,
    trajectoryCount: plugin.trajectoryCount,
    trajectoryIndex: plugin.trajectoryIndex,
    text: stage1Bias.textContent,
    textWrites: stage1Bias.textWriteCount
  }, powerDisabledSnapshot);

  plugin.setPowerUiEnabled(true);
  assert.equal(plugin.trajectoryCount, powerDisabledSnapshot.trajectoryCount + 1);
  assert.notEqual(stage1Bias.textContent, powerDisabledSnapshot.text);
  assert.equal(plugin.__testHarness.rafCallbacks.size, 1);
  plugin.cleanup();
});

test('Tube Simulator is registered directly after Sub Synth with shipped rollout enabled', async () => {
  const [pluginList, rolloutSource] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'plugins', 'plugins.txt'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'dsp-rollout.js'), 'utf8')
  ]);
  const lines = pluginList.split(/\r?\n/);
  const subSynthIndex = lines.indexOf(
    'saturation/sub_synth: Sub Synth | Saturation | SubSynthPlugin | css'
  );

  assert.notEqual(subSynthIndex, -1);
  assert.equal(
    lines[subSynthIndex + 1],
    'saturation/tube_simulator: Tube Simulator | Saturation | TubeSimulatorPlugin | css'
  );
  assert.equal(
    lines.filter(line => line.includes('TubeSimulatorPlugin')).length,
    1
  );
  assert.match(rolloutSource, /'TubeSimulatorPlugin'/);
});

test('Tube Simulator Phase A input calibration applies exactly once and preserves state', async () => {
  const frames = 384;
  const input = new Float32Array(frames * 2);
  for (let channel = 0; channel < 2; channel++) {
    const channelOffset = channel * frames;
    for (let frame = 0; frame < frames; frame++) {
      input[channelOffset + frame] = 0.01 * Math.sin(2 * Math.PI * frame / 37);
    }
  }

  const unityReference = await createReferenceHarness({ dr: 0, iv: 1, og: 0 });
  const compensatedReference = await createReferenceHarness({ dr: -20, iv: 10, og: 0 });
  const unityOutput = unityReference.process(input, [31, 7, 53]);
  const compensatedOutput = compensatedReference.process(input, [31, 7, 53]);
  assert.equal(exactFloat32(unityOutput, compensatedOutput), true);

  for (const inputReference of [0.447, 2.828, 5.657, 13.8]) {
    const conversion = await createReferenceHarness({ dr: -24, iv: inputReference });
    conversion.processBlock(new Float32Array(2));
    assert.ok(
      Math.abs(
        conversion.checkpoint().controls[0] -
        inputReference * Math.pow(10, -24 / 20)
      ) < 1e-12
    );
  }

  const calibrated = await createReferenceHarness({ dr: -30, iv: 2.828 });
  calibrated.process(input.subarray(0, 512), [128]);
  const beforeChange = calibrated.checkpoint();
  assert.ok(
    Math.abs(beforeChange.controls[0] - 2.828 * Math.pow(10, -30 / 20)) < 1e-12
  );
  assert.ok(beforeChange.slowPublishCount > 0);

  calibrated.setParameters({ iv: 4 });
  calibrated.processBlock(new Float32Array(2));
  const afterChange = calibrated.checkpoint();
  assert.ok(afterChange.slowPublishCount >= beforeChange.slowPublishCount);
  assert.notEqual(afterChange.controls[0], beforeChange.controls[0]);
});

const TRANSLATED_SATURATION_DOCS = Object.freeze(
  ['ar', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'].map(language => ({
    language,
    file: path.join(repoRoot, 'docs', 'i18n', language, 'plugins', 'saturation.md')
  }))
);

// The heading is the anchor README links to, so it is also the section marker.
function tubeSimulatorSection(source, file) {
  const start = source.indexOf('\n## Tube Simulator\n');
  assert.notEqual(start, -1, `${file} is missing the "## Tube Simulator" section`);
  const rest = source.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('Tube Simulator preset matching is documented in every language', async () => {
  const docs = [
    { language: 'en', file: path.join(repoRoot, 'docs', 'plugins', 'saturation.md') },
    ...TRANSLATED_SATURATION_DOCS
  ];
  const tokens = [
    'EL84 Pentode @2%',
    'Output Safety Trim',
    'Auto Gain Reduction'
  ];

  for (const { language, file } of docs) {
    const locale = readFileSync(
      new URL(`../../js/locales/${language}.json5`, import.meta.url),
      'utf8'
    );
    const effectPresets = locale.match(
      /^\s*"ui\.title\.effectPresets":\s*"([^"]+)"/m
    )?.[1];
    assert.ok(effectPresets, `${language} is missing ui.title.effectPresets`);
    const section = tubeSimulatorSection(await fs.readFile(file, 'utf8'), file);
    const paragraph = section.split(/\r?\n\r?\n/)
      .find(candidate => candidate.includes('**EL84 Pentode @2%**'));
    assert.ok(paragraph, `${language} is missing the preset-matching paragraph`);
    assert.ok(paragraph.includes(`**${effectPresets}**`),
      `${language} preset-matching paragraph is missing "${effectPresets}"`);
    for (const token of tokens) {
      assert.ok(paragraph.includes(`**${token}**`),
        `${language} preset-matching paragraph is missing "${token}"`);
    }
  }
});

test('Tube Simulator listening guides only present selectable preset names as choices', async () => {
  const tables = readPluginPresetTables(repoRoot);
  const selectableLabels = new Set(
    tables.groups.flatMap(group => group.presets.map(preset => preset.label))
  );
  const hiddenLabels = tables.canonical.map(preset => preset.label);

  for (const { language, file } of TRANSLATED_SATURATION_DOCS) {
    const section = tubeSimulatorSection(await fs.readFile(file, 'utf8'), file);
    const guideStart = section.indexOf('\n### ');
    const guideEnd = section.indexOf('\n### ', guideStart + 1);
    const guide = section.slice(guideStart, guideEnd);

    for (const label of hiddenLabels) {
      assert.equal(guide.includes(`**${label}**`), false,
        `docs/i18n/${language} presents hidden canonical preset "${label}" as selectable`);
    }
    for (const match of guide.matchAll(/\*\*([^*]+@\d+(?:\.\d+)?%)\*\*/g)) {
      assert.ok(selectableLabels.has(match[1]),
        `docs/i18n/${language} uses non-selectable preset name "${match[1]}"`);
    }
  }
});

test('Tube Simulator presets are grouped by Pre, Power, and Pre+Power signal paths', () => {
  const tables = readPluginPresetTables(repoRoot);
  const expectedPowerIds = [
    'power-only-el84-pentode-10w-thd0p1',
    'power-only-el84-distributed-10w-thd0p1',
    'power-only-el34-distributed-20-37w-thd0p1',
    'power-only-6l6gc-pentode-thd0p1',
    'power-only-kt88-distributed-thd0p1',
    'power-only-se-300b-thd0p1',
    'power-only-se-300b-thd1',
    'power-only-se-2a3-thd0p1',
    'power-only-se-2a3-thd1',
    'power-only-el84-pentode-10w',
    'power-only-el84-distributed-10w',
    'power-only-el34-distributed-20-37w',
    'power-only-6l6gc-pentode',
    'power-only-kt88-distributed'
  ];

  assert.deepEqual(tables.groups.map(group => group.label), ['Pre', 'Power', 'Pre+Power']);
  assert.equal(tables.powerOnly.length, 7);
  assert.deepEqual(
    tables.groups[1].presets.map(preset => preset.id),
    expectedPowerIds,
    'the Power group must contain exactly the selectable power-only bank'
  );

  const ids = tables.groups.flatMap(group => group.presets.map(preset => preset.id));
  assert.equal(new Set(ids).size, ids.length, 'a preset appears in more than one signal-path group');
  assert.equal(ids.length, 35);
  assert.deepEqual(tables.groups.map(group => group.presets.length), [8, 14, 13]);
  assert.ok(tables.groups[0].presets.every(preset => preset.params.os === 'Line'));
  assert.ok(tables.groups[2].presets.every(preset =>
    preset.params.os !== 'Line' && preset.params.tp !== 'Bypass'));
});

test('Power-only presets retain their power circuits while bypassing the common driver', () => {
  const tables = readPluginPresetTables(repoRoot);
  const canonicalById = new Map(tables.canonical.map(preset => [preset.id, preset]));
  const calibratedFields = new Set(['dr', 'tp', 'iv', 'og']);

  for (const preset of tables.powerOnly) {
    assert.equal(preset.params.tp, 'Bypass', `${preset.id} does not bypass the driver`);
    assert.notEqual(preset.params.os, 'Line', `${preset.id} has no power circuit`);

    const suffix = preset.id.slice('power-only-'.length);
    const base = canonicalById.get(suffix.startsWith('se-') ? suffix : `power-${suffix}`);
    assert.ok(base, `${preset.id} has no canonical circuit base`);
    for (const field of tables.fields) {
      if (calibratedFields.has(field)) continue;
      if (field === 'nf' && preset.id === 'power-only-kt88-distributed') {
        assert.equal(preset.params.nf, 2,
          'Power-only KT88 must use the stable direct-drive feedback setting');
        assert.equal(preset.params.og, -10.747,
          'Power-only KT88 must keep its calibrated Output Trim');
        continue;
      }
      assert.equal(preset.params[field], base.params[field],
        `${preset.id} changed canonical circuit field ${field}`);
    }
  }
});
