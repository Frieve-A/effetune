import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { frequencyAxisSource } from '../helpers/spectrum-overlay-harness.mjs';

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

function loadSpectrogram({ hub = null, clock = { now: () => 0 } } = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/spectrogram.js', import.meta.url),
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
    requestPowerAnimationFrame(callback) { this.nextFrame = callback; return 1; }
  }
  vm.runInNewContext(frequencyAxisSource, { window: windowRef });
  vm.runInNewContext(source, {
    window: windowRef,
    PluginBase,
    performance: clock,
    cancelAnimationFrame() {},
    console,
    Float32Array,
    Uint8Array,
    Uint8ClampedArray,
    DataView,
    ArrayBuffer
  }, { filename: 'spectrogram.js' });
  return { SpectrogramPlugin: windowRef.SpectrogramPlugin, calls, windowRef };
}

function makeSpectrogramFrame({
  frameType = 5,
  version = 1,
  sampleRate = 48000,
  timeSeconds = 0,
  cellCount = 256,
  points = 8,
  trailingBytes = 0,
  intensity = row => row
} = {}) {
  const buffer = new ArrayBuffer(268 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setFloat32(0, sampleRate, true);
  payload.setFloat32(4, timeSeconds, true);
  payload.setUint16(8, cellCount, true);
  payload.setUint16(10, points, true);
  for (let row = 0; row < 256; row++) {
    payload.setUint8(12 + row, intensity(row));
  }
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

function subscribedPlugin(runtime, id = 37) {
  const plugin = new runtime.SpectrogramPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

function installCanvasStubs(plugin) {
  const drawCalls = [];
  const putCalls = [];
  const markerCalls = [];
  const operations = [];
  const fillCalls = [];
  const strokeCalls = [];
  const lineCalls = [];
  let pathStart = null;
  let pathEnd = null;
  plugin.imageDataCache = { data: new Uint8ClampedArray(256 * 1024 * 4) };
  plugin.tempCtx = {
    putImageData(...args) { putCalls.push(args); }
  };
  plugin.tempCanvas = { width: 1024, height: 256 };
  plugin.canvas = { width: 1024, height: 256 };
  plugin.canvasCtx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    lineWidth: 1,
    lineJoin: '',
    fillRect(x, y, width, height) {
      operations.push({ type: 'fillRect', x, y, width, height });
      fillCalls.push({ x, y, width, height, fillStyle: this.fillStyle });
    },
    drawImage(...args) {
      drawCalls.push(args);
      operations.push({ type: 'drawImage', args });
    },
    beginPath() { pathStart = null; pathEnd = null; },
    moveTo(x, y) {
      pathStart = { x, y };
      if (y === plugin.canvas.height - 16) markerCalls.push(x);
    },
    lineTo(x, y) {
      pathEnd = { x, y };
      operations.push({ type: 'lineTo', x, y });
    },
    rect(x, y, width, height) { operations.push({ type: 'rect', x, y, width, height }); },
    clip() {},
    fill() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText(text) { return { width: text.length * parseFloat(this.font) * 0.65 }; },
    stroke() {
      strokeCalls.push({ strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
      if (pathStart && pathEnd) {
        lineCalls.push({
          from: pathStart, to: pathEnd,
          strokeStyle: this.strokeStyle, lineWidth: this.lineWidth
        });
      }
    },
    strokeText(text, x, y) {
      operations.push({
        type: 'strokeText', text, x, y,
        strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineJoin: this.lineJoin,
        font: this.font, textAlign: this.textAlign
      });
    },
    fillText(text, x, y) {
      operations.push({
        type: 'fillText', text, x, y,
        fillStyle: this.fillStyle, font: this.font, textAlign: this.textAlign
      });
    },
    save() {},
    translate() {},
    rotate() {},
    restore() {}
  };
  return { drawCalls, putCalls, markerCalls, operations, fillCalls, strokeCalls, lineCalls };
}

test('Spectrogram persists frequency scale and reprojects canonical history immediately', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime);
  const { putCalls } = installCanvasStubs(plugin);
  const cellCount = 256;
  const historyWidth = 1024;
  const minFrequency = 20;
  const maxFrequency = 40000;
  const displayRow = 128;
  const firstIntensity = row => (row * 7) % 256;
  const secondIntensity = row => (row * 11 + 37) % 256;
  const pixelColor = (row, column) => {
    const offset = (row * historyWidth + column) * 4;
    return Array.from(plugin.imageDataCache.data.slice(offset, offset + 3));
  };
  const intensityColor = intensity => Array.from(plugin.spectrogramColorLut.slice(
    intensity * 3,
    intensity * 3 + 3
  ));
  const linearFrequencyAtRow = row => maxFrequency -
    (row / (cellCount - 1)) * (maxFrequency - minFrequency);
  const canonicalRowAtLinearDisplayRow = row => {
    const logMin = Math.log10(minFrequency);
    const logMax = Math.log10(maxFrequency);
    return (cellCount - 1) *
      (logMax - Math.log10(linearFrequencyAtRow(row))) / (logMax - logMin);
  };
  const interpolatedIntensity = (sourceRow, valueAtRow) => {
    const firstRow = Math.floor(sourceRow);
    const secondRow = Math.min(firstRow + 1, cellCount - 1);
    const fraction = sourceRow - firstRow;
    return Math.round(
      valueAtRow(firstRow) + (valueAtRow(secondRow) - valueAtRow(firstRow)) * fraction
    );
  };

  assert.equal(plugin.getParameters().sc, 'log');
  assert.equal(plugin.freqToY(20), 255);
  assert.equal(plugin.freqToY(40000), 0);

  hub.emit(makeSpectrogramFrame({ intensity: firstIntensity }).frame);
  assert.equal(plugin.spectrogramIntensityBuffer[123 * historyWidth], 93);
  plugin.setParameters({ sc: 'linear' });

  assert.equal(plugin.getParameters().sc, 'linear');
  assert.equal(plugin.freqToY(20010), 127);
  assert.equal(plugin.spectrogramIntensityBuffer[123 * historyWidth], 93);
  const linearSourceRow = canonicalRowAtLinearDisplayRow(displayRow);
  const firstLinearIntensity = interpolatedIntensity(linearSourceRow, firstIntensity);
  assert.deepEqual(
    pixelColor(displayRow, 0),
    intensityColor(firstLinearIntensity)
  );

  hub.emit(makeSpectrogramFrame({ timeSeconds: 0.01, intensity: secondIntensity }).frame);
  const secondLinearIntensity = interpolatedIntensity(linearSourceRow, secondIntensity);
  assert.equal(plugin.spectrogramIntensityBuffer[123 * historyWidth + 1], 110);
  assert.deepEqual(
    pixelColor(displayRow, 1),
    intensityColor(secondLinearIntensity)
  );

  plugin.setFrequencyScale('log');
  assert.equal(plugin.getParameters().sc, 'log');
  assert.deepEqual(pixelColor(displayRow, 0), intensityColor(128));
  assert.deepEqual(pixelColor(displayRow, 1), intensityColor(165));
  assert.ok(putCalls.length >= 5);

  plugin.setFrequencyScale('linear');
  plugin.setParameters({ sc: 'unsupported' });
  assert.equal(plugin.getParameters().sc, 'log');
  plugin.setFrequencyScale('linear');
  plugin.reset();
  assert.equal(plugin.getParameters().sc, 'log');

  const logMin = Math.log10(minFrequency);
  const logMax = Math.log10(maxFrequency);
  const canonicalFrequency = Math.pow(
    10,
    logMax - (20 / (cellCount - 1)) * (logMax - logMin)
  );
  plugin.dspSpectrogramActive = false;
  plugin.spectrogramBuffer.fill(-144);
  plugin.spectrogramBuffer.fill(-12, 20 * historyWidth, 22 * historyWidth);
  plugin.setFrequencyScale('linear');
  const legacyDisplayRow = (cellCount - 1) - Math.round(
    (cellCount - 1) *
      (canonicalFrequency - minFrequency) / (maxFrequency - minFrequency)
  );
  const legacyPixelOffset = legacyDisplayRow * historyWidth * 4;
  assert.ok(plugin.imageDataCache.data[legacyPixelOffset + 1] > 0);
  assert.equal(plugin.spectrogramBuffer[20 * historyWidth], -12);
  plugin.setFrequencyScale('log');
  assert.equal(plugin.getParameters().sc, 'log');
  assert.ok(plugin.imageDataCache.data[20 * historyWidth * 4 + 1] > 0);
});

test('Spectrogram synchronously copies v1 columns without running a main-thread FFT', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime, 42);
  const { putCalls } = installCanvasStubs(plugin);
  let fftCalls = 0;
  plugin.fft = () => { fftCalls++; };
  const { frame, payload } = makeSpectrogramFrame({
    sampleRate: 96000,
    timeSeconds: 1.25,
    intensity: row => row === 123 ? 254 : row
  });

  hub.emit(frame);
  payload.setUint8(12 + 123, 0);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 5);
  assert.equal(fftCalls, 0);
  assert.equal(plugin.sampleRate, 96000);
  assert.equal(plugin.dspSpectrogramActive, true);
  assert.equal(plugin.spectrogramWriteColumn, 1);
  assert.equal(plugin.spectrogramColumnCount, 1);
  assert.equal(plugin.spectrogramIntensityBuffer[123 * 1024], 254);
  assert.equal(putCalls.length, 2);
  assert.deepEqual(putCalls[1].slice(1), [0, 0, 0, 0, 1, 256]);
});

