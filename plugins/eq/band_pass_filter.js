// Band Pass Filter Plugin implementation
// This implementation uses Linkwitz-Riley filters for precise crossover characteristics.
// Linkwitz-Riley filters are created by cascading Butterworth filters of the same order.
const bandPassProcessorFunction = `
if (!parameters.enabled) return data;

const channelCount = parameters.channelCount;
const blockSize = parameters.blockSize;
const hpFreq = parameters.hf;
const lpFreq = parameters.lf;
const hpSlope = parameters.hs;
const lpSlope = parameters.ls;

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

// Helper function to apply a single biquad filter stage to all channels
function applySingleBiquad(inputBuf, outputBuf, currentBlockSize, currentChannelCount, coeffs, biquadState) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  for (let ch = 0; ch < currentChannelCount; ++ch) {
    let x1 = biquadState.x1[ch], x2 = biquadState.x2[ch], 
        y1 = biquadState.y1[ch], y2 = biquadState.y2[ch];

    const inChOffset = ch * currentBlockSize;
    const outChOffset = ch * currentBlockSize;

    for (let i = 0; i < currentBlockSize; ++i) {
      const sample = inputBuf[inChOffset + i];
      let filteredSample = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = sample;
      y2 = y1; y1 = filteredSample;
      outputBuf[outChOffset + i] = filteredSample;
    }
    biquadState.x1[ch] = x1; biquadState.x2[ch] = x2;
    biquadState.y1[ch] = y1; biquadState.y2[ch] = y2;
  }
}

// Applies cascaded biquad filters with different coefficients for each section.
function applyMultiBiquadFilter(inputSignal, finalOutputSignal, coeffsArray, biquadStatesArray) {
  if (!coeffsArray || coeffsArray.length === 0) {
    if (inputSignal !== finalOutputSignal) {
      finalOutputSignal.set(inputSignal);
    }
    return;
  }
  
  const numSections = coeffsArray.length;
  if (numSections === 0) {
    if (inputSignal !== finalOutputSignal) {
      finalOutputSignal.set(inputSignal);
    }
    return;
  }
  
  let bufferIn = inputSignal;
  let bufferOut = (numSections === 1) ? finalOutputSignal : context.pingPongBuffer;
  
  for (let stageIdx = 0; stageIdx < numSections; ++stageIdx) {
    if (stageIdx === numSections - 1) {
      bufferOut = finalOutputSignal;
    }
    
    applySingleBiquad(bufferIn, bufferOut, blockSize, channelCount, coeffsArray[stageIdx], biquadStatesArray[stageIdx]);
    
    if (stageIdx < numSections - 1) {
      bufferIn = bufferOut;
      if (stageIdx < numSections - 2) {
        bufferOut = (bufferIn === finalOutputSignal) ? context.pingPongBuffer : finalOutputSignal;
      } else {
        bufferOut = finalOutputSignal;
      }
    }
  }
}

// --- Hi Pass Processing ---
{
  const freq = hpFreq;
  const slope = hpSlope;
  
  let needsReset = !context.hpf || !context.hpf.filterStates || !context.hpf.filterConfig ||
                   context.hpf.filterConfig.sampleRate !== sampleRate ||
                   context.hpf.filterConfig.channelCount !== channelCount ||
                   context.hpf.filterConfig.freq !== freq ||
                   context.hpf.filterConfig.slope !== slope;

  if (needsReset || !context.hpf.cachedCoeffs) {
    const clampedFreq = Math.max(10.0, Math.min(freq, sampleRate * 0.499));
    const hpSections = designLinkwitzRileySections(sampleRate, clampedFreq, Math.abs(slope), "hp");
    
    context.hpf = context.hpf || {};
    context.hpf.cachedCoeffs = hpSections;
    
    // Initialize filter states based on actual section counts
    if (needsReset) {
      const dcOffset = 1e-25;
      
      const createSingleBiquadStateAndInit = () => {
        const state = { 
          x1: new Float32Array(channelCount), 
          x2: new Float32Array(channelCount), 
          y1: new Float32Array(channelCount), 
          y2: new Float32Array(channelCount) 
        };
        for (let ch = 0; ch < channelCount; ch++) {
          state.x1[ch] = dcOffset; 
          state.x2[ch] = -dcOffset;
          state.y1[ch] = dcOffset; 
          state.y2[ch] = -dcOffset;
        }
        return state;
      };
      
      context.hpf.filterStates = [];
      if (context.hpf.cachedCoeffs && context.hpf.cachedCoeffs.length > 0) {
        for (let j = 0; j < context.hpf.cachedCoeffs.length; j++) {
          context.hpf.filterStates.push(createSingleBiquadStateAndInit());
        }
      }
      
      context.hpf.filterConfig = {
        sampleRate, channelCount, freq, slope
      };
      
      // Allocate pingPongBuffer for multi-stage filtering
      if (!context.pingPongBuffer || context.pingPongBuffer.length !== blockSize * channelCount) {
        context.pingPongBuffer = new Float32Array(blockSize * channelCount);
      }
    }
  }

  // Apply Linkwitz-Riley high-pass filter
  if (context.hpf.cachedCoeffs && context.hpf.cachedCoeffs.length > 0) {
    applyMultiBiquadFilter(data, data, context.hpf.cachedCoeffs, context.hpf.filterStates);
  }
}

// --- Lo Pass Processing ---
{
  const freq = lpFreq;
  const slope = lpSlope;
  
  let needsReset = !context.lpf || !context.lpf.filterStates || !context.lpf.filterConfig ||
                   context.lpf.filterConfig.sampleRate !== sampleRate ||
                   context.lpf.filterConfig.channelCount !== channelCount ||
                   context.lpf.filterConfig.freq !== freq ||
                   context.lpf.filterConfig.slope !== slope;

  if (needsReset || !context.lpf.cachedCoeffs) {
    const clampedFreq = Math.max(10.0, Math.min(freq, sampleRate * 0.499));
    const lpSections = designLinkwitzRileySections(sampleRate, clampedFreq, Math.abs(slope), "lp");
    
    context.lpf = context.lpf || {};
    context.lpf.cachedCoeffs = lpSections;
    
    // Initialize filter states based on actual section counts
    if (needsReset) {
      const dcOffset = 1e-25;
      
      const createSingleBiquadStateAndInit = () => {
        const state = { 
          x1: new Float32Array(channelCount), 
          x2: new Float32Array(channelCount), 
          y1: new Float32Array(channelCount), 
          y2: new Float32Array(channelCount) 
        };
        for (let ch = 0; ch < channelCount; ch++) {
          state.x1[ch] = dcOffset; 
          state.x2[ch] = -dcOffset;
          state.y1[ch] = dcOffset; 
          state.y2[ch] = -dcOffset;
        }
        return state;
      };
      
      context.lpf.filterStates = [];
      if (context.lpf.cachedCoeffs && context.lpf.cachedCoeffs.length > 0) {
        for (let j = 0; j < context.lpf.cachedCoeffs.length; j++) {
          context.lpf.filterStates.push(createSingleBiquadStateAndInit());
        }
      }
      
      context.lpf.filterConfig = {
        sampleRate, channelCount, freq, slope
      };
      
      // Allocate pingPongBuffer for multi-stage filtering (reuse if already allocated)
      if (!context.pingPongBuffer || context.pingPongBuffer.length !== blockSize * channelCount) {
        context.pingPongBuffer = new Float32Array(blockSize * channelCount);
      }
    }
  }

  // Apply Linkwitz-Riley low-pass filter
  if (context.lpf.cachedCoeffs && context.lpf.cachedCoeffs.length > 0) {
    applyMultiBiquadFilter(data, data, context.lpf.cachedCoeffs, context.lpf.filterStates);
  }
}

return data;
`;

