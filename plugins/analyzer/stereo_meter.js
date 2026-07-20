const STEREO_FIELD_TAP_FRAME = 6;
const STEREO_FIELD_TELEMETRY_VERSION = 2;
const STEREO_FIELD_PAYLOAD_HEADER_BYTES = 8;
const STEREO_FIELD_MAX_DELTA_SAMPLES = 8000;
const STEREO_FIELD_SAMPLE_BYTES = 8;
const STEREO_FIELD_ENVELOPE_BINS = 360;
const STEREO_FIELD_PAYLOAD_TAIL_BYTES = STEREO_FIELD_ENVELOPE_BINS * 4 + 16;
const STEREO_FIELD_SAMPLE_FLAG_DISCONTINUITY = 1;
const STEREO_FIELD_MAX_SAMPLE_RATE = 768000;

class StereoMeterPlugin extends PluginBase {
  constructor() {
    super('Stereo Meter', 'Stereo balance and phase visualization');

    // Parameter initialization (Window: 10–1000 ms, default 100 ms)
    this.windowTime = 0.1; // 0.1 sec = 100 ms

    // Canvas and drawing setup
    this.canvas = null;
    this.ctx = null;
    this.animationId = null;
    this.animationFrameId = null;
    this.lastDrawTime = 0;
    this.resizeGraphDisposer = null;
    this.graphDpr = 1;
    this.graphCssWidth = 480;

    // Sample rate (will be updated from processor parameters)
    this.sampleRate = 44100;

    // Internal event listener bookkeeping
    this.boundEventListeners = new Map();

    // Precompute a color lookup table for green values (0–255)
    this._colorLookup = new Array(256);
    for (let i = 0; i < 256; i++) {
      this._colorLookup[i] = `rgb(0,${i},0)`;
    }
    this.observer = null;

    // Persistent buffers for drawing
    this.buckets = new Array(256);
    for (let i = 0; i < 256; i++) {
      this.buckets[i] = [];
    }
    this.smoothedPeaks = new Float32Array(360);
    this.dspStereoFieldSnapshot = null;
    this.dspXBuffer = null;
    this.dspYBuffer = null;
    this.dspBufferPosition = 0;
    this.dspLastTelemetrySequence = null;
    this._dspTelemetryHub = null;
    this._dspTelemetryTapId = null;
    this._dspTelemetryUnsubscribe = null;
    this._boundDspStereoFieldTelemetry = frame => this.handleDspStereoFieldTelemetry(frame);

    // Register the Audio Worklet Processor
    this.registerProcessor(`
    // --- Optimization: Pre-calculate constant ---
    const RADIANS_TO_DEGREES = 180 / Math.PI;
    // --- Optimization: Pre-calculate constant for decay ---
    // -20 dB/s decay corresponds to amplitude multiplication by 10^(-t)
    // Math.pow(10, -t) = Math.exp(-t * Math.LN10)
    const LOG10 = Math.LN10; // Cache Math.LN10

    // Compute a dynamic buffer size based on the sample rate.
    const maxWindowSec = 1.0; // Maximum window time (1 second)
    // --- Optimization: Use const for parameters that don't change locally ---
    const sampleRate = parameters.sampleRate;
    const requiredSamples = Math.ceil(sampleRate * maxWindowSec);
    let computedBufferSize = 1;
    // Use Math.pow and Math.ceil for potentially clearer intent and potential micro-optimization
    // Although the original while loop is likely very fast anyway as requiredSamples is not excessively large.
    // Let's stick to the original loop for exact behavior matching, as performance gain is negligible here.
    while (computedBufferSize < requiredSamples) {
      computedBufferSize *= 2;
    }

    // Initialize or update state if the buffer size has changed.
    if (!context.initialized || context.bufferSize !== computedBufferSize) {
      context.bufferSize = computedBufferSize;
      // --- Optimization: Removed unused context.buffer allocation ---
      // const { channelCount } = parameters; // channelCount only used for removed buffer
      // context.buffer = new Array(channelCount);
      // for (let i = 0; i < channelCount; i++) {
      //   context.buffer[i] = new Float32Array(context.bufferSize);
      // }
      context.bufferPosition = 0;
      context.initialized = true;
      context.lastPeakUpdateTime = time; // Initialize peak update time
      // Allocate necessary buffers
      context.xBuffer = new Float32Array(context.bufferSize);
      context.yBuffer = new Float32Array(context.bufferSize);
      context.peakBuffer = new Float32Array(360); // Remains 360 regardless of bufferSize
      // --- Optimization: Initialize peakBuffer to 0 explicitly if needed ---
      // Although Float32Array is zero-initialized by default, being explicit can sometimes clarify.
      // context.peakBuffer.fill(0); // Keep implicit zero-init for brevity matching original
    }

    const result = data; // Direct reference instead of copy

    // --- Optimization: Destructure parameters once ---
    // Note: sampleRate already destructured above. channelCount is no longer needed here.
    const { blockSize } = parameters; // Assuming data contains interleaved stereo channels

    // --- Optimization: Alias context properties frequently accessed in the loop ---
    // This reduces property lookups inside the hot loop.
    const xBuffer = context.xBuffer;
    const yBuffer = context.yBuffer;
    const peakBuffer = context.peakBuffer;
    const bufferSize = context.bufferSize;
    // Use a local variable for bufferPosition within the loop
    let currentPosition = context.bufferPosition;
    // --- Optimization: Pre-calculate bufferSize - 1 for bitwise AND ---
    const bufferMask = bufferSize - 1; // Valid because bufferSize is power of 2

    // Process each sample in the current block.
    for (let i = 0; i < blockSize; i++) {
      // --- Optimization: Direct indexing assuming interleaved stereo ---
      // data layout: [L0, R0, L1, R1, ...] -> This is NOT what the original code does.
      // Original code accesses: left = data[i], right = data[i + blockSize]
      // This assumes data layout: [L0, L1, ..., L(blockSize-1), R0, R1, ..., R(blockSize-1)]
      // Assuming channelCount is 2 and data is planar (separate blocks per channel).
      // Let's stick PRECISELY to the original access pattern.
      const left = data[i];
      const right = data[i + blockSize]; // Assumes planar layout [LLL...RRR...]

      // Calculate x and y values.
      const x = right - left; // x = R - L
      const y = left + right; // y = L + R

      // Store x and y in circular buffers using local alias.
      xBuffer[currentPosition] = x;
      yBuffer[currentPosition] = y;

      // Compute angle (in degrees) and magnitude.
      // --- Optimization: Use pre-calculated constant ---
      const angle = -Math.atan2(y, x) * RADIANS_TO_DEGREES;
      // --- Optimization: Calculation is necessary, sqrt/atan2 are inherent costs ---
      const magnitude = Math.sqrt(x * x + y * y); // Can't avoid sqrt if true magnitude needed

      // Update the peak value for the corresponding angle.
      const angleIndex = ((Math.round(angle) % 360) + 360) % 360;

      // Use local alias for peakBuffer access
      if (magnitude > peakBuffer[angleIndex]) {
        peakBuffer[angleIndex] = magnitude;
      }

      // Advance the circular buffer position using bitwise AND and local variable.
      currentPosition = (currentPosition + 1) & bufferMask;
    }
    // --- Optimization: Update context state variable after the loop ---
    context.bufferPosition = currentPosition;

    // Apply a peak decay of -20 dB/s.
    const lastPeakUpdateTime = context.lastPeakUpdateTime; // Use local var
    const timeDelta = time - lastPeakUpdateTime;

    if (timeDelta > 0) {
      // --- Optimization: Use Math.exp and cached Math.LN10 ---
      // Potentially faster than Math.pow(10, x) on some engines. Behavior is identical.
      const decayFactor = Math.exp(-timeDelta * LOG10);
      // Use local alias for peakBuffer access
      // --- Optimization: Loop unrolling unlikely to help much for 360 iterations ---
      for (let i = 0; i < 360; i++) {
        peakBuffer[i] *= decayFactor;
      }
      context.lastPeakUpdateTime = time; // Update time after applying decay
    }

    // Throttle measurements to 60 FPS (1/60 second intervals)
    const measurementInterval = 1 / 60; // 16.67ms
    if (!context.lastMeasurementTime) {
      context.lastMeasurementTime = 0;
    }
    
    if (time - context.lastMeasurementTime >= measurementInterval) {
      // Attach measurements to the result array.
      // Functionality requires attaching these exact properties.
      result.measurements = {
        xBuffer: context.xBuffer, // Return the buffer from context
        yBuffer: context.yBuffer, // Return the buffer from context
        peakBuffer: context.peakBuffer, // Return the buffer from context
        currentPosition: context.bufferPosition, // Return the final position
        time: time,
        sampleRate: sampleRate // Use the value derived earlier
      };
      context.lastMeasurementTime = time;
    }

    // Return the copied input data with attached measurements.
    return result;
    `);
  }

