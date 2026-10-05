import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Element, frequencyAxisSource } from '../helpers/spectrum-overlay-harness.mjs';

const previewSource = fs.readFileSync(new URL('../../plugins/frequency-preview.js', import.meta.url), 'utf8');

function harness(name = 'BandPassFilterPlugin') {
  class PreviewElement extends Element {
    constructor(tag) {
      super(tag);
      this.clientLeft = this.clientTop = 0;
      this.rect = { left: 10, top: 20, width: 400, height: 200 };
    }
    getBoundingClientRect() { return this.rect; }
    removeEventListener(type) { this.listeners.delete(type); }
    closest() { return this.excluded ? this : null; }
    hasPointerCapture(id) { return this.capture === id; }
    setPointerCapture(id) { this.capture = id; }
    releasePointerCapture() { this.capture = null; }
    getContext() {
      const context = super.getContext();
      for (const method of ['setTransform', 'fillRect', 'arc']) {
        context[method] = (...args) => this.drawCalls.push([method, ...args]);
      }
      return context;
    }
  }
  const frames = new Map();
  const posts = [];
  const sounds = [];
  let frameId = 0;
  const plugin = { id: 1, constructor: { name }, mn: 60, mx: 71, ly: 'Horizontal', rf: 442 };
  const window = new PreviewElement();
  window.devicePixelRatio = 2;
  window.audioManager = { pipeline: [plugin], setFrequencyPreview(frequency, sound) {
    posts.push(frequency);
    sounds.push(sound);
  } };
  const document = new PreviewElement();
  document.createElement = tag => new PreviewElement(tag);
  const context = {
    window, document,
    getComputedStyle: element => ({ position: element.style.position || 'static', touchAction: element.style.touchAction || 'auto' }),
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class { observe() {} disconnect() {} }
  };
  vm.runInNewContext(frequencyAxisSource, context);
  vm.runInNewContext(previewSource, context);
  if (name === 'ChromaSpiralPlugin') {
    vm.runInNewContext(fs.readFileSync(new URL('../../plugins/analyzer/chroma_spiral.js', import.meta.url), 'utf8'),
      { window, PluginBase: class {} });
    delete plugin.constructor;
    Object.setPrototypeOf(plugin, window.ChromaSpiralPlugin.prototype);
    Object.assign(plugin, { lo: 1, hi: 7, dm: 0 });
  }
  const root = new PreviewElement();
  const mount = root.appendChild(new PreviewElement());
  const plot = mount.appendChild(new PreviewElement('canvas'));
  root.querySelector = () => plot;
  const preview = window.FrequencyPreview;
  const instance = preview.attach(plugin, root);
  function event(type, overrides = {}) {
    const data = { button: 0, pointerId: 2, pointerType: 'mouse', target: plot,
      clientX: 210, clientY: 80, preventDefault() { this.defaultPrevented = true; }, ...overrides };
    instance.mount.listeners.get(type)?.(data);
    return data;
  }
  return { window, document, plugin, mount, plot, posts, sounds, preview, instance, frames, event,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); } };
}

test('frequency graphs use the saved sound while pitch graphs and keyboards keep sine previews', () => {
  for (const name of ['BandPassFilterPlugin', 'FiveBandPEQPlugin', 'NoteSpectrogramPlugin',
    'PitchMeterPlugin', 'ChromaSpiralPlugin', 'SpectrumAnalyzerPlugin', 'SpectrogramPlugin']) {
    for (const kb of [false, true]) {
      const h = harness(name);
      h.plugin.kb = kb;
      h.plugin.freqToX = frequency => Math.log10(frequency / 10) / Math.log10(4000) * 100;
      h.plugin.getKeyboardGeometry = length => h.window.FrequencyAxis.noteAxisKeys(0, 127, length);
      h.plugin.frequencyToX = (frequency, length) =>
        h.window.FrequencyAxis.frequencyToPosition(frequency, length, 20, 40000);
      h.plugin.freqToY = frequency =>
        h.window.FrequencyAxis.frequencyToPosition(frequency, 255, 20, 40000, 'log', 'y');
      h.window.appConfig = { frequencyPreviewSound: 'bandpassNoise' };
      h.event('pointerdown');
      const pitchGraph = ['NoteSpectrogramPlugin', 'PitchMeterPlugin', 'ChromaSpiralPlugin'].includes(name);
      const keyboard = kb && ['SpectrumAnalyzerPlugin', 'SpectrogramPlugin'].includes(name);
      assert.equal(h.sounds.at(-1), pitchGraph || keyboard ? 'sine' : 'bandpassNoise', `${name}, keyboard ${kb}`);
      h.event('pointerup');
      assert.equal(h.posts.at(-1), null);
    }
  }

  const h = harness();
  h.event('pointerdown');
  assert.equal(h.sounds.at(-1), 'sine');
  const frequency = h.posts.at(-1);
  h.window.appConfig = { frequencyPreviewSound: 'bandpassNoise' };
  h.event('pointermove');
  h.frame();
  assert.equal(h.posts.at(-1), frequency);
  assert.equal(h.sounds.at(-1), 'bandpassNoise');
  h.window.appConfig.frequencyPreviewSound = 'unknown';
  h.event('pointermove');
  h.frame();
  assert.equal(h.sounds.at(-1), 'sine');
  h.preview.stop();
});

