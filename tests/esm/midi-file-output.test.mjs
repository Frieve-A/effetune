import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { MidiFileOutput } from '../../js/midi/midi-file-output.js';
import { MidiControllerManager } from '../../js/midi/midi-controller-manager.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';

const u16 = value => [value >> 8 & 255, value & 255];
const u32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const text = value => [...new TextEncoder().encode(value)];
const event = (delta, ...bytes) => [...(delta < 128 ? [delta] : [delta >> 7 | 128, delta & 127]), ...bytes];
const smf = track => new Uint8Array([...text('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(480),
    ...text('MTrk'), ...u32(track.length + 4), ...track, 0, 255, 47, 0]);
const GM_RESET = [0x7e, 0x7f, 9, 1, 0xf7];
const PART = [0x43, 0x10, 0x4c, 8, 0, 7, 1, 0xf7];

// 120 BPM: 480 ticks are 0.5 s. Reset, program and volume precede two notes.
const timeline = parseSmf(smf([
    ...event(0, 0xf0, GM_RESET.length, ...GM_RESET), ...event(0, 0xc0, 5), ...event(0, 0xb0, 7, 90),
    ...event(0, 0xf7, 2, 0x43, 0xf7), ...event(0, 0xf0, 3, 1, 0x80, 0xf7), ...event(0, 0xf0, 2, 1, 2),
    ...event(240, 0xf0, PART.length, ...PART), ...event(240, 0x90, 60, 100), ...event(480, 0x80, 60, 0),
    ...event(480, 0x90, 62, 100), ...event(480, 0x80, 62, 0)
]));

function harness({ port = true } = {}) {
    const sent = [], clock = { now: 1000 };
    const device = { send(data, timestamp) { sent.push([[...data], timestamp]); } };
    const state = { port: port ? device : null };
    // Render context time zero is heard at performance time 1000 ms.
    const output = new MidiFileOutput({ getOutput: () => state.port, getClockOffset: () => 1000, now: () => clock.now });
    return { output, sent, clock, state, device };
}

test('the parser keeps complete raw SysEx beside the typed reset markers', () => {
    assert.deepEqual(timeline.sysex.map(item => [item.seconds, [...item.data]]),
        [[0, [0xf0, ...GM_RESET]], [.25, [0xf0, ...PART]]], 'escapes, invalid bytes and split packets are not kept');
    assert.ok(timeline.events.some(item => item.status === 0 && item.systemReset), 'scheduler markers are unchanged');
    assert.equal(parseSmf(smf([...event(0, 0x90, 60, 1), ...event(1, 0x80, 60, 0)])).sysex, undefined);
});

test('playback sends file messages within the lookahead at the audible time for the current speed', () => {
    const h = harness();
    h.output.start(timeline, { position: 0, anchorTime: 0, speed: 2, generation: 7 });
    assert.deepEqual(h.sent, [[[0xf0, ...GM_RESET], 1000], [[0xc0, 5], 1000], [[0xb0, 7, 90], 1000]],
        'status-0 markers are not sent and program changes are two bytes');
    h.clock.now = 1100;
    h.output.pump(8);
    assert.equal(h.sent.length, 3, 'a stale generation sends nothing');
    h.output.pump(7);
    assert.deepEqual(h.sent.slice(3), [[[0xf0, ...PART], 1125]]);
    h.clock.now = 1200;
    h.output.pump(7);
    assert.deepEqual(h.sent.at(-1), [[0x90, 60, 100], 1250]);
    // At context time 0.3 s the file is at 0.6 s; from there it advances at normal speed.
    h.output.retime(.3, 1);
    h.clock.now = 1650;
    h.output.pump(7);
    assert.deepEqual(h.sent.at(-1), [[0x80, 60, 0], 1700]);
});

test('stopping releases held notes, then sustain and all notes after queued messages', () => {
    const h = harness();
    h.clock.now = 800;
    h.output.start(timeline, { position: .5, anchorTime: 0, speed: 1, generation: 1 });
    h.sent.length = 0;
    h.clock.now = 950;
    h.output.pump(1);
    assert.deepEqual(h.sent, [[[0x90, 60, 100], 1000]]);
    h.output.stop();
    assert.deepEqual(h.sent[1], [[0x80, 60, 0], 1000]);
    assert.deepEqual(h.sent.slice(2, 5), [[[0xb0, 121, 0], 1000], [[0xb0, 64, 0], 1000], [[0xb0, 123, 0], 1000]]);
    assert.equal(h.sent.length, 2 + 48);
    h.output.pump(1);
    assert.equal(h.sent.length, 50, 'a stopped run sends nothing more');
    // Seeking restarts from the new position, so the previous run is silenced first.
    h.output.start(timeline, { position: .5, anchorTime: 0, speed: 1, generation: 2 });
    const seek = h.sent.length;
    h.output.start(timeline, { position: 1.2, anchorTime: 0, speed: 1, generation: 3 });
    assert.deepEqual(h.sent[seek][0], [0x80, 60, 0]);
    // A note queued ahead of the clock is released at its own time; the restarted
    // run's chase and events must follow that release on the device.
    h.clock.now = 1040;
    const before = h.sent.length;
    h.output.start(timeline, { position: .45, anchorTime: 0, speed: 1, generation: 4 });
    const reset = h.sent.slice(before).find(([data]) => data[0] === 0xf0 && data[1] === 0x7e);
    const afterReset = h.sent.slice(h.sent.indexOf(reset) + 1);
    assert.ok(afterReset.every(([, timestamp]) => timestamp - reset[1] >= 100), 'state waits for the queued reset to settle');
    assert.deepEqual(h.sent.at(-1), [[0x90, 60, 100], 1300], 'the note follows the settling chase');
    const restart = h.sent.length;
    h.output.start(timeline, { position: 0, anchorTime: 0, speed: 1, generation: 5 });
    const stamps = h.sent.slice(restart).map(([, timestamp]) => timestamp);
    assert.equal(h.sent[restart][1], 1300,'the release follows the queued note');
    assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b), 'the new run never precedes the old release');
});

