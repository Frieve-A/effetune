// Relays the Network Output transport between the Electron main process and
// the audio worklet: forwards the PCM MessagePort that main hands over, keeps
// the local L0 delay in step with the main-side status, and asks main for a
// fresh port whenever the primary worklet is rebuilt.
export class NetworkOutputIntegration {
  constructor(audioManager, { windowRef = globalThis.window, bridge = windowRef?.electronAPI?.networkOutputV1 } = {}) {
    this.audioManager = audioManager;
    this.window = windowRef;
    this.bridge = bridge;
    this.portListener = null;
    this.removeStatusListener = null;
    this.routeListener = () => { void this.reportRoute(); };
    if (!bridge?.rendererReady || !windowRef?.addEventListener) return;
    this.portListener = event => {
      if (event.source !== windowRef || event.data?.type !== 'effetune-network-output-v1-port' ||
          event.ports?.length !== 1) return;
      audioManager.setNetworkOutputPort?.(event.ports[0]);
    };
    windowRef.addEventListener('message', this.portListener);
    audioManager.addEventListener?.('networkRoute', this.routeListener);
    audioManager.addEventListener?.('networkPaths', this.routeListener);
    if (bridge.updateRoute && bridge.getClock) this.routeTimer = setInterval(this.routeListener, 1000);
    let receivedStatus = false;
    if (typeof bridge.onStatus === 'function') {
      this.removeStatusListener = bridge.onStatus(status => {
        receivedStatus = true;
        this.applyStatus(status);
      });
    }
    audioManager.setNetworkOutputPortRequester?.(() => {
      void Promise.resolve().then(() => bridge.rendererReady())
        .catch(error => console.warn('[Network Output] Renderer registration failed.', error));
    });
    void Promise.resolve().then(() => bridge.getStatus?.()).then(status => {
      if (!receivedStatus) this.applyStatus(status);
    })
      .catch(error => console.warn('[Network Output] Status could not be read.', error));
  }

  applyStatus(status) {
    if (!status || typeof status !== 'object') return;
    const delayMs = Number(status.localDelayMs);
    this.audioManager.setNetworkOutputLocalDelay?.(status.enabled === true, Number.isFinite(delayMs) ? delayMs : 0,
      status.localEnabled !== false, status.syncDelayMs, status.syncRevision);
  }

  async reportRoute() {
    if (!this.bridge?.updateRoute || !this.bridge?.getClock) return;
    const manager = this.audioManager;
    const route = manager.networkRoute;
    const paths = manager.networkPaths;
    const context = manager.contextManager?.audioContext;
    const physical = context?.outputLatency || context?.baseLatency;
    const physicalOutputMs = Number.isFinite(physical) && physical > 0 ? physical * 1000 : null;
    if (!route || route.sendId == null) {
      await this.bridge.updateRoute({ active: false, physicalOutputMs });
      return;
    }
    if (!route || !paths || paths.revision !== route.revision || !context?.sampleRate) return;
    const before = performance.now();
    const hostClock = await this.bridge.getClock();
    const after = performance.now();
    if (manager.networkRoute !== route || manager.networkPaths !== paths || !Number.isFinite(hostClock)) return;
    const localSamples = paths.send?.localSamples;
    await this.bridge.updateRoute({ active: route.sendId != null, revision: paths.tapRevision,
      localReachable: Number.isFinite(localSamples),
      dspMs: Number.isFinite(localSamples) ? localSamples * 1000 / context.sampleRate : null,
      softwareOutputMs: Number.isFinite(paths.outputDelaySamples) ? paths.outputDelaySamples * 1000 / context.sampleRate : null,
      physicalOutputMs,
      contextFrame: context.currentTime * context.sampleRate,
      frameTimeMs: performance.now() + hostClock - (before + after) / 2,
      clockUncertaintyMs: (after - before) / 2 + 20 });
  }

  dispose() {
    clearInterval(this.routeTimer);
    this.audioManager.removeEventListener?.('networkRoute', this.routeListener);
    this.audioManager.removeEventListener?.('networkPaths', this.routeListener);
    if (this.portListener) this.window?.removeEventListener?.('message', this.portListener);
    this.portListener = null;
    this.removeStatusListener?.();
    this.removeStatusListener = null;
    if (this.bridge?.rendererReady) this.audioManager.setNetworkOutputPortRequester?.(null);
  }
}
