import { createAcceptanceCostWorkerPool } from '../helpers/sfz-native-acceptance.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { before, after } from 'node:test';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { compileSfzScript } from '../../js/sfz/script-compiler.js';
import { prepareOfflineMidiSession, prepareOfflineMidiPlayback, processOfflineMidiBlock } from '../../js/audio/midi-offline.js';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';

const costWorkers = createAcceptanceCostWorkerPool();
let previousWorker;
before(() => {
  previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: costWorkers.Worker });
});
after(async () => {
  try { await costWorkers.close(); } finally {
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker);
    else delete globalThis.Worker;
  }
});

const RATE = 48000;
const common = { enabled: true, channel: 'A', inputBus: 0, outputBus: 0 };
class SoundFontPlayerPlugin {
    static executionCapabilities = { requiresWasm: true };
    constructor(asset) { this.id = 1; this.enabled = true; this.channel = 'A'; this.sf = 'fixture'; this.asset = asset; }
    getParameters() { return { ...common, mc: 0, pl: 64, og: 0, sf: this.sf }; }
    getWasmAssets() { return new Map([[0, this.asset]]); }
    get offlineDspAssetRequired() { return true; }
    async createOfflineDspState() {
        return { parameters: this.getParameters(), assets: this.getWasmAssets(), offlineDspAssetRequired: true };
    }
}
class VolumePlugin {
    constructor(id, vl) { this.id = id; this.enabled = true; this.vl = vl; }
    getParameters() { return { ...common, vl: this.vl }; }
}
class DelayPlugin {
    constructor(id) { this.id = id; this.enabled = true; }
    getParameters() { return { ...common, ds: 2000, pd: 0, fb: 0, mx: 100, dp: 0, pp: 0 }; }
}
function buffer(channels, length, sampleRate) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        getChannelData: channel => samples[channel] };
}
function midiFile(track = [1, 0x90, 69, 127, 0x82, 0x2b, 0x80, 69, 0, 0, 255, 47, 0]) {
    // PPQ 1000: the first note starts at sample 24, inside the first render quantum.
    const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 232,
        77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
    return { name: 'synthetic.mid', size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer };
}

