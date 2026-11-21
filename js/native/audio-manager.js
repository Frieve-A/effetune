import { AudioManager } from '../audio-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID, SYSTEM_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';
import { saveAudioPreferences } from '../electron/audio-preference-store.js';
import { EnginePort, unpackSpectrumOverlay } from './engine-endpoint.js';
import { NativeInputAdapter } from './input-adapter.js';
import { unpackCheckpoints } from './instrument-transport.js';
import { audiblePlaybackPosition } from '../audio/visual-sync.js';

const FEED_BATCH_FRAMES = 512;
const DRIVER_RESPONSE_TIMEOUT_MS = 15000;
const DEVICE_ERRORS = {unavailable:'unavailable',unsupportedFormat:'format',permission:'permission',busy:'busy'};

function waitForEvent(target, type, accept, timeoutMs = DRIVER_RESPONSE_TIMEOUT_MS, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const finish = () => {
      clearTimeout(timer);
      target.removeEventListener(type,listener);
      signal?.removeEventListener('abort',cancel);
    };
    const cancel = () => { finish(); reject(signal.reason); };
    const listener = event => { if (accept(event)) { finish(); resolve(event); } };
    const timer = setTimeout(() => { finish(); reject(new Error('Audio driver response timed out')); }, timeoutMs);
    target.addEventListener(type,listener);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

export class NativeAudioManager extends AudioManager {
  constructor(pipelineManager) {
    super(pipelineManager, {externalInput:true});
    this.bridge = window.electronAPI.audioEngine;
    this.ioManager = new NativeInputAdapter(this);
    this.pipelineProcessor.ioManager = this.ioManager;
    this.engineEvents = new EventTarget();
    this.engineLifetime = new AbortController();
    this.endpoints = [];
    this.feedGeneration = 0;
    this.inputRequest = 0;
    this.parallelRequest = 0;
    this.clockOffsets = [];
    this.contextManager.suspendForPowerPolicy = async () => {
      if (this.failed || !await this.streamState(false)) return false;
      this.contextManager._intentionalPowerSuspend = true;
      await this.audioContext.suspend();
      return true;
    };
    this.contextManager.resumeForPowerPolicy = async () => {
      if (!this.control || this.failed) return false;
      await this.audioContext.resume();
      this.contextManager._intentionalPowerSuspend = false;
      return this.streamState(true);
    };
  }
  send(message) {
    if (message.type === 'fadeOutput' && !message.branch) {
      this.outputTarget = message.gain;
      if (this.endpoints[1]) this.send({...message,branch:1});
    }
    if (message.type === 'setInputMix') this.inputMixEnabled = message.enabled;
    const branch = message.branch || 0;
    const epoch = this.ready?.[branch]?.endpointEpoch;
    if (branch && !epoch) {
      this.endpoints[branch]?.port.pendingCommands?.push(message);
      return;
    }
    const scoped = epoch && !['openSession','releaseRecovery','flushFeed'].includes(message.type);
    this.control?.postMessage(scoped ? {...message,endpointEpoch:epoch} : message);
  }
  waitFor(type, accept, timeoutMs) {
    return waitForEvent(this.engineEvents,type,event => accept(event.detail),timeoutMs,this.engineLifetime.signal);
  }
  async request(message, type, accept = () => true) {
    const reply = this.waitFor(type,accept);
    this.send(message);
    return (await reply).detail;
  }
  async streamState(start) {
    this.streamRequested = start;
    const desired = start ? 'running' : 'stopped';
    const reply = await this.request({type:start ? 'startStream' : 'stopStream'}, 'sessionState',
      state => state.state === desired || state.state === 'failed');
    if (reply.state === desired && !start) this.resetClock();
    return reply.state === desired;
  }
  resetClock() {
    this.clock = null;
    this.clockOffsets.length = 0;
    this.frameOffset = 0;
  }
  observeClock(data) {
    const context = this.audioContext;
    const pipelineFrame = data.clockPipelineFrame ?? data.pipelineFrame;
    const timeNs = data.clockTimeNs ?? data.timeNs;
    if (!context || !Number.isFinite(pipelineFrame) || !(timeNs > 0)) return;
    const now = performance.now();
    const engineMs = timeNs / 1e6;
    this.clockOffsets.push(now - engineMs);
    if (this.clockOffsets.length > 100) this.clockOffsets.shift();
    const time = engineMs + Math.min(...this.clockOffsets);
    this.frameOffset = Math.round((context.currentTime - (now - time) / 1000) * context.sampleRate - pipelineFrame);
    this.clock = {...this.clock,...(data.clockTimeNs ? {} : data),pipelineFrame,time};
  }
  getEngineClock() {
    if (!this.clock) return null;
    return {frame:this.clock.pipelineFrame,time:this.clock.time};
  }
  toEngineFrame(frame) { return Math.max(0,Math.round(frame - (this.frameOffset || 0))); }
  _getDeviceLatencyFrames(context) {
    if (!context || !this.session) return 0;
    const frames = this.clock?.outputLatencyFrames ?? this.session.outputLatencyFrames ?? 0;
    return frames * context.sampleRate / this.session.deviceRate + (this.clock?.outputConverterDelayFrames || 0);
  }
  getOutputLatencySeconds(includeFeed = false) {
    if (!this.audioContext) return 0;
    const feed = includeFeed ? FEED_BATCH_FRAMES + (this.clock?.feedDelayFrames || 0) : 0;
    return (this._getDeviceLatencyFrames(this.audioContext) + feed) / this.audioContext.sampleRate;
  }
  getAudibleContextMs() {
    return ((this.audioContext?.currentTime || 0) - this.getOutputLatencySeconds()) * 1000;
  }
  _visualSyncNow() {
    const network = this.visualSyncEnabled && (this.networkRoute?.receiveId != null ||
      this._networkOutputLocalDelay?.active && (this.networkRoute?.sendId != null || this._appliedNetworkDelay?.syncDelayMs > 0));
    return network ? (this.audioContext?.currentTime || 0) * 1000 : this.getAudibleContextMs();
  }
  getAudiblePlaybackPosition(position,playbackSpeed) {
    return audiblePlaybackPosition({position,playbackSpeed,latencySeconds:this.getOutputLatencySeconds(true) +
      (this.audioContext ? this.getTotalPipelineLatencySamples() / this.audioContext.sampleRate : 0)});
  }
  setNetworkOutputPort(port) { port?.close(); }
  getNativeSampleRate() { return this.session?.sampleRate || this.audioContext?.sampleRate || 48000; }
  failOutput(reason = 'stopped') {
    this.failed = true;
    this.engineLifetime.abort(new Error('The audio driver stopped'));
    this._cancelPendingDspControlRequests();
    this.resetClock();
    this.dspCapabilities = window.dspCapabilities = null;
    this.outputErrorKey = 'dialog.audioConfig.driver.' + reason;
    window.uiManager?.setError?.(this.outputErrorKey,true);
  }
  _setAudioPreferencesMirror(preferences) {
    super._setAudioPreferencesMirror(preferences);
    this.preferences = preferences;
  }
  _applyEffectiveOutputPreferences(changes) {
    const current = window.electronIntegration?.audioPreferences || window.audioPreferences || this.preferences;
    this._setAudioPreferencesMirror({...current,...changes});
  }
  async openDefaultOutput() {
    const settings = {...this.openSettings,outputDeviceId:'default'};
    const result = await this.request(settings,'sessionState',s => s.state === 'open' || s.state === 'failed');
    if (result.state === 'open') {
      this.openSettings = settings;
      this.ioManager.currentOutputDeviceId = 'default';
      const fallback = {outputDeviceId:'default',outputDeviceLabel:''};
      this._applyEffectiveOutputPreferences(fallback);
      await saveAudioPreferences(true,fallback,{applyInPlace:'output-device-fallback'});
    }
    return result;
  }
  async attachPorts(driver) {
    const token = crypto.randomUUID();
    const received = waitForEvent(window,'message',event => event.source === window &&
      event.data?.type === 'effetune-audio-engine-ports' && event.data.token === token && event.ports.length === 2,
      15000,this.engineLifetime.signal);
    // Both waits settle independently if the main process cannot launch the driver.
    const [result, event] = await Promise.all([this.bridge.start(driver,token).then(status => {
      if (!status.ok) throw new Error('Audio driver unavailable');
      return status;
    }),received]);
    if (!result.ok) return;
    [this.control,this.feedPort] = event.ports;
    this.control.onmessage = ({data}) => this.receive(data);
  }
  receive(data) {
    this.observeClock(data);
    if (Array.isArray(data.checkpoints)) {
      try { data = unpackCheckpoints(data); }
      catch (error) { console.warn('Audio sampler response:',error); return; }
    }
    if (data.type === 'sessionState' && data.state === 'open') {
      const widthChanged = this.tap && this.session.width !== data.width;
      this.expectRecovery = false;
      this.session = data;
      this.contextManager.outputChannelCount = data.width;
      this._applyEffectiveOutputPreferences({outputChannels:data.outputChannels});
      if (widthChanged) {
        // Preserve the player's AudioContext, source connections and feed port.
        // The new generation discards any partially collected old-width PCM.
        this.tap.channelCount = data.width;
        for (const endpoint of this.endpoints) if (endpoint) endpoint.channelCount = data.width;
        this.flushFeed();
      }
    } else if (data.type === 'deviceReset' && data.direction === 'output') {
      this.expectRecovery = true;
      this.resetClock();
    } else if (data.type === 'sessionState' && data.state === 'failed' && this.expectRecovery) {
      this.expectRecovery = false;
      if (data.reason === 'unavailable' && this.openSettings?.outputDeviceId !== 'default') {
        // Dispatch this failed open before registering the fallback open's waiter.
        void Promise.resolve().then(() => this.openDefaultOutput()).then(result => {
          if (result.state !== 'open') this.failOutput(DEVICE_ERRORS[result.reason] || 'stopped');
        }).catch(error => { console.warn('Audio output recovery:',error); this.failOutput(); });
      } else this.failOutput(DEVICE_ERRORS[data.reason] || 'stopped');
    } else if (data.type === 'dspReady') {
      if (data.branch && (data.requestId !== this.parallelRequest || !this.endpoints[data.branch])) return;
      this.ready ??= [];
      this.ready[data.branch || 0] = data;
      const endpoint = this.endpoints[data.branch || 0];
      if (endpoint?.port.pendingCommands) {
        for (const message of endpoint.port.pendingCommands) this.send(message);
        delete endpoint.port.pendingCommands;
      }
      if (!data.branch && endpoint && data.recoveryId > 0) {
        void this.restorePrimary(data).catch(error => {
          if (this.session.recoveryId !== data.recoveryId) return;
          console.warn('Native audio recovery:',error);
          this.failOutput();
        });
      } else if (endpoint) this.restoreEndpoint(endpoint,data);
    } else if (data.type === 'inputState') {
      if (!data.requestId || data.requestId === this.inputRequest) {
        if (!this.ioManager.inputStream)
          this.ioManager.setInput(data.state,!data.requestId && !!this.tap,data.reopened);
        if (data.state === 'failed') {
          this.inputWarning = data.reason === 'permission' ? 'error.microphoneAccessDenied' : 'browser.deviceError';
          window.uiManager?.setError?.(this.inputWarning,true);
        }
      }
    } else if (data.type === 'dspTelemetry') {
      const offset = this.frameOffset || 0;
      data.contextFrameOffset = (data.contextFrameOffset || 0) + offset;
      if (Number.isFinite(data.endFrame)) data.endFrame += offset;
      if (Number.isFinite(data.mixerEndFrame)) data.mixerEndFrame += offset;
      this.endpoints[data.branch || 0]?.port.receive(data);
    } else if (data.type === 'spectrumOverlay') {
      const message = unpackSpectrumOverlay(data);
      if (message && !data.branch) {
        const offset = this.frameOffset || 0;
        message.endFrame += offset;
        if (message.timing) message.timing.captureEndFrame = Math.max(0,message.timing.captureEndFrame + offset);
        this.endpoints[0]?.port.receive(message);
      }
    } else if (data.type === 'engineFailure') {
      console.error('Native audio engine stopped:',data.reason);
      this.failOutput();
    } else if (data.type !== 'commandRejected' && data.type !== 'endpointRetired') {
      if (data.type === 'processBufferSynced' && Number.isFinite(data.endFrame)) data.endFrame += this.frameOffset || 0;
      this.endpoints[data.branch || 0]?.port.receive(data);
    }
    this.engineEvents.dispatchEvent(new CustomEvent(data.type,{detail:data}));
  }
  async initAudio(preferences = null) {
    try {
      this.preferences = preferences || await this.contextManager._loadAudioPreferences() || {};
      await this.attachPorts(this.preferences.audioDriver);
      const contextError = await this.contextManager.initAudioContext(this.preferences,{nativeFeed:true});
      if (contextError) throw new Error(contextError);
      this.audioContext = this.contextManager.audioContext;
      const input = this.preferences.inputDeviceId || 'default';
      const hardwareInput = ![NO_AUDIO_INPUT_DEVICE_ID,SYSTEM_AUDIO_INPUT_DEVICE_ID].includes(input);
      const permission = !hardwareInput || await window.electronAPI.requestMicrophoneAccess();
      const settings = {type:'openSession',sampleRate:this.audioContext.sampleRate,
        outputChannels:this.preferences.outputChannels || 2,outputDeviceId:this.preferences.outputDeviceId || 'default',
        inputDeviceId:hardwareInput && permission ? input : '',latency:this.preferences.latencyHint || 'interactive'};
      this.openSettings = settings;
      let opened = await this.request(settings,'sessionState');
      if (opened.state !== 'open' && opened.reason === 'unavailable' &&
          settings.outputDeviceId !== 'default') {
        opened = await this.openDefaultOutput();
      }
      if (opened.state !== 'open') {
        this.outputErrorKey = 'dialog.audioConfig.driver.' + (DEVICE_ERRORS[opened.reason] || 'startFailed');
        throw new Error(`Audio device could not open: ${opened.reason}`);
      }
      this.send({type:'fadeOutput',gain:0,duration:0});
      this.ioManager.currentOutputDeviceId = this.openSettings.outputDeviceId;
      this.ioManager.setInput(opened.inputFailed ? 'failed' : opened.inputChannels ? 'acquired':'none');
      await this.audioContext.audioWorklet.addModule(new URL('./feed-worklet.js',import.meta.url));
      this.tap = new AudioWorkletNode(this.audioContext,'effetune-native-feed',{
        numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],
        channelCount:opened.width,channelCountMode:'explicit',channelInterpretation:'discrete',
        processorOptions:{channels:opened.width,frames:FEED_BATCH_FRAMES}
      });
      this.tap.connect(this.audioContext.destination);
      this.tap.port.postMessage({port:this.feedPort,generation:this.feedGeneration},[this.feedPort]);
      this.feedPort = null;
      this.contextManager.workletNode = this.makeEndpoint(0);
      window.workletNode = this.contextManager.workletNode;
      this.updateExposedProperties();
      this._primaryWorkletEpoch++;
      this._advanceAudioGraphGeneration();
      this.telemetryHub.setPort(this.workletNode.port);
      this._networkOutputPortRequester?.();
      if (this.ready?.[0]) this.restoreEndpoint(this.workletNode,this.ready[0]);
      if (input === SYSTEM_AUDIO_INPUT_DEVICE_ID) {
        await this.ioManager.initAudioInput(this.preferences);
        this.connectSourceToPipeline(this.ioManager.sourceNode);
      }
      if (!permission) this.inputWarning = 'error.microphoneAccessDenied';
      await this.audioContext.resume();
      this.failed = false;
      return '';
    } catch (error) {
      this.failed = true;
      this.engineLifetime.abort(error);
      console.warn('Native audio initialization:',error);
      await this.bridge.stop();
      this.outputErrorKey ||= 'dialog.audioConfig.driver.startFailed';
      return 'Audio Error: ' + this.outputErrorKey;
    }
  }
  makeEndpoint(branch) {
    const port = new EnginePort(this,branch);
    const endpoint = {port,context:this.audioContext,channelCount:this.getOutputChannelCount()};
    port.onmessage = event => {
      if (event.data.type === 'dspReady') return;
      if (branch) this._handleParallelWorkletMessage(event,endpoint);
      else this.handleWorkletMessage(event,endpoint);
    };
    this.endpoints[branch] = endpoint;
    return endpoint;
  }
  restoreEndpoint(endpoint,data,configure = !this._parallelPreparing) {
    this._dspCapabilitiesByNode.set(endpoint,data);
    this._nextDspReadyToken(endpoint);
    if (!endpoint.port.branch) window.dspCapabilities = this.dspCapabilities = data;
    if (configure) {
      endpoint.port.configure();
      const plugins = endpoint.port.branch ? this.pipelineB || [] : this.pipeline;
      this._syncWasmAssetMembership(endpoint,plugins,{replayNew:false});
      this._replayPipelineWasmAssets(endpoint,plugins,{trackState:!endpoint.port.branch});
    }
    this._postNetworkOutputLocalDelay(endpoint);
    this._postNetworkReceiveSession(endpoint);
    endpoint.port.postMessage({type:'dspSetTelemetryRate',hz:this.getDspTelemetryRate()});
    if (!endpoint.port.branch) this._postVisualizerSources(endpoint);
    endpoint.port.postMessage({type:'setVisualSync',enabled:this.visualSyncEnabled});
    this._appliedOutputDelayFrames?.delete(endpoint);
    void this._applyWorkletOutputDelays([endpoint]);
    this.powerPolicyController?._configureWorklets?.();
    endpoint.port.receive(data);
    this.dispatchEvent('dspReady', data);
  }
  async restorePrimary(data) {
    const current = () => this.session.recoveryId === data.recoveryId && !this.failed;
    for (const node of this.endpoints) node?.port.close();
    this.endpoints.length = 0;
    this._parallelWorkletB = null;
    this._parallelPreparing = this._parallelActive = false;
    const primary = this.makeEndpoint(0);
    this.contextManager.workletNode = window.workletNode = primary;
    this.updateExposedProperties();
    this._primaryWorkletEpoch++;
    this._advanceAudioGraphGeneration();
    this._pruneInactiveDspWorklets();
    this.telemetryHub.setPort(primary.port);
    this.networkRoute = this.networkPaths = null;
    this.telemetryHub.routeRevision = -1;
    this.restoreEndpoint(primary,data,false);
    this.send({type:'setInputMix',enabled:this.inputMixEnabled === true});
    // The device keeps its recovery gate closed while real callbacks install
    // assets, prepare instruments and settle both Double-Blind Test branches.
    const stream = await this.request({type:'startStream'},'sessionState',s => s.state === 'running' || s.state === 'failed');
    if (!current()) return;
    if (stream.state !== 'running') throw new Error('The replacement audio stream could not start');
    const ready = this.parallelIntent ? await this.enableParallelPipelines(this.parallelIntent) : await this.preparePrimary(primary);
    if (!current()) return;
    if (!ready || !await this.waitForSfzRuntimeStarts()) throw new Error('Instrument or pipeline recovery failed');
    const player = window.uiManager?.audioPlayer?.contextManager;
    if (player?.midiTimeline && !await player.restoreMidiAfterDeviceReset(current))
      throw new Error('MIDI transport recovery failed');
    if (!current()) return;
    this.resumeSfzRuntimes();
    this._syncLiveMidiInputTargets();
    await this._applyWorkletOutputDelays([...this._getActiveDspWorklets()]);
    if (await this._networkOutputPortRequester?.() === false) throw new Error('Network audio registration failed');
    if (!current()) return;
    const delay = this._networkOutputLocalDelay;
    const requestId = this._networkDelayRequestId + 1;
    const localReady = this.waitFor('networkDelayApplied',m => !m.branch && m.requestId >= requestId);
    this.setNetworkOutputLocalDelay(delay.active,delay.delayMs,delay.localEnabled,delay.syncDelayMs,delay.syncRevision);
    await localReady;
    if (!current()) return;
    if (!await this._requestDspControl(primary,'awaitOutputReady','outputReady',{},DRIVER_RESPONSE_TIMEOUT_MS))
      throw new Error('Replacement audio output did not become ready');
    if (!current()) return;
    this.send({type:'fadeOutput',gain:this.outputTarget ?? 0,duration:0});
    const result = await this.request({type:'releaseRecovery',recoveryId:data.recoveryId},'recoveryReleased',
      m => m.recoveryId === data.recoveryId);
    if (!current()) return;
    if (!result.accepted) throw new Error('Replacement audio output was not released');
    if (!this.streamRequested) await this.streamState(false);
  }
  async preparePrimary(primary) {
    const deadline = Date.now() + 15000;
    do {
      const pipeline = this.pipeline;
      const initial = this._createBlindBranchSnapshot(pipeline);
      if (!await this._waitForPendingExternalAssetDescriptors(initial.assetReadinessPlugins,deadline)) return false;
      const snapshot = this._createBlindBranchSnapshot(this.pipeline);
      if (!await this.prepareBranch(primary,snapshot,deadline) || primary !== this.workletNode) return false;
      if (this._isBlindBranchSnapshotCurrent(snapshot,this.pipeline)) return true;
    } while (Date.now() < deadline);
    return false;
  }
  initializeAudioWorklet() { return this.failed ? 'Audio Error: unavailable' : ''; }
  prefetchDspModule() { return Promise.resolve(null); }
  async estimateSfzEffectPreparation(payload,context,formatTag) {
    // The desktop engine renders the instrument. Its existing offline sizing
    // worker uses the matching module to prepare assets for that engine.
    this.dspModuleInfo ??= await this._loadEnabledDspModule(this.preferences);
    return super.estimateSfzEffectPreparation(payload,context,formatTag);
  }
  registerPipelineProcessors() {}
  isDspReady() { return !!this.dspCapabilities && !this.failed; }
  _buildBlindPluginData(pipeline) {
    const data = super._buildBlindPluginData(pipeline);
    for (const [index,item] of data.entries()) item.assetPending = pipeline[index].externalAssetInfo?.pending === true;
    return data;
  }
  async waitForDspActivationBeforeOutput() {
    if (!this.control || this.failed) return false;
    try {
      if (!this.isDspReady()) await this.waitFor('dspReady',data => !data.branch);
      // Instrument preparation also waits for the engine here, before its
      // descriptor exists. Output activation waits for the resulting assets.
      if (this.streamRequested || await this.streamState(true)) return true;
    } catch (error) { console.warn('Native audio startup:',error); }
    if (!this.failed) this.failOutput();
    return false;
  }
  async fadeInOutputWhenReady() {
    if (this.failed || !this.control) return;
    const owner = this._captureOutputOwner();
    try {
      if (!await this.streamState(true)) throw new Error('The output stream did not start');
      // During normal startup each effect already publishes its assets to this
      // endpoint. A missing measurement affects its effect, not the output device.
      const primary = this.workletNode;
      await this.applyBranchPipeline(primary);
      if (!await this._requestDspControl(primary,'awaitOutputReady','outputReady',{},DRIVER_RESPONSE_TIMEOUT_MS))
        throw new Error('The audio engine did not confirm the published output');
      if (!this.failed) this._fadeInOutputIfOwned(owner);
    } catch (error) {
      if (!this.failed && this._isOutputOwnerCurrent(owner)) {
        console.error('Native audio output activation failed:',error);
        this.failOutput();
      }
    }
  }
  fadeInOutput(duration = .05) {
    this.ioManager.powerOutputStructurallyZero = false;
    this.send({type:'fadeOutput',gain:1,duration});
    this._setAudioProcessingOverloadMonitoring(true,duration);
  }
  fadeOutOutput(duration = .05) {
    this._setAudioProcessingOverloadMonitoring(false);
    this.send({type:'fadeOutput',gain:0,duration});
    return ++this._outputFadeToken;
  }
  async rebuildPipeline(_isInitializing = false, {gate = false} = {}) {
    if (!this.workletNode) return '';
    this.updateExposedProperties();
    this._configureOwnedPipelineWasmAssetResolvers();
    this.workletNode.port.configure(undefined,undefined,gate);
    this.syncPrimaryWasmAssetMembership?.();
    this.powerPolicyController?.notifyTopologyChanged?.('pipeline-rebuild');
    return '';
  }
  connectSourceToPipeline(node) {
    if (!node || !this.tap) return false;
    if (node === this.ioManager.silentSource) return true;
    if (node === this.ioManager.deviceSource) {
      this.send({type:'setInputMix',enabled:true});
      this.ioManager.inputRouteConnected = true;
    } else if (!this._connectedPipelineSources.has(node)) {
      node.connect(this.tap);
      this._connectedPipelineSources.add(node);
      if (node === this.ioManager.inputSourceNode) this.ioManager.inputRouteConnected = true;
    }
    return true;
  }
  isSourceConnectedToPipeline(node) {
    if (node === this.ioManager.silentSource) return true;
    if (node === this.ioManager.deviceSource) return this.ioManager.inputRouteConnected;
    return super.isSourceConnectedToPipeline(node);
  }
  disconnectSourceFromPipeline(node) {
    if (!node || node === this.ioManager.silentSource) return;
    if (node === this.ioManager.deviceSource) this.send({type:'setInputMix',enabled:false});
    else if (this._connectedPipelineSources.delete(node)) {
      try { node.disconnect(this.tap); } catch { /* Edge already disconnected by its owner. */ }
    }
    if (node === this.ioManager.inputSourceNode) this.ioManager.inputRouteConnected = false;
  }
  async replaceInput(id,timeoutMs = 15000) {
    const requestId = ++this.inputRequest;
    const allowed = id === NO_AUDIO_INPUT_DEVICE_ID || await window.electronAPI.requestMicrophoneAccess();
    if (requestId !== this.inputRequest) throw this.ioManager._createStaleInputAcquisitionError();
    const result = this.waitFor('inputState',data => data.requestId === requestId,timeoutMs);
    const inputDeviceId = allowed && id !== NO_AUDIO_INPUT_DEVICE_ID ? id : '';
    this.send({type:'replaceInput',inputDeviceId,
      latency:this.preferences.latencyHint,requestId});
    const {detail} = await result;
    if (requestId !== this.inputRequest) throw this.ioManager._createStaleInputAcquisitionError();
    this.openSettings = {...this.openSettings,inputDeviceId};
    if (!allowed) throw new DOMException('Microphone access denied','NotAllowedError');
    return detail;
  }
  flushFeed() {
    this.feedGeneration++;
    this.send({type:'flushFeed',generation:this.feedGeneration});
    this.tap?.port.postMessage({generation:this.feedGeneration,channels:this.tap.channelCount});
  }
  async reset(preferences = null) {
    const saved = window.electronIntegration?.audioPreferences || window.audioPreferences;
    if (!this.failed && this._canApplySilentInputInPlace(saved,preferences)) {
      return super._executeReset(preferences);
    }
    if (preferences) {
      if (!await saveAudioPreferences(true,preferences)) return 'Audio Error: settings';
    } else await window.app.reloadWithPipelineState();
    return '';
  }
  async applyBranchPipeline(endpoint,pluginData) {
    const port = endpoint.port;
    const revision = port.revision + 1;
    const applied = this.waitFor('pipelineApplied',data => data.branch === port.branch && data.revision === revision);
    port.configure(pluginData);
    await applied;
  }
  async prepareBranch(endpoint,snapshot,deadline) {
    const port = endpoint.port;
    await this.applyBranchPipeline(endpoint,snapshot.pluginData);
    const generation = this._audioGraphGeneration;
    this._syncWasmAssetMembership(endpoint,snapshot.plugins,{generation,replayNew:false});
    const target = await this._prepareWasmAssetMapsForTarget(endpoint,snapshot.plugins,
      {generation,assetMaps:snapshot.assetMaps});
    if (!target) return false;
    const expected = this._replayPipelineWasmAssets(endpoint,snapshot.plugins,{generation,
      assetMaps:target.assetMaps,assetReadinessPlugins:snapshot.assetReadinessPlugins,trackState:!port.branch});
    return expected !== null && this._waitForWasmAssetsActive(endpoint,expected,generation,deadline - Date.now());
  }
  async enableParallelPipelines(selection = 'A') {
    if (!this.isDspReady()) return false;
    this.parallelIntent = selection;
    if (this._parallelActive) { this.setBlindSelection(selection); return true; }
    this._parallelWorkletB = this.makeEndpoint(1);
    const requestId = ++this.parallelRequest;
    this.ready[1] = null;
    this._parallelWorkletB.port.pendingCommands = [];
    this._parallelPreparing = true;
    const snapshot = this._createParallelBranchSnapshot();
    const deadline = Date.now() + 15000;
    const primary = this.workletNode, secondary = this._parallelWorkletB;
    const barrier = this._createParallelDspBarrier([primary,secondary]);
    try {
      await this.request({type:'startParallel',selection:'A',requestId},'dspReady',
        m => m.branch === 1 && m.requestId === requestId);
      if (secondary !== this._parallelWorkletB) return false;
      this.send({type:'fadeOutput',branch:1,gain:this.outputTarget ?? 0,duration:0});
      this._postNetworkOutputSendPaused(primary,true);
      if (!await this._waitForParallelBranchAssets(snapshot,deadline)) throw new Error('Branch assets unavailable');
      const prepared = await Promise.all([this.prepareBranch(primary,snapshot.pipelineA,deadline),
        this.prepareBranch(secondary,snapshot.pipelineB,deadline)]);
      if (!prepared.every(Boolean) || !this._isParallelBranchSnapshotCurrent(snapshot) ||
          !await this._alignParallelPipelineLatency(barrier,primary,secondary,deadline))
        throw new Error('Branches could not be aligned');
      this._parallelActive = true;
      this._settleParallelDspBarrier(barrier,'native');
      this.setBlindSelection(this.parallelIntent,0);
      this.powerPolicyController?._configureWorklets?.();
      return true;
    } catch (error) {
      if (secondary === this._parallelWorkletB) {
        console.warn('Parallel audio startup:',error);
        await this.disableParallelPipelines();
      }
      return false;
    } finally { if (secondary === this._parallelWorkletB) this._parallelPreparing = false; }
  }
  setBlindSelection(selection,duration = .03) {
    if (!this._parallelActive) return;
    this.send({type:'setBlindSelection',branch:1,selection,duration});
    this._parallelSelection = this.parallelIntent = selection;
  }
  async disableParallelPipelines() {
    this.parallelIntent = null;
    if (this._parallelWorkletB) {
      this.send({type:'stopParallel',branch:this.ready?.[1] ? 1 : 0});
      this._parallelWorkletB.port.close();
      this._wasmAssetMembershipByNode?.delete(this._parallelWorkletB);
      this._dbtOutputDelayFrames?.delete(this._parallelWorkletB);
    }
    if (this._parallelDspBarrier) this._settleParallelDspBarrier(this._parallelDspBarrier,'cancelled');
    this._parallelDspBarrier = null;
    this._disposeParallelBranchSnapshot(this._parallelBranchSnapshot);
    this.endpoints.length = 1;
    this._parallelWorkletB = null;
    this._parallelActive = false;
    this._parallelPreparing = false;
    this._pruneInactiveDspWorklets();
    this._dbtOutputDelayFrames?.delete(this.workletNode);
    this._postNetworkOutputSendPaused(this.workletNode,false);
    await this.rebuildPipeline();
    if (this.workletNode) await this._applyWorkletOutputDelays([this.workletNode]);
    this.powerPolicyController?._configureWorklets?.();
    return true;
  }
}
