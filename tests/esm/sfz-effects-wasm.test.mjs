import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { materializeSfzAsset, sfzPlayerKind } from '../../js/sfz/preparation-context.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';
import { createSfzEffectsAsset } from '../helpers/sfz-effects-asset-fixture.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';

const rate = 48000;
function song() {
    // At120BPM and24000PPQ one tick is exactly one48kHz frame.
    // CC7 on channels2/3 exercises the instrument-global accepted CC scope
    // without changing the sounding channel1 voice's MIDI volume.
    const track = [0, 0xb1, 7, 0, 0, 0x90, 60, 127,
        0x82, 0x2c, 0xb1, 7, 127, 0x81, 0x48, 0xb2, 7, 0,
        100, 0x80, 60, 0, 0x83, 0x10, 255, 47, 0];
    return parseSmf(Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0x5d, 0xc0,
        77, 84, 114, 107, 0, 0, 0, track.length, ...track]));
}

async function render(variant, bank, { channels = 2, speed = 1 } = {}) {
    const suffix = variant === 'simd' ? '.simd' : '';
    const wasm = fs.readFileSync(new URL(`../../plugins/dsp/effetune-dsp${suffix}.wasm`, import.meta.url));
    const binding = await instantiateDspBinding(wasm), controlBinding = await instantiateDspBinding(wasm);
    binding.createEngine();
    try {
        assert.equal(binding.prepare(rate, channels, 128, 262144), 0);
        const id = binding.createInstance('SoundFontPlayerPlugin');
        const packer = DSP_PARAM_PACKERS.get('SoundFontPlayerPlugin');
        assert.equal(binding.instanceSetParams(id, packer.pack({ mc: 0, pl: 64, og: 0 }), packer.hash), 0);
        const scheduler = new MidiFrameScheduler(rate);
        scheduler.configure({ timeline: song(), position: 0, speed, generation: 1, preparing: true });
        // The immutable map is installed before FX admission, so CONTROL can
        // reserve the slowest physical tempo over the allowed speed range.
        binding.prepareMidiTransport(scheduler.transportPoints);
        const process = () => {
            const { combined, offsets } = binding.getArenaViews();
            combined.fill(0);
            assert.equal(binding.instanceProcess(id, offsets.combined, channels, 128, 0), 0);
            return Array.from({ length: channels }, (_, channel) => combined.slice(channel * 128, (channel + 1) * 128));
        };
        bank = await materializeSfzAsset(bank, { sampleRate: rate, processingChannels: channels, maxFrames: 128,
            timeline: song(), playerKind: sfzPlayerKind('SoundFontPlayerPlugin') }, 64 * 1024 * 1024,
        (payload, context, formatTag) => {
            const { control, payloadBytes } = samplePlayerPreparationData(payload);
            return controlBinding.estimateSfzEffectPreparation(control, context, formatTag, payloadBytes);
        });
        assert.equal(binding.instanceSetAsset(id, 0, bank.payload, { ...bank, frames: bank.samples, topology: 0 }), 0);
        for (let count = 0; (binding.instanceAssetState(id, 0) & 255) !== 3 && count < 2000; count++) process();
        assert.equal(binding.instanceAssetState(id, 0) & 255, 3, 'compiled FX bank must become active');
        scheduler.register(1, id);
        let ready = false;
        for (let count = 0; !ready && count < 2000; count++) {
            ready = scheduler.processInstance(binding, 1, 0, 128);
            if (!ready) process();
        }
        assert.ok(ready);
        scheduler.start(1, 0);
        const output = Array.from({ length: channels }, () => new Float32Array(2048));
        for (let frame = 0; frame < 2048; frame += 128) {
            assert.equal(scheduler.processInstance(binding, 1, frame, 128), true);
            const block = process();
            for (let channel = 0; channel < channels; channel++) output[channel].set(block[channel], frame);
        }
        return output;
    } finally { binding.destroyEngine(); controlBinding.destroyEngine(); }
}

