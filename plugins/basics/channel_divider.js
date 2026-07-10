// Channel Divider Plugin implementation
// Divides input channels into frequency bands, routing them to separate output channels.
// Reads channels 1-2, splits into 2-4 bands, routes each band to separate output channels.
const CHANNEL_DIVIDER_CHANNEL_COUNT_FRAME = 9;
const CHANNEL_DIVIDER_TELEMETRY_VERSION = 1;
const CHANNEL_DIVIDER_CHANNEL_COUNT_BYTES = 4;

class ChannelDividerPlugin extends PluginBase {
  constructor() {
    super("Channel Divider", "Split stereo signal into frequency bands and route to separate channels");

    this.bc = 2; // Band count (2, 3, or 4)
    this.f1 = 2000; // Crossover frequency 1 (Hz)
    this.s1 = -24; // Slope 1 (dB/oct)
    this.f2 = 4000; // Crossover frequency 2 (Hz)
    this.s2 = -24; // Slope 2 (dB/oct)
    this.f3 = 8000; // Crossover frequency 3 (Hz)
    this.s3 = -24; // Slope 3 (dB/oct)

    this.errorState = null;
    this.maxBands = 2; // Max bands allowed by bus config
    this._dspTelemetryHub = null;
    this._dspTelemetryTapId = null;
    this._dspTelemetryUnsubscribe = null;
    this._boundDspChannelCountTelemetry = frame => this.handleDspChannelCountTelemetry(frame);

    this.registerProcessor(`
      // Audio processing logic
      // Parameters: data, parameters, context, tools
      if (!parameters.enabled) return data;
    
      const { channelCount, blockSize, sampleRate } = parameters;
      data.measurements = { channels: channelCount };
    
      if (channelCount < 4 || channelCount % 2 !== 0) {
        return data;
      }
    
      const currentMaxBands = channelCount / 2;
      let bandCount = Math.min(parameters.bc, currentMaxBands);
      if (channelCount === 4 && bandCount > 2) bandCount = 2;
      else if (channelCount === 6 && bandCount > 3) bandCount = 3;
    
      const frequencies = [parameters.f1, parameters.f2, parameters.f3];
      const slopes = [parameters.s1, parameters.s2, parameters.s3];
    
      // --- Filter Coefficient Calculation (must be done first to determine section counts) ---
      // Strict Linkwitz-Riley implementation: Butterworth_N cascaded twice
      let needsReset = !context.filterStates || !context.filterConfig ||
                       context.filterConfig.sampleRate !== sampleRate ||
                       context.filterConfig.channelCount !== channelCount ||
                       context.filterConfig.bandCount !== bandCount ||
                       context.filterConfig.frequencies[0] !== frequencies[0] ||
                       context.filterConfig.frequencies[1] !== frequencies[1] ||
                       context.filterConfig.frequencies[2] !== frequencies[2] ||
                       context.filterConfig.slopes[0] !== slopes[0] ||
                       context.filterConfig.slopes[1] !== slopes[1] ||
                       context.filterConfig.slopes[2] !== slopes[2];
    
      if (needsReset || !context.cachedCoeffs) {
        // Helper functions for Linkwitz-Riley design
        function computeButterworthQs(N) {
          const Qs = [];
          const pairs = Math.floor(N / 2);
          for (let k = 1; k <= pairs; ++k) {
            const theta = (2 * k - 1) * Math.PI / (2 * N);
            const zeta = Math.sin(theta);
            const Q = 1 / (2 * zeta);
            Qs.push(Q);
          }
          return Qs;
        }
        
        function designFirstOrderButterworth(fs, fc, type) {
          if (fc <= 0 || fc >= fs * 0.5) return null;
          const K = 2 * fs;
          const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
          const Om = warped;
          const a0 = K + Om;
          const a1 = Om - K;
          let b0, b1;
          if (type === "lp") {
            b0 = Om;
            b1 = Om;
          } else {
            b0 = -K;
            b1 = K;
          }
          return { b0: b0 / a0, b1: b1 / a0, b2: 0, a1: a1 / a0, a2: 0 };
        }
        
        function designSecondOrderButterworth(fs, fc, Q, type) {
          if (fc <= 0 || fc >= fs * 0.5) return null;
          const K = 2 * fs;
          const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
          const Om = warped;
          const K2 = K * K;
          const Om2 = Om * Om;
          const K2Q = K2 * Q;
          const Om2Q = Om2 * Q;
          const a0 = K2Q + K * Om + Om2Q;
          const a1 = -2 * K2Q + 2 * Om2Q;
          const a2 = K2Q - K * Om + Om2Q;
          let b0, b1, b2;
          if (type === "lp") {
            b0 = Om2Q;
            b1 = 2 * Om2Q;
            b2 = Om2Q;
          } else {
            b0 = K2Q;
            b1 = -2 * K2Q;
            b2 = K2Q;
          }
          return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
        }
        
        function designButterworthSections(fs, fc, N, type) {
          if (!Number.isFinite(N) || N <= 0) return [];
          const sections = [];
          const isOdd = (N % 2) !== 0;
          if (isOdd) {
            const sec1 = designFirstOrderButterworth(fs, fc, type);
            if (sec1) sections.push(sec1);
          }
          const Qs = computeButterworthQs(N);
          for (const Q of Qs) {
            const sec2 = designSecondOrderButterworth(fs, fc, Q, type);
            if (sec2) sections.push(sec2);
          }
          return sections;
        }
        
        function designLinkwitzRileySections(fs, fc, slope, type) {
          if (slope === 0 || fc <= 0) return [];
          const absSlope = Math.abs(slope);
          if (absSlope % 12 !== 0) return [];
          const N = absSlope / 12;
          if (type !== "lp" && type !== "hp") return [];
          const butter = designButterworthSections(fs, fc, N, type);
          if (!butter.length) return [];
          // LR: Butterworth_N cascaded twice
          const lr = butter.slice();
          for (let i = 0; i < butter.length; ++i) {
            const s = butter[i];
            lr.push({ b0: s.b0, b1: s.b1, b2: s.b2, a1: s.a1, a2: s.a2 });
          }
          return lr;
        }
        
        context.cachedCoeffs = [];
        for (let i = 0; i < 3; i++) {
          if (i >= bandCount - 1) {
            context.cachedCoeffs[i] = null;
            continue;
          }
          
          const freq = frequencies[i];
          const clampedFreq = Math.max(10.0, Math.min(freq, sampleRate * 0.499));
          const slope = slopes[i];
          
          const lpSections = designLinkwitzRileySections(sampleRate, clampedFreq, Math.abs(slope), "lp");
          const hpSections = designLinkwitzRileySections(sampleRate, clampedFreq, Math.abs(slope), "hp");
          
          context.cachedCoeffs[i] = {
            lp: lpSections,
            hp: hpSections
          };
        }
        
        // Initialize filter states based on actual section counts
        if (needsReset) {
          const dcOffset = 1e-25;
          
          const createSingleBiquadStateAndInit = () => {
            const state = { x1: new Float32Array(2), x2: new Float32Array(2), y1: new Float32Array(2), y2: new Float32Array(2) };
            for (let ch = 0; ch < 2; ch++) {
              state.x1[ch] = dcOffset; state.x2[ch] = -dcOffset;
              state.y1[ch] = dcOffset; state.y2[ch] = -dcOffset;
            }
            return state;
          };
          
          context.filterStates = { lp: [], hp: [] };
          for (let i = 0; i < 3; i++) {
            if (i >= bandCount - 1) {
              context.filterStates.lp.push([]);
              context.filterStates.hp.push([]);
              continue;
            }
            
            const lpStates = [];
            const hpStates = [];
            if (context.cachedCoeffs[i]) {
              for (let j = 0; j < context.cachedCoeffs[i].lp.length; j++) {
                lpStates.push(createSingleBiquadStateAndInit());
              }
              for (let j = 0; j < context.cachedCoeffs[i].hp.length; j++) {
                hpStates.push(createSingleBiquadStateAndInit());
              }
            }
            context.filterStates.lp.push(lpStates);
            context.filterStates.hp.push(hpStates);
          }
          
          context.filterConfig = {
            sampleRate, channelCount, bandCount,
            frequencies: [...frequencies],
            slopes: [...slopes]
          };
          
          context.fadeIn = {
            counter: 0,
            length: Math.min(blockSize, Math.ceil(sampleRate * 0.005))
          };
          
          // Allocate pingPongBuffer for multi-stage filtering
          // Stereo processing, so blockSize * 2
          if (!context.pingPongBuffer || context.pingPongBuffer.length !== blockSize * 2) {
            context.pingPongBuffer = new Float32Array(blockSize * 2);
          }
        }
      }
    
      // --- Buffer Management ---
      const requiredTempBufferSize = blockSize * 2; // Stereo
      if (!context.tempBuffers || context.tempBuffers[0].length !== requiredTempBufferSize) {
        context.tempBuffers = [
          new Float32Array(requiredTempBufferSize), // inputCopy
          new Float32Array(requiredTempBufferSize), // temp1 (can be final output or intermediate)
          new Float32Array(requiredTempBufferSize)  // temp2 (can be final output or intermediate)
        ];
      }
      const [inputCopy, temp1, temp2] = context.tempBuffers;
    
      // --- Audio Processing ---
      for (let ch = 0; ch < 2; ++ch) {
        inputCopy.set(data.subarray(ch * blockSize, (ch + 1) * blockSize), ch * blockSize);
      }
      for (let ch = 0; ch < channelCount; ++ch) {
        data.fill(0, ch * blockSize, (ch + 1) * blockSize);
      }
      
      // Helper function to apply a single biquad filter stage to both L/R channels
      function applySingleBiquadStereo(inputStereoBuf, outputStereoBuf, currentBlockSize, coeffs, biquadState) {
        const { b0, b1, b2, a1, a2 } = coeffs;
        for (let ch = 0; ch < 2; ++ch) {
            let x1 = biquadState.x1[ch], x2 = biquadState.x2[ch], 
                y1 = biquadState.y1[ch], y2 = biquadState.y2[ch];
    
            const inChOffset = ch * currentBlockSize;
            const outChOffset = ch * currentBlockSize;
    
            for (let i = 0; i < currentBlockSize; ++i) {
              const sample = inputStereoBuf[inChOffset + i];
              // Denormal check / small noise add might be useful here if issues arise
              // let filteredSample = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2 + Number.EPSILON;
              let filteredSample = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
              x2 = x1; x1 = sample;
              y2 = y1; y1 = filteredSample;
              outputStereoBuf[outChOffset + i] = filteredSample;
            }
            biquadState.x1[ch] = x1; biquadState.x2[ch] = x2;
            biquadState.y1[ch] = y1; biquadState.y2[ch] = y2;
        }
      }
    
      // Applies cascaded biquad filters with different coefficients for each section.
      // coeffsArray: array of coefficient objects, one per section
      // biquadStatesArray: array of state objects, one per section
      function applyMultiBiquadFilter(inputStereoSignal, finalOutputStereoSignal, coeffsArray, biquadStatesArray) {
        if (!coeffsArray || coeffsArray.length === 0) {
          if (inputStereoSignal !== finalOutputStereoSignal) {
            finalOutputStereoSignal.set(inputStereoSignal);
          }
          return;
        }
        
        const numSections = coeffsArray.length;
        if (numSections === 0) {
          if (inputStereoSignal !== finalOutputStereoSignal) {
            finalOutputStereoSignal.set(inputStereoSignal);
          }
          return;
        }
        
        let bufferIn = inputStereoSignal;
        let bufferOut = (numSections === 1) ? finalOutputStereoSignal : context.pingPongBuffer;
        
        for (let stageIdx = 0; stageIdx < numSections; ++stageIdx) {
          if (stageIdx === numSections - 1) {
            bufferOut = finalOutputStereoSignal;
          }
          
          applySingleBiquadStereo(bufferIn, bufferOut, blockSize, coeffsArray[stageIdx], biquadStatesArray[stageIdx]);
          
          if (stageIdx < numSections - 1) {
            bufferIn = bufferOut;
            if (stageIdx < numSections - 2) {
              bufferOut = (bufferIn === finalOutputStereoSignal) ? context.pingPongBuffer : finalOutputStereoSignal;
            } else {
              bufferOut = finalOutputStereoSignal;
            }
          }
        }
      }
    
      function copyToOutput(sourceBuffer, outputChannelStart) {
        for (let ch = 0; ch < 2; ++ch) {
          data.set(sourceBuffer.subarray(ch * blockSize, (ch + 1) * blockSize), (outputChannelStart + ch) * blockSize);
        }
      }
    
      // --- Main Processing Logic ---
      // Apply Linkwitz-Riley filters with multiple sections per crossover
      
      if (bandCount === 2) {
        applyMultiBiquadFilter(inputCopy, temp1, context.cachedCoeffs[0].lp, context.filterStates.lp[0]);
        applyMultiBiquadFilter(inputCopy, temp2, context.cachedCoeffs[0].hp, context.filterStates.hp[0]);
        
        copyToOutput(temp1, 0);
        copyToOutput(temp2, 2);
      } else if (bandCount === 3) {
        applyMultiBiquadFilter(inputCopy, temp1, context.cachedCoeffs[0].lp, context.filterStates.lp[0]); // Lows in temp1
        applyMultiBiquadFilter(inputCopy, temp2, context.cachedCoeffs[0].hp, context.filterStates.hp[0]); // Mid+High in temp2
        copyToOutput(temp1, 0);
        
        // temp2 (Mid+High) is now input. Result for Mids in temp1.
        applyMultiBiquadFilter(temp2, temp1, context.cachedCoeffs[1].lp, context.filterStates.lp[1]); // Mids in temp1
        // temp2 (Mid+High input) is processed again for Highs. Result for Highs in temp2.
        applyMultiBiquadFilter(temp2, temp2, context.cachedCoeffs[1].hp, context.filterStates.hp[1]); // Highs in temp2
        copyToOutput(temp1, 2);
        copyToOutput(temp2, 4);
      } else if (bandCount === 4) {
        applyMultiBiquadFilter(inputCopy, temp1, context.cachedCoeffs[0].lp, context.filterStates.lp[0]); // Lows in temp1
        applyMultiBiquadFilter(inputCopy, temp2, context.cachedCoeffs[0].hp, context.filterStates.hp[0]); // MidLow+MidHigh+High in temp2
        copyToOutput(temp1, 0);
        
        // temp2 is input. MidLows in temp1. MidHigh+High overwrites temp2.
        applyMultiBiquadFilter(temp2, temp1, context.cachedCoeffs[1].lp, context.filterStates.lp[1]); // MidLows in temp1
        applyMultiBiquadFilter(temp2, temp2, context.cachedCoeffs[1].hp, context.filterStates.hp[1]); // MidHigh+High in temp2
        copyToOutput(temp1, 2);
    
        // temp2 (MidHigh+High) is input. MidHighs in temp1. Highs overwrites temp2.
        applyMultiBiquadFilter(temp2, temp1, context.cachedCoeffs[2].lp, context.filterStates.lp[2]); // MidHighs in temp1
        applyMultiBiquadFilter(temp2, temp2, context.cachedCoeffs[2].hp, context.filterStates.hp[2]); // Highs in temp2
        copyToOutput(temp1, 4);
        copyToOutput(temp2, 6);
      }
      
      if (context.fadeIn && context.fadeIn.counter < context.fadeIn.length) {
        const fadeLength = context.fadeIn.length;
        let counter = context.fadeIn.counter;
        for (let i = 0; i < blockSize; ++i) {
          if (counter >= fadeLength) break;
          const gain = counter / fadeLength;
          for (let ch = 0; ch < channelCount; ++ch) {
            data[ch * blockSize + i] *= gain;
          }
          counter++;
        }
        context.fadeIn.counter = counter;
        if (context.fadeIn.counter >= fadeLength) {
            context.fadeIn = null;
        }
      }
      return data;
    `);
  }

