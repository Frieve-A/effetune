import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const selectUrl = moduleUrl(read('../../js/ui/standard-select.js'));
const routingUrl = moduleUrl(read('../../js/ui/pipeline/pipeline-routing-dialog.js')
  .replace("'../standard-select.js'", JSON.stringify(selectUrl)));
const css = read('../../effetune-theme.css') + read('../../effetune.css')
  .replace('@import url("effetune-theme.css");', '');

test('settings and bus routing share themed selection and hover colors', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="routing">Routing</button><select class="config-select"><option>First</option><option>Second</option></select>');
    await page.addStyleTag({ content: css });
    await page.evaluate(async ({ selectUrl, routingUrl }) => {
      const { enableStandardSelects } = await import(selectUrl);
      const { PipelineRoutingDialog } = await import(routingUrl);
      enableStandardSelects(document);
      window.uiManager = { t: key => key };
      window.plugin = { id: 'test', channel: null, inputBus: 0, outputBus: 0, updateParameters() {} };
      const routing = new PipelineRoutingDialog({ updateBusInfo() {} });
      document.querySelector('#routing').onclick = event => routing.showRoutingDialog(window.plugin, event.target);
    }, { selectUrl, routingUrl });

    for (const theme of ['graphite', 'paper', 'midnight', 'ember', 'mint']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.locator('.config-select').click();
      const colors = async () => page.evaluate(() => {
        const list = document.querySelector('.standard-select-list:not([hidden])');
        const selected = getComputedStyle(list.querySelector('[aria-selected="true"]'));
        const hover = getComputedStyle(list.querySelector('.active'));
        const probe = document.createElement('span');
        probe.style.color = 'var(--et-on-accent)';
        probe.style.backgroundColor = 'var(--et-surface-20)';
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe);
        const result = { selectedText: selected.color, selectedBackground: selected.backgroundColor,
          hoverText: hover.color, hoverBackground: hover.backgroundColor,
          expectedText: expected.color, expectedHover: expected.backgroundColor };
        probe.remove();
        return result;
      });
      await page.locator('.standard-select-option').nth(1).hover();
      const settingsColors = await colors();
      assert.equal(settingsColors.selectedText, settingsColors.expectedText, theme);
      assert.equal(settingsColors.hoverBackground, settingsColors.expectedHover, theme);
      await page.keyboard.press('Escape');
      await page.locator('#routing').click();
      const channel = page.locator('.routing-dialog select').first();
      assert.equal(await channel.getAttribute('data-standard-select'), 'true');
      await channel.click();
      await page.locator('.standard-select-option').nth(1).hover();
      assert.deepEqual(await colors(), settingsColors, theme);
      await page.locator('.standard-select-option').nth(1).click();
      assert.equal(await page.evaluate(() => window.plugin.channel), 'A');
      assert.equal(await page.locator('.routing-dialog').count(), 1);
      await channel.click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.plugin.channel), 'L');
      await page.locator('.routing-dialog-close').click();
      await page.evaluate(() => { window.plugin.channel = null; });
    }
  } finally {
    await browser.close();
  }
});
