import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../css/effetune-theme.css') +
  read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '');

test('expanded video hides both document scrollbars and restores scrolling on every exit', async () => {
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: 720 } });
      await page.setContent(`<!doctype html><html class="layout-${mobile ? 'mobile' : 'desktop'}">
        <body class="layout-${mobile ? 'mobile' : 'desktop'}">
          <div class="audio-player" data-video="true" data-video-expanded="false">
            <div class="player-artwork"><video class="player-video"></video></div>
          </div>
          <main style="width:2200px;height:2400px"></main>
        </body></html>`);
      await page.addStyleTag({ content: css + read('../../css/effetune-mobile.css') });
      const readScrollState = () => page.evaluate(() => ({
        overflowX: getComputedStyle(document.documentElement).overflowX,
        overflowY: getComputedStyle(document.documentElement).overflowY,
        verticalGutter: innerWidth - document.documentElement.clientWidth,
        horizontalGutter: innerHeight - document.documentElement.clientHeight,
        contentHeight: document.scrollingElement.scrollHeight,
        contentWidth: document.scrollingElement.scrollWidth
      }));
      const before = await readScrollState();
      assert.ok(before.contentHeight > 720, 'background content must overflow vertically');
      assert.ok(before.verticalGutter > 0, 'the baseline must have a real vertical scrollbar');
      if (!mobile) {
        assert.ok(before.contentWidth > 1280, 'desktop background must overflow horizontally');
        assert.ok(before.horizontalGutter > 0, 'desktop baseline must have a real horizontal scrollbar');
      }
      await page.evaluate(() => scrollTo(100, 100));
      assert.equal(await page.evaluate(() => scrollY), 100);
      if (!mobile) assert.equal(await page.evaluate(() => scrollX), 100);
      await page.evaluate(() => scrollTo(0, 0));
      for (const exit of ['restore', 'audio', 'remove']) {
        await page.locator('.audio-player').evaluate(element => {
          element.dataset.video = 'true';
          element.dataset.videoExpanded = 'true';
        });
        const expanded = await readScrollState();
        assert.equal(expanded.overflowX, 'hidden');
        assert.equal(expanded.overflowY, 'hidden');
        assert.equal(expanded.verticalGutter, 0);
        assert.equal(expanded.horizontalGutter, 0);
        await page.locator('.audio-player').evaluate((element, action) => {
          if (action === 'remove') element.remove();
          else if (action === 'audio') element.dataset.video = 'false';
          else element.dataset.videoExpanded = 'false';
        }, exit);
        const restored = await readScrollState();
        for (const key of ['overflowX', 'overflowY', 'verticalGutter', 'horizontalGutter']) {
          assert.equal(restored[key], before[key], `${exit} must restore ${key}`);
        }
        await page.evaluate(() => scrollTo(100, 100));
        assert.equal(await page.evaluate(() => scrollY), 100);
        if (!mobile) assert.equal(await page.evaluate(() => scrollX), 100);
        await page.evaluate(() => scrollTo(0, 0));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('expanded video fills desktop and mobile viewports with bottom transport controls', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true]) {
      const width = mobile ? 390 : 1600;
      const page = await browser.newPage({ viewport: { width, height: 720 } });
      await page.setContent(`<body class="layout-${mobile ? 'mobile' : 'desktop'}">
        <div class="audio-player" data-expanded="true" data-video="true"
          data-video-expanded="true" data-video-controls="true">
          <h2>Player</h2>
          <div class="player-artwork"><video class="player-video"></video>
            <button class="player-button player-video-expand">↗</button></div>
          <div class="track-name-container">Title</div>
          <div class="player-controls">
            <input type="range" class="seek-bar"><div class="time-display">00:00</div>
            ${['play-pause', 'stop', 'prev', 'next', 'repeat', 'shuffle', 'speed', 'close']
              .map(name => `<button class="player-button ${name}-button">▶</button>`).join('')}
            <div class="player-playlist"></div>
          </div>
        </div>
        ${mobile ? `<nav class="mobile-bottom-nav" aria-label="Primary mobile navigation">
          ${['player', 'library', 'effects'].map(view =>
            `<button class="mobile-bottom-button" data-view="${view}">${view}</button>`).join('')}
        </nav>` : ''}</body>`);
      await page.addStyleTag({ content: css + read('../../css/effetune-mobile.css') });
      const layout = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          video: rect('.player-video'), controls: rect('.player-controls'),
          buttons: [...document.querySelectorAll('.player-controls .player-button')]
            .map(button => button.getBoundingClientRect().toJSON()),
          queueVisible: getComputedStyle(document.querySelector('.player-playlist')).display !== 'none'
        };
      });
      assert.equal(layout.video.width, width);
      assert.equal(layout.video.height, 720);
      assert.equal(layout.controls.bottom, 720);
      assert.equal(layout.queueVisible, false);
      for (const button of layout.buttons) {
        assert.ok(button.left >= 0 && button.right <= width);
        assert.ok(button.top >= layout.controls.top && button.bottom <= 720);
      }
      const hitTest = selector => page.locator(selector).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      });
      assert.equal(await hitTest('.close-button'), true, 'bottom transport must receive pointer input');
      assert.equal(await hitTest('.player-video-expand'), true, 'restore must receive pointer input');
      if (mobile) {
        assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), false);
      }
      await page.locator('.audio-player').evaluate(element => element.dataset.videoControls = 'false');
      await page.waitForFunction(() =>
        getComputedStyle(document.querySelector('.player-controls')).opacity === '0');
      assert.equal(await page.locator('.player-controls').evaluate(element => getComputedStyle(element).opacity), '0');
      if (mobile) {
        await page.locator('.audio-player').evaluate(element => element.dataset.videoExpanded = 'false');
        assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), true);
        assert.equal(await hitTest('.mobile-bottom-button[data-view="player"]'), true);
        await page.locator('.audio-player').evaluate(element => element.dataset.videoExpanded = 'true');
        assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), false);
        await page.locator('.audio-player').evaluate(element => element.remove());
        assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), true);
        assert.equal(await hitTest('.mobile-bottom-button[data-view="player"]'), true);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('long artist and title do not move desktop playback controls', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 720 } });
    for (const expanded of [false, true]) {
      await page.setContent(`
        <body class="layout-desktop">
          <div class="audio-player" ${expanded ? 'data-expanded="true"' : ''}>
            <h2>Player</h2>
            <div class="player-artwork"></div>
            <div class="track-name-container"><div class="track-name">Artist - Title</div></div>
            <div class="player-controls">
              <input type="range" class="seek-bar">
              <div class="time-display">00:00</div>
              ${'<button class="player-button">▶</button>'.repeat(10)}
              <div class="player-playlist"></div>
            </div>
          </div>
          <div class="main-container" style="width: 1350px"></div>
        </body>`);
      await page.addStyleTag({ content: css });
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));

      const measure = () => page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const name = document.querySelector('.track-name');
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          controlsLeft: rect('.player-controls').left,
          seekLeft: rect('.seek-bar').left,
          lastButtonRight: document.querySelector('.player-controls .player-button:last-of-type')
            .getBoundingClientRect().right,
          trackRight: rect('.track-name-container').right,
          nameRight: name.getBoundingClientRect().right,
          nameClipped: name.scrollWidth > name.clientWidth
        };
      });
      const before = await measure();
      await page.locator('.track-name').evaluate(element => {
        element.textContent = `${'Very Long Artist '.repeat(30)} - ${'Very Long Title '.repeat(30)}`;
      });
      const after = await measure();

      assert.equal(after.pageWidth, before.pageWidth, 'track metadata must not widen the page');
      assert.equal(after.controlsLeft, before.controlsLeft, 'transport controls must stay in place');
      assert.equal(after.seekLeft, before.seekLeft, 'seek bar must stay in place');
      assert.ok(after.lastButtonRight <= after.viewportWidth, 'transport buttons must remain visible');
      assert.ok(after.nameRight <= after.trackRight, 'track name must remain inside its container');
      assert.equal(after.nameClipped, true, 'long track name should be clipped');
    }
  } finally {
    await browser.close();
  }
});
