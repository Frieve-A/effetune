import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { AudioManager } from '../../js/audio-manager.js';
import { VISUAL_SYNC_RULES } from '../../js/audio/visual-sync.js';
import { TelemetryHub, TELEMETRY_HEADER_BYTES } from '../../js/audio/telemetry-hub.js';

function harness() {
    let now = 1000;
    let clockOffset = 0;
    let timer = null;
    const port = { postMessage() {} };
    const node = { port };
    const context = { sampleRate: 48000, currentTime: 1,
        getOutputTimestamp: () => ({ contextTime: 1, performanceTime: 1000 + clockOffset }) };
    const manager = Object.assign(Object.create(AudioManager.prototype), {
        contextManager: { audioContext: context }, visualSyncEnabled: true,
        visualSyncDelayFrames: 10000, _appliedOutputDelayFrames: new Map([[node, 10000]]),
        _getPrimaryWorkletNode: () => node,
        _visualSyncNow: () => 1000 + now - context.getOutputTimestamp().performanceTime
    });
    const hub = new TelemetryHub({ port, now: () => manager._visualSyncNow(),
        schedule: (callback, delay) => { timer = { callback, at: now + delay }; return 1; },
        cancel: () => { timer = null; } });
    manager.telemetryHub = hub;
    class PluginBase {
        constructor() { this.enabled = true; this._sectionEnabled = true; }
        registerProcessor() {}
        updateParameters() {}
    }
    const sandbox = vm.createContext({ window: { dspTelemetryHub: hub }, PluginBase,
        performance: { now: () => now }, console });
    for (const file of ['multires-spectrum.js', 'analyzer/note_spectrogram.js',
        'analyzer/spectrogram.js', 'analyzer/spectrum_analyzer.js', 'analyzer/chroma_spiral.js']) {
        vm.runInContext(fs.readFileSync(new URL('../../plugins/' + file, import.meta.url), 'utf8'), sandbox);
    }
    const note = new sandbox.window.NoteSpectrogramPlugin();
    const spectrogram = new sandbox.window.SpectrogramPlugin();
    const spectrum = new sandbox.window.SpectrumAnalyzerPlugin();
    spectrum.pt = 10;
    spectrum.sc = 'log-hq';
    manager.pipeline = [note, spectrogram, spectrum];
    manager.dspLatencyTaps = {};
    for (const [index, plugin] of manager.pipeline.entries()) {
        plugin.id = index + 7;
        plugin.ensureDspTelemetrySubscription();
        manager.dspLatencyTaps[plugin.id] = { input: 0, output: 0, execution: 'wasm', instanceId: index + 100 };
    }
    hub.setSources(manager.dspLatencyTaps);
    hub.setVisualSyncResolver((...args) => manager._resolveVisualSyncDue(...args));
    const send = (frames, endFrame = 51000, contextFrameOffset = 0) => {
        const packet = new ArrayBuffer(frames.reduce((sum, frame) => sum + TELEMETRY_HEADER_BYTES + frame.payload.byteLength, 0));
        const header = new DataView(packet);
        let offset = 0;
        for (const frame of frames) {
            header.setUint16(offset, frame.frameType, true);
            header.setUint16(offset + 2, frame.formatVersion, true);
            header.setUint32(offset + 4, frame.tapId, true);
            header.setUint16(offset + 12, frame.payload.byteLength, true);
            new Uint8Array(packet, offset + TELEMETRY_HEADER_BYTES, frame.payload.byteLength)
                .set(new Uint8Array(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength));
            offset += TELEMETRY_HEADER_BYTES + frame.payload.byteLength;
        }
        hub.handleMessage({ type: 'dspTelemetry', packet, bytes: packet.byteLength, endFrame, contextFrameOffset });
    };
    return { hub, manager, note, spectrogram, spectrum, sandbox, send,
        setTime: value => { now = value; }, setClockOffset: value => { clockOffset = value; },
        flush: () => {
            let count = 0;
            while (timer && count++ < 20) {
                const next = timer;
                timer = null;
                now = next.at;
                next.callback();
            }
            assert.equal(timer, null, 'The finite batch must drain');
        }, now: () => now };
}

