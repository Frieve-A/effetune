import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiInputState, applyMidiEvent, createMidiChannels } from '../../js/midi/smf-timeline.js';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';

test('live hydration restores actual global CC current values without replaying channel transactions', () => {
  const state = new MidiInputState();
  for (const [channel, cc, value] of [[3, 1, 90], [0, 1, 20], [12, 121, 0],
    [2, 101, 0], [2, 100, 0], [2, 6, 12], [1, 99, 15]]) {
    state.apply({ status: 0xb0 | channel, data1: cc, data2: value, seconds: 0 });
  }
  const events = state.hydration(), global = events.filter(event => event.flags === 1024);
  const byCC = new Map(global.map(event => [event.data1, event]));
  assert.deepEqual(byCC.get(1), { status: 0xb0, data1: 1, data2: 20, flags: 1024 });
  assert.deepEqual(byCC.get(6), { status: 0xb2, data1: 6, data2: 12, flags: 1024 });
  assert.equal(byCC.get(100).data2, 0);
  assert.equal(byCC.get(101).data2, 0);
  assert.equal(byCC.get(121).status, 0xbc);
  assert.equal(byCC.has(11), false, 'A channel reset does not invent an accepted global CC11');
  assert.deepEqual(events.slice(-global.length), global);
  const channels = createMidiChannels();
  for (const event of events) if (event.flags === 2048) applyMidiEvent(channels, event);
  assert.equal(channels[2].bendRange, 12);
  assert.equal(channels[2].cc[100], 0);
  assert.equal(channels[1].cc[99], 15);
  assert.equal(channels[12].cc[11], 127);
});

test('the existing input snapshot path carries global-only markers solely in state-only packets', () => {
  const scheduler = new MidiFrameScheduler(48000), state = new MidiInputState(), packets = [];
  state.apply({ status: 0xb9, data1: 6, data2: 91, seconds: 0 });
  scheduler.configureInput({ generation: 1, enabled: true });
  scheduler.register(7, 1, 5, 0);
  scheduler.hydrateInput(7, 5, state.hydration());
  const binding = { instanceSetMidiGain: () => 0, instanceSetMidiClock: () => 0,
    instanceMidiState: () => 0, instanceSetMidiEvents(_id, events, _generation, flags, count = events.length) {
      packets.push({ flags, events: events.slice(0, count).map(event => ({ ...event })) }); return 0;
    } };
  assert.equal(scheduler.processInputInstance(binding, 7, 0, 128, 0, true, true), true);
  const marked = packets.flatMap(packet => packet.events.map(event => ({ packet: packet.flags, event })))
    .filter(({ event }) => event.flags === 1024);
  assert.equal(marked.length, 1); assert.equal(marked[0].packet, 512);
  assert.equal(marked[0].event.status, 0xb9); assert.equal(marked[0].event.data2, 91);
});

test('extended global sources retain their own latest accepted bend and pressure messages across channels and keys', () => {
  const state = new MidiInputState();
  for (const [status, data1, data2] of [[0xe3, 0, 65], [0xd2, 91, 0], [0xa1, 60, 80],
    [0xe0, 64, 70], [0xa8, 72, 22], [0xb7, 1, 0], [0x90, 60, 127]])
    state.apply({ status, data1, data2, seconds: 0 });
  const global = state.hydration().filter(event => event.flags === 1024);
  assert.deepEqual(global.filter(event => (event.status & 0xf0) === 0xe0).at(-1), { status: 0xe0, data1: 64, data2: 70, flags: 1024 });
  assert.deepEqual(global.filter(event => event.status === 0xe3), [{ status: 0xe3, data1: 0, data2: 65, flags: 1024 }]);
  assert.deepEqual(global.filter(event => (event.status & 0xf0) === 0xd0), [{ status: 0xd2, data1: 91, data2: 0, flags: 1024 }]);
  assert.deepEqual(global.filter(event => (event.status & 0xf0) === 0xa0).at(-1), { status: 0xa8, data1: 72, data2: 22, flags: 1024 });
  assert.equal(global.some(event => (event.status & 0xf0) === 0x90), false);
  assert.equal(state.globalCurrent.size, 6);
});

test('a complete sixteen-channel snapshot fits the existing ingress limit and splits into bounded native state-only batches', () => {
  const state = new MidiInputState();
  for (let channel = 0; channel < 16; channel++) {
    const message = (kind, data1, data2 = 0) => state.apply({ status: kind | channel, data1, data2, seconds: 0 });
    for (let cc = 0; cc < 128; cc++) message(0xb0, cc, cc);
    for (const [cc, value] of [[101, 0], [100, 0], [6, 12], [38, 0]]) message(0xb0, cc, value);
    message(0xc0, 1); message(0xd0, 64); message(0xe0, 0, 64);
    for (let key = 0; key < 128; key++) message(0xa0, key, 64);
  }
  const events = state.hydration(), scheduler = new MidiFrameScheduler(48000), packets = [];
  assert.equal(events.filter(event => event.flags === 1024).length, 16 * 131);
  assert.ok(events.length <= 8192); assert.ok(events.length > 4096);
  scheduler.configureInput({ generation: 1, enabled: true }); scheduler.register(7, 1, 5, 0);
  assert.equal(scheduler.hydrateInput(7, 5, events), true);
  const binding = { instanceSetMidiGain: () => 0, instanceSetMidiClock: () => 0, instanceMidiState: () => 0,
    instanceSetMidiEvents(_id, values, _generation, flags, count = values.length) {
      if (flags === 512) packets.push(values.slice(0, count).map(value => ({ ...value }))); return 0;
    } };
  assert.equal(scheduler.processInputInstance(binding, 7, 0, 128, 0, true, true), true);
  assert.deepEqual(packets.map(packet => packet.length), [4096, events.length - 4096]);
  assert.equal(packets.flat().filter(event => event.flags === 1024).length, 16 * 131);
  assert.ok(packets.flat().every(event => event.flags === 1024 || event.flags === 2048));
});
