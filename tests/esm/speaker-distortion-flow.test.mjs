// End-to-end flow of the speaker distortion measurement screen with the real analysis module:
// level check, run and Check again through a simulated woofer (one channel, averaging 1).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import * as speakerDistortion from '../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { createSdcContext } from '../../js/utils/measurement-dsp/speaker-distortion/kernels.js';
import { N } from '../../js/utils/measurement-dsp/speaker-distortion/signals.js';
import { HANDLERS } from '../../js/utils/measurement-dsp/speaker-distortion/identify-worker.js';
import { setExecutorFactory } from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import {
    overloadExcessDb, perChannelSeconds, runCheckAgain, runSpeakerDistortionMeasurement
} from '../../features/measurement/measurement-controller/speaker-distortion-measurement.js';
import { createPlant } from '../helpers/distortion-plant-sim.mjs';

const SETTINGS = Object.freeze({
    index: 0, label: 'L', rateHz: N, signalLevelDbfs: -20, bandwidth: [20, 20000], sweepLength: 65536,
    averaging: 1, upperLimitHz: speakerDistortion.UPPER_LIMIT_RANGE_HZ[1], inputDeviceId: '', inputDeviceLabel: ''
});

let binding, context;

before(async () => {
    binding = await instantiateDsp(fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.simd.wasm', import.meta.url)));
    context = createSdcContext(binding);
    setExecutorFactory(() => ({ run: async (type, payload) => HANDLERS[type](context, payload), close() {} }));
});

after(() => {
    setExecutorFactory(null);
    context?.destroy();
    binding?.close?.();
});

test('a run and Check again with the real module produce a valid speaker model', async () => {
    const plant = createPlant({ kind: 'speaker' });
    const play = async (samples, settings) => plant.capture(samples, { fsDev: settings.rateHz });
    const pause = kind => assert.fail(`unexpected pause ${kind}`);
    const signal = new AbortController().signal;

    // Setup step 2: the level check of the first channel.
    const plan = await speakerDistortion.buildCapturePlan(SETTINGS);
    const judged = await speakerDistortion.judgeLevelCheck(await play(plan.levelCheck, SETTINGS), plan);
    assert.equal(judged.outcome, 'passed');

    const record = await runSpeakerDistortionMeasurement({
        settingsList: [SETTINGS], placement: 'listeningPosition', averaging: 1, first: { plan, judged },
        play, pause, signal
    });
    const model = record.speakerModel;
    assert.ok(speakerDistortion.validateSpeakerModel(model), 'the run result is a valid model');
    assert.ok(model.channels[0].checkCall, 'the correction check was applied');

    const length = model.recommendedLength;
    const checked = await runCheckAgain({ model, channels: [0], length, currentDv: 0, play, pause, signal });
    assert.ok(speakerDistortion.validateSpeakerModel(checked.model), 'the Check again result is a valid model');
    assert.ok(['same', 'undetermined'].includes(checked.outcome), `unchanged amplifier: ${checked.outcome}`);
    assert.equal(checked.dv, 0);
    assert.ok(checked.results[0].level, 'the corrected Check again pass was analysed');
});

test('the planned channel time matches the capture plan for standard and Quick', async () => {
    // The run times a channel as level check (8.5 s), captures with gaps, analysis (20 s) and correction
    // check (59.5 s); the setup screen estimates the same before a plan exists.
    for (const settings of [{ ...SETTINGS, averaging: 2 }, { ...SETTINGS, fast: true }]) {
        const plan = await speakerDistortion.buildCapturePlan(settings);
        const capturesSeconds = plan.captures.reduce((sum, capture) =>
            sum + capture.samples.length / settings.rateHz + capture.gapSeconds, 0);
        const planned = 8.5 + capturesSeconds + 79.5;
        assert.ok(Math.abs(perChannelSeconds(settings) - planned) < 1e-6,
            `${settings.fast ? 'Quick' : 'standard'}: ${perChannelSeconds(settings)} s, plan ${planned} s`);
    }
});

test('the overload estimate of a clipped capture through the simulated woofer', async () => {
    const plant = createPlant({ kind: 'speaker' });
    const plan = await speakerDistortion.buildCapturePlan(SETTINGS);
    const db = x => 20 * Math.log10(x);
    // Sweep and chirp-type call: close; phase-optimized multitone call: a lower bound.
    for (const [name, index, exact] of [['sweep', 19, true], ['call f8', 15, true], ['call a1', 0, false]]) {
        const raw = plant.capture(plan.captures[index].samples, { fsDev: SETTINGS.rateHz });
        let peak = 0;
        for (const x of raw) peak = Math.max(peak, Math.abs(x));
        for (const overDb of [2, 6, 12]) {
            const scale = 10 ** (overDb / 20) / peak;
            const clipped = Float32Array.from(raw, x => Math.max(-1, Math.min(1, x * scale)));
            // The capture stops one second after its first clipped sample.
            const first = clipped.findIndex(x => Math.abs(x) >= 1);
            const stopped = clipped.subarray(0, first + SETTINGS.rateHz);
            let truePeak = 0;
            for (let i = 0; i < stopped.length; i++) truePeak = Math.max(truePeak, Math.abs(raw[i] * scale));
            const estimate = overloadExcessDb(stopped, SETTINGS.rateHz);
            const error = estimate - db(truePeak);
            const message = `${name} +${overDb} dB: estimate ${estimate.toFixed(2)}, true ${db(truePeak).toFixed(2)}`;
            assert.ok(estimate >= 0, `${message}: clipping proves full scale`);
            assert.ok(exact ? Math.abs(error) <= 2 : error <= 0.5, message);
        }
    }
});
