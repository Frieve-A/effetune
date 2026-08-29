import fs from 'node:fs';
import vm from 'node:vm';

export const overlaySource = fs.readFileSync(new URL('../../plugins/spectrum-overlay.js', import.meta.url), 'utf8');

export function loadOverlay(overrides = {}) {
  const context = { window: {}, console, ...overrides };
  vm.runInNewContext(overlaySource, context);
  return context.window.SpectrumOverlay;
}

export class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; }
    };
    const classes = new Set();
    this.classList = {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    };
    this.className = '';
    this.width = 300;
    this.height = 150;
    this.drawCalls = [];
    this.drawTextStates = [];
  }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  getContext() {
    const calls = this.drawCalls;
    const textStates = this.drawTextStates;
    const stack = [];
    return {
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      ...Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke']
        .map(name => [name, (...args) => calls.push([name, ...args])])),
      save() {
        stack.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline });
        calls.push(['save']);
      },
      restore() {
        Object.assign(this, stack.pop());
        calls.push(['restore']);
      },
      translate(...args) { calls.push(['translate', ...args]); },
      rotate(...args) { calls.push(['rotate', ...args]); },
      fillText(...args) {
        calls.push(['fillText', ...args, this.textBaseline]);
        textStates.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline });
      }
    };
  }
}

export function createOverlayHarness() {
  let now = 0;
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  const intersections = new Set();
  const resizes = new Set();
  const posts = [];
  function makeNode() {
    const listeners = new Set();
    return {
      listeners,
      port: {
        postMessage(message) { posts.push(message); },
        addEventListener(type, handler) { listeners.add(handler); },
        removeEventListener(type, handler) { listeners.delete(handler); }
      }
    };
  }
  const window = { workletNode: makeNode(), devicePixelRatio: 2, audioManager: { pipeline: [] } };
  class Observer {
    constructor(callback, set) { this.callback = callback; this.set = set; set.add(this); }
    observe(element) { this.element = element; }
    disconnect() { this.set.delete(this); }
  }
  const overlay = loadOverlay({
    window,
    document: { createElement: name => new Element(name) },
    performance: { now: () => now },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    IntersectionObserver: class extends Observer { constructor(cb) { super(cb, intersections); } },
    ResizeObserver: class extends Observer { constructor(cb) { super(cb, resizes); } }
  });
  const plugin = {
    id: 7,
    constructor: { name: 'BandPassFilterPlugin' },
    runnable: true,
    canRunAnimation() { return this.runnable; },
    requestPowerAnimationFrame(callback, kind) {
      if (kind !== 'analyzer') throw Error('Wrong animation kind');
      if (!this.runnable) return null;
      const id = nextId++;
      frames.set(id, callback);
      return id;
    }
  };
  window.audioManager.pipeline = [plugin];
  function rootFor(targetPlugin = plugin) {
    const root = new Element();
    const mount = root.appendChild(new Element());
    const target = overlay.TARGETS.get(targetPlugin.constructor.name);
    const plot = target?.inset ? mount : mount.appendChild(new Element('canvas'));
    root.querySelector = selector => selector === target?.plotSelector ? plot : mount;
    return { root, mount, plot };
  }
  return {
    overlay, window, plugin, frames, timers, intersections, resizes, posts, makeNode, rootFor,
    attach() { const elements = rootFor(); return { ...elements, instance: overlay.attach(plugin, elements.root) }; },
    intersect(value) { for (const observer of [...intersections]) observer.callback([{ isIntersecting: value }]); },
    frame() {
      now += 16;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    }
  };
}
