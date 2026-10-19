import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

async function createPlayerPage(browser, { responsive = false } = {}) {
  const page = await browser.newPage({
    viewport: { width: responsive ? 1280 : 390, height: 844 },
    hasTouch: true, isMobile: !responsive, reducedMotion: 'reduce'
  });
  // Intercept local assets so the production UI needs neither a server nor media decoding.
  await page.route('https://effetune.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="layout-mobile"><meta name="viewport" content="width=device-width, initial-scale=1"><body class="layout-mobile"><main class="main-container"><div id="pluginList"></div></main>${responsive ? '' : '<div id="mobilePlayerView" class="mobile-player-view"></div>'}</body></html>`
    });
    if (pathname.endsWith('.mp4')) return route.fulfill({ status: 204, body: '' });
    try {
      return route.fulfill({
        contentType: /\.m?js$/.test(pathname) ? 'text/javascript' : 'text/css',
        body: readFileSync(new URL(`../..${pathname}`, import.meta.url))
      });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto('https://effetune.test/');
  await page.addStyleTag({ url: 'https://effetune.test/css/effetune.css' });
  await page.addStyleTag({ url: 'https://effetune.test/css/effetune-mobile.css' });
  if (responsive) await page.addStyleTag({ url: 'https://effetune.test/css/effetune-library.css' });
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.evaluate(async responsive => {
    const { AudioPlayerUI } = await import('/js/ui/audio-player/audio-player-ui.js');
    const { PlaybackManager } = await import('/js/ui/audio-player/playback-manager.js');
    // These layout tests model media; do not turn the empty fixture response into a decode error.
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() { return this.dataset.testSource || ''; },
      set(value) { this.dataset.testSource = value; }
    });
    window.appConfig = {};
    window.uiManager = { t: key => key, layoutMode: { isMobile: true } };
    if (responsive) {
      const { LayoutModeManager } = await import('/js/ui/layout-mode-manager.js');
      window.uiManager.layoutMode = new LayoutModeManager();
    }
    const state = {
      currentTrack: { name: 'Movie.mp4', path: '/movie.mp4' }, currentTrackName: 'Movie',
      currentTrackPosition: 30, currentTrackDuration: 60, playbackMode: 'audioElement',
      playbackSpeed: 1, isPlaying: false, seekBarEnabled: true, playlist: [], currentTrackIndex: 0
    };
    const listeners = new Map();
    const calls = { toggles: 0, seeks: [], speeds: [] };
    const stateManager = {
      getStateSnapshot: () => ({ ...state }),
      addListener(key, listener) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
      },
      removeListener(key, listener) { listeners.get(key)?.delete(listener); },
      update(patch) {
        Object.assign(state, patch);
        for (const [key, value] of Object.entries(patch)) {
          for (const listener of listeners.get(key) || []) listener(value);
        }
      }
    };
    const master = document.createElement('video');
    Object.defineProperties(master, { videoWidth: { value: 640 }, videoHeight: { value: 360 } });
    master.src = '/movie.mp4';
    const player = {
      stateManager, audioElement: master, audioManager: { getAudiblePlaybackPosition: () => 0 },
      contextManager: {
        getCurrentState: () => ({ ...state }),
        getCurrentPlaybackTime: () => state.currentTrackPosition,
        seek(position) {
          calls.seeks.push(position);
          stateManager.update({ currentTrackPosition: position });
        }
      },
      togglePlayPause() { calls.toggles += 1; },
      resumeAudioContextInGesture() {}, pause: async () => {},
      close() { player.ui.removeUI(); }
    };
    player.playbackManager = {
      audioPlayer: player, runPlaybackCommand: async command => command(),
      fastForward: PlaybackManager.prototype.fastForward, rewind: PlaybackManager.prototype.rewind,
      setPlaybackSpeed(speed) {
        calls.speeds.push(speed);
        stateManager.update({ playbackSpeed: speed });
      }
    };
    const ui = player.ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    if (responsive) {
      const { MobileNav } = await import('/js/ui/mobile-nav.js');
      window.uiManager.audioPlayer = player;
      window.uiManager.mobileNav = new MobileNav(window.uiManager);
    }
    window.fixture = { ui, player, state, stateManager, calls };
  }, responsive);
  return page;
}

