import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createOverlayHarness } from '../helpers/spectrum-overlay-harness.mjs';

const commands = harness => harness.posts.map(({ type, enabled }) => [type, enabled]);

test('overlay is dormant until enabled and releases all work when disabled', () => {
  const h = createOverlayHarness();
  const { instance, mount, plot } = h.attach();
  assert.equal(instance.button.parentElement, mount);
  assert.notEqual(instance.button.parentElement, plot);
  assert.equal(instance.canvas, null);
  assert.equal(h.posts.length + h.frames.size + h.timers.size + h.resizes.size + h.intersections.size, 0);
  instance.toggle();
  assert.deepEqual(commands(h), [['setSpectrumTapRoute', true], ['setSpectrumTap', true]]);
  assert.equal(h.posts.at(-1).mode, 'after');
  assert.equal(instance.button.getAttribute('data-spectrum-mode'), 'after');
  assert.equal(instance.button.getAttribute('aria-label'), 'Show Before and After spectra');
  assert.equal(instance.button.getAttribute('aria-pressed'), 'true');
  assert.equal(instance.canvas.parentElement, mount);
  assert.equal([...h.intersections][0].element, mount);
  [...h.resizes][0].callback([{ contentRect: { width: 500, height: 250 } }]);
  assert.equal(instance.canvas.width, 1000);
  assert.equal(instance.canvas.height, 500);
  instance.toggle();
  assert.deepEqual(commands(h).at(-1), ['setSpectrumTap', true]);
  assert.equal(h.posts.at(-1).mode, 'compare');
  assert.equal(instance.button.getAttribute('data-spectrum-mode'), 'compare');
  assert.equal(instance.button.getAttribute('aria-label'), 'Hide spectra');
  assert.equal(instance.button.getAttribute('aria-pressed'), 'mixed');
  assert.equal(instance.canvas.parentElement, mount);
  instance.toggle();
  assert.deepEqual(commands(h).slice(-2), [['setSpectrumTap', false], ['setSpectrumTapRoute', false]]);
  assert.equal(instance.canvas, null);
  assert.equal(instance.button.getAttribute('data-spectrum-mode'), 'off');
  assert.equal(instance.button.getAttribute('aria-label'), 'Show After spectrum');
  assert.equal(instance.button.getAttribute('aria-pressed'), 'false');
  assert.equal(h.frames.size + h.timers.size + h.resizes.size + h.intersections.size + h.window.workletNode.listeners.size, 0);
  const css = fs.readFileSync(new URL('../../plugins/spectrum-overlay.css', import.meta.url), 'utf8');
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /mix-blend-mode:\s*screen/);
});

test('detached reattachment and IO suspension preserve intent and never release the route', () => {
  const h = createOverlayHarness();
  let { instance } = h.attach();
  instance.enable();
  instance.toggle();
  h.posts.length = 0;
  const old = instance;
  ({ instance } = h.attach());
  assert.equal(old.disposed, true);
  h.intersect(false);
  assert.equal(instance.active, false);
  assert.equal(instance.button.getAttribute('aria-pressed'), 'mixed');
  h.intersect(true);
  assert.equal(instance.active, true);
  assert.deepEqual(commands(h).filter(([type]) => type === 'setSpectrumTapRoute'), [['setSpectrumTapRoute', true]]);
  assert.deepEqual(commands(h).at(-1), ['setSpectrumTap', true]);
  for (let i = 0; i < 100; i++) ({ instance } = h.attach());
  assert.equal(h.resizes.size, 1);
  assert.equal(h.intersections.size, 1);
  assert.equal(h.frames.size, 1);
  assert.equal(h.timers.size, 1);
  assert.equal(h.window.workletNode.listeners.size, 1);
  instance.disable();
  assert.equal(h.attach().instance.enabled, false);
});

