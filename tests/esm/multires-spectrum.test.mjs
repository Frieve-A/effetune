import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import '../../plugins/multires-spectrum.js';
import { TelemetryHub } from '../../js/audio/telemetry-hub.js';

const Analyzer = globalThis.MultiresSpectrum;

function render(type, { points = 10, rate = 48000, blocks = [128], length = 32000,
    signal = sample => Math.sin(2 * Math.PI * 375 * sample / rate) } = {}) {
    const analyzer = new Analyzer(rate, type);
    const frames = [];
    const start = analyzer.startJob;
    analyzer.startJob = function () {
        assert.equal(this.job, false, 'each job completes before its next nominal hop');
        return start.call(this);
    };
    let origin = 0;
    let blockIndex = 0;
    while (origin < length) {
        const size = Math.min(blocks[blockIndex++ % blocks.length], length - origin);
        const input = Float32Array.from({ length: size }, (_, i) => signal(origin + i));
        const original = input.slice();
        const frame = analyzer.process(input, { pt: points, dr: -96, hq: true, blockSize: size, channelCount: 1 });
        assert.deepEqual(input, original, 'analysis is audio pass-through');
        if (frame) {
            const snapshot = Analyzer.decode(frame, type);
            assert.ok(snapshot);
            frames.push(snapshot);
            analyzer.release(frame);
        }
        origin += size;
    }
    return { analyzer, frames };
}

test('HQ capture and levels are sample-driven for uniform and irregular callbacks', () => {
    for (const type of [4, 5]) {
        const uniform = render(type);
        const irregular = render(type, { blocks: [17, 63, 191, 2, 128, 47] });
        assert.ok(uniform.frames.length > 8);
        assert.deepEqual(irregular.frames, uniform.frames);
        for (const frame of uniform.frames) {
            assert.ok(frame.captureEndSample >= 4 * 1024 + 48);
            assert.equal(frame.captureEndSample % 4, 0);
            assert.equal(frame.hopSamples, type === 4 ? 1600 : 512);
            if (type === 4) {
                assert.ok(Math.max(...frame.current) > -0.3);
                assert.ok(frame.current.subarray(frame.validCellCount).every(x => x === -240));
            } else {
                assert.ok(frame.intensities.subarray(0, frame.firstValidIndex).every(x => x === 0));
            }
        }
    }
});

test('HQ resolves low close tones and rejects full-scale energy in the decimator alias bands', () => {
    const { frames } = render(4, { points: 12, length: 52000,
        signal: sample => 0.5 * (Math.sin(2 * Math.PI * 93.75 * sample / 48000) +
            Math.sin(2 * Math.PI * 105.46875 * sample / 48000)) });
    const values = frames.at(-1).current;
    const at = frequency => values[Math.round(Math.log(frequency / 20) / Math.log(2000) * 2047)];
    assert.ok(at(93.75) > -6.7);
    assert.ok(at(105.46875) > -6.7);
    // The two tones fit inside one short-window bin; its Hann lobes overlap.
    // Require a clear valley relative to both peaks after the final grid interpolation.
    assert.ok(at(99.609375) < Math.min(at(93.75), at(105.46875)) - 12);
    const alias = render(4, { points: 12, length: 52000,
        signal: sample => Math.sin(2 * Math.PI * 12093.75 * sample / 48000) }).frames.at(-1);
    const lowEnd = Math.floor(Math.log(375 / 20) / Math.log(2000) * 2047);
    assert.ok(Math.max(...alias.current.subarray(0, lowEnd)) < -144);
});

test('HQ short and long windows describe the same instant', () => {
    // A burst with one tone in each band peaks in the frame whose shared window centre is nearest it.
    const burst = sample => sample >= 20000 && sample < 20256
        ? Math.sin(2 * Math.PI * 93.75 * sample / 48000) + Math.sin(2 * Math.PI * 6000 * sample / 48000) : 0;
    const { frames } = render(5, { points: 10, length: 36000, signal: burst });
    // Spectrogram cells run from high to low frequency.
    const cell = frequency => 255 - Math.round(Math.log(frequency / 20) / Math.log(2000) * 255);
    const loudest = frequency => frames.reduce((best, frame, index) =>
        frame.intensities[cell(frequency)] > frames[best].intensities[cell(frequency)] ? index : best, 0);
    assert.ok(frames[loudest(6000)].intensities[cell(6000)] > 0);
    assert.equal(loudest(6000), loudest(93.75));
});

