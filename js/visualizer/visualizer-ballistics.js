// Display-side level ballistics shared by the Visualizer analyzers.
// Levels are in dB; fall times are "seconds to fall 20 dB", where 0 means instant.

export function createBallistics(length, withPeaks) {
    return {
        cur: new Float64Array(length).fill(-Infinity),
        peak: withPeaks ? new Float64Array(length).fill(-Infinity) : null,
        holdLeft: withPeaks ? new Float64Array(length) : null
    };
}

// Advance by dt seconds toward the latest raw levels: the current value follows
// rises instantly and falls at 20 / fallTime dB/s; the peak holds for holdTime,
// then falls at 20 / peakFallTime dB/s, never below the current value.
export function stepBallistics(state, raw, dt, fallTime, holdTime = 0, peakFallTime = 0) {
    const { cur, peak, holdLeft } = state;
    const fall = fallTime > 0 ? 20 * dt / fallTime : Infinity;
    const peakRate = peakFallTime > 0 ? 20 / peakFallTime : Infinity;
    for (let i = 0; i < cur.length; i++) {
        const falling = cur[i] - fall;
        const value = raw[i] > falling ? raw[i] : falling;
        cur[i] = value;
        if (!peak) continue;
        if (value >= peak[i]) {
            peak[i] = value;
            holdLeft[i] = holdTime;
        } else if (holdLeft[i] > dt) {
            holdLeft[i] -= dt;
        } else {
            const fallen = peakRate === Infinity ? value : peak[i] - peakRate * (dt - holdLeft[i]);
            holdLeft[i] = 0;
            peak[i] = fallen > value ? fallen : value;
        }
    }
}