test('Spectrogram ring paints one physical column and draws wrapped history chronologically', () => {
  const hub = createHub();
  let now = 0;
  const runtime = loadSpectrogram({ hub, clock: { now: () => now } });
  const plugin = subscribedPlugin(runtime);
  const { drawCalls, putCalls } = installCanvasStubs(plugin);
  // Use an exactly representable hop so this test isolates ring wrap geometry.
  const period = 128 / 32768;
  for (let index = 0; index < 1026; index++) {
    now = index * period * 1000;
    hub.emit(makeSpectrogramFrame({
      sampleRate: 32768, timeSeconds: index * period, intensity: () => index % 256
    }).frame);
    if (index === 0) plugin.drawGraph();
  }
  assert.equal(plugin.spectrogramWriteColumn, 2);
  assert.equal(plugin.spectrogramColumnCount, 1024);
  assert.equal(putCalls.length, 1027);
  assert.equal(plugin.spectrogramIntensityBuffer[100 * 1024], 0);
  assert.equal(plugin.spectrogramIntensityBuffer[100 * 1024 + 1], 1);

  putCalls.length = 0;
  drawCalls.length = 0;
  plugin.drawGraph();
  assert.equal(putCalls.length, 0);
  assert.equal(drawCalls.length, 3);
  assert.deepEqual(drawCalls[0].slice(1), [2, 0, 1022, 256, 0, 0, 1022, 256]);
  assert.deepEqual(drawCalls[1].slice(1), [0, 0, 1, 256, 1022, 0, 1, 256]);
  assert.deepEqual(drawCalls[2].slice(1), [1, 0, 1, 256, 1023, 0, 1, 256]);

  plugin.setPoints(10);
  assert.equal(plugin.spectrogramWriteColumn, 0);
  assert.equal(plugin.spectrogramColumnCount, 0);
  assert.equal(plugin.spectrogramIntensityBuffer[100 * 1024], 0);
  assert.equal(plugin.scrollTime, null);
  assert.equal(putCalls.length, 1);
});

