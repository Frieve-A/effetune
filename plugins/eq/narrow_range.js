// Processor function modified for Linkwitz–Riley–style filtering
// This implementation supports first‑order sections for 6dB/oct and 
// second‑order (Butterworth, Q = 1/√2) sections for 12dB/oct.
// The filter cascade is built as follows:
//  - If the absolute slope is 6 dB/oct, one first‑order stage is used.
//  - If the absolute slope is 12 dB/oct, one second‑order stage is used.
//  - If the absolute slope is an odd multiple of 6 (e.g. 18, 30, 42 dB/oct),
//    the cascade is built as one first‑order stage followed by the appropriate
//    number of second‑order stages.
//  - If the absolute slope is an even multiple of 6 (e.g. 24, 36, 48 dB/oct),
//    the cascade is built entirely from second‑order stages.
const processorFunction = `
// Early exit if processing is disabled
if (!parameters.enabled) return data;

// Extract parameters into local constants for potentially faster access
// Assuming sampleRate is available either globally or via parameters
const hpfFreq = parameters.hf;
const hpfSlope = parameters.hs;
const lpfFreq = parameters.lf;
const lpfSlope = parameters.ls;
const channelCount = parameters.channelCount;
const blockSize = parameters.blockSize;
const sampleRate = parameters.sampleRate; // Essential for coefficient calculation

// --- Stage Calculation ---
// Helper function to compute filter orders based on slope (dB/oct)
// Kept inside as it's directly used here.
function computeFilterStages(slope) {
  const absSlope = slope < 0 ? -slope : slope; // Optimized Math.abs
  if (absSlope < 3) return { order1: 0, order2: 0 }; // Treat slopes < 3dB/oct as off
  // Round to nearest multiple of 6dB/oct represented order
  const n = Math.round(absSlope / 6);
  if (n === 0) return { order1: 0, order2: 0 };
  if (n % 2 === 1) { // Odd total order (e.g., 6dB, 18dB)
    return { order1: 1, order2: (n - 1) >> 1 }; // Use bitwise shift for division by 2
  } else { // Even total order (e.g., 12dB, 24dB)
    return { order1: 0, order2: n >> 1 }; // Use bitwise shift
  }
}

const hpfStages = computeFilterStages(hpfSlope);
const lpfStages = computeFilterStages(lpfSlope);

// --- Parameter Change Detection & State/Coefficient Management ---
let needsReinit = false;
let needsCoeffRecalcHPF = false;
let needsCoeffRecalcLPF = false;

// Initialize context if it doesn't exist
if (typeof context === 'undefined' || context === null) {
    context = {}; // Ensure context object exists
}

// Check for slope changes -> requires reinitialization
if (context.lastHpfSlope !== hpfSlope || context.lastLpfSlope !== lpfSlope) {
  context.lastHpfSlope = hpfSlope;
  context.lastLpfSlope = lpfSlope;
  // Store computed stage counts
  context.hpfOrder1Stages = hpfStages.order1;
  context.hpfOrder2Stages = hpfStages.order2;
  context.lpfOrder1Stages = lpfStages.order1;
  context.lpfOrder2Stages = lpfStages.order2;
  context.filterStates = null; // Signal state structure needs update
  needsReinit = true;
}

// Check for frequency changes -> requires coefficient recalculation
if (context.lastHpfFreq !== hpfFreq) {
  context.lastHpfFreq = hpfFreq;
  needsCoeffRecalcHPF = true;
}
if (context.lastLpfFreq !== lpfFreq) {
  context.lastLpfFreq = lpfFreq;
  needsCoeffRecalcLPF = true;
}

// Initialize or re-initialize filter states if needed
// State structure: { hpf: [state1_1, state1_2, state2_1, ...], lpf: [...] }
if (needsReinit || !context.filterStates) {
  const hpfOrder1 = context.hpfOrder1Stages;
  const hpfOrder2 = context.hpfOrder2Stages;
  const lpfOrder1 = context.lpfOrder1Stages;
  const lpfOrder2 = context.lpfOrder2Stages;
  const totalHPFStages = hpfOrder1 + hpfOrder2;
  const totalLPFStages = lpfOrder1 + lpfOrder2;

  context.filterStates = { hpf: new Array(totalHPFStages), lpf: new Array(totalLPFStages) };
  const dcOffset = 1e-25; // Small offset to prevent denormals

  let hpfIdx = 0;
  // Init HPF 1st order states
  for (let s = 0; s < hpfOrder1; s++, hpfIdx++) {
    const state = { x1: new Float32Array(channelCount), y1: new Float32Array(channelCount) };
    // Init with DC offset to prevent denormals - specific values may vary slightly but maintain small non-zero
    for(let ch=0; ch<channelCount; ++ch) { state.x1[ch] = dcOffset; state.y1[ch] = dcOffset; }
    context.filterStates.hpf[hpfIdx] = state;
  }
  // Init HPF 2nd order states
  for (let s = 0; s < hpfOrder2; s++, hpfIdx++) {
    const state = {
      x1: new Float32Array(channelCount), x2: new Float32Array(channelCount),
      y1: new Float32Array(channelCount), y2: new Float32Array(channelCount)
    };
    for(let ch=0; ch<channelCount; ++ch) { state.x1[ch] = dcOffset; state.x2[ch] = -dcOffset; state.y1[ch] = dcOffset; state.y2[ch] = -dcOffset;}
    context.filterStates.hpf[hpfIdx] = state;
  }

  let lpfIdx = 0;
   // Init LPF 1st order states
  for (let s = 0; s < lpfOrder1; s++, lpfIdx++) {
     const state = { x1: new Float32Array(channelCount), y1: new Float32Array(channelCount) };
     for(let ch=0; ch<channelCount; ++ch) { state.x1[ch] = dcOffset; state.y1[ch] = dcOffset; }
     context.filterStates.lpf[lpfIdx] = state;
  }
   // Init LPF 2nd order states
  for (let s = 0; s < lpfOrder2; s++, lpfIdx++) {
    const state = {
      x1: new Float32Array(channelCount), x2: new Float32Array(channelCount),
      y1: new Float32Array(channelCount), y2: new Float32Array(channelCount)
    };
    for(let ch=0; ch<channelCount; ++ch) { state.x1[ch] = dcOffset; state.x2[ch] = -dcOffset; state.y1[ch] = dcOffset; state.y2[ch] = -dcOffset;}
    context.filterStates.lpf[lpfIdx] = state;
  }

  needsReinit = true; // Mark that reinitialization occurred
  needsCoeffRecalcHPF = true; // Force recalc after reinit
  needsCoeffRecalcLPF = true;
}

// Ensure coeffs object exists in context
if (!context.coeffs) {
    context.coeffs = {};
}

// --- Coefficient Calculation (only if needed) ---
// Inlined constants for performance
const PI = 3.141592653589793;
const SQRT2 = 1.4142135623730951;

// Recalculate HPF Coefficients if frequency changed or states were reinitialized
if (needsCoeffRecalcHPF || needsReinit) {
  const hpfOrder1 = context.hpfOrder1Stages;
  const hpfOrder2 = context.hpfOrder2Stages;
  const coeffs = context.coeffs;

  // HPF 1st Order Coefficients (Bilinear Transform)
  if (hpfOrder1 > 0) {
    // tan() can produce very large/infinite values near Nyquist, handle potential issues
    const tangentArg = PI * hpfFreq / sampleRate;
    if (hpfFreq > 0 && tangentArg < (PI * 0.5 - 1e-9)) { // Avoid tan(pi/2)
      const c = Math.tan(tangentArg);
      const one_plus_c = 1 + c;
      // Avoid division by zero if c approx -1 (freq near sampleRate/4)
      const inv_one_plus_c = (one_plus_c !== 0) ? 1 / one_plus_c : 0; // Or handle differently?
      coeffs.hp1_b0 = inv_one_plus_c;
      coeffs.hp1_b1 = -inv_one_plus_c;
      coeffs.hp1_a1 = -(1 - c) * inv_one_plus_c;
    } else { // Freq 0 or >= Nyquist: Pass-through (matching original potential behavior more closely than hard zeroing)
      coeffs.hp1_b0 = 1; coeffs.hp1_b1 = 0; coeffs.hp1_a1 = 0;
    }
  } else { // No 1st order stages
     coeffs.hp1_b0 = 1; coeffs.hp1_b1 = 0; coeffs.hp1_a1 = 0; // Default to pass-through
  }

  // HPF 2nd Order Coefficients (Butterworth RBJ Cookbook formula)
  if (hpfOrder2 > 0) {
    if (hpfFreq > 0 && hpfFreq < sampleRate * 0.5) { // Ensure freq is valid
      const w0 = 2 * PI * hpfFreq / sampleRate;
      const cos_w0 = Math.cos(w0);
      const alpha = Math.sin(w0) * (SQRT2 * 0.5); // Q = 1/SQRT2
      const a0_inv = 1 / (1 + alpha); // Precompute inverse

      coeffs.hp2_b0 = ((1 + cos_w0) * 0.5) * a0_inv;
      coeffs.hp2_b1 = -(1 + cos_w0) * a0_inv; // = -2 * b0
      coeffs.hp2_b2 = coeffs.hp2_b0;
      coeffs.hp2_a1 = (-2 * cos_w0) * a0_inv;
      coeffs.hp2_a2 = (1 - alpha) * a0_inv;
    } else { // Freq 0 or >= Nyquist: Pass-through
      coeffs.hp2_b0 = 1; coeffs.hp2_b1 = 0; coeffs.hp2_b2 = 0;
      coeffs.hp2_a1 = 0; coeffs.hp2_a2 = 0;
    }
  } else { // No 2nd order stages
      coeffs.hp2_b0 = 1; coeffs.hp2_b1 = 0; coeffs.hp2_b2 = 0;
      coeffs.hp2_a1 = 0; coeffs.hp2_a2 = 0; // Default to pass-through
  }
}

// Recalculate LPF Coefficients if frequency changed or states were reinitialized
if (needsCoeffRecalcLPF || needsReinit) {
  const lpfOrder1 = context.lpfOrder1Stages;
  const lpfOrder2 = context.lpfOrder2Stages;
  const coeffs = context.coeffs;

  // LPF 1st Order Coefficients (Bilinear Transform)
  if (lpfOrder1 > 0) {
    const tangentArg = PI * lpfFreq / sampleRate;
     if (lpfFreq > 0 && tangentArg < (PI * 0.5 - 1e-9)) { // Avoid tan(pi/2)
      const c = Math.tan(tangentArg);
      const one_plus_c = 1 + c;
      const inv_one_plus_c = (one_plus_c !== 0) ? 1 / one_plus_c : 0;
      const c_term = c * inv_one_plus_c;
      coeffs.lp1_b0 = c_term;
      coeffs.lp1_b1 = c_term;
      coeffs.lp1_a1 = -(1 - c) * inv_one_plus_c;
    } else { // Freq 0 or >= Nyquist: Pass-through
      coeffs.lp1_b0 = 1; coeffs.lp1_b1 = 0; coeffs.lp1_a1 = 0;
    }
  } else { // No 1st order stages
     coeffs.lp1_b0 = 1; coeffs.lp1_b1 = 0; coeffs.lp1_a1 = 0; // Default to pass-through
  }

  // LPF 2nd Order Coefficients (Butterworth RBJ Cookbook formula)
  if (lpfOrder2 > 0) {
    if (lpfFreq > 0 && lpfFreq < sampleRate * 0.5) { // Ensure freq is valid
      const w0 = 2 * PI * lpfFreq / sampleRate;
      const cos_w0 = Math.cos(w0);
      const alpha = Math.sin(w0) * (SQRT2 * 0.5); // Q = 1/SQRT2
      const a0_inv = 1 / (1 + alpha); // Precompute inverse

      const term = (1 - cos_w0) * 0.5;
      coeffs.lp2_b0 = term * a0_inv;
      coeffs.lp2_b1 = (1 - cos_w0) * a0_inv; // = 2 * b0
      coeffs.lp2_b2 = coeffs.lp2_b0;
      coeffs.lp2_a1 = (-2 * cos_w0) * a0_inv;
      coeffs.lp2_a2 = (1 - alpha) * a0_inv;
    } else { // Freq 0 or >= Nyquist: Pass-through
      coeffs.lp2_b0 = 1; coeffs.lp2_b1 = 0; coeffs.lp2_b2 = 0;
      coeffs.lp2_a1 = 0; coeffs.lp2_a2 = 0;
    }
  } else { // No 2nd order stages
      coeffs.lp2_b0 = 1; coeffs.lp2_b1 = 0; coeffs.lp2_b2 = 0;
      coeffs.lp2_a1 = 0; coeffs.lp2_a2 = 0; // Default to pass-through
  }
}


// --- Audio Processing ---
const hpfStates = context.filterStates.hpf;
const lpfStates = context.filterStates.lpf;
const hpfOrder1Count = context.hpfOrder1Stages; // Use cached counts
const hpfOrder2Count = context.hpfOrder2Stages;
const lpfOrder1Count = context.lpfOrder1Stages;
const lpfOrder2Count = context.lpfOrder2Stages;

// Early exit if no filter stages are actually configured
if (hpfOrder1Count === 0 && hpfOrder2Count === 0 && lpfOrder1Count === 0 && lpfOrder2Count === 0) {
    return data;
}

// Cache coefficients locally for the processing loop
const {
    hp1_b0, hp1_b1, hp1_a1, hp2_b0, hp2_b1, hp2_b2, hp2_a1, hp2_a2,
    lp1_b0, lp1_b1, lp1_a1, lp2_b0, lp2_b1, lp2_b2, lp2_a1, lp2_a2
} = context.coeffs;


// Process each channel
for (let ch = 0, offset = 0; ch < channelCount; ch++, offset += blockSize) {
    // Process each sample in the block for the current channel
    for (let i = 0; i < blockSize; i++) {
        let sample = data[offset + i]; // Current input sample

        // ----- High-Pass Filtering -----
        let hpfStageIdx = 0;

        // Apply 1st-order HPF stages
        for (let s = 0; s < hpfOrder1Count; s++, hpfStageIdx++) {
            const state = hpfStates[hpfStageIdx];
            // Cache state specific to channel
            const x1 = state.x1[ch];
            const y1 = state.y1[ch];
            const x_n = sample; // Input to this stage

            // Difference Equation: y[n] = b0*x[n] + b1*x[n-1] - a1*y[n-1]
            // Note: The RBJ formulas result in a1/a2 that need negation in the standard diff eq.
            // Here, a1 is calculated as -((1-c)/(1+c)), so we ADD it.
            // Let's stick to the original structure: y = b0*x + b1*x1 - a1*y1
            const y_n = hp1_b0 * x_n + hp1_b1 * x1 - hp1_a1 * y1;

            // Update state (use x_n before it's overwritten)
            state.x1[ch] = x_n;
            state.y1[ch] = y_n;
            sample = y_n; // Output becomes input for next stage
        }

        // Apply 2nd-order HPF stages
        for (let s = 0; s < hpfOrder2Count; s++, hpfStageIdx++) {
            const state = hpfStates[hpfStageIdx];
            // Cache state specific to channel
            const x1 = state.x1[ch]; const x2 = state.x2[ch];
            const y1 = state.y1[ch]; const y2 = state.y2[ch];
            const x_n = sample; // Input to this stage

            // Difference Equation: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
            // RBJ 'a' coeffs usually correspond to the feedback terms with signs appropriate for y[n] = ... - a1*y[n-1] ...
            const y_n = hp2_b0 * x_n + hp2_b1 * x1 + hp2_b2 * x2 - hp2_a1 * y1 - hp2_a2 * y2;

            // Update state (use x_n, y_n, x1, y1 before overwriting)
            state.x2[ch] = x1; state.x1[ch] = x_n;
            state.y2[ch] = y1; state.y1[ch] = y_n;
            sample = y_n; // Output becomes input for next stage
        }

        // ----- Low-Pass Filtering -----
        let lpfStageIdx = 0;

        // Apply 1st-order LPF stages
        for (let s = 0; s < lpfOrder1Count; s++, lpfStageIdx++) {
            const state = lpfStates[lpfStageIdx];
            const x1 = state.x1[ch];
            const y1 = state.y1[ch];
            const x_n = sample;

            // Difference Equation: y[n] = b0*x[n] + b1*x[n-1] - a1*y[n-1]
            // lp1_a1 calculated as -((1-c)/(1+c)) -> use subtraction as in original
            const y_n = lp1_b0 * x_n + lp1_b1 * x1 - lp1_a1 * y1;

            state.x1[ch] = x_n;
            state.y1[ch] = y_n;
            sample = y_n;
        }

        // Apply 2nd-order LPF stages
        for (let s = 0; s < lpfOrder2Count; s++, lpfStageIdx++) {
            const state = lpfStates[lpfStageIdx];
            const x1 = state.x1[ch]; const x2 = state.x2[ch];
            const y1 = state.y1[ch]; const y2 = state.y2[ch];
            const x_n = sample;

            // Difference Equation: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
            const y_n = lp2_b0 * x_n + lp2_b1 * x1 + lp2_b2 * x2 - lp2_a1 * y1 - lp2_a2 * y2;

            state.x2[ch] = x1; state.x1[ch] = x_n;
            state.y2[ch] = y1; state.y1[ch] = y_n;
            sample = y_n;
        }

        // Write the final filtered sample back to the data array
        data[offset + i] = sample;
    }
}

return data; // Return the modified data array
`;

