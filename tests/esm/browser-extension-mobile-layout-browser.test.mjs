import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../css/effetune-theme.css') +
  read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '') +
  read('../../css/effetune-mobile.css') +
  read('../../extension/editor.css');
const layoutModeSource = read('../../js/ui/layout-mode-manager.js').replace('export class LayoutModeManager', 'class LayoutModeManager');
const mobileShellSource = read('../../extension/mobile-shell.js').replace('export class ExtensionMobileShell', 'class ExtensionMobileShell');

test('extension editor fits mobile width and exposes the effect-list overlay controls', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 700 } });
    await page.setContent(`
      <body class="extension-editor">
        <header class="extension-header">
          <div class="extension-brand"><h1>EffeTune Pipeline Editor</h1></div>
          <div class="extension-session">
            <label class="editor-session-picker">Pipeline<select><option>Offline pipeline</option></select></label>
            <button class="header-button settings-menu-button" type="button">Settings</button>
          </div>
        </header>
        <div class="main-container">
          <div class="plugin-list-shell">
            <div class="plugin-list" id="pluginList">
              <div class="plugin-list-header"><div class="tab-switcher"><button class="tab-button">Effects</button></div></div>
            </div>
          </div>
          <div class="pipeline" id="pipeline"><div id="pipelineList"><div class="pipeline-column"></div></div></div>
        </div>
      </body>`);
    await page.addStyleTag({ content: `${css}\n* { transition: none !important; }` });
    await page.addScriptTag({ type: 'module', content: `
      ${layoutModeSource}
      ${mobileShellSource}
      const layoutMode = new LayoutModeManager();
      const mobileShell = new ExtensionMobileShell();
      layoutMode.onChange(mode => mobileShell.applyMode(mode));
      mobileShell.applyMode(layoutMode.mode);
      window.extensionMobileTest = { layoutMode, mobileShell };
    ` });
    await page.waitForFunction(() => !!window.extensionMobileTest);

    const closed = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const pluginList = document.getElementById('pluginList');
      const fab = rect('.mobile-plugin-fab');
      const headerButton = rect('.settings-menu-button');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        pipelineWidth: rect('#pipeline').width,
        pipelineListWidth: rect('#pipelineList').width,
        columnWidth: rect('.pipeline-column').width,
        columnCount: document.querySelectorAll('.pipeline-column').length,
        pluginListVisibility: getComputedStyle(pluginList).visibility,
        fab: { left: fab.left, right: fab.right, top: fab.top, bottom: fab.bottom },
        headerButton: { width: headerButton.width, height: headerButton.height }
      };
    });
    assert.equal(closed.scrollWidth, 375);
    assert.equal(closed.pipelineWidth, 375);
    assert.equal(closed.columnCount, 1);
    assert.equal(closed.columnWidth, closed.pipelineListWidth);
    assert.equal(closed.pluginListVisibility, 'hidden');
    assert.ok(closed.fab.left >= 0 && closed.fab.right <= 375);
    assert.ok(closed.fab.top >= 0 && closed.fab.bottom <= 700);
    assert.ok(closed.headerButton.width >= 40);
    assert.ok(closed.headerButton.height >= 40);

    await page.locator('.mobile-plugin-fab').click();
    const open = await page.locator('#pluginList').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        visibility: getComputedStyle(element).visibility,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
    });
    assert.equal(open.visibility, 'visible');
    assert.deepEqual(open, { visibility: 'visible', left: 0, top: 0, right: 375, bottom: 700 });

    await page.locator('.mobile-plugin-list-close').click();
    await assert.doesNotReject(page.waitForFunction(() =>
      getComputedStyle(document.getElementById('pluginList')).visibility === 'hidden'));

    await page.setViewportSize({ width: 1200, height: 700 });
    await assert.doesNotReject(page.waitForFunction(() =>
      document.body.classList.contains('layout-desktop') && !document.querySelector('.mobile-plugin-fab')));
    assert.equal(await page.locator('#pluginList').evaluate(element => element.classList.contains('mobile-open')), false);

    await page.setViewportSize({ width: 375, height: 700 });
    await assert.doesNotReject(page.waitForFunction(() =>
      document.body.classList.contains('layout-mobile') && !!document.querySelector('.mobile-plugin-fab')));
    assert.equal(await page.locator('.mobile-plugin-list-close').count(), 1);
  } finally {
    await browser.close();
  }
});
