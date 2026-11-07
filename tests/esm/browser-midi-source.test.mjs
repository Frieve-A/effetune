import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { BrowserMidiSource } from '../../js/browser/browser-midi-source.js';
import { musicPlayerOwnsMidi } from '../../js/midi/live-input.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function harness(initialSource = 'Hardware') {
    let receive = null, unsubscribed = false, source = initialSource;
    const sources = [], messages = [], powerListeners = new Set();
    const powerPolicyController = {
        player: null,
        subscribe(listener) { powerListeners.add(listener); listener(); return () => powerListeners.delete(listener); }
    };
    const audioManager = {
        powerPolicyController,
        getLiveMidiInputSource: () => source,
        // Mirrors audio-manager-live-midi.js: a shown Music Player forces no source.
        setLiveMidiInputSource(key) {
            key = musicPlayerOwnsMidi(powerPolicyController) ? null : key;
            if (key === source) return;
            source = key; sources.push(key);
        },
        enqueueLiveMidiInput(message) { messages.push(message); return message.sourceKey === source; }
    };
    const api = { onMidi(callback) { receive = callback; return () => { unsubscribed = true; }; } };
    const midi = new BrowserMidiSource(audioManager, api);
    const setPlayer = player => { powerPolicyController.player = player; for (const listener of powerListeners) listener(); };
    return { midi, sources, messages, send: message => receive(message), setSource: key => { source = key; }, setPlayer,
        unsubscribed: () => unsubscribed, powerListeners };
}

async function withClock(callback) {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    try {
        await withGlobals({ performance: { now: () => Date.now() } }, callback);
    } finally { mock.timers.reset(); }
}

const at = (delay, data) => ({ data, delay });

test('browser MIDI is delivered after its delay in time order with local timestamps', () => withClock(() => {
    const h = harness();
    mock.timers.tick(10);
    h.send({ events: [at(20, [0x90, 62, 100]), at(0, [0x90, 60, 100]), at(10, [0x80, 60, 0]), at(10, [0x80, 61, 0])] });
    assert.deepEqual(h.messages.map(message => [...message.data]), [[0x90, 60, 100]]);
    assert.equal(h.messages[0].timeStamp, 10);
    assert.equal(h.messages[0].sourceKey, 'browser');
    mock.timers.tick(10);
    assert.deepEqual(h.messages.map(message => message.timeStamp), [10, 20, 20]);
    assert.deepEqual(h.messages.slice(1).map(message => message.data[1]), [60, 61]);
    mock.timers.tick(10);
    assert.deepEqual(h.messages.map(message => message.data[1]), [60, 60, 61, 62]);
}));

test('browser MIDI routes recognized system resets and ignores other SysEx', () => withClock(() => {
    const h = harness();
    h.send({ events: [at(0, [0xf0, 0x7e, 0x7f, 9, 1, 0xf7]), at(0, [0xf0, 0x7d, 1, 0xf7])] });
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].systemReset, 1);
    assert.deepEqual([...h.messages[0].data], [0, 0, 0]);
}));

test('browser MIDI claims live input on its first event and restores the previous source on reset', () => withClock(() => {
    const h = harness();
    h.send({ events: [at(0, [0x90, 60, 100])] });
    h.send({ events: [at(0, [0x80, 60, 0])] });
    assert.deepEqual(h.sources, ['browser']);
    h.send({ reset: true });
    assert.deepEqual(h.sources, ['browser', 'Hardware']);
    h.send({ events: [at(0, [0x90, 60, 100])] });
    assert.deepEqual(h.sources, ['browser', 'Hardware', 'browser']);
}));

test('browser MIDI does not restore over a source that replaced it', () => withClock(() => {
    const h = harness(null);
    h.send({ events: [at(0, [0x90, 60, 100])] });
    h.setSource('Other');
    h.send({ reset: true });
    assert.deepEqual(h.sources, ['browser']);
}));

test('browser MIDI claims again when another source replaced it without a reset', () => withClock(() => {
    const h = harness();
    h.send({ events: [at(0, [0x90, 60, 100]), at(50, [0x80, 60, 0])] });
    h.setSource('Other'); // e.g. a device reconnect or a device selection.
    h.send({ events: [at(0, [0x90, 60, 120])] });
    assert.deepEqual(h.sources, ['browser', 'browser']);
    assert.equal(h.messages.at(-1).sourceKey, 'browser');
    mock.timers.tick(100);
    assert.deepEqual(h.messages.map(message => [...message.data]), [[0x90, 60, 100], [0x90, 60, 120]]);
    h.send({ reset: true });
    assert.deepEqual(h.sources, ['browser', 'browser', 'Other']);
}));

test('an attached Music Player ends the Browser claim and the next event after detach claims again', () => withClock(() => {
    const h = harness(null); // MidiLiveInput already ended its device session for the player.
    h.setPlayer({ ui: { container: {} } });
    h.send({ events: [at(0, [0x90, 60, 100])] });
    assert.equal(h.messages.length, 0);
    h.setPlayer(null);
    h.send({ events: [at(0, [0x90, 60, 100]), at(50, [0x80, 60, 0])] });
    assert.deepEqual(h.sources, ['browser']);
    assert.equal(h.messages.length, 1);
    h.setPlayer({ ui: { container: {} } });
    assert.deepEqual(h.sources, ['browser', null]);
    mock.timers.tick(100);
    assert.equal(h.messages.length, 1);
    h.setSource('Hardware'); // MidiLiveInput restores its device after detach.
    h.setPlayer(null);
    h.send({ events: [at(0, [0x90, 62, 100])] });
    h.send({ reset: true });
    assert.deepEqual(h.sources, ['browser', null, 'browser', 'Hardware']);
}));

test('reset and teardown discard scheduled events and unsubscribe', () => withClock(() => {
    const h = harness();
    h.send({ events: [at(50, [0x90, 60, 100])] });
    h.send({ reset: true });
    mock.timers.tick(100);
    assert.equal(h.messages.length, 0);
    h.send({ events: [at(150, [0x90, 60, 100])] });
    h.midi.dispose();
    mock.timers.tick(100);
    assert.equal(h.messages.length, 0);
    assert.equal(h.unsubscribed(), true);
    assert.equal(h.powerListeners.size, 0);
    assert.deepEqual(h.sources, ['browser', 'Hardware', 'browser', 'Hardware']);
}));

test('the scheduling queue is bounded', () => withClock(async () => {
    const h = harness();
    const errors = [];
    await withGlobals({ console: { ...console, error: message => errors.push(message) } }, () => {
        h.send({ events: Array.from({ length: 5000 }, () => at(10, [0x90, 60, 100])) });
    });
    assert.equal(h.midi.pending.length, 4096);
    assert.equal(errors.length, 1);
    mock.timers.tick(10);
    assert.equal(h.messages.length, 4096);
}));

test('browser MIDI is inert without the Browser MIDI API', () => {
    const audioManager = { setLiveMidiInputSource() { assert.fail('no claim expected'); } };
    const midi = new BrowserMidiSource(audioManager, {});
    midi.dispose();
    new BrowserMidiSource(audioManager, undefined).dispose();
});
