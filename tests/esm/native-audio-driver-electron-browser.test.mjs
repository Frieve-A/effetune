import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { existsSync } from 'node:fs';
import { builtExecutableDirectory, executableNames, requireExecutableEnv } from '../../tools/audio-engine-session.mjs';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { createDsfFixture, encodeDsdSignal } from '../helpers/dsd-fixture.mjs';

function flacCrc(bytes, bits, polynomial) {
  let crc = 0;
  const top = 1 << (bits - 1);
  const mask = (1 << bits) - 1;
  for (const byte of bytes) {
    crc ^= byte << (bits - 8);
    for (let bit = 0; bit < 8; ++bit) crc = ((crc << 1) ^ (crc & top ? polynomial : 0)) & mask;
  }
  return crc;
}

function create32BitSideChannelFlac() {
  const frameCount = 36;
  const blockFrames = 4096;
  const stream = Buffer.alloc(42);
  stream.write('fLaC');
  stream[4] = 0x80;
  stream[7] = 34;
  stream.writeUInt16BE(blockFrames, 8);
  stream.writeUInt16BE(blockFrames, 10);
  stream.writeBigUInt64BE(48000n << 44n | 1n << 41n | 31n << 36n | BigInt(frameCount * blockFrames), 18);
  const frames = Array.from({length:frameCount},(_, index) => {
    const header = Buffer.from([0xff, 0xf8, 0xca, 0x80, index]);
    // Left-side stereo stores 0x60000000 and the positive 33-bit difference 0xc0000000.
    const subframes = Buffer.from([0,0x60,0,0,0, 0,0x60,0,0,0,0]);
    const frame = Buffer.concat([header,Buffer.of(flacCrc(header,8,0x07)),subframes,Buffer.alloc(2)]);
    frame.writeUInt16BE(flacCrc(frame.subarray(0,-2),16,0x8005),frame.length - 2);
    return frame;
  });
  return Buffer.concat([stream,...frames]);
}

