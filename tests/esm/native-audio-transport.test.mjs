import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { AudioManager } from '../../js/audio-manager.js';
import { AudioContextManager } from '../../js/audio/audio-context-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { NativeAudioManager } from '../../js/native/audio-manager.js';
import { NativeInputAdapter } from '../../js/native/input-adapter.js';
import { packInstrumentMessage, packLiveMidi, unpackCheckpoints } from '../../js/native/instrument-transport.js';
import { EnginePort, ENGINE_PORT_ROUTES } from '../../js/native/engine-endpoint.js';
import { GRAPH_V1_CAPACITY } from '../../js/native/graph-capacity.generated.js';
import { buildPipelineAnalyzerSnapshot, buildPipelineProcessingSnapshot } from '../../js/pipeline-analyzer/pipeline-snapshot.js';
import { PipelineWorkletSync } from '../../js/ui/pipeline/pipeline-worklet-sync.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

test('native MIDI presentation excludes Chromium feed latency', () => {
  const native = Object.assign(Object.create(NativeAudioManager.prototype),{
    audioContext:{sampleRate:48000},
    contextManager:{audioContext:{sampleRate:48000}},
    session:{deviceRate:48000,outputLatencyFrames:240},
    clock:{outputConverterDelayFrames:12,feedDelayFrames:1024},
    getTotalPipelineLatencySamples:() => 480
  });
  const standard = Object.assign(Object.create(AudioManager.prototype),{
    contextManager:native.contextManager,
    _getDeviceLatencyFrames:() => 252,
    getTotalPipelineLatencySamples:() => 480
  });
  const presentation = manager => midiPlaybackMethods.getMidiPresentation.call({
    audioManager:manager,getCurrentState:() => ({playbackMode:'midi',playbackSpeed:1}),
    getCurrentMidiTime:() => 20,midiTimeline:{duration:30},midiPlaying:true
  });
  assert.equal(presentation(native).position,presentation(standard).position);
  assert.equal(native.getAudiblePlaybackPosition(20,1),20 - (252 + 480 + 512 + 1024) / 48000);
  native.filePlayback = {current:{track:1}};
  Object.assign(native.clock,{fileTrack:1,fileConverterDelayFrames:24});
  assert.equal(native.getAudiblePlaybackPosition(20,1),20 - (252 + 480 + 24) / 48000);
  assert.equal(presentation(native).position,presentation(standard).position);
});

test('native launch diagnostics distinguish no attempt from a failed handshake', async () => {
  const window = new EventTarget();
  const manager = Object.assign(Object.create(NativeAudioManager.prototype), {
    engineLifetime:new AbortController(), bridge:{start:async () => ({ok:false})}
  });
  await withGlobals({window},async () => {
    assert.equal(manager.getDiagnosticNativeState().variant,'notStarted');
    await assert.rejects(manager.attachPorts('wasapi'), /Audio driver unavailable/);
    assert.equal(manager.getDiagnosticNativeState().variant,'unknown');
    manager.bridge.start = async () => ({ok:false,variant:'baseline'});
    await assert.rejects(manager.attachPorts('wasapi'), /Audio driver unavailable/);
    assert.equal(manager.getDiagnosticNativeState().variant,'baseline');
  });
});

