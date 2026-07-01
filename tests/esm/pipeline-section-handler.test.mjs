import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineSectionHandler } from '../../js/ui/pipeline/pipeline-section-handler.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class SectionPlugin {
  constructor(id, enabled = true) {
    this.id = id;
    this.enabled = enabled;
  }
}

function createRuntime(pipeline, options = {}) {
  const calls = [];
  const pipelineManager = options.pipelineManager === undefined ? {
    expandedPlugins: new Set(),
    historyManager: {
      saveState() {
        calls.push(['saveState']);
      }
    }
  } : options.pipelineManager;

  const pipelineCore = {
    audioManager: { pipeline },
    selectedPlugins: new Set(pipeline),
    expandedPlugins: new Set(),
    pipelineManager,
    updatePipelineUI() {
      calls.push(['updatePipelineUI']);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    },
    selectionManager: {
      selectMultiple(plugins, clearExisting) {
        calls.push(['selectMultiple', plugins.map(plugin => plugin.id), clearExisting]);
      }
    }
  };

  return { calls, pipelineCore, pipelineManager };
}

function createPlugin(id, options = {}) {
  return {
    id,
    enabled: options.enabled ?? true,
    name: options.name ?? `Plugin ${id}`,
    cleanup: options.cleanup
  };
}

function createSectionPluginFactory(calls, options = {}) {
  return {
    isPluginAvailable(name) {
      calls.push(['isPluginAvailable', name]);
      if (options.throwAvailability) {
        throw new Error('availability failed');
      }
      return options.available !== false;
    },
    createPlugin(name) {
      calls.push(['createPlugin', name]);
      return {
        id: options.id ?? 999,
        name,
        setParameters(params) {
          calls.push(['setParameters', name, params]);
        }
      };
    }
  };
}

async function withSectionWindow(globals, callback) {
  await withGlobals({
    window: globals.window ?? {},
    document: globals.document ?? {
      querySelector: () => null,
      querySelectorAll: () => []
    },
    requestAnimationFrame: globals.requestAnimationFrame ?? (fn => {
      fn();
      return 1;
    }),
    console: globals.console ?? console
  }, callback);
}

test('deleteSectionRange removes section contents and tolerates missing sections', () => {
  const sectionA = new SectionPlugin(1);
  const pluginA = createPlugin(2);
  const pluginB = createPlugin(3);
  const sectionB = new SectionPlugin(4);
  const pluginC = createPlugin(5);
  const runtime = createRuntime([sectionA, pluginA, pluginB, sectionB, pluginC]);
  pluginB.cleanup = () => runtime.calls.push(['cleanup', pluginB.id]);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);

  handler.deleteSectionRange(new SectionPlugin(404));
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [sectionA, pluginA, pluginB, sectionB, pluginC]);

  handler.deleteSectionRange(sectionA);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [sectionB, pluginC]);
  assert.equal(runtime.pipelineCore.selectedPlugins.has(sectionA), false);
  assert.equal(runtime.pipelineCore.selectedPlugins.has(pluginB), false);
  assert.deepEqual(runtime.calls, [
    ['cleanup', 3],
    ['updatePipelineUI'],
    ['updateWorkletPlugins'],
    ['saveState']
  ]);
});

test('deleteSectionRange handles sections through pipeline end without a history manager', () => {
  const section = new SectionPlugin(1);
  const plugin = createPlugin(2);
  const runtime = createRuntime([section, plugin], { pipelineManager: null });
  const handler = new PipelineSectionHandler(runtime.pipelineCore);

  handler.deleteSectionRange(section);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, []);
  assert.deepEqual(runtime.calls, [
    ['updatePipelineUI'],
    ['updateWorkletPlugins']
  ]);
});

test('moveSectionUp handles guards, prior sections, and end-section insertion', async () => {
  const topSection = new SectionPlugin(1);
  const topEffect = createPlugin(2);
  const secondSection = new SectionPlugin(3);
  const secondEffect = createPlugin(4);
  const thirdSection = new SectionPlugin(5);
  const thirdEffect = createPlugin(6);
  const runtime = createRuntime([topSection, topEffect, secondSection, secondEffect, thirdSection, thirdEffect]);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);

  handler.moveSectionUp(new SectionPlugin(404));
  handler.moveSectionUp(topSection);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [topSection, topEffect, secondSection, secondEffect, thirdSection, thirdEffect]);

  handler.moveSectionUp(secondSection);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [secondSection, secondEffect, topSection, topEffect, thirdSection, thirdEffect]);

  const intro = createPlugin(10);
  const movableSection = new SectionPlugin(11);
  const movableEffect = createPlugin(12);
  const addRuntime = createRuntime([intro, movableSection, movableEffect]);
  const addHandler = new PipelineSectionHandler(addRuntime.pipelineCore);

  await withSectionWindow({
    window: { pluginManager: createSectionPluginFactory(addRuntime.calls, { id: 13 }) }
  }, async () => {
    addHandler.moveSectionUp(movableSection);
  });

  assert.deepEqual(addRuntime.pipelineCore.audioManager.pipeline.map(plugin => plugin.id), [11, 12, 13, 10]);
  assert.equal(addRuntime.pipelineManager.expandedPlugins.size, 1);
  assert.ok(addRuntime.calls.some(call => call[0] === 'saveState'));
});

