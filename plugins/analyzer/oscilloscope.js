const OSCILLOSCOPE_TAP_SCOPE_SNAPSHOT = 3;
const OSCILLOSCOPE_TELEMETRY_VERSION = 2;
const OSCILLOSCOPE_MAX_RAW_SAMPLES = 2048;
const OSCILLOSCOPE_MAX_CAPTURE_SAMPLES = 65536;
const OSCILLOSCOPE_M4_BUCKET_COUNT = 512;
const OSCILLOSCOPE_PAYLOAD_HEADER_BYTES = 16;
const OSCILLOSCOPE_M4_BUCKET_BYTES = 18;
const OSCILLOSCOPE_ENCODING_RAW = 0;
const OSCILLOSCOPE_ENCODING_M4 = 1;
const OSCILLOSCOPE_TRIGGERED_FLAG = 1 << 0;
const OSCILLOSCOPE_ENCODING_ENVELOPE = 2;
const OSCILLOSCOPE_ENVELOPE_HEADER_BYTES = 28;
const OSCILLOSCOPE_ENVELOPE_BUCKETS = 4096;
const OSCILLOSCOPE_MAX_ENVELOPE_BUCKETS = 8188;
const OSCILLOSCOPE_ROLLING_FLAG = 1 << 1;

class OscilloscopePlugin extends PluginBase {
    constructor() {
      super('Oscilloscope', 'Real-time waveform visualization');
  
      // ---------------------------
      // Parameter Initialization
      // ---------------------------
      // Display Time (dt): total time displayed along the horizontal axis.
      // Allowed range: 1 ms to 10 s (internal unit: sec)
      this.displayTime = 0.01; // default 10 ms = 0.01 sec
  
      // Trigger parameters:
      // Trigger Mode (tm): "Auto" (continuous sweep with forced update), "Normal" (freeze display if no trigger)
      // or "Off" (free-running display of the latest Display Time samples)
      this.triggerMode = 'Auto';
      // Trigger Level (tl): linear amplitude value (expected raw signal in [-1,1])
      this.triggerLevel = 0.0;
      // Trigger Edge (te): "Rising" or "Falling"
      this.triggerEdge = 'Rising';
      // Holdoff (ho): minimum time between triggers.
      // Allowed range: 0.1 ms to 10 ms (internal unit: sec)
      this.holdoff = 0.0001; // default 0.1 ms
  
      // Display Level (dl): in dB, allowed range: -96 dB to 0 dB.
      // The vertical axis is drawn from -gridMax to gridMax,
      // where gridMax = Math.pow(10, displayLevel/20) and the drawing factor is 1/gridMax.
      this.displayLevel = 0; // default 0 dB
      // Vertical Offset (vo): linear offset in [-1,1]; 0 means centered.
      this.verticalOffset = 0;
  
      // ---------------------------
      // Drawing and Buffer Setup
      // ---------------------------
      this.canvas = null;
      this.ctx = null;
      this.animationFrameId = null;
      this.resizeGraphDisposer = null;
      this.graphDpr = 1;
      this.graphCssWidth = 1024;
      this.scopeSnapshot = null;
      this.scopeScroll = null;
      this.scopeRaster = null;
      this.scopeGrid = null;
      this.scopePaint = null;
      this.scopeDrawn = null;
      this._dspTelemetryHub = null;
      this._dspTelemetryTapId = null;
      this._dspTelemetryUnsubscribe = null;
      this._boundDspScopeTelemetry = frame => this.handleDspScopeTelemetry(frame);
  
      this.sampleRate = 44100;
      this.frozenDisplayBuffer = null;
  
      // ---------------------------
      // Internal event listener bookkeeping.
      // ---------------------------
      this.boundEventListeners = new Map();
  
      // ---------------------------
      // Register Audio Worklet Processor
      // ---------------------------
      this.registerProcessor(OscilloscopePlugin.processorFunction);

      this.observer = null;
    }

    initializeDisplayState() {
      this.displayTime = 0.01;
      this.triggerMode = 'Auto';
      this.triggerLevel = 0;
      this.triggerEdge = 'Rising';
      this.holdoff = 0.0001;
      this.displayLevel = 0;
      this.verticalOffset = 0;
      this.sampleRate = 44100;
      this.displaySource = null;
      this.clearBuffer();
    }

    clearBuffer() {
      this.frozenDisplayBuffer = null;
      this.scopeSnapshot = null;
      this.scopeScroll = null;
      this.scopeRaster = null;
      this.scopeGrid = null;
      this.scopePaint = null;
      this.scopeDrawn = null;
    }
  
