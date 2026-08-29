const FIR_CROSSOVER_CHANNEL_COUNT_FRAME = 9;
const FIR_CROSSOVER_TELEMETRY_VERSION = 1;
const FIR_CROSSOVER_CHANNEL_COUNT_BYTES = 4;
const FIR_CROSSOVER_SLOPES = [-24, -48, -72, -96, -144, -192, -288, -384];

class FIRCrossoverPlugin extends PluginBase {
  constructor() {
    super('FIR Crossover', 'Split stereo into frequency bands with steep FIR filters');
    this.bc = 2;
    this.f1 = 2000;
    this.s1 = -24;
    this.f2 = 4000;
    this.s2 = -24;
    this.f3 = 8000;
    this.s3 = -24;
    this.pm = 'min';
    this.tp = 32768;
    this.lt = '128';
    this.temporalCapability = 'reset-on-resume';
    this.offlineDspAssetErrorMessageKey = 'firCrossover.error.design';

    this._sampleRate = this._getEngineSampleRate();
    this._outputChannelCount = this._getEngineChannelCount();
    this.maxBands = this._maximumBandCount(this._outputChannelCount) || 2;
    this._runtimePromise = null;
    this._designer = null;
    this._designTimer = null;
    this._designGeneration = 0;
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._lastDesign = null;
    this._assetState = 0;
    this._disposed = false;
    this.executionState = { state: 'pending', reason: null };

    this._statusElement = null;
    this._latencyElement = null;
    this._errorElement = null;
    this._bandRadios = [];
    this._crossoverControls = [];
    this._graphDispose = null;
    this._dspTelemetryHub = null;
    this._dspTelemetryTapId = null;
    this._dspTelemetryUnsubscribe = null;
    this._boundDspChannelCountTelemetry = frame =>
      this.handleDspChannelCountTelemetry(frame);

    this.registerProcessor('return data;');
  }

  process(context, data) {
    return data;
  }

  _getEngineSampleRate() {
    const value = this._sampleRate || window.workletNode?.context?.sampleRate ||
      window.audioContext?.sampleRate ||
      window.uiManager?.audioManager?.audioContext?.sampleRate;
    return Number.isFinite(value) && value > 0 ? value : 48000;
  }

  _getEngineChannelCount() {
    const candidates = [
      this._outputChannelCount,
      window.workletNode?.channelCount,
      window.audioManager?.outputChannelCount,
      window.uiManager?.audioManager?.outputChannelCount
    ];
    return candidates.find(value => Number.isInteger(value) && value >= 1 && value <= 16) || 2;
  }

  _maximumBandCount(outputChannelCount = this._outputChannelCount) {
    return outputChannelCount >= 4 && outputChannelCount <= 16 && outputChannelCount % 2 === 0
      ? Math.min(outputChannelCount / 2, 4) : 0;
  }

  _effectiveBandCount(outputChannelCount = this._outputChannelCount) {
    const maximum = this._maximumBandCount(outputChannelCount);
    return maximum ? Math.min(this.bc, maximum) : 0;
  }

  _packedParameters() {
    return {
      ...super.getParameters(),
      lt: this.lt,
      fd: this.pm === 'min' ? 0 : this.tp / 2,
      bc: this.bc
    };
  }

