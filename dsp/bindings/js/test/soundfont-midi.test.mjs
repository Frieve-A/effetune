import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SoundFontBank,
  ValidationError,
  createChain,
  midi,
  prepareSoundFont
} from '../dist/index.js';

const common = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'common');
// One looped 1 kHz sine region (key centre 83) with a 1 ms release and no pages.
const sineBank = SoundFontBank.fromBytes(await readFile(path.join(common, 'soundfont-sine-v1.etsf')));
const SAMPLE_RATE = 48000;
const FRAMES = 4800;

function soundFontDocument(parameters = {}, extra = []) {
  return {
    version: 1,
    chain: [
      { id: 'piano', type: 'SoundFontPlayer', assets: { soundFont: 'sine' }, parameters },
      ...extra
    ]
  };
}

async function openStream(document = soundFontDocument(), bank = sineBank) {
  const chain = await createChain(document, { variant: 'baseline', assetResolver: () => bank });
  const stream = await chain.stream({ sampleRate: SAMPLE_RATE, channels: 2, blockSize: 128, seed: 7 });
  return { chain, stream };
}

function silence(frames = FRAMES) {
  return [new Float32Array(frames), new Float32Array(frames)];
}

function rms(channel, start = 0, end = channel.length) {
  let sum = 0;
  for (let frame = start; frame < end; frame++) sum += channel[frame] * channel[frame];
  return Math.sqrt(sum / (end - start));
}

// Ignores the engine's denormal-protection noise floor.
function firstSound(channel) {
  return channel.findIndex(sample => (sample < 0 ? -sample : sample) > 1e-6);
}

const noteEvents = [
  { frame: 0, effectId: 'piano', midi: midi.noteOn(0, 83, 100) },
  { frame: 2400, effectId: 'piano', midi: midi.noteOff(0, 83) }
];

test('MIDI helpers build channel voice messages and reject out-of-range values', () => {
  assert.deepEqual(midi.noteOn(1, 60, 100), [0x91, 60, 100]);
  assert.deepEqual(midi.noteOff(2, 60), [0x82, 60, 0]);
  assert.deepEqual(midi.controlChange(0, 64, 127), [0xb0, 64, 127]);
  assert.deepEqual(midi.pitchBend(3, 8192), [0xe3, 0, 64]);
  assert.deepEqual(midi.programChange(15, 5), [0xcf, 5, 0]);
  assert.throws(() => midi.noteOn(16, 60, 100), ValidationError);
  assert.throws(() => midi.noteOn(0, 128, 100), ValidationError);
  assert.throws(() => midi.pitchBend(0, 16384), ValidationError);
});

test('SoundFontPlayer sounds on note on and its tail decays after note off', async () => {
  const { chain, stream } = await openStream();
  try {
    const [left] = await stream.process(silence(), { events: noteEvents });
    const [tail] = await stream.process(silence());
    const held = rms(left, 480, 2400);
    assert.ok(held > 0.01, `held note RMS ${held}`);
    assert.ok(rms(left, 2400 + 480, FRAMES) < held * 1e-3);
    assert.ok(rms(tail) < held * 1e-3);
  } finally {
    stream.close();
    chain.close();
  }
});

test('MIDI rendering is bit-identical across streams and after reset', async () => {
  const first = await openStream();
  const second = await openStream();
  try {
    const expected = await first.stream.process(silence(), { events: noteEvents });
    assert.deepEqual(await second.stream.process(silence(), { events: noteEvents }), expected);
    first.stream.reset();
    assert.deepEqual(await first.stream.process(silence(), { events: noteEvents }), expected);
  } finally {
    for (const { chain, stream } of [first, second]) {
      stream.close();
      chain.close();
    }
  }
});

test('MIDI events share the event list with parameter events', async () => {
  const mixed = await openStream();
  const reference = await openStream(soundFontDocument({ outputGain: -20 }));
  try {
    // The parameter event splits the first block range, so the note on lands in a sub-range.
    const [left] = await mixed.stream.process(silence(), { events: [
      { frame: 500, effectId: 'piano', parameters: { outputGain: -20 } },
      { frame: 1000, effectId: 'piano', midi: midi.noteOn(0, 83, 100) }
    ] });
    const [expected] = await reference.stream.process(silence(), { events: [
      { frame: 1000, effectId: 'piano', midi: midi.noteOn(0, 83, 100) }
    ] });
    assert.equal(firstSound(left), firstSound(expected));
    assert.ok(firstSound(left) >= 1000 && firstSound(left) <= 1002);
    const level = rms(left, 2000, FRAMES), expectedLevel = rms(expected, 2000, FRAMES);
    assert.ok(Math.abs(level / expectedLevel - 1) < 0.01, `${level} vs ${expectedLevel}`);
  } finally {
    for (const { chain, stream } of [mixed, reference]) {
      stream.close();
      chain.close();
    }
  }
});

