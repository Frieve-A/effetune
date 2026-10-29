import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { analyzerDisplayDependencies } from '../helpers/visualizer-analyzer-script.mjs';

const source = readFileSync(new URL('../../plugins/analyzer/oscilloscope.js', import.meta.url), 'utf8');
const moduleSource = file => (file === 'visualizer-analyzer-display' ? analyzerDisplayDependencies : '')
  + readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');

test('Long Oscilloscope envelopes remain solid at fractional column widths and scroll positions', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas height="160"></canvas>');
    await page.addScriptTag({ content: `
      window.PluginBase = class {
        constructor() { this.enabled = this._sectionEnabled = true; }
        registerProcessor(processor) { this.processorString = processor; }
        updateParameters() {}
      };
    ` });
    await page.addScriptTag({ content: source });
    const results = await page.evaluate(() => {
      const plugin = new OscilloscopePlugin();
      plugin.canvas = document.querySelector('canvas');
      plugin.ctx = plugin.canvas.getContext('2d');
      plugin.displayOptions = { showAxes: false, showAxisNumbers: false,
        themePalette: { get: role => role === 'graph-trace' ? '#00ff00' : '#000000' } };
      const sampleRate = 48000, captureSampleCount = sampleRate * 10;
      const bucketSamples = Math.ceil(captureSampleCount / 4096), endSample = 720000;
      const first = Math.floor((endSample - captureSampleCount - sampleRate / 10) / bucketSamples);
      const bucketCount = Math.ceil(endSample / bucketSamples) - first;
      const extrema = new Float32Array(bucketCount * 2);
      for (let bucket = 0; bucket < bucketCount; bucket++) {
        extrema[bucket * 2] = -0.5;
        extrema[bucket * 2 + 1] = 0.5;
      }
      plugin.acceptScopeSnapshot({ sampleRate, captureSampleCount, bucketSamples, endSample,
        bucketCount, extrema, encoding: 2, rolling: true });
      const time = plugin.scopeScroll.time;
      const results = [];
      for (const width of [315, 944, 1416, 2832, 3840]) {
        plugin.canvas.width = width;
        for (const offset of [0, 4, 8, 12, 16]) {
          plugin.drawWaveform(time + offset);
          const pixels = plugin.ctx.getImageData(0, 80, width, 1).data;
          let minimumGreen = 255;
          for (let x = 0; x < width; x++) minimumGreen = Math.min(minimumGreen, pixels[x * 4 + 1]);
          results.push({ width, offset, minimumGreen });
        }
      }
      const long = results;
      const short = [];
      const processor = new Function('context', 'data', 'parameters', 'time', plugin.processorString);
      for (const [rate, displayTime] of [[44100, 0.05], [48000, 0.04], [48000, 0.045], [96000, 0.04]]) {
        plugin.setDisplayTime(displayTime);
        plugin.setTriggerMode('Off');
        const state = {};
        for (let start = 0; start < rate / 4; start += 128) {
          const audio = Float32Array.from({ length: 128 }, (_, frame) =>
            0.4 * Math.sin((start + frame) * 2 * Math.PI * 1000 / rate));
          processor(state, audio, { ...plugin.getParameters(), sampleRate: rate,
            blockSize: 128, channelCount: 1 }, start / rate);
        }
        plugin.acceptScopeSnapshot(state.scope.snapshot);
        const time = plugin.scopeScroll?.time ?? performance.now();
        for (const width of [944, 2832, 3840]) {
          plugin.canvas.width = width;
          for (const offset of [0, 8, 16]) {
            plugin.drawWaveform(time + offset);
            const pixels = plugin.ctx.getImageData(0, 0, width, 160).data;
            let emptyColumns = 0;
            for (let x = 0; x < width; x++) {
              let painted = false;
              for (let y = 0; y < 160 && !painted; y++) painted = pixels[(y * width + x) * 4 + 1] > 0;
              if (!painted) emptyColumns++;
            }
            short.push({ rate, displayTime, width, offset, emptyColumns });
          }
        }
      }
      const incremental = [];
      plugin.setDisplayTime(10);
      for (const width of [944, 3840]) {
        const geometry = { width, height: 160, factor: 1, centerY: 80, dpr: 1 };
        plugin.scopeRaster = null;
        for (let frame = 0; frame < 30; frame++) {
          const endSample = 720000 + frame * 800;
          const first = Math.floor((endSample - captureSampleCount - sampleRate / 10) / bucketSamples);
          const bucketCount = Math.ceil(endSample / bucketSamples) - first;
          const extrema = new Float32Array(bucketCount * 2);
          for (let bucket = 0; bucket < bucketCount; bucket++) {
            const value = 0.35 * Math.sin((first + bucket) * 0.29);
            extrema[bucket * 2] = value - .1;
            extrema[bucket * 2 + 1] = value + .1;
          }
          const snapshot = { sampleRate, captureSampleCount, bucketSamples, endSample, bucketCount, extrema, rolling: true };
          const cached = plugin.updateRollingRaster(snapshot, geometry);
          plugin.scopeRaster = null;
          const reference = plugin.updateRollingRaster(snapshot, geometry);
          plugin.scopeRaster = cached;
          const x = Math.ceil((endSample - sampleRate / 30 - captureSampleCount) / (captureSampleCount / width) - cached.startColumn) + 2;
          const actual = cached.ctx.getImageData(x, 0, width - 4, 160).data;
          const expected = reference.ctx.getImageData(x, 0, width - 4, 160).data;
          let differences = 0;
          for (let index = 0; index < actual.length; index++) if (actual[index] !== expected[index]) differences++;
          incremental.push({ width, frame, differences });
        }
      }
      return { long, short, incremental };
    });
    assert.equal(results.long.length, 25);
    for (const result of results.long) assert.equal(result.minimumGreen, 255, JSON.stringify(result));
    assert.equal(results.short.length, 36);
    for (const result of results.short) assert.equal(result.emptyColumns, 0, JSON.stringify(result));
    for (const result of results.incremental) assert.equal(result.differences, 0, JSON.stringify(result));
  } finally {
    await browser.close();
  }
});

