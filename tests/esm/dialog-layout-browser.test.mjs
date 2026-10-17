import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const injectedStyle = (path, assignment) => read(path).split(assignment)[1].split('`;')[0];
const css = [
  '../../css/effetune-theme.css', '../../css/effetune.css',
  '../../css/effetune-library.css', '../../css/asset-library.css',
  '../../css/user-data-backup.css', '../../css/effetune-mobile.css',
  '../../plugins/others/sfz_note_player.css', '../../extension/editor.css'
].map(read).join('\n').replace('@import url("effetune-theme.css");', '') +
  injectedStyle('../../js/electron/audioIntegration.js', 'styleElement.textContent = `') +
  injectedStyle('../../js/electron/configIntegration.js', 'style.textContent = `') +
  injectedStyle('../../js/electron-integration.js', 'styleElement.textContent = `');

const dialogs = [
  ['modal-overlay', 'audio-config-dialog'],
  ['modal-overlay', 'config-dialog'],
  ['modal-overlay', 'about-dialog'],
  ['remote-control-overlay', 'remote-control-dialog'],
  ['ir-library-overlay', 'ir-library-dialog'],
  ['backup-restore-overlay', 'backup-restore-dialog'],
  ['library-dialog-backdrop', 'library-properties-dialog'],
  ['library-dialog-backdrop', 'library-properties-dialog library-properties-dialog-scrollable midi-mapping-dialog'],
  ['sfz-load-notice-overlay', 'sfz-load-notice'],
  ['extension-dialog-overlay', 'extension-dialog'],
  ['extension-measurement-delete-overlay', 'extension-measurement-delete-dialog'],
  ['', 'ai-dialog'], ['', 'routing-dialog'], ['', 'preset-dialog']
];

test('dialogs fit small viewports and their last action remains reachable', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Browser page zoom reduces the available CSS viewport. Desktop CSS zoom is tested separately.
    for (const viewport of [{ width: 960, height: 540 }, { width: 480, height: 270 }, { width: 320, height: 200 }]) {
      await page.setViewportSize(viewport);
      for (const mobile of [false, true]) {
        for (const [overlay, dialog] of [...dialogs, ['dialog-overlay', 'dialog-content']]) {
          const measurement = dialog === 'dialog-content';
          await page.setContent(`<body class="${mobile ? 'layout-mobile' : 'layout-desktop'}">
            <div class="${overlay}"><section class="${dialog}" id="dialog">
              <h2>Settings</h2><div style="height:900px;min-height:900px;flex-shrink:0">Long content</div>
              <div class="dialog-buttons" style="flex-shrink:0"><button id="last">Apply</button></div>
            </section></div></body>`);
          await page.addStyleTag({ content: measurement
            ? read('../../features/measurement/styles.css') + read('../../features/measurement/styles-mobile.css')
            : css });
          if (!overlay) await page.locator('#dialog').evaluate(element => {
            element.style.position = 'fixed';
            element.style.top = '8px';
            element.style.left = '8px';
          });
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
          for (const zoom of [1, 1.5, 3]) {
            await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
            const bounds = await page.locator('#dialog').boundingBox();
            const label = `${dialog} ${viewport.width}x${viewport.height} mobile=${mobile} zoom=${zoom}`;
            assert.ok(bounds.x >= -1 && bounds.y >= -1, `${label}: top/left`);
            assert.ok(bounds.x + bounds.width <= viewport.width + 1, `${label}: right`);
            assert.ok(bounds.y + bounds.height <= viewport.height + 1, `${label}: bottom`);
            await page.locator('#last').click({ timeout: 2000 });
            const action = await page.locator('#last').boundingBox();
            assert.ok(action.y >= 0 && action.y + action.height <= viewport.height + 1, `${label}: action`);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
});

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const routingUrl = moduleUrl(read('../../js/ui/pipeline/pipeline-routing-dialog.js')
  .replace("'../standard-select.js'", JSON.stringify(moduleUrl(read('../../js/ui/standard-select.js'))))
  .replace("'../motion.js'", JSON.stringify(moduleUrl(read('../../js/ui/motion.js'))))
  .replace("'../../audio/plugin-execution-capabilities.js'", JSON.stringify(moduleUrl(read('../../js/audio/plugin-execution-capabilities.js')))));

test('anchored dialogs stay on screen after opening at the bottom right and resizing', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.setContent('<button id="anchor" style="position:fixed;bottom:0;right:0">Open</button>');
    await page.addStyleTag({ content: css });
    await page.evaluate(async url => {
      const { PipelineRoutingDialog } = await import(url);
      const routing = new PipelineRoutingDialog({});
      for (const name of ['routing-dialog', 'preset-dialog']) {
        const dialog = document.createElement('div');
        dialog.className = name;
        dialog.innerHTML = '<div style="min-height:100px">Content</div><button>Close</button>';
        document.body.appendChild(dialog);
        routing.positionDialog(dialog, document.querySelector('#anchor'));
        dialog.firstChild.style.minHeight = '600px';
      }
      document.getAnimations().forEach(animation => animation.finish());
    }, routingUrl);
    for (const viewport of [{ width: 640, height: 360 }, { width: 320, height: 200 }]) {
      await page.setViewportSize(viewport);
      for (const selector of ['.routing-dialog', '.preset-dialog']) {
        const bounds = await page.locator(selector).boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0, selector);
        assert.ok(bounds.x + bounds.width <= viewport.width + 1, selector);
        assert.ok(bounds.y + bounds.height <= viewport.height + 1, selector);
      }
    }
  } finally {
    await browser.close();
  }
});

