import assert from 'node:assert/strict';
import test from 'node:test';

import { runRenderRequest } from '../../js/pipeline-analyzer/analysis-worker.js';
import { analyzeEssRecording, createEssSignal } from '../../js/utils/measurement-dsp/ess.js';

// Objective check for measuring through the effect pipeline: an ESS rendered through a
// synthetic pipeline and analyzed as an ideal loopback recording must show the
// pipeline's theoretical response and the expected time origin.
const SAMPLE_RATE = 48000;
const LEVEL_DB = -12;
const PLAYBACK_OFFSET = 4800;
const GAIN = 0.5;
const PEQ = Object.freeze({ frequency: 1000, gainDb: 6, q: 1 });
// The JS fallback reports ceil(la * sampleRate / 1000) samples for this plugin type.
const REPORTED_DELAY_TYPE = 'BrickwallLimiterPlugin';
const REPORTED_LOOKAHEAD_MS = 2;
const REPORTED_DELAY = 96;
const UNREPORTED_DELAY = 37;

function peakingCoefficients({ frequency, gainDb, q }) {
    const amplitude = 10 ** (gainDb / 40);
    const omega = 2 * Math.PI * frequency / SAMPLE_RATE;
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha / amplitude;
    return {
        b0: (1 + alpha * amplitude) / a0,
        b1: -2 * Math.cos(omega) / a0,
        b2: (1 - alpha * amplitude) / a0,
        a1: -2 * Math.cos(omega) / a0,
        a2: (1 - alpha / amplitude) / a0
    };
}

function theoreticalDb(frequency) {
    const { b0, b1, b2, a1, a2 } = peakingCoefficients(PEQ);
    const omega = 2 * Math.PI * frequency / SAMPLE_RATE;
    const c1 = Math.cos(omega);
    const s1 = Math.sin(omega);
    const c2 = Math.cos(2 * omega);
    const s2 = Math.sin(2 * omega);
    const numerator = Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2);
    const denominator = Math.hypot(1 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2);
    return 20 * Math.log10(GAIN * numerator / denominator);
}

const GAIN_PROCESSOR = `
    for (let i = 0; i < data.length; i++) data[i] *= ${GAIN};
    return data;
`;

function biquadProcessor() {
    const { b0, b1, b2, a1, a2 } = peakingCoefficients(PEQ);
    return `
        const state = context.biquad ??= { x1: 0, x2: 0, y1: 0, y2: 0 };
        for (let i = 0; i < data.length; i++) {
            const x = data[i];
            const y = ${b0} * x + ${b1} * state.x1 + ${b2} * state.x2 - ${a1} * state.y1 - ${a2} * state.y2;
            state.x2 = state.x1; state.x1 = x;
            state.y2 = state.y1; state.y1 = y;
            data[i] = y;
        }
        return data;
    `;
}

function delayProcessor(samples) {
    return `
        const state = context.delay ??= { buffer: new Float32Array(${samples}), position: 0 };
        for (let i = 0; i < data.length; i++) {
            const delayed = state.buffer[state.position];
            state.buffer[state.position] = data[i];
            state.position = (state.position + 1) % ${samples};
            data[i] = delayed;
        }
        return data;
    `;
}

function pipelineSnapshot(delayStage = null) {
    const stages = [
        { type: 'PipelineCheckGainPlugin', processor: GAIN_PROCESSOR },
        { type: 'PipelineCheckPeakingPlugin', processor: biquadProcessor() },
        ...(delayStage ? [delayStage] : [])
    ];
    return {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        plugins: stages.map((stage, index) => ({
            id: index + 1,
            type: stage.type,
            enabled: true,
            parameters: stage.parameters ?? {},
            inputBus: 0,
            outputBus: 0,
            channel: 'A'
        })),
        masterBypass: false,
        processors: stages.map(stage => ({ pluginType: stage.type, processor: stage.processor }))
    };
}

async function measureThroughPipeline(sweep, snapshot) {
    const plan = { length: PLAYBACK_OFFSET + sweep.length + sweep.tailSamples };
    const input = new Float32Array(plan.length);
    const gain = 10 ** (LEVEL_DB / 20);
    for (let index = 0; index < sweep.length; index++) {
        input[PLAYBACK_OFFSET + index] = sweep.signal[index] * gain;
    }
    const { output, reportedLatency } = await runRenderRequest({
        type: 'render', requestId: 1, snapshot, input: [input]
    });
    const analysis = analyzeEssRecording(output[0], sweep, {
        repetitions: 1,
        playbackOffsetSamples: PLAYBACK_OFFSET,
        outputTimeReference: 'audio-context',
        levelDb: LEVEL_DB
    });
    return { analysis, reportedLatency };
}

test('an ESS rendered through a synthetic pipeline measures its theoretical response and time origin', async () => {
    const sweep = createEssSignal({
        length: 65536, sampleRate: SAMPLE_RATE, startFrequency: 20, endFrequency: 20000
    });

    const direct = await measureThroughPipeline(sweep, pipelineSnapshot());
    assert.equal(direct.reportedLatency, 0);
    let checked = 0;
    let worstError = 0;
    for (const [frequency, db] of direct.analysis.frequencyResponse) {
        if (frequency < 50 || frequency > 15000) continue;
        const error = Math.abs(db - theoreticalDb(frequency));
        if (error > worstError) worstError = error;
        checked += 1;
    }
    assert.ok(checked > 100, `too few frequency points checked: ${checked}`);
    assert.ok(worstError <= 0.1, `worst response error ${worstError.toFixed(4)} dB`);

    const reported = await measureThroughPipeline(sweep, pipelineSnapshot({
        type: REPORTED_DELAY_TYPE,
        parameters: { la: REPORTED_LOOKAHEAD_MS },
        processor: delayProcessor(REPORTED_DELAY)
    }));
    assert.equal(reported.reportedLatency, REPORTED_DELAY);
    assert.equal(reported.analysis.trimStartSamples, direct.analysis.trimStartSamples);

    const unreported = await measureThroughPipeline(sweep, pipelineSnapshot({
        type: 'PipelineCheckDelayPlugin',
        processor: delayProcessor(UNREPORTED_DELAY)
    }));
    assert.equal(unreported.reportedLatency, 0);
    assert.equal(unreported.analysis.trimStartSamples, direct.analysis.trimStartSamples + UNREPORTED_DELAY);
});
