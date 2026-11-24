import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import engineProtocol from '../../electron/audio-engine-protocol.cjs';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { packLiveMidi } from '../../js/native/instrument-transport.js';
import { EnginePort } from '../../js/native/engine-endpoint.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { builtExecutableDirectory, executableNames, requireExecutableEnv, withAudioEngine } from '../../tools/audio-engine-session.mjs';
import { createSfzEffectsAsset } from '../helpers/sfz-effects-asset-fixture.mjs';
import { materializeAcceptanceAsset } from '../helpers/sfz-native-acceptance.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';

async function loadInstrument(session, type, name = 'Dry', revision = 1,
  { streamed = name === 'Paged', minimumPhysicalBpm } = {}) {
  const packer = DSP_PARAM_PACKERS.get(type);
  const params = packer.pack({});
  const descriptor = Buffer.alloc(20);
  descriptor.writeUInt32LE(1, 0);
  descriptor.writeUInt32LE(1, 4);
  descriptor.writeUInt32LE(7, 8);
  descriptor[12] = descriptor[16] = 1;
  descriptor[15] = 254;
  await session.send({ type: 'configurePipeline', descriptorOffset: params.byteLength, descriptorBytes: 20,
    plugins: [{ id: 7, type, sf: 'test.sfz', layoutHash: packer.hash, paramsOffset: 0, paramsCount: params.length }] },
  Buffer.concat([Buffer.from(params.buffer, params.byteOffset, params.byteLength), descriptor]));
  await session.receive('pipelineApplied');
  const binding = await instantiateDspBinding(readFileSync(new URL('../../plugins/dsp/effetune-dsp.simd.wasm', import.meta.url)));
  const { payload, processingChannels, footprintBytes, headBlock, rateDivider, formatTag } =
    await materializeAcceptanceAsset(binding, await createSfzEffectsAsset(name, streamed),
      { playerKind: type, minimumPhysicalBpm });
  await session.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, operationRevision: revision,
    processingChannels, footprintBytes, headBlock, rateDivider, formatTag,
    preparationContext:{minimumPhysicalBpm} }, Buffer.from(payload));
  const {message} = await session.receive('assetState');
  assert.equal(message.state & 255, streamed ? 2 : 3);
}
async function render(session, frames = 128) {
  await session.send({ type: 'renderNull', frames }, Buffer.alloc(frames * 2 * 4));
  const {attachment} = await session.receive('nullOutput');
  return Array.from({length:frames*2}, (_, i) => attachment.readFloatLE(i*4));
}

// Native MIDI preparation completes on the render thread, as in the worklet. Its notice
// follows the output of the completing block, so it is read with the next block.
async function renderUntilPrepared(session, generation, frames = 128) {
  let rendered = 0;
  for (let prepared = false; !prepared; rendered += frames) {
    assert.ok(rendered < 64 * frames, `MIDI generation ${generation} did not prepare`);
    await session.send({ type: 'renderNull', frames }, Buffer.alloc(frames * 2 * 4));
    for (let frame = await session.readFrame(); frame?.message?.type !== 'nullOutput'; frame = await session.readFrame()) {
      assert.ok(frame, 'The audio engine exited while preparing MIDI.');
      if (frame.message?.type === 'midiPrepared' && frame.message.generation === generation) prepared = true;
    }
  }
  return rendered;
}

async function publishResidentPage(session, generation, pcm) {
  await session.send({type:'sfzPublishPage',requestId:1,pluginId:7,generation,operationRevision:1,
    page:{generation,sample:0,pageIndex:0,frames:4096,channels:1,resident:true}},Buffer.from(pcm.buffer));
  assert.equal((await session.receive('sfzStreamPagesPublished')).message.ok,true);
  await session.receive('assetState', m => (m.state & 255) === 3);
}

async function pollPages(session, generation, pcm) {
  await session.send({type:'sfzPollPages',pluginId:7,generation,requestId:3});
  const {message:{readiness}} = await session.receive('sfzStreamReadiness');
  const {message:reply} = await session.receive('sfzStreamRequests');
  assert.equal(reply.ok,true);
  for (const page of reply.requests) {
    await session.send({type:'sfzPublishPage',requestId:4,pluginId:7,generation,operationRevision:1,
      page:{...page,frames:4096,channels:1}},Buffer.from(pcm.buffer));
    assert.equal((await session.receive('sfzStreamPagesPublished')).message.ok,true);
  }
  return readiness.scope > 0 && !readiness.pendingPages;
}

