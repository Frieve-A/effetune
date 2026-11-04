import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAcceptanceInstrument, openAcceptancePlayer, midiMessage as midi } from '../helpers/sfz-native-acceptance.mjs';

const samples = () => new Map([
    ['tone.wav', { sampleRate: 48000, channels: [new Float32Array(96000).fill(.25)] }],
    ['zero.wav', { sampleRate: 48000, channels: [new Float32Array(64)] }]
]);
const peak = audio => audio.reduce((highest, value) => {
    const magnitude = value < 0 ? -value : value;
    return magnitude > highest ? magnitude : highest;
}, 0);

for (const variant of ['baseline', 'simd']) {
    for (const mode of ['fast', 'normal']) {
        test(`real ${variant} typed ${mode} group choke retires the sounding envelope once`, async () => {
            const asset = await compileAcceptanceInstrument('<global> amp_veltrack=0 ampeg_release=.01 ' +
                `<region> sample=tone.wav key=60 loop_mode=loop_continuous off_by=1 off_mode=${mode} off_time=.01 ` +
                '<region> sample=zero.wav key=61 group=1', { samples: samples() });
            const player = await openAcceptancePlayer(variant, asset);
            try {
                player.events([midi(0xb0, 7, 127), midi(0x90, 60, 127, 0, 1)]);
                player.render();
                assert.ok(peak(player.render()) > .24);
                for (let block = 0; block < 8; block++) {
                    player.events([midi(0x90, 61, 127, 0, 2 + block)]);
                    player.render();
                }
                assert.equal(player.binding.instanceMidiState(player.id) & 1, 0,
                    'Repeated choke messages cannot restart the retirement deadline');
                assert.ok(peak(player.render()) < 1e-7);
                player.events([midi(0x80, 60, 0, 0, 1)]);
                assert.ok(peak(player.render()) < 1e-7);
                player.events([midi(0x90, 60, 127, 0, 20)]);
                player.render();
                assert.ok(peak(player.render()) > .24, 'A later ordinary note still plays');
            } finally { player.close(); }
        });
    }
    for (const sameNote of [false, true]) {
        test(`real ${variant} ${sameNote ? 'note_polyphony' : 'polyphony'} steals one-shots without changing key-release immunity`, async () => {
            const asset = await compileAcceptanceInstrument('<region> sample=tone.wav lokey=60 hikey=61 ' +
                `amp_veltrack=0 loop_mode=one_shot ${sameNote ? 'note_polyphony' : 'polyphony'}=1 ampeg_release=.001`,
            { samples: samples() });
            const player = await openAcceptancePlayer(variant, asset);
            try {
                player.events([midi(0xb0, 7, 127), midi(0xb1, 7, 127),
                    midi(0x91, 60, 127, 0, 9), midi(0x90, 60, 127, 0, 1)]);
                player.render();
                const key = sameNote ? 60 : 61;
                player.events([midi(0x90, key, 127, 0, 2)]);
                let audio;
                for (let block = 0; block < 3; block++) audio = player.render();
                assert.ok(Math.abs(peak(audio) - .5) < 1e-5,
                    'Only the new voice and the unaffected other-channel voice remain');
                player.events([midi(0x80, key, 0, 0, 2)]);
                for (let block = 0; block < 3; block++) audio = player.render();
                assert.ok(Math.abs(peak(audio) - .5) < 1e-5,
                    'Physical note-off cannot prematurely stop either one-shot');
            } finally { player.close(); }
        });
    }
}
