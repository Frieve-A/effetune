class FiveBandFIRPEQPlugin extends PluginBase {
  static BANDS = [
    { frequency: 100, name: '100 Hz' },
    { frequency: 316, name: '316 Hz' },
    { frequency: 1000, name: '1.0 kHz' },
    { frequency: 3160, name: '3.16 kHz' },
    { frequency: 10000, name: '10 kHz' }
  ];

  static FILTER_TYPES = [
    { id: 'pk', name: 'Peaking' },
    { id: 'lp', name: 'LowPass' },
    { id: 'hp', name: 'HighPass' },
    { id: 'ls', name: 'LowShelv' },
    { id: 'hs', name: 'HighShel' },
    { id: 'bp', name: 'BandPass' },
    { id: 'no', name: 'Notch' }
  ];

  static SLOPE_TYPES = ['lp', 'hp'];

  static _logSliderPosition(value, minimum, maximum) {
    if (value <= minimum) return 0;
    if (value >= maximum) return 100;
    const logMinimum = Math.log10(minimum);
    return 100 * (Math.log10(value) - logMinimum) /
      (Math.log10(maximum) - logMinimum);
  }

  static _valueFromLogSliderPosition(position, minimum, maximum) {
    const numericPosition = Number(position);
    if (!Number.isFinite(numericPosition) || numericPosition <= 0) return minimum;
    if (numericPosition >= 100) return maximum;
    const logMinimum = Math.log10(minimum);
    return 10 ** (
      logMinimum +
      numericPosition * (Math.log10(maximum) - logMinimum) / 100
    );
  }

  constructor() {
    super('5Band FIR PEQ', '5-band FIR parametric equalizer');
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
    this._statusMessage = 'Preparing FIR filter…';
    this._statusState = 'preparing';
    this._statusElement = null;
    this._latencyElement = null;
    this.uiCreated = false;
    this.activeDragMarker = null;
    this.boundMouseMoveHandler = null;
    this.boundMouseUpHandler = null;
    this.bandCheckboxes = [];
    this.temporalCapability = 'reset-on-resume';
    this.offlineDspAssetErrorMessageKey = 'fiveBandFirPeq.error.design';
    this.executionState = { state: 'pending', reason: null };

    for (let index = 0; index < 5; index += 1) {
      const band = FiveBandFIRPEQPlugin.BANDS[index];
      this[`f${index}`] = band.frequency;
      this[`g${index}`] = 0;
      this[`q${index}`] = 0.7;
      this[`s${index}`] = 12;
      this[`t${index}`] = 'pk';
      this[`e${index}`] = true;
    }
    this.registerProcessor('return data;');
  }

  process(context, data) {
    return data;
  }

  _t(_key, fallback, params = {}) {
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      fallback
    );
  }

  _packedParameters() {
    return {
      ...super.getParameters(),
      lt: this.lt,
      fd: this.pm === 'min' ? 0 : this.tp / 2,
      dy: 0,
      gn: 0
    };
  }

  getParameters(options = {}) {
    const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
      ? options.sampleRate
      : this._sampleRate;
    const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
      options.outputChannelCount >= 1 && options.outputChannelCount <= 8
      ? options.outputChannelCount
      : this._outputChannelCount;
    if (options.commitSampleRate &&
      (sampleRate !== this._sampleRate || outputChannelCount !== this._outputChannelCount)) {
      this._sampleRate = sampleRate;
      this._outputChannelCount = outputChannelCount;
      this._scheduleDesign(0);
    }
    const parameters = {
      ...this._packedParameters(),
      pm: this.pm,
      tp: this.tp
    };
    for (let index = 0; index < 5; index += 1) {
      parameters[`f${index}`] = this[`f${index}`];
      parameters[`g${index}`] = this[`g${index}`];
      parameters[`q${index}`] = this[`q${index}`];
      parameters[`s${index}`] = this[`s${index}`];
      parameters[`t${index}`] = this[`t${index}`];
      parameters[`e${index}`] = this[`e${index}`];
    }
    return parameters;
  }

  setParameters(params = {}, syncUi = true) {
    const previousDesign = this._designSignature();
    const previousLatency = this.lt;
    super._setValidatedParameters(params);
    if (['min', 'lin'].includes(params.pm)) this.pm = params.pm;
    const taps = Number(params.tp);
    if ([8192, 16384, 32768, 65536, 131072].includes(taps)) this.tp = taps;
    if (['0', '128', '256', '512', '1024'].includes(String(params.lt))) {
      this.lt = String(params.lt);
    }
    for (let index = 0; index < 5; index += 1) {
      const type = params[`t${index}`];
      if (FiveBandFIRPEQPlugin.FILTER_TYPES.some(candidate => candidate.id === type)) {
        this[`t${index}`] = type;
      }
      if (params[`f${index}`] !== undefined) {
        this[`f${index}`] = this.parseFiniteNumber(
          params[`f${index}`], 20, 20000, this[`f${index}`]
        );
      }
      if (params[`g${index}`] !== undefined) {
        this[`g${index}`] = this.parseFiniteNumber(
          params[`g${index}`], -20, 20, this[`g${index}`]
        );
      }
      if (params[`q${index}`] !== undefined) {
        this[`q${index}`] = this.parseFiniteNumber(
          params[`q${index}`], 0.1, 100, this[`q${index}`]
        );
      }
      if (params[`s${index}`] !== undefined) {
        this[`s${index}`] = this.parseFiniteNumber(
          params[`s${index}`], 0.1, 384, this[`s${index}`]
        );
      }
      if (params[`e${index}`] !== undefined) {
        this[`e${index}`] = Boolean(params[`e${index}`]);
      }
    }
    this._updatePowerGainBound();
    this.updateParameters();
    const nextDesign = this._designSignature();
    if (previousDesign !== nextDesign) this._scheduleDesign(150);
    else if (previousLatency !== this.lt && this._lastDesign) this._stageDesign(this._lastDesign);
    if (syncUi) this.setUIValues();
    this.updateMarkers();
    this.updateResponse();
    this._renderStatus();
  }

  setBand(index, frequency, gain, q, type, enabled, slope) {
    if (!Number.isInteger(index) || index < 0 || index >= 5) return;
    const parameters = {};
    if (frequency !== undefined) parameters[`f${index}`] = frequency;
    if (gain !== undefined) parameters[`g${index}`] = gain;
    if (q !== undefined) parameters[`q${index}`] = q;
    if (type !== undefined) parameters[`t${index}`] = type;
    if (enabled !== undefined) parameters[`e${index}`] = enabled;
    if (slope !== undefined) parameters[`s${index}`] = slope;
    this.setParameters(parameters, false);
  }

  toggleBandEnabled(index) {
    this.setBand(index, undefined, undefined, undefined, undefined, !this[`e${index}`]);
  }

  reset() {
    const parameters = { pm: 'min', tp: 32768, lt: '128', enabled: true };
    FiveBandFIRPEQPlugin.BANDS.forEach((band, index) => {
      parameters[`f${index}`] = band.frequency;
      parameters[`g${index}`] = 0;
      parameters[`q${index}`] = 0.7;
      parameters[`s${index}`] = 12;
      parameters[`t${index}`] = 'pk';
      parameters[`e${index}`] = true;
    });
    this.setParameters(parameters);
  }

  _bands() {
    return FiveBandFIRPEQPlugin.BANDS.map((_, index) => ({
      frequency: this[`f${index}`],
      gain: this[`g${index}`],
      q: this[`q${index}`],
      slope: this[`s${index}`],
      type: this[`t${index}`],
      enabled: this[`e${index}`]
    }));
  }

  _designSignature(sampleRate = this._sampleRate) {
    return JSON.stringify([this.pm, this.tp, this._bands(), sampleRate, this.channel]);
  }

  _designConfig(sampleRate = this._sampleRate) {
    return {
      sampleRate,
      taps: this.tp,
      phase: this.pm,
      eqBands: this._bands()
    };
  }

  async _getRuntime() {
    if (!this._runtimePromise) {
      this._runtimePromise = Promise.all([
        import('../../js/five-band-fir-peq/designer.js'),
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
    this._designPending = true;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this.updateParameters();
    this._setStatus('Designing FIR filter…', 'preparing');
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
      if (!this._designer) {
        const designer = runtime.createFiveBandFirPeqDesigner();
        if (this._disposed || generation !== this._designGeneration) {
          designer.close();
          return false;
        }
        this._designer = designer;
      }
      const designer = this._designer;
      const result = await designer.design(this._designConfig());
      if (this._disposed || generation !== this._designGeneration ||
        designer !== this._designer) return false;
      this._lastDesign = result;
      this._lastDesignSignature = this._designSignature();
      this.updateResponse();
      return this._stageDesign(result, generation);
    } catch (error) {
      if (this._disposed || generation !== this._designGeneration) return false;
      console.error('5Band FIR PEQ design failed:', error);
      this._designPending = false;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this.updateParameters();
      this._setStatus(
        'The FIR filter could not be designed. Try fewer taps or less extreme settings.',
        'error'
      );
      return false;
    }
  }

  async _stageDesign(result, generation = this._designGeneration) {
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
      const processingChannels = runtime.selectedIrChannelCount(
        this.channel,
        this._outputChannelCount
      );
      const footprintBytes = runtime.estimateIrKernelCommitFootprint({
        frames: this.tp,
        assetChannels: 1,
        topology: runtime.IR_ASSET_TOPOLOGY.mono,
        processingChannels,
        headBlock: Number(this.lt)
      });
      const operationRevision = this.setWasmAsset(0, {
        payload: result.payload,
        formatTag: 1,
        headBlock: Number(this.lt),
        rateDivider: 1,
        pathCount: 0,
        inputCount: 0,
        processingChannels,
        footprintBytes,
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
      console.error('5Band FIR PEQ asset staging failed:', error);
      this._designPending = false;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this.updateParameters();
      this._setStatus(
        'The FIR filter could not be prepared. Try fewer taps or a higher latency.',
        'error'
      );
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

  _updatePowerGainBound(payload = this._lastDesign?.payload) {
    if (!(payload instanceof ArrayBuffer) || payload.byteLength < 32 + this.tp * 4) {
      this.powerGainUpperBoundDb = 0;
      return;
    }
    const samples = new Float32Array(payload, 32);
    let sum = 0;
    for (let index = 0; index < this.tp; index += 1) {
      const value = samples[index];
      sum += value < 0 ? -value : value;
    }
    this.powerGainUpperBoundDb = 20 * Math.log10(sum > 1 ? sum : 1);
  }

  get offlineDspAssetRequired() {
    return true;
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
      const error = new Error('5Band FIR PEQ settings changed during offline filter preparation.');
      error.userMessageKey = this.offlineDspAssetErrorMessageKey;
      return error;
    };
    if (!operationCurrent()) throw staleError();
    const runtime = await this._getRuntime();
    if (!operationCurrent()) throw staleError();
    const designer = runtime.createFiveBandFirPeqDesigner();
    let designed;
    try {
      designed = await designer.design(snapshot.config);
    } finally {
      designer.close();
    }
    if (!operationCurrent()) throw staleError();
    const processingChannels = runtime.selectedIrChannelCount(
      snapshot.channel,
      outputChannelCount
    );
    const footprintBytes = runtime.estimateIrKernelCommitFootprint({
      frames: snapshot.config.taps,
      assetChannels: 1,
      topology: runtime.IR_ASSET_TOPOLOGY.mono,
      processingChannels,
      headBlock: Number(snapshot.latency)
    });
    return {
      parameters: {
        ...snapshot.baseParameters,
        lt: snapshot.latency,
        fd: snapshot.config.phase === 'min' ? 0 : snapshot.config.taps / 2,
        dy: 0,
        gn: 0
      },
      assets: new Map([[0, {
        payload: designed.payload,
        formatTag: 1,
        headBlock: Number(snapshot.latency),
        rateDivider: 1,
        pathCount: 0,
        inputCount: 0,
        processingChannels,
        footprintBytes,
        warmupSamples: Number(snapshot.latency) +
          (snapshot.config.phase === 'min' ? 0 : snapshot.config.taps / 2),
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
      const warning = this._lastDesign?.qualityWarnings?.includes('filterAccuracy');
      this._setStatus(
        warning
          ? 'The FIR response may be inaccurate. Increase Taps or reduce Q or Slope.'
          : 'FIR filter is ready.',
        warning ? 'warning' : 'ready'
      );
    } else if (status === 4) {
      this._designPending = false;
      this._designStaged = false;
      this._candidateAssetRevision = null;
      this._effectiveAssetRevision = null;
      this.updateParameters();
      this._setStatus(
        'The FIR filter could not be prepared. Try fewer taps or a higher latency.',
        'error'
      );
    }
    this._renderStatus();
  }

  onWasmAssetRejected(slot, reason, operationRevision) {
    if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
    console.warn('5Band FIR PEQ asset admission rejected:', reason);
    this._designPending = false;
    this._designStaged = false;
    this._candidateAssetRevision = null;
    this._effectiveAssetRevision = null;
    this._assetState = 4;
    this.updateParameters();
    this._setStatus(
      'The FIR filter could not be prepared. Try fewer taps or a higher latency.',
      'error'
    );
  }

  onMessage(message) {
    if (this._disposed) return;
    if (Number.isFinite(message.sampleRate) && message.sampleRate > 0 &&
      message.sampleRate !== this._sampleRate) {
      this._sampleRate = message.sampleRate;
      this._scheduleDesign(0);
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
    const filterDelay = this.pm === 'min' ? 0 : this.tp / 2;
    const totalSamples = Number(this.lt) + filterDelay;
    const milliseconds = totalSamples * 1000 / this._sampleRate;
    this._latencyElement.textContent =
      `Latency: ${totalSamples} samples (${milliseconds.toFixed(1)} ms)`;
  }

  createUI() {
    this.disconnectGraphResizeObserver();
    const container = document.createElement('div');
    container.className = 'five-band-fir-peq-plugin-ui plugin-parameter-ui';
    container.id = `five-band-fir-peq-container-${this.id}`;

    const settings = document.createElement('div');
    settings.className = 'five-band-fir-peq-settings';
    settings.appendChild(this.createRadioGroup('Phase', [
      { value: 'min', label: 'Minimum Phase' },
      { value: 'lin', label: 'Linear Phase' }
    ], this.pm, value => this.setParameters({ pm: value })));
    settings.appendChild(this.createSelectControl(
      'Taps',
      [8192, 16384, 32768, 65536, 131072].map(value => ({
        value: String(value),
        label: String(value)
      })),
      String(this.tp),
      value => this.setParameters({ tp: Number(value) })
    ));
    settings.appendChild(this.createSelectControl(
      'Latency',
      [0, 128, 256, 512, 1024].map(value => ({
        value: String(value),
        label: `${value} samples`
      })),
      this.lt,
      value => this.setParameters({ lt: value })
    ));
    container.appendChild(settings);

    const graphContainer = document.createElement('div');
    graphContainer.className = 'five-band-fir-peq-graph';
    const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    gridSvg.setAttribute('class', 'five-band-fir-peq-grid');
    gridSvg.setAttribute('width', '100%');
    gridSvg.setAttribute('height', '100%');
    for (const frequency of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = this.freqToX(frequency);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', `${x}%`);
      line.setAttribute('x2', `${x}%`);
      line.setAttribute('y1', '0');
      line.setAttribute('y2', '100%');
      gridSvg.appendChild(line);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', `${x}%`);
      text.setAttribute('y', '95%');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = frequency >= 1000 ? `${frequency / 1000}k` : frequency;
      gridSvg.appendChild(text);
    }
    for (const gain of [-18, -12, -6, 0, 6, 12, 18]) {
      const y = this.gainToY(gain);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', '100%');
      line.setAttribute('y1', `${y}%`);
      line.setAttribute('y2', `${y}%`);
      gridSvg.appendChild(line);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '2%');
      text.setAttribute('y', `${y}%`);
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = `${gain}dB`;
      gridSvg.appendChild(text);
    }
    graphContainer.appendChild(gridSvg);

    const responseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    responseSvg.setAttribute('class', 'five-band-fir-peq-response');
    responseSvg.setAttribute('width', '100%');
    responseSvg.setAttribute('height', '100%');
    graphContainer.appendChild(responseSvg);

    const legend = document.createElement('div');
    legend.className = 'five-band-fir-peq-legend';
    for (const [className, label] of [
      [
        'five-band-fir-peq-legend-target',
        this._t('fiveBandFirPeq.graph.target', 'Target')
      ],
      [
        'five-band-fir-peq-legend-realized',
        this._t('fiveBandFirPeq.graph.realized', 'Realized')
      ]
    ]) {
      const item = document.createElement('span');
      item.className = `five-band-fir-peq-legend-item ${className}`;
      const swatch = document.createElement('span');
      swatch.className = 'five-band-fir-peq-legend-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, document.createTextNode(label));
      legend.appendChild(item);
    }
    graphContainer.appendChild(legend);

    const markers = [];
    for (let index = 0; index < 5; index += 1) {
      const marker = document.createElement('div');
      marker.className = 'five-band-fir-peq-marker';
      marker.dataset.band = String(index);
      marker.textContent = String(index + 1);
      const markerText = document.createElement('div');
      markerText.className = 'five-band-fir-peq-marker-text';
      marker.appendChild(markerText);
      const startDrag = (clientX, clientY) => {
        this.activeDragMarker = index;
        this.initialDragX = clientX;
        this.initialDragY = clientY;
        this.hasMoved = false;
        marker.classList.add('active');
      };
      marker.addEventListener('mousedown', event => {
        event.preventDefault();
        startDrag(event.clientX, event.clientY);
        this.boundMouseMoveHandler = moveEvent => this.handleDragMove(moveEvent);
        this.boundMouseUpHandler = () => this.handleDragEnd();
        document.addEventListener('mousemove', this.boundMouseMoveHandler);
        document.addEventListener('mouseup', this.boundMouseUpHandler);
      });
      marker.addEventListener('touchstart', event => {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        startDrag(touch.clientX, touch.clientY);
      }, { passive: false });
      marker.addEventListener('touchmove', event => {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        this.handleDragMove(touch);
      }, { passive: false });
      marker.addEventListener('touchend', () => this.handleDragEnd());
      graphContainer.appendChild(marker);
      markers.push(marker);
    }
    container.appendChild(graphContainer);

    const controls = document.createElement('div');
    controls.className = 'five-band-fir-peq-controls';
    for (let index = 0; index < 5; index += 1) {
      controls.appendChild(this._createBandControls(index));
    }
    container.appendChild(controls);

    const statusLine = document.createElement('div');
    statusLine.className = 'five-band-fir-peq-status-line';
    const status = document.createElement('div');
    status.className = 'five-band-fir-peq-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const latency = document.createElement('div');
    latency.className = 'five-band-fir-peq-latency';
    statusLine.append(status, latency);
    container.appendChild(statusLine);

    this.uiContainer = container;
    this.graphContainer = graphContainer;
    this.responseSvg = responseSvg;
    this.markers = markers;
    this._statusElement = status;
    this._latencyElement = latency;
    this.uiCreated = true;
    this.observeGraphResize(graphContainer);
    this.setUIValues();
    this._renderStatus();
    this._scheduleDesign(0);
    setTimeout(() => {
      this.updateMarkers();
      this.updateResponse();
    }, 0);
    return container;
  }

  _createBandControls(index) {
    const band = document.createElement('div');
    band.className = 'five-band-fir-peq-band';
    band.dataset.band = String(index);
    band.dataset.pluginId = this.id;

    const heading = document.createElement('label');
    heading.className = 'five-band-fir-peq-band-label';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'five-band-fir-peq-band-checkbox';
    enabled.checked = this[`e${index}`];
    enabled.addEventListener('change', () => this.setBand(
      index,
      undefined,
      undefined,
      undefined,
      undefined,
      enabled.checked
    ));
    heading.append(enabled, `Band ${index + 1}`);
    this.bandCheckboxes[index] = enabled;
    band.appendChild(heading);

    const type = document.createElement('select');
    type.className = 'five-band-fir-peq-filter-type';
    for (const filterType of FiveBandFIRPEQPlugin.FILTER_TYPES) {
      const option = document.createElement('option');
      option.value = filterType.id;
      option.textContent = filterType.name;
      type.appendChild(option);
    }
    type.value = this[`t${index}`];
    type.addEventListener('change', () => {
      this.setBand(
        index,
        undefined,
        undefined,
        undefined,
        type.value
      );
      this._setSlopeControlsState(band, type.value);
    });
    band.appendChild(this._controlRow('Type:', type, 'type'));

    const q = document.createElement('input');
    q.type = 'number';
    q.className = 'five-band-fir-peq-q-text';
    q.min = '0.1';
    q.max = '100';
    q.step = '0.01';
    q.value = this[`q${index}`].toFixed(2);
    q.autocomplete = 'off';
    const qSlider = document.createElement('input');
    qSlider.type = 'range';
    qSlider.className = 'five-band-fir-peq-q-slider';
    qSlider.min = '0';
    qSlider.max = '100';
    qSlider.step = '0.1';
    qSlider.value = String(FiveBandFIRPEQPlugin._logSliderPosition(
      this[`q${index}`],
      0.1,
      100
    ));
    qSlider.autocomplete = 'off';
    const updateQ = value => {
      this.setBand(index, undefined, undefined, Number(value));
      const formatted = this[`q${index}`].toFixed(2);
      qSlider.value = String(FiveBandFIRPEQPlugin._logSliderPosition(
        this[`q${index}`],
        0.1,
        100
      ));
      qSlider.setAttribute('aria-valuetext', formatted);
      q.value = formatted;
    };
    qSlider.setAttribute('aria-valuetext', this[`q${index}`].toFixed(2));
    qSlider.addEventListener('input', () => updateQ(
      FiveBandFIRPEQPlugin._valueFromLogSliderPosition(qSlider.value, 0.1, 100)
    ));
    q.addEventListener('input', () => updateQ(q.value));
    q.addEventListener('change', () => {
      q.value = this[`q${index}`].toFixed(2);
    });
    const qRow = this._controlRow('Q:', qSlider, 'q');
    qRow.appendChild(q);
    band.appendChild(qRow);

    const slope = document.createElement('input');
    slope.type = 'number';
    slope.className = 'five-band-fir-peq-slope-text';
    slope.min = '0.1';
    slope.max = '384';
    slope.step = '0.1';
    slope.value = this[`s${index}`].toFixed(1);
    slope.autocomplete = 'off';
    const slopeSlider = document.createElement('input');
    slopeSlider.type = 'range';
    slopeSlider.className = 'five-band-fir-peq-slope-slider';
    slopeSlider.min = '0';
    slopeSlider.max = '100';
    slopeSlider.step = '0.1';
    slopeSlider.value = String(FiveBandFIRPEQPlugin._logSliderPosition(
      this[`s${index}`],
      0.1,
      384
    ));
    slopeSlider.autocomplete = 'off';
    const updateSlope = value => {
      this.setBand(
        index,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        Number(value)
      );
      const formatted = this[`s${index}`].toFixed(1);
      slopeSlider.value = String(FiveBandFIRPEQPlugin._logSliderPosition(
        this[`s${index}`],
        0.1,
        384
      ));
      slopeSlider.setAttribute('aria-valuetext', `${formatted} dB/oct`);
      slope.value = formatted;
    };
    slopeSlider.setAttribute(
      'aria-valuetext',
      `${this[`s${index}`].toFixed(1)} dB/oct`
    );
    slopeSlider.addEventListener('input', () => updateSlope(
      FiveBandFIRPEQPlugin._valueFromLogSliderPosition(
        slopeSlider.value,
        0.1,
        384
      )
    ));
    slope.addEventListener('input', () => updateSlope(slope.value));
    slope.addEventListener('change', () => {
      slope.value = this[`s${index}`].toFixed(1);
    });
    const slopeRow = this._controlRow('Slope (dB/oct):', slopeSlider, 'slope');
    slopeRow.appendChild(slope);
    band.appendChild(slopeRow);
    this._setSlopeControlsState(band, type.value);

    const frequency = document.createElement('input');
    frequency.type = 'number';
    frequency.className = 'five-band-fir-peq-freq-text';
    frequency.min = '20';
    frequency.max = '20000';
    frequency.step = '1';
    frequency.value = this[`f${index}`].toFixed(0);
    frequency.autocomplete = 'off';
    frequency.addEventListener('input', () => this.setBand(
      index,
      Number(frequency.value)
    ));
    frequency.addEventListener('change', () => {
      frequency.value = this[`f${index}`].toFixed(0);
    });
    band.appendChild(this._controlRow('Freq (Hz):', frequency, 'freq'));

    const gain = document.createElement('input');
    gain.type = 'number';
    gain.className = 'five-band-fir-peq-gain-text';
    gain.min = '-20';
    gain.max = '20';
    gain.step = '0.1';
    gain.value = this[`g${index}`].toFixed(1);
    gain.autocomplete = 'off';
    gain.addEventListener('input', () => this.setBand(
      index,
      undefined,
      Number(gain.value)
    ));
    gain.addEventListener('change', () => {
      gain.value = this[`g${index}`].toFixed(1);
    });
    band.appendChild(this._controlRow('Gain (dB):', gain, 'gain'));
    return band;
  }

  _controlRow(labelText, input, kind) {
    const row = document.createElement('div');
    row.className = `five-band-fir-peq-${kind}-row`;
    const label = document.createElement('label');
    label.className = `five-band-fir-peq-${kind}-label`;
    label.textContent = labelText;
    row.append(label, input);
    return row;
  }

  _setSlopeControlsState(band, type) {
    const disabled = !FiveBandFIRPEQPlugin.SLOPE_TYPES.includes(type);
    const slopeSlider = band?.querySelector('.five-band-fir-peq-slope-slider');
    const slope = band?.querySelector('.five-band-fir-peq-slope-text');
    if (slopeSlider) slopeSlider.disabled = disabled;
    if (slope) slope.disabled = disabled;
  }

  setUIValues() {
    if (!this.uiCreated || !this.uiContainer) return;
    for (let index = 0; index < 5; index += 1) this.setUIBandValues(index);
  }

  setUIBandValues(index) {
    const band = this.uiContainer?.querySelector(
      `.five-band-fir-peq-band[data-band="${index}"]`
    );
    if (!band) return;
    const checkbox = band.querySelector('.five-band-fir-peq-band-checkbox');
    const type = band.querySelector('.five-band-fir-peq-filter-type');
    const qSlider = band.querySelector('.five-band-fir-peq-q-slider');
    const q = band.querySelector('.five-band-fir-peq-q-text');
    const slopeSlider = band.querySelector('.five-band-fir-peq-slope-slider');
    const slope = band.querySelector('.five-band-fir-peq-slope-text');
    const frequency = band.querySelector('.five-band-fir-peq-freq-text');
    const gain = band.querySelector('.five-band-fir-peq-gain-text');
    if (checkbox) checkbox.checked = this[`e${index}`];
    if (type) type.value = this[`t${index}`];
    if (qSlider) {
      qSlider.value = String(FiveBandFIRPEQPlugin._logSliderPosition(
        this[`q${index}`],
        0.1,
        100
      ));
      qSlider.setAttribute?.('aria-valuetext', this[`q${index}`].toFixed(2));
    }
    if (q) q.value = this[`q${index}`].toFixed(2);
    if (slopeSlider) {
      slopeSlider.value = String(FiveBandFIRPEQPlugin._logSliderPosition(
        this[`s${index}`],
        0.1,
        384
      ));
      slopeSlider.setAttribute?.(
        'aria-valuetext',
        `${this[`s${index}`].toFixed(1)} dB/oct`
      );
    }
    if (slope) slope.value = this[`s${index}`].toFixed(1);
    this._setSlopeControlsState(band, this[`t${index}`]);
    if (frequency) frequency.value = this[`f${index}`].toFixed(0);
    if (gain) gain.value = this[`g${index}`].toFixed(1);
  }

  freqToX(frequency) {
    const clamped = Math.max(10, Math.min(frequency, 40000));
    return (Math.log10(clamped) - Math.log10(10)) /
      (Math.log10(40000) - Math.log10(10)) * 100;
  }

  xToFreq(percent) {
    return 10 ** (Math.log10(10) +
      percent / 100 * (Math.log10(40000) - Math.log10(10)));
  }

  gainToY(gain) {
    return 50 - gain / 20 * 50;
  }

  yToGain(percent) {
    return -(percent - 50) / 50 * 20;
  }

  getGraphPlotArea(container = this.graphContainer) {
    const margin = 20;
    const rect = container?.getBoundingClientRect?.() ||
      { left: 0, top: 0, width: 0, height: 0 };
    const width = container?.clientWidth || rect.width;
    const height = container?.clientHeight || rect.height;
    const marginX = width > margin * 2 ? margin : 0;
    const marginY = height > margin * 2 ? margin : 0;
    const plotWidth = width - marginX * 2;
    const plotHeight = height - marginY * 2;
    return {
      left: rect.left + marginX,
      top: rect.top + marginY,
      width: plotWidth > 0 ? plotWidth : width,
      height: plotHeight > 0 ? plotHeight : height,
      leftPercent: width > 0 ? marginX / width * 100 : 0,
      topPercent: height > 0 ? marginY / height * 100 : 0,
      widthPercent: width > 0 ? (plotWidth > 0 ? plotWidth : width) / width * 100 : 100,
      heightPercent: height > 0 ? (plotHeight > 0 ? plotHeight : height) / height * 100 : 100
    };
  }

  updateMarkers() {
    if (!this.uiCreated || !this.markers || !this.graphContainer) return;
    const plot = this.getGraphPlotArea();
    const width = this.graphContainer.clientWidth;
    const height = this.graphContainer.clientHeight;
    if (!width || !height) return;
    const labelItems = [];
    for (let index = 0; index < 5; index += 1) {
      const marker = this.markers[index];
      const frequency = this[`f${index}`];
      const gain = this[`g${index}`];
      const x = plot.leftPercent + this.freqToX(frequency) / 100 * plot.widthPercent;
      const y = plot.topPercent + this.gainToY(gain) / 100 * plot.heightPercent;
      marker.style.left = `${x}%`;
      marker.style.top = `${y}%`;
      marker.classList.toggle('disabled', !this[`e${index}`]);
      const text = marker.querySelector('.five-band-fir-peq-marker-text');
      if (!text) continue;
      text.className = 'five-band-fir-peq-marker-text';
      const frequencyText = frequency >= 1000
        ? `${(frequency / 1000).toFixed(1)}kHz`
        : `${frequency.toFixed(0)}Hz`;
      text.replaceChildren(
        document.createTextNode(frequencyText),
        ...(['lp', 'hp', 'bp', 'no'].includes(this[`t${index}`])
          ? []
          : [
              document.createElement('br'),
              document.createTextNode(`${gain.toFixed(1)}dB`)
            ])
      );
      labelItems.push({
        el: text,
        cx: x / 100 * width,
        cy: y / 100 * height
      });
    }
    this.layoutMarkerLabels?.({
      items: labelItems,
      width,
      height,
      axis: 'horizontal'
    });
  }

  calculateBandResponse(frequency, band) {
    if (!band.enabled) return 0;
    const gainIndependent = ['lp', 'hp', 'bp', 'no'].includes(band.type);
    if (!gainIndependent && Math.abs(band.gain) < 0.0001) return 0;
    const sampleRate = this._sampleRate;
    const center = Math.min(band.frequency, sampleRate * 0.49);
    const omega = 2 * Math.PI * center / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const amplitude = 10 ** (band.gain / 40);
    const alpha = sine / (2 * band.q);
    const root = Math.sqrt(amplitude);
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    if (band.type === 'lp') {
      b0 = (1 - cosine) / 2;
      b1 = 1 - cosine;
      b2 = (1 - cosine) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosine;
      a2 = 1 - alpha;
    } else if (band.type === 'hp') {
      b0 = (1 + cosine) / 2;
      b1 = -(1 + cosine);
      b2 = (1 + cosine) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosine;
      a2 = 1 - alpha;
    } else if (band.type === 'ls') {
      b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + 2 * root * alpha);
      b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
      b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - 2 * root * alpha);
      a0 = (amplitude + 1) + (amplitude - 1) * cosine + 2 * root * alpha;
      a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine);
      a2 = (amplitude + 1) + (amplitude - 1) * cosine - 2 * root * alpha;
    } else if (band.type === 'hs') {
      b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + 2 * root * alpha);
      b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine);
      b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - 2 * root * alpha);
      a0 = (amplitude + 1) - (amplitude - 1) * cosine + 2 * root * alpha;
      a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine);
      a2 = (amplitude + 1) - (amplitude - 1) * cosine - 2 * root * alpha;
    } else if (band.type === 'bp') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosine;
      a2 = 1 - alpha;
    } else if (band.type === 'no') {
      b0 = 1;
      b1 = -2 * cosine;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosine;
      a2 = 1 - alpha;
    } else {
      b0 = 1 + alpha * amplitude;
      b1 = -2 * cosine;
      b2 = 1 - alpha * amplitude;
      a0 = 1 + alpha / amplitude;
      a1 = -2 * cosine;
      a2 = 1 - alpha / amplitude;
    }
    const target = 2 * Math.PI * frequency / sampleRate;
    const targetCosine = Math.cos(target);
    const targetSine = Math.sin(target);
    const doubleCosine = Math.cos(2 * target);
    const doubleSine = Math.sin(2 * target);
    const numeratorReal = b0 + b1 * targetCosine + b2 * doubleCosine;
    const numeratorImaginary = -b1 * targetSine - b2 * doubleSine;
    const denominatorReal = a0 + a1 * targetCosine + a2 * doubleCosine;
    const denominatorImaginary = -a1 * targetSine - a2 * doubleSine;
    const numerator = Math.hypot(numeratorReal, numeratorImaginary);
    const denominator = Math.hypot(denominatorReal, denominatorImaginary);
    const response = 20 * Math.log10(
      Math.max(1e-8, numerator) / Math.max(1e-8, denominator)
    );
    return FiveBandFIRPEQPlugin.SLOPE_TYPES.includes(band.type) && response < 0
      ? response * (Number.isFinite(band.slope) ? band.slope : 12) / 12
      : response;
  }

  updateResponse() {
    if (!this.uiCreated || !this.responseSvg?.clientWidth || !this.responseSvg.clientHeight) return;
    const width = this.responseSvg.clientWidth;
    const height = this.responseSvg.clientHeight;
    this.responseSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.responseSvg.setAttribute('preserveAspectRatio', 'none');
    const bands = this._bands();
    const count = Math.max(200, Math.round(width / 2));
    const targetCommands = [];
    for (let index = 0; index <= count; index += 1) {
      const frequency = 10 * (4000 ** (index / count));
      let response = 0;
      for (const band of bands) response += this.calculateBandResponse(frequency, band);
      const x = this.freqToX(frequency) * width / 100;
      const y = this.gainToY(response) * height / 100;
      targetCommands.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
    }

    this.responseSvg.replaceChildren();
    const appendPath = (commands, className, stroke, widthValue) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', className);
      path.setAttribute('d', commands.join(' '));
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', widthValue);
      path.setAttribute('fill', 'none');
      this.responseSvg.appendChild(path);
    };
    appendPath(
      targetCommands,
      'five-band-fir-peq-target-response',
      'rgba(176, 176, 176, 0.7)',
      '1.5'
    );

    const realized = this._lastDesignSignature === this._designSignature()
      ? this._lastDesign?.response
      : null;
    if (realized?.frequencies?.length &&
      realized.realizedDb?.length === realized.frequencies.length) {
      const realizedCommands = [];
      for (let point = 0; point < realized.frequencies.length; point += 1) {
        const x = this.freqToX(realized.frequencies[point]) * width / 100;
        const y = this.gainToY(realized.realizedDb[point]) * height / 100;
        realizedCommands.push(
          `${point === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
        );
      }
      appendPath(
        realizedCommands,
        'five-band-fir-peq-realized-response',
        '#00ff00',
        '2'
      );
    }
  }

  handleDragMove(event) {
    if (this.activeDragMarker === null || !this.graphContainer) return;
    if (!this.hasMoved) {
      const xDifference = Math.abs(event.clientX - this.initialDragX);
      const yDifference = Math.abs(event.clientY - this.initialDragY);
      if (xDifference < 3 && yDifference < 3) return;
      this.hasMoved = true;
    }
    const plot = this.getGraphPlotArea();
    let x = (event.clientX - plot.left) / plot.width;
    let y = (event.clientY - plot.top) / plot.height;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    const band = this.activeDragMarker;
    this.setBand(band, this.xToFreq(x * 100), this.yToGain(y * 100));
    this.setUIBandValues(band);
  }

  handleDragEnd() {
    if (this.activeDragMarker === null) return;
    this.markers?.[this.activeDragMarker]?.classList.remove('active');
    this.activeDragMarker = null;
    this.hasMoved = false;
    if (this.boundMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundMouseMoveHandler);
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseMoveHandler = null;
      this.boundMouseUpHandler = null;
    }
  }

  observeGraphResize(container) {
    this.disconnectGraphResizeObserver();
    if (!container) return;
    this.lastGraphSize = { width: 0, height: 0 };
    const handleResize = () => {
      const rect = container.getBoundingClientRect?.() || { width: 0, height: 0 };
      const width = container.clientWidth || rect.width;
      const height = container.clientHeight || rect.height;
      if (!width || !height ||
        (width === this.lastGraphSize.width && height === this.lastGraphSize.height)) return;
      this.lastGraphSize = { width, height };
      this.updateMarkers();
      this.updateResponse();
    };
    const ResizeObserverClass = typeof ResizeObserver !== 'undefined'
      ? ResizeObserver
      : globalThis.window?.ResizeObserver;
    if (typeof ResizeObserverClass === 'function') {
      this.graphResizeObserver = new ResizeObserverClass(handleResize);
      this.graphResizeObserver.observe(container);
    } else if (globalThis.window?.addEventListener) {
      this.graphResizeWindowListener = handleResize;
      window.addEventListener('resize', handleResize);
    }
  }

  disconnectGraphResizeObserver() {
    this.graphResizeObserver?.disconnect();
    this.graphResizeObserver = null;
    if (this.graphResizeWindowListener && globalThis.window?.removeEventListener) {
      window.removeEventListener('resize', this.graphResizeWindowListener);
    }
    this.graphResizeWindowListener = null;
    this.lastGraphSize = null;
  }

  cleanup() {
    if (this._disposed) return;
    this._disposed = true;
    ++this._designGeneration;
    if (this._designTimer !== null) clearTimeout(this._designTimer);
    this._designTimer = null;
    this._designer?.close();
    this._designer = null;
    this.disconnectGraphResizeObserver();
    if (this.boundMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundMouseMoveHandler);
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
    }
    this.boundMouseMoveHandler = null;
    this.boundMouseUpHandler = null;
    this.activeDragMarker = null;
    this._lastDesignSignature = null;
    this.uiCreated = false;
    this._statusElement = null;
    this._latencyElement = null;
    super.cleanup();
  }
}

if (typeof window !== 'undefined') {
  window.FiveBandFIRPEQPlugin = FiveBandFIRPEQPlugin;
}