function noteFrame(index, time, generation = 1) {
    const payload = new DataView(new ArrayBuffer(3548));
    payload.setFloat32(0, 48000, true);
    payload.setFloat32(4, time, true);
    payload.setUint16(8, 440, true);
    payload.setUint16(10, 21, true);
    payload.setFloat32(12, 0.02, true);
    payload.setUint32(16, index, true);
    payload.setUint32(20, 5, true);
    payload.setUint32(24, generation, true);
    for (let pitch = 0; pitch < 440; pitch++) {
        payload.setFloat32(28 + pitch * 4, 0.75, true);
        payload.setFloat32(1788 + pitch * 4, -12, true);
    }
    return { tapId: 7, frameType: 24, formatVersion: 3, payload };
}

function spectrogramFrame(time) {
    const payload = new DataView(new ArrayBuffer(268));
    payload.setFloat32(0, 48000, true);
    payload.setFloat32(4, time, true);
    payload.setUint16(8, 256, true);
    payload.setUint16(10, 12, true);
    new Uint8Array(payload.buffer, 12).fill(192);
    return { tapId: 8, frameType: 5, formatVersion: 1, payload };
}

function hqFrame(sandbox, { rate = 48000, points = 10 } = {}) {
    const analyzer = new sandbox.MultiresSpectrum(rate, 4);
    const blocks = Math.ceil((5 * (1 << points) + rate / 30 + 128) / 128);
    for (let block = 0; block < blocks; block++) {
        const frame = analyzer.process(new Float32Array(128),
            { pt: points, hq: true, dr: -96, blockSize: 128, channelCount: 1 });
        if (frame) return { ...frame, tapId: 9, endFrame: (block + 1) * 128 };
    }
    assert.fail('HQ analysis did not complete');
}

test('Visual Sync preserves both histories with different analysis periods through output-clock changes', () => {
    const h = harness();
    h.send([noteFrame(0, 1), spectrogramFrame(1)]);
    h.setTime(1020);
    h.setClockOffset(25);
    h.send([noteFrame(1, 1.02)]);
    h.setTime(1040);
    h.setClockOffset(-5);
    h.send([noteFrame(2, 1.04), spectrogramFrame(1 + 2048 / 48000)]);
    h.flush();
    assert.equal(h.note.lastFrameIndex, 2);
    assert.equal(h.note.history.subarray(0, h.note.writeColumn * 440).every(value => value === 0.75), true);
    assert.equal(h.spectrogram.spectrogramColumnCount, 2);
    assert.deepEqual(Array.from(h.spectrogram.spectrogramIntensityBuffer.subarray(0, 2)), [192, 192]);
});

test('Visual Sync preserves capture spacing inside a batched packet and after a worklet time reset', () => {
    for (const offset of [0, 48000]) {
        const h = harness();
        const deliveries = [];
        h.hub.subscribe(7, 24, () => deliveries.push(h.now()));
        h.send([noteFrame(0, 1 - offset / 48000), noteFrame(1, 1.02 - offset / 48000)], 51000, offset);
        h.flush();
        assert.equal(deliveries.length, 2);
        assert.ok(Math.abs(deliveries[0] - (1000 + (10000 - 8192) / 48)) < 0.001);
        assert.ok(Math.abs(deliveries[1] - deliveries[0] - 20) < 0.001);
    }
});

test('A to B to A accepts recreated Note and HQ Spectrum analyzers on the same worklet port', () => {
    const h = harness();
    const oldHq = hqFrame(h.sandbox);
    oldHq.payload.setUint32(12, 3, true);
    oldHq.payload.setUint32(24, 50, true);
    h.send([noteFrame(50, 1, 3), oldHq]);
    h.flush();
    assert.equal(h.note.lastFrameIndex, 50);
    assert.equal(h.spectrum.hqFrameIndex, 50);
    // Leave an old A frame waiting when B replaces the pipeline.
    h.send([noteFrame(51, 2, 3)], 96000);
    h.hub.setSources({ 20: { instanceId: 200 } });
    h.hub.setSources({ 7: { instanceId: 300 }, 8: { instanceId: 301 }, 9: { instanceId: 302 } });
    assert.equal(h.hub.visualSyncQueue.length, 0);
    h.send([noteFrame(0, 1.5), hqFrame(h.sandbox)], 73000);
    h.flush();
    assert.equal(h.note.activeGeneration, 1);
    assert.equal(h.note.lastFrameIndex, 0);
    assert.equal(h.spectrum.hqGeneration, 1);
    assert.equal(h.spectrum.hqFrameIndex, 0);
    // Repeated latency reports retain the current analysis identity.
    const source = h.hub.sources.get(7);
    h.hub.setSources({ 7: { instanceId: 300 }, 8: { instanceId: 301 }, 9: { instanceId: 302 } });
    assert.equal(h.hub.sources.get(7), source);
    h.send([noteFrame(1, 1.52)], 74000);
    h.flush();
    assert.equal(h.note.lastFrameIndex, 1);
});

