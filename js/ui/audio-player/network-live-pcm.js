// A classified UPnP stream uses the same live resampler as AirPlay. The HTTP
// connection establishes frame zero; only consumed frames are reported.
const loadedContexts = new WeakSet();
const LIVE_FADE_SECONDS = 0.01;

export class NetworkLivePcm {
  constructor(player, bridge, { fetchStream = fetch,
    createNode = context => new AudioWorkletNode(context, 'effetune-live-pcm',
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }) } = {}) {
    this.player = player;
    this.bridge = bridge;
    this.fetchStream = fetchStream;
    this.createNode = createNode;
    this.generation = 0;
  }

  // A start that does not reach buffered playback releases its connection and nodes, unless a newer start or stop
  // already owns them.
  async start(entry, isCurrent = () => true) {
    this.stop();
    const generation = ++this.generation;
    let started = false;
    try {
      started = await this.open(entry, generation, isCurrent);
      return started;
    } finally {
      if (!started && generation === this.generation) this.stop();
    }
  }

  async open(entry, generation, isCurrent) {
    const controller = new AbortController();
    this.controller = controller;
    const current = () => generation === this.generation && isCurrent() && !controller.signal.aborted;
    const response = await this.fetchStream(entry.playbackUrl, { signal: controller.signal,
      headers: { Accept: 'application/vnd.effetune.live-pcm-v1' } });
    const connectionId = response.headers.get('X-EffeTune-Live-Connection');
    if (!response.ok || !response.body || !connectionId ||
        !response.headers.get('Content-Type')?.startsWith('application/vnd.effetune.live-pcm-v1')) {
      return false;
    }
    if (!await this.player.resumeAudioContextForRemotePlayback() || !current()) return false;
    const context = this.player.audioContext;
    if (!loadedContexts.has(context)) {
      await context.audioWorklet.addModule(new URL('./live-pcm-worklet.js', import.meta.url));
      loadedContexts.add(context);
    }
    if (!current()) return false;
    const node = this.createNode(context);
    this.node = node;
    const source = context.createGain();
    this.source = source;
    source.gain.value = 0;
    node.connect(source);
    const manager = this.player.contextManager;
    if (!manager.ensurePipelineSourceConnected(source)) throw new Error('Live source could not connect');
    this.connectionId = connectionId;
    this.sessionId = entry.liveSessionId;
    this.pending = new Map();
    this.requestId = 0;
    let creditResolve;
    let bufferedResolve;
    const buffered = new Promise(resolve => { bufferedResolve = resolve; });
    node.port.onmessage = ({ data }) => {
      if (!current() || data.generation !== generation) return;
      if (data.type === 'credit') { const resolve = creditResolve; creditResolve = null; resolve?.(data.accepted); }
      if (data.type === 'buffered') bufferedResolve(true);
      if (data.type === 'position') { this.pending.get(data.requestId)?.(data); this.pending.delete(data.requestId); }
    };
    this.cancelPendingRead = () => { creditResolve?.(false); bufferedResolve(false); };
    node.port.postMessage({ type: 'start', generation });
    const reader = response.body.getReader();
    this.reader = reader;
    const pump = async () => {
      let carry = new Uint8Array(0);
      let frame = 0;
      while (current()) {
        const { value, done } = await reader.read();
        if (done) break;
        const bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry); bytes.set(value, carry.length);
        let offset = 0;
        while (bytes.length - offset >= 4 && current()) {
          const count = Math.min(4096, Math.floor((bytes.length - offset) / 4));
          const planes = [new Float32Array(count), new Float32Array(count)];
          const view = new DataView(bytes.buffer, bytes.byteOffset + offset, count * 4);
          for (let i = 0; i < count; i++) {
            planes[0][i] = view.getInt16(i * 4, true) / 32768;
            planes[1][i] = view.getInt16(i * 4 + 2, true) / 32768;
          }
          const credit = new Promise(resolve => { creditResolve = resolve; });
          node.port.postMessage({ type: 'pcm', generation, startFrame: frame, frameCount: count,
            planes: planes.map(plane => plane.buffer) }, planes.map(plane => plane.buffer));
          if (!await credit) throw new Error('Live PCM was rejected');
          frame += count; offset += count * 4;
        }
        carry = bytes.slice(offset);
      }
      if (current()) throw new Error('Live stream ended');
    };
    void pump().catch(error => {
      if (current()) {
        console.warn('[Network Receive] Live stream failed.', error);
        this.stop();
        this.player.stateManager?.updateState?.({ isPlaying: false, isPaused: false, isStopped: true },
          'Network live playback ended');
      }
      bufferedResolve(false);
    });
    return await buffered && current();
  }

  position() {
    if (!this.node) return Promise.resolve(null);
    const requestId = ++this.requestId;
    return new Promise(resolve => {
      this.pending.set(requestId, resolve);
      this.node.port.postMessage({ type: 'position', generation: this.generation, requestId });
    });
  }

  beginReporting() {
    const generation = this.generation;
    const report = async () => {
      if (generation !== this.generation || !this.node) return;
      try {
        const probeId = await this.bridge?.probeLivePlayback?.({ sessionId: this.sessionId,
          connectionId: this.connectionId });
        if (probeId && generation === this.generation) {
          const position = await this.position();
          const manager = this.player.audioManager;
          const context = this.player.audioContext;
          const worklet = manager?._getPrimaryWorkletNode?.();
          if (position?.started && generation === this.generation && context?.sampleRate) {
            const physical = context.outputLatency || context.baseLatency;
            const paths = manager.networkPaths;
            const currentPaths = paths?.revision === manager.networkRoute?.revision ? paths : null;
            const suffix = manager.networkRoute?.receiveId != null
              ? currentPaths?.receive?.localSamples : manager.dspPipelineLatencySamples;
            const outputDelay = manager._appliedOutputDelayFrames?.get(worklet);
            await this.bridge.reportLivePlayback({ sessionId: this.sessionId, connectionId: this.connectionId,
              probeId, positionFrames: position.positionFrames,
              dspMs: Number.isFinite(suffix) ? suffix * 1000 / context.sampleRate : null,
              softwareOutputMs: Number.isFinite(outputDelay) && Number.isFinite(currentPaths?.localDelaySamples)
                ? (outputDelay + currentPaths.localDelaySamples) * 1000 / context.sampleRate : null,
              physicalOutputMs: Number.isFinite(physical) && physical > 0 ? physical * 1000 : null,
              revision: manager.networkRoute?.revision ?? 0 });
          }
        }
      } catch (error) { console.warn('[Network Receive] Timing report failed.', error); }
      if (generation === this.generation) this.reportTimer = setTimeout(report, 1000);
    };
    void report();
  }

  followReceiveRoute(generation) {
    const audioManager = this.player.audioManager;
    const manager = this.player.contextManager;
    const update = () => {
      const route = audioManager.networkRoute;
      const session = audioManager._networkReceiveSession;
      if (route?.generation !== generation || !route.receiveActive ||
          (session && (!session.active || session.generation !== generation))) return;
      const input = audioManager.ioManager?.inputSourceNode;
      const useInput = manager.getUseInputWithPlayer?.() === true;
      const mixInput = manager.shouldMixInputWithPlayer?.() ?? (useInput && route.receiveId == null);
      if (mixInput && input) {
        audioManager.ensureSourceConnectedToPipeline?.(input);
        this.inputSuppressed = false;
      } else if (route.receiveId != null && useInput) {
        if (input && audioManager.isSourceConnectedToPipeline?.(input)) {
          audioManager.disconnectSourceFromPipeline(input);
        }
        this.inputSuppressed = true;
      } else {
        this.inputSuppressed = false;
      }
    };
    this.routeListener = update;
    audioManager.addEventListener('networkRoute', update);
    update();
  }

  activate() {
    const gain = this.source?.gain;
    const context = this.player.audioContext;
    if (!gain) return;
    if (context?.state === 'running' && typeof gain.setValueAtTime === 'function' &&
        typeof gain.linearRampToValueAtTime === 'function') {
      gain.setValueAtTime(0, context.currentTime);
      gain.linearRampToValueAtTime(1, context.currentTime + LIVE_FADE_SECONDS);
    } else {
      gain.value = 1;
    }
  }

  stop() {
    this.generation++;
    clearTimeout(this.reportTimer);
    this.controller?.abort();
    this.controller = null;
    this.cancelPendingRead?.();
    this.cancelPendingRead = null;
    for (const resolve of this.pending?.values() ?? []) resolve(null);
    this.pending?.clear();
    const source = this.source;
    const node = this.node;
    let fade = false;
    const context = this.player.audioContext;
    const gain = source?.gain;
    let fadeEnd = 0;
    if (gain && context?.state === 'running' && typeof gain.linearRampToValueAtTime === 'function') {
      const now = context.currentTime;
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
      }
      gain.linearRampToValueAtTime(0, now + LIVE_FADE_SECONDS);
      fadeEnd = now + LIVE_FADE_SECONDS;
      fade = true;
    }
    if (source) {
      const manager = this.player.contextManager;
      if (manager.audioManager.sourceNode === source) {
        const silence = manager.createSilentGain();
        if (silence) manager.setManagedSourceNode(silence);
      }
    }
    this.node = null;
    this.source = null;
    const release = () => {
      if (source) this.player.contextManager.releasePipelineSource(source);
      node?.disconnect();
      node?.port.close();
    };
    if (fade) {
      const releaseAfterFade = () => {
        const remaining = fadeEnd - context.currentTime;
        if (context.state !== 'running' || remaining <= 0) release();
        else setTimeout(releaseAfterFade, remaining * 1000);
      };
      setTimeout(releaseAfterFade, LIVE_FADE_SECONDS * 1000);
    }
    else release();
    const audioManager = this.player.audioManager;
    if (this.routeListener) audioManager?.removeEventListener('networkRoute', this.routeListener);
    this.routeListener = null;
    const input = audioManager?.ioManager?.inputSourceNode;
    if (this.inputSuppressed && input && this.player.contextManager.getUseInputWithPlayer?.() === true) {
      audioManager.ensureSourceConnectedToPipeline?.(input);
    }
    this.inputSuppressed = false;
  }
}