test('Spectrogram color LUT freezes the legacy seven-stop gradient', () => {
  const runtime = loadSpectrogram();
  const plugin = new runtime.SpectrogramPlugin();
  assert.equal(plugin.getParameters().cl, 'Heatmap');
  const expectedRgbaByIntensity = new Map([
    [0, [0, 0, 0, 255]],
    [42, [0, 0, 190, 255]],
    [85, [0, 191, 191, 255]],
    [128, [2, 191, 0, 255]],
    [170, [191, 190, 0, 255]],
    [212, [191, 2, 0, 255]],
    [255, [191, 191, 191, 255]]
  ]);
  for (const [intensity, expectedRgba] of expectedRgbaByIntensity) {
    assert.deepEqual(
      [...plugin.spectrogramColorLut.slice(intensity * 3, intensity * 3 + 3), 255],
      expectedRgba
    );
  }
});

test('Spectrogram recolors retained intensity with Normal and Heatmap only', () => {
  const runtime = loadSpectrogram();
  runtime.windowRef.ThemePalette = { get: role => role === 'graph-bg-deep'
    ? 'rgb(10, 20, 30)' : 'rgb(110, 120, 130)' };
  const plugin = new runtime.SpectrogramPlugin();
  installCanvasStubs(plugin);
  plugin.setColor('Normal');
  plugin.dspSpectrogramActive = true;
  const row = 128;
  const intensity = 128;
  plugin.spectrogramIntensityBuffer[row * 1024] = intensity;
  plugin.paintDspSpectrogramImage();
  const offset = row * 1024 * 4;
  const color = () => Array.from(plugin.imageDataCache.data.slice(offset, offset + 3));
  const normalColor = color();
  assert.deepEqual(normalColor, [60, 70, 80]);
  plugin.setColor('Heatmap');
  assert.deepEqual(color(), Array.from(plugin.constructor.getHeatmapLuts().rgb.slice(384, 387)));
  plugin.setColor('Rainbow');
  assert.equal(plugin.getParameters().cl, 'Heatmap');
  plugin.setColor('Normal');
  assert.deepEqual(color(), normalColor);
  assert.equal(plugin.spectrogramIntensityBuffer[row * 1024], intensity);
  assert.equal(plugin.getParameters().cl, 'Normal');
  plugin.reset();
  assert.equal(plugin.cl, 'Heatmap');
});

test('Spectrogram scrolls by elapsed render time between deliveries and aligns fresh data', () => {
  const hub = createHub();
  let now = 1000;
  const plugin = subscribedPlugin(loadSpectrogram({ hub, clock: { now: () => now } }));
  const { drawCalls, markerCalls, putCalls } = installCanvasStubs(plugin);
  const period = 2048 / 32768;
  const emit = timeSeconds => hub.emit(makeSpectrogramFrame({ sampleRate: 32768, points: 12, timeSeconds }).frame);
  const draw = timestamp => {
    drawCalls.length = 0;
    markerCalls.length = 0;
    plugin.drawGraph(timestamp);
    return { x: drawCalls[0][5], marker: markerCalls.at(-1) };
  };
  emit(1);
  const first = draw(now);
  for (const elapsed of [5, 21, 34, 49]) {
    // The rAF timestamp, not a later performance.now() read, positions the frame.
    now = 1000 + elapsed + 3;
    const current = draw(1000 + elapsed);
    assert.ok(Math.abs(first.x - current.x - elapsed / 1000 / period) < 1e-9);
    assert.ok(Math.abs(first.marker - current.marker - elapsed / 1000 / period) < 1e-9);
  }
  const before = draw(now);
  emit(1 + period);
  emit(1 + 2 * period);
  const received = draw(now);
  assert.ok(received.x < before.x);
  assert.deepEqual(draw(now), received);
  assert.equal(drawCalls.length, 2);
  assert.equal(drawCalls[0][3], 2);
  assert.equal(plugin.canvasCtx.imageSmoothingEnabled, true);
  // Resizing changes pixel scale, not the time represented by the history.
  plugin.canvas.width = 2048;
  const resized = draw(now);
  assert.equal(resized.x, received.x * 2);
  assert.equal(resized.marker, received.marker * 2);
  assert.equal(putCalls.length, 4);
});

