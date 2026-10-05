import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../css/effetune-theme.css') +
  read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '');
const managerSource = read('../../js/ui/pipeline/pipeline-column-manager.js')
  .replace('export class PipelineColumnManager', 'class PipelineColumnManager');

async function mountPipeline(page, columns, hiddenClass = '') {
  await page.setContent(`<body class="${hiddenClass}">
    <div class="main-container"><div id="pipeline"><div id="pipelineList"></div></div></div>
  </body>`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: managerSource });
  await page.evaluate(columnCount => {
    Object.defineProperty(window, 'localStorage', { configurable: true,
      value: { getItem() { return null; }, setItem() {} } });
    window.uiManager = { layoutMode: { isMobile: false } };
    const heights = [160, 360, 300, 200, 250, 200, 480, 340, 200, 90, 50, 330, 160, 110, 60];
    window.createdItems = [];
    const core = {
      pipelineList: document.getElementById('pipelineList'),
      audioManager: { pipeline: heights.map((height, id) => ({ height, id })) },
      itemBuilder: {
        createPipelineItem(plugin) {
          const item = document.createElement('div');
          item.className = 'pipeline-item';
          item.dataset.pluginId = plugin.id;
          item.style.height = `${plugin.height}px`;
          item.style.flexShrink = '0';
          window.createdItems.push(item);
          return item;
        }
      },
      updateSelectionClasses() {}
    };
    window.columnManager = new PipelineColumnManager(core);
    window.columnManager.updatePipelineColumns(columnCount);
    window.placements = () => [...core.pipelineList.querySelectorAll('.pipeline-column')]
      .map(column => [...column.children].map(item => Number(item.dataset.pluginId)));
  }, columns);
}

test('a pipeline built in a hidden view balances its existing items when first shown', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const columns of [2, 3]) {
      await mountPipeline(page, columns);
      const expected = await page.evaluate(() => window.placements());
      if (columns === 2) assert.equal(expected[0].length, 6);
      for (const hiddenClass of ['view-visualizer', 'layout-mini-player']) {
        await mountPipeline(page, columns, hiddenClass);
        const before = await page.evaluate(() => window.placements());
        assert.notDeepEqual(before, expected);
        if (columns === 2) assert.equal(before[0].length, 8);
        await page.evaluate(() => document.body.className = '');
        await page.waitForFunction(expectedPlacements =>
          JSON.stringify(window.placements()) === JSON.stringify(expectedPlacements), expected,
        { timeout: 3000 });
        assert.equal(await page.evaluate(() => window.createdItems.length), 15);
        assert.equal(await page.evaluate(() => window.createdItems.every(item => item.isConnected)), true);

        // Opening/closing effects and returning to the view must keep the chosen split.
        await page.evaluate(hidden => {
          window.createdItems[0].style.height = '800px';
          document.body.className = hidden;
        }, hiddenClass);
        await page.evaluate(() => document.body.className = '');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(await page.evaluate(() => window.placements()), expected);
      }
    }
  } finally {
    await browser.close();
  }
});

test('replacing or clearing a hidden pipeline cancels its pending layout measurement', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await mountPipeline(page, 2, 'view-visualizer');
    await page.evaluate(() => {
      window.oldItems = window.createdItems.slice();
      window.oldObserver = window.columnManager.pendingLayoutObserver;
      window.columnManager.audioManager.pipeline = [300, 50, 50, 50, 50]
        .map((height, id) => ({ height, id }));
      window.columnManager.distributePluginsToColumns();
    });
    assert.equal(await page.evaluate(() => window.columnManager.pendingLayoutObserver !== window.oldObserver), true);
    await page.evaluate(() => document.body.className = '');
    await page.waitForFunction(() => window.columnManager.pendingLayoutObserver === null);
    assert.deepEqual(await page.evaluate(() => window.placements()), [[0], [1, 2, 3, 4]]);
    assert.equal(await page.evaluate(() => window.oldItems.every(item => !item.isConnected)), true);

    await page.evaluate(() => {
      document.body.className = 'view-visualizer';
      window.columnManager.distributePluginsToColumns();
    });
    assert.equal(await page.evaluate(() => Boolean(window.columnManager.pendingLayoutObserver)), true);
    await page.evaluate(() => {
      window.columnManager.audioManager.pipeline = [];
      window.columnManager.handleEmptyPipelineState();
      document.body.className = '';
    });
    assert.equal(await page.evaluate(() => window.columnManager.pendingLayoutObserver), null);
    assert.deepEqual(await page.evaluate(() => window.placements()), []);
  } finally {
    await browser.close();
  }
});