test('Visualizer Oscilloscope reuses waveform rasters through palette, flip, and layer changes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas width="1600" height="400"></canvas>');
    await page.addScriptTag({ content: 'window.PluginBase = class {};' });
    await page.addScriptTag({ content: source });
    for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-text',
      'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display']) {
      await page.addScriptTag({ content: moduleSource(file) });
    }
    const results = await page.evaluate(() => {
      const item = createItem('oscilloscope', 'scope');
      Object.assign(item.params, { dt: 10, tm: 'Off', showAxes: false, showAxisNumbers: false });
      item.palette.mode = 'gradient';
      item.palette.stops = [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }];
      const canvas = document.querySelector('canvas');
      const display = createAnalyzerDisplay(item, canvas, { subscribeItem: () => () => {} });
      const sampleRate = 48000, captureSampleCount = 480000, bucketSamples = 118, endSample = 720000;
      const first = Math.floor((endSample - captureSampleCount - 4800) / bucketSamples);
      const bucketCount = Math.ceil(endSample / bucketSamples) - first;
      const extrema = Float32Array.from({ length: bucketCount * 2 }, (_, index) => index % 2 ? .5 : -.5);
      display.plugin.acceptScopeSnapshot({ sampleRate, captureSampleCount, bucketSamples, endSample,
        bucketCount, extrema, encoding: 2, rolling: true });
      const time = display.plugin.scopeScroll.time / 1000;
      const results = [];
      let firstRaster;
      for (const direction of ['frequency', 'radial']) for (const flipX of [false, true]) {
        item.palette.direction = direction;
        item.flipX = flipX;
        display.draw(item, time, 800);
        firstRaster ||= display.plugin.scopeRaster;
        const signal = display.signalCanvas || canvas;
        const pixels = signal.getContext('2d');
        results.push({ direction, flipX, cached: firstRaster === display.plugin.scopeRaster,
          left: [...pixels.getImageData(400, 200, 1, 1).data],
          right: [...pixels.getImageData(1200, 200, 1, 1).data],
          annotationAlpha: display.signalCanvas ? canvas.getContext('2d').getImageData(800, 200, 1, 1).data[3] : null });
      }
      display.dispose();
      return results;
    });
    for (const result of results) {
      assert.equal(result.cached, true, JSON.stringify(result));
      assert.equal(result.left[3], 255);
      assert.equal(result.right[3], 255);
      if (result.direction === 'frequency') {
        assert.ok((result.left[0] - result.right[0]) * (result.flipX ? -1 : 1) > 100);
      } else assert.equal(result.annotationAlpha, 0, 'The signal stays on its own effect layer');
    }
  } finally { await browser.close(); }
});
