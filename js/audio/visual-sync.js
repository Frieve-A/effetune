// Deterministic capture age and staged-analysis completion bounds, in context frames.
export const VISUAL_SYNC_MAX_OUTPUT_DELAY_SECONDS = 0.5;
export const VISUAL_SYNC_QUEUE_LIMIT = 256;
export const isVisualSyncEnabled = config => config?.visualSync === true;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const bounded = (value, fallback, low, high) => clamp(Number.isFinite(value) ? value : fallback, low, high);
const zero = () => 0;
const noteWindowAge = rate => clamp(Math.round(rate * 16384 / 48000), 32, 65536) / 2;
const rule = (generationFrames = zero, tap = 'output') => Object.freeze({ synced: true, generationFrames, tap });
const fftSize = params => 2 ** Math.round(bounded(params.pt, 12, 8, 14));
function spectrumAge(params, sampleRate, execution, rateLimited) {
    const size = fftSize(params);
    const hop = rateLimited ? Math.max(size / 2, Math.ceil(sampleRate / 30)) : size / 2;
    // HQ uses a fourfold decimated long window with a 97-tap FIR (48-frame delay).
    if (params.sc === 'log-hq') return size * 2 + 48 + Math.floor(hop / 16) * 16;
    const completion = execution === 'wasm' ? clamp(Math.floor(hop / 16), 1, 512) * 16 : 0;
    return size / 2 + completion;
}
function phaseSelectAge(params, sampleRate, execution) {
    if (execution !== 'wasm') return 0;
    const rounded = Math.round(sampleRate);
    let size;
    if (Math.abs(sampleRate - rounded) <= 0.01) {
        if (rounded === 44100 || rounded === 48000) size = 4096;
        else if (rounded === 88200 || rounded === 96000) size = 8192;
        else if (rounded === 176400 || rounded === 192000) size = 16384;
    }
    if (!size) {
        size = 2048;
        const requested = Math.ceil(sampleRate * 0.085);
        while (size < 32768 && size < requested) size *= 2;
    }
    // The input window completes its staged analysis during the following quarter-window hop.
    return size / 2 + size / 4;
}
const rules = {
    // Only windowed readings are aligned; VU, PPM, and peak ballistics are the meter definition.
    AnalogMeterPlugin: rule((p, rate) => {
        if (p.md === 'RMS') return Math.ceil(rate * bounded(p.it, 0.3, 0.05, 3)) / 2;
        if (p.md === 'Loudness') return Math.ceil(rate * (p.ln === 1 ? 3 : 0.4)) / 2;
        return 0;
    }),
    ChromaSpiralPlugin: rule((p, rate, execution) => {
        let pt = 8;
        while (pt < 14 && rate / (4 * (1 << pt)) > 1.5) pt++;
        return spectrumAge({ pt, sc: 'log-hq' }, rate, execution, true);
    }),
    LevelMeterPlugin: rule(),
    PhaseSelectEqPlugin: rule(phaseSelectAge, 'input'),
    SpectrumAnalyzerPlugin: rule((p, rate, execution) => spectrumAge(p, rate, execution, true)),
    SpectrogramPlugin: rule((p, rate, execution) => spectrumAge(p, rate, execution, false)),
    NoteSpectrogramPlugin: rule((p, rate) =>
        noteWindowAge(rate) +
        Math.floor(clamp(Math.round(rate * 0.02), 16, 8192) / 16) * 16),
    PitchMeterPlugin: rule((p, rate) => {
        const frequency = bounded(p.rf, 440, 400, 480) * 2 ** ((Math.round(bounded(p.mn, 36, 21, 108)) - 69) / 12);
        return Math.ceil(Math.max(3.1 * rate / frequency + 4, rate * 0.015)) / 2 +
            clamp(Math.round(rate * 0.01 / 16) * 16, 16, 8192);
    }),
    OscilloscopePlugin: rule((p, rate) => clamp(Math.floor(rate * bounded(p.dt, 0.01, 0.001, 0.1)), 1, 65536) / 2),
    StereoMeterPlugin: rule((p, rate) => Math.ceil(rate * bounded(p.wt, 0.1, 0.01, 1)) / 2),
    spectrumOverlay: rule((params, rate) => params?.quality === 'hq'
        ? spectrumAge({ pt: 12, sc: 'log-hq' }, rate, 'js', true) : 2048)
};
for (const name of [
    'CompressorPlugin', 'GatePlugin', 'ExpanderPlugin', 'BrickwallLimiterPlugin',
    'MultibandCompressorPlugin', 'MultibandExpanderPlugin', 'MultibandTransientPlugin',
    'TransientShaperPlugin', 'AutoLevelerPlugin', 'PowerAmpSagPlugin', 'FiveBandDynamicEQ',
    'VinylSimulatorPlugin', 'FMRadioSimulatorPlugin', 'AMRadioSimulatorPlugin',
    'SWRadioSimulatorPlugin', 'TVAudioSimulatorPlugin', 'DSD64IMDSimulatorPlugin',
    'TubeSimulatorPlugin', 'HumRemoverPlugin', 'ClipRestorerPlugin', 'ClickRemoverPlugin',
    'MatrixPlugin', 'ChannelDividerPlugin', 'MultiChannelPanelPlugin', 'FIRCrossoverPlugin'
]) rules[name] = rule();
export const VISUAL_SYNC_RULES = Object.freeze(rules);

export function requiredOutputDelayFrames({ targets, taps, dbtFrames = 0, deviceLatencyFrames = 0, maxFrames }) {
    let required = 0;
    for (const target of targets) {
        const tap = taps?.[target.id];
        if (target.enabled === false || !tap) continue;
        const definition = VISUAL_SYNC_RULES[target.ruleKey];
        if (!definition?.synced) continue;
        required = Math.max(required, target.generationFrames - (tap[definition.tap] || 0) - dbtFrames - deviceLatencyFrames);
    }
    return Math.ceil(clamp(required, 0, maxFrames));
}

// Keep every deadline in milliseconds on the AudioContext sample timeline.
export function audibleFrameTime({ endFrame, generationFrames = 0, tapFrames = 0,
    outputDelayFrames = 0, sampleRate }) {
    return (endFrame - generationFrames + tapFrames + outputDelayFrames) / sampleRate * 1000;
}

export function audibleContextTime({ outputTimestamp, currentTime, outputLatency, baseLatency, performanceTime }) {
    if (outputTimestamp && Number.isFinite(outputTimestamp.contextTime) &&
        Number.isFinite(outputTimestamp.performanceTime) && outputTimestamp.performanceTime > 0) {
        return outputTimestamp.contextTime * 1000 + performanceTime - outputTimestamp.performanceTime;
    }
    return (currentTime - (outputLatency || baseLatency || 0)) * 1000;
}

// These payloads record capture-end time on the worklet processing timeline.
export function telemetryCaptureTiming(frame, contextFrameOffset) {
    if (!Number.isFinite(contextFrameOffset)) return null;
    const note = frame?.frameType === 24 && frame.formatVersion === 3 && frame.payload?.byteLength === 3548;
    const spectrogram = frame?.frameType === 5 && frame.formatVersion === 1 && frame.payload?.byteLength === 268;
    if (!note && !spectrogram) return null;
    const sampleRate = frame.payload.getFloat32(0, true);
    const time = frame.payload.getFloat32(4, true);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(time)) return null;
    return { endFrame: time * sampleRate + contextFrameOffset,
        generationFrames: note ? noteWindowAge(sampleRate) : 2 ** frame.payload.getUint16(10, true) / 2 };
}
