import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { getNativeMeasurementDriver, NativeMeasurement, nativeMeasurementInputIndices } from
    '../../features/measurement/audio-utils/native-measurement.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import AudioProcessing from '../../features/measurement/measurement-controller/audio-processing.js';
import { MeasurementController } from '../../features/measurement/measurement-controller/index.js';
import uiManager from '../../features/measurement/ui/ui-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('only native desktop drivers use the native measurement devices and input channel indices', () => {
    assert.equal(getNativeMeasurementDriver({ startupDriver: () => 'standard' }), null);
    assert.equal(getNativeMeasurementDriver({ startupDriver: () => 'wasapi' }), 'wasapi');
    assert.equal(getNativeMeasurementDriver({ startupDriver: () => 'miniaudio' }), 'miniaudio');
    assert.deepEqual(nativeMeasurementInputIndices('left', 2), [0]);
    assert.deepEqual(nativeMeasurementInputIndices('right', 2), [1]);
    assert.deepEqual(nativeMeasurementInputIndices('both', 2), [0, 1]);
    assert.deepEqual(nativeMeasurementInputIndices('both', 1), [0]);
    assert.deepEqual(nativeMeasurementInputIndices('4', 5), [4]);
    assert.throws(() => nativeMeasurementInputIndices('right', 1));
    assert.throws(() => nativeMeasurementInputIndices('4', 4));
});

test('native capture applies playback gain, interleaves selected channels, and reads timing and overload', async () => {
    const { port1: control, port2: sidecar } = new MessageChannel();
    const messages = [];
    sidecar.on('message', message => {
        messages.push(message);
        const state = (value, format) => sidecar.postMessage({ type: 'measurementState', state: value, ...format });
        switch (message.type) {
            case 'openMeasurement': state('open', { sampleRate: 48000, outputChannels: 3 }); break;
            case 'measurementBegin': state('ready'); break;
            case 'measurementChunk': break;
            case 'measurementStart': state('running'); break;
            case 'measurementStatus':
                sidecar.postMessage({ type: 'measurementStatus', status: 'complete', inputPeak: .8, overloadStopped: true });
                break;
            case 'measurementRead': {
                const { offset, frames } = message;
                const samples = new Float32Array(frames);
                samples[0] = .75;
                sidecar.postMessage({ type: 'measurementData', offset, frames, captureStartFrame: 0, playbackStartFrame: 10,
                    attachment: samples.buffer });
                break;
            }
            case 'measurementCancel': state('open'); break;
            case 'closeMeasurement': state('closed'); break;
            default: assert.fail(`Unexpected measurement command ${message.type}`);
        }
    });
    const native = new NativeMeasurement('wasapi', {}, async driver => {
        assert.equal(driver, 'wasapi');
        return { ports: [control] };
    });
    const { signal } = new AbortController();
    try {
        await native.open({ sampleRate: 48000, inputDeviceId: 'microphone', inputChannelIndices: [4],
            outputDeviceId: 'speakers', outputChannels: 3 }, signal);
        const channels = [[1, 2], [0, 0], [3, 4]];
        const starts = [];
        const result = await native.record({ sampleRate: 48000, length: 2, numberOfChannels: 3,
            getChannelData: index => Float32Array.from(channels[index]) }, .25, { peak: .999, tailSeconds: .1 }, signal,
        duration => starts.push([messages.at(-1)?.type, duration]));
        assert.deepEqual(starts, [['measurementStart', 48002 / 48000]]);
        assert.equal(result.overloadStopped, true);
        assert.equal(result.playbackStartFrame, 10);
        assert.equal(result.captureStartFrame, 0);
        assert.equal(result.recording.length, 48002);
        assert.equal(result.recording[0], .75);
        const [open, begin, chunk] = messages;
        assert.deepEqual(open.inputChannelIndices, [4]);
        assert.equal(begin.overloadTailFrames, 4800);
        assert.equal(begin.overloadPeak, .999);
        assert.deepEqual([...new Float32Array(chunk.attachment)], [.25, 0, .75, .5, 0, 1]);

        await native.startPlayback([null, Float32Array.of(.5, 1), null], .5, { loop: true });
        await native.startPlayback([null, Float32Array.of(.5, 1), null], .25, { loop: true });
        const [startLoop, loopChunk, start, cancelLoop, restartLoop, restartChunk] = messages.slice(-7, -1);
        assert.equal(startLoop.loop, true);
        assert.equal(startLoop.captureFrames, 0);
        assert.deepEqual([...new Float32Array(loopChunk.attachment)], [0, .25, 0, 0, .5, 0]);
        assert.equal(start.type, 'measurementStart');
        assert.equal(cancelLoop.type, 'measurementCancel');
        assert.equal(restartLoop.loop, true);
        assert.deepEqual([...new Float32Array(restartChunk.attachment)], [0, .125, 0, 0, .25, 0]);
        await native.close();
        assert.equal(messages.at(-1).type, 'closeMeasurement');
    } finally {
        native.client?.close();
        sidecar.close();
    }
});

