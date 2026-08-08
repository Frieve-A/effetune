import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'fm_radio_simulator');

const TAP_FM_RADIO_SIMULATOR = 16;
const TELEMETRY_VERSION = 1;
const TELEMETRY_BYTES = 216;
const SPECTRUM_BINS = 48;

function makeTelemetryPayload() {
    const payload = new DataView(new ArrayBuffer(TELEMETRY_BYTES));
    payload.setFloat32(0, 65, true);          // rfLevelDb (dBuV)
    payload.setFloat32(4, 38.2, true);        // cnrDb
    payload.setFloat32(8, 1, true);           // pilotLock
    payload.setFloat32(12, 0.75, true);       // blendRatio
    payload.setFloat32(16, -10.5, true);      // multipathDb
    payload.setUint32(20, 3, true);           // cumulative clickCount
    for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        payload.setFloat32(24 + 4 * bin, -80 + bin * 0.5, true);
    }
    return payload;
}

test('FM Radio Simulator freezes the parameter layout and representative parity matrix', async () => {
    const schemaPath = path.join(pluginRoot, 'params.json');
    const [schemaText, casesText] = await Promise.all([
        fs.readFile(schemaPath, 'utf8'),
        fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8')
    ]);
    const raw = JSON.parse(schemaText);
    const schema = validateParamSpec(raw, schemaPath);
    const cases = JSON.parse(casesText).cases;

    assert.equal(schema.type, 'FMRadioSimulatorPlugin');
    assert.equal(schema.floatCount, 12);
    assert.deepEqual(raw.fields.map(({ key }) => key),
        ['rd', 'em', 'pr', 'st', 'tn', 'bw', 'mp', 'dl', 'fd', 'sm', 'og', 'mx']);
    assert.deepEqual(raw.fields.find(field => field.key === 'em').values, ['50', '75']);
    assert.deepEqual(raw.fields.find(field => field.key === 'sm').values,
        ['Auto', 'Stereo', 'Mono']);
    assert.deepEqual(
        Object.fromEntries(['min', 'max'].map(key =>
            [key, raw.fields.find(field => field.key === 'tn')[key]])),
        { min: -200, max: 200 });

    // Content-based coverage checks (no fixed case count): all eight plan
    // rates, nonlinear excitation at maximum Processing, parameter-event and
    // tuning-drag sequences, and the channel-mode corners must stay present.
    assert.ok(cases.length >= 15, `expected a full case matrix, got ${cases.length}`);
    assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
    assert.ok(cases.every(item => item.params?.fr === true));
    const coveredRates = new Set(cases.map(item => item.sampleRate ?? 96000));
    for (const rate of [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000]) {
        assert.ok(coveredRates.has(rate), `missing parity case at ${rate} Hz`);
    }
    assert.ok(cases.some(item => item.stimulus === 'sin1k' && item.params.pr === 18));
    assert.ok(cases.some(item => item.stimulus === 'sq50' && item.params.pr === 18));
    assert.ok(cases.some(item =>
        (item.sampleRate === 352800 || item.sampleRate === 384000) &&
        item.params.pr === 18));
    assert.ok(cases.some(item => item.blockSize === 1));
    assert.ok(cases.some(item => item.channels === 4 && item.channelMode === 'all4'));
    assert.ok(cases.some(item => item.channels === 1 && item.channelMode === 'mono'));
    assert.ok(cases.some(item =>
        item.params.tn === 200 && item.params.bw === 240 && item.params.st === 0));
    assert.ok(cases.some(item =>
        item.events?.some(event => event.params.sm === 'Mono')));
    assert.ok(cases.some(item =>
        (item.events?.filter(event => event.params.tn !== undefined).length ?? 0) >= 4),
        'missing a continuous tuning-drag event case');
    assert.ok(cases.some(item => item.params.mx === 0 && item.stimulus === 'imp'));
    // The transmitter shutdown path must stay frozen: a steady off-air case and
    // a case that switches the carrier off mid-render and brings it back.
    assert.ok(cases.some(item => item.params.rd === false));
    assert.ok(cases.some(item =>
        item.events?.some(event => event.params.rd === false) &&
        item.events?.some(event => event.params.rd === true)));
});

