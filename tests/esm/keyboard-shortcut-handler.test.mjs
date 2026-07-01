import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handlePipelineKeyboardShortcut,
  handlePipelinePasteEvent
} from '../../js/ui/pipeline/keyboard-shortcut-handler.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createTarget(kind = 'div', { range = false, contentEditable = false } = {}) {
  return {
    kind,
    isContentEditable: contentEditable,
    matches(selector) {
      if (selector === 'input, textarea') return kind === 'input' || kind === 'textarea';
      if (selector === 'input[type="range"]') return range;
      return false;
    }
  };
}

function createEvent(options = {}) {
  const event = {
    key: options.key,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    shiftKey: Boolean(options.shiftKey),
    target: Object.prototype.hasOwnProperty.call(options, 'target') ? options.target : createTarget(),
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented += 1;
    },
    stopPropagation() {
      this.stopped += 1;
    }
  };
  return event;
}

function createContext(options = {}) {
  const calls = [];
  const presetSelect = {
    ...createTarget('input'),
    value: options.presetValue ?? ' Preset Name ',
    focus: () => calls.push(['focus']),
    select: () => calls.push(['select'])
  };
  const pipeline = [{ id: 'a' }, { id: 'b' }];
  const selectedPlugins = new Set([{ id: 'old' }]);
  const selectedItems = [
    { classList: { remove: name => calls.push(['removeClass', name, 0]) } },
    { classList: { remove: name => calls.push(['removeClass', name, 1]) } }
  ];

  const context = {
    calls,
    presetSelect,
    historyManager: {
      undo: () => calls.push(['undo']),
      redo: () => calls.push(['redo'])
    },
    pipelineManager: {
      presetManager: {
        presetSelect,
        savePreset: name => calls.push(['savePreset', name])
      },
      audioManager: { pipeline }
    },
    core: {
      selectedPlugins,
      pipelineList: {
        querySelectorAll: selector => {
          calls.push(['querySelectorAll', selector]);
          return selectedItems;
        }
      },
      updateSelectionClasses: () => calls.push(['updateSelectionClasses']),
      deleteSelectedPlugins: () => calls.push(['deleteSelectedPlugins'])
    },
    clipboardManager: {
      cutSelectedPlugins: () => calls.push(['cutSelectedPlugins']),
      copySelectedPluginsToClipboard: () => calls.push(['copySelectedPluginsToClipboard']),
      handlePaste: text => calls.push(['handlePaste', text])
    },
    uiManager: {
      setError: (...args) => calls.push(['setError', ...args])
    },
    documentRef: {
      activeElement: options.activeElement
    },
    readTextFromClipboard: options.readTextFromClipboard || (async () => '')
  };

  return context;
}

function callShortcut(event, context) {
  return handlePipelineKeyboardShortcut(event, {
    historyManager: context.historyManager,
    pipelineManager: context.pipelineManager,
    core: context.core,
    clipboardManager: context.clipboardManager,
    readTextFromClipboard: context.readTextFromClipboard,
    uiManager: context.uiManager,
    documentRef: context.documentRef
  });
}

test('Ctrl+Z is case-insensitive and performs undo outside text inputs', () => {
  const context = createContext();
  const event = createEvent({ key: 'Z', ctrlKey: true });

  assert.equal(callShortcut(event, context), true);
  assert.deepEqual(context.calls, [['undo']]);
  assert.equal(event.prevented, 1);
  assert.equal(event.stopped, 1);
});

test('Ctrl+Y performs redo from range inputs while ordinary inputs keep browser editing', () => {
  const rangeContext = createContext();
  const rangeEvent = createEvent({ key: 'y', ctrlKey: true, target: createTarget('input', { range: true }) });

  assert.equal(callShortcut(rangeEvent, rangeContext), true);
  assert.deepEqual(rangeContext.calls, [['redo']]);

  const textContext = createContext();
  const textEvent = createEvent({ key: 'z', ctrlKey: true, target: createTarget('input') });

  assert.equal(callShortcut(textEvent, textContext), false);
  assert.deepEqual(textContext.calls, []);
  assert.equal(textEvent.prevented, 0);
  assert.equal(textEvent.stopped, 0);
});

