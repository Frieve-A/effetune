import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { AudioContextManager } from '../../js/audio/audio-context-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { NativeAudioManager } from '../../js/native/audio-manager.js';
import { NativeInputAdapter } from '../../js/native/input-adapter.js';
import { packInstrumentMessage, packLiveMidi, unpackCheckpoints } from '../../js/native/instrument-transport.js';
import { EnginePort, ENGINE_PORT_ROUTES } from '../../js/native/engine-endpoint.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('native endpoints route the complete worklet command vocabulary and preserve request replies',async () => {
  const source = await readFile(new URL('../../plugins/audio-processor.js',import.meta.url),'utf8');
  const handler = source.slice(source.indexOf('    handlePortMessage(data) {'),source.indexOf('    updateNetworkRoute() {'));
  const commands = [...handler.matchAll(/(?:data\.type\s*===\s*|case\s+)'([a-zA-Z]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(commands)].sort(),[...ENGINE_PORT_ROUTES.keys()].sort());
  const sent = [], received = [];
  const port = new EnginePort({send:m => sent.push(m)},1);
  port.addEventListener('message',event => received.push(event.data));
  port.receive({type:'dspReady',branch:1});
  for (const [type,reply] of [['clearPluginAsset','assetState'],['sfzGetPreparationContext','sfzPreparationContext'],['midiCaptureCheckpoint','midiCheckpoints']]) {
    port.postMessage({type,requestId:5});
    assert.deepEqual(sent.pop(),{type,requestId:5,branch:1});
    port.receive({type:reply,requestId:5,branch:1});
  }
  assert.deepEqual(received.map(m => m.type),['dspReady','assetState','sfzPreparationContext','midiCheckpoints']);
});

test('native blind testing applies both effect chains while normal playback stays bypassed', () => {
  const sent = [];
  const manager = {
    masterBypass:true,audioContext:{sampleRate:48000},getOutputChannelCount:() => 2,
    pipeline:[],pipelineA:[],pipelineB:[],_buildBlindPluginData:pipeline => pipeline,
    send:message => sent.push([message.branch,message.masterBypass])
  };
  const primary = new EnginePort(manager,0), secondary = new EnginePort(manager,1);
  primary.configure();
  manager._parallelPreparing = true;
  primary.configure(manager.pipelineA);
  secondary.configure(manager.pipelineB);
  manager._parallelActive = true;
  manager._parallelPreparing = false;
  primary.postMessage({type:'updatePlugins',plugins:manager.pipelineA,masterBypass:true});
  secondary.configure();
  manager._parallelActive = false;
  primary.configure();
  assert.deepEqual(sent,[[0,true],[0,false],[1,false],[0,false],[1,false],[0,true]]);
  assert.equal(manager.masterBypass,true);
});

test('native device reopen and default fallback preserve the latest Player and MIDI preferences', async () => {
  const startup = {audioDriver:'wasapi',outputDeviceId:'native-output',outputDeviceLabel:'Speakers',outputChannels:2};
  const live = {...startup,sampleRate:48000,gaplessPlayback:false,replayGainMode:'track',
    replayGainPreampDb:-3,replayGainPreventClipping:false,midiInputDeviceKey:'keyboard',midiOutputDeviceKey:'synth'};
  const saved = [];
  const window = {
    audioPreferences:live,electronIntegration:{audioPreferences:live},
    electronAPI:{saveAudioPreferences:async (...args) => { saved.push(args); return {success:true}; }}
  };
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    preferences:startup,contextManager:new AudioContextManager(),engineEvents:new EventTarget(),
    session:{width:4},tap:{channelCount:4},ioManager:{currentOutputDeviceId:startup.outputDeviceId},
    openSettings:{type:'openSession',outputDeviceId:startup.outputDeviceId},
    request:async settings => {
      assert.deepEqual(settings,{type:'openSession',outputDeviceId:'default'});
      return {state:'open'};
    }
  });
  await withGlobals({window},async () => {
    manager.receive({type:'sessionState',state:'open',width:4,outputChannels:1});
    assert.deepEqual(window.audioPreferences,{...live,outputChannels:1});
    assert.equal(manager.contextManager.outputChannelCount,4);
    assert.equal(window.electronIntegration.audioPreferences,window.audioPreferences);

    const latest = {...window.audioPreferences,replayGainMode:'album',midiOutputDeviceKey:'new-synth'};
    window.audioPreferences = window.electronIntegration.audioPreferences = latest;
    await manager.openDefaultOutput();
    const fallback = {outputDeviceId:'default',outputDeviceLabel:''};
    assert.deepEqual(window.audioPreferences,{...latest,...fallback});
    assert.equal(window.electronIntegration.audioPreferences,window.audioPreferences);
    assert.equal(manager.preferences,window.audioPreferences);
    assert.deepEqual(saved,[[fallback,{applyInPlace:'output-device-fallback'}]]);
  });
});