test('moveSectionDown handles guards, no lower section, and both target calculations', () => {
  const sectionA = new SectionPlugin(1);
  const effectA = createPlugin(2);
  const sectionB = new SectionPlugin(3);
  const effectB = createPlugin(4);
  const runtime = createRuntime([sectionA, effectA, sectionB, effectB]);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);

  handler.moveSectionDown(new SectionPlugin(404));
  handler.moveSectionDown(sectionB);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [sectionA, effectA, sectionB, effectB]);

  handler.moveSectionDown(sectionA);
  assert.deepEqual(runtime.pipelineCore.audioManager.pipeline, [sectionB, effectB, sectionA, effectA]);

  const first = new SectionPlugin(10);
  const firstEffect = createPlugin(11);
  const second = new SectionPlugin(12);
  const secondEffect = createPlugin(13);
  const third = new SectionPlugin(14);
  const thirdEffect = createPlugin(15);
  const thirdRuntime = createRuntime([first, firstEffect, second, secondEffect, third, thirdEffect], { pipelineManager: null });
  const thirdHandler = new PipelineSectionHandler(thirdRuntime.pipelineCore);

  thirdHandler.moveSectionDown(first);
  assert.deepEqual(thirdRuntime.pipelineCore.audioManager.pipeline, [second, secondEffect, first, firstEffect, third, thirdEffect]);
  assert.deepEqual(thirdRuntime.calls, [
    ['updatePipelineUI'],
    ['updateWorkletPlugins']
  ]);
});

test('addEndSectionPluginAtPosition handles unavailable plugins, absent managers, and failures', async () => {
  const sectionPlugins = [];
  const runtime = createRuntime([]);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);

  await withSectionWindow({ window: {} }, async () => {
    handler.addEndSectionPluginAtPosition(sectionPlugins, 0);
  });
  assert.deepEqual(sectionPlugins, []);

  await withSectionWindow({
    window: { pluginManager: createSectionPluginFactory(runtime.calls, { available: false }) }
  }, async () => {
    handler.addEndSectionPluginAtPosition(sectionPlugins, 0);
  });
  assert.deepEqual(sectionPlugins, []);

  const noManagerRuntime = createRuntime([], { pipelineManager: null });
  const noManagerHandler = new PipelineSectionHandler(noManagerRuntime.pipelineCore);
  await withSectionWindow({
    window: { pluginManager: createSectionPluginFactory(noManagerRuntime.calls, { id: 21 }) }
  }, async () => {
    noManagerHandler.addEndSectionPluginAtPosition(sectionPlugins, 0);
  });
  assert.equal(sectionPlugins.at(-1).id, 21);

  const warnings = [];
  await withSectionWindow({
    window: { pluginManager: createSectionPluginFactory(runtime.calls, { throwAvailability: true }) },
    console: { ...console, warn: (...args) => warnings.push(args) }
  }, async () => {
    handler.addEndSectionPluginAtPosition(sectionPlugins, 0);
  });
  assert.equal(warnings.length, 1);
});

test('section state, range, selection, and plugin detection helpers handle edge cases', () => {
  const sectionOff = new SectionPlugin(1, false);
  const pluginA = createPlugin(2);
  const sectionOn = new SectionPlugin(3, true);
  const pluginB = createPlugin(4);
  const preSection = createPlugin(5);
  const runtime = createRuntime([preSection, sectionOff, pluginA, sectionOn, pluginB]);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);

  assert.deepEqual(handler.getPluginSectionState(createPlugin(404)), { insideSection: false, sectionEnabled: true });
  assert.deepEqual(handler.getPluginSectionState(preSection), { insideSection: false, sectionEnabled: true });
  assert.deepEqual(handler.getPluginSectionState(pluginA), { insideSection: true, sectionEnabled: false });
  assert.deepEqual(handler.getPluginSectionState(pluginB), { insideSection: true, sectionEnabled: true });

  assert.deepEqual(handler.findSectionRange(createPlugin(404)), { startIndex: -1, endIndex: -1 });
  assert.deepEqual(handler.findSectionRange(sectionOff), { startIndex: 1, endIndex: 3 });
  assert.deepEqual(handler.findSectionRange(sectionOn), { startIndex: 3, endIndex: 5 });

  handler.selectSection(createPlugin(404));
  handler.selectSection(sectionOff);
  assert.deepEqual(runtime.calls, [['selectMultiple', [1, 2], true]]);

  assert.equal(handler.isSectionPlugin(sectionOff), true);
  assert.equal(handler.isSectionPlugin({ constructor: Object, name: 'Section' }), true);
  assert.equal(handler.isSectionPlugin({ constructor: Object, name: 'Other' }), false);
});