test('Ctrl+Shift+Z is not consumed by undo handling', () => {
  const context = createContext();
  const event = createEvent({ key: 'z', ctrlKey: true, shiftKey: true });

  assert.equal(callShortcut(event, context), false);
  assert.deepEqual(context.calls, []);
});

test('Ctrl+S focuses preset input and saves trimmed names', () => {
  const context = createContext({ presetValue: '  Reference Preset  ' });
  const event = createEvent({ key: 's', ctrlKey: true, target: createTarget('textarea') });

  assert.equal(callShortcut(event, context), true);
  assert.deepEqual(context.calls, [
    ['focus'],
    ['select'],
    ['savePreset', 'Reference Preset']
  ]);
});

test('Ctrl+Shift+S and blank preset names focus without saving', () => {
  const shiftContext = createContext({ presetValue: 'Named' });
  const shiftEvent = createEvent({ key: 's', ctrlKey: true, shiftKey: true });
  assert.equal(callShortcut(shiftEvent, shiftContext), true);
  assert.deepEqual(shiftContext.calls, [['focus'], ['select']]);

  const blankContext = createContext({ presetValue: '   ' });
  const blankEvent = createEvent({ key: 's', ctrlKey: true });
  assert.equal(callShortcut(blankEvent, blankContext), true);
  assert.deepEqual(blankContext.calls, [['focus'], ['select']]);
});

test('Escape clears preset text when the preset input is the event target', () => {
  const context = createContext({ presetValue: 'to clear' });
  const event = createEvent({ key: 'Escape', target: context.presetSelect });

  assert.equal(callShortcut(event, context), true);
  assert.equal(context.presetSelect.value, '');
  assert.deepEqual(context.calls, []);
});

test('non-save shortcuts are ignored while typing in text inputs', () => {
  const context = createContext();
  const event = createEvent({ key: 'a', ctrlKey: true, target: createTarget('textarea') });

  assert.equal(callShortcut(event, context), false);
  assert.deepEqual(context.calls, []);
});

test('contenteditable targets are treated as text editing targets', () => {
  const context = createContext();
  const event = createEvent({ key: 'a', ctrlKey: true, target: createTarget('div', { contentEditable: true }) });

  assert.equal(callShortcut(event, context), false);
  assert.deepEqual(context.calls, []);
});

test('Ctrl+A selects every plugin and updates selection classes', () => {
  const context = createContext();
  const event = createEvent({ key: 'a', ctrlKey: true });

  assert.equal(callShortcut(event, context), true);
  assert.deepEqual([...context.core.selectedPlugins], context.pipelineManager.audioManager.pipeline);
  assert.deepEqual(context.calls, [['updateSelectionClasses']]);
  assert.equal(event.prevented, 1);
  assert.equal(event.stopped, 1);
});

test('Ctrl+X cuts and Meta+C copies selected plugins', () => {
  const cutContext = createContext();
  const cutEvent = createEvent({ key: 'x', ctrlKey: true });
  assert.equal(callShortcut(cutEvent, cutContext), true);
  assert.deepEqual(cutContext.calls, [['cutSelectedPlugins']]);

  const copyContext = createContext();
  const copyEvent = createEvent({ key: 'c', metaKey: true });
  assert.equal(callShortcut(copyEvent, copyContext), true);
  assert.deepEqual(copyContext.calls, [['copySelectedPluginsToClipboard']]);
});

test('Escape clears active preset text before clearing pipeline selection', () => {
  const context = createContext({ presetValue: 'active preset' });
  context.documentRef.activeElement = context.presetSelect;
  const event = createEvent({ key: 'Escape' });

  assert.equal(callShortcut(event, context), true);
  assert.equal(context.presetSelect.value, '');
  assert.deepEqual(context.calls, []);
});

