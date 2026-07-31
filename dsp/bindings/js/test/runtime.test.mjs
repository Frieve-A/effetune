import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { generateStimulus } from '../../../../tools/dsp-parity/stimuli.mjs';

import {
  AssetError,
  BitCrusher,
  BrickwallLimiter,
  Compressor,
  EFFECT_CATALOG,
  EFFECT_METADATA,
  EFFECT_TYPES,
  IRReverb,
  LevelMeter,
  LoPassFilter,
  Matrix,
  Oscilloscope,
  Spectrogram,
  SpectrumAnalyzer,
  StereoMeter,
  StateError,
  ValidationError,
  Volume,
  createChain,
  encodeEta1,
  EffectError,
  EffeTuneRuntimeError,
  isBundleDocument
} from '../dist/index.js';
import { loadDspArtifact } from '../dist/artifacts.js';
import {
  _EFFECT_IMPLEMENTATION,
  createEffect
} from '../dist/generated-effects.js';
import { normalizeChainDocument, packEffect } from '../dist/semantics.js';

function constantAudio(channels, frames, value = 1) {
  return Array.from({ length: channels }, () => new Float32Array(frames).fill(value));
}

function planarChannels(data, channels, frames) {
  return Array.from({ length: channels }, (_, channel) =>
    data.slice(channel * frames, (channel + 1) * frames)
  );
}

function decodeFloat32Le(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return Float32Array.from(
    { length: buffer.byteLength / Float32Array.BYTES_PER_ELEMENT },
    (_, index) => view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true)
  );
}

async function renderVolumeEventGolden(variant) {
  const metadataUrl = new URL(
    '../../../plugins/basics/volume/golden/case-016.json',
    import.meta.url
  );
  const metadata = JSON.parse(await readFile(metadataUrl, 'utf8'));
  const expected = decodeFloat32Le(
    await readFile(new URL(metadata.binary, metadataUrl))
  );
  const stimulus = generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex
  });
  const chain = await createChain([
    new Volume({ id: 'gain', volume: metadata.params.vl })
  ], { variant });
  const stream = await chain.stream({
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    blockSize: metadata.blockSize,
    seed: Number(BigInt(metadata.seed))
  });
  try {
    const output = await stream.process(
      planarChannels(stimulus, metadata.channels, metadata.frameCount),
      {
        events: metadata.events.map(event => ({
          frame: event.frame,
          effectId: 'gain',
          parameters: { volume: event.params.vl }
        }))
      }
    );
    const expectedChannels = planarChannels(
      expected,
      metadata.channels,
      metadata.frameCount
    );
    for (let channel = 0; channel < metadata.channels; channel++) {
      for (let frame = 0; frame < metadata.frameCount; frame++) {
        assert.ok(
          Math.abs(output[channel][frame] - expectedChannels[channel][frame]) <=
            metadata.tolerance.abs,
          `${variant} channel ${channel} frame ${frame}`
        );
      }
    }
  } finally {
    stream.close();
    chain.close();
  }
}

test('generated effects import and the public catalog stays semantic', async () => {
  const generated = await import('../dist/generated-effects.js');
  const compressor = new generated.Compressor({ threshold: -18 });
  assert.equal(compressor.type, 'Compressor');
  assert.equal(compressor.parameters.threshold, -18);
  assert.equal(EFFECT_TYPES.length, 76);
  assert.equal(EFFECT_CATALOG.effects.length, 76);
  assert.deepEqual(EFFECT_CATALOG.channels, [
    'all', 'stereo', 'left', 'right',
    '1', '2', '3', '4', '5', '6', '7', '8', '34', '56', '78'
  ]);
  assert.ok(EFFECT_METADATA.effects.every(effect => !Object.hasOwn(effect, 'implementation')));
  const entry = await import('../dist/index.js');
  assert.equal(Object.hasOwn(entry, '_EFFECT_IMPLEMENTATION'), false);
  assert.equal(typeof isBundleDocument, 'function');
  assert.equal(isBundleDocument({ version: 1, chain: {}, assets: [] }), true);
});

