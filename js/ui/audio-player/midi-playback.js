import { readScoreArtwork } from './score-artwork-source.js';
import { isScoreFile, isMusicXmlFile, parseScoreAsync, SCORE_MAX_BYTES } from '../../midi/score-file.js';
import { validateMidiSchedule } from '../../midi/smf-scheduler.js';
import { MidiFileOutput } from '../../midi/midi-file-output.js';
import { audibleContextTime } from '../../audio/visual-sync.js';
import { readMidiWrdBytes } from './midi-wrd-source.js';

const MIDI_INSTRUMENT_TYPE = 'SoundFontPlayerPlugin';

// Connected external output selected in Audio Configuration, or null.
const selectedMidiOutput = () => globalThis.window?.midiControllerManager?.getSelectedOutput?.() ?? null;

function scoreFileName(track) {
  if (typeof track === 'string') return track;
  return track?.file?.name ?? track?.fileName ?? track?.path ?? track?.name ?? '';
}

function* enabledMidiInstruments(pipeline) {
  let sectionEnabled = true;
  for (const plugin of pipeline) {
    if (plugin.constructor.name === 'SectionPlugin') { sectionEnabled = plugin.enabled !== false; continue; }
    if (plugin.constructor.name === MIDI_INSTRUMENT_TYPE && plugin.enabled && sectionEnabled) yield plugin;
  }
}

function isRuntimeRetiredMidiTarget(manager, plugin, node) {
  if (!node || manager._isActiveDspWorklet?.(node) !== true ||
      manager._wasmAssetMembershipByNode?.get(node)?.get(plugin.id) !== plugin) return false;
  const identity = manager._getSfzRuntimeAssetIdentity?.(node, plugin.id);
  // The status callback established this fact from a current ACTIVE -> ERROR.
  // Internal replay must not revive it under the same user asset revision.
  return Number.isSafeInteger(identity?.token) && plugin._runtimeAssetErrorRevision === identity.token;
}