test('Audio Configuration switches drivers, renders the player feed and carries the device selection over', {
  timeout: 120000
}, async t => {
  for (const name of Object.values(executableNames(process.platform,process.arch)).filter(Boolean)) {
    if (!existsSync(path.join(builtExecutableDirectory(),name))) {
      const reason = 'Build the native audio driver with npm run build:audio-engine before running this test.';
      if (process.env[requireExecutableEnv] === '1') assert.fail(reason);
      t.skip(reason);
      return;
    }
  }
  const root = fileURLToPath(new URL('../../',import.meta.url));
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(),'effetune-audio-driver-')));
  let application;
  try {
    await writeFile(path.join(profile,'config.json'), JSON.stringify({
      language:'en',onboardingTourShown:true,checkForUpdatesOnStartup:false
    }));
    await writeFile(path.join(profile,'audio-preferences.json'), JSON.stringify({
      audioDriver:'standard',inputDeviceId:'__effetune_no_audio_input__',outputDeviceId:'default',sampleRate:48000
    }));
    await writeFile(path.join(profile,'pipeline-state.json'),JSON.stringify([
      {name:'Room EQ',enabled:true,parameters:{ms:'unavailable-measurement'}}
    ]));
    application = await electron.launch({args:[path.join(root,'tests/helpers/desktop-browser-electron-main.cjs'),
      `--user-data-dir=${profile}`],env:{...process.env,EFFETUNE_AUDIO_ENGINE_NULL:'1',
        EFFETUNE_BROWSER_TEST_MANUAL_AUDIO_CLOCK:'1',EFFETUNE_BROWSER_TEST_NATIVE_INPUT:'0'}});
    const deadline = Date.now() + 30000;
    let page;
    while (!page && Date.now() < deadline) {
      page = application.windows().find(win => win.url().includes('effetune.html'));
      if (!page) await new Promise(resolve => setTimeout(resolve,100));
    }
    assert.ok(page,'EffeTune main window must open');
    const errors = [];
    page.on('console', message => {
      if (['warning','error'].includes(message.type())) errors.push(message.text());
    });
    page.on('pageerror',error => errors.push(error.message));
    await page.waitForFunction(() => window.app?.initialized,null,{timeout:30000});
    const driver = process.platform === 'win32' ? 'wasapi' : 'miniaudio';
    const changeDriver = async desired => {
      await page.evaluate(() => window.electronIntegration.showAudioConfigDialog());
      await page.locator('#audio-driver').selectOption(desired);
      await page.waitForFunction(() => !document.querySelector('#apply-button').disabled);
      const reloaded = page.waitForEvent('load',{timeout:30000});
      await page.locator('#apply-button').click();
      await reloaded;
      await page.waitForFunction(() => window.app?.initialized,null,{timeout:30000});
    };
    await changeDriver(driver);
    const state = await page.evaluate(() => ({
      driver:window.audioPreferences?.audioDriver, bank:window.audioManager?.session,
      inputDeviceId:window.audioPreferences?.inputDeviceId,
      ready:window.audioManager?.isDspReady?.(),sink:window.audioManager?.audioContext?.sinkId?.type
    }));
    assert.equal(state.driver,driver,errors.join('\n'));
    assert.equal(state.inputDeviceId,'__effetune_no_audio_input__');
    assert.equal(state.ready,true,errors.join('\n'));
    assert.equal(state.sink,'none');
    assert.equal(state.bank.sampleRate,48000);
    await page.waitForFunction(() => window.audioManager.pipeline.some(plugin =>
      plugin.constructor.name === 'RoomEqPlugin' && plugin.externalAssetInfo?.missing));
    assert.equal(await page.evaluate(() => window.audioManager.outputTarget),1,
      'A missing effect measurement must leave the published audio output available');
    const peak = await page.evaluate(async () => {
      const m = window.audioManager, ctx = m.audioContext;
      const tone = ctx.createOscillator();
      m.connectSourceToPipeline(tone);
      tone.start();
      try {
        for (let i = 0; i < 20; ++i) {
          await new Promise(resolve => setTimeout(resolve,20));
          const { attachment } = await m.request({type:'renderNullDevice',frames:512},'nullOutput');
          const maximum = new Float32Array(attachment).reduce((n,v) => Math.max(n,Math.abs(v)),0);
          if (maximum > .01) return maximum;
        }
        return 0;
      } finally { tone.stop(); m.disconnectSourceFromPipeline(tone); }
    });
    assert.ok(peak > .01,`The native pipeline did not render the feed: ${errors.join('\n')}`);
    const gain = await page.evaluate(async () => {
      const m = window.audioManager;
      const volume = window.pluginManager.createPlugin('Volume');
      m.updateCurrentPipeline([volume]);
      await m.rebuildPipeline();
      volume.setVl(-6);
      const input = new Float32Array(4096 * m.getOutputChannelCount()).fill(.5);
      let sample;
      for (let batch = 0; batch < 8; ++batch) {
        const {attachment} = await m.request({type:'renderNull',frames:4096,attachment:input.buffer},'nullOutput');
        sample = new Float32Array(attachment).at(-1);
      }
      return sample / .5;
    });
    assert.ok(Math.abs(gain - 10 ** (-6/20)) < .001,`Volume adjustment did not reach the engine: ${gain}`);
    const network = await application.evaluate(() => globalThis.fixtureAudioNetwork);
    assert.ok(network?.acknowledged > 8,'the main Network Output host must return packet credits');
    assert.equal(network.acknowledged,network.packets);
    const blind = await page.evaluate(async () => {
      const m = window.audioManager;
      const b = window.pluginManager.createPlugin('Volume');
      b.vl = -12;
      m.pipelineB = [b];
      const enabled = await m.enableParallelPipelines('B');
      if (!enabled) return {enabled};
      const input = new Float32Array(4096 * m.getOutputChannelCount()).fill(.5);
      const render = async () => {
        const {attachment} = await m.request({type:'renderNull',frames:4096,attachment:input.buffer},'nullOutput');
        return new Float32Array(attachment).at(-1) / .5;
      };
      const branchB = await render();
      m.setBlindSelection('A');
      const branchA = await render();
      await m.disableParallelPipelines();
      return {enabled,branchA,branchB};
    });
    assert.ok(blind.enabled,`Blind test could not start: ${errors.join('\n')}`);
    assert.ok(Math.abs(blind.branchA - 10 ** (-6/20)) < .001);
    assert.ok(Math.abs(blind.branchB - 10 ** (-12/20)) < .001);
    assert.equal(await page.evaluate(() => window.audioManager.failed),false,errors.join('\n'));
    await application.evaluate(() => globalThis.closeFixtureAudioEngine());
    await page.waitForFunction(() => window.audioManager.failed === true);
    assert.equal(await page.evaluate(() => window.audioManager.outputErrorKey),'dialog.audioConfig.driver.stopped');
    assert.equal(await page.evaluate(() => window.audioPreferences.audioDriver),driver);
    const recovered = page.waitForEvent('load',{timeout:30000});
    await page.evaluate(() => { void window.audioManager.reset(); });
    await recovered;
    await page.waitForFunction(() => window.app?.initialized && window.audioManager.isDspReady?.(),null,{timeout:30000});
    await page.evaluate(() => window.electronIntegration.showAudioConfigDialog());
    await page.locator('#input-device').selectOption('null-in');
    await page.locator('#output-device').selectOption('null-out');
    const configured = page.waitForEvent('load',{timeout:30000});
    await page.locator('#apply-button').click();
    await configured;
    await page.waitForFunction(() => window.app?.initialized,null,{timeout:30000});
    await page.waitForFunction(() => window.audioManager.getEngineClock()?.frame > 0,null,{timeout:5000});
    const input = await page.evaluate(async () => {
      const m = window.audioManager, io = m.ioManager;
      const start = m.getEngineClock().frame;
      const before = io.getInputSnapshot();
      const release = await io.releaseAudioInput();
      const acquired = await io.beginReacquireAudioInput({requireVisible:false});
      window.fixtureNativeManager = m;
      return {before:before.state,released:release.after.state,acquired:acquired.state,start};
    });
    assert.equal(input.before,'live');
    assert.equal(input.released,'released');
    assert.equal(input.acquired,'live');
    await page.evaluate(() => window.electronIntegration.showAudioConfigDialog());
    await page.locator('#input-device').selectOption('__effetune_no_audio_input__');
    await page.locator('#apply-button').click();
    await page.waitForFunction(frame => window.fixtureNativeManager === window.audioManager &&
      window.audioManager.ioManager.getInputSnapshot().state === 'not-configured' &&
      window.audioManager.getEngineClock()?.frame > frame,input.start,{timeout:10000});
    const samples = new Float32Array(44100 * 60);
    for (let i = 0; i < samples.length; ++i) samples[i] = .15 * Math.sin(i / 20);
    const wav = new AudioEncoder().encodeWav({numberOfChannels:2,sampleRate:44100,length:samples.length,
      getChannelData:() => samples},'pcm16');
    const track = path.join(profile,'reset-playback.wav');
    await writeFile(track,new Uint8Array(await wav.arrayBuffer()));
    const chooseFile = file => application.evaluate(({dialog},file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return {canceled:false,filePaths:Array.isArray(file) ? file : [file]};
      };
    },file);
    const openTrack = async file => {
      await chooseFile(file);
      await page.evaluate(async () => {
        const {openMusicFile} = await import('./js/electron/presetIntegration.js');
        await openMusicFile(true);
      });
    };
    await page.evaluate(async () => {
      const player = await window.uiManager.createAudioPlayer([], false);
      await player.contextManager.applyGaplessPlaybackPreference(false);
    });
    await openTrack(track);
    await page.waitForFunction(() => window.uiManager.audioPlayer?.stateManager.getStateSnapshot().isPlaying &&
      window.audioManager.clock?.feedDelayFrames > 0);

    const presetPath = path.join(profile,'native-visualizer.effetune_preset');
    await writeFile(presetPath,JSON.stringify({pipeline:[
      {name:'Oscillator',enabled:true,parameters:{fr:1320,vl:-34}},
      {name:'Volume',enabled:true,parameters:{vl:-6}}
    ]}));
    await page.locator('#visualizerButton').click();
    await page.waitForFunction(() => window.uiManager.visualizerView?.sources.active &&
      window.uiManager.isEffectPipelineHidden() && window.audioManager.powerPolicyController.displayDspBypassed &&
      !window.audioManager.powerPolicyController.dspUiActivityAllowed);
    assert.equal(await page.locator('#pipeline').isVisible(),false);
    await page.evaluate(async () => {
      const view = window.uiManager.visualizerView;
      const {createDefaultLayout} = await import('./js/visualizer/visualizer-model.js');
      view.setLayout(createDefaultLayout());
      const frames = window.fixtureVisualizerFrames = [];
      let previousSnapshot;
      window.stopFixtureVisualizer = view.sources.subscribeItem('main-spectrum',frame => {
        const snapshot = view.sources.getFrame('main-spectrum');
        if (snapshot === previousSnapshot || !snapshot?.current?.some(level => level > -65)) return;
        previousSnapshot = snapshot;
        const prev = frames.at(-1);
        if (prev?.tapId !== frame.tapId || frame.sequence > prev.sequence) {
          frames.push({tapId:frame.tapId,sequence:frame.sequence});
        }
      });
    });
    const waitForVisualizerFrames = async ({afterSequence = -1, replacedTap = null} = {}) => {
      await page.waitForFunction(({afterSequence,replacedTap}) => {
        const m = window.audioManager, ui = window.uiManager;
        const tap = m.visualizerSources[0]?.tapId;
        return tap && tap !== replacedTap && ui.isEffectPipelineHidden() &&
          m.powerPolicyController.displayDspBypassed && !m.powerPolicyController.dspUiActivityAllowed &&
          ui.audioPlayer.stateManager.getStateSnapshot().isPlaying &&
          window.fixtureVisualizerFrames.filter(frame => frame.tapId === tap && frame.sequence > afterSequence).length >= 3;
      },{afterSequence,replacedTap},{timeout:6000}).catch(async error => {
        const diagnostic = await page.evaluate(() => ({
          sources:window.audioManager.visualizerSources.map(({tapId,type}) => ({tapId,type})),
          telemetry:window.audioManager.telemetryHub.getStats(),
          latest:window.fixtureVisualizerFrames.at(-1)
        }));
        throw new Error('Native Visualizer spectrum did not advance with the Effects view hidden. ' +
          JSON.stringify(diagnostic),{cause:error});
      });
      return page.evaluate(() => window.fixtureVisualizerFrames.at(-1));
    };
    const beforePreset = await waitForVisualizerFrames();
    const presetWarnings = errors.length;
    await chooseFile(presetPath);
    await page.evaluate(async () => {
      const m = window.audioManager;
      const revision = m.workletNode.port.revision;
      const published = m.waitFor('pipelineApplied',event => event.branch === 0 && event.revision > revision);
      const selection = await window.electronAPI.showOpenDialog({properties:['openFile']});
      const {openPresetFile} = await import('./js/electron/presetIntegration.js');
      await openPresetFile(true,selection.filePaths[0]);
      await published;
    });
    await page.waitForFunction(() => window.audioManager.pipeline.some(plugin => plugin.enabled &&
      plugin.constructor.name === 'OscillatorPlugin'));
    const presetSequence = await page.evaluate(() => window.fixtureVisualizerFrames.at(-1).sequence);
    const afterPreset = await waitForVisualizerFrames({afterSequence:presetSequence});
    assert.equal(afterPreset.tapId,beforePreset.tapId,'Preset publication must keep the visible Visualizer source');
    assert.ok(!errors.slice(presetWarnings).some(error => error.includes('Failed to start realtime output keepalive')),
      'A native preset with a continuous effect must publish without attempting the Chromium output keepalive');

    await page.evaluate(() => {
      const m = window.audioManager;
      window.fixtureFormatReady = 0;
      m.engineEvents.addEventListener('dspReady',() => ++window.fixtureFormatReady);
      window.fixtureFeedContext = m.audioContext;
    });
    const resetDevice = settings => page.evaluate(async settings => {
        const m = window.audioManager;
        const opened = m.waitFor('sessionState',event => event.state === 'open',10000);
        m.send({type:'testDeviceReset',...settings});
        const {detail} = await opened;
        if (detail.recoveryId) {
          const {detail:release} = await m.waitFor('recoveryReleased',event => event.recoveryId === detail.recoveryId);
          if (!release.accepted) throw new Error('Recovery failed to release the output');
        }
      },settings);
    const readOutput = () => page.evaluate(() => window.audioManager.request({type:'testReadOutput'},'testOutput'));
    const requireNetwork = async previous => {
      for (let attempt = 0; attempt < 60; ++attempt) {
        const counts = await application.evaluate(() => globalThis.fixtureAudioNetwork);
        if (counts.registration > previous && counts.nonSilent > 8 && counts.acknowledged === counts.packets) return;
        await new Promise(resolve => setTimeout(resolve,50));
      }
      assert.fail('The replacement engine must supply audible PCM and receive credits on the new port');
    };
    const recover = async (settings,width,rate,hold = false) => {
      const previous = await application.evaluate(() => globalThis.fixtureAudioNetwork.registration);
      if (hold) await page.evaluate(() => {
        const m = window.audioManager, prepare = m.preparePrimary;
        m.preparePrimary = async function (endpoint) {
          delete this.preparePrimary;
          await new Promise(resolve => { window.fixtureContinuePreparation = resolve; });
          return prepare.call(this,endpoint);
        };
      });
      const reset = resetDevice(settings);
      if (hold) {
        await page.waitForFunction(() => !!window.fixtureContinuePreparation);
        const sent = await application.evaluate(() => globalThis.fixtureAudioNetwork.nonSilent);
        await readOutput();
        await new Promise(resolve => setTimeout(resolve,150));
        const held = await readOutput();
        assert.ok(held.frames > 0);
        assert.equal(held.peak,0,'The physical sink must be silent while the new graph is unprepared');
        assert.equal(await application.evaluate(() => globalThis.fixtureAudioNetwork.nonSilent),sent,
          'An unprepared primary must not send audio to the network');
        await page.evaluate(() => { window.fixtureContinuePreparation(); delete window.fixtureContinuePreparation; });
      }
      await reset;
      if (!settings.deviceRate) await requireNetwork(previous);
      await page.waitForFunction(({width,rate}) => window.audioManager.session.width === width &&
        window.audioManager.session.deviceRate === rate && window.audioManager.clock?.feedDelayFrames > 0 &&
        window.uiManager.audioPlayer?.stateManager.getStateSnapshot().isPlaying,
        {width,rate},{timeout:10000});
      await page.waitForFunction(async () => {
        const observation = await window.audioManager.powerPolicyController._requestFreshWorkletObservation();
        return observation?.outputActive;
      },null,{polling:150,timeout:8000});
      return page.evaluate(() => ({
        persistedContext:window.fixtureFeedContext === window.audioManager.audioContext,
        ready:window.fixtureFormatReady,rate:window.audioManager.audioContext.sampleRate,
        tap:window.audioManager.tap.channelCount,endpoint:window.audioManager.workletNode.channelCount
      }));
    };
    assert.deepEqual(await recover({deviceRate:44100},2,44100),
      {persistedContext:true,ready:0,rate:48000,tap:2,endpoint:2});
    assert.deepEqual(await recover({outputChannels:1},1,44100,true),
      {persistedContext:true,ready:1,rate:48000,tap:1,endpoint:1});
    await waitForVisualizerFrames({replacedTap:afterPreset.tapId});
    await page.evaluate(() => window.stopFixtureVisualizer());
    await page.locator('#effectPipelineButton').click();
    const volumeItem = page.locator('#pipelineList .pipeline-item').filter({
      has:page.getByText('Volume',{exact:true})
    });
    const volumeValue = volumeItem.locator('input[type="number"]');
    if (!await volumeValue.isVisible()) await volumeItem.locator('.plugin-name').click();
    const waitForPlaybackPeak = async ([min,max]) => {
      await readOutput();
      await page.waitForFunction(async ({min,max}) => {
        const output = await window.audioManager.request({type:'testReadOutput'},'testOutput');
        return output.frames > 0 && output.peak > min && output.peak < max &&
          window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying;
      },{min,max},{polling:100,timeout:5000});
    };
    const setVolume = async value => {
      await volumeValue.fill(String(value));
      await volumeValue.press('Tab');
    };
    const initialGain = [.055,.095], editedGain = [.013,.028], unityGain = [.13,.19];
    await waitForPlaybackPeak(initialGain);
    assert.equal(Number(await volumeValue.inputValue()),-6);
    await setVolume(-18);
    await waitForPlaybackPeak(editedGain);
    await page.locator('#undoButton').click();
    await waitForPlaybackPeak(initialGain);
    assert.equal(Number(await volumeValue.inputValue()),-6);
    await page.locator('#redoButton').click();
    await waitForPlaybackPeak(editedGain);
    assert.equal(Number(await volumeValue.inputValue()),-18);
    const effectToggle = volumeItem.locator('.toggle-button');
    await effectToggle.click();
    await waitForPlaybackPeak(unityGain);
    assert.ok(await effectToggle.evaluate(button => button.classList.contains('off')));
    await effectToggle.click();
    await waitForPlaybackPeak(editedGain);
    const masterToggle = page.locator('#pipeline .master-toggle');
    await masterToggle.click();
    await waitForPlaybackPeak(unityGain);
    await masterToggle.click();
    await waitForPlaybackPeak(editedGain);
    await setVolume(-6);
    await waitForPlaybackPeak(initialGain);

    const pipelineItems = page.locator('#pipelineList .pipeline-item');
    const oscillator = pipelineItems.filter({has:page.getByText('Oscillator',{exact:true})});
    await oscillator.locator('.delete-button').click();
    await oscillator.waitFor({state:'detached'});
    await volumeItem.locator('.routing-button').click();
    const routing = page.locator('.routing-dialog');
    const outputBus = routing.locator('select[data-routing-key="outputBus"]');
    await outputBus.selectOption('1');
    await waitForPlaybackPeak(unityGain);
    await outputBus.selectOption('0');
    await waitForPlaybackPeak(initialGain);
    await routing.locator('.routing-dialog-close').click();

    const meter = pipelineItems.filter({has:page.getByText('Level Meter',{exact:true})});
    if (await page.locator('#pluginList.collapsed').count()) await page.locator('#sidebarButton').click();
    await page.locator('#effectSearchButton').click();
    const effectSearch = page.locator('#effectSearchInput');
    await effectSearch.fill('Level Meter');
    await page.locator('#pluginList .plugin-item').filter({hasText:/^Level Meter/}).dblclick();
    await effectSearch.press('Escape');
    await meter.locator('canvas.meter-foreground').waitFor();
    const waitForMeter = ([min,max]) => page.waitForFunction(({min,max}) => {
      const plugin = window.audioManager.pipeline.find(item => item.constructor.name === 'LevelMeterPlugin');
      return plugin?.raw[0] > min && plugin.raw[0] < max;
    },{min,max},{timeout:5000});
    const meterAfterVolume = async () =>
      (await pipelineItems.locator('.plugin-name').allTextContents())[0] === 'Volume';
    if (!await meterAfterVolume()) await meter.locator('.move-down-button').click();
    await waitForMeter([-25,-20]);
    assert.deepEqual(await pipelineItems.locator('.plugin-name').allTextContents(),['Volume','Level Meter']);
    await meter.locator('.move-up-button').click();
    await waitForMeter([-19,-14]);
    assert.deepEqual(await pipelineItems.locator('.plugin-name').allTextContents(),['Level Meter','Volume']);
    await meter.locator('.delete-button').click();
    await meter.waitFor({state:'detached'});
    await waitForPlaybackPeak(initialGain);

    await page.locator('#pipelineMenuButton').click();
    await page.locator('#copyAToBButton').click();
    await page.waitForFunction(() => window.audioManager.currentPipeline === 'B');
    if (!await volumeValue.isVisible()) await volumeItem.locator('.plugin-name').click();
    await setVolume(-18);
    await waitForPlaybackPeak(editedGain);
    await page.locator('#pipelineToggleButton').click();
    await page.waitForFunction(() => window.audioManager.currentPipeline === 'A');
    await waitForPlaybackPeak(initialGain);
    await page.locator('#pipelineMenuButton').click();
    await page.locator('#doubleBlindTestButton').click();
    await page.locator('.dbt-count-input').fill('1');
    await page.locator('.dbt-start-abx').click();
    await page.waitForFunction(() => window.audioManager._parallelActive &&
      document.querySelector('.dbt-progress')?.textContent === 'Test 1 / 1');
    await page.locator('.dbt-switch-a').click();
    await waitForPlaybackPeak(initialGain);
    await page.locator('.dbt-switch-b').click();
    await waitForPlaybackPeak(editedGain);
    await page.locator('.dbt-switch-x').click();
    await page.waitForFunction(() => window.audioManager.outputTarget === 1);
    const xStart = await page.evaluate(() => window.audioManager.clock.pipelineFrame);
    await page.waitForFunction(frame => window.audioManager.clock.pipelineFrame > frame + 4800,xStart);
    const x = (await readOutput()).peak;
    const reference = x >= initialGain[0] && x <= initialGain[1] ? 'a' :
      x >= editedGain[0] && x <= editedGain[1] ? 'b' : null;
    assert.ok(reference,`Blind X must match one audible reference, got ${x}`);
    await page.locator(`.dbt-vote-${reference}`).click();
    await page.locator('.dbt-result-answers').filter({hasText:'Correct answers: 1 / 1'}).waitFor();
    await waitForPlaybackPeak(initialGain);

    await page.locator('.dbt-start-abx').click();
    await page.waitForFunction(() => window.audioManager._parallelActive &&
      document.querySelector('.dbt-progress')?.textContent === 'Test 1 / 1');
    // Submit the last answer during the sample-switch dip.
    await page.evaluate(() => {
      document.querySelector('.dbt-switch-x').click();
      document.querySelector('.dbt-vote-a').click();
    });
    await page.locator('.dbt-result-answers').filter({hasText:/Correct answers: [01] \/ 1/}).waitFor();
    await page.waitForFunction(() => window.audioManager.outputTarget === 1,null,{timeout:5000});
    await waitForPlaybackPeak(initialGain);

    await page.locator('.dbt-close-button').click();
    await page.locator('.dbt-close-button').waitFor({state:'detached'});
    await page.waitForFunction(() => !window.audioManager._parallelActive && window.audioManager.currentPipeline === 'A');
    await waitForPlaybackPeak(initialGain);

    await recover({unavailableOutputId:'null-out'},1,44100);
    await page.waitForFunction(() => window.audioManager.ioManager.currentOutputDeviceId === 'default' &&
      window.audioPreferences.outputDeviceId === 'default');
    assert.equal(await page.evaluate(() => window.audioManager.session.inputChannels),0);
    const saved = JSON.parse(await readFile(path.join(profile,'audio-preferences.json'),'utf8'));
    assert.equal(saved.outputDeviceId,'default');
    assert.equal(saved.audioDriver,driver);
    assert.ok(await page.evaluate(async () => {
      const m = window.audioManager;
      const b = window.pluginManager.createPlugin('Volume');
      b.vl = -12;
      m.pipelineB = [b];
      if (!await m.enableParallelPipelines('B')) return false;
      m.fadeOutOutput(0);
      const old = m.ready.map(capabilities => capabilities.endpointEpoch);
      const send = m.send;
      m.send = function (message) {
        send.call(this,message);
        if (message.type !== 'testDeviceReset') return;
        delete this.send;
        window.fixtureRetired = Promise.all([0,1].map(branch => {
          const requestId = 9000 + branch;
          const receipt = this.waitFor('endpointRetired',r => r.branch === branch && r.requestId === requestId);
          this.endpoints[branch].port.postMessage({type:'requestPowerObservation',requestId});
          return receipt;
        }));
      };
      window.fixtureOldBranch = old[1];
      return true;
    }));
    await resetDevice({outputChannels:2});
    await page.evaluate(async () => {
      const m = window.audioManager;
      await window.fixtureRetired;
      const retired = m.waitFor('endpointRetired',r => r.requestId === 9002);
      m.control.postMessage({type:'stopParallel',branch:1,endpointEpoch:window.fixtureOldBranch,requestId:9002});
      await retired;
    });
    assert.deepEqual(await page.evaluate(() => [window.audioManager._parallelActive,window.audioManager._parallelSelection]),[true,'B']);
    await readOutput();
    await new Promise(resolve => setTimeout(resolve,150));
    assert.equal((await readOutput()).peak,0,'The replacement output must retain the closed master gain');
    await page.evaluate(() => window.audioManager.fadeInOutput(0));
    await new Promise(resolve => setTimeout(resolve,150));
    const selected = await readOutput();
    assert.ok(selected.peak > .001 && selected.peak < .075,'The recreated blind branch must retain its attenuation');
    await page.evaluate(() => window.audioManager.disableParallelPipelines());
    // A real SMF with repeated note-on/off events makes both continued
    // transport position and future synthesis observable after a new Engine.
    const events = [];
    for (let i = 0; i < 100; ++i) events.push(0,0x90,60,110,72,0x80,60,0,24,0xb0,1,0);
    events.push(0,0xff,0x2f,0);
    const header = Buffer.from('4d546864000000060000000100604d54726b00000000','hex');
    header.writeUInt32BE(events.length,18);
    const score = path.join(profile,'reset-score.mid');
    await writeFile(score,Buffer.concat([header,Buffer.from(events)]));
    const tone = path.join(profile,'tone.sfz');
    await writeFile(tone,'<region> sample=*sine amp_veltrack=0 ampeg_release=.01');
    await chooseFile(tone);
    await page.evaluate(async () => {
      const m = window.audioManager;
      const sampler = window.pluginManager.createPlugin('SoundFont Player');
      m.updateCurrentPipeline([sampler]);
      await m.rebuildPipeline();
      await sampler._selectBank(async service => (await service.selectFiles())[0]);
      if (!sampler.getWasmAssets()?.get(0)) throw new Error('The test bank did not load: ' + sampler._error);
      const active = await m.waitForEffectiveActiveWasmAssets(sampler,[0],{primaryWorklet:m.workletNode});
      if (!active.ready) throw new Error('The instrument is unavailable');
      await window.uiManager.audioPlayer.stop();
    });
    await openTrack(score);
    await page.waitForFunction(() => window.uiManager.audioPlayer.contextManager.midiPlaying,null,{timeout:10000})
      .catch(async error => {
        const state = await page.evaluate(() => {
          const player = window.uiManager.audioPlayer;
          return {mode:player.stateManager.getStateSnapshot().playbackMode,
            state:player.contextManager.midiPreparation?.generation,failed:window.audioManager.failed,
            track:player.stateManager.getCurrentTrack()?.name,selected:player.contextManager.midiTimeline?.duration};
        });
        throw new Error(`MIDI playback failed ${JSON.stringify(state)}`,{cause:error});
      });
    await page.evaluate(() => window.uiManager.audioPlayer.playbackManager.setPlaybackSpeed(1.5));
    await page.waitForFunction(() => window.uiManager.audioPlayer.contextManager.getCurrentMidiTime() > 1);
    await page.locator('#visualizerButton').click();
    await page.evaluate(async () => {
      const {createDefaultLayout,createItem} = await import('./js/visualizer/visualizer-model.js');
      window.uiManager.visualizerView.setLayout({...createDefaultLayout(),items:[createItem('midi','score-mixer')]});
    });
    await page.waitForFunction(() => {
      const view = window.uiManager.visualizerView;
      const state = view.renderer.layers.get('score-mixer')?.display?.previousMixerState;
      const channel = state?.channels[0];
      const pitch = 60; // The fixture score repeats middle C on channel one.
      if (!window.uiManager.isEffectPipelineHidden() || window.audioManager.powerPolicyController.dspUiActivityAllowed ||
          !channel?.voices || !channel.levelPeak || !(channel.notes[pitch >> 3] & (1 << (pitch % 8)))) return false;
      if (!window.fixtureFirstMixerState) window.fixtureFirstMixerState = state;
      return state !== window.fixtureFirstMixerState;
    },null,{timeout:8000});
    await page.locator('#effectPipelineButton').click();
    const song = () => page.evaluate(() => {
      const player = window.uiManager.audioPlayer.contextManager;
      return {position:player.getCurrentMidiTime(),generation:player.midiGeneration,
        playing:player.midiPlaying,speed:player.midiSpeed};
    });
    const before = await song();
    await resetDevice({outputChannels:1});
    const after = await song();
    assert.ok(after.playing && after.generation > before.generation && after.position >= before.position);
    assert.equal(after.speed,1.5);
    await readOutput();
    await page.waitForFunction(position => window.uiManager.audioPlayer.contextManager.getCurrentMidiTime() > position + 1,
      after.position,{timeout:5000});
    assert.ok((await readOutput()).peak > .001,'Later MIDI notes must reach the actual output');

    // Reacquire a real capture stream and close only its route to DSP. The
    // replacement primary must keep the gate closed despite owning the device.
    await page.evaluate(() => window.electronIntegration.showAudioConfigDialog());
    await page.locator('#input-device').selectOption('null-in');
    await page.locator('#output-device').selectOption('null-out');
    const inputReload = page.waitForEvent('load',{timeout:30000});
    await page.locator('#apply-button').click();
    await inputReload;
    await page.waitForFunction(() => window.app?.initialized && window.audioManager.isDspReady());
    await page.evaluate(async () => {
      const m = window.audioManager;
      m.updateCurrentPipeline([]);
      await m.rebuildPipeline();
      await m.request({type:'testSetInput',level:.25},'testInputSet');
      m.connectSourceToPipeline(m.ioManager.deviceSource);
    });
    const loudCapture = async () => {
      await page.waitForFunction(async () => {
        const m = window.audioManager, sample = await m.request({type:'testReadOutput'},'testOutput');
        return sample.peak > .2;
      },null,{polling:100,timeout:5000});
    };
    await loudCapture();
    await page.evaluate(() => {
      const m = window.audioManager;
      m.disconnectSourceFromPipeline(m.ioManager.deviceSource);
      m.setNetworkOutputLocalDelay(false,0,false);
    });
    await new Promise(resolve => setTimeout(resolve,150));
    await readOutput();
    await resetDevice({unavailableOutputId:'null-out'});
    await new Promise(resolve => setTimeout(resolve,200));
    const closed = await readOutput();
    assert.ok(closed.frames > 0 && closed.peak === 0,'A captured microphone must remain inaudible while its route is closed');
    assert.equal(await application.evaluate(() => globalThis.fixtureAudioNetwork.nonSilent),0);
    await page.evaluate(() => window.audioManager.connectSourceToPipeline(window.audioManager.ioManager.deviceSource));
    await requireNetwork(0);
    assert.equal((await readOutput()).peak,0,'The restored local mute must silence capture while the network receives it');
    await page.evaluate(() => window.audioManager.setNetworkOutputLocalDelay(false,0,true));
    await loudCapture();
    await openTrack(track);
    await page.waitForFunction(() => window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying);
    await page.evaluate(() => window.audioManager.disconnectSourceFromPipeline(window.audioManager.ioManager.deviceSource));
    await resetDevice({deviceRate:44100,loseInput:true});
    await page.waitForFunction(() => window.audioManager.ioManager.getInputSnapshot().state === 'ended' &&
      window.audioManager.inputWarning === 'browser.deviceError');
    assert.equal(await page.evaluate(() => window.audioPreferences.inputDeviceId),'null-in');
    assert.deepEqual(await page.evaluate(() => {
      const m = window.audioManager;
      return [m.session.inputChannels,m.ioManager.inputRouteConnected,m.inputMixEnabled,m.failed];
    }),[0,false,false,false]);
    await readOutput();
    await page.waitForFunction(async () => {
      const sample = await window.audioManager.request({type:'testReadOutput'},'testOutput');
      return sample.peak > .001 && window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying;
    },null,{polling:100,timeout:5000});
    const flac = path.join(profile,'issue-72-32-bit-side.flac');
    await writeFile(flac,create32BitSideChannelFlac());
    await page.evaluate(async () => {
      const player = window.uiManager.audioPlayer;
      await player.stop();
      player.playbackManager.setPlaybackSpeed(1);
      await player.contextManager.applyGaplessPlaybackPreference(true);
      const file = window.audioManager.filePlayback;
      const send = file.send.bind(file);
      window.restoreFixtureFileSend = () => { file.send = send; };
      window.fixtureDecodedFile = {frames:0, mismatches:0};
      file.send = (type, entry, fields) => {
        if (type === 'feed') {
          const samples = new Float32Array(fields.attachment);
          for (let i = 0; i < fields.frames; ++i) {
            if (samples[i] !== .75 || samples[fields.frames + i] !== -.75) window.fixtureDecodedFile.mismatches++;
          }
          window.fixtureDecodedFile.frames += fields.frames;
        }
        return send(type,entry,fields);
      };
    });
    await openTrack(flac);
    await page.waitForFunction(() => window.fixtureDecodedFile.frames >= 8192 && window.audioManager.clock?.fileReadFrame > 0,
      null,{timeout:10000}).catch(async error => {
      throw new Error(`The 32-bit FLAC did not reach the native file port: ${errors.join('\n')}`,{cause:error});
    });
    assert.equal(await page.evaluate(() => window.fixtureDecodedFile.mismatches),0);

    const secondTrack = path.join(profile,'direct-next.wav');
    const secondSamples = new Float32Array(48003).fill(.45);
    const nextWave = new AudioEncoder().encodeWav({numberOfChannels:2,sampleRate:48000,length:secondSamples.length,
      getChannelData:() => secondSamples},'pcm16');
    await writeFile(secondTrack,new Uint8Array(await nextWave.arrayBuffer()));
    await page.evaluate(async () => {
      window.restoreFixtureFileSend();
      await window.uiManager.audioPlayer.stop();
      const m = window.audioManager;
      window.fixtureFileEnds = [];
      m.engineEvents.addEventListener('fileEnded',event => {
        const entry = m.filePlayback.current;
        window.fixtureFileEnds.push({ ...event.detail, totalFrames:entry?.transport.metadata.totalFrames,
          decoderEnded:entry?.transport.decoderEnded, failed:entry?.transport.failed });
      });
    });
    await openTrack([track,secondTrack]);
    await page.waitForFunction(() => window.audioManager.filePlayback.current?.sampleRate === 44100 &&
      window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying);
    const firstGeneration = await page.evaluate(() => window.audioManager.filePlayback.generation);
    await page.evaluate(() => window.uiManager.audioPlayer.contextManager.seek(56));
    await page.waitForFunction(generation => window.audioManager.filePlayback.generation > generation &&
      window.uiManager.audioPlayer.contextManager.rollingTransport?.currentTime > 55,firstGeneration);
    await page.waitForFunction(() => window.audioManager.clock?.fileQueuedFrames > 34000,null,{timeout:5000})
      .catch(async error => {
        const fileState = await page.evaluate(() => {
          const m = window.audioManager, player = window.uiManager.audioPlayer;
          const transport = player.contextManager.rollingTransport;
          return {clock:m.clock, transport:transport && {position:transport.currentTime, playing:transport.playing,
            decoderEnded:transport.decoderEnded, queued:transport.queue.length, received:transport.lastReceivedFrame,
            fill:transport.lastFillTarget, error:transport.failed}, current:player.stateManager.getCurrentTrack()?.name};
        });
        throw new Error(`Direct file lookahead did not fill: ${JSON.stringify(fileState)}\n${errors.join('\n')}`,{cause:error});
      });
    const beforeStall = await page.evaluate(() => {
      const m = window.audioManager;
      const state = {generation:m.filePlayback.generation,underruns:m.clock.fileUnderruns,gaps:m.clock.fileGaps};
      const end = performance.now() + 350;
      while (performance.now() < end) { /* Stall only the renderer. */ }
      return state;
    });
    await page.waitForFunction(() => window.uiManager.audioPlayer.stateManager.getCurrentTrack()?.name === 'direct-next.wav');
    const afterStall = await page.evaluate(() => {
      const m = window.audioManager;
      return {generation:m.filePlayback.generation,underruns:m.clock.fileUnderruns,gaps:m.clock.fileGaps};
    });
    assert.deepEqual(afterStall,beforeStall,'Seek, renderer stall, and rate-changing boundary should preserve queued file PCM');
    await page.waitForFunction(generation => window.fixtureFileEnds.some(event =>
      event.generation === generation && event.track === 2),afterStall.generation);
    const end = await page.evaluate(generation => window.fixtureFileEnds.find(event =>
      event.generation === generation && event.track === 2),afterStall.generation);
    assert.equal(end.totalFrames,48003);
    assert.equal(end.decoderEnded,true);
    assert.equal(end.failed,false);

    // DSD uses the file lane at normal speed and the renderer feed for speed
    // conversion. Returning to normal speed must reacquire the file lane.
    const sourceRate = 2822400;
    const dsdSamples = encodeDsdSignal(sourceRate * 5, sourceRate, time => .25 * Math.sin(2 * Math.PI * 440 * time));
    const dsd = path.join(profile,'direct-rebind.dsf');
    await writeFile(dsd,createDsfFixture({sampleRate:sourceRate,sampleCount:sourceRate * 5,
      channels:[dsdSamples,dsdSamples]}));
    await page.evaluate(() => window.uiManager.audioPlayer.stop());
    await openTrack(dsd);
    const dsdState = () => page.evaluate(() => {
      const m = window.audioManager, transport = window.uiManager.audioPlayer.contextManager.rollingTransport;
      return {generation:m.filePlayback.generation, direct:Boolean(transport?.nativeFile),
        speed:transport?.metadata.playbackSpeed, rate:transport?.metadata.sampleRate,
        nativeRate:m.filePlayback.current?.sampleRate, position:transport?.currentTime};
    });
    await page.waitForFunction(() => {
      const transport = window.uiManager.audioPlayer.contextManager.rollingTransport;
      return transport?.metadata?.codec === 'dsd' && transport.nativeFile && transport.currentTime > .4;
    },null,{timeout:10000});
    const dsdDirect = await dsdState();
    assert.equal(dsdDirect.speed,1);
    assert.equal(dsdDirect.nativeRate,dsdDirect.rate);
    assert.ok(dsdDirect.rate < sourceRate);
    await page.waitForFunction(async () =>
      (await window.audioManager.request({type:'testReadOutput'},'testOutput')).peak > .01,
    null,{polling:100,timeout:5000});
    await page.evaluate(() => window.uiManager.audioPlayer.playbackManager.setPlaybackSpeed(1.5));
    await page.waitForFunction(() => {
      const transport = window.uiManager.audioPlayer.contextManager.rollingTransport;
      return transport?.metadata?.playbackSpeed === 1.5 && !transport.nativeFile &&
        window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying;
    },null,{timeout:10000});
    const dsdFeed = await dsdState();
    assert.equal(dsdFeed.direct,false);
    assert.ok(dsdFeed.position >= dsdDirect.position - .15);
    await page.evaluate(() => window.uiManager.audioPlayer.playbackManager.setPlaybackSpeed(1));
    await page.waitForFunction(generation => {
      const m = window.audioManager, transport = window.uiManager.audioPlayer.contextManager.rollingTransport;
      return transport?.metadata?.playbackSpeed === 1 && transport.nativeFile &&
        m.filePlayback.generation > generation && m.clock?.fileReadFrame > 0 &&
        m.clock?.fileGeneration === m.filePlayback.generation;
    },dsdDirect.generation,{timeout:10000});
    const dsdRebound = await dsdState();
    assert.equal(dsdRebound.nativeRate,dsdRebound.rate);
    assert.ok(dsdRebound.position >= dsdFeed.position - .15);
    await changeDriver('standard');
    assert.equal(await page.evaluate(() => window.audioPreferences.audioDriver),'standard');
    assert.equal(await page.evaluate(() => window.audioPreferences.inputDeviceId),'default');
  } finally {
    try { await application?.close(); }
    finally { await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  }
});