test('native all-channel noise and sweep buffers use the selected width on wider devices', async t => {
    const context = { sampleRate: 8000, createBuffer(count, frames) {
        const channels = Array.from({ length: count }, () => new Float32Array(frames));
        return { numberOfChannels: count, length: frames, getChannelData: i => channels[i] };
    } };
    t.mock.method(audioUtils, 'stopMicrophoneInput', async () => {});
    const native = { async open(options) { this.session = options; return options; },
        async ensureOpen() { return this.session; },
        async startPlayback(channels) { this.channels = channels; },
        async cancel() {},
        async record(buffer) { return { recording: new Float32Array(8), sampleRate: context.sampleRate,
            outputChannels: buffer.numberOfChannels }; } };
    const previous = { nativeMeasurement: audioUtils.nativeMeasurement, devices: audioUtils.devices,
        audioContext: audioUtils.audioContext, microphone: audioUtils.microphone,
        microphoneRequest: audioUtils.microphoneRequest, selectedInputChannel: audioUtils.selectedInputChannel };
    Object.assign(audioUtils, { nativeMeasurement: native, audioContext: context });
    t.after(() => Object.assign(audioUtils, previous));
    for (const [width, capacity] of [[1, 2], [2, 8]]) {
        audioUtils.devices = { inputs: [{ id: 'in', channels: 2 }], outputs: [{ id: 'out', channels: capacity }] };
        await audioUtils.startMicrophoneInput('in', 'left', { outputDeviceId: 'out', outputChannelCount: width });
        assert.equal(native.session.outputChannels, width);
        assert.equal(await audioUtils.startWhiteNoise(-20, 'out', 'all'), true);
        assert.equal(native.channels.length, width);
        assert.ok(native.channels.every(channel => channel.some(value => value !== 0)));
        await audioUtils.stopWhiteNoise();
        const controller = { ...AudioProcessing };
        await controller.recordPlayback({ outputChannel: 'all', createPlayback: (audio, count) => {
            assert.equal(count, width);
            return { buffer: audio.createBuffer(count, 8), gain: 1 };
        }, finish: () => {} });
    }
});

