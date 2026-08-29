import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const targets = {
  BandPassFilterPlugin: { path: 'eq/band_pass_filter' },
  CombFilterPlugin: { path: 'eq/comb_filter' },
  FifteenBandGEQPlugin: { path: 'eq/fifteen_band_geq' },
  HiPassFilterPlugin: { path: 'eq/hi_pass_filter' },
  LoPassFilterPlugin: { path: 'eq/lo_pass_filter' },
  LoudnessEqualizerPlugin: { path: 'eq/loudness_equalizer' },
  NarrowRangePlugin: { path: 'eq/narrow_range' },
  TiltEQPlugin: { path: 'eq/tilt_eq' },
  ToneControlPlugin: { path: 'eq/tone_control' },
  ChannelDividerPlugin: { path: 'basics/channel_divider' },
  FIRCrossoverPlugin: { path: 'basics/fir_crossover' },
  FiveBandDynamicEQ: { path: 'eq/five_band_dynamic_eq' },
  FiveBandPEQPlugin: { path: 'eq/five_band_peq', response: '.five-band-peq-response' },
  FifteenBandPEQPlugin: { path: 'eq/fifteen_band_peq', response: '.fifteen-band-peq-response' },
  FiveBandFIRPEQPlugin: { path: 'eq/five_band_fir_peq', response: '.five-band-fir-peq-response' },
  RoomEqPlugin: { path: 'eq/room_eq', response: '.room-eq-additional-eq-response' },
  EarphoneCableSimPlugin: { path: 'eq/earphone_cable_sim', response: '.earphone-cable-sim-response' },
  SubSynthPlugin: { path: 'saturation/sub_synth' }
};

const bottomAnchored = new Set([
  'FifteenBandPEQPlugin', 'FiveBandFIRPEQPlugin', 'RoomEqPlugin'
]);

const fontSizes = {
  ChannelDividerPlugin: { tick: 11, axis: 13 },
  FIRCrossoverPlugin: { tick: 11, axis: 13 },
  FiveBandDynamicEQ: { tick: 12, axis: 13 },
  SubSynthPlugin: { tick: 11, axis: 13 }
};

function expectedFontSize(name, svg) {
  if (svg) return { tick: 10, axis: 10 };
  return fontSizes[name] || { tick: 12, axis: 14 };
}

function rectangleMismatches(actual, expected) {
  return ['left', 'top', 'right', 'bottom']
    .filter(edge => Math.abs(actual[edge] - expected[edge]) >= 0.02)
    .map(edge => ({ edge, actual: actual[edge], expected: expected[edge] }));
}

async function loadCssInApplicationOrder(page) {
  const pluginDefinition = await fs.readFile('plugins/plugins.txt', 'utf8');
  const pluginCss = pluginDefinition.split(/\r?\n/)
    .filter(line => line.includes('| css'))
    .map(line => line.trim().split(':', 1)[0]);
  for (const path of [
    'effetune.css',
    'effetune-mobile.css',
    'effetune-library.css',
    'pipeline-analyzer.css',
    'plugins/spectrum-overlay.css',
    ...pluginCss.map(path => `plugins/${path}.css`)
  ]) {
    await page.addStyleTag({ content: await fs.readFile(path, 'utf8') });
  }
}

async function loadTargetScripts(page) {
  for (const path of [
    'plugins/plugin-base.js',
    'plugins/spectrum-overlay.js',
    ...Object.values(targets).map(target => `plugins/${target.path}.js`)
  ]) {
    await page.addScriptTag({ content: await fs.readFile(path, 'utf8') });
  }
}