test('FM Radio Simulator reference is deterministic tooling while normal fallback is transparent', async () => {
    const source = await fs.readFile(
        path.join(repoRoot, 'plugins', 'lofi', 'fm_radio_simulator.js'), 'utf8');
    class PluginBase {
        constructor() {
            this.enabled = true;
            this.id = 11;
        }
        registerProcessor(processor) { this.processorString = processor; }
        updateParameters() {}
        getSerializableParameters() { return this.getParameters(); }
        getWorkletPluginData(parameters) { return parameters; }
        // Mirror of plugins/plugin-base.js parseFiniteNumber.
        parseFiniteNumber(value, min, max, previous) {
            let numericValue;
            if (typeof value === 'number') {
                numericValue = value;
            } else if (typeof value === 'string') {
                const trimmedValue = value.trim();
                if (trimmedValue === '') {
                    return Number.isFinite(previous) ? previous : min;
                }
                numericValue = Number(trimmedValue);
            } else {
                return Number.isFinite(previous) ? previous : min;
            }
            if (!Number.isFinite(numericValue)) {
                return Number.isFinite(previous) ? previous : min;
            }
            if (numericValue < min) return min;
            if (numericValue > max) return max;
            return numericValue;
        }
    }
    const context = {
        PluginBase,
        performance: { now: () => 1000 },
        window: { dspTelemetryHub: null }
    };
    vm.runInNewContext(source, context);
    const plugin = new context.window.FMRadioSimulatorPlugin();
    const serializable = plugin.getSerializableParameters();
    const runtime = plugin.getWorkletPluginData(plugin.getParameters());
    const defaultKeys = ['em', 'pr', 'st', 'tn', 'bw', 'mp', 'dl', 'fd', 'sm', 'og', 'mx'];
    assert.deepEqual(Object.fromEntries(defaultKeys.map(key => [key, serializable[key]])), {
        em: '50', pr: 0, st: 35, tn: 0, bw: 230, mp: 0, dl: 5, fd: 0,
        sm: 'Auto', og: 0, mx: 100
    });
    assert.equal('fr' in serializable, false);
    assert.equal('fr' in runtime, false);
    plugin.setParameters({ tn: 250 });
    assert.equal(plugin.tn, 200);
    plugin.setParameters({ tn: -250 });
    assert.equal(plugin.tn, -200);
    plugin.setParameters({ sm: 'invalid' });
    assert.equal(plugin.sm, 'Auto');

    // Strict parameter validation: invalid types and non-boolean enabled
    // values must keep the previous state (table-driven).
    plugin.setParameters({ pr: 12, mx: 80 });
    assert.deepEqual({ pr: plugin.pr, mx: plugin.mx }, { pr: 12, mx: 80 });
    const invalidTable = [
        { input: { pr: Number.NaN }, key: 'pr', expected: 12 },
        { input: { pr: Number.POSITIVE_INFINITY }, key: 'pr', expected: 12 },
        { input: { pr: [3] }, key: 'pr', expected: 12 },
        { input: { pr: { value: 3 } }, key: 'pr', expected: 12 },
        { input: { pr: '3junk' }, key: 'pr', expected: 12 },
        { input: { pr: null }, key: 'pr', expected: 12 },
        { input: { pr: true }, key: 'pr', expected: 12 },
        { input: { mx: '0junk' }, key: 'mx', expected: 80 },
        { input: { mx: [] }, key: 'mx', expected: 80 },
        { input: { tn: 'Infinity' }, key: 'tn', expected: -200 },
        { input: { dl: {} }, key: 'dl', expected: 5 }
    ];
    for (const { input, key, expected } of invalidTable) {
        plugin.setParameters(input);
        assert.equal(plugin[key], expected,
            `${key} must survive ${JSON.stringify(input)}`);
    }
    plugin.setParameters({ pr: ' 4.5 ' });
    assert.equal(plugin.pr, 4.5);
    plugin.enabled = true;
    for (const enabled of ['false', 0, 1, 'true', null, [], {}]) {
        plugin.setParameters({ enabled });
        assert.equal(plugin.enabled, true,
            `non-boolean enabled ${JSON.stringify(enabled)} must be ignored`);
    }
    plugin.setParameters({ enabled: false });
    assert.equal(plugin.enabled, false);
    plugin.setParameters({ enabled: true });
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.getTemporalCapability(), 'must-process');
    plugin.setParameters({ mx: '0junk', enabled: 'false' });
    assert.equal(plugin.mx, 80);
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.getTemporalCapability(), 'must-process');
    plugin.setParameters({ pr: 0, mx: 100 });

    const parameters = {
        ...plugin.getParameters(),
        sampleRate: 48000,
        blockSize: 4,
        channelCount: 1
    };
    const audio = new Float32Array([0.25, -0.5, 0.75, -1]);
    const expected = [...audio];
    const processor = new Function('data', 'parameters', 'context', plugin.processorString);
    const result = processor(audio, parameters, {});
    assert.deepEqual([...result], expected);
    assert.deepEqual(result.measurements, { bypass: true });
});