test('cold native analysis, measurement handoff and export use the offline DSP module', async () => {
  const preferences = {useWasmDsp:true};
  const window = {audioPreferences:preferences, location:{pathname:'/effetune.html'}};
  const manager = Object.assign(Object.create(NativeAudioManager.prototype), {
    currentPipeline:'A', preferences, dspModuleInfo:null,
    contextManager:{audioContext:{sampleRate:48000},outputChannelCount:2}
  });
  const context = vm.createContext({window, Float32Array, Uint8Array, performance, console});
  for (const file of ['plugin-base.js','analyzer/analog_meter.js']) {
    vm.runInContext(await readFile(new URL('../../plugins/' + file, import.meta.url),'utf8'), context);
  }
  window.AnalogMeterPlugin.prototype.audioHostActive = false;
  const meter = new window.AnalogMeterPlugin();
  meter.id = 7;
  manager.pipelineA = [meter];
  const options = {audioManager:manager, workletSync:new PipelineWorkletSync({audioManager:manager}),
    configuration:{inputChannel:0,outputs:[{channel:0}]}};
  const fetch = async asset => new Response(await readFile(new URL('../../' + asset, import.meta.url)));
  await withGlobals({window,fetch}, async () => {
    assert.equal(window.dspParamPackers, undefined);
    const {snapshot:analysis} = await buildPipelineAnalyzerSnapshot(options);
    assert.deepEqual(analysis.requiredWasmPluginIds,[meter.id]);
    assert.ok(analysis.plugins[0].wasmParams instanceof Float32Array);
    assert.ok(analysis.dsp.module instanceof WebAssembly.Module);
    const {snapshot:handoff} = await buildPipelineProcessingSnapshot(options);
    assert.equal(handoff.dsp.module,null);
    assert.ok(WebAssembly.validate(handoff.dsp.bytes));

    const exporter = await manager._ensureOfflineProcessor();
    const session = await exporter.createOfflineDspSession([meter],48000,2);
    try {
      assert.ok(session?.entries.get(meter), 'The exporter must instantiate the native effect in its offline engine');
      assert.equal(session.moduleInfo.module,analysis.dsp.module);
    } finally { exporter.destroyOfflineDspSession(session); }
    assert.equal(manager.dspModuleInfo,null);
    preferences.useWasmDsp = false;
    await assert.rejects(buildPipelineAnalyzerSnapshot(options), {code:'wasm-unavailable'});
    assert.equal(await exporter.createOfflineDspSession([meter],48000,2),null);
  });
});

test('native System Audio mixes only a confirmed capture and ends it after input release', async () => {
  const calls = [];
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    contextManager:{},preferences:{inputDeviceId:'system-audio'},tap:{},
    control:{postMessage(message) { calls.push(['mix',message.enabled]); }}
  });
  const io = manager.ioManager = new NativeInputAdapter(manager);
  let allowed = true, confirmed = true;
  io.evaluateSystemAudioGuard = async () => ({allowed,defaultGroupId:'speakers'});
  manager.replaceInput = async id => {
    calls.push(['replace',id]);
    const state = id === 'system-audio' ? 'acquired' : 'none';
    io.setInput(state);
    if (state === 'acquired') manager.connectSourceToPipeline(io.deviceSource);
    return {state};
  };
  const window = {electronAPI:{systemAudio:{
    nativeBegin:async () => { calls.push(['begin']); return 1; },
    nativeHold:async token => { calls.push(['hold',token]); return confirmed; },
    nativeEnd:async token => { calls.push(['end',token]); }
  }},uiManager:{showTransientMessage:key => calls.push(['message',key])}};
  const acquire = () => io.beginReacquireAudioInput({requireVisible:false});
  await withGlobals({window},async () => {
    await acquire();
    assert.deepEqual(calls, [['begin'],['replace','system-audio'],['mix',false],['mix',false],['hold',1],['mix',true]]);
    assert.equal(io.systemAudioDefaultGroupId,'speakers');
    await io.releaseAudioInput();
    assert.deepEqual(calls.slice(-2),[['replace',NO_AUDIO_INPUT_DEVICE_ID],['end',1]]);
    assert.equal(io.systemAudioDefaultGroupId,null);
    calls.length = 0;
    confirmed = false;
    await assert.rejects(acquire(),error => error.systemAudioNotified);
    assert.deepEqual(calls.slice(-3),[['replace',NO_AUDIO_INPUT_DEVICE_ID],['end',1],['message','error.systemAudioMuteUnavailable']]);
    assert(!calls.some(([op, value]) => op === 'mix' && value));
    assert.equal(io.systemAudioDisabled,true);
    calls.length = 0;
    allowed = false;
    await assert.rejects(acquire(),{name:'NotAllowedError'});
    assert.deepEqual(calls,[]);
    allowed = confirmed = true;
    io.systemAudioDisabled = false;
    await acquire();
    calls.length = 0;
    io.setInput('failed');
    io.setInput('failed');
    assert.deepEqual(calls,[['end',1]]);
    await acquire();
    calls.length = 0;
    manager.engineEvents = new EventTarget();
    manager.engineLifetime = new AbortController();
    manager.bridge = {stop:async () => { calls.push(['stop']); }};
    manager._cancelPendingDspControlRequests = () => {};
    manager.resetClock = () => {};
    manager.expectRecovery = true;
    manager.receive({type:'sessionState',state:'failed',reason:'unsupportedFormat'});
    assert.equal(manager.engineLifetime.signal.aborted,true);
    manager.receive({type:'engineFailure',reason:'test'});
    assert.equal(io.nativeCapture,null);
    assert.deepEqual(calls,[['stop']]);
  });
});

