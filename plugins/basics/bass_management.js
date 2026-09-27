const BASS_MANAGEMENT_CHANNEL_COUNT_FRAME = 9;
const BASS_MANAGEMENT_TELEMETRY_VERSION = 1;
const BASS_MANAGEMENT_CHANNEL_COUNT_BYTES = 4;
const BASS_MANAGEMENT_MAX_CHANNELS = 16;
const BASS_MANAGEMENT_SAMPLE_RATES = Object.freeze([
  44100, 48000, 88200, 96000, 176400, 192000
]);
const BASS_MANAGEMENT_SLOPES = Object.freeze([24, 48, 96]);
const BASS_MANAGEMENT_TAPS = Object.freeze(['8192', '16384', '32768']);
const BASS_MANAGEMENT_ROLES = Object.freeze([
  'Full Range', 'Managed', 'LFE', 'Unused'
]);

class BassManagementPlugin extends PluginBase {
  static executionCapabilities = Object.freeze({
    requiresWasm: true,
    supportedSampleRates: BASS_MANAGEMENT_SAMPLE_RATES,
    supportedChannelModes: Object.freeze(['all'])
  });

  constructor() {
    super('Bass Management', 'Route low frequencies from each input to one or more subwoofer outputs');
    this.channel = 'A';
    this.ph = 'IIR';
    this.tp = '16384';
    this.ro = Array(BASS_MANAGEMENT_MAX_CHANNELS).fill(0);
    this.fc = Array(BASS_MANAGEMENT_MAX_CHANNELS).fill(80);
    this.sl = Array(BASS_MANAGEMENT_MAX_CHANNELS).fill(24);
    this.rt = Array(BASS_MANAGEMENT_MAX_CHANNELS).fill(0);
    this.ri = Array(BASS_MANAGEMENT_MAX_CHANNELS).fill(0);
    this.su = 0;
    this.lf = 120;
    this.ls = 24;
    this.lo = false;
    this.bg = 0;
    this.lg = 0;
    this.hg = 0;
    this.temporalCapability = 'reset-on-resume';
    this.offlineDspAssetErrorMessageKey = 'bassManagement.error.design';
    this.powerGainUpperBoundDb = 0;

    this._sampleRate = this._getEngineSampleRate();
    this._outputChannelCount = this._getEngineChannelCount();
    this._processingChannelCount = this._outputChannelCount;
    this.ro.fill(1, 0, this._processingChannelCount);
    this._runtimePromise = null;
    this._designer = null;
    this._designTimer = null;
    this._designGeneration = 0;
    this._designPending = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._candidateDesign = null;
    this._activeDesign = null;
    this._assetState = 0;
    this._disposed = false;
    this.executionState = { state: 'pending', reason: null };
    this._statusMessage = '';
    this._statusState = '';
    this._statusElement = null;
    this._latencyElement = null;
    this._errorElement = null;
    this._routeElement = null;
    this._channelControls = [];
    this._subControls = [];
    this._matrixWrapper = null;
    this._matrixSignature = '';
    this._linearQualityControl = null;
    this._lfeFrequencyControls = [];
    this._lfeSlopeControl = null;
    this._graphChannel = 0;
    this._graphDispose = null;
    this._dspTelemetryHub = null;
    this._dspTelemetryTapId = null;
    this._dspTelemetryUnsubscribe = null;
    this._boundChannelCountTelemetry = frame => this.handleDspChannelCountTelemetry(frame);
    this.registerProcessor('return data;');
    this._updatePowerGainBound();
  }

  process(context, data) {
    return data;
  }

