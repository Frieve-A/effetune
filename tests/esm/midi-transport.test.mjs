import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiFrameScheduler, validateMidiSchedule } from '../../js/midi/smf-scheduler.js';
import { prepareOfflineMidiSession } from '../../js/audio/midi-offline.js';
import { WebMetadataParser } from '../../js/library/scan/web-metadata-parser.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset, sfzAssetTailSeconds } from '../../js/sfz/asset.js';

const event = (seconds, status = 0x90, data1 = 60, data2 = 100) => ({ seconds, status, data1, data2 });
function binding() {
    const calls = [];
    return { calls, instanceLatency: () => 0, instanceSetMidiGain(id, gain) { calls.push({ id, gain }); return 0; },
        instanceSetMidiEvents(id, events, generation, flags, count = events.length) {
            calls.push({ id, events: events.slice(0, count).map(value => ({ ...value })), generation, flags });
            return 0;
        } };
}

function timedBinding() {
    const host = binding();
    host.pending = false;
    host.instanceMidiState = () => host.pending ? 16 : 0;
    host.instanceSetMidiClock = (id, frame, generation, flags) => {
        host.calls.push({ id, clock: frame, generation, clockFlags: flags });
        return 0;
    };
    return host;
}

test('a live availability join hydrates all channel transactions without past notes or history clocks, then delivers only future events', () => {
    const scheduler = new MidiFrameScheduler(1000), host = timedBinding();
    const settings = Array.from({ length: 16 }, (_, channel) => [
        event(0, 0xb0 | channel, 0, channel), event(0, 0xc0 | channel, channel + 1, 0),
        event(0, 0xb0 | channel, 7, 80), event(0, 0xb0 | channel, 101, 0),
        event(0, 0xb0 | channel, 100, 0), event(0, 0xb0 | channel, 6, 12),
        event(0, 0xe0 | channel, 0, 80)]).flat();
    scheduler.configure({ timeline: { events: [...settings, event(.01, 0x90, 60), event(.6, 0x9f, 72)], duration: 1 },
        generation: 7, playing: true });
    scheduler.register('late', 1);
    scheduler.joinLiveInstance('late');
    assert.equal(scheduler.processInstance(host, 'late', 500, 50), true);
    const hydration = host.calls.filter(call => call.flags === 512).flatMap(call => call.events);
    assert.deepEqual(hydration.map(({ status, data1, data2 }) => ({ status, data1, data2 })),
        settings.map(({ status, data1, data2 }) => ({ status, data1, data2 })));
    assert.ok(hydration.every(value => (value.status & 0xf0) !== 0x90));
    assert.equal(host.calls.some(call => call.flags === 2 || call.clockFlags === 2), false);
    assert.deepEqual(host.calls.find(call => call.flags === 0).events.map(value => [value.flags, value.renderFrame]), [[32, 0]]);
    scheduler.processInstance(host, 'late', 600, 50);
    const future = host.calls.findLast(call => call.flags === 0).events;
    assert.deepEqual(future.map(value => [value.status, value.data1, value.renderFrame]), [[0x9f, 72, 100]]);
    assert.equal(scheduler.generation, 7);
    assert.equal(scheduler.currentPosition(650), .65);
});

test('live hydration stays bounded while the song advances and pauses safely without waiting for sample availability', () => {
    const scheduler = new MidiFrameScheduler(1000), host = timedBinding();
    scheduler.configure({ timeline: { events: [...Array.from({ length: 700 }, () => event(.01)), event(.7, 0x90, 72)], duration: 1 },
        generation: 1, playing: true });
    scheduler.register('late', 1); scheduler.joinLiveInstance('late');
    for (const frame of [400, 450]) {
        const before = scheduler.instances.get('late').cursor;
        assert.equal(scheduler.processInstance(host, 'late', frame, 50, 0, true, false), false);
        assert.ok(scheduler.instances.get('late').cursor - before <= 256);
        assert.equal(scheduler.playing, true);
    }
    scheduler.requestPause(2, 550);
    scheduler.processInstance(host, 'late', 550, 50, 0, true, false);
    assert.equal(scheduler.finishPause(600).position, .55);
    assert.equal(scheduler.instances.get('late').clockFrame, 0);
    assert.equal(host.calls.some(call => call.flags === 0 || call.clockFlags === 2), false);
    const cursor = scheduler.instances.get('late').cursor;
    scheduler.configure({ generation: 3, position: .55, mode: 'resume', preparing: true });
    scheduler.restoreInstanceState('late', { cursor, clockFrame: 0 });
    scheduler.processInstance(host, 'late', 600, 50);
    scheduler.start(3, 1000);
    scheduler.processInstance(host, 'late', 1000, 50);
    assert.deepEqual(host.calls.findLast(call => call.flags === 0).events.map(value => [value.flags, value.renderFrame]), [[32, 0]]);
});