test('output recovery checks System Audio against the newly applied default output',async () => {
  const calls = [];
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    engineEvents:new EventTarget(),expectRecovery:true,openSettings:{outputDeviceId:'separate'},
    openDefaultOutput:async () => { calls.push('default'); return {state:'open'}; },
    powerPolicyController:{handleSystemAudioOutputChange:() => calls.push('check')}
  });
  manager.receive({type:'sessionState',state:'failed',reason:'unavailable'});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls,['default','check']);
});

test('a compatible output reopen resumes the native file clock without recreating the endpoint', () => {
  const calls = [];
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    engineEvents:new EventTarget(),contextManager:{},clockOffsets:[],
    _applyEffectiveOutputPreferences() {},
    filePlayback:{current:{generation:4},recover:() => calls.push('recover'),update:() => calls.push('clock')}
  });
  manager.receive({type:'deviceReset',direction:'output'});
  assert.equal(manager.fileRecoveryNeeded,4);
  manager.receive({type:'sessionState',state:'open',recoveryId:0,width:2});
  assert.equal(manager.fileRecoveryNeeded,null);
  manager.clock = {};
  manager.endpoints = [];
  manager.receive({type:'clock'});
  assert.deepEqual(calls,['recover','clock']);
});

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

test('startup opens System Audio with the saved output and builds the tap at the native mix width',async () => {
  const calls = [];
  let defaultEndpoint = 'source-A';
  const prefs = {audioDriver:'wasapi',inputDeviceId:'system-audio',outputDeviceId:'separate'};
  const window = {electronAPI:{systemAudio:{
    nativeBegin:async endpoint => { calls.push(['begin',endpoint]); defaultEndpoint = 'source-B'; return 1; },
    nativeHold:async () => { calls.push('hold'); return true; },
    nativeEnd:async () => { calls.push('end'); }
  }}};
  const context = {sampleRate:48000,audioWorklet:{async addModule() {}},async resume() {}};
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    engineLifetime:new AbortController(),contextManager:{audioContext:context,async initAudioContext() {}},
    control:{postMessage(m) { if (m.type === 'setInputMix') calls.push(m.enabled); }},
    async attachPorts() {},async request(settings) {
      calls.push(settings.inputDeviceId,settings.outputDeviceId,settings.loopbackEndpointId);
      return {state:'open',inputChannels:6,width:6};
    },makeEndpoint:() => ({port:{}}),updateExposedProperties() { this.workletNode = this.contextManager.workletNode; },
    _advanceAudioGraphGeneration() {},telemetryHub:{setPort() {}},endpoints:[]
  });
  manager.ioManager = new NativeInputAdapter(manager);
  manager.ioManager.evaluateSystemAudioGuard = async output => {
    calls.push(output); return {allowed:true,defaultGroupId:defaultEndpoint};
  };
  class Tap {
    constructor(_context,_name,options) { calls.push(['tap',options.channelCount]); this.port = {postMessage() {}}; }
    connect() {}
  }
  await withGlobals({window,AudioWorkletNode:Tap},async () => {
    assert.equal(await manager.initAudio(prefs),'');
    assert.deepEqual(calls,['separate',['begin','source-A'],'system-audio','separate','source-A',false,'hold',true,['tap',6]]);
    assert.equal(manager.ioManager.systemAudioDefaultGroupId,'source-A');
    manager.inputRequest = 0;
    manager.waitFor = async () => ({detail:{state:'acquired'}});
    manager.send = message => calls.push(message);
    await manager.replaceInput('system-audio');
    assert.equal(calls.at(-1).loopbackEndpointId,'source-A');
  });
});

