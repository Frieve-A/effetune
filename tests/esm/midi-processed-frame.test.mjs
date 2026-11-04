import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { compileAcceptanceInstrument } from '../helpers/sfz-native-acceptance.mjs';

function worklet() {
  let Processor;
  const sandbox = { console, sampleRate: 48000, currentFrame: 0,
    AudioWorkletProcessor: class {}, registerProcessor(name, Type) { if (name === 'plugin-processor') Processor = Type; } };
  let source = fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8');
  const scheduler = fs.readFileSync(new URL('../../js/midi/smf-scheduler.js', import.meta.url), 'utf8');
  source = source.replace(/\/\/ __ETMIDI_SCHEDULER_INJECT_START__[\s\S]*?\/\/ __ETMIDI_SCHEDULER_INJECT_END__/,
    () => scheduler.replace(/^export /gm, ''));
  vm.runInNewContext(source, sandbox);
  const messages = [];
  const processor = Object.assign(Object.create(Processor.prototype), {
    currentFrame: 0, streamBoundaries: [], plugins: [], wasmInstances: new Map(),
    transition: { phase: 'open' }, outputReadyRequests: [],
    audioProcessingClockNow: () => 0, finishPipelineCpuMeasurement() {},
    hasExecutionLatencyDrift: () => false, notifySfzSampleStreamPolls() {},
    port: { postMessage(data) { messages.push(data); } }, processPipeline: () => true,
    midiScheduler: new MidiFrameScheduler(48000)
  });
  const render = () => processor.process([], [[new Float32Array(128), new Float32Array(128)]], {});
  return { processor, sandbox, messages, render };
}

test('only completed callbacks advance a silent MIDI source; context jumps and stalled callbacks do not', () => {
  const h = worklet(), scheduler = h.processor.midiScheduler;
  scheduler.configure({ timeline: { duration: .005, events: [] }, playing: true, generation: 1 });
  let rendering = false;
  h.processor.processPipeline = () => {
    assert.equal(h.processor.currentFrame, rendering ? 128 : 0);
    assert.equal(h.messages.some(message => message.type === 'midiEnded'), false, 'EOF must wait for completed processing');
    return true;
  };
  h.sandbox.currentFrame = 4800000;
  assert.equal(h.processor.currentFrame, 0, 'No callback means no completed samples');
  h.render();
  assert.equal(h.processor.currentFrame, 128, JSON.stringify(h.messages));
  assert.equal(h.messages.find(message => message.type === 'midiPosition').position, 128 / 48000);
  h.sandbox.currentFrame += 4800000;
  assert.equal(h.processor.currentFrame, 128, JSON.stringify(h.messages));
  rendering = true;
  h.render();
  assert.equal(h.processor.currentFrame, 256);
  assert.equal(h.messages.filter(message => message.type === 'midiEnded').length, 1);
});

test('MIDI cursor, EOF and input consumption remain staged until the native processing receipt', () => {
  const scheduler = new MidiFrameScheduler(48000), delivery = [];
  let receipt = { frame: 0, generation: 1 };
  const binding = { instanceSetMidiEvents(_id, events, _generation, flags, count = events.length) {
    delivery.push({ flags, events: events.slice(0, count).map(event => ({ ...event })) }); return 0;
  }, instanceSetMidiGain: () => 0, instanceSetMidiClock: () => 0, instanceMidiClock: () => receipt };
  scheduler.configure({ timeline: { duration: .001, events: [{ seconds: 0, status: 144, data1: 60, data2: 127 }] },
    generation: 1, playing: true });
  const state = scheduler.register('main', 1);
  scheduler.stageInstance(binding, 'main', 0, 128);
  assert.equal(state.cursor, 0); assert.equal(state.ended, false);
  assert.throws(() => scheduler.commitInstances(binding), /did not commit/);
  assert.equal(state.cursor, 0); assert.equal(state.ended, false);
  scheduler.stageInstance(binding, 'main', 0, 128);
  receipt = { frame: 128, generation: 1 };
  scheduler.commitInstances(binding);
  assert.equal(state.cursor, 1); assert.equal(state.ended, true); assert.equal(state.clockFrame, 128);
  const count = delivery.length;
  scheduler.stageInstance(binding, 'main', 128, 128); receipt.frame = 256; scheduler.commitInstances(binding);
  assert.equal(delivery.slice(count).flatMap(batch => batch.events).filter(event => event.status === 144).length, 0);
  scheduler.stageInstance(binding, 'main', 256, 128);
  scheduler.configure({ generation: 2, position: 0 });
  scheduler.commitInstances(binding);
  assert.equal(state.clockFrame, 256, 'A newer transport retires the staged generation without publishing it');
});

test('live MIDI acknowledgements and pause completion are published after processing, never during staging', () => {
  const h = worklet(), scheduler = h.processor.midiScheduler;
  scheduler.configureInput({ generation: 1, enabled: true });
  scheduler.input.events.push({ frame: 0, serial: 1, targets: [] });
  h.processor.midiInputAcks = [{ generation: 1, requestId: 7, serial: 1 }];
  h.processor.processPipeline = () => {
    assert.equal(scheduler.input.events.length, 1);
    assert.equal(h.messages.length, 0);
    return true;
  };
  h.render();
  assert.equal(scheduler.input.events.length, 0, JSON.stringify(h.messages));
  assert.equal(h.messages.find(message => message.type === 'midiInputAccepted').accepted, true);
  scheduler.configure({ timeline: { duration: 1, events: [] }, generation: 2, playing: true, anchorFrame: 128 });
  scheduler.requestPause(3, 192);
  h.processor.processPipeline = () => {
    assert.equal(h.messages.some(message => message.type === 'midiPauseReady'), false);
    return true;
  };
  h.render();
  assert.equal(h.messages.filter(message => message.type === 'midiPauseReady').length, 1);
});

