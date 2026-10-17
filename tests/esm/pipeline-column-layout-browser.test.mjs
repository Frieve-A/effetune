import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../css/effetune-theme.css') +
  read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '');
const managerSource = read('../../js/ui/pipeline/pipeline-column-manager.js')
  .replace('export class PipelineColumnManager', 'class PipelineColumnManager');
const collapseSource = read('../../js/ui/plugin-list/collapse-manager.js')
  .replace('export class CollapseManager', 'class CollapseManager');
const appHtml = read('../../effetune.html');
const pipelineHeader = appHtml.slice(appHtml.indexOf('<div class="pipeline-header">'),
  appHtml.indexOf('<div id="pipelineList">'));

async function mountPipeline(page, columns, hiddenClass = '') {
  await page.setContent(`<body class="${hiddenClass}">
    <div class="main-container">
      <div class="plugin-list-shell"><div class="plugin-list" id="pluginList"></div>
        <button class="plugin-list-pull-tab" id="pluginListPullTab"></button>
      </div>
      <div class="pipeline" id="pipeline">${pipelineHeader}<div id="pipelineList"></div></div>
    </div>
  </body>`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: managerSource });
  await page.evaluate(columnCount => {
    Object.defineProperty(window, 'localStorage', { configurable: true,
      value: { getItem() { return null; }, setItem() {} } });
    window.uiManager = { layoutMode: { isMobile: false } };
    window.appConfig = { pipelineColumnMode: 'manual' };
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

test('automatic columns fit desktop widths, track resizing, and preserve manual and mobile layouts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 3840, height: 1080 } });
    await mountPipeline(page, 4);
    await page.addScriptTag({ content: collapseSource });
    await page.evaluate(() => {
      const values = new Map([['pipelineColumns', '4']]);
      Object.defineProperty(window, 'localStorage', { configurable: true, value: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value))
      } });
      window.appConfig = {};
      window.app = { initialized: true };
      window.uiManager.pipelineManager = { core: { columnManager: window.columnManager } };
      // Match application order: sidebar resize handling is registered first.
      window.collapseManager = new CollapseManager({ pluginList: document.getElementById('pluginList') });
      window.uiManager.pluginListManager = { updatePositions: () => window.collapseManager.updatePositions() };
      window.sidebarToggles = [];
      const toggle = window.collapseManager.togglePluginListCollapse.bind(window.collapseManager);
      window.collapseManager.togglePluginListCollapse = () => {
        window.sidebarToggles.push(window.innerWidth);
        toggle();
      };
      window.columnManager.setupColumnControl();
      window.columnManager.setupResponsiveColumnAdjustment();
    });
    const columnCount = () => page.locator('.pipeline-column').count();
    const assertToolbarRightEdge = async buttonId => {
      const offset = await page.evaluate(id => {
        const button = document.getElementById(id).getBoundingClientRect();
        const effect = document.querySelector('.pipeline-column:last-child .pipeline-item').getBoundingClientRect();
        return button.right - effect.right;
      }, buttonId);
      assert.ok(Math.abs(offset) < 1, `${buttonId} is offset from the effect panel by ${offset}px`);
    };
    assert.equal(await columnCount(), 3);
    assert.equal(await page.locator('#increaseColumnsButton').isVisible(), false);
    assert.equal(await page.locator('#decreaseColumnsButton').isVisible(), false);
    await assertToolbarRightEdge('pipelineAnalyzerButton');

    for (const [width, expected] of [[2560, 2], [1920, 1], [3840, 3], [1400, 1], [12000, 8], [1920, 1]]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.waitForFunction(count => document.querySelectorAll('.pipeline-column').length === count, expected);
      assert.equal(await page.evaluate(() => localStorage.getItem('pipelineColumns')), '4');
      assert.equal(await page.evaluate(() => window.collapseManager.isCollapsed), width === 1400);
      if (width >= 1920) {
        // Wait for the existing width transition before checking the rendered edge.
        await page.waitForFunction(() => document.getElementById('pipeline').getBoundingClientRect().right <=
          document.documentElement.clientWidth - 20);
      }
    }
    assert.deepEqual(await page.evaluate(() => window.sidebarToggles), [1400, 12000]);
    // Electron changes CSS zoom without dispatching a window resize event.
    for (const [width, zoom, expected, collapsed] of [[2560, 1.5, 1, false], [2560, .5, 4, false],
      [1920, 1.5, 1, true], [1920, 1, 1, false]]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.evaluate(zoom => { document.body.style.zoom = zoom; }, zoom);
      await page.waitForFunction(({ expected, collapsed }) =>
        document.querySelectorAll('.pipeline-column').length === expected &&
        window.collapseManager.isCollapsed === collapsed, { expected, collapsed });
      await page.waitForFunction(() => document.getElementById('pipeline').getBoundingClientRect().right <=
        document.documentElement.clientWidth - 10);
      assert.equal(await page.evaluate(() => localStorage.getItem('pipelineColumns')), '4');
    }
    const created = await page.evaluate(() => window.createdItems.length);
    await page.setViewportSize({ width: 2000, height: 1080 });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.createdItems.length), created);

    // A collapsed sidebar must still have enough space to be reopened.
    await page.evaluate(() => document.querySelector('.main-container').classList.add('plugin-list-collapsed'));
    await page.setViewportSize({ width: 2400, height: 1080 });
    await page.waitForTimeout(250);
    assert.equal(await columnCount(), 1);

    await page.evaluate(() => {
      window.uiManager.layoutMode.isMobile = true;
      window.columnManager.updatePipelineColumns(window.columnManager.getCurrentColumns());
    });
    await page.setViewportSize({ width: 3840, height: 1080 });
    await page.waitForTimeout(250);
    assert.equal(await columnCount(), 1);
    assert.equal(await page.evaluate(() => document.getElementById('pipeline').style.width), '100%');

    await page.evaluate(() => {
      window.uiManager.layoutMode.isMobile = false;
      window.appConfig.pipelineColumnMode = 'manual';
      window.columnManager.updatePipelineColumns(window.columnManager.getCurrentColumns());
    });
    assert.equal(await columnCount(), 4);
    assert.equal(await page.locator('#increaseColumnsButton').isVisible(), true);
    assert.equal(await page.locator('#decreaseColumnsButton').isVisible(), true);
    assert.equal(await page.locator('#increaseColumnsButton').isDisabled(), false);
    await assertToolbarRightEdge('increaseColumnsButton');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(250);
    assert.equal(await columnCount(), 4);
    await page.locator('#decreaseColumnsButton').click();
    assert.equal(await columnCount(), 3);
    assert.equal(await page.evaluate(() => localStorage.getItem('pipelineColumns')), '3');
    for (const count of [1, 8]) {
      await page.evaluate(count => window.columnManager.updatePipelineColumns(count), count);
      assert.equal(await page.locator('#increaseColumnsButton').isVisible(), true);
      assert.equal(await page.locator('#decreaseColumnsButton').isVisible(), true);
      assert.equal(await page.locator(count === 1 ? '#decreaseColumnsButton' : '#increaseColumnsButton').isDisabled(), true);
      await assertToolbarRightEdge('increaseColumnsButton');
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
