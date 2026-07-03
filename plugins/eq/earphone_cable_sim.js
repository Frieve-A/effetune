class EarphoneCableSimPlugin extends PluginBase {
  // Default resonance presets.
  // Slot 0 mirrors the Earphone Cable Impact Analyzer default (single dynamic-driver
  // fundamental resonance) and is the only one enabled by default.
  // Slots 1-4 are pre-set to typical impedance peaks of various driver types so they
  // can simply be toggled on.
  static RES_DEFAULTS = [
    { f: 120,   q: 2.0, z: 48,  e: true  }, // Dynamic driver fundamental (Fs)
    { f: 2000,  q: 1.5, z: 36,  e: false }, // Balanced-armature mid branch
    { f: 5000,  q: 2.0, z: 64,  e: false }, // BA driver
    { f: 9000,  q: 3.0, z: 80,  e: false }, // BA tweeter / crossover peak
    { f: 60,    q: 1.5, z: 64,  e: false }  // Large dynamic driver bass peak
  ];

  static NUM_RES = 5;

  // AudioWorklet processor function: cascade of biquad sections whose coefficients
  // are pre-computed on the main thread (this.sos) from the physical impedance model.
  static processorFunction = `
  if (!parameters.enabled) return data;
  const sos = parameters.sos;
  if (!sos || sos.length === 0) return data;

  const { channelCount, blockSize, sampleRate } = parameters;

  const makeStates = (n) => {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) {
      arr[i] = {
        x1: new Float64Array(channelCount),
        x2: new Float64Array(channelCount),
        y1: new Float64Array(channelCount),
        y2: new Float64Array(channelCount)
      };
    }
    return arr;
  };

  // Initialise (first run or channel-count change).
  if (!context.initialized || context.lastChannelCount !== channelCount) {
    context.activeSos = sos;
    context.activeStates = makeStates(sos.length);
    context.oldSos = null;
    context.oldStates = null;
    context.fade = 1.0;
    context.fadeStep = 0.0;
    context.lastChannelCount = channelCount;
    context.initialized = true;
  }

  // Coefficient set changed -> crossfade the old output into the new one over a few
  // milliseconds. Toggling a resonance changes the section count and the coefficients;
  // without this the filter state would jump (or be reset), producing a loud click and a
  // slowly decaying DC-like thump. The old cascade keeps running and is faded out while
  // the new one starts from a clean (zero) state. (Seeding the new sections from the old
  // ones is wrong: the polynomial is re-factored, so sections do not correspond and the
  // injected state causes a large overshoot.)
  if (sos !== context.activeSos) {
    context.oldSos = context.activeSos;
    context.oldStates = context.activeStates;
    context.activeSos = sos;
    context.activeStates = makeStates(sos.length);
    let fadeSamples = Math.round((sampleRate || 48000) * 0.02);
    if (fadeSamples < 128) fadeSamples = 128;
    context.fadeStep = 1.0 / fadeSamples;
    context.fade = 0.0;
  }

  const activeSos = context.activeSos;
  const activeStates = context.activeStates;
  const nActive = activeSos.length;
  const oldSos = context.oldSos;
  const oldStates = context.oldStates;
  const fadeStep = context.fadeStep;
  let fade = context.fade;
  const fading = fade < 1.0 && oldSos !== null;
  const nOld = fading ? oldSos.length : 0;

  for (let i = 0; i < blockSize; i++) {
    const t = fade < 1.0 ? fade : 1.0;
    for (let ch = 0; ch < channelCount; ch++) {
      const idx = ch * blockSize + i;
      const x = data[idx];

      // New (target) cascade — always runs so its state stays current.
      let vn = x;
      for (let s = 0; s < nActive; s++) {
        const c = activeSos[s];
        const st = activeStates[s];
        const x1 = st.x1[ch], x2 = st.x2[ch], y1 = st.y1[ch], y2 = st.y2[ch];
        const y = c.b0 * vn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        st.x2[ch] = x1; st.x1[ch] = vn; st.y2[ch] = y1; st.y1[ch] = y;
        vn = y;
      }

      if (fading) {
        // Old cascade keeps running and is faded out.
        let vo = x;
        for (let s = 0; s < nOld; s++) {
          const c = oldSos[s];
          const st = oldStates[s];
          const x1 = st.x1[ch], x2 = st.x2[ch], y1 = st.y1[ch], y2 = st.y2[ch];
          const y = c.b0 * vo + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
          st.x2[ch] = x1; st.x1[ch] = vo; st.y2[ch] = y1; st.y1[ch] = y;
          vo = y;
        }
        data[idx] = vo + (vn - vo) * t;
      } else {
        data[idx] = vn;
      }
    }
    if (fading && fade < 1.0) { fade += fadeStep; if (fade > 1.0) fade = 1.0; }
  }

  context.fade = fading ? fade : 1.0;
  if (context.fade >= 1.0) { context.oldSos = null; context.oldStates = null; }
  return data;
  `;

  constructor() {
    super('Earphone Cable Sim', 'Simulates the frequency response from output impedance and earphone cable interacting with the earphone load impedance');

    this._sampleRate = 96000;
    this.uiCreated = false;
    this._sosDirty = true;
    this.sos = [];
    this._sosCacheKey = null;
    this._sosCacheValue = null;

    // --- Amplifier / cable parameters (mirrors the analyzer app) ---
    this.zo = 0.5;   // Output impedance (Ohm)         0 - 20
    this.rc = 0.30;  // Cable DC resistance (Ohm)       0 - 2
    this.lc = 0.5;   // Cable inductance (uH)           0 - 5
    this.lv = 0.20;  // Voice coil inductance (mH)      0.01 - 2
    this.zb = 16;    // Base (nominal) impedance (Ohm)  4 - 64

    // --- Resonances ---
    for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
      const d = EarphoneCableSimPlugin.RES_DEFAULTS[i];
      this['rf' + i] = d.f; // resonance frequency (Hz)
      this['rq' + i] = d.q; // Q factor
      this['rz' + i] = d.z; // peak impedance (Ohm)
      this['re' + i] = d.e; // enabled
    }

    this.onMessage = (message) => {
      if (message.sampleRate !== undefined && message.sampleRate !== this._sampleRate) {
        this._sampleRate = message.sampleRate;
        this._sosDirty = true;
        this.computeCoefficients();
        this.updateParameters();
        if (this.responseSvg) this.updateResponse();
      }
    };

    this.computeCoefficients();
    this.registerProcessor(EarphoneCableSimPlugin.processorFunction);
  }

  /* ============================================================
   *  Complex / polynomial helpers
   * ============================================================ */
  static _cadd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
  static _csub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
  static _cmul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
  static _cdiv(a, b) {
    let d = b.re * b.re + b.im * b.im;
    if (d < 1e-300) d = 1e-300;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }
  static _cabs(a) { return Math.hypot(a.re, a.im); }

  // Polynomials are real-coefficient arrays, low -> high order.
  static _pmul(a, b) {
    const r = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
    return r;
  }
  static _padd(a, b) {
    const n = Math.max(a.length, b.length);
    const r = new Array(n).fill(0);
    for (let i = 0; i < a.length; i++) r[i] += a[i];
    for (let i = 0; i < b.length; i++) r[i] += b[i];
    return r;
  }

  // Durand-Kerner root finder for a real-coefficient polynomial (low -> high order).
  static _roots(poly) {
    const C = EarphoneCableSimPlugin;
    let a = poly.slice();
    while (a.length > 1 && Math.abs(a[a.length - 1]) < 1e-14) a.pop();
    const n = a.length - 1;
    if (n <= 0) return [];
    const lead = a[a.length - 1];
    const m = a.map(x => x / lead); // monic, low -> high
    const evalp = (x) => {
      let r = { re: 0, im: 0 };
      for (let i = m.length - 1; i >= 0; i--) r = C._cadd(C._cmul(r, x), { re: m[i], im: 0 });
      return r;
    };
    let z = [];
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * i) / n + 0.4;
      z.push({ re: 0.5 * Math.cos(ang), im: 0.5 * Math.sin(ang) });
    }
    for (let it = 0; it < 500; it++) {
      let maxd = 0;
      for (let i = 0; i < n; i++) {
        let denom = { re: 1, im: 0 };
        for (let j = 0; j < n; j++) if (j !== i) denom = C._cmul(denom, C._csub(z[i], z[j]));
        const dz = C._cdiv(evalp(z[i]), denom);
        z[i] = C._csub(z[i], dz);
        const d = C._cabs(dz);
        if (d > maxd) maxd = d;
      }
      if (maxd < 1e-13) break;
    }
    return z;
  }

  // Group complex roots (with real coefficients) into 2nd / 1st order section
  // denominators of the form [1, b1, b2] (z^-1 polynomial coefficients).
  static _pairRoots(rts) {
    const used = new Array(rts.length).fill(false);
    const secs = [];
    for (let i = 0; i < rts.length; i++) {
      if (used[i]) continue;
      if (Math.abs(rts[i].im) < 1e-9) {
        used[i] = true;
        secs.push([1, -rts[i].re, 0]);
      } else {
        // find the closest conjugate partner
        let best = -1, bd = Infinity;
        for (let j = i + 1; j < rts.length; j++) {
          if (used[j]) continue;
          const d = Math.abs(rts[j].re - rts[i].re) + Math.abs(rts[j].im + rts[i].im);
          if (d < bd) { bd = d; best = j; }
        }
        used[i] = true;
        if (best >= 0) used[best] = true;
        const re = rts[i].re;
        const mag2 = rts[i].re * rts[i].re + rts[i].im * rts[i].im;
        secs.push([1, -2 * re, mag2]);
      }
    }
    return secs;
  }

  /* ============================================================
   *  Physical model
   * ============================================================ */
  // Load impedance of the earphone (Zmin + jwLvc + sum of resonances), per ecia.js.
  _zload(f) {
    const C = EarphoneCableSimPlugin;
    const w = 2 * Math.PI * f;
    let z = { re: this.zb, im: w * this.lv * 1e-3 };
    for (let k = 0; k < C.NUM_RES; k++) {
      if (!this['re' + k]) continue;
      const fr = this['rf' + k], Q = this['rq' + k], zp = this['rz' + k];
      const ratio = f / fr - fr / f;
      const denom = { re: 1, im: Q * ratio };
      z = C._cadd(z, C._cdiv({ re: zp - this.zb, im: 0 }, denom));
    }
    return z;
  }

  // Total transfer function (with cable + output impedance), complex.
  _hphys(f) {
    const C = EarphoneCableSimPlugin;
    const w = 2 * Math.PI * f;
    const zl = this._zload(f);
    const zt = { re: this.zo + this.rc + zl.re, im: w * this.lc * 1e-6 + zl.im };
    return C._cdiv(zl, zt);
  }

  /* ============================================================
   *  Coefficient computation: physical model -> biquad cascade
   * ============================================================ */
  computeCoefficients() {
    if (!this._sosDirty) return;
    this.sos = this._buildSos(this._sampleRate || 96000);
    this._sosDirty = false;
    this._sosCacheKey = null;
    this._sosCacheValue = null;
  }

  _buildSos(fs) {
    const C = EarphoneCableSimPlugin;
    const wref = 2 * Math.PI * 1000; // normalisation frequency (sigma = s / wref)

    // Collect enabled resonances.
    const res = [];
    for (let k = 0; k < C.NUM_RES; k++) {
      if (this['re' + k]) res.push({ f: this['rf' + k], q: this['rq' + k], z: this['rz' + k] });
    }

    const lv = this.lv * 1e-3 * wref; // normalised voice-coil inductance term
    const lc = this.lc * 1e-6 * wref; // normalised cable inductance term
    const Rs = this.zo + this.rc;     // series resistance (output + cable DC)
    const N = res.length;

    // Per-resonance denominator Dk(sigma) = (Q/x0) s^2 + s + Q*x0, x0 = f0/1000.
    const Dk = res.map(r => { const x0 = r.f / 1000; return [r.q * x0, 1, r.q / x0]; });

    let Dprod = [1];
    for (const d of Dk) Dprod = C._pmul(Dprod, d);

    // others[k] = product of all Dj for j != k.
    const others = res.map((_, k) => {
      let pr = [1];
      for (let j = 0; j < N; j++) if (j !== k) pr = C._pmul(pr, Dk[j]);
      return pr;
    });

    // Nload(sigma) = (Zmin + lv*sigma)*Dprod + sum_k (zp-Zmin)*sigma*others[k]
    let Nload = C._pmul([this.zb, lv], Dprod);
    for (let k = 0; k < N; k++) {
      const Rk = res[k].z - this.zb;
      Nload = C._padd(Nload, C._pmul([0, Rk], others[k]));
    }

    // Den(sigma) = (Rs + lc*sigma)*Dprod + Nload
    const Den = C._padd(C._pmul([Rs, lc], Dprod), Nload);

    // Factor numerator (zeros) and denominator (poles), then map each analog root to the
    // z-plane with the matched-Z transform (z = e^{sT}). Unlike the bilinear transform it
    // preserves every pole/zero frequency exactly (no frequency warping), so the realised
    // response stays faithful to the physical model across the whole audible band. (The
    // bilinear warping otherwise costs tens of percent of relative error versus the small,
    // smooth target response.) Analog poles lie in the left half plane, so
    // |z| = e^{Re(s)/fs} < 1 and every section is stable.
    const k = wref / fs; // s = sigma * wref, T = 1/fs  =>  z = exp(sigma * wref / fs)
    const dig = (r) => {
      const mag = Math.exp(r.re * k);
      const ang = r.im * k;
      return { re: mag * Math.cos(ang), im: mag * Math.sin(ang) };
    };
    const zz = C._roots(Nload).map(dig);
    const zp = C._roots(Den).map(dig);

    const zSecs = C._pairRoots(zz);
    const pSecs = C._pairRoots(zp);

    const n = Math.max(zSecs.length, pSecs.length);
    const sos = [];
    for (let i = 0; i < n; i++) {
      const b = zSecs[i] || [1, 0, 0];
      const a = pSecs[i] || [1, 0, 0];
      sos.push({ b0: b[0], b1: b[1], b2: b[2], a1: a[1], a2: a[2] });
    }

    // Normalise to 0 dB power-average over 20 Hz - 20 kHz (matches the analyzer and
    // keeps loudness constant when the effect is toggled), then fold the makeup gain
    // into the first section.
    const makeup = this._makeupGain(sos);
    if (sos.length > 0) {
      sos[0].b0 *= makeup; sos[0].b1 *= makeup; sos[0].b2 *= makeup;
    }

    return sos;
  }

  // Power-average of the realised cascade magnitude over 20 Hz - 20 kHz -> makeup gain.
  _makeupGain(sos) {
    const fs = this._sampleRate || 96000;
    const POINTS = 256;
    const fmin = 20, fmax = 20000;
    let sum = 0;
    for (let i = 0; i < POINTS; i++) {
      const f = fmin * Math.pow(fmax / fmin, i / (POINTS - 1));
      const mag = this._cascadeMag(sos, f, fs);
      sum += mag * mag;
    }
    const avg = Math.sqrt(sum / POINTS);
    return avg > 1e-9 ? 1 / avg : 1;
  }

  _cascadeMag(sos, f, fs) {
    const C = EarphoneCableSimPlugin;
    const w = (2 * Math.PI * f) / fs;
    const z1 = { re: Math.cos(-w), im: Math.sin(-w) };
    const z2 = C._cmul(z1, z1);
    let H = { re: 1, im: 0 };
    for (const s of sos) {
      const num = C._cadd(C._cadd({ re: s.b0, im: 0 }, C._cmul({ re: s.b1, im: 0 }, z1)), C._cmul({ re: s.b2, im: 0 }, z2));
      const den = C._cadd(C._cadd({ re: 1, im: 0 }, C._cmul({ re: s.a1, im: 0 }, z1)), C._cmul({ re: s.a2, im: 0 }, z2));
      H = C._cmul(H, C._cdiv(num, den));
    }
    return C._cabs(H);
  }

  /* ============================================================
   *  Parameter management
   * ============================================================ */
  _sosSignature() {
    const values = [this.zo, this.rc, this.lc, this.lv, this.zb];
    for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
      values.push(this['rf' + i], this['rq' + i], this['rz' + i], this['re' + i] ? 1 : 0);
    }
    return values.join('|');
  }

  _getSosForSampleRate(sampleRate) {
    const fallbackRate = this._sampleRate || 96000;
    const fs = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : fallbackRate;
    if (fs === fallbackRate) {
      this.computeCoefficients();
      return this.sos;
    }

    const key = `${fs}|${this._sosSignature()}`;
    if (this._sosCacheKey !== key) {
      this._sosCacheKey = key;
      this._sosCacheValue = this._buildSos(fs);
    }
    return this._sosCacheValue;
  }

  getParameters(options = {}) {
    const optionSampleRate = options && options.sampleRate;
    if (options && options.commitSampleRate &&
        Number.isFinite(optionSampleRate) && optionSampleRate > 0 &&
        optionSampleRate !== this._sampleRate) {
      this._sampleRate = optionSampleRate;
      this._sosDirty = true;
      this.computeCoefficients();
      if (this.responseSvg) this.updateResponse();
    }

    const params = { type: this.constructor.name, enabled: this.enabled };
    params.zo = this.zo; params.rc = this.rc; params.lc = this.lc;
    params.lv = this.lv; params.zb = this.zb;
    for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
      params['rf' + i] = this['rf' + i];
      params['rq' + i] = this['rq' + i];
      params['rz' + i] = this['rz' + i];
      params['re' + i] = this['re' + i];
    }
    params.sos = this._getSosForSampleRate(options && options.sampleRate);
    return params;
  }

  getSerializableParameters() {
    const { type, enabled, sos, ...params } = this.getParameters();
    return params;
  }

  setParameters(params) {
    const num = (v) => (typeof v === 'number' ? v : parseFloat(v));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let changed = false;

    if (params.enabled !== undefined) this.enabled = params.enabled;

    if (params.zo !== undefined) { const v = num(params.zo); if (!isNaN(v)) { this.zo = clamp(v, 0, 20); changed = true; } }
    if (params.rc !== undefined) { const v = num(params.rc); if (!isNaN(v)) { this.rc = clamp(v, 0, 2); changed = true; } }
    if (params.lc !== undefined) { const v = num(params.lc); if (!isNaN(v)) { this.lc = clamp(v, 0, 5); changed = true; } }
    if (params.lv !== undefined) { const v = num(params.lv); if (!isNaN(v)) { this.lv = clamp(v, 0.01, 2); changed = true; } }
    if (params.zb !== undefined) { const v = num(params.zb); if (!isNaN(v)) { this.zb = clamp(v, 4, 64); changed = true; } }

    for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
      if (params['rf' + i] !== undefined) { const v = num(params['rf' + i]); if (!isNaN(v)) { this['rf' + i] = clamp(v, 20, 20000); changed = true; } }
      if (params['rq' + i] !== undefined) { const v = num(params['rq' + i]); if (!isNaN(v)) { this['rq' + i] = clamp(v, 0.5, 10); changed = true; } }
      if (params['rz' + i] !== undefined) { const v = num(params['rz' + i]); if (!isNaN(v)) { this['rz' + i] = clamp(v, 16, 116); changed = true; } }
      if (params['re' + i] !== undefined) { this['re' + i] = !!params['re' + i]; changed = true; }
    }

    if (changed) {
      this._sosDirty = true;
      this.computeCoefficients();
    }
    this.updateParameters();
    if (this.uiCreated) this.setUIValues();
    if (this.responseSvg) this.updateResponse();
  }

  // Individual setters -------------------------------------------------------
  setZo(v) { this.setParameters({ zo: v }); }
  setRc(v) { this.setParameters({ rc: v }); }
  setLc(v) { this.setParameters({ lc: v }); }
  setLv(v) { this.setParameters({ lv: v }); }
  setZb(v) { this.setParameters({ zb: v }); }
  setRes(i, prop, v) { this.setParameters({ [prop + i]: v }); }

  reset() {
    this.zo = 0.5; this.rc = 0.30; this.lc = 0.5; this.lv = 0.20; this.zb = 16;
    for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
      const d = EarphoneCableSimPlugin.RES_DEFAULTS[i];
      this['rf' + i] = d.f; this['rq' + i] = d.q; this['rz' + i] = d.z; this['re' + i] = d.e;
    }
    this.enabled = true;
    this._sosDirty = true;
    this.computeCoefficients();
    this.updateParameters();
    if (this.uiCreated) this.setUIValues();
    if (this.responseSvg) this.updateResponse();
  }

  /* ============================================================
   *  UI
   * ============================================================ */
  createUI() {
    this.disconnectGraphResizeObserver();
    const container = document.createElement('div');
    container.className = 'earphone-cable-sim-plugin-ui plugin-parameter-ui';

    // ---- Graph (grid + response SVG, modelled after 5Band PEQ) ----
    const graphContainer = document.createElement('div');
    graphContainer.className = 'earphone-cable-sim-graph';

    const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    gridSvg.setAttribute('class', 'earphone-cable-sim-grid');
    gridSvg.setAttribute('width', '100%');
    gridSvg.setAttribute('height', '100%');
    graphContainer.appendChild(gridSvg);

    const responseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    responseSvg.setAttribute('class', 'earphone-cable-sim-response');
    responseSvg.setAttribute('width', '100%');
    responseSvg.setAttribute('height', '100%');
    responseSvg.setAttribute('preserveAspectRatio', 'none');
    graphContainer.appendChild(responseSvg);

    this.graphContainer = graphContainer;
    this.gridSvg = gridSvg;
    this.responseSvg = responseSvg;
    this.observeGraphResize(graphContainer);
    container.appendChild(graphContainer);

    // ---- Amplifier / cable parameters ----
    const ampSection = document.createElement('div');
    ampSection.className = 'earphone-cable-sim-amp';
    ampSection.appendChild(this.createParameterControl('Output Z', 0, 20, 0.1, this.zo, (v) => this.setZo(v), 'Ω'));
    ampSection.appendChild(this.createParameterControl('Cable R', 0, 2, 0.01, this.rc, (v) => this.setRc(v), 'Ω'));
    ampSection.appendChild(this.createParameterControl('Cable L', 0, 5, 0.1, this.lc, (v) => this.setLc(v), 'µH'));
    ampSection.appendChild(this.createParameterControl('Voice Coil L', 0.01, 2, 0.01, this.lv, (v) => this.setLv(v), 'mH'));
    ampSection.appendChild(this.createParameterControl('Base Z', 4, 64, 1, this.zb, (v) => this.setZb(v), 'Ω'));
    container.appendChild(ampSection);

    // ---- Resonance controls (5 columns, modelled after 5Band PEQ) ----
    const controls = document.createElement('div');
    controls.className = 'earphone-cable-sim-controls';
    this.resInputs = [];

    for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
      const col = document.createElement('div');
      col.className = 'earphone-cable-sim-res';
      col.dataset.res = i;

      // Enable checkbox + title
      const labelContainer = document.createElement('label');
      labelContainer.className = 'earphone-cable-sim-res-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'earphone-cable-sim-res-checkbox';
      checkbox.id = `${this.id}-${this.name}-res-${i}-checkbox`;
      checkbox.name = checkbox.id;
      checkbox.checked = this['re' + i];
      checkbox.autocomplete = 'off';
      checkbox.addEventListener('change', () => this.setRes(i, 're', checkbox.checked));
      labelContainer.appendChild(checkbox);
      labelContainer.appendChild(document.createTextNode(`Resonance ${i + 1}`));
      col.appendChild(labelContainer);

      const refs = {};
      const mkRow = (labelText, prop, min, max, step, toFixed) => {
        const row = document.createElement('div');
        row.className = 'earphone-cable-sim-row';
        const lbl = document.createElement('label');
        lbl.className = 'earphone-cable-sim-row-label';
        lbl.textContent = labelText;
        const inputId = `${this.id}-${this.name}-res-${i}-${prop}`;
        lbl.htmlFor = inputId;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'earphone-cable-sim-row-input';
        input.id = inputId;
        input.name = inputId;
        input.min = min; input.max = max; input.step = step;
        input.value = this[prop + i].toFixed(toFixed);
        input.autocomplete = 'off';
        input.addEventListener('input', () => this.setRes(i, prop, parseFloat(input.value)));
        input.addEventListener('change', () => { input.value = this[prop + i].toFixed(toFixed); });
        row.appendChild(lbl); row.appendChild(input);
        col.appendChild(row);
        refs[prop] = input;
      };

      mkRow('Freq (Hz):', 'rf', 20, 20000, 1, 0);
      mkRow('Q:', 'rq', 0.5, 10, 0.1, 1);
      mkRow('Peak Z (Ω):', 'rz', 16, 116, 1, 0);

      refs.checkbox = checkbox;
      this.resInputs[i] = refs;
      controls.appendChild(col);
    }
    container.appendChild(controls);

    this.uiContainer = container;
    this.uiCreated = true;

    setTimeout(() => this.updateResponse(), 0);
    return container;
  }

  setUIValues() {
    if (!this.uiCreated || !this.uiContainer) return;
    // Amplifier / cable sliders (created via createParameterControl, queried by id).
    const syncCtl = (label, value, toFixed) => {
      const base = `${this.id}-${this.name}-${label.toLowerCase().replace(/\s+/g, '-')}`;
      const slider = document.getElementById(`${base}-slider`);
      const valueInput = document.getElementById(`${base}-value`);
      if (slider) slider.value = value;
      if (valueInput) valueInput.value = value.toFixed(toFixed);
    };
    syncCtl('Output Z', this.zo, 1);
    syncCtl('Cable R', this.rc, 2);
    syncCtl('Cable L', this.lc, 1);
    syncCtl('Voice Coil L', this.lv, 2);
    syncCtl('Base Z', this.zb, 0);

    if (this.resInputs) {
      for (let i = 0; i < EarphoneCableSimPlugin.NUM_RES; i++) {
        const r = this.resInputs[i];
        if (!r) continue;
        if (r.checkbox) r.checkbox.checked = this['re' + i];
        if (r.rf) r.rf.value = this['rf' + i].toFixed(0);
        if (r.rq) r.rq.value = this['rq' + i].toFixed(1);
        if (r.rz) r.rz.value = this['rz' + i].toFixed(0);
      }
    }
  }

  /* ============================================================
   *  Graph (white grid + green response, SVG like 5Band PEQ)
   * ============================================================ */
  // Frequency axis spans 10 Hz - 40 kHz exactly like 5Band PEQ, so the labelled
  // grid frequencies (20 Hz - 20 kHz) sit inset from the edges (no border frame).
  freqToX(freq) {
    return (Math.log10(Math.max(10, Math.min(freq, 40000))) - Math.log10(10)) / (Math.log10(40000) - Math.log10(10)) * 100;
  }

  gainToY(gain) {
    const R = this._dbMapRange || 13.2;
    return 50 - (gain / R) * 50;
  }

  observeGraphResize(container) {
    this.disconnectGraphResizeObserver();
    if (!container) return;

    this.lastGraphSize = { width: 0, height: 0 };
    const handleResize = () => {
      const rect = container.getBoundingClientRect?.() || { width: 0, height: 0 };
      const width = container.clientWidth || rect.width;
      const height = container.clientHeight || rect.height;
      if (!width || !height) return;
      if (this.lastGraphSize.width === width && this.lastGraphSize.height === height) return;
      this.lastGraphSize = { width, height };
      this.updateResponse();
    };
    this.graphResizeHandler = handleResize;

    const ResizeObserverClass = typeof ResizeObserver !== 'undefined'
      ? ResizeObserver
      : (typeof window !== 'undefined' ? window.ResizeObserver : null);
    if (typeof ResizeObserverClass === 'function') {
      this.graphResizeObserver = new ResizeObserverClass(handleResize);
      this.graphResizeObserver.observe(container);
      return;
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', handleResize);
      this.graphResizeWindowListener = handleResize;
    }
  }

  disconnectGraphResizeObserver() {
    if (this.graphResizeObserver) {
      this.graphResizeObserver.disconnect();
      this.graphResizeObserver = null;
    }
    if (this.graphResizeWindowListener && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this.graphResizeWindowListener);
    }
    this.graphResizeWindowListener = null;
    this.graphResizeHandler = null;
    this.lastGraphSize = null;
  }

  // Rebuild the grid. The full-scale mapping range (this._dbMapRange) carries extra
  // headroom beyond the outermost label so every line and number stays inside the graph.
  buildGrid(labelMag) {
    const svg = this.gridSvg;
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    freqs.forEach(freq => {
      const x = this.freqToX(freq);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', `${x}%`); line.setAttribute('x2', `${x}%`);
      line.setAttribute('y1', '0'); line.setAttribute('y2', '100%');
      svg.appendChild(line);
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', `${x}%`); text.setAttribute('y', '95%');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      svg.appendChild(text);
    });

    const gains = [labelMag, labelMag / 2, 0, -labelMag / 2, -labelMag];
    gains.forEach(gain => {
      const y = this.gainToY(gain);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', '0'); line.setAttribute('x2', '100%');
      line.setAttribute('y1', `${y}%`); line.setAttribute('y2', `${y}%`);
      svg.appendChild(line);
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', '1%'); text.setAttribute('y', `${y}%`);
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = `${gain > 0 ? '+' : ''}${Number.isInteger(gain) ? gain.toFixed(0) : gain.toFixed(1)}dB`;
      svg.appendChild(text);
    });
  }

  updateResponse() {
    if (!this.responseSvg) return;
    const width = this.responseSvg.clientWidth;
    const height = this.responseSvg.clientHeight;
    if (!width || !height) return;
    this.responseSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.responseSvg.setAttribute('preserveAspectRatio', 'none');

    // Plot the response of the realised biquad cascade (what is actually applied to the
    // audio), not the ideal physical model. The digital filter is only defined up to
    // Nyquist, so evaluation frequencies are clamped just below it.
    const sos = this.sos;
    const fsr = this._sampleRate || 96000;
    const nyq = fsr * 0.5 * 0.999;

    // 0 dB reference = power-average over the audible band (20 Hz - 20 kHz),
    // matching the audio makeup normalisation.
    const NB = 256;
    let sumP = 0;
    for (let j = 0; j < NB; j++) {
      const f = Math.min(20 * Math.pow(1000, j / (NB - 1)), nyq);
      const mag = this._cascadeMag(sos, f, fsr);
      sumP += mag * mag;
    }
    const avgDb = 10 * Math.log10(sumP / NB);

    // Plot across the full graph width (10 Hz - 40 kHz) like 5Band PEQ.
    const minFreq = 10, maxFreq = 40000;
    const numPoints = Math.max(200, Math.floor(width));
    const freqs = new Float64Array(numPoints + 1);
    const db = new Float64Array(numPoints + 1);
    let maxAbs = 0;
    for (let i = 0; i <= numPoints; i++) {
      const f = minFreq * Math.pow(maxFreq / minFreq, i / numPoints);
      freqs[i] = f;
      const d = 20 * Math.log10(this._cascadeMag(sos, Math.min(f, nyq), fsr)) - avgDb;
      db[i] = d;
      if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    }

    // Pick the outermost label magnitude, then add headroom for the mapping range
    // so the curve and labels never touch the boundary.
    const steps = [0.5, 1, 1.5, 3, 6, 12, 24, 48];
    let labelMag = steps[steps.length - 1];
    for (const s of steps) { if (Math.max(0.5, maxAbs) <= s) { labelMag = s; break; } }
    this._dbMapRange = labelMag * 1.1;

    this.buildGrid(labelMag);

    const pathPoints = [];
    for (let i = 0; i <= numPoints; i++) {
      const x = this.freqToX(freqs[i]) * width / 100;
      const y = this.gainToY(db[i]) * height / 100;
      pathPoints.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    while (this.responseSvg.firstChild) this.responseSvg.removeChild(this.responseSvg.firstChild);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathPoints.join(' '));
    this.responseSvg.appendChild(path);
  }

  cleanup() {
    this.disconnectGraphResizeObserver();
    super.cleanup();
  }
}

if (typeof window !== 'undefined') {
  window.EarphoneCableSimPlugin = EarphoneCableSimPlugin;
}
