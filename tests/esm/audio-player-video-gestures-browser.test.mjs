import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

async function createPlayerPage(browser, { touch = false } = {}) {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 720 }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce'
  });
  // Load production modules and CSS without starting a server or decoding media.
  await page.route('https://effetune.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body class="layout-desktop"><main class="main-container"></main></body>'
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
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.evaluate(async () => {
    const { AudioPlayerUI } = await import('/js/ui/audio-player/audio-player-ui.js');
    const { PlaybackManager } = await import('/js/ui/audio-player/playback-manager.js');
    // These interaction tests model media; do not turn the empty fixture response into a decode error.
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() { return this.dataset.testSource || ''; },
      set(value) { this.dataset.testSource = value; }
    });
    localStorage.setItem('playerQueueExpanded', 'true');
    window.uiManager = { t: key => key, layoutMode: { isMobile: false } };
    const state = {
      currentTrack: { name: 'Movie.mp4', path: '/movie.mp4' },
      currentTrackName: 'Movie', currentTrackPosition: 30, currentTrackDuration: 60,
      playbackMode: 'audioElement', playbackSpeed: 1, isPlaying: false,
      seekBarEnabled: true, playlist: [], currentTrackIndex: 0
    };
    const listeners = new Map();
    const calls = { toggles: 0, seeks: [] };
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
    Object.defineProperty(master, 'videoWidth', { value: 640 });
    master.src = '/movie.mp4';
    const player = {
      stateManager, audioElement: master,
      audioManager: { getAudiblePlaybackPosition: () => 0 },
      contextManager: {
        getCurrentState: () => ({ ...state }),
        getCurrentPlaybackTime: () => state.currentTrackPosition,
        seek(position) {
          calls.seeks.push(position);
          stateManager.update({ currentTrackPosition: position });
        }
      },
      togglePlayPause() { calls.toggles += 1; },
      resumeAudioContextInGesture() {},
      pause: async () => {},
      close() { player.ui.removeUI(); }
    };
    player.playbackManager = {
      audioPlayer: player,
      runPlaybackCommand: async command => command(),
      fastForward: PlaybackManager.prototype.fastForward,
      rewind: PlaybackManager.prototype.rewind
    };
    const ui = player.ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    window.fixture = { ui, player, state, stateManager, calls };
  });
  return page;
}

async function surfacePoint(page, fraction = 0.5) {
  const box = await page.locator('.player-video').boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  return { x: box.x + box.width * fraction, y: box.y + box.height * 0.35 };
}

async function readPlayer(page) {
  return page.evaluate(() => ({
    ...window.fixture.calls,
    expanded: window.fixture.ui.videoExpanded,
    controls: window.fixture.ui.container?.dataset.videoControls
  }));
}

test('native video clicks defer playback and double clicks expand or restore without toggling playback', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createPlayerPage(browser);
    let point = await surfacePoint(page);
    await page.mouse.click(point.x, point.y);
    assert.equal((await readPlayer(page)).toggles, 0);
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);

    await page.mouse.dblclick(point.x, point.y);
    assert.equal((await readPlayer(page)).expanded, true);
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);
    point = await surfacePoint(page);
    await page.mouse.dblclick(point.x, point.y);
    assert.equal((await readPlayer(page)).expanded, false);
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);
  } finally {
    await browser.close();
  }
});

test('native touch taps reveal controls and seek only on expanded left or right double taps', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createPlayerPage(browser, { touch: true });
    const tap = async fraction => {
      const point = await surfacePoint(page, fraction);
      await page.touchscreen.tap(point.x, point.y);
    };
    await tap(0.2);
    assert.equal((await readPlayer(page)).controls, 'true');
    await page.clock.runFor(550);
    await tap(0.2);
    await tap(0.2);
    await page.clock.runFor(550);
    assert.deepEqual(await readPlayer(page), { toggles: 0, seeks: [], expanded: false, controls: 'true' });

    await page.evaluate(() => window.fixture.ui.setVideoExpanded(true));
    await tap(0.2);
    await tap(0.2);
    assert.deepEqual((await readPlayer(page)).seeks, [20]);
    await tap(0.8);
    await tap(0.8);
    await page.clock.runFor(550);
    assert.deepEqual(await readPlayer(page), { toggles: 0, seeks: [20, 30], expanded: true, controls: 'true' });
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);
    await page.clock.runFor(2500);
    assert.equal((await readPlayer(page)).controls, 'false');
    await page.evaluate(() => window.fixture.ui.setMiniMode(true));
    await tap(0.2);
    await tap(0.2);
    await page.clock.runFor(550);
    assert.deepEqual(await readPlayer(page), { toggles: 0, seeks: [20, 30], expanded: false, controls: 'false' });
  } finally {
    await browser.close();
  }
});

test('video gestures leave controls and mini mode alone and discard pending clicks on source change or removal', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await createPlayerPage(browser);
    await page.locator('.play-pause-button').click();
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);
    const slider = await page.locator('.seek-bar').boundingBox();
    await page.mouse.click(slider.x + slider.width * 0.75, slider.y + slider.height / 2);
    await page.clock.runFor(550);
    const afterSlider = await readPlayer(page);
    assert.equal(afterSlider.toggles, 1);
    assert.equal(afterSlider.expanded, false);
    assert.equal(afterSlider.seeks.length, 1);
    assert.ok(afterSlider.seeks[0] > 40 && afterSlider.seeks[0] < 50);

    const preview = await surfacePoint(page);
    await page.mouse.move(preview.x, preview.y);
    await page.locator('.player-video-expand').click();
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).expanded, true);
    assert.equal((await readPlayer(page)).toggles, 1);
    await page.locator('.player-video-expand').click();
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).expanded, false);
    assert.equal((await readPlayer(page)).toggles, 1);

    await page.evaluate(() => window.fixture.ui.setMiniMode(true));
    let point = await surfacePoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);
    assert.equal((await readPlayer(page)).expanded, false);
    await page.evaluate(() => window.fixture.ui.setMiniMode(false));

    point = await surfacePoint(page);
    await page.mouse.click(point.x, point.y);
    await page.evaluate(() => {
      const { player, stateManager } = window.fixture;
      player.audioElement.src = '/next.mp4';
      stateManager.update({ currentTrack: { name: 'Next.mp4', path: '/next.mp4' } });
    });
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);

    point = await surfacePoint(page);
    await page.mouse.click(point.x, point.y);
    await page.evaluate(() => window.fixture.ui.removeUI());
    await page.clock.runFor(550);
    assert.equal((await readPlayer(page)).toggles, 1);
    assert.equal(await page.locator('.audio-player').count(), 0);
  } finally {
    await browser.close();
  }
});