test('a worklet with no eligible instrument still acknowledges the common pause boundary at its source frame', () => {
    const scheduler = new MidiFrameScheduler(1000), host = timedBinding();
    scheduler.register('inactive', 1);
    scheduler.configure({ timeline: { events: [], duration: 1 }, generation: 1, playing: true });
    scheduler.processInstance(host, 'inactive', 0, 16, 0, false);
    scheduler.requestPause(2, 50);
    scheduler.processInstance(host, 'inactive', 16, 16, 0, false);
    assert.equal(scheduler.finishPause(32), null);
    assert.equal(scheduler.finishPause(50).position, .05);
});

test('timed history waits for native progress and advances only through the queued slice before the final target', () => {
    const scheduler = new MidiFrameScheduler(1000), host = timedBinding();
    scheduler.register('one', 1);
    const events = Array.from({ length: 600 }, (_, index) => event(index / 1000, 0xb0, 1, index % 128));
    events.push(event(1));
    scheduler.configure({ timeline: { events, duration: 2 }, position: 1, generation: 1, preparing: true });
    assert.equal(scheduler.processInstance(host, 'one', 0, 16), false);
    assert.equal(host.calls.at(-1).clock, 255);
    host.pending = true;
    const sent = host.calls.length;
    assert.equal(scheduler.processInstance(host, 'one', 16, 16), false);
    assert.equal(host.calls.length, sent + 1, 'Only gain refresh is allowed while history is pending');
    host.pending = false;
    assert.equal(scheduler.processInstance(host, 'one', 32, 16), false);
    assert.equal(host.calls.at(-1).clock, 511);
    assert.equal(scheduler.processInstance(host, 'one', 48, 16), true);
    const historyClocks = host.calls.filter(call => call.clockFlags === 2).map(call => call.clock);
    assert.deepEqual(historyClocks, [255, 511, 599, 1000]);
    const restored = host.calls.filter(call => call.flags === 2).flatMap(call => call.events);
    assert.equal(restored.length, 600);
    assert.equal(restored.at(-1).renderFrame, 599);
    scheduler.start(1, 1000);
    scheduler.processInstance(host, 'one', 992, 16);
    const live = host.calls.filter(call => call.flags === 0).at(-1).events;
    assert.deepEqual(live.map(value => [value.flags, value.offsetFrames, value.renderFrame]), [[4, 8, 1000], [0, 8, 1000]]);
    assert.equal(scheduler.instances.get('one').clockFrame, 1008);
});

test('timed pause freezes the VM clock, resume activates at an exact offset, and speed preserves deadlines', () => {
    const scheduler = new MidiFrameScheduler(1000), host = timedBinding();
    scheduler.register('one', 1);
    scheduler.configure({ timeline: { events: [event(0), event(.2)], duration: 1 }, generation: 1, playing: true });
    scheduler.processInstance(host, 'one', 0, 10);
    scheduler.setSpeed(2, .01, 10);
    scheduler.processInstance(host, 'one', 10, 10);
    assert.ok(host.calls.some(call => call.flags === 64));
    assert.equal(host.calls.filter(call => call.flags === 1).length, 1);
    assert.equal(scheduler.instances.get('one').clockFrame, 20);
    scheduler.configure({ generation: 2, position: .03, speed: 2, mode: 'pause' });
    scheduler.processInstance(host, 'one', 20, 10);
    scheduler.processInstance(host, 'one', 1000, 128);
    assert.equal(host.calls.at(-1).clock, 20);
    assert.equal(host.calls.at(-1).clockFlags, 0);
    scheduler.configure({ generation: 3, position: .03, speed: 2, preparing: true, mode: 'resume' });
    scheduler.processInstance(host, 'one', 1000, 128);
    scheduler.start(3, 2000);
    scheduler.processInstance(host, 'one', 1992, 16);
    const resumed = host.calls.filter(call => call.flags === 0).at(-1).events;
    assert.deepEqual(resumed.map(value => [value.flags, value.offsetFrames, value.renderFrame]), [[32, 8, 20]]);
    scheduler.processInstance(host, 'one', 2008, 8);
    assert.equal(host.calls.findLast(call => call.clockFlags === 1).clock, 28);
    assert.equal(host.calls.filter(call => call.flags === 2).length, 0, 'Resume does not replay callbacks');
});

