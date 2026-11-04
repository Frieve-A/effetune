// Independently defined SFZ modulation profile, based on the pinned public
// inventory in specifications/sfz. This data also generates the native schema.
export const SFZ_MOD_KINDS = Object.freeze({
    Region: 0, AmpEG: 1, FilterEG: 2, PitchEG: 3, FlexEG: 4, EGStage: 5,
    AmpLFO: 6, FilterLFO: 7, PitchLFO: 8, LFO: 9, LFOSubosc: 10, LFOStep: 11, Filter: 12, Oscillator: 13,
    SamplePlayback: 14, Lifecycle: 15, ReleaseDecaySegment: 16, VoiceDSP: 17, NoiseLayer: 18, InitialController: 19,
    ReverseController: 20, Amplifier: 21, VelocityCurvePoint: 22, Crossfade: 23,
    ControllerCondition: 24, ControllerStart: 25, ControllerStop: 26, TempoCondition: 27, TimerCondition: 28, Equalizer: 29,
    Variable: 30
});
export const SFZ_MOD_PROPERTY_IDS = Object.freeze({
    Volume: 0, Amplitude: 1, Pitch: 2, Pan: 3, Width: 4, Position: 5,
    Delay: 6, Start: 7, Attack: 8, Hold: 9, Decay: 10, Sustain: 11, Release: 12,
    Depth: 13, Dynamic: 14, AttackShape: 15, DecayShape: 16, ReleaseShape: 17,
    DecayZero: 18, ReleaseZero: 19, Points: 20, SustainPoint: 21, Loop: 22,
    LoopCount: 23, Time: 24, Level: 25, Curve: 26, Shape: 27,
    Frequency: 28, Fade: 29, Phase: 30, Wave: 31, Count: 32,
    Ratio: 33, Scale: 34, Offset: 35, Steps: 36, StepLevel: 37,
    Cutoff: 38, Resonance: 39, FilterType: 40, Gain: 41, FilterMode: 42,
    KeyTrack: 43, KeyCenter: 44, VelocityTrack: 45, Random: 46,
    Eq1Frequency: 47, Eq1Bandwidth: 48, Eq1Gain: 49,
    Eq2Frequency: 50, Eq2Bandwidth: 51, Eq2Gain: 52,
    Eq3Frequency: 53, Eq3Bandwidth: 54, Eq3Gain: 55,
    Smooth: 57, Enabled: 58, AmpEnvelope: 59, ResonanceRandom: 60,
    BendSmooth: 61, BendStepUp: 62, BendStepDown: 63, NoteOffset: 64, SwitchOffset: 65, ScopeTune: 66,
    SourceWave: 67, OscillatorMode: 68, OscillatorMulti: 69, OscillatorDetune: 70,
    OscillatorPhase: 71, OscillatorQuality: 72, OscillatorModDepth: 73, OscillatorTableSize: 74,
    DelayBeats: 75, DelayBeatsRandom: 76, DelaySamples: 77, SyncBeats: 78, SyncOffset: 79,
    StopBeats: 80, SampleFadeout: 81, OffsetMode: 82, OffsetRandom: 83,
    LoopStartDelta: 84, LoopEndDelta: 85, LoopType: 86, LoopTune: 87, PlayCount: 88,
    NoteSelfMask: 89, OffCurve: 90, OffShape: 91, ReleaseDead: 92, ReleaseDecay: 93,
    SustainSwitch: 94, SostenutoSwitch: 95, SustainCC: 96, SostenutoCC: 97,
    SustainLow: 98, SostenutoLow: 99, SwitchVelocity: 100, PolyphonyStealing: 101, InitialValue: 102,
    ScopeVolume: 103, ScopeAmplitude: 104, ReverseLow: 105, ReverseHigh: 106, LoopRepeatLimit: 107, LoopRepeatLimited: 108,
    DspOrder: 120, Drive: 121, BitReduction: 122, Decimation: 123,
    NoiseLevel: 124, NoiseTone: 125, NoiseStep: 126, NoiseStereo: 127, NoiseFilter: 128,
    PanLaw: 129, PhaseInvert: 130, PanKeyTrack: 131, PanKeyCenter: 132, PanVelocityTrack: 133, PanRandom: 134,
    InLow: 135, InHigh: 136, OutLow: 137, OutHigh: 138,
    ConditionLow: 141, ConditionHigh: 142, BpmLow: 143, BpmHigh: 144, TimerLow: 145, TimerHigh: 146, SampleQuality: 147,
    EqType: 148, NoteEnabled: 149, SilentAction: 150,
    PositionKeyCenter: 151, PositionKeyTrack: 152, PositionVelocityTrack: 153, PositionRandom: 154,
    VariableValue: 155
});
export const SFZ_MOD_UNITS = Object.freeze({ Scalar: 0, Seconds: 1, Percent: 2, Decibels: 3,
    Cents: 4, Hertz: 5, Cycles: 6, MidiKey: 7, Octaves: 8, Index: 9, Milliseconds: 10, Degrees: 11, Beats: 12 });