class BandPassFilterPlugin extends PluginBase {
  constructor() {
    super("Band Pass Filter", "Band-pass filter using cascaded hi/lo-pass filters");
    this.hf = 1000; // HPF frequency in Hz
    this.lf = 1000; // LPF frequency in Hz
    this.hs = -24;  // HPF slope in dB/oct
    this.ls = -24;  // LPF slope in dB/oct
    this.registerProcessor(bandPassProcessorFunction);
  }

  setHf(freq) { this.setParameters({ hf: freq }); }
  setLf(freq) { this.setParameters({ lf: freq }); }
  setHs(slope) { this.setParameters({ hs: slope }); }
  setLs(slope) { this.setParameters({ ls: slope }); }

  getParameters() {
    return {
      type: this.constructor.name,
      enabled: this.enabled,
      hf: this.hf,
      lf: this.lf,
      hs: this.hs,
      ls: this.ls
    };
  }

  setParameters(params) {
    if (params.enabled !== undefined) this.enabled = params.enabled;
    if (params.hf !== undefined) {
      const value = typeof params.hf === "number" ? params.hf : parseFloat(params.hf);
      this.hf = value < 10 ? 10 : (value > 40000 ? 40000 : value);
    }
    if (params.lf !== undefined) {
      const value = typeof params.lf === "number" ? params.lf : parseFloat(params.lf);
      this.lf = value < 10 ? 10 : (value > 40000 ? 40000 : value);
    }
    if (params.hs !== undefined) {
      const intSlope = typeof params.hs === "number" ? params.hs : parseInt(params.hs);
      const allowed = [0, -12, -24, -36, -48];
      this.hs = allowed.includes(intSlope) ? intSlope : -24;
    }
    if (params.ls !== undefined) {
      const intSlope = typeof params.ls === "number" ? params.ls : parseInt(params.ls);
      const allowed = [0, -12, -24, -36, -48];
      this.ls = allowed.includes(intSlope) ? intSlope : -24;
    }
    this.updateParameters();
  }

