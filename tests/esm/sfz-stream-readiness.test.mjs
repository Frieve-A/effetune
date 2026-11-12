import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';

function setup(reject = null, committedAhead = window => window) {
  let Type;
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8'), {
    console, sampleRate: 48000, AudioWorkletProcessor: class {},
    registerProcessor(name, value) { if (name === 'plugin-processor') Type = value; }
  });
  const events = [{ seconds: .5, status: 144, data1: 60, data2: 127 },
    { seconds: .8, status: 176, data1: 7, data2: 100 }, { seconds: 1.5, status: 144, data1: 64, data2: 127 },
    { seconds: 1.6, status: 224, data1: 0, data2: 80 }, { seconds: 2.2, status: 128, data1: 64, data2: 0 }];
  const calls = [], entry = { id: 1, sfzSampleStream: {} }, plugin = { id: 7, type: 'SoundFontPlayerPlugin', enabled: true, parameters: { mc: 0 } };
  let snapshot = { generation: 0, scope: 0, admittedFrames: 0, readyAheadFrames: 0, plannedPages: 0, pendingPages: 0 };
  const processor = Object.assign(Object.create(Type.prototype), { currentFrame: 96000, dspSampleRate: 48000,
    plugins: [plugin], sfzNoEvents: [], midiScheduler: { generation: 7, speed: 2, preparing: true, playing: false,
      timeline: { duration: 5, events }, currentPosition: () => 1, instances: new Map() }, dspBinding: {
      instanceMidiClock: () => ({ generation: 0, frame: 0 }), instanceStreamReadiness: () => snapshot,
      prefetchSfzSampleStream(_id, events, generation, window, flags, count) {
        calls.push({ flags, generation, window, events: events.slice(0, count).map(event => ({ ...event })) });
        const status = reject?.(flags, window) ?? 0;
        if (!status && flags === 6) snapshot = { generation: 0, scope: 1, admittedFrames: window,
          readyAheadFrames: committedAhead(window), plannedPages: 4, pendingPages: 0 };
        return status;
      }
    } });
  return { processor, calls, entry, plugin };
}
test('known forecast converts source seconds to output sample offsets at speed2 without past NoteOns', () => {
  const h = setup(); h.processor.advanceSfzSampleForecast(7, h.entry);
  assert.deepEqual(h.calls.map(call => call.flags), [5, 6]);
  assert.equal(h.calls[0].generation, 0);
  assert.deepEqual(Array.from(h.calls[0].events, event => event.offsetFrames), [0, 12000, 14400, 28800]);
  assert.deepEqual(Array.from(h.calls[0].events, event => event.data1), [7, 64, 0, 64]);
  assert.equal(h.processor.isSfzInstrumentJoinReady(h.plugin, h.entry), true);
});
test('a track change before the instance syncs ignores its cursor from the previous timeline', () => {
  const h = setup();
  h.processor.midiScheduler.instances.set(7, { enabled: true, generation: 6, cursor: 40 });
  h.processor.advanceSfzSampleForecast(7, h.entry);
  assert.deepEqual(h.calls.map(call => call.flags), [5, 6]);
  assert.deepEqual(Array.from(h.calls[0].events, event => event.data1), [7, 64, 0, 64]);
});
test('optional pressure tries bounded source windows and leaves a usable limited join', () => {
  const h = setup(() => -3);
  for (let index = 0; index < 3; index++) h.processor.advanceSfzSampleForecast(7, h.entry);
  assert.deepEqual(h.calls.map(call => call.window), [72000, 48000, 12000]);
  assert.equal(h.entry.sfzSampleStream.forecast.pressure, true);
  assert.equal(h.entry.sfzSampleStream.readiness.scope, 0);
  assert.equal(h.processor.isSfzInstrumentJoinReady(h.plugin, h.entry), true);
});

test('polls and page acknowledgements keep a confirmed admission limit until a plan succeeds', () => {
  let capacityLimited = true;
  const h = setup(() => capacityLimited ? -3 : 0), reports = [];
  const stream = Object.assign(h.entry.sfzSampleStream, { generation: 1, operationRevision: 1, replayEpoch: null });
  const supply = { postMessage() {} }; stream.supplyPort = supply;
  Object.assign(h.processor, { dspLive: true, wasmInstances: new Map([[7, h.entry]]),
    port: { postMessage(data) { if (data.type === 'sfzStreamReadiness') reports.push(data); } } });
  Object.assign(h.processor.dspBinding, { instanceAssetState: () => 3, instanceMidiState: () => 0,
    takeSfzSampleRequests: () => [], publishSfzSamplePage: () => 0 });
  const poll = () => h.processor.handleSfzSampleStreamControl({ type: 'sfzPollPages', pluginId: 7, generation: 1 });
  const next = () => { h.processor.currentFrame += 1600; };
  for (let attempt = 0; attempt < 3; attempt++) { poll(); next(); }
  assert.equal(reports.at(-1).limited, true);
  h.processor.currentFrame = stream.forecast.retryFrame;
  poll(); next();
  assert.equal(stream.forecast.pressure, false, 'A new candidate is still being tried');
  assert.equal(reports.at(-1).limited, true, 'Retrying is not evidence that capacity has recovered');
  h.processor.handleSfzSampleStreamControl({ type: 'sfzPublishPage', pluginId: 7, generation: 1,
    operationRevision: 1, replayEpoch: null, page: { generation: 1 } }, supply);
  assert.equal(reports.at(-1).limited, true, 'The independent page-ACK path publishes the same confirmed state');
  next(); poll(); next(); poll();
  assert.equal(reports.at(-1).limited, true);
  capacityLimited = false;
  h.processor.currentFrame = stream.forecast.retryFrame;
  poll(); next(); poll();
  assert.equal(reports.at(-1).limited, false, 'An accepted native plan clears the limitation');
  assert.equal(reports.at(-1).readiness.pendingPages, 0);
  capacityLimited = true; h.processor.midiScheduler.generation++;
  next(); poll();
  assert.equal(reports.at(-1).limited, false, 'A new MIDI generation does not inherit an old planning result');
});

