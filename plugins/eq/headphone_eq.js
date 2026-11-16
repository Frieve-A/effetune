// Target adjust bands: flat keys ea/ta/fa/ga/qa + band index (enabled, type, frequency, gain, Q).
const HEADPHONE_EQ_ADJUST_FREQUENCIES = Object.freeze([100, 316, 1000, 3160, 10000]);
const HEADPHONE_EQ_ADJUST_TYPES = Object.freeze(['pk', 'ls', 'hs']);
const HEADPHONE_EQ_RANGES = Object.freeze({
  ca: [-100, 100], uf: [1000, 20000], mb: [0, 18], sm: [0.02, 1],
  ...Object.fromEntries(HEADPHONE_EQ_ADJUST_FREQUENCIES.flatMap((_, band) => [
    ['fa' + band, [20, 20000]], ['ga' + band, [-20, 20]]
  ]))
});
// Storage grid of the loaded curves (mr/mt): createLogFrequencyGrid(20, 20000, 1/24) of
// js/utils/measurement-dsp/smoothing.js, which this classic script cannot import.
const HEADPHONE_EQ_GRID = Object.freeze((() => {
  const octaves = Math.log2(20000 / 20);
  const steps = Math.ceil(octaves * 24);
  return Array.from({ length: steps + 1 }, (_, index) => 20 * 2 ** (index / steps * octaves));
})());
const HEADPHONE_EQ_GRID_LOG = Object.freeze(HEADPHONE_EQ_GRID.map(Math.log10));
const HEADPHONE_EQ_LOG_MIN = Math.log10(20);
const HEADPHONE_EQ_LOG_SPAN = 3;
// Interior ticks only; 20 Hz and 20 kHz are the axis bounds on the canvas edges.
const HEADPHONE_EQ_FREQ_TICKS = Object.freeze([50, 100, 200, 500, 1000, 2000, 5000, 10000]);
// Fixed ±20 dB level axis with 6 dB grid lines, as the Room EQ response graph.
const HEADPHONE_EQ_DB_LIMIT = 20;
const HEADPHONE_EQ_DB_TICKS = Object.freeze([-18, -12, -6, 0, 6, 12, 18]);
const HEADPHONE_EQ_PARSE_ERROR = 'This file could not be read as a frequency response. ' +
  'Use an AutoEq CSV or a text file with frequency and level columns.';
const HEADPHONE_EQ_NO_MEASUREMENT = 'Load a headphone measurement to start.';
const HEADPHONE_EQ_NO_TARGET = 'Load a target curve to apply the correction.';
const HEADPHONE_EQ_AUTOEQ_RESULTS = 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results';
const HEADPHONE_EQ_LIST_LOADING = 'Loading the headphone list…';
const HEADPHONE_EQ_LIST_ERROR = 'The headphone list could not be downloaded. ' +
  'Check your internet connection, or load a file instead.';
const HEADPHONE_EQ_DOWNLOADING = 'Downloading the measurement…';
const HEADPHONE_EQ_DOWNLOAD_ERROR = 'The measurement could not be downloaded. ' +
  'Check the link and your internet connection.';

class HeadphoneEQPlugin extends FirAssetEqPlugin {
  static executionCapabilities = Object.freeze({
    requiresWasm: true,
    supportedSampleRates: Object.freeze([44100, 48000, 88200, 96000, 176400, 192000])
  });

  static FIR_MESSAGES = {
    name: 'Headphone EQ',
    designing: 'Designing correction filter…',
    designFailed: 'The correction filter could not be designed. Try fewer taps or load the measurement again.',
    prepareFailed: 'The correction filter could not be prepared. Try fewer taps or a higher latency.',
    ready: 'Correction filter is ready.',
    warning: 'The correction may be inaccurate. Increase Taps or Smoothing.'
  };

  // Log-frequency linear interpolation of sorted [frequency, value] points at the given
  // frequencies; outside the points the edge values hold.
  static _interpolateLog(points, frequencies) {
    const result = new Array(frequencies.length);
    let upper = 1;
    for (let index = 0; index < frequencies.length; index += 1) {
      const frequency = frequencies[index];
      if (frequency <= points[0][0]) {
        result[index] = points[0][1];
        continue;
      }
      if (frequency >= points[points.length - 1][0]) {
        result[index] = points[points.length - 1][1];
        continue;
      }
      while (points[upper][0] < frequency) upper += 1;
      const [f0, v0] = points[upper - 1];
      const [f1, v1] = points[upper];
      const ratio = Math.log(frequency / f0) / Math.log(f1 / f0);
      result[index] = v0 + (v1 - v0) * ratio;
    }
    return result;
  }

