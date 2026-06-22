class FiveBandPEQPlugin extends PluginBase {
  // Initial band frequencies (approximately logarithmically spaced)
  static BANDS = [
    { freq: 100, name: '100 Hz' },
    { freq: 316, name: '316 Hz' },
    { freq: 1000, name: '1.0 kHz' },
    { freq: 3160, name: '3.16 kHz' },
    { freq: 10000, name: '10 kHz' }
  ];

  // Filter types
  static FILTER_TYPES = [
    { id: 'pk', name: 'Peaking' },
    { id: 'lp', name: 'LowPass' },
    { id: 'hp', name: 'HighPass' },
    { id: 'ls', name: 'LowShelv' },
    { id: 'hs', name: 'HighShel' },
    { id: 'bp', name: 'BandPass' },
    { id: 'no', name: 'Notch' },
    { id: 'ap', name: 'AllPass' }
  ];

  // AudioWorklet processor function (internal processing)
  static processorFunction = `
  // --- Constants ---
  const BYPASS_THRESHOLD = 0.01; 
  const A0_THRESHOLD = 1e-8;     
  const PI = 3.141592653589793;
  const TWO_PI = 6.283185307179586;
  const NUM_BANDS = 5;          
  const SHELF_Q_MAX = 2.0;       
  const GENERAL_Q_MIN = 0.1;     
  
  // --- Early Exit ---
  if (!parameters.enabled) return data;
  
  // --- Parameter & Context Caching ---
  const { channelCount, blockSize, sampleRate } = parameters;
  const sampleRateInv = 1.0 / sampleRate;
  const twoPiTimesSrInv = TWO_PI * sampleRateInv; 
  
  // --- State Initialization & Management ---
  if (!context.initialized || context.lastChannelCount !== channelCount) {
      context.filterStates = new Array(NUM_BANDS);
      for (let i = 0; i < NUM_BANDS; i++) {
          context.filterStates[i] = {
              x1: new Array(channelCount).fill(0.0),
              x2: new Array(channelCount).fill(0.0),
              y1: new Array(channelCount).fill(0.0),
              y2: new Array(channelCount).fill(0.0)
          };
      }
      context.lastChannelCount = channelCount;
      context.initialized = true;
      context.lastParams = null; 
  }
  
  const filterStates = context.filterStates;
  
  // --- Parameter Change Detection & Coefficient Caching ---
  let currentParamsString = '';
  for (let i = 0; i < NUM_BANDS; i++) {
      currentParamsString += \`\${parameters['e' + i]},\${parameters['g' + i]},\${parameters['t' + i]},\${parameters['f' + i]},\${parameters['q' + i]};\`;
  }
  currentParamsString += parameters.ch; 
  
  let coeffs; 
  
  if (context.lastParams !== currentParamsString) {
      coeffs = new Array(NUM_BANDS); 
  
      for (let bandIndex = 0; bandIndex < NUM_BANDS; bandIndex++) {
          const bandEnabled = parameters['e' + bandIndex];
          const gainDb = parameters['g' + bandIndex]; 
          const type = parameters['t' + bandIndex];
          const freq = parameters['f' + bandIndex];
          let Q_param = parameters['q' + bandIndex];
  
          const isShelf = type === 'ls' || type === 'hs';
          if (isShelf) {
              Q_param = Q_param > SHELF_Q_MAX ? SHELF_Q_MAX : Q_param; 
          }
          const Q = Q_param < GENERAL_Q_MIN ? GENERAL_Q_MIN : Q_param; 
  
          const gainAbs = gainDb < 0 ? -gainDb : gainDb; 
          const isGainBypassed = gainAbs < BYPASS_THRESHOLD && type !== 'lp' && type !== 'hp' && type !== 'bp' && type !== 'no' && type !== 'ap';
  
          if (!bandEnabled || isGainBypassed) {
              coeffs[bandIndex] = null; 
              continue; 
          }
  
          const A = Math.pow(10, 0.025 * gainDb); 
          const w0 = freq * twoPiTimesSrInv;
          const clampedW0 = w0 < 1e-6 ? 1e-6 : (w0 > PI - 1e-6 ? PI - 1e-6 : w0);
          const cosw0 = Math.cos(clampedW0);
          const sinw0 = Math.sin(clampedW0);
          const alpha = sinw0 / (2.0 * Q); 
  
          let b0 = 0.0, b1 = 0.0, b2 = 0.0, a0 = 1.0, a1 = 0.0, a2 = 0.0;
  
          switch (type) {
              case 'pk': { 
                  const alphaMulA = alpha * A;
                  const alphaDivA = alpha / A;
                  const neg2CosW0 = -2.0 * cosw0;
                  b0 = 1.0 + alphaMulA; b1 = neg2CosW0; b2 = 1.0 - alphaMulA;
                  a0 = 1.0 + alphaDivA; a1 = neg2CosW0; a2 = 1.0 - alphaDivA;
                  break;
              }
              case 'lp': { 
                  const oneMinusCosW0 = 1.0 - cosw0; const neg2CosW0 = -2.0 * cosw0;
                  b0 = oneMinusCosW0 * 0.5; b1 = oneMinusCosW0; b2 = b0;
                  a0 = 1.0 + alpha; a1 = neg2CosW0; a2 = 1.0 - alpha;
                  break;
              }
              case 'hp': { 
                  const onePlusCosW0 = 1.0 + cosw0; const neg2CosW0 = -2.0 * cosw0;
                  b0 = onePlusCosW0 * 0.5; b1 = -onePlusCosW0; b2 = b0;
                  a0 = 1.0 + alpha; a1 = neg2CosW0; a2 = 1.0 - alpha;
                  break;
              }
              case 'ls': { 
                  const sqrtA = Math.sqrt(A < 0 ? 0 : A); const twoSqrtAalpha = 2.0 * sqrtA * alpha;
                  const A_plus_1 = A + 1.0; const A_minus_1 = A - 1.0;
                  const commonTerm1 = A_plus_1 - A_minus_1 * cosw0; const commonTerm2 = A_plus_1 + A_minus_1 * cosw0;
                  b0 = A * (commonTerm1 + twoSqrtAalpha); b1 = 2.0 * A * (A_minus_1 - A_plus_1 * cosw0); b2 = A * (commonTerm1 - twoSqrtAalpha);
                  a0 = commonTerm2 + twoSqrtAalpha; a1 = -2.0 * (A_minus_1 + A_plus_1 * cosw0); a2 = commonTerm2 - twoSqrtAalpha;
                  break;
              }
              case 'hs': { 
                  const sqrtA = Math.sqrt(A < 0 ? 0 : A); const twoSqrtAalpha = 2.0 * sqrtA * alpha;
                  const A_plus_1 = A + 1.0; const A_minus_1 = A - 1.0;
                  const commonTerm1 = A_plus_1 + A_minus_1 * cosw0; const commonTerm2 = A_plus_1 - A_minus_1 * cosw0;
                  b0 = A * (commonTerm1 + twoSqrtAalpha); b1 = -2.0 * A * (A_minus_1 + A_plus_1 * cosw0); b2 = A * (commonTerm1 - twoSqrtAalpha);
                  a0 = commonTerm2 + twoSqrtAalpha; a1 = 2.0 * (A_minus_1 - A_plus_1 * cosw0); a2 = commonTerm2 - twoSqrtAalpha;
                  break;
              }
              case 'bp': { 
                  const neg2CosW0 = -2.0 * cosw0;
                  b0 = alpha; b1 = 0.0; b2 = -alpha;
                  a0 = 1.0 + alpha; a1 = neg2CosW0; a2 = 1.0 - alpha;
                  break;
              }
              case 'no': { 
                  const neg2CosW0 = -2.0 * cosw0;
                  b0 = 1.0; b1 = neg2CosW0; b2 = 1.0;
                  a0 = 1.0 + alpha; a1 = neg2CosW0; a2 = 1.0 - alpha;
                  break;
              }
              case 'ap': { 
                  const neg2CosW0 = -2.0 * cosw0;
                  b0 = 1.0 - alpha; b1 = neg2CosW0; b2 = 1.0 + alpha;
                  a0 = 1.0 + alpha; a1 = neg2CosW0; a2 = 1.0 - alpha;
                  break;
              }
              default: { coeffs[bandIndex] = null; continue; }
          }
  
          const a0_abs = a0 < 0 ? -a0 : a0; 
          if (a0_abs < A0_THRESHOLD) { coeffs[bandIndex] = null; }
          else {
              const invA0 = 1.0 / a0;
              coeffs[bandIndex] = { b0: b0 * invA0, b1: b1 * invA0, b2: b2 * invA0, a1: a1 * invA0, a2: a2 * invA0 };
          }
      } 
      context.coeffs = coeffs; context.lastParams = currentParamsString;
  } else { coeffs = context.coeffs; }
  
  // --- Audio Processing ---
  for (let ch = 0; ch < channelCount; ch++) {
      const offset = ch * blockSize; 
      for (let bandIndex = 0; bandIndex < NUM_BANDS; bandIndex++) {
          const bandCoeffs = coeffs[bandIndex];
          if (bandCoeffs === null) { continue; }
          const { b0, b1, b2, a1, a2 } = bandCoeffs; 
          const state = filterStates[bandIndex];
          let x1_ch = state.x1[ch], x2_ch = state.x2[ch]; 
          let y1_ch = state.y1[ch], y2_ch = state.y2[ch]; 
          for (let i = 0; i < blockSize; i++) {
              const dataIndex = offset + i; const x_n = data[dataIndex]; 
              const y_n = b0 * x_n + b1 * x1_ch + b2 * x2_ch - a1 * y1_ch - a2 * y2_ch;
              x2_ch = x1_ch; x1_ch = x_n; y2_ch = y1_ch; y1_ch = y_n;
              data[dataIndex] = y_n;
          }
          state.x1[ch] = x1_ch; state.x2[ch] = x2_ch; state.y1[ch] = y1_ch; state.y2[ch] = y2_ch;
      } 
  } 
  return data; 
  `;
    
  constructor() {
    super('5Band PEQ', '5-band parametric equalizer');
    this._sampleRate = 96000;
    this.uiCreated = false; // Initialize uiCreated flag
    
    // Store event listener functions and bind references at instance level
    this.boundMouseMoveHandler = null;
    this.boundMouseUpHandler = null;
    this.activeDragMarker = null;

    this.onMessage = (message) => {
      if (message.sampleRate !== undefined && message.sampleRate !== this._sampleRate) {
        this._sampleRate = message.sampleRate;
        if (this.responseSvg) { this.updateResponse(); }
      }
    };

    for (let i = 0; i < 5; i++) {
      this['f' + i] = FiveBandPEQPlugin.BANDS[i].freq;
      this['g' + i] = 0;
      this['q' + i] = 1.0; 
      this['t' + i] = 'pk';
      this['e' + i] = true;
    }
    this.bandCheckboxes = [];
    this.ch = 'All'; 
    this.registerProcessor(FiveBandPEQPlugin.processorFunction);
  }

  setBand(index, freq, gain, Q, type, enabled) {
    if (freq !== undefined) this['f' + index] = Math.max(20, Math.min(parseFloat(freq), 20000));
    if (gain !== undefined) this['g' + index] = Math.max(-20, Math.min(parseFloat(gain), 20));
    
    if (type !== undefined) this['t' + index] = type;
    
    if (Q !== undefined) {
      const currentType = this['t' + index];
      if (currentType === 'ls' || currentType === 'hs') {
        this['q' + index] = Math.max(0.1, Math.min(parseFloat(Q), 2.0));
      } else {
        this['q' + index] = Math.max(0.1, Math.min(parseFloat(Q), 10.0));
      }
    } else if (type !== undefined) { // If only type changed, re-clamp Q
      const currentType = this['t' + index];
      const existingQ = this['q' + index];
      if (currentType === 'ls' || currentType === 'hs') {
        this['q' + index] = Math.max(0.1, Math.min(existingQ, 2.0));
      }
    }

    if (enabled !== undefined) this['e' + index] = enabled;
    this.updateParameters();
  }

  toggleBandEnabled(index) {
    this['e' + index] = !this['e' + index];
    if (this.bandCheckboxes[index]) { this.bandCheckboxes[index].checked = this['e' + index]; }
    this.updateParameters();
    if (this.responseSvg) { this.updateResponse(); }
    if (this.markers) { this.updateMarkers(); }
  }

  reset() {
    FiveBandPEQPlugin.BANDS.forEach((band, index) => {
      this.setBand(index, FiveBandPEQPlugin.BANDS[index].freq, 0.0, 1.41, 'pk', true);
    });
    this.enabled = true;
    this.updateParameters();
    if (this.uiCreated) this.setUIValues();
  }

  getParameters() {
      const params = { type: this.constructor.name, enabled: this.enabled };
      for (let i = 0; i < 5; i++) {
          params['f' + i] = this['f' + i]; params['g' + i] = this['g' + i];
          params['q' + i] = this['q' + i]; params['t' + i] = this['t' + i];
          params['e' + i] = this['e' + i];
      }
      return params;
  }

  setParameters(params) {
      let shouldUpdateResponse = false;
      if (params.enabled !== undefined) this.enabled = params.enabled;
      if (params.sampleRate !== undefined) { this._sampleRate = params.sampleRate; shouldUpdateResponse = true; }

      for (let i = 0; i < 5; i++) {
          if (params['f' + i] !== undefined) { this['f' + i] = Math.max(20, Math.min(parseFloat(params['f' + i]), 20000)); shouldUpdateResponse = true; }
          if (params['g' + i] !== undefined) { this['g' + i] = Math.max(-20, Math.min(parseFloat(params['g' + i]), 20)); shouldUpdateResponse = true; }
          if (params['t' + i] !== undefined) { this['t' + i] = params['t' + i]; shouldUpdateResponse = true; }
          
          if (params['q' + i] !== undefined) {
              const currentType = this['t' + i]; // Use potentially updated type
              if (currentType === 'ls' || currentType === 'hs') {
                  this['q' + i] = Math.max(0.1, Math.min(parseFloat(params['q' + i]), 2.0));
              } else {
                  this['q' + i] = Math.max(0.1, Math.min(parseFloat(params['q' + i]), 10.0));
              }
              shouldUpdateResponse = true;
          } else if (params['t' + i] !== undefined) { // Type changed, Q not in params, re-clamp current Q
              const currentType = this['t' + i];
              const existingQ = this['q' + i];
              if (currentType === 'ls' || currentType === 'hs') {
                  if (existingQ > 2.0) this['q' + i] = 2.0;
              } // No un-clamping needed if type changed from shelf to non-shelf
          }
          if (params['e' + i] !== undefined) { this['e' + i] = params['e' + i]; shouldUpdateResponse = true; }
      }
      
      this.updateParameters();
      if (shouldUpdateResponse && this.responseSvg) { this.updateResponse(); }
      if (this.uiCreated) { this.setUIValues(); }
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'five-band-peq-plugin-ui plugin-parameter-ui';
    container.id = `five-band-peq-container-${this.id}`;

    const graphContainer = document.createElement('div');
    graphContainer.className = 'five-band-peq-graph';
    graphContainer.id = `five-band-peq-graph-${this.id}`;

    const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    gridSvg.setAttribute('class', 'five-band-peq-grid');
    gridSvg.setAttribute('width', '100%'); gridSvg.setAttribute('height', '100%');

    const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    freqs.forEach(freq => {
      const x = this.freqToX(freq);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', `${x}%`); line.setAttribute('x2', `${x}%`);
      line.setAttribute('y1', '0'); line.setAttribute('y2', '100%');
      gridSvg.appendChild(line);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', `${x}%`); text.setAttribute('y', '95%');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = freq >= 1000 ? `${freq / 1000}k` : freq;
      gridSvg.appendChild(text);
    });

    const gains = [-18, -12, -6, 0, 6, 12, 18];
    gains.forEach(gain => {
      const y = this.gainToY(gain);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0'); line.setAttribute('x2', '100%');
      line.setAttribute('y1', `${y}%`); line.setAttribute('y2', `${y}%`);
      gridSvg.appendChild(line);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '2%'); text.setAttribute('y', `${y}%`);
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = `${gain}dB`;
      gridSvg.appendChild(text);
    });
    graphContainer.appendChild(gridSvg);

    const responseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    responseSvg.setAttribute('class', 'five-band-peq-response');
    responseSvg.setAttribute('width', '100%'); responseSvg.setAttribute('height', '100%');
    graphContainer.appendChild(responseSvg);

    const markers = [];
    for (let i = 0; i < 5; i++) {
      const marker = document.createElement('div');
      marker.className = 'five-band-peq-marker'; 
      marker.textContent = i + 1;
      marker.id = `five-band-peq-marker-${this.id}-${i}`;
      marker.dataset.pluginId = this.id;
      marker.dataset.band = i;
      
      const markerText = document.createElement('div');
      markerText.className = 'five-band-peq-marker-text';
      marker.appendChild(markerText); 
      graphContainer.appendChild(marker);
      markers.push(marker);
      
      // Improved drag and drop implementation with simplification
      const handleDragStart = (clientX, clientY) => {
        this.activeDragMarker = i;
        marker.classList.add('active');
        const bandUI = container.querySelector(`.five-band-peq-band[data-band="${i}"][data-plugin-id="${this.id}"]`);
        if (bandUI) bandUI.classList.add('active');
        
        // Add event listeners only if they don't already exist
        if (!this.boundMouseMoveHandler) {
          this.boundMouseMoveHandler = this.handleDragMove.bind(this);
          this.boundMouseUpHandler = this.handleDragEnd.bind(this);
          document.addEventListener('mousemove', this.boundMouseMoveHandler);
          document.addEventListener('mouseup', this.boundMouseUpHandler);
        }
        
        // Store initial position but don't update marker position on mousedown
        this.initialDragX = clientX;
        this.initialDragY = clientY;
        this.hasMoved = false;
      };

      marker.addEventListener('mousedown', (e) => { 
        handleDragStart(e.clientX, e.clientY); 
        e.preventDefault(); 
      });
      
      marker.addEventListener('touchstart', (e) => { 
        const touch = e.touches[0]; 
        handleDragStart(touch.clientX, touch.clientY);
        e.preventDefault(); 
      }, { passive: false });
      
      marker.addEventListener('touchmove', (e) => { 
        if (this.activeDragMarker === i) { 
          const touch = e.touches[0]; 
          this.handleDragMove({
            clientX: touch.clientX, 
            clientY: touch.clientY, 
            targetContainer: graphContainer,
            targetBand: i
          });
          e.preventDefault();
        }
      }, { passive: false });
      
      marker.addEventListener('touchend', () => {
        if (this.activeDragMarker === i) {
          this.handleDragEnd();
        }
      });
      
      marker.addEventListener('touchcancel', () => {
        if (this.activeDragMarker === i) {
          this.handleDragEnd();
        }
      });

      marker.addEventListener('contextmenu', (e) => { 
        e.preventDefault(); 
        this.toggleBandEnabled(i); 
      });
    }

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'five-band-peq-controls';

    for (let i = 0; i < 5; i++) {
      const bandControls = document.createElement('div');
      bandControls.className = 'five-band-peq-band'; 
      bandControls.dataset.band = i;
      bandControls.dataset.pluginId = this.id;
      bandControls.id = `five-band-peq-band-${this.id}-${i}`;

      const labelContainer = document.createElement('label');
      labelContainer.className = 'five-band-peq-band-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; 
      checkbox.className = 'five-band-peq-band-checkbox';
      checkbox.id = `${this.id}-five-band-peq-band-${i}-checkbox`;
      checkbox.name = `${this.id}-five-band-peq-band-${i}-checkbox`;
      checkbox.checked = this['e' + i]; 
      checkbox.autocomplete = "off";
      this.bandCheckboxes[i] = checkbox;
      checkbox.addEventListener('change', () => {
        this.setBand(i, undefined, undefined, undefined, undefined, checkbox.checked); // Use setBand for consistency
        this.updateMarkers(); this.updateResponse();
      });
      labelContainer.appendChild(checkbox); labelContainer.appendChild(document.createTextNode(`Band ${i + 1}`));

      const typeRow = document.createElement('div'); 
      typeRow.className = 'five-band-peq-type-row';
      const typeSelectId = `${this.id}-five-band-peq-band-${i}-type`;
      const typeLabel = document.createElement('label');
      typeLabel.className = 'five-band-peq-type-label'; 
      typeLabel.textContent = 'Type:'; 
      typeLabel.htmlFor = typeSelectId;
      const typeSelect = document.createElement('select');
      typeSelect.className = 'five-band-peq-filter-type'; 
      typeSelect.id = typeSelectId; 
      typeSelect.name = typeSelectId; 
      typeSelect.autocomplete = "off";
      FiveBandPEQPlugin.FILTER_TYPES.forEach(type => {
        const option = document.createElement('option'); option.value = type.id; option.textContent = type.name; typeSelect.appendChild(option);
      });
      typeSelect.value = this['t' + i];
      typeRow.appendChild(typeLabel); typeRow.appendChild(typeSelect);

      const qRow = document.createElement('div'); 
      qRow.className = 'five-band-peq-q-row';
      const qSliderId = `${this.id}-five-band-peq-band-${i}-q-slider`;
      const qTextId = `${this.id}-five-band-peq-band-${i}-q-text`;
      const qLabel = document.createElement('div');
      qLabel.className = 'five-band-peq-q-label'; 
      qLabel.textContent = 'Q:'; 
      qLabel.htmlFor = qSliderId;
      const qSlider = document.createElement('input');
      qSlider.type = 'range'; 
      qSlider.className = 'five-band-peq-q-slider'; 
      qSlider.id = qSliderId; 
      qSlider.name = qSliderId;
      qSlider.min = 0.1; qSlider.step = 0.01; qSlider.value = this['q' + i]; qSlider.autocomplete = "off";
      const qText = document.createElement('input');
      qText.type = 'number'; 
      qText.className = 'five-band-peq-q-text'; 
      qText.id = qTextId; 
      qText.name = qTextId;
      qText.min = 0.1; qText.step = 0.01; qText.value = this['q' + i]; qText.autocomplete = "off";
      qRow.appendChild(qLabel); qRow.appendChild(qSlider); qRow.appendChild(qText);

      const updateQControlsState = (type) => {
        const isShelf = type === 'ls' || type === 'hs'; const newMaxQ = isShelf ? 2.0 : 10.0;
        qSlider.max = newMaxQ; qText.max = newMaxQ;
        // Clamp current Q if it exceeds new max, then update UI
        const currentQ = parseFloat(this['q' + i]);
        if (currentQ > newMaxQ) { this.setBand(i, undefined, undefined, newMaxQ, type); } // setBand updates plugin's Q
        // Always set UI from plugin state after potential clamping by setBand or just for formatting
        qSlider.value = parseFloat(this['q' + i]).toFixed(2);
        qText.value = parseFloat(this['q' + i]).toFixed(2);
      };
      updateQControlsState(this['t' + i]);

      typeSelect.addEventListener('change', () => {
        const newType = typeSelect.value;
        this.setBand(i, undefined, undefined, parseFloat(qSlider.value), newType); // Pass current Q, setBand will clamp
        updateQControlsState(newType); // Update Q controls for new type (max, value)
        this.updateResponse(); this.updateMarkers();
      });

      const updateQFromUI = (valueStr) => {
        this.setBand(i, undefined, undefined, parseFloat(valueStr), typeSelect.value); // Pass current type
        // Update UI from plugin state (which might be clamped)
        qSlider.value = parseFloat(this['q' + i]).toFixed(2);
        qText.value = parseFloat(this['q' + i]).toFixed(2);
        this.updateResponse(); this.updateMarkers();
      };
      qSlider.addEventListener('input', () => updateQFromUI(qSlider.value));
      qText.addEventListener('input', () => updateQFromUI(qText.value));
      qText.addEventListener('change', () => { qText.value = parseFloat(this['q' + i]).toFixed(2); });


      const freqRow = document.createElement('div'); 
      freqRow.className = 'five-band-peq-freq-row';
      const freqLabel = document.createElement('label');
      freqLabel.className = 'five-band-peq-freq-label'; 
      freqLabel.textContent = 'Freq (Hz):';
      const freqTextId = `${this.id}-five-band-peq-band-${i}-freq`; 
      freqLabel.htmlFor = freqTextId;
      const freqText = document.createElement('input');
      freqText.type = 'number'; 
      freqText.className = 'five-band-peq-freq-text'; 
      freqText.id = freqTextId; 
      freqText.name = freqTextId;
      freqText.min = 20; freqText.max = 20000; freqText.step = 1; freqText.value = parseFloat(this['f' + i]).toFixed(0); freqText.autocomplete = "off";
      freqText.addEventListener('input', () => {
          this.setBand(i, parseFloat(freqText.value), undefined, undefined, undefined);
          this.updateResponse(); this.updateMarkers();
      });
      freqText.addEventListener('change', () => { freqText.value = parseFloat(this['f' + i]).toFixed(0); this.updateResponse(); this.updateMarkers(); });
      freqRow.appendChild(freqLabel); freqRow.appendChild(freqText);

      const gainRow = document.createElement('div'); 
      gainRow.className = 'five-band-peq-gain-row';
      const gainLabel = document.createElement('label');
      gainLabel.className = 'five-band-peq-gain-label'; 
      gainLabel.textContent = 'Gain (dB):';
      const gainTextId = `${this.id}-five-band-peq-band-${i}-gain`; 
      gainLabel.htmlFor = gainTextId;
      const gainText = document.createElement('input');
      gainText.type = 'number'; 
      gainText.className = 'five-band-peq-gain-text'; 
      gainText.id = gainTextId; 
      gainText.name = gainTextId;
      gainText.min = -20; gainText.max = 20; gainText.step = 0.1; gainText.value = parseFloat(this['g' + i]).toFixed(1); gainText.autocomplete = "off";
      gainText.addEventListener('input', () => {
          this.setBand(i, undefined, parseFloat(gainText.value), undefined, undefined);
          this.updateResponse(); this.updateMarkers();
      });
      gainText.addEventListener('change', () => { gainText.value = parseFloat(this['g' + i]).toFixed(1); this.updateResponse(); this.updateMarkers(); });
      gainRow.appendChild(gainLabel); gainRow.appendChild(gainText);
      
      bandControls.appendChild(labelContainer); bandControls.appendChild(typeRow);
      bandControls.appendChild(qRow); bandControls.appendChild(freqRow); bandControls.appendChild(gainRow);
      controlsContainer.appendChild(bandControls);
    }

    container.appendChild(graphContainer); container.appendChild(controlsContainer);
    this.graphContainer = graphContainer; this.responseSvg = responseSvg; this.markers = markers;
    this.uiContainer = container;

    this._uiCreated(); // Set uiCreated = true and call setUIValues

    setTimeout(() => { // Defer initial drawing for elements to get dimensions
      this.updateMarkers(); this.updateResponse();
    }, 0);
    return container;
  }
  
  _uiCreated() {
    this.uiCreated = true;
    this.setUIValues();
  }

  setUIValues() {
    if (!this.uiCreated || !this.graphContainer) return;
    for (let i = 0; i < 5; i++) {
        const bandControl = this.graphContainer.parentElement.querySelector(`.five-band-peq-band[data-band="${i}"][data-plugin-id="${this.id}"]`);
        if (!bandControl) continue;
        const checkbox = bandControl.querySelector('.five-band-peq-band-checkbox');
        const typeSelect = bandControl.querySelector('.five-band-peq-filter-type');
        const qSlider = bandControl.querySelector('.five-band-peq-q-slider');
        const qText = bandControl.querySelector('.five-band-peq-q-text');
        const freqText = bandControl.querySelector('.five-band-peq-freq-text');
        const gainText = bandControl.querySelector('.five-band-peq-gain-text');

        if (checkbox) checkbox.checked = this['e' + i];
        if (typeSelect) typeSelect.value = this['t' + i];
        
        const currentType = this['t' + i]; const isShelf = currentType === 'ls' || currentType === 'hs';
        const maxQ = isShelf ? 2.0 : 10.0;

        if (qSlider) { qSlider.max = maxQ; qSlider.value = parseFloat(this['q' + i]).toFixed(2); }
        if (qText) { qText.max = maxQ; qText.value = parseFloat(this['q' + i]).toFixed(2); }
        if (freqText) freqText.value = parseFloat(this['f' + i]).toFixed(0);
        if (gainText) gainText.value = parseFloat(this['g' + i]).toFixed(1);
    }
    // No need to call updateMarkers/Response here as setUIValues is for individual controls.
    // Initial call is handled by _uiCreated -> setUIValues and then the setTimeout in createUI.
  }
  
  setUIBandValues(bandIndex) {
    if (!this.uiCreated || !this.graphContainer) return;
    const bandControl = this.graphContainer.parentElement.querySelector(`.five-band-peq-band[data-band="${bandIndex}"][data-plugin-id="${this.id}"]`);
    if (!bandControl) return;

    const freqText = bandControl.querySelector('.five-band-peq-freq-text');
    const gainText = bandControl.querySelector('.five-band-peq-gain-text');
    // Also update Q and Type if they could be changed by interactions not covered by their own listeners
    const typeSelect = bandControl.querySelector('.five-band-peq-filter-type');
    const qSlider = bandControl.querySelector('.five-band-peq-q-slider');
    const qText = bandControl.querySelector('.five-band-peq-q-text');


    if (freqText) freqText.value = parseFloat(this['f' + bandIndex]).toFixed(0);
    if (gainText) gainText.value = parseFloat(this['g' + bandIndex]).toFixed(1);
    
    // If marker drag or other interactions could change type or Q, update them too
    if (typeSelect) typeSelect.value = this['t' + bandIndex];
    if (qSlider && qText) { // Update Q controls based on current type and value
        const currentType = this['t' + bandIndex];
        const isShelf = currentType === 'ls' || currentType === 'hs';
        const maxQ = isShelf ? 2.0 : 10.0;
        qSlider.max = maxQ;
        qText.max = maxQ;
        qSlider.value = parseFloat(this['q' + bandIndex]).toFixed(2);
        qText.value = parseFloat(this['q' + bandIndex]).toFixed(2);
    }
  }

  freqToX(freq) { return (Math.log10(Math.max(10, Math.min(freq, 40000))) - Math.log10(10)) / (Math.log10(40000) - Math.log10(10)) * 100; }
  xToFreq(xPercent) { return Math.pow(10, Math.log10(10) + (xPercent / 100) * (Math.log10(40000) - Math.log10(10))); }
  gainToY(gain) { return 50 - (gain / 20.0) * 50; } // NEVER Clamp gain
  yToGain(yPercent) { return -(yPercent - 50) / 50.0 * 20.0; }

  updateMarkers() {
    if (!this.markers || !this.graphContainer || !this.uiCreated) return;
    for (let i = 0; i < 5; i++) {
      const marker = this.markers[i]; if (!marker) continue;
      const freq = this['f' + i]; const gain = this['g' + i]; const enabled = this['e' + i];
      const x = this.freqToX(freq); const y = this.gainToY(gain);
      const margin = 20; 
      const graphWidth = this.graphContainer.clientWidth; const graphHeight = this.graphContainer.clientHeight;
      if (graphWidth === 0 || graphHeight === 0) continue;
      const xPos = (x / 100) * (graphWidth - 2 * margin) + margin;
      const yPos = (y / 100) * (graphHeight - 2 * margin) + margin;
      marker.style.left = `${xPos}px`; marker.style.top = `${yPos}px`;
      marker.classList.toggle('disabled', !enabled);
      marker.dataset.pluginId = this.id;
      const markerTextEl = marker.querySelector('.five-band-peq-marker-text'); if (!markerTextEl) continue;
      const centerX = graphWidth / 2; const isLeft = xPos < centerX;
      markerTextEl.className = `five-band-peq-marker-text ${isLeft ? 'left' : 'right'}`;
      const freqDisplayText = freq >= 1000 ? `${(freq/1000).toFixed(1)}k` : freq.toFixed(0); // Adjusted kHz display
      const type = this['t' + i];
      markerTextEl.innerHTML = `${freqDisplayText}Hz${type === 'lp' || type === 'hp' || type === 'bp' || type === 'ap' || type === 'no' ? '' : `<br>${gain.toFixed(1)}dB`}`;
    }
  }

  calculateBandResponse(freq, bandFreq, bandGain, bandQ, bandType) {
    const sampleRate = this._sampleRate || 96000;
    const w0 = 2 * Math.PI * bandFreq / sampleRate; const w = 2 * Math.PI * freq / sampleRate;
    let qToUse = bandQ;
    if (bandType === 'ls' || bandType === 'hs') { qToUse = Math.min(bandQ, 2.0); }
    qToUse = Math.max(0.1, qToUse); const Q_calc = qToUse;
    let alpha = Math.sin(w0) / (2 * Q_calc); const cosw0 = Math.cos(w0);
    const A = Math.pow(10, bandGain / 40);
    let b0, b1, b2, a0, a1, a2;
    if (Math.abs(bandGain) < 0.01 && !['lp', 'hp', 'bp', 'no', 'ap'].includes(bandType)) {
      b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    } else {
      switch (bandType) {
        case 'pk': { const alpha_A = alpha*A; const alpha_div_A = alpha/A; b0=1+alpha_A; b1=-2*cosw0; b2=1-alpha_A; a0=1+alpha_div_A; a1=-2*cosw0; a2=1-alpha_div_A; break; }
        case 'lp': { b0=(1-cosw0)/2; b1=1-cosw0; b2=(1-cosw0)/2; a0=1+alpha; a1=-2*cosw0; a2=1-alpha; break; }
        case 'hp': { b0=(1+cosw0)/2; b1=-(1+cosw0); b2=(1+cosw0)/2; a0=1+alpha; a1=-2*cosw0; a2=1-alpha; break; }
        case 'ls': { const sA=Math.sqrt(A<0?0:A); const tSAa=2*sA*alpha; b0=A*((A+1)-(A-1)*cosw0+tSAa); b1=2*A*((A-1)-(A+1)*cosw0); b2=A*((A+1)-(A-1)*cosw0-tSAa); a0=(A+1)+(A-1)*cosw0+tSAa; a1=-2*((A-1)+(A+1)*cosw0); a2=(A+1)+(A-1)*cosw0-tSAa; break; }
        case 'hs': { const sA=Math.sqrt(A<0?0:A); const tSAa=2*sA*alpha; b0=A*((A+1)+(A-1)*cosw0+tSAa); b1=-2*A*((A-1)+(A+1)*cosw0); b2=A*((A+1)+(A-1)*cosw0-tSAa); a0=(A+1)-(A-1)*cosw0+tSAa; a1=2*((A-1)-(A+1)*cosw0); a2=(A+1)-(A-1)*cosw0-tSAa; break; }
        case 'bp': { b0=alpha; b1=0; b2=-alpha; a0=1+alpha; a1=-2*cosw0; a2=1-alpha; break; }
        case 'no': { b0=1; b1=-2*cosw0; b2=1; a0=1+alpha; a1=-2*cosw0; a2=1-alpha; break; }
        case 'ap': { b0=1-alpha; b1=-2*cosw0; b2=1+alpha; a0=1+alpha; a1=-2*cosw0; a2=1-alpha; break; }
        default: return 0; 
      }
    }
    if (Math.abs(a0) > 1e-8) { const invA0=1/a0; b0*=invA0;b1*=invA0;b2*=invA0; a1*=invA0;a2*=invA0; } 
    else { return 0; } // Unstable filter, effectively bypass for response
    const cW=Math.cos(w); const sW=Math.sin(w); const c2W=2*cW*cW-1; const s2W=2*sW*cW; // cos(2w), sin(2w)
    let num_re = b0 + b1*cW + b2*c2W; let num_im = -b1*sW - b2*s2W;
    let den_re = 1 + a1*cW + a2*c2W; let den_im = -a1*sW - a2*s2W; // a0 is 1 after normalization
    const den_mag_sq = den_re*den_re + den_im*den_im;
    if (den_mag_sq < 1e-18) return -Infinity; // Or a very small dB value
    const num_mag_sq = num_re*num_re + num_im*num_im;
    const magnitude = Math.sqrt(num_mag_sq / den_mag_sq);
    return 20 * Math.log10(Math.max(1e-9, magnitude)); // Clamp to avoid log(0)
  }

  updateResponse() {
    if (!this.responseSvg || !this.responseSvg.clientWidth || !this.uiCreated) return;
    const width = this.responseSvg.clientWidth; 
    const height = this.responseSvg.clientHeight;
    const freqPoints = []; 
    const numPoints = Math.max(200, width / 2);
    const minFreq = 10; 
    const maxFreq = 40000; 
    
    for (let i=0; i<=numPoints; i++) { 
      freqPoints.push(minFreq * Math.pow(maxFreq/minFreq, i/numPoints)); 
    }
    
    const responseDataPoints = freqPoints.map(freq => {
      let totalGainDb = 0;
      for (let band = 0; band < 5; band++) {
        if (!this['e' + band]) continue;
        const bf = this['f' + band], bg = this['g' + band], bq = this['q' + band], bt = this['t' + band];
        if (Math.abs(bg) < 0.01 && !['lp', 'hp', 'bp', 'no', 'ap'].includes(bt)) continue;
        totalGainDb += this.calculateBandResponse(freq, bf, bg, bq, bt);
      }
      return totalGainDb;
    });
    
    const pathPoints = [];
    for (let i = 0; i < freqPoints.length; i++) {
      const x = this.freqToX(freqPoints[i]) * width / 100; // freqToX returns %, convert to px
      const y = this.gainToY(responseDataPoints[i]) * height / 100;  // NEVER Clamp gain
      pathPoints.push(i === 0 ? `M ${x.toFixed(2)},${y.toFixed(2)}` : `L ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    
    // Clear existing SVG elements
    while (this.responseSvg.firstChild) { 
      this.responseSvg.removeChild(this.responseSvg.firstChild); 
    }
    
    // Create new path
    if (pathPoints.length > 0) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathPoints.join(' ')); 
      path.setAttribute('stroke', '#00ff00');
      path.setAttribute('stroke-width', '2'); 
      path.setAttribute('fill', 'none');
      path.id = `five-band-peq-response-path-${this.id}`;
      this.responseSvg.appendChild(path);
    }
  }

  // Implement drag move handler as class method
  handleDragMove(e) {
    const { clientX, clientY, targetContainer, targetBand } = e;
    if (this.activeDragMarker === null) return;
    
    // Check if this is the first movement
    if (!this.hasMoved) {
      // Determine if there's been enough movement to consider it a drag
      const moveThreshold = 3; // 3 pixels threshold
      const xDiff = Math.abs(clientX - this.initialDragX);
      const yDiff = Math.abs(clientY - this.initialDragY);
      
      if (xDiff < moveThreshold && yDiff < moveThreshold) {
        // Movement is too small, don't do anything yet
        return;
      }
      
      // Now we've determined it's a real drag
      this.hasMoved = true;
    }
    
    const bandIndex = targetBand !== undefined ? targetBand : this.activeDragMarker;
    const container = targetContainer || this.graphContainer;
    
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const margin = 20;
    let x = (clientX - rect.left - margin) / (rect.width - 2 * margin);
    x = Math.max(0, Math.min(1, x));
    let y = (clientY - rect.top - margin) / (rect.height - 2 * margin);
    y = Math.max(0, Math.min(1, y));
    
    const freq = this.xToFreq(x * 100);
    const gain = this.yToGain(y * 100);
    
    this.setBand(bandIndex, freq, gain);
    this.updateMarkers();
    this.updateResponse();
    
    if (this.uiCreated) {
      this.setUIBandValues(bandIndex);
    }
  }
  
  // Implement drag end handler as class method
  handleDragEnd() {
    if (this.activeDragMarker === null) return;
    
    const marker = this.markers ? this.markers[this.activeDragMarker] : null;
    if (marker) {
      marker.classList.remove('active');
    }
    
    if (this.uiContainer) {
      const bandUI = this.uiContainer.querySelector(`.five-band-peq-band[data-band="${this.activeDragMarker}"][data-plugin-id="${this.id}"]`);
      if (bandUI) {
        bandUI.classList.remove('active');
      }
    }
    
    this.activeDragMarker = null;
    this.hasMoved = false; // Reset movement state
    
    // Remove event listeners
    if (this.boundMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundMouseMoveHandler);
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseMoveHandler = null;
      this.boundMouseUpHandler = null;
    }
  }
  
  // Add plugin cleanup method
  cleanup() {
    // Clean up event listeners
    if (this.boundMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundMouseMoveHandler);
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseMoveHandler = null;
      this.boundMouseUpHandler = null;
    }
    
    // Reset active state
    this.activeDragMarker = null;
    
    // Clean up other resources
    this.uiCreated = false;
    super.cleanup();
  }
}

if (typeof window !== 'undefined') {
  window.FiveBandPEQPlugin = FiveBandPEQPlugin;
}