test('restoring the primary native endpoint holds synced telemetry until its audible time',async () => {
  let resolver = null;
  const posted = [];
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    visualSyncEnabled:true,_dspCapabilitiesByNode:new Map(),_nextDspReadyToken() {},
    _postNetworkOutputLocalDelay() {},_postNetworkReceiveSession() {},_postVisualizerSources() {},
    async _applyWorkletOutputDelays() {},dispatchEvent() {},_resolveVisualSyncDue:() => 42,
    telemetryHub:{setVisualSyncResolver(value) { resolver = value; }}
  });
  const endpoint = {port:{branch:0,postMessage(message) { posted.push(message); },receive() {}}};
  await withGlobals({window:{}},async () => manager.restoreEndpoint(endpoint,{},false));
  assert.equal(resolver?.('tap',0,'SpectrumAnalyzerPlugin'),42);
  assert.deepEqual(posted.find(message => message.type === 'setVisualSync'),{type:'setVisualSync',enabled:true});
});

test('a saved native input that fails to open falls back to the default input without changing the preference',async () => {
  const sent = [];
  const replies = {missing:{state:'failed',reason:'unavailable'},default:{state:'acquired'}};
  const preferences = {inputDeviceId:'missing',latencyHint:'interactive'};
  const manager = Object.assign(Object.create(NativeAudioManager.prototype),{
    inputRequest:0,preferences,openSettings:{},
    send:message => sent.push(message),
    waitFor:async () => { await null; return {detail:replies[sent.at(-1).inputDeviceId]}; }
  });
  manager.ioManager = new NativeInputAdapter(manager);
  const window = {electronAPI:{requestMicrophoneAccess:async () => true}};
  await withGlobals({window},async () => {
    assert.deepEqual(await manager.replaceInput('missing'),{state:'acquired'});
  });
  assert.deepEqual(sent.map(m => m.inputDeviceId),['missing','default']);
  assert.deepEqual(manager.ioManager.diagnosticFallbackInput,{id:'missing',match:'fellBackToDefault'});
  assert.equal(preferences.inputDeviceId,'missing');
});

test('over-capacity native edits preserve the running revision and execution reports', async () => {
  const sent = [], errors = [], events = [];
  const port = new EnginePort({
    audioContext:{sampleRate:48000},getOutputChannelCount:() => 2,preferences:{},
    send:message => sent.push(message)
  },0);
  port.onmessage = event => events.push(event.data);
  await withGlobals({window:{uiManager:{setError:key => errors.push(key)}}},() => {
    const chain = Array.from({length:48},(_,i) => ({id:i+1,type:'LevelMeterPlugin',enabled:true}));
    assert.equal(port.configure(chain),true);
    const revision = port.revision, eventCount = events.length;
    assert.equal(port.configure([...chain,{id:49,type:'VolumePlugin',enabled:true}]),false);
    assert.deepEqual(errors,['error.pipelineTooLarge']);
    assert.equal(sent.length,1);
    assert.equal(port.revision,revision);
    assert.equal(port.types.has(49),false);
    assert.equal(events.length,eventCount);
    assert.equal(port.configure(chain.slice(1)),true);
    assert.equal(sent.length,2);
  });
});