  _getEngineSampleRate() {
    const value = this._sampleRate || window.workletNode?.context?.sampleRate ||
      window.audioContext?.sampleRate || window.uiManager?.audioManager?.audioContext?.sampleRate;
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

  _ownParameters() {
    return {
      ph: this.ph,
      tp: this.tp,
      ro: [...this.ro],
      fc: [...this.fc],
      sl: [...this.sl],
      rt: [...this.rt],
      ri: [...this.ri],
      su: this.su,
      lf: this.lf,
      ls: this.ls,
      lo: this.lo,
      bg: this.bg,
      lg: this.lg,
      hg: this.hg
    };
  }

  getParameters(options = {}) {
    this.ensureDspTelemetrySubscription();
    const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
      ? options.sampleRate : this._sampleRate;
    const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
      options.outputChannelCount >= 1 && options.outputChannelCount <= 16
      ? options.outputChannelCount : this._outputChannelCount;
    if (options.commitSampleRate &&
      (sampleRate !== this._sampleRate || outputChannelCount !== this._outputChannelCount)) {
      this._sampleRate = sampleRate;
      this._outputChannelCount = outputChannelCount;
      if (this.ph === 'Linear') this._scheduleDesign(0);
    }
    return { ...super.getParameters(), ...this._ownParameters() };
  }

  _validatedArray(candidate, current, normalize) {
    if (!Array.isArray(candidate)) return current;
    return Array.from({ length: BASS_MANAGEMENT_MAX_CHANNELS }, (_, index) =>
      normalize(candidate[index], current[index]));
  }

  setParameters(params = {}) {
    const previousDesign = this._designSignature();
    const previousPhase = this.ph;
    super._setValidatedParameters(params);
    if (params.ph === 'IIR' || params.ph === 'Linear') this.ph = params.ph;
    if (BASS_MANAGEMENT_TAPS.includes(String(params.tp))) this.tp = String(params.tp);
    this.ro = this._validatedArray(params.ro, this.ro, (value, previous) => {
      const role = Math.round(Number(value));
      return role >= 0 && role <= 3 ? role : previous;
    });
    this.fc = this._validatedArray(params.fc, this.fc, (value, previous) =>
      Math.round(this.parseFiniteNumber(value, 20, 300, previous)));
    this.sl = this._validatedArray(params.sl, this.sl, (value, previous) => {
      const slope = Math.round(Number(value));
      return BASS_MANAGEMENT_SLOPES.includes(slope) ? slope : previous;
    });
    this.rt = this._validatedArray(params.rt, this.rt, (value, previous) => {
      const mask = Math.round(Number(value));
      return Number.isSafeInteger(mask) ? Math.max(0, Math.min(65535, mask)) : previous;
    });
    this.ri = this._validatedArray(params.ri, this.ri, (value, previous) => {
      const mask = Math.round(Number(value));
      return Number.isSafeInteger(mask) ? Math.max(0, Math.min(65535, mask)) : previous;
    });
    for (let channel = 0; channel < BASS_MANAGEMENT_MAX_CHANNELS; channel += 1) {
      this.ri[channel] &= this.rt[channel];
    }
    if (params.su !== undefined) {
      const mask = Math.round(Number(params.su));
      if (Number.isSafeInteger(mask)) this.su = Math.max(0, Math.min(65535, mask));
    }
    this.lf = Math.round(this.parseFiniteNumber(params.lf, 20, 300, this.lf));
    const lfeSlope = Math.round(Number(params.ls));
    if (BASS_MANAGEMENT_SLOPES.includes(lfeSlope)) this.ls = lfeSlope;
    if (params.lo !== undefined) this.lo = Boolean(params.lo);
    this.bg = this.parseFiniteNumber(params.bg, -24, 12, this.bg);
    this.lg = this.parseFiniteNumber(params.lg, -24, 12, this.lg);
    this.hg = this.parseFiniteNumber(params.hg, -24, 0, this.hg);

    this.updateParameters();
    const error = this._configurationError();
    if (this.su === 0) {
      this._cancelDesign();
      if (this._assetState || this._candidateDesign || this._activeDesign) this.clearWasmAsset(0);
      this._candidateDesign = null;
      this._activeDesign = null;
      this._assetState = 0;
      this._updatePowerGainBound();
      this._setStatus('Select one or more Sub Outputs to configure bass management.');
    } else if (this.ph === 'IIR') {
      this._cancelDesign();
      if (previousPhase === 'Linear' || this._assetState || this._candidateDesign || this._activeDesign) {
        this.clearWasmAsset(0);
      }
      this._candidateDesign = null;
      this._activeDesign = null;
      this._assetState = 0;
      this._updatePowerGainBound();
      this._setStatus(error || 'IIR bass management is active.', error ? 'error' : 'ready');
    } else if (error) {
      this._cancelDesign();
      this._setStatus(error, 'error');
    } else if (this._linearInputChannels().length === 0) {
      this._cancelDesign();
      if (this._assetState || this._candidateDesign || this._activeDesign) this.clearWasmAsset(0);
      this._candidateDesign = null;
      this._activeDesign = null;
      this._assetState = 0;
      this._updatePowerGainBound();
      this._setStatus('Linear routing is active; no low-pass filters are required.', 'ready');
    } else if (previousDesign !== this._designSignature() ||
      !this._activeDesign && !this._designPending) {
      this._scheduleDesign(150);
    } else {
      this._updatePowerGainBound(this._activeDesign);
      if (!this._designPending) {
        this._setStatus('Linear-phase bass management filters are active.', 'ready');
      }
    }
    this._syncControls();
    this._renderConfiguration();
    this._renderStatus();
    this.drawGraph();
  }

  _settingsSignature() {
    return JSON.stringify(this._ownParameters());
  }

  _filterSignature() {
    return JSON.stringify([
      this.ph, this.tp, this.ro, this.fc, this.sl, this.lo, this.lf, this.ls
    ]);
  }

  _designSignature(sampleRate = this._sampleRate, channelCount = this._processingChannelCount) {
    return JSON.stringify([this._filterSignature(), sampleRate, channelCount]);
  }

  _designConfig(sampleRate = this._sampleRate, channelCount = this._processingChannelCount) {
    return {
      sampleRate,
      channelCount,
      taps: Number(this.tp),
      roles: this.ro,
      frequencies: this.fc,
      slopes: this.sl,
      lfeLowpass: this.lo,
      lfeFrequency: this.lf,
      lfeSlope: this.ls
    };
  }

  _linearInputChannels(channelCount = this._processingChannelCount) {
    const inputs = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      if (this.ro[channel] === 1 || this.ro[channel] === 2 && this.lo) inputs.push(channel);
    }
    return inputs;
  }