export const SFZ_MOD_SAMPLING = Object.freeze({ Birth: 0, Dynamic: 1, Envelope: 2 });
export const SFZ_MOD_STORAGE_TYPES = Object.freeze({ Float: 0, UInt32: 1, UInt33: 2 });
export const SFZ_MOD_ROUTE_FLAGS = Object.freeze({ Multiply: 1, StepCurveA: 2, StepCurveB: 4,
    IntegerDepth: 8, IntegerHigh: 16, IntegerNegative: 32 });
export const SFZ_MOD_FILTER_TYPES = Object.freeze({
    lpf_1p: 1, lpf_2p: 2, hpf_1p: 3, hpf_2p: 4, bpf_2p: 5, brf_2p: 6,
    bpf_1p: 7, brf_1p: 8, apf_1p: 9, lpf_2p_sv: 10, hpf_2p_sv: 11,
    bpf_2p_sv: 12, brf_2p_sv: 13, pkf_2p: 14, lpf_4p: 15, hpf_4p: 16,
    lpf_6p: 17, hpf_6p: 18, comb: 19, pink: 20, lsh: 21, hsh: 22, peq: 23
});

// Definitions are expanded only for kinds which can own the property. Omitted
// stages/sub-oscillators do not create a dense instrument-wide parameter bank.
const definitions = [];
const FLOAT_MAX = 3.4028234663852886e38;
function property(kinds, name, defaultValue, min, max, unit = 'Scalar', options = {}) {
    const { modulationUnit = unit, ...settings } = options;
    for (const kind of kinds) definitions.push(Object.freeze({ kind: SFZ_MOD_KINDS[kind],
        id: SFZ_MOD_PROPERTY_IDS[name], name, default: defaultValue, min, max,
        unit: SFZ_MOD_UNITS[unit], modulationUnit: SFZ_MOD_UNITS[modulationUnit],
        integer: false, storage: SFZ_MOD_STORAGE_TYPES.Float, combine: 0, sampling: SFZ_MOD_SAMPLING.Dynamic, ...settings }));
}
const eg = ['AmpEG', 'FilterEG', 'PitchEG'];
const lfo = ['AmpLFO', 'FilterLFO', 'PitchLFO', 'LFO'];
property(['Variable'], 'VariableValue', 0, -FLOAT_MAX, FLOAT_MAX);
property(['Region'], 'NoteEnabled', 1, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Region'], 'SilentAction', 0, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Region'], 'Volume', 0, -144, 144, 'Decibels');
property(['Region'], 'Amplitude', 100, 0, 100, 'Percent');
property(['Region'], 'Pitch', 0, -12000, 12000, 'Cents');
property(['Region'], 'Pan', 0, -100, 100, 'Percent');
property(['Region'], 'Width', 100, -100, 100, 'Percent');
property(['Region'], 'Position', 0, -100, 100, 'Percent');
property(['Region'], 'BendSmooth', 0, 0, FLOAT_MAX, 'Milliseconds', { sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['BendStepUp', 'BendStepDown']) property(['Region'], name, 1, 1, 1200, 'Cents',
    { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['NoteOffset', 'SwitchOffset']) property(['Region'], name, 0, -247, 247, 'MidiKey',
    { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Region'], 'ScopeTune', 0, -28800, 28800, 'Cents', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Region'], 'ScopeVolume', 0, -432, 18, 'Decibels', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Region'], 'ScopeAmplitude', 100, 0, 100, 'Percent', { sampling: SFZ_MOD_SAMPLING.Birth });
for (let band = 1; band <= 3; band++) {
    property(['Region'], `Eq${band}Frequency`, [50, 500, 5000][band - 1], 0, 30000, 'Hertz');
    property(['Region'], `Eq${band}Bandwidth`, 1, .001, 4, 'Octaves');
    property(['Region'], `Eq${band}Gain`, 0, -96, 24, 'Decibels');
}
property(['Equalizer'], 'EqType', 0, 0, 2, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Equalizer'], 'Dynamic', 0, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Equalizer'], 'FilterMode', 1, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['Delay', 'Attack', 'Hold', 'Decay', 'Release']) {
    property(eg, name, 0, 0, 100, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Envelope });
}
property(eg, 'Start', 0, 0, 100, 'Percent', { sampling: SFZ_MOD_SAMPLING.Envelope });
property(eg, 'Sustain', 0, 0, 100, 'Percent', { sampling: SFZ_MOD_SAMPLING.Envelope });
property(eg, 'Dynamic', 0, 0, 1, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['AttackShape', 'DecayShape', 'ReleaseShape']) property(eg, name, 0, -FLOAT_MAX, FLOAT_MAX);
property(eg, 'DecayZero', 1, 0, 1, 'Scalar', { integer: true });
property(eg, 'ReleaseZero', 0, 0, 1, 'Scalar', { integer: true });
property(['FilterEG', 'PitchEG'], 'Depth', 0, -12000, 12000, 'Cents');
property(['FlexEG'], 'Dynamic', 0, 0, 1, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['FlexEG'], 'AmpEnvelope', 0, 0, 1, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['Points', 'SustainPoint', 'Loop', 'LoopCount']) {
    property(['FlexEG'], name, ['Points', 'LoopCount'].includes(name) ? 0 : -1, -1, 65535, 'Index',
        { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
}
property(['EGStage'], 'Time', 0, 0, FLOAT_MAX, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Envelope });
property(['EGStage'], 'Level', 0, -1, 1, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Envelope });
property(['EGStage'], 'Curve', 0, 0, 254, 'Index', { integer: true });
property(['EGStage'], 'Shape', 0, -FLOAT_MAX, FLOAT_MAX);
property(['AmpLFO', 'FilterLFO', 'PitchLFO'], 'Delay', 0, 0, 100, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['AmpLFO', 'FilterLFO', 'PitchLFO'], 'Fade', 0, 0, 100, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['AmpLFO', 'FilterLFO', 'PitchLFO'], 'Frequency', 0, 0, 20000, 'Hertz');
property(['LFO'], 'Delay', 0, 0, FLOAT_MAX, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['LFO'], 'Fade', 0, 0, FLOAT_MAX, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['LFO'], 'Frequency', 0, 0, FLOAT_MAX, 'Hertz');
property(lfo, 'Phase', 0, 0, 1, 'Cycles', { sampling: SFZ_MOD_SAMPLING.Birth });
property(lfo, 'Count', -1, -1, 16777216, 'Index', { integer: true });
property(lfo, 'Steps', 0, 0, 65535, 'Index', { integer: true });
property(lfo, 'Smooth', 0, 0, 10000, 'Milliseconds');
property(['AmpLFO'], 'Depth', 0, -10, 10, 'Decibels');
property(['FilterLFO', 'PitchLFO'], 'Depth', 0, -1200, 1200, 'Cents');
property(['LFO'], 'Depth', 100, -FLOAT_MAX, FLOAT_MAX, 'Percent');
property([...lfo, 'LFOSubosc'], 'Wave', 1, -1, 13, 'Index', { integer: true });
property([...lfo, 'LFOSubosc'], 'Ratio', 1, 0, FLOAT_MAX);
property([...lfo, 'LFOSubosc'], 'Scale', 1, -FLOAT_MAX, FLOAT_MAX);
property([...lfo, 'LFOSubosc'], 'Offset', 0, -FLOAT_MAX, FLOAT_MAX);
property(['LFOStep'], 'StepLevel', 0, -100, 100, 'Percent');
property(['Filter'], 'Enabled', 0, 0, 1, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'Cutoff', 20000, 0, 384000, 'Hertz', { modulationUnit: 'Cents' });
property(['Filter'], 'Resonance', 0, 0, 40, 'Decibels');
property(['Filter'], 'FilterType', 2, 1, 23, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'Gain', 0, -144, 144, 'Decibels');
property(['Filter'], 'FilterMode', 0, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'KeyTrack', 0, 0, 1200, 'Cents', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'KeyCenter', 60, 0, 127, 'MidiKey', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'VelocityTrack', 0, -9600, 9600, 'Cents', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'Random', 0, 0, 9600, 'Cents', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Filter'], 'ResonanceRandom', 0, 0, 40, 'Decibels', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'Enabled', 0, 0, 1, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'SourceWave', 0, 0, 6, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'OscillatorMode', 0, 0, 2, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'OscillatorMulti', 1, 1, 9, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'OscillatorDetune', 0, -FLOAT_MAX, FLOAT_MAX, 'Cents');
property(['Oscillator'], 'OscillatorPhase', 0, -FLOAT_MAX, 360, 'Degrees', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'OscillatorQuality', 2, 0, 3, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Oscillator'], 'OscillatorModDepth', 100, -FLOAT_MAX, FLOAT_MAX, 'Percent');
property(['Oscillator'], 'OscillatorTableSize', 0, 0, 4294967295, 'Index', { integer: true, storage: SFZ_MOD_STORAGE_TYPES.UInt32, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['DelayBeats', 'DelayBeatsRandom']) property(['SamplePlayback'], name, 0, 0, FLOAT_MAX, 'Beats', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'DelaySamples', 0, 0, 4294967296, 'Index', { integer: true, storage: SFZ_MOD_STORAGE_TYPES.UInt33, sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'Delay', 0, -100, 100, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'LoopRepeatLimit', 0, 0, 4294967295, 'Index', { integer: true, storage: SFZ_MOD_STORAGE_TYPES.UInt32, sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'LoopRepeatLimited', 0, 0, 1, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['SyncBeats', 'SyncOffset']) property(['SamplePlayback'], name, 0, 0, 32, 'Beats', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'StopBeats', -1, -1, FLOAT_MAX, 'Beats', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'SampleFadeout', 0, 0, FLOAT_MAX, 'Seconds');
property(['SamplePlayback'], 'OffsetMode', 0, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'Offset', 0, -4294967296, 4294967296, 'Index', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'OffsetRandom', 0, 0, 4294967296, 'Index', { integer: true, storage: SFZ_MOD_STORAGE_TYPES.UInt33, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['LoopStartDelta', 'LoopEndDelta']) property(['SamplePlayback'], name, 0, -4294967296, 4294967296, 'Index');
property(['SamplePlayback'], 'LoopType', 0, 0, 2, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'LoopTune', 0, -FLOAT_MAX, FLOAT_MAX, 'Cents');
property(['SamplePlayback'], 'PlayCount', 0, 0, 4294967296, 'Index', { integer: true, storage: SFZ_MOD_STORAGE_TYPES.UInt33, sampling: SFZ_MOD_SAMPLING.Birth });
for (const [name, value] of [['NoteSelfMask', 1], ['ReleaseDead', 0], ['SustainSwitch', 1], ['SostenutoSwitch', 1], ['SwitchVelocity', 0]]) {
    property(['Lifecycle'], name, value, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
}
property(['Lifecycle'], 'OffCurve', 10, -2, 10, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Lifecycle'], 'OffShape', -10.3616, -FLOAT_MAX, FLOAT_MAX);
property(['Lifecycle'], 'ReleaseDecay', 0, 0, 200, 'Decibels', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Lifecycle'], 'PolyphonyStealing', 0, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const [name, value] of [['SustainCC', 64], ['SostenutoCC', 66]]) property(['Lifecycle'], name, value, 0, 127, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['SustainLow', 'SostenutoLow']) property(['Lifecycle'], name, .5, 0, 127, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['ReleaseDecaySegment'], 'ReleaseDecay', 0, -200, 200, 'Decibels', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['ReleaseDecaySegment'], 'Time', -1, -1, FLOAT_MAX, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['InitialController'], 'InitialValue', 0, 0, 1, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['ReverseController'], 'ReverseLow', 0, 0, 127, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['ReverseController'], 'ReverseHigh', 127, 0, 127, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['VoiceDSP'], 'DspOrder', 1, 0, 14, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['Drive', 'BitReduction', 'Decimation']) property(['VoiceDSP'], name, 0, 0, 100, 'Percent');
property(['NoiseLayer'], 'NoiseLevel', -96, -96, 24, 'Decibels');
property(['NoiseLayer'], 'NoiseTone', 100, 0, 100, 'Percent', { integer: true });
property(['NoiseLayer'], 'NoiseStep', 0, 0, 100, 'Index', { integer: true });
property(['NoiseLayer'], 'NoiseStereo', 1, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['NoiseLayer'], 'NoiseFilter', 1, 0, 23, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'VelocityTrack', 100, -100, 100, 'Percent');
// Reference-inferred raw tracking offset: one unit is 100 percentage points.
property(['Amplifier'], 'Random', 0, -FLOAT_MAX, FLOAT_MAX, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'PanLaw', 0, 0, 2, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'PhaseInvert', 0, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'PanKeyCenter', 60, 0, 127, 'MidiKey', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['PanKeyTrack', 'PanVelocityTrack', 'PanRandom']) property(['Amplifier'], name, 0, -100, 100, 'Percent', { sampling: SFZ_MOD_SAMPLING.Birth });
// Position tracking uses measured percentage-point offsets; its random depth is one-sided.
property(['Amplifier'], 'PositionKeyCenter', 60, 0, 127, 'MidiKey', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'PositionKeyTrack', 0, -FLOAT_MAX, FLOAT_MAX, 'Percent', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'PositionVelocityTrack', 0, -200, 200, 'Percent', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Amplifier'], 'PositionRandom', 0, -100, 100, 'Percent', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['VelocityCurvePoint'], 'Level', 0, 0, 1, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['InLow', 'InHigh', 'OutLow', 'OutHigh']) property(['Crossfade'], name, name.startsWith('In') ? 0 : 127, 0, 127, 'Scalar', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['Crossfade'], 'Curve', 1, 0, 1, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
property(['ControllerCondition'], 'ConditionLow', 0, 0, 1, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['ControllerCondition'], 'ConditionHigh', 1, 0, 1, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
for (const name of ['ConditionLow', 'ConditionHigh']) property(['ControllerStart', 'ControllerStop'], name, -1, -1, 1, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['TempoCondition'], 'BpmLow', 0, 0, 500, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['TempoCondition'], 'BpmHigh', 500, 0, 500, 'Scalar', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['TimerCondition'], 'TimerLow', 0, 0, FLOAT_MAX, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['TimerCondition'], 'TimerHigh', FLOAT_MAX, 0, FLOAT_MAX, 'Seconds', { sampling: SFZ_MOD_SAMPLING.Birth });
property(['SamplePlayback'], 'SampleQuality', 0, 0, 10, 'Index', { integer: true, sampling: SFZ_MOD_SAMPLING.Birth });
// Fixed amplitude-envelope defaults differ from modulation envelopes.
export const SFZ_MOD_PROPERTIES = Object.freeze(definitions.map(definition => {
    const defaults = { Release: .001, Sustain: 100, DecayShape: -10.3616, ReleaseShape: -10.3616 };
    return definition.kind === SFZ_MOD_KINDS.AmpEG && Object.hasOwn(defaults, definition.name)
        ? Object.freeze({ ...definition, default: defaults[definition.name] }) : definition;
}));
export const SFZ_MOD_SOURCES = Object.freeze({ Constant: 0, Controller: 0x10000, Envelope: 0x30000, LFO: 0x40000, Note: 0x50000, Variable: 0x60000 });
// CC0..127 are normalized to 0..1. Virtual controllers retain the units below;
// notably ARIA host/key-delta facts are not divided by 127.
export const SFZ_MOD_VIRTUAL_CONTROLLERS = Object.freeze([
    [128, 'PitchBend', 'normalized', 'channel', 'event'],
    [129, 'ChannelPressure', 'normalized', 'channel', 'event'],
    [130, 'PolyPressure', 'normalized', 'voice-key', 'event'],
    [131, 'NoteOnVelocity', 'normalized', 'instrument', 'note-on'],
    [132, 'NoteOffVelocity', 'normalized', 'instrument', 'note-off'],
    [133, 'NoteNumber', 'normalized', 'instrument', 'note-event'],
    [134, 'NoteGate', 'boolean', 'instrument', 'note-event'],
    [135, 'Random', 'normalized', 'instrument', 'note-on'],
    [136, 'BipolarRandom', 'bipolar', 'instrument', 'note-on'],
    [137, 'Alternate', 'boolean', 'instrument', 'note-on'],
    [140, 'KeyDelta', 'semitones', 'instrument', 'note-on'],
    [141, 'AbsoluteKeyDelta', 'semitones', 'instrument', 'note-on'],
    [142, 'Tempo', 'BPM', 'host', 'sample'],
    [143, 'Transport', '0-stop/1-play/2-loop', 'host', 'event'],
    [144, 'SampleRate', 'Hz', 'engine', 'prepare'],
    [145, 'EngineTime', 'seconds', 'engine', 'sample'],
    [146, 'Numerator', 'integer', 'host', 'event'],
    [147, 'Denominator', 'integer', 'host', 'event'],
    [148, 'SongPosition', 'quarter-notes', 'host', 'sample'],
    [149, 'BarPosition', 'quarter-notes', 'host', 'sample'],
    [150, 'InstrumentTime', 'seconds', 'instrument', 'sample'],
    [151, 'SinceNoteOn', 'seconds', 'instrument', 'sample'],
    [152, 'SinceNoteOff', 'seconds', 'instrument', 'sample'],
    [153, 'KeysDown', 'integer', 'instrument', 'note-event'],
    [154, 'Voices', 'integer', 'instrument', 'sample'],
    [155, 'SampleOffset', 'sample-frames', 'instrument', 'voice-start']
].map(([id, name, unit, scope, sampling]) => Object.freeze({ id, name, unit, scope, sampling })));
export const SFZ_MOD_LAYOUT = Object.freeze({ Version: 3, HeaderWords: 14, DirectoryWords: 6,
    RouteWords: 10, CurveWords: 129, InstanceWords: 6, ParameterWords: 4, Profile: 1 });
export const SFZ_MOD_STORAGE = Object.freeze({ MaxVoices: 128, EnvelopeStateBytes: 80, LfoStateBytes: 88,
    RouteStateBytes: 24, BornFactsBytes: 24, RegionPlanBytes: 256, PropertyPointerBytes: 8, StateIndexBytes: 4,
    OscillatorStateBytes: 144, PlaybackStateBytes: 40, VoiceDspStateBytes: 40, NoiseStateBytes: 496,
    PlaybackPlanBytes: 208, ReleaseSegmentBytes: 24, ReverseConditionBytes: 12, ParameterIndexBytes: 4, IntegerBaseBytes: 8, IntegerDepthBytes: 8, ConditionIndexBytes: 4, InitialControllerBytes: 512,
    GeneratorParametersBytes: 64, PreviewVoices: 1, TimerGroupBytes: 16 * 8 * 2,
    CachePageFrames: 4096, CachePageBytes: 32, CacheSampleMetadataBytes: 16,
    CacheRequestBytes: 24, CacheRequestCapacity: 4096, CacheModeBytes: 1, CacheHashLoad: 4,
    CacheForecastPageBytes: 16, CacheForecastSourceBytes: 64, CacheForecastSourceCapacity: 4096 });

const K = SFZ_MOD_KINDS, P = SFZ_MOD_PROPERTY_IDS;
const fields = Object.freeze({ delay: 'Delay', start: 'Start', attack: 'Attack', hold: 'Hold', decay: 'Decay',
  sustain: 'Sustain', release: 'Release', depth: 'Depth', dynamic: 'Dynamic', attack_shape: 'AttackShape',
  decay_shape: 'DecayShape', release_shape: 'ReleaseShape', decay_zero: 'DecayZero', release_zero: 'ReleaseZero',
  freq: 'Frequency', fade: 'Fade', phase: 'Phase', wave: 'Wave', count: 'Count', ratio: 'Ratio', scale: 'Scale',
  offset: 'Offset', steps: 'Steps', smooth: 'Smooth', points: 'Points', loop: 'Loop', loop_count: 'LoopCount',
  ampeg: 'AmpEnvelope' });
const fixedKinds = Object.freeze({ ampeg: K.AmpEG, fileg: K.FilterEG, pitcheg: K.PitchEG,
  amplfo: K.AmpLFO, fillfo: K.FilterLFO, pitchlfo: K.PitchLFO });
const rootFields = Object.freeze({ volume: 'Volume', amplitude: 'Amplitude', tune: 'Pitch', pitch: 'Pitch',
  pan: 'Pan', width: 'Width', position: 'Position' });
const playbackFields = Object.freeze({ delay: 'Delay', delay_beats: 'DelayBeats', delay_beats_random: 'DelayBeatsRandom',
  delay_samples: 'DelaySamples', sync_beats: 'SyncBeats', sync_offset: 'SyncOffset', stop_beats: 'StopBeats',
  sample_fadeout: 'SampleFadeout', offset_mode: 'OffsetMode', offset: 'Offset', offset_random: 'OffsetRandom',
  loop_start: 'LoopStartDelta', loop_length: 'LoopEndDelta', loop_type: 'LoopType', loop_tune: 'LoopTune', count: 'PlayCount' });
const lifecycleFields = Object.freeze({ note_selfmask: 'NoteSelfMask', off_curve: 'OffCurve', off_shape: 'OffShape',
  rt_dead: 'ReleaseDead', rt_decay: 'ReleaseDecay', sustain_sw: 'SustainSwitch', sostenuto_sw: 'SostenutoSwitch',
  sustain_cc: 'SustainCC', sostenuto_cc: 'SostenutoCC', sustain_lo: 'SustainLow', sostenuto_lo: 'SostenutoLow', sw_vel: 'SwitchVelocity',
  polyphony_stealing: 'PolyphonyStealing' });
const dspFields = Object.freeze({ dsp_order: 'DspOrder', drive: 'Drive', bitred: 'BitReduction', decim: 'Decimation' });
const noiseFields = Object.freeze({ noise_level: 'NoiseLevel', noise_tone: 'NoiseTone', noise_step: 'NoiseStep',
  noise_stereo: 'NoiseStereo', noise_filter: 'NoiseFilter' });
const amplifierFields = Object.freeze({ amp_veltrack: 'VelocityTrack', amp_veltrack_random: 'Random', pan_law: 'PanLaw', phase: 'PhaseInvert',
    pan_keytrack: 'PanKeyTrack', pan_keycenter: 'PanKeyCenter', pan_veltrack: 'PanVelocityTrack', pan_random: 'PanRandom',
    position_keycenter: 'PositionKeyCenter', position_keytrack: 'PositionKeyTrack',
    position_veltrack: 'PositionVelocityTrack', position_random: 'PositionRandom' });
const destination = (kind, index, property, parent = null) => ({ kind, index, property: P[property], parent });

function targetFor(key) {
  const condition = /^(?:(on|stop)_)?(lo|hi)hdcc([0-9]{1,3})$/.exec(key);
  if (condition) return destination(condition[1] === 'on' ? K.ControllerStart : condition[1] === 'stop' ? K.ControllerStop : K.ControllerCondition,
    Number(condition[3]), condition[2] === 'lo' ? 'ConditionLow' : 'ConditionHigh');
  const stop = /^stop_(lo|hi)cc([0-9]{1,3})$/.exec(key);
  if (stop) return destination(K.ControllerStop, Number(stop[2]), stop[1] === 'lo' ? 'ConditionLow' : 'ConditionHigh');
  if (key === 'lobpm' || key === 'hibpm') return destination(K.TempoCondition, 0, key === 'lobpm' ? 'BpmLow' : 'BpmHigh');
  if (key === 'lotimer' || key === 'hitimer') return destination(K.TimerCondition, 0, key === 'lotimer' ? 'TimerLow' : 'TimerHigh');
  if (key === 'sample_quality') return destination(K.SamplePlayback, 0, 'SampleQuality');
  if (Object.hasOwn(amplifierFields, key)) return destination(K.Amplifier, 0, amplifierFields[key]);
  const velocity = /^amp_velcurve_([0-9]{1,3})$/.exec(key);
  if (velocity) return destination(K.VelocityCurvePoint, Number(velocity[1]), 'Level');
  const crossfade = /^xf(in|out)_(lo|hi)(key|vel|cc([0-9]{1,3}))$/.exec(key);
  if (crossfade) return destination(K.Crossfade, crossfade[3] === 'key' ? 0 : crossfade[3] === 'vel' ? 1 : 2 + Number(crossfade[4]),
    `${crossfade[1] === 'in' ? 'In' : 'Out'}${crossfade[2] === 'lo' ? 'Low' : 'High'}`);
  const reverse = /^reverse_(lo|hi)cc([0-9]{1,3})$/.exec(key);
  if (reverse) return destination(K.ReverseController, Number(reverse[2]), reverse[1] === 'lo' ? 'ReverseLow' : 'ReverseHigh');
  if (Object.hasOwn(dspFields, key)) return destination(K.VoiceDSP, 0, dspFields[key]);
  if (Object.hasOwn(noiseFields, key)) return destination(K.NoiseLayer, 0, noiseFields[key]);
  if (Object.hasOwn(playbackFields, key)) return destination(K.SamplePlayback, 0, playbackFields[key]);
  if (Object.hasOwn(lifecycleFields, key)) return destination(K.Lifecycle, 0, lifecycleFields[key]);
  const release = /^rt_decay([0-9]+)(_time)?$/.exec(key);
  if (release) return destination(K.ReleaseDecaySegment, Number(release[1]), release[2] ? 'Time' : 'ReleaseDecay', { kind: K.Lifecycle, index: 0 });
  const oscillator = /^oscillator_(detune|mod_depth)$/.exec(key);
  if (oscillator) return destination(K.Oscillator, 0, oscillator[1] === 'detune' ? 'OscillatorDetune' : 'OscillatorModDepth');
  if (Object.hasOwn(rootFields, key)) return destination(K.Region, 0, rootFields[key]);
  let match = /^eq([1-3])_(type|dynamic|mode)$/.exec(key);
  if (match) return destination(K.Equalizer, Number(match[1]), { type: 'EqType', dynamic: 'Dynamic', mode: 'FilterMode' }[match[2]]);
  match = /^eq([1-3])_(freq|bw|gain)$/.exec(key);
  if (match) return destination(K.Region, 0, `Eq${match[1]}${{ freq: 'Frequency', bw: 'Bandwidth', gain: 'Gain' }[match[2]]}`);
  match = /^(cutoff|resonance)(2)?(?:_(random))?$/.exec(key);
  if (match) return destination(K.Filter, match[2] ? 2 : 1, match[3] ?
    (match[1] === 'cutoff' ? 'Random' : 'ResonanceRandom') : match[1] === 'cutoff' ? 'Cutoff' : 'Resonance');
  match = /^fil(2)?_(type|gain|mode|keytrack|keycenter|veltrack|random)$/.exec(key);
  if (match) return destination(K.Filter, match[1] ? 2 : 1, { type: 'FilterType', gain: 'Gain', mode: 'FilterMode',
    keytrack: 'KeyTrack', keycenter: 'KeyCenter', veltrack: 'VelocityTrack', random: 'Random' }[match[2]]);
  match = /^(ampeg|fileg|pitcheg|amplfo|fillfo|pitchlfo)_(.*)$/.exec(key);
  if (match && Object.hasOwn(fields, match[2])) return destination(fixedKinds[match[1]], 0, fields[match[2]]);
  match = /^eg([0-9]+)_(time|level|curve|shape)([0-9]+)$/.exec(key);
  if (match) return destination(K.EGStage, Number(match[3]),
    { time: 'Time', level: 'Level', curve: 'Curve', shape: 'Shape' }[match[2]], { kind: K.FlexEG, index: Number(match[1]) });
  match = /^eg([0-9]+)_(.*)$/.exec(key);
  if (match && Object.hasOwn(fields, match[2])) return destination(K.FlexEG, Number(match[1]),
    match[2] === 'sustain' ? 'SustainPoint' : fields[match[2]]);
  match = /^lfo([0-9]+)_(wave|ratio|scale|offset)([0-9]+)$/.exec(key);
  if (match) return destination(K.LFOSubosc, Number(match[3]), fields[match[2]], { kind: K.LFO, index: Number(match[1]) });
  match = /^lfo([0-9]+)_step([0-9]+)$/.exec(key);
  if (match) return destination(K.LFOStep, Number(match[2]), 'StepLevel', { kind: K.LFO, index: Number(match[1]) });
  match = /^lfo([0-9]+)_(.*)$/.exec(key);
  if (match && Object.hasOwn(fields, match[2])) return destination(K.LFO, Number(match[1]), fields[match[2]]);
  return null;
}


export function sfzModulationTarget(key) {
    let target = targetFor(key), source = null, multiply = false;
    if (!target) {
        const generator = /^(eg|lfo)([0-9]+)_(.+)$/.exec(key);
        if (generator) {
            source = { kind: generator[1] === 'eg' ? K.FlexEG : K.LFO, index: Number(generator[2]) };
            const cross = /^(freq|depth|depthadd)_lfo([0-9]+)$/.exec(generator[3]);
            if (cross) {
                target = destination(K.LFO, Number(cross[2]), cross[1] === 'freq' ? 'Frequency' : 'Depth');
                multiply = cross[1] === 'depth';
            } else {
                target = targetFor(generator[3].replace(/^driveshape$/, 'drive').replace(/^noise(level|tone|step)$/, 'noise_$1')
                    .replace(/^eq([1-3])(freq|bw|gain)$/, 'eq$1_$2')
                    .replace(/^fil1gain$/, 'fil_gain').replace(/^fil2gain$/, 'fil2_gain'));
                multiply = generator[3] === 'amplitude';
            }
        }
    }
    return target && SFZ_MOD_PROPERTIES.some(spec => spec.kind === target.kind && spec.id === target.property)
        ? { target, source, multiply } : null;
}
