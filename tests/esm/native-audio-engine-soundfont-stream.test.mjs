import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { packInstrumentMessage } from '../../js/native/instrument-transport.js';
import { prepareSoundFontBank } from '../../js/sf2/asset.js';
import { openSf2Source } from '../../js/sf2/source.js';
import { sfzSampleCacheFootprint } from '../../js/sfz/asset.js';
import { samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { builtExecutableDirectory, executableNames, requireExecutableEnv, withAudioEngine } from '../../tools/audio-engine-session.mjs';
import { createMultisampleSf2 } from '../helpers/sf2-fixture.mjs';
import { createSampleWorkerPool } from '../helpers/sf2-runtime-fixture.mjs';

const rate = 48000;
const keys = Array.from({length:12}, (_, i) => 48 + i);
const framesPerSample = 98304;
const block = 1024;

function chordScore() {
  // Real SMFs often explicitly set tempo and meter at the parser's default tick zero.
  const events = [0, 255, 81, 3, 7, 161, 32, 0, 255, 88, 4, 4, 2, 24, 8];
  // Chords change every half second. Four pedal tones continue across the changes.
  // The opening rest lasts exactly as long as the normal 1.5-second forecast.
  for (const [i,pitch] of keys.slice(0, 4).entries())
    events.push(...(i === 0 ? [0x82, 0x20] : [0]), 0x90, pitch, 96);
  for (let chord = 0; chord < 8; ++chord) {
    const pitches = keys.slice(4 + chord % 2 * 4, 8 + chord % 2 * 4);
    for (const pitch of pitches) events.push(0, 0x91, pitch, 90);
    pitches.forEach((pitch, index) => events.push(index === 0 ? 96 : 0, 0x81, pitch, 0));
  }
  for (const pitch of keys.slice(0, 4)) events.push(0, 0x80, pitch, 0);
  events.push(0, 255, 47, 0);
  const header = Buffer.from('4d546864000000060000000100604d54726b00000000','hex');
  header.writeUInt32BE(events.length, 18);
  return parseSmf(Buffer.concat([header, Buffer.from(events)]));
}

async function play(executable, asset, song, {resident = false, loadScoreFirst = false}) {
  return withAudioEngine(executable, ['--backend','null'], async session => {
    await session.receive('hello');
    await session.send({type:'hello',version:1});
    await session.send({type:'openSession',sampleRate:rate,outputChannels:2,periodFrames:128});
    await session.receive('sessionState', state => state.state === 'open');
    const type = 'SoundFontPlayerPlugin', packer = DSP_PARAM_PACKERS.get(type);
    const params = packer.pack({pl:64,pm:-1});
    const descriptor = Buffer.alloc(20);
    descriptor.writeUInt32LE(1,0); descriptor.writeUInt32LE(1,4); descriptor.writeUInt32LE(7,8);
    descriptor[12] = descriptor[16] = 1;
    descriptor[15] = 254;
    await session.send({type:'configurePipeline',descriptorOffset:params.byteLength,descriptorBytes:20,
      plugins:[{id:7,type,sf:'chords.sf2',layoutHash:packer.hash,paramsOffset:0,paramsCount:params.length}]},
    Buffer.concat([Buffer.from(params.buffer), descriptor]));
    await session.receive('pipelineApplied');
    const transport = {type:'midiTransport',generation:1,position:0,preparing:true,
      timeline:{duration:song.duration,events:song.events,tempoMap:song.tempoMap,timeSignatures:song.timeSignatures}};
    const {attachment:timelineBytes,...wire} = resident ? transport : packInstrumentMessage(transport);
    const timelineAttachment = timelineBytes && Buffer.from(timelineBytes);
    // A score can already be loaded when the selected bank finishes preparing.
    if (loadScoreFirst) await session.send({...wire,preparing:false},timelineAttachment);
    const {processingChannels,footprintBytes,headBlock,rateDivider,formatTag,preparationContext} = asset;
    await session.send({type:'setPluginAsset',pluginId:7,slot:0,operationRevision:1,processingChannels,
      footprintBytes,headBlock,rateDivider,formatTag,preparationContext},Buffer.from(asset.payload));
    let stream;
    do {
      stream = await session.readFrame();
      assert.ok(stream,'The native sidecar closed before publishing the SoundFont stream');
      assert.notEqual(stream.message.type,'assetLoadRejected',`SoundFont load failed: ${stream.message.reason}`);
    } while (stream.message.type !== 'sfzStreamReady');
    const {generation} = stream.message;
    let decoded = [];
    const provider = await asset.sampleProviderFactory({generation,publish:page => { decoded.push(page); return true; }});
    try {
      const publish = async () => {
        for (const {pcm,...page} of decoded) {
          await session.send({type:'sfzPublishPage',pluginId:7,operationRevision:1,generation,requestId:1,page},
            Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength));
          assert.equal((await session.receive('sfzStreamPagesPublished')).message.ok,true);
        }
        decoded = [];
      };
      if (resident) {
        for (const [sample,metadata] of provider.samples.entries()) {
          await provider.preload(Array.from({length:Math.ceil(metadata.frames / 4096)},(_,pageIndex) => ({sample,pageIndex})));
          await publish();
        }
      }
      const poll = async () => {
        await session.send({type:'sfzPollPages',pluginId:7,generation,requestId:2});
        const {message:{readiness,limited}} = await session.receive('sfzStreamReadiness');
        const {message:{requests,ok}} = await session.receive('sfzStreamRequests');
        assert.equal(ok,true);
        await provider.requestPages(requests);
        return {readiness,limited};
      };
      await session.send(wire,timelineAttachment);
      let prepared;
      for (let attempt = 0; attempt < 24; ++attempt) {
        prepared = await poll();
        await publish();
        if (prepared.readiness.scope === 1 && prepared.readiness.readyAheadFrames > 0 && !prepared.readiness.pendingPages) break;
      }
      assert.equal(prepared.readiness.scope,1);
      assert.equal(prepared.readiness.generation,1);
      assert.ok(prepared.readiness.plannedPages > 0,'Play must admit the first chord after the opening rest');
      assert.equal(prepared.readiness.pendingPages,0);
      assert.ok(prepared.readiness.readyAheadFrames > 0);
      if (!resident) {
        assert.equal(prepared.limited,true);
        assert.equal(prepared.readiness.admittedFrames,rate / 4);
      }
      // The seek history is restored over successive blocks before the score reports prepared.
      let ready = false;
      for (let quantum = 0; !ready && quantum < 8; ++quantum) {
        await session.send({type:'renderNull',frames:128},Buffer.alloc(128 * 8));
        let message;
        do message = (await session.readFrame()).message;
        while (message?.type !== 'nullOutput' && !(message?.type === 'midiPrepared' && message.generation === 1));
        ready = message.type === 'midiPrepared';
      }
      assert.ok(ready,'The admitted score must report prepared while the device renders');
      const waiting = await poll();
      assert.equal(waiting.readiness.scope,1,'The prepared score must remain admitted until Play starts');
      await session.send({type:'midiStart',generation:1,delayFrames:0});
      const output = [], requestedSamples = new Set();
      let latePages = 0;
      for (let frame = 0; frame < rate * song.duration; frame += block) {
        // Supply pages one render period after collecting them (21.3ms).
        await publish();
        await poll();
        for (const page of decoded) { requestedSamples.add(page.sample); latePages++; }
        const frames = Math.min(block, rate * song.duration - frame);
        await session.send({type:'renderNull',frames},Buffer.alloc(frames * 2 * 4));
        const {attachment} = await session.receive('nullOutput');
        output.push(attachment);
      }
      await session.send({type:'closeSession'});
      await session.receive('sessionState', state => state.state === 'closed');
      assert.equal((await session.finish()).code,0);
      return {output:Buffer.concat(output),latePages,requestedSamples};
    } finally { provider.close(); }
  });
}

