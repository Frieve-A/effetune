import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

async function createAnalyzerPage(browser, { width, mobile, automatic = false }) {
  const page = await browser.newPage({
    viewport: { width, height: 844 }, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce'
  });
  // Load production styles and modules without starting a local server or audio pipeline.
  await page.route('https://effetune.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="${mobile ? 'layout-mobile' : 'layout-desktop'}">
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <body class="${mobile ? 'layout-mobile' : 'layout-desktop'}">
          <main class="main-container">
            ${automatic ? '<div class="plugin-list-shell"><div class="plugin-list" id="pluginList"></div><div class="plugin-list-pull-tab" id="pluginListPullTab"></div></div>' : ''}
            <div class="pipeline" id="pipeline">
              ${automatic ? '<button id="sidebarButton">Effects</button>' : ''}
              <button class="header-button pipeline-analyzer-button" id="pipelineAnalyzerButton">Analyzer</button>
              <button class="header-button remote-control-button" id="referenceRemote" data-state="listening" hidden>Remote Control</button>
              <div id="pipelineList"><div class="pipeline-column">
                <div class="pipeline-item" id="referenceEffect">
                  <div class="pipeline-item-header">
                    <div class="handle">☰</div><button class="toggle-button">ON</button>
                    <div class="plugin-name">Volume</div><button class="delete-button">×</button>
                  </div>
                  <div class="plugin-ui expanded"><div class="plugin-parameter-ui">
                    <div class="parameter-row"><label>Volume:</label>
                      <input type="range"><input type="number" value="0">
                    </div>
                  </div></div>
                </div>
                <div class="pipeline-item" id="nextEffect">Next effect</div>
              </div></div>
            </div>
            <aside class="pipeline-analyzer-panel" id="pipelineAnalyzerPanel" hidden></aside>
          </main>
        </body></html>`
    });
    try {
      return route.fulfill({
        contentType: pathname.endsWith('.js') ? 'text/javascript' : 'text/css',
        body: readFileSync(new URL(`../..${pathname}`, import.meta.url))
      });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto('https://effetune.test/');
  for (const name of ['effetune', 'effetune-mobile', 'pipeline-analyzer']) {
    await page.addStyleTag({ url: `https://effetune.test/css/${name}.css` });
  }
  await page.evaluate(async automatic => {
    const { PipelineAnalyzerUI } = await import('/js/pipeline-analyzer/ui.js');
    if (automatic) {
      const { PipelineColumnManager } = await import('/js/ui/pipeline/pipeline-column-manager.js');
      const { CollapseManager } = await import('/js/ui/plugin-list/collapse-manager.js');
      const reference = document.getElementById('referenceEffect');
      const core = {
        pipelineList: document.getElementById('pipelineList'),
        audioManager: { pipeline: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        itemBuilder: { createPipelineItem(plugin) {
          const item = reference.cloneNode(true);
          item.id = `effect${plugin.id}`;
          item.style.height = '900px';
          return item;
        } },
        updateSelectionClasses() {}
      };
      window.app = { initialized: true };
      window.appConfig = { pipelineColumnMode: 'automatic' };
      window.uiManager = { layoutMode: { isMobile: false }, pipelineManager: { core } };
      localStorage.setItem('pipelineColumns', '4');
      core.columnManager = new PipelineColumnManager(core);
      window.columnManager = core.columnManager;
      window.collapseManager = new CollapseManager({ pluginList: document.getElementById('pluginList') });
      window.uiManager.pluginListManager = { updatePositions: () => window.collapseManager.updatePositions() };
      core.columnManager.setupResponsiveColumnAdjustment();
    }
    window.analyzer = new PipelineAnalyzerUI({
      onLayoutChange: () => {
        if (window.columnManager?.isAutomatic()) window.collapseManager.checkWindowWidthAndAdjust();
      }
    });
  }, automatic);
  await page.locator('#pipelineAnalyzerButton').click();
  await page.mouse.move(0, 0);
  return page;
}

test('unavailable analysis views hide the previous response graph and restore it on return', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createAnalyzerPage(browser, { width: 1440, mobile: false });
    await page.evaluate(() => {
      const ui = window.analyzer;
      ui.setConfiguration({ ...ui.getConfiguration(), graphView: 'frequency',
        measurementSettings: { ...ui.getConfiguration().measurementSettings, signalType: 'mls' } });
      ui.setResult({ views: {
        frequency: { curves: [{ id: 'after', label: 'After', color: '#00ff00', points: [
          { x: 0, y: 0.5, xValue: 20, yValue: 0 },
          { x: 1, y: 0.5, xValue: 20000, yValue: 0 }
        ] }] },
        distortion: { available: false, reason: 'ess-required' },
        waterfall: { available: false }
      } });
    });
    const graph = page.locator('.pipeline-analyzer-graph');
    const overlay = page.locator('.pipeline-analyzer-hover-overlay');
    assert.equal(await graph.isVisible(), true);
    assert.equal(await graph.locator('.pipeline-analyzer-curve').count(), 1);
    for (const view of ['distortion', 'waterfall']) {
      await page.locator(`input[name="pipelineAnalyzerGraphView"][value="${view}"]`).check();
      for (const svg of [graph, overlay]) {
        assert.deepEqual(await svg.evaluate(element => ({
          hiddenAttribute: element.hasAttribute('hidden'), display: getComputedStyle(element).display
        })), { hiddenAttribute: true, display: 'none' });
        assert.equal(await svg.isVisible(), false);
      }
      assert.equal(await page.locator('.pipeline-analyzer-analysis-message').isVisible(), true);
      await page.locator('input[name="pipelineAnalyzerGraphView"][value="frequency"]').check();
      for (const svg of [graph, overlay]) {
        assert.equal(await svg.getAttribute('hidden'), null);
        assert.equal(await svg.isVisible(), true);
      }
      assert.equal(await graph.locator('.pipeline-analyzer-curve').count(), 1);
      assert.equal(await page.locator('.pipeline-analyzer-analysis-message').isVisible(), false);
    }
  } finally {
    await browser.close();
  }
});