test('Pipeline Analyzer measures a cold native pipeline with a WASM-only effect', {timeout:60000}, async t => {
  const names = Object.values(executableNames(process.platform,process.arch)).filter(Boolean);
  if (names.some(name => !existsSync(path.join(builtExecutableDirectory(),name)))) {
    if (process.env[requireExecutableEnv] === '1') assert.fail('Build the native audio driver before running this test');
    return t.skip('The native audio driver has not been built');
  }
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(),'effetune-native-analyzer-')));
  let application;
  try {
    const driver = process.platform === 'win32' ? 'wasapi' : 'miniaudio';
    await writeFile(path.join(profile,'config.json'),JSON.stringify({
      language:'en',onboardingTourShown:true,checkForUpdatesOnStartup:false
    }));
    await writeFile(path.join(profile,'audio-preferences.json'),JSON.stringify({
      audioDriver:driver,inputDeviceId:'__effetune_no_audio_input__',outputDeviceId:'default',sampleRate:48000,useWasmDsp:true
    }));
    await writeFile(path.join(profile,'pipeline-state.json'),JSON.stringify([
      {name:'Analog Meter',enabled:true,parameters:{}},{name:'Volume',enabled:true,parameters:{vl:-6}}
    ]));
    const main = fileURLToPath(new URL('../helpers/desktop-browser-electron-main.cjs',import.meta.url));
    application = await electron.launch({args:[main,`--user-data-dir=${profile}`],
      env:{...process.env,EFFETUNE_AUDIO_ENGINE_NULL:'1',EFFETUNE_BROWSER_TEST_NATIVE_INPUT:'0'}});
    const mainPage = win => win.url().includes('effetune.html');
    let page;
    for (let i = 0; i < 300 && !page; ++i) {
      page = application.windows().find(mainPage);
      if (!page) await new Promise(resolve => setTimeout(resolve,100));
    }
    assert.ok(page,'EffeTune main window must open');
    await page.waitForFunction(() => window.app?.initialized && window.audioManager?.isDspReady?.());
    assert.deepEqual(await page.evaluate(() => [window.audioPreferences.audioDriver,
      window.audioManager.dspModuleInfo,window.audioManager.getCurrentPipeline().map(p => p.name)]),
    [driver,null,['Analog Meter','Volume']]);
    const active = await page.evaluate(() => window.audioManager.getDspExecutionStateSnapshot()
      .states.filter(state => state.state === 'active').map(state => state.pluginType));
    assert.ok(active.includes('VolumePlugin'), 'The analyzer must recognize optional effects running in the native engine');
    await page.locator('#pipelineAnalyzerButton').click();
    await page.waitForFunction(() => window.uiManager.pipelineAnalyzerController?.lastAcceptedResult);
    const gainDb = await page.evaluate(() => {
      const {before,after} = window.uiManager.pipelineAnalyzerController.lastAcceptedRawResult;
      return after.spectrum.magnitudeDb[20] - before.spectrum.magnitudeDb[20];
    });
    assert.ok(Math.abs(gainDb + 6) < .1,`Measured gain was ${gainDb} dB`);
  } finally {
    try { await application?.close(); }
    finally { await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  }
});