test('Escape clears selected plugins and selected item classes', () => {
  const context = createContext();
  const event = createEvent({ key: 'Escape' });

  assert.equal(callShortcut(event, context), true);
  assert.equal(context.core.selectedPlugins.size, 0);
  assert.deepEqual(context.calls, [
    ['querySelectorAll', '.pipeline-item'],
    ['removeClass', 'selected', 0],
    ['removeClass', 'selected', 1]
  ]);
});

test('Ctrl+V prevents browser paste and applies non-empty clipboard text', async () => {
  const context = createContext({ readTextFromClipboard: async () => 'pasted preset' });
  const event = createEvent({ key: 'v', ctrlKey: true });

  await withGlobals({ window: { electronAPI: { readClipboardText: async () => 'pasted preset' } } }, async () => {
    assert.equal(callShortcut(event, context), true);
    assert.equal(event.prevented, 1);
    assert.equal(event.stopped, 1);
    await flushMicrotasks();
  });
  assert.deepEqual(context.calls, [['handlePaste', 'pasted preset']]);
});

test('Ctrl+V ignores empty clipboard text', async () => {
  const context = createContext({ readTextFromClipboard: async () => '' });
  const event = createEvent({ key: 'v', ctrlKey: true });

  await withGlobals({ window: { electronAPI: { readClipboardText: async () => '' } } }, async () => {
    assert.equal(callShortcut(event, context), true);
    await flushMicrotasks();
  });
  assert.deepEqual(context.calls, []);
});

test('Ctrl+V reports clipboard read failures when a UI manager exists', async () => {
  const context = createContext({
    readTextFromClipboard: async () => { throw new Error('read failed'); }
  });
  const event = createEvent({ key: 'v', ctrlKey: true });

  await withGlobals({ window: { electronAPI: { readClipboardText: async () => { throw new Error('read failed'); } } } }, async () => {
    assert.equal(callShortcut(event, context), true);
    await flushMicrotasks();
  });
  assert.deepEqual(context.calls, [['setError', 'error.failedToReadClipboard', true]]);
});

test('Ctrl+V read failures are silent when no UI manager exists', async () => {
  const context = createContext({
    readTextFromClipboard: async () => { throw new Error('read failed'); }
  });
  context.uiManager = null;
  const event = createEvent({ key: 'v', ctrlKey: true });

  await withGlobals({ window: { electronAPI: { readClipboardText: async () => { throw new Error('read failed'); } } } }, async () => {
    assert.equal(callShortcut(event, context), true);
    await flushMicrotasks();
  });
  assert.deepEqual(context.calls, []);
});

test('Ctrl+V is left to the paste event path when no Electron clipboard bridge exists', () => {
  const context = createContext({ readTextFromClipboard: async () => 'not used' });
  const event = createEvent({ key: 'v', ctrlKey: true });

  assert.equal(callShortcut(event, context), false);
  assert.equal(event.prevented, 0);
  assert.equal(event.stopped, 0);
  assert.deepEqual(context.calls, []);
});

test('Ctrl+V is left to paste events when the Electron API lacks clipboard read', async () => {
  const context = createContext({ readTextFromClipboard: async () => 'not used' });
  const event = createEvent({ key: 'v', ctrlKey: true });

  await withGlobals({ window: { electronAPI: {} } }, async () => {
    assert.equal(callShortcut(event, context), false);
  });

  assert.equal(event.prevented, 0);
  assert.equal(event.stopped, 0);
  assert.deepEqual(context.calls, []);
});

test('Delete removes selected plugins and consumes the key event', () => {
  const context = createContext();
  const event = createEvent({ key: 'Delete' });

  assert.equal(callShortcut(event, context), true);
  assert.deepEqual(context.calls, [['deleteSelectedPlugins']]);
  assert.equal(event.prevented, 1);
  assert.equal(event.stopped, 1);
});