test('starting mid-file chases SysEx, program and controllers without notes', () => {
    const h = harness();
    h.output.start(timeline, { position: 1.2, anchorTime: 0, speed: 1, generation: 1 });
    assert.deepEqual(h.sent[0], [[0xf0, ...GM_RESET], 1000]);
    // The synth ignores input right after the reset, so the rest of the state follows it.
    const chase = h.sent.slice(1).filter(([, timestamp]) => timestamp === 1100).map(([data]) => data);
    assert.deepEqual(h.sent.slice(1).map(([, timestamp]) => timestamp), h.sent.slice(1).map(() => 1100));
    assert.deepEqual(chase[0], [0xf0, ...PART]);
    assert.ok(chase.some(data => data.length === 2 && data[0] === 0xc0 && data[1] === 5));
    assert.ok(chase.some(data => data[0] === 0xb0 && data[1] === 7 && data[2] === 90));
    assert.ok(!chase.some(data => (data[0] & 0xe0) === 0x80 || data[0] === 0), 'no notes or markers');
    assert.ok(chase.length < 16, 'only the state used by the file is restored');
});

test('nothing is sent without a connected selected output; a new output is chased and failures are logged', t => {
    const h = harness({ port: false });
    h.output.start(timeline, { position: 0, anchorTime: 0, speed: 1, generation: 1 });
    h.clock.now = 1300;
    h.output.pump(1);
    assert.equal(h.sent.length, 0);
    h.state.port = h.device;
    h.clock.now = 1450;
    h.output.pump(1);
    assert.deepEqual(h.sent.map(([data]) => data[0]).slice(0, 2), [0xf0, 0xf0], 'the new output receives the current state');
    assert.ok(h.sent.some(([data]) => data[0] === 0x90), 'playback continues on the new output');
    const warn = t.mock.method(console, 'warn', () => {});
    h.device.send = () => { throw new Error('closed'); };
    h.state.port = null;
    h.output.pump(1);
    assert.ok(warn.mock.callCount() > 0, 'a failed release is logged without stopping playback');
});

test('the manager exposes only a connected selected output and requests SysEx for it', async () => {
    const synth = { name: 'Synth', state: 'connected', send() {} };
    const requested = [];
    const access = { inputs: new Map(), outputs: new Map([['synth', synth]]), sysexEnabled: true,
        addEventListener() {}, removeEventListener() {} };
    const manager = new MidiControllerManager({ windowRef: {},
        navigatorRef: { requestMIDIAccess: async options => { requested.push(options); return access; }, getGamepads: () => [] },
        store: { mappings: [], devices: [], async initialize() {}, subscribe: () => () => {}, getDeviceProtocol: () => 'generic' },
        localInputSources: { syncSubscriptions() {}, cancelLearn() {}, dispose() {} },
        engine: { setGamepadPoller() {}, dispose() {}, onSourceEvent() {} },
        mcuProtocol: { startFeedbackPoller() {}, stopFeedbackPoller() {}, dispose() {} },
        automationScheduler: { sync() {}, dispose() {} } });
    await manager.initialize({});
    assert.equal(manager.getSelectedOutput(), null);
    await manager.setOutputDevice('Synth');
    assert.deepEqual(requested, [{ sysex: true }]);
    assert.equal(manager.midiStateListening, true, 'a selected output keeps hot-plug monitoring active');
    assert.equal(manager.getSelectedOutput(), synth);
    synth.state = 'disconnected';
    assert.equal(manager.getSelectedOutput(), null);
    await manager.setOutputDevice('');
    assert.equal(manager.midiStateListening, false);
    manager.dispose();
});

test('the add-player guidance is suppressed only while the selected output is connected', () => {
    const shown = [];
    const previous = globalThis.window;
    let output = {};
    globalThis.window = { midiControllerManager: { getSelectedOutput: () => output },
        uiManager: { showTransientMessage: key => shown.push(key) } };
    try {
        const player = { midiTimeline: timeline, showMidiInstrumentNotice: midiPlaybackMethods.showMidiInstrumentNotice };
        player.showMidiInstrumentNotice();
        assert.deepEqual(shown, []);
        output = null;
        player.showMidiInstrumentNotice();
        player.showMidiInstrumentNotice();
        assert.deepEqual(shown, ['sfzPlayer.status.addPlayer'], 'the suppressed song can still show it once');
    } finally {
        globalThis.window = previous;
    }
});
