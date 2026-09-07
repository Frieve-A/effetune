import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const baseCss = read('../../effetune-theme.css') +
  read('../../effetune.css').replace('@import url("effetune-theme.css");', '');
const extensionCss = read('../../extension/editor.css');

async function captureLayout(page, { extension, collapsed, columns }) {
  const bodyClass = extension ? 'extension-editor' : '';
  const collapseClass = collapsed ? ' plugin-list-collapsed' : '';
  await page.setContent(`
    <body class="${bodyClass}">
      <div class="main-container${collapseClass}">
        <div class="plugin-list-shell">
          <div class="plugin-list" id="pluginList"></div>
          <div class="plugin-list-pull-tab" id="pluginListPullTab">◀</div>
        </div>
        <div class="pipeline" id="pipeline">
          <div class="pipeline-header">
            <button class="toggle-button master-toggle">ON</button>
            <span class="pipeline-title">Effect Pipeline</span>
            <div class="pipeline-header-right">
              <div class="pipeline-toolbar-group"><button class="header-button pipeline-preset-button" id="pipelinePresetButton"><svg width="16" height="16"></svg></button></div>
              <div class="pipeline-toolbar-group"><button class="header-button undo-button" id="undoButton">↶</button><button class="header-button redo-button" id="redoButton">↷</button></div>
              <div class="pipeline-toolbar-group"><button class="column-control-button" id="decreaseColumnsButton">−</button><button class="column-control-button" id="increaseColumnsButton">+</button></div>
            </div>
          </div>
          <div id="pipelineList"><div class="pipeline-column"></div></div>
        </div>
      </div>
    </body>`);
  await page.addStyleTag({ content: `${baseCss}${extension ? extensionCss : ''}\n* { transition: none !important; }` });
  await page.locator('#pipeline').evaluate((pipeline, count) => {
    pipeline.style.width = `${1064 * count + 10 * (count - 1)}px`;
  }, columns);
  return page.evaluate(() => {
    const rect = id => document.getElementById(id).getBoundingClientRect();
    const style = id => getComputedStyle(document.getElementById(id));
    const face = id => {
      const computed = style(id);
      return {
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        borderColor: computed.borderColor,
        borderRadius: computed.borderRadius,
        borderStyle: computed.borderStyle,
        borderWidth: computed.borderWidth,
        boxShadow: computed.boxShadow,
        color: computed.color,
        padding: computed.padding
      };
    };
    const pipelineRect = rect('pipeline');
    const presetRect = rect('pipelinePresetButton');
    const undoRect = rect('undoButton');
    const redoRect = rect('redoButton');
    const decreaseRect = rect('decreaseColumnsButton');
    return {
      pipeline: { width: rect('pipeline').width, computed: style('pipeline').width },
      pullTab: { width: rect('pluginListPullTab').width, height: rect('pluginListPullTab').height,
        face: face('pluginListPullTab') },
      preset: { width: rect('pipelinePresetButton').width, height: rect('pipelinePresetButton').height,
        face: face('pipelinePresetButton') },
      undo: { width: rect('undoButton').width, height: rect('undoButton').height,
        face: face('undoButton') },
      redo: { width: rect('redoButton').width, height: rect('redoButton').height,
        face: face('redoButton') },
      placement: {
        pipelineOffsets: {
          preset: presetRect.left - pipelineRect.left,
          undo: undoRect.left - pipelineRect.left,
          redo: redoRect.left - pipelineRect.left,
          decrease: decreaseRect.left - pipelineRect.left
        },
        gaps: {
          presetToUndo: undoRect.left - presetRect.right,
          undoToRedo: redoRect.left - undoRect.right,
          redoToDecrease: decreaseRect.left - redoRect.right
        }
      },
      headerGap: getComputedStyle(document.querySelector('.pipeline-header-right')).gap,
      groupGap: getComputedStyle(document.querySelectorAll('.pipeline-toolbar-group')[1]).gap,
      scrollWidth: document.documentElement.scrollWidth
    };
  });
}

test('extension reuses canonical fixed pipeline, pull-tab, and toolbar geometry', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 700 } });
    for (const collapsed of [false, true]) {
      for (const columns of [1, 2]) {
        const canonical = await captureLayout(page, { extension: false, collapsed, columns });
        const extension = await captureLayout(page, { extension: true, collapsed, columns });
        assert.equal(canonical.pipeline.width, columns === 1 ? 1104 : 2178);
        assert.deepEqual(extension.pipeline, canonical.pipeline);
        assert.deepEqual(extension.pullTab, canonical.pullTab);
        assert.deepEqual(extension.preset, canonical.preset);
        assert.deepEqual(extension.undo, canonical.undo);
        assert.deepEqual(extension.redo, canonical.redo);
        assert.deepEqual(extension.placement, canonical.placement);
        assert.deepEqual(canonical.placement.gaps,
          { presetToUndo: 10, undoToRedo: 5, redoToDecrease: 10 });
        assert.deepEqual({ width: extension.preset.width, height: extension.preset.height }, { width: 34, height: 24 });
        assert.deepEqual({ width: extension.undo.width, height: extension.undo.height }, { width: 24, height: 24 });
        assert.deepEqual({ width: extension.redo.width, height: extension.redo.height }, { width: 24, height: 24 });
        assert.equal(extension.headerGap, '10px');
        assert.equal(extension.groupGap, '5px');
        assert.equal(extension.headerGap, canonical.headerGap);
        assert.equal(extension.groupGap, canonical.groupGap);
        assert.ok(extension.scrollWidth > 760);
      }
    }
  } finally {
    await browser.close();
  }
});
