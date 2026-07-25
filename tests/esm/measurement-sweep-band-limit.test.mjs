import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import FFT from '../../features/measurement/audio-utils/fft.js';
import {
    generateTSP
} from '../../features/measurement/audio-utils/signal-generation.js';

const measurementHtml = fs.readFileSync(
    new URL('../../features/measurement/measurement.html', import.meta.url),
    'utf8'
);
const appSource = fs.readFileSync(
    new URL('../../features/measurement/app.js', import.meta.url),
    'utf8'
);

function spectrumMagnitude(signal, bin) {
    const fft = new FFT(signal.length);
    const real = new Float32Array(signal.length);
    const imag = new Float32Array(signal.length);
    fft.transform(real, imag, signal, new Float32Array(signal.length));
    return Math.hypot(real[bin], imag[bin]);
}

test('unlimited TSP uses every non-DC FFT bin', () => {
    const length = 1024;
    const sampleRate = 48000;
    const harness = { initialized: true };

    const fullBand = generateTSP.call(
        harness,
        length,
        sampleRate,
        'left',
        5000,
        10000,
        false
    );
    const limited = generateTSP.call(
        { initialized: true },
        length,
        sampleRate,
        'left',
        5000,
        10000,
        true
    );

    const firstBin = 1;
    const lastBin = length / 2 - 1;
    assert.ok(
        spectrumMagnitude(fullBand.left, firstBin) >
            spectrumMagnitude(limited.left, firstBin) * 1000
    );
    assert.ok(
        spectrumMagnitude(fullBand.left, lastBin) >
            spectrumMagnitude(limited.left, lastBin) * 1000
    );
    assert.equal(fullBand.frequencyResponse[0].frequency, sampleRate / length);
    assert.ok(
        Math.abs(
            fullBand.frequencyResponse.at(-1).frequency -
            lastBin * sampleRate / length
        ) < 1e-9
    );
});

test('sweep bandwidth control defaults to limited and disables both frequency inputs when off', () => {
    assert.match(
        measurementHtml,
        /<input type="checkbox" id="sweepBandLimited" checked>/
    );
    assert.match(
        appSource,
        /const disabled = !bandLimitedInput\.checked;[\s\S]*?minInput\.disabled = disabled;[\s\S]*?maxInput\.disabled = disabled;/
    );
    assert.match(
        appSource,
        /sweepBandLimited'\)\.addEventListener\('change', \(\) => \{[\s\S]*?updateSweepBandLimitControls\(\);[\s\S]*?saveUserSettings\(\);/
    );
    assert.match(
        appSource,
        /sweepBandLimited: document\.getElementById\('sweepBandLimited'\)\.checked/
    );
    assert.match(
        appSource,
        /typeof settings\.sweepBandLimited === 'boolean'[\s\S]*?\.checked = settings\.sweepBandLimited/
    );
});
