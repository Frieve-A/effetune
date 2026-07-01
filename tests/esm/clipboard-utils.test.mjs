import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copyTextToClipboard,
  readTextFromClipboard
} from '../../js/utils/clipboard-utils.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createLegacyDocument({
  execResult = true,
  execThrows = false,
  focusThrows = false,
  createThrows = false,
  attachParent = true,
  selection = null,
  activeElement = null
} = {}) {
  const appended = [];
  const removed = [];
  const body = {
    appendChild(node) {
      if (attachParent) {
        node.parentNode = body;
      }
      appended.push(node);
    },
    removeChild(node) {
      removed.push(node);
      node.parentNode = null;
    }
  };
  const textarea = {
    value: '',
    style: {},
    attributes: {},
    focused: false,
    selected: false,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {
      if (focusThrows) throw new Error('focus failed');
      this.focused = true;
    },
    select() {
      this.selected = true;
    }
  };

  return {
    appended,
    removed,
    textarea,
    activeElement,
    getSelection: selection ? () => selection : undefined,
    createElement(tagName) {
      assert.equal(tagName, 'textarea');
      if (createThrows) throw new Error('dom unavailable');
      return textarea;
    },
    body,
    execCommand(command) {
      assert.equal(command, 'copy');
      if (execThrows) throw new Error('copy command failed');
      return execResult;
    }
  };
}

test('copyTextToClipboard prefers the Electron preload bridge', async () => {
  const calls = [];

  await withGlobals({
    window: { electronAPI: { writeClipboardText: async text => { calls.push(text); return true; } } },
    navigator: { clipboard: { writeText: async () => { throw new Error('should not use web clipboard'); } } }
  }, async () => {
    assert.equal(await copyTextToClipboard('preset'), true);
    assert.deepEqual(calls, ['preset']);
  });
});

test('copyTextToClipboard falls back from Electron failure to the web Clipboard API', async () => {
  const calls = [];

  await withGlobals({
    window: { electronAPI: { writeClipboardText: async () => false } },
    navigator: { clipboard: { writeText: async text => calls.push(text) } }
  }, async () => {
    assert.equal(await copyTextToClipboard('browser preset'), true);
    assert.deepEqual(calls, ['browser preset']);
  });
});

test('copyTextToClipboard works without a window global', async () => {
  const calls = [];

  await withGlobals({
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document: { body: null, execCommand: () => true }
  }, async () => {
    assert.equal(await copyTextToClipboard('windowless copy'), true);
    assert.deepEqual(calls, ['windowless copy']);
  });
});

test('copyTextToClipboard skips non-function Electron and web clipboard writers', async () => {
  await withGlobals({
    window: { electronAPI: { writeClipboardText: 'not a function' } },
    navigator: { clipboard: {} },
    document: { body: null, execCommand: () => true }
  }, async () => {
    assert.equal(await copyTextToClipboard('no writers'), false);
  });
});

test('copyTextToClipboard falls back when the Electron bridge throws', async () => {
  const calls = [];

  await withGlobals({
    window: { electronAPI: { writeClipboardText: async () => { throw new Error('bridge failed'); } } },
    navigator: { clipboard: { writeText: async text => calls.push(text) } }
  }, async () => {
    assert.equal(await copyTextToClipboard('after bridge error'), true);
    assert.deepEqual(calls, ['after bridge error']);
  });
});