  getParameters() {
    this.ensureDspTelemetrySubscription();
    return {
      type: this.constructor.name, enabled: this.enabled,
      bc: this.bc, f1: this.f1, s1: this.s1,
      f2: this.f2, s2: this.s2, f3: this.f3, s3: this.s3,
    };
  }

  setParameters(params) {
    let needsUpdate = false;
    const p = this.getParameters(); // Current parameters

    if (params.enabled !== undefined && params.enabled !== p.enabled) {
      this.enabled = !!params.enabled;
      needsUpdate = true;
    }
    if (params.bc !== undefined && params.bc !== p.bc) {
      const bandCount = parseInt(params.bc);
      if ([2, 3, 4].includes(bandCount)) {
        this.bc = bandCount;
        needsUpdate = true;
      }
    }

    // Handle frequencies with ordering F1 < F2 < F3
    let { f1, f2, f3 } = this;
    let f1Changed = false, f2Changed = false, f3Changed = false;

    if (params.f1 !== undefined && params.f1 !== p.f1) {
        const val = Math.max(10, Math.min(40000, parseFloat(params.f1)));
        if (!isNaN(val)) { f1 = val; f1Changed = true; }
    }
    if (params.f2 !== undefined && params.f2 !== p.f2) {
        const val = Math.max(10, Math.min(40000, parseFloat(params.f2)));
        if (!isNaN(val)) { f2 = val; f2Changed = true; }
    }
    if (params.f3 !== undefined && params.f3 !== p.f3) {
        const val = Math.max(10, Math.min(40000, parseFloat(params.f3)));
        if (!isNaN(val)) { f3 = val; f3Changed = true; }
    }

    if (f1Changed || f2Changed || f3Changed) {
        if (f2 <= f1) f2 = f1 + 1;
        if (f3 <= f2) f3 = f2 + 1;
        if (f1 >= f2) f1 = f2 - 1;

        const minSeparation = 1; 
        if (this.bc >= 2) {
            if (this.bc >=3) { 
                f1 = Math.min(f1, f2 - minSeparation);
                if (this.bc >= 4) { 
                     f2 = Math.min(f2, f3 - minSeparation);
                     f2 = Math.max(f2, f1 + minSeparation); 
                     f3 = Math.max(f3, f2 + minSeparation); 
                } else { 
                    f2 = Math.max(f2, f1 + minSeparation);
                }
            }
        }
        this.f1 = Math.max(10, Math.min(40000, f1));
        this.f2 = Math.max(10, Math.min(40000, f2));
        this.f3 = Math.max(10, Math.min(40000, f3));
        needsUpdate = true;
    }


    const allowedSlopes = [-12, -24, -36, -48, -60, -72, -84, -96];
    if (params.s1 !== undefined && params.s1 !== p.s1 && allowedSlopes.includes(parseInt(params.s1))) {
      this.s1 = parseInt(params.s1); needsUpdate = true;
    }
    if (params.s2 !== undefined && params.s2 !== p.s2 && allowedSlopes.includes(parseInt(params.s2))) {
      this.s2 = parseInt(params.s2); needsUpdate = true;
    }
    if (params.s3 !== undefined && params.s3 !== p.s3 && allowedSlopes.includes(parseInt(params.s3))) {
      this.s3 = parseInt(params.s3); needsUpdate = true;
    }

    if (needsUpdate) {
      this.updateParameters(); 
      this.updateErrorState();
      this.updateCrossoverControls();
      if (this.canvas) this.drawGraph();
    }
  }

