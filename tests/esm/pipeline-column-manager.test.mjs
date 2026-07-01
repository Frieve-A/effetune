import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineColumnManager } from '../../js/ui/pipeline/pipeline-column-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createButton(calls, id) {
  return {
    id,
    disabled: false,
    listeners: {},
    addEventListener(type, listener) {
      calls.push(['addEventListener', id, type]);
      this.listeners[type] = listener;
    },
    click() {
      this.listeners.click?.();
    }
  };
}

function createColumn(calls, owner) {
  return {
    className: '',
    dataset: {},
    children: [],
    innerHTML: '',
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      calls.push(['appendToColumn', this.dataset.columnIndex, child.pluginId]);
      return child;
    },
    remove() {
      const index = owner.columns.indexOf(this);
      if (index !== -1) owner.columns.splice(index, 1);
      calls.push(['removeColumn', this.dataset.columnIndex]);
    }
  };
}

function createPipelineList(calls, options = {}) {
  const list = {
    columns: [],
    emptyElement: options.emptyElement === false ? null : { style: { display: '' } },
    classList: {
      add(className) {
        calls.push(['classAdd', className]);
      },
      remove(className) {
        calls.push(['classRemove', className]);
      }
    },
    appendChild(child) {
      child.parentNode = list;
      if (child.className === 'pipeline-column') {
        list.columns.push(child);
      }
      calls.push(['appendChild', child.className]);
      return child;
    },
    querySelector(selector) {
      if (selector === '#pipelineEmpty') return list.emptyElement;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.pipeline-column') {
        return options.columnsOverride ?? [...list.columns];
      }
      return [];
    }
  };
  return list;
}

function createRuntime(options = {}) {
  const calls = [];
  const pipeline = options.pipeline ?? [];
  const pipelineList = options.pipelineList === undefined
    ? createPipelineList(calls, options)
    : options.pipelineList;
  const pipelineCore = {
    audioManager: { pipeline },
    pipelineList,
    itemBuilder: {
      createPipelineItem(plugin) {
        calls.push(['createPipelineItem', plugin.id]);
        return { pluginId: plugin.id };
      }
    },
    updatePipelineUI(force) {
      calls.push(['updatePipelineUI', force]);
    },
    updateSelectionClasses() {
      calls.push(['updateSelectionClasses']);
    }
  };
  return { calls, pipelineCore, pipelineList };
}

async function withColumnGlobals(runtime, options, callback) {
  const storage = new Map(Object.entries(options.storage ?? {}));
  const animationCallbacks = [];
  const elements = options.elements ?? {};
  const windowListeners = {};
  const documentRef = {
    documentElement: {
      style: {
        setProperty(name, value) {
          runtime.calls.push(['setProperty', name, value]);
        }
      }
    },
    createElement(tagName) {
      runtime.calls.push(['createElement', tagName]);
      return createColumn(runtime.calls, runtime.pipelineList);
    },
    getElementById(id) {
      if (Object.prototype.hasOwnProperty.call(elements, id)) return elements[id];
      if (id === 'pipeline') return options.pipelineElement ?? { style: {} };
      return null;
    }
  };
  const windowRef = {
    uiManager: options.uiManager,
    addEventListener(type, listener) {
      runtime.calls.push(['windowAddEventListener', type]);
      windowListeners[type] = listener;
    }
  };

  await withGlobals({
    document: documentRef,
    window: windowRef,
    localStorage: {
      getItem(key) {
        runtime.calls.push(['getItem', key]);
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        runtime.calls.push(['setItem', key, value]);
        storage.set(key, String(value));
      }
    },
    requestAnimationFrame(fn) {
      runtime.calls.push(['requestAnimationFrame']);
      animationCallbacks.push(fn);
      return animationCallbacks.length;
    },
    setTimeout(fn, delay) {
      runtime.calls.push(['setTimeout', delay]);
      animationCallbacks.push(fn);
      return animationCallbacks.length;
    },
    clearTimeout(id) {
      runtime.calls.push(['clearTimeout', id]);
    },
    console: options.console ?? console
  }, async () => callback({ storage, animationCallbacks, windowListeners }));
}

