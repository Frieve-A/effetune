import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {createMultisampleSf2,createSf2Fixture} from '../helpers/sf2-fixture.mjs';
import {launchNativeAudioFixture} from '../helpers/native-audio-electron.mjs';

function soundFont() {
  const sampleFrames = 131072;
  const pcm16 = Int16Array.from({length:sampleFrames},(_,i) => Math.round(25000 * Math.sin(2 * Math.PI * i / 64)));
  return createSf2Fixture({sampleFrames,pcm16,keyRange:[36,96],sampleRate:48000,
    loopStart:65536,loopEnd:sampleFrames - 64,sm24:false});
}

async function selectSoundFont(fixture,holdImport = false,bytes = soundFont()) {
  const {application,page,profile} = fixture;
  const bank = path.join(profile,'held-notes.sf2');
  await writeFile(bank,bytes);
  await chooseFile(application,bank);
  await page.evaluate(async hold => {
    const m = window.audioManager;
    const sampler = window.pluginManager.createPlugin('SoundFont Player');
    m.updateCurrentPipeline([sampler]);
    await m.rebuildPipeline();
    if (hold) {
      const load = sampler._loadBank;
      sampler._loadBank = async function (...args) {
        await new Promise(resolve => { window.releaseImport = resolve; });
        return load.apply(this,args);
      };
    }
    window.bankPublished = (async () => {
      await sampler._selectBank(async service => (await service.selectFiles())[0]);
      if (!sampler.getWasmAssets()?.get(0)) throw new Error('SoundFont bank was not loaded: ' + sampler._error);
      const active = await m.waitForEffectiveActiveWasmAssets(sampler,[0],{primaryWorklet:m.workletNode});
      if (!active.ready) throw new Error('The SoundFont was not ready');
    })();
    if (!hold) await window.bankPublished;
  },holdImport);
  if (holdImport) await page.waitForFunction(() => typeof window.releaseImport === 'function');
}

async function chooseFile(application,file) {
  await application.evaluate(({dialog},file) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return {canceled:false,filePaths:Array.isArray(file) ? file : [file]};
    };
  },file);
}

// 120 BPM, 96 ticks per quarter. The first note spans several streamed sample pages.
function heldNotesMidi() {
  const events = Buffer.from([
    0,0x90,60,110, 0x82,0x20,0x80,60,0, // 1.5 seconds
    48,0x90,67,110, 96,0x80,67,0,       // 1.75 to 2.25 seconds
    48,0x90,60,110, 96,0x80,60,0,       // 2.5 to 3.0 seconds
    0x82,0x20,0xff,0x2f,0
  ]);
  const header = Buffer.from('4d546864000000060000000100604d54726b00000000','hex');
  header.writeUInt32BE(events.length,18);
  return Buffer.concat([header,events]);
}

async function delayInitialScoreForecast(page) {
  await page.evaluate(async () => {
    const m = window.audioManager;
    const send = m.send;
    m.send = function (message) {
      if (message.type === 'midiTransport' && message.preparing && !window.fileForecastDelay) {
        window.fileForecastDelay = {held:null,started:false,waiting:true};
        setTimeout(() => {
          window.fileForecastDelay.waiting = false;
          if (window.fileForecastDelay.held) send.call(m,window.fileForecastDelay.held);
        },500);
      }
      if (message.type === 'sfzPollPages' && window.fileForecastDelay?.waiting) {
        window.fileForecastDelay.held = message;
        return;
      }
      if (message.type === 'midiStart') {
        window.fileNoteStart = performance.now();
        if (window.fileForecastDelay) window.fileForecastDelay.started = window.fileForecastDelay.waiting;
      }
      return send.call(this,message);
    };
  });
}