test('all generated effects normalize and pack against their private layouts', () => {
  const assetTypes = new Set([
    'FIRCrossover',
    'FiveBandFIRPEQ',
    'GroupDelayEQ',
    'IRReverb',
    'RoomEQ'
  ]);
  for (const type of EFFECT_TYPES) {
    const options = assetTypes.has(type)
      ? { assets: { impulseResponse: 'ir' } }
      : {};
    const effect = createEffect(type, options);
    const normalized = normalizeChainDocument([effect]).chain[0];
    const packed = packEffect(normalized);
    assert.equal(packed.values.length, _EFFECT_IMPLEMENTATION[type].floatCount, type);
    assert.equal(packed.hash, _EFFECT_IMPLEMENTATION[type].layoutHash, type);
  }
});

test('Matrix routes require complete route grammar before native packing', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../common/matrix-routes-v1.fixture.json', import.meta.url),
    'utf8'
  )).routeStrings;
  const definition = EFFECT_METADATA.effects
    .find(entry => entry.type === 'Matrix').parameters[0];
  assert.equal(definition.name, 'matrixRoutes');
  assert.equal(definition.pattern, fixture.pattern);
  for (const matrixRoutes of fixture.valid) {
    const normalized = normalizeChainDocument([
      new Matrix({ matrixRoutes })
    ]).chain[0];
    assert.equal(normalized.parameters.matrixRoutes, matrixRoutes);
  }
  const expectedMessage =
    "Matrix.matrixRoutes has an invalid format; expected a string matching " +
    "^(?:p?[0-8][0-8])*$ (for example '0011').";
  for (const matrixRoutes of fixture.invalid) {
    const matrix = new Matrix({ matrixRoutes });
    assert.throws(
      () => normalizeChainDocument([matrix]),
      error => error instanceof ValidationError && error.message === expectedMessage
    );
    await assert.rejects(createChain([matrix]), ValidationError);
  }

  const outOfRange = normalizeChainDocument([
    new Matrix({ matrixRoutes: '88' })
  ]).chain[0];
  assert.deepEqual(
    [...packEffect(outOfRange).bytes],
    [1, 0, 1, 0, 8, 8, 0]
  );

  const chain = await createChain([
    new Matrix({ id: 'matrix', matrixRoutes: '88' })
  ], { variant: 'baseline' });
  const input = constantAudio(2, 8);
  try {
    const output = await chain.process(input, { sampleRate: 48000 });
    assert.ok(output.every(channel => channel.every(value => value === 0)));
    const stream = await chain.stream({
      sampleRate: 48000,
      channels: 2,
      blockSize: 8
    });
    try {
      await assert.rejects(
        stream.process(input, {
          events: [{
            frame: 0,
            effectId: 'matrix',
            parameters: { matrixRoutes: '0011p' }
          }]
        }),
        ValidationError
      );
      const unchanged = await stream.process(input);
      assert.ok(unchanged.every(channel => channel.every(value => value === 0)));
    } finally {
      stream.close();
    }
  } finally {
    chain.close();
  }
});

// The Python binding already reports this as ValidationError
// ("Matrix.matrixRoutes contains too many routes"); the generated JavaScript packer
// reports it as a plain RangeError, so the bindings boundary translates it and keeps
// process/stream/setParam inside the documented error taxonomy.
test('Matrix route capacity overflow is a public validation error, not a RangeError', async () => {
  // 1025 two-character routes stay inside the 3072-character parameter limit and the
  // route grammar, so they reach the packer's 1024-route structured capacity.
  const matrixRoutes = '00'.repeat(1025);
  const definition = EFFECT_METADATA.effects
    .find(entry => entry.type === 'Matrix').parameters[0];
  assert.ok(matrixRoutes.length <= definition.maximumLength);
  const overflowing = normalizeChainDocument([new Matrix({ matrixRoutes })]).chain[0];
  assert.throws(
    () => packEffect(overflowing),
    error => error instanceof ValidationError &&
      !(error instanceof RangeError) &&
      error.message.includes('matrixRoutes') &&
      error.message.includes('route capacity')
  );
  const chain = await createChain([new Matrix({ id: 'matrix', matrixRoutes: '0011' })], {
    variant: 'baseline'
  });
  try {
    chain.setParam('matrix', 'matrixRoutes', matrixRoutes);
    await assert.rejects(
      chain.process(constantAudio(2, 8), { sampleRate: 48000 }),
      ValidationError
    );
  } finally {
    chain.close();
  }
});

