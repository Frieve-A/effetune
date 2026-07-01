import assert from 'node:assert/strict';

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.forEach(token => this.tokens.add(token));
    this.element.className = [...this.tokens].join(' ');
  }

  remove(...tokens) {
    tokens.forEach(token => this.tokens.delete(token));
    this.element.className = [...this.tokens].join(' ');
  }

  toggle(token, force) {
    const shouldAdd = force === undefined ? !this.tokens.has(token) : Boolean(force);
    if (shouldAdd) this.add(token);
    else this.remove(token);
    return shouldAdd;
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

function createElement(documentRef, tagName, id = '') {
  const element = {
    tagName: tagName.toUpperCase(),
    ownerDocument: documentRef,
    id,
    className: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    parentNode: null,
    children: [],
    childNodes: [],
    dataset: {},
    listeners: new Map(),
    style: {
      setProperty(name, value) {
        this[name] = value;
      }
    },
    classList: null,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      this.childNodes = this.children;
      if (child.id) documentRef.elementsById.set(child.id, child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter(candidate => candidate !== child);
      this.childNodes = this.children;
      child.parentNode = null;
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.children.indexOf(before);
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
      this.childNodes = this.children;
      if (child.id) documentRef.elementsById.set(child.id, child);
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) || []) {
        listener({ target: this, ...event });
      }
    },
    click() {
      for (const listener of this.listeners.get('click') || []) {
        listener({ preventDefault() {}, stopPropagation() {} });
      }
      if (typeof this.onclick === 'function') this.onclick();
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    matches(selector) {
      if (selector === 'input, textarea') return this.tagName === 'INPUT' || this.tagName === 'TEXTAREA';
      if (selector === 'input[type="range"]') return this.tagName === 'INPUT' && this.type === 'range';
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      return this.tagName.toLowerCase() === selector.toLowerCase();
    },
    closest(selector) {
      return this.matches(selector) ? this : null;
    },
    contains(target) {
      return this === target || this.children.includes(target);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    getAttribute(name) {
      return this[name];
    },
    focus() {},
    select() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    }
  };
  element.classList = new FakeClassList(element);
  return element;
}

function createDocument() {
  const documentRef = {
    elementsById: new Map(),
    listeners: new Map(),
    hidden: false,
    head: null,
    body: null,
    documentElement: null,
    createElement(tagName) {
      return createElement(documentRef, tagName);
    },
    getElementById(id) {
      if (!documentRef.elementsById.has(id)) {
        documentRef.elementsById.set(id, createElement(documentRef, 'div', id));
      }
      return documentRef.elementsById.get(id);
    },
    querySelector(selector) {
      if (selector === '.whats-this') return documentRef.getElementById('whatsThis');
      if (selector === '.toggle-button.master-toggle') {
        const toggle = documentRef.getElementById('masterToggle');
        toggle.classList.add('toggle-button', 'master-toggle');
        return toggle;
      }
      if (selector === '.pipeline-header h2' || selector === '.subtitle') {
        return documentRef.getElementById(selector.replace(/\W+/g, '-'));
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, listener) {
      if (!documentRef.listeners.has(type)) documentRef.listeners.set(type, []);
      documentRef.listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!documentRef.listeners.has(type)) return;
      documentRef.listeners.set(type, documentRef.listeners.get(type).filter(candidate => candidate !== listener));
    }
  };
  documentRef.head = createElement(documentRef, 'head', 'head');
  documentRef.body = createElement(documentRef, 'body', 'body');
  documentRef.documentElement = createElement(documentRef, 'html', 'html');
  return documentRef;
}

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

