import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright';

test('Windows first presents saved window geometry without a visible maximize transition', {
  skip: process.platform !== 'win32', timeout: 30_000
}, async () => {
  const tempBase = await realpath(os.tmpdir());
  const profile = await realpath(await mkdtemp(path.join(tempBase, 'effetune-startup-window-')));
  assert.ok(profile.startsWith(`${tempBase}${path.sep}`));
  let application;
  try {
    application = await electron.launch({
      args: [fileURLToPath(new URL('../helpers/startup-window-electron-main.cjs', import.meta.url))],
      env: { ...process.env, EFFETUNE_STARTUP_WINDOW_TEST_PROFILE: profile },
      timeout: 20_000
    });
    const results = await application.evaluate(() => globalThis.startupWindowResults);
    for (const result of results) {
      assert.equal(result.prepared.visible, false);
      assert.equal(result.prepared.maximized, result.isMaximized);
      assert.ok(result.preparationShows.every(opacity => opacity === 0));
      assert.deepEqual(result.prepared.normalBounds, result.normalBounds);
      assert.equal(result.presented.visible, true);
      assert.equal(result.presented.maximized, result.isMaximized);
      assert.deepEqual(result.presentationShows, [{
        maximized: result.isMaximized, bounds: result.prepared.bounds
      }]);
      assert.deepEqual(result.presented.bounds, result.prepared.bounds);
      // Windows applies the native application-menu height when the hidden window
      // is presented, so compare each renderer snapshot with its same-phase native size.
      assert.deepEqual(result.firstClientSize, result.prepared.contentSize);
      assert.deepEqual(result.shownClientSize, result.presented.contentSize);
      assert.deepEqual(result.restoredBounds, result.normalBounds);
    }
  } finally {
    await application?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