test('stream events reject invalid MIDI and more MIDI events than one call can deliver', async () => {
  const { chain, stream } = await openStream(soundFontDocument({}, [
    { id: 'volume', type: 'Volume', parameters: {} }
  ]));
  const event = midi => ({ frame: 0, effectId: 'piano', midi });
  try {
    for (const invalid of [[0x40, 0, 0], [0x90, 128, 0], [0x90, 60], [0xc0], [0xc0, 128], [0x90, 60, 1.5], 'abc']) {
      await assert.rejects(stream.process(silence(16), { events: [event(invalid)] }), ValidationError);
    }
    // Raw MIDI bytes pass through: unused messages are ignored, not rejected.
    await stream.process(silence(16), { events: [
      [0xfe], [0xf8], [0xf0, 0x7e, 0x7f, 0xf7], [0xd0, 64], [0xa0, 60, 10], [0xc0, 5],
      new Uint8Array([0x90, 60, 100]), new Uint8Array([0x80, 60, 0])
    ].map(event) });
    await assert.rejects(stream.process(silence(16), { events: [
      { frame: 0, effectId: 'volume', midi: midi.noteOn(0, 60, 100) }
    ] }), /does not accept MIDI/);
    await assert.rejects(stream.process(silence(16), { events: [
      { frame: 0, effectId: 'piano', midi: midi.noteOn(0, 60, 100), parameters: { outputGain: 0 } }
    ] }), /either parameters or midi/);
    await assert.rejects(stream.process(silence(16), { events: [{ frame: 0, effectId: 'piano' }] }),
      /either parameters or midi/);

    const controls = count => Array.from({ length: count }, () => event(midi.controlChange(0, 7, 100)));
    await stream.process(silence(16), { events: controls(4096) });
    await assert.rejects(stream.process(silence(16), { events: controls(4097) }), ValidationError);
  } finally {
    stream.close();
    chain.close();
  }
});

test('a prepared SF2 bank with sample pages plays through the stream', async () => {
  const bank = await prepareSoundFont(await readFile(path.join(common, 'soundfont-tiny.sf2')));
  assert.ok(bank.pages.length > 0);
  const { chain, stream } = await openStream(soundFontDocument(), bank);
  try {
    const [left] = await stream.process(silence(), { events: [
      { frame: 0, effectId: 'piano', midi: midi.noteOn(0, 69, 100) }
    ] });
    assert.ok(rms(left, 480, FRAMES) > 1e-3);
  } finally {
    stream.close();
    chain.close();
  }
});

test('the worklet processor applies sendMidi messages at the next block start', async () => {
  const priorProcessor = globalThis.AudioWorkletProcessor;
  const priorRegister = globalThis.registerProcessor;
  const priorSampleRate = globalThis.sampleRate;
  let Processor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { messages: [], postMessage: message => this.port.messages.push(message), onmessage: null };
    }
  };
  globalThis.registerProcessor = (_name, RegisteredProcessor) => { Processor = RegisteredProcessor; };
  globalThis.sampleRate = SAMPLE_RATE;
  const { chain, stream } = await openStream();
  try {
    await import(`../dist/worklet-processor.js?midi=${Date.now()}`);
    const processor = new Processor();
    await processor.initialize({
      channels: 2,
      maxFrames: 128,
      // The node sends the normalized document.
      document: { version: 1, chain: soundFontDocument().chain.map(effect => ({ ...effect, enabled: true, channel: 'all' })) },
      // The node structured-clones the resolved bank into the processor.
      resolvedAssets: new Map([['piano', { soundFont: structuredClone({ bank: sineBank, reference: 'sine' }) }]]),
      wasmBytes: await readFile(new URL('../dist/assets/effetune-dsp.wasm', import.meta.url)),
      seed: 7
    });
    assert.equal(processor.ready, true);
    processor.handleMessage({ type: 'midi', effectId: 'piano', midi: midi.noteOn(0, 83, 100) });
    const rendered = [new Float32Array(1280), new Float32Array(1280)];
    for (let offset = 0; offset < 1280; offset += 128) {
      const output = [new Float32Array(128), new Float32Array(128)];
      assert.equal(processor.process([silence(128)], [output]), true);
      rendered[0].set(output[0], offset);
      rendered[1].set(output[1], offset);
    }
    const expected = await stream.process(silence(1280), { events: [noteEvents[0]] });
    assert.deepEqual(rendered, expected);
    assert.equal(processor.port.messages.some(message => message.type === 'commandResult' && !message.ok), false);
    processor.handleMessage({ type: 'close' });
  } finally {
    stream.close();
    chain.close();
    if (priorProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = priorProcessor;
    if (priorRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = priorRegister;
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test('EffeTuneNode.sendMidi validates and posts MIDI for SoundFont effects', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = {
        messages: [],
        postMessage: message => {
          this.port.messages.push(message);
          if (message.type === 'initialize') {
            queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready', latencySamples: 0 } }));
          }
        },
        start() {}
      };
    }
    disconnect() {}
  };
  try {
    const { EffeTuneNode } = await import(`../dist/worklet.js?midi=${Date.now()}`);
    const context = { sampleRate: SAMPLE_RATE, audioWorklet: { async addModule() {} } };
    const node = await EffeTuneNode.create(context, soundFontDocument({}, [
      { id: 'volume', type: 'Volume', parameters: {} }
    ]), { assetResolver: () => sineBank });
    node.sendMidi('piano', midi.noteOn(0, 60, 100));
    assert.deepEqual(node.port.messages.at(-1), { type: 'midi', effectId: 'piano', midi: [0x90, 60, 100] });
    assert.throws(() => node.sendMidi('volume', midi.noteOn(0, 60, 100)), /does not accept MIDI/);
    assert.throws(() => node.sendMidi('piano', [0x90, 60]), ValidationError);
    node.sendMidi('piano', new Uint8Array([0xc1, 5]));
    assert.deepEqual(node.port.messages.at(-1), { type: 'midi', effectId: 'piano', midi: [0xc1, 5, 0] });
    const posted = node.port.messages.length;
    node.sendMidi('piano', new Uint8Array([0xfe]));
    node.sendMidi('piano', new Uint8Array([0xd0, 64]));
    assert.equal(node.port.messages.length, posted);
    // The caller's bank stays usable after it is handed to the worklet.
    assert.equal(sineBank.payload.byteLength > 0, true);
    node.close();
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});
