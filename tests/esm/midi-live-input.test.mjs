import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiLiveInput } from '../../js/midi/live-input.js';

const shownPlayer = { paused: true, ui: { container: {} } };

function harness() {
  let port = { state: 'connected' }, change, powerChange, receive;
  const sources = [], messages = [];
  const manager = {
    onChange(callback) { change = callback; return () => { change = null; }; },
    findInput(key) { return key === 'Virtual MIDI' && port?.state === 'connected' ? port : null; },
    async setPerformanceInput(_key, callback) { receive = callback; }
  };
  const power = {
    player: null,
    subscribe(callback) { powerChange = callback; callback(); return () => { powerChange = null; }; }
  };
  const audioManager = {
    setLiveMidiInputSource(key) { sources.push(key); },
    enqueueLiveMidiInput(message) { messages.push(message); }
  };
  const input = new MidiLiveInput({ manager, audioManager, powerController: power });
  return { input, sources, messages, power,
    send(data, extra = {}) { receive?.({ data, timeStamp: 123.5, sourceKey: 'Virtual MIDI', port, ...extra }); },
    replacePort(next) { port = next; change?.(); },
    powerChange() { powerChange?.(); },
    port: () => port };
}

test('live input preserves every channel voice message and copies timestamped MIDI bytes', async () => {
  const h = harness();
  await h.input.select('Virtual MIDI');
  assert.deepEqual(h.sources, ['Virtual MIDI']);
  for (let channel = 0; channel < 16; channel++) {
    for (const type of [0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0]) {
      const bytes = new Uint8Array(type === 0xc0 || type === 0xd0 ? [type | channel, 65] : [type | channel, 65, 100]);
      h.send(bytes);
      const result = h.messages.at(-1);
      assert.deepEqual(result.data, bytes);
      assert.notEqual(result.data, bytes);
      assert.equal(result.timeStamp, 123.5);
    }
  }
  assert.equal(h.messages.length, 16 * 7);
  for (const data of [[0xf8], [0xf0, 1, 0xf7], [0x90, 60], [0x90, 60, 128], [0xc0, 1, 2]]) h.send(data);
  h.send([0x90, 60, 100], { timeStamp: NaN });
  assert.equal(h.messages.length, 16 * 7);
  h.input.dispose();
});

test('attached Music Player owns MIDI even paused, while browser audio does not', async () => {
  const h = harness();
  h.power.browserSelected = true;
  await h.input.select('Virtual MIDI');
  h.send([0x90, 60, 100]);
  h.power.player = shownPlayer;
  // A message can precede the asynchronous power observation notification.
  h.send([0x90, 62, 100]);
  h.powerChange();
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.sources, ['Virtual MIDI', null]);
  h.power.player = null;
  h.powerChange();
  h.send([0x90, 64, 100]);
  assert.equal(h.messages.length, 2);
  assert.deepEqual(h.sources, ['Virtual MIDI', null, 'Virtual MIDI']);
  h.input.dispose();
});

test('hidden network renderer player without UI leaves live MIDI available', async () => {
  const h = harness();
  h.power.player = { ui: { container: null } };
  await h.input.select('Virtual MIDI');
  h.send([0x90, 60, 100]);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.sources, ['Virtual MIDI']);
  h.input.dispose();
});

test('port replacement, disconnect, None and disposal clear source ownership and stale events', async () => {
  const h = harness();
  await h.input.select('Virtual MIDI');
  const oldPort = h.port();
  h.replacePort({ state: 'connected' });
  assert.deepEqual(h.sources, ['Virtual MIDI', null, 'Virtual MIDI']);
  h.send([0x90, 60, 100], { port: oldPort });
  h.send([0x90, 60, 100], { sourceKey: 'Another MIDI' });
  assert.equal(h.messages.length, 0);
  h.send([0x90, 60, 100]);
  h.replacePort({ state: 'disconnected' });
  h.send([0x80, 60, 0]);
  assert.equal(h.messages.length, 1);
  await h.input.select('');
  h.replacePort({ state: 'connected' });
  assert.equal(h.sources.at(-1), null);
  h.input.dispose();
  h.send([0x90, 60, 100]);
  assert.equal(h.messages.length, 1);
});


test('live reset recognition shares source ownership and accepts only complete valid GM/GS/XG packets', async () => {
  const h = harness(); await h.input.select('Virtual MIDI');
  for (const packet of [[0xf0, 0x7e, 0x7f, 9, 1, 0xf7],
    [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0, 0x7f, 0, 0x41, 0xf7],
    [0xf0, 0x43, 0x10, 0x4c, 0, 0, 0x7e, 0, 0xf7]]) h.send(packet);
  assert.deepEqual(h.messages.map(event => event.systemReset), [1, 2, 3]);
  for (const packet of [[0xf0, 0x7e, 0x7f, 9, 2, 0xf7], [0xf0, 0x7e, 0x80, 9, 1, 0xf7],
    [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0, 0x7f, 0, 0, 0xf7], [0xf0, 0x7e, 0x7f, 9, 1]]) h.send(packet);
  h.power.player = shownPlayer; h.powerChange();
  h.send([0xf0, 0x7e, 0x7f, 9, 1, 0xf7]);
  assert.equal(h.messages.length, 3); h.input.dispose();
});