test('a cold SF2 bank plays the first file note and streams every sustained note', {timeout:75000}, async t => {
  const fixture = await launchNativeAudioFixture(t);
  if (!fixture) return;
  const {page,application,profile} = fixture;
  const score = path.join(profile,'held-notes.mid');
  await writeFile(score,heldNotesMidi());
  await page.evaluate(async () => {
    await window.uiManager.createAudioPlayer([],false);
    await window.uiManager.audioPlayer.contextManager.applyGaplessPlaybackPreference(false);
  });
  await selectSoundFont(fixture,true);
  await chooseFile(application,score);
  await delayInitialScoreForecast(page);
  await page.evaluate(async () => {
    const {openMusicFile} = await import('./js/electron/presetIntegration.js');
    void openMusicFile(true);
  });
  await page.waitForFunction(() => !!window.uiManager.audioPlayer.contextManager.midiTimeline);
  await new Promise(resolve => setTimeout(resolve,500));
  const advanced = await page.evaluate(() => {
    const started = Number.isFinite(window.fileNoteStart);
    window.releaseImport();
    return started;
  });
  assert.equal(advanced,false,'The first note must wait while the selected SoundFont is loading');
  await page.evaluate(() => window.bankPublished);
  await page.waitForFunction(() => Number.isFinite(window.fileNoteStart),null,{timeout:12000});
  const samples = await page.evaluate(async () => {
    const m = window.audioManager, readings = [];
    while (performance.now() - window.fileNoteStart < 3180) {
      const {peak,frames} = await m.request({type:'testReadOutput'},'testOutput');
      if (frames) readings.push([Math.round(performance.now() - window.fileNoteStart),peak]);
      await new Promise(resolve => setTimeout(resolve,12));
    }
    return readings;
  });
  const onset = samples.find(([,peak]) => peak > .001)?.[0];
  const forecast = await page.evaluate(() => ({
    polled:!!window.fileForecastDelay?.held,started:window.fileForecastDelay?.started
  }));
  assert.deepEqual(forecast,{polled:true,started:false},'The transport must prepare the new score before starting its clock');
  assert.ok(Number.isFinite(onset) && onset < 150,`First SF2 note onset was ${onset} ms`);
  for (const [begin,end] of [[100,1450],[1850,2220],[2600,2970]]) {
    const audible = samples.filter(([time]) => time >= begin && time <= end);
    assert.ok(audible.length >= 5,`No sustained sampling in ${begin}–${end} ms`);
    assert.deepEqual(audible.filter(([,peak]) => peak < .001),[],`Unexpected silence within ${begin}–${end} ms`);
  }
  for (const [begin,end] of [[1600,1730],[2360,2480]]) {
    assert.ok(samples.some(([time,peak]) => time >= begin && time <= end && peak < .001),
      `No note release observed between ${begin} and ${end} ms`);
  }
  // Reattack a held note when seeking midway through the streamed sample.
  await page.evaluate(() => window.uiManager.audioPlayer.contextManager.seekMidi(.75));
  await waitForOutput(page,.001);
  await page.evaluate(() => window.uiManager.audioPlayer.contextManager.seekMidi(1.55));
  await waitForOutput(page,0,.001);
  await waitForOutput(page,.001);
});

async function waitForOutput(page, minimum, maximum = 2) {
  await page.waitForFunction(async ([lower,upper]) => {
    const sample = await window.audioManager.request({type:'testReadOutput'},'testOutput');
    return sample.frames > 0 && sample.peak >= lower && sample.peak <= upper;
  },[minimum,maximum],{polling:80,timeout:8000});
}