test('preview excludes existing controls and consumed pointer gestures', () => {
  const h = harness();
  h.event('pointerdown', { defaultPrevented: true });
  h.plot.excluded = true;
  h.event('pointerdown');
  h.plot.excluded = false;
  h.event('pointerdown', { button: 2 });
  assert.deepEqual(h.posts, []);
  h.event('pointerdown');
  assert.ok(Math.abs(h.posts[0] - Math.sqrt(10 * 40000)) < 1e-8);
  assert.equal(h.mount.style.touchAction, 'pan-y');
  h.preview.stop();
});

test('drag updates coalesce and every stop path cancels pending moves', () => {
  for (const name of ['BandPassFilterPlugin', 'ChromaSpiralPlugin']) {
    for (const end of ['pointerup', 'pointercancel', 'lostpointercapture', 'removed', 'blur', 'pagehide', 'hidden', 'dispose', 'stop']) {
      const h = harness(name);
      h.event('pointerdown');
      h.event('pointermove', { clientX: 310 });
      h.event('pointermove', { clientX: 410 });
      assert.equal(h.posts.length, 1);
      h.frame();
      const expected = name === 'ChromaSpiralPlugin' ? h.instance.axis.pointToFreq(400, 60) : 40000;
      assert.equal(h.posts.at(-1), expected);
      h.event('pointermove', { clientX: 100 });
      if (end === 'hidden') { h.document.hidden = true; h.document.listeners.get('visibilitychange')(); }
      else if (end === 'removed') {
        h.mount.capture = null;
        h.mount.remove();
        h.document.listeners.get('lostpointercapture')({ pointerId: 2 });
      }
      else if (end === 'blur' || end === 'pagehide') h.window.listeners.get(end)();
      else if (end === 'dispose') h.instance.dispose();
      else if (end === 'stop') h.preview.stop();
      else h.event(end);
      assert.equal(h.posts.at(-1), null, end);
      assert.equal(h.frames.size, 0, end);
      const count = h.posts.length;
      h.event('pointermove');
      h.frame();
      h.preview.stop();
      assert.equal(h.posts.length, count, end);
    }
  }
});

test('Chroma preview follows held and dragged spiral positions in all colors after resizing and scrolling', () => {
  for (const dm of [0, 1, 2]) {
    for (const size of [306, 640]) {
      const h = harness('ChromaSpiralPlugin');
      h.plugin.dm = dm;
      h.plot.rect = { left: 30, top: 50, width: size, height: size };
      h.instance.resize();
      assert.equal(h.mount.style.touchAction, 'none');
      const point = h.instance.axis.toPoint(440);
      h.event('pointerdown', { clientX: point.x + 30, clientY: point.y + 50, pointerType: 'touch' });
      assert.ok(Math.abs(h.posts.at(-1) - 440) < 1e-9);
      const marker = h.instance.canvas.drawCalls.filter(call => call[0] === 'arc').at(-1);
      assert.ok(Math.abs(marker[1] - point.x) < 1e-9);
      assert.ok(Math.abs(marker[2] - point.y) < 1e-9);
      h.plot.rect.top = 120;
      const next = h.instance.axis.toPoint(880);
      h.event('pointermove', { clientX: next.x + 30, clientY: next.y + 120 });
      assert.equal(h.posts.length, 1);
      h.frame();
      assert.ok(Math.abs(h.posts.at(-1) - 880) < 1e-9);
      h.event('pointerup');
      assert.equal(h.posts.at(-1), null);
      h.instance.dispose();
      assert.equal(h.mount.style.touchAction, undefined);
    }
  }
});