test('copyTextToClipboard uses the textarea selection path before web clipboard writes', async () => {
  const range = { cloneRange: () => ({ id: 'cloned-range' }) };
  const restoredRanges = [];
  const selection = {
    rangeCount: 1,
    getRangeAt: index => {
      assert.equal(index, 0);
      return range;
    },
    removeAllRanges: () => restoredRanges.push(['removeAllRanges']),
    addRange: restoredRange => restoredRanges.push(['addRange', restoredRange])
  };
  const focusCalls = [];
  const activeElement = {
    focus(options) {
      focusCalls.push(options);
      if (focusCalls.length === 1) {
        throw new Error('preventScroll unsupported');
      }
    }
  };
  const document = createLegacyDocument({ selection, activeElement });

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async () => { throw new Error('should not use web clipboard'); } } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('legacy copy'), true);
    assert.equal(document.textarea.value, 'legacy copy');
    assert.deepEqual(document.textarea.attributes, { readonly: '' });
    assert.equal(document.textarea.focused, true);
    assert.equal(document.textarea.selected, true);
    assert.deepEqual(document.appended, [document.textarea]);
    assert.deepEqual(document.removed, [document.textarea]);
    assert.deepEqual(restoredRanges, [['removeAllRanges'], ['addRange', { id: 'cloned-range' }]]);
    assert.deepEqual(focusCalls, [{ preventScroll: true }, undefined]);
  });
});

test('copyTextToClipboard handles empty selections and detached textareas', async () => {
  const selectionCalls = [];
  const selection = {
    rangeCount: 0,
    getRangeAt: () => { throw new Error('no ranges should be read'); },
    removeAllRanges: () => selectionCalls.push(['removeAllRanges']),
    addRange: range => selectionCalls.push(['addRange', range])
  };
  const document = createLegacyDocument({
    attachParent: false,
    selection,
    activeElement: { focus: 'not a function' }
  });

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async () => { throw new Error('should not use web clipboard'); } } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('detached textarea'), true);
    assert.deepEqual(document.appended, [document.textarea]);
    assert.deepEqual(document.removed, []);
    assert.deepEqual(selectionCalls, [['removeAllRanges']]);
  });
});

test('copyTextToClipboard handles a present getSelection API with no selection', async () => {
  const document = createLegacyDocument();
  document.getSelection = () => null;

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async () => { throw new Error('should not use web clipboard'); } } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('no active selection'), true);
    assert.deepEqual(document.removed, [document.textarea]);
  });
});

test('copyTextToClipboard falls back when restoring the previous selection fails', async () => {
  const calls = [];
  const document = createLegacyDocument({
    execThrows: true,
    selection: {
      rangeCount: 1,
      getRangeAt: () => ({ cloneRange: () => ({ id: 'range' }) }),
      removeAllRanges: () => { throw new Error('selection restore failed'); },
      addRange: () => { throw new Error('should not add ranges after restore failure'); }
    }
  });

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('after selection restore failure'), true);
    assert.deepEqual(calls, ['after selection restore failure']);
  });
});

test('copyTextToClipboard falls back when restoring focus fails', async () => {
  const calls = [];
  const document = createLegacyDocument({
    execThrows: true,
    activeElement: { focus: () => { throw new Error('focus restore failed'); } }
  });

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('after focus restore failure'), true);
    assert.deepEqual(calls, ['after focus restore failure']);
  });
});

test('copyTextToClipboard falls back to web clipboard when selection copy cannot run', async () => {
  const calls = [];

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document: { body: null, execCommand: () => true }
  }, async () => {
    assert.equal(await copyTextToClipboard('web copy'), true);
    assert.deepEqual(calls, ['web copy']);
  });
});

test('copyTextToClipboard falls back to web clipboard when selection copy throws', async () => {
  const calls = [];
  const focusCalls = [];
  const document = createLegacyDocument({
    execThrows: true,
    activeElement: { focus: options => focusCalls.push(options) }
  });

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('after exec failure'), true);
    assert.deepEqual(calls, ['after exec failure']);
    assert.deepEqual(document.removed, [document.textarea]);
    assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  });
});

test('copyTextToClipboard falls back to web clipboard when textarea focus throws', async () => {
  const calls = [];
  const document = createLegacyDocument({ focusThrows: true });

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document
  }, async () => {
    assert.equal(await copyTextToClipboard('after focus failure'), true);
    assert.deepEqual(calls, ['after focus failure']);
    assert.deepEqual(document.removed, [document.textarea]);
  });
});

