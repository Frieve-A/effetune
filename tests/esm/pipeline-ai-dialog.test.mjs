import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineAIDialog } from '../../js/ui/pipeline/pipeline-ai-dialog.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName, calls = []) {
    this.tagName = tagName.toUpperCase();
    this.calls = calls;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.placeholder = '';
    this.title = '';
    this.value = '';
    this.rows = 0;
    this.onclick = null;
    this.removed = false;
    this.focused = false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    this.removed = true;
    this.parentNode?.removeChild(this);
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some(child => child.contains?.(target));
  }

  focus() {
    this.focused = true;
    this.calls.push(['focus', this.className]);
  }
}

function createDocument(calls, options = {}) {
  const documentRef = {
    currentDialog: options.existingDialog ?? null,
    listeners: new Map(),
    body: null,
    createElement(tagName) {
      calls.push(['createElement', tagName]);
      return new FakeElement(tagName, calls);
    },
    querySelector(selector) {
      calls.push(['querySelector', selector]);
      if (selector === '.ai-dialog') return documentRef.currentDialog;
      return null;
    },
    addEventListener(type, listener) {
      calls.push(['documentAddEventListener', type]);
      documentRef.listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      calls.push(['documentRemoveEventListener', type, listener === documentRef.listeners.get(type)]);
      documentRef.listeners.delete(type);
    }
  };

  documentRef.body = new FakeElement('body', calls);
  const appendToBody = documentRef.body.appendChild.bind(documentRef.body);
  documentRef.body.appendChild = child => {
    calls.push(['bodyAppend', child.className]);
    if (child.className === 'ai-dialog') {
      documentRef.currentDialog = child;
    }
    return appendToBody(child);
  };

  return documentRef;
}

function createWindow(calls, options = {}) {
  const windowRef = {
    uiManager: options.uiManager === false ? null : {
      t(key, params) {
        calls.push(['translate', key, params ?? null]);
        return params?.effectName ? `T:${key}:${params.effectName}` : `T:${key}`;
      }
    },
    open(url, target) {
      calls.push(['windowOpen', url, target]);
      if (options.throwOpen) {
        throw new Error('open failed');
      }
    }
  };

  if (Object.prototype.hasOwnProperty.call(options, 'electronAPI')) {
    windowRef.electronAPI = options.electronAPI;
  }

  return windowRef;
}

function createHandler(options = {}) {
  return new PipelineAIDialog({
    pluginManager: options.pluginManager ?? { id: 'plugins' }
  });
}

async function withAIGlobals(calls, options, callback) {
  const timeouts = [];
  const documentRef = options.document ?? createDocument(calls, options);
  await withGlobals({
    document: documentRef,
    window: options.window ?? createWindow(calls, options),
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timeouts.push(fn);
      return timeouts.length;
    },
    console: options.console ?? console
  }, async () => callback({ documentRef, timeouts }));
}

test('constructor and showAIDialog replace existing dialogs and build translated content', async () => {
  const calls = [];
  const existingDialog = new FakeElement('div', calls);
  const documentRef = createDocument(calls, { existingDialog });
  const handler = createHandler();

  await withAIGlobals(calls, { document: documentRef }, async ({ documentRef, timeouts }) => {
    handler.showAIDialog({ name: 'Compressor' }, {});

    assert.equal(handler.pluginManager.id, 'plugins');
    assert.equal(existingDialog.removed, true);
    assert.equal(documentRef.body.children.length, 1);
    assert.equal(documentRef.currentDialog.className, 'ai-dialog');
    assert.equal(documentRef.currentDialog.style.position, 'fixed');
    assert.equal(documentRef.currentDialog.style.transform, 'translate(-50%, -50%)');
    assert.equal(documentRef.currentDialog.children.length, 4);

    const [header, caption, textArea, buttons] = documentRef.currentDialog.children;
    assert.equal(header.textContent, 'T:ui.askAITitle');
    assert.equal(header.children[0].title, 'T:ui.title.close');
    assert.equal(caption.textContent, 'T:ui.askAICaption:Compressor');
    assert.equal(textArea.placeholder, 'T:ui.askAIPlaceholder');
    assert.equal(textArea.rows, 4);
    assert.equal(textArea.focused, true);
    assert.deepEqual(buttons.children.map(button => button.textContent), ['T:ui.askChatGPT', 'T:ui.askPerplexity']);
    assert.equal(timeouts.length, 1);
  });
});

