import { DSP_PARAM_PACKERS } from '../audio/dsp-params.generated.js';
import { buildDspPipelineNodes, encodeDspPipelineDescriptor } from '../audio/dsp-pipeline-descriptor.js';
import { DISPLAY_DSP_PLUGIN_TYPES } from '../audio/power-topology.js';
import { getPluginExecutionChannelMode, getPluginExecutionUnsupportedReason } from '../audio/plugin-execution-capabilities.js';
import { packInstrumentMessage, packLiveMidi } from './instrument-transport.js';

// Every AudioWorklet port command has one disposition at the native endpoint.
export const ENGINE_PORT_ROUTES = new Map(Object.entries({
  forward: [
    'soundFontMidiMetering','soundFontMixerAction','sfzGetPreparationContext','sfzPublishPage','sfzPollPages',
    'sfzStreamFailed','sfzCaptureCheckpoints','sfzStartRuntime','sfzResumeRuntime','midiPause','midiCaptureCheckpoint',
    'midiInputConfigure','midiInputState','midiInputEvents','midiTransport','midiStart','midiSpeed','midiGain',
    'setSpectrumTapRoute','setSpectrumTap','setAudioProcessingOverloadMonitoring','setVisualizerSources',
    'dspSetTelemetryRate','setPluginAsset','clearPluginAsset','requestDspLatency','setVisualSync','setOutputDelay',
    'awaitOutputReady','resetProcessingState','resetPluginState','streamBoundary','frequencyPreview','userActivity',
    'updateSilenceThreshold','configurePowerPolicy','setPowerProcessingState','setUiTelemetryEnabled','setDisplayDspBypassed',
    'requestPowerObservation','prepareTemporalStateAndResume','setNetworkReceiveSession','setNetworkOutputLocalDelay',
    'setNetworkOutputSendPaused'
  ],
  pipeline:['updatePlugin','updatePlugins','batchUpdatePlugins','addPlugin','removePlugin','reorderPlugin','reset'],
  close:['setNetworkOutputPort','sfzAttachSupplyPort'],
  ignore:['updateAudioConfig','setLowLatencyMode','dspModule','dspEnableTypes','registerProcessor','dspTelemetryReturn',
    'dspCleanupFailed','requestJsFallbackBudgetState','configureJsFallbackBudget']
}).flatMap(([route,types]) => types.map(type => [type,route])));

function isSampler(type) {
  return type === 'SoundFontPlayerPlugin' || type === 'SFZNotePlayerPlugin';
}

export function packed(plugin, rate, channels, useWasm) {
  const { id, type, parameters = {}, executionCapabilities: capabilities } = plugin;
  const packer = DSP_PARAM_PACKERS.get(type);
  const channel = parameters.channel ?? plugin.channel ?? null;
  const reason = getPluginExecutionUnsupportedReason(capabilities, {sampleRate:rate,
    channelMode:getPluginExecutionChannelMode(channel,channels)}) ||
    (useWasm === false && capabilities?.requiresWasm ? 'rolloutDisabled' : !packer ? 'wasmUnavailable' : null);
  const floats = packer && !reason ? plugin.wasmParams ?? packer.pack(parameters) : new Float32Array(0);
  const bytes = packer && !reason ? plugin.wasmParamBytes ?? packer.packBytes?.(parameters) : null;
  return { id, type, reason, floats, bytes, layoutHash:packer?.hash || 0, skip:!packer || !!reason,
    ...(isSampler(type) && {sf:parameters.sf || '',midiChannelMask:parameters.mco || 0}),
    assetPending:plugin.assetPending };
}

function isDisplayOnly(plugin) {
  return DISPLAY_DSP_PLUGIN_TYPES.has(plugin.type) &&
    !(plugin.type === 'RhythmAnalyzerPlugin' && plugin.parameters?.ck === true);
}