test('unknown generated factory types use the public effect error', () => {
  assert.throws(() => createEffect('NotAnEffect'), EffectError);
});

test('artifact response body failures use the public runtime error', async () => {
  await assert.rejects(
    loadDspArtifact({
      variant: 'baseline',
      cache: false,
      wasmUrl: 'https://example.test/dsp.wasm',
      metaUrl: 'https://example.test/dsp.json',
      fetch: async url => ({
        ok: true,
        arrayBuffer: async () => {
          throw new Error(`cannot read ${url}`);
        },
        text: async () => '{"abiVersion":1,"kernels":[]}'
      })
    }),
    EffeTuneRuntimeError
  );
});

test('chain normalization materializes defaults and deterministic unique ids', async () => {
  const chain = await createChain([
    new Compressor({ threshold: -20 }),
    new Compressor({ id: 'Compressor#1', ratio: 3 }),
    new Volume()
  ]);
  assert.deepEqual(chain.effects.map(effect => effect.id), [
    'Compressor#2',
    'Compressor#1',
    'Volume#1'
  ]);
  assert.equal(chain.effects[0].parameters.ratio, 2);
  chain.close();

  await assert.rejects(
    createChain({
      version: 1,
      chain: [
        { id: 'same', type: 'Volume', parameters: {} },
        { id: 'same', type: 'Volume', parameters: {} }
      ]
    }),
    ValidationError
  );
});

test('IR Reverb requires an explicit asset at construction and chain validation', async () => {
  assert.throws(() => new IRReverb(), AssetError);
  assert.throws(
    () => new IRReverb({ assets: { impulseResponse: 'room', unknown: 'room' } }),
    AssetError
  );
  assert.throws(
    () => new Volume({ assets: { impulseResponse: 'room' } }),
    AssetError
  );
  await assert.rejects(
    createChain({
      version: 1,
      chain: [{ type: 'IRReverb', parameters: {} }]
    }),
    AssetError
  );
});

test('identity processing returns owned copies and close is idempotent', async () => {
  const chain = await createChain([]);
  const input = constantAudio(2, 0);
  const output = await chain.process(input, { sampleRate: 48000 });
  assert.notEqual(output[0], input[0]);
  chain.reset();
  chain.close();
  chain.close();
  await assert.rejects(chain.process(input, { sampleRate: 48000 }), StateError);
});

test('baseline processing is serial, channel-aware, fresh, and does not mutate input', async () => {
  const chain = await createChain([
    new Volume({ id: 'left', volume: -6, channel: 'left' }),
    new Volume({ id: 'all', volume: -6, channel: 'all' })
  ], { variant: 'baseline' });
  const input = constantAudio(2, 256);
  const before = input.map(channel => new Float32Array(channel));
  const first = await chain.process(input, { sampleRate: 48000, seed: 9 });
  const second = await chain.process(input, { sampleRate: 48000, seed: 9 });
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first[0][255] - 0.25118864) < 2e-5);
  assert.ok(Math.abs(first[1][255] - 0.5011872) < 2e-5);

  chain.setParam('all', 'volume', 0).reset();
  const changed = await chain.process(input, { sampleRate: 48000, seed: 9 });
  assert.ok(Math.abs(changed[1][255] - 1) < 2e-5);
  chain.close();
});

test('offline processing rejects non-finite audio samples before native processing', async () => {
  const chain = await createChain([new LoPassFilter()], { variant: 'baseline' });
  try {
    for (const value of [NaN, Infinity, -Infinity]) {
      const input = constantAudio(2, 16, 0.25);
      input[1][7] = value;
      await assert.rejects(
        chain.process(input, { sampleRate: 48000 }),
        error =>
          error instanceof ValidationError &&
          error.message === 'Audio samples must all be finite.'
      );
    }
  } finally {
    chain.close();
  }
});

