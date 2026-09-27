import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { frequencyAxisSource } from '../helpers/spectrum-overlay-harness.mjs';
import { performance } from 'node:perf_hooks';

function createHub() {
  const subscriptions = [];
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  return {
    subscriptions,
    get subscribeCalls() { return subscribeCalls; },
    get unsubscribeCalls() { return unsubscribeCalls; },
    subscribe(tapId, frameType, callback) {
      subscribeCalls++;
      const subscription = { tapId, frameType, callback, active: true };
      subscriptions.push(subscription);
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        unsubscribeCalls++;
      };
    },
    emit(frame) {
      for (const subscription of subscriptions) {
        if (subscription.active) subscription.callback(frame);
      }
    }
  };
}

function loadSpectrumAnalyzer({
  hub = null,
  now = () => performance.now(),
  documentRef = null,
  IntersectionObserverRef = null
} = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/spectrum_analyzer.js', import.meta.url),
    'utf8'
  );
  const calls = [];
  const windowRef = { dspTelemetryHub: hub };
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = null;
      this._sectionEnabled = true;
    }
    registerProcessor(processor) { this.processorString = processor; }
    updateParameters() { calls.push(['updateParameters']); }
    _setupMessageHandler() { calls.push(['baseSetupMessageHandler']); }
    cleanup() { calls.push(['baseCleanup']); }
  }
  installThemePaletteStub(windowRef);
  vm.runInNewContext(frequencyAxisSource, { window: windowRef });
  vm.runInNewContext(source, {
    window: windowRef,
    PluginBase,
    document: documentRef,
    IntersectionObserver: IntersectionObserverRef,
    performance: { now },
    cancelAnimationFrame() {},
    console,
    Float32Array,
    DataView,
    ArrayBuffer
  }, { filename: 'spectrum_analyzer.js' });
  return { SpectrumAnalyzerPlugin: windowRef.SpectrumAnalyzerPlugin, calls, windowRef };
}

function makeSpectrumFrame({
  frameType = 4,
  version = 1,
  sampleRate = 48000,
  points = 8,
  flags = points === 14 ? 1 : 0,
  binCount = points === 14 ? 8190 : (1 << (points - 1)) + 1,
  trailingBytes = 0,
  currentValue = bin => -120 + bin / 1000,
  peakValue = bin => bin === 8 ? -1 : -100
} = {}) {
  const buffer = new ArrayBuffer(12 + binCount * 8 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setFloat32(0, sampleRate, true);
  payload.setUint32(4, binCount, true);
  payload.setUint16(8, points, true);
  payload.setUint16(10, flags, true);
  for (let bin = 0; bin < binCount; bin++) {
    payload.setFloat32(12 + bin * 4, currentValue(bin), true);
    payload.setFloat32(12 + binCount * 4 + bin * 4, peakValue(bin), true);
  }
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

function subscribedPlugin(runtime, id = 37) {
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

function createUiElement(tagName) {
  const listeners = new Map();
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    className: '',
    textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.({ target: this }); },
    querySelector() { return null; }
  };
}

test('Spectrum Analyzer places Keyboard after every other setting and keeps its helper binding', () => {
  const documentRef = { createElement: createUiElement };
  class FakeIntersectionObserver {
    observe() {}
    disconnect() {}
  }
  const runtime = loadSpectrumAnalyzer({ documentRef, IntersectionObserverRef: FakeIntersectionObserver });
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const helperCalls = [];
  const createRow = (label, input = null) => {
    const row = createUiElement('div');
    row.className = 'parameter-row';
    const labelElement = createUiElement('label');
    labelElement.textContent = `${label}:`;
    row.appendChild(labelElement);
    if (input) row.appendChild(input);
    return row;
  };
  plugin.createParameterControl = (label, minimum, maximum, step, value, setter, unit, key) => {
    helperCalls.push({ kind: 'parameter', label, value, key });
    return createRow(`${label} (${unit})`);
  };
  plugin.createRadioGroup = (label, options, value, setter, key) => {
    helperCalls.push({ kind: 'radio', label, options, value, key });
    return createRow(label);
  };
  plugin.createCheckboxControl = (label, checked, setter, key) => {
    helperCalls.push({ kind: 'checkbox', label, value: checked, key });
    const checkbox = createUiElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.addEventListener('change', event => setter(event.target.checked));
    return createRow(label, checkbox);
  };
  plugin.createResponsiveGraph = () => ({
    container: createUiElement('div'),
    canvas: createUiElement('canvas'),
    dispose() {}
  });
  plugin.registerUIRefresh = () => {};
  plugin.isHeldByUser = () => false;

  const ui = plugin.createUI();
  const rows = ui.children.filter(child => child.className.includes('parameter-row'));
  assert.deepEqual(rows.map(row => row.children[0].textContent), [
    'DB Range (dB):',
    'Points:',
    'Frequency Scale:',
    'Display:',
    'Color:',
    'Keyboard:'
  ]);
  assert.equal(ui.children.at(-2), rows.at(-1));
  assert.deepEqual(helperCalls.map(({ kind, label, key }) => ({ kind, label, key })), [
    { kind: 'parameter', label: 'DB Range', key: 'dr' },
    { kind: 'radio', label: 'Frequency Scale', key: 'sc' },
    { kind: 'radio', label: 'Display', key: 'dm' },
    { kind: 'radio', label: 'Color', key: 'cl' },
    { kind: 'checkbox', label: 'Keyboard', key: 'kb' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(helperCalls.find(call => call.key === 'cl').options)), [
    { value: 'Normal', label: 'Normal' },
    { value: 'Heatmap', label: 'Heatmap' },
    { value: 'Rainbow', label: 'Note Colors' }
  ]);
  assert.equal(helperCalls.at(-1).value, false);

  const keyboardCheckbox = rows.at(-1).children[1];
  plugin.canvas = null;
  keyboardCheckbox.checked = true;
  keyboardCheckbox.dispatch('change');
  assert.equal(plugin.getParameters().kb, true);
});

test('Spectrum Analyzer persists the selected frequency scale and maps linear x positions', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();

  assert.equal(plugin.getParameters().sc, 'log');
  assert.equal(plugin.frequencyToX(20, 100), 0);
  assert.equal(plugin.frequencyToX(40000, 100), 100);

  plugin.setParameters({ sc: 'linear' });
  assert.equal(plugin.getParameters().sc, 'linear');
  assert.equal(plugin.frequencyToX(20010, 100), 50);

  plugin.setParameters({ sc: 'unsupported' });
  assert.equal(plugin.getParameters().sc, 'log');
  plugin.setFrequencyScale('linear');
  plugin.reset();
  assert.equal(plugin.getParameters().sc, 'log');
});

test('Spectrum Analyzer persists and resets the selected display mode', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();

  assert.equal(plugin.getParameters().dm, 'line');
  plugin.setParameters({ dm: 'bar' });
  assert.equal(plugin.getParameters().dm, 'bar');
  plugin.setParameters({ dm: 'unsupported' });
  assert.equal(plugin.getParameters().dm, 'line');
  plugin.setDisplayMode('bar');
  plugin.reset();
  assert.equal(plugin.getParameters().dm, 'line');
});

