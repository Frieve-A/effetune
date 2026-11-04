import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const baseCss = read('../../css/effetune-theme.css') +
  read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '');
const extensionCss = read('../../extension/editor.css');
const settingsUrl = 'data:text/javascript;base64,' + Buffer.from(read('../../js/settings-storage.js')).toString('base64');
const collapseManagerSource = read('../../js/ui/plugin-list/collapse-manager.js')
  .replace('../../settings-storage.js', settingsUrl)
  .replace('export class CollapseManager', 'class CollapseManager');

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

test('extension editor collapses its desktop sidebar before the fixed pipeline overflows', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.setContent(`
      <body class="extension-editor layout-desktop">
        <div class="main-container">
          <div class="plugin-list-shell">
            <div class="plugin-list" id="pluginList"></div>
            <div class="plugin-list-pull-tab" id="pluginListPullTab">◀</div>
          </div>
          <div class="pipeline" id="pipeline"><div id="pipelineList"><div class="pipeline-column"></div></div></div>
        </div>
      </body>`);
    await page.addStyleTag({ content: `${baseCss}${extensionCss}\n* { transition: none !important; }` });
    await page.locator('#pipeline').evaluate(element => { element.style.width = '1104px'; });
    const expanded = await page.evaluate(() => ({
      pipelineRight: document.getElementById('pipeline').getBoundingClientRect().right,
      scrollWidth: document.documentElement.scrollWidth
    }));
    assert.ok(expanded.pipelineRight > 1180);
    assert.ok(expanded.scrollWidth > 1200);

    await page.addScriptTag({ type: 'module', content: `
      ${collapseManagerSource}
      window.appInitializedListener = true;
      window.uiManager = { layoutMode: { isMobile: false } };
      const manager = new CollapseManager({ pluginList: document.getElementById('pluginList') });
      manager.markReady();
      window.extensionCollapseTest = manager;
    ` });
    await page.waitForFunction(() => document.querySelector('.main-container').classList.contains('plugin-list-collapsed'));
    const collapsed = await page.evaluate(() => ({
      pipelineRight: document.getElementById('pipeline').getBoundingClientRect().right,
      scrollWidth: document.documentElement.scrollWidth,
      ariaExpanded: document.getElementById('pluginListPullTab').getAttribute('aria-expanded')
    }));
    assert.ok(collapsed.pipelineRight <= 1180);
    assert.equal(collapsed.scrollWidth, 1200);
    assert.equal(collapsed.ariaExpanded, 'false');

    await page.setViewportSize({ width: 1600, height: 700 });
    await page.waitForFunction(() => !document.querySelector('.main-container').classList.contains('plugin-list-collapsed'));
    const expandedAgain = await page.evaluate(() => ({
      pipelineRight: document.getElementById('pipeline').getBoundingClientRect().right,
      scrollWidth: document.documentElement.scrollWidth
    }));
    assert.ok(expandedAgain.pipelineRight <= 1580);
    assert.equal(expandedAgain.scrollWidth, 1600);
  } finally {
    await browser.close();
  }
});

test('extension editor colors stay on the canonical theme in every browser color mode', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 700 } });
    await page.setContent(`
      <body class="extension-editor">
        <header class="extension-header">
          <div class="extension-brand"><h1>EffeTune</h1><p>Listening tab</p></div>
          <span class="editor-status">Connected</span>
        </header>
        <div class="pipeline-item">
          <span class="plugin-name">Graphic Equalizer</span>
          <select><option>Preset</option></select>
          <input type="text" value="0.0">
        </div>
      </body>`);
    await page.addStyleTag({ content: `${baseCss}${extensionCss}\n* { transition: none !important; }` });

    const captureColors = async colorScheme => {
      await page.emulateMedia({ colorScheme });
      return page.evaluate(() => {
        const style = selector => getComputedStyle(document.querySelector(selector));
        return {
          rootColorScheme: getComputedStyle(document.documentElement).colorScheme,
          body: { color: style('body').color, background: style('body').backgroundColor },
          header: { color: style('h1').color, background: style('header').backgroundColor },
          pluginName: style('.plugin-name').color,
          select: { color: style('select').color, background: style('select').backgroundColor },
          input: { color: style('input').color, background: style('input').backgroundColor }
        };
      });
    };

    const lightBrowser = await captureColors('light');
    const darkBrowser = await captureColors('dark');
    assert.deepEqual(lightBrowser, darkBrowser);
    assert.equal(lightBrowser.rootColorScheme, 'dark');
    assert.equal(lightBrowser.pluginName, 'rgb(246, 248, 251)');
    assert.notEqual(lightBrowser.pluginName, lightBrowser.body.background);
    assert.notEqual(lightBrowser.select.color, lightBrowser.select.background);
    assert.notEqual(lightBrowser.input.color, lightBrowser.input.background);
  } finally {
    await browser.close();
  }
});