test('stream rejects non-finite audio without contaminating native state', async () => {
  const chain = await createChain([new LoPassFilter()], { variant: 'baseline' });
  const stream = await chain.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 16
  });
  const control = await chain.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 16
  });
  try {
    const warmup = constantAudio(1, 16, 0.25);
    assert.deepEqual(await stream.process(warmup), await control.process(warmup));

    for (const value of [NaN, Infinity, -Infinity]) {
      const invalid = constantAudio(1, 16, 0.25);
      invalid[0][7] = value;
      await assert.rejects(
        stream.process(invalid),
        error =>
          error instanceof ValidationError &&
          error.message === 'Audio samples must all be finite.'
      );
    }

    const clean = constantAudio(1, 16, -0.125);
    const output = await stream.process(clean);
    assert.ok(output[0].every(Number.isFinite));
    assert.deepEqual(output, await control.process(clean));
  } finally {
    stream.close();
    control.close();
    chain.close();
  }
});

test('seeded effects restart from the same seed on every offline call', async () => {
  const chain = await createChain([
    new BitCrusher({ bitDepth: 8, bitError: 10, tpdfDither: true })
  ], { variant: 'baseline' });
  const input = constantAudio(1, 257, 0.25);
  const first = await chain.process(input, { sampleRate: 48000, seed: 1234, blockSize: 63 });
  const second = await chain.process(input, { sampleRate: 48000, seed: 1234, blockSize: 63 });
  const third = await chain.process(input, { sampleRate: 48000, seed: 4321, blockSize: 63 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
  chain.close();
});

test('all five analyzer telemetry decoders expose semantic observations', async t => {
  const frames = 16384;
  const input = [new Float32Array(frames), new Float32Array(frames)];
  for (let frame = 0; frame < frames; frame++) {
    input[0][frame] = Math.sin(2 * Math.PI * 997 * frame / 48000);
    input[1][frame] = 0.5 * Math.sin(2 * Math.PI * 1499 * frame / 48000);
  }
  const cases = [
    {
      effect: new LevelMeter({ id: 'meter' }),
      kind: 'level',
      verify(frame) {
        assert.equal(frame.channels.length, 2);
        assert.ok(frame.channels[0].peak > 0.9);
        assert.ok(frame.channels[0].rms > 0.6);
        assert.ok(frame.channels[0].peak > frame.channels[1].peak);
        assert.ok(frame.channels.every(channel =>
          Number.isFinite(channel.peak) &&
          Number.isFinite(channel.rms) &&
          channel.peak >= 0 &&
          channel.rms >= 0 &&
          channel.clipped === false
        ));
      }
    },
    {
      effect: new Oscilloscope({ id: 'scope', displayTime: 0.005 }),
      kind: 'oscilloscope',
      verify(frame) {
        assert.equal(frame.sampleRate, 48000);
        assert.equal(frame.encoding, 'samples');
        assert.equal(frame.sampleIndices.length, frame.values.length);
        assert.ok(frame.values.length > 100);
        assert.equal(frame.sampleIndices[0], 0);
        assert.ok(frame.sampleIndices.at(-1) < frame.captureSampleCount);
        assert.ok(frame.values.every(Number.isFinite));
        assert.ok(Math.max(...frame.values) - Math.min(...frame.values) > 0.5);
      }
    },
    {
      effect: new SpectrumAnalyzer({ id: 'spectrum', points: 10 }),
      kind: 'spectrum',
      verify(frame) {
        assert.equal(frame.sampleRate, 48000);
        assert.equal(frame.points, 10);
        assert.equal(frame.binsTruncated, false);
        assert.equal(frame.currentDb.length, 513);
        assert.equal(frame.peakDb.length, 513);
        assert.ok(frame.currentDb.every(Number.isFinite));
        assert.ok(frame.peakDb.every(Number.isFinite));
        assert.ok(Math.max(...frame.currentDb) > -20);
        assert.ok(Math.max(...frame.currentDb) - Math.min(...frame.currentDb) > 20);
      }
    },
    {
      effect: new Spectrogram({ id: 'spectrogram', points: 10 }),
      kind: 'spectrogram',
      verify(frame) {
        assert.equal(frame.sampleRate, 48000);
        assert.equal(frame.points, 10);
        assert.ok(frame.timeSeconds > 0);
        assert.equal(frame.intensities.length, 256);
        assert.ok(frame.intensities.every(value => value >= 0 && value <= 255));
        assert.ok(Math.max(...frame.intensities) > 0);
      }
    },
    {
      effect: new StereoMeter({ id: 'stereo', windowTime: 0.02 }),
      kind: 'stereo',
      verify(frame) {
        assert.equal(frame.sampleRate, 48000);
        assert.equal(frame.samples.length % 2, 0);
        assert.ok(frame.samples.length > 0);
        assert.equal(frame.envelope.length, 360);
        assert.ok(frame.samples.every(Number.isFinite));
        assert.ok(frame.envelope.every(value => Number.isFinite(value) && value >= 0));
        assert.ok(frame.correlation >= -1 && frame.correlation <= 1);
        assert.ok(Number.isFinite(frame.balance));
        assert.ok(frame.peakLeft > frame.peakRight);
        assert.ok(frame.peakRight > 0.4);
      }
    }
  ];
  for (const analyzer of cases) {
    await t.test(analyzer.kind, async () => {
      const chain = await createChain([analyzer.effect], { variant: 'baseline' });
      const stream = await chain.stream({
        sampleRate: 48000,
        channels: 2,
        blockSize: 128
      });
      const received = [];
      const callback = frame => received.push(frame);
      const unsubscribe = stream.subscribe(callback);
      try {
        const output = await stream.process(input);
        assert.deepEqual(output, input);
        assert.ok(received.length > 0);
        const frame = received.at(-1);
        assert.equal(frame.kind, analyzer.kind);
        assert.equal(frame.effectType, analyzer.effect.type);
        assert.equal(frame.effectId, analyzer.effect.id);
        assert.equal(frame.effectIndex, 0);
        assert.ok(Number.isInteger(frame.sequence) && frame.sequence >= 0);
        assert.equal(frame.dropped, 0);
        analyzer.verify(frame);
        assert.equal(stream.droppedTelemetryFrames, 0);
        const count = received.length;
        assert.equal(unsubscribe(), true);
        assert.equal(stream.unsubscribe(callback), false);
        await stream.process(input);
        assert.equal(received.length, count);
      } finally {
        stream.close();
        chain.close();
      }
    });
  }
});

test('offline analyzer processing accepts a semantic telemetry callback', async () => {
  const chain = await createChain([
    new LevelMeter({ id: 'meter' })
  ], { variant: 'baseline' });
  const received = [];
  const input = constantAudio(2, 2048, 0.25);
  try {
    const output = await chain.process(input, {
      sampleRate: 48000,
      blockSize: 128,
      onTelemetry: frame => received.push(frame)
    });
    assert.deepEqual(output, input);
    assert.ok(received.some(frame =>
      frame.kind === 'level' &&
      frame.effectType === 'LevelMeter' &&
      frame.effectId === 'meter'
    ));
  } finally {
    chain.close();
  }
});

test('stateful stream setParam and reset preserve the declared lifetime', async () => {
  const chain = await createChain([
    new BitCrusher({
      id: 'crusher',
      bitDepth: 8,
      bitError: 10,
      tpdfDither: true
    })
  ], { variant: 'baseline' });
  const stream = await chain.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 63,
    seed: 1234
  });
  const input = constantAudio(1, 257, 0.25);
  const first = await stream.process(input);
  stream.setParam('crusher', 'bitDepth', 4);
  const changed = await stream.process(input);
  stream.reset();
  assert.equal(stream.effects[0].parameters.bitDepth, 8);
  const restarted = await stream.process(input);
  assert.notDeepEqual(changed, first);
  assert.deepEqual(restarted, first);
  stream.close();
  stream.close();
  await assert.rejects(stream.process(input), StateError);
  chain.close();
});