export const midiPlaybackMethods = {
  async prepareMidiTrack(playableTrack, descriptor, isStale) {
    const fileName = scoreFileName(playableTrack);
    if (descriptor.byteLength > SCORE_MAX_BYTES) {
      const error = new Error('This score file is too large to open.');
      error.code = isMusicXmlFile(fileName) ? 'musicxml-too-large' : 'midi-too-large';
      throw error;
    }
    const bytes = await this.loadTrackData(descriptor, isStale, true);
    if (!bytes || isStale()) return null;
    let wrdBytes = null;
    let lyricsWarning = false;
    try {
      wrdBytes = await readMidiWrdBytes(playableTrack, this.audioPlayer);
    } catch (error) {
      console.debug('MIDI lyrics sidecar could not be loaded:', error);
      lyricsWarning = true;
    }
    if (isStale()) return null;
    const timeline = await parseScoreAsync(bytes.slice(0), {
      fileName,
      languageHints: this.getMetadataRepairHints?.(), wrdBytes
    });
    if (isStale()) return null;
    if (lyricsWarning || timeline.lyricsWarning) {
      globalThis.window?.uiManager?.showTransientMessage?.('midi.error.lyricsUnavailable', false, {}, 7000);
    }
    try {
      timeline.picture = await readScoreArtwork(playableTrack);
    } catch (error) {
      console.debug('Score cover image could not be loaded:', error);
    }
    if (isStale()) return null;
    validateMidiSchedule(timeline, this.audioPlayer.audioContext.sampleRate);
    return timeline;
  },

  prepareMidiTransitionCandidate(prepared, sourceGeneration) {
    const context = this.audioPlayer.audioContext;
    const source = context.createBufferSource();
    // A one-frame stereo loop keeps input quanta running without song-length PCM.
    source.buffer = context.createBuffer(2, 1, context.sampleRate);
    source.loop = true;
    this.preparePlaybackSource(source);
    if (!this.connectPrivatePipelineSource(source)) {
      this.releasePipelineSource(source, true);
      throw new Error('MIDI playback could not connect to the audio pipeline');
    }
    source.start();
    return { mode: 'midi', backend: 'midi', source, sourceGeneration,
      timeline: prepared.midiTimeline, committed: false, cleaned: false };
  },

  getMidiWorklets() {
    const nodes = this.audioManager._getActiveDspWorklets?.();
    return nodes ? [...nodes] : [this.audioManager.workletNode].filter(Boolean);
  },

  *getMidiInstrumentTargets() {
    const manager = this.audioManager;
    for (const node of this.getMidiWorklets()) {
      if (manager._isActiveDspWorklet?.(node) !== true) continue;
      const membership = manager._wasmAssetMembershipByNode?.get(node);
      for (const plugin of enabledMidiInstruments(membership?.values() ?? [])) yield { node, plugin };
    }
  },

  postMidiTransport(playing, position = this.getCurrentMidiTime(), { preparing = false, mode = 'reset', generation = null, timeline = this.midiTimeline, preservePresentation = false } = {}) {
    this.midiOutput?.stop();
    const context = this.audioPlayer.audioContext;
    const nextGeneration = generation ?? this.audioManager.nextMidiGeneration?.(this.midiGeneration) ?? (this.midiGeneration ?? 0) + 1;
    if (this.midiPreparation && this.midiPreparation.generation !== nextGeneration) this.midiPreparation.finish(false);
    const speed = this.getCurrentState()?.playbackSpeed ?? 1;
    const anchorTime = (context?.currentTime ?? 0) + (playing ? 0.02 : 0);
    if (!preservePresentation) {
      this.midiPosition = position;
      this.midiSpeed = speed;
      this.midiPlaying = playing;
      this.midiAnchorTime = anchorTime;
    }
    this.midiGeneration = nextGeneration;
    if (mode === 'reset' || mode === 'live') {
      if (this.audioManager.visualSyncEnabled) this.audioManager.telemetryHub?.clearVisualSyncQueue?.();
      this.midiCheckpointRequest?.finish(false);
      this.audioManager.clearSfzRuntimeCheckpoints?.({ types: [MIDI_INSTRUMENT_TYPE] });
      this.midiRebindCheckpoint = null;
      this.midiCheckpointAvailable = false;
      this.midiCheckpointTimeline = null;
    }
    this.midiEndNotified = false;
    this.midiPorts ??= new Map();
    const nodes = this.getMidiWorklets();
    for (const [node, listener] of this.midiPorts) if (!nodes.includes(node)) {
      node.port.removeEventListener?.('message', listener);
      this.midiPorts.delete(node);
    }
    for (const node of nodes) {
      if (!this.midiPorts.has(node)) {
        const listener = ({ data }) => {
          const checkpointRequest = this.midiCheckpointRequest;
          if (checkpointRequest && checkpointRequest.generation === data.generation && checkpointRequest.nodes.has(node)) {
            if (data.type === 'midiCheckpointError') { checkpointRequest.finish(false); return; }
            if (data.type === 'midiPauseReady') {
              if (!Number.isFinite(data.position) || data.position < 0 || data.position > this.midiTimeline.duration) {
                checkpointRequest.finish(false); return;
              }
              checkpointRequest.positions.set(node, data.position);
              try { node.port.postMessage({ type: 'midiCaptureCheckpoint', generation: data.generation }); }
              catch (error) { console.error('MIDI checkpoint request failed:', error); checkpointRequest.finish(false); }
              return;
            }
            if (data.type === 'midiCheckpoints') {
              if (data.position !== checkpointRequest.positions.get(node) || !Array.isArray(data.checkpoints)) {
                checkpointRequest.finish(false); return;
              }
              checkpointRequest.packets.set(node, data.checkpoints);
              if (checkpointRequest.packets.size === checkpointRequest.nodes.size) checkpointRequest.finish(true);
              return;
            }
          }
          const preparation = this.midiPreparation;
          if (data.type === 'midiPrepared' && preparation && preparation.generation === data.generation) {
            preparation.nodes.delete(node);
            if (!preparation.nodes.size) preparation.finish(true);
            return;
          }
          if (data.type === 'assetState' || data.type === 'midiTransportError' && data.pluginId !== undefined) {
            const manager = this.audioManager;
            const target = [...this.getMidiInstrumentTargets()].find(item => item.node === node && item.plugin.id === data.pluginId);
            const expected = manager._getSfzRuntimeAssetIdentity?.(node, data.pluginId);
            if (!target || (data.slot ?? 0) !== 0 || !Number.isSafeInteger(expected?.token) || expected.token <= 0 ||
                expected?.token !== data.operationRevision ||
                (expected?.replayEpoch ?? null) !== (data.replayEpoch ?? null)) return;
            // Asset status belongs to an asset operation, not a song generation.
            if (data.type === 'assetState') {
              if (this.midiPlaying && (data.state & 255) < 3) this.showMidiInstrumentNotice();
              return;
            }
          }
          if (data.generation !== this.midiGeneration || !this.getMidiWorklets().includes(node)) return;
          if (data.type === 'midiTransportError' && data.pluginId !== undefined) {
            const manager = this.audioManager;
            const key = manager._wasmAssetKey?.(data.pluginId, 0) ?? `${data.pluginId}:0`;
            if ((manager._wasmAssetStatesByNode?.get(node)?.get(key) & 255) !== 4) return;
            if (this.hasHealthyMidiInstruments()) return;
          } else if (node !== this.audioManager.workletNode) return;
          if (data.type === 'midiPosition' && Number.isFinite(data.position) && data.position >= 0) {
            this.midiPosition = Math.min(data.position, this.midiTimeline?.duration ?? 0);
            this.midiOutput?.pump(data.generation);
          } else if (data.type === 'midiEnded' && this.midiPlaying && !this.midiEndNotified) {
            this.midiOutput?.finish(data.generation);
            this.midiEndNotified = true;
            this.midiNaturalTail = true;
            this.midiPosition = this.midiTimeline?.duration ?? 0;
            this.midiPlaying = false;
            this.handleTrackEnded();
          } else if (data.type === 'midiTransportError') {
            console.error('MIDI playback failed:', data.detail);
            void this.pauseMidi({ sourceFailure: true });
            this.reportPlaybackSourceFailure(new Error('MIDI playback failed'));
          }
        };
        node.port.addEventListener?.('message', listener);
        node.port.start?.();
        this.midiPorts.set(node, listener);
      }
      node.port.postMessage({ type: 'midiTransport', timeline,
        position, speed, playing, preparing, generation: this.midiGeneration,
        anchorFrame: Math.round(anchorTime * context.sampleRate),
        delayFrames: playing ? Math.round(.02 * context.sampleRate) : 0,
        gain: this.playerMute ? 0 : this.playerVolume / 100,
        preserveRelease: this.midiNaturalTail === true, mode,
        ...(mode === 'resume' && { checkpoints: this.getMidiCheckpointForNode(node) }) });
    }
    return this.midiGeneration;
  },

  getMidiCheckpointForNode(node) {
    const eligible = new Set([...this.getMidiInstrumentTargets()]
      .filter(target => target.node === node && !isRuntimeRetiredMidiTarget(this.audioManager, target.plugin, node))
      .map(target => target.plugin.id));
    return (this.audioManager.getSfzRuntimeCheckpoints?.(node) ?? [])
      .filter(record => record.type === MIDI_INSTRUMENT_TYPE && eligible.has(record.pluginId));
  },

  hasHealthyMidiInstruments() {
    const manager = this.audioManager;
    for (const { node, plugin } of this.getMidiInstrumentTargets()) {
      if (!plugin.sf || isRuntimeRetiredMidiTarget(manager, plugin, node) ||
          manager.getSfzSamplePreparation?.(plugin, node)) continue;
      const snapshot = manager.getEffectiveActiveWasmAssetSnapshot?.(plugin, [0], { primaryWorklet: node });
      if (snapshot?.ready === true && snapshot.stale !== true) return true;
    }
    return false;
  },

  captureMidiCheckpoints({ sourceFailure = false, preservePendingSeek = false } = {}) {
    this.midiOutput?.stop();
    if (this.midiCheckpointTimeline === this.midiTimeline && this.midiCheckpointAvailable) return Promise.resolve(true);
    if (this.midiPreparation) {
      const pending = this.midiPreparation;
      const position = preservePendingSeek && pending.timeline === this.midiTimeline && !pending.preservePresentation
        ? pending.position ?? this.midiPosition : this.midiPosition;
      this.midiPreparation.finish(false);
      this.postMidiTransport(false, position);
      return Promise.resolve(true);
    }
    const nodes = this.getMidiWorklets();
    if (!this.midiTimeline || !nodes.length) {
      const position = this.getCurrentMidiTime();
      this.postMidiTransport(false, position, { mode: 'pause' });
      this.midiCheckpointTimeline = this.midiTimeline;
      this.midiCheckpointPosition = position;
      this.midiCheckpointAvailable = !sourceFailure;
      return Promise.resolve(true);
    }
    this.midiCheckpointRequest?.finish(false);
    const generation = this.audioManager.nextMidiGeneration?.(this.midiGeneration) ?? (this.midiGeneration ?? 0) + 1;
    const timeline = this.midiTimeline;
    const context = this.audioPlayer.audioContext;
    const anchorFrame = Math.ceil((context.currentTime + .05) * context.sampleRate);
    this.midiGeneration = generation;
    return new Promise(resolve => {
      const request = { generation, nodes: new Set(nodes), positions: new Map(), packets: new Map(), finish: null };
      const guard = setTimeout(() => request.finish(false), 5000);
      request.finish = success => {
        if (this.midiCheckpointRequest !== request) return;
        clearTimeout(guard);
        this.midiCheckpointRequest = null;
        const valid = success && this.midiGeneration === generation && this.midiTimeline === timeline;
        if (valid) {
          const position = request.positions.get(this.audioManager.workletNode) ?? request.positions.values().next().value;
          if ([...request.positions.values()].some(value => Math.abs(value - position) > 1e-9)) { resolve(false); return; }
          try {
            for (const [node, records] of request.packets) {
              if (this.audioManager.storeSfzRuntimeCheckpoints(node, records, { generation, position }) === false) {
                resolve(false); return;
              }
            }
          } catch (error) { console.error('MIDI checkpoint identity changed:', error); resolve(false); return; }
          this.midiPosition = position;
          this.midiPlaying = false;
          const runtimeFailure = sourceFailure || [...this.getMidiInstrumentTargets()]
            .some(({ node, plugin }) => isRuntimeRetiredMidiTarget(this.audioManager, plugin, node));
          this.midiCheckpointAvailable = [...request.packets.values()].some(records => records.length > 0) || !runtimeFailure;
          this.midiCheckpointTimeline = timeline;
          this.midiCheckpointPosition = position;
        }
        resolve(valid);
      };
      this.midiCheckpointRequest = request;
      try {
        for (const node of nodes) node.port.postMessage({ type: 'midiPause', generation, anchorFrame,
          delayFrames: Math.ceil(.05 * context.sampleRate) });
      } catch (error) {
        console.error('MIDI pause request failed:', error);
        request.finish(false);
      }
    });
  },

  async prepareMidiGraphReset() {
    const timeline = this.midiTimeline, stopToken = this.stopRequestToken;
    if (!timeline) return;
    const capture = this.captureMidiCheckpoints({ preservePendingSeek: true });
    const generation = this.midiGeneration;
    const captured = await capture;
    if (timeline !== this.midiTimeline || stopToken !== this.stopRequestToken || generation !== this.midiGeneration) return;
    if (!captured) throw new Error('MIDI instrument state could not be preserved');
    this.midiRebindCheckpoint = { timeline, stopToken, generation, available: this.midiCheckpointAvailable,
      position: this.midiPosition, draining: this.midiNaturalTail === true };
  },

  prepareMidiTransport(position, isCurrent = null, timeline = this.midiTimeline, { preservePresentation = false } = {}) {
    this.midiOutput?.stop();
    this.midiPreparation?.finish(false);
    const nodes = this.getMidiWorklets();
    const resume = this.midiCheckpointAvailable && this.midiCheckpointTimeline === timeline &&
      this.midiCheckpointPosition === position;
    if ((!this.hasHealthyMidiInstruments() && !resume) || !nodes.length) {
      const generation = this.audioManager.nextMidiGeneration?.(this.midiGeneration) ?? (this.midiGeneration ?? 0) + 1;
      this.midiGeneration = generation;
      return new Promise(resolve => {
        const request = { generation, timeline, position, preservePresentation, nodes: new Set(nodes), finish: ready => {
          if (this.midiPreparation !== request) return;
          this.midiPreparation = null;
          resolve(ready && isCurrent?.() !== false);
        } };
        this.midiPreparation = request;
        const current = () => this.midiPreparation === request && this.midiGeneration === generation && isCurrent?.() !== false;
        Promise.resolve().then(async () => {
        for (const { node, plugin } of this.getMidiInstrumentTargets()) {
          if (!current()) { request.finish(false); return; }
          if (typeof plugin.prepareSfzForContext !== 'function' || !plugin.getWasmAssets?.().get(0)) continue;
          const context = await this.audioManager.getSfzPreparationContext(plugin, node, timeline);
          if (!context || !current() || !await plugin.prepareSfzForContext(context, node, current, null, { waitReady: false })) {
            request.finish(false); return;
          }
        }
        if (!current()) { request.finish(false); return; }
        this.postMidiTransport(false, position, { mode: 'live', generation, timeline, preservePresentation });
        request.finish(true);
        }).catch(error => { console.error('Pending instrument context preparation failed:', error); request.finish(false); });
      });
    }
    return new Promise(resolve => {
      const request = { generation: this.audioManager.nextMidiGeneration?.(this.midiGeneration) ?? (this.midiGeneration ?? 0) + 1,
        timeline, position, preservePresentation, nodes: new Set(nodes), finish: null };
      let guard = null;
      request.finish = ready => {
        if (this.midiPreparation !== request) return;
        clearTimeout(guard);
        this.midiPreparation = null;
        resolve(ready && isCurrent?.() !== false);
      };
      this.midiPreparation = request;
      this.midiGeneration = request.generation;
      guard = setTimeout(() => {
        if (this.midiPreparation !== request) return;
        if (preservePresentation) { request.finish(false); return; }
        const current = isCurrent?.() !== false;
        const state = this.getCurrentState();
        this.postMidiTransport(false, position);
        if (current) {
          this.updateState({ isPlaying: false, isPaused: !state?.isStopped,
            currentTrackPosition: position }, 'MIDI preparation timed out');
          window.uiManager?.setError?.('sfzPlayer.error.prepare', true);
        }
      }, 15000);
      const current = () => this.midiPreparation === request && this.midiGeneration === request.generation && isCurrent?.() !== false;
      Promise.resolve().then(async () => {
        const beforeReplay = () => {
          if (!current()) return false;
          if (request.reprepared) return true;
          request.reprepared = true;
          // Omit the timeline so the existing driver stops without installing
          // the candidate map before its new FX capacity is ready.
          for (const node of nodes) node.port.postMessage({ type: 'midiTransport', mode: 'pause',
            position: this.getCurrentMidiTime(), generation: request.generation, playing: false,
            speed: this.midiSpeed ?? 1, gain: this.playerMute ? 0 : this.playerVolume / 100 });
          return true;
        };
        for (const { node, plugin } of this.getMidiInstrumentTargets()) {
          if (!current()) return;
          if (typeof plugin.prepareSfzForContext !== 'function') continue;
          const context = await this.audioManager.getSfzPreparationContext(plugin, node, timeline);
          if (!context || !current() || !await plugin.prepareSfzForContext(context, node, current, beforeReplay)) {
            request.finish(false); return;
          }
        }
        if (current()) this.postMidiTransport(false, position, { preparing: true, mode: resume ? 'resume' : 'reset',
          generation: request.generation, timeline, preservePresentation });
      }).catch(error => {
        console.error('MIDI instrument context preparation failed:', error);
        request.finish(false);
      });
    });
  },

  captureMidiInstrumentDescriptors() {
    return [...this.getMidiInstrumentTargets()].map(({ node, plugin }) =>
      ({ node, plugin, descriptor: plugin.getWasmAssets?.().get(0) })).filter(item => item.descriptor);
  },

  async restoreMidiInstrumentDescriptors(records, isCurrent) {
    for (const { node, plugin, descriptor } of records) {
      if (!isCurrent() || !this.getMidiWorklets().includes(node) ||
          plugin.getWasmAssetOperationRevision?.(0) !== descriptor.operationRevision) return false;
      const epoch = plugin.reprepareWasmAssetContext(0, descriptor, node,
        { operationRevision: descriptor.operationRevision, isCurrent });
      if (!epoch) return false;
      const ready = await this.audioManager.waitForEffectiveActiveWasmAssets(plugin, [0], { primaryWorklet: node,
        getPreparation: () => this.audioManager.getSfzSamplePreparation(plugin, node) });
      if (!isCurrent() || !ready.ready || ready.stale ||
          this.audioManager._getSfzRuntimeAssetIdentity(node, plugin.id).replayEpoch !== epoch) return false;
    }
    return true;
  },

  startPreparedMidiTransport(position = this.midiPosition) {
    const context = this.audioPlayer.audioContext;
    this.midiPosition = position;
    this.midiSpeed = this.getCurrentState()?.playbackSpeed ?? 1;
    this.midiPlaying = true;
    this.midiAnchorTime = context.currentTime + .02;
    for (const node of this.getMidiWorklets()) node.port.postMessage({ type: 'midiStart',
      generation: this.midiGeneration, anchorFrame: Math.round(this.midiAnchorTime * context.sampleRate),
      delayFrames: Math.round(.02 * context.sampleRate) });
    if (this.midiTimeline) {
      this.midiOutput ??= new MidiFileOutput({ getOutput: selectedMidiOutput,
        getClockOffset: now => this.getMidiOutputClockOffset(now) });
      this.midiOutput.start(this.midiTimeline, { position, anchorTime: this.midiAnchorTime,
        speed: this.midiSpeed, generation: this.midiGeneration });
    }
    this.audioManager.clearSfzRuntimeCheckpoints?.({ types: [MIDI_INSTRUMENT_TYPE] });
    this.midiCheckpointAvailable = false;
    this.midiCheckpointTimeline = null;
  },

  // performance.now() milliseconds at which render context time zero is heard.
  getMidiOutputClockOffset(now) {
    const context = this.audioPlayer.audioContext;
    const heard = audibleContextTime({ outputTimestamp: context.getOutputTimestamp?.(),
      currentTime: context.currentTime, outputLatency: context.outputLatency,
      baseLatency: context.baseLatency, performanceTime: now });
    return now - heard + (this.audioManager.getTotalPipelineLatencySamples?.() ?? 0) / context.sampleRate * 1000;
  },

  setMidiPlaybackSpeed() {
    const context = this.audioPlayer.audioContext;
    const position = this.getCurrentMidiTime();
    this.midiSpeed = this.getCurrentState()?.playbackSpeed ?? 1;
    this.midiPosition = position;
    this.midiAnchorTime = context.currentTime;
    this.midiOutput?.retime(context.currentTime, this.midiSpeed);
    for (const node of this.getMidiWorklets()) node.port.postMessage({ type: 'midiSpeed',
      position, speed: this.midiSpeed, anchorFrame: Math.round(context.currentTime * context.sampleRate) });
  },

  getCurrentMidiTime() {
    return Math.max(0, Math.min(this.midiPosition ?? 0, this.midiTimeline?.duration ?? 0));
  },

  getMidiPresentation() {
    const state = this.getCurrentState();
    const position = this.getCurrentMidiTime();
    return { hasMidi: state?.playbackMode === 'midi' && !!this.midiTimeline,
      timeline: state?.playbackMode === 'midi' ? this.midiTimeline : null,
      position: this.audioManager.getAudiblePlaybackPosition?.(position, state?.playbackSpeed ?? 1) ?? position,
      speed: state?.playbackSpeed ?? 1,
      presentationEpoch: this.midiPresentationEpoch ?? 0,
      sourceGeneration: this.activeSourceGeneration,
      generation: this.midiGeneration ?? 0, playing: this.midiPlaying === true,
      preparing: !!this.midiPreparation || !!this.midiCheckpointRequest,
      paused: state?.isPaused === true };
  },

  async prepareMidiInstruments(isCurrent = null) {
    const manager = this.audioManager;
    if (isCurrent?.() === false) return false;
    let runtimeFailed = false;
    let readyTargets = 0;
    let unavailable = false;
    for (const { node, plugin } of this.getMidiInstrumentTargets()) {
      if (isRuntimeRetiredMidiTarget(manager, plugin, node)) { runtimeFailed = true; continue; }
      const snapshot = manager.getEffectiveActiveWasmAssetSnapshot?.(plugin, [0], { primaryWorklet: node });
      if (plugin.sf && !plugin._pending && !plugin._missing && !plugin._error && snapshot?.ready &&
          !snapshot.stale && !manager.getSfzSamplePreparation?.(plugin, node)) readyTargets++;
      else unavailable = true;
    }
    if (runtimeFailed && !readyTargets && !unavailable) throw new Error('The instrument stopped playing. Load it again or choose another instrument.');
    this.midiHasInstruments = readyTargets > 0;
    if (unavailable || !readyTargets) this.showMidiInstrumentNotice();
    return true;
  },

  showMidiInstrumentNotice() {
    if (selectedMidiOutput()) return;
    const source = this.midiTimeline ?? this.activeSourceGeneration ?? null;
    if (this.midiInstrumentNoticeSource === source) return;
    this.midiInstrumentNoticeSource = source;
    globalThis.window?.uiManager?.showTransientMessage?.('sfzPlayer.status.addPlayer', false, {}, 7000);
  },

  async playMidi(stopToken = this.stopRequestToken, isCurrent = null, { draining = false } = {}) {
    if (!this.midiTimeline || !this.midiSource) return false;
    const generation = this.activeSourceGeneration;
    let commandGeneration = this.midiGeneration ?? 0;
    const current = () => this.stopRequestToken === stopToken &&
      this.activeSourceGeneration === generation && isCurrent?.() !== false &&
      (this.midiGeneration ?? 0) === commandGeneration;
    if (!await this.prepareMidiInstruments(current) || !current()) return false;
    const position = this.getCurrentMidiTime();
    const stage = await this.stagePlaybackActivation('midi', generation, position);
    try {
      if (!current() || !this.ensurePipelineSourceConnected(this.midiSource)) return false;
      // Establish full processing before replaying history: power resume may reset kernels.
      const preparation = this.prepareMidiTransport(position, current);
      commandGeneration = this.midiGeneration;
      if (!await preparation || !current()) return false;
      const commit = () => {
        if (!current()) return false;
        if (!this.setPrivatePipelineSourceMuted(this.midiSource, false)) return false;
        if (!this.getUseInputWithPlayer()) this.setManagedSourceNode(this.getPipelineSourceNode(this.midiSource));
        this.startPreparedMidiTransport();
        if (draining) {
          this.midiPlaying = false;
          this.midiNaturalTail = true;
        } else {
          this.updateState({ isPlaying: true, isPaused: false, isStopped: false }, 'MIDI playback started');
          this.setupBufferMonitoring();
          this.rearmPreparedAutomaticMove();
        }
        return true;
      };
      if (stage) {
        const result = await this.audioManager.activateStagedAudioCandidate(stage, {
          acquire: () => this.midiSource, isCandidateCurrent: () => current(), commit
        });
        return result.activated === true;
      }
      return commit();
    } finally { this.releasePlaybackActivationStage(stage); }
  },

  async pauseMidi({ sourceFailure = false } = {}) {
    const timeline = this.midiTimeline;
    const capture = this.captureMidiCheckpoints({ sourceFailure });
    const generation = this.midiGeneration;
    const captured = await capture;
    if (this.midiGeneration !== generation || this.midiTimeline !== timeline) return false;
    if (!captured) {
      this.midiNaturalTail = false;
      await this.stopMidi();
      window.uiManager?.setError?.('sfzPlayer.error.prepare', true);
      return false;
    }
    this.clearBufferMonitoring();
    this.updateState({ isPlaying: false, isPaused: true, isStopped: false,
      currentTrackPosition: this.midiPosition }, 'MIDI playback paused');
  },

  async stopMidi() {
    this.midiPresentationEpoch = (this.midiPresentationEpoch ?? 0) + 1;
    this.postMidiTransport(false, 0, { mode: this.midiNaturalTail ? 'drain' : 'reset' });
    this.clearBufferMonitoring();
    this.maintainSilentSource();
    this.updateState({ isPlaying: false, isPaused: false, isStopped: true,
      isTransitioning: false, transitionType: null, currentTrackPosition: 0 }, 'MIDI playback stopped');
  },

  async seekMidi(time) {
    this.midiPresentationEpoch = (this.midiPresentationEpoch ?? 0) + 1;
    const playing = this.midiPlaying === true || this.getCurrentState()?.isPlaying === true;
    const position = Math.max(0, Math.min(time, this.midiTimeline?.duration ?? 0));
    const token = this.stopRequestToken;
    if (playing) {
      let commandGeneration = null;
      const current = () => this.stopRequestToken === token && this.getCurrentState()?.playbackMode === 'midi' &&
        (commandGeneration === null || this.midiGeneration === commandGeneration);
      const preparation = this.prepareMidiTransport(position, current);
      commandGeneration = this.midiGeneration;
      if (!await preparation || !current()) return;
      this.startPreparedMidiTransport();
    } else this.postMidiTransport(false, position);
    this.updateState({ currentTrackPosition: position, isPaused: !playing, isStopped: false }, 'MIDI seek completed');
  },

  releaseMidiPlayback({ preserveCheckpoint = false, preserveTransport = false } = {}) {
    this.midiOutput?.stop();
    if (!this.midiTimeline && !this.midiSource) return;
    if (!preserveTransport) this.postMidiTransport(false, 0, { mode: preserveCheckpoint ? 'pause' : 'reset' });
    this.midiTimeline = null;
    if (this.midiSource) this.releasePipelineSource(this.midiSource, true);
    this.midiSource = null;
  },

  isMidiTrack(track) { return isScoreFile(scoreFileName(track)); }
};