test('encoded MIDI WAV retains velocity/RPN pitched samples, finite loops, CC triggers and pedal release', async t => {
    const meta = JSON.parse(fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url)));
    const cases = [
        { name: 'velocity pitch', opcodes: 'key=69 loop_mode=one_shot pitch_veltrack=-1200',
            frames: RATE, track: [0, 0x90, 69, 127, 20, 0x80, 69, 0, 0, 255, 47, 0], lastSound: 1.99 },
        { name: 'RPN bend range', opcodes: 'key=69 loop_mode=one_shot', frames: RATE,
            track: [0, 0xb0, 101, 0, 0, 0xb0, 100, 0, 0, 0xb0, 6, 12,
                0, 0xe0, 0, 0, 0, 0x90, 69, 127, 20, 0x80, 69, 0, 0, 255, 47, 0], lastSound: 1.99 },
        { name: 'finite release loop', opcodes: 'key=69 trigger=release loop_mode=loop_continuous loop_count=2 ampeg_release=1',
            frames: RATE / 10, track: [0, 0x90, 69, 127, 20, 0x80, 69, 0, 0, 255, 47, 0], lastSound: .29 },
        { name: 'CC trigger', opcodes: 'key=60 on_locc1=1 on_hicc1=127 loop_mode=one_shot',
            frames: RATE, track: [0, 0xb0, 1, 127, 20, 255, 47, 0], lastSound: .99 },
        { name: 'sustain pedal release', opcodes: 'key=69 loop_mode=loop_continuous ampeg_release=.5', frames: 256,
            track: [0, 0xb0, 64, 127, 0, 0x90, 69, 127, 20, 0x80, 69, 0, 80, 255, 47, 0], lastSound: .3 }
    ];
    for (const variant of ['', '.simd']) await t.test(variant || 'baseline', async () => {
        const bytes = fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${variant}.wasm`, import.meta.url));
        const processor = new OfflineProcessor({ audioContext: { sampleRate: RATE,
            decodeAudioData() { assert.fail('MIDI must never enter audio decoding'); } },
        createOfflineContext() { return { createBuffer: buffer }; } }, new AudioEncoder(), {
            getModuleInfo: async () => ({ bytes, meta, paramPackers: DSP_PARAM_PACKERS }), instantiateDsp,
            warning: message => assert.fail(message)
        });
        await withGlobals({ window: { audioPreferences: { useWasmDsp: true, outputChannels: 2 } } }, async () => {
            for (const fixture of cases) {
                const parsed = await parseSfz({ selectedPath: 'tail.sfz', readText: async () =>
                    `<region> sample=constant.wav amp_veltrack=0 ${fixture.opcodes}`,
                hasSample: () => true, onDiagnostic: null });
                const asset = packSfzAsset(parsed.regions, new Map([['constant.wav', {
                    channels: [Float32Array.from({ length: fixture.frames }, () => .25)], sampleRate: RATE
                }]]));
                const result = await processor.processAudioFile(midiFile(fixture.track), [new SoundFontPlayerPlugin(asset)], null,
                    { format: 'wav', sampleRate: RATE, wavSampleFormat: 'float32' });
                assert.equal(result.tailLimitReached, false, fixture.name);
                const wav = new DataView(await result.blob.arrayBuffer());
                const frame = Math.floor(fixture.lastSound * RATE);
                assert.ok(wav.getUint32(40, true) >= (frame + 1) * 8, `${fixture.name}: encoded ending retained`);
                assert.ok(Math.abs(wav.getFloat32(44 + frame * 8, true)) > .001,
                    `${fixture.name}: encoded late sample is audible`);
            }
        });
    });
});

test('MIDI renders through actual baseline/SIMD SFZ and downstream effects into isolated whole-song WAV output', async t => {
    const parsed = await parseSfz({ selectedPath: 'test.sfz', readText: async () =>
        '<region> sample=constant.wav key=69 amp_veltrack=0 loop_mode=loop_continuous ampeg_release=.02',
    hasSample: () => true, onDiagnostic: null });
    const asset = packSfzAsset(parsed.regions, new Map([['constant.wav', {
        channels: [Float32Array.from({ length: 256 }, () => .25)], sampleRate: RATE
    }]]));
    const meta = JSON.parse(fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url)));
    for (const variant of ['', '.simd']) await t.test(variant || 'baseline', async () => {
        const bytes = fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${variant}.wasm`, import.meta.url));
        const sessions = [];
        const outputs = [];
        const encoder = new AudioEncoder();
        const processor = new OfflineProcessor({ audioContext: { sampleRate: RATE,
            decodeAudioData() { assert.fail('MIDI must never enter decodeAudioData'); } },
        createOfflineContext() { return { createBuffer: buffer }; } }, {
            async encode(value, settings, options) {
                outputs.push(value);
                return encoder.encode(value, settings, options);
            }
        }, { getModuleInfo: async () => ({ bytes, meta, paramPackers: DSP_PARAM_PACKERS }),
            async instantiateDsp(...args) { const value = await instantiateDsp(...args); sessions.push(value); return value; },
            warning: message => assert.fail(message) });
        await withGlobals({ window: { audioPreferences: { useWasmDsp: true, outputChannels: 2 } } }, async () => {
            const settings = { format: 'wav', sampleRate: RATE, wavSampleFormat: 'float32' };
            const first = await processor.processAudioFile(midiFile(), [new VolumePlugin(2, -6), new SoundFontPlayerPlugin(asset)], null, settings);
            const second = await processor.processAudioFile(midiFile(), [new SoundFontPlayerPlugin(asset), new VolumePlugin(2, -6)], null, settings);
            const third = await processor.processAudioFile(midiFile(), [new SoundFontPlayerPlugin(asset)], null, settings);
            assert.equal(first.tailLimitReached, false);
            assert.equal(first.blob.type, 'audio/wav');
            const header = new DataView(await first.blob.arrayBuffer());
            assert.equal(header.getUint32(24, true), RATE);
            assert.equal(header.getUint32(40, true), outputs[0].length * 2 * 4);
            assert.ok(outputs[0].length > .15 * RATE, 'SFZ release must outlast the SMF event endpoint');
            assert.ok(outputs[0].getChannelData(0).subarray(0, 24).every(value => Math.abs(value) < 1e-12));
            const power = audio => audio.getChannelData(0).reduce((sum, value) => sum + value * value, 0);
            assert.ok(power(outputs[0]) > 1);
            assert.ok(Math.abs(power(outputs[0]) - power(outputs[2])) < 1e-6,
                'a gain before SFZ must not affect sound generated later in the pipeline');
            assert.ok(Math.abs(power(outputs[1]) / power(outputs[0]) - 10 ** (-6 / 10)) < 1e-5,
                'a gain after SFZ must affect its generated audio');
            assert.notEqual(sessions[0], sessions[1]);
            assert.equal(outputs[0].length, outputs[2].length);
            assert.ok(outputs[0].getChannelData(0).every((value, index) =>
                Math.abs(value - outputs[2].getChannelData(0)[index]) < 1e-9));
            const delayed = await processor.processAudioFile(midiFile(), [new SoundFontPlayerPlugin(asset),
                new DelayPlugin(2), new DelayPlugin(3)], null, settings);
            assert.equal(delayed.tailLimitReached, false);
            const audio = outputs.at(-1).getChannelData(0);
            assert.ok(audio.length > RATE * 4, 'serial delays must retain the echo after four seconds of silence');
            assert.ok(audio.subarray(0, RATE * 4).every(value => Math.abs(value) < 1e-12));
            assert.ok(audio.subarray(RATE * 4).some(value => Math.abs(value) > .01));
            const release = await parseSfz({ selectedPath: 'release.sfz', readText: async () =>
                '<region> sample=release.wav key=69 trigger=release delay=1 loop_mode=one_shot amp_veltrack=0',
            hasSample: () => true, onDiagnostic: null });
            const releaseAsset = packSfzAsset(release.regions, new Map([['release.wav', {
                channels: [Float32Array.from({ length: RATE / 10 }, () => .25)], sampleRate: RATE
            }]]));
            const late = await processor.processAudioFile(midiFile(), [new SoundFontPlayerPlugin(releaseAsset)], null, settings);
            assert.equal(late.tailLimitReached, false);
            const lateAudio = outputs.at(-1).getChannelData(0);
            assert.ok(lateAudio.length > RATE * 1.2, 'a delayed release-trigger sample must survive export drain');
            assert.ok(lateAudio.subarray(RATE * 1.1).some(value => Math.abs(value) > .01));
            await assert.rejects(processor.processAudioFile(midiFile(), [], null, settings),
                { userMessageKey: 'sfzPlayer.error.offlineInstrument' });
            const previousOutputs = outputs.length;
            const canceled = await processor.processAudioFile(midiFile(), [new SoundFontPlayerPlugin(asset)],
                () => processor.cancelProcessing(), settings);
            assert.equal(canceled, null);
            assert.equal(outputs.length, previousOutputs);
            assert.equal(processor.isProcessing(), false);
        });
    });
});