test('stream latencySamples stays fresh across parameters, reset, and events', async () => {
  const chain = await createChain([
    new BrickwallLimiter({ id: 'limiter', lookahead: 3 }),
    new BrickwallLimiter({ id: 'disabled', enabled: false, lookahead: 10 })
  ], { variant: 'baseline' });
  const stream = await chain.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 8
  });
  assert.equal(stream.latencySamples, 144);
  stream.setParam('limiter', 'lookahead', 6);
  assert.equal(stream.latencySamples, 288);
  stream.reset();
  assert.equal(stream.latencySamples, 144);
  await stream.process([new Float32Array(8)], {
    events: [{
      frame: 0,
      effectId: 'limiter',
      parameters: { lookahead: 9 }
    }]
  });
  assert.equal(stream.latencySamples, 432);
  stream.close();
  assert.throws(() => stream.latencySamples, StateError);
  chain.close();

  const emptyChain = await createChain([]);
  const emptyStream = await emptyChain.stream({ sampleRate: 48000, channels: 1 });
  assert.equal(emptyStream.latencySamples, 0);
  emptyStream.close();
  emptyChain.close();
});

test('chain latencySamples matches an opened stream without disturbing later results', async () => {
  const chain = await createChain([
    new BrickwallLimiter({ id: 'limiter', lookahead: 3 })
  ], { variant: 'baseline' });
  const input = constantAudio(1, 64, 0.5);
  const reference = await chain.process(input, { sampleRate: 48000, blockSize: 8 });

  const latency = await chain.latencySamples({ sampleRate: 48000, channels: 1 });
  assert.equal(latency, 144);
  const stream = await chain.stream({ sampleRate: 48000, channels: 1, blockSize: 8 });
  assert.equal(latency, stream.latencySamples);
  stream.close();

  const afterQuery = await chain.process(input, { sampleRate: 48000, blockSize: 8 });
  assert.deepEqual(afterQuery, reference);
  const repeated = await chain.latencySamples({ sampleRate: 48000, channels: 1 });
  assert.equal(repeated, latency);
  assert.equal(await chain.latencySamples({ sampleRate: 48000 }), 144);
  chain.close();
  await assert.rejects(chain.latencySamples({ sampleRate: 48000 }), StateError);

  const plainChain = await createChain([
    new Volume({ id: 'gain', volume: -6 })
  ], { variant: 'baseline' });
  assert.equal(await plainChain.latencySamples({ sampleRate: 48000, channels: 1 }), 0);
  plainChain.close();

  const emptyChain = await createChain([]);
  assert.equal(await emptyChain.latencySamples({ sampleRate: 48000 }), 0);
  emptyChain.close();

  const invalidChain = await createChain([new Volume({ volume: 0 })], { variant: 'baseline' });
  await assert.rejects(invalidChain.latencySamples({ sampleRate: 0 }), ValidationError);
  invalidChain.close();
});

