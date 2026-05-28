class OscilloscopePlugin extends PluginBase {
    constructor() {
      super('Oscilloscope', 'Real-time waveform visualization');
  
      // ---------------------------
      // Parameter Initialization
      // ---------------------------
      // Display Time (dt): total time displayed along the horizontal axis.
      // Allowed range: 1 ms to 100 ms (internal unit: sec)
      this.displayTime = 0.01; // default 10 ms = 0.01 sec
  
      // Trigger parameters:
      // Trigger Mode (tm): "Auto" (continuous sweep with forced update) or "Normal" (freeze display if no trigger)
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
      this.animationId = null;
      this.drawInterval = 1000 / 30; // target 30 FPS
  
      // Circular buffer for waveform data.
      this.bufferSize = 65536;
      this.waveformBuffer = new Float32Array(this.bufferSize);
      // triggerIndex: updated by the Audio Worklet processor upon trigger detection.
      this.triggerIndex = 0;
      // lastBufferPosition: current write position received from the Worklet.
      this.lastBufferPosition = 0;
  
      // Sample rate (will be updated from processor parameters)
      this.sampleRate = 44100;
  
      // ---------------------------
      // Accumulation state for waveform capture
      // ---------------------------
      // frozenDisplayBuffer: frozen snapshot captured once Display Time samples have been accumulated.
      this.frozenDisplayBuffer = null;
      // lastProcessedTriggerIndex: used to detect new trigger events.
      this.lastProcessedTriggerIndex = null;
      // accumulating: flag indicating that accumulation is in progress.
      this.accumulating = false;
      // accumulationBuffer: separate buffer to accumulate samples after trigger.
      this.accumulationBuffer = null;
      // accumulationBufferIndex: current write index in the accumulation buffer.
      this.accumulationBufferIndex = 0;
      // lastAccumulationBufferPos: last circular buffer index processed for accumulation.
      this.lastAccumulationBufferPos = 0;
  
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
  
    // clearBuffer: Clears the internal circular buffer and accumulation state.
    clearBuffer() {
      this.waveformBuffer.fill(0);
      this.lastBufferPosition = 0;
      this.triggerIndex = 0;
      this.frozenDisplayBuffer = null;
      this.lastProcessedTriggerIndex = null;
      this.accumulating = false;
      this.accumulationBuffer = null;
      this.accumulationBufferIndex = 0;
      this.lastAccumulationBufferPos = 0;
    }
  
    // ================================================================
    // Audio Worklet Processor function
    //
    // This function runs in the Audio Worklet context. It writes input audio
    // into a circular buffer and performs edge–trigger detection.
    // Additionally, it passes the sampleRate parameter.
    // ================================================================
    static processorFunction = `
      // Copy the input data into a result buffer.
      const result = data;
  
      const { channelCount, blockSize } = parameters;
      // Use short parameter names:
      // tm: triggerMode, tl: triggerLevel, te: triggerEdge, ho: holdoff
      const mode = parameters.tm;
  
      // Initialize state if needed.
      if (!context.initialized || !context.buffer) {
        context.buffer = [new Float32Array(65536)];
        context.bufferPosition = 0;
        context.initialized = true;
        context.lastTriggerTime = 0;
        context.triggerIndex = 0;
        context.lastAutoSweepTime = 0;
      }
  
      // Write the average of L/R channels into the circular buffer.
      const averageBuffer = context.buffer[0];
      let currentPosition = context.bufferPosition;
      for (let i = 0; i < blockSize; i++) {
        const leftSample = data[i] || 0;
        const rightSample = channelCount > 1 ? data[blockSize + i] : leftSample;
        const averageSample = (leftSample + rightSample) * 0.5;
        averageBuffer[currentPosition] = averageSample;
        currentPosition = (currentPosition + 1) & (65536 - 1);
      }
      context.bufferPosition = currentPosition;
  
      let triggered = false;
      const trigLevel = parameters.tl;
      const rising = parameters.te === 'Rising';
      let prevAvg = averageBuffer[(currentPosition - blockSize + 65536) & (65536 - 1)];
      for (let i = 0; i < blockSize; i++) {
        const currentSampleIndexInBuffer = (currentPosition - blockSize + i + 65536) & (65536 - 1);
        const currAvg = averageBuffer[currentSampleIndexInBuffer];
        
        if ((rising && prevAvg < trigLevel && currAvg >= trigLevel) ||
            (!rising && prevAvg > trigLevel && currAvg <= trigLevel)) {
          if (time - context.lastTriggerTime >= parameters.ho) {
            context.triggerIndex = currentSampleIndexInBuffer;
            context.lastTriggerTime = time;
            triggered = true;
            if (mode === 'Auto') {
              context.lastAutoSweepTime = time;
            }
            break;
          }
        }
        prevAvg = currAvg;
      }
      if (mode === 'Auto' && !triggered) {
        if (!context.lastAutoSweepTime) {
          context.lastAutoSweepTime = time;
        }
        if (time - context.lastAutoSweepTime >= 0.1) {
          context.triggerIndex = context.bufferPosition;
          context.lastAutoSweepTime = time;
        }
      }
  
      result.measurements = {
        buffer: context.buffer[0],
        triggerIndex: context.triggerIndex,
        currentPosition: context.bufferPosition,
        time: time,
        sampleRate: parameters.sampleRate
      };
  
      return result;
    `;
  
    // ================================================================
    // createUI: Build the UI (parameter controls + canvas).
    // All comments are in English.
    // ================================================================
    createUI() {
      if (this.observer) {
        this.observer.disconnect();
      }
      const container = document.createElement('div');
      container.className = 'plugin-parameter-ui';
  
      const parametersGrid = document.createElement('div');
      parametersGrid.className = 'parameters-grid';
  
      // --- Display Time Control (ms) ---
      parametersGrid.appendChild(this.createParameterControl(
        'Display Time', 1, 100, 1,
        (this.displayTime * 1000).toFixed(0),
        (value) => {
          this.setDisplayTime(value / 1000);
          this.clearBuffer();
          this.updateParameters();
        },
        'ms'
      ));
  
      // --- Trigger Mode Control (Auto/Normal) ---
      const tmRow = document.createElement('div');
      tmRow.className = 'parameter-row';
  
      const tmLabel = document.createElement('label');
      tmLabel.textContent = 'Trigger Mode:';

      const modes = ['Auto', 'Normal'];
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
        return label;
      });
      tmRow.appendChild(tmLabel);
      modeRadios.forEach(r => tmRow.appendChild(r));
      parametersGrid.appendChild(tmRow);
  
      // --- Trigger Level Control ---
      parametersGrid.appendChild(this.createParameterControl(
        'Trigger Level', -1.0, 1.0, 0.01,
        this.triggerLevel,
        (value) => {
          this.setTriggerLevel(value);
          this.updateParameters();
        },
        ''
      ));
  
      // --- Trigger Edge Control (Rising/Falling) ---
      const teRow = document.createElement('div');
      teRow.className = 'parameter-row';
  
      const teLabel = document.createElement('label');
      teLabel.textContent = 'Trigger Edge:';

      const edges = ['Rising', 'Falling'];
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
        return label;
      });
      teRow.appendChild(teLabel);
      edgeRadios.forEach(r => teRow.appendChild(r));
      parametersGrid.appendChild(teRow);
  
      // --- Holdoff Control (ms) ---
      parametersGrid.appendChild(this.createParameterControl(
        'Holdoff', 0.1, 10, 0.1,
        (this.holdoff * 1000).toFixed(1),
        (value) => {
          this.setHoldoff(value / 1000);
          this.updateParameters();
        },
        'ms'
      ));
  
      // --- Display Level Control (dB) ---
      parametersGrid.appendChild(this.createParameterControl(
        'Display Level', -96, 0, 1,
        this.displayLevel,
        (value) => {
          this.setDisplayLevel(value);
          this.updateParameters();
        },
        'dB'
      ));

      // --- Vertical Offset Control ---
      parametersGrid.appendChild(this.createParameterControl(
        'Vertical Offset', -1.0, 1.0, 0.01,
        this.verticalOffset,
        (value) => {
          this.setVerticalOffset(value);
          this.updateParameters();
        },
        ''
      ));
  
      container.appendChild(parametersGrid);
  
      // --- Graph Container and Canvas ---
      const graphContainer = document.createElement('div');
      graphContainer.className = 'graph-container';
  
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024;
      this.canvas.height = 480;
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      graphContainer.appendChild(this.canvas);
  
      container.appendChild(graphContainer);
  
      if (this.observer == null) {
        this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
      }
      this.observer.observe(this.canvas);

      return container;
    }
  
    // ---------------------------
    // Setter Methods
    // ---------------------------
    setDisplayTime(value) {
      const newValue = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(newValue)) {
        // Clamp to allowed range: 0.001 sec (1 ms) to 0.1 sec (100 ms)
        this.displayTime = newValue < 0.001 ? 0.001 : (newValue > 0.1 ? 0.1 : newValue);
        this.clearBuffer();
      }
      this.updateParameters();
    }
  
    setTriggerMode(value) {
      if (['Auto', 'Normal'].includes(value)) {
        this.triggerMode = value;
        // Clear frozen snapshot when mode changes.
        this.frozenDisplayBuffer = null;
        this.lastProcessedTriggerIndex = null;
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
        this.lastProcessedTriggerIndex = null;
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
  
    // ---------------------------
    // onMessage: Receive messages from the Audio Worklet.
    // ---------------------------
    onMessage(message) {
      // Check that measurements and buffer exist.
      if (
        message.type === 'processBuffer' &&
        message.measurements &&
        message.measurements.buffer
      ) {
        this.process(message.measurements.buffer, message);
      }
    }
  
    // ---------------------------
    // process: Update the circular buffer and accumulate waveform samples after trigger.
    //
    // When a new trigger event is detected, a new accumulation is started.
    // New samples from the circular buffer are appended (handling wrap-around)
    // until the number of samples equals sampleRate * displayTime.
    // Once captured, the frozen snapshot is kept until the next trigger.
    // ---------------------------
    process(audioBuffer, message) {
      if (!audioBuffer || !message?.measurements?.buffer) {
        return audioBuffer;
      }
      if (!this.enabled) {
        return audioBuffer;
      }
      // Update sampleRate from measurements.
      if (message.measurements.sampleRate) {
        this.sampleRate = message.measurements.sampleRate;
      }
      // Use the provided buffer and determine its actual length.
      const buffer = message.measurements.buffer;
      const bufferLength = buffer.length;
      // Resize waveformBuffer if necessary.
      if (this.waveformBuffer.length !== bufferLength) {
        this.waveformBuffer = new Float32Array(bufferLength);
      }
      // Update local circular buffer.
      this.waveformBuffer.set(buffer);
      const newTriggerIndex = message.measurements.triggerIndex;
      const currentPos = message.measurements.currentPosition;
  
      // Only start a new accumulation if not already accumulating.
      if (!this.accumulating && (this.lastProcessedTriggerIndex === null || this.lastProcessedTriggerIndex !== newTriggerIndex)) {
        // New trigger: start accumulating.
        this.lastProcessedTriggerIndex = newTriggerIndex;
        this.accumulating = true;
        const displaySamples = Math.floor(this.sampleRate * this.displayTime);
        this.accumulationBuffer = new Float32Array(displaySamples);
        this.accumulationBufferIndex = 0;
        // Start accumulation from the trigger index.
        this.lastAccumulationBufferPos = newTriggerIndex;
        // Do NOT clear the previous frozen snapshot until new accumulation is complete.
      }
  
      // If accumulating, append new samples from the circular buffer.
      if (this.accumulating) {
        const displaySamples = this.accumulationBuffer.length; // total samples to accumulate
        let availableSpace = displaySamples - this.accumulationBufferIndex;
        if (availableSpace > 0) {
          if (currentPos >= this.lastAccumulationBufferPos) {
            // No wrap-around.
            let newSamples = buffer.subarray(this.lastAccumulationBufferPos, currentPos);
            if (newSamples.length > availableSpace) {
              newSamples = newSamples.subarray(0, availableSpace);
            }
            this.accumulationBuffer.set(newSamples, this.accumulationBufferIndex);
            this.accumulationBufferIndex += newSamples.length;
          } else {
            // Wrap-around: first copy from lastAccumulationBufferPos to end.
            let part1 = buffer.subarray(this.lastAccumulationBufferPos, bufferLength);
            if (part1.length > availableSpace) {
              part1 = part1.subarray(0, availableSpace);
            }
            this.accumulationBuffer.set(part1, this.accumulationBufferIndex);
            this.accumulationBufferIndex += part1.length;
            availableSpace = displaySamples - this.accumulationBufferIndex;
            if (availableSpace > 0) {
              let part2 = buffer.subarray(0, currentPos);
              if (part2.length > availableSpace) {
                part2 = part2.subarray(0, availableSpace);
              }
              this.accumulationBuffer.set(part2, this.accumulationBufferIndex);
              this.accumulationBufferIndex += part2.length;
            }
          }
          // Update the last processed position.
          this.lastAccumulationBufferPos = currentPos;
        }
        // If we have accumulated enough samples, finalize the accumulation.
        if (this.accumulationBufferIndex >= displaySamples) {
          this.frozenDisplayBuffer = this.accumulationBuffer;
          this.accumulating = false;
        }
      }
  
      // Until a new trigger occurs, frozenDisplayBuffer remains unchanged.
      return audioBuffer;
    }
  
    handleIntersect(entries) {
      entries.forEach(entry => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible) {
              this.startAnimation();
          } else {
              this.stopAnimation();
          }
      });
    }

    startAnimation() {
        if (this.animationFrameId) return;
        if (!this.enabled || !this._sectionEnabled) return; // Skip if disabled or section is off.

        const animate = () => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawWaveform();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();
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
    // The waveform is drawn as a continuous line (using linear interpolation)
    // based on the frozen snapshot (accumulated Display Time samples).
    // Until a frozen snapshot is available, only the grid is drawn.
    // ---------------------------
    drawWaveform() {
      const { ctx, canvas } = this;
      const { width, height } = canvas;
  
      // Clear the canvas.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
  
      // Left margin for vertical axis labels.
      const leftMargin = 80;
  
      // Vertical scaling.
      const factor = 1 / Math.pow(10, this.displayLevel / 20);
      // Compute centerY based on Vertical Offset.
      const centerY = height / 2 - (this.verticalOffset * height / 2);
  
      // ---------------------------
      // Draw vertical grid and amplitude scale based on visible amplitude range.
      // ---------------------------
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.font = '12px Arial';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#666';
      ctx.textBaseline = 'middle';
  
      // Compute visible amplitude range based on the mapping:
      // y = centerY - (amp * factor) * (height/2)
      // => amp = (centerY - y) / ((height/2) * factor)
      const ampTop = centerY / ((height / 2) * factor);         // amplitude corresponding to y=0 (top)
      const ampBottom = (centerY - height) / ((height / 2) * factor); // amplitude corresponding to y=height (bottom)
      const visibleAmpMin = Math.min(ampTop, ampBottom);
      const visibleAmpMax = Math.max(ampTop, ampBottom);
  
      const desiredTickCount = 20;
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
      const textMargin = 6; // approximately half the font size
  
      for (let tick = tickStart; tick <= tickEnd + tickStep * 0.5; tick += tickStep) {
        const y = centerY - (tick * factor) * (height / 2);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        // Only draw text if it does not overlap the top or bottom edge.
        if (y - textMargin >= 0 && y + textMargin <= height) {
          ctx.fillText(tick.toFixed(decimals), 64, y);
        }
      }
  
      // ---------------------------
      // Draw horizontal grid and time scale.
      // ---------------------------
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = leftMargin + ((width - leftMargin) * i) / 10;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (i !== 0 && i !== 10) {
          ctx.fillStyle = '#666';
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          const t_ms = (i / 10) * (this.displayTime * 1000);
          ctx.fillText(t_ms.toFixed(2) + ' ms', x, height - 40);
        }
      }
  
      // Draw axis labels.
      ctx.fillStyle = '#fff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Time (ms)', leftMargin + (width - leftMargin) / 2, height - 10);
      ctx.save();
      ctx.translate(20, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('Amplitude', 0, 0);
      ctx.restore();
  
      // ---------------------------
      // Draw the waveform if a frozen snapshot is available.
      // ---------------------------
      if (this.frozenDisplayBuffer) {
        const displayBuffer = this.frozenDisplayBuffer;
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Draw continuous line: map each sample index to x coordinate.
        for (let i = 0; i < displayBuffer.length; i++) {
          const x = leftMargin + (i / (displayBuffer.length - 1)) * (width - leftMargin);
          const sample = displayBuffer[i];
          const y = centerY - (sample * factor) * (height / 2);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }
  
    // ---------------------------
    // cleanup: Cancel the animation and remove event listeners.
    // ---------------------------
    cleanup() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      for (const [element, listener] of this.boundEventListeners) {
        element.removeEventListener('change', listener);
        element.removeEventListener('input', listener);
      }
      this.boundEventListeners.clear();
    }
  }
  
  // Register plugin globally (for browser environments)
  if (typeof window !== 'undefined') {
    window.OscilloscopePlugin = OscilloscopePlugin;
  }