async function assertViewportBox(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} is visible`);
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1, `${selector} fits viewport: ${JSON.stringify(box)}`);
  return box;
}

async function assertHittable(page, selector) {
  await assertViewportBox(page, selector);
  assert.equal(await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), true, `${selector} receives native pointer input`);
}

async function assertPlayButtonShape(page, expanded) {
  const styles = await page.evaluate(() => {
    const read = selector => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      const icon = getComputedStyle(element.querySelector('svg'));
      return {
        width: style.width, height: style.height, radius: style.borderRadius,
        padding: style.padding, background: style.backgroundImage,
        iconWidth: icon.width, iconHeight: icon.height
      };
    };
    return { play: read('.play-pause-button'), stop: read('.stop-button') };
  });
  if (expanded) {
    assert.deepEqual(styles.play, styles.stop, 'expanded play uses standard transport styling');
    assert.equal(styles.play.width, '36px');
    assert.equal(styles.play.height, '36px');
    assert.equal(styles.play.radius, '4px');
  } else {
    assert.equal(styles.play.width, '72px');
    assert.equal(styles.play.height, '72px');
    assert.equal(styles.play.radius, '50%');
    assert.notEqual(styles.play.background, styles.stop.background);
  }
}

async function dragRange(page, selector, rotated = true) {
  const box = await assertViewportBox(page, selector);
  assert.ok(rotated ? box.height > box.width * 2 : box.width > box.height * 2,
    `${selector} follows the displayed horizontal axis`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (rotated ? 0.5 : 0.75),
    box.y + box.height * (rotated ? 0.75 : 0.5), { steps: 5 });
  await page.mouse.up();
}

test('expanded mobile video fits the viewport and restores after preference, resize, and exit changes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createPlayerPage(browser);
    await page.clock.resume();
    await assertPlayButtonShape(page, false);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), false);
    await page.evaluate(() => window.fixture.ui.setVideoExpanded(true));
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), true);
    const box = await assertViewportBox(page, '.player-video');
    assert.ok(Math.abs(box.width - 390) < 1 && Math.abs(box.height - 844) < 1);
    await assertPlayButtonShape(page, true);
    await assertHittable(page, '.play-pause-button');
    await assertHittable(page, '.player-video-expand');
    await page.locator('.play-pause-button').click();
    assert.equal(await page.evaluate(() => window.fixture.calls.toggles), 1);
    await page.evaluate(() => {
      window.appConfig.videoAutoRotate = false;
      window.fixture.ui.refreshVideoRotation();
    });
    assert.equal(await page.locator('.audio-player').evaluate(element => getComputedStyle(element).transform), 'none');
    await page.mouse.move(0, 0);
    await assertPlayButtonShape(page, true);
    await dragRange(page, '.seek-bar', false);
    const position = await page.evaluate(() => window.fixture.state.currentTrackPosition);
    assert.ok(position > 40 && position < 50, `native unrotated seek reached ${position}`);
    await page.evaluate(() => {
      window.appConfig.videoAutoRotate = true;
      window.fixture.ui.refreshVideoRotation();
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => !window.fixture.ui.videoRotated);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => window.fixture.ui.videoRotated);
    await page.evaluate(() => {
      window.uiManager.layoutMode.isMobile = false;
      document.body.className = document.documentElement.className = 'layout-desktop';
      window.fixture.ui.mountContainerForLayout();
    });
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), false);
    assert.equal(await page.locator('.audio-player').evaluate(element => getComputedStyle(element).transform), 'none');
    await page.evaluate(() => {
      window.uiManager.layoutMode.isMobile = true;
      document.body.className = document.documentElement.className = 'layout-mobile';
      window.fixture.ui.mountContainerForLayout();
    });
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), true);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), true);
    await page.locator('.player-video-expand').click();
    assert.deepEqual(await page.evaluate(() => ({
      expanded: window.fixture.ui.videoExpanded, rotated: window.fixture.ui.videoRotated,
      toggles: window.fixture.calls.toggles
    })), { expanded: false, rotated: false, toggles: 1 });
    await assertPlayButtonShape(page, false);
  } finally {
    await browser.close();
  }
});

test('rotated native gestures, seek and speed controls use the displayed axes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createPlayerPage(browser);
    await page.evaluate(() => window.fixture.ui.setVideoExpanded(true));
    // Local left/right become viewport top/bottom after clockwise rotation.
    for (const y of [170, 670]) {
      await page.touchscreen.tap(240, y);
      await page.touchscreen.tap(240, y);
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.seeks), [20, 30]);
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);
    await dragRange(page, '.seek-bar');
    const position = await page.evaluate(() => window.fixture.state.currentTrackPosition);
    assert.ok(position > 40 && position < 50, `native rotated seek reached ${position}`);
    await page.locator('.speed-button').click();
    assert.equal(await page.locator('.player-speed-popup').evaluate(element => element.parentElement.classList.contains('audio-player')), true);
    await assertViewportBox(page, '.player-speed-popup');
    await assertHittable(page, '.player-speed-number');
    await dragRange(page, '.player-speed-slider');
    const speed = await page.evaluate(() => window.fixture.state.playbackSpeed);
    assert.ok(speed > 1.7 && speed < 2.4, `native rotated speed reached ${speed}`);
    await page.locator('.player-speed-number').fill('1.25');
    await page.locator('.player-speed-number').press('Enter');
    assert.equal(await page.evaluate(() => window.fixture.state.playbackSpeed), 1.25);
    assert.equal(await page.evaluate(() => window.fixture.calls.toggles), 0);
    await page.evaluate(() => {
      window.appConfig.videoAutoRotate = false;
      window.fixture.ui.refreshVideoRotation();
    });
    assert.equal(await page.locator('.player-speed-popup').count(), 0);
    await page.locator('.speed-button').click();
    assert.equal(await page.locator('.player-speed-popup').evaluate(element => element.parentElement === document.body), true);
  } finally {
    await browser.close();
  }
});

test('expanded video survives real responsive layout changes and restores mobile navigation', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createPlayerPage(browser, { responsive: true });
    await page.clock.resume();
    await page.evaluate(() => {
      window.fixture.stateManager.update({ isPlaying: true });
      window.uiManager.mobileNav.applyViewState('library', { fromLibraryView: true });
      window.fixture.ui.setVideoExpanded(true);
    });
    await assertViewportBox(page, '.player-video');
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => window.uiManager.layoutMode.appliedMode === 'mobile');
    const mobileBox = await assertViewportBox(page, '.player-video');
    assert.ok(Math.abs(mobileBox.width - 390) < 1 && Math.abs(mobileBox.height - 844) < 1);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoExpanded), true);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), true);
    assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), false);
    await page.evaluate(() => window.fixture.ui.showVideoControls());
    await assertHittable(page, '.player-video-expand');
    await page.locator('.player-video-expand').click();
    assert.equal(await page.evaluate(() => window.fixture.ui.videoExpanded), false);
    assert.equal(await page.evaluate(() => window.uiManager.mobileNav.getCurrentView()), 'library');
    assert.equal(await page.locator('#mobilePlayerView .audio-player').count(), 1);
    assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), true);
    await assertHittable(page, '.mobile-bottom-button[data-view="player"]');
    await page.locator('.mobile-bottom-button[data-view="player"]').click();
    assert.equal(await page.locator('#mobilePlayerView .audio-player').isVisible(), true);
    await page.evaluate(() => window.fixture.ui.setVideoExpanded(true));
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.waitForFunction(() => window.uiManager.layoutMode.appliedMode === 'desktop');
    const desktopBox = await assertViewportBox(page, '.player-video');
    assert.ok(Math.abs(desktopBox.width - 1280) < 1 && Math.abs(desktopBox.height - 844) < 1);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoExpanded), true);
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), false);
    assert.equal(await page.locator('.audio-player').evaluate(element => getComputedStyle(element).transform), 'none');
    await page.evaluate(() => { window.appConfig.videoAutoRotate = false; });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => window.uiManager.layoutMode.appliedMode === 'mobile');
    await assertViewportBox(page, '.player-video');
    assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mobilePlayerView .audio-player').isVisible(), true);
    assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), true);
    for (const view of ['effects', 'visualizer']) {
      await page.setViewportSize({ width: 1280, height: 844 });
      await page.waitForFunction(() => window.uiManager.layoutMode.appliedMode === 'desktop');
      await page.evaluate(view => {
        window.appConfig.videoAutoRotate = true;
        // These are the existing view states preserved by MobileNav at the breakpoint.
        document.body.classList.toggle('view-visualizer', view === 'visualizer');
        window.uiManager.mobileNav.applyViewState(view, { fromLibraryView: true });
        window.fixture.ui.setVideoExpanded(true);
      }, view);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => window.uiManager.layoutMode.appliedMode === 'mobile');
      await assertViewportBox(page, '.player-video');
      assert.equal(await page.evaluate(() => window.fixture.ui.videoRotated), true);
      assert.equal(await page.evaluate(() => window.uiManager.mobileNav.getCurrentView()), view);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#mobilePlayerView .audio-player').count(), 1);
      assert.equal(await page.locator('.mobile-bottom-nav').isVisible(), true);
      assert.equal(await page.evaluate(() => window.uiManager.mobileNav.getCurrentView()), view);
    }
    assert.equal(await page.evaluate(() => window.fixture.state.isPlaying), true);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), { toggles: 0, seeks: [], speeds: [] });
  } finally {
    await browser.close();
  }
});
