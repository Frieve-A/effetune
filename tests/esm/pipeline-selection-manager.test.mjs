import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineSelectionManager } from '../../js/ui/pipeline/pipeline-selection-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class SectionPlugin {
  constructor(id) {
    this.id = id;
  }
}

function createRuntime(pipeline, options = {}) {
  const calls = [];
  const selectedItems = [
    {
      classList: {
        remove(className) {
          calls.push(['removeClass', 'selected-old', className]);
        }
      }
    }
  ];
  const items = pipeline.map(plugin => ({
    plugin,
    classList: {
      add(className) {
        calls.push(['addClass', plugin.id, className]);
      },
      remove(className) {
        calls.push(['removeClass', plugin.id, className]);
      }
    }
  }));

  const pipelineCore = {
    audioManager: { pipeline },
    pipelineList: {
      querySelectorAll(selector) {
        calls.push(['querySelectorAll', selector]);
        if (selector === '.pipeline-item.selected') return selectedItems;
        if (selector === '.pipeline-item') return items;
        return [];
      }
    },
    updatePipelineUI() {
      calls.push(['updatePipelineUI']);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    },
    pipelineManager: options.history === false ? options.pipelineManager : {
      historyManager: {
        saveState() {
          calls.push(['saveState']);
        }
      }
    }
  };

  return { calls, items, pipelineCore };
}

async function withLayoutDocument(calls, callback) {
  await withGlobals({
    document: {
      body: {
        getBoundingClientRect() {
          calls.push(['getBoundingClientRect']);
          return {};
        }
      }
    }
  }, callback);
}

test('handlePluginSelection clears only when requested without modifier keys', async () => {
  const existing = { id: 'existing' };
  const pluginA = { id: 'a' };
  const pluginB = { id: 'b' };
  const runtime = createRuntime([pluginA, pluginB]);
  const manager = new PipelineSelectionManager(runtime.pipelineCore);
  manager.selectedPlugins.add(existing);

  await withLayoutDocument(runtime.calls, async () => {
    manager.handlePluginSelection(pluginA, { ctrlKey: false, metaKey: false });
    assert.deepEqual([...manager.selectedPlugins], [pluginA]);

    manager.handlePluginSelection(existing, { ctrlKey: true, metaKey: false });
    assert.equal(manager.selectedPlugins.has(pluginA), true);
    assert.equal(manager.selectedPlugins.has(existing), true);

    manager.handlePluginSelection(pluginB, { ctrlKey: false, metaKey: true });
    assert.equal(manager.selectedPlugins.has(pluginB), true);

    manager.handlePluginSelection(pluginA, { ctrlKey: false, metaKey: false }, false);
    assert.equal(manager.selectedPlugins.has(existing), true);
  });

  assert.equal(runtime.calls.filter(call => call[0] === 'getBoundingClientRect').length, 4);
});

test('handleSectionSelection selects through the next section or falls back when missing', async () => {
  const sectionA = new SectionPlugin('section-a');
  const effectA = { id: 'effect-a' };
  const effectB = { id: 'effect-b' };
  const sectionB = new SectionPlugin('section-b');
  const effectC = { id: 'effect-c' };
  const runtime = createRuntime([sectionA, effectA, effectB, sectionB, effectC]);
  const manager = new PipelineSelectionManager(runtime.pipelineCore);

  await withLayoutDocument(runtime.calls, async () => {
    manager.handleSectionSelection(sectionA, {});
    assert.deepEqual([...manager.selectedPlugins], [sectionA, effectA, effectB]);

    manager.handleSectionSelection(sectionB, {});
    assert.deepEqual([...manager.selectedPlugins], [sectionB, effectC]);

    const missing = new SectionPlugin('missing');
    manager.handleSectionSelection(missing, { ctrlKey: false, metaKey: false });
    assert.deepEqual([...manager.selectedPlugins], [missing]);
  });
});

