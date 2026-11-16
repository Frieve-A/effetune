import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import '../../plugins/multires-spectrum.js';

function load() {
  const calls = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 7 }) }, {
    get(target, key) { return target[key] ?? ((...args) => calls.push([key, ...args])); },
    set(target, key, value) { target[key] = value; calls.push(['set', key, value]); return true; }
  });
  const element = tag => ({ tag, children: [], style: {}, appendChild(child) { this.children.push(child); },
    setAttribute() {}, width: 640, height: 640, getContext: () => context });
  const controls = [];
  const subscriptions = [];
  class PluginBase {
    constructor() { this.enabled = true; this._sectionEnabled = true; }
    registerProcessor(code) { this.processor = code; }
    updateParameters() {}
    cleanup() {}
    _setupMessageHandler() {}
    canRunAnimation() { return true; }
    requestPowerAnimationFrame() { return 1; }
    parseFiniteNumber(value, low, high, fallback) {
      return Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
    }
    createRadioGroup(...args) { controls.push(['radio', ...args]); return element('div'); }
    createParameterControl(...args) { controls.push(['slider', ...args]); return element('div'); }
    createResponsiveGraph(options) {
      controls.push(['graph', options]);
      const canvas = element('canvas');
      options.onResize({ canvas, dpr: 1 });
      return { canvas, container: element('div'), dispose() { calls.push(['dispose']); } };
    }
  }
  const sandbox = { PluginBase, Float32Array, Math, console, MultiresSpectrum: globalThis.MultiresSpectrum,
    document: { createElement: element }, cancelAnimationFrame: id => calls.push(['cancel', id]),
    window: { ThemePalette: { get: name => `theme:${name}` }, dspTelemetryHub: {
      port: {}, subscribe(...args) { subscriptions.push(args); return () => calls.push(['unsubscribe']); }
    } } };
  vm.createContext(sandbox);
  for (const name of ['note_spectrogram', 'chroma_spiral']) {
    vm.runInContext(fs.readFileSync(new URL(`../../plugins/analyzer/${name}.js`, import.meta.url), 'utf8'), sandbox);
  }
  return { Plugin: sandbox.window.ChromaSpiralPlugin, Note: sandbox.window.NoteSpectrogramPlugin,
    sandbox, calls, controls, subscriptions };
}

function snapshot() {
  return { minFrequency: 20, maxFrequency: 40000, cellCount: 2048, firstValidIndex: 0,
    validCellCount: 2048, current: new Float32Array(2048).fill(-240) };
}

test('display hooks hide auxiliary graphics independently and keep the native data drawing', () => {
  const { Plugin, calls } = load();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.display = [{ midi: 60, level: -12 }, { midi: 61, level: -18 }];
  plugin.levelReference = -12;
  let signals = 0;
  const text = [];
  plugin.displayOptions = {
    transparent: true, showAxes: false, showAxisNumbers: false,
    themePalette: { get: role => `override:${role}` },
    noteColor: () => [20, 40, 60], spiralFillStyle: () => 'palette-fill',
    drawSignal(context, draw) { signals++; draw(context); },
    textContext: { fillText: (...args) => text.push(args) }
  };
  calls.length = 0;
  plugin.drawGraph();
  assert.equal(signals, 1);
  assert.equal(calls.filter(call => call[0] === 'arc').length, 2);
  assert.ok(calls.some(call => call[0] === 'clearRect'));
  assert.ok(!calls.some(call => ['fillRect', 'stroke', 'fillText'].includes(call[0])));
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'fillStyle' && call[2] === 'rgb(20,40,60)'));
  plugin.displayOptions.showAxisNumbers = true;
  plugin.drawGraph();
  assert.ok(text.some(([label]) => label === 'C'));
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'fillStyle' && call[2] === 'override:graph-label'));
  plugin.displayOptions.showAxes = true;
  plugin.displayOptions.deferDraw = true;
  plugin.setParameters({ dm: 1 });
  assert.equal(signals, 2, 'parameter update does not advance a host-managed draw');
  calls.length = 0;
  plugin.drawGraph();
  assert.equal(calls.filter(call => call[0] === 'stroke').length, 2);
  assert.equal(calls.filter(call => call[0] === 'arc').length, 0);
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'fillStyle' && call[2] === 'palette-fill'));
  delete plugin.displayOptions;
  calls.length = 0;
  plugin.drawGraph();
  assert.ok(calls.some(call => call[0] === 'fillRect'));
  assert.ok(calls.some(call => call[0] === 'fillText'));
  assert.equal(calls.filter(call => call[0] === 'stroke').length, 2);
  plugin.cleanup();
});

