import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAcceptanceInstrument, openAcceptancePlayer, midiMessage as midi } from '../helpers/sfz-native-acceptance.mjs';
import { createSf2Fixture } from '../helpers/sf2-fixture.mjs';
import { openSf2Source } from '../../js/sf2/source.js';
import { sf2SamplerRegions } from '../../js/sf2/asset.js';
import { packStreamedSfzAsset } from '../../js/sfz/asset.js';

const tone = Float32Array.from({ length: 4096 }, (_, frame) => .25 * Math.sin(2 * Math.PI * frame * 3 / 8));
function amplitude(audio, frequency, sampleRate) {
    let real = 0, imaginary = 0;
    for (let frame = 0; frame < audio.length; frame++) {
        const phase = 2 * Math.PI * frequency * frame / sampleRate;
        real += audio[frame] * Math.cos(phase);
        imaginary += audio[frame] * Math.sin(phase);
    }
    return 2 * Math.hypot(real, imaginary) / audio.length;
}
function capture(player) {
    for (let block = 0; block < 16; block++) player.render();
    const audio = new Float32Array(8192);
    for (let at = 0; at < audio.length; at += 128) audio.set(player.render().subarray(0, 128), at);
    return audio;
}

for (const variant of ['baseline', 'simd']) {
    for (const sampleRate of [48000, 96000]) {
        for (const semitones of [-12, -24]) {
            test(`real ${variant} ${sampleRate}Hz ${semitones} semitone controlled and base pitch suppress independent images`, async () => {
                const audio = [];
                for (const controlled of [false, true]) {
                    const tune = controlled ? -1200 : 0;
                    const keycenter = 60 - semitones + tune / 100;
                    const asset = await compileAcceptanceInstrument(`<region> sample=tone.wav key=60 ` +
                        `pitch_keycenter=${keycenter} tune=${tune} loop_mode=loop_continuous loop_start=0 loop_end=4095`,
                    { samples: new Map([['tone.wav', { sampleRate: 48000, channels: [tone] }]]) });
                    const player = await openAcceptancePlayer(variant, asset, { sampleRate, channels: 4 });
                    try {
                        player.events([midi(0xb0, 7, 127), midi(0x90, 60, 127)]);
                        audio.push(capture(player));
                    } finally { player.close(); }
                }
                const wanted = 18000 * 2 ** (semitones / 12);
                const image = 30000 * 2 ** (semitones / 12);
                // The image frequency is distinct from the wanted tone at both host rates.
                for (const output of audio) {
                    const level = amplitude(output, wanted, sampleRate);
                    assert.ok(level > .249 && level < .251, `Wanted tone amplitude: ${level}`);
                    assert.ok(amplitude(output, image, sampleRate) < level * .0001,
                        'An interpolation image must be at least 80dB below the preserved wanted tone');
                }
            });
        }
    }
    test(`real ${variant} cached and controlled downsampling retain the existing Nyquist rejection`, async () => {
        for (const controlled of [false, true]) {
            const asset = await compileAcceptanceInstrument('<region> sample=tone.wav key=60 ' +
                `${controlled ? 'tune=1200' : 'pitch_keycenter=48'} loop_mode=loop_continuous loop_start=0 loop_end=4095`,
            { samples: new Map([['tone.wav', { sampleRate: 48000, channels: [tone] }]]) });
            const player = await openAcceptancePlayer(variant, asset);
            try {
                player.events([midi(0xb0, 7, 127), midi(0x90, 60, 127)]);
                assert.ok(amplitude(capture(player), 12000, 48000) < .0001);
            } finally { player.close(); }
        }
    });
    test(`real ${variant} SF2 RPN twelve-semitone negative bend suppresses interpolation images`, async () => {
        const pcm16 = Int16Array.from(tone, value => Math.round(value * 32768));
        const bytes = createSf2Fixture({ sampleFrames: pcm16.length, sampleRate: 48000,
            loopStart: 0, loopEnd: pcm16.length, pcm16, keyRange: [0, 127] });
        const source = await openSf2Source({ size: bytes.length,
            readRange: async (offset, length) => bytes.subarray(offset, offset + length) });
        const samples = new Map(source.samples.map(sample => [sample.path,
            { frames: sample.frames, channels: 1, sampleRate: sample.sampleRate, revision: 'a'.repeat(64) }]));
        const asset = packStreamedSfzAsset(sf2SamplerRegions(source), samples, { cacheSlots: 8,
            sourceProfile: source.compiled.sourceProfile, presets: source.compiled.presets,
            modulation: source.compiled });
        const player = await openAcceptancePlayer(variant, asset, { sampleRate: 96000, channels: 4,
            initialize(binding, id) {
                assert.equal(binding.configureSfzSampleStream(id, 9), 0);
                assert.equal(binding.publishSfzSamplePage(id, { generation: 9, sample: 0, pageIndex: 0,
                    pcm: Float32Array.from(pcm16, value => value / 32768), frames: pcm16.length,
                    channels: 1, resident: true }), 0);
            } });
        try {
            player.events([midi(0xb0, 7, 127), midi(0x90, 60, 127)]);
            player.render();
            player.events([midi(0xb0, 101, 0), midi(0xb0, 100, 0), midi(0xb0, 6, 12), midi(0xe0, 0, 0)]);
            const output = capture(player), wanted = amplitude(output, 9000, 96000);
            assert.ok(wanted > .001, 'The bent wanted tone remains audible');
            assert.ok(amplitude(output, 15000, 96000) < wanted * .0001);
        } finally { player.close(); }
    });
}