test('GC and disposal stop taps and orphan timers without route changes', () => {
  const h = createOverlayHarness();
  const { instance } = h.attach();
  instance.enable();
  assert.equal(h.timers.size, 1);
  h.window.audioManager.pipeline = [];
  h.posts.length = 0;
  const unsupported = { id: 9, constructor: { name: 'GroupDelayPEQPlugin' } };
  assert.equal(h.overlay.attach(unsupported, h.rootFor().root), null);
  assert.equal(instance.disposed, true);
  assert.deepEqual(commands(h), [['setSpectrumTap', false]]);
  const count = h.posts.length;
  h.advance(1000);
  assert.equal(h.posts.length, count);
  assert.equal(h.timers.size + h.resizes.size + h.intersections.size, 0);
  assert.ok(h.posts.every(message => message.type !== 'setSpectrumTapRoute'));
});

test('power gate and swallowed frame recovery stay within the intent lifetime', () => {
  const h = createOverlayHarness();
  const { instance } = h.attach();
  h.plugin.runnable = false;
  instance.enable();
  assert.equal(instance.active, false);
  assert.equal(instance.enabled, true);
  h.advance(500);
  assert.equal(h.frames.size, 0);
  h.plugin.runnable = true;
  h.advance(250);
  assert.equal(instance.active, true);
  assert.equal(h.frames.size, 1);
  h.frames.clear(); // PluginBase can suppress an already queued callback when the gate closes.
  h.advance(500);
  assert.equal(h.frames.size, 1);
  instance.dispose();
  const count = h.posts.length;
  h.advance(1000);
  assert.equal(h.posts.length, count);
  assert.equal(h.frames.size + h.timers.size, 0);
});

test('node replacement replays intent and effective tap on frames and while suspended', () => {
  for (const mode of ['frame', 'intersection', 'power', 'missing']) {
    const h = createOverlayHarness();
    const { instance } = h.attach();
    instance.enable();
    const oldNode = h.window.workletNode;
    if (mode === 'intersection') h.intersect(false);
    if (mode === 'power') { h.plugin.runnable = false; h.advance(250); }
    h.posts.length = 0;
    if (mode === 'missing') { h.window.workletNode = null; h.frame(); }
    h.window.workletNode = h.makeNode();
    if (mode === 'intersection') h.intersect(true);
    else if (mode === 'power' || mode === 'missing') { h.plugin.runnable = true; h.advance(250); }
    else h.frame();
    assert.equal(oldNode.listeners.size, 0, mode);
    assert.equal(h.window.workletNode.listeners.size, 1, mode);
    assert.deepEqual(commands(h).slice(-2), [['setSpectrumTapRoute', true], ['setSpectrumTap', true]], mode);
    assert.equal(instance.active, true, mode);
    instance.dispose();
  }
});

test('After and comparison modes analyze only their requested spectra and comparison paints signed change', () => {
  const h = createOverlayHarness();
  const { instance } = h.attach();
  let stopped = 0;
  for (const type of ['mousedown', 'pointerdown']) instance.button.listeners.get(type)({ stopPropagation() { stopped++; } });
  assert.equal(stopped, 2);
  instance.enable();
  instance.onSpectrumMessage({ type: 'spectrumOverlay', pluginId: 7, buffer: new Float32Array(4096) });
  assert.equal(instance.pending, null);
  instance.onSpectrumMessage({
    type: 'spectrumOverlay',
    spectrumPluginId: 7,
    mode: 'after',
    outputBuffer: new Float32Array(4096).fill(0.5),
    bufferPosition: 0,
    sampleRate: 48000
  });
  h.frame();
  assert.equal(instance.inputLevels, null);
  assert.ok(instance.levels[0] < -6 && instance.levels[0] > -6.03);
  assert.deepEqual(instance.canvas.fillStyles, []);
  assert.equal(instance.canvas.strokeStyles.at(-1), 'rgba(140,190,255,0.55)');

  instance.toggle();
  const message = {
    type: 'spectrumOverlay',
    spectrumPluginId: 7,
    mode: 'compare',
    inputBuffer: new Float32Array(4096).fill(1),
    outputBuffer: new Float32Array(4096).fill(0.5),
    bufferPosition: 0,
    sampleRate: 48000
  };
  instance.onSpectrumMessage(message);
  assert.equal(instance.levels, null);
  h.frame();
  assert.ok(instance.inputLevels[0] > -0.01);
  assert.ok(instance.levels[0] < -6 && instance.levels[0] > -6.03);
  assert.equal(instance.canvas.fillStyles.at(-1), 'rgba(140,190,255,0.55)');
  assert.equal(instance.canvas.strokeStyles.at(-1), 'rgba(190,190,190,0.9)');

  instance.canvas.drawCalls.length = 0;
  instance.canvas.fillStyles.length = 0;
  instance.canvas.strokeStyles.length = 0;
  instance.inputLevels.fill(-48);
  instance.levels.fill(-36);
  instance.levels.fill(-60, 20);
  instance._draw();
  assert.deepEqual(instance.canvas.fillStyles, [
    'rgba(255,190,140,0.55)',
    'rgba(140,190,255,0.55)'
  ]);
  assert.deepEqual(instance.canvas.strokeStyles, ['rgba(190,190,190,0.9)']);
  assert.deepEqual(
    instance.canvas.drawCalls.filter(([method]) => method === 'fill' || method === 'stroke')
      .map(([method]) => method),
    ['fill', 'fill', 'stroke']
  );
  h.advance(600);
  for (let i = 0; i < 26; i++) h.frame();
  assert.ok(Number.isFinite(instance.levels[0]));
  assert.ok(instance.levels[0] < -96);
  assert.ok(Number.isFinite(instance.inputLevels[0]));
  assert.ok(instance.inputLevels[0] < -96);
  assert.equal(instance.pending, null);
  instance.dispose();
});