  createUI() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.resizeGraphDisposer) {
      this.resizeGraphDisposer();
      this.resizeGraphDisposer = null;
    }
    const container = document.createElement('div');
    container.className = 'plugin-parameter-ui stereo-meter';

    // Use createParameterControl for Window time
    container.appendChild(this.createParameterControl(
      'Window', 10, 1000, 1,
      (this.windowTime * 1000).toFixed(0),
      (value) => this.setWindowTime(value / 1000),
      'ms'
    ));

    // Create the graph container and canvas.
    const graph = this.createResponsiveGraph({
      maxWidth: 480,
      aspectRatio: '1 / 1',
      onResize: ({ canvas, cssWidth, dpr }) => {
        this.canvas = canvas;
        this.graphCssWidth = cssWidth;
        this.graphDpr = dpr;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.drawMeter();
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

    return container;
  }

  setWindowTime(value) {
    const newValue = typeof value === 'number' ? value : parseFloat(value);
    if (!isNaN(newValue)) {
      // Clamp the value between 10 ms (0.01 sec) and 1000 ms (1 sec).
      this.windowTime = newValue < 0.01 ? 0.01 : (newValue > 1.0 ? 1.0 : newValue);
    }
    this.updateParameters();
  }

  getParameters() {
    this.ensureDspTelemetrySubscription();
    return {
      type: this.constructor.name,
      enabled: this.enabled,
      wt: this.windowTime
    };
  }

  setParameters(params) {
    if (params.wt !== undefined) this.setWindowTime(params.wt);
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
        STEREO_FIELD_TAP_FRAME,
        this._boundDspStereoFieldTelemetry
      );
      if (typeof unsubscribe !== 'function') {
        hub.unsubscribe?.(
          tapId,
          STEREO_FIELD_TAP_FRAME,
          this._boundDspStereoFieldTelemetry
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

  parseDspStereoFieldTelemetryFrame(frame) {
    if (frame?.frameType !== STEREO_FIELD_TAP_FRAME ||
        frame.formatVersion !== STEREO_FIELD_TELEMETRY_VERSION) {
      return null;
    }
    const payload = frame.payload;
    if (!payload || typeof payload.getUint8 !== 'function' ||
        typeof payload.getUint16 !== 'function' ||
        typeof payload.getFloat32 !== 'function' ||
        !Number.isInteger(payload.byteLength) ||
        payload.byteLength < STEREO_FIELD_PAYLOAD_HEADER_BYTES +
          STEREO_FIELD_PAYLOAD_TAIL_BYTES) {
      return null;
    }

    const sampleRate = payload.getFloat32(0, true);
    const sampleCount = payload.getUint16(4, true);
    const sampleFlags = payload.getUint16(6, true);
    const expectedBytes = STEREO_FIELD_PAYLOAD_HEADER_BYTES +
      sampleCount * STEREO_FIELD_SAMPLE_BYTES + STEREO_FIELD_PAYLOAD_TAIL_BYTES;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
        sampleRate > STEREO_FIELD_MAX_SAMPLE_RATE ||
        sampleCount > STEREO_FIELD_MAX_DELTA_SAMPLES ||
        (sampleFlags & ~STEREO_FIELD_SAMPLE_FLAG_DISCONTINUITY) !== 0 ||
        payload.byteLength !== expectedBytes) {
      return null;
    }

    const samples = new Float32Array(sampleCount * 2);
    for (let sample = 0; sample < sampleCount; sample++) {
      const offset = STEREO_FIELD_PAYLOAD_HEADER_BYTES +
        sample * STEREO_FIELD_SAMPLE_BYTES;
      const x = payload.getFloat32(offset, true);
      const y = payload.getFloat32(offset + 4, true);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      samples[sample * 2] = x;
      samples[sample * 2 + 1] = y;
    }

    const envelopeOffset = STEREO_FIELD_PAYLOAD_HEADER_BYTES +
      sampleCount * STEREO_FIELD_SAMPLE_BYTES;
    const peakBuffer = new Float32Array(STEREO_FIELD_ENVELOPE_BINS);
    for (let bin = 0; bin < STEREO_FIELD_ENVELOPE_BINS; bin++) {
      const peak = payload.getFloat32(envelopeOffset + bin * 4, true);
      if (!Number.isFinite(peak) || peak < 0) return null;
      peakBuffer[bin] = peak;
    }

    const statisticsOffset = envelopeOffset + STEREO_FIELD_ENVELOPE_BINS * 4;
    const correlation = payload.getFloat32(statisticsOffset, true);
    const balance = payload.getFloat32(statisticsOffset + 4, true);
    const peakL = payload.getFloat32(statisticsOffset + 8, true);
    const peakR = payload.getFloat32(statisticsOffset + 12, true);
    if (!Number.isFinite(correlation) || correlation < -1 || correlation > 1 ||
        !Number.isFinite(balance) ||
        !Number.isFinite(peakL) || peakL < 0 ||
        !Number.isFinite(peakR) || peakR < 0) {
      return null;
    }
    return {
      sampleRate,
      sampleCount,
      sampleFlags,
      samples,
      peakBuffer,
      correlation,
      balance,
      peakL,
      peakR
    };
  }

  ensureDspSampleBuffers(sampleRate) {
    const bufferSize = Math.max(1, Math.ceil(sampleRate));
    if (this.dspXBuffer?.length === bufferSize && this.dspYBuffer?.length === bufferSize) {
      this.sampleRate = sampleRate;
      return false;
    }
    this.dspXBuffer = new Float32Array(bufferSize);
    this.dspYBuffer = new Float32Array(bufferSize);
    this.dspBufferPosition = 0;
    this.sampleRate = sampleRate;
    return true;
  }

  resetDspSampleBuffers() {
    this.dspXBuffer?.fill(0);
    this.dspYBuffer?.fill(0);
    this.dspBufferPosition = 0;
  }

  appendDspSamples(samples) {
    const xBuffer = this.dspXBuffer;
    const yBuffer = this.dspYBuffer;
    if (!xBuffer || !yBuffer) return;
    let position = this.dspBufferPosition;
    for (let source = 0; source < samples.length; source += 2) {
      xBuffer[position] = samples[source];
      yBuffer[position] = samples[source + 1];
      position++;
      if (position === xBuffer.length) position = 0;
    }
    this.dspBufferPosition = position;
  }

  handleDspStereoFieldTelemetry(frame) {
    const snapshot = this.parseDspStereoFieldTelemetryFrame(frame);
    if (!snapshot || !this.enabled || !this._sectionEnabled) return;
    const resized = this.ensureDspSampleBuffers(snapshot.sampleRate);
    const sequence = frame.sequence >>> 0;
    const expectedSequence = this.dspLastTelemetrySequence === null
      ? null
      : (this.dspLastTelemetrySequence + 1) >>> 0;
    const discontinuity = resized || expectedSequence === null ||
      sequence !== expectedSequence || (frame.flags & 1) !== 0 ||
      (snapshot.sampleFlags & STEREO_FIELD_SAMPLE_FLAG_DISCONTINUITY) !== 0;
    if (discontinuity) {
      this.resetDspSampleBuffers();
    }
    this.appendDspSamples(snapshot.samples);
    this.dspLastTelemetrySequence = sequence;
    const measurements = {
      ...snapshot,
      xBuffer: this.dspXBuffer,
      yBuffer: this.dspYBuffer,
      currentPosition: this.dspBufferPosition
    };
    this.dspStereoFieldSnapshot = measurements;
    this.currentMeasurements = measurements;
  }

  onMessage(message) {
    this.ensureDspTelemetrySubscription();
    if (message.type === 'processBuffer' && message.measurements) {
      this.process(message.measurements);
    }
  }

  process(measurements) {
    if (!measurements || !this.enabled) {
      return;
    }
    if (measurements.sampleRate) {
      this.sampleRate = measurements.sampleRate;
    }
    this.dspStereoFieldSnapshot = null;
    this.dspLastTelemetrySequence = null;
    this.currentMeasurements = measurements;
  }

  handleIntersect(entries) {
    entries.forEach(entry => {
      this.isVisible = entry.isIntersecting;
      if (this.isVisible) {
        if (this.canRunAnimation()) this.startAnimation();
        else this.renderPowerUiOnce(() => this.drawMeter());
      } else {
            this.stopAnimation();
        }
    });
  }

  startAnimation() {
      if (!this.enabled || !this._sectionEnabled) return;
    if (this.animationFrameId) return;

    const animate = () => {
        if (!this.isVisible) {
            this.stopAnimation();
            return;
        }
        this.drawMeter();
        this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
    };
    animate();
  }

  stopAnimation() {
    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }
  }

  drawMeter() {
    if (!this.currentMeasurements) return;

    const { ctx, canvas } = this;
    const { width, height } = canvas;
    const dpr = this.graphDpr || 1;
    const isNarrow = this.graphCssWidth < 400;
    const centerX = width / 2;
    const centerY = height / 2;
    const size = Math.min(width, height);
    const radius = size * 0.45;

    // Clear the canvas.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw the diamond shape.
    ctx.strokeStyle = '#333';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX + radius, centerY);
    ctx.lineTo(centerX, centerY + radius);
    ctx.lineTo(centerX - radius, centerY);
    ctx.closePath();
    ctx.stroke();

    // Draw vertical and horizontal grid lines.
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX, centerY + radius);
    ctx.moveTo(centerX - radius, centerY);
    ctx.lineTo(centerX + radius, centerY);
    ctx.stroke();

    // Draw additional 45-degree grid lines.
    ctx.beginPath();
    for (let angle = 45; angle < 360; angle += 90) {
      const rad = angle * Math.PI / 180;
      const x = Math.cos(rad);
      const y = Math.sin(rad);
      ctx.moveTo(centerX, centerY);
      const scale = Math.min(Math.abs(radius / x), Math.abs(radius / y));
      ctx.lineTo(centerX + x * scale, centerY + y * scale);
    }
    ctx.stroke();

    // Draw labels.
    ctx.fillStyle = '#666';
    ctx.font = `${14 * dpr}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelOffset = size * 0.2;
    ctx.fillText('L+', centerX - radius + labelOffset, centerY - radius + labelOffset);
    ctx.fillText('R-', centerX - radius + labelOffset, centerY + radius - labelOffset);
    ctx.fillText('R+', centerX + radius - labelOffset, centerY - radius + labelOffset);
    ctx.fillText('L-', centerX + radius - labelOffset, centerY + radius - labelOffset);

    // Draw every sample in the selected window with the original age grading.
    const samplesNeeded = Math.ceil(this.windowTime * this.sampleRate);
    const { xBuffer, yBuffer } = this.currentMeasurements;
    const bufferLength = xBuffer.length;
    const endPos = this.currentMeasurements.currentPosition;
    const startIndex = (endPos - samplesNeeded + bufferLength) % bufferLength;

    const buckets = this.buckets;
    for (let i = 0; i < 256; i++) {
      buckets[i].length = 0;
    }

    for (let i = 0; i < samplesNeeded; i++) {
      const pos = (startIndex + i) % bufferLength;
      const sampleX = xBuffer[pos];
      const sampleY = yBuffer[pos];
      const screenX = centerX + (sampleX * 0.5) * radius;
      const screenY = centerY - (sampleY * 0.5) * radius;
      const intensity = samplesNeeded > 1 ? (i / (samplesNeeded - 1)) : 0;
      const green = Math.floor(255 * intensity);
      buckets[green].push({ x: screenX, y: screenY });
    }

    const pointSize = (isNarrow ? 2 : 1) * dpr;
    const pointOffset = pointSize * 0.5;
    for (let g = 0; g < 256; g++) {
      const points = buckets[g];
      if (points.length === 0) continue;

      ctx.fillStyle = this._colorLookup[g];
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        ctx.rect(points[j].x - pointOffset, points[j].y - pointOffset, pointSize, pointSize);
      }
      ctx.fill();
    }

    // Smooth the 360° peak buffer using a Gaussian (sigma = 5°).
    const smoothedPeaks = this.smoothedPeaks;
    const sigma = 5;
    const gaussianRange = Math.ceil(sigma * 3);
    const { peakBuffer } = this.currentMeasurements;
    
    for (let i = 0; i < 360; i++) {
      let sum = 0;
      let weightSum = 0;
      for (let j = -gaussianRange; j <= gaussianRange; j++) {
        const angle = ((i + j) % 360 + 360) % 360;
        const weight = Math.exp(-(j * j) / (2 * sigma * sigma));
        sum += peakBuffer[angle] * weight;
        weightSum += weight;
      }
      smoothedPeaks[i] = sum / weightSum;
    }
    
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 0; i < 360; i++) {
      const rad = i * Math.PI / 180;
      const r = smoothedPeaks[i] * 0.5 * radius;
      const x = centerX + Math.cos(rad) * r;
      const y = centerY + Math.sin(rad) * r;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.stroke();

    let correlation = 0;
    let energyDiff = 0;
    if (this.dspStereoFieldSnapshot) {
      correlation = this.dspStereoFieldSnapshot.correlation;
      energyDiff = this.dspStereoFieldSnapshot.balance;
    } else {
      const samplesNeeded = Math.ceil(this.windowTime * this.sampleRate);
      const { xBuffer, yBuffer } = this.currentMeasurements;
      const bufferLength = xBuffer.length;
      const endPos = this.currentMeasurements.currentPosition;
      const startIndex = (endPos - samplesNeeded + bufferLength) % bufferLength;
      let sumLR = 0;
      let sumL2 = 0;
      let sumR2 = 0;
      let energyL = 0;
      let energyR = 0;
      for (let i = 0; i < samplesNeeded; i++) {
        const pos = (startIndex + i) % bufferLength;
        const x = xBuffer[pos];
        const y = yBuffer[pos];
        const left = (y - x) / 2;
        const right = (x + y) / 2;
        sumLR += left * right;
        sumL2 += left * left;
        sumR2 += right * right;
        energyL += left * left;
        energyR += right * right;
      }
      if (sumL2 > 0 && sumR2 > 0) {
        correlation = sumLR / Math.sqrt(sumL2 * sumR2);
      }
      const epsilon = 1e-12;
      const energyL_dB = 10 * Math.log10(energyL + epsilon);
      const energyR_dB = 10 * Math.log10(energyR + epsilon);
      energyDiff = energyR_dB - energyL_dB;
    }

    // Draw the correlation bar on the left edge.
    const barThickness = 16 * dpr;
    const corrBarHeight = (correlation >= 0 ? correlation : -correlation) * centerY;
    ctx.fillStyle = '#008000';
    if (correlation >= 0) {
      ctx.fillRect(0, centerY - corrBarHeight, barThickness, corrBarHeight);
    } else {
      ctx.fillRect(0, centerY, barThickness, corrBarHeight);
    }

    // Draw correlation tick marks and labels.
    ctx.fillStyle = '#808080';
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = dpr;
    const corrTickX = 2 * dpr;
    const correlationTicks = [0.5, 0, -0.5];
    correlationTicks.forEach(tick => {
      const yTick = centerY - (tick * centerY);
      ctx.beginPath();
      ctx.moveTo(corrTickX + (16 * dpr), yTick);
      ctx.lineTo(corrTickX + (21 * dpr), yTick);
      ctx.stroke();
      ctx.font = `${12 * dpr}px Arial`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tick.toFixed(1), corrTickX + (23 * dpr), yTick);
    });

    // Draw the energy difference bar at the bottom.
    const energyMax = 18;
    const energyDiffClamped = energyDiff < -energyMax ? -energyMax : (energyDiff > energyMax ? energyMax : energyDiff);
    const halfCanvasWidth = width / 2;
    const energyBarLength = (energyDiffClamped / energyMax) * halfCanvasWidth;
    const energyBarY = height - barThickness;
    ctx.fillStyle = '#008000';
    if (energyBarLength >= 0) {
      ctx.fillRect(centerX, energyBarY, energyBarLength, barThickness);
    } else {
      ctx.fillRect(centerX + energyBarLength, energyBarY, -energyBarLength, barThickness);
    }

    // Draw energy tick marks and labels.
    ctx.fillStyle = '#808080';
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = dpr;
    const energyTicks = [-12, -6, 0, 6, 12];
    const energyTickY = height - (2 * dpr);
    energyTicks.forEach(tick => {
      const xTick = centerX + (tick / energyMax) * halfCanvasWidth;
      ctx.beginPath();
      ctx.moveTo(xTick, energyTickY - (21 * dpr));
      ctx.lineTo(xTick, energyTickY - (16 * dpr));
      ctx.stroke();
      ctx.font = `${12 * dpr}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(tick.toString() + 'dB', xTick, energyTickY - (23 * dpr));
    });

    // Draw axis labels.
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `${12 * dpr}px Arial`;
    ctx.fillText('LR Balance', width / 2, height - dpr);
    ctx.save();
    ctx.translate(20 * dpr, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('LR Correlation', 0, -3 * dpr);
    ctx.restore();
  }

  cleanup() {
    this.stopAnimation();
    this.disposeDspTelemetrySubscription();
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
    this.canvas = null;
    this.ctx = null;
    this.dspXBuffer = null;
    this.dspYBuffer = null;
    this.dspBufferPosition = 0;
    this.dspLastTelemetrySequence = null;
    this.dspStereoFieldSnapshot = null;
    super.cleanup();
  }
}

// Register the plugin globally
if (typeof window !== 'undefined') {
  window.StereoMeterPlugin = StereoMeterPlugin;
}