test('Spectrum Analyzer Color builds level and pitch gradients', () => {
  const runtime = loadSpectrumAnalyzer();
  runtime.windowRef.NoteSpectrogramPlugin = { noteColor: midi => [midi, 80, 160] };
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let intensity = 0; intensity < 256; intensity++) {
    rgba.set([intensity, 0, 255 - intensity, intensity], intensity * 4);
  }
  runtime.windowRef.SpectrogramPlugin = { getHeatmapLuts: () => ({ rgba }) };
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const gradients = [];
  const context = {
    createLinearGradient(...coordinates) {
      const gradient = { coordinates, stops: [], addColorStop(position, color) {
        this.stops.push([position, color]);
      } };
      gradients.push(gradient);
      return gradient;
    }
  };
  assert.equal(plugin.getColorStyle(context, 200, 100), null);
  plugin.setColor('Heatmap');
  const heatmap = plugin.getColorStyle(context, 200, 100);
  assert.deepEqual(heatmap.coordinates, [0, 100, 0, 0]);
  assert.deepEqual(heatmap.stops[0], [0, 'rgba(0,0,255,0)']);
  assert.deepEqual(heatmap.stops.at(-1), [1, 'rgba(255,0,0,1)']);
  assert.equal(plugin.getColorStyle(context, 200, 100), heatmap);
  plugin.setColor('Rainbow');
  const notes = plugin.getColorStyle(context, 200, 100);
  assert.deepEqual(notes.coordinates, [0, 0, 200, 0]);
  assert.ok(notes.stops.length > 100);
  assert.equal(notes.stops[0][0], 0);
  assert.equal(notes.stops.at(-1)[0], 1);
  plugin.setFrequencyScale('linear');
  assert.notEqual(plugin.getColorStyle(context, 200, 100), notes);
  assert.equal(plugin.getParameters().cl, 'Rainbow');
  plugin.reset();
  assert.equal(plugin.cl, 'Normal');
});

test('Spectrum Analyzer Note Colors paints each bar and peak from its center frequency', () => {
  const runtime = loadSpectrumAnalyzer();
  runtime.windowRef.NoteSpectrogramPlugin = { noteColor: midi => [midi, 80, 160] };
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  plugin.setColor('Rainbow');
  const spectrum = new Float32Array(48).fill(-Infinity);
  const peaks = new Float32Array(48).fill(-Infinity);
  for (const band of [10, 11]) { spectrum[band] = -30; peaks[band] = -20; }
  const bands = { spectrum, peaks, firstFilled: 10, lastFilled: 11 };
  const fills = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, stroke() {},
    moveTo() {}, lineTo() {},
    createLinearGradient() { throw new Error('Bars should not use a gradient'); },
    fillRect() { fills.push(this.fillStyle); }
  };
  for (const scale of ['linear', 'log', 'log-hq']) {
    plugin.sc = scale;
    fills.length = 0;
    plugin.drawSpectrumBars(context, bands, 800, 400, 1);
    const expected = [10, 11].map(band => {
      const frequency = plugin.displayXToFrequency((band + 0.5) / 48);
      const midi = 69 + 12 * Math.log2(frequency / 440);
      return `rgb(${runtime.windowRef.NoteSpectrogramPlugin.noteColor(midi).map(Math.round).join(',')})`;
    });
    assert.deepEqual(fills, [...expected, ...expected], scale);
  }
});