test('Room EQ stops the effective tap outside the frequency view and keeps user intent', () => {
  const h = createOverlayHarness();
  h.plugin.constructor.name = 'RoomEqPlugin';
  const { instance, mount } = h.attach();
  assert.equal(mount.style['--spectrum-overlay-inset'], '20px');
  instance.enable();
  assert.equal(instance.axisTitle.parentElement, mount);
  assert.equal(instance.axisTitle.className, 'spectrum-overlay-axis-title');
  assert.equal(instance.axisTitle.textContent, 'Level (dBFS)');
  assert.equal(instance.axisTitle.getAttribute('aria-hidden'), 'true');
  h.plugin.runnable = false;
  h.advance(250);
  assert.equal(instance.active, false);
  h.plugin.runnable = true;
  h.advance(250);
  h.plugin._responseView = 'impulse';
  h.frame();
  assert.equal(instance.active, false);
  assert.equal(instance.enabled, true);
  h.plugin._responseView = 'frequency';
  h.advance(250);
  assert.equal(instance.active, true);
  assert.equal(h.posts.filter(message => message.type === 'setSpectrumTapRoute').length, 1);
  instance.disable();
  assert.equal(instance.axisTitle, null);
  instance.enable();
  instance.dispose();
  assert.equal(mount.style['--spectrum-overlay-inset'], undefined);
});

test('the dBFS scale keeps only interior ticks and a vertical title before spectrum data arrives', () => {
  const h = createOverlayHarness();
  const { instance } = h.attach();
  instance.enable();
  [...h.resizes][0].callback([{ contentRect: { width: 400, height: 200 } }]);
  const labels = () => instance.canvas.drawCalls.filter(([name]) => name === 'fillText');
  const expected = [
    ['fillText', '-24', 756, 100, 'middle'],
    ['fillText', '-48', 756, 200, 'middle'],
    ['fillText', '-72', 756, 300, 'middle'],
    ['fillText', 'Level (dBFS)', 0, 0, 'alphabetic']
  ];
  assert.deepEqual(labels(), expected);
  assert.deepEqual(instance.canvas.drawTextStates, [
    { font: '24px Arial', textAlign: 'right', textBaseline: 'middle' },
    { font: '24px Arial', textAlign: 'right', textBaseline: 'middle' },
    { font: '24px Arial', textAlign: 'right', textBaseline: 'middle' },
    { font: '28px Arial', textAlign: 'center', textBaseline: 'alphabetic' }
  ]);
  assert.deepEqual(instance.canvas.drawCalls.filter(([name]) => ['save', 'translate', 'rotate', 'restore'].includes(name)), [
    ['save'], ['translate', 792, 200], ['rotate', -Math.PI / 2], ['restore']
  ]);
  instance.canvas.drawCalls.length = 0;
  instance.canvas.drawTextStates.length = 0;
  h.frame();
  assert.deepEqual(labels(), expected);
  assert.deepEqual(instance.canvas.drawTextStates, [
    { font: '24px Arial', textAlign: 'right', textBaseline: 'middle' },
    { font: '24px Arial', textAlign: 'right', textBaseline: 'middle' },
    { font: '24px Arial', textAlign: 'right', textBaseline: 'middle' },
    { font: '28px Arial', textAlign: 'center', textBaseline: 'alphabetic' }
  ]);
  assert.equal(instance.canvas.drawCalls.some(([name]) => name === 'fill' || name === 'stroke'), false);
  instance.dispose();
});