async function suspendSilentAudio(fixture) {
  const {page} = fixture;
  await page.evaluate(() => {
    const policy = window.audioManager.powerPolicyController;
    void policy.updateSettings({...policy.settings,mode:'maximum',fullSuspendDelaySeconds:60});
  });
  await fixture.application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w =>
    w.webContents.getURL().includes('effetune.html')).hide());
  await page.waitForFunction(() => {
    const policy = window.audioManager.powerPolicyController;
    return Number.isFinite(policy.hiddenSinceEpochMs) && Number.isFinite(policy.routedInputSilentSinceEpochMs) &&
      Number.isFinite(policy.routedOutputSilentSinceEpochMs);
  },null,{polling:100,timeout:8000});
  await page.evaluate(() => {
    const policy = window.audioManager.powerPolicyController;
    policy.hiddenSinceEpochMs -= 61000;
    policy.routedInputSilentSinceEpochMs -= 61000;
    policy.routedOutputSilentSinceEpochMs -= 61000;
    void policy.requestReconcile('deadline');
  });
  await page.waitForFunction(() => window.audioManager.audioContext.state === 'suspended' &&
    window.audioManager.powerPolicyController.getSnapshot().effectiveState === 'SUSPENDED',null,{polling:100,timeout:8000});
}

test('a ready SoundFont wakes for a new score and Stop silences its pedalled note', {timeout:65000}, async t => {
  const fixture = await launchNativeAudioFixture(t);
  if (!fixture) return;
  const {page,profile,application} = fixture;
  const score = path.join(profile,'program-change.mid');
  const nextScore = path.join(profile,'second-program-change.mid');
  // Explicit tick-zero tempo and meter, a different preset and a held sustain pedal.
  const meta = [0,0xff,0x51,3,7,0xa1,0x20, 0,0xff,0x58,4,4,2,24,8];
  const midi = heldNotesMidi();
  const bytes = Buffer.concat([midi.subarray(0,22),Buffer.from([...meta,0,0xc0,1,0,0xb0,64,127]),midi.subarray(22)]);
  bytes.writeUInt32BE(bytes.length - 22,18);
  await Promise.all([writeFile(score,bytes),writeFile(nextScore,bytes)]);
  await selectSoundFont(fixture,false,createMultisampleSf2([48,60],131072,{separatePrograms:true}));
  await page.waitForFunction(() => {
    const m = window.audioManager, info = m.getNativeMixerMetadata(m.pipeline[0]);
    return info?.streamReadiness?.scope === 2 && info.cacheReady;
  },null,{polling:50,timeout:10000});
  await suspendSilentAudio(fixture);
  await delayInitialScoreForecast(page);
  await chooseFile(application,[score,nextScore]);
  await page.evaluate(async () => {
    const {openMusicFile} = await import('./js/electron/presetIntegration.js');
    void openMusicFile(true);
  });
  await page.waitForFunction(() => Number.isFinite(window.fileNoteStart),null,{polling:20,timeout:15000});
  const opening = await page.evaluate(async () => {
    const m = window.audioManager, peaks = [];
    while (performance.now() - window.fileNoteStart < 900) {
      const {peak,frames} = await m.request({type:'testReadOutput'},'testOutput');
      if (frames) peaks.push([performance.now()-window.fileNoteStart,peak]);
      await new Promise(resolve => setTimeout(resolve,12));
    }
    return {peaks,pollHeld:!!window.fileForecastDelay.held,startedEarly:window.fileForecastDelay.started};
  });
  assert.ok(opening.pollHeld && !opening.startedEarly,'The new preset needs its own ready sample forecast');
  assert.ok(opening.peaks.find(([,peak]) => peak > .001)?.[0] < 150,'Opening note must sound on time');
  assert.ok(opening.peaks.filter(([time]) => time >= 100).every(([,peak]) => peak > .001));
  await page.locator('.stop-button').evaluate(button => button.click());
  await page.waitForFunction(() => window.uiManager.audioPlayer.stateManager.getStateSnapshot().isStopped);
  await waitForOutput(page,0,.0001);
  await waitForOutput(page,0,.0001);
  await page.locator('.play-pause-button').evaluate(button => button.click());
  await waitForOutput(page,.001);
  await page.waitForFunction(() => {
    const state = window.uiManager.audioPlayer.stateManager.getStateSnapshot();
    return state.currentTrackIndex === 1 && state.isPlaying && state.currentTrack.name === 'second-program-change.mid';
  },null,{polling:50,timeout:18000});
  await page.evaluate(() => window.audioManager.request({type:'testReadOutput'},'testOutput'));
  await waitForOutput(page,.001);
});

