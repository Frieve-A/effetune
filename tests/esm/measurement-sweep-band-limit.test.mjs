import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import FFT from '../../features/measurement/audio-utils/fft.js';
import {
    generateTSP, startWhiteNoise, stopWhiteNoise
} from '../../features/measurement/audio-utils/signal-generation.js';
import { DataStorage } from '../../features/measurement/dataStorage.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

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

test('sweep bandwidth offers three modes and persists the complete channel configuration', () => {
    for (const mode of ['off', 'common', 'perChannel']) {
        assert.ok(measurementHtml.includes(`name="sweepBandMode" value="${mode}"`));
    }
    assert.match(measurementHtml, /name="sweepBandMode" value="common" checked/);
    assert.match(appSource, /input\.disabled = mode !== 'common'/);
    assert.match(appSource, /input\.disabled = mode !== 'perChannel'/);
    assert.match(appSource, /sweepBand: getSweepBandConfiguration\(\)/);
});

function createNode(properties = {}) {
    return {
        children: [],
        dataset: {},
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
        addEventListener() {},
        ...properties
    };
}

function createMeasurementSettingsDocument() {
    const sweepBandChannel = createNode({
        querySelector(selector) {
            return selector === 'input:checked'
                ? this.children.flatMap(label => label.children).find(input => input.checked) : null;
        }
    });
    const outputControls = ['all', 'left', 'right', '2', '3', '4', '5', '6', '7']
        .map(value => createNode({ value, type: 'checkbox', checked: value === 'all' }));
    const sweepBandModes = ['off', 'common', 'perChannel'].map(value =>
        createNode({ value, type: 'radio', checked: value === 'common' }));
    for (const control of sweepBandModes) {
        let checked = control.checked;
        Object.defineProperty(control, 'checked', {
            get: () => checked,
            set: value => {
                checked = Boolean(value);
                if (checked) sweepBandModes.filter(other => other !== control)
                    .forEach(other => { other.checked = false; });
            }
        });
    }
    const input = value => createNode({ value });
    const elements = new Map([
        ['sampleRate', input('48000')], ['inputChannel', input('left')],
        ['sweepLength', input('65536')], ['averaging', input('1')],
        ['sweepMinFreq', input('20')], ['sweepMaxFreq', input('20000')],
        ['sweepBandChannelMinFreq', input('20')], ['sweepBandChannelMaxFreq', input('20000')],
        ['sweepBandChannel', sweepBandChannel]
    ]);
    return {
        addEventListener() {},
        createElement: () => createNode(),
        getElementById: id => elements.get(id) || null,
        querySelector(selector) {
            if (selector === '#sweepBandMode input:checked') {
                return sweepBandModes.find(control => control.checked) || null;
            }
            const mode = selector.match(/^#sweepBandMode input\[value="(.+)"\]$/);
            if (mode) return sweepBandModes.find(control => control.value === mode[1]) || null;
            return selector === '#sweepBandChannel input:checked'
                ? sweepBandChannel.querySelector('input:checked') : null;
        },
        querySelectorAll(selector) {
            if (selector === '#outputChannel input:checked') {
                return outputControls.filter(control => control.checked);
            }
            return selector === '#outputChannel input[type="checkbox"]' ? outputControls : [];
        }
    };
}

test('settings restore adapts released sweep bands and prioritizes current per-channel settings', async () => {
    await withGlobals({
        window: { addEventListener() {} }, document: createMeasurementSettingsDocument()
    }, async () => {
        await import(`../../features/measurement/app.js?settings-test=${Date.now()}`);
        const storage = window.app.dataStorage;
        const originalLoad = storage.loadUserSettings;
        const originalSave = storage.saveUserSettings;
        let restoredSettings;
        let savedSettings;
        storage.loadUserSettings = () => restoredSettings;
        storage.saveUserSettings = settings => { savedSettings = settings; };
        try {
            restoredSettings = { sweepBandLimited: true, sweepMinFreq: '5000', sweepMaxFreq: '18000' };
            window.app.loadUserSettings();
            window.app.saveUserSettings();
            assert.deepEqual(savedSettings.sweepBand.common, { minFreq: 5000, maxFreq: 18000 });
            assert.equal(savedSettings.sweepBand.mode, 'common');

            restoredSettings = { sweepBandLimited: false, sweepMinFreq: '5000', sweepMaxFreq: '18000' };
            window.app.loadUserSettings();
            window.app.saveUserSettings();
            assert.equal(savedSettings.sweepBand.mode, 'off');
            assert.deepEqual(savedSettings.sweepBand.common, { minFreq: 5000, maxFreq: 18000 });

            restoredSettings = {
                sweepBandLimited: false, sweepMinFreq: '100', sweepMaxFreq: '200',
                outputChannels: ['left', 'right'],
                sweepBand: {
                    mode: 'perChannel', common: { minFreq: 30, maxFreq: 19000 },
                    perChannel: [
                        { channel: 'left', minFreq: 40, maxFreq: 400 },
                        { channel: 'right', minFreq: 1500, maxFreq: 1800 }
                    ]
                }
            };
            window.app.loadUserSettings();
            window.app.saveUserSettings();
            assert.equal(savedSettings.sweepBand.mode, 'perChannel');
            assert.deepEqual(savedSettings.sweepBand.common, { minFreq: 30, maxFreq: 19000 });
            assert.deepEqual(savedSettings.sweepBand.perChannel.slice(0, 2), [
                { channel: 'left', minFreq: 40, maxFreq: 400 },
                { channel: 'right', minFreq: 1500, maxFreq: 1800 }
            ]);
        } finally {
            storage.loadUserSettings = originalLoad;
            storage.saveUserSettings = originalSave;
        }
    });
});

test('simultaneous sweeps filter each speaker and retain one calibrated aggregate reference', () => {
    const state = { initialized: true };
    const length = 1024;
    const sampleRate = 48000;
    const sweep = generateTSP.call(state, length, sampleRate, 'all', 1000, 12000, true, [
        { minFreq: 1000, maxFreq: 6000 },
        { minFreq: 4000, maxFreq: 12000 }
    ]);
    assert.ok(spectrumMagnitude(sweep.left, 44) > spectrumMagnitude(sweep.right, 44) * 1000);
    assert.ok(spectrumMagnitude(sweep.right, 200) > spectrumMagnitude(sweep.left, 200) * 1000);
    const sum = Float32Array.from(sweep.left, (value, i) => value + sweep.right[i]);
    const fft = new FFT(length);
    const real = new Float32Array(length), imag = new Float32Array(length);
    const invReal = new Float32Array(length), invImag = new Float32Array(length);
    fft.transform(real, imag, sum, new Float32Array(length));
    fft.transform(invReal, invImag, sweep.inverseFilter, new Float32Array(length));
    for (const [bin, expected] of [[44, 1], [107, 2], [200, 1]]) {
        const gain = (real[bin] * invReal[bin] - imag[bin] * invImag[bin]) /
            state.lastDeconvolutionRefScale;
        assert.ok(Math.abs(gain - expected) < 1e-5, `${bin}: ${gain}`);
    }
    assert.ok(sweep.channels.every(samples => samples.every(value => Math.abs(value) <= 0.951)));
});

test('simultaneous noise uses separate bands and releases its multichannel source', async () => {
    const destination = { maxChannelCount: 2, channelCount: 2 };
    const source = { connect() {}, start() {}, stop() { this.stopped = true; }, disconnect() {} };
    const gain = { gain: {}, connect(target) { this.target = target; }, disconnect() {} };
    const state = {
        audioContext: {
            sampleRate: 2048, state: 'running', destination,
            createBuffer(count, length) {
                const channels = Array.from({ length: count }, () => new Float32Array(length));
                return { getChannelData: channel => channels[channel], numberOfChannels: count };
            },
            createBufferSource: () => source,
            createGain: () => gain
        },
        ensureAudioContextRunning: async () => true
    };
    try {
        assert.equal(await startWhiteNoise.call(state, -12, null, 'all', 100, 900, [
            { minFreq: 100, maxFreq: 300 }, { minFreq: 600, maxFreq: 900 }
        ]), true);
        assert.equal(source.buffer.numberOfChannels, 2);
        assert.equal(gain.target, destination);
        const low = source.buffer.getChannelData(0), high = source.buffer.getChannelData(1);
        assert.ok(spectrumMagnitude(low, 400) > spectrumMagnitude(high, 400) * 1000);
        assert.ok(spectrumMagnitude(high, 1400) > spectrumMagnitude(low, 1400) * 1000);
    } finally {
        stopWhiteNoise.call(state);
    }
    assert.equal(source.stopped, true);
});

test('measurement import retains valid per-output bands and rejects malformed ranges', async () => {
    const storage = new DataStorage();
    storage.generateId = () => 'imported';
    let imported;
    storage.addMeasurement = async measurement => { imported = measurement; return measurement.id; };
    const measurement = { name: 'Bands', points: [], sweepBand: {
        mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
        perChannel: [{ channel: 'left', minFreq: 40, maxFreq: 400 }]
    } };
    assert.equal(await storage.importMeasurementFromJSON(JSON.stringify(measurement)), 'imported');
    assert.deepEqual(imported.sweepBand, measurement.sweepBand);
    for (const entry of [
        { channel: 'left', minFreq: 400, maxFreq: 40 },
        { channel: 'all', minFreq: 40, maxFreq: 400 },
        { channel: 'left', minFreq: '40', maxFreq: 400 }
    ]) {
        const invalid = structuredClone(measurement);
        invalid.sweepBand.perChannel = [entry];
        assert.equal(await storage.importMeasurementFromJSON(JSON.stringify(invalid)), null);
    }
});