for (const name of Object.values(executableNames(process.platform,process.arch)).filter(Boolean))
  test(`${name} streams overlapping SF2 key zones throughout a polyphonic MIDI score`, async t => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      assert.notEqual(process.env[requireExecutableEnv],'1','Build the native audio engine first');
      return t.skip('Build the native audio engine first.');
    }
    const bytes = createMultisampleSf2(keys, framesPerSample);
    const source = await openSf2Source({size:bytes.length,revision:'chords',readRange:async (offset,length) =>
      new Uint8Array(bytes.subarray(offset,offset + length))});
    assert.equal(source.samples.length,keys.length);
    const song = chordScore();
    assert.equal(song.duration,5.5);
    const workers = createSampleWorkerPool();
    try {
      const binding = await instantiateDspBinding(readFileSync(new URL('../../plugins/dsp/effetune-dsp.simd.wasm',import.meta.url)));
      const estimate = (payload,context,formatTag) => {
        const {control,payloadBytes} = samplePlayerPreparationData(payload);
        return binding.estimateSfzEffectPreparation(control,context,formatTag,payloadBytes);
      };
      const preparationContext = {sampleRate:rate,processingChannels:2,maxFrames:128,minimumPhysicalBpm:0,playerKind:1};
      const {descriptor} = await prepareSoundFontBank({id:'a'.repeat(24),source,maxBytes:32*1024*1024,
        preparationContext,estimateEffectBytes:estimate},{workerFactory:workers.workerFactory,persistentCache:null});
      const budget = descriptor.nativeNonCacheBytes + descriptor.payload.byteLength + sfzSampleCacheFootprint(keys.length,64,1);
      const limited = await descriptor.materializeForContext(preparationContext,budget,estimate);
      assert.equal(limited.sampleCacheSlots,64);
      const actual = await play(executable,limited,song,{loadScoreFirst:true});
      const reference = await play(executable,descriptor,song,{resident:true});
      // A chord just inside the 1.5-second horizon rounds onto the window end and must still close the scan.
      const edge = song.events.map(event => event.seconds === 3 ? {...event,seconds:3 - 1e-6} : event);
      await play(executable,descriptor,{...song,events:edge},{resident:true});
      assert.ok(actual.latePages > 32 && actual.requestedSamples.size >= 8);
      for (let frame = 0; frame < song.duration * rate; frame += block) {
        const frames = Math.min(block,song.duration * rate - frame);
        const from = frame * 8, until = from + frames * 8;
        const expected = reference.output.subarray(from,until);
        let peak = 0;
        for (let i = 0; i < expected.length; i += 4) peak = Math.max(peak,Math.abs(expected.readFloatLE(i)));
        if (frame + frames <= rate * 1.5) assert.equal(peak,0,'The authored rest must stay silent');
        else assert.ok(peak > .001,`Resident reference silent at frame ${frame}`);
        assert.ok(actual.output.subarray(from,until).equals(expected),`Stream differs from resident PCM at frame ${frame}`);
      }
    } finally { await workers.close(); }
  });
