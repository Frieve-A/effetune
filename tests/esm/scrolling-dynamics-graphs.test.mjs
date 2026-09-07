import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const cases = [
  { file: 'auto_leveler', type: 'AutoLevelerPlugin', points: 1024, method: 'drawGraph',
    initial: { inputLufs: -30, outputLufs: -24 }, latest: { inputLufs: -12, outputLufs: -6 },
    expectedY: [[60, 30]] },
  { file: 'transient_shaper', type: 'TransientShaperPlugin', points: 1024, method: 'drawGraph',
    initial: { gain: -2 }, latest: { gain: 3 }, expectedY: [[60]] },
  { file: 'multiband_transient', type: 'MultibandTransientPlugin', points: 306, method: 'drawGraphs',
    initial: { gains: [1, -1, -2] }, latest: { gains: [-3, 1, 3] }, expectedY: [[180], [100], [60]] },
  { file: 'power_amp_sag', type: 'PowerAmpSagPlugin', points: 512, method: 'drawGraphs',
    initial: { inputEnvelope: 20, gainReduction: -1 }, latest: { inputEnvelope: 65, gainReduction: -3.5 },
    expectedY: [[84], [240 * (1 - 8.5 / 14)]] }
];

function createCanvas(width) {
  let points;
  let commands;
  const strokes = [];
  const canvas = { width, height: 240, clientWidth: width };
  const ctx = {
    canvas, strokes,
    fillRect() { strokes.length = 0; }, fillText() {},
    save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() { points = []; commands = []; },
    moveTo(x, y) { points.push([x, y]); commands.push({ type: 'moveTo', x, y }); },
    lineTo(x, y) { points.push([x, y]); commands.push({ type: 'lineTo', x, y }); },
    stroke() { strokes.push({ color: this.strokeStyle, points, commands }); }
  };
  canvas.getContext = () => ctx;
  return canvas;
}

async function createGraph(spec) {
  const clock = { now: 20000, callback: null };
  const context = vm.createContext({
    performance: { now: () => clock.now }, window: {}, cancelAnimationFrame() {},
    PluginBase: class {
      constructor() { this.id = 1; this.enabled = true; this._sectionEnabled = true; }
      _setupMessageHandler() {} registerProcessor() {} updateParameters() {} cleanup() {}
      requestPowerAnimationFrame(callback) { clock.callback = callback; return 1; }
    }
  });
  const source = await fs.readFile(new URL(`../../plugins/dynamics/${spec.file}.js`, import.meta.url), 'utf8');
  installThemePaletteStub(context.window);
  vm.runInContext(source, context, { filename: spec.file });
  const plugin = new context.window[spec.type]();
  const canvases = spec.expectedY.map(() => createCanvas(spec.points * 2));
  if (spec.file === 'multiband_transient') plugin.canvases = canvases;
  else if (spec.file === 'power_amp_sag') {
    [plugin.canvasLeft, plugin.canvasRight] = canvases;
    [plugin.canvasCtxLeft, plugin.canvasCtxRight] = canvases.map(canvas => canvas.getContext('2d'));
  } else {
    [plugin.canvas] = canvases;
    plugin.canvasCtx = plugin.canvas.getContext('2d');
  }
  const snapshot = () => canvases.map(canvas => {
    const strokes = canvas.getContext('2d').strokes;
    return {
      curves: strokes.filter(stroke => ['stub:graph-trace', 'stub:text-primary'].includes(stroke.color)),
      ticks: strokes.filter(stroke => stroke.color === 'stub:graph-grid-strong').map(stroke => stroke.points[0][0])
    };
  });
  return {
    clock, plugin, canvases, snapshot,
    deliver: measurements => plugin.onMessage({ type: 'processBuffer', measurements }),
    draw: now => { plugin[spec.method](now); return snapshot(); }
  };
}

function assertLatestAtEdge(frames, spec, canvases) {
  for (let graph = 0; graph < frames.length; graph++) {
    assert.equal(frames[graph].curves.length, spec.expectedY[graph].length);
    for (let curve = 0; curve < frames[graph].curves.length; curve++) {
      const endpoint = frames[graph].curves[curve].points.at(-1);
      assert.equal(endpoint[0], canvases[graph].width);
      assert.ok(Math.abs(endpoint[1] - spec.expectedY[graph][curve]) < 1e-9);
    }
  }
}

