import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { compileAcceptanceInstrument, openAcceptancePlayer, midiMessage as midi, silentBlock } from '../helpers/sfz-native-acceptance.mjs';
import { createSfzSentinelFixture } from '../../tools/generate-sfz-sentinel-fixture.mjs';
import { TelemetryHub } from '../../js/audio/telemetry-hub.js';
import { decodeTelemetryPacket } from '../../dsp/bindings/js/src/telemetry.js';

// These cases require the coherent extended-family publication. They deliberately
// do not skip missing consumers or claim old artifacts implement new contracts.
for (const variant of ['baseline', 'simd']) {
    test(`real ${variant} authored oscillator tuning and checkpoint reattack retain playable note identity`, async () => {
        const asset = await compileAcceptanceInstrument('<global> global_tune=1200 <region> sample=*sine key=69 ' +
            'oscillator_phase=90 amp_veltrack=0 ampeg_release=.001');
        const player = await openAcceptancePlayer(variant, asset);
        try {
            player.events([midi(0x90, 69, 127, 0, 9)]);
            const audio = new Float32Array(9600);
            for (let frame = 0; frame < audio.length; frame += 128)
                audio.set(player.render().subarray(0, Math.min(128, audio.length - frame)), frame);
            let crossings = 0;
            for (let frame = 1; frame < audio.length; frame++)
                if (audio[frame - 1] <= 0 && audio[frame] > 0) crossings++;
            assert.ok(Math.abs(crossings - 176) <= 1, 'A4 raised1200cents must produce880Hz');
            player.events([], 16);
            player.render();
            const checkpoint = player.binding.instanceWriteMidiCheckpoint(player.id);
            player.reset({ running: false });
            assert.equal(player.binding.instanceReadMidiCheckpoint(player.id, checkpoint), 0);
            // A paused checkpoint resumes with the same timed marker used by
            // MidiFrameScheduler; REATTACK alone is for a completed seek.
            player.events([{ ...midi(0, 0, 0), flags: 32,
                renderFrame: player.binding.instanceMidiClock(player.id).frame }]);
            const restored = player.render();
            assert.ok(restored.some(value => Math.abs(value) > .01), 'held source can reattack after checkpoint restore');
            // Reattack need not retain oscillator phase. Physical note ownership
            // must survive, so its original note-off cannot leave a stuck source.
            player.events([midi(0x80, 69, 0, 0, 9)]);
            for (let block = 0; block < 8; block++) player.render();
            assert.ok(silentBlock(player.render()));
        } finally { player.close(); }
    });

    for (const equalized of [false, true]) test(`real ${variant} high-resolution initialization, velocity and crossfade ${equalized ? 'with EQ' : 'amplifier'} shape actual audio`, async () => {
        const pcm = Float32Array.from({ length: 480 }, (_, frame) => .25 * Math.sin(2 * Math.PI * frame / 48));
        const samples = () => new Map([['tone.wav', { sampleRate: 48000, channels: [pcm] }]]);
        const base = '<region> sample=tone.wav lokey=60 hikey=72 loop_mode=loop_continuous pitch_keytrack=0 amp_veltrack=0';
        const plain = await openAcceptancePlayer(variant, await compileAcceptanceInstrument(base, { samples: samples() }));
        const shaped = await openAcceptancePlayer(variant, await compileAcceptanceInstrument('<control> set_hdcc1=.501 ' + base +
            ' amp_veltrack=100 amp_velcurve_032=.5 xfin_lokey=60 xfin_hikey=72 xf_keycurve=gain phase=invert ' +
            'volume_oncc1=20' + (equalized ? ' eq1_type=peak eq1_freq=1000 eq1_bw=1 eq1_gain=6 eq1_dynamic=1' : ''), { samples: samples() }));
        try {
            plain.events([midi(0x90, 66, 32, 0, 1)]); shaped.events([midi(0x90, 66, 32, 0, 1)]);
            let reference, actual;
            for (let block = 0; block < 24; block++) { reference = plain.render(); actual = shaped.render(); }
            const ratio = -.5 * .5 * 10 ** (((equalized ? 6 : 0) + .501 * 20) / 20);
            let error = 0, energy = 0;
            for (let frame = 0; frame < 128; frame++) {
                error += (actual[frame] - reference[frame] * ratio) ** 2;
                energy += reference[frame] ** 2;
            }
            assert.ok(energy > .001);
            assert.ok(Math.sqrt(error / energy) < .005, 'authored amplitude factors and optional1000Hz peak EQ match their physical gain');
        } finally { plain.close(); shaped.close(); }
    });

    test(`real ${variant} controller actions ignore historical hydration and need no note-on`, async () => {
        const asset = await compileAcceptanceInstrument('<region> sample=tone.wav key=-1 loop_mode=loop_continuous amp_veltrack=0 ' +
            'on_lohdcc20=1 on_hihdcc20=1 stop_locc21=127 stop_hicc21=127 ampeg_release=.001');
        const player = await openAcceptancePlayer(variant, asset);
        try {
            player.events([midi(0x90, 60, 127, 0, 1)]);
            assert.ok(silentBlock(player.render()), 'controller-only region cannot answer ordinary notes');
            player.events([midi(0xb0, 20, 127)], 512);
            assert.ok(silentBlock(player.render()), 'latejoin persistent state does not replay start actions');
            player.events([midi(0xb0, 20, 127, 37)]);
            const started = player.render();
            assert.ok(silentBlock(started.subarray(0, 37)));
            assert.ok(started.subarray(50, 128).some(value => value > .01), 'received controller starts audio at its sample offset');
            player.events([midi(0xb0, 21, 127)], 512);
            assert.ok(player.render().subarray(0, 128).some(value => value > .01), 'hydration does not replay stop actions');
            player.events([midi(0xb0, 21, 127, 53)]);
            player.render();
            for (let block = 0; block < 4; block++) player.render();
            assert.ok(silentBlock(player.render()), 'accepted stop event releases without a MIDI note');
        } finally { player.close(); }
    });

    test(`real ${variant} sentinel choke performs group action and leaves no silent voice`, async () => {
        for (const name of ['MuteCC', 'MuteNote', 'SilentOnly']) {
            const player = await openAcceptancePlayer(variant, await createSfzSentinelFixture(name));
            try {
                player.events([midi(0x90, 60, 127, 0, 1)]);
                player.render();
                const before = player.render();
                assert.equal(silentBlock(before), name === 'SilentOnly');
                player.events([name === 'MuteNote' ? midi(0x90, 61, 127, 0, 2) : midi(0xb0, 64, 127)]);
                for (let block = 0; block < 8; block++) player.render();
                assert.ok(silentBlock(player.render()), `${name} must finish its group choke`);
                const packet = new Uint8Array(262144), count = player.binding.telemetryRead(packet);
                const view = new DataView(packet.buffer);
                let voices;
                for (let at = 0; at + 16 <= count;) {
                    const length = view.getUint16(at + 12, true);
                    assert.ok(at + 16 + length <= count);
                    if (view.getUint16(at, true) === 30) voices = view.getUint16(at + 16, true);
                    at += (16 + length + 3) & ~3;
                }
                assert.equal(voices, 0, 'actual voice telemetry must show no retained silent action');
            } finally { player.close(); }
        }
    });

    test(`real ${variant} full-width controller offset selects the exact streamed birth frame`, async () => {
        const frames = 16777280;
        const asset = await compileAcceptanceInstrument('<region> sample=large.wav key=60 amp_veltrack=0 ' +
            'sample_quality=1 pitch_keytrack=0 transpose=-120 offset_oncc20=16777217', {
            stream: true, samples: new Map([['large.wav', { frames, channels: 1, sampleRate: 48000, revision: 'a'.repeat(64) }]])
        });
        const player = await openAcceptancePlayer(variant, asset, { initialize(binding, id) {
            assert.equal(binding.configureSfzSampleStream(id, 41), 0);
            for (const pageIndex of [0, 4095, 4096]) {
                const length = Math.min(4096, frames - pageIndex * 4096), pcm = new Float32Array(length).fill(.25);
                if (pageIndex === 4096) pcm[0] = -.25;
                assert.equal(binding.publishSfzSamplePage(id, { generation: 41, sample: 0, pageIndex,
                    pcm, frames: length, channels: 1, resident: true }), 0);
            }
        } });
        try {
            player.events([midi(0xb0, 20, 127), midi(0x90, 60, 127, 0, 1)]);
            const block = player.render();
            assert.ok(block.subarray(8, 32).every(value => value > .01),
                '16777217 must not round to the negative sample at16777216');
            assert.deepEqual(player.binding.takeSfzSampleRequests(player.id), [], 'bounded prepared target pages suffice');
        } finally { player.close(); }
    });

    test(`real ${variant} accepted keyswitch telemetry reaches the SDK and current instrument label`, async () => {
        const asset = await compileAcceptanceInstrument('<region> sample=tone.wav key=60 sw_lokey=24 sw_hikey=25 sw_last=24 sw_label=Legato');
        const player = await openAcceptancePlayer(variant, asset);
        const port = {}, hub = new TelemetryHub({ port, now: () => 0, schedule: () => 1, cancel: () => {} });
        assert.equal(player.binding.instanceSetTap(player.id, player.id), 0);
        assert.equal(player.binding.setTelemetryRate(60), 0);
        const window = { dspTelemetryHub: hub };
        class PluginBase { constructor() { this.enabled = true; } onMessage() {} }
        vm.runInNewContext(fs.readFileSync(new URL('../../plugins/sfz-instrument.js', import.meta.url), 'utf8'), { window, PluginBase });
        const plugin = new window.SFZInstrumentPlugin();
        plugin.id = player.id; plugin.getWasmAssetOperationRevision = () => 1;
        plugin._wasmAssetStates = new Map([[0, 3]]); plugin._wasmAssetLogicalReplayEpochs = new Map([[0, 1]]);
        plugin._instrumentPresentation = asset.parsed.presentation;
        plugin._currentSwitchLabels = { textContent: '', hidden: true };
        plugin._ensureSwitchTelemetrySubscription();
        try {
            player.events([midi(0x92, 24, 100, 0, 1)]);
            let accepted;
            for (let quantum = 0; quantum < 32 && !accepted; quantum++) {
                player.render();
                const packet = new Uint8Array(262144), bytes = player.binding.telemetryRead(packet);
                const decoded = decodeTelemetryPacket(packet, bytes,
                    new Map([[player.id, { effectType: 'SoundFontPlayer', effectId: 'player', effectIndex: 0 }]]), 0);
                accepted = decoded.frames.find(frame => frame.kind === 'sfz-keyswitches' && frame.keys[2] === 24);
                hub.handleMessage({ type: 'dspTelemetry', packet: packet.buffer, bytes, recycle: false }, port);
            }
            assert.ok(accepted, 'actual native frame34 must carry the accepted channel3 switch');
            assert.equal(plugin._activeSwitches[2], 24);
            assert.match(plugin._currentSwitchLabels.textContent, /Channel 3: Legato/);
            assert.equal(plugin._currentSwitchLabels.hidden, false);
        } finally { plugin._switchSubscription?.unsubscribe(); hub.clearVisualSyncQueue(); player.close(); }
    });
}
