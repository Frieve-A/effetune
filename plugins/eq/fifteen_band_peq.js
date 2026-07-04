class FifteenBandPEQPlugin extends PluginBase {
  // Initial band frequencies (approximately logarithmically spaced)
  static BANDS = [
    { freq: 25, name: '25 Hz' },
    { freq: 40, name: '40 Hz' },
    { freq: 63, name: '63 Hz' },
    { freq: 100, name: '100 Hz' },
    { freq: 160, name: '160 Hz' },
    { freq: 250, name: '250 Hz' },
    { freq: 400, name: '400 Hz' },
    { freq: 630, name: '630 Hz' },
    { freq: 1000, name: '1.0 kHz' },
    { freq: 1600, name: '1.6 kHz' },
    { freq: 2500, name: '2.5 kHz' },
    { freq: 4000, name: '4.0 kHz' },
    { freq: 6300, name: '6.3 kHz' },
    { freq: 10000, name: '10 kHz' },
    { freq: 16000, name: '16 kHz' }
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

  // EQ filter mapping
  static EQ_FILTER_MAP = {
    'LS': 'ls',
    'LSC': 'ls',
    'PK': 'pk',
    'HS': 'hs',
    'HSC': 'hs'
  };

  // AudioWorklet processor function (internal processing)
  static processorFunction = `
  // --- Constants ---
  const BYPASS_THRESHOLD = 0.01; 
  const A0_THRESHOLD = 1e-8;     
  const PI = 3.141592653589793;
  const TWO_PI = 6.283185307179586;
  const NUM_BANDS = 15;          
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
    super('15Band PEQ', '15-band parametric equalizer');
    this._sampleRate = 96000;
    this.uiCreated = false;
    this.currentBandIndex = 0;
    this.instanceId = `fifteen-band-peq-${Math.random().toString(36).substring(2, 9)}`;
    
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

    // Initial values setup
    for (let i = 0; i < 15; i++) {
      this['f' + i] = FifteenBandPEQPlugin.BANDS[i].freq;
      this['g' + i] = 0;
      this['q' + i] = 1.0; 
      this['t' + i] = 'pk'; // Default to Peaking type
      this['e' + i] = true;
    }
    this.registerProcessor(FifteenBandPEQPlugin.processorFunction);
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
    if (this.bandContentPanes.length > 0) { 
      this.setUIBandValues(index);
    }
  }

  toggleBandEnabled(index) {
    this['e' + index] = !this['e' + index];
    if (this.bandCheckboxes[index]) { this.bandCheckboxes[index].checked = this['e' + index]; }
    this.updateParameters();
    if (this.responseSvg) { this.updateResponse(); }
    if (this.markers) { this.updateMarkers(); }
  }

  invertGains() {
    for (let i = 0; i < 15; i++) {
      this['g' + i] = -this['g' + i];
    }
    this.updateParameters();
    if (this.uiCreated) {
      this.setUIValues();
      if (this.responseSvg) { this.updateResponse(); }
      if (this.markers) { this.updateMarkers(); }
    }
  }

  getParameters() {
    const params = super.getParameters();
    for (let i = 0; i < 15; i++) {
      params['f' + i] = this['f' + i];
      params['g' + i] = this['g' + i];
      params['q' + i] = this['q' + i];
      params['t' + i] = this['t' + i];
      params['e' + i] = this['e' + i];
    }
    return params;
  }

  setParameters(params) {
    super.setParameters(params);
    for (let i = 0; i < 15; i++) {
      if (params['f' + i] !== undefined) this['f' + i] = params['f' + i];
      if (params['g' + i] !== undefined) this['g' + i] = params['g' + i];
      if (params['q' + i] !== undefined) this['q' + i] = params['q' + i];
      if (params['t' + i] !== undefined) this['t' + i] = params['t' + i];
      if (params['e' + i] !== undefined) this['e' + i] = params['e' + i];
    }
    
    if (this.uiCreated) {
      this.setUIValues();
      if (this.responseSvg) { this.updateResponse(); }
      if (this.markers) { this.updateMarkers(); }
    }
  }

  selectBand(index) {
    if (index >= 0 && index < 15) {
      this.currentBandIndex = index;
      
      // Update UI to reflect the changed selection
      this.updateUI();
      if (this.responseSvg) { this.updateResponse(); }
    }
  }

  getNearestBandIndexForGraphPoint(clientX, clientY, container = this.graphContainer) {
    if (!container || typeof clientX !== 'number' || typeof clientY !== 'number') {
      return this.currentBandIndex;
    }

    const plotArea = this.getGraphPlotArea(container);
    if (!plotArea.width || !plotArea.height) return this.currentBandIndex;

    let nearestBand = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < 15; i++) {
      const x = plotArea.left + (this.freqToX(this['f' + i]) / 100) * plotArea.width;
      const y = plotArea.top + (this.gainToY(this['g' + i]) / 100) * plotArea.height;
      const dx = clientX - x;
      const dy = clientY - y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestBand = i;
      }
    }

    return nearestBand;
  }

  selectNearestBandFromGraphPoint(clientX, clientY, container = this.graphContainer) {
    const bandIndex = this.getNearestBandIndexForGraphPoint(clientX, clientY, container);
    this.selectBand(bandIndex);
    return bandIndex;
  }

  updateUI() {
    // Update tab active states
    if (this.bandTabs) {
      this.bandTabs.forEach((tab, i) => {
        if (i === this.currentBandIndex) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });
    }

    // Update content pane visibility
    if (this.bandContentPanes) {
      this.bandContentPanes.forEach((pane, i) => {
        if (i === this.currentBandIndex) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });
    }

    // Update current band controls with correct values
    this.setUIBandValues(this.currentBandIndex);
  }

  createUI() {
    this.disconnectGraphResizeObserver();
    const container = document.createElement('div');
    container.className = 'fifteen-band-peq-plugin-ui plugin-parameter-ui';
    
    // Generate a unique instance ID for this plugin instance
    this.instanceId = `fifteen-band-peq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    container.setAttribute('data-instance-id', this.instanceId);

    // EQ response graph
    const graphContainer = document.createElement('div');
    graphContainer.className = 'fifteen-band-peq-graph';
    
    // Create Import button in the top right corner
    const importButtonContainer = document.createElement('div');
    importButtonContainer.className = 'fifteen-band-peq-import-container';
    
    const importButton = document.createElement('button');
    importButton.className = 'fifteen-band-peq-import-button';
    importButton.textContent = 'Import';
    
    // Create a hidden file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt';
    fileInput.style.display = 'none';
    fileInput.id = `${this.instanceId}-file-input`;
    
    // Add event listeners for importing
    importButton.addEventListener('click', () => {
      fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        this.handleFileImport(file);
      }
    });
    
    const inverseButton = document.createElement('button');
    inverseButton.className = 'fifteen-band-peq-inverse-button';
    inverseButton.textContent = 'Inverse';
    inverseButton.addEventListener('click', () => {
      this.invertGains();
    });

    importButtonContainer.appendChild(inverseButton);
    importButtonContainer.appendChild(importButton);
    importButtonContainer.appendChild(fileInput);
    graphContainer.appendChild(importButtonContainer);
    
    // Create grid for the graph
    const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    gridSvg.setAttribute('class', 'fifteen-band-peq-grid');
    gridSvg.setAttribute('width', '100%');
    gridSvg.setAttribute('height', '100%');
    
    // Horizontal grid lines (gain)
    const gains = [-18, -12, -6, 0, 6, 12, 18];
    gains.forEach(gain => {
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
    });
    
    // Vertical grid lines (frequencies)
    const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    frequencies.forEach(freq => {
      const x = this.freqToX(freq);
      
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
      
      let freqText;
      if (freq >= 1000) { freqText = (freq / 1000) + 'k'; }
      else { freqText = freq; }
      
      text.textContent = freqText;
      gridSvg.appendChild(text);
    });
    
    graphContainer.appendChild(gridSvg);
    
    // Create SVG for EQ curve
    const responseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    responseSvg.setAttribute('class', 'fifteen-band-peq-response');
    responseSvg.setAttribute('width', '100%');
    responseSvg.setAttribute('height', '100%');
    responseSvg.setAttribute('preserveAspectRatio', 'none');
    graphContainer.appendChild(responseSvg);
    this.responseSvg = responseSvg;

    // Create markers for each band
    const markers = [];
    for (let i = 0; i < 15; i++) {
      const marker = document.createElement('div');
      marker.className = 'fifteen-band-peq-marker'; 
      marker.textContent = i + 1;
      marker.id = `fifteen-band-peq-marker-${this.id}-${i}`;
      marker.dataset.pluginId = this.id;
      marker.dataset.index = i;
      
      const markerText = document.createElement('div');
      markerText.className = 'fifteen-band-peq-marker-text';
      marker.appendChild(markerText);
      
      graphContainer.appendChild(marker);
      markers.push(marker);
      
      // Improved drag and drop implementation with simplification
      const handleDragStart = (clientX, clientY) => {
        // On mobile the enlarged hit areas of neighboring markers overlap, so
        // resolve the grabbed band from the pointer position instead of the
        // marker element that happened to receive the event.
        const bandIndex = window.uiManager?.layoutMode?.isMobile
          ? this.getNearestBandIndexForGraphPoint(clientX, clientY, graphContainer)
          : i;
        this.activeDragMarker = bandIndex;
        const targetMarker = this.markers?.[bandIndex] || marker;
        targetMarker.classList.add('active');
        this.selectBand(bandIndex);

        // Store initial position but don't update marker position on mousedown
        this.initialDragX = clientX;
        this.initialDragY = clientY;
        this.hasMoved = false;
      };
      let suppressTapUntil = 0;
      const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

      const cleanupPointer = this.bindGraphPointer(marker, {
        onDragStart: (e) => handleDragStart(e.clientX, e.clientY),
        onDragMove: (e) => this.handleDragMove({
          clientX: e.clientX,
          clientY: e.clientY,
          targetContainer: graphContainer,
          targetBand: this.activeDragMarker
        }),
        onDragEnd: () => this.handleDragEnd(),
        onTap: (e) => {
          if (suppressTapUntil && now() < suppressTapUntil) {
            suppressTapUntil = 0;
            return;
          }
          if (window.uiManager?.layoutMode?.isMobile) {
            this.selectNearestBandFromGraphPoint(e.clientX, e.clientY, graphContainer);
          }
          else this.selectBand(i);
        }
      });
      this.boundEventListeners = this.boundEventListeners || [];
      this.boundEventListeners.push(cleanupPointer);
      
      marker.addEventListener('contextmenu', (e) => { 
        e.preventDefault(); 
        suppressTapUntil = now() + 700;
        this.toggleBandEnabled(i); 
      });
    }
    
    this.markers = markers;
    this.graphContainer = graphContainer;
    this.uiContainer = container;
    this.observeGraphResize(graphContainer);

    // Band settings area
    const bandSettingsDiv = document.createElement('div');
    bandSettingsDiv.className = 'fifteen-band-peq-band-settings';

    // Band tabs container
    const bandTabsContainer = document.createElement('div');
    bandTabsContainer.className = 'fifteen-band-peq-band-tabs';
    bandSettingsDiv.appendChild(bandTabsContainer);

    // Band content panes container
    const bandContentsContainer = document.createElement('div');
    bandContentsContainer.className = 'fifteen-band-peq-band-contents';
    bandSettingsDiv.appendChild(bandContentsContainer);

    // Reset arrays before populating
    this.bandContentPanes = [];
    this.bandCheckboxes = [];
    this.bandTabs = [];

    // Create tabs for each band
    for (let i = 0; i < 15; i++) {
      const button = document.createElement('button');
      button.className = `fifteen-band-peq-band-tab ${i === this.currentBandIndex ? 'active' : ''}`;
      button.dataset.bandIndex = i;
      button.setAttribute('data-instance-id', this.instanceId);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `${this.instanceId}-band-content-${i}`);

      const buttonContent = document.createElement('span');
      buttonContent.style.display = 'inline-flex';
      buttonContent.style.alignItems = 'center';
      buttonContent.style.gap = '5px';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this['e' + i];
      checkbox.id = `${this.instanceId}-band-${i}-enable`;
      checkbox.className = 'fifteen-band-peq-band-tab-checkbox';
      checkbox.setAttribute('aria-label', `Enable Band ${i + 1}`);
      checkbox.autocomplete = "off";
      
      // Event listener for checkbox change
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation(); // Prevent triggering the button click
        const index = parseInt(button.dataset.bandIndex, 10);
        this['e' + index] = e.target.checked;
        this.updateParameters();
        button.classList.toggle('disabled', !e.target.checked);
        if (this.markers && this.markers[index]) {
          this.markers[index].classList.toggle('disabled', !e.target.checked);
        }
        if (this.responseSvg) { this.updateResponse(); }
      });
      
      buttonContent.appendChild(checkbox);
      this.bandCheckboxes[i] = checkbox;

      const buttonText = document.createElement('span');
      buttonText.textContent = `${i + 1}`;
      buttonContent.appendChild(buttonText);
      button.appendChild(buttonContent);

      // Event listener for tab button click
      button.addEventListener('click', (e) => {
        if (e.target === checkbox) return; // Don't select if clicking checkbox
        
        const index = parseInt(e.currentTarget.dataset.bandIndex, 10);
        
        // Update active states
        this.selectBand(index);
      });

      bandTabsContainer.appendChild(button);
      this.bandTabs.push(button);
    }

    // Create content pane for each band
    for (let i = 0; i < 15; i++) {
      const contentPane = document.createElement('div');
      contentPane.className = `fifteen-band-peq-band-content ${i === this.currentBandIndex ? 'active' : ''}`;
      contentPane.id = `${this.instanceId}-band-content-${i}`;
      contentPane.setAttribute('data-instance-id', this.instanceId);
      
      // --- Create a single row for all controls ---
      const controlRow = document.createElement('div');
      controlRow.className = 'fifteen-band-peq-control-row';
      
      // --- Filter Type ---
      const typeLabel = document.createElement('span');
      typeLabel.className = 'fifteen-band-peq-type-label';
      typeLabel.textContent = 'Type: ';
      controlRow.appendChild(typeLabel);
      
      const typeSelect = document.createElement('select');
      typeSelect.className = 'fifteen-band-peq-filter-type';
      typeSelect.addEventListener('change', e => {
        this['t' + i] = e.target.value;
        
        const currentType = this['t' + i];
        const isShelf = currentType === 'ls' || currentType === 'hs';
        const qInput = contentPane.querySelector('.fifteen-band-peq-q-text');
        const qSlider = contentPane.querySelector('.fifteen-band-peq-q-slider');
        
        // Update Q limits based on filter type
        if (isShelf) {
          qInput.max = 2.0;
          qSlider.max = 2.0;
          this['q' + i] = Math.min(this['q' + i], 2.0);
          qInput.value = this['q' + i].toFixed(2);
          qSlider.value = this['q' + i];
        } else {
          qInput.max = 10.0;
          qSlider.max = 10.0;
        }
        
        this.updateParameters();
        if (this.responseSvg) { this.updateResponse(); }
        if (this.markers) { this.updateMarkers(); }
      });
      
      FifteenBandPEQPlugin.FILTER_TYPES.forEach(type => {
        const option = document.createElement('option');
        option.value = type.id;
        option.textContent = type.name;
        typeSelect.appendChild(option);
      });
      
      // Set initial value
      typeSelect.value = this['t' + i];
      
      controlRow.appendChild(typeSelect);
      
      // --- Frequency ---
      const freqLabel = document.createElement('span');
      freqLabel.className = 'fifteen-band-peq-freq-label';
      freqLabel.textContent = 'Freq (Hz):';
      controlRow.appendChild(freqLabel);
      
      const freqText = document.createElement('input');
      freqText.type = 'text';
      freqText.className = 'fifteen-band-peq-freq-text';
      freqText.addEventListener('change', e => {
        let value = parseFloat(e.target.value);
        
        if (isNaN(value)) {
          value = this['f' + i];
          e.target.value = Math.round(value);
          return;
        }
        
        value = Math.max(20, Math.min(value, 20000));
        this['f' + i] = value;
        e.target.value = Math.round(value);
        
        this.updateParameters();
        if (this.responseSvg) { this.updateResponse(); }
        if (this.markers) { this.updateMarkers(); }
      });
      
      // Set initial frequency value
      freqText.value = Math.round(this['f' + i]);
      
      controlRow.appendChild(freqText);
      
      // --- Gain ---
      const gainLabel = document.createElement('span');
      gainLabel.className = 'fifteen-band-peq-gain-label';
      gainLabel.textContent = 'Gain (dB):';
      controlRow.appendChild(gainLabel);
      
      const gainText = document.createElement('input');
      gainText.type = 'text';
      gainText.className = 'fifteen-band-peq-gain-text';
      gainText.addEventListener('change', e => {
        let value = parseFloat(e.target.value);
        
        if (isNaN(value)) {
          value = this['g' + i];
          e.target.value = value.toFixed(1);
          return;
        }
        
        value = Math.max(-20, Math.min(value, 20));
        this['g' + i] = value;
        e.target.value = value.toFixed(1);
        
        this.updateParameters();
        if (this.responseSvg) { this.updateResponse(); }
        if (this.markers) { this.updateMarkers(); }
      });
      
      // Set initial gain value
      gainText.value = this['g' + i].toFixed(1);
      
      controlRow.appendChild(gainText);
      
      contentPane.appendChild(controlRow);
      
      // --- Q Factor (in a separate row) ---
      const qRow = document.createElement('div');
      qRow.className = 'fifteen-band-peq-q-row';
      
      const qLabel = document.createElement('span');
      qLabel.className = 'fifteen-band-peq-q-label';
      qLabel.textContent = 'Q: ';
      qRow.appendChild(qLabel);
      
      const qSlider = document.createElement('input');
      qSlider.type = 'range';
      qSlider.className = 'fifteen-band-peq-q-slider';
      qSlider.min = 0.1;
      qSlider.max = 10.0;
      qSlider.step = 0.01;
      qSlider.addEventListener('input', e => {
        const value = parseFloat(e.target.value);
        this['q' + i] = value;
        
        const qTextInput = contentPane.querySelector('.fifteen-band-peq-q-text');
        qTextInput.value = value.toFixed(2);
        
        this.updateParameters();
        if (this.responseSvg) { this.updateResponse(); }
      });
      qRow.appendChild(qSlider);
      
      // Set initial Q slider value
      qSlider.value = this['q' + i];
      
      const qText = document.createElement('input');
      qText.type = 'text';
      qText.className = 'fifteen-band-peq-q-text';
      qText.addEventListener('change', e => {
        let value = parseFloat(e.target.value);
        const currentType = this['t' + i];
        const isShelf = currentType === 'ls' || currentType === 'hs';
        
        if (isNaN(value)) {
          value = this['q' + i];
          e.target.value = value.toFixed(2);
          return;
        }
        
        if (isShelf) {
          value = Math.max(0.1, Math.min(value, 2.0));
        } else {
          value = Math.max(0.1, Math.min(value, 10.0));
        }
        
        this['q' + i] = value;
        e.target.value = value.toFixed(2);
        
        const qSliderInput = contentPane.querySelector('.fifteen-band-peq-q-slider');
        qSliderInput.value = value;
        
        this.updateParameters();
        if (this.responseSvg) { this.updateResponse(); }
      });
      
      // Set initial Q text value
      qText.value = this['q' + i].toFixed(2);
      
      qRow.appendChild(qText);
      
      contentPane.appendChild(qRow);
      
      bandContentsContainer.appendChild(contentPane);
      this.bandContentPanes.push(contentPane);
    }

    container.appendChild(graphContainer);
    container.appendChild(bandSettingsDiv);
    
    this._uiCreated(); // Set uiCreated = true

    setTimeout(() => { // Defer initial drawing for elements to get dimensions
      this.updateMarkers(); 
      this.updateResponse();
      
      // Ensure all values are displayed correctly after UI creation
      this.setUIValues();
      this.updateUI();
    }, 0);
    
    return container;
  }

  _uiCreated() {
    this.uiCreated = true;
    
    // Set values for the selected band after initialization
    this.setUIBandValues(this.currentBandIndex);
    
    return true;
  }

  setUIValues() {
    for (let i = 0; i < 15; i++) {
      this.setUIBandValues(i);
    }
  }

  setUIBandValues(bandIndex) {
    if (!this.uiCreated || !this.bandContentPanes[bandIndex]) return;
    
    const contentPane = this.bandContentPanes[bandIndex];
    
    // Set filter type
    const typeSelect = contentPane.querySelector('.fifteen-band-peq-filter-type');
    if (typeSelect) typeSelect.value = this['t' + bandIndex];
    
    // Set Q value
    const qSlider = contentPane.querySelector('.fifteen-band-peq-q-slider');
    const qText = contentPane.querySelector('.fifteen-band-peq-q-text');
    if (qSlider) qSlider.value = this['q' + bandIndex];
    if (qText) qText.value = this['q' + bandIndex].toFixed(2);
    
    // Set frequency (display integer part only)
    const freqText = contentPane.querySelector('.fifteen-band-peq-freq-text');
    if (freqText) freqText.value = Math.round(this['f' + bandIndex]);
    
    // Set gain (display with 1 decimal place)
    const gainText = contentPane.querySelector('.fifteen-band-peq-gain-text');
    if (gainText) gainText.value = this['g' + bandIndex].toFixed(1);
    
    // Update checkbox state
    if (this.bandCheckboxes[bandIndex]) {
      this.bandCheckboxes[bandIndex].checked = this['e' + bandIndex];
    }
    
    // Update marker state
    if (this.markers && this.markers[bandIndex]) {
      this.markers[bandIndex].classList.toggle('disabled', !this['e' + bandIndex]);
    }
  }

  freqToX(freq) { return (Math.log10(Math.max(10, Math.min(freq, 40000))) - Math.log10(10)) / (Math.log10(40000) - Math.log10(10)) * 100; }
  xToFreq(xPercent) { return Math.pow(10, Math.log10(10) + (xPercent / 100) * (Math.log10(40000) - Math.log10(10))); }
  gainToY(gain) { return 50 - (gain / 20.0) * 50; } // NEVER Clamp gain
  yToGain(yPercent) { return -(yPercent - 50) / 50.0 * 20.0; }

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
      this.updateMarkers();
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

  getGraphPlotArea(container = this.graphContainer) {
    const margin = 20;
    const rect = container?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
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
      leftPercent: width > 0 ? (marginX / width) * 100 : 0,
      topPercent: height > 0 ? (marginY / height) * 100 : 0,
      widthPercent: width > 0 ? ((plotWidth > 0 ? plotWidth : width) / width) * 100 : 100,
      heightPercent: height > 0 ? ((plotHeight > 0 ? plotHeight : height) / height) * 100 : 100
    };
  }

  updateMarkers() {
    if (!this.markers || !this.graphContainer || !this.uiCreated) return; // Check if UI is created
    const plotArea = this.getGraphPlotArea();
    const graphWidth = this.graphContainer.clientWidth;
    const graphHeight = this.graphContainer.clientHeight;
    if (graphWidth === 0 || graphHeight === 0) return;
    const labelItems = [];
    for (let i = 0; i < 15; i++) {
      const marker = this.markers[i]; if (!marker) continue;
      const freq = this['f' + i]; const gain = this['g' + i]; const enabled = this['e' + i];
      const x = this.freqToX(freq); const y = this.gainToY(gain);
      const xPos = plotArea.leftPercent + (x / 100) * plotArea.widthPercent;
      const yPos = plotArea.topPercent + (y / 100) * plotArea.heightPercent;
      marker.style.left = `${xPos}%`; marker.style.top = `${yPos}%`;
      marker.classList.toggle('disabled', !enabled);
      const markerTextEl = marker.querySelector('.fifteen-band-peq-marker-text'); if (!markerTextEl) continue;
      markerTextEl.className = 'fifteen-band-peq-marker-text';
      const freqDisplayText = freq >= 1000 ? `${(freq/1000).toFixed(1)}k` : freq.toFixed(0); // Adjusted kHz display
      const type = this['t' + i];
      markerTextEl.innerHTML = `${freqDisplayText}Hz${type === 'lp' || type === 'hp' || type === 'bp' || type === 'ap' || type === 'no' ? '' : `<br>${gain.toFixed(1)}dB`}`;
      labelItems.push({
        el: markerTextEl,
        cx: (xPos / 100) * graphWidth,
        cy: (yPos / 100) * graphHeight
      });
    }
    // Scatter the freq/gain labels so they don't overlap markers/each other or
    // spill outside the graph. Prefer top/bottom placement for this plugin.
    this.layoutMarkerLabels?.({ items: labelItems, width: graphWidth, height: graphHeight, axis: 'vertical' });
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
    if (!this.responseSvg || !this.responseSvg.clientWidth || !this.responseSvg.clientHeight || !this.uiCreated) return; // Check if UI is created
    const width = this.responseSvg.clientWidth;
    const height = this.responseSvg.clientHeight;
    this.responseSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.responseSvg.setAttribute('preserveAspectRatio', 'none');

    const freqPoints = [];
    const numPoints = Math.max(200, width / 2);
    const minFreq = 10;
    const maxFreq = 40000;
    for (let i = 0; i <= numPoints; i++) {
      freqPoints.push(minFreq * Math.pow(maxFreq / minFreq, i / numPoints));
    }

    const responseDataPoints = freqPoints.map(freq => {
      let totalGainDb = 0;
      for (let band = 0; band < 15; band++) {
        if (!this['e' + band]) continue;
        const bf = this['f' + band], bg = this['g' + band], bq = this['q' + band], bt = this['t' + band];
        if (Math.abs(bg) < 0.01 && !['lp', 'hp', 'bp', 'no', 'ap'].includes(bt)) continue;
        totalGainDb += this.calculateBandResponse(freq, bf, bg, bq, bt);
      }
      return totalGainDb;
    });

    const pathPoints = [];
    for (let i = 0; i < freqPoints.length; i++) {
      const x = width * (this.freqToX(freqPoints[i]) / 100);
      const y = height * (this.gainToY(responseDataPoints[i]) / 100); // NEVER Clamp gain
      pathPoints.push(i === 0 ? `M ${x.toFixed(2)},${y.toFixed(2)}` : `L ${x.toFixed(2)},${y.toFixed(2)}`);
    }

    while (this.responseSvg.firstChild) {
      this.responseSvg.removeChild(this.responseSvg.firstChild);
    }

    if (pathPoints.length > 0) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathPoints.join(' '));
      path.setAttribute('stroke', '#00ff00');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.id = `fifteen-band-peq-response-path-${this.id}`;
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
    
    const plotArea = this.getGraphPlotArea(container);
    let x = (clientX - plotArea.left) / plotArea.width;
    x = Math.max(0, Math.min(1, x));
    let y = (clientY - plotArea.top) / plotArea.height;
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
    
    this.activeDragMarker = null;
    this.hasMoved = false; // Reset movement state
    
    if (this.boundMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundMouseMoveHandler);
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseMoveHandler = null;
      this.boundMouseUpHandler = null;
    }
  }
  
  // Add plugin cleanup method
  cleanup() {
    this.disconnectGraphResizeObserver();
    // Clean up event listeners
    if (this.boundMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundMouseMoveHandler);
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseMoveHandler = null;
      this.boundMouseUpHandler = null;
    }
    if (Array.isArray(this.boundEventListeners)) {
      this.boundEventListeners.forEach(cleanup => cleanup());
      this.boundEventListeners = [];
    }
    
    // Reset active state
    this.activeDragMarker = null;
    
    // Clean up other resources
    this.uiCreated = false;
    super.cleanup();
  }
  
  /**
   * Handle text file import for txt format
   * @param {File} file - The selected file
   */
  handleFileImport(file) {
    // Reset the file input value to allow re-importing the same file
    const fileInput = document.getElementById(`${this.instanceId}-file-input`);
    if (fileInput) {
      fileInput.value = '';
    }
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const content = e.target.result;
      this.parseAndImportTXT(content);
    };
    
    reader.onerror = () => {
      console.error('Error reading file');
      alert('Error reading file. Please try again.');
    };
    
    reader.readAsText(file);
  }
  
  /**
   * Parse txt format and apply parameters
   * @param {string} content - The text content to parse
   */
  parseAndImportTXT(content) {
    // Reset all bands first to default settings
    for (let i = 0; i < 15; i++) {
      this.setBand(i, FifteenBandPEQPlugin.BANDS[i].freq, 0, 1.0, 'pk', false);
    }
    
    const lines = content.split('\n');
    let filterIndex = 0;
    
    for (let line of lines) {
      line = line.trim();
      
      // Skip comments and empty lines
      if (line.startsWith('#') || line.length === 0) {
        continue;
      }
      
      // Skip Preamp settings
      if (line.startsWith('Preamp:')) {
        continue;
      }
      
      // Parse filter lines (Format: Filter N: ON TYPE Fc X Hz Gain Y dB Q Z)
      if (line.startsWith('Filter')) {
        const match = line.match(/Filter\s+(\d+):\s+ON\s+(\w+)\s+Fc\s+(\d+(?:\.\d+)?)\s+Hz\s+Gain\s+([-+]?\d+(?:\.\d+)?)\s+dB\s+Q\s+(\d+(?:\.\d+)?)/);
        
        if (match) {
          const filterNum = parseInt(match[1], 10);
          const filterType = match[2];
          const frequency = parseFloat(match[3]);
          const gain = parseFloat(match[4]);
          const q = parseFloat(match[5]);
          
          // Map to our filter types (if supported)
          const mappedType = FifteenBandPEQPlugin.EQ_FILTER_MAP[filterType];
          
          if (mappedType && filterIndex < 15) {
            // Apply this filter to the band
            this.setBand(filterIndex, frequency, gain, q, mappedType, true);
            filterIndex++;
          }
        }
      }
    }
    
    // Update UI after all changes are applied
    if (this.uiCreated) {
      this.setUIValues();
      if (this.responseSvg) { this.updateResponse(); }
      if (this.markers) { this.updateMarkers(); }
    }
  }
} 

// Register plugin
if (typeof window !== 'undefined') {
  window.FifteenBandPEQPlugin = FifteenBandPEQPlugin;
}