  createUI() {
    const container = document.createElement("div");
    container.className = "band-pass-filter-plugin-ui plugin-parameter-ui";

    // Helper to create a slope select box
    const createSlopeSelect = (current, onChange, filterType, canvasRef) => {
      const selectId = `${this.id}-${this.name}-${filterType.toLowerCase()}-slope`;
      
      const select = document.createElement("select");
      select.className = "slope-select";
      select.id = selectId;
      select.name = selectId;
      select.autocomplete = "off";
      
      const slopes = [0, -12, -24, -36, -48];
      slopes.forEach(slope => {
        const option = document.createElement("option");
        option.value = slope;
        option.textContent = slope === 0 ? "Off" : `${Math.abs(slope)}dB/oct`;
        option.selected = current === slope;
        select.appendChild(option);
      });
      select.addEventListener("change", e => {
        onChange(parseInt(e.target.value));
        // Draw graph using the passed canvas reference
        if (canvasRef) this.drawGraph(canvasRef);
      });
      return select;
    };

    // Create graph container and canvas *before* creating controls that need it
    const { container: graphContainer, canvas } = this.createResponsiveGraph({
      maxWidth: 600,
      aspectRatio: "5 / 2",
      mobileAspectRatio: "2 / 1",
      className: "band-pass-filter-graph",
      onResize: ({ canvas }) => this.drawGraph(canvas)
    });
    graphContainer.style.margin = "10px auto";
    canvas.style.margin = "0 auto";

    // Create HPF row
    const hpfRow = this.createParameterControl("HPF", 10, 40000, 1, this.hf,
      (value) => {
        this.setHf(value);
        this.drawGraph(canvas);
      },
      'Hz'
    );
    // Append the HPF slope selector to the row
    hpfRow.appendChild(createSlopeSelect(this.hs, v => this.setHs(v), "HPF", canvas));

    // Create LPF row
    const lpfRow = this.createParameterControl("LPF", 10, 40000, 1, this.lf,
      (value) => {
        this.setLf(value);
        this.drawGraph(canvas);
      },
      'Hz'
    );
    // Append the LPF slope selector to the row
    lpfRow.appendChild(createSlopeSelect(this.ls, v => this.setLs(v), "LPF", canvas));

    container.appendChild(hpfRow);
    container.appendChild(lpfRow);
    container.appendChild(graphContainer);
    this.drawGraph(canvas);
    return container;
  }

  drawGraph(canvas) {
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth || canvas.width;
    const cssHeight = rect.height || canvas.clientHeight || canvas.height;
    const dpr = canvas.width / cssWidth || 1;
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    const minFreqLog = Math.log10(10);
    const maxFreqLog = Math.log10(40000);

    const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = isMobileLayout ? 1 : 0.5;
    ctx.font = "12px Arial";

    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    gridFreqs.forEach(freq => {
      const x = width * (Math.log10(freq) - minFreqLog) / (maxFreqLog - minFreqLog);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (freq >= 10) {
        ctx.fillStyle = "#666";
        ctx.textAlign = "center";
        ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, height - 24);
      }
    });

    const dbRange = [-60, 12];
    const totalDbSpan = dbRange[1] - dbRange[0];
    const gridDBs = [-60, -48, -36, -24, -12, 0];
    gridDBs.forEach(db => {
      const y = height * (1 - (db - dbRange[0]) / totalDbSpan);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (db > -60) {
        ctx.fillStyle = "#666";
        ctx.textAlign = "right";
        ctx.fillText(`${db}dB`, 48, y + 4);
      }
    });

    ctx.fillStyle = "#fff";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Frequency (Hz)", width / 2, height - 5);
    ctx.save();
    ctx.translate(14, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Level (dB)", 0, 0);
    ctx.restore();

    // Calculate frequency response using actual filter coefficients
    const freqPoints = Array.from({ length: width }, (_, i) =>
      Math.pow(10, minFreqLog + (i / (width - 1)) * (maxFreqLog - minFreqLog))
    );

    const response = freqPoints.map(freq => {
      const hpfResponse = this.calculateFilterMagnitudeDb(freq, this.hf, this.hs, "hp");
      const lpfResponse = this.calculateFilterMagnitudeDb(freq, this.lf, this.ls, "lp");
      return hpfResponse + lpfResponse;
    });

    ctx.beginPath();
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = isMobileLayout ? 3 : 1.5;
    for (let i = 0; i < width; i++) {
      let y = height * (1 - (response[i] - dbRange[0]) / totalDbSpan);
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
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
}

window.BandPassFilterPlugin = BandPassFilterPlugin;