test('Spectrum Analyzer synchronously copies v1 telemetry without running a main-thread FFT', () => {
  const hub = createHub();
  const runtime = loadSpectrumAnalyzer({ hub });
  const plugin = subscribedPlugin(runtime, 42);
  let fftCalls = 0;
  plugin.fft = () => { fftCalls++; };
  const { frame, payload } = makeSpectrumFrame({
    sampleRate: 96000,
    currentValue: bin => bin === 8 ? -3.25 : -120,
    peakValue: bin => bin === 8 ? -1.5 : -100
  });

  hub.emit(frame);
  payload.setFloat32(12 + 8 * 4, 99, true);
  payload.setFloat32(12 + 129 * 4 + 8 * 4, 99, true);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 4);
  assert.equal(fftCalls, 0);
  assert.equal(plugin.sampleRate, 96000);
  assert.equal(plugin.spectrumPoints, 8);
  assert.equal(plugin.spectrum.length, 129);
  assert.equal(plugin.spectrum[8], -3.25);
  assert.equal(plugin.peaks[8], -1.5);
  assert.equal(plugin.dspSpectrumSnapshot.current[8], -3.25);
  assert.equal(plugin.dspSpectrumSnapshot.peaks[8], -1.5);
});

test('Spectrum Analyzer accepts only the exact pt=14 truncated maximum payload contract', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const { frame, payload } = makeSpectrumFrame({ points: 14 });
  const parsed = plugin.parseDspSpectrumTelemetryFrame(frame);

  assert.equal(payload.byteLength, 65532);
  assert.equal(parsed.binCount, 8190);
  assert.equal(parsed.points, 14);
  assert.equal(parsed.flags, 1);
  assert.equal(parsed.binsTruncated, true);
  assert.equal(parsed.current.length, 8190);
  assert.equal(parsed.peaks.length, 8190);
  assert.ok(Math.abs(parsed.current[8189] - (-120 + 8.189)) < 1e-5);

  assert.equal(plugin.parseDspSpectrumTelemetryFrame(
    makeSpectrumFrame({ points: 14, flags: 0, binCount: 8193 }).frame
  ), null);
  assert.equal(plugin.parseDspSpectrumTelemetryFrame(
    makeSpectrumFrame({ points: 14, flags: 1, binCount: 8189 }).frame
  ), null);
  assert.equal(plugin.parseDspSpectrumTelemetryFrame(
    makeSpectrumFrame({ points: 13, flags: 1, binCount: 4094 }).frame
  ), null);
});

test('Spectrum Analyzer rejects malformed, non-finite, and incompatible v1 payloads', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const nonFiniteCurrent = makeSpectrumFrame();
  nonFiniteCurrent.payload.setFloat32(12, Number.NaN, true);
  const nonFinitePeak = makeSpectrumFrame();
  nonFinitePeak.payload.setFloat32(12 + 129 * 4, Number.POSITIVE_INFINITY, true);
  const highPeak = makeSpectrumFrame();
  highPeak.payload.setFloat32(12 + 129 * 4, 0.01, true);
  const lowPeak = makeSpectrumFrame();
  lowPeak.payload.setFloat32(12 + 129 * 4, -145.01, true);
  const invalid = [
    makeSpectrumFrame({ frameType: 5 }).frame,
    makeSpectrumFrame({ version: 2 }).frame,
    makeSpectrumFrame({ sampleRate: Number.NaN }).frame,
    makeSpectrumFrame({ sampleRate: 0 }).frame,
    makeSpectrumFrame({ points: 7, binCount: 65 }).frame,
    makeSpectrumFrame({ points: 15, binCount: 16385 }).frame,
    makeSpectrumFrame({ flags: 2 }).frame,
    makeSpectrumFrame({ binCount: 128 }).frame,
    makeSpectrumFrame({ trailingBytes: 4 }).frame,
    nonFiniteCurrent.frame,
    nonFinitePeak.frame,
    highPeak.frame,
    lowPeak.frame,
    { frameType: 4, formatVersion: 1, payload: new Uint8Array(64) }
  ];

  for (const frame of invalid) {
    assert.equal(plugin.parseDspSpectrumTelemetryFrame(frame), null);
  }
  assert.equal(plugin.dspSpectrumSnapshot, null);
});