test('native startup and device recovery keep gain gated until a playable pipeline is published', async () => {
  const sent = [], errors = [];
  const opened = {type:'sessionState',state:'open',width:2,inputChannels:0,outputChannels:2,
    sampleRate:48000,deviceRate:48000,recoveryId:0};
  const ready = {type:'dspReady',branch:0,endpointEpoch:1};
  const reply = data => queueMicrotask(() => control.onmessage({data}));
  const control = {postMessage(message) {
    sent.push(message);
    const {type,branch,revision,requestId,samples,recoveryId} = message;
    if (type === 'openSession') { reply(opened); reply(ready); }
    if (type === 'startStream' || type === 'stopStream')
      reply({type:'sessionState',state:type === 'startStream' ? 'running' : 'stopped'});
    if (type === 'configurePipeline') reply({type:'pipelineApplied',branch,revision});
    if (type === 'setOutputDelay') reply({type:'outputDelaySet',branch,requestId,samples});
    if (type === 'setNetworkOutputLocalDelay') reply({type:'networkDelayApplied',branch,requestId,localDelaySamples:0});
    if (type === 'awaitOutputReady') reply({type:'outputReady',branch,requestId});
    if (type === 'releaseRecovery') reply({type:'recoveryReleased',recoveryId,accepted:true});
  }};
  const window = Object.assign(new EventTarget(),{
    electronAPI:{audioEngine:{async start(_driver,token) {
      window.dispatchEvent(Object.assign(new Event('message'),{
        source:window,data:{type:'effetune-audio-engine-ports',token,variant:'single'},ports:[control,{},{}]
      }));
      return {ok:true};
    },async stop() {}}},
    uiManager:{setError:key => errors.push(key)}
  });
  class Tap {
    port = {postMessage() {}};
    connect() {}
  }
  class VolumePlugin {
    constructor(id) { this.id = id; }
    enabled = true;
    getParameters() { return {vl:-6}; }
  }
  await withGlobals({window,AudioWorkletNode:Tap},async () => {
    const manager = new NativeAudioManager({});
    const context = {sampleRate:48000,audioWorklet:{async addModule() {}},async suspend() {},async resume() {}};
    manager.contextManager.initAudioContext = async () => { manager.contextManager.audioContext = context; };
    const lastCommand = type => sent.findLast(message => message.type === type);
    const recover = async recoveryId => {
      const previous = manager.workletNode;
      const done = manager.waitFor('recoveryReleased',data => data.recoveryId === recoveryId,5000);
      manager.receive({type:'deviceReset',direction:'output'});
      manager.receive({...opened,recoveryId});
      manager.receive({...ready,recoveryId,endpointEpoch:recoveryId+1});
      await done;
      assert.equal(previous.port.closed,true);
      assert.equal(manager.failed,false);
      assert.equal(manager.audioContext,context);
    };
    try {
      assert.equal(await manager.initAudio({audioDriver:'wasapi',inputDeviceId:NO_AUDIO_INPUT_DEVICE_ID}),'');
      const oversized = Array.from({length:GRAPH_V1_CAPACITY.maxEffectiveInstances + 1},(_,i) => new VolumePlugin(i+1));
      manager.updateCurrentPipeline(oversized);
      assert.equal(await manager.waitForDspActivationBeforeOutput(),true);
      await manager.fadeInOutputWhenReady();
      assert.ok(errors.includes('error.pipelineTooLarge'));
      assert.deepEqual(lastCommand('configurePipeline').plugins,[]);
      assert.equal(lastCommand('fadeOutput').gain,0);

      await manager.setMasterBypass(true);
      await flushMicrotasks();
      assert.equal(lastCommand('configurePipeline').masterBypass,true);
      assert.equal(lastCommand('fadeOutput').gain,1);
      await manager.setMasterBypass(false);
      await recover(1);
      assert.equal(lastCommand('fadeOutput').gain,0);

      const owner = manager.fadeOutOutput(0);
      manager.updateCurrentPipeline([oversized[0]]);
      assert.equal(await manager.rebuildPipeline(false,{gate:true}),'');
      await flushMicrotasks();
      assert.equal(manager.capacityOutputHeld,false);
      assert.equal(lastCommand('fadeOutput').gain,0);
      assert.equal(manager.fadeInOutputForToken(owner,0),true);
      assert.equal(lastCommand('fadeOutput').gain,1);

      manager.updateCurrentPipeline(oversized);
      assert.equal(await manager.rebuildPipeline(),'error.pipelineTooLarge');
      await recover(2);
      assert.equal(lastCommand('fadeOutput').gain,1);
      assert.deepEqual(lastCommand('configurePipeline').plugins.map(plugin => plugin.id),[oversized[0].id]);
      assert.equal(await manager.contextManager.suspendForPowerPolicy(),true);
      assert.equal(await manager.contextManager.resumeForPowerPolicy(),true);
    } finally {
      manager.engineLifetime.abort();
      manager._cancelPendingDspControlRequests();
      manager.telemetryHub.setPort(null);
    }
  });
});

