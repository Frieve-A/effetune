import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PluginListManager } from '../../js/ui/plugin-list-manager.js';
import { SearchManager } from '../../js/ui/plugin-list/search-manager.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulationPluginAliases = Object.freeze([
  Object.freeze({
    file: 'auto_filter.js', className: 'AutoFilterPlugin', name: 'Auto Filter',
    aliases: Object.freeze(['Envelope Filter', 'Auto Wah', 'Wah'])
  }),
  Object.freeze({
    file: 'auto_pan.js', className: 'AutoPanPlugin', name: 'Auto Pan',
    aliases: Object.freeze([])
  }),
  Object.freeze({
    file: 'chorus.js', className: 'ChorusPlugin', name: 'Chorus',
    aliases: Object.freeze(['Stereo Chorus', 'Ensemble', 'Flanger', 'Vibrato'])
  }),
  Object.freeze({
    file: 'frequency_shifter.js', className: 'FrequencyShifterPlugin',
    name: 'Frequency Shifter', aliases: Object.freeze([
      'Ring Modulator', 'Ring Mod', 'Barber-pole Frequency Shifter',
      'Barber Pole Frequency Shifter'
    ])
  }),
  Object.freeze({
    file: 'phaser.js', className: 'PhaserPlugin', name: 'Phaser',
    aliases: Object.freeze(['Barber-pole Phaser', 'Barber Pole Phaser'])
  }),
  Object.freeze({
    file: 'rotary_speaker.js', className: 'RotarySpeakerPlugin', name: 'Rotary Speaker',
    aliases: Object.freeze(['Leslie', 'Rotary'])
  })
]);

async function loadModulationPlugin({ file, className }) {
  const source = await fs.readFile(path.join(repoRoot, 'plugins', 'modulation', file), 'utf8');
  const context = { PluginBase: class {}, window: {} };
  vm.runInNewContext(source, context, { filename: file });
  return context.window[className];
}

function pluginItem(name, aliases = '') {
  return {
    childNodes: [{ textContent: name }],
    dataset: aliases ? { searchAliases: aliases } : {},
    style: {}
  };
}

function searchHarness(items, category = 'Modulation') {
  const categoryItems = {
    style: {},
    querySelectorAll(selector) { return selector === '.plugin-item' ? items : []; }
  };
  const title = {
    textContent: category,
    querySelector() { return null; }
  };
  const rightColumn = {
    querySelector(selector) {
      if (selector === '.plugin-category-items') return categoryItems;
      return null;
    }
  };
  const categoryRow = {
    dataset: { category },
    style: {},
    querySelector(selector) {
      if (selector === 'h3') return title;
      if (selector === '.right-column-content') return rightColumn;
      return null;
    }
  };
  const content = {
    querySelectorAll(selector) { return selector === '.category-row' ? [categoryRow] : []; }
  };
  return {
    pluginList: {
      querySelector(selector) {
        if (selector === '.plugin-list-content') return content;
        return null;
      }
    },
    pluginListManager: { updateCategoryVisibility() {} }
  };
}

test('modulation plugin list items expose the required production alias inventory', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        className: '', draggable: false, dataset: {}, children: [],
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  try {
    for (const expected of modulationPluginAliases) {
      const Plugin = await loadModulationPlugin(expected);
      assert.equal(Object.hasOwn(Plugin, 'searchAliases'), true, expected.name);
      assert.equal(Object.isFrozen(Plugin.searchAliases), true, expected.name);
      assert.deepEqual(Array.from(Plugin.searchAliases), Array.from(expected.aliases), expected.name);

      const item = PluginListManager.prototype.createPluginItem.call(
        { setupPluginItemEvents() {} },
        { name: expected.name, description: 'Description', constructor: Plugin });
      if (expected.aliases.length > 0) {
        assert.equal(item.dataset.searchAliases, expected.aliases.join('\n'), expected.name);
      } else {
        assert.equal('searchAliases' in item.dataset, false, expected.name);
      }
    }
  } finally {
    globalThis.document = previousDocument;
  }
});

test('each required alias reveals only its owning general effect', async () => {
  const plugins = await Promise.all(modulationPluginAliases.map(async expected => ({
    ...expected,
    Plugin: await loadModulationPlugin(expected)
  })));
  const items = plugins.map(({ name, Plugin }) =>
    pluginItem(name, Array.from(Plugin.searchAliases).join('\n')));
  const harness = searchHarness(items);

  for (const [ownerIndex, owner] of plugins.entries()) {
    for (const alias of owner.aliases) {
      SearchManager.prototype.filterPlugins.call(harness, alias);
      const visibleNames = items
        .filter(item => item.style.display === '')
        .map(item => item.childNodes[0].textContent);
      assert.deepEqual(visibleNames, [owner.name], alias);
      assert.equal(items[ownerIndex].style.display, '', alias);
    }
  }
});

test('ordinary name and category search behavior is unchanged', () => {
  const autoFilter = pluginItem('Auto Filter', 'Envelope Filter\nAuto Wah\nWah');
  const tremolo = pluginItem('Tremolo');
  const harness = searchHarness([autoFilter, tremolo]);

  SearchManager.prototype.filterPlugins.call(harness, 'tremolo');
  assert.equal(autoFilter.style.display, 'none');
  assert.equal(tremolo.style.display, '');

  SearchManager.prototype.filterPlugins.call(harness, 'modulation');
  assert.equal(autoFilter.style.display, '');
  assert.equal(tremolo.style.display, '');

  SearchManager.prototype.filterPlugins.call(harness, '');
  assert.equal(autoFilter.style.display, '');
  assert.equal(tremolo.style.display, '');
});