function noteAnalysisSources(active) {
  const sources = new Map();
  for (const [index,consumer] of active.entries()) {
    if (consumer.type !== 'SFZNotePlayerPlugin' || consumer.skip) continue;
    for (let i = index - 1; i >= 0; --i) {
      const upstream = active[i];
      if (upstream.type === 'NoteSpectrogramPlugin') {
        if (!upstream.skip && upstream.inputBus === consumer.inputBus && upstream.channel === consumer.channel &&
            upstream.parameters?.mn === consumer.parameters?.mn && upstream.parameters?.mx === consumer.parameters?.mx)
          sources.set(consumer.id,upstream.id);
        break;
      }
      if (upstream.outputBus === consumer.inputBus &&
          !(upstream.inputBus === upstream.outputBus && isDisplayOnly(upstream))) break;
    }
  }
  return sources;
}

export function packRecords(items, descriptor) {
  const total = items.reduce((n,item) => n + item.floats.byteLength + (item.bytes?.byteLength || 0),0);
  const attachment = new Uint8Array(total + (descriptor?.byteLength || 0));
  let offset = 0;
  const records = items.map(({id,type,floats,bytes,layoutHash,skip,assetPending,displayOnly,noteAnalysisSource,sf,midiChannelMask}) => {
    const paramsOffset = offset;
    attachment.set(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength), offset);
    offset += floats.byteLength;
    const bytesOffset = offset;
    if (bytes) { attachment.set(bytes, offset); offset += bytes.byteLength; }
    return {id,type,layoutHash,skip,assetPending,displayOnly,noteAnalysisSource,sf,midiChannelMask,
      paramsOffset,paramsCount:floats.length,bytesOffset,bytesLength:bytes?.byteLength || 0};
  });
  if (descriptor) attachment.set(new Uint8Array(descriptor.buffer || descriptor,descriptor.byteOffset || 0,descriptor.byteLength), offset);
  return {records,attachment:attachment.buffer,descriptorOffset:offset,descriptorBytes:descriptor?.byteLength || 0};
}

export function unpackSpectrumOverlay({packet,...message}) {
  if (!(packet instanceof ArrayBuffer) || ![16384,32768].includes(packet.byteLength)) return null;
  const samples = new Float32Array(packet);
  if (message.quality === 'hq') {
    if (!message.outputSpectrum) return null;
    message.outputSpectrum = {...message.outputSpectrum,current:samples.subarray(0,2048),peaks:samples.subarray(2048,4096)};
    message.inputSpectrum = samples.length === 8192 && message.inputSpectrum ? {...message.inputSpectrum,
      current:samples.subarray(4096,6144),peaks:samples.subarray(6144)} : null;
  } else {
    message.outputBuffer = samples.subarray(0,4096);
    if (samples.length === 8192) message.inputBuffer = samples.subarray(4096);
  }
  return message;
}