test('Spectrum Overlay follows every real graph through the complete plugin CSS cascade',
  { timeout: 120_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const controlCollisions = [];
    const geometryMismatches = [];
    try {
      for (const { width, dpr } of [
        { width: 1280, dpr: 1 },
        { width: 900, dpr: 2 },
        { width: 360, dpr: 1 },
        { width: 360, dpr: 2 }
      ]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          deviceScaleFactor: dpr
        });
        try {
          await page.setContent('<main class="pipeline-item"></main>');
          const layout = await page.evaluate(() => {
            const mobile = window.matchMedia('(max-width: 1158px)').matches;
            for (const element of [document.documentElement, document.body]) {
              element.classList.toggle('layout-mobile', mobile);
              element.classList.toggle('layout-desktop', !mobile);
            }
            return {
              mobile,
              body: document.body.className,
              root: document.documentElement.className
            };
          });
          assert.equal(layout.mobile, width <= 1158, `${width}px layout media query`);
          assert.ok(layout.body.includes(layout.mobile ? 'layout-mobile' : 'layout-desktop'));
          assert.ok(layout.root.includes(layout.mobile ? 'layout-mobile' : 'layout-desktop'));
          await loadCssInApplicationOrder(page);
          await page.evaluate(() => {
            window.audioContext = { sampleRate: 48000, destination: { channelCount: 2 } };
            window.audioManager = { pipeline: [] };
            window.workletNode = {
              port: { addEventListener() {}, removeEventListener() {}, postMessage() {} }
            };
          });
          await loadTargetScripts(page);

          for (const [index, [name, definition]] of Object.entries(targets).entries()) {
            const result = await page.evaluate(async ({ name, id, responseSelector }) => {
              const main = document.querySelector('main');
              main.replaceChildren();
              const plugin = new window[name]();
              plugin.id = id;
              window.audioManager.pipeline = [plugin];
              const root = document.createElement('div');
              root.className = 'plugin-ui expanded';
              const graphCanvasLabels = [];
              const canvasPrototype = CanvasRenderingContext2D.prototype;
              const originalGraphFillText = canvasPrototype.fillText;
              canvasPrototype.fillText = function(text, ...args) {
                graphCanvasLabels.push(String(text));
                return originalGraphFillText.call(this, text, ...args);
              };
              try {
                root.append(plugin.createUI());
                main.append(root);
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              } finally {
                canvasPrototype.fillText = originalGraphFillText;
              }
              const rect = element => {
                const { left, top, right, bottom } = element.getBoundingClientRect();
                return { left, top, right, bottom };
              };
              const graphControls = () => [...root.querySelectorAll('button, input[type="button"], [class*="legend"]')]
                .filter(element => !element.classList.contains('spectrum-overlay-toggle'))
                .filter(element => {
                  const value = `${element.textContent} ${element.value || ''} ${element.getAttribute('aria-label') || ''}`;
                  return /Import|Reset|legend/i.test(value) || /legend/i.test(element.className);
                })
                .map(element => ({
                  rect: rect(element),
                  label: `${element.className} ${element.textContent} ${element.value || ''}`.trim()
                }));
              const originalControls = graphControls();
              const originalLegendRight = name === 'RoomEqPlugin'
                ? rect(root.querySelector('.room-eq-response-legend')).right
                : null;
              const instance = window.SpectrumOverlay.attach(plugin, root);
              instance.enable();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const canvas = rect(instance.canvas);
              const button = rect(instance.button);
              const icon = instance.button.querySelector('svg');
              const iconRect = rect(icon);
              const iconStyles = getComputedStyle(icon);
              const spectrumIconStyles = {
                display: iconStyles.display,
                visibility: iconStyles.visibility
              };
              const plot = root.querySelector(instance.target.plotSelector);
              const plotRect = rect(plot);
              const response = responseSelector ? root.querySelector(responseSelector) : null;
              const responseRect = response ? rect(response) : null;
              const svgLabels = [...plot.querySelectorAll('text')].map(element => element.textContent || '');
              const originalAxisLabels = [...graphCanvasLabels, ...svgLabels];
              const isDbUnitTick = text => /^[+-]?\d+(?:\.\d+)?\s*dB$/i.test(text.trim());
              const isNumericTick = text => /^[+-]?\d+(?:\.\d+)?$/.test(text.trim());
              const styles = getComputedStyle(instance.canvas);
              const canvasStyles = {
                backgroundColor: styles.backgroundColor, margin: styles.margin, padding: styles.padding,
                borderTopWidth: styles.borderTopWidth, boxSizing: styles.boxSizing
              };
              const overlap = (first, second) => first.left < second.right && first.right > second.left &&
                first.top < second.bottom && first.bottom > second.top;

              const calls = { fill: 0, fillRect: 0, moveTo: [], labels: [], transforms: [] };
              const prototype = CanvasRenderingContext2D.prototype;
              const methods = ['fill', 'fillRect', 'moveTo', 'fillText', 'save', 'restore', 'translate', 'rotate'];
              const originals = Object.fromEntries(methods.map(method => [method, prototype[method]]));
              prototype.fill = function(...args) { calls.fill++; return originals.fill.apply(this, args); };
              prototype.fillRect = function(...args) { calls.fillRect++; return originals.fillRect.apply(this, args); };
              prototype.moveTo = function(...args) { calls.moveTo.push(args); return originals.moveTo.apply(this, args); };
              prototype.fillText = function(text, x, y, ...args) {
                const metrics = this.measureText(text);
                calls.labels.push({
                  text, x, y, width: metrics.width,
                  ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent,
                  font: this.font, textAlign: this.textAlign, baseline: this.textBaseline
                });
                return originals.fillText.call(this, text, x, y, ...args);
              };
              for (const method of ['save', 'restore', 'translate', 'rotate']) {
                prototype[method] = function(...args) {
                  calls.transforms.push([method, ...args]);
                  return originals[method].apply(this, args);
                };
              }
              try {
                instance.levels = new Float32Array(2048).fill(-36);
                instance.sampleRate = 48000;
                instance.lastReceived = performance.now();
                instance._draw();
              } finally {
                for (const method of methods) prototype[method] = originals[method];
              }

              const dpr = window.devicePixelRatio || 1;
              const roomHover = name === 'RoomEqPlugin'
                ? (() => {
                    const graph = root.querySelector('.room-eq-additional-eq-graph');
                    const graphRect = rect(graph);
                    graph.dispatchEvent(new MouseEvent('mousemove', {
                      bubbles: true,
                      clientX: (graphRect.left + graphRect.right) / 2,
                      clientY: (graphRect.top + graphRect.bottom) / 2
                    }));
                    const legend = root.querySelector('.room-eq-response-legend');
                    return { legend: rect(legend), cursor: legend.querySelector('.room-eq-response-legend-cursor').textContent };
                  })()
                : null;
              const controls = graphControls();
              const scaleLabels = calls.labels.map(label => {
                const height = 10;
                const baselineOffset = label.baseline === 'top' ? 0 : label.baseline === 'bottom' ? height : height / 2;
                const x = canvas.left + label.x / dpr;
                const y = canvas.top + label.y / dpr;
                return {
                  left: x - label.width / dpr,
                  top: y - baselineOffset,
                  right: x,
                  bottom: y - baselineOffset + height
                };
              });
              const buttonCollisions = controls.filter(control => overlap(button, control.rect));
              const scaleCollisions = scaleLabels.flatMap((label, index) => controls
                .filter(control => overlap(label, control.rect))
                .map(control => ({ label: calls.labels[index].text, labelRect: label, control })));
              const title = calls.labels.find(label => label.text === 'Level (dBFS)');
              const titleRect = {
                left: canvas.right - 4 - title.ascent / dpr,
                top: (canvas.top + canvas.bottom) / 2 - title.width / (2 * dpr),
                right: canvas.right - 4 + title.descent / dpr,
                bottom: (canvas.top + canvas.bottom) / 2 + title.width / (2 * dpr)
              };
              const titleCollisions = controls.filter(control => overlap(titleRect, control.rect));
              const buttonTitleCollision = overlap(button, titleRect);

              const nonFrequency = name === 'RoomEqPlugin'
                ? (() => {
                    plugin._setResponseView('phase');
                    const hidden = {
                      canvas: getComputedStyle(instance.canvas).display,
                      button: getComputedStyle(instance.button).display,
                      legendRight: rect(root.querySelector('.room-eq-response-legend')).right
                    };
                    plugin._setResponseView('frequency');
                    return hidden;
              })()
                : null;
              if (name === 'RoomEqPlugin') {
                root.querySelector('.room-eq-additional-eq-graph').dispatchEvent(new MouseEvent('mouseleave'));
              }
              instance.disable();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const controlsRestored = graphControls().every((control, index) => {
                const original = originalControls[index];
                return original && original.label === control.label &&
                  Object.keys(control.rect).every(edge => Math.abs(control.rect[edge] - original.rect[edge]) < 0.02);
              }) && graphControls().length === originalControls.length;
              const removedWhenOff = !root.contains(instance.canvas);
              const disposedLegendRight = name === 'RoomEqPlugin'
                ? (() => {
                    instance.enable();
                    const graph = root.querySelector('.room-eq-additional-eq-graph');
                    const graphRect = rect(graph);
                    graph.dispatchEvent(new MouseEvent('mousemove', {
                      bubbles: true,
                      clientX: (graphRect.left + graphRect.right) / 2,
                      clientY: (graphRect.top + graphRect.bottom) / 2
                    }));
                    instance.dispose();
                    return rect(root.querySelector('.room-eq-response-legend')).right;
                  })()
                : (() => { instance.dispose(); return null; })();
              plugin.cleanup?.();
              return {
                canvas, button, icon: iconRect, iconStyles: spectrumIconStyles,
                plot: plotRect, response: responseRect,
                inset: instance.target.inset, styles: canvasStyles,
                buttonCollisions, scaleCollisions, titleCollisions, buttonTitleCollision,
                originalAxisUnitLabels: originalAxisLabels.filter(isDbUnitTick),
                originalAxisNumericTicks: originalAxisLabels.filter(isNumericTick),
                originalLegendRight, roomHover, disposedLegendRight,
                calls, nonFrequency, removedWhenOff, controlsRestored
              };
            }, { name, id: index + 1, responseSelector: definition.response || null });

            const expected = definition.response || result.inset === 0
              ? result.response || result.plot
              : {
                  left: result.plot.left + result.inset,
                  top: result.plot.top + result.inset,
                  right: result.plot.right - result.inset,
                  bottom: result.plot.bottom - result.inset
                };
            const mismatch = rectangleMismatches(result.canvas, expected);
            if (mismatch.length) geometryMismatches.push({ name, width, dpr, mismatch });
            assert.ok(result.button.left >= expected.left && result.button.right <= expected.right &&
              result.button.top >= expected.top && result.button.bottom <= expected.bottom,
            `${name} button must stay inside its plot`);
            assert.ok(Math.abs(result.button.right - (expected.right - 6)) < 0.02,
              `${name} button must be 6px inside its original plot right edge`);
            assert.ok(result.icon.right > result.icon.left && result.icon.bottom > result.icon.top,
              `${name} spectrum icon must have a visible box`);
            assert.equal(result.iconStyles.display, 'block', `${name} spectrum icon display`);
            assert.equal(result.iconStyles.visibility, 'visible', `${name} spectrum icon visibility`);
            if (result.buttonCollisions.length || result.scaleCollisions.length || result.titleCollisions.length ||
              result.buttonTitleCollision) {
              controlCollisions.push({ name, width, dpr, ...result });
            }
            assert.equal(result.styles.backgroundColor, 'rgba(0, 0, 0, 0)', `${name} background`);
            assert.equal(result.styles.margin, '0px', `${name} margin`);
            assert.equal(result.styles.padding, '0px', `${name} padding`);
            assert.equal(result.styles.borderTopWidth, '0px', `${name} border`);
            assert.equal(result.styles.boxSizing, 'border-box', `${name} box sizing`);
            assert.equal(result.calls.fill, 0, `${name} spectrum must not fill a path`);
            assert.equal(result.calls.fillRect, 0, `${name} spectrum must not fill its canvas`);
            assert.equal(result.calls.moveTo[0][0], 0, `${name} spectrum must begin at the frequency floor`);
            assert.deepEqual(result.calls.labels.map(({ text }) => text),
              ['-24', '-48', '-72', 'Level (dBFS)'], `${name} scale`);
            const sizes = expectedFontSize(name, Boolean(definition.response));
            const tickFont = `${sizes.tick * dpr}px Arial`;
            const axisFont = `${sizes.axis * dpr}px Arial`;
            for (const label of result.calls.labels.slice(0, 3)) {
              assert.deepEqual(
                { font: label.font, textAlign: label.textAlign, baseline: label.baseline },
                { font: tickFont, textAlign: 'right', baseline: 'middle' }, `${name} tick font`
              );
            }
            assert.deepEqual(
              {
                font: result.calls.labels[3].font,
                textAlign: result.calls.labels[3].textAlign,
                baseline: result.calls.labels[3].baseline
              },
              { font: axisFont, textAlign: 'center', baseline: 'alphabetic' }, `${name} axis title font`
            );
            assert.deepEqual(result.calls.transforms.map(([method]) => method),
              ['save', 'translate', 'rotate', 'restore'], `${name} axis title transform`);
            assert.equal(result.buttonTitleCollision, false, `${name} title must not overlap its toggle`);
            assert.deepEqual(result.originalAxisUnitLabels, [], `${name} original left axis must not append dB`);
            assert.ok(result.originalAxisNumericTicks.length >= 3,
              `${name} original graph must retain numeric axis ticks`);
            assert.equal(result.removedWhenOff, true, `${name} must hide the overlay when off`);
            assert.equal(result.controlsRestored, true, `${name} graph controls must return to their original position when off`);
            if (name === 'RoomEqPlugin') {
              assert.deepEqual(result.nonFrequency, {
                canvas: 'none', button: 'none', legendRight: result.originalLegendRight
              },
                'Room EQ must hide the overlay outside its frequency graph');
              assert.match(result.roomHover.cursor, /(?:Hz|kHz)$/, 'Room EQ hover must expand its legend');
              assert.ok(Math.abs(result.roomHover.legend.right - (expected.right - 40)) < 0.02,
                'Room EQ hover legend must leave the spectrum axis clear');
              assert.equal(result.disposedLegendRight, result.originalLegendRight,
                'Room EQ must restore the hover legend position when the overlay is disposed');
            }
            const bottom = bottomAnchored.has(name);
            assert.ok(bottom
              ? expected.bottom - result.button.bottom >= 5
              : result.button.top - expected.top >= 5,
            `${name} toggle anchor`);
          }
        } finally {
          await page.close();
        }
      }
      assert.deepEqual(geometryMismatches, [], 'Spectrum Overlay must match each plot rectangle exactly');
      assert.deepEqual(controlCollisions.map(({ name, width, dpr, buttonCollisions, scaleCollisions }) => ({
        name, width, dpr, buttonCollisions, scaleCollisions
      })), [], 'Spectrum Overlay controls and dBFS scale must not overlap existing graph controls');
    } finally {
      await browser.close();
    }
  });