test('unhandled keys and missing key values leave the event untouched', () => {
  const context = createContext();
  const ordinaryEvent = createEvent({ key: 'F2' });
  const missingKeyEvent = createEvent();

  assert.equal(callShortcut(ordinaryEvent, context), false);
  assert.equal(callShortcut(missingKeyEvent, context), false);
  assert.deepEqual(context.calls, []);
  assert.equal(ordinaryEvent.prevented, 0);
  assert.equal(missingKeyEvent.stopped, 0);
});

test('default globals are usable when optional dependencies are omitted', async () => {
  const context = createContext();
  const event = createEvent({ key: 'Delete' });

  await withGlobals({
    window: { uiManager: context.uiManager },
    document: context.documentRef
  }, async () => {
    assert.equal(handlePipelineKeyboardShortcut(event, {
      historyManager: context.historyManager,
      pipelineManager: context.pipelineManager,
      core: context.core,
      clipboardManager: context.clipboardManager
    }), true);
  });

  assert.deepEqual(context.calls, [['deleteSelectedPlugins']]);
});

test('optional globals default to null outside browser-like environments', () => {
  const context = createContext();
  const event = createEvent({ key: 'Delete' });

  assert.equal(handlePipelineKeyboardShortcut(event, {
    historyManager: context.historyManager,
    pipelineManager: context.pipelineManager,
    core: context.core,
    clipboardManager: context.clipboardManager
  }), true);
  assert.deepEqual(context.calls, [['deleteSelectedPlugins']]);
});

test('Escape clears selection when no document reference is available', () => {
  const context = createContext();
  context.documentRef = null;
  const event = createEvent({ key: 'Escape' });

  assert.equal(callShortcut(event, context), true);
  assert.equal(context.core.selectedPlugins.size, 0);
  assert.deepEqual(context.calls, [
    ['querySelectorAll', '.pipeline-item'],
    ['removeClass', 'selected', 0],
    ['removeClass', 'selected', 1]
  ]);
});

test('targets without matches are treated as non-editing elements', () => {
  const context = createContext();
  const event = createEvent({ key: 'F4', target: {} });

  assert.equal(callShortcut(event, context), false);
  assert.deepEqual(context.calls, []);
});

test('null targets are treated as non-editing elements', () => {
  const context = createContext();
  const event = createEvent({ key: 'F5', target: null });

  assert.equal(callShortcut(event, context), false);
  assert.deepEqual(context.calls, []);
});

test('paste events ignore text editing targets, missing data, and empty text', () => {
  const inputContext = createContext();
  const inputEvent = createEvent({ target: createTarget('input') });
  inputEvent.clipboardData = { getData: () => 'ignored' };
  assert.equal(handlePipelinePasteEvent(inputEvent, { clipboardManager: inputContext.clipboardManager }), false);
  assert.deepEqual(inputContext.calls, []);

  const missingContext = createContext();
  const missingEvent = createEvent();
  assert.equal(handlePipelinePasteEvent(missingEvent, { clipboardManager: missingContext.clipboardManager }), false);
  assert.deepEqual(missingContext.calls, []);

  const emptyContext = createContext();
  const emptyEvent = createEvent();
  emptyEvent.clipboardData = { getData: format => {
    assert.equal(format, 'text/plain');
    return '';
  } };
  assert.equal(handlePipelinePasteEvent(emptyEvent, { clipboardManager: emptyContext.clipboardManager }), false);
  assert.deepEqual(emptyContext.calls, []);
});

test('paste events apply non-empty clipboard text outside text editing targets', () => {
  const context = createContext();
  const event = createEvent();
  event.clipboardData = { getData: format => {
    assert.equal(format, 'text/plain');
    return 'pasted via event';
  } };

  assert.equal(handlePipelinePasteEvent(event, { clipboardManager: context.clipboardManager }), true);
  assert.equal(event.prevented, 1);
  assert.equal(event.stopped, 1);
  assert.deepEqual(context.calls, [['handlePaste', 'pasted via event']]);
});