test('note preview follows displayed black and white keys and its note band', () => {
  const h = harness('PitchMeterPlugin');
  // C-sharp row, first over its black key, then the white C key beneath it.
  h.event('pointerdown', { clientX: 60, clientY: 180 });
  assert.equal(h.posts.at(-1), 442 * 2 ** ((61 - 69) / 12));
  h.event('pointermove', { clientX: 60, clientY: 210 });
  h.frame();
  assert.equal(h.posts.at(-1), 442 * 2 ** ((60 - 69) / 12));
  assert.ok(h.instance.canvas.drawCalls.some(call => call[0] === 'fillRect'));
  h.preview.stop();
});

test('canvas-relative mapping preserves graph margins and replacement stops the owner', () => {
  const h = harness();
  h.plot.rect = { left: 30, top: 20, width: 360, height: 200 };
  h.event('pointerdown', { clientX: 390 });
  assert.equal(h.posts.at(-1), 40000);
  assert.equal(h.instance.canvas.style.left, '20px');
  h.preview.attach(h.plugin, { querySelector: () => h.plot });
  assert.equal(h.posts.at(-1), null);
});

test('preview trace and hit testing stay on the graph at CSS zoom levels', () => {
  for (const zoom of [0.75, 1.5]) {
    const h = harness();
    h.mount.offsetWidth = 400;
    h.mount.offsetHeight = 200;
    h.mount.rect = { left: 10, top: 20, width: 400 * zoom, height: 200 * zoom };
    h.plot.rect = { left: 10 + 20 * zoom, top: 20 + 10 * zoom,
      width: 360 * zoom, height: 180 * zoom };
    h.instance.resize();
    assert.equal(h.instance.canvas.style.left, '20px');
    assert.equal(h.instance.canvas.style.top, '10px');
    assert.equal(h.instance.canvas.style.width, '360px');
    assert.equal(h.instance.canvas.style.height, '180px');
    assert.equal(h.instance.canvas.width, Math.round(360 * zoom * h.window.devicePixelRatio));

    const clientX = h.plot.rect.left + h.plot.rect.width / 2;
    h.event('pointerdown', { clientX });
    assert.ok(Math.abs(h.posts.at(-1) - Math.sqrt(10 * 40000)) < 1e-8);
    const line = h.instance.canvas.drawCalls.filter(call => call[0] === 'moveTo').at(-1);
    assert.ok(Math.abs(line[1] - h.plot.rect.width / 2) < 1e-8);
    h.preview.stop();
  }
});

test('inset PEQ preview and polar preview keep their displayed margins at CSS zoom', () => {
  for (const name of ['FiveBandPEQPlugin', 'ChromaSpiralPlugin']) {
    const h = harness(name);
    const zoom = 1.5;
    const mount = h.instance.mount;
    mount.offsetWidth = mount.offsetHeight = 400;
    mount.rect = { left: 30, top: 50, width: 400 * zoom, height: 400 * zoom };
    if (name === 'ChromaSpiralPlugin') h.plot.rect = mount.rect;
    h.plugin.freqToX = frequency => Math.log10(frequency / 10) / Math.log10(4000) * 100;
    h.instance.resize();
    const inset = name === 'FiveBandPEQPlugin' ? 20 : 0;
    assert.equal(h.instance.canvas.style.left, `${inset}px`);
    assert.equal(h.instance.canvas.style.top, `${inset}px`);
    assert.equal(h.instance.canvas.style.width, `${400 - inset * 2}px`);
    const frequency = name === 'ChromaSpiralPlugin' ? 440 : 200;
    const point = name === 'ChromaSpiralPlugin'
      ? h.instance.axis.toPoint(frequency)
      : { x: h.instance.axis.toPos(frequency), y: 100 };
    h.event('pointerdown', { clientX: h.instance.box.left + point.x,
      clientY: h.instance.box.top + point.y });
    assert.ok(Math.abs(h.posts.at(-1) / frequency - 1) < 1e-10,
      `${name}: expected ${frequency} Hz, got ${h.posts.at(-1)} Hz`);
    h.preview.stop();
  }
});
