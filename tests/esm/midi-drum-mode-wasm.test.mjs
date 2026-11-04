import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';
import { parseSmf } from '../../js/midi/smf-parser.js';

const xg = (part, mode) => [0, 0xf0, 8, 0x43, 0x10, 0x4c, 8, part, 7, mode, 0xf7];
const gs = [0, 0xf0, 10, 0x41, 0x10, 0x42, 0x12, 0x40, 0x11, 0x15, 2, 0x18, 0xf7];
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

for (const variant of ['baseline', 'simd']) test(`${variant} parsed GS/XG drums choose actual SF2 kits through worklet forecast, seek and melodic return`, async () => {
    const fixture = await createSf2RuntimeFixture({ resident: true });
    const h = await createNativeSamplerWorklet({ variant });
    try {
        fixture.descriptor.operationRevision = 1;
        await h.initialize('SoundFontPlayerPlugin', fixture.descriptor);
        await h.waitForJoinReady();
        const capture = async (designation, program, position = 0) => {
            // SysEx/PC precede a later note so seek must restore the typed state.
            const track = [...designation, 0, 0xc0, program, 96, 0x90, 60, 127, 0x83, 0x00, 255, 47, 0];
            const timeline = parseSmf(Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
                77, 84, 114, 107, 0, 0, 0, track.length, ...track]));
            const generation = (h.processor.midiScheduler?.generation ?? 0) + 1;
            await h.send({ type: 'midiTransport', timeline, generation, position, playing: false,
                preparing: true, anchorFrame: h.frame, speed: 1, gain: 1 });
            await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared' && message.generation === generation));
            const origin = h.frame + 128;
            await h.send({ type: 'midiStart', generation, anchorFrame: origin });
            const samples = [];
            for (let block = 0; block < 100; block++) {
                const frame = h.frame, output = h.render()[0];
                if (frame > origin + 9600) samples.push(...output);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false, h.errors.join('; '));
            assert.ok(rms(samples) > 1e-5, 'The selected kit must produce actual audio');
            return rms(samples);
        };
        const bright = await capture(xg(0, 0), 0);
        const quiet = await capture(gs, 1);
        assert.ok(Math.abs(quiet / bright - 10 ** (-120 / 200)) < .01, 'GS MAP2 on channel1 uses the quiet drum kit, not melodic program1 fallback');
        const sought = await capture(xg(0, 3), 1, .05);
        assert.ok(Math.abs(sought / quiet - 1) < .02, 'XG Drum Setup2 survives seek and native sample forecast');
        const melodic = await capture([...gs, ...xg(0, 0)], 0);
        assert.ok(Math.abs(melodic / bright - 1) < .02, 'Mode0 restores melodic playback after a GS drum assignment');
    } finally {
        await h.close(); await fixture.close();
    }
});