test('native input None preserves current preferences after a failed save and a successful retry', async () => {
  const startup = {audioDriver:'wasapi',inputDeviceId:'mic',outputChannels:2,
    gaplessPlayback:true,replayGainMode:'off',midiInputDeviceKey:'',midiOutputDeviceKey:''};
  const live = {...startup,gaplessPlayback:false,replayGainMode:'track',replayGainPreampDb:-3,
    replayGainPreventClipping:false,midiInputDeviceKey:'keyboard',midiOutputDeviceKey:'synth'};
  const silent = {...live,inputDeviceId:NO_AUDIO_INPUT_DEVICE_ID};
  let saveSucceeds = false;
  let releaseRequests = 0;
  const saved = [];
  const window = {
    audioPreferences:live,electronAPI:{},
    electronIntegration:{audioPreferences:live,saveAudioPreferences:async (...args) => {
      saved.push(args);
      return saveSucceeds;
    }}
  };
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    preferences:startup,contextManager:Object.assign(new AudioContextManager(),{audioContext:{},workletNode:{}}),
    engineEvents:new EventTarget(),powerPolicyController:{
      getInputConfigRevision:() => 0,
      async requestSilentInputSelection() {
        ++releaseRequests;
        assert.equal(manager.preferences,silent);
        manager.receive({type:'sessionState',state:'open',width:2,outputChannels:1});
        manager.receive({type:'inputState',state:'none'});
        return true;
      }
    }
  });
  manager.ioManager = new NativeInputAdapter(manager);
  await withGlobals({window},async () => {
    manager.ioManager.setInput('acquired');
    assert.match(await manager.reset(silent),/Failed to save audio preferences/);
    assert.equal(releaseRequests,0);
    assert.equal(manager.ioManager.getInputSnapshot().state,'live');
    assert.equal(window.audioPreferences,live);
    assert.equal(window.electronIntegration.audioPreferences,live);
    assert.equal(manager.preferences,live);

    saveSucceeds = true;
    assert.equal(await manager.reset(silent),'');
    assert.equal(releaseRequests,1);
    assert.equal(manager.ioManager.getInputSnapshot().state,'not-configured');
    assert.deepEqual(window.audioPreferences,{...silent,outputChannels:1});
    assert.equal(window.electronIntegration.audioPreferences,window.audioPreferences);
    assert.equal(manager.preferences,window.audioPreferences);
    assert.deepEqual(saved,[[silent,{applyInPlace:'silent-input'}],[silent,{applyInPlace:'silent-input'}]]);
  });
});

