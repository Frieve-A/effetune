// Shared lifecycle for EQ plugins that design one mono FIR off the audio thread
// and stage it into the WASM convolution kernel through the IR asset contract.
// Subclasses provide the designer (_loadDesignerModule, _createDesigner), the
// design inputs (_designConfig), their own parameters, the UI, and the status
// texts in a static FIR_MESSAGES table.
class FirAssetEqPlugin extends PluginBase {
  static TAP_OPTIONS = [8192, 16384, 32768, 65536, 131072];
  static LATENCY_OPTIONS = ['0', '128', '256', '512', '1024'];
  // Kernel parameters a subclass packs next to lt/fd.
  static PACKED_EXTRAS = {};

  constructor(name, description) {
    super(name, description);
    this.pm = 'min';
    this.tp = 32768;
    this.lt = '128';
    this._sampleRate = 48000;
    this._outputChannelCount = 2;
    this._runtimePromise = null;
    this._designer = null;
    this._designTimer = null;
    this._designGeneration = 0;
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._lastDesign = null;
    this._lastDesignSignature = null;
    this._assetState = 0;
    this._disposed = false;
    this._statusMessage = '';
    this._statusState = 'preparing';
    this._statusElement = null;
    this._latencyElement = null;
    this.uiCreated = false;
    this.temporalCapability = 'reset-on-resume';
    this.executionState = { state: 'pending', reason: null };
  }

  process(context, data) {
    return data;
  }

  _filterDelay(phase = this.pm, taps = this.tp) {
    return phase === 'min' ? 0 : taps / 2;
  }

  _packedParameters() {
    return {
      ...super.getParameters(),
      lt: this.lt,
      fd: this._filterDelay(),
      ...this.constructor.PACKED_EXTRAS
    };
  }

  getParameters(options = {}) {
    const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
      ? options.sampleRate
      : this._sampleRate;
    const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
      options.outputChannelCount >= 1 && options.outputChannelCount <= 16
      ? options.outputChannelCount
      : this._outputChannelCount;
    if (options.commitSampleRate &&
      (sampleRate !== this._sampleRate || outputChannelCount !== this._outputChannelCount)) {
      this._sampleRate = sampleRate;
      this._outputChannelCount = outputChannelCount;
      this._engineFormatChanged();
    }
    return {
      ...this._packedParameters(),
      pm: this.pm,
      tp: this.tp
    };
  }

  setParameters(params = {}, syncUi = true) {
    const previousDesign = this._designSignature();
    const previousLatency = this.lt;
    super._setValidatedParameters(params);
    if (['min', 'lin'].includes(params.pm)) this.pm = params.pm;
    const taps = Number(params.tp);
    if (this.constructor.TAP_OPTIONS.includes(taps)) this.tp = taps;
    if (FirAssetEqPlugin.LATENCY_OPTIONS.includes(String(params.lt))) {
      this.lt = String(params.lt);
    }
    this._setDesignParameters(params);
    this.updateParameters();
    if (previousDesign !== this._designSignature()) this._scheduleDesign(150);
    else if (previousLatency !== this.lt && this._lastDesign) this._stageDesign(this._lastDesign);
    this._syncParameterUI(syncUi);
    this._renderStatus();
  }

  // Applies the subclass's own parameters from a setParameters() call.
  _setDesignParameters() {}

  // Brings the subclass UI up to date after a setParameters() call.
  _syncParameterUI() {}

  // False when the settings need no filter; the asset is then released and the
  // audio passes through (see _settleFlat).
  _filterRequired() {
    return true;
  }

  // Redesigns after the engine sample rate or output channel count changed.
  _engineFormatChanged() {
    this._scheduleDesign(0);
  }

  // Shows a new design, or its release, in the subclass UI.
  _renderDesign() {
    this.updateResponse();
  }

  _designSignature(sampleRate = this._sampleRate) {
    return JSON.stringify([this._designConfig(sampleRate), this.channel]);
  }