test('Spectrum Analyzer retains its legacy processBuffer FFT as the fallback path', () => {
  const hub = createHub();
  const runtime = loadSpectrumAnalyzer({ hub });
  const plugin = subscribedPlugin(runtime);
  hub.emit(makeSpectrumFrame().frame);
  assert.notEqual(plugin.dspSpectrumSnapshot, null);

  plugin.setPoints(8);
  const originalFft = plugin.fft;
  let fftCalls = 0;
  plugin.fft = function(real, imag) {
    fftCalls++;
    return originalFft.call(this, real, imag);
  };
  const average = new Float32Array(256);
  average[0] = 1;
  plugin.onMessage({
    type: 'processBuffer',
    measurements: {
      buffer: [average],
      bufferPosition: 0,
      time: 1,
      sampleRate: 32000
    }
  });

  assert.equal(fftCalls, 1);
  assert.equal(plugin.dspSpectrumSnapshot, null);
  assert.equal(plugin.spectrumPoints, 8);
  assert.equal(plugin.spectrum.length, 128);
  assert.match(plugin.processorString, /Float32Array\.from\(context\.buffer\[0\]\)/);
  assert.match(plugin.processorString, /bufferPosition % \(fftSize \/ 2\) === 0/);
});

test('Spectrum Analyzer deduplicates, rebinds, and cleans up telemetry subscriptions', () => {
  const firstHub = createHub();
  const runtime = loadSpectrumAnalyzer({ hub: firstHub });
  const plugin = subscribedPlugin(runtime, 7);
  plugin.getParameters();
  plugin._setupMessageHandler();
  assert.equal(firstHub.subscribeCalls, 1);

  const secondHub = createHub();
  runtime.windowRef.dspTelemetryHub = secondHub;
  plugin._setupMessageHandler();
  assert.equal(firstHub.unsubscribeCalls, 1);
  assert.equal(secondHub.subscribeCalls, 1);

  plugin.cleanup();
  plugin.cleanup();
  assert.equal(secondHub.unsubscribeCalls, 1);
  assert.ok(runtime.calls.some(call => call[0] === 'baseCleanup'));
});

test('Spectrum Analyzer aggregates maxima, fills interior gaps, and bounds the valid bands', () => {
  const { SpectrumAnalyzerPlugin } = loadSpectrumAnalyzer();
  const bands = SpectrumAnalyzerPlugin.aggregateBands([
    [20, [-40, -30]],
    [25, [-25, -15]],
    [60, [-35, -20]],
    [100, [-10, -5]]
  ], 100, 5);

  assert.deepEqual(Array.from(bands.spectrum), [
    Number.NEGATIVE_INFINITY, -25, -25, -35, -10
  ]);
  assert.deepEqual(Array.from(bands.peaks), [
    Number.NEGATIVE_INFINITY, -15, -15, -20, -5
  ]);
  assert.equal(bands.firstFilled, 1);
  assert.equal(bands.lastFilled, 4);

  const empty = SpectrumAnalyzerPlugin.aggregateBands([], 100, 5);
  assert.deepEqual(Array.from(empty.spectrum), Array(5).fill(Number.NEGATIVE_INFINITY));
  assert.deepEqual(Array.from(empty.peaks), Array(5).fill(Number.NEGATIVE_INFINITY));
  assert.equal(empty.firstFilled, 5);
  assert.equal(empty.lastFilled, -1);
});

function createSpectrumDrawRecorder() {
  const operations = [];
  const record = (type, details = {}) => operations.push({ type, ...details });
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    fillRect(x, y, width, height) {
      record('fillRect', { style: this.fillStyle, x, y, width, height });
    },
    fillText(text, x, y) {
      record('fillText', { style: this.fillStyle, text, x, y });
    },
    strokeText(text, x, y) {
      record('strokeText', { style: this.strokeStyle, text, x, y });
    },
    beginPath() { record('beginPath'); },
    closePath() { record('closePath'); },
    moveTo(x, y) { record('moveTo', { x, y }); },
    lineTo(x, y) { record('lineTo', { x, y }); },
    rect(x, y, width, height) { record('rect', { x, y, width, height }); },
    fill() { record('fill', { style: this.fillStyle }); },
    createLinearGradient: () => ({ addColorStop() {} }),
    stroke() { record('stroke', { style: this.strokeStyle, lineWidth: this.lineWidth }); },
    measureText(text) { return { width: text.length * parseFloat(this.font) * 0.65 }; },
    clip() { record('clip'); },
    save() { record('save'); },
    restore() { record('restore'); },
    translate(x, y) { record('translate', { x, y }); },
    rotate(angle) { record('rotate', { angle }); }
  };
  return { ctx, operations };
}

function collectStrokedLines(operations) {
  const lines = [];
  let start = null;
  let end = null;
  for (const operation of operations) {
    if (operation.type === 'beginPath') {
      start = null;
      end = null;
    } else if (operation.type === 'moveTo') {
      start = { x: operation.x, y: operation.y };
    } else if (operation.type === 'lineTo') {
      end = { x: operation.x, y: operation.y };
    } else if (operation.type === 'stroke' && start && end) {
      lines.push({ start, end, style: operation.style, lineWidth: operation.lineWidth });
    }
  }
  return lines;
}

