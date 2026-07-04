import assert from 'node:assert/strict';
import test from 'node:test';

import { MobileNav } from '../../js/ui/mobile-nav.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.id = '';
    this.className = '';
    this.innerHTML = '';
    this.textContent = '';
    this.type = '';
    this.title = '';
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : !!force;
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      }
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  prepend(child) {
    child.parentNode = this;
    this.children.unshift(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.eventListeners.set(type, (this.eventListeners.get(type) || []).filter(candidate => candidate !== listener));
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

function createDocument() {
  const listeners = new Map();
  const body = new FakeElement('body');
  const mainContainer = new FakeElement('div');
  mainContainer.className = 'main-container';
  const pluginList = new FakeElement('div');
  pluginList.id = 'pluginList';
  body.appendChild(mainContainer);

  return {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === '.main-container') return mainContainer;
      return null;
    },
    getElementById(id) {
      if (id === 'pluginList') return pluginList;
      return null;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    }
  };
}

test('MobileNav updates the resume prompt on AudioContext statechange', async () => {
  const documentRef = createDocument();
  const audioContextListeners = new Map();
  const audioContext = {
    state: 'suspended',
    addEventListener(type, listener) {
      audioContextListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (audioContextListeners.get(type) === listener) {
        audioContextListeners.delete(type);
      }
    }
  };
  const layoutMode = {
    mode: 'mobile',
    isMobile: true,
    onChange() {
      return () => {};
    }
  };

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    const nav = new MobileNav({
      layoutMode,
      audioManager: { audioContext },
      audioPlayer: null
    });

    assert.equal(nav.resumePrompt.hidden, false);
    assert.equal(typeof audioContextListeners.get('statechange'), 'function');

    audioContext.state = 'running';
    audioContextListeners.get('statechange')();
    assert.equal(nav.resumePrompt.hidden, true);

    nav.dispose();
    assert.equal(audioContextListeners.size, 0);
  });
});