test('copyTextToClipboard falls back to web clipboard when execCommand is unavailable', async () => {
  const calls = [];

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async text => calls.push(text) } },
    document: { body: {}, execCommand: null }
  }, async () => {
    assert.equal(await copyTextToClipboard('no execCommand'), true);
    assert.deepEqual(calls, ['no execCommand']);
  });
});

test('copyTextToClipboard logs web clipboard write failures', async () => {
  const errors = [];

  await withGlobals({
    window: {},
    navigator: { clipboard: { writeText: async () => { throw new Error('permission denied'); } } },
    document: { body: null, execCommand: () => true },
    console: { ...console, error: (...args) => errors.push(args) }
  }, async () => {
    assert.equal(await copyTextToClipboard('uncopyable web'), false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], '[clipboard] copy failed:');
  });
});

test('copyTextToClipboard returns false when selection setup throws and no web clipboard exists', async () => {
  await withGlobals({
    window: {},
    navigator: {},
    document: createLegacyDocument({ createThrows: true })
  }, async () => {
    assert.equal(await copyTextToClipboard('uncopyable'), false);
  });
});

test('copyTextToClipboard returns false when navigator is unavailable after selection fails', async () => {
  await withGlobals({
    window: {},
    navigator: undefined,
    document: { body: null, execCommand: () => true }
  }, async () => {
    assert.equal(await copyTextToClipboard('no navigator'), false);
  });
});

test('readTextFromClipboard prefers Electron clipboard text when it is a string', async () => {
  await withGlobals({
    window: { electronAPI: { readClipboardText: async () => 'electron text' } },
    navigator: { clipboard: { readText: async () => 'web text' } }
  }, async () => {
    assert.equal(await readTextFromClipboard(), 'electron text');
  });
});

test('readTextFromClipboard falls back when Electron returns a non-string value', async () => {
  await withGlobals({
    window: { electronAPI: { readClipboardText: async () => null } },
    navigator: { clipboard: { readText: async () => 'web text' } }
  }, async () => {
    assert.equal(await readTextFromClipboard(), 'web text');
  });
});

test('readTextFromClipboard works without a window global', async () => {
  await withGlobals({
    navigator: { clipboard: { readText: async () => 'windowless read' } }
  }, async () => {
    assert.equal(await readTextFromClipboard(), 'windowless read');
  });
});

test('readTextFromClipboard returns empty text when clipboard readers are missing', async () => {
  await withGlobals({
    window: { electronAPI: { readClipboardText: 'not a function' } },
    navigator: { clipboard: {} }
  }, async () => {
    assert.equal(await readTextFromClipboard(), '');
  });
});

test('readTextFromClipboard falls back when Electron clipboard read throws', async () => {
  await withGlobals({
    window: { electronAPI: { readClipboardText: async () => { throw new Error('bridge read failed'); } } },
    navigator: { clipboard: { readText: async () => 'web after bridge error' } }
  }, async () => {
    assert.equal(await readTextFromClipboard(), 'web after bridge error');
  });
});

test('readTextFromClipboard logs and returns empty text when web clipboard read fails', async () => {
  const errors = [];

  await withGlobals({
    window: {},
    navigator: { clipboard: { readText: async () => { throw new Error('read denied'); } } },
    console: { ...console, error: (...args) => errors.push(args) }
  }, async () => {
    assert.equal(await readTextFromClipboard(), '');
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], '[clipboard] read failed:');
  });
});

test('readTextFromClipboard returns empty text when no clipboard API is available', async () => {
  await withGlobals({
    window: {},
    navigator: {}
  }, async () => {
    assert.equal(await readTextFromClipboard(), '');
  });
});

test('readTextFromClipboard returns empty text when navigator is unavailable', async () => {
  await withGlobals({
    window: {},
    navigator: undefined
  }, async () => {
    assert.equal(await readTextFromClipboard(), '');
  });
});