test('audio settings cancel and apply can be reached with enlarged display', async () => {
  const source = read('../../js/electron/audioIntegration.js');
  const html = source.split('const dialogHTML = `')[1].split('`;')[0]
    .replace(/\$\{t\('([^']+)'\)\}/g, '$1')
    .replace(/\$\{[^}]+\}/g, '');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
    await page.setContent(`<div class="modal-overlay">${html}</div>`);
    await page.addStyleTag({ content: css });
    for (const button of ['#cancel-button', '#apply-button']) {
      await page.locator(button).click();
      const bounds = await page.locator(button).boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 270);
    }
    await page.locator('#input-device').focus();
    const first = await page.locator('#input-device').boundingBox();
    assert.ok(first.y >= 0 && first.y + first.height <= 270);
  } finally {
    await browser.close();
  }
});

const backupDialogUrl = moduleUrl(read('../../js/user-data-backup/dialog.js'));

test('backup and restore stay inside the viewport as desktop CSS zoom increases', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const viewport of [{ width: 1280, height: 720 }, { width: 560, height: 420 }]) {
      await page.setViewportSize(viewport);
      await page.setContent('<body></body>');
      await page.addStyleTag({ content: css });
      await page.evaluate(async url => {
        const { openUserDataBackupDialog } = await import(url);
        openUserDataBackupDialog({ service: {
          listBackup: async () => ({ items: Array.from({ length: 20 }, (_, index) => ({
            key: `pipeline:${index}`, kind: 'pipeline', name: `Preset ${index}`, available: true
          })) }),
          select: async (_catalog, keys) => keys
        } });
      }, backupDialogUrl);
      await page.locator('.backup-restore-primary:enabled').waitFor();
      for (const zoom of [1, 1.5, 2, 3, 1]) {
        await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
        for (const mode of ['Create backup', 'Restore from file']) {
          await page.getByRole('tab', { name: mode, exact: true }).click();
          const bounds = await page.locator('.backup-restore-dialog').boundingBox();
          const label = `${mode} ${viewport.width}x${viewport.height} zoom=${zoom}`;
          assert.ok(bounds.x >= 0 && bounds.y >= 0, `${label}: top/left ${JSON.stringify(bounds)}`);
          assert.ok(bounds.x + bounds.width <= viewport.width + 1, `${label}: right`);
          assert.ok(bounds.y + bounds.height <= viewport.height + 1, `${label}: bottom`);
          const action = page.locator('.backup-restore-primary');
          await action.evaluate(element => element.scrollIntoView({ block: 'nearest' }));
          const actionBounds = await action.boundingBox();
          assert.ok(actionBounds.y >= 0 && actionBounds.y + actionBounds.height <= viewport.height + 1, `${label}: action`);
        }
      }
      await page.locator('.backup-restore-close').click();
      assert.equal(await page.locator('.backup-restore-dialog').count(), 0);
    }
  } finally {
    await browser.close();
  }
});