test('HQ keeps completed frame ownership finite and warms anew on Points or mode changes', () => {
    const analyzer = new Analyzer(48000, 4);
    const input = new Float32Array(128);
    const params = { pt: 8, dr: -96, hq: true, blockSize: 128, channelCount: 1 };
    const held = [];
    for (let i = 0; i < 100; i++) {
        const frame = analyzer.process(input, params);
        if (frame) held.push({ frame, bytes: new Uint8Array(frame.payload.buffer).slice() });
    }
    assert.equal(held.length, 3);
    for (const { frame, bytes } of held) {
        assert.deepEqual(new Uint8Array(frame.payload.buffer), bytes);
        analyzer.release(frame);
    }
    const generation = analyzer.generation;
    params.pt = 14;
    assert.equal(analyzer.process(input, params), null);
    assert.equal(analyzer.generation, generation + 1);
    assert.equal(analyzer.longCount, 8);
    params.hq = false;
    assert.equal(analyzer.process(input, params), null);
    assert.equal(analyzer.inputCount, 0);
    params.hq = true;
    assert.equal(analyzer.process(input, params), null);
    assert.equal(analyzer.longCount, 8);
});

test('all Points and high rates finish jobs with preallocated storage through mode switches', () => {
    const sandbox = vm.createContext({});
    vm.runInContext(fs.readFileSync(new URL('../../plugins/multires-spectrum.js', import.meta.url), 'utf8'), sandbox);
    vm.runInContext(`
        const analyzers = [new MultiresSpectrum(192000, 4), new MultiresSpectrum(192000, 5)];
        const input = new Float32Array(127);
        const parameters = { pt: 8, hq: true, dr: -96, blockSize: 127, channelCount: 1 };
        for (const name of ['Float32Array', 'Float64Array', 'Uint8Array', 'Uint16Array', 'ArrayBuffer', 'DataView']) {
            globalThis[name] = function () { throw new Error('processing allocation: ' + name); };
        }
        for (const analyzer of analyzers) {
            for (const points of [8, 12, 14, 8]) {
                parameters.pt = points;
                parameters.hq = true;
                for (let sample = 0; sample < 6 * (1 << points) + 20000; sample += 127) {
                    const frame = analyzer.process(input, parameters);
                    analyzer.release(frame);
                    if (analyzer.job && analyzer.inputCount >= analyzer.nextJob) throw new Error('missed job deadline');
                }
                parameters.hq = false;
                const frame = analyzer.captureLegacy(input, parameters, 0);
                analyzer.release(frame);
            }
        }
    `, sandbox);
});

function loadPlugin(type, hub = null) {
    const window = { dspTelemetryHub: hub };
    class PluginBase {
        constructor() { this.enabled = true; this._sectionEnabled = true; }
        registerProcessor() {}
        updateParameters() {}
    }
    const sandbox = vm.createContext({ window, PluginBase, performance, console });
    vm.runInContext(fs.readFileSync(new URL('../../plugins/multires-spectrum.js', import.meta.url), 'utf8'), sandbox);
    const file = type === 4 ? 'spectrum_analyzer' : 'spectrogram';
    vm.runInContext(fs.readFileSync(new URL(`../../plugins/analyzer/${file}.js`, import.meta.url), 'utf8'), sandbox);
    return new window[type === 4 ? 'SpectrumAnalyzerPlugin' : 'SpectrogramPlugin']();
}

test('HQ UI restores scale precedence, rejects stale frames and uses the log grid', () => {
    for (const type of [4, 5]) {
        const plugin = loadPlugin(type);
        plugin.setParameters({ pt: 10, sc: 'linear', hq: true });
        assert.equal(plugin.getParameters().hq, false);
        plugin.setParameters({ hq: false });
        assert.equal(plugin.sc, 'linear');
        plugin.setParameters({ hq: true });
        assert.equal(plugin.sc, 'log-hq');
        const analyzer = new Analyzer(48000, type);
        const input = new Float32Array(128);
        let frame;
        for (let i = 0; i < 100 && !frame; i++) {
            frame = analyzer.process(input, { pt: 10, hq: true, dr: -96, blockSize: 128, channelCount: 1 });
        }
        const handle = type === 4 ? 'handleDspSpectrumTelemetry' : 'handleDspSpectrogramTelemetry';
        plugin[handle](frame);
        assert.equal(plugin.hqFrameIndex, 0);
        if (type === 4) {
            assert.equal(plugin.spectrum.length, 2048);
            assert.ok(plugin.collectSpectrumLevels(1024, 0).at(-1)[0] < 1000);
        } else {
            assert.equal(plugin.displayRowToCanonicalRow(123), 123);
            assert.equal(plugin.spectrogramColumnCount, 1);
            plugin[handle](frame);
            assert.equal(plugin.spectrogramColumnCount, 1);
        }
        plugin.setFrequencyScale('log');
        plugin.setFrequencyScale('log-hq');
        plugin[handle](frame);
        assert.equal(plugin.hqFrameIndex, -1);
        plugin.setParameters({ sc: 'log', hq: true });
        assert.equal(plugin.getParameters().hq, false);
    }
});