export class EnginePort extends EventTarget {
  constructor(manager, branch) {
    super();
    this.manager = manager;
    this.branch = branch;
    this.revision = 0;
    this.midiInputSerial = 0;
    this.directSampleSupply = false;
    // Each sample page is acknowledged only after an audio callback stages it.
    // Four in flight caps supply below dense playback, so later requests such
    // as release pages arrive late. 16 stays well inside the sidecar's
    // 64-entry command ring and frame queue with several instruments.
    this.samplePublishWindow = 16;
  }
  start() {}
  close() { this.closed = true; this.onmessage = null; }
  receive(message) {
    if (this.closed) return;
    const event = new MessageEvent('message', {data:message});
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }
  postMessage(message) {
    if (this.closed) return;
    const m = this.manager;
    const route = ENGINE_PORT_ROUTES.get(message.type);
    if (!route) { console.warn('Unknown native audio port command:',message.type); return; }
    if (route === 'ignore') return;
    if (route === 'close') { message.port?.close(); return; }
    if (message.type === 'updatePlugin' && message.plugin) {
      const item = packed(message.plugin,m.audioContext.sampleRate,m.getOutputChannelCount(),m.preferences.useWasmDsp);
      if (!item.skip && this.types?.get(item.id) === item.type &&
          this.routing?.get(item.id) === this.routeKey(message.plugin)) {
        const { records, attachment } = packRecords([item]);
        m.send({...records[0],type:'updateParameters',pluginType:item.type,branch:this.branch,attachment});
        return;
      }
    }
    if (route === 'pipeline') {
      this.configure(message.type === 'updatePlugins' ? message.plugins : undefined, message.masterBypass,message.gate === true);
      return;
    }
    if (message.type === 'resetProcessingState' && !this.branch) m.flushFeed();
    const { payload, ...wire } = message;
    if (payload instanceof ArrayBuffer) wire.attachment = payload;
    else if (ArrayBuffer.isView(payload)) wire.attachment = payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.byteLength);
    else if (payload !== undefined) wire.payload = payload;
    if (wire.type === 'setVisualizerSources') {
      wire.sources = wire.sources.map(source => ({...source,params:Array.from(source.params)}));
    }
    if (wire.type === 'dspSetTelemetryRate' && m._soundFontMidiMeteringPlugins?.size)
      wire.midiMetering = true;
    if (wire.type === 'sfzPublishPage' && ArrayBuffer.isView(wire.page?.pcm)) {
      const {pcm, ...page} = wire.page;
      wire.page = page;
      wire.attachment = pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset + pcm.byteLength);
    }
    if (message.type.startsWith('midi')) {
      if (Number.isFinite(wire.anchorFrame)) wire.anchorFrame = m.toEngineFrame(wire.anchorFrame);
      if (message.type === 'midiInputConfigure') this.midiInputSerial = 0;
      if (message.type === 'midiInputEvents' || message.type === 'midiInputState') {
        m.send({...packLiveMidi(wire,() => ++this.midiInputSerial,frame => m.toEngineFrame(frame)),branch:this.branch});
        return;
      }
    }
    const binary = wire.type === 'midiTransport' || wire.type === 'sfzStartRuntime' ? packInstrumentMessage(wire) : wire;
    m.send({...binary,branch:this.branch});
  }
  routeKey(p) {
    return JSON.stringify([p.enabled,p.parameters?.inputBus ?? p.inputBus,p.parameters?.outputBus ?? p.outputBus,
      p.parameters?.channel ?? p.channel,p.parameters?.ck,p.parameters?.mn,p.parameters?.mx,
      ...(isSampler(p.type) ? [p.parameters?.sf || '',p.parameters?.mco || 0] : [])]);
  }
  configure(plugins, masterBypass, gate = false) {
    if (this.closed) return;
    const m = this.manager;
    const parallel = m._parallelActive || m._parallelPreparing;
    plugins ??= m._buildBlindPluginData(this.branch ? m.pipelineB : parallel ? m.pipelineA : m.pipeline);
    const bypass = this.branch || parallel ? false : (masterBypass ?? m.masterBypass);
    const nodes = buildDspPipelineNodes(plugins,{getInstanceId:p => p.id,getParameters:p => p.parameters});
    const items = [], active = [];
    this.types = new Map();
    this.routing = new Map();
    const revision = ++this.revision;
    for (const plugin of plugins) {
      if (plugin.type === 'SectionPlugin') continue;
      const item = packed(plugin,m.audioContext.sampleRate,m.getOutputChannelCount(),m.preferences.useWasmDsp);
      const node = nodes[items.length];
      item.displayOnly = isDisplayOnly(plugin);
      items.push(item);
      this.types.set(item.id,item.type);
      this.routing.set(item.id,this.routeKey(plugin));
      if (node.enabled && node.sectionGate) {
        active.push({...plugin,...node,skip:item.skip});
        this.receive({pluginId:item.id,sampleRate:m.audioContext.sampleRate});
        this.receive({type:'dspExecutionState',pluginId:item.id,pluginType:item.type,generation:revision,
          sampleRate:m.audioContext.sampleRate,state:item.reason ? 'bypassed':'active',reason:item.reason});
      }
    }
    const sources = noteAnalysisSources(bypass ? [] : active);
    const producers = new Set(sources.values());
    for (const item of items) {
      if (producers.has(item.id)) item.displayOnly = false;
      if (item.type === 'SFZNotePlayerPlugin') item.noteAnalysisSource = sources.get(item.id) ?? 0;
    }
    const {records, ...binary} = packRecords(items,encodeDspPipelineDescriptor(nodes,m.getOutputChannelCount()));
    m.send({type:'configurePipeline',branch:this.branch,revision,plugins:records,gate,masterBypass:bypass,...binary});
  }
}