for (const spec of cases) {
  test(`${spec.type} scrolls every curve and second tick by render time`, async () => {
    const graph = await createGraph(spec);
    const { clock, plugin, canvases, deliver, draw } = graph;
    deliver(spec.initial);
    clock.now += 100;
    deliver(spec.latest);
    const times = [clock.now + 2, clock.now + 7, clock.now + 15];
    const frames = times.map(draw);
    for (let i = 0; i < frames.length; i++) {
      assertLatestAtEdge(frames[i], spec, canvases);
      for (let band = 0; band < canvases.length; band++) {
        const current = frames[i][band];
        // The original visible 60 Hz history duration remains unchanged.
        const expectedX = canvases[band].width - (times[i] - 20000) * 0.12;
        for (const curve of current.curves) {
          assert.ok(Math.abs(curve.points[0][0] - expectedX) < 1e-9);
          assert.equal(curve.commands.at(-2).type, 'lineTo');
        }
        if (i === 0) continue;
        const previous = frames[i - 1][band];
        const distance = (times[i] - times[i - 1]) * 0.12;
        assert.ok(Math.abs(previous.ticks.at(-1) - current.ticks.at(-1) - distance) < 1e-9);
      }
    }
    const stalled = draw(clock.now + 60000);
    assertLatestAtEdge(stalled, spec, canvases);
    for (let band = 0; band < canvases.length; band++) {
      for (const curve of stalled[band].curves) {
        assert.ok(Math.abs(curve.points.at(-2)[0] - (canvases[band].width - 2)) < 1e-9);
      }
    }
    canvases.forEach(canvas => { canvas.width /= 2; });
    assertLatestAtEdge(draw(clock.now + 8), spec, canvases);

    plugin.isVisible = true;
    plugin.startAnimation();
    clock.callback(clock.now + 15);
    assert.deepEqual(graph.snapshot(), draw(clock.now + 15));
    plugin.cleanup();
  });

  test(`${spec.type} anchors latest values after repeated effect and section ON/OFF`, async () => {
    const { clock, plugin, canvases, deliver, draw } = await createGraph(spec);
    plugin.isVisible = true;
    deliver(spec.initial);
    for (let cycle = 0; cycle < 8; cycle++) {
      clock.now += 5;
      deliver(spec.initial);
      plugin.stopAnimation();
      const frozen = draw(clock.now);
      const gate = cycle % 2 === 0 ? 'enabled' : '_sectionEnabled';
      plugin[gate] = false;
      clock.now += 20000;
      deliver(spec.initial);
      assert.deepEqual(draw(clock.now), frozen);
      plugin[gate] = true;
      plugin.startAnimation();
      deliver({ ...spec.latest, time: cycle % 2 });
      const resumed = draw(clock.now + 8);
      assertLatestAtEdge(resumed, spec, canvases);
      for (let band = 0; band < canvases.length; band++) {
        for (const curve of resumed[band].curves) {
          const latest = curve.commands.at(-2);
          assert.equal(latest.type, 'moveTo');
          assert.ok(Math.abs(latest.x - (canvases[band].width - 0.96)) < 1e-9);
        }
      }
    }
    // Hidden graphs still receive telemetry; a one-off resize must show the newest values.
    plugin.stopAnimation();
    clock.now += 5000;
    deliver(spec.latest);
    const hidden = draw(clock.now + 100);
    assertLatestAtEdge(hidden, spec, canvases);
    for (let band = 0; band < canvases.length; band++) {
      for (const curve of hidden[band].curves) {
        assert.equal(curve.points.at(-2)[0], canvases[band].width);
      }
    }
    plugin.cleanup();
  });

  test(`${spec.type} leaves telemetry gaps blank`, async () => {
    const { clock, plugin, canvases, deliver, draw } = await createGraph(spec);
    deliver(spec.initial);
    clock.now += 10;
    deliver(spec.initial);
    clock.now += 20000;
    deliver(spec.latest);
    const resumed = draw(clock.now + 8);
    assertLatestAtEdge(resumed, spec, canvases);
    for (let graph = 0; graph < resumed.length; graph++) {
      for (const curve of resumed[graph].curves) {
        const latest = curve.commands.at(-2);
        assert.equal(latest.type, 'moveTo');
        assert.ok(Math.abs(latest.x - (canvases[graph].width - 0.96)) < 1e-9);
      }
    }
    plugin.cleanup();
  });
}