test('native ESS starts the input level graph and excites the selected outputs', async t => {
    const width = 6;
    const previous = { initialized: audioUtils.initialized, audioContext: audioUtils.audioContext,
        nativeMeasurement: audioUtils.nativeMeasurement, sweepMinFreq: audioUtils.sweepMinFreq,
        sweepMaxFreq: audioUtils.sweepMaxFreq };
    t.after(() => Object.assign(audioUtils, previous));
    const context = { sampleRate: 8000, createBuffer(count, length) {
        const channels = Array.from({ length: count }, () => new Float32Array(length));
        return { numberOfChannels: count, length, sampleRate: this.sampleRate, getChannelData: i => channels[i] };
    } };
    let playback;
    const nativeMeasurement = { session: { outputChannels: width }, async record(buffer, _gain, _overload, _signal, onStart) {
        playback = buffer;
        onStart?.(1 + buffer.length / buffer.sampleRate);
        return { recording: new Float32Array(8), sampleRate: buffer.sampleRate };
    } };
    Object.assign(audioUtils, { initialized: true, audioContext: context, nativeMeasurement });
    const controller = new MeasurementController();
    controller.measurementConfig = { sweepLength: 1024, averaging: 1, outputChannelCount: width };
    const startLevelGraph = t.mock.method(controller, 'startChannelLevelGraph', () => {});
    t.mock.method(controller, 'processRecordedBuffer', async () => ({}));
    await withGlobals({ document: { getElementById: () => ({ value: '-12' }) } }, async () => {
        for (const mode of ['off', 'common']) {
            controller.currentMeasurement = { acquisitionMethod: 'ess', sweepLength: 1024,
                sweepBand: { mode, common: { minFreq: 100, maxFreq: 2500 } } };
            for (const selection of ['all', '4']) {
                const sweep = controller.generateChannelSweep(selection);
                startLevelGraph.mock.resetCalls();
                await controller.playAndRecordSweep(sweep, selection, width);
                assert.deepEqual(startLevelGraph.mock.calls.map(call => call.arguments), [[1 + playback.length / playback.sampleRate]]);
                assert.equal(playback.numberOfChannels, width);
                for (let index = 0; index < width; index++) {
                    const samples = playback.getChannelData(index);
                    if (selection === 'all' || index === 4) {
                        assert.ok(samples.some(value => value !== 0));
                        assert.deepEqual(samples.subarray(0, sweep.length), sweep.signal);
                    } else assert.ok(samples.every(value => value === 0));
                }
            }
        }
    });
});

test('native recording uses the rendered playback buffer and forwards timing, even after an early overload stop', async () => {
    const original = audioUtils.nativeMeasurement;
    const rendered = { numberOfChannels: 4 };
    const recording = Float32Array.of(.1, .2);
    const stopWhen = Object.assign(() => false, { overload: { peak: .999, tailSeconds: .1 } });
    audioUtils.nativeMeasurement = {
        session: { outputChannels: 4 },
        record: async (buffer, gain, overload, signal, onStart) => {
            assert.equal(buffer, rendered);
            assert.equal(gain, .25);
            assert.equal(overload, stopWhen.overload);
            assert.equal(signal.aborted, false);
            assert.equal(onStart, undefined);
            return { recording, sampleRate: 48000, playbackStartFrame: null, captureStartFrame: null, overloadStopped: true };
        }
    };
    const controller = { ...AudioProcessing };
    try {
        const result = await controller.recordPlayback({ outputChannel: '2', stopWhen,
            createPlayback: (_context, channels) => {
                assert.equal(channels, 4);
                return { buffer: rendered, gain: .25 };
            },
            finish: (samples, timing) => {
                assert.equal(samples, recording);
                assert.equal(timing.outputRoute.mode, 'direct');
                assert.equal(timing.captureStartFrame, null);
                assert.equal(timing.scheduledPlaybackFrame, null);
                assert.equal(timing.hasOverload, true);
                return timing.sampleRate;
            } });
        assert.equal(result, 48000);
        assert.equal(stopWhen.overloadStopped, true);
        assert.equal(controller.nativeMeasurementAbort, null);
    } finally {
        audioUtils.nativeMeasurement = original;
    }
});

