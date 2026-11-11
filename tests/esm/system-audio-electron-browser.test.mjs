import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const TONE_FREQUENCY = 997;

async function waitForAppPage(application) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const page = application.windows().find(candidate => candidate.url().includes('effetune.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('production app must open effetune.html');
}

async function closeApplication(application) {
  const child = application.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  try {
    await Promise.race([application.close(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Electron test shutdown timed out')), 15_000);
    })]);
  } catch (error) {
    process.stderr.write(`System Audio integration shutdown required cleanup: ${error.message}\n`);
    if (child.exitCode === null) {
      if (process.platform === 'win32') {
        await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
      } else child.kill('SIGKILL');
    }
    throw error;
  } finally { clearTimeout(timer); }
}

// Play a tone on the Windows default output from a separate hidden window.
function startDefaultOutputTone(application, frequency) {
  return application.evaluate(async ({ BrowserWindow }, toneFrequency) => {
    const tone = new BrowserWindow({ show: false, webPreferences: {
      partition: 'system-audio-test-tone', sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false
    } });
    globalThis.systemAudioTestTone = tone;
    await tone.loadURL('about:blank');
    return tone.webContents.executeJavaScript(`(async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = ${toneFrequency};
      gain.gain.value = 0.25;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      await context.resume();
      return context.state;
    })()`, true);
  }, frequency);
}

function stopDefaultOutputTone(application) {
  return application.evaluate(() => {
    const tone = globalThis.systemAudioTestTone;
    if (tone && !tone.isDestroyed()) tone.destroy();
    globalThis.systemAudioTestTone = null;
  });
}

