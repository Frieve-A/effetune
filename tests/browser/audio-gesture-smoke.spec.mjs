import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserTestLaunchOptions } from '../helpers/browser-test-display.mjs';

const FIXTURE_PATH = '/tests/browser/audio-gesture-smoke.fixture.html';

export async function runAudioGestureBrowserSmoke({ baseURL }) {
  // Do not inherit the DSP suite's autoplay exemption or fake microphone grant.
  const browser = await chromium.launch(await browserTestLaunchOptions({
    headless: process.env.POWER_BROWSER_HEADED !== '1',
    args: ['--autoplay-policy=document-user-activation-required']
  }));
  try {
    for (const cold of [true, false]) {
      const context = await browser.newContext({ hasTouch: true, isMobile: true });
      try {
        const page = await context.newPage();
        const errors = [];
        let latest = null;
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
          if (message.type() === 'error') errors.push(message.text());
          if (message.text().startsWith('[audio-gesture-smoke] ')) {
            latest = JSON.parse(message.text().slice('[audio-gesture-smoke] '.length));
          }
        });
        await page.goto(`${baseURL}${FIXTURE_PATH}${cold ? '?cold' : ''}`);
        // Locator/evaluate polling itself grants CDP user activation. Observe
        // fixture events instead so expiry and the first touch remain genuine.
        const waitForStage = async stage => {
          if (latest?.stage === stage) return latest;
          try {
            await page.waitForEvent('console', {
              predicate: message => message.text().startsWith('[audio-gesture-smoke] ') && latest?.stage === stage,
              timeout: 10_000
            });
            return latest;
          } catch (error) {
            throw new Error(`${cold ? 'Cold' : 'Resumed'} Library Play: ` +
              `${JSON.stringify(latest)}; errors: ${errors.join('; ')}`, { cause: error });
          }
        };
        const initial = await waitForStage('ready');
        assert.equal(initial.contextState, 'suspended', 'autoplay must really be restricted');
        if (!cold) assert.equal(initial.attempts[0].active, false);
        await page.touchscreen.tap(100, 40);
        if (cold) {
          const loading = await waitForStage('loading');
          assert.equal(loading.attempts[0]?.active, true,
            'cold Library Play must resume synchronously before lazy loading');
        }
        const played = await waitForStage('played');
        assert.equal(played.played, 1);
        assert.equal(played.pending, false);
        assert.equal(played.contextState, 'running');
        assert.ok(played.events.some(event => event.type === 'pointerdown' && !event.active && event.trusted));
        assert.ok(played.events.some(event => event.type === 'pointerup' && event.active && event.trusted));
        if (cold) assert.equal(played.loadFinishedWithActivation, false);
        else {
          assert.ok(played.attempts.slice(1).some(attempt => attempt.active));
          await waitForStage('resuspended');
          await page.touchscreen.tap(100, 40);
          const replayed = await waitForStage('played');
          assert.equal(replayed.played, 2);
          assert.equal(replayed.pending, false);
          assert.equal(replayed.contextState, 'running');
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