    // ================================================================
    // Audio Worklet Processor function
    //
    // Build compact display snapshots in the worklet, including the JavaScript fallback.
    // Rolling envelopes are aggregated as audio arrives; no long PCM window is scanned.
    // ================================================================
    static processorFunction = `
      const { channelCount, blockSize, sampleRate } = parameters;
      const mode = parameters.tm;
      const sampleCount = (sampleRate * parameters.dt) | 0;
      if (!context.scope) {
        const state = context.scope = {
          ring: new Float32Array(65536), rolling: new Float32Array(16384),
          building: new Float32Array(8192), indices: new Uint32Array(2048),
          position: 0, trigger: 0, processedTrigger: -1, lastTriggerTime: 0,
          lastAutoSweepTime: 0, endSample: 0, rollingIndex: 0, rollingFill: 0,
          active: false, nextUpdate: 0, snapshot: null
        };
        state.appendPoint = (index, value) => {
          if (state.points && state.indices[state.points - 1] === index) return;
          state.indices[state.points] = index;
          state.building[state.points++] = value;
        };
        state.begin = (position, triggered) => {
          state.active = true;
          state.readPosition = position;
          state.captured = 0;
          state.points = 0;
          state.bucket = 0;
          state.bucketBegin = 0;
          state.bucketCount = state.sampleCount > 65536 ? 4096 : 512;
          state.bucketEnd = Math.floor(state.sampleCount / state.bucketCount);
          state.triggered = triggered;
        };
        state.append = sample => {
          const index = state.captured++;
          if (state.sampleCount <= 2048) {
            state.building[index] = sample;
          } else {
            if (index === state.bucketBegin) {
              state.first = state.minimum = state.maximum = sample;
              state.minimumIndex = state.maximumIndex = index;
            } else {
              if (sample < state.minimum) { state.minimum = sample; state.minimumIndex = index; }
              if (sample > state.maximum) { state.maximum = sample; state.maximumIndex = index; }
            }
            if (state.captured === state.bucketEnd) {
              if (state.sampleCount > 65536) {
                state.building[state.bucket * 2] = state.minimum;
                state.building[state.bucket * 2 + 1] = state.maximum;
              } else {
                state.appendPoint(state.bucketBegin, state.first);
                if (state.minimumIndex <= state.maximumIndex) {
                  state.appendPoint(state.minimumIndex, state.minimum);
                  state.appendPoint(state.maximumIndex, state.maximum);
                } else {
                  state.appendPoint(state.maximumIndex, state.maximum);
                  state.appendPoint(state.minimumIndex, state.minimum);
                }
                state.appendPoint(index, sample);
              }
              state.bucketBegin = state.bucketEnd;
              state.bucket++;
              state.bucketEnd = Math.floor((state.bucket + 1) * state.sampleCount / state.bucketCount);
            }
          }
          if (state.captured === state.sampleCount) {
            const envelope = state.sampleCount > 65536;
            const raw = state.sampleCount <= 2048;
            const length = envelope ? 8192 : raw ? state.sampleCount : state.points;
            state.snapshot = {
              sampleRate: state.sampleRate, captureSampleCount: state.sampleCount,
              triggerOffsetInSnapshot: 0, triggered: state.triggered,
              encoding: envelope ? 2 : raw ? 0 : 1, bucketCount: raw ? 0 : state.bucketCount,
              values: envelope ? null : state.building.slice(0, length),
              sampleIndices: raw || envelope ? null : state.indices.slice(0, length),
              extrema: envelope ? state.building.slice(0, length) : null,
              rolling: false, bucketSamples: 0, endSample: 0
            };
            state.active = false;
          }
        };
      }
      const state = context.scope;
      if (state.sampleCount !== sampleCount || state.mode !== mode ||
          state.edge !== parameters.te || state.sampleRate !== sampleRate) {
        state.sampleCount = sampleCount > 0 ? sampleCount : 1;
        state.sampleRate = sampleRate;
        state.mode = mode;
        state.edge = parameters.te;
        state.active = false;
        state.snapshot = null;
        state.processedTrigger = -1;
        state.endSample = state.rollingIndex = state.rollingFill = 0;
        state.bucketSamples = Math.ceil(state.sampleCount / 4096);
        state.nextUpdate = 0;
      }
      const rolling = mode === 'Off' && state.sampleCount > 2048;
      let currentPosition = state.position;
      for (let i = 0; i < blockSize; i++) {
        const left = data[i];
        const sample = (left + (channelCount > 1 ? data[blockSize + i] : left)) * 0.5;
        if (rolling) {
          const offset = state.rollingIndex * 2;
          if (state.rollingFill === 0) {
            state.rolling[offset] = state.rolling[offset + 1] = sample;
          } else {
            if (sample < state.rolling[offset]) state.rolling[offset] = sample;
            if (sample > state.rolling[offset + 1]) state.rolling[offset + 1] = sample;
          }
          if (++state.rollingFill === state.bucketSamples) {
            state.rollingFill = 0;
            state.rollingIndex = (state.rollingIndex + 1) & 8191;
          }
        } else {
          state.ring[currentPosition] = sample;
          currentPosition = (currentPosition + 1) & 65535;
        }
      }
      state.position = currentPosition;
      state.endSample += blockSize;
      if (mode !== 'Off') {
        let triggered = false;
        const level = parameters.tl;
        const rising = parameters.te === 'Rising';
        let previous = state.ring[(currentPosition - blockSize) & 65535];
        for (let i = 0; i < blockSize; i++) {
          const index = (currentPosition - blockSize + i) & 65535;
          const sample = state.ring[index];
          if ((rising ? previous < level && sample >= level : previous > level && sample <= level) &&
              time - state.lastTriggerTime >= parameters.ho) {
            state.trigger = index;
            state.lastTriggerTime = time;
            state.realTrigger = triggered = true;
            if (mode === 'Auto') state.lastAutoSweepTime = time;
            break;
          }
          previous = sample;
        }
        if (mode === 'Auto' && !triggered) {
          if (!state.lastAutoSweepTime) state.lastAutoSweepTime = time;
          if (time - state.lastAutoSweepTime >= 0.1) {
            state.trigger = currentPosition;
            state.realTrigger = false;
            state.lastAutoSweepTime = time;
          }
        }
        if (!state.active && state.processedTrigger !== state.trigger) {
          state.processedTrigger = state.trigger;
          state.begin(state.trigger, !!state.realTrigger);
        }
        if (state.active) {
          const available = (currentPosition - state.readPosition) & 65535;
          let count = available < blockSize * 2 ? available : blockSize * 2;
          const remaining = state.sampleCount - state.captured;
          if (count > remaining) count = remaining;
          for (let i = 0; i < count; i++) {
            state.append(state.ring[(state.readPosition + i) & 65535]);
          }
          state.readPosition = (state.readPosition + count) & 65535;
        }
      }
      if (time >= state.nextUpdate) {
        const interval = 1 / (mode === 'Off' ? 60 : 30);
        state.nextUpdate += interval;
        if (state.nextUpdate <= time) state.nextUpdate = time + interval;
        if (rolling) {
          const overlap = sampleRate * 0.1 < state.bucketSamples * 4090
            ? Math.floor(sampleRate * 0.1) : state.bucketSamples * 4090;
          const start = state.endSample - state.sampleCount - overlap;
          const first = start > 0 ? Math.floor(start / state.bucketSamples) : 0;
          const last = Math.floor((state.endSample - 1) / state.bucketSamples);
          const count = last - first + 1;
          const extrema = new Float32Array(count * 2);
          for (let i = 0; i < count; i++) {
            const offset = ((first + i) & 8191) * 2;
            extrema[i * 2] = state.rolling[offset];
            extrema[i * 2 + 1] = state.rolling[offset + 1];
          }
          state.snapshot = {
            sampleRate, captureSampleCount: state.sampleCount, triggerOffsetInSnapshot: 0,
            triggered: false, encoding: 2, bucketCount: count, values: null, sampleIndices: null,
            extrema, rolling: true, bucketSamples: state.bucketSamples, endSample: state.endSample
          };
        } else if (mode === 'Off') {
          const values = new Float32Array(state.sampleCount);
          for (let i = 0; i < state.sampleCount; i++) {
            values[i] = state.ring[(currentPosition - state.sampleCount + i) & 65535];
          }
          state.snapshot = { sampleRate, captureSampleCount: state.sampleCount,
            triggerOffsetInSnapshot: 0, triggered: false, encoding: 0, bucketCount: 0,
            values, sampleIndices: null, rolling: false };
        }
        if (state.snapshot) {
          data.measurements = { scopeSnapshot: state.snapshot };
        }
      }
      return data;
    `;
  
