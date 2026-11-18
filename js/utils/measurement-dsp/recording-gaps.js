// Shared policy for recordings whose capture slipped (samples lost or inserted by the input path).

/** Share of the repetitions or periods that must remain for their average to count as measured. */
export const MIN_KEPT_SHARE = 0.7;

/** Extra plays of a test signal whose recording was not usable. */
export const MAX_REPLAYS = 2;

const GAP_STATES = [null, 'corrected', 'interrupted'];

/** The worst of recording-gap states (null, 'corrected', 'interrupted'). */
export const worstGaps = (...states) =>
    states.reduce((worst, state) => (GAP_STATES.indexOf(state) > GAP_STATES.indexOf(worst) ? state : worst), null);