test('constructor and column controls honor saved state and button limits', async () => {
  const runtime = createRuntime({
    pipeline: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
  });
  const decrease = createButton(runtime.calls, 'decrease');
  const increase = createButton(runtime.calls, 'increase');
  const pullTabUpdates = [];

  await withColumnGlobals(runtime, {
    storage: { pipelineColumns: '3' },
    elements: {
      decreaseColumnsButton: decrease,
      increaseColumnsButton: increase
    },
    uiManager: {
      pluginListManager: {
        updatePositions() {
          pullTabUpdates.push('updated');
        }
      }
    }
  }, async ({ animationCallbacks, storage }) => {
    const manager = new PipelineColumnManager(runtime.pipelineCore);
    assert.equal(manager.getCurrentColumns(), 3);

    manager.setupColumnControl();
    animationCallbacks.splice(0).forEach(fn => fn());
    assert.equal(runtime.pipelineList.columns.length, 3);
    assert.equal(storage.get('pipelineColumns'), '3');

    decrease.click();
    animationCallbacks.splice(0).forEach(fn => fn());
    assert.equal(manager.getCurrentColumns(), 2);
    assert.equal(decrease.disabled, false);

    increase.click();
    animationCallbacks.splice(0).forEach(fn => fn());
    assert.equal(manager.getCurrentColumns(), 3);

    manager.currentColumns = 1;
    decrease.click();
    assert.equal(manager.getCurrentColumns(), 1);

    manager.currentColumns = 8;
    increase.click();
    assert.equal(manager.getCurrentColumns(), 8);
  });

  assert.ok(pullTabUpdates.length >= 3);
  assert.ok(runtime.calls.some(call => call[0] === 'updateSelectionClasses'));
});

test('setupColumnControl and button state updates tolerate missing buttons', async () => {
  const runtime = createRuntime();

  await withColumnGlobals(runtime, {
    storage: {},
    elements: {
      decreaseColumnsButton: null,
      increaseColumnsButton: createButton(runtime.calls, 'increase')
    }
  }, async () => {
    const manager = new PipelineColumnManager(runtime.pipelineCore);
    assert.equal(manager.getCurrentColumns(), 1);
    manager.setupColumnControl();
    manager.updateColumnButtonStates(8);
    assert.equal(runtime.calls.some(call => call[0] === 'setProperty'), false);
  });

  const missingIncreaseRuntime = createRuntime();
  await withColumnGlobals(missingIncreaseRuntime, {
    elements: {
      decreaseColumnsButton: createButton(missingIncreaseRuntime.calls, 'decrease'),
      increaseColumnsButton: null
    }
  }, async () => {
    const manager = new PipelineColumnManager(missingIncreaseRuntime.pipelineCore);
    manager.updateColumnButtonStates(1);
  });
});

test('updatePipelineColumns validates ranges and handles missing pipeline elements', async () => {
  const runtime = createRuntime({ pipeline: [{ id: 'only' }] });

  await withColumnGlobals(runtime, {
    pipelineElement: null,
    uiManager: null
  }, async ({ animationCallbacks, storage }) => {
    const manager = new PipelineColumnManager(runtime.pipelineCore);
    manager.updatePipelineColumns(0);
    manager.updatePipelineColumns(9);
    assert.equal(runtime.calls.some(call => call[0] === 'setProperty'), false);

    manager.updatePipelineColumns(2);
    animationCallbacks.splice(0).forEach(fn => fn());
    assert.equal(storage.get('pipelineColumns'), '2');
    assert.equal(runtime.pipelineList.columns.length, 2);
  });
});

