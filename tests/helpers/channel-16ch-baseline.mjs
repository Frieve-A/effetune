import fs from 'node:fs';
import vm from 'node:vm';
import { gunzipSync, gzipSync } from 'node:zlib';

class BaselineElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.dataset = {};
    this.classList = {
      add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); }
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener() {}

  replaceChildren(...children) { this.children = children; }

  querySelectorAll(tagName) {
    return this.children.flatMap(child => [
      ...(child.tagName === tagName ? [child] : []), ...child.querySelectorAll(tagName)
    ]);
  }

  getContext() { return null; }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

function createBaselineDocument() {
  return {
    createElement(tagName) {
      return new BaselineElement(tagName);
    },
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; }
  };
}

class BaselineObserver {
  observe() {}
  disconnect() {}
}

export function loadBaselinePlugin(relativePath, exportName, { window = {} } = {}) {
  const document = createBaselineDocument();
  const context = vm.createContext({
    window,
    document,
    console,
    MutationObserver: BaselineObserver,
    IntersectionObserver: BaselineObserver,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    Float32Array,
    Float64Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    ArrayBuffer,
    DataView
  });
  window.window = window;
  window.document = document;

  const pluginBasePath = new URL('../../plugins/plugin-base.js', import.meta.url);
  const pluginPath = new URL(`../../plugins/${relativePath}`, import.meta.url);
  vm.runInContext(fs.readFileSync(pluginBasePath, 'utf8'), context, {
    filename: 'plugins/plugin-base.js'
  });
  vm.runInContext(fs.readFileSync(pluginPath, 'utf8'), context, {
    filename: `plugins/${relativePath}`
  });

  return window[exportName];
}

export function serializeBaselineDom(element, { normalizeMatrixSticky = false } = {}) {
  const nodes = [];
  const childrenOf = node => normalizeMatrixSticky && node.tagName === 'table'
    ? node.children.flatMap(child => ['thead', 'tbody'].includes(child.tagName) ? child.children : [child])
    : node.children;
  const visit = node => {
    const children = childrenOf(node);
    nodes.push([
      node.tagName,
      normalizeMatrixSticky && node.tagName === 'th'
        ? node.className.split(' ').filter(name => ![
          'matrix-sticky-header', 'matrix-sticky-channel-header', 'matrix-sticky-row', 'matrix-sticky-corner'
        ].includes(name)).join(' ')
        : node.className,
      Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b)),
      node.textContent,
      children.length
    ]);
    children.forEach(visit);
  };
  visit(element);
  return nodes;
}

export function encodeBaselineDom(element) {
  return gzipSync(JSON.stringify(serializeBaselineDom(element))).toString('base64');
}

export function decodeBaselineDom(encoded) {
  return JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
}
