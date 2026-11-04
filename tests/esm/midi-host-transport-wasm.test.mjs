import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { materializeSfzAsset, sfzPlayerKind } from '../../js/sfz/preparation-context.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { midiBeatAt } from '../../js/midi/smf-timeline.js';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';
import { prepareOfflineMidiSession, prepareOfflineMidiPlayback, processOfflineMidiBlock } from '../../js/audio/midi-offline.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';

const RATE = 48000;
const modulation = 'volume_oncc142=.1 volume_oncc143=2 volume_oncc146=1 ' +
    'volume_oncc147=.5 volume_oncc148=6 volume_oncc149=3';
function timeline() {
    // Tempo and meter change together at frame 480, inside a 128-frame block.
    const track = [0, 0x90, 60, 127, 20, 255, 81, 3, 15, 66, 64,
        0, 255, 88, 4, 3, 3, 24, 8, 100, 0x80, 60, 0, 0, 255, 47, 0];
    return parseSmf(Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 232,
        77, 84, 114, 107, 0, 0, 0, track.length, ...track]));
}
async function asset(modulated) {
    const parsed = await parseSfz({ selectedPath: 'authored.sfz', onDiagnostic: null,
        readText: async () => '<region> sample=constant.wav key=60 loop_mode=loop_continuous volume=-30 ' +
            (modulated ? modulation : '') });
    return packSfzAsset(parsed.regions, new Map([['constant.wav', {
        sampleRate: RATE, channels: [new Float32Array(1024).fill(.25)]
    }]]), { modulation: parsed.modulation });
}
function expectedGain(song, seconds, speed) {
    const beat = midiBeatAt(song, seconds);
    const bar = beat.meterQuarter % (beat.numerator * 4 / beat.denominator);
    return 10 ** ((beat.bpm * speed * .1 + 2 + beat.numerator + beat.denominator * .5 +
        beat.quarter * 6 + bar * 3) / 20);
}
async function direct(variant, song, bank, { position = 0, speed = 1, checkpoint = false, retime = false } = {}) {
    const suffix = variant === 'simd' ? '.simd' : '';
    const wasm = fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${suffix}.wasm`, import.meta.url));
    const binding = await instantiateDspBinding(wasm), controlBinding = await instantiateDspBinding(wasm);
    binding.createEngine();
    assert.equal(binding.prepare(RATE, 2, 128, 262144), 0);
    const id = binding.createInstance('SoundFontPlayerPlugin');
    const packer = DSP_PARAM_PACKERS.get('SoundFontPlayerPlugin');
    const parameters = { mc: 0, pl: 64, og: 0 };
    const plugin = { id: 7, constructor: { name: 'SoundFontPlayerPlugin' }, enabled: true,
        getParameters: () => parameters, getWasmAssets: () => new Map([[0, bank]]) };
    const entry = { plugin, instanceId: id, typeName: 'SoundFontPlayerPlugin', offlineAssetsReady: true };
    const session = { binding, entries: new Map([[plugin, entry]]), descriptorEligible: false };
    const render = () => {
        const { combined, offsets } = binding.getArenaViews();
        combined.fill(0);
        assert.equal(binding.instanceProcess(id, offsets.combined, 2, 128, 0), 0);
        return combined.slice(0, 128);
    };
    try {
        assert.equal(binding.instanceSetParams(id, packer.pack(parameters), packer.hash), 0);
        bank = await materializeSfzAsset(bank, { sampleRate: RATE, processingChannels: 2, maxFrames: 128,
            timeline: song, playerKind: sfzPlayerKind('SoundFontPlayerPlugin') }, 64 * 1024 * 1024,
        (payload, context, formatTag) => {
            const { control, payloadBytes } = samplePlayerPreparationData(payload);
            return controlBinding.estimateSfzEffectPreparation(control, context, formatTag, payloadBytes);
        });
        assert.equal(binding.instanceSetAsset(id, 0, bank.payload, { ...bank, frames: bank.samples, topology: 0 }), 0);
        for (let attempt = 0; (binding.instanceAssetState(id, 0) & 255) !== 3 && attempt < 1000; attempt++) render();
        assert.equal(binding.instanceAssetState(id, 0) & 255, 3);
        let scheduler, midi;
        if (!position && speed === 1) {
            midi = prepareOfflineMidiSession(session, song, [plugin], RATE);
            assert.equal(await prepareOfflineMidiPlayback(midi, session, { processPending: render,
                configureGraph() {}, isCancelled: () => false }), true);
            scheduler = midi.scheduler;
        } else {
            scheduler = new MidiFrameScheduler(RATE);
            scheduler.configure({ timeline: song, position, speed, generation: 1, preparing: true });
            binding.prepareMidiTransport(scheduler.transportPoints);
            scheduler.register(7, id);
            let ready = false;
            for (let attempt = 0; attempt < 1000 && !ready; attempt++) {
                ready = scheduler.processInstance(binding, 7, 0, 128);
                if (!ready) render();
            }
            assert.ok(ready);
            scheduler.start(1, 0);
        }
        const pcm = new Float32Array(1024);
        for (let offset = 0; offset < pcm.length; offset += 128) {
            if (offset === 512 && checkpoint) {
                assert.equal(scheduler.requestPause(2, offset), true);
                assert.equal(scheduler.processInstance(binding, 7, offset, 128), true);
                render();
                const paused = scheduler.finishPause(offset + 128);
                assert.ok(paused);
                const state = scheduler.instances.get(7);
                const cursor = state.cursor, clockFrame = state.clockFrame;
                const bytes = binding.instanceWriteMidiCheckpoint(id);
                assert.equal(binding.instanceReadMidiCheckpoint(id, bytes), 0);
                scheduler.configure({ generation: 3, mode: 'resume', position: paused.position,
                    anchorFrame: offset, speed, playing: true });
                assert.equal(scheduler.restoreInstanceState(7, { cursor, clockFrame }), true);
            }
            if (offset === 512 && retime) scheduler.setSpeed(2, position + offset / RATE * speed, offset);
            if (midi) processOfflineMidiBlock(midi, session, offset, 128);
            else assert.equal(scheduler.processInstance(binding, 7, offset, 128), true);
            pcm.set(render(), offset);
        }
        return pcm;
    } finally { binding.destroyEngine(); controlBinding.destroyEngine(); }
}
async function live(variant, song, bank) {
    const h = await createNativeSamplerWorklet({ variant });
    try {
        await h.initialize('SoundFontPlayerPlugin', bank);
        await h.waitFor(() => h.processor.transition.phase === 'open');
        await h.send({ type: 'midiTransport', timeline: song, generation: 1, position: 0,
            anchorFrame: 0, speed: 1, gain: 1, playing: false, preparing: true });
        await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared'));
        await h.send({ type: 'midiStart', generation: 1, anchorFrame: h.frame });
        const pcm = new Float32Array(1024);
        for (let offset = 0; offset < pcm.length; offset += 128) pcm.set(h.render()[0], offset);
        assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false, h.errors.join('\n'));
        return pcm;
    } finally { await h.close(); }
}

for (const variant of ['baseline', 'simd']) {
    test(`real SMF host sources reach live and offline ${variant} audio at exact tempo/meter frames`, async () => {
        const song = timeline(), plainBank = await asset(false), modBank = await asset(true);
        const plain = await direct(variant, song, plainBank);
        const offline = await direct(variant, song, modBank);
        const realtime = await live(variant, song, modBank);
        for (const frame of [256, 479, 480, 481, 768, 1023]) {
            assert.ok(plain[frame] > .001, 'Authored constant sample must be audible');
            const expected = expectedGain(song, frame / RATE, 1);
            assert.ok(Math.abs(offline[frame] / plain[frame] - expected) < 1e-4,
                `Raw BPM, transport, meter and PPQ sources differ at sample ${frame}`);
            assert.ok(Math.abs(realtime[frame] - offline[frame]) < 1e-6,
                `Live/offline musical transport diverges at sample ${frame}`);
        }
        const seekPlain = await direct(variant, song, plainBank, { position: .03, speed: 2 });
        const seekMod = await direct(variant, song, modBank, { position: .03, speed: 2 });
        for (const frame of [256, 511, 768]) {
            assert.ok(Math.abs(seekMod[frame] / seekPlain[frame] - expectedGain(song, .03 + frame / RATE * 2, 2)) < 1e-4,
                `Seek history and doubled physical tempo diverge at sample ${frame}`);
        }
        for (const options of [{ checkpoint: true }, { retime: true }]) {
            const reference = await direct(variant, song, plainBank, options);
            const actual = await direct(variant, song, modBank, options);
            for (const frame of [768, 1023]) {
                const sourceSeconds = options.retime ? (512 + (frame - 512) * 2) / RATE : frame / RATE;
                assert.ok(Math.abs(actual[frame] / reference[frame] - expectedGain(song, sourceSeconds, options.retime ? 2 : 1)) < 1e-4,
                    `${options.retime ? 'Speed change' : 'Paused checkpoint resume'} lost real host facts at ${frame}`);
            }
        }
    });
}