test('rebuild and distribution handle missing lists, empty columns, and invalid target columns', async () => {
  const errors = [];
  const missingRuntime = createRuntime({ pipelineList: null });
  await withColumnGlobals(missingRuntime, {
    console: { ...console, error: (...args) => errors.push(args) }
  }, async () => {
    const manager = new PipelineColumnManager(missingRuntime.pipelineCore);
    manager.rebuildPipelineColumns(2);
  });
  assert.equal(errors.length, 1);

  const emptyRuntime = createRuntime({ pipeline: [] });
  await withColumnGlobals(emptyRuntime, {}, async () => {
    const manager = new PipelineColumnManager(emptyRuntime.pipelineCore);
    manager.distributePluginsToColumns();
  });
  assert.deepEqual(emptyRuntime.calls.filter(call => call[0] === 'updatePipelineUI'), [
    ['updatePipelineUI', true]
  ]);

  const nonEmptyRuntime = createRuntime({ pipeline: [{ id: 'x' }] });
  await withColumnGlobals(nonEmptyRuntime, {}, async () => {
    const manager = new PipelineColumnManager(nonEmptyRuntime.pipelineCore);
    manager.distributePluginsToColumns();
  });
  assert.equal(nonEmptyRuntime.calls.some(call => call[0] === 'updatePipelineUI'), false);

  const warnings = [];
  const oddColumns = { length: 1, forEach() {}, 0: undefined };
  const invalidTargetRuntime = createRuntime({
    pipeline: [{ id: 'lost' }],
    columnsOverride: oddColumns
  });
  await withColumnGlobals(invalidTargetRuntime, {
    console: { ...console, warn: (...args) => warnings.push(args) }
  }, async () => {
    const manager = new PipelineColumnManager(invalidTargetRuntime.pipelineCore);
    manager.distributePluginsToColumns();
  });
  assert.equal(warnings.length, 1);
});

test('responsive resize debounce registers callbacks without changing column settings', async () => {
  const runtime = createRuntime();

  await withColumnGlobals(runtime, {}, async ({ animationCallbacks, windowListeners }) => {
    const manager = new PipelineColumnManager(runtime.pipelineCore);
    manager.setupResponsiveColumnAdjustment();
    windowListeners.resize();
    animationCallbacks.splice(0).forEach(fn => fn());
  });

  assert.ok(runtime.calls.some(call => call[0] === 'windowAddEventListener' && call[1] === 'resize'));
  assert.ok(runtime.calls.some(call => call[0] === 'clearTimeout'));
  assert.ok(runtime.calls.some(call => call[0] === 'setTimeout' && call[1] === 200));
});

test('empty and non-empty pipeline state update columns, placeholders, and pull tab position', async () => {
  const runtime = createRuntime();

  await withColumnGlobals(runtime, {
    uiManager: {
      pluginListManager: {
        updatePositions() {
          runtime.calls.push(['updatePositions']);
        }
      }
    }
  }, async ({ animationCallbacks }) => {
    const manager = new PipelineColumnManager(runtime.pipelineCore);
    manager.rebuildPipelineColumns(2);
    assert.equal(runtime.pipelineList.columns.length, 2);

    manager.handleEmptyPipelineState();
    assert.equal(runtime.pipelineList.columns.length, 0);
    assert.equal(runtime.pipelineList.emptyElement.style.display, 'block');
    animationCallbacks.splice(0).forEach(fn => fn());

    manager.handleNonEmptyPipelineState();
    assert.equal(runtime.pipelineList.emptyElement.style.display, 'none');
  });

  assert.ok(runtime.calls.some(call => call[0] === 'classAdd' && call[1] === 'is-empty'));
  assert.ok(runtime.calls.some(call => call[0] === 'classRemove' && call[1] === 'is-empty'));
  assert.ok(runtime.calls.some(call => call[0] === 'updatePositions'));

  const noEmptyRuntime = createRuntime({ emptyElement: false });
  await withColumnGlobals(noEmptyRuntime, {}, async () => {
    const manager = new PipelineColumnManager(noEmptyRuntime.pipelineCore);
    manager.handleEmptyPipelineState();
    manager.handleNonEmptyPipelineState();
  });
});