test('FM Radio Simulator parses only finite telemetry v1 frames with the exact payload', async () => {
    const source = await fs.readFile(
        path.join(repoRoot, 'plugins', 'lofi', 'fm_radio_simulator.js'), 'utf8');
    class PluginBase {
        constructor() { this.enabled = true; this.id = 16; }
        registerProcessor() {}
    }
    const context = { PluginBase, performance: { now: () => 1000 }, window: {} };
    vm.runInNewContext(source, context);
    const plugin = new context.window.FMRadioSimulatorPlugin();

    const payload = makeTelemetryPayload();
    const parsed = plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: TELEMETRY_VERSION, payload
    });
    assert.ok(parsed);
    assert.deepEqual(
        {
            rfLevelDb: parsed.rfLevelDb,
            pilotLock: parsed.pilotLock,
            blendRatio: parsed.blendRatio,
            clickCount: parsed.clickCount
        },
        { rfLevelDb: 65, pilotLock: 1, blendRatio: 0.75, clickCount: 3 });
    assert.ok(Math.abs(parsed.cnrDb - 38.2) < 1e-4);
    assert.ok(Math.abs(parsed.multipathDb + 10.5) < 1e-4);
    assert.equal(parsed.spectrumDb.length, SPECTRUM_BINS);
    assert.equal(parsed.spectrumDb[0], -80);

    assert.equal(plugin.parseDspTelemetryFrame({
        frameType: 15, formatVersion: TELEMETRY_VERSION, payload
    }), null);
    assert.equal(plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: 2, payload
    }), null);
    assert.equal(plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: TELEMETRY_VERSION,
        payload: new DataView(new ArrayBuffer(TELEMETRY_BYTES - 4))
    }), null);
    assert.equal(plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: TELEMETRY_VERSION,
        payload: new DataView(new ArrayBuffer(TELEMETRY_BYTES + 4))
    }), null);

    for (const offset of [0, 4, 8, 12, 16]) {
        const invalid = new DataView(payload.buffer.slice(0));
        invalid.setFloat32(offset, Number.NaN, true);
        assert.equal(plugin.parseDspTelemetryFrame({
            frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: TELEMETRY_VERSION,
            payload: invalid
        }), null);
    }
    const invalidBin = new DataView(payload.buffer.slice(0));
    invalidBin.setFloat32(24 + 4 * 17, Number.POSITIVE_INFINITY, true);
    assert.equal(plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: TELEMETRY_VERSION,
        payload: invalidBin
    }), null);
    const outOfRange = new DataView(payload.buffer.slice(0));
    outOfRange.setFloat32(8, 1.5, true);
    assert.equal(plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR, formatVersion: TELEMETRY_VERSION,
        payload: outOfRange
    }), null);
});

