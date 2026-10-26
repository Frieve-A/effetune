const loadedContexts = new WeakSet();

export class AirPlayPlayback {
  constructor(audioPlayer, { windowRef = globalThis.window, bridge = windowRef?.electronAPI?.airPlayV1,
    createNode = context => new AudioWorkletNode(context, 'effetune-live-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }) } = {}) {
    this.audioPlayer = audioPlayer;
    this.window = windowRef;
    this.bridge = bridge;
    this.createNode = createNode;
    this.active = false;
    this.token = 0;
    this.generation = null;
    this.source = null;
    this.node = null;
    this.port = null;
    this.preparing = null;
    this.committing = false;
    this.disposed = false;
    this.information = null;
    this.artworkUrl = '';
    if (!bridge?.rendererReady || !windowRef?.addEventListener) return;
    this.portListener = event => {
      if (event.source !== windowRef || event.data?.type !== 'effetune-airplay-v1-port' || event.ports?.length !== 1) return;
      this.attachPort(event.ports[0]);
    };
    windowRef.addEventListener('message', this.portListener);
    void Promise.resolve(bridge.rendererReady()).catch(error => console.warn('[AirPlay] Renderer registration failed.', error));
  }

  attachPort(port) {
    this.release(false);
    this.port?.close();
    this.port = port;
    port.onmessage = event => { void this.handleMessage(event.data).catch(error => this.fail(error)); };
    port.start();
  }

  async handleMessage(message) {
    if (this.disposed || !message || !Number.isSafeInteger(message.generation)) return;
    if (message.type === 'start') {
      if (message.sampleRate !== 44100 || message.channelCount !== 2) return;
      this.preparing = this.prepare(message.generation);
      await this.preparing;
      return;
    }
    if (message.generation !== this.generation) return;
    if (message.type === 'end') { this.release(false); return; }
    const token = this.token;
    if (this.preparing) await this.preparing;
    if (token !== this.token || !this.node) return;
    if (message.type === 'information') {
      const information = message.information;
      if (!information || typeof information !== 'object') return;
      this.information = information;
      this.publishInformation();
    } else if (message.type === 'artwork') {
      const artwork = message.artwork;
      if (artwork !== null && (!['image/jpeg', 'image/png'].includes(artwork?.mimeType) ||
          !(artwork.bytes instanceof ArrayBuffer))) return;
      this.clearArtwork();
      if (artwork) this.artworkUrl = URL.createObjectURL(new Blob([artwork.bytes], { type: artwork.mimeType }));
      this.publishInformation();
    } else if (message.type === 'pcm') {
      this.node.port.postMessage(message, message.planes);
    } else if (message.type === 'reset') this.node.port.postMessage(message);
  }

  async prepare(generation) {
    this.release(false);
    const token = this.token;
    this.generation = generation;
    const resumed = await this.audioPlayer.resumeAudioContextForRemotePlayback();
    if (token !== this.token || this.disposed) return;
    if (!resumed) throw new Error('Live playback activation failed');
    const context = this.audioPlayer.audioContext;
    if (!loadedContexts.has(context)) {
      await context.audioWorklet.addModule(new URL('./live-pcm-worklet.js', import.meta.url));
      loadedContexts.add(context);
    }
    if (token !== this.token || this.disposed) return;
    const node = this.createNode(context);
    const source = context.createGain();
    source.gain.value = 0;
    node.connect(source);
    if (!this.audioPlayer.contextManager.ensurePipelineSourceConnected(source)) {
      node.disconnect(); source.disconnect(); node.port.close();
      throw new Error('Live source could not connect');
    }
    this.node = node;
    this.source = source;
    node.port.onmessage = event => {
      const message = event.data;
      if (token !== this.token || message.generation !== generation) return;
      if (message.type === 'credit') {
        this.port?.postMessage({ type: 'credit', generation });
        if (message.accepted === false) this.fail(new Error('Invalid live PCM slab'));
      } else if (message.type === 'buffered' && !this.active && !this.committing) {
        void this.commit(token, generation).catch(error => this.fail(error));
      }
    };
    node.port.postMessage({ type: 'start', generation });
  }

  async commit(token, generation) {
    const isCurrent = () => token === this.token && !this.disposed;
    if (!isCurrent()) return;
    this.committing = true;
    try {
      const cleared = await this.audioPlayer.activateOpenHomePlaybackAdapter().clearForLiveInput(isCurrent);
      if (cleared === false || !isCurrent()) return;
      const manager = this.audioPlayer.contextManager;
      const ownership = manager.preparePlayerSourceOwnership();
      if (!ownership || !manager.ensurePipelineSourceConnected(this.source)) throw new Error('Live ownership failed');
      manager.commitPlayerSourceOwnership(this.source, ownership);
      this.source.gain.value = 1;
      this.active = true;
      if (!this.audioPlayer.ui?.container) this.audioPlayer.ui?.createPlayerUI?.();
      this.audioPlayer.stateManager.updateState({ liveInputActive: true, currentTrack: null, currentTrackName: 'AirPlay',
        currentTrackDuration: 0, currentTrackPosition: 0, isPlaying: true, isPaused: false, isStopped: false,
        seekBarEnabled: false, transportCapabilities: { stop: true } }, 'AirPlay source committed');
      this.publishInformation();
      this.port?.postMessage({ type: 'ready', generation });
    } finally { if (token === this.token) this.committing = false; }
  }

  publishInformation() {
    if (!this.active) return;
    const information = this.information;
    const metadata = information?.metadata;
    const name = this.audioPlayer.ui?.getDisplayTrackName?.({ meta: metadata }) || metadata?.title || 'AirPlay';
    this.audioPlayer.stateManager.updateState({ liveInputInformation: information,
      currentTrackName: name, artworkUrl: this.artworkUrl,
      currentTrackPosition: information?.position ?? 0, currentTrackDuration: information?.duration ?? 0
    }, 'AirPlay information');
  }

  clearArtwork() {
    if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl);
    this.artworkUrl = '';
  }

  release(notifyMain = true) {
    const wasActive = this.active;
    this.token += 1;
    this.active = false;
    this.committing = false;
    const manager = this.audioPlayer.contextManager;
    if (this.source) {
      // Connect running silence before releasing the live pipeline route.
      if (wasActive && !manager.getUseInputWithPlayer()) {
        const silence = manager.createSilentGain();
        if (!silence) throw new Error('Silent source handoff failed');
        manager.setManagedSourceNode(silence);
      }
      this.node?.port.postMessage({ type: 'end', generation: this.generation });
      manager.releasePipelineSource(this.source);
      this.node?.disconnect();
      this.node?.port.close();
    }
    this.source = null;
    this.node = null;
    this.preparing = null;
    this.generation = null;
    this.information = null;
    this.clearArtwork();
    if (wasActive) this.audioPlayer.stateManager.updateState({ liveInputActive: false, isPlaying: false, isPaused: false,
      isStopped: true, currentTrackName: '', artworkUrl: '', liveInputInformation: null,
      currentTrackPosition: 0, currentTrackDuration: 0, seekBarEnabled: true,
      transportCapabilities: undefined }, 'AirPlay source released');
    if (notifyMain) void Promise.resolve(this.bridge?.stopSession?.()).catch(error => console.warn('[AirPlay] Stop failed.', error));
  }

  releaseForUrl() { if (this.source || this.preparing) this.release(true); }

  async stopSession() {
    this.release(false);
    await this.bridge?.stopSession?.();
  }

  fail(error) {
    console.warn('[AirPlay] Live playback failed.', error);
    this.window?.uiManager?.setError?.('airPlay.playbackFailed', true);
    this.release(true);
  }

  dispose() {
    this.disposed = true;
    this.release(false);
    this.port?.close();
    this.port = null;
    this.window?.removeEventListener?.('message', this.portListener);
    void Promise.resolve(this.bridge?.rendererUnavailable?.()).catch(() => {});
  }
}