// Optimized NarrowRangePlugin class with simplified UI creation
class NarrowRangePlugin extends PluginBase {
  constructor() {
    super("Narrow Range", "High-pass and low-pass filter combination for narrow band filtering (crossover-capable)");
    this.hf = 60;    // HPF Frequency in Hz
    this.hs = -24;   // HPF Slope (allowed values: 0, -6, -12, -18, -24, -30, -36, -42, -48 dB/oct)
    this.lf = 5000;  // LPF Frequency in Hz
    this.ls = -12;   // LPF Slope (allowed values: 0, -6, -12, -18, -24, -30, -36, -42, -48 dB/oct)
    this.registerProcessor(processorFunction);
  }

  setHf(freq) { this.setParameters({ hf: freq }); }
  setHs(slope) { this.setParameters({ hs: slope }); }
  setLf(freq) { this.setParameters({ lf: freq }); }
  setLs(slope) { this.setParameters({ ls: slope }); }

  getParameters() {
    return {
      type: this.constructor.name,
      enabled: this.enabled,
      hf: this.hf,
      hs: this.hs,
      lf: this.lf,
      ls: this.ls
    };
  }

  setParameters(params) {
    if (params.enabled !== undefined) this.enabled = params.enabled;
    if (params.hf !== undefined) {
      const value = typeof params.hf === "number" ? params.hf : parseFloat(params.hf);
      this.hf = value < 20 ? 20 : (value > 4000 ? 4000 : value);
    }
    if (params.hs !== undefined) {
      const intSlope = typeof params.hs === "number" ? params.hs : parseInt(params.hs);
      const allowed = [0, -6, -12, -18, -24, -30, -36, -42, -48];
      this.hs = allowed.includes(intSlope) ? intSlope : -12;
    }
    if (params.lf !== undefined) {
      const value = typeof params.lf === "number" ? params.lf : parseFloat(params.lf);
      this.lf = value < 200 ? 200 : (value > 40000 ? 40000 : value);
    }
    if (params.ls !== undefined) {
      const intSlope = typeof params.ls === "number" ? params.ls : parseInt(params.ls);
      const allowed = [0, -6, -12, -18, -24, -30, -36, -42, -48];
      this.ls = allowed.includes(intSlope) ? intSlope : -12;
    }
    this.updateParameters();
  }