function nextFrame(analyzer, points = 10) {
    const input = new Float32Array(128);
    for (let i = 0; i < 200; i++) {
        const frame = analyzer.process(input, { pt: points, hq: true, dr: -96, blockSize: 128, channelCount: 1 });
        if (!frame) continue;
        const copy = { frameType: frame.frameType, formatVersion: 2,
            payload: new DataView(frame.payload.buffer.slice(0)) };
        analyzer.release(frame);
        return copy;
    }
    assert.fail('HQ producer did not complete a frame');
}

test('HQ resumes after paused scale changes using the actual producer watermark', () => {
    for (const type of [4, 5]) {
        const plugin = loadPlugin(type);
        plugin.setParameters({ pt: 10, sc: 'log-hq' });
        const handle = type === 4 ? 'handleDspSpectrumTelemetry' : 'handleDspSpectrogramTelemetry';
        const analyzer = new Analyzer(48000, type);
        const first = nextFrame(analyzer);
        plugin[handle](first);
        assert.equal(plugin.hqGeneration, 1);

        // Neither intermediate scale reaches a callback while audio is paused.
        plugin.setFrequencyScale('log');
        plugin.setFrequencyScale('log-hq');
        plugin[handle](first);
        assert.equal(plugin.hqFrameIndex, -1, 'the pre-switch duplicate stays rejected');
        const resumed = nextFrame(analyzer);
        plugin[handle](resumed);
        assert.equal(plugin.hqGeneration, 1);
        assert.equal(plugin.hqFrameIndex, 1, 'a new frame from the unchanged analysis is accepted');
        plugin[handle](first);
        assert.equal(plugin.hqFrameIndex, 1);

        // An actual non-HQ callback still resets analysis and requires full warmup.
        plugin.setFrequencyScale('linear');
        const input = new Float32Array(128);
        analyzer.release(analyzer.captureLegacy(input, { pt: 10, blockSize: 128, channelCount: 1 }, 0));
        plugin.setFrequencyScale('log-hq');
        assert.equal(analyzer.process(input, { pt: 10, hq: true, dr: -96, blockSize: 128, channelCount: 1 }), null);
        plugin[handle](nextFrame(analyzer));
        assert.equal(plugin.hqGeneration, 2);
        assert.equal(plugin.hqFrameIndex, 0);
        plugin[handle](resumed);
        assert.equal(plugin.hqGeneration, 2, 'an older analysis generation stays rejected');
        assert.equal(plugin.hqFrameIndex, 0);
    }
});

test('HQ subscription accepts a replacement producer and rejects late packets from the old port', () => {
    for (const type of [4, 5]) {
        const oldPort = { postMessage() {} };
        const newPort = { postMessage() {} };
        const hub = new TelemetryHub({ port: oldPort });
        const plugin = loadPlugin(type, hub);
        plugin.id = 7;
        plugin.setParameters({ pt: 10, sc: 'log-hq' });
        plugin.ensureDspTelemetrySubscription();
        const send = (frame, port) => {
            const packet = new ArrayBuffer(16 + frame.payload.byteLength);
            const header = new DataView(packet);
            header.setUint16(0, type, true);
            header.setUint16(2, 2, true);
            header.setUint32(4, plugin.id, true);
            header.setUint16(12, frame.payload.byteLength, true);
            new Uint8Array(packet, 16).set(new Uint8Array(frame.payload.buffer));
            hub.handleMessage({ type: 'dspTelemetry', packet, bytes: packet.byteLength }, port);
        };
        const oldAnalyzer = new Analyzer(48000, type);
        send(nextFrame(oldAnalyzer), oldPort);
        oldAnalyzer.configure(10, false);
        const oldFrame = nextFrame(oldAnalyzer);
        send(oldFrame, oldPort);
        assert.equal(plugin.hqGeneration, 2);

        hub.setPort(newPort);
        const newFrame = nextFrame(new Analyzer(48000, type));
        send(newFrame, newPort);
        assert.equal(plugin.hqGeneration, 1, 'a new producer owns a fresh generation sequence');
        assert.equal(plugin.hqFrameIndex, 0);
        if (type === 5) assert.equal(plugin.spectrogramColumnCount, 1);
        send(nextFrame(oldAnalyzer), oldPort);
        assert.equal(plugin.hqGeneration, 1, 'the old producer cannot reclaim the display');
        send(newFrame, newPort);
        assert.equal(plugin.hqFrameIndex, 0);
        if (type === 5) assert.equal(plugin.spectrogramColumnCount, 1, 'duplicates do not append history');
        plugin.disposeDspTelemetrySubscription();
    }
});