function createPipelineItem(plugin, options = {}) {
  const pluginUI = options.hasPluginUI === false ? null : {
    classList: {
      add(className) {
        options.calls.push(['pluginUiAdd', plugin.id, className]);
      },
      remove(className) {
        options.calls.push(['pluginUiRemove', plugin.id, className]);
      }
    }
  };
  const nameEl = options.hasName === false ? null : {};

  return {
    dataset: { pluginId: String(plugin.id) },
    querySelector(selector) {
      if (selector === '.plugin-ui') return pluginUI;
      if (selector === '.plugin-name') return nameEl;
      return null;
    },
    nameEl
  };
}

test('expandCollapseSection expands plugins, updates markers, and localizes tooltips', async () => {
  const section = new SectionPlugin(1);
  const pluginA = createPlugin(2);
  pluginA.updateMarkers = () => {};
  pluginA.updateResponse = () => {};
  const pluginB = createPlugin(3);
  const pluginC = createPlugin(4);
  const runtime = createRuntime([section, pluginA, pluginB, pluginC]);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);
  const animationCallbacks = [];
  const items = new Map([
    [1, createPipelineItem(section, { calls: runtime.calls })],
    [2, createPipelineItem(pluginA, { calls: runtime.calls })],
    [3, createPipelineItem(pluginB, { calls: runtime.calls, hasPluginUI: false, hasName: false })],
    [4, createPipelineItem(pluginC, { calls: runtime.calls })],
    [999, createPipelineItem({ id: 999 }, { calls: runtime.calls })]
  ]);
  pluginA.updateMarkers = () => runtime.calls.push(['updateMarkers', pluginA.id]);
  pluginA.updateResponse = () => runtime.calls.push(['updateResponse', pluginA.id]);

  await withSectionWindow({
    window: { uiManager: { t: key => `T:${key}` } },
    document: {
      querySelector(selector) {
        const match = /data-plugin-id="(\d+)"/.exec(selector);
        if (!match) return null;
        const id = Number(match[1]);
        return id === 4 ? null : items.get(id);
      },
      querySelectorAll(selector) {
        assert.equal(selector, '.pipeline-item');
        return [items.get(1), items.get(2), items.get(3), items.get(4), items.get(999)];
      }
    },
    requestAnimationFrame(fn) {
      animationCallbacks.push(fn);
      return animationCallbacks.length;
    }
  }, async () => {
    handler.expandCollapseSection(section, true);
    animationCallbacks.forEach(fn => fn());
  });

  assert.equal(runtime.pipelineCore.expandedPlugins.has(section), true);
  assert.equal(runtime.pipelineCore.expandedPlugins.has(pluginA), true);
  assert.equal(items.get(1).nameEl.title, 'T:ui.title.collapse');
  assert.equal(items.get(4).nameEl.title, 'T:ui.title.expand');
  assert.ok(runtime.calls.some(call => call[0] === 'updateMarkers'));
  assert.ok(runtime.calls.some(call => call[0] === 'updateResponse'));
});

test('expandCollapseSection collapses plugins and uses fallback tooltip text', async () => {
  const section = new SectionPlugin(1);
  const plugin = createPlugin(2);
  const runtime = createRuntime([section, plugin]);
  runtime.pipelineCore.expandedPlugins.add(section);
  runtime.pipelineCore.expandedPlugins.add(plugin);
  const handler = new PipelineSectionHandler(runtime.pipelineCore);
  const items = new Map([
    [1, createPipelineItem(section, { calls: runtime.calls })],
    [2, createPipelineItem(plugin, { calls: runtime.calls })]
  ]);

  await withSectionWindow({
    window: {},
    document: {
      querySelector(selector) {
        const match = /data-plugin-id="(\d+)"/.exec(selector);
        return match ? items.get(Number(match[1])) : null;
      },
      querySelectorAll() {
        return [items.get(1), items.get(2)];
      }
    }
  }, async () => {
    handler.updateAllTooltips();
    assert.equal(items.get(1).nameEl.title, 'Click to collapse');

    handler.expandCollapseSection(new SectionPlugin(404), false);
    handler.expandCollapseSection(section, false);
  });

  assert.equal(runtime.pipelineCore.expandedPlugins.size, 0);
  assert.equal(items.get(1).nameEl.title, 'Click to expand');
  assert.deepEqual(runtime.calls.filter(call => call[0] === 'pluginUiRemove'), [
    ['pluginUiRemove', 1, 'expanded'],
    ['pluginUiRemove', 2, 'expanded']
  ]);
});
