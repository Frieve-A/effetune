import { PIPELINE_ANALYZER_TSP_LENGTHS } from './tsp.js';

const MLS_DEFINITIONS = Object.freeze({
    32767: Object.freeze({ degree: 15, taps: Object.freeze([0, 14]) }),
    65535: Object.freeze({ degree: 16, taps: Object.freeze([0, 4, 13, 15]) }),
    131071: Object.freeze({ degree: 17, taps: Object.freeze([0, 14]) }),
    262143: Object.freeze({ degree: 18, taps: Object.freeze([0, 11]) }),
    524287: Object.freeze({ degree: 19, taps: Object.freeze([0, 14, 17, 18]) })
});

export const PIPELINE_ANALYZER_MLS_LENGTHS = Object.freeze(
    Object.keys(MLS_DEFINITIONS).map(Number)
);
export { PIPELINE_ANALYZER_TSP_LENGTHS };

export function levelDbToAmplitude(levelDb) {
    if (!Number.isInteger(levelDb) || levelDb < -60 || levelDb > 0) {
        throw new TypeError('Analyzer level must be an integer from -60 to 0 dBFS');
    }
    return 10 ** (levelDb / 20);
}

export function normalizeMeasurementSettings(value = {}) {
    const signalType = ['mls', 'tsp', 'impulse'].includes(value.signalType)
        ? value.signalType
        : 'mls';
    const levelDb = Number.isInteger(value.levelDb) && value.levelDb >= -60 && value.levelDb <= 0
        ? value.levelDb
        : -12;
    const allowedLengths = signalType === 'tsp'
        ? PIPELINE_ANALYZER_TSP_LENGTHS
        : signalType === 'mls'
            ? PIPELINE_ANALYZER_MLS_LENGTHS
            : [...PIPELINE_ANALYZER_MLS_LENGTHS, ...PIPELINE_ANALYZER_TSP_LENGTHS];
    const sequenceLength = allowedLengths.includes(value.sequenceLength)
        ? value.sequenceLength
        : signalType === 'tsp' ? 65536 : 65535;
    const stabilizationPeriods = Number.isInteger(value.stabilizationPeriods) &&
        value.stabilizationPeriods >= 1 && value.stabilizationPeriods <= 32
        ? value.stabilizationPeriods
        : 12;
    const averagingPeriods = Number.isInteger(value.averagingPeriods) &&
        value.averagingPeriods >= 1 && value.averagingPeriods <= 8
        ? value.averagingPeriods
        : 2;
    return Object.freeze({
        signalType,
        levelDb,
        sequenceLength,
        stabilizationPeriods,
        averagingPeriods
    });
}

export function generateMlsSequence(sequenceLength, amplitude = 1) {
    const definition = MLS_DEFINITIONS[sequenceLength];
    if (!definition) throw new TypeError('Unsupported MLS sequence length');
    if (!(Number.isFinite(amplitude) && amplitude > 0 && amplitude <= 1)) {
        throw new TypeError('MLS amplitude must be finite and in (0, 1]');
    }
    const sequence = new Float32Array(sequenceLength);
    let state = (1 << definition.degree) - 1;
    const initialState = state;
    for (let index = 0; index < sequenceLength; index += 1) {
        sequence[index] = (state & 1) !== 0 ? amplitude : -amplitude;
        let feedback = 0;
        for (const tap of definition.taps) feedback ^= (state >>> tap) & 1;
        state = (state >>> 1) | (feedback << (definition.degree - 1));
        if (state === 0) throw new Error('MLS generator entered the zero state');
        if (state === initialState && index !== sequenceLength - 1) {
            throw new Error('MLS generator repeated before the selected period');
        }
    }
    if (state !== initialState) throw new Error('MLS generator did not complete its period');
    return sequence;
}