  _configurationError(channelCount = this._processingChannelCount) {
    if (this.channel !== 'A') return 'Set Ch to All so channel routes keep their displayed numbers.';
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 16) {
      return 'The current processing channel count is unavailable.';
    }
    const availableMask = channelCount === 16 ? 65535 : (1 << channelCount) - 1;
    if ((this.su & ~availableMask) !== 0) {
      return 'A selected Sub output is outside the current processing width.';
    }
    for (let channel = channelCount; channel < 16; channel += 1) {
      if (this.ro[channel] === 1 || this.ro[channel] === 2 || this.rt[channel] !== 0) {
        return `Ch ${channel + 1} is configured outside the current processing width.`;
      }
    }
    if (this.su === 0) return '';
    for (let channel = 0; channel < channelCount; channel += 1) {
      const bit = 1 << channel;
      if ((this.su & bit) !== 0 && (this.ro[channel] === 0 || this.ro[channel] === 1)) {
        return `Ch ${channel + 1} cannot be both a Main input and a Sub output.`;
      }
      if (this.ro[channel] !== 1 && this.ro[channel] !== 2) continue;
      const targets = this.rt[channel];
      if ((this.ri[channel] & ~targets) !== 0) {
        return `Ch ${channel + 1} has an inverted route that is not enabled.`;
      }
      if (targets === 0) return `Ch ${channel + 1} needs at least one Sub target.`;
      if ((targets & ~this.su) !== 0 || (targets & ~availableMask) !== 0) {
        return `Ch ${channel + 1} targets an output that is not an available Sub.`;
      }
    }
    return '';
  }

  async _getRuntime() {
    if (!this._runtimePromise) {
      this._runtimePromise = Promise.all([
        import('../../js/bass-management/designer.js'),
        import('../../js/ir-library/ir-asset-payload.js'),
        import('../../js/ir-library/ir-plugin-contract.js')
      ]).then(([designer, payload, contract]) => ({ ...designer, ...payload, ...contract }));
    }
    return this._runtimePromise;
  }

  _cancelDesign() {
    ++this._designGeneration;
    if (this._designTimer !== null) clearTimeout(this._designTimer);
    this._designTimer = null;
    this._designPending = false;
    this._candidateAssetRevision = null;
    this._candidateDesign = null;
  }

  _scheduleDesign(delay = 150) {
    if (this._disposed || this.ph !== 'Linear' || this.su === 0) return;
    if (this._designTimer !== null) clearTimeout(this._designTimer);
    const generation = ++this._designGeneration;
    this._designPending = true;
    this._candidateAssetRevision = null;
    this._candidateDesign = null;
    this._setStatus('Designing linear-phase bass management filters…', 'preparing');
    this._designTimer = setTimeout(() => {
      if (this._disposed || generation !== this._designGeneration) return;
      this._designTimer = null;
      this._designAndStage(generation);
    }, delay);
  }

  async _designAndStage(generation) {
    try {
      if (this._disposed || generation !== this._designGeneration) return false;
      const runtime = await this._getRuntime();
      if (this._disposed || generation !== this._designGeneration) return false;
      if (!this._designer) this._designer = runtime.createBassManagementDesigner();
      const result = await this._designer.design(this._designConfig());
      if (this._disposed || generation !== this._designGeneration) return false;
      return this._stageDesign(result, generation);
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error('Bass Management design failed:', error);
      this._designPending = false;
      this._assetState = 4;
      this._setStatus('The linear-phase filters could not be designed. Try fewer taps.', 'error');
      this._renderStatus();
      return false;
    }
  }

  async _stageDesign(result, generation = this._designGeneration) {
    try {
      if (this._disposed || generation !== this._designGeneration || this.ph !== 'Linear') {
        return false;
      }
      const expectedInputs = this._linearInputChannels();
      if (!Array.isArray(result?.inputChannels) ||
        result.inputChannels.length !== expectedInputs.length ||
        result.inputChannels.some((channel, index) => channel !== expectedInputs[index]) ||
        !(result.payload instanceof ArrayBuffer)) return false;
      const runtime = await this._getRuntime();
      if (this._disposed || generation !== this._designGeneration) return false;
      const pathCount = result.inputChannels.length;
      const footprintBytes = runtime.estimateIrKernelCommitFootprint({
        frames: Number(this.tp),
        assetChannels: pathCount,
        topology: runtime.IR_ASSET_TOPOLOGY.matrix,
        processingChannels: this._processingChannelCount,
        headBlock: 128,
        pathCount,
        inputCount: this._processingChannelCount
      });
      this._candidateDesign = result;
      this._assetState = 1;
      const operationRevision = this.setWasmAsset(0, {
        payload: result.payload,
        formatTag: 1,
        headBlock: 128,
        rateDivider: 1,
        pathCount,
        inputCount: this._processingChannelCount,
        processingChannels: this._processingChannelCount,
        footprintBytes,
        externalAssetSignature: this._assetSignature()
      });
      if (this._disposed || generation !== this._designGeneration) return false;
      this._candidateAssetRevision = operationRevision;
      this._updatePowerGainBound(result);
      this._renderStatus();
      return true;
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error('Bass Management asset staging failed:', error);
      this._designPending = false;
      this._candidateAssetRevision = null;
      this._candidateDesign = null;
      this._assetState = 4;
      this._setStatus('The linear-phase filters could not be prepared. Try fewer taps.', 'error');
      this._renderStatus();
      return false;
    }
  }

  _assetSignature(sampleRate = this._sampleRate, channelCount = this._processingChannelCount) {
    return JSON.stringify([1, this._designConfig(sampleRate, channelCount), 128, channelCount]);
  }

  _updatePowerGainBound(design = null) {
    if (this.su === 0) {
      this.powerGainUpperBoundDb = 0;
      return;
    }
    const headGain = 10 ** (this.hg / 20);
    const bassGain = 10 ** (this.bg / 20);
    const lfeGain = 10 ** (this.lg / 20);
    const norms = new Map();
    if (design?.inputChannels && design?.l1Norms) {
      design.inputChannels.forEach((channel, index) => norms.set(channel, design.l1Norms[index]));
    }
    let maximum = headGain;
    const subSums = new Float64Array(BASS_MANAGEMENT_MAX_CHANNELS);
    for (let input = 0; input < this._processingChannelCount; input += 1) {
      const role = this.ro[input];
      const filtered = role === 1 || role === 2 && this.lo;
      const norm = filtered ? (norms.get(input) || 4) : 1;
      if (role === 1) maximum = Math.max(maximum, headGain * (1 + norm));
      if (role !== 1 && role !== 2) continue;
      const targets = this.rt[input] & this.su;
      let count = 0;
      for (let output = 0; output < BASS_MANAGEMENT_MAX_CHANNELS; output += 1) {
        if ((targets & (1 << output)) !== 0) count += 1;
      }
      if (!count) continue;
      const contribution = (role === 1 ? bassGain : lfeGain) * norm / count;
      for (let output = 0; output < BASS_MANAGEMENT_MAX_CHANNELS; output += 1) {
        if ((targets & (1 << output)) === 0) continue;
        subSums[output] += contribution;
        maximum = Math.max(maximum, headGain * subSums[output]);
      }
    }
    this.powerGainUpperBoundDb = 20 * Math.log10(Math.max(1, maximum));
  }

  get offlineDspAssetRequired() {
    return this.su !== 0 && this.ph === 'Linear' && !this._configurationError() &&
      this._linearInputChannels().length > 0;
  }

  _offlineError(message) {
    const error = new Error(message);
    error.userMessageKey = this.offlineDspAssetErrorMessageKey;
    return error;
  }

  async createOfflineDspState({ sampleRate, outputChannelCount, isCurrent = () => true } = {}) {
    const snapshot = {
      generation: this._designGeneration,
      settingsSignature: this._settingsSignature(),
      parameters: { ...super.getParameters(), ...this._ownParameters() },
      config: this._designConfig(sampleRate, outputChannelCount),
      outputChannelCount
    };
    const current = () => !this._disposed && isCurrent() &&
      snapshot.generation === this._designGeneration &&
      snapshot.settingsSignature === this._settingsSignature();
    if (!current()) throw this._offlineError('Bass Management settings changed during offline preparation.');
    const error = this._configurationError(outputChannelCount);
    if (error) throw this._offlineError(error);
    const linearInputs = this._linearInputChannels(outputChannelCount);
    if (this.su === 0 || this.ph !== 'Linear' || linearInputs.length === 0) {
      return { parameters: snapshot.parameters, assets: new Map(), offlineDspAssetRequired: false };
    }
    const runtime = await this._getRuntime();
    if (!current()) throw this._offlineError('Bass Management settings changed during offline preparation.');
    const designer = runtime.createBassManagementDesigner();
    let designed;
    try {
      designed = await designer.design(snapshot.config);
    } finally {
      designer.close();
    }
    if (!current()) throw this._offlineError('Bass Management settings changed during offline preparation.');
    if (!(designed?.payload instanceof ArrayBuffer) ||
      designed.inputChannels?.length !== linearInputs.length) {
      throw this._offlineError('Bass Management filters could not be prepared.');
    }
    const pathCount = linearInputs.length;
    const footprintBytes = runtime.estimateIrKernelCommitFootprint({
      frames: Number(this.tp),
      assetChannels: pathCount,
      topology: runtime.IR_ASSET_TOPOLOGY.matrix,
      processingChannels: outputChannelCount,
      headBlock: 128,
      pathCount,
      inputCount: outputChannelCount
    });
    return {
      parameters: snapshot.parameters,
      assets: new Map([[0, {
        payload: designed.payload,
        formatTag: 1,
        headBlock: 128,
        rateDivider: 1,
        pathCount,
        inputCount: outputChannelCount,
        processingChannels: outputChannelCount,
        footprintBytes,
        warmupSamples: Number(this.tp) / 2 + 128,
        externalAssetSignature: JSON.stringify([1, snapshot.config, 128, outputChannelCount])
      }]]),
      offlineDspAssetRequired: true
    };
  }

  onWasmAssetState(slot, state, operationRevision) {
    if (this._disposed || slot !== 0 ||
      !this._isCurrentWasmAssetOperation(slot, operationRevision)) return;
    const status = state & 0xff;
    if (operationRevision !== this._candidateAssetRevision && status !== 4) return;
    this._assetState = status;
    if (status === 3 && operationRevision === this._candidateAssetRevision) {
      this._designPending = false;
      this._effectiveAssetRevision = operationRevision;
      this._candidateAssetRevision = null;
      this._activeDesign = this._candidateDesign;
      this._candidateDesign = null;
      this._setStatus('Linear-phase bass management filters are active.', 'ready');
      this.drawGraph();
    } else if (status === 4) {
      this._designPending = false;
      this._candidateAssetRevision = null;
      this._candidateDesign = null;
      this._setStatus('The linear-phase filters could not be prepared. Try fewer taps.', 'error');
    }
    this._renderStatus();
  }

  onWasmAssetRejected(slot, reason, operationRevision, retention = {}) {
    if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
    console.warn('Bass Management asset admission rejected:', reason);
    this._designPending = false;
    this._candidateAssetRevision = null;
    this._candidateDesign = null;
    if (retention.residentRetained) {
      this._effectiveAssetRevision = retention.retainedOperationRevision;
      this._assetState = retention.retainedAssetState & 0xff;
      this._setStatus('The new filters could not be prepared; the previous routing remains active.', 'error');
    } else {
      this._effectiveAssetRevision = null;
      this._activeDesign = null;
      this._assetState = 4;
      this._setStatus('The filters could not be prepared. Main outputs remain dry and Sub outputs are silent.', 'error');
    }
    this._renderStatus();
  }

  _setupMessageHandler() {
    super._setupMessageHandler();
    this.ensureDspTelemetrySubscription();
    if (this.su !== 0 && this.ph === 'Linear' && !this._configurationError() &&
      this._linearInputChannels().length && !this._activeDesign && this._designTimer === null) {
      this._scheduleDesign(0);
    }
  }

  ensureDspTelemetrySubscription() {
    const hub = window.dspTelemetryHub;
    const tapId = this.id;
    if (!Number.isInteger(tapId) || tapId < 0 || tapId > 0xffffffff ||
      !hub || typeof hub.subscribe !== 'function') return false;
    if (this._dspTelemetryUnsubscribe && hub === this._dspTelemetryHub &&
      tapId === this._dspTelemetryTapId) return true;
    this.disposeDspTelemetrySubscription();
    try {
      const unsubscribe = hub.subscribe(
        tapId,
        BASS_MANAGEMENT_CHANNEL_COUNT_FRAME,
        this._boundChannelCountTelemetry
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
    try { unsubscribe?.(); } catch (error) { /* Ignore a stale subscription. */ }
  }

  parseDspChannelCountTelemetryFrame(frame) {
    if (frame?.frameType !== BASS_MANAGEMENT_CHANNEL_COUNT_FRAME ||
      frame.formatVersion !== BASS_MANAGEMENT_TELEMETRY_VERSION) return null;
    const payload = frame.payload;
    if (!payload || typeof payload.getUint32 !== 'function' ||
      payload.byteLength !== BASS_MANAGEMENT_CHANNEL_COUNT_BYTES) return null;
    const channels = payload.getUint32(0, true);
    return channels >= 1 && channels <= 16 ? channels : null;
  }

  handleDspChannelCountTelemetry(frame) {
    const channels = this.parseDspChannelCountTelemetryFrame(frame);
    if (channels === null || !this.enabled || !this._sectionEnabled ||
      channels === this._processingChannelCount) return;
    this._processingChannelCount = channels;
    if (this.ph === 'Linear') this._scheduleDesign(0);
    else this._updatePowerGainBound();
    this._syncControls();
    this._renderConfiguration();
    this.drawGraph();
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
      unsupportedChannelMode: 'Set Ch to All to use Bass Management.',
      unsupportedSampleRate: 'This sample rate is not supported. Bass Management is bypassed.',
      wasmUnavailable: 'WASM audio processing is unavailable. Bass Management is bypassed.',
      rolloutDisabled: 'DSP processing is disabled. Bass Management is bypassed.',
      runtimeFallback: 'Audio processing was interrupted. Bass Management is bypassed.'
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
    this._statusElement.textContent = executionMessage || this._statusMessage;
    this._statusElement.dataset.state = executionMessage ? 'error' : this._statusState;
  }

  _renderStatus() {
    if (!this._latencyElement) return;
    const samples = this.ph === 'Linear' ? Number(this.tp) / 2 + 128 : 0;
    const milliseconds = samples * 1000 / this._sampleRate;
    const assetLabels = ['not needed', 'staged', 'preparing', 'active', 'error'];
    this._latencyElement.textContent = this.ph === 'Linear'
      ? `${samples} samples / ${milliseconds.toFixed(1)} ms · ${assetLabels[this._assetState] || 'waiting'}`
      : '0 samples · IIR phase response';
  }

  _renderConfiguration() {
    const error = this._configurationError();
    if (this._errorElement) {
      this._errorElement.hidden = !error;
      this._errorElement.textContent = error;
    }
    if (!this._routeElement) return;
    if (this.su === 0) {
      this._routeElement.textContent = 'No Sub outputs selected.';
      return;
    }
    const routes = [];
    for (let input = 0; input < this._processingChannelCount; input += 1) {
      if (this.ro[input] !== 1 && this.ro[input] !== 2) continue;
      const targets = [];
      for (let output = 0; output < this._processingChannelCount; output += 1) {
        if ((this.rt[input] & (1 << output)) !== 0) targets.push(output + 1);
      }
      routes.push(`Ch ${input + 1} ${BASS_MANAGEMENT_ROLES[this.ro[input]]} → ${targets.length ? `Sub ${targets.join(', ')}` : 'no Sub'}`);
    }
    this._routeElement.textContent = routes.length
      ? routes.join(' · ')
      : 'No managed or LFE inputs. All Full Range channels pass through.';
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'plugin-parameter-ui bass-management-ui';
    const error = document.createElement('div');
    error.className = 'bass-management-error';
    this._errorElement = error;
    container.appendChild(error);

    const globalSettings = document.createElement('div');
    globalSettings.className = 'bass-management-global-settings';
    globalSettings.appendChild(this.createRadioGroup('Phase', [
      { value: 'IIR', label: 'IIR' },
      { value: 'Linear', label: 'Linear' }
    ], this.ph, value => this.setParameters({ ph: value }), 'ph'));
    const linearQualityRow = this.createSelectControl('Linear Quality', BASS_MANAGEMENT_TAPS.map(value => ({
      value, label: `${value} taps`
    })), this.tp, value => this.setParameters({ tp: value }), 'tp');
    this._linearQualityControl = linearQualityRow.querySelector('select');
    globalSettings.appendChild(linearQualityRow);
    const bassGainRow = this.createParameterControl('Bass Gain', -24, 12, 0.1, this.bg,
      value => this.setParameters({ bg: value }), 'dB', 'bg');
    const lfeGainRow = this.createParameterControl('LFE Gain', -24, 12, 0.1, this.lg,
      value => this.setParameters({ lg: value }), 'dB', 'lg');
    const headroomRow = this.createParameterControl('Headroom', -24, 0, 0.1, this.hg,
      value => this.setParameters({ hg: value }), 'dB', 'hg');
    const lfeLowpassRow = this.createCheckboxControl('LFE Low-pass', this.lo,
      value => this.setParameters({ lo: value }), 'lo');
    const lfeFrequencyRow = this.createParameterControl('LFE LP', 20, 300, 1, this.lf,
      value => this.setParameters({ lf: value }), 'Hz', 'lf');
    this._lfeFrequencyControls = [
      lfeFrequencyRow.querySelector('input[type="range"]'),
      lfeFrequencyRow.querySelector('input[type="number"]')
    ];
    this._bindWholeHertzNumber(...this._lfeFrequencyControls, false);
    const lfeSlopeRow = this.createSelectControl('LFE Slope', BASS_MANAGEMENT_SLOPES.map(value => ({
      value: String(value), label: `${value} dB/oct`
    })), String(this.ls), value => this.setParameters({ ls: Number(value) }), 'ls');
    this._lfeSlopeControl = lfeSlopeRow.querySelector('select');

    const subRow = document.createElement('div');
    subRow.className = 'parameter-row bass-management-subs';
    const subHeading = document.createElement('label');
    subHeading.textContent = 'Sub Outputs:';
    const subOptions = document.createElement('div');
    subOptions.className = 'bass-management-checkbox-group';
    this._subControls = Array.from({ length: BASS_MANAGEMENT_MAX_CHANNELS }, (_, channel) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `${this.id}-bass-management-sub-${channel + 1}`;
      input.name = input.id;
      input.autocomplete = 'off';
      input.checked = (this.su & (1 << channel)) !== 0;
      input.addEventListener('change', () => {
        this._setSubOutputEnabled(channel, input.checked);
      });
      label.append(input, document.createTextNode(` Ch ${channel + 1}`));
      subOptions.appendChild(label);
      return { label, input };
    });
    subRow.append(subHeading, subOptions);
    globalSettings.append(
      subRow, lfeLowpassRow, lfeFrequencyRow, lfeSlopeRow,
      bassGainRow, lfeGainRow, headroomRow
    );
    container.appendChild(globalSettings);

    const matrixHeading = document.createElement('div');
    matrixHeading.className = 'bass-management-section-heading';
    matrixHeading.textContent = 'Bass Matrix';
    container.appendChild(matrixHeading);
    this._matrixWrapper = document.createElement('div');
    this._matrixWrapper.className = 'bass-management-matrix-wrapper';
    this._matrixSignature = '';
    container.appendChild(this._matrixWrapper);

    const graphWrap = document.createElement('div');
    graphWrap.className = 'bass-management-graph-container';
    const graph = this.createResponsiveGraph({
      maxWidth: 600,
      aspectRatio: '5 / 2',
      mobileAspectRatio: '2 / 1',
      className: 'bass-management-graph',
      onResize: () => this.drawGraph()
    });
    graph.canvas.style.backgroundColor = 'var(--et-graph-bg-deep)';
    this.canvas = graph.canvas;
    this._graphDispose?.();
    this._graphDispose = graph.dispose;
    graphWrap.appendChild(graph.container);
    container.appendChild(graphWrap);

    this._graphReadout = window.GraphReadout?.attach({
      mount: graph.container,
      surface: this.canvas,
      read: x => this._readGraph(x)
    });

    const route = document.createElement('div');
    route.className = 'bass-management-route-summary';
    this._routeElement = route;
    container.appendChild(route);
    const statusLine = document.createElement('div');
    statusLine.className = 'bass-management-status-line';
    const status = document.createElement('div');
    status.className = 'bass-management-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const latency = document.createElement('div');
    latency.className = 'bass-management-latency';
    this._statusElement = status;
    this._latencyElement = latency;
    statusLine.append(status, latency);
    container.appendChild(statusLine);

    this._syncControls();
    this._renderConfiguration();
    this._setStatus(this._statusMessage || (this.su === 0
      ? 'Select one or more Sub Outputs to configure bass management.'
      : this.ph === 'IIR'
        ? 'IIR bass management is active.'
        : 'Preparing linear-phase bass management filters…'),
    this.su === 0 ? '' : this._statusState || 'ready');
    this._renderStatus();
    this.drawGraph();
    if (this.su !== 0 && this.ph === 'Linear' && !this._configurationError() &&
      this._linearInputChannels().length && !this._activeDesign && this._designTimer === null) {
      this._scheduleDesign(0);
    }
    return container;
  }

  _selectedSubOutputs() {
    const outputs = [];
    for (let channel = 0; channel < this._processingChannelCount; channel += 1) {
      if ((this.su & (1 << channel)) !== 0) outputs.push(channel);
    }
    return outputs;
  }

  _setSubOutputEnabled(channel, enabled) {
    const bit = 1 << channel;
    if (enabled) {
      const roles = [...this.ro];
      const routes = [...this.rt];
      const inversions = [...this.ri];
      roles[channel] = 2;
      for (let input = 0; input < this._processingChannelCount; input += 1) {
        routes[input] |= bit;
        inversions[input] &= ~bit;
      }
      this.setParameters({ ro: roles, su: this.su | bit, rt: routes, ri: inversions });
      return;
    }
    const routes = this.rt.map(mask => mask & ~bit);
    const inversions = this.ri.map(mask => mask & ~bit);
    this.setParameters({ su: this.su & ~bit, rt: routes, ri: inversions });
  }

  _bindWholeHertzNumber(range, number, logarithmic = true) {
    number?.addEventListener('input', () => {
      const value = Number(number.value);
      if (!Number.isFinite(value)) return;
      const rounded = Math.max(20, Math.min(300, Math.round(value)));
      number.value = String(rounded);
      if (range) {
        range.value = String(logarithmic
          ? 100 * Math.log(rounded / 20) / Math.log(15)
          : rounded);
        window.uiManager?.refreshRangeFillStyling?.(range);
      }
    });
  }

  _createMatrixInputControls(channel) {
    const channelNumber = channel + 1;
    const roleRow = this.createSelectControl(`Ch ${channelNumber} Role`,
      BASS_MANAGEMENT_ROLES.map((label, value) => ({ value: String(value), label })),
      String(this.ro[channel]), value => {
        const roles = [...this.ro];
        roles[channel] = Number(value);
        this.setParameters({ ro: roles });
      });
    roleRow.classList.add('bass-management-role-row');
    roleRow.querySelector('label').classList.add('bass-management-visually-hidden');
    const role = roleRow.querySelector('select');
    role.setAttribute('aria-label', `Ch ${channelNumber} Role`);

    const frequencyRow = this.createParameterControl(
      `Ch ${channelNumber} Freq`, 20, 300, 1, this.fc[channel], value => {
        const values = [...this.fc];
        values[channel] = value;
        this.setParameters({ fc: values });
      }, 'Hz', null, null, true);
    frequencyRow.classList.add('bass-management-frequency-row');
    frequencyRow.querySelector('label').classList.add('bass-management-visually-hidden');
    const frequencyRange = frequencyRow.querySelector('input[type="range"]');
    const frequency = frequencyRow.querySelector('input[type="number"]');
    this._bindWholeHertzNumber(frequencyRange, frequency);
    const slope = document.createElement('select');
    slope.id = `${this.id}-bass-management-slope-${channelNumber}`;
    slope.name = slope.id;
    slope.autocomplete = 'off';
    slope.className = 'slope-select';
    slope.setAttribute('aria-label', `Ch ${channelNumber} crossover slope`);
    for (const value of BASS_MANAGEMENT_SLOPES) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}dB`;
      slope.appendChild(option);
    }
    slope.addEventListener('change', () => {
      const values = [...this.sl];
      values[channel] = Number(slope.value);
      this.setParameters({ sl: values });
    });
    return { roleRow, frequencyRow, role, frequency, frequencyRange, slope };
  }

  _buildRoutingMatrix() {
    if (!this._matrixWrapper) return;
    const outputs = this._selectedSubOutputs();
    const table = document.createElement('table');
    table.className = 'bass-management-matrix';
    const head = document.createElement('thead');
    const groupRow = document.createElement('tr');
    const inputHeading = document.createElement('th');
    inputHeading.colSpan = 4;
    inputHeading.textContent = 'Input';
    const outputHeading = document.createElement('th');
    outputHeading.colSpan = Math.max(1, outputs.length);
    outputHeading.textContent = 'Sub Outputs';
    groupRow.append(inputHeading, outputHeading);
    const channelRow = document.createElement('tr');
    for (const label of ['Ch', 'Role', 'Freq (Hz)', 'Slope']) {
      const heading = document.createElement('th');
      heading.textContent = label;
      channelRow.appendChild(heading);
    }
    if (outputs.length) {
      for (const output of outputs) {
        const heading = document.createElement('th');
        heading.textContent = `Ch ${output + 1}`;
        channelRow.appendChild(heading);
      }
    } else {
      const heading = document.createElement('th');
      heading.textContent = 'Select above';
      heading.className = 'bass-management-empty-heading';
      channelRow.appendChild(heading);
    }
    head.append(groupRow, channelRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    this._channelControls = [];
    for (let channel = 0; channel < this._processingChannelCount; channel += 1) {
      const row = document.createElement('tr');
      row.dataset.channel = String(channel);
      row.addEventListener('click', () => this._selectGraphChannel(channel));
      const channelCell = document.createElement('th');
      channelCell.scope = 'row';
      channelCell.className = 'bass-management-channel-cell';
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'bass-management-channel-button';
      selectButton.textContent = `Ch ${channel + 1}`;
      selectButton.setAttribute('aria-label', `Show Ch ${channel + 1} response`);
      selectButton.addEventListener('click', () => this._selectGraphChannel(channel));
      channelCell.appendChild(selectButton);

      const inputControls = this._createMatrixInputControls(channel);
      const roleCell = document.createElement('td');
      roleCell.className = 'bass-management-role-cell';
      roleCell.appendChild(inputControls.roleRow);
      const frequencyCell = document.createElement('td');
      frequencyCell.className = 'bass-management-frequency-cell';
      frequencyCell.appendChild(inputControls.frequencyRow);
      const slopeCell = document.createElement('td');
      slopeCell.className = 'bass-management-slope-cell';
      slopeCell.appendChild(inputControls.slope);
      row.append(channelCell, roleCell, frequencyCell, slopeCell);

      const routeButtons = [];
      if (outputs.length) {
        for (const output of outputs) {
          const cell = document.createElement('td');
          cell.className = 'bass-management-route-cell';
          const onButton = document.createElement('button');
          onButton.type = 'button';
          onButton.className = 'bass-management-matrix-button';
          onButton.textContent = 'ON';
          onButton.setAttribute('aria-label', `Route Ch ${channel + 1} to Sub Ch ${output + 1}`);
          const phaseButton = document.createElement('button');
          phaseButton.type = 'button';
          phaseButton.className = 'bass-management-matrix-button phase-button';
          phaseButton.textContent = 'Ø';
          phaseButton.setAttribute('aria-label', `Invert Ch ${channel + 1} route to Sub Ch ${output + 1}`);
          onButton.addEventListener('click', () => {
            const bit = 1 << output;
            const routes = [...this.rt];
            const inversions = [...this.ri];
            if ((routes[channel] & bit) !== 0) {
              routes[channel] &= ~bit;
              inversions[channel] &= ~bit;
            } else {
              routes[channel] |= bit;
            }
            this.setParameters({ rt: routes, ri: inversions });
          });
          phaseButton.addEventListener('click', () => {
            const bit = 1 << output;
            if ((this.rt[channel] & bit) === 0) return;
            const inversions = [...this.ri];
            inversions[channel] ^= bit;
            this.setParameters({ ri: inversions });
          });
          cell.append(onButton, phaseButton);
          row.appendChild(cell);
          routeButtons.push({ output, onButton, phaseButton });
        }
      } else {
        const cell = document.createElement('td');
        cell.className = 'bass-management-empty-cell';
        cell.textContent = 'Select one or more Sub Outputs above.';
        row.appendChild(cell);
      }
      body.appendChild(row);
      this._channelControls.push({ row, selectButton, routeButtons, ...inputControls });
    }
    table.appendChild(body);
    this._matrixWrapper.replaceChildren(table);
    this._matrixSignature = `${this._processingChannelCount}:${outputs.join(',')}`;
  }

  _selectGraphChannel(channel) {
    const maximum = Math.max(0, this._processingChannelCount - 1);
    this._graphChannel = Math.max(0, Math.min(maximum, Math.round(channel) || 0));
    for (let index = 0; index < this._channelControls.length; index += 1) {
      const selected = index === this._graphChannel;
      this._channelControls[index].row.classList.toggle('selected', selected);
      this._channelControls[index].selectButton.setAttribute('aria-pressed', String(selected));
    }
    this.drawGraph();
  }

  _syncControls() {
    if (this._linearQualityControl) {
      this._linearQualityControl.disabled = this.ph !== 'Linear';
      this._linearQualityControl.closest('.parameter-row')?.classList.toggle(
        'parameter-disabled', this.ph !== 'Linear');
    }
    for (const control of this._lfeFrequencyControls) control.disabled = !this.lo;
    this._lfeFrequencyControls[0]?.closest('.parameter-row')?.classList.toggle(
      'parameter-disabled', !this.lo);
    if (this._lfeSlopeControl) {
      this._lfeSlopeControl.disabled = !this.lo;
      this._lfeSlopeControl.closest('.parameter-row')?.classList.toggle(
        'parameter-disabled', !this.lo);
    }
    for (let channel = 0; channel < this._subControls.length; channel += 1) {
      const control = this._subControls[channel];
      const visible = channel < this._processingChannelCount;
      control.label.hidden = !visible;
      if (!this.isHeldByUser(control.input)) control.input.checked = (this.su & (1 << channel)) !== 0;
    }
    if (this._graphChannel >= this._processingChannelCount) this._graphChannel = 0;
    const matrixSignature = `${this._processingChannelCount}:${this._selectedSubOutputs().join(',')}`;
    if (this._matrixWrapper && matrixSignature !== this._matrixSignature) this._buildRoutingMatrix();
    for (let channel = 0; channel < this._channelControls.length; channel += 1) {
      const control = this._channelControls[channel];
      if (!this.isHeldByUser(control.role)) control.role.value = String(this.ro[channel]);
      if (!this.isHeldByUser(control.frequency)) control.frequency.value = String(this.fc[channel]);
      if (!this.isHeldByUser(control.frequencyRange)) {
        control.frequencyRange.value = String(100 * Math.log(this.fc[channel] / 20) / Math.log(15));
        window.uiManager?.refreshRangeFillStyling?.(control.frequencyRange);
      }
      if (!this.isHeldByUser(control.slope)) control.slope.value = String(this.sl[channel]);
      const managed = this.ro[channel] === 1;
      const routed = managed || this.ro[channel] === 2;
      control.frequencyRange.disabled = !managed;
      control.frequency.disabled = !managed;
      control.slope.disabled = !managed;
      control.frequency.closest('.parameter-row')?.classList.toggle('parameter-disabled', !managed);
      control.row.classList.toggle('selected', channel === this._graphChannel);
      control.selectButton.setAttribute('aria-pressed', String(channel === this._graphChannel));
      for (const route of control.routeButtons) {
        const bit = 1 << route.output;
        const active = (this.rt[channel] & bit) !== 0;
        const inverted = active && (this.ri[channel] & bit) !== 0;
        route.onButton.disabled = !routed;
        route.phaseButton.disabled = !routed || !active;
        route.onButton.classList.toggle('active', active);
        route.phaseButton.classList.toggle('active', inverted);
        route.onButton.setAttribute('aria-pressed', String(active));
        route.phaseButton.setAttribute('aria-pressed', String(inverted));
      }
    }
  }

  _lowWeight(frequency, cutoff, slope) {
    if (!(frequency > 0)) return 1;
    const exponent = slope / (20 * Math.log10(2)) * Math.log(frequency / cutoff);
    if (exponent <= -36) return 1;
    if (exponent >= 36) return 0;
    return 1 / (1 + Math.exp(exponent));
  }

  // Reads the exact per-pixel Sub/Main response curves drawn by drawGraph at a
  // given canvas-pixel x, for the cursor readout overlay. Returns null when no
  // response curve is drawn for the selected channel (Full Range / LFE / Unused).
  _readGraph(x) {
    const frame = this._readoutFrame;
    if (!frame?.valid || !frame.hasResponse) return null;
    const { format, columnValueAt } = window.GraphReadout;
    const labels = ['Sub (low)', 'Main (high)'];
    const rows = [];
    for (let curve = 0; curve < 2; curve += 1) {
      const db = columnValueAt(frame.curveData[curve], x);
      if (db === null) continue;
      rows.push({
        label: labels[curve],
        color: frame.colors[curve],
        value: format.db(db, { signed: true }),
        y: frame.toY(db)
      });
    }
    if (!rows.length) return null;
    return { cursor: format.frequency(this._graphFrequencyAt(x, frame.width)), rows };
  }

  // Log-frequency axis of the response curves: 10 Hz at x = 0 to the plotted maximum at
  // x = width - 1 (canvas px).
  _graphFrequencyAt(x, width) {
    const minimumLog = Math.log10(10);
    const maximumLog = Math.log10(Math.min(20000, this._sampleRate * 0.48));
    return 10 ** (minimumLog + x / Math.max(1, width - 1) * (maximumLog - minimumLog));
  }

  _getCanvasDpr(canvas) {
    const rect = canvas.getBoundingClientRect?.();
    const cssWidth = canvas.clientWidth || rect?.width || canvas.width || 1;
    return canvas.width / cssWidth;
  }

  drawGraph() {
    const frame = (this._readoutFrame ??= {});
    frame.valid = false;
    if (!this.canvas) return;
    const context = this.canvas.getContext('2d');
    const { width, height } = this.canvas;
    if (!context || !width || !height) return;
    const dpr = this._getCanvasDpr(this.canvas);
    const cssWidth = width / dpr;
    const tickFont = Math.round(11 * dpr);
    const axisFont = Math.round(13 * dpr);
    const bottomTickY = height - 26 * dpr;
    const axisBottomY = height - 4 * dpr;
    const leftLabelX = 40 * dpr;
    const axisLabelX = 12 * dpr;
    context.clearRect(0, 0, width, height);
    const minimumLog = Math.log10(10);
    const maximumLog = Math.log10(Math.min(20000, this._sampleRate * 0.48));

    const role = this.ro[this._graphChannel];
    const hasResponse = role === 1 || role === 2 && this.lo;
    const cutoff = role === 1 ? this.fc[this._graphChannel] : this.lf;
    const slope = role === 1 ? this.sl[this._graphChannel] : this.ls;
    const responseIndex = this._activeDesign?.inputChannels?.indexOf(this._graphChannel) ?? -1;
    const response = responseIndex >= 0 ? this._activeDesign.responses?.[responseIndex] : null;
    const frequencies = response ? this._activeDesign.responseFrequencies : null;
    const curveData = [[], []];
    if (hasResponse) {
      for (let curve = 0; curve < curveData.length; curve += 1) {
        let nearest = 0;
        for (let x = 0; x < width; x += 1) {
          const frequency = this._graphFrequencyAt(x, width);
          let low = this._lowWeight(frequency, cutoff, slope);
          if (response && frequencies?.length === response.length) {
            while (nearest + 1 < frequencies.length && frequencies[nearest + 1] < frequency) {
              nearest += 1;
            }
            const next = Math.min(nearest + 1, frequencies.length - 1);
            if (next === nearest || frequency <= frequencies[nearest]) {
              low = response[nearest];
            } else {
              const lowerLog = Math.log(frequencies[nearest]);
              const upperLog = Math.log(frequencies[next]);
              const fraction = (Math.log(frequency) - lowerLog) / (upperLog - lowerLog);
              low = response[nearest] + (response[next] - response[nearest]) * fraction;
            }
          }
          const magnitude = curve === 0 ? Math.abs(low) : Math.abs(1 - low);
          if (!(magnitude > 0) || !Number.isFinite(magnitude)) {
            curveData[curve].push(null);
            continue;
          }
          const decibels = 20 * Math.log10(magnitude);
          if (!Number.isFinite(decibels)) {
            curveData[curve].push(null);
            continue;
          }
          curveData[curve].push(decibels);
        }
      }
    }

    const decibelMinimum = -60;
    const decibelMaximum = 12;
    const decibelTick = 12;
    const decibelSpan = decibelMaximum - decibelMinimum;
    const colors = [
      window.ThemePalette?.get('graph-trace') ?? '',
      window.ThemePalette?.get('graph-trace-secondary') ?? ''
    ];

    // --- Finalize readout frame ---
    // Drawing happens directly in canvas-pixel units (canvas.width/height, no
    // ctx.setTransform(dpr) scaling), so the cursor readout's x/y arrive in
    // the same units already: no CSS-to-device conversion is needed.
    frame.valid = true;
    frame.hasResponse = hasResponse;
    frame.width = width;
    frame.curveData = curveData;
    frame.colors = colors;
    frame.toY = db => height * (1 - (db - decibelMinimum) / decibelSpan);
    this._graphReadout?.refresh();

    context.strokeStyle = window.ThemePalette?.get('graph-grid') ?? '';
    context.lineWidth = (document.body?.classList.contains('layout-mobile') ? 1 : 0.5) * dpr;
    context.font = `${tickFont}px Arial`;
    const gridFrequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const frequencyLabelBounds = [];
    const labeledFrequencies = cssWidth < 420
      ? new Set([20, 100, 500, 2000, 10000])
      : new Set(gridFrequencies);
    for (const frequency of gridFrequencies) {
      if (frequency > 10 ** maximumLog) continue;
      const x = width * (Math.log10(frequency) - minimumLog) / (maximumLog - minimumLog);
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      if (labeledFrequencies.has(frequency)) {
        const label = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
        const halfWidth = context.measureText(label).width / 2;
        if (x - halfWidth >= 0 && x + halfWidth <= width) {
          context.fillStyle = window.ThemePalette?.get('graph-label') ?? '';
          context.textAlign = 'center';
          context.fillText(label, x, bottomTickY);
          frequencyLabelBounds.push({
            left: x - halfWidth,
            right: x + halfWidth,
            top: bottomTickY - tickFont,
            bottom: bottomTickY + 3 * dpr
          });
        }
      }
    }
    const firstTick = Math.ceil(decibelMinimum / decibelTick) * decibelTick;
    for (let decibels = firstTick; decibels <= decibelMaximum; decibels += decibelTick) {
      const y = height * (1 - (decibels - decibelMinimum) / decibelSpan);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      context.fillStyle = window.ThemePalette?.get('graph-label') ?? '';
      context.textAlign = 'right';
      const label = Math.abs(decibels) >= 1 ? String(Math.round(decibels)) : decibels.toFixed(1);
      const baseline = y + 3 * dpr;
      const labelWidth = context.measureText(label).width;
      const bounds = {
        left: leftLabelX - labelWidth,
        right: leftLabelX,
        top: baseline - tickFont,
        bottom: baseline + 3 * dpr
      };
      const overlapsFrequencyLabel = frequencyLabelBounds.some(other =>
        bounds.left < other.right && bounds.right > other.left &&
        bounds.top < other.bottom && bounds.bottom > other.top);
      if (baseline >= tickFont && baseline <= height && !overlapsFrequencyLabel) {
        context.fillText(label, leftLabelX, baseline);
      }
    }
    context.fillStyle = window.ThemePalette?.get('text-primary') ?? '';
    context.font = `${axisFont}px Arial`;
    context.textAlign = 'center';
    context.fillText('Frequency (Hz)', width / 2, axisBottomY);
    context.save();
    context.translate(axisLabelX, height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText('Level (dB)', 0, 0);
    context.restore();

    if (!hasResponse) {
      const message = role === 0 ? 'Full Range · Main pass-through' :
        role === 2 ? 'LFE · Unfiltered Sub routing' : 'Unused · No output';
      context.fillStyle = window.ThemePalette?.get('graph-label') ?? '';
      context.font = `${axisFont}px Arial`;
      context.textAlign = 'center';
      context.fillText(message, width / 2, height / 2, width - 48 * dpr);
      return;
    }
    const mobile = document.body?.classList.contains('layout-mobile');
    for (let curve = 0; curve < 2; curve += 1) {
      context.strokeStyle = colors[curve];
      context.lineWidth = (mobile ? 2 : 1.5) * dpr;
      context.beginPath();
      let drawing = false;
      for (let x = 0; x < curveData[curve].length; x += 1) {
        const decibels = curveData[curve][x];
        if (decibels === null) {
          drawing = false;
          continue;
        }
        const y = height * (1 - (decibels - decibelMinimum) / decibelSpan);
        if (!drawing) context.moveTo(x, y);
        else context.lineTo(x, y);
        drawing = true;
      }
      context.stroke();
    }
  }

  cleanup() {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelDesign();
    this._designer?.close();
    this._designer = null;
    this.disposeDspTelemetrySubscription();
    this._graphDispose?.();
    this._graphDispose = null;
    this._statusElement = null;
    this._latencyElement = null;
    this._errorElement = null;
    this._routeElement = null;
    this._matrixWrapper = null;
    this._matrixSignature = '';
    this._linearQualityControl = null;
    this._lfeFrequencyControls = [];
    this._lfeSlopeControl = null;
    this._channelControls = [];
    this._subControls = [];
    this.canvas = null;
    super.cleanup();
  }
}

window.BassManagementPlugin = BassManagementPlugin;