test('Spectrum Analyzer draws bounded bars at the aggregated levels', () => {
  const { SpectrumAnalyzerPlugin } = loadSpectrumAnalyzer();
  const plugin = new SpectrumAnalyzerPlugin();
  plugin.dr = -100;
  const { ctx, operations } = createSpectrumDrawRecorder();
  const bands = {
    spectrum: new Float32Array([Number.NEGATIVE_INFINITY, -50, -25, Number.NEGATIVE_INFINITY]),
    peaks: new Float32Array([Number.NEGATIVE_INFINITY, -40, -10, Number.NEGATIVE_INFINITY]),
    firstFilled: 1,
    lastFilled: 2
  };

  plugin.drawSpectrumBars(ctx, bands, 400, 200, 2);

  const bars = operations.filter(operation =>
    operation.type === 'fillRect' && operation.style === 'stub:graph-trace-fill');
  const peaks = operations.filter(operation =>
    operation.type === 'fillRect' && operation.style === 'stub:graph-trace');
  assert.equal(bars.length, 2);
  assert.equal(peaks.length, 2);
  assert.deepEqual(bars.map(({ y }) => y), [100, 50]);
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    assert.ok(bar.width >= 1);
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 400);
    if (index > 0) assert.ok(bars[index - 1].x + bars[index - 1].width <= bar.x);
  }
});

test('Spectrum Bar quantization fills whole blocks and places the peak in one block', () => {
  const { SpectrumAnalyzerPlugin } = loadSpectrumAnalyzer();
  const plugin = new SpectrumAnalyzerPlugin();
  const bands = { spectrum: Float32Array.of(-50), peaks: Float32Array.of(-31),
    firstFilled: 0, lastFilled: 0 };
  const draw = quantizeBars => {
    plugin.displayOptions = { quantizeBars };
    const { ctx, operations } = createSpectrumDrawRecorder();
    plugin.drawSpectrumBars(ctx, bands, 120, 240, 1);
    return operations.filter(operation => operation.type === 'fillRect');
  };
  const continuous = draw(false);
  const quantized = draw(true);
  const geometry = rectangles => rectangles.map(({ y, height }) =>
    [Math.round(y * 100) / 100, Math.round(height * 100) / 100]);
  assert.deepEqual(geometry(continuous),
    [[125, 115], [77.5, 1]]);
  assert.deepEqual(geometry(quantized),
    [[126, 114], [72.5, 5]]);
  const top = { spectrum: Float32Array.of(-1), peaks: Float32Array.of(0),
    firstFilled: 0, lastFilled: 0 };
  const { ctx, operations } = createSpectrumDrawRecorder();
  plugin.drawSpectrumBars(ctx, top, 120, 400, 1);
  assert.deepEqual(geometry(operations.filter(operation => operation.type === 'fillRect')).at(-1),
    [4.5, 5]);
  assert.deepEqual(Array.from(bands.spectrum), [-50]);
  assert.deepEqual(Array.from(bands.peaks), [-31]);
});

test('Spectrum Analyzer keeps Line free of bars and paints Bar labels last', () => {
  const { SpectrumAnalyzerPlugin, windowRef } = loadSpectrumAnalyzer();
  const plugin = new SpectrumAnalyzerPlugin();
  plugin.setPoints(8);
  plugin.sampleRate = 48000;
  plugin.spectrum.fill(-48);
  plugin.peaks.fill(-24);
  plugin.graphDpr = 1;
  const width = 480;
  const height = 240;
  const now = 1000;

  const lineRecorder = createSpectrumDrawRecorder();
  plugin.canvas = { width, height, getContext: () => lineRecorder.ctx };
  plugin.drawGraph(now);
  assert.equal(lineRecorder.operations.some(operation =>
    operation.type === 'fillRect' &&
    (operation.style === 'stub:graph-trace-fill' || operation.style === 'stub:graph-trace')), false);

  plugin.setDisplayMode('bar');
  for (const { cssWidth, bandCount, background } of [
    { cssWidth: 600, bandCount: 48, background: 'rgb(16, 16, 16)' },
    { cssWidth: 400, bandCount: 24, background: 'rgb(240, 240, 240)' }
  ]) {
    windowRef.ThemePalette.get = name =>
      name === 'graph-bg-deep' ? background : `stub:${name}`;
    plugin.graphCssWidth = cssWidth;
    const barRecorder = createSpectrumDrawRecorder();
    plugin.canvas = { width, height, getContext: () => barRecorder.ctx };
    const levels = plugin.collectSpectrumLevels(width, now);
    const bands = SpectrumAnalyzerPlugin.aggregateBands(levels, width, bandCount);
    plugin.drawGraph(now);

    const bodyBars = barRecorder.operations.filter(operation =>
      operation.type === 'fillRect' && operation.style === 'stub:graph-trace-fill');
    assert.equal(bodyBars.length, bands.lastFilled - bands.firstFilled + 1);
    const backgroundFill = barRecorder.operations.find(operation =>
      operation.type === 'fillRect' && operation.x === 0 && operation.y === 0 &&
      operation.width === width && operation.height === height);
    assert.equal(backgroundFill.style, background);
    const lastBarIndex = barRecorder.operations.findLastIndex(operation =>
      operation.type === 'fillRect' &&
      (operation.style === 'stub:graph-trace-fill' || operation.style === 'stub:graph-trace'));
    const labels = barRecorder.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.type === 'fillText');
    assert.ok(labels.length > 2);
    assert.ok(labels.some(({ operation }) => operation.text === 'Frequency (Hz)'));
    assert.ok(labels.some(({ operation }) => operation.text === 'Level (dB)'));
    assert.ok(labels.every(({ index }) => index > lastBarIndex));
    for (const { operation, index } of labels) {
      assert.deepEqual(barRecorder.operations[index - 1], {
        type: 'strokeText',
        style: backgroundFill.style,
        text: operation.text,
        x: operation.x,
        y: operation.y
      });
    }
  }
});