test('Visualizer Heatmap colors Chroma dots and adjacent fill sections by their normalized strength', () => {
  const { Plugin, calls } = load();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.display = [{ midi: 60, level: -12 }, { midi: 61, level: -18 }, { midi: 62, level: -24 }];
  plugin.levelReference = -12;
  const intensities = [];
  plugin.displayOptions = { showAxes: false, showAxisNumbers: false,
    signalColor(_midi, intensity) {
      intensities.push(intensity);
      return { alpha: intensity, css: `rgba(255,0,0,${intensity})` };
    } };
  plugin.dm = 0;
  plugin.drawGraph();
  assert.equal(intensities.length, 3);
  assert.equal(calls.filter(call => call[0] === 'arc').length, 3);
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'fillStyle' && call[2].startsWith('rgba(255,0,0,')));
  calls.length = 0; intensities.length = 0;
  plugin.dm = 1;
  plugin.drawGraph();
  assert.equal(intensities.length, 2, 'Three existing data points produce two fill quads');
  assert.equal(calls.filter(call => call[0] === 'fill').length, 2);
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'fillStyle' && call[2].startsWith('rgba(255,0,0,')));
  assert.ok(intensities[0] > intensities[1], 'Each section uses adjacent cell strengths');
  plugin.cleanup();
});

test('Chroma parameters clamp the edited octave and use the standard square UI', () => {
  const { Plugin, controls, subscriptions, calls } = load();
  const plugin = new Plugin();
  plugin.id = 77;
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())),
    { type: 'ChromaSpiralPlugin', enabled: true, dm: 0, lo: 1, hi: 7, ft: 3, lr: 24, df: -60 });
  plugin.setParameters({ lo: 8 });
  assert.equal(plugin.hi, 8);
  plugin.setParameters({ hi: 1 });
  assert.equal(plugin.lo, 1);
  plugin.setParameters({ lo: -20, hi: 40, dm: 1 });
  assert.equal(plugin.lo, 1);
  assert.equal(plugin.hi, 9);
  plugin.setParameters({ dm: 3 });
  assert.equal(plugin.dm, 1);
  for (const dm of [0, 1, 2]) {
    plugin.setParameters({ dm });
    const restored = new Plugin();
    restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
    assert.equal(restored.dm, dm);
  }
  plugin.reset();
  assert.equal(plugin.dm, 0);
  assert.deepEqual([plugin.lo, plugin.hi], [1, 7]);
  const ui = plugin.createUI();
  assert.equal(ui.children.at(-1).style.margin, '1rem auto 0');
  assert.equal(controls.filter(c => c[0] === 'radio').length, 1);
  const colorControl = controls.find(c => c[0] === 'radio');
  assert.equal(colorControl[1], 'Color');
  assert.deepEqual(JSON.parse(JSON.stringify(colorControl[2])),
    [{ value: 0, label: 'Normal' }, { value: 1, label: 'Normal 2' }, { value: 2, label: 'Note Colors' }]);
  assert.equal(colorControl[3], 0);
  colorControl[4]('2');
  assert.equal(plugin.dm, 2);
  assert.equal(controls.filter(c => c[0] === 'slider').length, 5);
  assert.equal(controls.find(c => c[0] === 'slider' && c[1] === 'Highest Octave')[5], 7);
  assert.deepEqual(controls.filter(c => c[0] === 'slider').slice(2).map(c => [...c.slice(1, 6), c[7], c[8]]), [
    ['Frequency Tilt', -6, 6, 0.5, 3, 'dB/oct', 'ft'],
    ['Level Range', 6, 96, 1, 24, 'dB', 'lr'],
    ['Display Floor', -120, -24, 1, -60, 'dB', 'df']
  ]);
  const graph = controls.find(c => c[0] === 'graph')[1];
  assert.equal(graph.aspectRatio, '1 / 1');
  assert.equal(graph.mobileAspectRatio, '1 / 1');
  assert.deepEqual(subscriptions.map(s => s.slice(0, 2)), [[77, 4]]);
  plugin.cleanup();
  assert.ok(calls.some(call => call[0] === 'unsubscribe'));
  assert.ok(calls.some(call => call[0] === 'dispose'));
});