test('parameter events validate boundaries, ordering, ids, and semantic values before processing', async () => {
  const chain = await createChain([
    new Volume({ id: 'gain', volume: 0 })
  ], { variant: 'baseline' });
  const stream = await chain.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 4
  });
  const input = constantAudio(1, 8);
  await stream.process(input, {
    events: [
      { frame: 0, effectId: 'gain', parameters: { volume: -60 } },
      { frame: 0, effectId: 'gain', parameters: { volume: 0 } },
      { frame: 7, effectId: 'gain', parameters: { volume: -6 } }
    ]
  });
  assert.equal(stream.effects[0].parameters.volume, -6);

  const invalidEvents = [
    [{ frame: 8, effectId: 'gain', parameters: { volume: 0 } }],
    [
      { frame: 4, effectId: 'gain', parameters: { volume: 0 } },
      { frame: 3, effectId: 'gain', parameters: { volume: 0 } }
    ],
    [{ frame: 0, effectId: 'missing', parameters: { volume: 0 } }],
    [{ frame: 0, effectId: 'gain', parameters: { missing: 0 } }],
    [{ frame: 0, effectId: 'gain', parameters: { volume: 100 } }]
  ];
  for (const events of invalidEvents) {
    await assert.rejects(stream.process(input, { events }), ValidationError);
  }
  stream.close();
  chain.close();
});