test('Spectrogram anchors the initial batch to its newest column and preserves missing time intervals', () => {
  const hub = createHub();
  let now = 0;
  const plugin = subscribedPlugin(loadSpectrogram({ hub, clock: { now: () => now } }));
  const { drawCalls } = installCanvasStubs(plugin);
  const period = 128 / 32768;
  const emit = timeSeconds => hub.emit(makeSpectrogramFrame({ sampleRate: 32768, timeSeconds }).frame);
  emit(1);
  emit(1 + period);
  plugin.drawGraph();
  assert.equal(drawCalls[0][5], 1022);
  now = period * 4000;
  emit(1 + 5 * period);
  drawCalls.length = 0;
  plugin.drawGraph();
  assert.equal(drawCalls.length, 2);
  assert.equal(drawCalls[0][5], 1018);
  assert.equal(drawCalls[1][5], 1023);
  assert.equal(drawCalls[1][5] - (drawCalls[0][5] + drawCalls[0][7]), 3);
});

test('Spectrogram freezes while stopped and reanchors fresh data on resume or a timeline reset', () => {
  const hub = createHub();
  let now = 1000;
  const plugin = subscribedPlugin(loadSpectrogram({ hub, clock: { now: () => now } }));
  const { drawCalls } = installCanvasStubs(plugin);
  const emit = (timeSeconds, points = 8, sampleRate = 32768) => hub.emit(
    makeSpectrogramFrame({ timeSeconds, points, sampleRate }).frame
  );
  const x = () => { drawCalls.length = 0; plugin.drawGraph(); return drawCalls[0][5]; };
  emit(10);
  x();
  now += 20;
  plugin.stopAnimation();
  const frozen = x();
  now += 60000;
  assert.equal(x(), frozen);
  plugin.isVisible = true;
  plugin.startAnimation();
  emit(70);
  assert.equal(plugin.getSpectrogramDisplayTime(now), 70);
  assert.equal(x(), 1023);
  now += 10;
  assert.ok(x() < 1023);
  // A replacement audio context has a new time origin; old history must disappear.
  emit(0);
  assert.equal(plugin.spectrogramColumnCount, 1);
  assert.equal(x(), 1023);
  emit(0); // Equal f32 times remain finite and do not reset the stream.
  assert.equal(plugin.spectrogramColumnCount, 2);
  assert.ok(Number.isFinite(x()));
  emit(1, 10);
  assert.equal(plugin.spectrogramColumnCount, 1);
  assert.equal(plugin.spectrogramColumnPeriod, 512 / 32768);
  emit(2, 10, 48000);
  assert.equal(plugin.spectrogramColumnCount, 1);
  assert.equal(plugin.spectrogramColumnPeriod, 512 / 48000);
  plugin.stopAnimation();
});

test('Spectrogram rejects malformed and incompatible v1 payloads', () => {
  const runtime = loadSpectrogram();
  const plugin = new runtime.SpectrogramPlugin();
  const invalid = [
    makeSpectrogramFrame({ frameType: 4 }).frame,
    makeSpectrogramFrame({ version: 2 }).frame,
    makeSpectrogramFrame({ sampleRate: Number.NaN }).frame,
    makeSpectrogramFrame({ sampleRate: 0 }).frame,
    makeSpectrogramFrame({ timeSeconds: Number.POSITIVE_INFINITY }).frame,
    makeSpectrogramFrame({ cellCount: 255 }).frame,
    makeSpectrogramFrame({ points: 7 }).frame,
    makeSpectrogramFrame({ points: 15 }).frame,
    makeSpectrogramFrame({ trailingBytes: 1 }).frame,
    { frameType: 5, formatVersion: 1, payload: new Uint8Array(268) }
  ];
  for (const frame of invalid) {
    assert.equal(plugin.parseDspSpectrogramTelemetryFrame(frame), null);
  }
  const parsed = plugin.parseDspSpectrogramTelemetryFrame(makeSpectrogramFrame().frame);
  assert.equal(parsed.cellCount, 256);
  assert.equal(parsed.points, 8);
  assert.equal(parsed.intensities.length, 256);
});

test('Spectrogram retains processBuffer FFT and scroll behavior as fallback', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime);
  hub.emit(makeSpectrogramFrame().frame);
  assert.equal(plugin.dspSpectrogramActive, true);

  plugin.setPoints(8);
  const { drawCalls } = installCanvasStubs(plugin);
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
  assert.equal(plugin.dspSpectrogramActive, false);
  assert.equal(plugin.spectrum.length, 128);
  assert.match(plugin.processorString, /Float32Array\.from\(context\.buffer\[0\]\)/);
  assert.match(plugin.processorString, /bufferPosition % \(fftSize \/ 2\) === 0/);
  plugin.drawGraph(0);
  const firstX = drawCalls.at(-1)[5];
  drawCalls.length = 0;
  plugin.drawGraph(2);
  assert.equal(firstX - drawCalls[0][5], 0.5);
});