test('Analyzer follows effect spacing, page scrolling, and header expansion', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const layout of [
      { width: 390, mobile: true },
      { width: 900, mobile: true },
      { width: 900, mobile: false },
      { width: 1440, mobile: false }
    ]) {
      await t.test(`${layout.mobile ? 'mobile' : 'desktop'} at ${layout.width}px`, async () => {
        const page = await createAnalyzerPage(browser, layout);
        try {
          const panel = page.locator('#pipelineAnalyzerPanel');
          const body = page.locator('#pipelineAnalyzerBody');
          const buttonFace = selector => page.locator(selector).evaluate(element => {
            for (const animation of element.getAnimations()) animation.finish();
            const style = getComputedStyle(element);
            return { background: style.backgroundImage, color: style.color };
          });
          const activeFace = await buttonFace('#pipelineAnalyzerButton');
          assert.deepEqual(activeFace, await buttonFace('#referenceRemote'));
          const effectButtonHeight = (await page.locator('#referenceEffect .toggle-button').boundingBox()).height;
          for (const name of ['Add Output', 'Refresh measurements']) {
            const button = page.getByRole('button', { name, exact: true });
            assert.equal((await button.boundingBox()).height, effectButtonHeight,
              `${name} must match the standard Effect button height`);
          }
          await page.evaluate(() => window.analyzer.setAudioFormat({ sampleRate: 48000, channelCount: 4 }));
          for (let output = 1; output < 4; output++) {
            await page.getByRole('button', { name: 'Add Output', exact: true }).click();
          }
          await page.locator('.pipeline-analyzer-settings summary').click();
          const scrolling = await panel.evaluate(element => {
            const body = document.querySelector('#pipelineAnalyzerBody');
            const top = element.getBoundingClientRect().top;
            const scrollY = window.scrollY;
            window.scrollBy({ top: 80, behavior: 'instant' });
            return {
              panelOverflow: element.scrollHeight - element.clientHeight,
              bodyOverflow: body.scrollHeight - body.clientHeight,
              overflowY: [getComputedStyle(element).overflowY, getComputedStyle(body).overflowY],
              pageScroll: window.scrollY - scrollY,
              panelScroll: top - element.getBoundingClientRect().top
            };
          });
          assert.equal(scrolling.panelOverflow, 0);
          assert.equal(scrolling.bodyOverflow, 0);
          assert.deepEqual(scrolling.overflowY, ['visible', 'visible']);
          assert.ok(scrolling.pageScroll > 0);
          assert.equal(scrolling.panelScroll, scrolling.pageScroll);
          if (layout.mobile) {
            const geometry = await page.evaluate(() => {
              const rect = selector => {
                const { left, right, top, bottom } = document.querySelector(selector).getBoundingClientRect();
                return { left, right, top, bottom };
              };
              const insets = element => {
                const style = getComputedStyle(element);
                return ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop']
                  .map(property => style[property]);
              };
              const body = document.querySelector('#pipelineAnalyzerBody');
              return {
                panel: rect('#pipelineAnalyzerPanel'), effect: rect('#referenceEffect'), next: rect('#nextEffect'),
                title: rect('.pipeline-analyzer-title'), handle: rect('#referenceEffect .handle'),
                close: rect('.pipeline-analyzer-close'), remove: rect('#referenceEffect .delete-button'),
                input: rect('#pipelineAnalyzerInput'), graph: rect('.pipeline-analyzer-graph-section'),
                displayNumber: rect('.pipeline-analyzer-display-control input[type="number"]'),
                effectNumber: rect('#referenceEffect input[type="number"]'),
                parameters: rect('#referenceEffect .parameter-row'),
                bodyInsets: insets(body), effectInsets: insets(document.querySelector('#referenceEffect .plugin-ui'))
              };
            });
            assert.equal(geometry.panel.left, geometry.effect.left);
            assert.equal(geometry.panel.right, geometry.effect.right);
            assert.equal(geometry.title.left, geometry.handle.left);
            assert.equal(geometry.close.right, geometry.remove.right);
            assert.equal(geometry.input.left, geometry.parameters.left);
            assert.equal(geometry.graph.right, geometry.parameters.right);
            assert.equal(geometry.displayNumber.right, geometry.effectNumber.right);
            assert.deepEqual(geometry.bodyInsets, geometry.effectInsets);
            assert.equal(geometry.effect.top - geometry.panel.bottom, geometry.next.top - geometry.effect.bottom);
          }
          assert.equal(await body.isVisible(), true);
          const expandedHeight = (await panel.boundingBox()).height;
          const collapse = page.getByRole('button', { name: 'Collapse Analyzer', exact: true });
          if (layout.mobile) await collapse.tap();
          else await collapse.click();
          assert.equal(await body.isVisible(), false, 'collapsed content must be hidden by the rendered CSS');
          const expand = page.getByRole('button', { name: 'Expand Analyzer', exact: true });
          assert.equal(await expand.getAttribute('aria-expanded'), 'false');
          assert.deepEqual(await buttonFace('#pipelineAnalyzerButton'), activeFace);
          const collapsedHeight = (await panel.boundingBox()).height;
          assert.equal(collapsedHeight, (await page.locator('.pipeline-analyzer-header').boundingBox()).height);
          assert.ok(collapsedHeight < expandedHeight);
          const close = panel.getByRole('button', { name: 'Close Pipeline Analyzer', exact: true });
          for (const button of [expand, close]) {
            const { width, height } = await button.boundingBox();
            assert.deepEqual({ width, height }, layout.mobile ? { width: 40, height: 40 } : { width: 24, height: 24 });
          }
          await expand.press('Enter');
          assert.equal(await body.isVisible(), true);
          assert.equal(await collapse.getAttribute('aria-expanded'), 'true');
          assert.equal((await panel.boundingBox()).height, expandedHeight);
          await close.click();
          assert.equal(await panel.isVisible(), false);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'pipelineAnalyzerButton');
          assert.equal(await page.locator('#pipelineAnalyzerButton').getAttribute('aria-pressed'), 'false');
          assert.notDeepEqual(await buttonFace('#pipelineAnalyzerButton'), activeFace);
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});

test('Sidebar controls retain manual expansion after Analyzer layout observations', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createAnalyzerPage(browser, { width: 1253, mobile: false, automatic: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1253, height: 700 });
    await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
    const settle = async () => {
      await page.waitForFunction(() => document.getAnimations().every(animation =>
        animation.playState !== 'running' && !animation.pending));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await settle();
    for (const open of [true, false]) {
      await page.evaluate(open => window.analyzer.setOpen(open), open);
      await settle();
      if (!await page.evaluate(() => window.collapseManager.isCollapsed)) {
        await page.locator('#sidebarButton').click();
        await settle();
      }
      for (const id of ['sidebarButton', 'pluginListPullTab']) {
        await page.locator(`#${id}`).click();
        await settle();
        assert.equal(await page.evaluate(() => window.collapseManager.isCollapsed), false,
          `${id} must retain manual expansion with the Analyzer ${open ? 'open' : 'closed'}`);
        assert.equal(await page.locator(`#${id}`).getAttribute('aria-expanded'), 'true');
        await page.locator(`#${id}`).click();
        await settle();
        assert.equal(await page.evaluate(() => window.collapseManager.isCollapsed), true);
      }
    }
  } finally {
    await browser.close();
  }
});