test('asset-backed streams keep assets for live updates and reject reconfiguration', async () => {
  const payload = encodeEta1({
    channels: [Float32Array.of(1)],
    sampleRate: 48000,
    topology: 'mono'
  });
  const chain = await createChain([
    new IRReverb({
      id: 'room',
      assets: { impulseResponse: 'room-ir' },
      channelMode: 'mono',
      latency: 0,
      convolutionRate: 'full',
      wetLevel: -15
    })
  ], {
    variant: 'baseline',
    assetResolver: () => payload
  });
  const stream = await chain.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 8
  });
  try {
    stream.setParam('room', 'wetLevel', -9);
    await stream.process(constantAudio(1, 8, 0), {
      events: [{
        frame: 0,
        effectId: 'room',
        parameters: { dryLevel: -6 }
      }]
    });
    assert.equal(stream.effects[0].parameters.wetLevel, -9);
    assert.equal(stream.effects[0].parameters.dryLevel, -6);

    for (const [parameter, value] of [
      ['channelMode', 'independent'],
      ['latency', 256],
      ['convolutionRate', 'half']
    ]) {
      assert.throws(
        () => stream.setParam('room', parameter, value),
        error => error instanceof ValidationError &&
          error.message.includes('cannot be updated while a stream is open')
      );
      await assert.rejects(
        stream.process(constantAudio(1, 8, 0), {
          events: [{
            frame: 0,
            effectId: 'room',
            parameters: { [parameter]: value }
          }]
        }),
        ValidationError
      );
      assert.equal(stream.effects[0].parameters[parameter], {
        channelMode: 'mono',
        latency: 0,
        convolutionRate: 'full'
      }[parameter]);
    }
  } finally {
    stream.close();
    chain.close();
  }
});

test('baseline parameter events match the frozen Volume golden', async () => {
  await renderVolumeEventGolden('baseline');
});

test('SIMD parameter events match the frozen Volume golden when supported', async t => {
  try {
    await renderVolumeEventGolden('simd');
  } catch (error) {
    if (error?.message?.includes('does not support SIMD')) {
      t.skip('WebAssembly SIMD is unavailable');
      return;
    }
    throw error;
  }
});

test('SIMD artifact processes when the runtime supports it', async t => {
  let chain;
  try {
    chain = await createChain([new Compressor()], { variant: 'simd' });
  } catch (error) {
    if (error?.message?.includes('does not support SIMD')) {
      t.skip('WebAssembly SIMD is unavailable');
      return;
    }
    throw error;
  }
  const output = await chain.process(constantAudio(1, 128), { sampleRate: 48000 });
  assert.equal(output[0].length, 128);
  chain.close();
});

test('invalid parameters, sample rates, seeds, and unavailable channels fail explicitly', async () => {
  await assert.rejects(
    createChain({ version: 1, chain: [{ type: 'Volume', parameters: { volume: 100 } }] }),
    ValidationError
  );
  const fm = await createChain({
    version: 1,
    chain: [{ type: 'FMRadioSimulator', parameters: {} }]
  });
  await assert.rejects(
    fm.process(constantAudio(2, 16), { sampleRate: 32000 }),
    ValidationError
  );
  fm.close();

  const right = await createChain([
    new Volume({ channel: 'right' })
  ]);
  await assert.rejects(
    right.process(constantAudio(1, 16), { sampleRate: 48000 }),
    ValidationError
  );
  await assert.rejects(
    right.process(constantAudio(2, 16), { sampleRate: 48000, seed: -1 }),
    ValidationError
  );
  right.close();
});

test('disabled IR Reverb remains schema-valid without resolving or processing its asset', async () => {
  let resolverCalls = 0;
  const chain = await createChain([
    new IRReverb({
      enabled: false,
      assets: { impulseResponse: 'unused' }
    })
  ], {
    assetResolver() {
      resolverCalls++;
      throw new Error('disabled assets must not be resolved');
    }
  });
  const input = constantAudio(2, 16, 0.25);
  assert.deepEqual(await chain.process(input, { sampleRate: 48000 }), input);
  assert.equal(resolverCalls, 0);
  chain.close();
});