test('shared normalization keeps its hold, release, floor, and octave energy correction', () => {
  const { Plugin, Note } = load();
  assert.equal(Plugin.octaveCorrection(50), 0);
  assert.equal(Plugin.octaveCorrection(100), 0);
  assert.equal(Plugin.octaveCorrection(800), 9);
  const state = { levelReference: Note.levelFloor, levelReferenceHold: 0 };
  Note.updateLevelReference(state, -12, 0.1);
  Note.updateLevelReference(state, -80, 0.9);
  assert.equal(state.levelReference, -12);
  Note.updateLevelReference(state, -80, 0.6);
  assert.ok(Math.abs(state.levelReference + 22) < 1e-12);
  assert.equal(Note.normalizedLevel(-48, -80), 0.5);
  assert.equal(Note.normalizedLevel(0, -12), 1);
  assert.equal(Note.normalizedLevel(-240, -12), 0);
  const plugin = new Plugin();
  const frame = snapshot();
  const index = Math.round(Math.log(440 / 20) / Math.log(2000) * 2047);
  frame.current[index] = -18;
  plugin.updateDisplay(frame, 0.1);
  const expected = Math.max(...plugin.display.map(cell => cell.level));
  assert.equal(plugin.levelReference, expected);
  assert.equal(Note.normalizedLevel(expected, plugin.levelReference), 1);
});

test('Normal preserves distinct valid frequency cells within one semitone and their brightness', () => {
  const { Plugin, Note, calls } = load();
  const frame = snapshot();
  const index = Math.round(Math.log(440 / 20) / Math.log(2000) * 2047);
  frame.firstValidIndex = index;
  frame.validCellCount = 2;
  frame.current[index - 1] = 0;
  frame.current[index] = -20;
  frame.current[index + 1] = -10;
  frame.current[index + 2] = 0;
  const cells = Plugin.spectrumCells(frame, 4, 4);
  assert.equal(cells.length, 2);
  assert.equal(Math.round(cells[0].midi), 69);
  assert.equal(Math.round(cells[1].midi), 69);
  assert.notEqual(cells[0].midi, cells[1].midi);
  const plugin = new Plugin();
  plugin.setParameters({ lo: 4, hi: 4 });
  plugin.updateDisplay(frame, 0.1);
  plugin.createUI();
  calls.length = 0;
  plugin.drawGraph();
  const dots = calls.filter(call => call[0] === 'arc');
  assert.equal(dots.length, 2);
  assert.notEqual(dots[0][1], dots[1][1]);
  const alpha = calls.filter(call => call[0] === 'set' && call[1] === 'globalAlpha');
  assert.deepEqual(alpha.map(call => call[2]),
    [...cells.map(cell => Note.normalizedLevel(cell.level, plugin.levelReference)), 1]);
  assert.ok(alpha[0][2] < alpha[1][2]);
  plugin.cleanup();
});

test('dot area follows normalized volume from zero to a radius of half the turn spacing', () => {
  const { Plugin, calls } = load();
  const plugin = new Plugin();
  plugin.createUI();
  for (const [size, dpr, lo, hi] of [[640, 1, 4, 4], [320, 1, 1, 7], [640, 2, 1, 7]]) {
    plugin.setParameters({ lo, hi });
    plugin.canvas.width = plugin.canvas.height = size;
    plugin.graphDpr = dpr;
    plugin.display = [0, -12, -18, -24].map((level, index) => ({ midi: 69 + index * 0.06, level }));
    plugin.levelReference = 0;
    calls.length = 0;
    plugin.drawGraph();
    const dots = calls.filter(call => call[0] === 'arc');
    assert.equal(dots.length, 3, 'zero normalized level has zero area and is not drawn');
    const outer = size / 2;
    const inner = Math.max(14 * dpr, outer * 0.1);
    const pitch = (outer - inner) / (hi - lo + 2);
    assert.equal(dots[0][3], pitch / 2);
    const maximumArea = Math.PI * (pitch / 2) ** 2;
    for (const [index, intensity] of [1, 0.5, 0.25].entries()) {
      assert.ok(Math.abs(Math.PI * dots[index][3] ** 2 / maximumArea - intensity) < 1e-12);
    }
    assert.ok(dots.every(dot => dot[3] <= pitch / 2));
  }
  plugin.cleanup();
});