const calls = [];
const documentRef = createDocument();
const windowListeners = new Map();
const electronTarget = {
  ipc: new Map(),
  closeCallback: null,
  async isFirstLaunch() {
    calls.push(['isFirstLaunch']);
    return false;
  },
  onRequestPipelineStateForClose(callback) {
    calls.push(['onRequestPipelineStateForClose', typeof callback]);
    this.closeCallback = callback;
  },
  sendPipelineStateForClose(state) {
    calls.push(['sendPipelineStateForClose', state]);
  },
  onIPC(channel, listener) {
    calls.push(['onIPC', channel, typeof listener]);
    this.ipc.set(channel, listener);
  },
  armRendererWatchdog(reason) {
    calls.push(['armRendererWatchdog', reason]);
    return Promise.resolve();
  },
  rendererPing() {
    calls.push(['rendererPing']);
  },
  async getAppVersion() {
    calls.push(['getAppVersion']);
    return '1.2.3';
  },
  async loadConfig() {
    calls.push(['loadConfig']);
    return { success: true, config: {} };
  },
  async loadAudioPreferences() {
    calls.push(['loadAudioPreferences']);
    return { success: true, preferences: null };
  },
  async updateApplicationMenu() {
    calls.push(['updateApplicationMenu']);
    return { success: true };
  },
  async updateTrayMenu() {
    calls.push(['updateTrayMenu']);
    return { success: true };
  },
  async getUserPresetsForTray() {
    calls.push(['getUserPresetsForTray']);
    return { success: true, presets: [] };
  }
};
const electronAPI = new Proxy(electronTarget, {
  get(target, property) {
    if (property in target) return target[property];
    if (String(property).startsWith('on')) {
      return callback => calls.push([String(property), typeof callback]);
    }
    return async () => ({ success: false });
  }
});
const windowRef = {
  electronAPI,
  appConfig: {},
  location: {
    search: '',
    reload() {
      calls.push(['location.reload']);
    }
  },
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    if (!windowListeners.has(type)) return;
    windowListeners.set(type, windowListeners.get(type).filter(candidate => candidate !== listener));
  },
  open(url, target) {
    calls.push(['window.open', url, target]);
  }
};

setGlobal('window', windowRef);
setGlobal('document', documentRef);
setGlobal('navigator', {
  language: 'en-US',
  userAgent: 'Mozilla/5.0',
  mediaDevices: {
    addEventListener(type, listener) {
      calls.push(['mediaDevices.addEventListener', type, typeof listener]);
    },
    async enumerateDevices() {
      calls.push(['enumerateDevices']);
      return [];
    }
  }
});
setGlobal('localStorage', createLocalStorage());
setGlobal('requestAnimationFrame', callback => {
  callback();
  return calls.length;
});
setGlobal('setTimeout', (callback, delay) => {
  calls.push(['setTimeout', delay]);
  callback();
  return calls.length;
});
setGlobal('clearTimeout', id => calls.push(['clearTimeout', id]));
setGlobal('setInterval', (callback, delay) => {
  calls.push(['setInterval', delay, typeof callback]);
  return calls.length;
});
setGlobal('clearInterval', id => calls.push(['clearInterval', id]));
setGlobal('fetch', async url => {
  calls.push(['fetch', String(url)]);
  if (String(url).includes('js/locales/')) {
    return { ok: true, async text() { return '{}'; } };
  }
  throw new Error(`blocked test fetch: ${url}`);
});
setGlobal('console', {
  ...console,
  log(...args) { calls.push(['console.log', ...args]); },
  warn(...args) { calls.push(['console.warn', ...args]); },
  error(...args) { calls.push(['console.error', ...args]); }
});

const mod = await import('../../js/app.js');
for (let i = 0; i < 8; i++) {
  await Promise.resolve();
}

assert.equal(windowRef.app instanceof mod.App, true);
assert.equal(windowRef.isFirstLaunch, false);
assert.equal(windowRef.app.initialized, true);
assert.equal(electronTarget.closeCallback instanceof Function, true);
assert.equal(electronTarget.ipc.has('load-preset-from-tray'), true);
electronTarget.closeCallback();

assert.equal(calls.some(call => call[0] === 'isFirstLaunch'), true);
assert.equal(calls.some(call => call[0] === 'onRequestPipelineStateForClose'), true);
assert.equal(calls.some(call => call[0] === 'armRendererWatchdog' && call[1] === 'main-page'), true);
assert.equal(calls.some(call => call[0] === 'rendererPing'), true);
assert.deepEqual(calls.find(call => call[0] === 'sendPipelineStateForClose'), ['sendPipelineStateForClose', null]);
assert.equal(documentRef.head.children.some(child => child.id === 'temp-hide-style'), false);