test('FM Radio Simulator drives the HUD from subscribed telemetry', async () => {
    const source = await fs.readFile(
        path.join(repoRoot, 'plugins', 'lofi', 'fm_radio_simulator.js'), 'utf8');
    let subscription = null;
    class PluginBase {
        constructor() { this.enabled = true; this.id = 16; }
        registerProcessor() {}
        canRunAnimation() { return true; }
        cleanup() {}
    }
    const context = {
        PluginBase,
        performance: { now: () => 1000 },
        window: {
            dspTelemetryHub: {
                subscribe(tapId, frameType, callback) {
                    subscription = { tapId, frameType, callback };
                    return () => { subscription = null; };
                }
            }
        }
    };
    vm.runInNewContext(source, context);
    const plugin = new context.window.FMRadioSimulatorPlugin();
    plugin.hudStatusElement = { textContent: 'stale status' };
    plugin._updateHudStatus('disabled');
    assert.equal(plugin.hudStatusElement.textContent, '');
    assert.equal(plugin.ensureDspTelemetrySubscription(), true);
    assert.deepEqual(
        { tapId: subscription.tapId, frameType: subscription.frameType },
        { tapId: 16, frameType: TAP_FM_RADIO_SIMULATOR });

    subscription.callback({
        frameType: TAP_FM_RADIO_SIMULATOR,
        formatVersion: TELEMETRY_VERSION,
        payload: makeTelemetryPayload()
    });
    assert.ok(Math.abs(plugin.hudValues.rfLevelDb - 65) < 0.01);
    assert.ok(Math.abs(plugin.hudValues.blendRatio - 0.75) < 0.001);
    assert.equal(plugin.lastClickCount, 3);
    assert.equal(plugin.lastTelemetryAt, 1000);
    assert.equal(plugin.bypassSince, 0);

    const drawnText = [];
    const drawingContext = {
        clearRect() {}, fillRect() {}, strokeRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
        measureText: text => ({ width: text.length * 6 }),
        fillText(text) { drawnText.push(String(text)); }
    };
    plugin.hudCanvas = {
        width: 600,
        height: 120,
        clientWidth: 600,
        getContext: () => drawingContext
    };
    plugin.drawHud();
    const statusLine = drawnText.join(' ');
    assert.match(statusLine, /dBµV/);
    assert.match(statusLine, /CNR 38\.\d dB/);
    assert.match(statusLine, /ST 75%/);
    assert.match(statusLine, /MPath -10\.\d dB/);
    assert.match(statusLine, /Clicks/);
    // No standing WASM status while running normally.
    assert.doesNotMatch(statusLine, /WASM ACTIVE/);

    plugin.cleanup();
    assert.equal(subscription, null);
});

test('FM Radio Simulator narrow HUD keeps every status string inside a 320px canvas', async () => {
    const source = await fs.readFile(
        path.join(repoRoot, 'plugins', 'lofi', 'fm_radio_simulator.js'), 'utf8');
    class PluginBase {
        constructor() { this.enabled = true; this.id = 16; }
        registerProcessor() {}
        canRunAnimation() { return true; }
        cleanup() {}
    }
    const context = { PluginBase, performance: { now: () => 1000 }, window: {} };
    vm.runInNewContext(source, context);
    const plugin = new context.window.FMRadioSimulatorPlugin();
    plugin._applyTelemetryMeasurements(plugin.parseDspTelemetryFrame({
        frameType: TAP_FM_RADIO_SIMULATOR,
        formatVersion: TELEMETRY_VERSION,
        payload: makeTelemetryPayload()
    }));
    // Worst-case string lengths for the width check.
    plugin.hudValues.multipathDb = -118.9;
    plugin.hudValues.clickRate = 99.9;

    const canvasWidth = 320;
    const drawn = [];
    const measure = text => ({ width: String(text).length * 6 });
    const drawingContext = {
        clearRect() {}, fillRect() {}, strokeRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
        textAlign: 'left',
        measureText: measure,
        fillText(text, x, y) {
            drawn.push({ text: String(text), x, y, align: this.textAlign });
        }
    };
    plugin.hudCanvas = {
        width: canvasWidth,
        height: 128,
        clientWidth: canvasWidth,
        getContext: () => drawingContext
    };
    plugin.drawHud();

    const statusPattern = /dBµV|CNR|ST \d|MPath|Clicks|●/;
    const statusItems = drawn.filter(item => statusPattern.test(item.text));
    assert.equal(statusItems.length, 6, 'all six status items are drawn');
    for (const item of statusItems) {
        assert.equal(item.align, 'left');
        const end = item.x + measure(item.text).width;
        assert.ok(end <= canvasWidth,
            `"${item.text}" ends at ${end}, beyond the ${canvasWidth}px canvas`);
        assert.ok(item.x >= 0, `"${item.text}" starts inside the canvas`);
    }
    const clicksItem = statusItems.find(item => item.text.startsWith('Clicks'));
    const levelItem = statusItems.find(item => item.text.includes('dBµV'));
    assert.ok(clicksItem && levelItem);
    assert.notEqual(clicksItem.y, levelItem.y,
        'narrow layout splits the status items into two rows');
    assert.ok(drawn.every(item => item.text !== 'WASM ACTIVE'));
});

