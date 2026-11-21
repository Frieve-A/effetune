import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { builtExecutableDirectory, executableNames } from './audio-engine-session.mjs';

const sampleRate = 96000;
const trackSampleRate = 44100;
const seconds = 120;
const root = fileURLToPath(new URL('../', import.meta.url));

function makeTrack() {
  const frames = (seconds + 12) * trackSampleRate;
  const dataBytes = frames * 4;
  const data = Buffer.alloc(44 + dataBytes);
  data.write('RIFF', 0);
  data.writeUInt32LE(dataBytes + 36, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(trackSampleRate, 24);
  data.writeUInt32LE(trackSampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    data.writeInt16LE(Math.round(Math.sin(frame * Math.PI / 48) * 5200), 44 + 4 * frame);
    data.writeInt16LE(Math.round(Math.sin(frame * Math.PI / 64) * 4800), 46 + 4 * frame);
  }
  return data;
}

async function run() {
  assert.equal(process.platform, 'win32', 'The full physical application smoke uses WASAPI.');
  const { baseline } = executableNames(process.platform, process.arch);
  const executable = join(builtExecutableDirectory(), baseline);
  assert.ok(existsSync(executable), 'Run npm run build:audio-engine first.');
  const listing = JSON.parse(execFileSync(executable, ['--list-devices', '--backend', 'wasapi'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  }));
  if (!listing.outputs.length) {
    console.log('Skipped native application smoke. No WASAPI playback device is available.');
    return;
  }
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'effetune-audio-engine-smoke-')));
  let application;
  try {
    const track = makeTrack();
    const path = join(profile, 'tone.wav');
    await Promise.all([
      writeFile(path, track),
      writeFile(join(profile, 'config.json'), JSON.stringify({
        language: 'en', onboardingTourShown: true, checkForUpdatesOnStartup: false,
      })),
      writeFile(join(profile, 'audio-preferences.json'), JSON.stringify({
        audioDriver: 'wasapi', inputDeviceId: '__effetune_no_audio_input__',
        outputDeviceId: 'default', sampleRate,
      })),
    ]);
    application = await electron.launch({
      args: [join(root, 'tests/helpers/desktop-browser-electron-main.cjs'), `--user-data-dir=${profile}`],
      env: { ...process.env, EFFETUNE_AUDIO_ENGINE_NULL: '0', EFFETUNE_AUDIO_ENGINE_MUTE_OUTPUT: '1' },
    });
    const deadline = Date.now() + 30000;
    let page;
    while (!page && Date.now() < deadline) {
      page = application.windows().find(window => window.url().includes('effetune.html'));
      if (!page) await delay(100);
    }
    assert.ok(page, 'EffeTune main window must open.');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'warning' || message.type() === 'error' ||
          /AudioContextManager|PowerPolicy|activation|AudioPlayer|playback|rejected/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.waitForFunction(() => window.app?.initialized && window.audioManager?.getEngineClock?.()?.frame > 0,
      null, { timeout: 30000 });
    const startup = await page.evaluate(() => ({
      driver: window.audioPreferences.audioDriver, session: window.audioManager.session,
    }));
    assert.equal(startup.driver, 'wasapi');
    assert.ok(startup.session.deviceRate > 0);

    await page.evaluate(() => {
      const manager = window.audioManager;
      window.nativeAudioSmokeGaps = [];
      let previousGap;
      manager.engineEvents.addEventListener('clock', ({ detail }) => {
        const { feedGaps, feedBackwardGaps, lastFeedGapExpected, lastFeedGapReceived } = detail;
        if (!feedGaps || feedGaps === previousGap || window.nativeAudioSmokeGaps.length >= 64) return;
        previousGap = feedGaps;
        window.nativeAudioSmokeGaps.push({ feedGaps, feedBackwardGaps, lastFeedGapExpected, lastFeedGapReceived });
      });
      const start = manager.activateStagedAudioCandidate.bind(manager);
      manager.activateStagedAudioCandidate = async (...args) => {
        const result = await start(...args);
        console.debug('Playback activation decision:', JSON.stringify({
          activated: result.activated, errorCode: result.error?.code, stage: result.stage?.state,
        }));
        return result;
      };
    });

    // Give the normal file-selection handler a single synthetic selection.
    await application.evaluate(({ dialog }, trackPath) => {
      const show = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = show;
        return { canceled: false, filePaths: [trackPath] };
      };
    }, path);
    await page.evaluate(async () => {
      const { openMusicFile } = await import('./js/electron/presetIntegration.js');
      await openMusicFile(true);
    });
    try {
      await page.waitForFunction(() => window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying,
        null, { timeout: 30000 });
    } catch (error) {
      const playback = await page.evaluate(() => {
        const player = window.uiManager.audioPlayer;
        const state = player?.stateManager.getStateSnapshot();
        const manager = window.audioManager;
        return { playing: state?.isPlaying, track: state?.currentTrack?.name, mode: state?.playbackMode,
          context: manager.audioContext.state, power: manager.powerPolicyController?.getSnapshot?.(),
          input: manager.ioManager.getInputSnapshot?.(), mediaError: player?.audioElement?.error?.message,
          activation: manager.isStagedAudioActivationEnabled?.() };
      });
      throw new Error(`${error.message}\n${JSON.stringify(playback)}\n${errors.join('\n')}`, { cause: error });
    }

    let previous;
    let firstFrame;
    const unexpected = [];
    for (let second = 0; second < seconds; second += 1) {
      if (second === 25) {
        await page.evaluate(() => {
          const manager = window.audioManager;
          const volume = window.app.pluginManager.createPlugin('Volume');
          volume.setParameters({ vl: -5 });
          manager.pipeline.push(volume);
          window.pipelineManager.core.workletSync.updateWorkletPlugins();
        });
      } else if (second === 50 || second === 80) {
        await application.evaluate(({ BrowserWindow }, minimize) => {
          const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('effetune.html'));
          if (minimize) window.minimize();
          else window.restore();
        }, second === 50);
      }
      await delay(1000);
      const state = await page.evaluate(() => ({
        clock: window.audioManager.clock,
        alive: !window.audioManager.failed,
        playing: window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying,
      }));
      const { clock } = state;
      assert.ok(state.alive && state.playing && clock, `Playback stopped at ${second}s. ${errors.join(' ')}`);
      assert.ok(Number.isSafeInteger(clock.feedUnderruns) && Number.isSafeInteger(clock.feedGaps));
      firstFrame ??= clock.pipelineFrame;
      if (previous && second > 5 &&
          (clock.feedUnderruns > previous.feedUnderruns || clock.feedGaps > previous.feedGaps)) {
        unexpected.push({ second, feedUnderruns: clock.feedUnderruns, feedGaps: clock.feedGaps });
        if (unexpected.length === 1) console.log(JSON.stringify({ second, firstGapClock: clock }));
      }
      previous = clock;
    }
    assert.ok(previous.pipelineFrame - firstFrame >= (seconds - 8) * sampleRate, 'Native playback clock did not keep pace.');
    const { transport, nativeAudioSmokeGaps } = await page.evaluate(async () => {
      const manager = window.audioManager;
      const observation = new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000);
        manager.engineEvents.addEventListener('powerObservation', ({ detail }) => {
          clearTimeout(timeout);
          resolve({ droppedFeedPackets: detail.droppedFeedPackets, telemetryDroppedFrames: detail.telemetryDroppedFrames });
        }, { once: true });
      });
      manager.powerPolicyController._requestWorkletObservation();
      return { transport: await observation, nativeAudioSmokeGaps: window.nativeAudioSmokeGaps };
    });
    console.log(JSON.stringify({ session: startup.session, counters: { ...previous, ...transport },
      unexpected, nativeAudioSmokeGaps }));
    for (const value of [previous.callbackOverruns, previous.deviceDiscontinuities, previous.feedOverflows,
      transport?.droppedFeedPackets, transport?.telemetryDroppedFrames]) {
      assert.ok(Number.isSafeInteger(value) && value >= 0, 'Missing native audio diagnostic counter.');
    }
    assert.deepEqual(unexpected, [], 'Feed underruns or gaps increased during continuous playback.');
  } finally {
    try { await application?.close(); }
    finally { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  }
}

await run();