  // Reads an AutoEq CSV (header with frequency/raw/target columns) or a headerless
  // "frequency level" text into the storage grid. In 'target' mode the target column wins
  // over raw. Throws when the file holds no usable response.
  static parseResponseFile(text, mode = 'measurement') {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    const split = line => line.trim().split(/\s*[,;\t]\s*|\s+/);
    const number = value => (value === undefined || value === '' ? NaN : Number(value));
    const first = lines.findIndex(line => line.trim() !== '');
    if (first < 0) throw new Error('The file is empty.');
    const header = split(lines[first]).map(name => name.toLowerCase());
    const finish = pairs => {
      const points = pairs
        .filter(([frequency, value]) => frequency > 0 && Number.isFinite(frequency) && Number.isFinite(value))
        .sort((a, b) => a[0] - b[0])
        .filter((point, index, sorted) => index === 0 || point[0] !== sorted[index - 1][0]);
      if (points.length < 2) throw new Error('Fewer than two valid points.');
      if (points[points.length - 1][0] / points[0][0] < 2) throw new Error('The points span less than one octave.');
      return HeadphoneEQPlugin._interpolateLog(points, HEADPHONE_EQ_GRID)
        .map(value => Math.round(value * 10) / 10 + 0);
    };
    const rows = (header.includes('frequency') ? lines.slice(first + 1) : lines)
      .filter(line => line.trim() !== '')
      .map(split);
    if (!header.includes('frequency')) {
      return { response: finish(rows.map(cells => [number(cells[0]), number(cells[1])])), target: null };
    }
    const column = name => header.indexOf(name);
    const read = index => finish(rows.map(cells => [number(cells[column('frequency')]), number(cells[index])]));
    if (mode === 'target') {
      const index = column('target') >= 0 ? column('target') : column('raw');
      if (index < 0) throw new Error('No target or raw column.');
      return { response: read(index), target: null };
    }
    if (column('raw') < 0) throw new Error('No raw column.');
    return { response: read(column('raw')), target: column('target') >= 0 ? read(column('target')) : null };
  }

  // Reads the AutoEQ results/INDEX.md lines "- [<Model>](./<source>/<rig form>/<Model, encoded>)
  // by <source>[ on <rig>]" into search entries; the link may hold unencoded parentheses, so it
  // ends at ") by ". crinacle results are left out; other lines and repeated labels are skipped.
  static parseAutoEqIndex(text) {
    const entries = new Map();
    for (const line of String(text).split(/\r?\n/)) {
      const match = /^- \[(.+?)\]\(\.\/(.+)\) by (.+?)(?: on (.+))?$/.exec(line.trim());
      if (!match || match[3] === 'crinacle') continue;
      const [, model, path, source, rig] = match;
      const label = rig ? `${model} — ${source} on ${rig}` : `${model} — ${source}`;
      if (entries.has(label)) continue;
      entries.set(label, {
        label,
        url: `${HEADPHONE_EQ_AUTOEQ_RESULTS}/${path}/${encodeURIComponent(model)}.csv`,
        name: `${model} (${source})`
      });
    }
    return [...entries.values()];
  }