test('live MIDI keeps source note identity across target fanout and preserves hydration flags',() => {
  let serial = 8;
  const targets = [{id:13,token:3},{id:5,token:2}];
  const {attachment,eventCount,events} = packLiveMidi({type:'midiInputEvents',events:[
    {status:0x90,data1:65,data2:88,frame:42,targets},
    {status:0,data1:3,data2:1,drumMode:{channel:3,mode:1},frame:45,targets:targets.slice(1)}
  ]},() => ++serial,frame => frame - 12);
  const v = new DataView(attachment);
  assert.equal(events,undefined);
  assert.equal(eventCount,2);
  assert.equal(serial,10);
  assert.equal(v.getUint32(8,true),9);
  assert.equal(v.getFloat64(12,true),30);
  assert.equal(v.getUint32(20,true),2);
  assert.equal(v.getUint32(24,true),13);
  assert.equal(v.getUint32(32,true),5);
  assert.equal(v.getUint32(44,true),16384);
  const hydration = packLiveMidi({type:'midiInputState',events:[{status:0,data1:0,data2:0,flags:8192,noteId:3}]});
  assert.deepEqual([...new Uint32Array(hydration.attachment)],[0,8192,3]);
});

test('the feed stamps samples continuously through repeated context frames and elided silence',async () => {
  const sent = [];
  let Tap;
  const globals = vm.createContext({
    currentFrame:0,
    AudioWorkletProcessor:class { constructor() { this.port = {}; } },
    registerProcessor(_name,processor) { Tap = processor; }
  });
  vm.runInContext(await readFile(new URL('../../js/native/feed-worklet.js',import.meta.url),'utf8'),globals);
  const tap = new Tap({processorOptions:{channels:1,frames:512}});
  tap.port.onmessage({data:{port:{postMessage:m => sent.push(m)},generation:1}});
  const process = (start,signal) => {
    globals.currentFrame = start;
    const samples = new Float32Array(128).fill(signal);
    tap.process([[samples]],[[samples]]);
  };
  for (let i = 0; i < 20; ++i) process(i === 4 ? 384 : i * 128,i < 8 || i >= 16 ? 1 : 0);
  assert.deepEqual(sent.map(m => [m.type,m.sourceFrame]),[
    ['feed',0],['feed',512],['feedSilence',1024],['feed',2048]
  ]);
  process(2560,.5);
  tap.port.onmessage({data:{generation:2,channels:2}});
  for (let i = 0; i < 4; ++i) process(4096 + 128 * i,1);
  assert.equal(sent.at(-1).sourceFrame,4096);
  assert.equal(sent.at(-1).generation,2);
  assert.equal(sent.at(-1).channelCount,2);
  const resized = new Float32Array(sent.at(-1).attachment);
  assert.ok(resized.subarray(0,512).every(sample => sample === 1));
  assert.ok(resized.subarray(512).every(sample => sample === 0));
});

test('sampler checkpoints retain their exact byte ranges alongside the binary MIDI event list',() => {
  const bytes = Uint8Array.of(0,7,8,0).subarray(1,3);
  const message = packInstrumentMessage({type:'midiTransport',checkpoints:[{pluginId:3,bytes}],
    timeline:{duration:2,tempoMap:[{seconds:0,quarter:0,microsecondsPerQuarter:500000}],
      timeSignatures:[{seconds:0,quarter:0,numerator:7,denominator:8}],displayEvents:[{}],events:[
      {seconds:.25,status:0x90,data1:64,data2:90},
      {seconds:1,status:0,data1:3,data2:1,drumMode:{channel:3,mode:1}}
    ]}});
  const events = new DataView(message.attachment,message.timeline.eventsOffset);
  assert.equal(message.timeline.eventsCount,2);
  assert.equal(message.timeline.displayEvents,undefined);
  assert.equal(events.getFloat64(0,true),.25);
  assert.equal(events.getUint32(8,true),0x90);
  assert.equal(events.getUint16(46,true),1);
  const packed = new DataView(message.attachment);
  assert.equal(packed.getUint32(message.timeline.tempoOffset + 16,true),500000);
  assert.equal(packed.getUint32(message.timeline.meterOffset + 20,true),8);
  assert.deepEqual(unpackCheckpoints(message).checkpoints,[{pluginId:3,bytes}]);
  assert.throws(() => unpackCheckpoints({...message,checkpoints:[{byteOffset:1,byteLength:999}]}),/checkpoint/);
});