test('native Redo, Redo Channel and test signal reopen interrupted sessions on explicit retry',
    { timeout: 5000 }, async t => {
    const { port1: control, port2: sidecar } = new MessageChannel();
    const commands = [];
    let open = false;
    let lost = false;
    let nextFailure = 'deviceLost';
    let takeFailure;
    let inputPeak = 0;
    let onOpen;
    let refuseOpen = false;
    const sampleRate = 8000;
    const outputChannels = 3;
    sidecar.on('message', command => {
        commands.push(command);
        const state = (value, details) => sidecar.postMessage({ type: 'measurementState', state: value, ...details });
        const reject = reason => sidecar.postMessage({ type: 'commandRejected', command: command.type, reason });
        switch (command.type) {
            case 'openMeasurement':
                onOpen?.();
                if (open) reject('busy');
                else if (refuseOpen) state('failed', { reason: 'unavailable' });
                else { open = true; lost = false; state('open', { sampleRate, outputChannels }); }
                break;
            case 'closeMeasurement': open = false; state('closed'); break;
            case 'measurementBegin':
                if (lost) reject('invalid');
                else state('ready');
                break;
            case 'measurementChunk': break;
            case 'measurementStart':
                takeFailure = nextFailure;
                lost = takeFailure === 'deviceLost';
                nextFailure = null;
                state('running');
                break;
            case 'measurementStatus':
                sidecar.postMessage({ type: 'measurementStatus', status: lost || takeFailure ? 'failed' : 'complete',
                    reason: lost ? 'deviceLost' : takeFailure, inputPeak });
                break;
            case 'measurementRead':
                sidecar.postMessage({ type: 'measurementData', offset: command.offset, frames: command.frames,
                    attachment: new Float32Array(command.frames).buffer });
                break;
            case 'measurementCancel': takeFailure = null; state('open'); break;
            default: assert.fail(`Unexpected measurement command ${command.type}`);
        }
    });
    const native = new NativeMeasurement('wasapi', {}, async () => ({ ports: [control] }));
    const audioStateKeys = ['initialized', 'audioContext', 'nativeMeasurement', 'devices', 'microphone', 'microphoneRequest',
        'selectedInputChannel', 'currentInputLevel', 'sweepMinFreq', 'sweepMaxFreq', 'whiteNoiseOperationToken',
        'isWhiteNoisePending', 'isWhiteNoiseActive', 'whiteNoiseDesiredActive', 'whiteNoiseRouteOperation',
        'nativeNoiseChannels', 'whiteNoiseChannel', 'nativeLevelPending'];
    const previous = Object.fromEntries(audioStateKeys.map(key => [key, audioUtils[key]]));
    Object.assign(audioUtils, {
        initialized: true, nativeMeasurement: native, microphone: null, microphoneRequest: null,
        devices: { inputs: [{ id: 'mic', channels: 2 }], outputs: [{ id: 'speakers', channels: 8 }] },
        audioContext: { state: 'running', sampleRate, async suspend() {}, createBuffer(count, length) {
            const channels = Array.from({ length: count }, () => new Float32Array(length));
            return { numberOfChannels: count, length, sampleRate, getChannelData: index => channels[index] };
        } }
    });
    const controller = new MeasurementController();
    controller.measurementConfig = {
        sampleRate, audioInputId: 'mic', inputChannel: 'right', audioOutputId: 'speakers', outputChannel: 'multi',
        outputChannels: ['left', '2'], outputChannelCount: outputChannels, sweepLength: 1024, averaging: 1
    };
    controller.currentMeasurement = {
        acquisitionMethod: 'ess', sweepLength: 1024, sweepBand: { mode: 'off' }, points: []
    };
    t.mock.method(controller, 'startChannelLevelGraph', () => {});
    t.mock.method(controller, 'processRecordedBuffer', async () => ({ frequencyResponse: [[100, 0]] }));
    t.mock.method(controller, 'updateFrequencyResponseGraph', () => {});
    const showNotification = t.mock.method(uiManager, 'showNotification', () => {});
    const canvas = { getContext: () => ({ clearRect() {} }) };
    const redo = { style: {} };
    const save = { style: {} };
    const elements = { levelGraph: canvas, frequencyResponseGraph: canvas, noiseLevel: { value: '-12' }, redoBtn: redo,
        saveAndFinishBtn: save, noiseChannelMode: { querySelector: () => ({ value: 'manual' }) } };
    const deviceCommands = () => commands.filter(command => ['openMeasurement', 'closeMeasurement'].includes(command.type));
    try {
        await withGlobals({ document: { getElementById: id => elements[id] ?? null } }, async () => {
            await controller.redoMeasurement();
            assert.equal(native.session, null);
            assert.deepEqual(deviceCommands().map(command => command.type), ['openMeasurement', 'closeMeasurement']);
            assert.equal(redo.style.display, 'inline-block');
            assert.equal(save.style.display, 'none');
            assert.equal(controller.currentPoint, null);

            refuseOpen = true;
            await controller.redoMeasurement();
            assert.equal(redo.style.display, 'inline-block');
            assert.equal(commands.filter(command => command.type === 'measurementStart').length, 1);

            refuseOpen = false;
            await controller.redoMeasurement();
            assert.equal(save.style.display, 'inline-block');
            const point = controller.currentPoint;
            assert.deepEqual(point.channels.map(entry => [entry.channel, entry.frequencyResponse]), [
                ['left', [[100, 0]]], ['2', [[100, 0]]]
            ]);

            nextFailure = 'interrupted';
            const session = native.session;
            assert.equal(await controller.redoChannel('2'), false);
            assert.equal(native.session, session);
            assert.equal(controller.currentPoint, point);
            assert.equal(await controller.redoChannel('2'), true);
            assert.equal(native.session, session);
            const redonePoint = controller.currentPoint;

            nextFailure = 'deviceLost';
            assert.equal(await controller.redoChannel('2'), false);
            assert.equal(native.session, null);
            assert.equal(controller.currentPoint, redonePoint);
            assert.equal(await controller.redoChannel('2'), true);
            assert.equal(controller.currentPoint.channels[0], point.channels[0]);

            lost = true;
            controller.currentNoiseChannel = '2';
            assert.equal(await controller.toggleWhiteNoise(), false);
            assert.equal(native.session, null);
            assert.equal(await controller.toggleWhiteNoise(), true);
            assert.deepEqual(audioUtils.nativeNoiseChannels.map(channel => channel?.some(value => value !== 0) ?? false),
                [false, false, true]);
            takeFailure = 'interrupted';
            for (const peak of [0.5, 0.25]) {
                inputPeak = peak;
                await audioUtils.refreshNativeInputLevel();
                assert.equal(audioUtils.getInputLevel(), 20 * Math.log10(peak));
            }
            assert.equal(showNotification.mock.callCount(), 5);
            assert.deepEqual(deviceCommands().map(command => command.type), [
                'openMeasurement', 'closeMeasurement', 'openMeasurement', 'openMeasurement', 'closeMeasurement',
                'openMeasurement', 'closeMeasurement', 'openMeasurement'
            ]);
            for (const command of deviceCommands().filter(command => command.type === 'openMeasurement')) {
                assert.deepEqual(command, { type: 'openMeasurement', sampleRate, outputChannels,
                    inputDeviceId: 'mic', outputDeviceId: 'speakers', inputChannelIndices: [1] });
            }
            await audioUtils.stopWhiteNoise();
            lost = true;
            await native.status();
            await native.queue;
            assert.equal(native.session, null);

            onOpen = () => controller.cancelMeasurement();
            const starts = commands.filter(command => command.type === 'measurementStart').length;
            await controller.redoMeasurement();
            await native.queue;
            assert.equal(native.session, null);
            assert.equal(commands.filter(command => command.type === 'measurementStart').length, starts);
            assert.equal(showNotification.mock.callCount(), 5);
            const deviceOperations = deviceCommands().length;
            await assert.rejects(controller.recordChannelSweep('left', outputChannels), { name: 'SweepCancelledError' });
            assert.equal(deviceCommands().length, deviceOperations);
        });
    } finally {
        await audioUtils.stopWhiteNoise();
        await audioUtils.stopMicrophoneInput();
        native.client?.close();
        sidecar.close();
        Object.assign(audioUtils, previous);
    }
});