test('Browser capture, AirPlay and mid-pipeline network PCM reach the native output', {timeout:70000}, async t => {
  const fixture = await launchNativeAudioFixture(t);
  if (!fixture) return;
  const {application,page} = fixture;
  await page.evaluate(async () => {
    const m = window.audioManager;
    const {BrowserInputController} = await import('./js/audio/browser-input-controller.js');
    const context = m.audioContext;
    const input = context.createMediaStreamDestination();
    const tone = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = .4;
    tone.connect(gain).connect(input);
    tone.start();
    const browser = new BrowserInputController(m,{
      onState:() => () => {},prepareCapture:() => ({generation:1}),setCaptureState:async () => ({ok:true})
    });
    // Supply the OS capture boundary with a real Chromium stereo stream.
    const displayMedia = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = async () => input.stream;
    try {
      if (!await browser.select()) throw new Error('Browser capture did not start');
    } finally { navigator.mediaDevices.getDisplayMedia = displayMedia; }
    window.stopBrowserSource = async () => { await browser.release(); tone.stop(); };
  });
  await waitForOutput(page,.25,.43);
  await page.evaluate(async () => {
    const m = window.audioManager;
    m.updateCurrentPipeline(['Live Audio Send','Mute'].map(name => window.pluginManager.createPlugin(name)));
    await m.rebuildPipeline();
    m.setNetworkOutputLocalDelay(true,0,true);
  });
  await waitForOutput(page,0,0);
  const before = await application.evaluate(() => globalThis.fixtureAudioNetwork.nonSilent);
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 50; i++) {
      const network = await application.evaluate(() => globalThis.fixtureAudioNetwork);
      if (network.nonSilent > before + 2 && network.acknowledged > 0) return;
      await new Promise(resolve => setTimeout(resolve,60));
    }
    throw new Error('The pre-mute Live Audio Send marker did not send Browser samples');
  });
  await page.evaluate(() => window.stopBrowserSource());
  await page.evaluate(async () => {
    const m = window.audioManager;
    m.setNetworkOutputLocalDelay(false,0,true);
    m.updateCurrentPipeline([]);
    await m.rebuildPipeline();
  });
  await waitForOutput(page,0,0);

  await page.evaluate(async () => {
    const p = await window.uiManager.createAudioPlayer([],false);
    p.airPlayPlayback.dispose();
    const {AirPlayPlayback} = await import('./js/ui/audio-player/airplay-playback.js');
    const air = p.airPlayPlayback = new AirPlayPlayback(p,{bridge:null});
    const channel = new MessageChannel();
    air.attachPort(channel.port1);
    window.airplaySender = channel.port2;
    const generation = 8;
    channel.port2.postMessage({type:'start',sampleRate:44100,channelCount:2,generation});
    // The receiver accepts planar Float32 PCM in credited slabs.
    for (let block = 0; block < 17; block++) {
      const planes = Array.from({length:2}, () => new Float32Array(4096).fill(.375).buffer);
      channel.port2.postMessage({type:'pcm',generation,startFrame:block * 4096,frameCount:4096,planes},planes);
    }
  });
  await page.waitForFunction(() => window.uiManager.audioPlayer.airPlayPlayback.active,null,{timeout:5000})
    .catch(async error => {
      const details = await page.evaluate(() => {
        const a = window.uiManager.audioPlayer.airPlayPlayback;
        return [a.generation,!!a.node,a.committing,window.audioManager.audioContext.state];
      });
      throw new Error('AirPlay did not activate: ' + JSON.stringify(details),{cause:error});
    });
  await waitForOutput(page,.35,.42);
  await page.evaluate(() => window.airplaySender.postMessage({type:'end',generation:8}));
  await page.waitForFunction(() => !window.uiManager.audioPlayer.airPlayPlayback.active);
  await waitForOutput(page,0,0);

  await page.evaluate(async () => {
    const m = window.audioManager, p = window.uiManager.audioPlayer;
    const plugin = name => window.pluginManager.createPlugin(name);
    const prefix = plugin('Mute'), receive = plugin('Live Audio Receive'), volume = plugin('Volume');
    volume.setVl(-6);
    m.updateCurrentPipeline([prefix,receive,volume]);
    await m.rebuildPipeline();
    const adapter = p.activateOpenHomePlaybackAdapter();
    const entry = {id:7,sourceKey:'openhome:7',liveSessionId:'fixture-session',playbackUrl:'https://fixture.invalid/live'};
    adapter.queue = [entry];
    p.stateManager.updateState({currentTrack:{sourceKey:entry.sourceKey,meta:{openHomeQueueEntry:entry}}},'Select network stream');
    const pcm = new Int16Array(2 * 44100).fill(16384);
    const body = new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(pcm.buffer)); }});
    adapter.networkLive.fetchStream = async () => new Response(body,{headers:{
      'Content-Type':'application/vnd.effetune.live-pcm-v1','X-EffeTune-Live-Connection':'fixture-connection'
    }});
    if (!await adapter.playClassifiedLive()) throw new Error('Network receive route was not adopted');
    if (m.networkRoute?.receiveId !== receive.id) throw new Error('Receive marker did not own the route: ' +
      JSON.stringify({expected:receive.id,route:m.networkRoute,session:m._networkReceiveSession,
        track:p.stateManager.getStateSnapshot().currentTrack?.sourceKey,
        queue:adapter.queue.map(item => item.id),mode:p.stateManager.getStateSnapshot().playbackMode}));
  });
  // Input is 0.5. The receive marker must bypass Mute and retain the -6 dB suffix.
  await waitForOutput(page,.24,.28);
  const network = await application.evaluate(() => globalThis.fixtureAudioNetwork);
  assert.ok(network.nonSilent > 0 && network.acknowledged > 0,'The native send path must deliver PCM and receive credit');
});

