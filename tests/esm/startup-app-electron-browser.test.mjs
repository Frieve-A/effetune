import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';

test('maximized startup completes without a debugger or hidden-window paint events', { timeout: 40_000 }, async () => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-startup-native-')));
  let child;
  let exited;
  let guard;
  try {
    await writeFile(path.join(profile, 'config.json'), JSON.stringify({
      checkForUpdatesOnStartup: false, pipelineStartup: 'default'
    }));
    await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
      inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID, outputDeviceId: 'default', sampleRate: 48000, outputChannels: 2
    }));
    await writeFile(path.join(profile, 'window-state.json'), JSON.stringify({
      bounds: { x: 80, y: 80, width: 1100, height: 800 }, isMaximized: true
    }));
    const env = { ...process.env, EFFETUNE_STARTUP_TEST_PROFILE: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(createRequire(import.meta.url)('electron'),
      [fileURLToPath(new URL('../helpers/startup-app-electron-main.cjs', import.meta.url))],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
    const state = await new Promise((resolve, reject) => {
      let presented;
      let splash;
      const maximizations = [];
      const complete = (error, result) => {
        clearTimeout(guard);
        child.removeListener('message', onMessage);
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        if (error) reject(error);
        else resolve(result);
      };
      const onMessage = message => {
        if (message.type === 'presented') presented = message;
        if (message.type === 'maximized') maximizations.push(message);
        if (message.type === 'closed' && message.window.url.endsWith('effetune-splash.html')) splash = message.window;
        if (!presented || !splash) return;
        // The Linux window manager can acknowledge maximize after the native show event.
        const maximizedWindow = [presented, ...maximizations].find(observation =>
          observation.windowId === presented.main.id && observation.url === presented.main.url &&
          observation.visible && observation.maximized);
        if (maximizedWindow) complete(null, { ...presented, splash, maximizedWindow });
      };
      const onError = error => complete(error);
      const onExit = code => complete(new Error(`Electron exited before presentation (${code}): ${output}`));
      guard = setTimeout(() => complete(new Error(`Startup did not present a maximized main window: ${output}`)), 30_000);
      child.on('message', onMessage);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    clearTimeout(guard);
    assert.equal(state.visible, true);
    if (process.platform === 'win32') assert.equal(state.maximized, true);
    assert.equal(state.maximizedWindow.windowId, state.main.id);
    assert.equal(state.maximizedWindow.url, state.main.url);
    assert.equal(state.maximizedWindow.visible, true);
    assert.equal(state.maximizedWindow.maximized, true);
    assert.equal(state.main.loads, 1);
    assert.equal(state.main.shows.length, 1);
    assert.equal(state.main.shows[0].prepared, true);
    assert.ok(state.splash.closedAt - state.splash.shownAt >= 2900);
  } finally {
    clearTimeout(guard);
    if (child?.exitCode === null) {
      if (child.connected) child.send('exit');
      else child.kill();
      const shutdownGuard = setTimeout(() => child.kill(), 3000);
      try { await exited; } finally { clearTimeout(shutdownGuard); }
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function silentWav() {
  const pcm = Buffer.alloc(44 + 48000 * 4);
  pcm.write('RIFF'); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(48000, 24); pcm.writeUInt32LE(192000, 28);
  pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36);
  pcm.writeUInt32LE(pcm.length - 44, 40);
  return pcm;
}

for (const mode of ['first-launch', 'saved-window', 'preset-and-music', 'minimized', 'tray']) {
  test(`desktop startup loads the real app once: ${mode}`, { timeout: 60_000 }, async () => {
    const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-startup-app-')));
    let application;
    try {
      const minimized = mode === 'minimized' || mode === 'tray';
      await writeFile(path.join(profile, 'config.json'), JSON.stringify({
        startMinimized: minimized, minimizeToTray: mode === 'tray',
        checkForUpdatesOnStartup: false, pipelineStartup: 'default'
      }));
      if (mode === 'saved-window') {
        await writeFile(path.join(profile, 'window-state.json'), JSON.stringify({
          bounds: { x: 80, y: 80, width: 900, height: 700 }, isMaximized: false
        }));
      }
      const args = [fileURLToPath(new URL('../helpers/startup-app-electron-main.cjs', import.meta.url))];
      if (mode === 'minimized') args.push('--from-auto-restart');
      if (mode === 'preset-and-music') {
        const preset = path.join(profile, 'Startup.effetune_preset');
        const music = path.join(profile, 'Silence.wav');
        await writeFile(preset, JSON.stringify({ pipeline: [
          { name: 'Volume', enabled: true, parameters: { vl: -12 } }
        ] }));
        await writeFile(music, silentWav());
        args.push(preset, music);
      }
      application = await electron.launch({ args,
        env: { ...process.env, EFFETUNE_STARTUP_TEST_PROFILE: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
        timeout: 30_000 });
      const deadline = Date.now() + 30_000;
      let mainPage;
      while (!(mainPage = application.windows().find(page => page.url().includes('/effetune.html')))) {
        if (Date.now() > deadline) throw new Error('The application document did not load');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await mainPage.waitForFunction(() => window.app?.initialized, null, { timeout: 30_000 });
      const audio = await mainPage.evaluate(() => ({
        direct: window.audioManager.ioManager.directOutputMode,
        hasMediaOutput: !!window.audioManager.ioManager.audioElement,
        pipeline: window.audioManager.pipeline.map(plugin => plugin.name),
        hasPlayer: !!window.uiManager.audioPlayer
      }));
      assert.equal(audio.direct, true);
      assert.equal(audio.hasMediaOutput, false);
      if (mode === 'preset-and-music') {
        assert.deepEqual(audio.pipeline, ['Volume']);
        assert.equal(audio.hasPlayer, true);
      }
      const state = await application.evaluate(({ BrowserWindow }) => {
        const records = globalThis.startupWindows;
        const main = records.find(item => item.url.includes('/effetune.html'));
        const window = BrowserWindow.fromId(main.id);
        return { main, others: records.filter(item => item !== main),
          minimized: window.isMinimized(), visible: window.isVisible() };
      });
      assert.equal(state.main.loads, 1);
      if (minimized) {
        assert.equal(state.others.length, 0);
        if (mode === 'minimized') assert.equal(state.minimized, true);
        else assert.equal(state.visible, false);
      } else {
        assert.equal(state.others.length, 1);
        assert.equal(state.main.shows.length, 1);
        assert.equal(state.main.shows[0].prepared, true);
        await application.evaluate(async () => {
          while (globalThis.startupWindows.some(item => item.url.endsWith('effetune-splash.html') && !item.closed)) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        });
        const splash = await application.evaluate(() => globalThis.startupWindows.find(item =>
          item.url.endsWith('effetune-splash.html')));
        assert.ok(splash.closedAt - splash.shownAt >= 2900);
      }
    } finally {
      await application?.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
