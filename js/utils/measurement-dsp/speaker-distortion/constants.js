// Shared constants of the speaker distortion model. The figures module and the
// chart renderer import this file directly, so they load neither the
// identification coordinator nor its workers.

export const SETS = Object.freeze(['L', 'L-6', 'L-12', 'peaks']);

export const LENGTHS = Object.freeze(['short', 'long']);

// Frequency classes in Hz. Position k is the figure index of figL and
// checkFig[length].fig and, for k <= 4, the power entry POWER_CLASS_BASE + k.
// total and even8k both use power entry 54 (the even 50 Hz-8 kHz set); total
// adds the odd sum of that set.
export const CLASSES = Object.freeze([
    Object.freeze({ key: 'c1', lo: 50, hi: 100 }),
    Object.freeze({ key: 'c2', lo: 100, hi: 400 }),
    Object.freeze({ key: 'c3', lo: 400, hi: 2000 }),
    Object.freeze({ key: 'evenAll', lo: 50, hi: 2000 }),
    Object.freeze({ key: 'total', lo: 50, hi: 8000 }),
    Object.freeze({ key: 'even8k', lo: 50, hi: 8000 })
]);

// Odd block: its configurations, its classes on the non-excited, non-mains odd
// bins (position k is the index of odd.checkFig[c].odd), its 32 low states and the first bin of
// its odd row grid (row r is bin ODD_FIRST_BIN + 2r, r < 3983).
export const ODD_CONFIGS = Object.freeze(['short', 'long', 'alone']);
export const ODD_CLASSES = Object.freeze([
    Object.freeze({ key: 'o1', lo: 50, hi: 100 }),
    Object.freeze({ key: 'o2', lo: 100, hi: 400 }),
    Object.freeze({ key: 'o3', lo: 400, hi: 2000 }),
    Object.freeze({ key: 'oddAll', lo: 50, hi: 2000 })
]);
export const ODD_STATES = 32;
export const ODD_FIRST_BIN = 35;

// Recording peak at which the level check reports an overload.
export const LEVEL_CHECK_OVERLOAD = 0.708;
// Periods of the test signal the level check analyses.
export const LEVEL_CHECK_K = 2;

// Stored scale order of power and figL.
export const SCALES = Object.freeze([
    Object.freeze({ key: 'measured', s: 0 }),
    Object.freeze({ key: 'reduce', s: 1 }),
    Object.freeze({ key: 'add', s: -1 }),
    Object.freeze({ key: 'reduceQuieter3', s: 10 ** (-3 / 20) }),
    Object.freeze({ key: 'reduceLouder3', s: 10 ** (3 / 20) })
]);

export const SCALE_MEASURED = 0;
export const SCALE_REDUCE = 1;
export const SCALE_ADD = 2;

// Layout of power[length][set][scale]: bands 0..49, then the class sums.
export const N_BANDS = 50;
export const POWER_CLASS_BASE = 50;
export const POWER_LENGTH = 55;

// Layout of ref[set]: four blocks of 51 values (bands 0..49 and the
// 50 Hz-8 kHz set at offset REF_SET).
export const REF_X = 0;
export const REF_ODD = 51;
export const REF_VAR = 102;
export const REF_ODD_VAR = 153;
export const REF_SET = 50;
export const REF_LENGTH = 204;

// Chart band edges e_0..e_50 in Hz: 1/6-octave steps from 25 Hz, the last
// band ending at 8 kHz.
export const BAND_EDGES = Object.freeze(Array.from({ length: N_BANDS + 1 },
    (_, i) => (i < N_BANDS ? 25 * 2 ** (i / 6) : 8000)));

// Fundamentals in Hz of the swept-sine record: 1/24-octave steps 50 Hz·2^(k/24) rounded to the 1 Hz
// model grid, without repeats, from 20 Hz (the ESS analysis lower bound, k = −32) while the second
// harmonic stays at or below 8 kHz (k = 151); 179 points.
export const SWEEP_FREQUENCIES = Object.freeze([
    ...new Set(Array.from({ length: 184 }, (_, i) => Math.round(50 * 2 ** ((i - 32) / 24))))
]);

// Smallest and largest Upper Limit in Hz; the default is the largest.
export const UPPER_LIMIT_RANGE_HZ = Object.freeze([500, 8000]);