  createUI() {
    const container = document.createElement("div");
    container.className = "narrow-range-plugin-ui plugin-parameter-ui";

    // Helper to create a parameter row with slider and number input
    const createRow = (labelText, min, max, step, value, onInput) => {
      // Create a parameter name from the label (e.g., "HPF Freq (Hz):" -> "hpffreq")
      const paramName = labelText.toLowerCase().split(' ')[0].replace(/[^a-z0-9]/g, '');
      
      const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
      const numberId = `${this.id}-${this.name}-${paramName}-number`;
      
      const row = document.createElement("div");
      row.className = "parameter-row";
      
      const label = document.createElement("label");
      label.textContent = labelText;
      label.htmlFor = sliderId;
      
      const slider = document.createElement("input");
      slider.type = "range";
      slider.id = sliderId;
      slider.name = sliderId;
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.value = value;
      slider.autocomplete = "off";
      
      const numberInput = document.createElement("input");
      numberInput.type = "number";
      numberInput.id = numberId;
      numberInput.name = numberId;
      numberInput.min = min;
      numberInput.max = max;
      numberInput.step = step;
      numberInput.value = value;
      numberInput.autocomplete = "off";
      slider.addEventListener("input", e => {
        onInput(parseFloat(e.target.value));
        numberInput.value = labelText.includes("HPF") ? this.hf : this.lf;
        this.drawGraph(canvas);
      });
      numberInput.addEventListener("input", e => {
        onInput(parseFloat(e.target.value) || 0);
        slider.value = labelText.includes("HPF") ? this.hf : this.lf;
        this.drawGraph(canvas);
        e.target.value = labelText.includes("HPF") ? this.hf : this.lf;
      });
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(numberInput);
      return row;
    };

    // Helper to create a slope select box
    const createSlopeSelect = (current, onChange, filterType) => {
      const selectId = `${this.id}-${this.name}-${filterType.toLowerCase()}-slope`;
      
      const select = document.createElement("select");
      select.className = "slope-select";
      select.id = selectId;
      select.name = selectId;
      select.autocomplete = "off";
      
      const slopes = [0, -6, -12, -18, -24, -30, -36, -42, -48];
      slopes.forEach(slope => {
        const option = document.createElement("option");
        option.value = slope;
        option.textContent = slope === 0 ? "Off" : `${Math.abs(slope)}dB/oct`;
        option.selected = current === slope;
        select.appendChild(option);
      });
      select.addEventListener("change", e => {
        onChange(parseInt(e.target.value));
        this.drawGraph(canvas);
      });
      return select;
    };

    // Create HPF and LPF parameter rows
    const hpfRow = createRow("HPF Freq (Hz):", 20, 4000, 1, this.hf, v => this.setHf(v));
    hpfRow.appendChild(createSlopeSelect(this.hs, v => this.setHs(v), "HPF"));
    const lpfRow = createRow("LPF Freq (Hz):", 200, 40000, 100, this.lf, v => this.setLf(v));
    lpfRow.appendChild(createSlopeSelect(this.ls, v => this.setLs(v), "LPF"));

    // Create graph container and canvas
    const { container: graphContainer, canvas } = this.createResponsiveGraph({
      maxWidth: 600,
      aspectRatio: "5 / 2",
      mobileAspectRatio: "2 / 1",
      className: "narrow-range-graph",
      onResize: ({ canvas }) => this.drawGraph(canvas)
    });
    graphContainer.style.margin = "10px auto";
    canvas.style.margin = "0 auto";

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
    const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Draw grid & labels (unchanged)
    ctx.strokeStyle = "#444";
    ctx.lineWidth = isMobileLayout ? 1 : 0.5;
    ctx.font = "12px Arial";
    const freqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    freqs.forEach(freq => {
      const x = width * (Math.log10(freq) - Math.log10(20)) / (Math.log10(40000) - Math.log10(20));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (freq > 20 && freq < 40000) {
        ctx.fillStyle = "#666";
        ctx.textAlign = "center";
        ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, height - 24);
      }
    });
    const dBs = [-30, -24, -18, -12, -6, 0];
    dBs.forEach(db => {
      const y = height * (1 - (db + 30) / 36);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (db > -30 && db < 6) {
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

    // Local helper to figure out 1st/2nd order stage counts
    function computeStages(slope) {
      const absSlope = Math.abs(slope);
      if (absSlope === 0) return { order1: 0, order2: 0 };
      const n = absSlope / 6;
      if (n % 2 === 1) {
        return { order1: 1, order2: (n - 1) / 2 };
      } else {
        return { order1: 0, order2: n / 2 };
      }
    }
    const hp = computeStages(this.hs);
    const lp = computeStages(this.ls);

    // We replicate the RBJ formulas for each filter type, matching processorFunction:
    const PI = 3.141592653589793;
    const SQRT2 = 1.4142135623730951;
    const sampleRate = 96000; // Chosen fixed sample rate for graph

    // 1st-order HPF coefficients from processorFunction (bilinear transform)
    function getHp1Coeffs(freq) {
      if (freq <= 0 || freq >= sampleRate / 2) {
        return { b0:1, b1:0, b2:0, a1:0, a2:0 };
      }
      const c = Math.tan(PI * freq / sampleRate);
      if (Math.abs(c) < 1e-12 || c > 1e12) {
        return { b0:1, b1:0, b2:0, a1:0, a2:0 };
      }
      const inv = 1 / (1 + c);
      return {
        b0: inv,
        b1: -inv,
        b2: 0,
        a1: -((1 - c) * inv),
        a2: 0
      };
    }

    // 2nd-order HPF coefficients from processorFunction (Butterworth, Q = 1/sqrt(2))
    function getHp2Coeffs(freq) {
      if (freq <= 0 || freq >= sampleRate / 2) {
        return { b0:1, b1:0, b2:0, a1:0, a2:0 };
      }
      const w0 = 2 * PI * freq / sampleRate;
      const cosw0 = Math.cos(w0);
      const alpha = Math.sin(w0) * (SQRT2 * 0.5);
      const inv = 1 / (1 + alpha);
      const b0 = ((1 + cosw0) * 0.5) * inv;
      const b1 = -(1 + cosw0) * inv;
      const b2 = b0;
      const a1 = -2 * cosw0 * inv;
      const a2 = (1 - alpha) * inv;
      return { b0, b1, b2, a1, a2 };
    }

    // 1st-order LPF coefficients (bilinear transform)
    function getLp1Coeffs(freq) {
      if (freq <= 0 || freq >= sampleRate / 2) {
        return { b0:1, b1:0, b2:0, a1:0, a2:0 };
      }
      const c = Math.tan(PI * freq / sampleRate);
      if (Math.abs(c) < 1e-12 || c > 1e12) {
        return { b0:1, b1:0, b2:0, a1:0, a2:0 };
      }
      const inv = 1 / (1 + c);
      const b0 = c * inv;
      return {
        b0,
        b1: b0,
        b2: 0,
        a1: -((1 - c) * inv),
        a2: 0
      };
    }

    // 2nd-order LPF coefficients (Butterworth, Q = 1/sqrt(2))
    function getLp2Coeffs(freq) {
      if (freq <= 0 || freq >= sampleRate / 2) {
        return { b0:1, b1:0, b2:0, a1:0, a2:0 };
      }
      const w0 = 2 * PI * freq / sampleRate;
      const cosw0 = Math.cos(w0);
      const alpha = Math.sin(w0) * (SQRT2 * 0.5);
      const inv = 1 / (1 + alpha);
      const term = (1 - cosw0) * 0.5;
      const b0 = term * inv;
      const b1 = (1 - cosw0) * inv;
      const b2 = b0;
      const a1 = -2 * cosw0 * inv;
      const a2 = (1 - alpha) * inv;
      return { b0, b1, b2, a1, a2 };
    }

    // Magnitude of H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
    // evaluated at z = e^(jω) => z^-1 = e^(-jω), etc.
    function biquadMagnitude(b0, b1, b2, a1, a2, omega) {
      // Numerator
      const numReal = b0 + b1*Math.cos(omega) + b2*Math.cos(2*omega);
      const numImag = b1*(-Math.sin(omega)) + b2*(-Math.sin(2*omega));
      const numMag = Math.sqrt(numReal*numReal + numImag*numImag);

      // Denominator
      const denReal = 1 + a1*Math.cos(omega) + a2*Math.cos(2*omega);
      const denImag = a1*(-Math.sin(omega)) + a2*(-Math.sin(2*omega));
      const denMag = Math.sqrt(denReal*denReal + denImag*denImag);

      return denMag < 1e-12 ? 0 : (numMag / denMag);
    }

    // Precompute single-stage biquad coefficients
    const hp1 = getHp1Coeffs(this.hf);
    const hp2 = getHp2Coeffs(this.hf);
    const lp1 = getLp1Coeffs(this.lf);
    const lp2 = getLp2Coeffs(this.lf);

    ctx.beginPath();
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = isMobileLayout ? 2 : 1;

    for (let i = 0; i < width; i++) {
      const freq = Math.pow(10, Math.log10(20) + (i / width) * (Math.log10(40000) - Math.log10(20)));
      const w = 2 * Math.PI * freq / sampleRate;

      // Compute HPF magnitude
      let hpfMag = 1;
      if (hp.order1 > 0) {
        const mag1 = biquadMagnitude(hp1.b0, hp1.b1, hp1.b2, hp1.a1, hp1.a2, w);
        hpfMag *= Math.pow(mag1, hp.order1);
      }
      if (hp.order2 > 0) {
        const mag2 = biquadMagnitude(hp2.b0, hp2.b1, hp2.b2, hp2.a1, hp2.a2, w);
        hpfMag *= Math.pow(mag2, hp.order2);
      }

      // Compute LPF magnitude
      let lpfMag = 1;
      if (lp.order1 > 0) {
        const mag1 = biquadMagnitude(lp1.b0, lp1.b1, lp1.b2, lp1.a1, lp1.a2, w);
        lpfMag *= Math.pow(mag1, lp.order1);
      }
      if (lp.order2 > 0) {
        const mag2 = biquadMagnitude(lp2.b0, lp2.b1, lp2.b2, lp2.a1, lp2.a2, w);
        lpfMag *= Math.pow(mag2, lp.order2);
      }

      // Combined response
      const totalMag = hpfMag * lpfMag;
      const responseDb = 20 * Math.log10(totalMag);
      const y = height * (1 - (responseDb + 30) / 36);

      if (i === 0) {
        ctx.moveTo(i, y);
      } else {
        ctx.lineTo(i, y);
      }
    }
    ctx.stroke();
  }
}

window.NarrowRangePlugin = NarrowRangePlugin;