test('Normal 2 fills cell endpoints back along the spiral baseline without a data contour stroke', () => {
  const { Plugin, Note, calls } = load();
  const frame = snapshot();
  const index = Math.round(Math.log(440 / 20) / Math.log(2000) * 2047);
  frame.firstValidIndex = index;
  frame.validCellCount = 3;
  frame.current[index] = -30;
  frame.current[index + 1] = -20;
  frame.current[index + 2] = -10;
  const plugin = new Plugin();
  plugin.setParameters({ dm: 1, lo: 4, hi: 4 });
  plugin.updateDisplay(frame, 0.1);
  plugin.createUI();
  calls.length = 0;
  plugin.drawGraph();
  const fillIndex = calls.findIndex(call => call[0] === 'fill');
  const fillStart = calls.findLastIndex((call, i) => i < fillIndex && call[0] === 'beginPath');
  const fillPath = calls.slice(fillStart, fillIndex).filter(call => ['moveTo', 'lineTo', 'closePath'].includes(call[0]));
  const contour = fillPath.slice(0, 3);
  assert.equal(calls.slice(fillIndex).filter(call => call[0] === 'stroke').length, 0);
  assert.equal(calls.filter(call => call[0] === 'stroke').length, 2, 'radial and spiral guides are stroked');
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'fillStyle' && call[2] === 'theme:graph-trace'));
  assert.equal(contour.length, 3);
  assert.equal(contour.filter(call => call[0] === 'moveTo').length, 1);
  assert.equal(fillPath.at(-1)[0], 'closePath');
  assert.equal(fillPath.length, 7);
  const inner = 640 / 2 * 0.1;
  const pitch = (640 / 2 - inner) / 2;
  for (let i = 0; i < 3; i++) {
    const cell = plugin.display[i];
    const base = Plugin.spiralPoint(cell.midi, 60, inner, pitch);
    const length = Note.normalizedLevel(cell.level, plugin.levelReference) * pitch;
    assert.ok(Math.abs(contour[i][1] - (base.x + Math.sin(base.angle) * length)) < 1e-9);
    assert.ok(Math.abs(contour[i][2] - (base.y - Math.cos(base.angle) * length)) < 1e-9);
    assert.deepEqual(fillPath[5 - i], ['lineTo', base.x, base.y]);
  }
  assert.equal(calls.filter(call => call[0] === 'arc').length, 0);
  plugin.levelReference += 10;
  plugin.levelReferenceHold = 0.7;
  const reference = plugin.levelReference;
  plugin.snapshot = frame;
  plugin.setParameters({ dm: 0 });
  assert.equal(plugin.levelReference, reference);
  assert.equal(plugin.levelReferenceHold, 0.7);
  plugin.cleanup();
});

test('spiral has C above center and moves clockwise outward by one pitch each octave', () => {
  const { Plugin } = load();
  const c = Plugin.spiralPoint(60, 60, 20, 30);
  const sharp = Plugin.spiralPoint(61, 60, 20, 30);
  const next = Plugin.spiralPoint(72, 60, 20, 30);
  assert.equal(c.x, 0);
  assert.equal(c.y, -20);
  assert.ok(sharp.x > 0 && sharp.y < 0);
  assert.equal(sharp.radius, 22.5);
  assert.equal(next.radius, 50);
  assert.ok(Math.abs(next.x) < 1e-12);
});

test('automatic FFT points follow sample rate and stop at the supported limit', () => {
  const { Plugin } = load();
  for (const [rate, points] of [[44100, 13], [48000, 13], [88200, 14], [96000, 14], [192000, 14]]) {
    assert.equal(Plugin.automaticPoints(rate), points);
  }
});

test('Chroma receiver rejects duplicate, wrong-size, and previous producer frames', () => {
  const { Plugin, sandbox } = load();
  const plugin = new Plugin();
  plugin.id = 7;
  plugin.getParameters();
  const port = sandbox.window.dspTelemetryHub.port;
  const payload = new DataView(new ArrayBuffer(48 + 2048 * 8));
  payload.setFloat32(0, 48000, true);
  payload.setUint16(4, 13, true);
  payload.setUint32(8, 4096, true);
  payload.setUint32(12, 1, true);
  payload.setUint32(16, 40000, true);
  payload.setUint32(28, 2048, true);
  payload.setFloat32(32, 20, true);
  payload.setFloat32(36, 40000, true);
  const valid = Array.from({ length: 2048 }, (_, i) => 20 * Math.exp(i * Math.log(2000) / 2047))
    .filter(hz => hz <= 24000).length;
  payload.setUint32(44, valid, true);
  for (let i = 0; i < 4096; i++) payload.setFloat32(48 + i * 4, -80, true);
  const frame = { frameType: 4, formatVersion: 2, payload };
  plugin.handleTelemetry(frame, port);
  const first = plugin.snapshot;
  assert.ok(first);
  plugin.handleTelemetry(frame, port);
  assert.equal(plugin.snapshot, first);
  payload.setUint32(24, 1, true);
  plugin.handleTelemetry(frame, {});
  assert.equal(plugin.snapshot, first);
  payload.setUint16(4, 12, true);
  payload.setUint32(8, 2048, true);
  plugin.handleTelemetry(frame, port);
  assert.equal(plugin.snapshot, first);
  payload.setUint16(4, 13, true);
  payload.setUint32(8, 4096, true);
  plugin.handleTelemetry(frame, port);
  assert.notEqual(plugin.snapshot, first);
  plugin.enabled = false;
  payload.setUint32(24, 2, true);
  plugin.handleTelemetry(frame, port);
  assert.equal(plugin.snapshot.frameIndex, 1);
});

