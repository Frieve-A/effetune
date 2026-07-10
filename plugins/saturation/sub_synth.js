class SubSynthPlugin extends PluginBase {
  constructor() {
    super("Sub Synth", "Generates and mixes subharmonic signals for bass enhancement");

    // Default parameters
    this.sl = 100;    // Sub Level (%)
    this.dl = 100;    // Dry Level (%)
    this.slf = 160;   // Sub LPF Frequency (Hz)
    this.sls = -12;   // Sub LPF Slope (dB/oct)
    this.shf = 5;     // Sub HPF Frequency (Hz)
    this.shs = -6;    // Sub HPF Slope (dB/oct)
    this.dhf = 40;    // Dry HPF Frequency (Hz)
    this.dhs = 0;     // Dry HPF Slope (dB/oct)

    this.registerProcessor(`
      if (!parameters.enabled) return data;
      
      const { sl, dl, slf, sls, shf, shs, dhf, dhs, channelCount, blockSize, sampleRate } = parameters;
      const sr = sampleRate;
      const subLevelGain = sl / 100;
      const dryLevelGain = dl / 100;  // New Dry Level gain
      
      // Helper to compute stages from slope (in dB/oct)
      function computeStages(slope) {
        const absSlope = Math.abs(slope);
        const n = absSlope / 6;
        return (absSlope === 0) 
            ? { order1: 0, order2: 0 }
            : (n % 2 === 1) 
              ? { order1: 1, order2: (n - 1) / 2 }
              : { order1: 0, order2: n / 2 };
      }
      
      // Compute stage counts for each filter
      const subLpfStages = computeStages(sls);
      const subHpfStages = computeStages(shs);
      const dryHpfStages = computeStages(dhs);
      
      // Preserve channel state across routing changes and reset only chains whose
      // first/second-order topology changed.
      if (!context.filterStates || !context.filterShapes) {
        context.filterStates = { subLpf: [], subHpf: [], dryHpf: [] };
        context.filterShapes = { subLpf: -1, subHpf: -1, dryHpf: -1 };
        context.channelCapacity = 0;
      }

      const channelCapacity = channelCount > context.channelCapacity
        ? channelCount
        : context.channelCapacity;
      const createState = (order) => (order === 1)
        ? { x1: [], y1: [] }
        : { x1: [], x2: [], y1: [], y2: [] };
      const ensureStateCapacity = (state) => {
        while (state.x1.length < channelCapacity) state.x1.push(0);
        while (state.y1.length < channelCapacity) state.y1.push(0);
        if (state.x2) {
          while (state.x2.length < channelCapacity) state.x2.push(0);
          while (state.y2.length < channelCapacity) state.y2.push(0);
        }
      };
      const ensureChain = (key, stages) => {
        const shape = stages.order1 * 16 + stages.order2;
        if (context.filterShapes[key] !== shape) {
          const states = [];
          for (let i = 0; i < stages.order1; i++) states.push(createState(1));
          for (let i = 0; i < stages.order2; i++) states.push(createState(2));
          context.filterStates[key] = states;
          context.filterShapes[key] = shape;
        }
        for (const state of context.filterStates[key]) ensureStateCapacity(state);
      };

      ensureChain('subLpf', subLpfStages);
      ensureChain('subHpf', subHpfStages);
      ensureChain('dryHpf', dryHpfStages);
      context.channelCapacity = channelCapacity;
      
      // Calculate filter coefficients only if needed
      let subLpf1, subLpf2, subHpf1, subHpf2, dryHpf1, dryHpf2;
      
      if (subLpfStages.order1) {
        const c = Math.tan(Math.PI * slf / sr);
        subLpf1 = { b0: c/(1+c), b1: c/(1+c), a1: -((1-c)/(1+c)) };
      }
      if (subLpfStages.order2) {
        const w0 = 2*Math.PI*slf/sr, Q = 1/Math.SQRT2, alpha = Math.sin(w0)/(2*Q);
        const a0 = 1+alpha;
        subLpf2 = {
          b0: ((1-Math.cos(w0))/2)/a0,
          b1: (1-Math.cos(w0))/a0,
          b2: ((1-Math.cos(w0))/2)/a0,
          a1: (-2*Math.cos(w0))/a0,
          a2: (1-alpha)/a0
        };
      }
      
      if (subHpfStages.order1) {
        const c = Math.tan(Math.PI * shf / sr);
        subHpf1 = { b0: 1/(1+c), b1: -1/(1+c), a1: -((1-c)/(1+c)) };
      }
      if (subHpfStages.order2) {
        const w0 = 2*Math.PI*shf/sr, Q = 1/Math.SQRT2, alpha = Math.sin(w0)/(2*Q);
        const a0 = 1+alpha;
        subHpf2 = {
          b0: ((1+Math.cos(w0))/2)/a0,
          b1: (-(1+Math.cos(w0)))/a0,
          b2: ((1+Math.cos(w0))/2)/a0,
          a1: (-2*Math.cos(w0))/a0,
          a2: (1-alpha)/a0
        };
      }
      
      if (dryHpfStages.order1) {
        const c = Math.tan(Math.PI * dhf / sr);
        dryHpf1 = { b0: 1/(1+c), b1: -1/(1+c), a1: -((1-c)/(1+c)) };
      }
      if (dryHpfStages.order2) {
        const w0 = 2*Math.PI*dhf/sr, Q = 1/Math.SQRT2, alpha = Math.sin(w0)/(2*Q);
        const a0 = 1+alpha;
        dryHpf2 = {
          b0: ((1+Math.cos(w0))/2)/a0,
          b1: (-(1+Math.cos(w0)))/a0,
          b2: ((1+Math.cos(w0))/2)/a0,
          a1: (-2*Math.cos(w0))/a0,
          a2: (1-alpha)/a0
        };
      }
      
      // Helper: create a filter chain array from first-order and second-order stages
      function createChain(order1, order2, coeff1, coeff2) {
        const chain = [];
        for (let i = 0; i < order1; i++) chain.push({ type: 1, ...coeff1 });
        for (let i = 0; i < order2; i++) chain.push({ type: 2, ...coeff2 });
        return chain;
      }
      
      const subLpfChain = createChain(subLpfStages.order1, subLpfStages.order2, subLpf1||{}, subLpf2||{});
      const subHpfChain = createChain(subHpfStages.order1, subHpfStages.order2, subHpf1||{}, subHpf2||{});
      const dryHpfChain = createChain(dryHpfStages.order1, dryHpfStages.order2, dryHpf1||{}, dryHpf2||{});
      
      // Cache filter state arrays for speed
      const subLpfStates = context.filterStates.subLpf;
      const subHpfStates = context.filterStates.subHpf;
      const dryHpfStates = context.filterStates.dryHpf;
      
      // Process a filter chain for one sample on a given channel
      function processChain(chain, states, sample, ch) {
        for (let j = 0; j < chain.length; j++) {
          const stage = chain[j], state = states[j], x = sample;
          if (stage.type === 1) {
            sample = stage.b0 * x + stage.b1 * state.x1[ch] - stage.a1 * state.y1[ch];
            state.x1[ch] = x;
            state.y1[ch] = sample;
          } else { // Second-order
            sample = stage.b0 * x + stage.b1 * state.x1[ch] + stage.b2 * state.x2[ch]
                     - stage.a1 * state.y1[ch] - stage.a2 * state.y2[ch];
            state.x2[ch] = state.x1[ch];
            state.x1[ch] = x;
            state.y2[ch] = state.y1[ch];
            state.y1[ch] = sample;
          }
        }
        return sample;
      }
      
      // Process each sample per channel
      for (let ch = 0, offset = 0; ch < channelCount; ch++, offset += blockSize) {
        for (let i = 0; i < blockSize; i++) {
          const idx = offset + i;
          let dry = data[idx];
          let sub = dry >= 0 ? dry : -dry;
          if (subLpfChain.length) sub = processChain(subLpfChain, subLpfStates, sub, ch);
          if (subHpfChain.length) sub = processChain(subHpfChain, subHpfStates, sub, ch);
          if (dryHpfChain.length) dry = processChain(dryHpfChain, dryHpfStates, dry, ch);
          // Mix processed signals with Dry Level and Sub Level gains
          data[idx] = (dry * dryLevelGain) + (sub * subLevelGain);
        }
      }
      
      return data;
    `);
  }

  // Parameter setters with validation
  setSl(value) { this.setParameters({ sl: value }); }
  setDl(value) { this.setParameters({ dl: value }); }  // New setter for Dry Level
  setSlf(value) { this.setParameters({ slf: value }); }
  setSls(value) { this.setParameters({ sls: value }); }
  setShf(value) { this.setParameters({ shf: value }); }
  setShs(value) { this.setParameters({ shs: value }); }
  setDhf(value) { this.setParameters({ dhf: value }); }
  setDhs(value) { this.setParameters({ dhs: value }); }

  getParameters() {
    return {
      type: this.constructor.name,
      enabled: this.enabled,
      sl: this.sl,
      dl: this.dl,  // Include Dry Level parameter
      slf: this.slf,
      sls: this.sls,
      shf: this.shf,
      shs: this.shs,
      dhf: this.dhf,
      dhs: this.dhs
    };
  }

  setParameters(params) {
    if (params.enabled !== undefined) this.enabled = params.enabled;

    // Validate and set Sub Level (sl)
    if (params.sl !== undefined) {
      const value = typeof params.sl === "number" ? params.sl : parseFloat(params.sl);
      if (!isNaN(value)) this.sl = value < 0 ? 0 : (value > 200 ? 200 : value);
    }

    // Validate and set Dry Level (dl)
    if (params.dl !== undefined) {
      const value = typeof params.dl === "number" ? params.dl : parseFloat(params.dl);
      if (!isNaN(value)) this.dl = value < 0 ? 0 : (value > 200 ? 200 : value);
    }

    // Validate and set Sub LPF Frequency (slf)
    if (params.slf !== undefined) {
      const value = typeof params.slf === "number" ? params.slf : parseFloat(params.slf);
      if (!isNaN(value)) this.slf = value < 5 ? 5 : (value > 400 ? 400 : value);
    }

    // Validate and set Sub LPF Slope (sls)
    if (params.sls !== undefined) {
      const value = typeof params.sls === "number" ? params.sls : parseInt(params.sls);
      const allowed = [0, -6, -12, -18, -24];
      if (!isNaN(value) && allowed.includes(value)) this.sls = value;
    }

    // Validate and set Sub HPF Frequency (shf)
    if (params.shf !== undefined) {
      const value = typeof params.shf === "number" ? params.shf : parseFloat(params.shf);
      if (!isNaN(value)) this.shf = value < 5 ? 5 : (value > 400 ? 400 : value);
    }

    // Validate and set Sub HPF Slope (shs)
    if (params.shs !== undefined) {
      const value = typeof params.shs === "number" ? params.shs : parseInt(params.shs);
      const allowed = [0, -6, -12, -18, -24];
      if (!isNaN(value) && allowed.includes(value)) this.shs = value;
    }

    // Validate and set Dry HPF Frequency (dhf)
    if (params.dhf !== undefined) {
      const value = typeof params.dhf === "number" ? params.dhf : parseFloat(params.dhf);
      if (!isNaN(value)) this.dhf = value < 5 ? 5 : (value > 400 ? 400 : value);
    }

    // Validate and set Dry HPF Slope (dhs)
    if (params.dhs !== undefined) {
      const value = typeof params.dhs === "number" ? params.dhs : parseInt(params.dhs);
      const allowed = [0, -6, -12, -18, -24];
      if (!isNaN(value) && allowed.includes(value)) this.dhs = value;
    }

    this.updateParameters();
    this.drawGraph(this.canvas);
  }

  _getCanvasDpr(canvas) {
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const cssWidth = canvas.clientWidth || (rect && rect.width) || canvas.width || 1;
    return canvas.width / cssWidth;
  }

  createUI() {
    const container = document.createElement("div");
    container.className = "sub-synth-plugin-ui plugin-parameter-ui";

    // Helper to create a slope select box
    const createSlopeSelect = (current, onChange, paramName) => {
      const select = document.createElement("select");
      select.className = "slope-select";
      select.id = `${this.id}-${this.name}-${paramName}-select`;
      select.name = `${this.id}-${this.name}-${paramName}-select`;
      select.autocomplete = "off";
      
      const slopes = [0, -6, -12, -18, -24];
      slopes.forEach(slope => {
        const option = document.createElement("option");
        option.value = slope;
        option.textContent = slope === 0 ? "Off" : `${Math.abs(slope)}dB/oct`;
        option.selected = current === slope;
        select.appendChild(option);
      });
      
      // Use the instance canvas for drawing
      select.addEventListener("change", e => {
        onChange(parseInt(e.target.value));
        if (this.canvas) this.drawGraph(this.canvas);
      });
      return select;
    };

    // Create parameter rows using base helper
    const subLevelRow = this.createParameterControl("Sub Level", 0, 200, 1, this.sl, v => this.setSl(v), '%');
    const subLpfRow = this.createParameterControl("Sub LPF", 5, 400, 1, this.slf, v => {
      this.setSlf(v);
      if (this.canvas) this.drawGraph(this.canvas);
    }, 'Hz');
    subLpfRow.appendChild(createSlopeSelect(this.sls, v => this.setSls(v), "sublpfslope"));

    const subHpfRow = this.createParameterControl("Sub HPF", 5, 400, 1, this.shf, v => {
      this.setShf(v);
      if (this.canvas) this.drawGraph(this.canvas);
    }, 'Hz');
    subHpfRow.appendChild(createSlopeSelect(this.shs, v => this.setShs(v), "subhpfslope"));

    const dryLevelRow = this.createParameterControl("Dry Level", 0, 200, 1, this.dl, v => this.setDl(v), '%');
    const dryHpfRow = this.createParameterControl("Dry HPF", 5, 400, 1, this.dhf, v => {
      this.setDhf(v);
      if (this.canvas) this.drawGraph(this.canvas);
    }, 'Hz');
    dryHpfRow.appendChild(createSlopeSelect(this.dhs, v => this.setDhs(v), "dryhpfslope"));

    const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
      maxWidth: 600,
      aspectRatio: "5 / 2",
      mobileAspectRatio: "2 / 1",
      className: "sub-synth-graph",
      onResize: ({ canvas }) => this.drawGraph(canvas)
    });
    canvas.style.backgroundColor = "#222";
    this.canvas = canvas; // Store canvas reference on instance
    this.graphDispose?.();
    this.graphDispose = dispose;

    container.appendChild(subLevelRow);
    container.appendChild(subLpfRow);
    container.appendChild(subHpfRow);
    container.appendChild(dryLevelRow);
    container.appendChild(dryHpfRow);
    container.appendChild(graphContainer);

    // Restore updateParameters override
    this.updateParameters = () => {
      super.updateParameters();
      if (this.canvas) this.drawGraph(this.canvas);
    };

    this.drawGraph(canvas); // Initial draw
    return container;
  }

  drawGraph(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width, height = canvas.height;
    const dpr = this._getCanvasDpr(canvas);
    const cssWidth = width / dpr;
    const tickFont = Math.round(11 * dpr);
    const axisFont = Math.round(13 * dpr);
    const bottomTickY = height - 26 * dpr;
    const axisBottomY = height - 4 * dpr;
    const leftLabelX = 40 * dpr;
    const axisLabelX = 12 * dpr;
    const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "#444";
    ctx.lineWidth = (isMobileLayout ? 1 : 0.5) * dpr;
    const freqs = [5, 10, 20, 50, 100, 200, 500];
    const labeledFreqs = cssWidth < 420 ? [10, 50, 200, 500] : freqs;
    freqs.forEach(freq => {
      const x = width * (Math.log10(freq) - Math.log10(5)) / (Math.log10(1000) - Math.log10(5));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (labeledFreqs.includes(freq) && x > 12 * dpr && x < width - 12 * dpr) {
        ctx.fillStyle = "#666";
        ctx.font = `${tickFont}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText(freq.toString(), x, bottomTickY);
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
        ctx.font = `${tickFont}px Arial`;
        ctx.textAlign = "right";
        ctx.fillText(`${db}dB`, leftLabelX, y + 3 * dpr);
      }
    });
    ctx.fillStyle = "#fff";
    ctx.font = `${axisFont}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText("Frequency (Hz)", width / 2, axisBottomY);
    ctx.save();
    ctx.translate(axisLabelX, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Level (dB)", 0, 0);
    ctx.restore();

    // Helper to compute stages (same as in processor)
    function computeStages(slope) {
      const absSlope = Math.abs(slope);
      const n = absSlope / 6;
      return (absSlope === 0)
        ? { order1: 0, order2: 0 }
        : (n % 2 === 1)
          ? { order1: 1, order2: (n - 1) / 2 }
          : { order1: 0, order2: n / 2 };
    }

    // Draw dry signal response (white)
    ctx.beginPath();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = (isMobileLayout ? 2 : 1) * dpr;
    const dryHpfStages = computeStages(this.dhs);
    for (let i = 0; i < width; i++) {
      const freq = Math.pow(10, Math.log10(5) + (i / width) * (Math.log10(1000) - Math.log10(5)));
      let mag = 1;
      if (this.dhs !== 0) {
        const wRatio = freq / this.dhf;
        if (dryHpfStages.order1) {
          mag *= (wRatio / Math.sqrt(1 + wRatio * wRatio));
        }
        if (dryHpfStages.order2) {
          const secondOrder = (wRatio * wRatio) / Math.sqrt(1 + 2 * wRatio * wRatio + Math.pow(wRatio, 4));
          mag *= Math.pow(secondOrder, dryHpfStages.order2);
        }
      }
      const response = 20 * Math.log10(mag);
      const y = height * (1 - (response + 30) / 36);
      i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
    }
    ctx.stroke();

    // Draw sub signal response (green)
    ctx.beginPath();
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = (isMobileLayout ? 2 : 1) * dpr;
    const subLpfStages = computeStages(this.sls);
    const subHpfStages = computeStages(this.shs);
    for (let i = 0; i < width; i++) {
      const freq = Math.pow(10, Math.log10(5) + (i / width) * (Math.log10(1000) - Math.log10(5)));
      let mag = this.sl / 100;
      if (this.sls !== 0) {
        const wRatio = freq / this.slf;
        if (subLpfStages.order1) {
          mag *= (1 / Math.sqrt(1 + wRatio * wRatio));
        }
        if (subLpfStages.order2) {
          const secondOrder = 1 / Math.sqrt(1 + 2 * wRatio * wRatio + Math.pow(wRatio, 4));
          mag *= Math.pow(secondOrder, subLpfStages.order2);
        }
      }
      if (this.shs !== 0) {
        const wRatio = freq / this.shf;
        if (subHpfStages.order1) {
          mag *= (wRatio / Math.sqrt(1 + wRatio * wRatio));
        }
        if (subHpfStages.order2) {
          const secondOrder = (wRatio * wRatio) / Math.sqrt(1 + 2 * wRatio * wRatio + Math.pow(wRatio, 4));
          mag *= Math.pow(secondOrder, subHpfStages.order2);
        }
      }
      const response = 20 * Math.log10(mag);
      const y = height * (1 - (response + 30) / 36);
      i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
    }
    ctx.stroke();
  }

  cleanup() {
    this.graphDispose?.();
    this.graphDispose = null;
    super.cleanup();
  }
}

window.SubSynthPlugin = SubSynthPlugin;