test('side Analyzer fills spare width without changing column or sidebar thresholds', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createAnalyzerPage(browser, { width: 2560, mobile: false, automatic: true });
    const columns = () => page.locator('.pipeline-column').count();
    const assertFills = () => page.waitForFunction(() => {
      const panel = document.getElementById('pipelineAnalyzerPanel');
      const pipeline = document.getElementById('pipeline');
      const graph = panel.querySelector('.pipeline-analyzer-graph-shell');
      const bodyStyle = getComputedStyle(document.body);
      const pipelineStyle = getComputedStyle(pipeline);
      const analyzerBodyStyle = getComputedStyle(panel.querySelector('.pipeline-analyzer-body'));
      const zoom = parseFloat(bodyStyle.zoom) || 1;
      const rect = panel.getBoundingClientRect();
      const rightEdge = document.documentElement.clientWidth - parseFloat(bodyStyle.paddingRight) * zoom;
      const pipelineWidth = parseFloat(pipeline.style.width) +
        parseFloat(pipelineStyle.paddingLeft) + parseFloat(pipelineStyle.paddingRight);
      const graphWidth = rect.width - zoom *
        (parseFloat(analyzerBodyStyle.paddingLeft) + parseFloat(analyzerBodyStyle.paddingRight));
      return Math.abs(rect.right + window.scrollX - rightEdge) < 1 &&
        rect.width >= parseFloat(getComputedStyle(panel).flexBasis) * zoom - 1 &&
        Math.abs(pipeline.getBoundingClientRect().width - pipelineWidth * zoom) < 1 &&
        (panel.classList.contains('is-collapsed') || Math.abs(graph.getBoundingClientRect().width - graphWidth) < 1);
    });
    assert.equal(await columns(), 1);
    await assertFills();
    await page.locator('#pipelineAnalyzerButton').click();
    assert.equal(await columns(), 2);
    await page.evaluate(() => window.analyzer.setOpen(true));
    assert.equal(await columns(), 1);
    await page.getByRole('button', { name: 'Collapse Analyzer', exact: true }).click();
    assert.equal(await columns(), 1, 'the collapsed Analyzer still occupies its side panel');
    await assertFills();
    await page.locator('#pipelineAnalyzerPanel').getByRole('button', { name: 'Close Pipeline Analyzer', exact: true }).click();
    assert.equal(await columns(), 2);
    await page.evaluate(() => {
      window.analyzer.setCollapsed(false);
      window.analyzer.setOpen(true);
    });
    for (const [width, expected, collapsed] of [
      [3840, 2, false], [4160, 3, false], [1943, 1, true], [1944, 1, false],
      [1800, 1, true], [1100, 1, true], [2560, 1, false]
    ]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(({ expected, collapsed }) =>
        window.columnManager.renderedColumns === expected && window.collapseManager.isCollapsed === collapsed,
      { expected, collapsed });
      if (width >= 1800) await assertFills();
      assert.equal(await page.evaluate(() => localStorage.getItem('pipelineColumns')), '4');
    }
    await page.evaluate(() => { document.body.style.zoom = '0.5'; });
    await page.waitForFunction(() => window.columnManager.renderedColumns === 3);
    await assertFills();
    await page.evaluate(() => {
      document.body.classList.add('view-visualizer');
      window.columnManager.adjustColumnsToWindow();
    });
    assert.equal(await columns(), 3);
    await page.evaluate(() => window.analyzer.setOpen(false));
    assert.equal(await columns(), 4);
    await page.evaluate(() => {
      window.analyzer.setOpen(true);
      document.body.classList.remove('view-visualizer');
      document.body.style.zoom = '1';
    });
    await page.waitForFunction(() => window.columnManager.renderedColumns === 1);
    await page.evaluate(() => window.scrollTo({ top: 300, left: 0, behavior: 'instant' }));
    const sticky = await page.evaluate(() => ({
      scroll: window.scrollY,
      analyzerTop: document.getElementById('pipelineAnalyzerPanel').getBoundingClientRect().top,
      listTop: document.getElementById('pluginList').getBoundingClientRect().top
    }));
    assert.equal(sticky.scroll, 300);
    assert.equal(sticky.analyzerTop, 20);
    assert.equal(sticky.analyzerTop, sticky.listTop);
    await page.evaluate(() => {
      window.appConfig.pipelineColumnMode = 'manual';
      window.columnManager.updatePipelineColumns(4);
      window.analyzer.setOpen(false);
    });
    assert.equal(await columns(), 4);
    await page.evaluate(() => window.analyzer.setOpen(true));
    assert.equal(await columns(), 4);
    assert.equal(await page.evaluate(() => localStorage.getItem('pipelineColumns')), '4');
    await page.waitForFunction(() => {
      const panel = document.getElementById('pipelineAnalyzerPanel');
      return panel.getBoundingClientRect().width === 460;
    });
    await page.evaluate(() => window.columnManager.updatePipelineColumns(1));
    await assertFills();
  } finally {
    await browser.close();
  }
});