  // GitHub page links to a file (blob) or an AutoEQ result folder (tree) become the raw file
  // URL; other links are fetched as they are.
  static toRawUrl(url) {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/(.+)$/.exec(url);
    if (!match) return url;
    const [, owner, repo, kind, path] = match;
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${path}`;
    return kind === 'blob' ? raw : `${raw}/${path.split('/').pop()}.csv`;
  }

  // The AutoEQ index, downloaded once per page on first use and shared by every instance;
  // a failed download is retried on the next request.
  static _autoEqIndex = null;

  static _loadAutoEqIndex() {
    HeadphoneEQPlugin._autoEqIndex ??= fetch(`${HEADPHONE_EQ_AUTOEQ_RESULTS}/INDEX.md`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(text => {
        const entries = HeadphoneEQPlugin.parseAutoEqIndex(text);
        if (!entries.length) throw new Error('The index lists no headphones.');
        return entries;
      })
      .catch(error => {
        HeadphoneEQPlugin._autoEqIndex = null;
        throw error;
      });
    return HeadphoneEQPlugin._autoEqIndex;
  }

  constructor() {
    super('Headphone EQ', 'FIR headphone correction toward a target curve');
    this.ca = 100;
    this.uf = 10000;
    this.mb = 6;
    this.sm = 0.17;
    this.ah = true;
    HEADPHONE_EQ_ADJUST_FREQUENCIES.forEach((frequency, band) => {
      this['ea' + band] = true;
      this['ta' + band] = 'pk';
      this['fa' + band] = frequency;
      this['ga' + band] = 0;
      this['qa' + band] = 1;
    });
    this.mr = [];
    this.mt = [];
    this.mn = '';
    this.tn = '';
    this.parameterRows = {};
    this._statusMessage = HEADPHONE_EQ_NO_MEASUREMENT;
    this._statusState = 'ready';
    this._measurementLoad = 0;
    this.offlineDspAssetErrorMessageKey = 'headphoneEq.error.design';
    this.registerProcessor('return data;');
  }

  getParameters(options = {}) {
    const parameters = super.getParameters(options);
    for (const key of ['ca', 'uf', 'mb', 'sm', 'ah']) parameters[key] = this[key];
    HEADPHONE_EQ_ADJUST_FREQUENCIES.forEach((_, band) => {
      for (const key of ['ea', 'ta', 'fa', 'ga', 'qa']) parameters[key + band] = this[key + band];
    });
    parameters.mr = this.mr.slice();
    parameters.mt = this.mt.slice();
    parameters.mn = this.mn;
    parameters.tn = this.tn;
    return parameters;
  }

  // Empty curves and names are left out, as Room EQ does with its measurement keys.
  getSerializableParameters() {
    const serialized = super.getSerializableParameters();
    for (const key of ['mr', 'mt', 'mn', 'tn']) {
      if (!serialized[key].length) delete serialized[key];
    }
    return serialized;
  }

  // A state without curves (undo, presets) clears the loaded ones.
  setSerializedParameters(params) {
    super.setSerializedParameters({ mr: [], mt: [], mn: '', tn: '', ...params });
  }

  _setDesignParameters(params) {
    for (const [key, [min, max]] of Object.entries(HEADPHONE_EQ_RANGES)) {
      if (params[key] !== undefined) this[key] = this.parseFiniteNumber(params[key], min, max, this[key]);
    }
    if (params.ah !== undefined) this.ah = Boolean(params.ah);
    HEADPHONE_EQ_ADJUST_FREQUENCIES.forEach((_, band) => {
      if (params['ea' + band] !== undefined) this['ea' + band] = Boolean(params['ea' + band]);
      const type = this['ta' + band] =
        this.isAllowedEnum(params['ta' + band], HEADPHONE_EQ_ADJUST_TYPES, this['ta' + band]);
      // Shelves cap Q at 2, as the editor does; a type change re-clamps it.
      this['qa' + band] = this.parseFiniteNumber(
        params['qa' + band] ?? this['qa' + band], 0.1, type === 'pk' ? 10 : 2, this['qa' + band]);
    });
    // A curve is empty (no data) or one finite value per storage grid point.
    for (const key of ['mr', 'mt']) {
      const curve = params[key];
      if (Array.isArray(curve) && (curve.length === 0 ||
        (curve.length === HEADPHONE_EQ_GRID.length && curve.every(Number.isFinite)))) {
        this[key] = curve.slice();
      }
    }
    for (const key of ['mn', 'tn']) {
      if (typeof params[key] === 'string') this[key] = params[key];
    }
  }

  _adjustBands() {
    return HEADPHONE_EQ_ADJUST_FREQUENCIES.map((_, band) => ({
      enabled: this['ea' + band],
      type: this['ta' + band],
      frequency: this['fa' + band],
      gain: this['ga' + band],
      q: this['qa' + band]
    }));
  }

  _hasCorrection() {
    return this.mr.length > 0 && this.mt.length > 0;
  }

  // The design input, including the measurement-minus-target response (null until both
  // curves are loaded, which designs a pass-through filter).
  _designConfig(sampleRate = this._sampleRate) {
    return {
      phase: this.pm,
      taps: this.tp,
      sampleRate,
      lowFrequency: 20,
      highFrequency: this.uf,
      maxBoostDb: this.mb,
      correctionAmount: this.ca / 100,
      smoothing: this.sm,
      limitPeakGain: this.ah,
      eqBands: this._adjustBands(),
      response: this._hasCorrection()
        ? HEADPHONE_EQ_GRID.map((frequency, index) => [frequency, this.mr[index] - this.mt[index]])
        : null
    };
  }

  // The result keeps the response it was designed for, so the graph can tell whether its
  // preview still matches the loaded curves.
  async _design(designer, { response, ...config }) {
    const result = await designer.design(config, [response
      ? { measurement: { id: 'headphone-eq', averageFrequencyResponse: response } }
      : null]);
    return Object.assign(result, { response });
  }

  _loadDesignerModule() {
    return import('../../js/room-eq/designer.js');
  }

  _createDesigner(runtime) {
    return runtime.createRoomEqDesigner();
  }

  _readyStatus() {
    if (!this.mr.length) return [HEADPHONE_EQ_NO_MEASUREMENT, 'ready'];
    if (!this.mt.length) return [HEADPHONE_EQ_NO_TARGET, 'ready'];
    const status = super._readyStatus();
    if (status[1] === 'warning') return status;
    const headroom = this._lastDesign?.previews?.[0]?.headroomDb ?? 0;
    const headroomText = this.ah && headroom <= -0.05 ? ` Headroom: ${headroom.toFixed(1)} dB.` : '';
    return [`Correction for ${this.mn} toward ${this.tn} is ready.${headroomText}`, 'ready'];
  }

  updateResponse() {
    this.drawGraph();
  }

  // Every parameter change (UI, file load, preset, undo) passes here. While the staged filter
  // is current, the status follows the loaded curves and names even when the design input
  // is unchanged; a pending or failed design keeps its own status.
  _syncParameterUI() {
    if (this._designStaged && !this._designPending) this._setStatus(...this._readyStatus());
    this.syncControlStates();
    this.drawGraph();
  }

  // Loads a response text (or a promise of one) under the given curve name; the file, drop,
  // search, and URL paths all end here. Returns whether the curves were loaded. A measurement
  // load superseded by a later one ends silently, so the last one started wins.
  async _loadText(text, name, mode, load = mode === 'target' ? null : ++this._measurementLoad) {
    try {
      text = await text;
      if (load !== null && load !== this._measurementLoad) return false;
      const { response, target } = HeadphoneEQPlugin.parseResponseFile(text, mode);
      this.setParameters(mode === 'target'
        ? { mt: response, tn: name }
        : { mr: response, mn: name, ...(target && { mt: target, tn: `${name} target` }) });
      // Loading again retries a failed design even when the design input is unchanged.
      if (!this._designStaged && !this._designPending) this._scheduleDesign(0);
      return true;
    } catch (error) {
      console.warn(`Headphone EQ could not read ${name}:`, error);
      this._setStatus(HEADPHONE_EQ_PARSE_ERROR, 'error');
      this._renderStatus();
      return false;
    }
  }

  _loadFile(file, mode) {
    return this._loadText(file.text(), file.name.replace(/\.[^.]*$/, ''), mode);
  }

  // Downloads a measurement; without a name, the last URL path element names it.
  _loadUrl(url, name) {
    const load = ++this._measurementLoad;
    return this._withProgress(HEADPHONE_EQ_DOWNLOADING, async () => {
      let text;
      try {
        name ??= decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.[^.]*$/, '');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
      } catch (error) {
        if (load !== this._measurementLoad) return false;
        console.warn(`Headphone EQ could not download ${url}:`, error);
        this._setStatus(HEADPHONE_EQ_DOWNLOAD_ERROR, 'error');
        this._renderStatus();
        return false;
      }
      return this._loadText(text, name, 'measurement', load);
    });
  }

  // Shows a progress message while the operation runs and then restores the earlier status,
  // unless a design or a failure has replaced the message meanwhile.
  async _withProgress(message, operation) {
    const previous = [this._statusMessage, this._statusState];
    this._setStatus(message, 'preparing');
    this._renderStatus();
    try {
      return await operation();
    } finally {
      if (this._statusMessage === message) {
        this._setStatus(...previous);
        this._renderStatus();
      }
    }
  }

  // Search entry: an index entry or an http(s) link loads a measurement; partial input does
  // nothing. A successful load clears the field.
  _createSearch() {
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'headphone-eq-search';
    search.placeholder = 'Search headphones (AutoEQ) or paste a URL';
    search.title = 'Type a headphone model and pick it from the AutoEQ list, or paste a link to a measurement file';
    search.autocomplete = 'off';
    const list = document.createElement('datalist');
    list.id = `headphone-eq-autoeq-${this.id}`;
    search.setAttribute('list', list.id);
    let entries = null;
    let request = null;
    search.addEventListener('focus', () => {
      request ??= this._withProgress(HEADPHONE_EQ_LIST_LOADING, () => HeadphoneEQPlugin._loadAutoEqIndex())
        .then(loaded => {
          entries = new Map(loaded.map(entry => [entry.label, entry]));
          list.replaceChildren(...loaded.map(({ label }) => {
            const option = document.createElement('option');
            option.value = label;
            return option;
          }));
          // A retry that succeeds clears the earlier list failure but keeps any newer status.
          if (this._statusMessage === HEADPHONE_EQ_LIST_ERROR) {
            this._setStatus(...this._readyStatus());
            this._renderStatus();
          }
        })
        .catch(error => {
          request = null;
          console.warn('Headphone EQ could not download the AutoEQ index:', error);
          this._setStatus(HEADPHONE_EQ_LIST_ERROR, 'error');
          this._renderStatus();
        });
    });
    search.addEventListener('change', async () => {
      const value = search.value.trim();
      const entry = entries?.get(value);
      let loaded;
      if (entry) loaded = await this._loadUrl(entry.url, entry.name);
      else if (/^https?:\/\//i.test(value)) loaded = await this._loadUrl(HeadphoneEQPlugin.toRawUrl(value));
      if (loaded) search.value = '';
    });
    return [search, list];
  }

  // Accepts a dropped .csv/.txt measurement on the container. The app's document drop
  // handlers listen in the capture phase, so these listen on window, which captures first,
  // and keep file drags over the container from reaching them (the body 'drag-over'
  // overlay they show is cleared). Other drags, and drops of other files, pass through.
  _attachFileDrop(container) {
    const isFileDrag = event => container.contains(event.target) &&
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const claim = event => {
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove('drag-over');
    };
    const onDragOver = event => {
      if (!isFileDrag(event)) return;
      claim(event);
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = event => {
      const file = isFileDrag(event) ? event.dataTransfer.files?.[0] : null;
      if (!file || !/\.(csv|txt)$/i.test(file.name)) return;
      claim(event);
      this._loadFile(file, 'measurement');
    };
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    this._fileDropDisposer = () => {
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }

  createUI() {
    this.resizeGraphDisposer?.();
    this.resizeGraphDisposer = null;
    this._graphReadout?.dispose?.();
    this._graphReadout = null;
    this._adjustEditor?.dispose();
    this._adjustEditor = null;
    this._fileDropDisposer?.();
    const container = document.createElement('div');
    container.className = 'plugin-parameter-ui headphone-eq-plugin-ui';
    const rows = this.parameterRows = {};
    const setter = key => value => this.setParameters({ [key]: value });
    container.append(...this._createSearch());
    this._attachFileDrop(container);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.txt';
    fileInput.style.display = 'none';
    let loadMode = 'measurement';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (file) await this._loadFile(file, loadMode);
      fileInput.value = '';
    });
    const loadButton = (label, title, mode) => {
      const button = document.createElement('button');
      button.className = 'analog-meter-reset-button';
      button.textContent = label;
      button.title = title;
      button.addEventListener('click', () => {
        loadMode = mode;
        fileInput.click();
      });
      return button;
    };
    const buttons = document.createElement('div');
    buttons.className = 'headphone-eq-buttons';
    buttons.append(
      loadButton('Load Measurement', 'Load a headphone frequency response (AutoEq CSV or frequency/level text)',
        'measurement'),
      loadButton('Load Target', 'Load the target curve to correct toward (AutoEq CSV or frequency/level text)',
        'target'),
      fileInput
    );
    container.appendChild(buttons);

    const parameters = document.createElement('div');
    parameters.className = 'analyzer-parameters';
    rows.ca = this.createParameterControl('Correction Amount', -100, 100, 1, this.ca, setter('ca'), '%', 'ca');
    rows.uf = this.createLogarithmicParameterControl('Upper Limit', 1000, 20000, 10, this.uf, setter('uf'), 'Hz', 'uf');
    rows.mb = this.createParameterControl('Max Boost', 0, 18, 0.1, this.mb, setter('mb'), 'dB', 'mb');
    rows.sm = this.createParameterControl('Smoothing', 0.02, 1, 0.01, this.sm, setter('sm'), 'oct', 'sm');
    rows.ah = this.createCheckboxControl('Auto Headroom', this.ah, setter('ah'), 'ah');
    parameters.append(rows.ca, rows.uf, rows.mb, rows.sm, rows.ah, ...this._createFirControls());
    container.appendChild(parameters);

    const graph = this.createResponsiveGraph({
      maxWidth: 1024,
      aspectRatio: '2.5 / 1',
      mobileAspectRatio: '4 / 3',
      className: 'headphone-eq-graph',
      onResize: ({ canvas, cssWidth }) => {
        this.canvas = canvas;
        this.graphCssWidth = cssWidth;
        this.canvasCtx = canvas.getContext('2d', { alpha: false });
        this.drawGraph();
      }
    });
    this.canvas = graph.canvas;
    this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
    this.resizeGraphDisposer = graph.dispose;
    this.canvas.setAttribute('aria-label', 'Headphone measurement, target, correction, and corrected response');
    this._graphContainer = graph.container;
    container.appendChild(graph.container);
    this._graphReadout = window.GraphReadout?.attach({
      mount: graph.container,
      surface: this.canvas,
      read: x => this._readGraph(x),
      legend: this._graphSeries()
    }) ?? null;

    // Target adjust handles on the graph (the editor's plot maps the canvas axes, in percent)
    // and their band controls under it.
    this._adjustEditor = window.RoomEqPlugin.createAdditionalEqEditor({
      host: this,
      id: this.id,
      sampleRate: this._sampleRate,
      bands: this._adjustBands(),
      onChange: bands => this.setParameters(Object.fromEntries(bands.flatMap((band, index) => [
        ['ea' + index, band.enabled], ['ta' + index, band.type], ['fa' + index, band.frequency],
        ['ga' + index, band.gain], ['qa' + index, band.q]
      ]))),
      plot: {
        element: graph.container,
        freqToX: frequency => (Math.log10(frequency) - HEADPHONE_EQ_LOG_MIN) / HEADPHONE_EQ_LOG_SPAN * 100,
        xToFreq: x => 10 ** (HEADPHONE_EQ_LOG_MIN + x / 100 * HEADPHONE_EQ_LOG_SPAN),
        gainToY: gain => 50 - gain / HEADPHONE_EQ_DB_LIMIT * 50,
        yToGain: y => (50 - y) / 50 * HEADPHONE_EQ_DB_LIMIT
      }
    });
    this._adjustUi = this._adjustEditor.createUI();
    container.appendChild(this._adjustUi);

    // The status and the latency share the bottom line, as in Room EQ.
    const statusLine = document.createElement('div');
    statusLine.className = 'room-eq-status-line local-audio-only';
    const status = this._statusElement = document.createElement('div');
    status.className = 'room-eq-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    this._latencyElement = document.createElement('div');
    this._latencyElement.className = 'room-eq-latency';
    statusLine.append(status, this._latencyElement);
    container.appendChild(statusLine);

    this.registerUIRefresh(() => {
      this.syncControlStates();
      this._adjustEditor?.syncFrom(this._adjustBands(), this._sampleRate);
    });
    this.uiCreated = true;
    this.syncControlStates();
    this._renderStatus();
    // The first design stages the filter (a unit impulse until both curves are loaded),
    // as the 5Band FIR PEQ does.
    this._scheduleDesign(0);
    this.drawGraph();
    return container;
  }

  // Until both curves are loaded the filter passes audio through, so the correction
  // settings and the target adjust have no effect and are shown disabled.
  syncControlStates() {
    const disabled = !this._hasCorrection();
    for (const key of ['ca', 'uf', 'mb', 'sm', 'ah']) {
      const row = this.parameterRows[key];
      if (!row) continue;
      row.classList.toggle('parameter-disabled', disabled);
      row.querySelectorAll('input').forEach(input => { input.disabled = disabled; });
    }
    this._adjustUi?.querySelectorAll('input, select, button').forEach(control => { control.disabled = disabled; });
    this._graphContainer?.classList.toggle('headphone-eq-inactive', disabled);
  }

  // Plotted series in legend order, in the Room EQ response colours.
  _graphSeries() {
    return [
      { label: 'Measurement', color: 'var(--et-graph-trace-secondary)' },
      { label: 'Target', color: 'var(--et-graph-overlay-compare)' },
      { label: 'Correction', color: 'var(--et-graph-trace)' },
      { label: 'Corrected', color: 'var(--et-text-primary)' }
    ];
  }

  // Sum of the enabled Target adjust bands (dB) at the given frequencies, from the editor's
  // own filter response.
  _adjustCurve(frequencies) {
    const editor = this._adjustEditor;
    // A sample rate change after the UI was built (committed by getParameters or reported
    // by the worklet) reaches the editor here, before its response is evaluated.
    if (editor._sampleRate !== this._sampleRate) editor.syncFrom(this._adjustBands(), this._sampleRate);
    const bands = HEADPHONE_EQ_ADJUST_FREQUENCIES.map((_, band) => band).filter(band =>
      this['ea' + band] && (this['ga' + band] >= 0.01 || this['ga' + band] <= -0.01));
    return Array.from(frequencies, frequency => {
      let total = 0;
      for (const band of bands) {
        total += editor.calculateBandResponse(frequency, this['fa' + band], this['ga' + band],
          this['qa' + band], this['ta' + band]);
      }
      return total;
    });
  }

  // Reference level (dB) of a storage-grid curve: the RMS of its linear gain from 20 Hz to the
  // Upper Limit. Same definition as the preview's referenceLevelDb in js/room-eq/design-core.js,
  // which this classic script cannot import, evaluated without the designer's smoothing.
  _referenceLevelDb(curve) {
    const high = this.uf < this._sampleRate * 0.45 ? this.uf : this._sampleRate * 0.45;
    let power = 0;
    let count = 0;
    for (let index = 0; index < HEADPHONE_EQ_GRID.length && HEADPHONE_EQ_GRID[index] <= high; index += 1) {
      power += 10 ** (curve[index] / 10);
      count += 1;
    }
    return 10 * Math.log10(power / (count || 1));
  }

  // The four series as [logFrequencies, values] (null when not drawn). The design preview
  // lives in the measurement-minus-target space; the target and the current adjust bring it
  // back to absolute levels, so a drag moves only the adjust term. Before a design the
  // measurement is placed the same way (around the target, or around 0 dB without one), so
  // the curve does not jump when the design lands. The correction is the EQ itself, without
  // the Auto Headroom shift, as in Room EQ.
  _graphCurves() {
    // A preview made for other curves (a redesign pending or failed) is not drawn.
    const design = this._lastDesign;
    const preview = this._hasCorrection() && design?.response?.every(([, value], index) =>
      value === this.mr[index] - this.mt[index]) ? design.previews?.[0] : null;
    if (!preview) {
      const level = this.mr.length && this._referenceLevelDb(this.mt.length
        ? this.mr.map((value, index) => value - this.mt[index])
        : this.mr);
      return [
        this.mr.length ? [HEADPHONE_EQ_GRID_LOG, this.mr.map(value => value - level)] : null,
        this.mt.length ? [HEADPHONE_EQ_GRID_LOG, this._adjustCurve(HEADPHONE_EQ_GRID).map((value, index) =>
          value + this.mt[index])] : null,
        null,
        null
      ];
    }
    const frequencies = preview.frequencies;
    const logFrequencies = Array.from(frequencies, Math.log10);
    const target = HeadphoneEQPlugin._interpolateLog(
      HEADPHONE_EQ_GRID.map((frequency, index) => [frequency, this.mt[index]]), frequencies);
    const adjust = this._adjustCurve(frequencies);
    const level = preview.referenceLevelDb;
    const series = values => [logFrequencies, values];
    return [
      series(target.map((value, index) => preview.measuredDb[index] - level + value)),
      series(target.map((value, index) => value + adjust[index])),
      series(adjust.map((value, index) => preview.baseCorrectionDb[index] + value)),
      series(target.map((value, index) => preview.predictedBaseDb[index] - level + value + adjust[index]))
    ];
  }

  _readGraph(x) {
    const frame = this._readoutFrame;
    if (!frame?.valid) return null;
    const { format, seriesValueAt } = window.GraphReadout;
    const logFrequency = HEADPHONE_EQ_LOG_MIN + x / frame.width * HEADPHONE_EQ_LOG_SPAN;
    return {
      cursor: format.frequency(10 ** logFrequency),
      rows: this._graphSeries().flatMap((series, index) => {
        const curve = frame.curves[index];
        if (!curve) return [];
        const value = seriesValueAt(curve[0], curve[1], logFrequency) ?? NaN;
        return [{ ...series, value: format.db(value, { signed: true }), y: frame.toY(value) }];
      })
    };
  }

  drawGraph() {
    const canvas = this.canvas;
    const ctx = this.canvasCtx;
    if (!canvas || !ctx || !this._adjustEditor) return;
    const { width, height } = canvas;
    if (!width || !height) return;
    const dpr = this.graphCssWidth > 0 ? width / this.graphCssWidth : 1;
    const thin = dpr > 1 ? dpr : 1;
    const color = role => window.ThemePalette?.get(role) ?? '';
    const curves = this._graphCurves();
    const toX = logFrequency => (logFrequency - HEADPHONE_EQ_LOG_MIN) / HEADPHONE_EQ_LOG_SPAN * width;
    const toY = db => (Number.isFinite(db) ? (HEADPHONE_EQ_DB_LIMIT - db) / (2 * HEADPHONE_EQ_DB_LIMIT) * height : NaN);
    const titleFont = `${Math.round(14 * dpr)}px Arial`;
    const labelZone = height - 38 * dpr;

    ctx.fillStyle = color('graph-bg-deep');
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = color('graph-grid');
    ctx.lineWidth = thin;
    ctx.fillStyle = color('graph-label');
    ctx.font = `${Math.round(12 * dpr)}px Arial`;
    ctx.textAlign = 'center';
    for (const frequency of HEADPHONE_EQ_FREQ_TICKS) {
      const x = toX(Math.log10(frequency));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      const label = frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
      const half = ctx.measureText(label).width / 2;
      if (x - half >= 0 && x + half <= width) ctx.fillText(label, x, height - 25 * dpr);
    }
    ctx.textAlign = 'right';
    for (const db of HEADPHONE_EQ_DB_TICKS) {
      const y = toY(db);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (y - 6 * dpr >= 0 && y + 6 * dpr <= labelZone) ctx.fillText(`${db}`, 40 * dpr, y + 4 * dpr);
    }

    // Upper Limit boundary, in the Room EQ correction boundary style.
    const limitX = toX(Math.log10(this.uf));
    ctx.save();
    ctx.strokeStyle = color('text-primary');
    ctx.lineCap = 'round';
    ctx.setLineDash([2 * thin, 3 * thin]);
    ctx.beginPath();
    ctx.moveTo(limitX, 0);
    ctx.lineTo(limitX, height);
    ctx.stroke();
    ctx.restore();

    const strokeCurve = ([logFrequencies, values]) => {
      ctx.beginPath();
      let drawing = false;
      for (let index = 0; index < values.length; index += 1) {
        if (!Number.isFinite(values[index])) {
          drawing = false;
          continue;
        }
        const x = toX(logFrequencies[index]);
        const y = toY(values[index]);
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    };
    ctx.lineWidth = thin;
    const roles = ['graph-trace-secondary', 'graph-overlay-compare', 'graph-trace', 'text-primary'];
    curves.forEach((curve, index) => {
      if (!curve) return;
      ctx.strokeStyle = color(roles[index]);
      // The measured curve sits back as in Room EQ.
      ctx.globalAlpha = index === 0 ? 0.7 : 1;
      strokeCurve(curve);
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = color('text-primary');
    ctx.font = titleFont;
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', width / 2, height - 5 * dpr);
    ctx.save();
    ctx.translate(12 * dpr, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Level (dB)', 0, 4 * dpr);
    ctx.restore();

    this._readoutFrame = { valid: true, width, curves, toY };
    this._graphReadout?.refresh();
    this._adjustEditor.updateMarkers();
  }

  cleanup() {
    this._graphReadout?.dispose?.();
    this._graphReadout = null;
    this._adjustEditor?.dispose();
    this._adjustEditor = null;
    this._fileDropDisposer?.();
    this._fileDropDisposer = null;
    this.resizeGraphDisposer?.();
    this.resizeGraphDisposer = null;
    this.canvas = null;
    this.canvasCtx = null;
    this._graphContainer = null;
    this._adjustUi = null;
    this.parameterRows = {};
    this._readoutFrame = null;
    super.cleanup();
  }
}

window.HeadphoneEQPlugin = HeadphoneEQPlugin;