test('an accepted shorter forecast stays limited until the full target window is admitted', () => {
  let rejectLarge = true;
  const h = setup((_flags, window) => rejectLarge && window > 48000 ? -3 : 0);
  h.processor.advanceSfzSampleForecast(7, h.entry);
  h.processor.advanceSfzSampleForecast(7, h.entry);
  assert.equal(h.entry.sfzSampleStream.forecast.ready, true);
  assert.equal(h.entry.sfzSampleStream.forecast.windowFrames, 48000);
  assert.equal(h.entry.sfzSampleStream.limited, true, 'A usable fallback has not met the full preloading target');
  h.processor.dspBinding.instanceStreamReadiness().readyAheadFrames = 24000;
  h.processor.currentFrame += 24000;
  rejectLarge = false;
  h.processor.advanceSfzSampleForecast(7, h.entry);
  assert.equal(h.entry.sfzSampleStream.forecast.windowFrames, 72000);
  assert.equal(h.entry.sfzSampleStream.limited, false);
});
test('actual accepted source expiry renews a stale forecast without declaring a fatal stream failure', () => {
  const h = setup(flags => flags === 6 ? -2 : 0);
  h.processor.advanceSfzSampleForecast(7, h.entry);
  assert.equal(h.entry.sfzSampleStream.forecast, null);
});

test('expired committed candidates keep the limitation until a usable full window succeeds', () => {
  let rejectLarge = true, expired = true;
  const h = setup((_flags, window) => rejectLarge && window > 12000 ? -3 : 0,
    window => expired ? 0 : window);
  const advance = () => h.processor.advanceSfzSampleForecast(7, h.entry);
  const stream = h.entry.sfzSampleStream;
  for (let attempt = 0; attempt < 3; attempt++) advance();
  assert.equal(h.calls.at(-1).flags, 6, 'Native COMMIT succeeds with all pages acknowledged');
  assert.equal(stream.readiness.scope, 1);
  assert.equal(stream.readiness.pendingPages, 0);
  assert.equal(stream.readiness.readyAheadFrames, 0, 'The admitted short window expired while its pages were prepared');
  assert.equal(stream.forecast, null);
  assert.equal(stream.limited, true);

  h.processor.currentFrame += 12000;
  h.processor.midiScheduler.currentPosition = () => 2;
  advance();
  assert.equal(stream.limited, true, 'A same-goal candidate rebuild and rolling origin do not prove recovery');
  advance(); advance();
  assert.equal(stream.forecast, null);
  assert.equal(stream.limited, true, 'Another expired fallback keeps the confirmed limitation');

  rejectLarge = false;
  advance();
  assert.equal(h.calls.at(-1).window, 72000);
  assert.equal(stream.forecast, null);
  assert.equal(stream.limited, true, 'Even a full-window COMMIT cannot clear the warning if its coverage has expired');
  expired = false;
  advance();
  assert.equal(stream.forecast.ready, true);
  assert.equal(stream.limited, false, 'A usable full-window COMMIT confirms recovery');

  rejectLarge = true;
  h.processor.midiScheduler.generation++;
  advance(); advance(); advance();
  assert.equal(stream.limited, true);
  h.processor.port = { postMessage() {} };
  h.processor.stopSfzSampleStream(7, h.entry);
  assert.equal(h.entry.sfzSampleStream, null);
  h.entry.sfzSampleStream = {};
  advance();
  assert.equal(h.entry.sfzSampleStream.limited, false, 'A replacement asset starts with its own planning goal');
});
test('cold live input commits state and retires old notes, then delivers only the new future note', () => {
  const scheduler = new MidiFrameScheduler(48000), sent = [];
  let receipt = { generation: 3, frame: 0 }, advance = false;
  const binding = { instanceSetMidiEvents(_id, events, _generation, flags, count = events.length) {
    sent.push({ flags, events: events.slice(0, count).map(event => ({ ...event })) }); return 0;
  }, instanceSetMidiGain() {}, instanceMidiState: () => 0, instanceMidiClock: () => receipt,
  instanceSetMidiClock(_id, frame, generation, flags) { receipt = { frame, generation }; advance = flags === 1; return 0; } };
  scheduler.register(7, 1, 9); scheduler.configureInput({ generation: 3, enabled: true });
  scheduler.hydrateInput(7, 9, []);
  const event = (frame, status, data1) => ({ frame, status, data1, data2: 100, targets: [{ id: 7, token: 9 }] });
  scheduler.enqueueInput([event(0, 144, 60), event(0, 176, 7)]);
  assert.equal(scheduler.stageInstance(binding, 7, 0, 128, 0, true, false), true);
  assert.equal(scheduler.instances.get(7).inputCursor, undefined);
  scheduler.commitInstances(binding); scheduler.finishInputFrame(128);
  assert.equal(scheduler.instances.get(7).inputCursor, 2);
  assert.equal(sent.some(batch => batch.events.some(event => event.status === 144)), false);
  assert.ok(sent.some(batch => batch.flags === 512 && batch.events.some(event => event.data1 === 7)));
  scheduler.enqueueInput([event(128, 144, 64)]);
  scheduler.stageInstance(binding, 7, 128, 128, 0, true, true);
  if (advance) receipt.frame += 128;
  scheduler.commitInstances(binding);
  assert.deepEqual(sent.flatMap(batch => batch.events.filter(event => event.status === 144).map(event => event.data1)), [64]);
});