test('master bypass disconnects native note analysis without changing its allocation at capacity', () => {
  const sent = [];
  const port = new EnginePort({
    audioContext:{sampleRate:48000}, getOutputChannelCount:() => 2, preferences:{},
    send:message => sent.push(message)
  },0);
  const parameters = {mn:28,mx:91};
  const graph = [
    {id:1,type:'NoteSpectrogramPlugin',enabled:true,parameters},
    {id:2,type:'SFZNotePlayerPlugin',enabled:true,parameters},
    ...Array.from({length:GRAPH_V1_CAPACITY.maxEffectiveInstances - 2},(_,i) => ({
      id:i + 3,type:'VolumePlugin',enabled:true
    }))
  ];
  for (const bypass of [false,true,false]) assert.equal(port.configure(graph,bypass),true);
  assert.deepEqual(sent.map(message => message.masterBypass),[false,true,false]);
  assert.deepEqual(sent.map(message => message.plugins[0].displayOnly),[false,false,false]);
  assert.deepEqual(sent.map(message => message.plugins[1].noteAnalysisSource),[1,0,1]);
});

test('native device recovery replays skipped assets without waiting for an inactive kernel', async () => {
  class CrosstalkCancellationPlugin {
    static executionCapabilities = {supportedChannelModes:['stereo-pair']};
    id = 1;
    enabled = true;
    channel = 'L';
    externalAssetInfo = {pending:true};
    getParameters() { return {channel:this.channel}; }
  }
  const effect = new CrosstalkCancellationPlugin();
  const descriptorWaits = [], replayed = [], activeWaits = [];
  const audioContext = {sampleRate:48000};
  const manager = Object.assign(Object.create(NativeAudioManager.prototype), {
    audioContext, contextManager:{audioContext,outputChannelCount:2}, preferences:{}, pipeline:[effect],
    applyBranchPipeline:async () => true,
    _syncWasmAssetMembership() {},
    _prepareWasmAssetMapsForTarget:async () => ({assetMaps:new Map()}),
    _waitForPendingExternalAssetDescriptors(plugins) { descriptorWaits.push(plugins); return true; },
    _replayPipelineWasmAssets(_endpoint,plugins,options) {
      replayed.push(plugins);
      return new Set(options.assetReadinessPlugins.map(plugin => `${plugin.id}:0`));
    },
    _waitForWasmAssetsActive(_endpoint,expected) { activeWaits.push([...expected]); return true; }
  });
  const endpoint = manager.workletNode = {port:new EnginePort(manager,0)};

  assert.equal(manager._createBlindBranchSnapshot([effect]).records[0].requiresAssetReadiness,false);
  assert.equal(await manager.preparePrimary(endpoint),true);
  effect.channel = null;
  assert.equal(manager._createBlindBranchSnapshot([effect]).records[0].requiresAssetReadiness,true);
  assert.equal(await manager.preparePrimary(endpoint),true);
  assert.deepEqual(descriptorWaits,[[],[effect]]);
  assert.deepEqual(replayed,[[effect],[effect]]);
  assert.deepEqual(activeWaits,[[],['1:0']]);
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

test('a native preset with a continuous effect publishes without a Chromium output keepalive', async () => {
  const contextManager = new AudioContextManager();
  contextManager.audioContext = { sampleRate: 48000, sinkId: { type: 'none' } };
  const plugin = { id: 1, type: 'OscillatorPlugin', enabled: true, temporalCapability: 'must-process' };
  const calls = [];
  const manager = Object.assign(Object.create(NativeAudioManager.prototype), {
    contextManager,
    audioContext: contextManager.audioContext,
    pipeline: [plugin],
    preferences: { useWasmDsp: true },
    getOutputChannelCount: () => 2,
    control: { postMessage: message => calls.push(message.type) },
    powerPolicyController: { notifyTopologyChanged: reason => calls.push(reason) },
    _scheduleVisualSyncUpdate() {}
  });
  contextManager.workletNode = { port: new EnginePort(manager, 0) };
  class AudioWorkletNode {
    constructor() {
      calls.push('create-worklet');
      throw new DOMException('The processor is not registered on the native feed context', 'InvalidStateError');
    }
  }
  await withGlobals({ AudioWorkletNode }, () => {
    const result = manager.commitPowerTopologyMutation({ type: 'updatePlugins', plugins: [plugin] },
      { reason: 'apply-preset' });
    assert.equal(result.postedNodeCount, 1);
    assert.deepEqual(calls, ['configurePipeline', 'apply-preset']);
    assert.equal(contextManager.realtimeOutputKeepaliveNode, null);
  });
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

test('native input replacement refreshes negotiated diagnostics without dropping the output clock', async () => {
  const inputUpdates = [];
  const manager = Object.assign(Object.create(NativeAudioManager.prototype), {
    audioContext:{sampleRate:48000,currentTime:1},engineEvents:new EventTarget(),clockOffsets:[],inputRequest:2,
    endpoints:[],preferences:{},ioManager:{setInput:state => inputUpdates.push(state)},
    session:{sampleRate:48000,deviceRate:48000,outputChannels:2,outputLatencyFrames:256,
      captureRate:48000,inputChannels:2,inputLatencyFrames:128,inputFailed:false}
  });
  const clock = {
    type:'clock',pipelineFrame:1024,timeNs:1e9,outputLatencyFrames:300,outputConverterDelayFrames:32,
    inputLatencyFrames:128,captureRatio:1,captureTargetFrames:256,captureConverterDelayFrames:16
  };
  const input = () => {
    const {inputChannels,captureRate,inputLatencyFrames,inputFailed} = manager.getDiagnosticNativeState().session;
    return {inputChannels,captureRate,inputLatencyFrames,inputFailed};
  };
  await withGlobals({window:{}},() => {
    manager.receive(clock);
    const presentation = manager.getEngineClock();
    const latency = manager.getOutputLatencySeconds();
    // This replacement reached the hardware while a newer request was pending.
    manager.receive({type:'inputState',state:'acquired',requestId:1,inputChannels:1,
      captureRate:44100,inputLatencyFrames:96});
    const pending = manager.getDiagnosticNativeState();
    assert.deepEqual(input(),{inputChannels:1,captureRate:44100,inputLatencyFrames:96,inputFailed:false});
    assert.deepEqual(inputUpdates,[]);
    assert.equal(pending.captureRatio,null);
    assert.equal(pending.latency.inputLatencyFrames,undefined);
    assert.equal(pending.latency.captureTargetFrames,undefined);
    assert.equal(pending.latency.captureConverterDelayFrames,undefined);
    assert.deepEqual(manager.getEngineClock(),presentation);
    assert.equal(manager.getOutputLatencySeconds(),latency);

    const captureRatio = 44100 / 48000;
    manager.receive({...clock,pipelineFrame:2048,timeNs:2e9,inputLatencyFrames:96,
      captureRatio,captureTargetFrames:220,captureConverterDelayFrames:32});
    const current = manager.getDiagnosticNativeState();
    assert.equal(current.captureRatio,captureRatio);
    assert.equal(current.latency.captureTargetFrames,220);
    assert.equal(current.latency.captureConverterDelayFrames,32);

    manager.receive({type:'inputState',state:'none',requestId:2});
    assert.deepEqual(input(),{inputChannels:0,captureRate:0,inputLatencyFrames:0,inputFailed:false});
    assert.equal(manager.getDiagnosticNativeState().captureRatio,null);
    manager.receive({type:'inputState',state:'failed',reason:'unavailable',reopened:true});
    assert.deepEqual(input(),{inputChannels:0,captureRate:0,inputLatencyFrames:0,inputFailed:true});
    assert.deepEqual(inputUpdates,['none','failed']);
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
