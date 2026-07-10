export const SHIPPED_ENABLED_TYPES = Object.freeze([
    'LevelMeterPlugin',
    'OscilloscopePlugin',
    'SpectrogramPlugin',
    'SpectrumAnalyzerPlugin',
    'StereoMeterPlugin',
    'ChannelDividerPlugin',
    'DCOffsetPlugin',
    'MatrixPlugin',
    'MultiChannelPanelPlugin',
    'MutePlugin',
    'PolarityInversionPlugin',
    'StereoBalancePlugin',
    'VolumePlugin',
    'DelayPlugin',
    'TimeAlignmentPlugin',
    'AutoLevelerPlugin',
    'BrickwallLimiterPlugin',
    'CompressorPlugin',
    'ExpanderPlugin',
    'GatePlugin',
    'MultibandCompressorPlugin',
    'MultibandExpanderPlugin',
    'MultibandTransientPlugin',
    'PowerAmpSagPlugin',
    'TransientShaperPlugin',
    'BandPassFilterPlugin',
    'CombFilterPlugin',
    'EarphoneCableSimPlugin',
    'FifteenBandGEQPlugin',
    'FifteenBandPEQPlugin',
    'FiveBandDynamicEQ',
    'FiveBandPEQPlugin',
    'HiPassFilterPlugin',
    'LoPassFilterPlugin',
    'LoudnessEqualizerPlugin',
    'NarrowRangePlugin',
    'TiltEQPlugin',
    'ToneControlPlugin',
    'BitCrusherPlugin',
    'DigitalErrorEmulatorPlugin',
    'DSD64IMDSimulatorPlugin',
    'HumGeneratorPlugin',
    'NoiseBlenderPlugin',
    'SimpleJitterPlugin',
    'VinylArtifactsPlugin',
    'DopplerDistortionPlugin',
    'PitchShifterPlugin',
    'TremoloPlugin',
    'WowFlutterPlugin',
    'OscillatorPlugin',
    'HornResonatorPlugin',
    'HornResonatorPlusPlugin',
    'ModalResonatorPlugin',
    'DattorroPlateReverbPlugin',
    'FDNReverbPlugin',
    'RSReverbPlugin',
    'DynamicSaturationPlugin',
    'ExciterPlugin',
    'HardClippingPlugin',
    'HarmonicDistortionPlugin',
    'MultibandSaturationPlugin',
    'SaturationPlugin',
    'SubSynthPlugin',
    'CrossfeedFilterPlugin',
    'MSMatrixPlugin',
    'MultibandBalancePlugin',
    'StereoBlendPlugin'
]);

function readSearch(locationOrSearch) {
    if (typeof locationOrSearch === 'string') {
        const question = locationOrSearch.indexOf('?');
        return question >= 0 ? locationOrSearch.slice(question) : locationOrSearch;
    }
    return typeof locationOrSearch?.search === 'string' ? locationOrSearch.search : '';
}

function isEnabledFlag(value) {
    return value === '1' || value === 'true' || value === 'on';
}

export function getDspRuntimeFlags(locationOrSearch = globalThis.location) {
    const params = new URLSearchParams(readSearch(locationOrSearch));
    return {
        forceOff: String(params.get('dsp') || '').toLowerCase() === 'off',
        debug: isEnabledFlag(String(params.get('dspDebug') || '').toLowerCase()),
        bench: isEnabledFlag(String(params.get('dspBench') || '').toLowerCase())
    };
}

export function isWasmDspEnabled(preference = true, locationOrSearch = globalThis.location) {
    const preferenceValue = typeof preference === 'object' && preference !== null
        ? preference.useWasmDsp
        : preference;
    return preferenceValue !== false && !getDspRuntimeFlags(locationOrSearch).forceOff;
}

export function filterEnabledDspTypes({
    meta,
    paramPackers,
    preference = true,
    location = globalThis.location,
    shippedTypes = SHIPPED_ENABLED_TYPES
} = {}) {
    if (!isWasmDspEnabled(preference, location)) return [];
    if (!Array.isArray(meta?.kernels) || !(paramPackers instanceof Map)) return [];

    const shipped = new Set(shippedTypes || []);
    const enabled = [];
    const seen = new Set();
    for (const kernel of meta.kernels) {
        if (!kernel || typeof kernel.name !== 'string' || seen.has(kernel.name) || !shipped.has(kernel.name)) {
            continue;
        }
        const packer = paramPackers.get(kernel.name);
        if (!packer || typeof packer.pack !== 'function' || (packer.hash >>> 0) !== (kernel.hash >>> 0)) {
            continue;
        }
        seen.add(kernel.name);
        enabled.push(kernel.name);
    }
    return enabled;
}

export function getDspRolloutConfig(options = {}) {
    const flags = getDspRuntimeFlags(options.location);
    return {
        ...flags,
        enabledTypes: filterEnabledDspTypes(options)
    };
}