test('timed natural EOF drains without fabricated controller callbacks while a new song and Stop reset', () => {
    const scheduler = new MidiFrameScheduler(1000), host = timedBinding();
    scheduler.register('one', 1);
    scheduler.configure({ timeline: { events: [event(0)], duration: .009 }, generation: 1, playing: true });
    scheduler.processInstance(host, 'one', 0, 16);
    const live = host.calls.find(call => call.flags === 0).events;
    assert.deepEqual(live.map(value => value.flags), [4, 0, 128]);
    assert.equal(live.at(-1).offsetFrames, 9);
    assert.ok(live.every(value => (value.status & 0xf0) !== 0xb0));
    scheduler.configure({ generation: 2, position: .009, mode: 'drain' });
    scheduler.processInstance(host, 'one', 16, 16);
    assert.ok(host.calls.some(call => call.flags === 128));
    assert.equal(host.calls.at(-1).clockFlags, 1);
    assert.equal(host.calls.at(-1).clock, 16);
    scheduler.configure({ generation: 3, position: 0 });
    scheduler.processInstance(host, 'one', 32, 16);
    assert.equal(host.calls.at(-1).clock, 0);
    assert.equal(host.calls.filter(call => call.flags === 1).length, 2);
});

test('MIDI scheduler keeps exact offsets, upstream latency, speed and independent instance delivery', () => {
    const scheduler = new MidiFrameScheduler(1000);
    const host = binding();
    scheduler.register('one', 1); scheduler.register('two', 2);
    scheduler.configure({ timeline: { events: [event(.003), event(.007, 0x80, 60, 0)], duration: .1 },
        generation: 1, playing: true, anchorFrame: 100, speed: 2, gain: .4 });
    scheduler.processInstance(host, 'one', 100, 5);
    scheduler.processInstance(host, 'two', 100, 5, 3);
    const first = host.calls.find(call => call.id === 1 && call.flags === 0);
    assert.deepEqual(first.events.map(value => value.offsetFrames), [2, 4]);
    assert.equal(host.calls.some(call => call.id === 2 && call.flags === 0), false);
    scheduler.processInstance(host, 'two', 105, 5, 3);
    assert.deepEqual(host.calls.filter(call => call.id === 2 && call.flags === 0).at(-1).events
        .map(value => value.offsetFrames), [0, 2]);
    assert.equal(host.calls.find(call => call.gain !== undefined).gain, .4);
});

test('MIDI seek replays bounded silent history then reattacks once, keeping exact-target events separate', () => {
    const scheduler = new MidiFrameScheduler(1000);
    const host = binding();
    scheduler.register('one', 1);
    const history = Array.from({ length: 600 }, (_, index) => event(index / 1000, 0xb0, 1, index % 128));
    scheduler.configure({ timeline: { events: [...history, event(1)], duration: 2 }, position: 1,
        anchorFrame: 1000, generation: 2, playing: true });
    assert.equal(scheduler.processInstance(host, 'one', 0, 16), false);
    assert.equal(scheduler.processInstance(host, 'one', 16, 16), false);
    assert.equal(scheduler.processInstance(host, 'one', 32, 16), true);
    assert.deepEqual(host.calls.filter(call => call.flags === 2).map(call => call.events.length), [256, 256, 88]);
    assert.equal(host.calls.filter(call => call.flags === 4).length, 0);
    assert.equal(host.calls.filter(call => call.flags === 0).length, 0);
    scheduler.processInstance(host, 'one', 1000, 16);
    assert.equal(host.calls.filter(call => call.flags === 0).at(-1).events[0].flags, 4);
    assert.equal(host.calls.filter(call => call.flags === 0).at(-1).events[1].data1, 60);
    scheduler.configure({ generation: 3, position: 0, playing: false });
    scheduler.processInstance(host, 'one', 1016, 16);
    assert.equal(host.calls.at(-2).flags, 1);
    assert.equal(scheduler.configure({ generation: 2, playing: true }), false);
});

test('MIDI natural end releases every channel and preserve-release reset differs from explicit Stop', () => {
    const scheduler = new MidiFrameScheduler(1000), host = binding();
    scheduler.register('one', 1);
    scheduler.configure({ timeline: { events: [event(0)], duration: .009 }, generation: 1, playing: true });
    scheduler.processInstance(host, 'one', 0, 16);
    const end = host.calls.find(call => call.flags === 0).events;
    assert.equal(end.length, 49);
    assert.equal(end.at(-1).offsetFrames, 9);
    assert.equal(end.at(-1).status, 0xbf);
    scheduler.configure({ generation: 2, preserveRelease: true });
    scheduler.processInstance(host, 'one', 16, 16);
    assert.equal(host.calls.at(-2).flags, 9);
});

test('MIDI scheduling rejects a whole over-dense block instead of dropping Note Off events', () => {
    assert.throws(() => validateMidiSchedule({ events: Array.from({ length: 4100 }, () => event(0)) }, 48000),
        { code: 'midi-too-dense' });
});