test('Chroma graph remains drawable before the optional theme palette is available', () => {
  const { Plugin, sandbox, calls } = load();
  delete sandbox.window.ThemePalette;
  const plugin = new Plugin();
  assert.doesNotThrow(() => plugin.createUI());
  assert.ok(calls.some(call => call[0] === 'fillRect'));
  plugin.cleanup();
});

test('silent Normal 2 collapses its fill to the baseline and preserves the same guides as both dot colors', () => {
  const { Plugin, calls } = load();
  const plugin = new Plugin();
  plugin.setParameters({ dm: 1, lo: 4, hi: 4 });
  plugin.updateDisplay(snapshot(), 0.1);
  plugin.createUI();
  calls.length = 0;
  plugin.drawGraph();
  assert.equal(calls.filter(call => call[0] === 'stroke').length, 2);
  const fillIndex = calls.findIndex(call => call[0] === 'fill');
  const fillStart = calls.findLastIndex((call, i) => i < fillIndex && call[0] === 'beginPath');
  const points = calls.slice(fillStart, fillIndex)
    .filter(call => call[0] === 'moveTo' || call[0] === 'lineTo').map(call => call.slice(1));
  assert.equal(points.length, plugin.display.length * 2);
  assert.deepEqual(points.slice(0, plugin.display.length), points.slice(plugin.display.length).reverse());
  const pathOperations = call => ['beginPath', 'moveTo', 'lineTo', 'stroke'].includes(call[0]);
  const areaGuides = calls.slice(0, fillStart).filter(pathOperations);
  for (const dm of [0, 2]) {
    plugin.setParameters({ dm });
    calls.length = 0;
    plugin.drawGraph();
    assert.deepEqual(calls.filter(pathOperations), areaGuides);
  }
  plugin.cleanup();
});

test('display normalization controls restore presets, clamp finite inputs and reset to the original defaults', () => {
  const { Plugin } = load();
  const plugin = new Plugin();
  plugin.setParameters({ ft: -2.5, lr: 48, df: -84, dm: 2 });
  const restored = new Plugin();
  restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
  assert.deepEqual(restored.getParameters(), plugin.getParameters());
  plugin.setParameters({ ft: NaN, lr: Infinity, df: 'invalid' });
  assert.deepEqual([plugin.ft, plugin.lr, plugin.df], [-2.5, 48, -84]);
  plugin.setParameters({ ft: -99, lr: -1, df: -999 });
  assert.deepEqual([plugin.ft, plugin.lr, plugin.df], [-6, 6, -120]);
  plugin.setParameters({ ft: 99, lr: 999, df: 0 });
  assert.deepEqual([plugin.ft, plugin.lr, plugin.df], [6, 96, -24]);
  plugin.reset();
  assert.deepEqual([plugin.dm, plugin.ft, plugin.lr, plugin.df], [0, 3, 24, -60]);
});

test('shared normalization defaults match the original Note Spectrogram formula exactly', () => {
  const { Note } = load();
  for (const reference of [-240, -80, -36, -35.123, -12, 0]) {
    for (const level of [-240, -80, -60, -48, -36, -35.123, -12, 0]) {
      const upper = Math.max(reference, -36);
      const expected = Math.max(0, Math.min(1, (level - (upper - 24)) / 24));
      assert.equal(Note.normalizedLevel(level, reference), expected);
      assert.equal(Note.normalizedLevel(level, reference, 24, -60), expected);
    }
  }
  assert.equal(Note.normalizedLevel(-48, -80, 48, -60), 0.25);
  assert.equal(Note.normalizedLevel(-48, -80, 24, -72), 1);
  assert.equal(Note.normalizedLevel(-24, -12, 24, -60), 0.5);
});