test('UI position holds the last generation-matched completed receipt without context extrapolation', () => {
  let listener;
  const node = { port: { addEventListener(_type, value) { listener = value; }, start() {}, postMessage() {} } };
  const context = { currentTime: 0, sampleRate: 48000 };
  const owner = Object.assign({}, midiPlaybackMethods, { midiTimeline: { duration: 10 }, midiPosition: 0,
    audioPlayer: { audioContext: context }, audioManager: { workletNode: node },
    getCurrentState: () => ({ playbackSpeed: 1 }) });
  owner.postMidiTransport(true, 0);
  context.currentTime = 1000;
  assert.equal(owner.getCurrentMidiTime(), 0);
  listener({ data: { type: 'midiPosition', generation: owner.midiGeneration, position: .25 } });
  assert.equal(owner.getCurrentMidiTime(), .25);
  context.currentTime += 1000;
  assert.equal(owner.getCurrentMidiTime(), .25);
  listener({ data: { type: 'midiPosition', generation: owner.midiGeneration - 1, position: 5 } });
  assert.equal(owner.getCurrentMidiTime(), .25);
});

test('sample availability reports episode transitions through the existing nonlatched runtime channel', () => {
  const h = worklet(), entry = { id: 1, instanceEpoch: 2 };
  let event = { generation: 1, cause: 1, latched: false };
  h.processor.dspBinding = { instanceRuntimeEvent: () => event };
  const plugin = { id: 7, type: 'SoundFontPlayerPlugin' };
  for (let block = 0; block < 100; block++) h.processor.postDspRuntimeEvent(plugin, entry);
  assert.equal(h.messages.length, 1, 'A continuing gap does not spam each quantum');
  assert.equal(h.messages[0].cause, 'sampleUnavailable');
  assert.equal(h.messages[0].latched, false);
  event = { generation: 2, cause: 0, latched: false };
  h.processor.postDspRuntimeEvent(plugin, entry);
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[1].cause, 'available');
});

test('a rejected native processing receipt cannot publish progress, EOF or live input acknowledgement', () => {
  const h = worklet(), scheduler = h.processor.midiScheduler;
  scheduler.configure({ timeline: { duration: .001, events: [] }, generation: 1, playing: true });
  scheduler.commitInstances = () => { throw new Error('MIDI audio processing did not commit its scheduled frames'); };
  h.processor.midiInputAcks = [{ generation: 1, requestId: 7, serial: 1 }];
  h.render();
  assert.equal(h.processor.currentFrame, 0);
  assert.deepEqual(h.messages.map(message => message.type), ['midiTransportError']);
  assert.equal(h.processor.midiInputAcks.length, 1);
});

test('candidate preparation cannot publish its position before the existing start commit', () => {
  const h = worklet();
  h.processor.midiScheduler.configure({ timeline: { duration: 2, events: [] }, generation: 1, preparing: true, position: 1 });
  h.render();
  assert.equal(h.messages.some(message => message.type === 'midiPrepared'), true);
  assert.equal(h.messages.some(message => message.type === 'midiPosition'), false);
  h.processor.midiScheduler.start(1, h.processor.currentFrame);
  h.render();
  assert.ok(h.messages.find(message => message.type === 'midiPosition').position > 1);
});

for (const variant of ['baseline', 'simd']) test(`${variant} native source clock follows completed audio rather than jumped context frames`, async () => {
  const asset = await compileAcceptanceInstrument('<region> sample=constant.wav key=60 loop_mode=loop_continuous volume_oncc145=6', {
    samples: new Map([['constant.wav', { sampleRate: 48000, channels: [new Float32Array(4800).fill(.125)] }]]) });
  asset.operationRevision = 1;
  const h = await createNativeSamplerWorklet({ variant });
  try {
    await h.initialize('SoundFontPlayerPlugin', asset);
    const playback = createNativeMidiPlaybackOwner(h), owner = playback.owner;
    owner.postMidiTransport(true, 0);
    for (let block = 0; block < 40; block++) { h.render(); await Promise.resolve(); }
    const id = h.processor.wasmInstances.get(7).id;
    const frame = h.processor.currentFrame, native = h.binding.instanceMidiClock(id).frame;
    const cursor = h.processor.midiScheduler.instances.get(7).cursor, position = owner.getCurrentMidiTime();
    const processTimes = [], process = h.binding.pipelineProcess.bind(h.binding);
    h.binding.pipelineProcess = (channels, frames, time, ...args) => {
      processTimes.push(time); return process(channels, frames, time, ...args);
    };
    h.advanceContextWithoutProcessing(4800000);
    assert.equal(h.processor.currentFrame, frame);
    assert.equal(h.binding.instanceMidiClock(id).frame, native);
    assert.equal(owner.getCurrentMidiTime(), position);
    assert.equal(h.processor.midiScheduler.instances.get(7).cursor, cursor);
    const output = h.render()[0]; await Promise.resolve();
    assert.deepEqual(processTimes, [frame / 48000], 'Native ProcessInfo time follows the same completed sample position');
    assert.equal(h.processor.currentFrame, frame + 128);
    assert.equal(h.binding.instanceMidiClock(id).frame, native + 128);
    assert.equal(h.messages.some(message => message.type === 'midiEnded' || message.type === 'midiTransportError'), false);
    assert.ok(output.some(value => Math.abs(value) > .001));
    assert.equal(playback.reported, 0);
  } finally { await h.close(); }
});