    // ================================================================
    // createUI: Build the UI (parameter controls + canvas).
    // All comments are in English.
    // ================================================================
    createUI() {
      this.ensureDspTelemetrySubscription();
      if (this.observer) {
        this.observer.disconnect();
      }
      if (this.resizeGraphDisposer) {
        this.resizeGraphDisposer();
        this.resizeGraphDisposer = null;
      }
      const container = document.createElement('div');
      container.className = 'plugin-parameter-ui oscilloscope-plugin-ui';
  
      const parametersGrid = document.createElement('div');
      parametersGrid.className = 'parameters-grid';
      // Each column stacks its own rows, so a wrapped radio row grows only its column.
      const leftColumn = document.createElement('div');
      const rightColumn = document.createElement('div');
      parametersGrid.appendChild(leftColumn);
      parametersGrid.appendChild(rightColumn);
  
      // --- Display Time Control (ms) ---
      leftColumn.appendChild(this.createParameterControl(
        'Display Time', 1, 10000, 1,
        (this.displayTime * 1000).toFixed(0),
        (value) => {
          this.setDisplayTime(value / 1000);
          this.clearBuffer();
          this.updateParameters();
        },
        // The widget is in ms while the model holds seconds.
        'ms', 'displayTime', (value) => value * 1000, true
      ));
  
      // --- Trigger Mode Control (Auto/Normal/Off) ---
      const tmRow = document.createElement('div');
      tmRow.className = 'parameter-row';
  
      const tmLabel = document.createElement('label');
      tmLabel.textContent = 'Trigger Mode:';

      const modes = ['Auto', 'Normal', 'Off'];
      const modeRadioInputs = [];
      const modeRadios = modes.map(mode => {
        const label = document.createElement('label');
        label.className = 'radio-label';
        const radioId = `${this.id}-${this.name}-trigger-mode-${mode.toLowerCase()}`;
        label.htmlFor = radioId;

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.id = radioId;
        radio.name = `${this.id}-${this.name}-trigger-mode`;
        radio.value = mode;
        radio.checked = (mode === this.triggerMode);
        radio.autocomplete = "off";
  
        const radioHandler = (e) => {
          if (e.target.checked) {
            this.setTriggerMode(e.target.value);
            this.clearBuffer();
          }
        };
        radio.addEventListener('change', radioHandler);
        this.boundEventListeners.set(radio, radioHandler);
  
        label.appendChild(radio);
        label.appendChild(document.createTextNode(mode));
        modeRadioInputs.push({ radio, mode });
        return label;
      });
      const tmGroup = document.createElement('div');
      tmGroup.className = 'radio-group';
      modeRadios.forEach(r => tmGroup.appendChild(r));
      tmRow.appendChild(tmLabel);
      tmRow.appendChild(tmGroup);
      rightColumn.appendChild(tmRow);
  
      // --- Trigger Level Control ---
      leftColumn.appendChild(this.createParameterControl(
        'Trigger Level', -1.0, 1.0, 0.01,
        this.triggerLevel,
        (value) => {
          this.setTriggerLevel(value);
          this.updateParameters();
        },
        '', 'triggerLevel'
      ));
  
      // --- Trigger Edge Control (Rising/Falling) ---
      const teRow = document.createElement('div');
      teRow.className = 'parameter-row';
  
      const teLabel = document.createElement('label');
      teLabel.textContent = 'Trigger Edge:';

      const edges = ['Rising', 'Falling'];
      const edgeRadioInputs = [];
      const edgeRadios = edges.map(edge => {
        const label = document.createElement('label');
        label.className = 'radio-label';
        const radioId = `${this.id}-${this.name}-trigger-edge-${edge.toLowerCase()}`;
        label.htmlFor = radioId;

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.id = radioId;
        radio.name = `${this.id}-${this.name}-trigger-edge`;
        radio.value = edge;
        radio.checked = (edge === this.triggerEdge);
        radio.autocomplete = "off";
  
        const radioHandler = (e) => {
          if (e.target.checked) {
            this.setTriggerEdge(e.target.value);
            this.clearBuffer();
          }
        };
        radio.addEventListener('change', radioHandler);
        this.boundEventListeners.set(radio, radioHandler);
  
        label.appendChild(radio);
        label.appendChild(document.createTextNode(edge));
        edgeRadioInputs.push({ radio, edge });
        return label;
      });
      const teGroup = document.createElement('div');
      teGroup.className = 'radio-group';
      edgeRadios.forEach(r => teGroup.appendChild(r));
      teRow.appendChild(teLabel);
      teRow.appendChild(teGroup);
      rightColumn.appendChild(teRow);
  
      // --- Holdoff Control (ms) ---
      leftColumn.appendChild(this.createParameterControl(
        'Holdoff', 0.1, 10, 0.1,
        (this.holdoff * 1000).toFixed(1),
        (value) => {
          this.setHoldoff(value / 1000);
          this.updateParameters();
        },
        // The widget is in ms while the model holds seconds.
        'ms', 'holdoff', (value) => value * 1000, true
      ));
  
      // --- Display Level Control (dB) ---
      rightColumn.appendChild(this.createParameterControl(
        'Display Level', -96, 0, 1,
        this.displayLevel,
        (value) => {
          this.setDisplayLevel(value);
          this.updateParameters();
        },
        'dB', 'displayLevel'
      ));

      // --- Vertical Offset Control ---
      leftColumn.appendChild(this.createParameterControl(
        'Vertical Offset', -1.0, 1.0, 0.01,
        this.verticalOffset,
        (value) => {
          this.setVerticalOffset(value);
          this.updateParameters();
        },
        '', 'verticalOffset'
      ));
  
      container.appendChild(parametersGrid);
  
      // --- Graph Container and Canvas ---
      const graph = this.createResponsiveGraph({
        className: 'local-audio-only',
        maxWidth: 1024,
        aspectRatio: '32 / 15',
        mobileAspectRatio: '4 / 3',
        onResize: ({ canvas, cssWidth, dpr }) => {
          this.canvas = canvas;
          this.graphCssWidth = cssWidth;
          this.graphDpr = dpr;
          this.ctx = canvas.getContext('2d', { alpha: false });
          this.drawWaveform();
        }
      });
      const graphContainer = graph.container;
      this.canvas = graph.canvas;
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.resizeGraphDisposer = graph.dispose;
  
      container.appendChild(graphContainer);
  
      if (this.observer == null) {
        this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
      }
      this.observer.observe(this.canvas);

      // Automation playback and preset recall change the model without touching the
      // DOM, so the hand-built radio groups are refreshed here. The sliders above are
      // covered by their modelKey.
      this.registerUIRefresh(() => {
        for (const { radio, mode } of modeRadioInputs) {
          radio.checked = (mode === this.triggerMode);
        }
        for (const { radio, edge } of edgeRadioInputs) {
          radio.checked = (edge === this.triggerEdge);
        }
      });

      this._graphReadout = window.GraphReadout?.attach({
        mount: graphContainer,
        surface: this.canvas,
        plot: () => {
          const frame = this._readoutFrame;
          return frame && { left: frame.left, top: 0, width: frame.width, height: frame.height };
        },
        read: x => this._readWaveform(x)
      });

      return container;
    }
  