function captureSpectrum(plugin) {
  let points;
  const paths = [];
  const ctx = {
    fillRect() { paths.length = 0; }, fillText() {}, save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() { points = []; },
    moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
    stroke() { paths.push({ color: this.strokeStyle, points }); }
  };
  plugin.canvas = { width: 1200, height: 960, getContext: () => ctx };
  return now => {
    plugin.drawGraph(now);
    return {
      current: paths.find(path => path.color === 'stub:graph-trace-fill').points,
      peak: paths.find(path => path.color === 'stub:graph-trace').points
    };
  };
}

test('Spectrum Analyzer projects only peak decay at render time without mutating snapshots', () => {
  let now = 1000;
  const runtime = loadSpectrumAnalyzer({ now: () => now });
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const draw = captureSpectrum(plugin);
  plugin.handleDspSpectrumTelemetry(makeSpectrumFrame({ points: 12, currentValue: () => -50, peakValue: () => -10 }).frame);
  const snapshot = plugin.dspSpectrumSnapshot;
  const stored = Array.from(plugin.peaks);
  const initial = draw(now);
  for (const elapsed of [4, 17, 31]) {
    const frame = draw(now + elapsed);
    assert.deepEqual(frame.current, initial.current);
    assert.ok(Math.abs(frame.peak[0][1] - (100 + 0.2 * elapsed)) < 1e-9);
  }
  assert.ok(Math.abs(draw(now + 5000).peak[0][1] - (100 + 20 * 2048 / 48000 * 10)) < 1e-9);
  assert.equal(plugin.dspSpectrumSnapshot, snapshot);
  assert.deepEqual(Array.from(plugin.peaks), stored);
  assert.equal(snapshot.peaks[8], -10);
  now += 100;
  plugin.handleDspSpectrumTelemetry(makeSpectrumFrame({ points: 14, sampleRate: 96000, currentValue: () => -50, peakValue: () => -10 }).frame);
  assert.ok(Math.abs(draw(now + 5000).peak[0][1] - (100 + 20 * 8192 / 96000 * 10)) < 1e-9);
  now += 100;
  plugin.handleDspSpectrumTelemetry(makeSpectrumFrame({ currentValue: () => -10, peakValue: () => -10 }).frame);
  assert.deepEqual(draw(now + 1000), draw(now));
  plugin.cleanup();
});

test('Spectrum Analyzer freezes peak position and accepts fresh peaks after repeated ON/OFF', () => {
  let now = 1000;
  const plugin = new (loadSpectrumAnalyzer({ now: () => now }).SpectrumAnalyzerPlugin)();
  const draw = captureSpectrum(plugin);
  const emit = peak => plugin.handleDspSpectrumTelemetry(makeSpectrumFrame({ currentValue: () => -80, peakValue: () => peak }).frame);
  let callback;
  plugin.isVisible = true;
  plugin.requestPowerAnimationFrame = next => { callback = next; return 1; };
  emit(-10);
  for (let cycle = 0; cycle < 8; cycle++) {
    now += 5;
    const frozen = draw(now);
    plugin.stopAnimation();
    const gate = cycle % 2 ? '_sectionEnabled' : 'enabled';
    plugin[gate] = false;
    now += 10000;
    emit(-1);
    {
      const frame = draw(now);
      assert.deepEqual(frame.current, frozen.current);
      assert.ok(frame.peak.every((point, index) => point[0] === frozen.peak[index][0] && Math.abs(point[1] - frozen.peak[index][1]) < 1e-8));
    }
    plugin[gate] = true;
    plugin.startAnimation();
    {
      const frame = draw(now);
      assert.deepEqual(frame.current, frozen.current);
      assert.ok(frame.peak.every((point, index) => point[0] === frozen.peak[index][0] && Math.abs(point[1] - frozen.peak[index][1]) < 1e-8));
    }
    emit(-5);
    assert.equal(draw(now).peak[0][1], 50);
    callback(now + 7);
    assert.ok(Math.abs(draw(now + 7).peak[0][1] - 51.4) < 1e-9);
  }
  plugin.cleanup();
});