const WASM_TELEMETRY_BYTES = 32768;
const WASM_SAMPLE_RATE = 96000;
const WASM_BLOCK_SIZE = 128;

function readWasmFrames(binding) {
    const packet = new ArrayBuffer(WASM_TELEMETRY_BYTES);
    const bytes = binding.telemetryRead(packet);
    const frames = [];
    const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.bytesRead, bytes);
    return { bytes, frames };
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
    test(`FM Radio Simulator telemetry from ${artifact} honors the v1 payload and 60 Hz cadence`, async () => {
        const bytes = fsSync.readFileSync(
            new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
        const binding = await instantiateDsp(bytes);
        try {
            assert.notEqual(binding.createEngine(), 0);
            assert.equal(binding.prepare(
                WASM_SAMPLE_RATE, 2, WASM_BLOCK_SIZE, WASM_TELEMETRY_BYTES), 0);
            assert.equal(binding.setTelemetryRate(60), 0);
            const instanceId = binding.createInstance('FMRadioSimulatorPlugin');
            assert.notEqual(instanceId, 0);
            assert.equal(binding.instanceSetTap(instanceId, 1616), 0);
            const packer = DSP_PARAM_PACKERS.get('FMRadioSimulatorPlugin');
            assert.equal(packer.floatCount, 12);
            const strongAuto = { st: 60, sm: 'Auto', mp: 0, tn: 0, bw: 230 };
            assert.equal(binding.instanceSetParams(
                instanceId, packer.pack(strongAuto), packer.hash), 0);

            const arena = binding.getArenaViews();
            let processedFrames = 0;
            const processBlocks = count => {
                for (let block = 0; block < count; block++) {
                    for (let frame = 0; frame < WASM_BLOCK_SIZE; frame++) {
                        const sample = 0.5 * Math.sin(
                            2 * Math.PI * 1000 * (processedFrames + frame) / WASM_SAMPLE_RATE);
                        arena.combined[frame] = sample;
                        arena.combined[WASM_BLOCK_SIZE + frame] = sample;
                    }
                    assert.equal(binding.instanceProcess(
                        instanceId,
                        arena.offsets.combined,
                        2,
                        WASM_BLOCK_SIZE,
                        processedFrames / WASM_SAMPLE_RATE
                    ), 0);
                    processedFrames += WASM_BLOCK_SIZE;
                }
            };

            // 60 Hz at 96 kHz = one frame every 1600 processed frames
            // (12.5 blocks): nothing after 12 blocks, one frame on the 13th.
            processBlocks(12);
            assert.deepEqual(readWasmFrames(binding), { bytes: 0, frames: [] });
            processBlocks(1);
            const first = readWasmFrames(binding);
            assert.equal(first.bytes, 232);
            assert.equal(first.frames.length, 1);
            const [frame] = first.frames;
            assert.equal(frame.frameType, TelemetryFrameType.TAP_FM_RADIO_SIMULATOR);
            assert.equal(frame.frameType, TAP_FM_RADIO_SIMULATOR);
            assert.equal(frame.formatVersion, TELEMETRY_VERSION);
            assert.equal(frame.tapId, 1616);
            assert.equal(frame.sequence, 0);
            assert.equal(frame.payloadBytes, TELEMETRY_BYTES);
            assert.equal(frame.flags, 0);
            for (const offset of [0, 4, 8, 12, 16]) {
                assert.equal(Number.isFinite(frame.payload.getFloat32(offset, true)), true);
            }

            // Strong clean signal: pilot locks, Auto blend goes full stereo,
            // and the recovered-MPX spectrum shows the 1 kHz program bin.
            processBlocks(1125);
            const settled = readWasmFrames(binding);
            assert.ok(settled.frames.length > 0);
            const payload = settled.frames.at(-1).payload;
            const rfLevelDb = payload.getFloat32(0, true);
            const cnrDb = payload.getFloat32(4, true);
            const pilotLock = payload.getFloat32(8, true);
            const blendRatio = payload.getFloat32(12, true);
            assert.ok(rfLevelDb > 50 && rfLevelDb < 70, `rfLevelDb was ${rfLevelDb}`);
            assert.ok(cnrDb > 40 && cnrDb < 100, `cnrDb was ${cnrDb}`);
            assert.ok(pilotLock > 0.5, `pilotLock was ${pilotLock}`);
            assert.ok(blendRatio > 0.9, `Auto blendRatio was ${blendRatio}`);
            let peakBinDb = -1000;
            for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
                const value = payload.getFloat32(24 + 4 * bin, true);
                assert.equal(Number.isFinite(value), true);
                assert.ok(value >= -141 && value <= 20, `bin ${bin} was ${value}`);
                if (value > peakBinDb) peakBinDb = value;
            }
            assert.ok(peakBinDb > -40, `spectrum peak was ${peakBinDb}`);

            // Forced modes pin the reported blend ratio exactly.
            assert.equal(binding.instanceSetParams(
                instanceId, packer.pack({ ...strongAuto, sm: 'Mono' }), packer.hash), 0);
            processBlocks(40);
            const mono = readWasmFrames(binding);
            assert.equal(mono.frames.at(-1).payload.getFloat32(12, true), 0);
            assert.equal(binding.instanceSetParams(
                instanceId, packer.pack({ ...strongAuto, sm: 'Stereo' }), packer.hash), 0);
            processBlocks(40);
            const stereo = readWasmFrames(binding);
            assert.equal(stereo.frames.at(-1).payload.getFloat32(12, true), 1);

            // Dead carrier: Auto blend collapses to mono and threshold clicks
            // accumulate on the cumulative counter.
            const weakStart = stereo.frames.at(-1).payload.getUint32(20, true);
            assert.equal(binding.instanceSetParams(
                instanceId, packer.pack({ ...strongAuto, st: 0 }), packer.hash), 0);
            processBlocks(750);
            const weak = readWasmFrames(binding);
            assert.ok(weak.frames.length > 0);
            const weakPayload = weak.frames.at(-1).payload;
            assert.equal(weakPayload.getFloat32(12, true), 0);
            assert.ok(weakPayload.getFloat32(4, true) < 25,
                `weak-signal cnrDb was ${weakPayload.getFloat32(4, true)}`);
            assert.ok(weakPayload.getUint32(20, true) > weakStart,
                `click counter did not advance below threshold (${weakStart})`);
        } finally {
            binding.close();
        }
    });
}

