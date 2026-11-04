import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizeMidiDrumMode } from '../../js/midi/system-reset.js';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { MidiInputState, restoreMidiState } from '../../js/midi/smf-timeline.js';
import { MIDI_DRUM_MODE } from '../../js/midi/smf-scheduler.js';
import { MidiLiveInput } from '../../js/midi/live-input.js';

const gs = (part, mode) => [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x10 | part, 0x15, mode,
    (128 - ((0x40 + (0x10 | part) + 0x15 + mode) & 127)) & 127, 0xf7];
const xg = (part, mode) => [0xf0, 0x43, 0x10, 0x4c, 8, part, 7, mode, 0xf7];
function song(packets) {
    const track = packets.flatMap(packet => [0, 0xf0, packet.length - 1, ...packet.slice(1)]);
    track.push(0x83, 0x60, 255, 47, 0);
    return parseSmf(Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
        77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track]));
}

test('GS block addressing and XG part modes normalize all 16 parts, including melodic return', () => {
    for (let part = 0; part < 16; part++) {
        const channel = part === 0 ? 9 : part <= 9 ? part - 1 : part;
        for (let mode = 0; mode <= 2; mode++) assert.deepEqual(recognizeMidiDrumMode(gs(part, mode)), { channel, mode });
        for (let mode = 0; mode <= 3; mode++) assert.deepEqual(recognizeMidiDrumMode(xg(part, mode)), { channel: part, mode });
    }
    for (const packet of [gs(1, 3), xg(16, 1), xg(1, 4), gs(1, 1).slice(0, -1), xg(1, 1).slice(1)])
        assert.equal(recognizeMidiDrumMode(packet), null);
    const invalid = gs(1, 1); invalid[9] ^= 1;
    assert.equal(recognizeMidiDrumMode(invalid), null);
    assert.equal(song([invalid, xg(1, 4)]).events.length, 0);
});

test('SMF retains ordered drum state for seek and bounded live hydration; reset restores channel10', () => {
    const timeline = song([gs(1, 2), xg(10, 3), xg(9, 0)]);
    assert.deepEqual(timeline.events.map(event => event.drumMode), [
        { channel: 0, mode: 2 }, { channel: 10, mode: 3 }, { channel: 9, mode: 0 }
    ]);
    const state = restoreMidiState(timeline, .1);
    assert.deepEqual([state.channels[0].drumMode, state.channels[9].drumMode, state.channels[10].drumMode], [2, 0, 3]);
    assert.equal(timeline.displayEvents.filter(event => event.type === 'sysex').length, 3);
    const live = new MidiInputState();
    for (const event of timeline.events) live.apply(event);
    assert.deepEqual(live.hydration().filter(event => event.flags === MIDI_DRUM_MODE).map(event => [event.data1, event.data2]),
        [[0, 2], [9, 0], [10, 3]]);
    live.apply({ seconds: 1, systemReset: 2 });
    assert.equal(live.hydration().filter(event => event.flags === MIDI_DRUM_MODE).length, 0);
    assert.deepEqual([live.channels[0].drumMode, live.channels[9].drumMode, live.channels[10].drumMode], [0, 1, 0]);
});

test('live GS/XG designation follows input ownership and invalid packets leave state unchanged', async () => {
    const state = new MidiInputState(), port = {}, messages = [];
    const input = new MidiLiveInput({ manager: {
        onChange: () => () => {}, findInput: () => port, setPerformanceInput: async () => {}
    }, audioManager: { setLiveMidiInputSource() {}, enqueueLiveMidiInput(event) {
        messages.push(event); state.apply({ ...event, seconds: 0 });
    } } });
    await input.select('source');
    const send = data => input.onMessage({ data, timeStamp: 0, sourceKey: 'source', port });
    send(gs(1, 2)); send(xg(10, 3)); send(xg(9, 0));
    const before = state.hydration();
    const invalid = gs(1, 0); invalid[9] ^= 1;
    send(invalid); send(xg(1, 4));
    assert.equal(messages.length, 3);
    assert.deepEqual(state.hydration(), before);
    assert.deepEqual(messages[0].data, Uint8Array.of(0, 0, 2));
    input.dispose();
});
