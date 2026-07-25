const AUDIBLE_MIN_FREQUENCY = 20;
const AUDIBLE_MAX_FREQUENCY = 20000;

/**
 * Normalize a frequency response to the median level inside the audible
 * portion of the measured band. The median keeps low- and high-frequency
 * roll-off from shifting an otherwise flat mid-band away from 0 dB.
 *
 * @param {Array} response Frequency response data as [[frequency, dB], ...]
 * @param {number} measurementMinFrequency Measured lower frequency limit
 * @param {number} measurementMaxFrequency Measured upper frequency limit
 * @returns {Array} Normalized frequency response
 */
function normalizeResponseToZeroDb(
    response,
    measurementMinFrequency = AUDIBLE_MIN_FREQUENCY,
    measurementMaxFrequency = AUDIBLE_MAX_FREQUENCY
) {
    if (!response || response.length === 0) return response;

    const minFrequency = Math.max(
        AUDIBLE_MIN_FREQUENCY,
        Number.isFinite(measurementMinFrequency)
            ? measurementMinFrequency
            : AUDIBLE_MIN_FREQUENCY
    );
    const maxFrequency = Math.min(
        AUDIBLE_MAX_FREQUENCY,
        Number.isFinite(measurementMaxFrequency)
            ? measurementMaxFrequency
            : AUDIBLE_MAX_FREQUENCY
    );
    const magnitudes = response
        .filter(([frequency, db]) =>
            frequency >= minFrequency &&
            frequency <= maxFrequency &&
            Number.isFinite(db)
        )
        .map(([, db]) => db)
        .sort((a, b) => a - b);

    if (magnitudes.length === 0) return response.map(point => [...point]);

    const middle = Math.floor(magnitudes.length / 2);
    const referenceDb = magnitudes.length % 2 === 1
        ? magnitudes[middle]
        : (magnitudes[middle - 1] + magnitudes[middle]) / 2;

    return response.map(([frequency, db]) => [frequency, db - referenceDb]);
}

export {
    AUDIBLE_MAX_FREQUENCY,
    AUDIBLE_MIN_FREQUENCY,
    normalizeResponseToZeroDb
};