test('actual WASM reattacks prepared held notes at an offset after large frozen history and rejects stale generations', async t => {
    const parsed = await parseSfz({ selectedPath: 'held.sfz', readText: async () =>
        '<region> sample=constant.wav key=69 amp_veltrack=0 loop_mode=loop_continuous',
    hasSample: () => true, onDiagnostic: null });
    const asset = packSfzAsset(parsed.regions, new Map([['constant.wav', {
        channels: [Float32Array.from({ length: 256 }, () => .25)], sampleRate: RATE
    }]]));
    const meta = JSON.parse(fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url)));
    for (const variant of ['', '.simd']) await t.test(variant || 'baseline', async () => {
        const bytes = fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${variant}.wasm`, import.meta.url));
        const processor = new OfflineProcessor({}, {}, {
            getModuleInfo: async () => ({ bytes, meta, paramPackers: DSP_PARAM_PACKERS }), instantiateDsp,
            warning: message => assert.fail(message)
        });
        await withGlobals({ window: { audioPreferences: { useWasmDsp: true } } }, async () => {
            const plugin = new SoundFontPlayerPlugin(asset);
            const session = await processor.createOfflineDspSession([plugin], RATE, 2);
            assert.ok(session);
            try {
                const entry = session.entries.get(plugin);
                const scheduler = new MidiFrameScheduler(RATE);
                scheduler.register(plugin.id, entry.instanceId);
                const events = [{ seconds: 0, status: 0x90, data1: 69, data2: 127 },
                    ...Array.from({ length: 100000 }, (_, index) => ({ seconds: index / 1000,
                        status: 0xb0, data1: 1, data2: index % 128 }))];
                scheduler.configure({ timeline: { events, duration: 101 }, position: 100,
                    generation: 1, preparing: true });
                let frame = 0;
                let prepared = false;
                for (let block = 0; block < 100000; block++, frame += 128) {
                    prepared = scheduler.processInstance(session.binding, plugin.id, frame, 128);
                    if (prepared) break;
                    assert.ok(processor.tryProcessOfflineDspPipeline({ session, pipeline: [plugin],
                        inputBlock: new Float32Array(256), sampleRate: RATE, outputChannelCount: 2,
                        blockSize: 128, offset: frame }), 'native history must advance before the next readiness check');
                }
                assert.equal(prepared, true, 'bounded history preparation reaches the frozen target');
                assert.equal(scheduler.currentPosition(frame), 100);
                const anchorFrame = frame + 128;
                scheduler.start(1, anchorFrame);
                scheduler.processInstance(session.binding, plugin.id, anchorFrame, 128, 7);
                const result = processor.tryProcessOfflineDspPipeline({ session, pipeline: [plugin],
                    inputBlock: new Float32Array(256), sampleRate: RATE, outputChannelCount: 2,
                    blockSize: 128, offset: anchorFrame });
                assert.ok(result);
                assert.ok(result.subarray(0, 7).every(value => Math.abs(value) < 1e-12));
                assert.ok(result.subarray(7, 128).some(value => Math.abs(value) > .01));
                scheduler.configure({ generation: 2, position: 0, playing: false });
                scheduler.processInstance(session.binding, plugin.id, anchorFrame + 128, 128);
                assert.notEqual(session.binding.instanceSetMidiEvents(entry.instanceId,
                    [{ offsetFrames: 0, status: 0x90, data1: 69, data2: 127 }], 1), 0);
            } finally { processor.destroyOfflineDspSession(session); }
        });
    });
});


test('initial offline barrier preserves exact zero-time note/CC transients and script initialization across graph reset', async t => {
    const meta = JSON.parse(fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url)));
    for (const variant of ['', '.simd']) await t.test(variant || 'baseline', async () => {
        const bytes = fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${variant}.wasm`, import.meta.url));
        const render = async (asset, event, graph, prepare) => {
            const processor = new OfflineProcessor({}, {}, {
                getModuleInfo: async () => ({ bytes, meta, paramPackers: DSP_PARAM_PACKERS }), instantiateDsp,
                warning: message => assert.fail(message)
            });
            const plugin = new SoundFontPlayerPlugin(asset);
            const session = await processor.createOfflineDspSession([plugin], RATE, 2);
            assert.ok(session);
            const binding = session.binding, entry = session.entries.get(plugin);
            const output = new Float32Array(512);
            try {
                let midi;
                if (prepare) {
                    midi = prepareOfflineMidiSession(session, { duration: .1, events: [event] }, [plugin], RATE);
                    if (!graph) session.descriptorEligible = false;
                    const write = binding.instanceWriteMidiCheckpoint.bind(binding);
                    const read = binding.instanceReadMidiCheckpoint.bind(binding);
                    let captures = 0;
                    binding.instanceWriteMidiCheckpoint = id => { captures++; return write(id); };
                    binding.instanceReadMidiCheckpoint = (id, checkpoint) => {
                        const status = read(id, checkpoint);
                        assert.equal(captures, 1);
                        assert.equal(binding.instanceMidiClock(id).frame, 0, 'checkpoint restore retains source time zero');
                        return status;
                    };
                    assert.equal(await prepareOfflineMidiPlayback(midi, session, {
                        isCancelled: () => false,
                        configureGraph: () => {
                            if (graph) processor.prepareOfflineDspGraph(session, [plugin], 2, RATE);
                        },
                        processPending: () => {
                            const silence = binding.getArenaViews().scratch.allChannels.subarray(0, 256);
                            silence.fill(0);
                            assert.equal(binding.instanceProcess(entry.instanceId,
                                binding.pointerForArenaView(silence), 2, 128, 0), 0);
                        }
                    }), true);
                } else {
                    assert.equal(binding.instanceSetSeed(entry.instanceId, 0x4d494449, 1), 0);
                    assert.equal(binding.instanceSetMidiEvents(entry.instanceId, [], 1, 1), 0);
                    assert.equal(binding.instanceSetMidiClock(entry.instanceId, 0, 1, 1), 0);
                    assert.equal(binding.instanceSetMidiEvents(entry.instanceId,
                        [{ ...event, offsetFrames: 0, noteId: 1 }], 1), 0);
                }
                for (let offset = 0; offset < output.length; offset += 128) {
                    if (midi) processOfflineMidiBlock(midi, session, offset, 128);
                    if (graph) {
                        const block = await processor.processOfflineDspGraph({ session,
                            inputBlock: new Float32Array(256), outputChannelCount: 2,
                            blockSize: 128, offset, sampleRate: RATE });
                        output.set(block.subarray(0, 128), offset);
                    } else {
                        const audio = binding.getArenaViews().combined.subarray(0, 256);
                        audio.fill(0);
                        assert.equal(binding.instanceProcess(entry.instanceId,
                            binding.pointerForArenaView(audio), 2, 128, offset / RATE), 0);
                        output.set(audio.subarray(0, 128), offset);
                    }
                }
                return output;
            } finally { processor.destroyOfflineDspSession(session); }
        };
        await withGlobals({ window: { audioPreferences: { useWasmDsp: true } } }, async () => {
            for (const cc of [false, true]) {
                const parsed = await parseSfz({ selectedPath: 'onset.sfz', readText: async () =>
                    `<region> sample=transient.wav amp_veltrack=0 loop_mode=one_shot ${cc ? 'on_locc1=1 on_hicc1=127' : 'key=69'}`,
                hasSample: () => true, onDiagnostic: null });
                const samples = new Map([['transient.wav', { sampleRate: RATE,
                    channels: [Float32Array.from({ length: 1024 }, (_, i) => .1 + (i % 17) / 100)] }]]);
                const asset = packSfzAsset(parsed.regions, samples);
                const event = { seconds: 0, status: cc ? 0xb0 : 0x90, data1: cc ? 1 : 69, data2: 127 };
                const reference = await render(asset, event, false, false);
                const actual = await render(asset, event, true, true);
                const onset = values => values.findIndex(value => Math.abs(value) > .0001);
                assert.ok(onset(reference) >= 0 && onset(reference) < 4, 'direct source-zero transient is immediate');
                assert.equal(onset(actual), onset(reference), 'preparation adds no output samples');
                assert.ok(actual.every((value, index) => Math.abs(value - reference[index]) < 1e-7),
                    `${cc ? 'CC' : 'note'} zero-time PCM matches direct native rendering`);
                if (!cc) {
                    const script = compileSfzScript('on init declare $gain := random(-12000,-1000) end on ' +
                        'on note change_vol($EVENT_ID,$gain) end on');
                    const scripted = packSfzAsset(parsed.regions, samples, { script });
                    const preparedDirect = await render(scripted, event, false, true);
                    const restoredGraph = await render(scripted, event, true, true);
                    assert.ok(preparedDirect.some(value => Math.abs(value) > .001));
                    assert.ok(restoredGraph.every((value, index) => Math.abs(value - preparedDirect[index]) < 1e-7),
                        'graph setup does not repeat init/RNG or change the first scripted note');
                }
            }
        });
    });
});