test('the first live MIDI note after native idle suspension produces audio', {timeout:65000}, async t => {
  const fixture = await launchNativeAudioFixture(t);
  if (!fixture) return;
  const {page} = fixture;
  await selectSoundFont(fixture);
  await page.evaluate(async () => {
    const m = window.audioManager;
    const {BrowserMidiSource} = await import('./js/browser/browser-midi-source.js');
    const midi = new BrowserMidiSource(m);
    window.sendLiveNote = status => midi.receive({events:[{data:[status,60,100],delay:0}]});
    window.noteAcknowledgements = [];
    m.workletNode.port.addEventListener('message',({data}) => {
      if (data.type === 'midiInputAccepted') window.noteAcknowledgements.push(data.accepted);
    });
  });
  await suspendSilentAudio(fixture);
  await page.evaluate(async () => {
    await window.audioManager.request({type:'testReadOutput'},'testOutput');
    window.sendLiveNote(0x90);
  });
  await page.waitForFunction(() => window.audioManager.audioContext.state === 'running' &&
    window.audioManager.powerPolicyController.getSnapshot().effectiveState === 'ACTIVE',null,{polling:50,timeout:6000});
  await waitForOutput(page,.005);
  await waitForOutput(page,.005);
  await page.evaluate(() => window.sendLiveNote(0x80));
  await waitForOutput(page,0,.0001);
  await page.waitForFunction(() => window.noteAcknowledgements.length === 2,null,{polling:25,timeout:2000});
  assert.deepEqual(await page.evaluate(() => window.noteAcknowledgements),[true,true]);
});