    // ---------------------------
    // Setter Methods
    // ---------------------------
    setDisplayTime(value) {
      const newValue = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(newValue)) {
        this.displayTime = newValue < 0.001 ? 0.001 : (newValue > 10 ? 10 : newValue);
        this.clearBuffer();
      }
      this.updateParameters();
    }
  
    setTriggerMode(value) {
      if (['Auto', 'Normal', 'Off'].includes(value)) {
        this.triggerMode = value;
        // Clear frozen snapshot when mode changes.
        this.frozenDisplayBuffer = null;
        this.clearBuffer();
        this.updateParameters();
      }
    }
  
    setTriggerLevel(value) {
      const newValue = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(newValue)) {
        this.triggerLevel = newValue < -1 ? -1 : (newValue > 1 ? 1 : newValue);
        this.updateParameters();
      }
    }
  
    setTriggerEdge(value) {
      if (['Rising', 'Falling'].includes(value)) {
        this.triggerEdge = value;
        this.frozenDisplayBuffer = null;
        this.updateParameters();
      }
    }
  
    setHoldoff(value) {
      const newValue = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(newValue)) {
        this.holdoff = newValue < 1e-4 ? 1e-4 : (newValue > 1e-2 ? 1e-2 : newValue);
      }
      this.updateParameters();
    }
  
    // Display Level: in dB (dl); effective drawing factor = 1/Math.pow(10, displayLevel/20)
    setDisplayLevel(value) {
      const newValue = typeof value === 'number' ? value : parseInt(value);
      if (!isNaN(newValue)) {
        this.displayLevel = newValue < -96 ? -96 : (newValue > 0 ? 0 : newValue);
        this.updateParameters();
      }
    }
  
    setVerticalOffset(value) {
      const newValue = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(newValue)) {
        this.verticalOffset = newValue < -1 ? -1 : (newValue > 1 ? 1 : newValue);
        this.updateParameters();
      }
    }
  
    // ---------------------------
    // Parameter Getters / Updater
    // Return parameters with short names as per the development guide.
    // ---------------------------
    getParameters() {
      this.ensureDspTelemetrySubscription();
      return {
        type: this.constructor.name,
        enabled: this.enabled,
        dt: this.displayTime,      // Display Time
        tm: this.triggerMode,      // Trigger Mode
        tl: this.triggerLevel,     // Trigger Level
        te: this.triggerEdge,      // Trigger Edge
        ho: this.holdoff,          // Holdoff
        dl: this.displayLevel,     // Display Level
        vo: this.verticalOffset    // Vertical Offset
      };
    }
  
    setParameters(params) {
      if (params.dt !== undefined) this.setDisplayTime(params.dt);
      if (params.tm !== undefined) this.setTriggerMode(params.tm);
      if (params.tl !== undefined) this.setTriggerLevel(params.tl);
      if (params.te !== undefined) this.setTriggerEdge(params.te);
      if (params.ho !== undefined) this.setHoldoff(params.ho);
      if (params.dl !== undefined) this.setDisplayLevel(params.dl);
      if (params.vo !== undefined) this.setVerticalOffset(params.vo);
      this.updateParameters();
    }

    _setupMessageHandler() {
      super._setupMessageHandler();
      this.ensureDspTelemetrySubscription?.();
    }

    ensureDspTelemetrySubscription() {
      const hub = window.dspTelemetryHub;
      const tapId = this.id;
      const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
      const validHub = hub && typeof hub.subscribe === 'function';

      if (!validTapId || !validHub) {
        if (this._dspTelemetryUnsubscribe &&
            (hub !== this._dspTelemetryHub || tapId !== this._dspTelemetryTapId)) {
          this.disposeDspTelemetrySubscription();
        }
        return false;
      }
      if (this._dspTelemetryUnsubscribe &&
          hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) {
        return true;
      }

      this.disposeDspTelemetrySubscription();
      try {
        const unsubscribe = hub.subscribe(
          tapId,
          OSCILLOSCOPE_TAP_SCOPE_SNAPSHOT,
          this._boundDspScopeTelemetry
        );
        if (typeof unsubscribe !== 'function') {
          hub.unsubscribe?.(
            tapId,
            OSCILLOSCOPE_TAP_SCOPE_SNAPSHOT,
            this._boundDspScopeTelemetry
          );
          return false;
        }
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
      if (!unsubscribe) return;
      try {
        unsubscribe();
      } catch (error) {
        // Ignore stale telemetry subscription cleanup failures.
      }
    }

    parseDspScopeTelemetryFrame(frame) {
      if (frame?.frameType !== OSCILLOSCOPE_TAP_SCOPE_SNAPSHOT ||
          ![OSCILLOSCOPE_TELEMETRY_VERSION, 3].includes(frame.formatVersion)) {
        return null;
      }
      const payload = frame.payload;
      if (!payload || typeof payload.getUint8 !== 'function' ||
          typeof payload.getUint16 !== 'function' ||
          typeof payload.getUint32 !== 'function' ||
          typeof payload.getFloat32 !== 'function' ||
          !Number.isInteger(payload.byteLength) ||
          payload.byteLength < OSCILLOSCOPE_PAYLOAD_HEADER_BYTES + 4) {
        return null;
      }

      const sampleRate = payload.getFloat32(0, true);
      const captureSampleCount = payload.getUint32(4, true);
      const triggerOffsetInSnapshot = payload.getUint32(8, true);
      const bucketCount = payload.getUint16(12, true);
      const encoding = payload.getUint8(14);
      const flags = payload.getUint8(15);
      if (frame.formatVersion === 3) {
        if (encoding !== OSCILLOSCOPE_ENCODING_ENVELOPE ||
            !Number.isFinite(sampleRate) || sampleRate <= 0 ||
            captureSampleCount <= OSCILLOSCOPE_MAX_RAW_SAMPLES ||
            captureSampleCount > Math.ceil(sampleRate * 10) ||
            triggerOffsetInSnapshot >= captureSampleCount ||
            bucketCount < 1 || bucketCount > OSCILLOSCOPE_MAX_ENVELOPE_BUCKETS ||
            (flags & ~(OSCILLOSCOPE_TRIGGERED_FLAG | OSCILLOSCOPE_ROLLING_FLAG)) !== 0 ||
            payload.byteLength !== OSCILLOSCOPE_ENVELOPE_HEADER_BYTES + bucketCount * 8) return null;
        const bucketSamples = payload.getUint32(16, true);
        const endSample = payload.getUint32(20, true) + payload.getUint32(24, true) * 0x100000000;
        const rolling = (flags & OSCILLOSCOPE_ROLLING_FLAG) !== 0;
        if (rolling ? bucketSamples !== Math.ceil(captureSampleCount / OSCILLOSCOPE_ENVELOPE_BUCKETS) ||
            !Number.isSafeInteger(endSample) || endSample < 1 ||
            bucketCount > Math.ceil(endSample / bucketSamples) || (flags & OSCILLOSCOPE_TRIGGERED_FLAG)
          : bucketSamples !== 0 || endSample !== 0 || bucketCount !== OSCILLOSCOPE_ENVELOPE_BUCKETS) {
          return null;
        }
        const extrema = new Float32Array(bucketCount * 2);
        for (let bucket = 0; bucket < bucketCount; bucket++) {
          const offset = OSCILLOSCOPE_ENVELOPE_HEADER_BYTES + bucket * 8;
          const minimum = payload.getFloat32(offset, true);
          const maximum = payload.getFloat32(offset + 4, true);
          if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) return null;
          extrema[bucket * 2] = minimum;
          extrema[bucket * 2 + 1] = maximum;
        }
        return { sampleRate, captureSampleCount, triggerOffsetInSnapshot, bucketCount, encoding,
          triggered: (flags & OSCILLOSCOPE_TRIGGERED_FLAG) !== 0, rolling, bucketSamples, endSample,
          extrema, values: null, sampleIndices: null };
      }
      if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
          captureSampleCount < 1 || captureSampleCount > OSCILLOSCOPE_MAX_CAPTURE_SAMPLES ||
          triggerOffsetInSnapshot >= captureSampleCount ||
          (flags & ~OSCILLOSCOPE_TRIGGERED_FLAG) !== 0) {
        return null;
      }

      if (encoding === OSCILLOSCOPE_ENCODING_RAW) {
        if (bucketCount !== 0 || captureSampleCount > OSCILLOSCOPE_MAX_RAW_SAMPLES ||
            payload.byteLength !== OSCILLOSCOPE_PAYLOAD_HEADER_BYTES + captureSampleCount * 4) {
          return null;
        }
        const values = new Float32Array(captureSampleCount);
        for (let index = 0; index < captureSampleCount; index++) {
          const value = payload.getFloat32(
            OSCILLOSCOPE_PAYLOAD_HEADER_BYTES + index * 4,
            true
          );
          if (!Number.isFinite(value)) return null;
          values[index] = value;
        }
        return {
          sampleRate,
          captureSampleCount,
          triggerOffsetInSnapshot,
          bucketCount,
          encoding,
          triggered: (flags & OSCILLOSCOPE_TRIGGERED_FLAG) !== 0,
          sampleIndices: null,
          values
        };
      }

      if (encoding !== OSCILLOSCOPE_ENCODING_M4 ||
          captureSampleCount <= OSCILLOSCOPE_MAX_RAW_SAMPLES ||
          bucketCount !== OSCILLOSCOPE_M4_BUCKET_COUNT ||
          payload.byteLength !==
            OSCILLOSCOPE_PAYLOAD_HEADER_BYTES + bucketCount * OSCILLOSCOPE_M4_BUCKET_BYTES) {
        return null;
      }

      const sampleIndices = new Uint32Array(bucketCount * 4);
      const values = new Float32Array(bucketCount * 4);
      let pointCount = 0;
      const appendPoint = (sampleIndex, value) => {
        if (pointCount > 0 && sampleIndices[pointCount - 1] === sampleIndex) {
          return values[pointCount - 1] === value;
        }
        sampleIndices[pointCount] = sampleIndex;
        values[pointCount] = value;
        pointCount++;
        return true;
      };

      for (let bucket = 0; bucket < bucketCount; bucket++) {
        const begin = Math.floor(bucket * captureSampleCount / bucketCount);
        const end = Math.floor((bucket + 1) * captureSampleCount / bucketCount);
        const bucketLength = end - begin;
        const offset = OSCILLOSCOPE_PAYLOAD_HEADER_BYTES +
          bucket * OSCILLOSCOPE_M4_BUCKET_BYTES;
        const first = payload.getFloat32(offset, true);
        const minimum = payload.getFloat32(offset + 4, true);
        const maximum = payload.getFloat32(offset + 8, true);
        const last = payload.getFloat32(offset + 12, true);
        const minimumOffset = payload.getUint8(offset + 16);
        const maximumOffset = payload.getUint8(offset + 17);
        if (!Number.isFinite(first) || !Number.isFinite(minimum) ||
            !Number.isFinite(maximum) || !Number.isFinite(last) || minimum > maximum ||
            first < minimum || first > maximum || last < minimum || last > maximum ||
            minimumOffset >= bucketLength || maximumOffset >= bucketLength) {
          return null;
        }

        const minimumIndex = begin + minimumOffset;
        const maximumIndex = begin + maximumOffset;
        if (!appendPoint(begin, first)) return null;
        if (minimumIndex <= maximumIndex) {
          if (!appendPoint(minimumIndex, minimum) ||
              !appendPoint(maximumIndex, maximum)) return null;
        } else if (!appendPoint(maximumIndex, maximum) ||
                   !appendPoint(minimumIndex, minimum)) {
          return null;
        }
        if (!appendPoint(end - 1, last)) return null;
      }

      return {
        sampleRate,
        captureSampleCount,
        triggerOffsetInSnapshot,
        bucketCount,
        encoding,
        triggered: (flags & OSCILLOSCOPE_TRIGGERED_FLAG) !== 0,
        sampleIndices: sampleIndices.subarray(0, pointCount),
        values: values.subarray(0, pointCount)
      };
    }

    handleDspScopeTelemetry(frame) {
      const snapshot = this.parseDspScopeTelemetryFrame(frame);
      if (!snapshot || !this.enabled) return;
      if (frame.source && frame.source !== this.displaySource) {
        this.clearBuffer();
        this.displaySource = frame.source;
      }
      this.acceptScopeSnapshot(snapshot);
    }

    acceptScopeSnapshot(snapshot) {
      const now = performance.now();
      const previous = this.scopeSnapshot;
      if (snapshot.rolling && previous?.rolling && snapshot.endSample === previous.endSample &&
          snapshot.sampleRate === previous.sampleRate && snapshot.captureSampleCount === previous.captureSampleCount) return;
      if (!snapshot.rolling && previous && !previous.rolling &&
          snapshot.encoding === previous.encoding && snapshot.sampleRate === previous.sampleRate &&
          snapshot.captureSampleCount === previous.captureSampleCount &&
          snapshot.triggered === previous.triggered &&
          snapshot.triggerOffsetInSnapshot === previous.triggerOffsetInSnapshot &&
          ['values', 'sampleIndices', 'extrema'].every(key => {
            const current = snapshot[key], old = previous[key];
            return current === old || current?.length === old?.length && current?.every((value, index) => value === old[index]);
          })) return;
      if (snapshot.rolling) {
        const compatible = previous?.rolling && previous.sampleRate === snapshot.sampleRate &&
          previous.captureSampleCount === snapshot.captureSampleCount &&
          snapshot.endSample >= previous.endSample;
        if (!compatible || !this.scopeScroll ||
            (snapshot.endSample > previous.endSample && now - this.scopeScroll.receivedAt > 250)) {
          // Buffer two telemetry periods so delivery jitter does not stop the render clock.
          this.scopeScroll = { sample: Math.max(0, snapshot.endSample - snapshot.sampleRate / 30),
            time: now, receivedAt: now, rate: snapshot.sampleRate };
        } else if (snapshot.endSample > previous.endSample) {
          const sample = this.scopeDisplayEnd(now);
          const error = snapshot.endSample - snapshot.sampleRate / 30 - sample;
          // Correct clock drift over a second, without following each message's arrival time.
          const correction = Math.max(-snapshot.sampleRate * 0.05, Math.min(snapshot.sampleRate * 0.05, error));
          this.scopeScroll = { sample, time: now, receivedAt: now, rate: snapshot.sampleRate + correction };
        }
      } else {
        this.scopeScroll = null;
      }
      this.sampleRate = snapshot.sampleRate;
      this.scopeSnapshot = snapshot;
      this.frozenDisplayBuffer = snapshot.encoding === OSCILLOSCOPE_ENCODING_RAW ? snapshot.values : null;
    }

    scopeDisplayEnd(now = performance.now()) {
      const scroll = this.scopeScroll;
      if (!scroll) return this.scopeSnapshot?.endSample || 0;
      return Math.min(this.scopeSnapshot.endSample,
        scroll.sample + Math.max(0, now - scroll.time) * scroll.rate / 1000);
    }

    paintEnvelopeColumns(target, snapshot, origin, samplesPerPixel, from, to, geometry) {
      const scale = geometry.factor * geometry.height / 2;
      const firstBucket = snapshot.rolling
        ? Math.floor((snapshot.endSample - 1) / snapshot.bucketSamples) - snapshot.bucketCount + 1 : 0;
      const bucketSamples = snapshot.rolling ? snapshot.bucketSamples : snapshot.captureSampleCount / snapshot.bucketCount;
      const endSample = snapshot.rolling ? snapshot.endSample : snapshot.captureSampleCount;
      target.fillStyle = '#fff'; // theme-allow: Alpha mask; scopePaint applies the themed trace color with source-in.
      let previousTop, previousBottom;
      const valueAt = position => {
        const sample = Math.max(firstBucket, Math.min(endSample - 1, position));
        const index = Math.floor(sample) - firstBucket;
        const next = Math.min(index + 1, snapshot.bucketCount - 1);
        return snapshot.extrema[index * 2] + (snapshot.extrema[next * 2] - snapshot.extrema[index * 2]) * (sample - Math.floor(sample));
      };
      for (let x = Math.max(0, from - 1); x < to; x++) {
        const start = origin + x * samplesPerPixel;
        const end = Math.min(start + samplesPerPixel, endSample);
        if (end <= firstBucket * bucketSamples || start >= endSample) continue;
        const first = Math.max(0, Math.floor(start / bucketSamples) - firstBucket);
        const last = Math.min(snapshot.bucketCount - 1, Math.ceil(end / bucketSamples) - firstBucket - 1);
        let minimum = Infinity, maximum = -Infinity;
        if (bucketSamples === 1 && samplesPerPixel < 1) {
          const a = valueAt(start), b = valueAt(end);
          minimum = Math.min(a, b);
          maximum = Math.max(a, b);
        } else {
          for (let bucket = first; bucket <= last; bucket++) {
            minimum = Math.min(minimum, snapshot.extrema[bucket * 2]);
            maximum = Math.max(maximum, snapshot.extrema[bucket * 2 + 1]);
          }
        }
        const top = geometry.centerY - maximum * scale;
        const bottom = geometry.centerY - minimum * scale;
        // Connect thin ranges while retaining every peak represented by this physical pixel.
        const connectedTop = previousBottom === undefined ? top : Math.min(top, previousBottom);
        const connectedBottom = previousTop === undefined ? bottom : Math.max(bottom, previousTop);
        if (x >= from) target.fillRect(x, connectedTop - geometry.dpr / 2, 1,
          Math.max(1, connectedBottom - connectedTop + geometry.dpr));
        previousTop = top;
        previousBottom = bottom;
      }
    }

    updateRollingRaster(snapshot, geometry) {
      const { width, height, factor, centerY, dpr } = geometry;
      const samplesPerPixel = snapshot.captureSampleCount / width;
      const history = Math.min(snapshot.sampleRate / 10, snapshot.bucketSamples * 4090);
      const rasterWidth = Math.ceil(width + history / samplesPerPixel) + 4;
      const key = [rasterWidth, height, width, factor, centerY, dpr,
        snapshot.sampleRate, snapshot.captureSampleCount, snapshot.bucketSamples].join('|');
      let cache = this.scopeRaster;
      const startColumn = Math.floor(snapshot.endSample / samplesPerPixel) - rasterWidth + 2;
      if (!cache || cache.key !== key || snapshot.endSample < cache.endSample) {
        const canvas = document.createElement('canvas');
        canvas.width = rasterWidth;
        canvas.height = height;
        cache = this.scopeRaster = { key, canvas, ctx: canvas.getContext('2d'),
          startColumn, endSample: 0 };
      }
      if (cache.endSample === snapshot.endSample) return cache;
      const target = cache.ctx;
      const shift = startColumn - cache.startColumn;
      let dirty = 0;
      if (cache.endSample && shift >= 0 && shift < rasterWidth) {
        if (shift) {
          // Copy complete pixels; only the final composition uses a fractional scroll offset.
          target.save();
          target.globalCompositeOperation = 'copy';
          target.drawImage(cache.canvas, -shift, 0);
          target.restore();
        }
        const partialStart = Math.floor((cache.endSample - 1) / snapshot.bucketSamples) * snapshot.bucketSamples;
        dirty = Math.max(0, Math.floor(partialStart / samplesPerPixel) - startColumn - Math.ceil(dpr) - 1);
      }
      cache.startColumn = startColumn;
      target.clearRect(dirty, 0, rasterWidth - dirty, height);
      this.paintEnvelopeColumns(target, snapshot, startColumn * samplesPerPixel,
        samplesPerPixel, dirty, rasterWidth, geometry);
      cache.endSample = snapshot.endSample;
      return cache;
    }
  
    // ---------------------------
    // onMessage: Receive messages from the Audio Worklet.
    // ---------------------------
    onMessage(message) {
      this.ensureDspTelemetrySubscription();
      if (message.type === 'processBuffer' && message.measurements?.scopeSnapshot && this.enabled) {
        this.acceptScopeSnapshot(message.measurements.scopeSnapshot);
      }
    }

    handleIntersect(entries) {
      entries.forEach(entry => {
            this.isVisible = entry.isIntersecting;
            if (this.isVisible) {
                if (this.canRunAnimation()) this.startAnimation();
                else this.renderPowerUiOnce(() => this.drawWaveform());
            } else {
              this.stopAnimation();
          }
      });
    }

    startAnimation() {
        if (this.animationFrameId) return;
        if (!this.enabled || !this._sectionEnabled) return; // Skip if disabled or section is off.

        const animate = now => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawWaveform(now);
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
        };
        animate(performance.now());
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    // ---------------------------
    // drawWaveform: Render grid and waveform.
    //
    // Draw detailed captures as a line and long windows as a filled min/max envelope.
    // Until a frozen snapshot is available, only the grid is drawn.
    // ---------------------------
    drawWaveform(now = performance.now()) {
      const { canvas } = this;
      let ctx = this.ctx;
      const output = ctx;
      const { width, height } = canvas;
      const options = this.displayOptions;
      const theme = role => options?.themePalette?.get(role) ?? window.ThemePalette?.get(role) ?? '';
      const label = (text, x, y) => (options?.textContext || ctx).fillText(text, x, y);
      const showAxes = options?.showAxes !== false;
      const showAxisNumbers = options?.showAxisNumbers !== false;
      const dpr = this.graphDpr || 1;
      const isNarrow = this.graphCssWidth < 500;
      const leftMargin = showAxisNumbers ? (isNarrow ? 52 : 80) * dpr : 0;
      const factor = 1 / Math.pow(10, this.displayLevel / 20);
      const centerY = height / 2 - (this.verticalOffset * height / 2);

      const snapshot = this.scopeSnapshot;
      const displayEnd = snapshot?.rolling ? this.scopeDisplayEnd(now) : snapshot?.captureSampleCount;
      const transform = ctx.getTransform();
      const gridKey = [width, height, this.displayTime, this.displayLevel, this.verticalOffset,
        dpr, isNarrow, showAxes, showAxisNumbers, options?.transparent,
        ...['graph-bg-deep', 'graph-grid-subtle', 'graph-label', 'text-primary'].map(theme),
        transform.a, transform.b, transform.c, transform.d, transform.e, transform.f].join('|');
      const traceColor = theme('graph-trace');
      const drawn = this.scopeDrawn;
      if (!options?.drawSignal && drawn?.canvas === canvas && drawn.snapshot === snapshot && drawn.end === displayEnd &&
          drawn.gridKey === gridKey && drawn.traceColor === traceColor) return false;
      this.scopeDrawn = { canvas, snapshot, end: displayEnd, gridKey, traceColor };

      // Axes, labels, and the background are independent of the scrolling signal.
      if (this.scopeGrid?.key !== gridKey) {
        const grid = document.createElement('canvas');
        grid.width = width;
        grid.height = height;
        this.scopeGrid = { key: gridKey, canvas: grid };
        ctx = grid.getContext('2d');
        ctx.setTransform(transform);
        this.ctx = ctx;

        // Clear the canvas.
        if (options?.transparent) ctx.clearRect(0, 0, width, height);
        else {
          ctx.fillStyle = theme('graph-bg-deep');
          ctx.fillRect(0, 0, width, height);
        }

        // ---------------------------
        // Draw vertical grid and amplitude scale based on visible amplitude range.
        // ---------------------------
        if (showAxes || showAxisNumbers) {
          ctx.strokeStyle = theme('graph-grid-subtle');
          ctx.lineWidth = dpr;
          const tickFontSize = (isNarrow ? 11 : 12) * dpr;
          ctx.font = `${tickFontSize}px Arial`;
          ctx.textAlign = 'right';
          ctx.fillStyle = theme('graph-label');
          ctx.textBaseline = 'middle';

          // Compute visible amplitude range based on the mapping:
          // y = centerY - (amp * factor) * (height/2)
          // => amp = (centerY - y) / ((height/2) * factor)
          const ampTop = centerY / ((height / 2) * factor);         // amplitude corresponding to y=0 (top)
          const ampBottom = (centerY - height) / ((height / 2) * factor); // amplitude corresponding to y=height (bottom)
          const visibleAmpMin = Math.min(ampTop, ampBottom);
          const visibleAmpMax = Math.max(ampTop, ampBottom);

          const desiredTickCount = isNarrow ? 8 : 20;
          const visibleAmpRange = visibleAmpMax - visibleAmpMin;
          const rawStep = visibleAmpRange / desiredTickCount;
          const exponent = Math.floor(Math.log10(rawStep));
          const fraction = rawStep / Math.pow(10, exponent);
          let niceFraction;
          if (fraction < 1.5) {
            niceFraction = 1;
          } else if (fraction < 3) {
            niceFraction = 2;
          } else if (fraction < 7) {
            niceFraction = 5;
          } else {
            niceFraction = 10;
          }
          const tickStep = niceFraction * Math.pow(10, exponent);

          // Calculate starting and ending tick values within the visible amplitude range.
          const tickStart = Math.ceil(visibleAmpMin / tickStep) * tickStep;
          const tickEnd = Math.floor(visibleAmpMax / tickStep) * tickStep;

          // Number of decimals for label formatting.
          const decimals = exponent < 0 ? -exponent : 0;

          // Define a margin (in pixels) so that text drawn too near the top or bottom is omitted.
          const textMargin = tickFontSize * 0.55;

          for (let tick = tickStart; tick <= tickEnd + tickStep * 0.5; tick += tickStep) {
            const y = centerY - (tick * factor) * (height / 2);
            if (showAxes) {
              ctx.beginPath();
              ctx.moveTo(0, y);
              ctx.lineTo(width, y);
              ctx.stroke();
            }
            // Only draw text if it does not overlap the top or bottom edge.
            if (showAxisNumbers && y - textMargin >= 0 && y + textMargin <= height) {
              label(tick.toFixed(decimals), leftMargin - (16 * dpr), y);
            }
          }

          // ---------------------------
          // Draw horizontal grid and time scale.
          // ---------------------------
          ctx.strokeStyle = theme('graph-grid-subtle');
          ctx.lineWidth = dpr;
          const timeDivisions = isNarrow ? 5 : 10;
          for (let i = 0; i <= timeDivisions; i++) {
            const x = leftMargin + ((width - leftMargin) * i) / timeDivisions;
            if (showAxes) {
              ctx.beginPath();
              ctx.moveTo(x, 0);
              ctx.lineTo(x, height);
              ctx.stroke();
            }
            if (showAxisNumbers && i !== 0 && i !== timeDivisions) {
              ctx.fillStyle = theme('graph-label');
              ctx.font = `${tickFontSize}px Arial`;
              ctx.textAlign = 'center';
              const seconds = this.displayTime >= 1;
              const time = (i / timeDivisions) * this.displayTime * (seconds ? 1 : 1000);
              label(time.toFixed(2) + (seconds ? ' s' : ' ms'), x, height - ((isNarrow ? 30 : 40) * dpr));
            }
          }

          // Draw axis labels.
          if (showAxisNumbers) {
            ctx.fillStyle = theme('text-primary');
            ctx.font = `${(isNarrow ? 12 : 14) * dpr}px Arial`;
            ctx.textAlign = 'center';
            label(this.displayTime >= 1 ? 'Time (s)' : 'Time (ms)',
              leftMargin + (width - leftMargin) / 2, height - (10 * dpr));
            ctx.save();
            ctx.translate((isNarrow ? 16 : 20) * dpr, height / 2);
            ctx.rotate(-Math.PI / 2);
            label('Amplitude', 0, 0);
            ctx.restore();
          }
        }

        this.ctx = output;
      }
      ctx = output;
      ctx.save();
      ctx.resetTransform();
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(this.scopeGrid.canvas, 0, 0);
      ctx.restore();

      // ---------------------------
      // Draw the waveform if a frozen snapshot is available.
      // ---------------------------
      const displayBuffer = this.scopeSnapshot?.values || this.frozenDisplayBuffer;
      const sampleIndices = this.scopeSnapshot?.sampleIndices;
      const sampleCount = this.scopeSnapshot?.captureSampleCount || displayBuffer?.length;
      const denominator = sampleCount > 1 ? sampleCount - 1 : 1;
      const firstBucket = snapshot?.rolling
        ? Math.floor((snapshot.endSample - 1) / snapshot.bucketSamples) - snapshot.bucketCount + 1 : 0;
      const plotWidth = width - leftMargin;
      let signalRaster, signalOffset = 0;
      if (snapshot?.extrema) {
        if (plotWidth > 0) {
          const geometry = { width: plotWidth, height, factor, centerY, dpr };
          if (snapshot.rolling) {
            signalRaster = this.updateRollingRaster(snapshot, geometry);
            signalOffset = signalRaster.startColumn - (displayEnd - sampleCount) / (sampleCount / plotWidth);
          } else {
            const key = ['capture', plotWidth, height, factor, centerY, dpr].join('|');
            if (this.scopeRaster?.key !== key || this.scopeRaster.snapshot !== snapshot) {
              const mask = document.createElement('canvas');
              mask.width = Math.ceil(plotWidth);
              mask.height = height;
              this.paintEnvelopeColumns(mask.getContext('2d'), snapshot, 0,
                sampleCount / plotWidth, 0, mask.width, geometry);
              this.scopeRaster = { key, canvas: mask, snapshot };
            }
            signalRaster = this.scopeRaster;
          }
        }
      } else if (displayBuffer && plotWidth > 0) {
        const key = ['trace', plotWidth, height, factor, centerY, dpr].join('|');
        if (this.scopeRaster?.key !== key || this.scopeRaster.values !== displayBuffer) {
          const mask = document.createElement('canvas');
          mask.width = Math.ceil(plotWidth);
          mask.height = height;
          const target = mask.getContext('2d');
          target.strokeStyle = '#fff'; // theme-allow: Alpha mask; scopePaint applies the themed trace color with source-in.
          target.lineWidth = 2 * dpr;
          target.beginPath();
          for (let i = 0; i < displayBuffer.length; i++) {
            const sampleIndex = sampleIndices ? sampleIndices[i] : i;
            const x = (sampleIndex / denominator) * plotWidth;
            const sample = displayBuffer[i];
            const y = centerY - (sample * factor) * (height / 2);
            if (i === 0) {
              target.moveTo(x, y);
            } else {
              target.lineTo(x, y);
            }
          }
          target.stroke();
          this.scopeRaster = { key, canvas: mask, values: displayBuffer };
        }
        signalRaster = this.scopeRaster;
      }
      if (signalRaster) {
        this.scopePaint ||= document.createElement('canvas');
        if (this.scopePaint.width !== width) this.scopePaint.width = width;
        if (this.scopePaint.height !== height) this.scopePaint.height = height;
        const paint = this.scopePaint.getContext('2d');
        paint.clearRect(0, 0, width, height);
        paint.drawImage(signalRaster.canvas, leftMargin + signalOffset, 0);
        paint.globalCompositeOperation = 'source-in';
        paint.fillStyle = options?.traceStyle?.(paint) ?? traceColor;
        paint.fillRect(leftMargin, 0, plotWidth, height);
        paint.globalCompositeOperation = 'source-over';
        const draw = target => target.drawImage(this.scopePaint, 0, 0);
        if (options?.drawSignal) options.drawSignal(ctx, draw);
        else draw(ctx);
      }

      // Keep the drawn mapping for the cursor readout.
      const frame = (this._readoutFrame ??= {});
      frame.left = leftMargin;
      frame.width = width - leftMargin;
      frame.height = height;
      frame.centerY = centerY;
      frame.factor = factor;
      frame.displayTimeMs = this.displayTime * 1000;
      frame.values = displayBuffer;
      frame.sampleIndices = sampleIndices;
      frame.denominator = denominator;
      frame.snapshot = snapshot;
      frame.displayEnd = displayEnd;
      frame.firstBucket = firstBucket;
      this._graphReadout?.refresh();
      return true;
    }

    // Reads the drawn waveform at canvas pixel x, interpolating between plotted points.
    _readWaveform(x) {
      const frame = this._readoutFrame;
      if (!frame || frame.width <= 0) return null;
      const { format, seriesValueAt, columnValueAt } = window.GraphReadout;
      const { left, width, values, sampleIndices, denominator } = frame;
      if (frame.snapshot?.extrema) {
        const snapshot = frame.snapshot;
        const position = Math.min(snapshot.captureSampleCount - 1,
          (x - left) / width * snapshot.captureSampleCount);
        const bucket = snapshot.rolling
          ? Math.floor((frame.displayEnd - snapshot.captureSampleCount + position) / snapshot.bucketSamples) - frame.firstBucket
          : Math.floor(position / snapshot.captureSampleCount * snapshot.bucketCount);
        const rows = ['Minimum', 'Maximum'].map((label, index) => {
          const value = bucket >= 0 && bucket < snapshot.bucketCount ? snapshot.extrema[bucket * 2 + index] : NaN;
          return { label, color: 'var(--et-graph-trace)', value: format.number(value, 3),
            y: Number.isFinite(value) ? frame.centerY - value * frame.factor * frame.height / 2 : undefined };
        });
        return { cursor: format.time((x - left) / width * frame.displayTimeMs), rows };
      }
      const position = (x - left) / width * denominator;
      const row = { label: 'Amplitude', color: 'var(--et-graph-trace)', value: format.number(NaN) };
      const sample = !values ? null
        : sampleIndices ? seriesValueAt(sampleIndices, values, position)
        : columnValueAt(values, position);
      if (sample !== null) {
        row.value = format.number(sample, 3);
        row.y = frame.centerY - sample * frame.factor * frame.height / 2;
      }
      return { cursor: format.time((x - left) / width * frame.displayTimeMs), rows: [row] };
    }

    // ---------------------------
    // cleanup: Cancel the animation and remove event listeners.
    // ---------------------------
    cleanup() {
      this.disposeDspTelemetrySubscription();
      this.stopAnimation();
      if (this.observer) {
        if (this.canvas) {
          this.observer.unobserve(this.canvas);
        }
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.resizeGraphDisposer) {
        this.resizeGraphDisposer();
        this.resizeGraphDisposer = null;
      }
      for (const [element, listener] of this.boundEventListeners) {
        element.removeEventListener('change', listener);
        element.removeEventListener('input', listener);
      }
      this.boundEventListeners.clear();
      this.clearBuffer();
      this.canvas = null;
      this.ctx = null;
      super.cleanup();
    }
  }
  
  // Register plugin globally (for browser environments)
  if (typeof window !== 'undefined') {
    window.OscilloscopePlugin = OscilloscopePlugin;
  }