test('extension popup keeps long tab titles truncated and Apply reachable', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 340, height: 600 } });
    const html = read('../../extension/popup.html')
      .replace('<link rel="stylesheet" href="extension/popup.css">', '')
      .replace('<script type="module" src="extension/popup.js"></script>', '');
    await page.setContent(html);
    await page.addStyleTag({ content: read('../../extension/popup.css') });
    await page.locator('#emptySessions').evaluate(element => { element.hidden = true; });
    await page.locator('#sessionList').evaluate(element => {
      element.innerHTML = `
        <article class="session-row">
          <label class="session-row-main">
            <input type="radio" checked>
            <span class="session-row-copy">
              <span class="session-title"></span>
              <span class="session-status"><span class="status-indicator processing"></span>Processing</span>
            </span>
          </label>
          <div class="session-actions"><label><input type="checkbox">Bypass</label><button>Stop</button></div>
        </article>`;
    });
    for (const title of ['Short title', '長いブラウザタブのタイトルです。'.repeat(50), 'x'.repeat(1000)]) {
      await page.locator('.session-title').evaluate((element, text) => {
        element.textContent = text;
      }, title);
      const layout = await page.evaluate(() => {
        const title = document.querySelector('.session-title');
        const apply = document.getElementById('applyPresetButton').getBoundingClientRect();
        return {
          width: document.body.getBoundingClientRect().width,
          scrollWidth: document.documentElement.scrollWidth,
          titleWidth: title.clientWidth,
          titleScrollWidth: title.scrollWidth,
          ellipsis: getComputedStyle(title).textOverflow,
          applyLeft: apply.left,
          applyRight: apply.right
        };
      });
      assert.equal(layout.width, 340);
      assert.equal(layout.scrollWidth, 340);
      assert.ok(layout.applyLeft > 0 && layout.applyRight <= 340);
      if (title.length > 100) {
        assert.ok(layout.titleScrollWidth > layout.titleWidth);
        assert.equal(layout.ellipsis, 'ellipsis');
      }
      await page.locator('#applyPresetButton').evaluate(button => { button.disabled = false; });
      await page.locator('#applyPresetButton').click({ timeout: 2000 });
    }
  } finally {
    await browser.close();
  }
});

test('extension popup uses the available width in a mobile browser tab', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 700 } });
    const html = read('../../extension/popup.html')
      .replace('<link rel="stylesheet" href="extension/popup.css">', '')
      .replace('<script type="module" src="extension/popup.js"></script>', '');
    await page.setContent(html);
    await page.addStyleTag({ content: read('../../extension/popup.css') });

    const layout = await page.evaluate(() => {
      const body = document.body.getBoundingClientRect();
      const controls = [...document.querySelectorAll('button, select')].map(element =>
        element.getBoundingClientRect().height);
      return {
        body: { left: body.left, right: body.right, width: body.width },
        scrollWidth: document.documentElement.scrollWidth,
        minimumControlHeight: Math.min(...controls)
      };
    });
    assert.deepEqual(layout.body, { left: 0, right: 412, width: 412 });
    assert.equal(layout.scrollWidth, 412);
    assert.ok(layout.minimumControlHeight >= 40);
  } finally {
    await browser.close();
  }
});
