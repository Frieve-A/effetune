import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

test('mobile messages remain readable above queue status', async () => {
  const css = ['effetune-theme', 'effetune', 'effetune-library', 'effetune-mobile']
    .map(name => readFileSync(new URL(`../../css/${name}.css`, import.meta.url), 'utf8'))
    .join('\n').replace('@import url("effetune-theme.css");', '');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(`<body class="layout-mobile">
        <div class="message-display"></div>
        <section class="library-paged-action-toast">
          <strong>再生キューを作成</strong><span>キャンセルしました</span><span>0件を処理済み</span>
          <button>キャンセル</button>
        </section></body>`);
      await page.addStyleTag({ content: css });
      for (const message of [
        'この曲はサーバーから再生可能な音声フォーマットで取得できません。別の曲を選んでください。',
        'Preset copied to clipboard.'
      ]) {
        await page.locator('.message-display').evaluate((element, text) => { element.textContent = text; }, message);
        const bounds = await page.evaluate(() => {
          const message = document.querySelector('.message-display');
          return {
            message: message.getBoundingClientRect().toJSON(),
            queue: document.querySelector('.library-paged-action-toast').getBoundingClientRect().toJSON(),
            readable: message.scrollWidth <= message.clientWidth && message.scrollHeight <= message.clientHeight
          };
        });
        assert.ok(bounds.message.bottom + 8 <= bounds.queue.top, 'message and queue must not overlap');
        assert.ok(bounds.message.left >= 0 && bounds.message.right <= width);
        assert.ok(bounds.readable, 'the entire message must fit without clipping');
      }
      await page.locator('.message-display').evaluate(element => { element.textContent = ''; });
      assert.equal(await page.locator('.message-display').isVisible(), false);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
