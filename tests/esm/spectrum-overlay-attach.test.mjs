import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PipelineItemBuilder } from '../../js/ui/pipeline/pipeline-item-builder.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { Element } from '../helpers/spectrum-overlay-harness.mjs';

test('pipeline UI creation attaches the shared overlay once after plugin UI creation', async () => {
  for (const available of [true, false]) {
    const calls = [];
    const plugin = { createUI: () => new Element() };
    const builder = new PipelineItemBuilder({ audioManager: {}, expandedPlugins: new Set() });
    builder.setupParameterUpdateHandling = () => {};
    const window = available ? { SpectrumOverlay: { attach: (...args) => calls.push(args) } } : {};
    await withGlobals({ window, document: { createElement: name => new Element(name) } }, () => {
      const ui = builder.createPluginUI(plugin);
      assert.equal(ui.children.length, 1);
      assert.deepEqual(calls, available ? [[plugin, ui]] : []);
    });
  }
});

test('overlay ownership stays out of the existing plugin cleanup and column paths', () => {
  for (const relative of [
    'js/ui/pipeline/history-manager.js', 'js/ui/pipeline/pipeline-section-handler.js',
    'js/ui/pipeline/pipeline-selection-manager.js', 'js/ui/pipeline/preset-manager.js',
    'js/ui/pipeline/pipeline-column-manager.js'
  ]) {
    const source = fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
    assert.equal(source.includes('SpectrumOverlay'), false, relative);
  }
});