test('FM Radio Simulator telemetry integration wiring is registered end to end', async () => {
    const [plugin, kernel, registry, cmake, rollout, telemetry, readme] = await Promise.all([
        fs.readFile(path.join(repoRoot, 'plugins', 'lofi', 'fm_radio_simulator.js'), 'utf8'),
        fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8'),
        fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
        fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8'),
        fs.readFile(path.join(repoRoot, 'js', 'audio', 'dsp-rollout.js'), 'utf8'),
        fs.readFile(path.join(repoRoot, 'js', 'audio', 'telemetry-hub.js'), 'utf8'),
        fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8')
    ]);
    assert.match(plugin, /FM_RADIO_SIMULATOR_TAP_STATUS\s*=\s*16/);
    assert.match(plugin, /FM_RADIO_SIMULATOR_TELEMETRY_VERSION\s*=\s*1/);
    assert.match(plugin, /FM_RADIO_SIMULATOR_TELEMETRY_BYTES\s*=\s*216/);
    assert.match(plugin, /FM_RADIO_SIMULATOR_SPECTRUM_BINS\s*=\s*48/);
    assert.match(plugin, /requestPowerAnimationFrame/);
    assert.match(plugin, /WASM is required/);
    assert.match(kernel, /kTelemetryFrameType\s*=\s*16u/);
    assert.match(kernel, /kTelemetryVersion\s*=\s*1u/);
    assert.match(kernel, /kSpectrumBins\s*=\s*48u/);
    assert.match(kernel, /void writeTelemetry\(TelemetryWriter &writer\)/);
    assert.match(registry, /EFFETUNE_PLUGIN\(FMRadioSimulatorPlugin, lofi\/fm_radio_simulator\)/);
    assert.match(cmake, /effetune_dsp_fm_radio_simulator_tests/);
    assert.match(rollout, /'FMRadioSimulatorPlugin'/);
    assert.match(telemetry, /TAP_FM_RADIO_SIMULATOR:\s*16/);
    assert.match(readme, /Type 16\s*\(`TAP_FM_RADIO_SIMULATOR`\)/);
});