test('Spectrum Analyzer round-trips Keyboard and normalizes it to true-only', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  assert.equal(plugin.getParameters().kb, false);
  plugin.setParameters({ kb: true });
  const restored = new runtime.SpectrumAnalyzerPlugin();
  restored.setParameters(plugin.getParameters());
  assert.equal(restored.kb, true);
  const count = runtime.calls.length;
  restored.setKeyboardVisible(true);
  assert.equal(runtime.calls.length, count);
  restored.setParameters({ kb: 'true' });
  assert.equal(restored.kb, false);
  restored.setKeyboardVisible(true);
  restored.reset();
  assert.equal(restored.getParameters().kb, false);
});

test('Spectrum Analyzer keyboard cells follow both frequency scales and clip the full display range', () => {
  const { SpectrumAnalyzerPlugin } = loadSpectrumAnalyzer();
  const plugin = new SpectrumAnalyzerPlugin();
  for (const scale of ['log', 'linear']) {
    plugin.sc = scale;
    const keys = plugin.getKeyboardGeometry(1024);
    assert.equal(keys[0].midi, 15);
    assert.equal(keys.at(-1).midi, 147);
    assert.equal(keys[0].start, 0);
    assert.equal(keys.at(-1).end, 1024);
    assert.equal(keys.find(key => key.midi === 69).center, plugin.frequencyToX(440, 1024));
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      for (const coordinate of [key.start, key.center, key.end]) {
        assert.ok(Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1024);
      }
      assert.ok(key.start <= key.center && key.center <= key.end);
      if (i) assert.equal(keys[i - 1].end, key.start);
    }
    const black = keys.find(key => key.midi === 70);
    assert.equal(black.black, true);
    assert.equal(black.start, plugin.frequencyToX(440 * 2 ** (0.5 / 12), 1024));
    assert.equal(black.end, plugin.frequencyToX(440 * 2 ** (1.5 / 12), 1024));
    if (scale === 'linear') assert.ok(keys[1].end - keys[1].start < 1);
  }
});

test('Spectrum Analyzer Keyboard uses Note Spectrogram key colors in Paper and Midnight', () => {
  for (const { theme, background, soft, white } of [
    { theme: 'Paper', background: 'rgb(255, 255, 255)', soft: 'rgb(241, 241, 241)', white: 255 },
    { theme: 'Midnight', background: 'rgb(7, 11, 20)', soft: 'rgb(24, 31, 42)', white: 238 }
  ]) {
    const runtime = loadSpectrumAnalyzer();
    const requestedColors = [];
    runtime.windowRef.ThemePalette.get = name => {
      requestedColors.push(name);
      if (name === 'graph-bg-deep') return background;
      if (name === 'graph-base-soft') return soft;
      return `stub:${name}`;
    };
    const plugin = new runtime.SpectrumAnalyzerPlugin();
    const { ctx, operations } = createSpectrumDrawRecorder();
    const width = 1024;
    const height = 100;
    const gutter = 44.8;
    plugin.drawKeyboard(ctx, width, height, gutter, 28, 1);

    const fills = operations.filter(operation => operation.type === 'fillRect');
    assert.deepEqual(fills[0], {
      type: 'fillRect',
      style: `rgb(${white}, ${white}, ${white})`,
      x: 0,
      y: height - gutter,
      width,
      height: gutter
    }, theme);
    const blackKeys = plugin.getKeyboardGeometry(width).filter(key => key.black);
    assert.equal(fills.length, blackKeys.length + 1, theme);
    assert.ok(fills.slice(1).every(operation =>
      operation.style === 'rgb(17, 17, 17)' &&
      operation.y === height - gutter &&
      Math.abs(operation.height - 28) < 1e-9
    ), theme);
    assert.equal(requestedColors.includes('graph-base-soft'), false, theme);
  }
});

