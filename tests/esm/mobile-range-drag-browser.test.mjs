import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

test('mobile effect sliders ignore taps, allow vertical scrolling, and adjust with horizontal touch drags', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true });
  await page.setContent(`<!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <body class="layout-mobile">
      <div class="plugin-parameter-ui"><div class="parameter-row">
        <input id="gain" type="range" min="0" max="100" step="1" value="50">
      </div></div>
    </body>`);
  for (const path of ['effetune-theme.css', 'effetune.css', 'effetune-mobile.css']) {
    const css = (await readFile(new URL(`../../css/${path}`, import.meta.url), 'utf8'))
      .replace('@import url("effetune-theme.css");', '');
    await page.addStyleTag({ content: css });
  }
  await page.addStyleTag({ content: `
    html, body { overflow: auto !important; }
    body { margin: 0; min-height: 2000px; }
    .plugin-parameter-ui { padding: 180px 20px 0; }
  ` });
  await page.addScriptTag({ type: 'module', content: `
    ${await readFile(new URL('../../js/ui/range-precision-controller.js', import.meta.url), 'utf8')}
    window.disposeRange = installRangePrecisionControl(document);
    window.rangeEvents = [];
    for (const type of ['input', 'change']) {
      document.getElementById('gain').addEventListener(type, event => window.rangeEvents.push(event.type));
    }
  ` });
  await page.waitForFunction(() => !!window.disposeRange);
  const session = await page.context().newCDPSession(page);
  const slider = page.locator('#gain');
  const bounds = await slider.boundingBox();
  const x = bounds.x + bounds.width * 0.8;
  const y = bounds.y + bounds.height / 2;
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 }))
  });

  await touch('touchStart', [[x, y]]);
  assert.equal(await slider.inputValue(), '50', 'initial contact must not jump to the touch position');
  await touch('touchEnd', []);
  assert.equal(await slider.inputValue(), '50');
  assert.deepEqual(await page.evaluate(() => window.rangeEvents), []);

  await touch('touchStart', [[x, y]]);
  await touch('touchMove', [[x - 3, y]]);
  assert.equal(await slider.inputValue(), '50');
  await touch('touchMove', [[x - 60, y + 2]]);
  assert.ok(Number(await slider.inputValue()) < 50);
  const draggedValue = await slider.inputValue();
  await touch('touchEnd', []);
  assert.equal(await slider.inputValue(), draggedValue);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.deepEqual(await page.evaluate(() => window.rangeEvents), ['input', 'change']);

  // Mouse and keyboard keep their standard range behavior in the mobile layout.
  await slider.click({ position: { x: bounds.width * 0.9, y: bounds.height / 2 } });
  const clicked = Number(await slider.inputValue());
  assert.ok(clicked > 50);
  await slider.press('ArrowLeft');
  assert.equal(Number(await slider.inputValue()), clicked - 1);

  // Check native scrolling last so momentum cannot affect another gesture.
  const valueBeforeScroll = await slider.inputValue();
  const eventsBeforeScroll = await page.evaluate(() => window.rangeEvents);
  await touch('touchStart', [[x, y]]);
  for (const distance of [20, 60, 100, 140]) await touch('touchMove', [[x, y - distance]]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.scrollY > 0);
  assert.equal(await slider.inputValue(), valueBeforeScroll);
  assert.deepEqual(await page.evaluate(() => window.rangeEvents), eventsBeforeScroll);
});
