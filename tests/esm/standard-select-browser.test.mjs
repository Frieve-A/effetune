import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const selectUrl = moduleUrl(read('../../js/ui/standard-select.js'));
const motionUrl = moduleUrl(read('../../js/ui/motion.js'));
const capabilitiesUrl = moduleUrl(read('../../js/audio/plugin-execution-capabilities.js'));
const routingUrl = moduleUrl(read('../../js/ui/pipeline/pipeline-routing-dialog.js')
  .replace("'../standard-select.js'", JSON.stringify(selectUrl))
  .replace("'../motion.js'", JSON.stringify(motionUrl))
  .replace("'../../audio/plugin-execution-capabilities.js'", JSON.stringify(capabilitiesUrl)));
const css = read('../../css/effetune-theme.css') + read('../../css/effetune.css')
  .replace('@import url("effetune-theme.css");', '');

test('new dropdowns automatically share themed scrollbars and native value events', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><button id="outside">Outside</button>');
    await page.addStyleTag({ content: css });
    await page.evaluate(async selectUrl => {
      const { enableStandardSelects } = await import(selectUrl);
      // Install before any dropdown exists, as new UI can be loaded later.
      enableStandardSelects(document);
      enableStandardSelects(document);
      const select = document.createElement('select');
      select.id = 'new-control';
      select.style.width = '260px';
      for (let index = 0; index < 26; index++) {
        const option = new Option(`Channel ${index + 1}`, String(index));
        option.disabled = index === 1;
        select.appendChild(option);
      }
      window.valueEvents = [];
      for (const type of ['input', 'change']) {
        select.addEventListener(type, () => window.valueEvents.push([type, select.value]));
      }
      document.body.appendChild(select);
      const scrollArea = document.createElement('div');
      scrollArea.id = 'existing-scroll-area';
      scrollArea.style.cssText = 'height: 50px; overflow: auto';
      scrollArea.innerHTML = '<div style="height: 200px">Scrollable content</div>';
      document.body.appendChild(scrollArea);
    }, selectUrl);

    const select = page.locator('#new-control');
    const list = page.locator('.standard-select-list');
    assert.equal(await list.count(), 1);
    for (const theme of ['graphite', 'paper', 'midnight', 'ember', 'mint']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await select.click();
      const scrollbar = await list.evaluate(list => ({
        color: getComputedStyle(list).scrollbarColor,
        expected: getComputedStyle(document.querySelector('#existing-scroll-area')).scrollbarColor,
        scrolls: list.scrollHeight > list.clientHeight,
        themeTrack: getComputedStyle(list, '::-webkit-scrollbar-track').backgroundImage
      }));
      assert.equal(scrollbar.color, scrollbar.expected, theme);
      assert.notEqual(scrollbar.color, 'auto', theme);
      assert.equal(scrollbar.scrolls, true, theme);
      assert.match(scrollbar.themeTrack, /linear-gradient/, theme);
      await page.keyboard.press('Escape');
      assert.equal(await select.getAttribute('aria-expanded'), 'false');
    }

    await select.click();
    await page.locator('.standard-select-option').nth(3).click();
    assert.equal(await select.inputValue(), '3');
    assert.deepEqual(await page.evaluate(() => window.valueEvents), [['input', '3'], ['change', '3']]);
    await select.click();
    await page.locator('.standard-select-option').nth(3).click();
    assert.equal(await page.evaluate(() => window.valueEvents.length), 2);

    await page.evaluate(() => {
      const select = document.createElement('select');
      select.id = 'type-ahead-control';
      select.append(new Option('Red', 'red'), new Option('Rose', 'rose'), new Option('Blue', 'blue'));
      document.body.appendChild(select);
    });
    const typeAhead = page.locator('#type-ahead-control');
    await typeAhead.focus();
    await page.keyboard.press('r');
    await page.keyboard.press('o');
    assert.equal(await typeAhead.inputValue(), 'red');
    assert.equal(await page.locator('.standard-select-option.active').textContent(), 'Rose');
    await page.waitForTimeout(750);
    await page.keyboard.press('r');
    assert.equal(await page.locator('.standard-select-option.active').textContent(), 'Red');
    await page.keyboard.press('Escape');

    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await select.inputValue(), '2');
    assert.deepEqual(await page.evaluate(() => window.valueEvents.slice(2)), [['input', '2'], ['change', '2']]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    assert.equal(await select.inputValue(), '2');
    await select.click();
    await page.locator('#outside').click();
    assert.equal(await list.isVisible(), false);

    await page.evaluate(() => {
      for (const attributes of [{ multiple: true }, { size: 4 }, { disabled: true }]) {
        const control = document.createElement('select');
        Object.assign(control, attributes);
        control.id = Object.keys(attributes)[0];
        control.append(new Option('One'), new Option('Two'));
        document.body.appendChild(control);
      }
    });
    for (const id of ['multiple', 'size']) {
      const control = page.locator('#' + id);
      await control.focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await control.getAttribute('data-standard-select'), null);
      assert.equal(await list.isVisible(), false);
    }
    await page.locator('#disabled').dispatchEvent('pointerdown', { button: 0 });
    assert.equal(await list.isVisible(), false);
  } finally {
    await browser.close();
  }
});

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
      await channel.focus();
      await page.keyboard.press('r');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.plugin.channel), 'R');
      await page.locator('.routing-dialog-close').click();
      await page.evaluate(() => { window.plugin.channel = null; });
    }
  } finally {
    await browser.close();
  }
});