async function renderWorklet(variant, bank) {
    // Production worklet code under Node VM, with real WASM; not a browser.
    const harness = await createNativeSamplerWorklet({ variant });
    try {
        await harness.initialize('SoundFontPlayerPlugin', bank);
        await harness.waitFor(() => harness.processor.transition.phase === 'open');
        await harness.send({ type: 'midiTransport', timeline: song(), generation: 1, position: 0,
            anchorFrame: 0, speed: 1, gain: 1, playing: false, preparing: true });
        await harness.waitFor(() => harness.messages.some(message => message.type === 'midiPrepared'));
        await harness.send({ type: 'midiStart', generation: 1, anchorFrame: harness.frame });
        const output = new Float32Array(2048);
        for (let frame = 0; frame < output.length; frame += 128) output.set(harness.render()[0], frame);
        assert.equal(harness.messages.some(message => message.type === 'midiTransportError'), false, harness.errors.join('\n'));
        return output;
    } finally { await harness.close(); }
}

for (const variant of ['baseline', 'simd']) {
    test(`normal SFZ FX assets render accepted CC order, sends, auxiliary routing and tails in ${variant}`, async () => {
        const dry = (await render(variant, await createSfzEffectsAsset('Dry')))[0];
        const gainBank = await createSfzEffectsAsset('Gain');
        const gain = (await render(variant, gainBank))[0];
        const live = await renderWorklet(variant, gainBank);
        for (const frame of [299, 300, 301, 499, 500, 501]) {
            assert.ok(Math.abs(dry[frame]) > .001);
            const expected = dry[frame] * (frame >= 300 && frame < 500 ? 10 ** (12 / 20) : 1);
            assert.ok(Math.abs(gain[frame] - expected) < 1e-5, `accepted cross-channel CC at ${frame}`);
            assert.ok(Math.abs(gain[frame] - live[frame]) < 1e-6, `live/offline FX at ${frame}`);
        }
        const send = (await render(variant, await createSfzEffectsAsset('Send')))[0];
        for (let frame = 48; frame < 1024; frame++)
            assert.ok(Math.abs(send[frame] - dry[frame] - .5 * dry[frame - 48]) < 1e-5, `send delay at ${frame}`);
        assert.ok(send.slice(649, 696).some(value => Math.abs(value) > 1e-5), 'delay survives voice release');
        assert.ok(send.slice(1024).every(value => Math.abs(value) < 1e-6), 'finite delay drains');
        const aux = await render(variant, await createSfzEffectsAsset('Aux'), { channels: 4 });
        assert.ok(aux[0].every(value => Math.abs(value) < 1e-6), 'auxiliary output must not fold into main');
        assert.ok(Math.abs(aux[2][256] - dry[256] * 10 ** (6 / 20)) < 1e-5);
        const convolution = (await render(variant, await createSfzEffectsAsset('Impulse')))[0];
        const stepCentroid = audio => {
            let moment = 0, previous = 0;
            for (let frame = 0; frame < 512; frame++) {
                moment += frame * (audio[frame] - previous); previous = audio[frame];
            }
            return moment / previous;
        };
        assert.ok(Math.abs(convolution[511] - dry[511]) < 1e-5, 'resampled unit IR preserves convolution DC gain');
        assert.ok(Math.abs(stepCentroid(convolution) - stepCentroid(dry) - 220 * 48000 / 44100) < .1,
            'IR-only44100Hz asset preserves physical impulse time at48000Hz');
        const syncBank = await createSfzEffectsAsset('Sync');
        for (const speed of [.5, 2]) {
            const source = (await render(variant, await createSfzEffectsAsset('Dry'), { speed }))[0];
            const synced = (await render(variant, syncBank, { speed }))[0], delay = 48 / speed;
            for (let frame = delay; frame < 512; frame++)
                assert.ok(Math.abs(synced[frame] - source[frame - delay]) < 1e-5, `beat delay at ${speed}x/${frame}`);
        }
    });
}