  _design(designer, config) {
    return designer.design(config);
  }

  _readyStatus() {
    const messages = this.constructor.FIR_MESSAGES;
    return this._lastDesign?.qualityWarnings?.includes('filterAccuracy')
      ? [messages.warning, 'warning']
      : [messages.ready, 'ready'];
  }

  async _getRuntime() {
    if (!this._runtimePromise) {
      this._runtimePromise = Promise.all([
        this._loadDesignerModule(),
        import('../js/ir-library/ir-asset-payload.js'),
        import('../js/ir-library/ir-plugin-contract.js')
      ]).then(([designer, payload, contract]) => ({
        ...designer,
        ...payload,
        ...contract
      }));
    }
    return this._runtimePromise;
  }

  _scheduleDesign(delay = 150) {
    if (this._disposed) return;
    if (this._designTimer !== null) clearTimeout(this._designTimer);
    const generation = ++this._designGeneration;
    this._designPending = true;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this.updateParameters();
    if (this._filterRequired()) {
      this._setStatus(this.constructor.FIR_MESSAGES.designing, 'preparing');
    }
    this._designTimer = setTimeout(() => {
      if (this._disposed || generation !== this._designGeneration) return;
      this._designTimer = null;
      this._designAndStage(generation);
    }, delay);
  }

  _failDesign(message) {
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this.updateParameters();
    this._setStatus(message, 'error');
  }

  _settleFlat() {
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._lastDesign = null;
    this._assetState = 0;
    this.clearWasmAsset(0);
    this._updatePowerGainBound(null);
    this.updateParameters();
    this._setStatus(this.constructor.FIR_MESSAGES.flat, '');
    this._renderDesign();
    return true;
  }

  async _designAndStage(generation) {
    const messages = this.constructor.FIR_MESSAGES;
    try {
      if (this._disposed || generation !== this._designGeneration) return false;
      if (!this._filterRequired()) return this._settleFlat();
      const runtime = await this._getRuntime();
      if (this._disposed || generation !== this._designGeneration) return false;
      if (!this._designer) {
        const designer = this._createDesigner(runtime);
        if (this._disposed || generation !== this._designGeneration) {
          designer.close();
          return false;
        }
        this._designer = designer;
      }
      const designer = this._designer;
      const result = await this._design(designer, this._designConfig());
      if (this._disposed || generation !== this._designGeneration ||
        designer !== this._designer) return false;
      this._lastDesign = result;
      this._lastDesignSignature = this._designSignature();
      this._renderDesign();
      return this._stageDesign(result, generation);
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error(`${messages.name} design failed:`, error);
      this._failDesign(messages.designFailed);
      return false;
    }
  }

  _assetFootprint(runtime, taps, channel, outputChannelCount, latency) {
    const processingChannels = runtime.selectedIrChannelCount(channel, outputChannelCount);
    const footprintBytes = runtime.estimateIrKernelCommitFootprint({
      frames: taps,
      assetChannels: 1,
      topology: runtime.IR_ASSET_TOPOLOGY.mono,
      processingChannels,
      headBlock: Number(latency)
    });
    return { processingChannels, footprintBytes };
  }

