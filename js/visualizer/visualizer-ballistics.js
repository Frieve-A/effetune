// Display-side level ballistics shared by the Visualizer analyzers.
// Levels are in dB; fall times are "seconds to fall 20 dB", where 0 means instant.

// Held values are kept per hold-time slot: HOLD_SLOTS + 1 slots of holdTime / HOLD_SLOTS
// seconds, so each value is held between holdTime and holdTime * (1 + 1 / HOLD_SLOTS).
const HOLD_SLOTS = 4;
const SLOT_COUNT = HOLD_SLOTS + 1;

export function createBallistics(length, withPeaks) {
    return {
        cur: new Float64Array(length).fill(-Infinity),
        peak: withPeaks ? new Float64Array(length).fill(-Infinity) : null,
        falling: withPeaks ? new Float64Array(length).fill(-Infinity) : null,
        slots: withPeaks ? Array.from({ length: SLOT_COUNT }, () => new Float64Array(length).fill(-Infinity)) : null,
        head: 0,
        slotTime: 0
    };
}

// Advance by dt seconds toward the latest raw levels: the current value follows
// rises instantly and falls at 20 / fallTime dB/s. The peak is the upper envelope of
// past current values, each held for holdTime and then falling at 20 / peakFallTime
// dB/s. Unlike a single hold timer that restarts only on a new maximum, this envelope
// changes continuously with the input, so neighboring bins with nearly equal levels
// keep nearly equal peaks instead of one holding while the other falls.
export function stepBallistics(state, raw, dt, fallTime, holdTime = 0, peakFallTime = 0) {
    const { cur, peak, falling, slots } = state;
    const fall = fallTime > 0 ? 20 * dt / fallTime : Infinity;
    for (let i = 0; i < cur.length; i++) {
        const lowered = cur[i] - fall;
        cur[i] = raw[i] > lowered ? raw[i] : lowered;
    }
    if (!peak) return;
    const peakRate = peakFallTime > 0 ? 20 / peakFallTime : Infinity;
    // Infinity * 0 would be NaN, so an instant fall over zero time drops nothing.
    const drop = seconds => seconds > 0 ? peakRate * seconds : 0;
    const width = holdTime / HOLD_SLOTS;
    // Rotations since the last step; only the first SLOT_COUNT ones retire filled slots.
    let rotations = SLOT_COUNT;
    let rest = 0;
    if (width > 0) {
        const time = state.slotTime + dt;
        rotations = Math.floor(time / width);
        rest = time - rotations * width;
        state.slotTime = rest;
    }
    const retired = rotations < SLOT_COUNT ? rotations : SLOT_COUNT;
    const decay = drop(dt);
    for (let i = 0; i < cur.length; i++) falling[i] -= decay;
    for (let j = 1; j <= retired; j++) {
        state.head = (state.head + 1) % SLOT_COUNT;
        const slot = slots[state.head];
        // This slot's hold ended at the j-th rotation and has been falling since.
        const since = drop((rotations - j) * width + rest);
        for (let i = 0; i < cur.length; i++) {
            const value = slot[i] - since;
            if (value > falling[i]) falling[i] = value;
            slot[i] = -Infinity;
        }
    }
    const current = width > 0 ? slots[state.head] : falling;
    for (let i = 0; i < cur.length; i++) {
        if (cur[i] > current[i]) current[i] = cur[i];
        let value = falling[i];
        for (const slot of slots) if (slot[i] > value) value = slot[i];
        peak[i] = value;
    }
}