test('the spectrum starts at the axis minimum and only draws a line over the full frequency width', () => {
  for (const name of ['BandPassFilterPlugin', 'CombFilterPlugin', 'SubSynthPlugin', 'FifteenBandGEQPlugin']) {
    for (const sampleRate of [48000, 96000]) {
      const h = createOverlayHarness();
      h.plugin.constructor.name = name;
      const { instance } = h.attach();
      instance.enable();
      const canvas = instance.canvas;
      canvas.width = 800;
      canvas.height = 400;
      instance.sampleRate = sampleRate;
      instance.levels = new Float32Array(2048).fill(-48);
      instance.levels[1] = -24;
      const original = instance.levels.slice();
      h.frame();
      const { minFreq, maxFreq } = instance.target;
      const binFrequency = sampleRate / 4096;
      const firstLevel = minFreq <= binFrequency ? -24 :
        -24 - 24 * Math.log(minFreq / binFrequency) / Math.log(2);
      const firstPoint = canvas.drawCalls.find(([method]) => method === 'moveTo');
      assert.equal(firstPoint[1], 0, `${name} at ${sampleRate}`);
      assert.ok(Math.abs(firstPoint[2] - 400 * firstLevel / -96) < 1e-9);
      const points = canvas.drawCalls.filter(([method]) => method === 'lineTo');
      const lastBin = Math.min(2047, Math.floor(maxFreq / binFrequency));
      const lastX = 800 * Math.log(lastBin * binFrequency / minFreq) / Math.log(maxFreq / minFreq);
      assert.ok(Math.abs(points.at(-1)[1] - lastX) < 1e-9);
      assert.equal(canvas.drawCalls.some(([method]) => method === 'fill' || method === 'closePath'), false);
      assert.equal(canvas.drawCalls.filter(([method]) => method === 'stroke').length, 1);
      assert.deepEqual(instance.levels, original);
      instance.dispose();
    }
  }
});

test('below-range spectrum values leave the graph through Canvas clipping instead of its bottom edge', () => {
  const h = createOverlayHarness();
  const { instance } = h.attach();
  const silence = h.overlay.analyze(new Float32Array(4096), 0, 48000);
  assert.ok(Number.isFinite(silence[1]));
  assert.ok(silence[1] < -96);

  instance.enable();
  const canvas = instance.canvas;
  canvas.width = 800;
  canvas.height = 400;
  instance.sampleRate = 48000;
  instance.levels = new Float32Array(2048).fill(-120);
  instance.levels[1] = -48;
  h.frame();

  const points = canvas.drawCalls.filter(([method]) => method === 'moveTo' || method === 'lineTo');
  assert.ok(points.some(([, , y]) => y > canvas.height), 'below-range values must reach outside the canvas');
  assert.equal(points.some(([, , y]) => y === canvas.height), false,
    'the spectrum must not create a horizontal segment on the graph bottom');
  assert.ok(points.some(([, , y], index) => index > 0 && points[index - 1][2] <= canvas.height && y > canvas.height),
    'the final visible point must connect continuously to the clipped portion');
  assert.equal(instance.levels[2], -120, 'drawing must retain below-range levels');
  instance.dispose();
});