test('Spectrum Analyzer Keyboard reserves a DPR-scaled gutter for Line and Bar without altering levels', () => {
  const runtime = loadSpectrumAnalyzer();
  runtime.windowRef.ThemePalette.get = name => name === 'graph-bg-deep' ? 'rgb(16, 16, 16)' :
    'stub:' + name;
  for (const dpr of [1, 2]) {
    for (const sc of ['log', 'linear']) {
      for (const dm of ['line', 'bar']) {
        const plugin = new runtime.SpectrumAnalyzerPlugin();
        plugin.sc = sc;
        plugin.dm = dm;
        plugin.graphDpr = dpr;
        plugin.spectrum.fill(-48);
        plugin.peaks.fill(-24);
        const spectrum = Array.from(plugin.spectrum);
        const peaks = Array.from(plugin.peaks);
        const { ctx, operations } = createSpectrumDrawRecorder();
        const width = 1024 * dpr;
        const height = 480 * dpr;
        const { gutter: keyboardDepth, blackDepth } =
          runtime.windowRef.FrequencyAxis.keyboardDepths(width / Math.log2(40000 / 20), height);
        const plotHeight = height - keyboardDepth;
        plugin.canvas = { width, height, getContext: () => ctx };

        plugin.drawGraph(0);
        const standardFrequencyLines = collectStrokedLines(operations).filter(line =>
          line.start.x === line.end.x && line.start.y === 0 && line.end.y === height &&
          line.style === 'stub:graph-grid-subtle');
        assert.equal(standardFrequencyLines.length, sc === 'log' ? 11 : 9);
        assert.ok(operations.some(operation =>
          operation.type === 'fillText' && operation.text === 'Frequency (Hz)'));
        assert.ok(operations.some(operation =>
          operation.type === 'fillText' &&
          (typeof operation.text === 'number' || /^\d+(?:\.\d+)?k$/.test(operation.text))));

        operations.length = 0;
        plugin.kb = true;
        plugin.drawGraph(0);
        const plotClip = operations.find(operation => operation.type === 'rect');
        assert.deepEqual(plotClip, { type: 'rect', x: 0, y: 0, width, height: plotHeight });
        const base = operations.find(operation => operation.type === 'fillRect' && operation.y === plotHeight);
        assert.deepEqual(base, { type: 'fillRect', style: base.style, x: 0, y: plotHeight, width, height: keyboardDepth });
        const cLabels = operations.filter(operation => operation.type === 'fillText' && /^C\d+$/.test(operation.text));
        assert.ok(cLabels.length > 0);
        for (const label of cLabels) {
          assert.ok(label.x >= 0 && label.x <= width && label.y > plotHeight && label.y < height);
        }
        assert.equal(operations.some(operation =>
          (operation.type === 'fillText' || operation.type === 'strokeText') &&
          operation.text === 'Frequency (Hz)'), false);
        assert.equal(operations.some(operation =>
          operation.type === 'fillText' &&
          (typeof operation.text === 'number' || /^\d+(?:\.\d+)?k$/.test(operation.text))), false);
        assert.ok(operations.some(operation =>
          operation.type === 'fillText' && operation.text === 'Level (dB)'));
        assert.ok(operations.some(operation =>
          operation.type === 'fillText' && /^-\d+dB$/.test(operation.text)));
        const expectedBoundaryKeys = plugin.getKeyboardGeometry(width)
          .filter(key => {
            const pitchClass = (key.midi % 12 + 12) % 12;
            return (pitchClass === 0 || pitchClass === 5) &&
              key.start > 0 && key.start < width;
          });
        const expectedBoundaries = Array.from(expectedBoundaryKeys, key => ({
            x: key.start,
            style: (key.midi % 12 + 12) % 12 === 0
              ? 'stub:graph-grid-strong'
              : 'stub:graph-grid-subtle',
            lineWidth: dpr
          }));
        const musicalBoundaries = collectStrokedLines(operations)
          .filter(line => line.start.x === line.end.x &&
            line.start.y === 0 && line.end.y === plotHeight)
          .map(line => ({ x: line.start.x, style: line.style, lineWidth: line.lineWidth }));
        assert.deepEqual(musicalBoundaries, expectedBoundaries);
        const bars = operations.filter(operation => operation.type === 'fillRect' && operation.style === 'stub:graph-trace-fill');
        assert.equal(bars.length > 0, dm === 'bar');
        assert.ok(bars.every(bar => Math.abs(bar.y + bar.height - plotHeight) < 1e-9));
        const blackKeys = plugin.getKeyboardGeometry(width).filter(key => key.black);
        const blackFills = operations.filter(operation => operation.type === 'fillRect' &&
          operation.style === 'rgb(17, 17, 17)');
        assert.deepEqual(blackFills.map(({ x, width: keyWidth }) => ({ x, width: keyWidth })),
          Array.from(blackKeys, key => ({ x: key.start, width: key.end - key.start })));
        assert.ok(blackFills.every(operation => operation.y === plotHeight &&
          Math.abs(operation.height - blackDepth) < 1e-9));
        const whiteBaseIndex = operations.findIndex(operation => operation.type === 'fillRect' &&
          operation.y === plotHeight && operation.width === width && operation.height === keyboardDepth);
        const firstBlackIndex = operations.findIndex(operation => operation.type === 'fillRect' &&
          operation.style === 'rgb(17, 17, 17)');
        assert.ok(whiteBaseIndex >= 0 && whiteBaseIndex < firstBlackIndex);
        assert.ok(operations.some(operation => operation.type === 'stroke' &&
          operation.style === 'stub:graph-label' && operation.lineWidth === dpr));
        assert.deepEqual(Array.from(plugin.spectrum), spectrum);
        assert.deepEqual(Array.from(plugin.peaks), peaks);

        operations.length = 0;
        plugin.canvas.height = 40 * dpr;
        plugin.drawGraph(0);
        // A short graph caps the keyboard at half its height instead of dropping it.
        assert.deepEqual(operations.find(operation => operation.type === 'rect'),
          { type: 'rect', x: 0, y: 0, width, height: 20 * dpr });
      }
    }
  }
});
