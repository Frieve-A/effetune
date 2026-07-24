export function detectOnsetFromEnergies(energies, sampleRate) {
    let leadingSilenceFrames = 0;
    while (leadingSilenceFrames < energies.length && energies[leadingSilenceFrames] <= 1e-20) {
        leadingSilenceFrames += 1;
    }
    if (leadingSilenceFrames === energies.length) return { onsetFrame: 0, leadingSilenceFrames: 0 };
    const roundedWindow = Math.round(sampleRate * 0.001);
    const windowFrames = roundedWindow < 8 ? 8 : roundedWindow;
    const windowEnergy = new Float64Array(energies.length);
    let running = 0;
    let peak = 0;
    for (let frame = 0; frame < energies.length; frame += 1) {
        running += energies[frame];
        if (frame >= windowFrames) running -= energies[frame - windowFrames];
        windowEnergy[frame] = running;
        if (running > peak) peak = running;
    }
    const threshold = peak * 0.01;
    let onsetFrame = leadingSilenceFrames;
    while (onsetFrame < windowEnergy.length && windowEnergy[onsetFrame] < threshold) onsetFrame += 1;
    if (onsetFrame === windowEnergy.length) onsetFrame = leadingSilenceFrames;
    return { onsetFrame, leadingSilenceFrames };
}

export function detectOnset(samples, sampleRate = 48000) {
    if (!samples?.length) return 0;
    const energies = new Float64Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) energies[index] = samples[index] * samples[index];
    return detectOnsetFromEnergies(energies, sampleRate).onsetFrame;
}

export function trimMeasurementImpulseResponse(samples, sampleRate, sweepLength, onsetIndex) {
    const prerollSamples = Math.min(4096, Math.max(0, sweepLength - 1));
    const start = Math.max(0, onsetIndex - prerollSamples);
    const storedOnset = onsetIndex - start;
    const available = samples.length - start;
    const length = Math.max(1, Math.min(
        Math.ceil(1.5 * sampleRate),
        2 ** 18,
        Math.max(1, sweepLength - prerollSamples),
        available
    ));
    return {
        data: Float32Array.from(samples.subarray(start, start + length)),
        onsetIndex: storedOnset,
        prerollSamples: storedOnset,
        sweepLimited: length === sweepLength - prerollSamples
    };
}