  async _stageDesign(result, generation = this._designGeneration) {
    const messages = this.constructor.FIR_MESSAGES;
    try {
      if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
        return false;
      }
      this._designPending = true;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this._assetState = 1;
      this.updateParameters();
      const runtime = await this._getRuntime();
      if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
        return false;
      }
      const operationRevision = this.setWasmAsset(0, {
        payload: result.payload,
        formatTag: 1,
        headBlock: Number(this.lt),
        rateDivider: 1,
        pathCount: 0,
        inputCount: 0,
        ...this._assetFootprint(runtime, this.tp, this.channel, this._outputChannelCount, this.lt),
        externalAssetSignature: this._externalAssetSignature()
      });
      if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
        return false;
      }
      this._candidateAssetRevision = operationRevision;
      this._updatePowerGainBound(result.payload);
      this._renderStatus();
      return true;
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error(`${messages.name} asset staging failed:`, error);
      this._failDesign(messages.stageFailed ?? messages.prepareFailed);
      return false;
    }
  }

  _externalAssetSignature({
    sampleRate = this._sampleRate,
    outputChannelCount = this._outputChannelCount
  } = {}) {
    return JSON.stringify([
      1,
      this._designConfig(sampleRate),
      this.lt,
      this.channel,
      outputChannelCount
    ]);
  }

  // The bound follows the payload that is actually staged, never the current Taps setting.
  // Payload layout: 32-byte header (frames per channel at byte 8, path count at byte 20),
  // 12 bytes per matrix path, then the channel kernels; the first kernel is summed.
  _updatePowerGainBound(payload) {
    const view = payload instanceof ArrayBuffer && payload.byteLength >= 32 ? new DataView(payload) : null;
    const frames = view ? view.getUint32(8, true) : 0;
    const start = view ? 32 + view.getUint32(20, true) * 12 : 0;
    if (!view || frames < 1 || start + frames * 4 > payload.byteLength) {
      this.powerGainUpperBoundDb = 0;
      return;
    }
    const samples = new Float32Array(payload, start, frames);
    let sum = 0;
    for (let index = 0; index < frames; index += 1) {
      const value = samples[index];
      sum += value < 0 ? -value : value;
    }
    this.powerGainUpperBoundDb = 20 * Math.log10(sum > 1 ? sum : 1);
  }

  get offlineDspAssetRequired() {
    return this._filterRequired();
  }

  async createOfflineDspState({
    sampleRate,
    outputChannelCount,
    isCurrent = () => true
  } = {}) {
    const snapshot = {
      generation: this._designGeneration,
      config: this._designConfig(sampleRate),
      latency: this.lt,
      channel: this.channel,
      baseParameters: { ...super.getParameters() }
    };
    const operationCurrent = () => !this._disposed && isCurrent() &&
      snapshot.generation === this._designGeneration;
    const staleError = () => {
      const error = new Error(
        `${this.constructor.FIR_MESSAGES.name} settings changed during offline filter preparation.`
      );
      error.userMessageKey = this.offlineDspAssetErrorMessageKey;
      return error;
    };
    const filterDelay = this._filterDelay(snapshot.config.phase, snapshot.config.taps);
    const parameters = {
      ...snapshot.baseParameters,
      lt: snapshot.latency,
      fd: filterDelay,
      ...this.constructor.PACKED_EXTRAS
    };
    if (!operationCurrent()) throw staleError();
    if (!this._filterRequired()) {
      return { parameters, assets: new Map(), offlineDspAssetRequired: false };
    }
    const runtime = await this._getRuntime();
    if (!operationCurrent()) throw staleError();
    const designer = this._createDesigner(runtime);
    let designed;
    try {
      designed = await this._design(designer, snapshot.config);
    } finally {
      designer.close();
    }
    if (!operationCurrent()) throw staleError();
    return {
      parameters,
      assets: new Map([[0, {
        payload: designed.payload,
        formatTag: 1,
        headBlock: Number(snapshot.latency),
        rateDivider: 1,
        pathCount: 0,
        inputCount: 0,
        ...this._assetFootprint(
          runtime,
          snapshot.config.taps,
          snapshot.channel,
          outputChannelCount,
          snapshot.latency
        ),
        warmupSamples: Number(snapshot.latency) + filterDelay,
        externalAssetSignature: JSON.stringify([
          1,
          snapshot.config,
          snapshot.latency,
          snapshot.channel,
          outputChannelCount
        ])
      }]]),
      offlineDspAssetRequired: true
    };
  }

  onWasmAssetState(slot, state, operationRevision) {
    if (this._disposed || slot !== 0 || !this._isCurrentWasmAssetOperation(
      slot,
      operationRevision
    )) return;
    const status = state & 0xff;
    const isCandidate = operationRevision === this._candidateAssetRevision;
    const isEffective = operationRevision === this._effectiveAssetRevision;
    if ((!isCandidate && status !== 4) || (!isCandidate && !isEffective)) return;
    this._assetState = status;
    if (status === 3) {
      this._designPending = false;
      this._designStaged = true;
      this._effectiveAssetRevision = operationRevision;
      this._candidateAssetRevision = null;
      this.updateParameters();
      this._setStatus(...this._readyStatus());
    } else if (status === 4) {
      this._effectiveAssetRevision = null;
      this._failDesign(this.constructor.FIR_MESSAGES.prepareFailed);
    }
    this._renderStatus();
  }

  onWasmAssetRejected(slot, reason, operationRevision) {
    if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
    const messages = this.constructor.FIR_MESSAGES;
    console.warn(`${messages.name} asset admission rejected:`, reason);
    this._effectiveAssetRevision = null;
    this._assetState = 4;
    this._failDesign(messages.prepareFailed);
  }

  onMessage(message) {
    if (this._disposed) return;
    if (Number.isFinite(message.sampleRate) && message.sampleRate > 0 &&
      message.sampleRate !== this._sampleRate) {
      this._sampleRate = message.sampleRate;
      this._engineFormatChanged();
      this.updateResponse();
    }
    if (message.type === 'dspExecutionState' && message.pluginId === this.id &&
      message.validated === true) {
      this.executionState = { state: message.state, reason: message.reason || null };
      this._renderStatus();
    }
  }

  onChannelSelectionChanged() {
    this._scheduleDesign(0);
  }

  _setStatus(message, state = '') {
    this._statusMessage = message;
    this._statusState = state;
    if (!this._statusElement) return;
    this._statusElement.textContent = message;
    this._statusElement.dataset.state = state;
  }

  _renderStatus() {
    if (this._statusElement) {
      let message = this._statusMessage;
      let state = this._statusState;
      if (this.executionState.state === 'bypassed') {
        message = 'FIR processing is unavailable, so this effect is bypassed.';
        state = 'error';
      }
      this._statusElement.textContent = message;
      this._statusElement.dataset.state = state;
    }
    if (!this._latencyElement) return;
    const totalSamples = Number(this.lt) + this._filterDelay();
    const milliseconds = totalSamples * 1000 / this._sampleRate;
    this._latencyElement.textContent =
      `Latency: ${totalSamples} samples (${milliseconds.toFixed(1)} ms)`;
  }

  // Phase, Taps, and Latency rows shared by every FIR asset EQ.
  _createFirControls() {
    return [
      this.createRadioGroup('Phase', [
        { value: 'min', label: 'Minimum Phase' },
        { value: 'lin', label: 'Linear Phase' }
      ], this.pm, value => this.setParameters({ pm: value }), 'pm'),
      this.createSelectControl(
        'Taps',
        FirAssetEqPlugin.TAP_OPTIONS.map(value => ({
          value: String(value),
          label: String(value)
        })),
        String(this.tp),
        value => this.setParameters({ tp: Number(value) }), 'tp'
      ),
      this.createSelectControl(
        'Latency',
        FirAssetEqPlugin.LATENCY_OPTIONS.map(value => ({
          value,
          label: `${value} samples`
        })),
        this.lt,
        value => this.setParameters({ lt: value }), 'lt'
      )
    ];
  }

  cleanup() {
    if (this._disposed) return;
    this._disposed = true;
    ++this._designGeneration;
    if (this._designTimer !== null) clearTimeout(this._designTimer);
    this._designTimer = null;
    this._designer?.close();
    this._designer = null;
    this._lastDesignSignature = null;
    this.uiCreated = false;
    this._statusElement = null;
    this._latencyElement = null;
    super.cleanup();
  }
}

if (typeof window !== 'undefined') {
  window.FirAssetEqPlugin = FirAssetEqPlugin;
}
