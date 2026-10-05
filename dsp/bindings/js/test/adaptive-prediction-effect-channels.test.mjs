import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdaptivePredictionEffect,
  ValidationError,
  createChain,
  createGraph
} from '../dist/index.js';
import { EffeTuneNode } from '../dist/worklet.js';

const predictionParameters = { freeze: true, original: 0, residual: 0, prediction: 1 };
const channelError =
  'AdaptivePredictionEffect processes one or two channels; select stereo or a single channel.';
const selections = [
  ['all', 1, 0, 1],
  ['all', 2, 0, 2],
  ['stereo', 4, 0, 2],
  ['left', 4, 0, 1],
  ['right', 4, 1, 1],
  ['4', 4, 3, 1],
  ['34', 4, 2, 2]
];

function audio(channels) {
  return Array.from({ length: channels }, () => new Float32Array(8).fill(0.25));
}

function graphDocument(channel, { enabled = true, mute = false } = {}) {
  return {
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [{ id: 'ape', type: 'AdaptivePredictionEffect', channel,
      enabled, parameters: predictionParameters }],
    edges: [
      { id: 'in', source: 'input', destination: 'ape' },
      { id: 'out', source: 'ape', destination: 'output', mute }
    ]
  };
}

function assertSelectedPrediction(output, start, count) {
  output.forEach((channel, index) => {
    const expected = index >= start && index < start + count ? 0 : 0.25;
    assert.ok(channel.every(sample => sample === expected), `output channel ${index + 1}`);
  });
}

test('APE Chain rejects all-channel multichannel processing before opening an engine', async () => {
  const chain = await createChain([new AdaptivePredictionEffect()], { variant: 'baseline' });
  chain._artifactForCurrentDocument = () => {
    assert.fail('Unsupported channel selection must be rejected before opening an engine.');
  };
  try {
    const options = { sampleRate: 48000, channels: 4 };
    for (const operation of [
      () => chain.prewarm(options),
      () => chain.stream(options),
      () => chain.latencySamples(options),
      () => chain.process(audio(4), options)
    ]) {
      await assert.rejects(operation, error =>
        error instanceof ValidationError && error.message === channelError);
    }
  } finally {
    chain.close();
  }
});

test('APE Graph rejects effective all-channel multichannel nodes with their document location', async () => {
  const graph = await createGraph(graphDocument('all'), { variant: 'baseline' });
  graph._artifactForCurrentDocument = () => {
    assert.fail('Unsupported channel selection must be rejected before opening an engine.');
  };
  try {
    for (const operation of [
      () => graph.stream({ sampleRate: 48000, channels: 4 }),
      () => graph.process(audio(4), { sampleRate: 48000 })
    ]) {
      await assert.rejects(operation, error => error instanceof ValidationError &&
        error.message === channelError && error.code === 'GRAPH_DOCUMENT_CHANNEL' &&
        error.path === '/nodes/0/channel' && error.nodeId === 'ape');
    }
  } finally {
    graph.close();
  }
});

for (const variant of ['baseline', 'simd']) {
  test(`APE ${variant} Chain and Graph accept low, high, and nonstandard sample rates`, async () => {
    for (const sampleRate of [8000, 32000, 50000, 96000, 192000, 352800, 384000]) {
      const chain = await createChain([
        new AdaptivePredictionEffect(predictionParameters)
      ], { variant });
      const graph = await createGraph(graphDocument('all'), { variant });
      let chainStream;
      let graphStream;
      try {
        await chain.prewarm({ sampleRate, channels: 2 });
        assert.equal(await chain.latencySamples({ sampleRate, channels: 2 }), 0);
        chainStream = await chain.stream({ sampleRate, channels: 2, blockSize: 8 });
        graphStream = await graph.stream({ sampleRate, channels: 2, blockSize: 8 });
        assertSelectedPrediction(await chainStream.process(audio(2)), 0, 2);
        assertSelectedPrediction(await graphStream.process(audio(2)), 0, 2);
      } finally {
        chainStream?.close();
        graphStream?.close();
        chain.close();
        graph.close();
      }
    }
  });

  test(`APE ${variant} Chain and Graph process mono, stereo, and selected multichannel routes`, async () => {
    for (const [channel, channels, start, count] of selections) {
      const chain = await createChain([
        new AdaptivePredictionEffect({ channel, ...predictionParameters })
      ], { variant });
      const graph = await createGraph(graphDocument(channel), { variant });
      let chainStream;
      let graphStream;
      try {
        chainStream = await chain.stream({ sampleRate: 48000, channels, blockSize: 8 });
        graphStream = await graph.stream({ sampleRate: 48000, channels, blockSize: 8 });
        assertSelectedPrediction(await chainStream.process(audio(channels)), start, count);
        assertSelectedPrediction(await graphStream.process(audio(channels)), start, count);
      } finally {
        chainStream?.close();
        graphStream?.close();
        chain.close();
        graph.close();
      }
    }
  });
}

test('disabled and dormant APE effects retain their multichannel bypass behavior', async () => {
  const chain = await createChain([
    new AdaptivePredictionEffect({ enabled: false })
  ], { variant: 'baseline' });
  try {
    assert.deepEqual(await chain.process(audio(4), { sampleRate: 48000 }), audio(4));
  } finally {
    chain.close();
  }
  for (const options of [{ enabled: false }, { mute: true }]) {
    const graph = await createGraph(graphDocument('all', options), { variant: 'baseline' });
    let stream;
    try {
      stream = await graph.stream({ sampleRate: 48000, channels: 4 });
    } finally {
      stream?.close();
      graph.close();
    }
  }
});

test('APE Worklet rejects unsupported channels before loading its processor module', async () => {
  let moduleLoads = 0;
  const loadFailure = new Error('Reached processor module loading.');
  const context = { sampleRate: 48000, audioWorklet: { addModule() {
    moduleLoads++;
    throw loadFailure;
  } } };
  await assert.rejects(
    EffeTuneNode.create(context, [new AdaptivePredictionEffect()], { channels: 4 }),
    error => error instanceof ValidationError && error.message === channelError
  );
  assert.equal(moduleLoads, 0);
  await assert.rejects(
    EffeTuneNode.create(context, [new AdaptivePredictionEffect({ channel: '34' })], { channels: 4 }),
    error => error.cause === loadFailure
  );
  assert.equal(moduleLoads, 1);
});