test('Spectrogram deduplicates, rebinds, and cleans up telemetry subscriptions', () => {
  const firstHub = createHub();
  const runtime = loadSpectrogram({ hub: firstHub });
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


test('Spectrogram keeps fresh data at the right edge after queued telemetry arrives on re-enable', () => {
  const hub = createHub();
  let now = 1000;
  const plugin = subscribedPlugin(loadSpectrogram({ hub, clock: { now: () => now } }));
  const { drawCalls } = installCanvasStubs(plugin);
  const emit = timeSeconds => hub.emit(makeSpectrogramFrame({ sampleRate: 32768, timeSeconds }).frame);
  const newestIsAtRightEdge = () => {
    drawCalls.length = 0;
    plugin.drawGraph();
    const latest = (plugin.spectrogramWriteColumn + 1023) % 1024;
    assert.ok(drawCalls.some(call => call[1] <= latest && latest < call[1] + call[3] &&
      Math.abs(call[5] + call[7] - plugin.canvas.width) < 1e-8),
    'the newest analysis column must reach the right edge');
  };
  emit(1);
  newestIsAtRightEdge();
  for (let cycle = 0; cycle < 3; cycle++) {
    plugin.stopAnimation();
    now += 5000;
    plugin.isVisible = true;
    plugin.startAnimation();
    emit(1 + cycle * 5 + 0.00390625); // A queued column arrives before current telemetry.
    plugin.drawGraph();
    emit(6 + cycle * 5);
    newestIsAtRightEdge();
    now += 17;
    newestIsAtRightEdge();
  }
  // Another effect can interrupt or retime telemetry without stopping this UI.
  now += 5000;
  newestIsAtRightEdge();
  assert.ok(plugin.getSpectrogramDisplayTime(now) - plugin.prevTime <= plugin.spectrogramColumnPeriod);
  emit(26);
  newestIsAtRightEdge();
});


test('Spectrogram round-trips Keyboard and normalizes it to true-only', () => {
  const runtime = loadSpectrogram();
  const plugin = new runtime.SpectrogramPlugin();
  assert.equal(plugin.getParameters().kb, false);
  plugin.setParameters({ kb: true });
  const restored = new runtime.SpectrogramPlugin();
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

test('Spectrogram keyboard cells project the existing frequency rows across the full display range', () => {
  const { SpectrogramPlugin } = loadSpectrogram();
  const plugin = new SpectrogramPlugin();
  for (const scale of ['log', 'linear']) {
    plugin.sc = scale;
    const keys = plugin.getKeyboardGeometry(512);
    assert.equal(keys[0].midi, 15);
    assert.equal(keys.at(-1).midi, 147);
    assert.equal(keys[0].end, 512);
    assert.equal(keys.at(-1).start, 0);
    assert.equal(keys.find(key => key.midi === 69).center, plugin.freqToY(440) / 255 * 512);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      for (const coordinate of [key.start, key.center, key.end]) {
        assert.ok(Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 512);
      }
      assert.ok(key.start <= key.center && key.center <= key.end);
      if (i) assert.equal(keys[i - 1].start, key.end);
    }
    const black = keys.find(key => key.midi === 70);
    assert.equal(black.black, true);
    assert.equal(black.start, plugin.freqToY(440 * 2 ** (1.5 / 12)) / 255 * 512);
    assert.equal(black.end, plugin.freqToY(440 * 2 ** (0.5 / 12)) / 255 * 512);
    if (scale === 'linear') assert.ok(keys[1].end - keys[1].start < 1);
  }
});

test('Spectrogram Keyboard keeps Note Spectrogram key colors in light and dark themes', () => {
  const themes = [
    {
      name: 'Paper',
      palette: {
        'graph-bg-deep': 'rgba(255, 255, 255, 1)',
        'graph-base-soft': 'rgba(241, 241, 241, 1)',
        'graph-label': 'rgba(102, 102, 102, 1)'
      },
      whiteKey: 'rgb(255, 255, 255)'
    },
    {
      name: 'Midnight',
      palette: {
        'graph-bg-deep': 'rgba(7, 11, 20, 1)',
        'graph-base-soft': 'rgba(25, 33, 51, 1)',
        'graph-label': 'rgba(125, 138, 163, 1)'
      },
      whiteKey: 'rgb(238, 238, 238)'
    }
  ];
  for (const theme of themes) {
    const runtime = loadSpectrogram();
    runtime.windowRef.ThemePalette = { get: name => theme.palette[name] ?? '' };
    const plugin = new runtime.SpectrogramPlugin();
    const { fillCalls, strokeCalls, operations } = installCanvasStubs(plugin);
    const width = 512;
    const height = 480;
    const gutter = 28;
    const edge = width - gutter;
    const blackDepth = 17.5;
    plugin.drawKeyboard(plugin.canvasCtx, width, height, gutter, blackDepth, 1, 12);

    assert.deepEqual(fillCalls[0], {
      x: edge, y: 0, width: gutter, height, fillStyle: theme.whiteKey
    }, theme.name + ' white keys');
    const blackKey = plugin.getKeyboardGeometry(height).find(key => key.midi === 70);
    assert.ok(fillCalls.some(call =>
      call.x === edge && call.y === blackKey.start && call.width === blackDepth &&
      call.height === blackKey.end - blackKey.start && call.fillStyle === 'rgb(17, 17, 17)'),
    theme.name + ' black keys');
    assert.ok(strokeCalls.some(call =>
      call.strokeStyle === theme.palette['graph-label'] && call.lineWidth === 1),
    theme.name + ' key boundaries');
    const octaveLabels = operations.filter(operation =>
      operation.type === 'fillText' && /^\d+$/.test(operation.text));
    assert.ok(octaveLabels.length >= 6, theme.name + ' octave labels');
    assert.ok(octaveLabels.every(label => label.y > 0 && label.y < height));
    assert.ok(octaveLabels.every(label => label.fillStyle === '#111'),
      theme.name + ' octave label fill');
    const outlinedLabels = operations.filter(operation => operation.type === 'strokeText');
    assert.deepEqual(outlinedLabels.map(label => label.text), octaveLabels.map(label => label.text),
      theme.name + ' outlined octave labels');
    assert.ok(outlinedLabels.every(label => label.strokeStyle === theme.whiteKey),
      theme.name + ' octave label outline');
  }
});

test('Spectrogram plot uses one fixed black-background palette before history is drawn', () => {
  const palettes = {
    Paper: {
      'graph-bg-deep': 'rgba(255, 255, 255, 1)',
      'graph-tone-50': 'rgba(138, 138, 138, 1)',
      'graph-label-strong': 'rgba(71, 71, 71, 1)',
      'text-primary': 'rgba(26, 26, 26, 1)',
      'graph-label': 'rgba(102, 102, 102, 1)'
    },
    Midnight: {
      'graph-bg-deep': 'rgba(7, 11, 20, 1)',
      'graph-tone-50': 'rgba(128, 133, 143, 1)',
      'graph-label-strong': 'rgba(205, 211, 222, 1)',
      'text-primary': 'rgba(230, 237, 247, 1)',
      'graph-label': 'rgba(125, 138, 163, 1)'
    }
  };
  let activeTheme = 'Paper';
  const runtime = loadSpectrogram();
  runtime.windowRef.ThemePalette = { get: name => palettes[activeTheme][name] ?? '' };
  const plugin = new runtime.SpectrogramPlugin();
  plugin.setColor('Heatmap');
  const { drawCalls, operations, fillCalls, strokeCalls } = installCanvasStubs(plugin);
  plugin.canvas.width = 512;
  plugin.canvas.height = 256;

  const keyboardDepth = runtime.windowRef.FrequencyAxis.keyboardDepths(256 / Math.log2(40000 / 20), 512).gutter;
  const verifyFixedPlotPalette = (expectedWidth, whiteKey = null) => {
    const plotWidth = expectedWidth - (whiteKey ? keyboardDepth : 0);
    assert.deepEqual(fillCalls[0], {
      x: 0, y: 0, width: plotWidth, height: 256, fillStyle: 'rgb(0, 0, 0)'
    });
    const frequencyLabels = operations.filter(operation =>
      operation.type === 'fillText' && operation.fillStyle === '#ccc');
    assert.equal(operations.find(operation =>
      operation.type === 'fillText' && operation.text === 'Time').fillStyle, '#fff');
    if (whiteKey) {
      assert.equal(frequencyLabels.length, 0);
      assert.equal(operations.some(operation =>
        operation.type === 'fillText' && operation.text === 'Frequency (Hz)'), false);
      assert.ok(strokeCalls.some(call => call.strokeStyle === '#444' && call.lineWidth === 1));
      assert.ok(fillCalls.some(call =>
        call.x === plotWidth && call.width === keyboardDepth && call.fillStyle === whiteKey));
    } else {
      assert.ok(strokeCalls.some(call => call.strokeStyle === '#888' && call.lineWidth === 1));
      assert.ok(frequencyLabels.length > 0);
      assert.equal(operations.find(operation =>
        operation.type === 'fillText' && operation.text === 'Frequency (Hz)').fillStyle, '#fff');
    }
    const graphLabels = operations.filter(operation =>
      operation.type === 'fillText' &&
      (operation.text === 'Time' || operation.text === 'Frequency (Hz)' ||
        operation.fillStyle === '#ccc'));
    const outlinedGraphLabels = operations.filter(operation =>
      operation.type === 'strokeText' && graphLabels.some(label =>
        label.text === operation.text && label.x === operation.x && label.y === operation.y));
    assert.deepEqual(
      outlinedGraphLabels.map(({ text, x, y }) => ({ text, x, y })),
      graphLabels.map(({ text, x, y }) => ({ text, x, y }))
    );
    assert.ok(outlinedGraphLabels.every(label =>
      label.strokeStyle === 'rgb(0, 0, 0)' &&
      label.lineWidth === 2 && label.lineJoin === 'round'));
  };

  plugin.drawGraph(0);
  verifyFixedPlotPalette(512);
  assert.equal(drawCalls.length, 0);

  plugin.kb = true;
  operations.length = 0;
  fillCalls.length = 0;
  strokeCalls.length = 0;
  plugin.drawGraph(0);
  verifyFixedPlotPalette(512, 'rgb(255, 255, 255)');

  plugin.handleDspSpectrogramTelemetry(makeSpectrogramFrame({
    timeSeconds: 1,
    intensity: () => 0
  }).frame);
  drawCalls.length = 0;
  operations.length = 0;
  fillCalls.length = 0;
  strokeCalls.length = 0;
  plugin.drawGraph(0);
  verifyFixedPlotPalette(512, 'rgb(255, 255, 255)');
  assert.ok(drawCalls.length > 0);
  assert.ok(strokeCalls.some(call => call.strokeStyle === '#888' && call.lineWidth === 2));
  assert.ok(operations.findIndex(operation => operation.type === 'fillRect') <
    operations.findIndex(operation => operation.type === 'drawImage'));
  assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(0, 3)), [0, 0, 0]);

  activeTheme = 'Midnight';
  plugin.canvas.width = 768;
  drawCalls.length = 0;
  operations.length = 0;
  fillCalls.length = 0;
  strokeCalls.length = 0;
  plugin.drawGraph(0);
  verifyFixedPlotPalette(768, 'rgb(238, 238, 238)');
});

test('Spectrogram Keyboard replaces the frequency axis with B-C boundary lines', () => {
  const minFrequency = 20;
  const maxFrequency = 40000;
  const minMidi = 69 + 12 * Math.log2(minFrequency / 440);
  const maxMidi = 69 + 12 * Math.log2(maxFrequency / 440);
  for (const scale of ['log', 'linear']) {
    for (const dpr of [1, 2]) {
      const { SpectrogramPlugin, windowRef } = loadSpectrogram();
      const plugin = new SpectrogramPlugin();
      const { operations, lineCalls } = installCanvasStubs(plugin);
      plugin.sc = scale;
      plugin.graphDpr = dpr;
      plugin.canvas.width = 1024 * dpr;
      plugin.canvas.height = 1024 * dpr;

      plugin.drawGraph(0);
      assert.ok(operations.some(operation =>
        operation.type === 'fillText' && operation.text === 'Frequency (Hz)'));
      assert.ok(operations.some(operation =>
        operation.type === 'fillText' && operation.fillStyle === '#ccc'));
      assert.equal(lineCalls.some(call => call.strokeStyle === '#444'), false);

      operations.length = 0;
      lineCalls.length = 0;
      plugin.kb = true;
      plugin.drawGraph(0);
      const plotWidth = 1024 * dpr -
        windowRef.FrequencyAxis.keyboardDepths(1024 * dpr / Math.log2(maxFrequency / minFrequency), 1024 * dpr).gutter;
      const boundaryLines = lineCalls.filter(call =>
        call.from.x === 0 && call.to.x === plotWidth && call.from.y === call.to.y);
      const expectedBoundaries = pitchClass => {
        const positions = [];
        for (let midi = Math.ceil(minMidi); midi <= Math.floor(maxMidi); midi++) {
          if ((midi % 12 + 12) % 12 !== pitchClass) continue;
          const boundaryFrequency = 440 * 2 ** ((midi - 0.5 - 69) / 12);
          positions.push(plugin.freqToY(boundaryFrequency) / 255 * plugin.canvas.height);
        }
        return positions;
      };

      assert.equal(operations.some(operation =>
        operation.type === 'fillText' && operation.text === 'Frequency (Hz)'), false);
      assert.equal(operations.some(operation =>
        operation.type === 'fillText' && operation.fillStyle === '#ccc'), false);
      const bCBoundaries = expectedBoundaries(0);
      const eFBoundaries = expectedBoundaries(5);
      assert.ok(eFBoundaries.length > 0);
      assert.deepEqual(boundaryLines.map(call => call.from.y), bCBoundaries);
      assert.ok(boundaryLines.every(call => call.strokeStyle === '#444'));
      assert.equal(boundaryLines.length, bCBoundaries.length);
      assert.ok(boundaryLines.every(call => call.lineWidth === dpr));
      assert.ok(operations.some(operation =>
        operation.type === 'fillText' && operation.text === 'Time'));
    }
  }
});

test('Spectrogram Keyboard scales history, grid, clock and labels to the same plot width', () => {
  const runtime = loadSpectrogram();
  runtime.windowRef.ThemePalette = { get: name =>
    name === 'graph-bg-deep' ? 'rgb(16, 16, 16)' : 'rgb(48, 48, 48)' };
  for (const dpr of [1, 2]) {
    for (const sc of ['log', 'linear']) {
      const plugin = new runtime.SpectrogramPlugin();
      const { drawCalls, markerCalls, operations } = installCanvasStubs(plugin);
      plugin.sc = sc;
      plugin.graphDpr = dpr;
      plugin.canvas.width = 1024 * dpr;
      plugin.canvas.height = 1024 * dpr;
      const width = plugin.canvas.width;
      const height = plugin.canvas.height;
      const { gutter, blackDepth } =
        runtime.windowRef.FrequencyAxis.keyboardDepths(height / Math.log2(40000 / 20), width);
      const plotWidth = width - gutter;
      plugin.handleDspSpectrogramTelemetry(makeSpectrogramFrame({ timeSeconds: 1 }).frame);
      plugin.handleDspSpectrogramTelemetry(makeSpectrogramFrame({ timeSeconds: 1.125 }).frame);
      const times = Array.from(plugin.spectrogramColumnTimes);
      plugin.drawGraph(0);
      const fullImages = drawCalls.splice(0);
      const fullMarkers = markerCalls.splice(0);
      operations.length = 0;
      plugin.kb = true;
      plugin.drawGraph(0);
      assert.equal(drawCalls.length, fullImages.length);
      drawCalls.forEach((image, index) => {
        assert.ok(Math.abs(image[5] - fullImages[index][5] * plotWidth / width) < 1e-9);
        assert.ok(Math.abs(image[7] - fullImages[index][7] * plotWidth / width) < 1e-9);
        assert.ok(image[5] + image[7] <= plotWidth + 1e-9);
      });
      const latest = drawCalls.at(-1);
      assert.ok(Math.abs(latest[5] + latest[7] - plotWidth) < 1e-9);
      markerCalls.forEach((x, index) => assert.ok(Math.abs(x - fullMarkers[index] * plotWidth / width) < 1e-9));
      assert.deepEqual(operations.find(operation => operation.type === 'rect'),
        { type: 'rect', x: 0, y: 0, width: plotWidth, height });
      const base = operations.find(operation => operation.type === 'fillRect');
      assert.deepEqual(base, { type: 'fillRect', x: 0, y: 0, width: plotWidth, height });
      assert.ok(operations.some(operation => operation.type === 'fillRect' &&
        operation.x === plotWidth && operation.y === 0 && operation.width === gutter && operation.height === height));
      const timeLabel = operations.find(operation => operation.type === 'fillText' && operation.text === 'Time');
      assert.equal(timeLabel.x, plotWidth / 2);
      assert.equal(operations.some(operation =>
        operation.type === 'fillText' && operation.text === 'Frequency (Hz)'), false);
      assert.equal(operations.some(operation =>
        operation.type === 'fillText' && operation.fillStyle === '#ccc'), false);
      const octaveLabels = operations.filter(operation =>
        operation.type === 'fillText' && /^\d+$/.test(operation.text) && operation.x > plotWidth);
      assert.ok(octaveLabels.length > 0);
      assert.ok(octaveLabels.every(label =>
        label.x > plotWidth && label.x < width && label.y > 0 && label.y < height));
      assert.equal(operations.some(operation =>
        (operation.type === 'fillText' || operation.type === 'strokeText') && /^C\d+$/.test(operation.text)), false);
      const outlinedLabels = operations.filter(operation =>
        operation.type === 'strokeText' && /^\d+$/.test(operation.text) && operation.x > plotWidth);
      assert.deepEqual(outlinedLabels.map(({ text, x, y }) => ({ text, x, y })),
        octaveLabels.map(({ text, x, y }) => ({ text, x, y })));
      assert.ok(outlinedLabels.every(label =>
        label.strokeStyle === 'rgb(238, 238, 238)' &&
        label.lineWidth === 1.5 * dpr && label.lineJoin === 'round'));
      assert.ok(octaveLabels.length >= 6);
      const frequencyFont = `${(plugin.graphCssWidth < 500 ? 11 : 12) * dpr}px Arial`;
      assert.ok(octaveLabels.every(label => label.font === frequencyFont));
      assert.ok(outlinedLabels.every(label => label.font === frequencyFont));
      assert.ok(outlinedLabels.every(label => label.textAlign === 'right'));
      assert.equal(new Set(outlinedLabels.map(label => label.x)).size, 1);
      const octaveNumbers = new Set(outlinedLabels.map(label => label.text));
      assert.ok(octaveNumbers.has('10') && octaveNumbers.has('11'));
      if (sc === 'log') {
        assert.deepEqual(Array.from(octaveNumbers).sort((left, right) => Number(left) - Number(right)),
          Array.from({ length: 11 }, (_, index) => String(index + 1)));
      }
      const oneDigit = outlinedLabels.find(label => label.text === '9');
      const twoDigits = outlinedLabels.find(label => label.text === '10');
      const fontSize = parseFloat(frequencyFont);
      const oneDigitWidth = fontSize * 0.65;
      const previousCenter = plotWidth + blackDepth + (gutter - blackDepth) / 2;
      assert.ok(Math.abs(oneDigit.x - oneDigitWidth / 2 - previousCenter) <= dpr);
      assert.ok(width - (oneDigit.x + oneDigit.lineWidth / 2) >= dpr);
      assert.ok(twoDigits.x - 2 * oneDigitWidth - twoDigits.lineWidth / 2 <
        oneDigit.x - oneDigitWidth - oneDigit.lineWidth / 2);
      assert.deepEqual(operations.find(operation => operation.type === 'rect' && operation.x === plotWidth),
        { type: 'rect', x: plotWidth, y: 0, width: gutter, height });
      const keys = plugin.getKeyboardGeometry(height);
      assert.ok(outlinedLabels.every(label => {
        const key = keys.find(item => item.midi === (Number(label.text) + 1) * 12);
        return key && label.y === (key.whiteStart + key.whiteEnd) / 2;
      }));
      const black = plugin.getKeyboardGeometry(height).find(key => key.midi === 70);
      assert.ok(operations.some(operation => operation.type === 'fillRect' &&
        operation.x === plotWidth && operation.y === black.start && operation.width === blackDepth &&
        operation.height === black.end - black.start));
      assert.deepEqual(Array.from(plugin.spectrogramColumnTimes), times);

      operations.length = 0;
      plugin.canvas.width = 28 * dpr;
      plugin.drawGraph(0);
      // A narrow graph caps the keyboard at half its width instead of dropping it.
      assert.equal(operations.find(operation => operation.type === 'fillText' && operation.text === 'Time').x, 7 * dpr);
    }
  }
});