  updateErrorState() { /* Handled by onMessage, kept for compatibility */ }

  _updateErrorUI() {
    if (!this.errorEl) return;
    this.errorEl.textContent = this.errorState || "";
    this.errorEl.style.display = this.errorState ? 'block' : 'none';
  }

  _getCanvasDpr(canvas) {
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const cssWidth = canvas.clientWidth || (rect && rect.width) || canvas.width || 1;
    return canvas.width / cssWidth;
  }

  _updateBandOptions() {
    if (!this.bandRadios) return;
    this.bandRadios.forEach((radio, index) => {
      const bandCountValue = index + 2;
      radio.style.opacity = (bandCountValue <= this.maxBands) ? "1" : "0.5";
    });
  }

  createUI() {
    const frag = document.createDocumentFragment();

    this.errorEl = document.createElement("div");
    this.errorEl.className = "error-banner";
    Object.assign(this.errorEl.style, { display: "none", padding: "5px", marginBottom: "10px", color: "#ff0000", backgroundColor: "rgba(255,0,0,0.1)" });
    frag.appendChild(this.errorEl);

    const bandRow = this._createRow("Band Count:");
    const radioGroup = document.createElement("div");
    radioGroup.className = "radio-group";
    Object.assign(radioGroup.style, { display: "flex", gap: "10px", alignItems: "center" });
    this.bandRadios = [];
    [2, 3, 4].forEach(bcValue => {
      const radioOption = document.createElement("div");
      Object.assign(radioOption.style, { display: "flex", alignItems: "center" });
      const id = `${this.id}-band-${bcValue}`;
      const radio = this._createInput("radio", id, bcValue, radioOption);
      radio.name = `${this.id}-band-select`;
      radio.checked = this.bc === bcValue;
      radio.onchange = () => { if (radio.checked) this.setParameters({ bc: bcValue }); };
      this.bandRadios.push(radio);
      this._createLabel(id, bcValue.toString(), radioOption, { marginLeft: "5px" });
      radioGroup.appendChild(radioOption);
    });
    bandRow.appendChild(radioGroup);
    frag.appendChild(bandRow);

    const freqContainer = document.createElement("div");
    freqContainer.className = "channel-divider-frequency-sliders";
    this.freq1Slider = this._createFreqControl(freqContainer, "Freq 1", 1, (val) => this.setParameters({ f1: val }), (val) => this.setParameters({ s1: val }), this.f1, this.s1);
    this.freq2Slider = this._createFreqControl(freqContainer, "Freq 2", 2, (val) => this.setParameters({ f2: val }), (val) => this.setParameters({ s2: val }), this.f2, this.s2);
    this.freq3Slider = this._createFreqControl(freqContainer, "Freq 3", 3, (val) => this.setParameters({ f3: val }), (val) => this.setParameters({ s3: val }), this.f3, this.s3);
    frag.appendChild(freqContainer);

    const graphWrap = document.createElement("div");
    graphWrap.className = "channel-divider-graph-container";
    const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
      maxWidth: 600,
      aspectRatio: "5 / 2",
      mobileAspectRatio: "2 / 1",
      className: "channel-divider-graph",
      onResize: () => this.drawGraph()
    });
    canvas.style.backgroundColor = "#222";
    this.canvas = canvas;
    this.graphDispose?.();
    this.graphDispose = dispose;
    graphWrap.appendChild(graphContainer);
    frag.appendChild(graphWrap);
    
    const uiContainer = document.createElement("div");
    uiContainer.className = "channel-divider-plugin-ui plugin-parameter-ui";
    uiContainer.appendChild(frag);

    this.updateCrossoverControls();
    this._updateBandOptions();
    this.drawGraph();
    return uiContainer;
  }

  _createRow(labelTextContent) {
    const row = document.createElement("div");
    row.className = "parameter-row";
    // Apply flex styling for horizontal alignment of label and controls group
    Object.assign(row.style, { display: "flex", alignItems: "center", marginBottom: "8px", gap: "10px"});
    if (labelTextContent) {
      const label = document.createElement("label");
      label.textContent = labelTextContent;
      label.style.flexShrink = "0"; // Prevent label from shrinking
      row.appendChild(label);
    }
    return row;
  }

  _createInput(type, id, value, parent) {
    const input = document.createElement("input");
    input.type = type;
    input.id = id;
    input.name = id; 
    input.autocomplete = "off";
    if (type === "number" || type === "range" || type === "radio") input.value = value;
    if (parent) parent.appendChild(input);
    return input;
  }

  _createLabel(forId, text, parent, style = {}) {
    const label = document.createElement("label");
    label.htmlFor = forId;
    label.textContent = text;
    Object.assign(label.style, style);
    if (parent) parent.appendChild(label);
    return label;
  }

  _createSlopeSelect(currentSlope, onChangeCallback, index) {
    const selectId = `${this.id}-slope-${index}`;
    const select = document.createElement("select");
    select.className = "slope-select";
    select.id = selectId;
    select.name = selectId;
    select.autocomplete = "off";
    select.style.marginLeft = "5px"; // Add some space next to the number input
    [-12, -24, -36, -48, -60, -72, -84, -96].forEach(slope => {
      const option = document.createElement("option");
      option.value = slope;
      option.textContent = `${Math.abs(slope)}dB`; // Shortened text
      option.selected = currentSlope === slope;
      select.appendChild(option);
    });
    select.onchange = (e) => {
        onChangeCallback(parseInt(e.target.value));
        // No direct call to this.drawGraph() here, should be handled by setParameters
    };
    return select;
  }

  _createFreqControl(parent, labelPrefix, index, freqSetter, slopeSetter, currentFreq, currentSlope) {
    const minFreq = 10, maxFreq = 40000;
    const sliderContainer = document.createElement("div");
    sliderContainer.className = `channel-divider-frequency-slider channel-divider-freq-${index}`;
    Object.assign(sliderContainer.style, { marginBottom: "10px" });


    // Top Row: Label, Number Input, and Slope Select
    const topRow = this._createRow(); // _createRow now applies flex
    topRow.classList.add("channel-divider-frequency-slider-top"); // Keep specific class if needed

    this._createLabel(`${this.id}-freq${index}-number`, `${labelPrefix} (Hz):`, topRow, { marginRight: "5px"});
    
    const numberInput = this._createInput("number", `${this.id}-freq${index}-number`, currentFreq, topRow);
    Object.assign(numberInput, { min: minFreq, max: maxFreq, step: 1 });

    // Add Slope Select directly to the topRow, after numberInput
    const slopeSelect = this._createSlopeSelect(currentSlope, (val) => { slopeSetter(val); }, index);
    topRow.appendChild(slopeSelect);
    
    sliderContainer.appendChild(topRow);

    // Middle: Range Slider (Full width below the top row)
    const rangeInput = this._createInput("range", `${this.id}-freq${index}-slider`, this.logToLinear(currentFreq, minFreq, maxFreq), sliderContainer);
    Object.assign(rangeInput, { min: 0, max: 1000, step: 1 });
    rangeInput.style.width = "100%"; // Make slider take full width
    
    sliderContainer.appendChild(rangeInput);
    
    // Event Listeners
    rangeInput.oninput = () => {
      const logValue = Math.round(this.linearToLog(parseFloat(rangeInput.value), minFreq, maxFreq));
      numberInput.value = logValue;
      freqSetter(logValue); // This will trigger setParameters, which handles drawGraph
    };
    numberInput.onchange = () => { 
      let val = parseFloat(numberInput.value) || minFreq;
      val = Math.max(minFreq, Math.min(maxFreq, val));
      numberInput.value = val; 
      rangeInput.value = this.logToLinear(val, minFreq, maxFreq);
      freqSetter(val); // This will trigger setParameters
    };

    parent.appendChild(sliderContainer);
    return sliderContainer;
  }


  updateCrossoverControls() {
    if (!this.freq1Slider || !this.freq2Slider || !this.freq3Slider) return;

    const setControlOpacityAndDisabled = (control, isEnabled) => {
        control.style.opacity = isEnabled ? "1" : "0.5";
        // control.querySelectorAll('input, select').forEach(el => el.disabled = !isEnabled);
    };
    
    setControlOpacityAndDisabled(this.freq1Slider, true);
    setControlOpacityAndDisabled(this.freq2Slider, this.bc >= 3);
    setControlOpacityAndDisabled(this.freq3Slider, this.bc >= 4);

    // No direct call to drawGraph() here, it's handled by setParameters or initial setup
  }

  linearToLog(value, min, max) { 
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    return Math.pow(10, minLog + (maxLog - minLog) * (value / 1000));
  }
  logToLinear(value, min, max) { 
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    if (value <= min) return 0;
    if (value >= max) return 1000;
    return 1000 * (Math.log10(value) - minLog) / (maxLog - minLog);
  }

  drawGraph() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    const { width, height } = this.canvas;
    const dpr = this._getCanvasDpr(this.canvas);
    const cssWidth = width / dpr;
    const tickFont = Math.round(11 * dpr);
    const axisFont = Math.round(13 * dpr);
    const bottomTickY = height - 26 * dpr;
    const axisBottomY = height - 4 * dpr;
    const leftLabelX = 40 * dpr;
    const axisLabelX = 12 * dpr;
    const minFreqLog = Math.log10(10);
    const maxFreqLog = Math.log10(40000);
    const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = (isMobileLayout ? 1 : 0.5) * dpr;
    ctx.font = `${tickFont}px Arial`;

    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const labeledFreqs = cssWidth < 420
      ? [20, 100, 500, 2000, 10000]
      : gridFreqs;
    gridFreqs.forEach(freq => {
      const x = width * (Math.log10(freq) - minFreqLog) / (maxFreqLog - minFreqLog);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      if (labeledFreqs.includes(freq)) {
        ctx.fillStyle = "#666"; ctx.textAlign = "center";
        ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, bottomTickY);
      }
    });

    const dbRange = [-60, 12]; 
    const totalDbSpan = dbRange[1] - dbRange[0];
    const gridDBs = [-60, -48, -36, -24, -12, 0]; 
    gridDBs.forEach(db => {
      const y = height * (1 - (db - dbRange[0]) / totalDbSpan);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      if (db > -60) { 
        ctx.fillStyle = "#666"; ctx.textAlign = "right";
        ctx.fillText(`${db}dB`, leftLabelX, y + 3 * dpr);
      }
    });

    ctx.fillStyle = "#fff"; ctx.font = `${axisFont}px Arial`; ctx.textAlign = "center";
    ctx.fillText("Frequency (Hz)", width / 2, axisBottomY);
    ctx.save();
    ctx.translate(axisLabelX, height / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("Level (dB)", 0, 0);
    ctx.restore();

    const freqPoints = Array.from({ length: width }, (_, i) => 
        Math.pow(10, minFreqLog + (i / (width - 1)) * (maxFreqLog - minFreqLog))
    );

    const bandDefinitions = [];
    if (this.bc === 2) {
      bandDefinitions.push({ name: "Low", filters: [{ freq: this.f1, slope: this.s1, type: "lp" }] });
      bandDefinitions.push({ name: "High", filters: [{ freq: this.f1, slope: this.s1, type: "hp" }] });
    } else if (this.bc === 3) {
      bandDefinitions.push({ name: "Low", filters: [{ freq: this.f1, slope: this.s1, type: "lp" }] });
      bandDefinitions.push({ name: "Mid", filters: [{ freq: this.f1, slope: this.s1, type: "hp" }, { freq: this.f2, slope: this.s2, type: "lp" }] });
      bandDefinitions.push({ name: "High", filters: [{ freq: this.f2, slope: this.s2, type: "hp" }] });
    } else if (this.bc === 4) {
      bandDefinitions.push({ name: "Low", filters: [{ freq: this.f1, slope: this.s1, type: "lp" }] });
      bandDefinitions.push({ name: "Mid-Low", filters: [{ freq: this.f1, slope: this.s1, type: "hp" }, { freq: this.f2, slope: this.s2, type: "lp" }] });
      bandDefinitions.push({ name: "Mid-High", filters: [{ freq: this.f2, slope: this.s2, type: "hp" }, { freq: this.f3, slope: this.s3, type: "lp" }] });
      bandDefinitions.push({ name: "High", filters: [{ freq: this.f3, slope: this.s3, type: "hp" }] });
    }
    
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = (isMobileLayout ? 2 : 1.5) * dpr;

    bandDefinitions.forEach(bandDef => {
      const response = this.calculateBandResponse(freqPoints, bandDef.filters);
      ctx.beginPath();
      for (let i = 0; i < width; i++) {
        let y = height * (1 - (response[i] - dbRange[0]) / totalDbSpan);
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.stroke();
    });
  }

  calculateBandResponse(freqPoints, filters) {
    return freqPoints.map(freq => {
      let gainDb = 0; 
      filters.forEach(filter => {
        gainDb += this.calculateFilterMagnitudeDb(freq, filter.freq, filter.slope, filter.type);
      });
      return gainDb;
    });
  }

  calculateFilterMagnitudeDb(freq, cutoffFreq, slope, type) {
    if (freq <= 0 || cutoffFreq <= 0 || slope === 0) return 0;
    
    const fs = 96000; // Default sample rate for graph calculation
    const sections = this.designLinkwitzRileySectionsForGraph(fs, cutoffFreq, slope, type);
    if (!sections.length) return 0;
    
    const w = 2 * Math.PI * freq / fs;
    const cosw = Math.cos(w);
    const sinw = Math.sin(w);
    const cos2w = Math.cos(2 * w);
    const sin2w = Math.sin(2 * w);
    
    const z1Re = cosw;
    const z1Im = -sinw;
    const z2Re = cos2w;
    const z2Im = -sin2w;
    
    let mag2 = 1.0;
    
    for (const s of sections) {
      const b0 = s.b0, b1 = s.b1, b2 = s.b2;
      const a1 = s.a1, a2 = s.a2;
      
      // Numerator: b0 + b1 z^-1 + b2 z^-2
      const numRe = b0 + b1 * z1Re + b2 * z2Re;
      const numIm = b1 * z1Im + b2 * z2Im;
      
      // Denominator: 1 + a1 z^-1 + a2 z^-2
      const denRe = 1 + a1 * z1Re + a2 * z2Re;
      const denIm = a1 * z1Im + a2 * z2Im;
      
      const numMag2 = numRe * numRe + numIm * numIm;
      const denMag2 = denRe * denRe + denIm * denIm;
      
      mag2 *= numMag2 / denMag2;
    }
    
    const db = 10 * Math.log10(Math.max(mag2, 1e-20));
    return db;
  }
  
  designLinkwitzRileySectionsForGraph(fs, fc, slope, type) {
    if (slope === 0 || fc <= 0) return [];
    const absSlope = Math.abs(slope);
    if (absSlope % 12 !== 0) return [];
    const N = absSlope / 12;
    if (type !== "lp" && type !== "hp") return [];
    
    const butter = this.designButterworthSectionsForGraph(fs, fc, N, type);
    if (!butter.length) return [];
    
    // LR: Butterworth_N cascaded twice
    const lr = butter.slice();
    for (let i = 0; i < butter.length; ++i) {
      const s = butter[i];
      lr.push({ b0: s.b0, b1: s.b1, b2: s.b2, a1: s.a1, a2: s.a2 });
    }
    return lr;
  }
  
  designButterworthSectionsForGraph(fs, fc, N, type) {
    if (!Number.isFinite(N) || N <= 0) return [];
    const sections = [];
    const isOdd = (N % 2) !== 0;
    
    if (isOdd) {
      const sec1 = this.designFirstOrderButterworthForGraph(fs, fc, type);
      if (sec1) sections.push(sec1);
    }
    
    const Qs = this.computeButterworthQsForGraph(N);
    for (const Q of Qs) {
      const sec2 = this.designSecondOrderButterworthForGraph(fs, fc, Q, type);
      if (sec2) sections.push(sec2);
    }
    
    return sections;
  }
  
  computeButterworthQsForGraph(N) {
    const Qs = [];
    const pairs = Math.floor(N / 2);
    for (let k = 1; k <= pairs; ++k) {
      const theta = (2 * k - 1) * Math.PI / (2 * N);
      const zeta = Math.sin(theta);
      const Q = 1 / (2 * zeta);
      Qs.push(Q);
    }
    return Qs;
  }
  
  designFirstOrderButterworthForGraph(fs, fc, type) {
    if (fc <= 0 || fc >= fs * 0.5) return null;
    const K = 2 * fs;
    const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
    const Om = warped;
    const a0 = K + Om;
    const a1 = Om - K;
    let b0, b1;
    if (type === "lp") {
      b0 = Om;
      b1 = Om;
    } else {
      b0 = -K;
      b1 = K;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: 0, a1: a1 / a0, a2: 0 };
  }
  
  designSecondOrderButterworthForGraph(fs, fc, Q, type) {
    if (fc <= 0 || fc >= fs * 0.5) return null;
    const K = 2 * fs;
    const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
    const Om = warped;
    const K2 = K * K;
    const Om2 = Om * Om;
    const K2Q = K2 * Q;
    const Om2Q = Om2 * Q;
    const a0 = K2Q + K * Om + Om2Q;
    const a1 = -2 * K2Q + 2 * Om2Q;
    const a2 = K2Q - K * Om + Om2Q;
    let b0, b1, b2;
    if (type === "lp") {
      b0 = Om2Q;
      b1 = 2 * Om2Q;
      b2 = Om2Q;
    } else {
      b0 = K2Q;
      b1 = -2 * K2Q;
      b2 = K2Q;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
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
        CHANNEL_DIVIDER_CHANNEL_COUNT_FRAME,
        this._boundDspChannelCountTelemetry
      );
      if (typeof unsubscribe !== 'function') {
        hub.unsubscribe?.(
          tapId,
          CHANNEL_DIVIDER_CHANNEL_COUNT_FRAME,
          this._boundDspChannelCountTelemetry
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

  parseDspChannelCountTelemetryFrame(frame) {
    if (frame?.frameType !== CHANNEL_DIVIDER_CHANNEL_COUNT_FRAME ||
        frame.formatVersion !== CHANNEL_DIVIDER_TELEMETRY_VERSION) {
      return null;
    }
    const payload = frame.payload;
    if (!payload || typeof payload.getUint32 !== 'function' ||
        !Number.isInteger(payload.byteLength) ||
        payload.byteLength !== CHANNEL_DIVIDER_CHANNEL_COUNT_BYTES) {
      return null;
    }
    const channels = payload.getUint32(0, true);
    return channels >= 1 && channels <= 8 ? channels : null;
  }

  handleDspChannelCountTelemetry(frame) {
    const channels = this.parseDspChannelCountTelemetryFrame(frame);
    if (channels === null || !this.enabled || !this._sectionEnabled) return;
    this.applyMeasuredChannelCount(channels);
  }

  applyMeasuredChannelCount(channels) {
      let newMaxBands = 2; 
      let error = null;

      if (channels < 4 || channels % 2 !== 0) {
        error = "This effect only works in multichannel mode (4, 6, or 8 channels).";
      } else if (channels === 4) {
        newMaxBands = 2;
      } else if (channels === 6) {
        newMaxBands = 3;
      } else if (channels === 8) {
        newMaxBands = 4;
      }
      
      let uiNeedsUpdate = false;
      if (this.maxBands !== newMaxBands) {
        this.maxBands = newMaxBands;
        uiNeedsUpdate = true;
      }
      if (this.errorState !== error) {
        this.errorState = error;
        uiNeedsUpdate = true;
      }

      if (uiNeedsUpdate) {
        this._updateErrorUI();
        this._updateBandOptions(); 
        this.updateCrossoverControls(); 
      }
  }

  onMessage(message) {
    this.ensureDspTelemetrySubscription();
    if (message.type === 'processBuffer' && message.pluginId === this.id && message.measurements) {
      this.applyMeasuredChannelCount(message.measurements.channels);
    }
  }

  cleanup() {
    this.disposeDspTelemetrySubscription();
    this.graphDispose?.();
    this.graphDispose = null;
    super.cleanup();
  }
}

window.ChannelDividerPlugin = ChannelDividerPlugin;
