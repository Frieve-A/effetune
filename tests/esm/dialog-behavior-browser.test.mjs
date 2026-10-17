import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

// Serve production modules through interception without starting a local server.
async function createPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await page.route('https://effetune.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><button id="anchor">Open</button></body>' });
    try {
      const body = readFileSync(new URL(`../..${pathname}`, import.meta.url));
      const contentType = /\.m?js$/.test(pathname) ? 'text/javascript'
        : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      return route.fulfill({ contentType, body });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto('https://effetune.test/');
  for (const name of ['effetune', 'effetune-library', 'user-data-backup', 'asset-library']) {
    await page.addStyleTag({ url: `https://effetune.test/css/${name}.css` });
  }
  return page;
}

const cases = [
  ['backup', '.backup-restore-dialog'], ['restore', '.backup-restore-dialog'], ['ai', '.ai-dialog'],
  ['routing', '.routing-dialog'], ['presets', '.preset-dialog'],
  ['asset', '.ir-library-dialog'], ['midi', '.midi-mapping-dialog'], ['about', '.about-dialog'],
  ['confirmation', '#confirmationDialog'], ['notification', '#notificationDialog']
];

test('production dialogs fit desktop CSS zoom and Escape closes them from their initial focus', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [kind, selector] of cases) {
      for (const initialZoom of [1, 3]) {
        const page = await createPage(browser);
        await page.evaluate(value => { document.body.style.zoom = value; }, initialZoom);
        await page.evaluate(async kind => {
          window.uiManager = { t: key => key };
          const anchor = document.querySelector('#anchor');
          anchor.focus();
          if (kind === 'backup' || kind === 'restore') {
            const { openUserDataBackupDialog } = await import('/js/user-data-backup/dialog.js');
            openUserDataBackupDialog({ service: {
              listBackup: async () => ({ items: [] }), select: async (_catalog, keys) => keys
            } });
            await new Promise(resolve => setTimeout(resolve, 0));
            if (kind === 'restore') document.querySelectorAll('.backup-restore-tabs button')[1].click();
          } else if (kind === 'ai') {
            const { PipelineAIDialog } = await import('/js/ui/pipeline/pipeline-ai-dialog.js');
            new PipelineAIDialog({ pluginManager: {} }).showAIDialog({ name: 'Equalizer' }, anchor);
          } else if (kind === 'routing' || kind === 'presets') {
            const { PipelineRoutingDialog } = await import('/js/ui/pipeline/pipeline-routing-dialog.js');
            const routingDialog = new PipelineRoutingDialog({});
            if (kind === 'routing') routingDialog.showRoutingDialog({ id: 1, channel: null, inputBus: null, outputBus: null }, anchor);
            else {
              const { PluginPresetDialog } = await import('/js/ui/pipeline/plugin-preset-dialog.js');
              await new PluginPresetDialog({ routingDialog }).show({
                listUserPresetNames: async () => [], getTitleKey: () => 'Presets'
              }, anchor, { focusSaveName: true });
            }
          } else if (kind === 'asset') {
            const { openAssetLibraryBrowser } = await import('/js/ui/asset-library-browser.js');
            let entries = [{ id: 'one', name: 'Impulse response' }];
            openAssetLibraryBrowser({
              service: { list: async () => entries, delete: async () => { entries = []; return { removed: true }; } },
              translate: (_key, fallback) => fallback, formatBadge: () => ''
            });
          } else if (kind === 'midi') {
            const { MidiMappingDialog } = await import('/js/midi/midi-mapping-dialog.js');
            await new MidiMappingDialog({ manager: {
              setDialogOpen: async () => {}, onChange: () => () => {}, cancelLearn() {},
              isSupported: () => true, listInputs: () => [], listGamepads: () => [],
              store: { mappings: [] }
            } }).open();
          } else if (kind === 'about') {
            const { ElectronIntegration } = await import('/js/electron-integration.js');
            await ElectronIntegration.prototype.showAboutDialog.call({ isElectron: true }, { version: 'test' });
          } else {
            document.body.insertAdjacentHTML('beforeend', `
              <div id="confirmationDialog" class="dialog-overlay" style="display:none"><div class="dialog-content">
                <p id="confirmationMessage"></p><button id="cancelBtn">Cancel</button></div></div>
              <div id="notificationDialog" class="dialog-overlay" style="display:none"><div class="dialog-content">
                <p id="notificationMessage"></p><button id="notificationOkBtn">OK</button></div></div>`);
            const { default: DialogController } = await import('/features/measurement/ui/dialog-controller.js');
            const controller = new DialogController({ pendingAction: () => { throw new Error('Escape must not confirm'); } });
            if (kind === 'confirmation') controller.showConfirmation('Confirm deletion');
            else controller.showNotification('Notification');
          }
        }, kind);
        if (kind === 'confirmation' || kind === 'notification') {
          await page.addStyleTag({ url: 'https://effetune.test/features/measurement/styles.css' });
        }
        await page.locator(selector).waitFor();
        if (kind === 'asset') {
          page.on('dialog', dialog => dialog.accept());
          await page.locator('.ir-library-entry button').last().click();
          await page.locator('.ir-library-entry').waitFor({ state: 'detached' });
        }
        for (const zoom of [1, 1.5, 2, 3]) {
          await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
          const bounds = await page.locator(selector).boundingBox();
          assert.ok(bounds.x >= -1 && bounds.y >= -1, `${kind} ${zoom}: top/left`);
          assert.ok(bounds.x + bounds.width <= 1281, `${kind} ${zoom}: right`);
          assert.ok(bounds.y + bounds.height <= 721, `${kind} ${zoom}: bottom`);
          await page.locator(`${selector} button:not(:disabled):visible`).last().click({ trial: true, timeout: 2000 });
        }
        if (kind === 'routing') {
          await page.locator(`${selector} select`).first().focus();
          await page.keyboard.press('Space');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator(selector).isVisible(), true, 'Escape closes an open selector first');
        }
        await page.keyboard.press('Escape');
        await page.locator(selector).waitFor({ state: 'hidden', timeout: 2000 });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