test('System Audio captures the Windows default output while EffeTune plays to a second device', {
  timeout: 90_000,
  skip: process.platform === 'win32' ? false : 'System Audio input is available only on Windows'
}, async t => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-system-audio-')));
  let application;
  let page;
  let closedNormally = false;
  const stage = name => process.stdout.write(`System Audio integration: ${name}\n`);
  t.after(async () => {
    let shutdownError;
    if (application && !closedNormally) {
      // A failed run must still end the loopback so the default output is unmuted.
      await stopDefaultOutputTone(application).catch(() => {});
      if (page && !page.isClosed()) {
        await page.evaluate(() => window.audioManager?.ioManager?.releaseAudioInput({ reason: 'close' }))
          .catch(error => process.stderr.write(`System Audio integration input cleanup: ${error.message}\n`));
      }
      try { await closeApplication(application); } catch (error) { shutdownError = error; }
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (shutdownError) throw shutdownError;
  });

  await writeFile(path.join(profile, 'config.json'), JSON.stringify({
    onboardingTourShown: true, language: 'en', checkForUpdatesOnStartup: false
  }));
  await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
    inputDeviceId: '__effetune_no_audio_input__', sampleRate: 48000, outputDeviceId: 'default'
  }));
  application = await electron.launch({
    args: [path.join(repoRoot, 'tests/helpers/desktop-browser-electron-main.cjs'), `--user-data-dir=${profile}`],
    env: { ...process.env, EFFETUNE_BROWSER_TEST_NATIVE_INPUT: '0' },
    timeout: 20_000
  });
  page = await waitForAppPage(application);
  page.on('pageerror', error => process.stderr.write(`System Audio integration renderer: ${error.message}\n`));
  await page.waitForFunction(() => window.app?.initialized && window.audioManager?.workletNode, null, { timeout: 25_000 });

  const outputs = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices())
    .filter(device => device.kind === 'audiooutput')
    .map(({ deviceId, groupId, label }) => ({ deviceId, groupId, label })));
  const defaultGroupId = outputs.find(device => device.deviceId === 'default')?.groupId;
  const second = outputs.find(device => !['default', 'communications'].includes(device.deviceId) &&
    device.groupId && device.groupId !== defaultGroupId);
  if (new Set(outputs.map(device => device.groupId).filter(Boolean)).size < 2 || !defaultGroupId || !second) {
    t.diagnostic(JSON.stringify({ outputs: outputs.map(({ deviceId, groupId }) => ({ deviceId, groupId })) }));
    t.skip('second output device unavailable');
    return;
  }

  await page.evaluate(() => window.electronIntegration.showAudioConfigDialog());
  await page.locator(`#output-device option[value="${second.deviceId}"]`).waitFor({ state: 'attached', timeout: 10_000 });
  await page.selectOption('#output-device', second.deviceId);
  await page.waitForFunction(() =>
    document.querySelector('#input-device option[value="system-audio"]')?.disabled === false, null, { timeout: 5_000 });
  await page.selectOption('#input-device', 'system-audio');
  const reloaded = page.waitForEvent('load', { timeout: 25_000 });
  await page.locator('#apply-button').click();
  await reloaded;
  stage('Audio Configuration applied System Audio with a second output');

  try {
    await page.waitForFunction(() => window.app?.initialized && window.audioManager?.workletNode &&
      window.audioManager.ioManager.getInputSnapshot().state === 'live', null, { timeout: 25_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      preferences: window.audioPreferences,
      snapshot: window.audioManager?.ioManager?.getInputSnapshot(),
      disabled: window.audioManager?.ioManager?.systemAudioDisabled,
      lastError: String(window.audioManager?.ioManager?.lastInputInitializationError || '')
    })).catch(() => null);
    throw new Error(`System Audio input did not start: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  const input = await page.evaluate(() => {
    const ioManager = window.audioManager.ioManager;
    // Keep the captured tone off the second device; only the input side is measured.
    ioManager.outputGainNode.gain.value = 0;
    return {
      preferences: { input: window.audioPreferences.inputDeviceId, output: window.audioPreferences.outputDeviceId },
      videoTracks: ioManager.inputStream.getVideoTracks().length,
      audioTracks: ioManager.inputStream.getAudioTracks().map(track => track.readyState)
    };
  });
  assert.deepEqual(input.preferences, { input: 'system-audio', output: second.deviceId });
  assert.equal(input.videoTracks, 0, 'the loopback video track is stopped and removed');
  assert.deepEqual(input.audioTracks, ['live']);
  stage('loopback input is live');

  await page.evaluate(frequency => {
    const context = window.audioManager.audioContext;
    const source = window.audioManager.ioManager.inputSourceNode;
    const meter = context.createAnalyser();
    meter.fftSize = 8192;
    meter.smoothingTimeConstant = 0;
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(meter);
    meter.connect(silent).connect(context.destination);
    const center = Math.round(frequency * meter.fftSize / context.sampleRate);
    window.systemAudioTestMeter = {
      // Peak tone-band level over a short window, in linear amplitude units.
      async measure() {
        let toneLevel = 0;
        for (let sample = 0; sample < 6; sample++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const bins = new Float32Array(meter.frequencyBinCount);
          meter.getFloatFrequencyData(bins);
          let power = 0;
          for (let bin = center - 3; bin <= center + 3; bin++) power += 10 ** (bins[bin] / 10);
          toneLevel = Math.max(toneLevel, Math.sqrt(power));
        }
        return toneLevel;
      },
      dispose() {
        source.disconnect(meter);
        meter.disconnect();
        silent.disconnect();
      }
    };
  }, TONE_FREQUENCY);
  const baseline = await page.evaluate(() => window.systemAudioTestMeter.measure());
  assert.equal(await startDefaultOutputTone(application, TONE_FREQUENCY), 'running');
  // Let the loopback deliver the tone before sampling.
  await page.waitForTimeout(500);
  const withTone = await page.evaluate(() => window.systemAudioTestMeter.measure());
  await stopDefaultOutputTone(application);
  await page.evaluate(() => window.systemAudioTestMeter.dispose());
  t.diagnostic(JSON.stringify({ baseline, withTone }));
  // The captured level depends on the host mix, so require a clear rise over the tone-free baseline.
  assert.ok(withTone > 1e-5 && withTone > baseline * 10,
    `System Audio input must carry the default-output tone: ${JSON.stringify({ baseline, withTone })}`);
  stage('default-output tone reached the System Audio input');

  // The normal close path releases the input, which ends the loopback and its mute.
  await closeApplication(application);
  closedNormally = true;
  stage('app shutdown');
});