test('updateSelectionClasses removes stale classes and marks selected plugins', async () => {
  const pluginA = { id: 'a' };
  const pluginB = { id: 'b' };
  const runtime = createRuntime([pluginA, pluginB]);
  const manager = new PipelineSelectionManager(runtime.pipelineCore);
  manager.selectedPlugins.add(pluginB);

  await withLayoutDocument(runtime.calls, async () => {
    manager.updateSelectionClasses();
  });

  assert.deepEqual(runtime.calls, [
    ['querySelectorAll', '.pipeline-item.selected'],
    ['removeClass', 'selected-old', 'selected'],
    ['querySelectorAll', '.pipeline-item'],
    ['addClass', 'b', 'selected'],
    ['getBoundingClientRect']
  ]);
});

test('deleteSelectedPlugins removes valid selections in reverse order and saves history', () => {
  const pluginA = { id: 'a' };
  const pluginB = { id: 'b' };
  const pluginC = { id: 'c' };
  const missing = { id: 'missing' };
  const runtime = createRuntime([pluginA, pluginB, pluginC]);
  pluginB.cleanup = () => runtime.calls.push(['cleanup', 'b']);
  const manager = new PipelineSelectionManager(runtime.pipelineCore);
  manager.selectedPlugins.add(pluginA);
  manager.selectedPlugins.add(pluginB);
  manager.selectedPlugins.add(missing);

  assert.equal(manager.deleteSelectedPlugins(), true);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [pluginC]);
  assert.equal(manager.selectedPlugins.has(pluginA), false);
  assert.equal(manager.selectedPlugins.has(pluginB), false);
  assert.equal(manager.selectedPlugins.has(missing), true);
  assert.deepEqual(runtime.calls, [
    ['cleanup', 'b'],
    ['updatePipelineUI'],
    ['updateWorkletPlugins'],
    ['saveState']
  ]);
});

test('deleteSelectedPlugins handles empty selections and absent history manager', () => {
  const pluginA = { id: 'a' };
  const runtime = createRuntime([pluginA], { history: false, pipelineManager: null });
  const manager = new PipelineSelectionManager(runtime.pipelineCore);

  assert.equal(manager.deleteSelectedPlugins(), false);
  manager.selectedPlugins.add(pluginA);
  assert.equal(manager.deleteSelectedPlugins(), true);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, []);
  assert.deepEqual(runtime.calls, [
    ['updatePipelineUI'],
    ['updateWorkletPlugins']
  ]);
});

test('selection helpers expose, replace, toggle, and invert selections', async () => {
  const pluginA = { id: 'a' };
  const pluginB = { id: 'b' };
  const pluginC = { id: 'c' };
  const runtime = createRuntime([pluginA, pluginB, pluginC]);
  const manager = new PipelineSelectionManager(runtime.pipelineCore);

  await withLayoutDocument(runtime.calls, async () => {
    manager.selectMultiple([pluginA, pluginB]);
    assert.equal(manager.isPluginSelected(pluginA), true);
    assert.equal(manager.getSelectedPlugins(), manager.selectedPlugins);

    manager.selectMultiple([pluginC], false);
    assert.deepEqual([...manager.selectedPlugins], [pluginA, pluginB, pluginC]);

    manager.togglePluginSelection(pluginB);
    assert.equal(manager.selectedPlugins.has(pluginB), false);

    manager.togglePluginSelection(pluginB);
    assert.equal(manager.selectedPlugins.has(pluginB), true);

    manager.clearSelection();
    assert.equal(manager.selectedPlugins.size, 0);

    manager.selectAll();
    assert.deepEqual([...manager.selectedPlugins], [pluginA, pluginB, pluginC]);

    manager.selectedPlugins = new Set([pluginA]);
    manager.inverseSelection();
    assert.deepEqual([...manager.selectedPlugins], [pluginB, pluginC]);
  });
});