test('Frequency Tilt reprocesses the current spectrum and resets the reference when tilt or octave changes', () => {
  const { Plugin } = load();
  const plugin = new Plugin();
  const frame = { minFrequency: 100, maxFrequency: 800, cellCount: 4, firstValidIndex: 0,
    validCellCount: 4, current: new Float32Array(4).fill(-30) };
  plugin.snapshot = frame;
  plugin.updateDisplay(frame, 0.1);
  assert.deepEqual(Array.from(plugin.display, cell => cell.level), [-30, -27, -24, -21]);
  for (const [ft, expected] of [[0, [-30, -30, -30, -30]], [-3, [-30, -33, -36, -39]], [6, [-30, -24, -18, -12]]]) {
    plugin.setParameters({ ft });
    plugin.display.forEach((cell, index) => assert.ok(Math.abs(cell.level - expected[index]) < 1e-12));
    assert.ok(Math.abs(plugin.levelReference - Math.max(...expected)) < 1e-12);
    assert.equal(plugin.levelReferenceHold, 1);
  }
  plugin.setParameters({ hi: 2 });
  assert.equal(plugin.display.length, 1);
  assert.equal(plugin.levelReference, -30);
  assert.equal(Plugin.octaveCorrection(50, 6), 0);
  assert.equal(Math.abs(Plugin.octaveCorrection(100, -6)), 0);
  assert.deepEqual([...frame.current], [-30, -30, -30, -30]);
});

test('Level Range and Display Floor change dot intensity and area height in every Color without resetting the hold', () => {
  const { Plugin, calls } = load();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.display = [{ midi: 69, level: -48 }, { midi: 69.1, level: -48 }];
  plugin.levelReference = -80;
  plugin.levelReferenceHold = 0.7;
  const { inner, pitch, midiLow } = plugin.getSpiralGeometry(640, 640);
  const base = Plugin.spiralPoint(69, midiLow, inner, pitch);
  for (const dm of [0, 1, 2]) {
    for (const [lr, df, intensity] of [[24, -60, 0.5], [48, -60, 0.25], [24, -48, 0], [24, -72, 1]]) {
      plugin.setParameters({ dm, lr, df });
      assert.equal(plugin.levelReference, -80);
      assert.equal(plugin.levelReferenceHold, 0.7);
      calls.length = 0;
      plugin.drawGraph();
      if (dm === 1) {
        const fill = calls.findIndex(call => call[0] === 'fill');
        const start = calls.findLastIndex((call, index) => index < fill && call[0] === 'beginPath');
        const top = calls.slice(start, fill).find(call => call[0] === 'moveTo');
        assert.ok(Math.abs(Math.hypot(top[1] - base.x, top[2] - base.y) / pitch - intensity) < 1e-12);
      } else {
        const dots = calls.filter(call => call[0] === 'arc');
        assert.equal(dots.length, intensity ? 2 : 0);
        if (intensity) {
          assert.ok(Math.abs((dots[0][3] / (pitch / 2)) ** 2 - intensity) < 1e-12);
          assert.equal(calls.find(call => call[0] === 'set' && call[1] === 'globalAlpha')[2], intensity);
        }
      }
    }
  }
  plugin.cleanup();
});

test('Normal and Note Colors keep the same dot geometry and intensity while selecting theme or note colors', () => {
  const { Plugin, Note, calls } = load();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.display = [{ midi: 60, level: -12 }, { midi: 69, level: -18 }];
  plugin.levelReference = 0;
  plugin.levelReferenceHold = 0.7;
  const drawings = [];
  for (const dm of [0, 2]) {
    plugin.setParameters({ dm });
    assert.equal(plugin.levelReference, 0);
    assert.equal(plugin.levelReferenceHold, 0.7);
    calls.length = 0;
    plugin.drawGraph();
    drawings.push({
      dots: calls.filter(call => call[0] === 'arc'),
      alpha: calls.filter(call => call[0] === 'set' && call[1] === 'globalAlpha'),
      colors: calls.filter(call => call[0] === 'set' && call[1] === 'fillStyle').slice(1, -1).map(call => call[2])
    });
  }
  assert.deepEqual(drawings[0].dots, drawings[1].dots);
  assert.deepEqual(drawings[0].alpha, drawings[1].alpha);
  assert.deepEqual(drawings[0].colors, ['theme:graph-trace', 'theme:graph-trace']);
  assert.deepEqual(drawings[1].colors, [0, 9].map(pc => `rgb(${Note.noteColors[pc].join(',')})`));
  plugin.cleanup();
});
