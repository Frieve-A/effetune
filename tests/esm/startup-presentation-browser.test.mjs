import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://effetune.test';
const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.json5': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png'
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function assertPreparing(page) {
  // Keep the application hidden without changing its layout measurements, but
  // leave a themed loading indicator visible in the prepared native window.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const spinner = document.querySelector('.startup-spinner');
    const appContent = document.querySelector('.title-container');
    return {
      scrollbarColor: style.scrollbarColor,
      spinnerDisplay: getComputedStyle(spinner).display,
      spinnerVisibility: getComputedStyle(spinner).visibility,
      appVisibility: getComputedStyle(appContent).visibility
    };
  }), {
    scrollbarColor: 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)',
    spinnerDisplay: 'block',
    spinnerVisibility: 'visible',
    appVisibility: 'hidden'
  });
}

for (const startupView of ['effects', 'library']) {
  test(`${startupView} startup presents the completed UI after slow resources and data`, { timeout: 45_000 }, async () => {
    const browser = await chromium.launch({
      headless: true,
      ignoreDefaultArgs: ['--hide-scrollbars'],
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const gates = new Map([
      ['/js/startup.js', { requested: deferred(), release: deferred() }],
      ['/js/locales/en.json5', { requested: deferred(), release: deferred() }],
      ...(startupView === 'library'
        ? [['/effetune-library.css', { requested: deferred(), release: deferred() }]] : [])
    ]);
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(view => {
        window.EFFECTUNE_DEV_SERVER = true;
        localStorage.setItem('effetune_app_config', JSON.stringify({
          startupView: view, libraryStartupView: 'tracks', language: 'en', pipelineStartup: 'default'
        }));
        localStorage.setItem('effetune_audio_preferences', JSON.stringify({
          inputDeviceId: 'none', useWasmDsp: false
        }));
        let app;
        Object.defineProperty(window, 'app', {
          configurable: true,
          get: () => app,
          set(value) {
            app = value;
            const processArguments = value.processCommandLineArguments;
            value.processCommandLineArguments = async function (...args) {
              const result = await processArguments.apply(this, args);
              window.__startupContentHandled = true;
              return result;
            };
          }
        });
        window.__startupFrames = [];
        const observe = () => {
          if (document.body && !document.documentElement.classList.contains('app-starting')) {
            window.__startupFrames.push({
              initialized: window.app?.initialized === true,
              library: document.body.classList.contains('view-library'),
              phase: window.uiManager?.libraryView?.pagedState?.phase ?? null,
              version: document.getElementById('app-version')?.textContent || ''
            });
          }
          requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      }, startupView);
      await page.route(`${origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        const gate = gates.get(pathname);
        if (gate) {
          gate.requested.resolve();
          await gate.release.promise;
        }
        const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
        if (!file.startsWith(root)) return route.fulfill({ status: 403, body: '' });
        try {
          await route.fulfill({
            contentType: contentTypes[path.extname(file)] || 'application/octet-stream',
            body: await fs.readFile(file)
          });
        } catch {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      await page.goto(`${origin}/effetune.html`, { waitUntil: 'commit' });
      await page.locator('#pipelineList').waitFor({ state: 'attached' });
      await assertPreparing(page);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await assertPreparing(page);

      if (startupView === 'library') {
        await page.evaluate(async () => {
          const { LibraryManagerV2 } = await import('/js/library/library-manager-v2.js');
          const queryTracks = LibraryManagerV2.prototype.queryTracks;
          const firstPage = new Promise(resolve => { window.__releaseLibraryPage = resolve; });
          LibraryManagerV2.prototype.queryTracks = async function (...args) {
            window.__libraryPageRequested = true;
            await firstPage;
            return queryTracks.apply(this, args);
          };
        });
      }
      gates.get('/js/startup.js').release.resolve();
      await gates.get('/js/locales/en.json5').requested.promise;
      await page.waitForFunction(() => window.__startupContentHandled === true);
      await assertPreparing(page);
      gates.get('/js/locales/en.json5').release.resolve();

      if (startupView === 'library') {
        await gates.get('/effetune-library.css').requested.promise;
        await assertPreparing(page);
        gates.get('/effetune-library.css').release.resolve();
        await page.waitForFunction(() => window.__libraryPageRequested === true);
        await assertPreparing(page);
        await page.evaluate(() => window.__releaseLibraryPage());
      }
      await page.waitForFunction(() => window.app?.initialized === true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const frames = await page.evaluate(() => window.__startupFrames);
      assert.ok(frames.length > 0, 'The prepared UI must become visible');
      for (const frame of frames) {
        assert.equal(frame.initialized, true, 'No partially initialized UI may paint');
        assert.equal(frame.library, startupView === 'library');
        if (startupView === 'library') assert.equal(frame.phase, 'committed');
        assert.notEqual(frame.version, '');
      }
      assert.notEqual(await page.evaluate(() =>
        getComputedStyle(document.documentElement).scrollbarColor
      ), 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)', 'Normal scrollbar colors must return after startup');
      assert.deepEqual(errors, []);
    } finally {
      for (const gate of gates.values()) gate.release.resolve();
      await browser.close();
    }
  });
}

test('application static import failure reveals a useful startup error', { timeout: 45_000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.route(`${origin}/**`, async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/js/plugin-manager.js') {
        await route.fulfill({ status: 500, contentType: 'text/javascript', body: '' });
        return;
      }

      const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
      if (!file.startsWith(root)) return route.fulfill({ status: 403, body: '' });
      try {
        await route.fulfill({
          contentType: contentTypes[path.extname(file)] || 'application/octet-stream',
          body: await fs.readFile(file)
        });
      } catch {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(`${origin}/effetune.html`, { waitUntil: 'commit' });
    await page.waitForFunction(() =>
      !document.documentElement.classList.contains('app-starting')
    );

    assert.deepEqual(await page.locator('#errorDisplay').evaluate(element => ({
      text: element.textContent,
      isError: element.classList.contains('error-message')
    })), {
      text: 'EffeTune could not start. Reload the app and try again.',
      isError: true
    });
    assert.notEqual(await page.evaluate(() =>
      getComputedStyle(document.documentElement).opacity
    ), '0', 'The startup failure must not leave the app transparent');
    assert.ok(consoleErrors.some(message => message.includes('Application startup failed:')),
      'The detailed startup failure must be logged to the developer console');
  } finally {
    await browser.close();
  }
});