test('Visualizer analysis uses the shared output delay and its pre-delay tap', () => {
    const h = harness();
    const pipelineDue = h.manager._resolveVisualSyncDue(7, 51000, 7,
        noteFrame(0, 1), 0);
    const source = { tapId: 0xf0000000, type: 'NoteSpectrogramPlugin',
        params: { mn: 28, mx: 91, nc: 8 } };
    h.manager.visualizerSources = [source];
    h.manager.visualizerSourcesByTap = new Map([[source.tapId, source]]);
    assert.equal(h.manager.getDspTelemetryRate({ hidden: true, displayDspBypassed: true }), 60);
    const due = h.manager._resolveVisualSyncDue(source.tapId, 51000, source.tapId,
        { ...noteFrame(0, 1), tapId: source.tapId }, 0);
    assert.ok(Number.isFinite(due));
    assert.equal(h.manager._resolveVisualSyncDue(7, 51000, 7,
        noteFrame(0, 1), 0), pipelineDue);
    h.manager.pipeline = [];
    const delay = h.manager._recomputeVisualSyncDelay();
    assert.ok(delay > 0);
});

test('Visualizer Phase Map source syncs its input-window rule at the final output tap', () => {
    const h = harness();
    const source = { tapId: 0xf0000001, type: 'PhaseSelectEqPlugin', params: {} };
    h.manager.visualizerSources = [source];
    h.manager.visualizerSourcesByTap = new Map([[source.tapId, source]]);
    h.manager.pipeline = [];
    const generation = VISUAL_SYNC_RULES.PhaseSelectEqPlugin.generationFrames({}, 48000, 'wasm');
    const delay = h.manager._recomputeVisualSyncDelay();
    assert.equal(delay, generation);
    h.manager._appliedOutputDelayFrames.set(h.manager._getPrimaryWorkletNode(), delay);
    const due = h.manager._resolveVisualSyncDue(source.tapId, 51000, source.tapId,
        { tapId: source.tapId, frameType: 20 }, 0);
    assert.equal(due, 51000 / 48);
});

test('Spectrum Overlay uses the same HQ analysis age for output delay and frame delivery', () => {
    const oldWindow = globalThis.window;
    globalThis.window = { SpectrumOverlay: { quality: 'hq', TARGETS: new Set(['VolumePlugin']) } };
    try {
        const h = harness();
        const plugin = { id: 22, enabled: true, getParameters: () => ({}) };
        Object.defineProperty(plugin, 'constructor', { value: { name: 'VolumePlugin' } });
        h.manager.pipeline = [plugin];
        h.manager.dspLatencyTaps = { 22: { input: 0, output: 0, execution: 'js' } };
        const generation = VISUAL_SYNC_RULES.spectrumOverlay.generationFrames(
            { quality: 'hq' }, 48000, 'js');
        assert.ok(generation > 2048);
        const delay = h.manager._recomputeVisualSyncDelay();
        assert.equal(delay, Math.ceil(generation));
        h.manager.visualSyncDelayFrames = delay;
        h.manager._appliedOutputDelayFrames.set(h.manager._getPrimaryWorkletNode(), delay);
        const due = h.manager._resolveVisualSyncDue(22, 51000, 'spectrumOverlay');
        assert.ok(Math.abs(due - 51000 / 48) < 1 / 48);

        globalThis.window.SpectrumOverlay.quality = 'standard';
        const standardDelay = h.manager._recomputeVisualSyncDelay();
        assert.equal(standardDelay, 2048);
        h.manager.visualSyncDelayFrames = standardDelay;
        h.manager._appliedOutputDelayFrames.set(h.manager._getPrimaryWorkletNode(), standardDelay);
        assert.equal(h.manager._resolveVisualSyncDue(22, 51000, 'spectrumOverlay'), 51000 / 48);
    } finally {
        globalThis.window = oldWindow;
    }
});