for (const name of Object.values(executableNames(process.platform, process.arch)).filter(Boolean)) {
  test(`${name} preserves the Standard release tail after the last MIDI event`, async t => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      assert.notEqual(process.env[requireExecutableEnv],'1','Build the native audio engine first');
      return t.skip('Build the native audio engine first.');
    }
    const type = 'SoundFontPlayerPlugin', duration = 321.4 / 48000;
    const transport = {type:'midiTransport',generation:1,preparing:true,position:0,
      timeline:{duration,events:[{seconds:0,status:0x90,data1:60,data2:127},
        {seconds:duration,status:0x80,data1:60,data2:0}]}};
    const worklet = await createNativeSamplerWorklet({variant:'simd'});
    try {
      await worklet.initialize(type,await createSfzEffectsAsset('DelayedRelease'));
      await worklet.waitFor(() => worklet.processor.transition.phase === 'open');
      await worklet.send(transport);
      await worklet.waitFor(() => worklet.messages.some(m => m.type === 'midiPrepared'));
      await worklet.send({type:'midiStart',generation:1,anchorFrame:worklet.frame});
      await withAudioEngine(executable,['--backend','null'],async session => {
        await session.receive('hello');
        await session.send({type:'hello',version:1});
        await session.send({type:'openSession',sampleRate:48000,outputChannels:2,periodFrames:128});
        await session.receive('sessionState',m => m.state === 'open');
        await loadInstrument(session,type,'DelayedRelease');
        await session.send(transport);
        const startFrame = await renderUntilPrepared(session,1);
        await session.send({type:'midiStart',generation:1,delayFrames:0});
        let peak = 0;
        for (let block = 0; block < 20; ++block) {
          if (block === 3) {
            assert.ok(worklet.messages.some(m => m.type === 'midiEnded' && m.generation === 1));
            const final = await session.receive('midiPosition',m => m.generation === 1 && m.position === duration);
            assert.equal(final.message.processedFrame,startFrame + 384,'The quantum containing the last event has rendered');
            await session.receive('midiEnded',m => m.generation === 1);
            const drain = {type:'midiTransport',mode:'drain',generation:2,position:0,
              playing:false,preserveRelease:true};
            await worklet.send(drain);
            await session.send(drain);
          }
          const expected = worklet.render()[0], actual = await render(session);
          for (let i = 0; i < 128; ++i) {
            peak = Math.max(peak,Math.abs(expected[i]));
            assert.ok(Math.abs(actual[i]-expected[i]) < 1e-5,`Tail differs at frame ${block * 128 + i}`);
          }
        }
        assert.ok(peak > .001,'The reference release sample must sound after EOF');
        assert.equal((await session.finish()).code,0);
      });
    } finally { await worklet.close(); }
  });
  test(`${name} resumes first and already configured live SoundFont inputs from idle`, async t => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      assert.notEqual(process.env[requireExecutableEnv], '1', 'Build the native audio engine first');
      return t.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend','null'], async session => {
      await session.receive('hello');
      await session.send({type:'hello',version:1});
      await session.send({type:'openSession',sampleRate:48000,outputChannels:2,periodFrames:128});
      await session.receive('sessionState',state => state.state === 'open');
      await loadInstrument(session,'SoundFontPlayerPlugin');
      const identity = {workletGraphGeneration:1,topologyRevision:1};
      await session.send({type:'configurePowerPolicy',...identity,enabled:true,enabledPluginCount:1,
        temporalSkipEligible:true,monitoringPreparationCapabilities:[{pluginId:7,capability:'reset-on-resume'}]});
      await session.receive('powerStateAck');
      const capture = async () => {
        await session.send({type:'sfzCaptureCheckpoints',reason:'power',requestId:1});
        return (await session.receive('sfzCheckpoints')).message;
      };
      const note = async status => {
        await session.send({type:'midiInputEvents',generation:1,requestId:3,
          events:[{frame:0,status,data1:60,data2:100,targets:[{id:7,token:1}]}]});
      };
      for (const epoch of [1,2]) {
        const checkpoint = await capture();
        assert.equal(checkpoint.ok,true,`Idle checkpoint failed in cycle ${epoch}`);
        assert.equal(checkpoint.checkpoints.length,1);
        const commandId = epoch * 2;
        await session.send({type:'setPowerProcessingState',...identity,processingDirective:'force-monitoring',
          commandId,skipEpoch:epoch});
        assert.equal((await session.receive('powerStateAck')).message.commandAccepted,true);
        if (epoch === 1) {
          await session.send({type:'midiInputConfigure',generation:1,enabled:true});
          await session.send({type:'midiInputState',pluginId:7,token:1,generation:1,events:[]});
        }
        await session.send({type:'prepareTemporalStateAndResume',...identity,origin:'deliberate',
          commandId,skipEpoch:epoch,resumeCommandId:commandId + 1,ackCommandId:commandId + 10});
        assert.equal((await session.receive('temporalStateResumed')).message.state,'acknowledged');
        if (epoch === 1) await note(0x90);
        else {
          // A full event packet leaves no spare kernel slot for the resume marker.
          const targets = [{id:7,token:1}];
          const events = Array.from({length:4096},() => ({frame:0,status:0xb0,data1:10,data2:64,targets}));
          events[4095] = {frame:0,status:0x90,data1:60,data2:100,targets};
          let serial = 0;
          const {attachment,...message} = packLiveMidi({type:'midiInputEvents',generation:1,requestId:3,events},
            () => ++serial,frame => frame);
          await session.send(message,Buffer.from(attachment));
        }
        const playing = await render(session,1024);
        assert.ok(playing.some(sample => Math.abs(sample) > .001),`No note after idle cycle ${epoch}`);
        assert.equal((await capture()).ok,false,'A held note cannot be checkpointed for idle');
        await note(0x80);
        await render(session,8192);
      }
      assert.equal((await session.finish()).code,0);
    });
  });
  test(`${name} reopens the output after SFZ timing exceeds its reserved latency`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend', 'null'], async session => {
      await session.receive('hello');
      await session.send({ type: 'hello', version: 1 });
      await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2, periodFrames: 128 });
      await session.receive('sessionState', state => state.state === 'open');
      const type = 'SFZNotePlayerPlugin';
      await loadInstrument(session, type);
      const packer = DSP_PARAM_PACKERS.get(type);
      const setTiming = async tm => {
        const params = packer.pack({ tm, dm: 100, wm: 0 });
        await session.send({ type: 'updateParameters', id: 7, pluginType: type,
          layoutHash: packer.hash, paramsCount: params.length }, Buffer.from(params.buffer));
      };
      const dry = async frames => {
        const input = new Float32Array(frames * 2).fill(.125);
        await session.send({ type: 'renderNull', frames }, Buffer.from(input.buffer));
        return (await session.receive('nullOutput')).attachment;
      };
      const latency = async () => {
        await session.send({ type: 'requestDspLatency' });
        return (await session.receive('dspLatencyResponse')).message.samples;
      };
      await setTiming(0);
      assert.equal((await dry(8192)).readFloatLE(8191 * 4), .125);
      assert.equal(await latency(), 4320);
      await setTiming(-50);
      const closing = await dry(1024);
      assert.equal(closing.readFloatLE(1023 * 4), 0);
      const reopening = await dry(8192);
      assert.equal(await latency(), 6720);
      assert.ok(reopening.subarray(0, 6720 * 4).every(byte => byte === 0),
        'The output stays silent while the new delay fills.');
      assert.equal(reopening.readFloatLE(8191 * 4), .125);
      await session.send({ type: 'closeSession' });
      await session.receive('sessionState', state => state.state === 'closed');
      assert.equal((await session.finish()).code, 0);
    });
  });
  test(`${name} matches the worklet's Visual Sync routes and downstream tap latency`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend', 'null'], async session => {
      await session.receive('hello');
      await session.send({ type: 'hello', version: 1 });
      await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2, periodFrames: 128 });
      await session.receive('sessionState', state => state.state === 'open');
      await loadInstrument(session, 'SFZNotePlayerPlugin');
      // Telemetry is stamped with the route revision, so each Visual Sync change must publish it.
      await session.send({ type: 'setVisualSync', enabled: true });
      const enabled = (await session.receive('networkRoute')).message;
      await session.send({ type: 'setVisualSync', enabled: false });
      const disabled = (await session.receive('networkRoute')).message;
      assert.ok(disabled.revision > enabled.revision);
      const { samples, taps } = (await session.receive('dspLatency')).message;
      assert.ok(samples > 0);
      assert.deepEqual([taps['7'].input, taps['7'].output], [samples, 0]);
      assert.equal((await session.finish()).code, 0);
    });
  });
  test(`${name} supplies SoundFont mixer telemetry to the Visualizer while Effects are hidden`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      assert.notEqual(process.env[requireExecutableEnv], '1', 'Build the native audio engine first');
      return context.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend', 'null'], async session => {
      await session.receive('hello');
      await session.send({type:'hello', version:1});
      await session.send({type:'openSession', sampleRate:48000, outputChannels:2});
      await session.receive('sessionState', state => state.state === 'open');
      await loadInstrument(session, 'SoundFontPlayerPlugin');
      await render(session);
      const {message} = await session.receive('sfzRuntimeIdentity', id => id.token === 1);
      await session.send({type:'configurePowerPolicy', enabled:true, uiTelemetryEnabled:false, displayDspBypassed:true});
      const subscribers = new Set();
      let rate;
      const port = new EnginePort({_soundFontMidiMeteringPlugins:subscribers, send:m => { rate = m; }},0);
      for (const enabled of [false,true,false]) {
        if (enabled) subscribers.add(7);
        else subscribers.clear();
        port.postMessage({type:'dspSetTelemetryRate',hz:60});
        await session.send(rate);
        await session.send({type:'soundFontMidiMetering', pluginId:7, instanceEpoch:message.instanceEpoch, enabled});
        await render(session, 4096);
        await session.send({type:'requestDspLatency'});
        let frames = 0;
        for (;;) {
          const packet = await session.readFrame();
          assert.ok(packet);
          if (packet.message.type === 'dspLatencyResponse') break;
          if (packet.kind === engineProtocol.kinds.telemetry)
            parseTelemetryPacket(packet.attachment, packet.message.bytes, frame => {
              if (frame.tapId === 7 && frame.frameType === TelemetryFrameType.TAP_SOUNDFONT_MIXER) ++frames;
            });
        }
        assert.equal(frames > 0, enabled);
      }
      assert.equal((await session.finish()).code, 0);
    });
  });
  test(`${name} joins a new and replaced SoundFont to the playing song without replaying old notes`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend','null'], async session => {
      await session.receive('hello');
      await session.send({type:'hello',version:1});
      await session.send({type:'openSession',sampleRate:48000,outputChannels:2});
      await session.receive('sessionState', m => m.state === 'open');
      const note = frame => ({seconds:frame/48000,status:0x90,data1:60,data2:127});
      const volume = (frame,value) => ({seconds:frame/48000,status:0xb0,data1:7,data2:value});
      await session.send({type:'midiTransport',generation:1,position:0,preparing:true,
        timeline:{duration:1,events:[note(0),volume(128,0),note(1024),
          volume(2048,127),note(2048),note(4096)]}});
      await renderUntilPrepared(session,1);
      await session.send({type:'midiStart',generation:1,delayFrames:0});
      await render(session,512);
      await loadInstrument(session,'SoundFontPlayerPlugin');
      const peak = async frames => Math.max(...(await render(session,frames)).map(Math.abs));
      assert.equal(await peak(1536),0,'The new instrument inherits the preceding zero channel volume.');
      assert.ok(await peak(512) > .001,'The next note reaches the new bank.');
      await loadInstrument(session,'SoundFontPlayerPlugin','Dry',2);
      assert.equal(await peak(1536),0,'The replacement does not reattack the note already playing.');
      assert.ok(await peak(512) > .001,'Later notes reach the replacement.');
      await session.send({type:'closeSession'});
      await session.receive('sessionState',m => m.state === 'closed');
      assert.equal((await session.finish()).code,0);
    });
  });
  test(`${name} keeps an unrelated real-time track continuous through SoundFont mixer edits`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend', 'null'], async session => {
      await session.receive('hello');
      await session.send({ type: 'hello', version: 1 });
      await session.send({ type: 'openSession', sampleRate: 44100, outputChannels: 2 });
      await session.receive('sessionState', message => message.state === 'open');
      await loadInstrument(session, 'SoundFontPlayerPlugin');
      await session.send({ type: 'midiTransport', generation: 1, position: 0, preparing: true,
        timeline: { duration: 2, events: [{ seconds: 0, status: 0x90, data1: 60, data2: 127 }] } });
      const frames = 49152;
      const pcm = Buffer.alloc(2 * frames * Float32Array.BYTES_PER_ELEMENT);
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = .08 + frame * .00001;
        pcm.writeFloatLE(sample, frame * 4);
        pcm.writeFloatLE(sample, (frame + frames) * 4);
      }
      const { kinds, encodeFrame } = engineProtocol;
      await session.write(encodeFrame(kinds.feed, { type: 'feed', generation: 1,
        sourceFrame: 0, frames, channelCount: 2 }, pcm));
      await session.send({ type: 'setNetworkOutputPort', attached: true });
      await session.send({ type: 'startStream' });
      await session.receive('sessionState', message => message.state === 'running');
      const actions = [
        { type: 'mute', value: true }, { type: 'control', controller: 7, value: 75 },
        { type: 'program', bank: 0, program: 0 }, { type: 'control', controller: 10, value: 80 },
        { type: 'mute', value: false },
      ];
      let packets = 0, completed = 0, afterEdits = 0, previousSample;
      while (completed < actions.length || afterEdits < 3) {
        const frame = await session.readFrame();
        assert.ok(frame, 'The session must keep producing PCM and mixer receipts.');
        if (frame.kind === kinds.network) {
          const { sourceEpoch, sourceFrame } = frame.message;
          await session.send({ type: 'pcm-ack', sourceEpoch, sourceFrame });
          packets += 1;
          // Warm the sustained voice and the feed resampler before comparing successive PCM samples.
          if (packets < 3) continue;
          for (let at = 0; at < frame.attachment.length; at += 4) {
            const sample = frame.attachment.readInt16LE(at);
            assert.ok(sample > 100, 'An unaffected track must remain audible.');
            if (previousSample !== undefined) assert.ok(Math.abs(sample - previousSample) < 40,
              `Unrelated PCM skipped at packet ${packets}, frame ${at / 4}: ${previousSample} to ${sample}`);
            previousSample = sample;
          }
          if (packets === 3) {
            for (const [index, action] of actions.entries()) {
              await session.send({ type: 'soundFontMixerAction', pluginId: 7, token: 1,
                requestId: index + 1, action: { ...action, channel: 1 } });
            }
          } else if (completed === actions.length) afterEdits += 1;
        } else if (frame.message.type === 'midiPrepared') {
          // The running stream completes MIDI preparation on its render thread.
          await session.send({ type: 'midiStart', generation: 1, delayFrames: 0 });
        } else if (frame.message.type === 'soundFontMixerActionApplied') {
          assert.equal(frame.message.ok, true);
          assert.deepEqual(frame.message.checkpoints, []);
          completed += 1;
        }
      }
      await session.send({ type: 'stopStream' });
      await session.receive('sessionState', message => message.state === 'stopped');
      await session.send({ type: 'closeSession' });
      await session.receive('sessionState', message => message.state === 'closed');
      assert.equal((await session.finish()).code, 0);
    }, { env: { ...process.env, EFFETUNE_AUDIO_ENGINE_NULL: '1' } });
  });

  test(`${name} matches the worklet across a tempo-boundary seek and speed change`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    const position = .076;
    const timeline = {
      duration: 1,
      events: [{ seconds: position, status: 0x90, data1: 60, data2: 127 }],
      tempoMap: [{ seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 },
        { seconds: .08, quarter: .16, microsecondsPerQuarter: 1000000 }],
      timeSignatures: [{ seconds: 0, quarter: 0, numerator: 4, denominator: 4 }],
    };
    const worklet = await createNativeSamplerWorklet({ variant: 'simd' });
    try {
      await worklet.initialize('SoundFontPlayerPlugin', await createSfzEffectsAsset('Sync'));
      await worklet.waitFor(() => worklet.processor.transition.phase === 'open');
      const transport = { type: 'midiTransport', timeline, generation: 1, position,
        anchorFrame: 0, speed: 1, gain: 1, playing: false, preparing: true };
      await worklet.send(transport);
      await worklet.waitFor(() => worklet.messages.some(message => message.type === 'midiPrepared'));
      await worklet.send({ type: 'midiStart', generation: 1, anchorFrame: worklet.frame });
      await withAudioEngine(executable, ['--backend', 'null'], async session => {
        await session.receive('hello');
        await session.send({ type: 'hello', version: 1 });
        await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2, periodFrames: 128 });
        await session.receive('sessionState', message => message.state === 'open');
        await loadInstrument(session, 'SoundFontPlayerPlugin', 'Sync');
        await session.send(transport);
        await renderUntilPrepared(session, 1);
        await session.send({ type: 'midiStart', generation: 1, delayFrames: 0 });
        let peak = 0, referenceBeforeSpeed;
        for (let block = 0; block < 5; block += 1) {
          if (block === 1) {
            const change = { type: 'midiSpeed', speed: 2 };
            await session.send(change);
            await worklet.send(change);
          }
          const expected = worklet.render()[0];
          const actual = await render(session);
          if (block === 0) {
            const entry = worklet.processor.wasmInstances.get(7);
            referenceBeforeSpeed = worklet.binding.instanceMidiClock(entry.id).frame;
          }
          for (let frame = 0; frame < expected.length; frame += 1) {
            peak = Math.max(peak, Math.abs(expected[frame]));
            assert.ok(Math.abs(actual[frame] - expected[frame]) < 1e-5,
              `tempo or clock mismatch at sample ${block * 128 + frame}: ${actual[frame]} versus ${expected[frame]}`);
          }
        }
        assert.ok(peak > .001, 'The beat-synchronized instrument must produce audible signal.');
        const pause = { type: 'midiPause', generation: 2, delayFrames: 64 };
        await worklet.send(pause);
        worklet.render();
        await session.send(pause);
        await render(session);
        await session.receive('midiPauseReady');
        await worklet.send({ type: 'midiCaptureCheckpoint', generation: 2 });
        await session.send({ type: 'midiCaptureCheckpoint', generation: 2 });
        const { message } = await session.receive('midiCheckpoints');
        const reference = worklet.messages.find(item => item.type === 'midiCheckpoints');
        const nativeBeforeSpeed = Math.round(position * 48000) + 128;
        assert.equal(message.checkpoints[0].clockFrame - nativeBeforeSpeed,
          reference.checkpoints[0].clockFrame - referenceBeforeSpeed);
        await session.send({ type: 'closeSession' });
        await session.receive('sessionState', state => state.state === 'closed');
        assert.equal((await session.finish()).code, 0);
      });
    } finally {
      await worklet.close();
    }
  });

  test(`${name} matches the worklet fades across MIDI transport changes`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    const timeline = { duration: 1, events: [{ seconds: 0, status: 0x90, data1: 60, data2: 127 },
      { seconds: .9, status: 0x80, data1: 60, data2: 0 }] };
    const worklet = await createNativeSamplerWorklet({ variant: 'simd' });
    try {
      await worklet.initialize('SoundFontPlayerPlugin', await createSfzEffectsAsset('Dry'));
      await worklet.waitFor(() => worklet.processor.transition.phase === 'open');
      await withAudioEngine(executable, ['--backend', 'null'], async session => {
        await session.receive('hello');
        await session.send({ type: 'hello', version: 1 });
        await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2, periodFrames: 128 });
        await session.receive('sessionState', message => message.state === 'open');
        await loadInstrument(session, 'SoundFontPlayerPlugin', 'Dry');
        const both = async message => { await worklet.send(message); await session.send(message); };
        // Keep protocol messages that arrive before a rendered block for later assertions.
        const seen = [];
        const step = async () => {
          await session.send({ type: 'renderNull', frames: 128 }, Buffer.alloc(128 * 2 * 4));
          for (let frame = await session.readFrame(); frame; frame = await session.readFrame()) {
            if (frame.message?.type === 'nullOutput')
              return Array.from({ length: 128 }, (_, i) => frame.attachment.readFloatLE(i * 4));
            seen.push(frame);
          }
          assert.fail('The audio engine exited while rendering.');
        };
        const take = async (type, generation) => {
          const index = seen.findIndex(frame => frame.message?.type === type && frame.message.generation === generation);
          return index < 0 ? session.receive(type, message => message.generation === generation) : seen.splice(index, 1)[0];
        };
        const compare = async (blocks, label) => {
          for (let block = 0; block < blocks; block += 1) {
            const expected = worklet.render()[0], actual = await step();
            for (let frame = 0; frame < expected.length; frame += 1)
              assert.ok(Math.abs(actual[frame] - expected[frame]) < 1e-5,
                `${label} differs at block ${block} frame ${frame}: ${actual[frame]} versus ${expected[frame]}`);
          }
        };
        const play = async (label, transport, checkpoints) => {
          const { generation } = transport;
          await worklet.send(checkpoints ? { ...transport, checkpoints: checkpoints.worklet } : transport);
          await session.send(checkpoints ? { ...transport, checkpoints: checkpoints.native.message.checkpoints } : transport,
            checkpoints?.native.attachment);
          // Both sides prepare on their render threads; keep them in lockstep until both report.
          const prepared = items => items.some(message => message?.type === 'midiPrepared' &&
            message.generation === generation);
          for (let block = 0; !prepared(seen.map(frame => frame.message)) || !prepared(worklet.messages); block += 1) {
            assert.ok(block < 8, `${label} preparation did not finish`);
            await compare(1, `${label} preparation ${block}`);
          }
          await take('midiPrepared', generation);
          await worklet.send({ type: 'midiStart', generation, anchorFrame: worklet.frame });
          await session.send({ type: 'midiStart', generation, delayFrames: 0 });
          await compare(4, `${label} playback`);
        };
        const transport = (generation, position, mode) => ({ type: 'midiTransport', timeline, generation, position,
          speed: 1, gain: 1, playing: false, preparing: true, mode });
        await play('start', transport(1, 0, 'reset'));
        await play('seek', transport(2, .5, 'reset'));
        await both({ type: 'midiPause', generation: 3, delayFrames: 64 });
        await compare(3, 'pause');
        const paused = await take('midiPauseReady', 3);
        await both({ type: 'midiCaptureCheckpoint', generation: 3 });
        const native = await take('midiCheckpoints', 3);
        const reference = worklet.messages.find(message => message.type === 'midiCheckpoints');
        assert.ok(Math.abs(paused.message.position - reference.position) < 1e-9);
        await play('resume', transport(4, reference.position, 'resume'), { worklet: reference.checkpoints, native });
        await both({ type: 'midiSpeed', speed: 2 });
        await compare(3, 'speed');
        // A seek that replaces instrument context first stops the old transport without a timeline.
        await both({ type: 'midiTransport', generation: 5, position: .55, speed: 2, gain: 1,
          playing: false, mode: 'pause' });
        await compare(2, 'replay pause');
        await play('replayed seek', transport(6, .2, 'reset'));
        await session.send({ type: 'closeSession' });
        await session.receive('sessionState', state => state.state === 'closed');
        assert.equal((await session.finish()).code, 0);
      });
    } finally {
      await worklet.close();
    }
  });

  test(`${name} publishes a streamed SFZ bank after its resident onset page`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    await withAudioEngine(executable, ['--backend','null'], async session => {
      await session.receive('hello');
      await session.send({type:'hello',version:1});
      await session.send({type:'openSession',sampleRate:48000,outputChannels:2,periodFrames:128});
      await session.receive('sessionState', m => m.state === 'open');
      await loadInstrument(session,'SFZNotePlayerPlugin','Paged');
      const {message:{generation}} = await session.receive('sfzStreamReady');
      const packer = DSP_PARAM_PACKERS.get('SFZNotePlayerPlugin');
      const params = packer.pack({dm:100,wm:0});
      await session.send({type:'updateParameters',id:7,pluginType:'SFZNotePlayerPlugin',
        layoutHash:packer.hash,paramsCount:params.length},Buffer.from(params.buffer));
      const pcm = new Float32Array(4096).fill(.25);
      await publishResidentPage(session,generation,pcm);
      await session.send({type:'sfzStartRuntime',requestId:2,pluginId:7,token:1});
      assert.equal((await session.receive('sfzRuntimeStarted')).message.ok,true);
      let ready = false;
      for (let attempt = 0; attempt < 12 && !ready; attempt++) {
        ready = await pollPages(session,generation,pcm);
        await render(session);
      }
      assert.ok(ready,'the forecast must admit sample pages');
      const dry = new Float32Array(8192 * 2).fill(.125);
      await session.send({type:'renderNull',frames:8192},Buffer.from(dry.buffer));
      const {attachment} = await session.receive('nullOutput');
      assert.ok(Math.abs(attachment.readFloatLE(attachment.length-4) - .125) < .00001,
        'Publishing resident pages must preserve the dry/wet edit.');
      await session.send({type:'closeSession'});
      await session.receive('sessionState', m => m.state === 'closed');
      assert.equal((await session.finish()).code,0);
    });
  });
  test(`${name} preserves the song tempo map when a streamed SoundFont becomes playable`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      if (process.env[requireExecutableEnv] === '1') assert.fail(`Missing native audio engine: ${executable}`);
      return context.skip('Build the native audio engine first.');
    }
    const song = {type:'midiTransport',generation:1,playing:true,position:0,timeline:{
      duration:2,events:[{seconds:.05,status:0x90,data1:60,data2:127}],
      tempoMap:[{seconds:0,quarter:0,microsecondsPerQuarter:1000000}],
      timeSignatures:[{seconds:0,quarter:0,numerator:4,denominator:4}]}};
    const play = setMapWhileLoading => withAudioEngine(executable,['--backend','null'],async session => {
      await session.receive('hello');
      await session.send({type:'hello',version:1});
      await session.send({type:'openSession',sampleRate:48000,outputChannels:2,periodFrames:128});
      await session.receive('sessionState', m => m.state === 'open');
      await loadInstrument(session,'SoundFontPlayerPlugin','Sync',1,{streamed:true,minimumPhysicalBpm:15});
      const {message:{generation}} = await session.receive('sfzStreamReady');
      const pcm = new Float32Array(4096).fill(.25);
      if (setMapWhileLoading) await session.send(song);
      await publishResidentPage(session,generation,pcm);
      if (!setMapWhileLoading) await session.send(song);
      for (let block = 0; block < 8; ++block) {
        await render(session);
        await pollPages(session,generation,pcm);
      }
      const result = await render(session,4096);
      await session.send({type:'closeSession'});
      await session.receive('sessionState', m => m.state === 'closed');
      assert.equal((await session.finish()).code,0);
      return result;
    });
    const expected = await play(false);
    assert.ok(expected.some(sample => Math.abs(sample) > .001));
    const actual = await play(true);
    assert.ok(actual.some(sample => Math.abs(sample) > .001));
    assert.ok(actual.every((sample, i) => Math.abs(sample - expected[i]) < .00001),
      'Beat-synchronized delay must use the same tempo when the map arrives before the onset page.');
  });
  test(`${name} plays and checkpoints a real sample bank`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      const message = `Build the native audio engine first: ${executable}`;
      if (process.env[requireExecutableEnv] === '1') assert.fail(message);
      return context.skip(message);
    }
    await withAudioEngine(executable, ['--backend','null'], async session => {
      await session.receive('hello');
      await session.send({type:'hello',version:1});
      await session.send({type:'openSession',sampleRate:48000,outputChannels:2,periodFrames:128});
      await session.receive('sessionState', m => m.state === 'open');
      await loadInstrument(session,'SoundFontPlayerPlugin');
      const event = Buffer.alloc(24);
      event.writeUInt32LE(0x90,8);
      event.writeUInt32LE(60,12);
      event.writeUInt32LE(127,16);
      await session.send({type:'midiTransport',generation:1,preparing:true,position:0,speed:1,gain:1,
        timeline:{duration:1,eventsOffset:0,eventsCount:1,tempoCount:0,meterCount:0}},event);
      await renderUntilPrepared(session,1);
      await session.send({type:'midiStart',generation:1,delayFrames:0});
      const pcm = await render(session, 512);
      assert.ok(pcm.some(v => Math.abs(v) > .001),'a scheduled note must reach the output');
      await session.send({type:'midiPause',generation:2,delayFrames:64});
      await render(session);
      const paused = await session.receive('midiPauseReady');
      assert.equal(paused.message.generation,2);
      await session.send({type:'midiCaptureCheckpoint',generation:2});
      const captured = await session.receive('midiCheckpoints');
      const [r] = captured.message.checkpoints;
      assert.equal(r.pluginId,7);
      assert.equal(r.sf,'test.sfz');
      assert.equal(r.cursor,1);
      assert.equal(r.byteLength,captured.attachment.length);
      assert.ok(r.byteLength>0);
      await session.send({ type: 'soundFontMixerAction', requestId: 10, pluginId: 7, token: 1,
        action: { type: 'control', channel: 0, controller: 7, value: 92 } });
      const mixerCheckpoint = await session.receive('soundFontMixerActionApplied', m => m.requestId === 10);
      assert.equal(mixerCheckpoint.message.ok, true);
      assert.equal(mixerCheckpoint.message.checkpoints[0].clockFrame, r.clockFrame);
      assert.notDeepEqual(mixerCheckpoint.attachment, captured.attachment);
      await session.send({type:'midiTransport',generation:3,mode:'resume',position:paused.message.position,
        preparing:true,checkpoints:mixerCheckpoint.message.checkpoints},mixerCheckpoint.attachment);
      await renderUntilPrepared(session,3);
      await session.send({type:'midiStart',generation:3,delayFrames:0});
      assert.ok((await render(session,256)).some(v => Math.abs(v)>.001));
      const plugin = {id:7,type:'SoundFontPlayerPlugin',enabled:true,parameters:{sf:'test.sfz',mco:0}};
      const writes = [];
      const endpoint = new EnginePort({audioContext:{sampleRate:48000},getOutputChannelCount:() => 2,
        preferences:{},pipeline:[plugin],_buildBlindPluginData:items => items,
        send:({attachment,...wire}) => writes.push(session.send(wire,Buffer.from(attachment)))},0);
      endpoint.configure();
      await Promise.all(writes.splice(0));
      await session.receive('pipelineApplied');
      for (const change of [{sf:'renamed.sfz'},{mco:4}]) {
        Object.assign(plugin.parameters,change);
        endpoint.postMessage({type:'updatePlugin',plugin});
        await Promise.all(writes.splice(0));
        await session.receive('pipelineApplied');
      }
      await session.send({type:'midiPause',generation:4,delayFrames:0});
      await render(session);
      await session.receive('midiPauseReady');
      await session.send({type:'midiCaptureCheckpoint',generation:4});
      const updated = await session.receive('midiCheckpoints');
      const [record] = updated.message.checkpoints;
      assert.equal(record.sf,'renamed.sfz');
      assert.equal(record.channel,4);
      await session.send({type:'midiTransport',generation:5,mode:'resume',preparing:true,checkpoints:[record]},updated.attachment);
      await renderUntilPrepared(session,5);
      await session.send({type:'midiInputConfigure',generation:6,enabled:true});
      const sendLive = async message => {
        let serial = 0;
        const {attachment,...wire} = packLiveMidi(message,() => ++serial,frame => frame);
        await session.send(wire,Buffer.from(attachment));
      };
      await sendLive({type:'midiInputState',generation:6,pluginId:7,token:1,events:[
        {status:0,data1:0,data2:0,flags:8192,noteId:1}
      ]});
      const targets = [{id:7,token:1},{id:9,token:3}];
      const events = Array.from({length:4096},() => ({status:0xb0,data1:10,data2:64,frame:896,targets}));
      events[0] = {status:0x90,data1:60,data2:127,frame:896,targets};
      await sendLive({type:'midiInputEvents',generation:6,requestId:11,events});
      assert.ok((await render(session,256)).some(v => Math.abs(v)>.001));
      const ack = await session.receive('midiInputAccepted',m => m.requestId===11);
      assert.equal(ack.message.accepted,true);
      // A rejected map must still stop the held input note, and must not acknowledge Play.
      await session.send({type:'midiTransport',generation:7,preparing:true,timeline:{
        duration:1,events:[],tempoMap:[{seconds:1,quarter:0,microsecondsPerQuarter:500000}],
        timeSignatures:[{seconds:1,quarter:0,numerator:4,denominator:4}]}});
      await session.receive('midiTransportError',m => m.generation === 7);
      await render(session,1024);
      assert.ok((await render(session)).every(v => Math.abs(v) < .00001));
      await session.send({type:'closeSession'});
      await session.receive('sessionState',m=>m.state==='closed');
      assert.equal((await session.finish()).code,0);
    });
  });
}