test('helper creators use fallback labels, close buttons, and AI button handlers', async () => {
  const calls = [];
  const documentRef = createDocument(calls);
  const handler = createHandler();

  await withAIGlobals(calls, { document: documentRef, uiManager: false }, async () => {
    const header = handler.createDialogHeader();
    assert.equal(header.textContent, 'Ask the AI about this effector');
    assert.equal(header.children[0].title, 'Close');

    const activeDialog = new FakeElement('div', calls);
    documentRef.currentDialog = activeDialog;
    header.children[0].onclick();
    assert.equal(activeDialog.removed, true);
    documentRef.currentDialog = null;
    assert.doesNotThrow(() => header.children[0].onclick());

    const caption = handler.createCaption({ name: 'Limiter' });
    assert.equal(caption.textContent, 'Question about Limiter:');

    const textArea = handler.createTextArea();
    textArea.value = 'How should I set this?';
    assert.equal(textArea.placeholder, 'Type your question about this effect...');

    const delegated = [];
    handler.askAI = async (service, plugin, text) => {
      delegated.push([service, plugin.name, text]);
    };
    const container = handler.createButtonContainer({ name: 'Limiter' }, textArea);
    assert.deepEqual(container.children.map(button => button.textContent), ['Ask ChatGPT', 'Ask Perplexity']);
    container.children[0].onclick();
    container.children[1].onclick();
    assert.deepEqual(delegated, [
      ['chatgpt', 'Limiter', 'How should I set this?'],
      ['perplexity', 'Limiter', 'How should I set this?']
    ]);
  });
});

test('askAI opens ChatGPT and Perplexity through Electron and browser fallbacks', async () => {
  const plugin = { name: 'Stereo Widener' };

  const electronCalls = [];
  const electronDialog = new FakeElement('div', electronCalls);
  await withAIGlobals(electronCalls, {
    existingDialog: electronDialog,
    electronAPI: {
      openExternalUrl(url) {
        electronCalls.push(['electronOpen', url]);
        return Promise.resolve();
      }
    }
  }, async () => {
    await createHandler().askAI('chatgpt', plugin, 'Explain safe values');
  });
  assert.equal(electronCalls.find(call => call[0] === 'electronOpen')[1].startsWith('https://chatgpt.com/?q='), true);
  assert.equal(electronDialog.removed, true);

  const rejectedCalls = [];
  await withAIGlobals(rejectedCalls, {
    electronAPI: {
      openExternalUrl(url) {
        rejectedCalls.push(['electronOpen', url]);
        return Promise.reject(new Error('blocked'));
      }
    }
  }, async () => {
    await createHandler().askAI('perplexity', plugin, 'Compare settings');
    await flushMicrotasks();
  });
  assert.equal(rejectedCalls.find(call => call[0] === 'electronOpen')[1].startsWith('https://www.perplexity.ai/search?q='), true);
  assert.equal(rejectedCalls.some(call => call[0] === 'windowOpen' && call[2] === '_blank'), true);

  const browserCalls = [];
  await withAIGlobals(browserCalls, {}, async () => {
    await createHandler().askAI('perplexity', plugin, 'Browser path');
  });
  assert.equal(browserCalls.find(call => call[0] === 'windowOpen')[1].startsWith('https://www.perplexity.ai/search?q='), true);

  const missingMethodCalls = [];
  await withAIGlobals(missingMethodCalls, { electronAPI: {} }, async () => {
    await createHandler().askAI('unknown', plugin, 'No matching service');
  });
  assert.deepEqual(missingMethodCalls.filter(call => call[0] === 'windowOpen'), [
    ['windowOpen', undefined, '_blank']
  ]);
});

test('askAI logs unexpected opening errors', async () => {
  const calls = [];
  const consoleCalls = [];

  await withAIGlobals(calls, {
    throwOpen: true,
    console: {
      error(...args) {
        consoleCalls.push(args);
      }
    }
  }, async () => {
    await createHandler().askAI('perplexity', { name: 'EQ' }, 'Why?');
  });

  assert.equal(consoleCalls.length, 1);
  assert.equal(consoleCalls[0][0], 'Error asking AI:');
});

test('setupCloseHandler ignores inside clicks and removes outside-click dialogs', async () => {
  const calls = [];
  const dialog = new FakeElement('div', calls);
  const child = new FakeElement('button', calls);
  const outside = new FakeElement('div', calls);
  dialog.appendChild(child);

  await withAIGlobals(calls, {}, async ({ documentRef, timeouts }) => {
    createHandler().setupCloseHandler(dialog);
    assert.equal(timeouts.length, 1);

    timeouts[0]();
    const listener = documentRef.listeners.get('click');
    listener({ target: child });
    assert.equal(dialog.removed, false);
    assert.equal(documentRef.listeners.has('click'), true);

    listener({ target: outside });
    assert.equal(dialog.removed, true);
    assert.equal(documentRef.listeners.has('click'), false);
  });
});