  getParameters(options = {}) {
    this.ensureDspTelemetrySubscription();
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
      this._applyOutputChannelCount(outputChannelCount);
      this._scheduleDesign(0);
    }
    return {
      ...this._packedParameters(),
      pm: this.pm,
      tp: this.tp,
      f1: this.f1,
      s1: this.s1,
      f2: this.f2,
      s2: this.s2,
      f3: this.f3,
      s3: this.s3
    };
  }

  getSerializableParameters() {
    const serialized = super.getSerializableParameters();
    delete serialized.fd;
    return serialized;
  }

  setParameters(params = {}) {
    const previousDesign = this._designSignature();
    const previousLatency = this.lt;
    super._setValidatedParameters(params);
    if (params.bc !== undefined) {
      const bandCount = Math.round(Number(params.bc));
      if ([2, 3, 4].includes(bandCount)) this.bc = bandCount;
    }
    const maximumBandCount = this._maximumBandCount();
    if (maximumBandCount) this.bc = Math.min(this.bc, maximumBandCount);
    if (params.pm === 'min' || params.pm === 'lin') this.pm = params.pm;
    const taps = Number(params.tp);
    if ([8192, 16384, 32768, 65536, 131072].includes(taps)) this.tp = taps;
    if (['0', '128', '256', '512', '1024'].includes(String(params.lt))) {
      this.lt = String(params.lt);
    }

    let frequencies = [this.f1, this.f2, this.f3];
    for (let index = 0; index < frequencies.length; index += 1) {
      const key = `f${index + 1}`;
      if (params[key] !== undefined) {
        frequencies[index] = this.parseFiniteNumber(params[key], 10, 40000, frequencies[index]);
      }
    }
    const activeCrossovers = this.bc - 1;
    for (let index = 0; index < activeCrossovers; index += 1) {
      const minimum = index === 0 ? 10 : frequencies[index - 1] + 1;
      const maximum = 40000 - (activeCrossovers - index - 1);
      frequencies[index] = Math.max(minimum, Math.min(maximum, frequencies[index]));
    }
    [this.f1, this.f2, this.f3] = frequencies;

    for (let index = 0; index < 3; index += 1) {
      const key = `s${index + 1}`;
      const slope = Math.round(Number(params[key]));
      if (FIR_CROSSOVER_SLOPES.includes(slope)) this[key] = slope;
    }

    this.updateParameters();
    const nextDesign = this._designSignature();
    if (previousDesign !== nextDesign) this._scheduleDesign(150);
    else if (previousLatency !== this.lt && this._lastDesign) {
      this._stageDesign(this._lastDesign);
    } else if (!this._lastDesign && this._effectiveBandCount()) {
      this._scheduleDesign(0);
    }
    this._syncControls();
    this._renderStatus();
    this.drawGraph();
  }

  _designSignature() {
    return JSON.stringify([
      this.bc, this.f1, this.s1, this.f2, this.s2, this.f3, this.s3,
      this.pm, this.tp, this._sampleRate, this._outputChannelCount
    ]);
  }

  _designConfig(
    sampleRate = this._sampleRate,
    outputChannelCount = this._outputChannelCount
  ) {
    return {
      sampleRate,
      taps: this.tp,
      phase: this.pm,
      bandCount: this._effectiveBandCount(outputChannelCount),
      frequencies: [this.f1, this.f2, this.f3],
      slopes: [this.s1, this.s2, this.s3]
    };
  }

  async _getRuntime() {
    if (!this._runtimePromise) {
      this._runtimePromise = Promise.all([
        import('../../js/fir-crossover/designer.js'),
        import('../../js/ir-library/ir-asset-payload.js'),
        import('../../js/ir-library/ir-plugin-contract.js')
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
    const bandCount = this._effectiveBandCount();
    if (!bandCount) {
      this._designTimer = null;
      this._settleUnavailable();
      return;
    }
    this._designPending = true;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._assetState = 0;
    this.updateParameters();
    this._setStatus('Designing FIR crossover filters…', 'preparing');
    this._designTimer = setTimeout(() => {
      if (this._disposed || generation !== this._designGeneration) return;
      this._designTimer = null;
      this._designAndStage(generation);
    }, delay);
  }

  _settleUnavailable() {
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._lastDesign = null;
    this._assetState = 0;
    this.clearWasmAsset(0);
    this.powerGainUpperBoundDb = 0;
    this.updateParameters();
    this._setStatus(
      'FIR Crossover needs an even number of output channels from 4 to 16.',
      'error'
    );
  }

  async _designAndStage(generation) {
    try {
      if (this._disposed || generation !== this._designGeneration) return false;
      const runtime = await this._getRuntime();
      if (this._disposed || generation !== this._designGeneration) return false;
      if (!this._designer) this._designer = runtime.createFIRCrossoverDesigner();
      const result = await this._designer.design(this._designConfig());
      if (this._disposed || generation !== this._designGeneration) return false;
      this._lastDesign = result;
      return this._stageDesign(result, generation);
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error('FIR Crossover design failed:', error);
      this._designPending = false;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this._assetState = 4;
      this.updateParameters();
      this._setStatus(
        'The FIR crossover filters could not be designed. Try fewer taps.',
        'error'
      );
      return false;
    }
  }

  async _stageDesign(result, generation = this._designGeneration) {
    try {
      if (this._disposed || generation !== this._designGeneration ||
        result !== this._lastDesign) return false;
      const bandCount = this._effectiveBandCount();
      if (!bandCount || result.bandCount !== bandCount) return false;
      this._designPending = true;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this._effectiveAssetRevision = null;
      this._assetState = 1;
      this.updateParameters();
      const runtime = await this._getRuntime();
      if (this._disposed || generation !== this._designGeneration ||
        result !== this._lastDesign) return false;
      const pathCount = bandCount * 2;
      const footprintBytes = runtime.estimateIrKernelCommitFootprint({
        frames: this.tp,
        assetChannels: bandCount,
        topology: runtime.IR_ASSET_TOPOLOGY.matrix,
        processingChannels: this._outputChannelCount,
        headBlock: Number(this.lt),
        pathCount,
        inputCount: 2
      });
      const operationRevision = this.setWasmAsset(0, {
        payload: result.payload,
        formatTag: 1,
        headBlock: Number(this.lt),
        rateDivider: 1,
        pathCount,
        inputCount: 2,
        processingChannels: this._outputChannelCount,
        footprintBytes,
        externalAssetSignature: this._assetSignature()
      });
      if (this._disposed || generation !== this._designGeneration ||
        result !== this._lastDesign) return false;
      this._candidateAssetRevision = operationRevision;
      this._updatePowerGainBound(result.payload, bandCount, pathCount);
      this._renderStatus();
      return true;
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error('FIR Crossover asset staging failed:', error);
      this._designPending = false;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this._assetState = 4;
      this.updateParameters();
      this._setStatus(
        'The FIR crossover filters could not be prepared. Try fewer taps or a higher latency.',
        'error'
      );
      return false;
    }
  }

  _assetSignature({
    sampleRate = this._sampleRate,
    outputChannelCount = this._outputChannelCount
  } = {}) {
    return JSON.stringify([
      1, this._designConfig(sampleRate, outputChannelCount), this.lt, outputChannelCount
    ]);
  }

  _updatePowerGainBound(payload, bandCount, pathCount) {
    const offset = 32 + pathCount * 12;
    if (!(payload instanceof ArrayBuffer) ||
      payload.byteLength < offset + bandCount * this.tp * 4) {
      this.powerGainUpperBoundDb = 0;
      return;
    }
    const samples = new Float32Array(payload, offset);
    let maximum = 1;
    for (let band = 0; band < bandCount; band += 1) {
      let sum = 0;
      const start = band * this.tp;
      for (let index = 0; index < this.tp; index += 1) {
        const value = samples[start + index];
        sum += value < 0 ? -value : value;
      }
      if (sum > maximum) maximum = sum;
    }
    this.powerGainUpperBoundDb = 20 * Math.log10(maximum);
  }

  get offlineDspAssetRequired() {
    return this.isOfflineDspAssetRequired();
  }

  isOfflineDspAssetRequired() {
    return this._effectiveBandCount() > 0;
  }

  _offlineStaleError() {
    const error = new Error('FIR Crossover settings changed during offline filter preparation.');
    error.userMessageKey = this.offlineDspAssetErrorMessageKey;
    return error;
  }

  async createOfflineDspState({
    sampleRate,
    outputChannelCount,
    isCurrent = () => true
  } = {}) {
    const snapshot = {
      generation: this._designGeneration,
      config: this._designConfig(sampleRate, outputChannelCount),
      latency: this.lt,
      outputChannelCount,
      baseParameters: { ...super.getParameters() }
    };
    const operationCurrent = () => !this._disposed && isCurrent() &&
      snapshot.generation === this._designGeneration;
    const parameters = {
      ...snapshot.baseParameters,
      lt: snapshot.latency,
      fd: snapshot.config.phase === 'min' ? 0 : snapshot.config.taps / 2,
      bc: this.bc
    };
    if (!operationCurrent()) throw this._offlineStaleError();
    if (!snapshot.config.bandCount || !this._maximumBandCount(outputChannelCount)) {
      return {
        parameters,
        assets: new Map(),
        offlineDspAssetRequired: false
      };
    }
    const runtime = await this._getRuntime();
    if (!operationCurrent()) throw this._offlineStaleError();
    const designer = runtime.createFIRCrossoverDesigner();
    let designed;
    try {
      designed = await designer.design(snapshot.config);
    } finally {
      designer.close();
    }
    if (!operationCurrent()) throw this._offlineStaleError();
    const pathCount = snapshot.config.bandCount * 2;
    const footprintBytes = runtime.estimateIrKernelCommitFootprint({
      frames: snapshot.config.taps,
      assetChannels: snapshot.config.bandCount,
      topology: runtime.IR_ASSET_TOPOLOGY.matrix,
      processingChannels: outputChannelCount,
      headBlock: Number(snapshot.latency),
      pathCount,
      inputCount: 2
    });
    return {
      parameters,
      assets: new Map([[0, {
        payload: designed.payload,
        formatTag: 1,
        headBlock: Number(snapshot.latency),
        rateDivider: 1,
        pathCount,
        inputCount: 2,
        processingChannels: outputChannelCount,
        footprintBytes,
        warmupSamples: Number(snapshot.latency) +
          (snapshot.config.phase === 'min' ? 0 : snapshot.config.taps / 2),
        externalAssetSignature: JSON.stringify([
          1, snapshot.config, snapshot.latency, outputChannelCount
        ])
      }]]),
      offlineDspAssetRequired: true
    };
  }

  onWasmAssetState(slot, state, operationRevision) {
    if (this._disposed || slot !== 0 ||
      !this._isCurrentWasmAssetOperation(slot, operationRevision)) return;
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
      this._setStatus('FIR crossover filters are ready.', 'ready');
    } else if (status === 4) {
      this._designPending = false;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this._effectiveAssetRevision = null;
      this.updateParameters();
      this._setStatus(
        'The FIR crossover filters could not be prepared. Try fewer taps or a higher latency.',
        'error'
      );
    }
    this._renderStatus();
  }

  onWasmAssetRejected(slot, reason, operationRevision) {
    if (this._disposed || slot !== 0 ||
      operationRevision !== this._candidateAssetRevision) return;
    console.warn('FIR Crossover asset admission rejected:', reason);
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._assetState = 4;
    this.updateParameters();
    this._setStatus(
      'The FIR crossover filters could not be prepared. Try fewer taps or a higher latency.',
      'error'
    );
  }

  _setupMessageHandler() {
    super._setupMessageHandler();
    this.ensureDspTelemetrySubscription();
    if (!this._lastDesign && this._designTimer === null) this._scheduleDesign(0);
  }

  ensureDspTelemetrySubscription() {
    const hub = window.dspTelemetryHub;
    const tapId = this.id;
    if (!Number.isInteger(tapId) || tapId < 0 || tapId > 0xffffffff ||
      !hub || typeof hub.subscribe !== 'function') return false;
    if (this._dspTelemetryUnsubscribe &&
      hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) return true;
    this.disposeDspTelemetrySubscription();
    try {
      const unsubscribe = hub.subscribe(
        tapId,
        FIR_CROSSOVER_CHANNEL_COUNT_FRAME,
        this._boundDspChannelCountTelemetry
      );
      if (typeof unsubscribe !== 'function') return false;
      this._dspTelemetryHub = hub;
      this._dspTelemetryTapId = tapId;
      this._dspTelemetryUnsubscribe = unsubscribe;
      return true;
    } catch (error) {
      return false;
    }
  }

  disposeDspTelemetrySubscription() {
    const unsubscribe = this._dspTelemetryUnsubscribe;
    this._dspTelemetryHub = null;
    this._dspTelemetryTapId = null;
    this._dspTelemetryUnsubscribe = null;
    try {
      unsubscribe?.();
    } catch (error) {
      // Ignore cleanup of a stale telemetry subscription.
    }
  }

  parseDspChannelCountTelemetryFrame(frame) {
    if (frame?.frameType !== FIR_CROSSOVER_CHANNEL_COUNT_FRAME ||
      frame.formatVersion !== FIR_CROSSOVER_TELEMETRY_VERSION) return null;
    const payload = frame.payload;
    if (!payload || typeof payload.getUint32 !== 'function' ||
      payload.byteLength !== FIR_CROSSOVER_CHANNEL_COUNT_BYTES) return null;
    const channels = payload.getUint32(0, true);
    return channels >= 1 && channels <= 16 ? channels : null;
  }

  handleDspChannelCountTelemetry(frame) {
    const channels = this.parseDspChannelCountTelemetryFrame(frame);
    if (channels === null || !this.enabled || !this._sectionEnabled) return;
    this._applyOutputChannelCount(channels);
  }

  _applyOutputChannelCount(channels) {
    const previous = this._outputChannelCount;
    const previousBandCount = this.bc;
    this._outputChannelCount = channels;
    const maximumBandCount = this._maximumBandCount(channels);
    this.maxBands = maximumBandCount || 2;
    if (maximumBandCount) this.bc = Math.min(this.bc, maximumBandCount);
    this._renderBusError();
    this._syncControls();
    if (previous !== channels || previousBandCount !== this.bc) this._scheduleDesign(0);
  }

  onMessage(message) {
    this.ensureDspTelemetrySubscription();
    if (message.type === 'dspExecutionState' && message.pluginId === this.id &&
      message.validated === true) {
      this.executionState = { state: message.state, reason: message.reason || null };
      this._renderStatusMessage();
    }
  }

  _executionStatusText() {
    if (this.executionState.state !== 'bypassed') return '';
    const messages = {
      unsupportedSampleRate: 'This sample rate is not supported. FIR Crossover is bypassed.',
      wasmUnavailable: 'WASM audio processing is unavailable. FIR Crossover is bypassed.',
      rolloutDisabled: 'DSP processing is disabled. FIR Crossover is bypassed.',
      runtimeFallback: 'Audio processing was interrupted. FIR Crossover is bypassed.'
    };
    return messages[this.executionState.reason] || '';
  }

  _setStatus(message, state = '') {
    if (this._disposed) return;
    this._statusMessage = message;
    this._statusState = state;
    this._renderStatusMessage();
  }

  _renderStatusMessage() {
    if (!this._statusElement) return;
    const executionMessage = this._executionStatusText();
    this._statusElement.textContent = executionMessage || this._statusMessage || '';
    this._statusElement.dataset.state = executionMessage ? 'error' : this._statusState || '';
  }

  _renderStatus() {
    if (!this._latencyElement) return;
    const hasFilter = Boolean(this._lastDesign) && this._effectiveBandCount() > 0;
    const samples = hasFilter ? Number(this.lt) + (this.pm === 'min' ? 0 : this.tp / 2) : 0;
    const milliseconds = samples * 1000 / this._sampleRate;
    const assetLabels = ['bypass', 'staged', 'preparing', 'active', 'error'];
    this._latencyElement.textContent =
      `${samples} samples / ${milliseconds.toFixed(1)} ms · ` +
      `${(this._sampleRate / this.tp).toFixed(1)} Hz · ` +
      `${assetLabels[this._assetState] || 'bypass'}`;
  }

  _renderBusError() {
    if (!this._errorElement) return;
    const invalid = !this._maximumBandCount(this._outputChannelCount);
    this._errorElement.hidden = !invalid;
    this._errorElement.textContent = invalid
      ? 'This effect needs an even number of output channels from 4 to 16.'
      : '';
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'plugin-parameter-ui fir-crossover-ui';

    const error = document.createElement('div');
    error.className = 'fir-crossover-error';
    this._errorElement = error;
    container.appendChild(error);

    const settings = document.createElement('div');
    settings.className = 'fir-crossover-settings';
    settings.appendChild(this.createRadioGroup('Phase', [
      { value: 'min', label: 'Minimum Phase' },
      { value: 'lin', label: 'Linear Phase' }
    ], this.pm, value => this.setParameters({ pm: value }), 'pm'));
    settings.appendChild(this.createSelectControl('Taps',
      [8192, 16384, 32768, 65536, 131072].map(value => ({
        value: String(value),
        label: String(value)
      })),
      String(this.tp),
      value => this.setParameters({ tp: Number(value) }), 'tp'));
    settings.appendChild(this.createSelectControl('Latency',
      [0, 128, 256, 512, 1024].map(value => ({
        value: String(value),
        label: `${value} samples`
      })),
      this.lt,
      value => this.setParameters({ lt: value }), 'lt'));
    container.appendChild(settings);

    const bandRow = document.createElement('div');
    bandRow.className = 'parameter-row fir-crossover-band-count';
    const bandLabel = document.createElement('label');
    bandLabel.textContent = 'Band Count:';
    const bandOptions = document.createElement('div');
    bandOptions.className = 'fir-crossover-radio-group';
    this._bandRadios = [2, 3, 4].map(value => {
      const wrapper = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `${this.id}-fir-crossover-bands`;
      input.value = String(value);
      input.checked = value === this.bc;
      input.addEventListener('change', () => {
        if (input.checked) this.setParameters({ bc: value });
      });
      wrapper.append(input, document.createTextNode(String(value)));
      bandOptions.appendChild(wrapper);
      return input;
    });
    bandRow.append(bandLabel, bandOptions);
    container.appendChild(bandRow);

    this._crossoverControls = [1, 2, 3].map(index =>
      this._createCrossoverControl(container, index));

    const graphWrap = document.createElement('div');
    graphWrap.className = 'fir-crossover-graph-container';
    const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
      maxWidth: 600,
      aspectRatio: '5 / 2',
      mobileAspectRatio: '2 / 1',
      className: 'fir-crossover-graph',
      onResize: () => this.drawGraph()
    });
    canvas.style.backgroundColor = '#222';
    this.canvas = canvas;
    this._graphDispose?.();
    this._graphDispose = dispose;
    graphWrap.appendChild(graphContainer);
    container.appendChild(graphWrap);

    const statusLine = document.createElement('div');
    statusLine.className = 'fir-crossover-status-line';
    const status = document.createElement('div');
    status.className = 'fir-crossover-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const latency = document.createElement('div');
    latency.className = 'fir-crossover-latency';
    this._statusElement = status;
    this._latencyElement = latency;
    statusLine.append(status, latency);
    container.appendChild(statusLine);

    this._renderBusError();
    this._syncControls();
    this._setStatus(this._statusMessage || 'Preparing FIR crossover filters…',
      this._statusState || 'preparing');
    this._renderStatus();
    this.drawGraph();
    if (!this._lastDesign && this._designTimer === null) this._scheduleDesign(0);
    return container;
  }

  _createCrossoverControl(parent, index) {
    const key = `f${index}`;
    const slopeKey = `s${index}`;
    const row = document.createElement('div');
    row.className = `parameter-row fir-crossover-frequency-row fir-crossover-frequency-${index}`;
    const range = document.createElement('input');
    range.type = 'range';
    range.id = `${this.id}-fir-crossover-frequency-${index}-slider`;
    range.name = range.id;
    range.min = '0';
    range.max = '1000';
    range.step = '1';
    range.value = String(this._frequencyToSlider(this[key]));
    range.autocomplete = 'off';
    range.setAttribute('aria-label', `Crossover ${index} frequency`);
    const label = document.createElement('label');
    label.htmlFor = range.id;
    label.textContent = `Freq ${index} (Hz):`;
    const number = document.createElement('input');
    number.type = 'number';
    number.id = `${this.id}-fir-crossover-frequency-${index}-value`;
    number.name = number.id;
    number.min = '10';
    number.max = '40000';
    number.step = '1';
    number.value = String(this[key]);
    number.autocomplete = 'off';
    const slope = document.createElement('select');
    slope.className = 'slope-select';
    slope.id = `${this.id}-fir-crossover-slope-${index}`;
    slope.name = slope.id;
    slope.autocomplete = 'off';
    slope.setAttribute('aria-label', `Crossover ${index} slope`);
    for (const value of FIR_CROSSOVER_SLOPES) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${Math.abs(value)}dB`;
      option.selected = value === this[slopeKey];
      slope.appendChild(option);
    }
    range.addEventListener('input', () => {
      const value = Math.round(this._sliderToFrequency(Number(range.value)));
      number.value = String(value);
      this.setParameters({ [key]: value });
    });
    number.addEventListener('change', () => {
      this.setParameters({ [key]: number.value });
      number.value = String(this[key]);
      range.value = String(this._frequencyToSlider(this[key]));
    });
    slope.addEventListener('change', () =>
      this.setParameters({ [slopeKey]: Number(slope.value) }));
    row.append(label, range, number, slope);
    parent.appendChild(row);
    return { root: row, number, slope, range };
  }

  _sliderToFrequency(value) {
    return 10 ** (1 + value / 1000 * (Math.log10(40000) - 1));
  }

  _frequencyToSlider(value) {
    return 1000 * (Math.log10(value) - 1) / (Math.log10(40000) - 1);
  }

  _syncControls() {
    for (let index = 0; index < this._bandRadios.length; index += 1) {
      const value = index + 2;
      const radio = this._bandRadios[index];
      radio.checked = value === this.bc;
      radio.disabled = value > this.maxBands;
      radio.closest?.('label')?.classList.toggle('disabled', radio.disabled);
    }
    for (let index = 0; index < this._crossoverControls.length; index += 1) {
      const control = this._crossoverControls[index];
      const enabled = index < this.bc - 1;
      control.root.classList.toggle('disabled', !enabled);
      for (const input of control.root.querySelectorAll('input, select')) input.disabled = !enabled;
      const frequency = this[`f${index + 1}`];
      control.number.value = String(frequency);
      control.range.value = String(this._frequencyToSlider(frequency));
      window.uiManager?.refreshRangeFillStyling?.(control.range);
      control.slope.value = String(this[`s${index + 1}`]);
    }
  }

  _getCanvasDpr(canvas) {
    const rect = canvas.getBoundingClientRect?.();
    const cssWidth = canvas.clientWidth || rect?.width || canvas.width || 1;
    return canvas.width / cssWidth;
  }

  _lowWeight(frequency, cutoff, slope) {
    if (!(frequency > 0)) return 1;
    const exponent = Math.abs(slope) / (20 * Math.log10(2)) *
      Math.log(frequency / cutoff);
    if (exponent <= -36) return 1;
    if (exponent >= 36) return 0;
    return 1 / (1 + Math.exp(exponent));
  }

  _bandMagnitudes(frequency) {
    const values = new Float64Array(this.bc);
    let remainder = 1;
    for (let crossover = 0; crossover < this.bc - 1; crossover += 1) {
      const low = this._lowWeight(
        frequency,
        this[`f${crossover + 1}`],
        this[`s${crossover + 1}`]
      );
      values[crossover] = remainder * low;
      remainder *= 1 - low;
    }
    values[this.bc - 1] = remainder;
    return values;
  }

  drawGraph() {
    if (!this.canvas) return;
    const context = this.canvas.getContext('2d');
    const { width, height } = this.canvas;
    if (!width || !height) return;
    const dpr = this._getCanvasDpr(this.canvas);
    const cssWidth = width / dpr;
    const tickFont = Math.round(11 * dpr);
    const axisFont = Math.round(13 * dpr);
    const bottomTickY = height - 26 * dpr;
    const axisBottomY = height - 4 * dpr;
    const leftLabelX = 40 * dpr;
    const axisLabelX = 12 * dpr;
    const minimumLog = Math.log10(10);
    const maximumLog = Math.log10(40000);
    const isMobileLayout = typeof document !== 'undefined' &&
      document.body?.classList.contains('layout-mobile');

    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#444';
    context.lineWidth = (isMobileLayout ? 1 : 0.5) * dpr;
    context.font = `${tickFont}px Arial`;

    const gridFrequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const labeledFrequencies = cssWidth < 420
      ? [20, 100, 500, 2000, 10000]
      : gridFrequencies;
    for (const frequency of gridFrequencies) {
      const x = width * (Math.log10(frequency) - minimumLog) /
        (maximumLog - minimumLog);
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      if (labeledFrequencies.includes(frequency)) {
        context.fillStyle = '#666';
        context.textAlign = 'center';
        context.fillText(
          frequency >= 1000 ? `${frequency / 1000}k` : frequency,
          x,
          bottomTickY
        );
      }
    }

    const decibelRange = [-60, 12];
    const decibelSpan = decibelRange[1] - decibelRange[0];
    for (const decibels of [-60, -48, -36, -24, -12, 0]) {
      const y = height * (1 - (decibels - decibelRange[0]) / decibelSpan);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      if (decibels > decibelRange[0]) {
        context.fillStyle = '#666';
        context.textAlign = 'right';
        context.fillText(`${decibels}`, leftLabelX, y + 3 * dpr);
      }
    }

    context.fillStyle = '#fff';
    context.font = `${axisFont}px Arial`;
    context.textAlign = 'center';
    context.fillText('Frequency (Hz)', width / 2, axisBottomY);
    context.save();
    context.translate(axisLabelX, height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText('Level (dB)', 0, 0);
    context.restore();

    context.strokeStyle = '#00ff00';
    context.lineWidth = (isMobileLayout ? 2 : 1.5) * dpr;
    for (let band = 0; band < this.bc; band += 1) {
      context.beginPath();
      for (let x = 0; x < width; x += 1) {
        const frequency = 10 ** (minimumLog +
          x / Math.max(1, width - 1) * (maximumLog - minimumLog));
        const magnitude = this._bandMagnitudes(frequency)[band];
        const decibels = 20 * Math.log10(Math.max(1e-8, magnitude));
        const y = height * (1 - (decibels - decibelRange[0]) / decibelSpan);
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  }

  cleanup() {
    if (this._disposed) return;
    this._disposed = true;
    ++this._designGeneration;
    if (this._designTimer !== null) clearTimeout(this._designTimer);
    this._designTimer = null;
    this._designer?.close();
    this._designer = null;
    this.disposeDspTelemetrySubscription();
    this._graphDispose?.();
    this._graphDispose = null;
    this._statusElement = null;
    this._latencyElement = null;
    this._errorElement = null;
    this.canvas = null;
    super.cleanup();
  }
}

window.FIRCrossoverPlugin = FIRCrossoverPlugin;