test('offline tail bounds include serial zero-feedback delays, regardless of temporary silence', () => {
    class SoundFontPlayerPlugin {}
    class DelayPlugin {}
    const sfz = Object.assign(new SoundFontPlayerPlugin(), { id: 1, enabled: true, getParameters: () => ({}) });
    const delays = [2, 3].map(id => Object.assign(new DelayPlugin(), { id, enabled: true,
        getParameters: () => ({ pd: 0, ds: 5000, fb: 0 }) }));
    const entry = { typeName: 'SoundFontPlayerPlugin', plugin: sfz, instanceId: 1, offlineAssetsReady: true,
        offlineState: { assets: new Map([[0, { tailSeconds: .2 }]]) } };
    const session = { entries: new Map([[sfz, entry]]), binding: binding() };
    const midi = prepareOfflineMidiSession(session, { events: [], duration: 1 }, [sfz, ...delays], 1000);
    assert.ok(midi.tailSeconds > 10.2);
    assert.equal(midi.tailLimitReached, false);
    delays[0].getParameters = () => ({ pd: 0, ds: 5000, fb: 100 });
    const uncertain = prepareOfflineMidiSession(session, { events: [], duration: 1 }, [sfz, ...delays], 1000);
    assert.equal(uncertain.tailSeconds, 120);
    assert.equal(uncertain.tailLimitReached, true);
});

test('offline tail proof includes bank Data Entry defaults and refuses unknown or infinite late voices', async () => {
    const asset = async opcodes => {
        const parsed = await parseSfz({ selectedPath: 'tail.sfz', readText: async () =>
            `<region> sample=tone.wav key=60 ${opcodes}`, hasSample: () => true, onDiagnostic: null });
        return packSfzAsset(parsed.regions, new Map([['tone.wav', {
            channels: [new Float32Array(1000).fill(.25)], sampleRate: 1000
        }]]));
    };
    const bank = await asset('loop_mode=one_shot set_cc6=12');
    assert.ok(bank.tailSeconds < 1.2);
    assert.ok(sfzAssetTailSeconds(bank.payload, { coarse: 0, fine: 50 }) > 2,
        'a later CC38 can combine with the bank initial CC6 to extend playback');
    const unknown = bank.payload.slice(0);
    new Uint32Array(unknown, 32)[1]++;
    assert.equal(sfzAssetTailSeconds(unknown), null);
    const infinite = await asset('on_locc1=1 on_hicc1=127 loop_mode=loop_continuous');
    assert.equal(infinite.tailSeconds, null);
});

test('MIDI metadata shares SMF duration and leaves audio-only fields empty without invoking audio parsing', async () => {
    const track = [0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0, 255, 47, 0];
    const file = new Blob([Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
        77, 84, 114, 107, 0, 0, 0, track.length, ...track])]);
    const parser = new WebMetadataParser({ filesystem: { getFile: async () => file },
        parse: () => assert.fail('MIDI must not use the audio metadata decoder') });
    const metadata = await parser.parse({ relativePath: 'song.midi', skipCovers: true });
    assert.equal(metadata.durationSec, .5);
    assert.equal(metadata.title, 'song');
    for (const field of ['sampleRate', 'bitrate', 'bitsPerSample', 'channels']) assert.equal(metadata[field], null);
});


test('a hundred thousand old MIDI events prepare at a frozen seek target before the frame clock starts', () => {
    const scheduler = new MidiFrameScheduler(48000), host = binding();
    scheduler.register('one', 1);
    const events = Array.from({ length: 100000 }, (_, index) => event(index / 1000, 0xb0, 1, index % 128));
    events.push(event(100));
    scheduler.configure({ timeline: { events, duration: 101 }, generation: 1, position: 100,
        preparing: true, playing: false });
    let frame = 0;
    while (!scheduler.processInstance(host, 'one', frame, 128)) {
        frame += 128;
        assert.equal(scheduler.currentPosition(frame), 100);
    }
    assert.equal(host.calls.filter(call => call.flags === 0).length, 0);
    assert.ok(host.calls.filter(call => call.flags === 2).every(call => call.events.length <= 256));
    assert.equal(scheduler.start(0, frame), false);
    assert.equal(scheduler.start(1, frame + 256), true);
    scheduler.processInstance(host, 'one', frame, 128);
    assert.equal(host.calls.filter(call => call.flags === 0).length, 0);
    scheduler.processInstance(host, 'one', frame + 256, 128, 7);
    const played = host.calls.filter(call => call.flags === 0).at(-1).events;
    assert.deepEqual(played.map(value => [value.offsetFrames, value.flags, value.status]), [[7, 4, 0], [7, 0, 0x90]]);
});