test('Visualizer source transport preserves HQ and applies gain only to its hidden tap', () => {
    const messages = [];
    const node = { port: { postMessage: message => messages.push(message) } };
    const manager = Object.assign(Object.create(AudioManager.prototype), {
        _getPrimaryWorkletNode: () => node,
        updateDspTelemetryRate() {},
        _scheduleVisualSyncUpdate() {}
    });
    manager.setVisualizerSources([{ tapId: 0xf0000000, type: 'SpectrumAnalyzerPlugin',
        params: { pt: 12, sc: 'log-hq', dr: -96 }, channel: 'L', gainDb: 6 }]);
    const source = manager.visualizerSources[0];
    assert.equal(source.params.hq, true);
    assert.equal(source.packed[2], 1);
    assert.equal(source.gain, 10 ** (6 / 20));
    const message = messages.find(entry => entry.type === 'setVisualizerSources');
    assert.equal(message.sources[0].gain, source.gain);
    assert.equal(message.sources[0].params[2], 1);
});


test('Chroma and HQ Spectrum deliver the same capture at its due time and draw on the next animation frame', () => {
    for (const [rate, points, age] of [[44100, 13, 20528], [96000, 14, 41008]]) {
        for (const execution of ['js', 'wasm']) {
            const h = harness();
            h.setTime(0);
            h.manager.contextManager.audioContext.sampleRate = rate;
            const chroma = new h.sandbox.window.ChromaSpiralPlugin();
            chroma.id = 10;
            chroma.ensureDspTelemetrySubscription();
            h.spectrum.pt = points;
            h.manager.pipeline = [h.spectrum, chroma];
            h.manager.dspLatencyTaps = {
                9: { input: 0, output: 128, execution, instanceId: 109 },
                10: { input: 0, output: 128, execution, instanceId: 110 }
            };
            h.hub.setSources(h.manager.dspLatencyTaps);
            h.manager.visualSyncDelayFrames = age;
            h.manager._appliedOutputDelayFrames.set(h.manager._getPrimaryWorkletNode(), age);
            assert.equal(h.manager._visualSyncGeneration(chroma, 'ChromaSpiralPlugin'), age);
            assert.equal(h.manager._visualSyncGeneration(h.spectrum, 'SpectrumAnalyzerPlugin'), age);
            const frame = hqFrame(h.sandbox, { rate, points });
            const expectedDue = (frame.endFrame + 128) / rate * 1000;
            for (const id of [9, 10]) {
                assert.equal(h.manager._resolveVisualSyncDue(id, frame.endFrame, id, frame, 0), expectedDue);
            }
            const draws = [[], []];
            const animations = [];
            for (const [index, plugin] of [h.spectrum, chroma].entries()) {
                plugin.isVisible = true;
                plugin.drawGraph = () => draws[index].push({ time: h.now(),
                    frame: index === 0 ? h.spectrum.hqFrameIndex : chroma.snapshot?.frameIndex ?? -1 });
                plugin.requestPowerAnimationFrame = (callback, kind) => {
                    assert.equal(kind, 'analyzer');
                    animations[index] = callback;
                    return index + 1;
                };
                plugin.startAnimation();
            }
            const deliveries = [];
            h.hub.subscribe(9, 4, () => deliveries.push(h.now()));
            h.hub.subscribe(10, 4, () => deliveries.push(h.now()));
            h.send([frame, { ...frame, tapId: 10 }], frame.endFrame, 0);
            h.setTime(expectedDue - 0.1);
            for (const animate of animations) animate(h.now());
            assert.equal(chroma.snapshot, null);
            assert.equal(h.spectrum.hqFrameIndex, -1);
            assert.equal(deliveries.length, 0);
            h.flush();
            assert.deepEqual(deliveries, [expectedDue, expectedDue]);
            assert.equal(chroma.snapshot.frameIndex, h.spectrum.hqFrameIndex);
            h.setTime(expectedDue + 16);
            for (const animate of animations) animate(h.now());
            assert.deepEqual(draws[0], draws[1]);
            assert.equal(draws[0].at(-1).frame, frame.payload.getUint32(24, true));
            assert.equal(h.hub.getStats().subscriberErrors, 0);
        }
    }
});
