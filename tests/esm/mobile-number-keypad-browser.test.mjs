import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

test('touching a number input allows scrolling and opens the keypad only after a tap ends', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true
  });
  await page.setContent(`<!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <body class="layout-mobile">
      <div class="plugin-parameter-ui">
        <div class="parameter-row"><label for="gain">Gain</label>
          <input id="gain" type="number" value="3" min="-24" max="24">
        </div>
      </div>
    </body>`);
  await page.addStyleTag({ content: await readFile(new URL('../../css/effetune-mobile.css', import.meta.url), 'utf8') });
  await page.addStyleTag({ content: `
    body { margin: 0; min-height: 2000px; }
    .plugin-parameter-ui { padding: 180px 20px 0; }
  ` });
  await page.addScriptTag({ type: 'module', content: `
    ${await readFile(new URL('../../js/ui/mobile-number-keypad.js', import.meta.url), 'utf8')}
    window.keypad = new MobileNumberKeypad();
  ` });
  await page.waitForFunction(() => !!window.keypad);
  const session = await page.context().newCDPSession(page);
  const input = page.locator('#gain');
  const bounds = await input.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(point => ({ x, y: point, id: 1 }))
  });
  const isOpen = () => page.evaluate(() => !!window.keypad.target);

  await touch('touchStart', [y]);
  assert.equal(await isOpen(), false, 'initial contact must leave the keypad closed');
  assert.equal(await input.evaluate(element => element === document.activeElement), false);
  await touch('touchEnd', []);
  assert.equal(await isOpen(), true);
  assert.equal(await page.locator('.mobile-number-keypad-overlay').isVisible(), true);
  assert.equal(await input.evaluate(element => element === document.activeElement), false);

  await page.evaluate(() => window.keypad.cancel());
  await input.click();
  assert.equal(await isOpen(), true, 'mouse activation must also work on release');

  // Check native scrolling last so momentum cannot affect another gesture.
  await page.evaluate(() => window.keypad.cancel());
  await touch('touchStart', [y]);
  for (const distance of [20, 60, 100, 140]) {
    await touch('touchMove', [y - distance]);
  }
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.scrollY > 0);
  assert.equal(await isOpen(), false, 'a swipe must scroll without opening the keypad');
  assert.equal(await input.inputValue(), '3');
});
