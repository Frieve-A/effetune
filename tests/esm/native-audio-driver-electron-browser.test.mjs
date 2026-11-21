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

test('Audio Configuration switches drivers, renders the player feed and remembers the standard devices', {
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
      ready:window.audioManager?.isDspReady?.(),sink:window.audioManager?.audioContext?.sinkId?.type
    }));
    assert.equal(state.driver,driver,errors.join('\n'));
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
        return {canceled:false,filePaths:[file]};
      };
    },file);
    const openTrack = async file => {
      await chooseFile(file);
      await page.evaluate(async () => {
        const {openMusicFile} = await import('./js/electron/presetIntegration.js');
        await openMusicFile(true);
      });
    };
    await openTrack(track);
    await page.waitForFunction(() => window.uiManager.audioPlayer?.stateManager.getStateSnapshot().isPlaying &&
      window.audioManager.clock?.feedDelayFrames > 0);
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
    assert.deepEqual(await page.evaluate(() => {
      const m = window.audioManager;
      return [m.session.inputChannels,m.ioManager.inputRouteConnected,m.inputMixEnabled,m.failed];
    }),[0,false,false,false]);
    await readOutput();
    await page.waitForFunction(async () => {
      const sample = await window.audioManager.request({type:'testReadOutput'},'testOutput');
      return sample.peak > .001 && window.uiManager.audioPlayer.stateManager.getStateSnapshot().isPlaying;
    },null,{polling:100,timeout:5000});
    await changeDriver('standard');
    assert.equal(await page.evaluate(() => window.audioPreferences.audioDriver),'standard');
    assert.equal(await page.evaluate(() => window.audioPreferences.inputDeviceId),'__effetune_no_audio_input__');
  } finally {
    try { await application?.close(); }
    finally { await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  }
});
