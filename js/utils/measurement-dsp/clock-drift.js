// Clock mismatch between the playback and recording devices, from the spacing of a repeated signal.
import { resampleByRatio } from './resample.js';

const STEP_TOLERANCE = 1; // recording samples: steps this close to the median step count as drift
const MIN_OFFSET = 1e-6; // below 1 ppm the accumulated time error stays negligible
export const MAX_CLOCK_OFFSET = 5e-3; // beyond 0.5% the mismatch is not a clock tolerance

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Ratio of the recording clock to the playback clock (above 1: the recording runs fast) from `steps`,
 * the change in arrival time (recording samples, fractional) from one repetition to the next of a signal
 * repeated every `interval` playback samples. A step far from the median is a capture slip, not drift,
 * and is left out. Without steps the ratio is 1.
 */
export function clockRatio(steps, interval) {
    if (!steps.length) return 1;
    const center = median(steps);
    let sum = 0;
    let count = 0;
    for (const step of steps) {
        const distance = step < center ? center - step : step - center;
        if (distance <= STEP_TOLERANCE) {
            sum += step;
            count += 1;
        }
    }
    return count ? 1 + sum / count / interval : 1;
}

/**
 * The recording resampled onto the playback clock around `origin` (the recording position where
 * playback starts), or null when `ratio` needs no correction or lies beyond a clock tolerance.
 */
export function correctClock(recording, ratio, origin, options) {
    const offset = ratio - 1;
    const size = offset < 0 ? -offset : offset;
    if (size < MIN_OFFSET) return null;
    const description = `recording clock ${offset > 0 ? 'faster' : 'slower'} than playback by ` +
        `${(size * 100).toFixed(5)}% (${(offset * 1e6).toFixed(2)} ppm)`;
    if (size > MAX_CLOCK_OFFSET) {
        console.info(`Measured ${description}; too large for a clock mismatch, left uncorrected.`);
        return null;
    }
    console.info(`Estimated ${description}; resampling with this ratio.`);
    return resampleByRatio(recording, ratio, origin, options);
}
