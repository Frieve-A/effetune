import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isMain, parseArgs } from './cli.mjs';
import { compareAudio, formatComparison } from './tolerance.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturePath = path.join(
  repositoryRoot,
  'dsp',
  'bindings',
  'common',
  'graph-v1-parity.fixture.json'
);

export async function loadGraphParityFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

function makeInput(testCase) {
  if (testCase.input.kind !== 'impulse') {
    throw new Error(`${testCase.id}: unsupported input kind ${testCase.input.kind}`);
  }
  const audio = Array.from(
    { length: testCase.channels },
    () => new Float32Array(testCase.frames)
  );
  testCase.input.channelValues.forEach((value, channel) => {
    audio[channel][testCase.input.frame] = value;
  });
  return audio;
}

function makeExpectedAudio(testCase) {
  if (testCase.expected.audio.kind !== 'sparse') {
    throw new Error(`${testCase.id}: unsupported expected audio kind ${testCase.expected.audio.kind}`);
  }
  const audio = Array.from(
    { length: testCase.channels },
    () => new Float32Array(testCase.frames)
  );
  for (const point of testCase.expected.audio.points) {
    audio[point.channel][point.frame] = point.value;
  }
  return audio;
}

function assertSubset(expected, actual, label) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`${label}: expected array length ${expected.length}`);
    }
    expected.forEach((value, index) => assertSubset(value, actual[index], `${label}/${index}`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {
      throw new Error(`${label}: expected an object`);
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!(key in actual)) throw new Error(`${label}: missing ${key}`);
      assertSubset(value, actual[key], `${label}/${key}`);
    }
    return;
  }
  if (!Object.is(expected, actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function makeAssetResolver(api, testCase) {
  const assets = testCase.assets ?? {};
  const encoded = new Map(Object.entries(assets).map(([reference, asset]) => [
    reference,
    api.encodeEta1({
      channels: asset.channels.map(channel => Float32Array.from(channel)),
      sampleRate: asset.sampleRate,
      topology: asset.topology
    })
  ]));
  return reference => {
    const asset = encoded.get(reference);
    if (!asset) throw new Error(`${testCase.id}: unknown asset ${reference}`);
    return asset;
  };
}

async function processSplits(stream, source, splits) {
  const output = source.map(channel => new Float32Array(channel.length));
  let offset = 0;
  for (const frames of splits) {
    const block = source.map(channel => channel.slice(offset, offset + frames));
    const processed = await stream.process(block);
    processed.forEach((channel, index) => output[index].set(channel, offset));
    offset += frames;
  }
  if (offset !== source[0].length) {
    throw new Error(`block splits cover ${offset} of ${source[0].length} frames`);
  }
  return output;
}

async function runCase(api, fixture, testCase, variant) {
  const source = makeInput(testCase);
  const expected = makeExpectedAudio(testCase);
  const graph = await api.createGraph(testCase.document, {
    variant,
    assetResolver: makeAssetResolver(api, testCase)
  });
  let stream;
  try {
    stream = await graph.stream({
      sampleRate: testCase.sampleRate,
      channels: testCase.channels,
      blockSize: Math.max(...testCase.blockSplits),
      seed: testCase.seed
    });
    if (stream.latencySamples !== testCase.expected.latencySamples) {
      throw new Error(
        `${testCase.id}/${variant}: expected latency ${testCase.expected.latencySamples}, ` +
        `received ${stream.latencySamples}`
      );
    }
    assertSubset(
      testCase.expected.snapshot,
      stream.compileSnapshot,
      `${testCase.id}/${variant}/snapshot`
    );
    const actual = await processSplits(stream, source, testCase.blockSplits);
    actual.forEach((channel, index) => {
      const comparison = compareAudio(expected[index], channel, fixture.tolerance);
      if (!comparison.pass) {
        throw new Error(
          `${testCase.id}/${variant}/channel-${index}: ${formatComparison(comparison)}`
        );
      }
    });
    if (testCase.resetEquality) {
      stream.reset();
      const replay = await processSplits(stream, source, testCase.blockSplits);
      replay.forEach((channel, index) => {
        const comparison = compareAudio(actual[index], channel, fixture.tolerance);
        if (!comparison.pass) {
          throw new Error(
            `${testCase.id}/${variant}/reset/channel-${index}: ${formatComparison(comparison)}`
          );
        }
      });
    }
  } finally {
    stream?.close();
    graph.close();
  }
}

export async function runGraphParityCases(api, { variants = ['baseline', 'simd'] } = {}) {
  const fixture = await loadGraphParityFixture();
  let passed = 0;
  for (const variant of variants) {
    for (const testCase of fixture.cases) {
      await runCase(api, fixture, testCase, variant);
      passed++;
      console.log(`PASS graph-v1/${testCase.id}/${variant}`);
    }
  }
  return { passed, total: fixture.cases.length * variants.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiPath = args.api
    ? path.resolve(String(args.api))
    : path.join(repositoryRoot, 'dsp', 'bindings', 'js', 'dist', 'index.js');
  const variants = args.variants
    ? String(args.variants).split(',').map(value => value.trim()).filter(Boolean)
    : ['baseline', 'simd'];
  const api = await import(pathToFileURL(apiPath).href);
  const result = await runGraphParityCases(api, { variants });
  console.log(`Graph v1 parity: ${result.passed}/${result.total} passed.`);
}

if (isMain(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
