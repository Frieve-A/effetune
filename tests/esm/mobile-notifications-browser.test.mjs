import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

test('messages overlay the header without shifting the layout on desktop and mobile', async () => {
  const css = ['effetune-theme', 'effetune', 'effetune-library', 'effetune-mobile']
    .map(name => readFileSync(new URL(`../../css/${name}.css`, import.meta.url), 'utf8'))
    .join('\n').replace('@import url("effetune-theme.css");', '');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height, mobile] of [[320, 568, true], [390, 844, true], [844, 390, true], [1024, 768, false], [1920, 1080, false]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(`<body class="${mobile ? 'layout-mobile' : 'layout-desktop'}">
        <div class="title-container">
          <h1>Frieve EffeTune<div class="message-display"></div></h1>
          <div class="header-buttons"><button>Connect effects</button></div>
        </div>
        <section class="library-paged-action-toast">
          <strong>再生キューを作成</strong><span>キャンセルしました</span><span>0件を処理済み</span>
          <button>キャンセル</button>
        </section></body>`);
      await page.addStyleTag({ content: `${css}
        *, *::before, *::after { transition: none !important; animation: none !important; }` });
      const headerBefore = await page.locator('.title-container').boundingBox();
      for (const message of [
        'この曲はサーバーから再生可能な音声フォーマットで取得できません。別の曲を選んでください。',
        'Preset copied to clipboard.',
        ...(mobile ? [] : [
          '接続先の「設定 > 環境設定... > ネットワーク」で「リモート操作を許可する」が有効か確認し、機器一覧から接続し直してください。'.repeat(4),
          'https://example.com/'.padEnd(600, 'a')
        ])
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
        if (mobile) assert.ok(bounds.message.bottom + 8 <= bounds.queue.top, 'message and queue must not overlap');
        assert.deepEqual(await page.locator('.title-container').boundingBox(), headerBefore, 'messages must not shift the header');
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
