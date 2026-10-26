import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import FFT from '../../features/measurement/audio-utils/fft.js';
import { analyzeEssRecording } from '../../js/utils/measurement-dsp/ess.js';
import {
    generateESS, startWhiteNoise, stopWhiteNoise
} from '../../features/measurement/audio-utils/signal-generation.js';
import { DataStorage } from '../../features/measurement/dataStorage.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { resolveSweepBand, resolveResponseSweepBand, essFrequencyLimit } from '../../features/measurement/measurement-model.js';

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

test('ESS setup endpoints share the acquisition frequency ceiling at every offered sample rate', () => {
    for (const sampleRate of [44100, 48000, 88200, 96000, 176400, 192000]) {
        const maxFreq = Math.floor(essFrequencyLimit(sampleRate)), minFreq = maxFreq - 1;
        for (const mode of ['common', 'perChannel']) {
            const config = { acquisitionMethod: 'ess', sweepBand: { mode, common: { minFreq, maxFreq },
                perChannel: [{ channel: 'left', minFreq, maxFreq }] } };
            assert.deepEqual(resolveSweepBand(config, 'left', sampleRate, 131072), { minFreq, maxFreq, bandLimited: true });
        }
    }
});

test('ESS full-band mode uses a finite audible sweep below Nyquist', () => {
    const sweep = generateESS.call({ initialized: true }, 16384, 48000, 'left', 5000, 10000, false);
    assert.equal(sweep.startFrequency, 20);
    assert.equal(sweep.endFrequency, 20000);
    assert.ok(sweep.signal.every(Number.isFinite));
    assert.ok(sweep.length >= 16384);
    assert.equal(sweep.right.some(value => value !== 0), false);
});

test('ESS band resolution matches excitation at low sample rates and near Nyquist without reinterpreting TSP records', () => {
    const cases = [
        { sampleRate: 16000, sweepBand: { mode: 'off' } },
        { sampleRate: 48000, sweepBand: { mode: 'common', common: { minFreq: 100, maxFreq: 23999 } } },
        { sampleRate: 16000, outputChannel: 'right', sweepBand: { mode: 'perChannel', perChannel: [
            { channel: 'right', minFreq: 7900, maxFreq: 7999 }
        ] } }
    ];
    for (const config of cases) {
        const measurement = { ...config, acquisitionMethod: 'ess', sweepLength: 16384 };
        const band = resolveSweepBand(measurement, config.outputChannel || 'left', config.sampleRate, 16384);
        const sweep = generateESS.call({ initialized: true }, 16384, config.sampleRate, config.outputChannel || 'left',
            band.minFreq, band.maxFreq, band.bandLimited);
        assert.equal(band.minFreq, sweep.startFrequency);
        assert.equal(band.maxFreq, sweep.endFrequency);
        assert.deepEqual(resolveResponseSweepBand(measurement, config.outputChannel || 'left'), band);
    }
    const legacy = { sampleRate: 48000, sweepLength: 65536, sweepBand: { mode: 'off' } };
    assert.deepEqual(resolveResponseSweepBand(legacy), {
        minFreq: 48000 / 65536, maxFreq: (65536 / 2 - 1) * 48000 / 65536, bandLimited: false
    });
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
        .map(value => {
            const label = createNode();
            return createNode({ value, type: 'checkbox', checked: value === 'all', closest: () => label });
        });
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
        ['outputChannelCount', input('2')],
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
            restoredSettings = { outputChannelCount: 6,
                sweepBandLimited: true, sweepMinFreq: '5000', sweepMaxFreq: '18000' };
            window.app.loadUserSettings();
            window.app.saveUserSettings();
            assert.deepEqual(savedSettings.sweepBand.common, { minFreq: 5000, maxFreq: 18000 });
            assert.equal(savedSettings.sweepBand.mode, 'common');
            assert.equal(savedSettings.outputChannelCount, 6);
            assert.equal(savedSettings.sweepBand.perChannel.length, 6);
            assert.equal(document.getElementById('sweepBandChannel').children.length, 6);

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

test('simultaneous ESS sweeps preserve the summed speaker bands with one unit reference', () => {
    const sampleRate = 16000;
    const sweep = generateESS.call({ initialized: true }, 32768, sampleRate, 'all', 200, 7000, true, [
        { minFreq: 200, maxFreq: 3000 }, { minFreq: 2000, maxFreq: 7000 }
    ]);
    const recording = new Float32Array(8000 + sweep.length + sweep.tailSamples);
    recording.set(Float32Array.from(sweep.left, (value, i) => (value + sweep.right[i]) * 0.2), 8100);
    const result = analyzeEssRecording(recording, sweep, { playbackOffsetSamples: 8000, levelDb: 20 * Math.log10(0.2) });
    for (const [frequency, gain] of [[1000, 1], [2500, 2], [5000, 1]]) {
        const point = result.frequencyResponse.reduce((a, b) => Math.abs(a[0] - frequency) < Math.abs(b[0] - frequency) ? a : b);
        assert.ok(Math.abs(point[1] - 20 * Math.log10(gain)) < 0.2, `${frequency}: ${point[1]}`);
    }
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
