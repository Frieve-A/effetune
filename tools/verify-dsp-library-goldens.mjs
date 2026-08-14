import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateStimulus } from './dsp-parity/stimuli.mjs';
import { compareAudio } from './dsp-parity/tolerance.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_SUMMARY = path.join(
  REPOSITORY_ROOT,
  '.tmp',
  'dsp-library-goldens-summary.json'
);
const EXPECTED_BACKENDS = Object.freeze({
  'python-native': 848,
  'javascript-baseline': 848,
  'javascript-simd': 848
});
const EXPECTED_WORKLET_GOLDEN = Object.freeze({
  'chromium-audioworklet-baseline': 91,
  'chromium-audioworklet-simd': 91
});
const EXPECTED_WORKLET_NONIDENTITY = Object.freeze({
  'chromium-audioworklet-nonidentity-baseline': 85,
  'chromium-audioworklet-nonidentity-simd': 85
});
const PYTHON_STATE_CONTRACTS = Object.freeze([
  'sameSeed',
  'differentSeed',
  'reset',
  'closeIdempotent',
  'closedRejects',
  'modulationCrossField',
  'frequencyShifterLatency'
]);
const JAVASCRIPT_STATE_CONTRACTS = Object.freeze([
  'sameSeed',
  'differentSeed',
  'closeIdempotent',
  'closedRejects',
  'statefulStream',
  'modulationCrossField',
  'frequencyShifterLatency'
]);
const EXPECTED_VALIDATION_REJECTIONS = Object.freeze({
  'python-native': 1,
  'javascript-baseline': 1,
  'javascript-simd': 1,
  'chromium-audioworklet-baseline': 1,
  'chromium-audioworklet-simd': 1,
  'chromium-audioworklet-nonidentity-baseline': 0,
  'chromium-audioworklet-nonidentity-simd': 0
});

function readArguments(argv) {
  const options = {
    repoRoot: REPOSITORY_ROOT,
    summaryPath: DEFAULT_SUMMARY,
    python: process.env.EFFETUNE_PYTHON ?? null,
    inventoryOnly: false,
    skipPython: false,
    skipJs: false
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--repo-root') options.repoRoot = path.resolve(argv[++index]);
    else if (argument === '--summary') options.summaryPath = path.resolve(argv[++index]);
    else if (argument === '--python') options.python = argv[++index];
    else if (argument === '--inventory-only') options.inventoryOnly = true;
    else if (argument === '--skip-python') options.skipPython = true;
    else if (argument === '--skip-js') options.skipJs = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function frozenGoldenChild(directory, name, label, seen) {
  if (typeof name !== 'string' ||
      name.length === 0 ||
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\\') ||
      path.posix.isAbsolute(name) ||
      path.win32.isAbsolute(name) ||
      seen.has(name)) {
    throw new Error(`Invalid or duplicate frozen golden ${label}: ${String(name)}`);
  }
  seen.add(name);
  const [root, candidate] = await Promise.all([
    fs.realpath(directory),
    fs.realpath(path.join(directory, name))
  ]);
  if (path.dirname(candidate) !== root) {
    throw new Error(`Frozen golden ${label} must be a direct child: ${name}`);
  }
  return candidate;
}

export async function discoverFrozenGoldenCases(repoRoot = REPOSITORY_ROOT) {
  const [privateCatalog, publicCatalog] = await Promise.all([
    readJson(path.join(repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.private.json')),
    readJson(path.join(repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.json'))
  ]);
  const publicByType = new Map(
    publicCatalog.effects.map(definition => [definition.type, definition])
  );
  const frozenSources = Object.entries(privateCatalog.frozenGoldenIndexes ?? {});
  if (frozenSources.length !== Object.keys(privateCatalog.effects).length) {
    throw new Error('Frozen golden source mapping does not match the effect inventory');
  }
  const frozenPaths = frozenSources.map(([, goldenPath]) => goldenPath);
  if (new Set(frozenPaths).size !== frozenPaths.length) {
    throw new Error('Frozen golden source mapping contains a duplicate path');
  }
  const indexByType = new Map();
  for (const [sourcePath, goldenPath] of frozenSources) {
    const expected = path.posix.join(path.posix.dirname(sourcePath), 'golden', 'index.json');
    if (goldenPath !== expected || path.isAbsolute(goldenPath) || goldenPath.startsWith('../')) {
      throw new Error(`Invalid frozen golden path for ${sourcePath}`);
    }
    const indexPath = path.join(repoRoot, ...goldenPath.split('/'));
    const index = await readJson(indexPath);
    if (indexByType.has(index.type)) {
      throw new Error(`Duplicate frozen golden index for ${index.type}`);
    }
    indexByType.set(index.type, { index, indexPath });
  }

  const cases = [];
  for (const [publicType, implementation] of Object.entries(privateCatalog.effects)) {
    const golden = indexByType.get(implementation.internalType);
    if (!golden) throw new Error(`Missing golden index for ${implementation.internalType}`);
    if (!Array.isArray(golden.index.cases)) {
      throw new Error(`Frozen golden index cases must be an array for ${implementation.internalType}`);
    }
    const directory = path.dirname(golden.indexPath);
    const metadataNames = new Set();
    const binaryNames = new Set();
    for (const filename of golden.index.cases) {
      const metadataPath = await frozenGoldenChild(
        directory, filename, 'metadata path', metadataNames
      );
      const metadata = await readJson(metadataPath);
      const referencePath = await frozenGoldenChild(
        directory, metadata.binary, 'binary path', binaryNames
      );
      cases.push({
        publicType,
        implementation,
        definition: publicByType.get(publicType),
        metadata,
        metadataPath,
        referencePath
      });
    }
  }
  return { cases, privateCatalog, publicCatalog };
}

export function summarizeInventory(cases) {
  const counts = {
    effects: new Set(cases.map(item => item.publicType)).size,
    total: cases.length,
    assetCases: cases.filter(item => item.metadata.asset).length,
    eventCases: cases.filter(item => item.metadata.events?.length).length,
    eventCount: cases.reduce(
      (total, item) => total + (item.metadata.events?.length ?? 0),
      0
    )
  };
  const values = key => [...new Set(cases.map(item => item.metadata[key]))]
    .sort((left, right) => left - right);
  return {
    ...counts,
    sampleRates: values('sampleRate'),
    channels: values('channels'),
    blockSizes: values('blockSize')
  };
}

function completeResults(results, expected, { stateContracts = false } = {}) {
  if (!Array.isArray(results) || results.length !== Object.keys(expected).length) {
    return false;
  }
  const byName = new Map(results.map(result => [result?.backend, result]));
  if (byName.size !== results.length) return false;
  return Object.entries(expected).every(([name, total]) => {
    const result = byName.get(name);
    const counts = result?.counts;
    if (!counts ||
        counts.total !== total ||
        counts.passed !== total ||
        counts.failed !== 0 ||
        counts.unexecuted !== 0 ||
        counts.expectedValidationRejections !==
          EXPECTED_VALIDATION_REJECTIONS[name]) {
      return false;
    }
    if (!stateContracts) return true;
    const contracts = result.stateContracts;
    const expectedContracts = name === 'python-native'
      ? PYTHON_STATE_CONTRACTS
      : JAVASCRIPT_STATE_CONTRACTS;
    const keys = contracts !== null && typeof contracts === 'object' && !Array.isArray(contracts)
      ? Object.keys(contracts)
      : [];
    return keys.length === expectedContracts.length &&
      expectedContracts.every(key => Object.hasOwn(contracts, key) && contracts[key] === true);
  });
}

export function isAcceptanceComplete(summary) {
  return summary !== null &&
    typeof summary === 'object' &&
    completeResults(summary.backends, EXPECTED_BACKENDS, { stateContracts: true }) &&
    summary.workletGolden?.status === 'completed' &&
    completeResults(summary.workletGolden.variants, EXPECTED_WORKLET_GOLDEN) &&
    summary.workletNonIdentity?.status === 'completed' &&
    completeResults(
      summary.workletNonIdentity.variants,
      EXPECTED_WORKLET_NONIDENTITY
    );
}

function reverseTransform(rule, value) {
  switch (rule.kind) {
    case 'identity':
      return value;
    case 'naturalLog':
      return Math.exp(value);
    case 'log10':
      return 10 ** value;
    case 'decibelsFromReference':
      return rule.reference * (10 ** (value / 20));
    case 'map': {
      const entry = rule.values.find(candidate => Object.is(candidate.internal, value));
      if (!entry) throw new Error(`No public mapping for internal value ${String(value)}`);
      return entry.public;
    }
    default:
      throw new Error(`Unsupported generated transform: ${rule.kind}`);
  }
}

function semanticParameters(testCase, legacy) {
  const parameters = {};
  for (const packed of testCase.implementation.packedParameters) {
    const definition = testCase.definition.parameters.find(
      parameter => parameter.name === packed.publicName
    );
    if (!definition) {
      throw new Error(`${testCase.publicType} is missing ${packed.publicName} metadata`);
    }
    let values;
    if (packed.keys.every(key => Object.hasOwn(legacy, key))) {
      values = packed.keys.map(key => reverseTransform(packed.transform, legacy[key]));
    } else {
      const prefixes = new Set(packed.keys.map(key => key.replace(/[0-9]+$/, '')));
      const [arrayKey] = prefixes;
      const aggregate = prefixes.size === 1 ? legacy[arrayKey] : null;
      if (packed.count > 1 &&
          Array.isArray(aggregate) &&
          aggregate.length === packed.count) {
        values = aggregate.map(value => reverseTransform(packed.transform, value));
      } else if (packed.count > 1 && prefixes.size === 1) {
        const objectArray = Object.values(legacy).find(value =>
          Array.isArray(value) &&
          value.length > 0 &&
          value.length <= packed.count &&
          value.every(item =>
            item !== null &&
            typeof item === 'object' &&
            !Array.isArray(item))
          && value.some(item => Object.hasOwn(item, arrayKey))
        );
        if (objectArray) {
          values = Array.from({ length: packed.count }, (_, index) =>
            index < objectArray.length && Object.hasOwn(objectArray[index], arrayKey)
              ? reverseTransform(packed.transform, objectArray[index][arrayKey])
              : Array.isArray(definition.default)
                ? definition.default[index]
                : definition.default
          );
        }
      }
    }
    if (!values) {
      values = Array.isArray(definition.default)
        ? [...definition.default]
        : [definition.default];
    }
    parameters[packed.publicName] = packed.count === 1 ? values[0] : values;
  }
  const structured = testCase.implementation.structuredParameter;
  if (structured) {
    const definition = testCase.definition.parameters.find(
      parameter => parameter.name === structured.publicName
    );
    if (!definition) {
      throw new Error(`${testCase.publicType} is missing ${structured.publicName} metadata`);
    }
    parameters[structured.publicName] = Object.hasOwn(legacy, structured.key)
      ? legacy[structured.key]
      : definition.default;
  }
  return parameters;
}

function suppliedSemanticNames(testCase, supplied) {
  const names = [];
  const append = name => {
    if (!names.includes(name)) names.push(name);
  };
  for (const legacyName of Object.keys(supplied)) {
    for (const packed of testCase.implementation.packedParameters) {
      const prefixes = new Set(packed.keys.map(key => key.replace(/[0-9]+$/, '')));
      const [arrayKey] = prefixes;
      const aggregate = packed.count > 1 && prefixes.size === 1 && arrayKey === legacyName;
      const objectArray = packed.count > 1 && prefixes.size === 1 &&
        Array.isArray(supplied[legacyName]) && supplied[legacyName].some(item =>
          item !== null &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          Object.hasOwn(item, arrayKey)
        );
      if (packed.keys.includes(legacyName) || aggregate || objectArray) {
        append(packed.publicName);
      }
    }
    const structured = testCase.implementation.structuredParameter;
    if (structured?.key === legacyName) append(structured.publicName);
  }
  return names;
}

function semanticEventParameters(testCase, current, supplied) {
  const snapshot = semanticParameters(testCase, current);
  return Object.fromEntries(
    suppliedSemanticNames(testCase, supplied).map(name => [name, snapshot[name]])
  );
}

export function expectedValidationRejection(testCase) {
  const parameters = semanticParameters(testCase, testCase.metadata.params);
  for (const definition of testCase.definition.parameters) {
    const value = parameters[definition.name];
    if (typeof value !== 'string' || typeof definition.pattern !== 'string') continue;
    const match = new RegExp(definition.pattern, 'u').exec(value);
    if (match?.[0] !== value) {
      return {
        parameter: definition.name,
        reason: 'pattern-mismatch'
      };
    }
  }
  return null;
}

function syntheticIrBytes(asset, sampleRate) {
  const spec = asset.ir;
  if (!spec || spec.kind !== 'sparse-decay-v1') {
    throw new Error('Unsupported synthetic IR kind');
  }
  let state = Number(spec.seed ?? 0x49525631) >>> 0;
  if (state === 0) state = 0x49525631;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const samples = new Float32Array(asset.channels * asset.frames);
  const tapCount = spec.tapCount ?? 17;
  for (let channel = 0; channel < asset.channels; channel++) {
    const channelGain = 1 - channel * 0.12;
    samples[channel * asset.frames] = (spec.directGain ?? 0.7) * channelGain;
    for (let tap = 1; tap < tapCount; tap++) {
      const frame = 1 + next() % Math.max(1, asset.frames - 1);
      const sign = (next() & 1) === 0 ? 1 : -1;
      const decay = Math.exp(-4 * frame / asset.frames);
      samples[channel * asset.frames + frame] +=
        sign * (spec.tailGain ?? 0.45) * channelGain * decay / Math.sqrt(tap + 1);
    }
    if (asset.frames > 1) {
      samples[(channel + 1) * asset.frames - 1] +=
        (spec.tailGain ?? 0.45) * channelGain * 0.01;
    }
  }
  const paths = asset.topology === 4 ? asset.paths : [];
  const bytes = new Uint8Array(32 + paths.length * 12 + samples.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x31415445, true);
  view.setUint32(4, asset.channels, true);
  view.setUint32(8, asset.frames, true);
  view.setUint32(12, Math.round(sampleRate / asset.rateDivider), true);
  view.setUint32(16, asset.topology, true);
  view.setUint32(20, paths.length, true);
  for (let index = 0; index < paths.length; index++) {
    const offset = 32 + index * 12;
    view.setUint32(offset, paths[index].input, true);
    view.setUint32(offset + 4, paths[index].output, true);
    view.setUint32(offset + 8, paths[index].irChannel, true);
  }
  for (let index = 0; index < samples.length; index++) {
    view.setFloat32(32 + paths.length * 12 + index * 4, samples[index], true);
  }
  return bytes;
}

function wrapperAsset(asset, sampleRate) {
  const bytes = syntheticIrBytes(asset, sampleRate);
  const topologyNames = {
    1: 'mono',
    2: 'independent',
    3: 'trueStereo',
    4: 'matrix'
  };
  return {
    bytes,
    format: {
      formatTag: 1,
      magic: 'ETA1',
      headerBytes: 32,
      pathRecordBytes: 12,
      reservedBytes: 8,
      sampleType: 'float32',
      byteOrder: 'little-endian',
      layout: 'planar',
      channels: asset.channels,
      frames: asset.frames,
      sampleRate: Math.round(sampleRate / asset.rateDivider),
      topology: topologyNames[asset.topology],
      pathCount: asset.pathCount ?? 0,
      ...(asset.topology === 4
        ? {
            paths: asset.paths.map(route => ({
              inputSlot: route.input,
              outputSlot: route.output,
              irChannel: route.irChannel
            }))
          }
        : {})
    }
  };
}

function semanticDocument(testCase) {
  const metadata = testCase.metadata;
  const node = {
    id: 'golden-effect',
    type: testCase.publicType,
    enabled: true,
    channel: 'all',
    parameters: semanticParameters(testCase, metadata.params)
  };
  if (metadata.asset) node.assets = { impulseResponse: 'golden-ir' };
  return { version: 1, chain: [node] };
}

export function buildEvents(testCase) {
  let current = { ...testCase.metadata.params };
  return (testCase.metadata.events ?? []).map(event => {
    current = { ...current, ...(event.params ?? {}) };
    return {
      frame: event.frame,
      effectId: 'golden-effect',
      parameters: semanticEventParameters(testCase, current, event.params ?? {})
    };
  });
}

function planarChannels(flat, channels, frames) {
  return Array.from(
    { length: channels },
    (_, channel) => flat.slice(channel * frames, (channel + 1) * frames)
  );
}

function flattenChannels(channels) {
  const frames = channels[0]?.length ?? 0;
  const output = new Float32Array(channels.length * frames);
  for (let channel = 0; channel < channels.length; channel++) {
    output.set(channels[channel], channel * frames);
  }
  return output;
}

function decodeFloat32(buffer) {
  if (buffer.byteLength % 4 !== 0) throw new Error('Golden byte length is not divisible by four');
  const output = new Float32Array(buffer.byteLength / 4);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let index = 0; index < output.length; index++) {
    output[index] = view.getFloat32(index * 4, true);
  }
  return output;
}

export async function stageJsPackage(repoRoot) {
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-acceptance-'));
  const sourceRoot = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src');
  for (const entry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts'))) {
      await fs.cp(path.join(sourceRoot, entry.name), path.join(stageRoot, entry.name));
    }
  }
  await Promise.all([
    fs.mkdir(path.join(stageRoot, 'internal'), { recursive: true }),
    fs.mkdir(path.join(stageRoot, 'assets'), { recursive: true }),
    fs.mkdir(path.join(stageRoot, 'catalog'), { recursive: true })
  ]);
  const copies = [
    ['js/audio/dsp-engine-binding.js', 'internal/dsp-engine-binding.js'],
    ['js/audio/dsp-wasm-loader.js', 'internal/dsp-wasm-loader.js'],
    ['js/audio/dsp-params.generated.js', 'internal/dsp-params.generated.js'],
    ['js/ir-library/ir-asset-payload.js', 'internal/ir-asset-payload.js'],
    ['js/ir-library/ir-plugin-contract.js', 'internal/ir-plugin-contract.js'],
    ['plugins/dsp/effetune-dsp.wasm', 'assets/effetune-dsp.wasm'],
    ['plugins/dsp/effetune-dsp.simd.wasm', 'assets/effetune-dsp.simd.wasm'],
    ['plugins/dsp/effetune-dsp.meta.json', 'assets/effetune-dsp.meta.json'],
    ['dsp/bindings/generated/effects-v1.json', 'catalog/effects-v1.json']
  ];
  for (const [source, target] of copies) {
    await fs.cp(path.join(repoRoot, source), path.join(stageRoot, target));
  }
  await fs.writeFile(
    path.join(stageRoot, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>EffeTune acceptance</title>'
  );
  return stageRoot;
}

async function processEventCase(chain, source, testCase, events) {
  if (typeof chain.stream !== 'function') {
    throw new UnsupportedEventContract(
      'Chain.stream({ sampleRate, channels, blockSize, seed }) is unavailable'
    );
  }
  const metadata = testCase.metadata;
  const stream = await chain.stream({
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    blockSize: metadata.blockSize,
    seed: Number(BigInt(metadata.seed) & 0xffffffffn)
  });
  try {
    return await stream.process(source, { events });
  } finally {
    stream.close();
  }
}

class UnsupportedEventContract extends Error {}

async function runJsVariant(api, cases, variant) {
  const failures = [];
  const unexecuted = [];
  const expectedValidationRejections = [];
  const residuals = {
    maxAbsError: 0,
    maxRelError: 0,
    maxRmsError: 0
  };
  let passed = 0;
  for (const testCase of cases) {
    const metadata = testCase.metadata;
    const label = `${testCase.publicType}/${metadata.id}`;
    let chain;
    let expectedRejection = null;
    try {
      expectedRejection = expectedValidationRejection(testCase);
      const referenceBuffer = await fs.readFile(testCase.referencePath);
      if (referenceBuffer.byteLength !== metadata.byteLength) {
        throw new Error('Golden binary byte length does not match metadata');
      }
      const reference = decodeFloat32(referenceBuffer);
      if (reference.length !== metadata.outputFloats) {
        throw new Error('Golden float count does not match metadata');
      }
      const flatInput = generateStimulus({
        id: metadata.stimulus,
        sampleRate: metadata.sampleRate,
        frames: metadata.frameCount,
        channels: metadata.channels,
        caseIndex: metadata.caseIndex
      });
      const source = planarChannels(flatInput, metadata.channels, metadata.frameCount);
      const asset = metadata.asset
        ? wrapperAsset(metadata.asset, metadata.sampleRate)
        : null;
      chain = await api.createChain(semanticDocument(testCase), {
        variant,
        cache: true,
        ...(asset ? { assetResolver: reference => reference === 'golden-ir' ? asset : null } : {})
      });
      if (expectedRejection) {
        failures.push({
          case: label,
          reason: 'expected-validation-rejection-not-raised',
          expectation: expectedRejection
        });
        continue;
      }
      let output;
      if (metadata.events?.length) {
        try {
          output = await processEventCase(chain, source, testCase, buildEvents(testCase));
        } catch (error) {
          if (!(error instanceof UnsupportedEventContract)) throw error;
          unexecuted.push({
            case: label,
            reason: 'unsupported-parameter-events',
            detail: error.message,
            eventCount: metadata.events.length
          });
          continue;
        }
      } else {
        output = await chain.process(source, {
          sampleRate: metadata.sampleRate,
          seed: Number(BigInt(metadata.seed) & 0xffffffffn),
          blockSize: metadata.blockSize
        });
      }
      const comparison = compareAudio(
        reference,
        flattenChannels(output),
        metadata.tolerance,
        { channels: metadata.channels, frames: metadata.frameCount }
      );
      residuals.maxAbsError = Math.max(
        residuals.maxAbsError,
        comparison.maxAbsError ?? 0
      );
      residuals.maxRelError = Math.max(
        residuals.maxRelError,
        comparison.maxRelError ?? 0
      );
      residuals.maxRmsError = Math.max(
        residuals.maxRmsError,
        comparison.rmsError ?? 0
      );
      if (comparison.pass) passed++;
      else failures.push({ case: label, comparison });
    } catch (error) {
      if (expectedRejection &&
          typeof api.ValidationError === 'function' &&
          error instanceof api.ValidationError) {
        passed++;
        expectedValidationRejections.push({
          case: label,
          ...expectedRejection
        });
      } else {
        failures.push({
          case: label,
          reason: error?.name ?? 'Error',
          detail: error?.message ?? String(error)
        });
      }
    } finally {
      chain?.close();
    }
  }
  return {
    backend: `javascript-${variant}`,
    counts: {
      total: cases.length,
      passed,
      failed: failures.length,
      unexecuted: unexecuted.length,
      expectedValidationRejections: expectedValidationRejections.length,
      assetCases: cases.filter(item => item.metadata.asset).length,
      eventCases: cases.filter(item => item.metadata.events?.length).length
    },
    residuals,
    expectedValidationRejections,
    failures,
    unexecuted
  };
}

function audioEquals(left, right) {
  return left.length === right.length && left.every((channel, index) =>
    Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength).equals(
      Buffer.from(
        right[index].buffer,
        right[index].byteOffset,
        right[index].byteLength
      )
    )
  );
}

export async function runJsModulationCrossFieldContract(api, variant) {
  const source = [
    Float32Array.from({ length: 512 }, (_, index) => Math.sin(index * 0.071) * 0.4),
    Float32Array.from({ length: 512 }, (_, index) => Math.cos(index * 0.053) * 0.3)
  ];
  const cases = [
    {
      type: 'AutoFilter',
      supplied: { minimumFrequency: 8000, maximumFrequency: 200 },
      canonical: { minimumFrequency: 200, maximumFrequency: 8000 }
    },
    {
      type: 'Chorus',
      supplied: { delay: 0.5, depth: 20 },
      canonical: { delay: 0.5, depth: 0.5 }
    },
    {
      type: 'FrequencyShifter',
      supplied: { minimumShift: 900, maximumShift: 20 },
      canonical: { minimumShift: 20, maximumShift: 900 }
    }
  ];
  for (const testCase of cases) {
    const EffectClass = api[testCase.type];
    if (typeof EffectClass !== 'function') return false;
    const id = `${testCase.type}-cross-field`;
    const named = await api.createChain([
      new EffectClass({ id, ...testCase.supplied })
    ], { variant, cache: true });
    const serialized = await api.createChain(JSON.stringify({
      version: 1,
      chain: [{ id, type: testCase.type, parameters: testCase.supplied }]
    }), { variant, cache: true });
    const canonical = await api.createChain({
      version: 1,
      chain: [{ id, type: testCase.type, parameters: testCase.canonical }]
    }, { variant, cache: true });
    try {
      if (JSON.stringify(named.preset) !== JSON.stringify(serialized.preset)) return false;
      const expected = await canonical.process(source, {
        sampleRate: 48000,
        blockSize: 64
      });
      if (!audioEquals(
        await named.process(source, { sampleRate: 48000, blockSize: 64 }),
        expected
      )) return false;
      if (!audioEquals(
        await serialized.process(source, { sampleRate: 48000, blockSize: 64 }),
        expected
      )) return false;

      const entries = Object.entries(testCase.supplied);
      for (const ordered of [entries, [...entries].reverse()]) {
        const eventChain = await api.createChain([
          new EffectClass({ id })
        ], { variant, cache: true });
        const stream = await eventChain.stream({
          sampleRate: 48000,
          channels: 2,
          blockSize: 64
        });
        try {
          const actual = await stream.process(source, {
            events: ordered.map(([name, value]) => ({
              frame: 0,
              effectId: id,
              parameters: { [name]: value }
            }))
          });
          if (!audioEquals(actual, expected)) return false;
          if (JSON.stringify(stream.preset) !== JSON.stringify(canonical.preset)) return false;
          if (JSON.stringify(stream.effects) !== JSON.stringify(canonical.effects)) return false;
        } finally {
          stream.close();
          eventChain.close();
        }
      }
    } finally {
      named.close();
      serialized.close();
      canonical.close();
    }
  }
  return true;
}

async function runJsFrequencyShifterLatencyContract(api, variant) {
  const chain = await api.createChain([
    new api.FrequencyShifter()
  ], { variant, cache: true });
  try {
    for (const [sampleRate, expected] of [[48000, 114], [96000, 228], [192000, 456]]) {
      if (await chain.latencySamples({ sampleRate, channels: 2 }) !== expected) return false;
      const stream = await chain.stream({ sampleRate, channels: 2, blockSize: 64 });
      try {
        if (stream.latencySamples !== expected) return false;
      } finally {
        stream.close();
      }
    }
    return true;
  } finally {
    chain.close();
  }
}

async function runJsStateContracts(api, variant) {
  const document = {
    version: 1,
    chain: [{
      id: 'jitter',
      type: 'SimpleJitter',
      enabled: true,
      channel: 'all',
      parameters: { rmsJitterNanoseconds: 100000 }
    }]
  };
  const source = [new Float32Array(257).fill(0.25)];
  const chain = await api.createChain(document, { variant });
  const first = await chain.process(source, { sampleRate: 48000, seed: 1234, blockSize: 63 });
  const second = await chain.process(source, { sampleRate: 48000, seed: 1234, blockSize: 63 });
  const other = await chain.process(source, { sampleRate: 48000, seed: 4321, blockSize: 63 });
  const sameSeed = Buffer.from(first[0].buffer).equals(Buffer.from(second[0].buffer));
  const differentSeed = !Buffer.from(first[0].buffer).equals(Buffer.from(other[0].buffer));
  chain.close();
  chain.close();
  let closedRejects = false;
  try {
    await chain.process(source, { sampleRate: 48000 });
  } catch (error) {
    closedRejects = error instanceof api.StateError;
  }
  const modulationCrossField = await runJsModulationCrossFieldContract(api, variant);
  const frequencyShifterLatency = await runJsFrequencyShifterLatencyContract(api, variant);
  return {
    sameSeed,
    differentSeed,
    closeIdempotent: true,
    closedRejects,
    statefulStream: typeof chain.stream === 'function',
    modulationCrossField,
    frequencyShifterLatency
  };
}

export async function chooseWorkletPlans(cases, { preferNonIdentity = false } = {}) {
  const grouped = new Map();
  for (const testCase of cases) {
    if (testCase.metadata.events?.length || expectedValidationRejection(testCase)) continue;
    const entries = grouped.get(testCase.publicType) ?? [];
    entries.push(testCase);
    grouped.set(testCase.publicType, entries);
  }
  const plans = [];
  for (const [publicType, entries] of grouped) {
    let best = null;
    for (const testCase of entries) {
      const metadata = testCase.metadata;
      if (metadata.sampleRate > 192000) continue;
      const reference = decodeFloat32(await fs.readFile(testCase.referencePath));
      const stimulus = generateStimulus({
        id: metadata.stimulus,
        sampleRate: metadata.sampleRate,
        frames: metadata.frameCount,
        channels: metadata.channels,
        caseIndex: metadata.caseIndex
      });
      const frames = metadata.frameCount;
      let score = 0;
      for (let channel = 0; channel < metadata.channels; channel++) {
        const offset = channel * metadata.frameCount;
        for (let frame = 0; frame < frames; frame++) {
          score = Math.max(
            score,
            Math.abs(reference[offset + frame] - stimulus[offset + frame])
          );
        }
      }
      const exactQuantum = metadata.blockSize === 128;
      const betterWithinScheduleClass = exactQuantum
        ? score > (best?.score ?? Number.NEGATIVE_INFINITY)
        : metadata.frameCount < (best?.testCase.metadata.frameCount ?? Number.POSITIVE_INFINITY) ||
          (metadata.frameCount === best?.testCase.metadata.frameCount && score > best.score);
      if (!best || (preferNonIdentity
        ? score > best.score
        : Number(exactQuantum) > Number(best.exactQuantum) ||
          (exactQuantum === best.exactQuantum && betterWithinScheduleClass))) {
        best = { testCase, stimulus, score, exactQuantum };
      }
    }
    if (!best) continue;
    if (preferNonIdentity && best.score <= 1e-7) continue;
    const metadata = best.testCase.metadata;
    const reference = decodeFloat32(await fs.readFile(best.testCase.referencePath));
    if (reference.length !== metadata.outputFloats ||
        reference.length !== metadata.channels * metadata.frameCount) {
      throw new Error(`Golden output length is invalid for ${metadata.id}`);
    }
    const frames = metadata.frameCount;
    const channels = planarChannels(best.stimulus, metadata.channels, metadata.frameCount)
      .map(channel => Array.from(channel.subarray(0, frames)));
    const asset = metadata.asset
      ? wrapperAsset(metadata.asset, metadata.sampleRate)
      : null;
    plans.push({
      publicType,
      caseId: metadata.id,
      goldenDifference: best.score,
      reference: Array.from(reference),
      tolerance: metadata.tolerance,
      document: semanticDocument(best.testCase),
      sampleRate: metadata.sampleRate,
      blockSize: metadata.blockSize,
      exactQuantum: best.exactQuantum,
      seed: Number(BigInt(metadata.seed) & 0xffffffffn),
      channels,
      frames,
      ...(asset
        ? {
            asset: {
              bytes: Array.from(asset.bytes),
              format: asset.format
            }
          }
        : {})
    });
  }
  if (!preferNonIdentity) {
    for (const testCase of cases) {
      const expectedRejection = expectedValidationRejection(testCase);
      if (!expectedRejection || testCase.metadata.events?.length) continue;
      const metadata = testCase.metadata;
      const stimulus = generateStimulus({
        id: metadata.stimulus,
        sampleRate: metadata.sampleRate,
        frames: metadata.frameCount,
        channels: metadata.channels,
        caseIndex: metadata.caseIndex
      });
      plans.push({
        publicType: testCase.publicType,
        caseId: metadata.id,
        goldenDifference: null,
        reference: [],
        tolerance: metadata.tolerance,
        document: semanticDocument(testCase),
        sampleRate: metadata.sampleRate,
        blockSize: metadata.blockSize,
        exactQuantum: metadata.blockSize === 128,
        seed: Number(BigInt(metadata.seed) & 0xffffffffn),
        channels: planarChannels(
          stimulus,
          metadata.channels,
          metadata.frameCount
        ).map(channel => Array.from(channel)),
        frames: metadata.frameCount,
        expectedValidationRejection: expectedRejection
      });
    }
  }
  return plans;
}

function contentType(filePath) {
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

async function runWorkletAcceptance(stageRoot, cases, { api, mode = 'golden' } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    return {
      status: 'unexecuted',
      reason: `Playwright is unavailable: ${error.message}`,
      variants: []
    };
  }
  const plans = await chooseWorkletPlans(cases, {
    preferNonIdentity: mode === 'nonidentity'
  });
  if (plans.length === 0) {
    throw new Error('No event-free AudioWorklet golden case is available.');
  }
  if (mode === 'golden') {
    for (const plan of plans) {
      if (plan.exactQuantum || plan.expectedValidationRejection) continue;
      let chain;
      try {
        chain = await api.createChain(plan.document, {
          variant: 'baseline',
          cache: true,
          ...(plan.asset
            ? {
                assetResolver: reference => reference === 'golden-ir'
                  ? {
                      bytes: Uint8Array.from(plan.asset.bytes),
                      format: plan.asset.format
                    }
                  : null
              }
            : {})
        });
        const quantumFrames = Math.ceil(plan.frames / 128) * 128;
        const paddedInput = plan.channels.map(channel => {
          const padded = new Float32Array(quantumFrames);
          padded.set(channel);
          return padded;
        });
        const output = await chain.process(
          paddedInput,
          {
            sampleRate: plan.sampleRate,
            seed: plan.seed,
            blockSize: 128
          }
        );
        plan.reference = Array.from(flattenChannels(
          output.map(channel => channel.subarray(0, plan.frames))
        ));
      } finally {
        chain?.close();
      }
    }
  }
  const browserPlans = plans.map(({ reference, tolerance, ...plan }) => plan);
  const artifacts = {
    baseline: (await fs.readFile(
      path.join(stageRoot, 'assets', 'effetune-dsp.wasm')
    )).toString('base64'),
    simd: (await fs.readFile(
      path.join(stageRoot, 'assets', 'effetune-dsp.simd.wasm')
    )).toString('base64'),
    meta: await fs.readFile(
      path.join(stageRoot, 'assets', 'effetune-dsp.meta.json'),
      'utf8'
    )
  };
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--allow-file-access-from-files']
    });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    await page.goto(pathToFileURL(path.join(stageRoot, 'index.html')).href);
    const apiUrl = pathToFileURL(path.join(stageRoot, 'index.js')).href;
    const workletUrl = pathToFileURL(path.join(stageRoot, 'worklet.js')).href;
    const processorUrl = pathToFileURL(
      path.join(stageRoot, 'worklet-processor.js')
    ).href;
    const variants = [];
    for (const variant of ['baseline', 'simd']) {
      const results = await page.evaluate(
        async ({ apiUrl, artifacts, plans, processorUrl, variant, workletUrl }) => {
          const [{ ValidationError }, { EffeTuneNode }] = await Promise.all([
            import(apiUrl),
            import(workletUrl)
          ]);
          const decode = value => {
            const binary = atob(value);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) {
              bytes[index] = binary.charCodeAt(index);
            }
            return bytes;
          };
          const wasmBytes = decode(artifacts[variant]);
          const artifactFetch = async url => {
            const target = String(url);
            if (target.endsWith('.meta.json')) {
              return new Response(artifacts.meta, {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(wasmBytes, {
              status: 200,
              headers: { 'Content-Type': 'application/wasm' }
            });
          };
          const output = [];
          for (const plan of plans) {
            let context;
            let node;
            try {
              context = new OfflineAudioContext(
                plan.channels.length,
                plan.frames,
                plan.sampleRate
              );
              const buffer = context.createBuffer(
                plan.channels.length,
                plan.frames,
                plan.sampleRate
              );
              for (let channel = 0; channel < plan.channels.length; channel++) {
                buffer.copyToChannel(Float32Array.from(plan.channels[channel]), channel);
              }
              const source = context.createBufferSource();
              source.buffer = buffer;
              node = await EffeTuneNode.create(context, plan.document, {
                variant,
                channels: plan.channels.length,
                seed: plan.seed,
                processorUrl,
                wasmUrl: 'https://effetune-artifact.invalid/effetune-dsp.wasm',
                simdWasmUrl: 'https://effetune-artifact.invalid/effetune-dsp.simd.wasm',
                metaUrl: 'https://effetune-artifact.invalid/effetune-dsp.meta.json',
                fetch: artifactFetch,
                ...(plan.asset
                  ? {
                      assetResolver: reference => reference === 'golden-ir'
                        ? {
                            bytes: Uint8Array.from(plan.asset.bytes),
                            format: plan.asset.format
                          }
                        : null
                    }
                  : {})
              });
              if (plan.expectedValidationRejection) {
                output.push({
                  publicType: plan.publicType,
                  caseId: plan.caseId,
                  pass: false,
                  reason: 'expected-validation-rejection-not-raised'
                });
                continue;
              }
              source.connect(node).connect(context.destination);
              source.start();
              const rendered = await context.startRendering();
              const actualOutput = new Array(plan.channels.length * plan.frames);
              let maxDifference = 0;
              let finite = true;
              for (let channel = 0; channel < plan.channels.length; channel++) {
                const actual = rendered.getChannelData(channel);
                const input = plan.channels[channel];
                for (let frame = 0; frame < actual.length; frame++) {
                  actualOutput[channel * plan.frames + frame] = actual[frame];
                  finite &&= Number.isFinite(actual[frame]);
                  maxDifference = Math.max(
                    maxDifference,
                    Math.abs(actual[frame] - input[frame])
                  );
                }
              }
              output.push({
                publicType: plan.publicType,
                caseId: plan.caseId,
                goldenDifference: plan.goldenDifference,
                goldenBlockSize: plan.blockSize,
                workletBlockSize: 128,
                exactQuantum: plan.exactQuantum,
                actual: actualOutput,
                finite,
                maxDifference,
                nonIdentity: maxDifference > 1e-7
              });
            } catch (error) {
              if (plan.expectedValidationRejection &&
                  error instanceof ValidationError) {
                output.push({
                  publicType: plan.publicType,
                  caseId: plan.caseId,
                  validationRejected: true
                });
              } else {
                output.push({
                  publicType: plan.publicType,
                  caseId: plan.caseId,
                  goldenDifference: plan.goldenDifference,
                  pass: false,
                  reason: error?.name ?? 'Error',
                  detail: error?.message ?? String(error)
                });
              }
            } finally {
              node?.close();
              await context?.close?.();
            }
          }
          return output;
        },
        { apiUrl, artifacts, plans: browserPlans, processorUrl, variant, workletUrl }
      );
      const planByCase = new Map(
        plans.map(plan => [`${plan.publicType}/${plan.caseId}`, plan])
      );
      const comparedResults = results.map(result => {
        const plan = planByCase.get(`${result.publicType}/${result.caseId}`);
        if (!plan) return { ...result, pass: false };
        if (plan.expectedValidationRejection) {
          return {
            ...result,
            expectedValidationRejection: plan.expectedValidationRejection,
            pass: result.validationRejected === true
          };
        }
        if (!result.actual) return { ...result, pass: false };
        if (mode === 'nonidentity') {
          const { actual, ...diagnostics } = result;
          return {
            ...diagnostics,
            pass: result.finite &&
              result.goldenDifference > 1e-7 &&
              result.nonIdentity
          };
        }
        const comparison = compareAudio(
          Float32Array.from(plan.reference),
          Float32Array.from(result.actual),
          plan.tolerance,
          { channels: plan.channels.length, frames: plan.frames }
        );
        const { actual, ...diagnostics } = result;
        return {
          ...diagnostics,
          pass: result.finite && comparison.pass,
          comparison
        };
      });
      variants.push({
        backend: mode === 'golden'
          ? `chromium-audioworklet-${variant}`
          : `chromium-audioworklet-nonidentity-${variant}`,
        counts: {
          total: comparedResults.length,
          passed: comparedResults.filter(result => result.pass).length,
          failed: comparedResults.filter(result => !result.pass).length,
          unexecuted: 0,
          expectedValidationRejections: comparedResults.filter(
            result => result.pass && result.validationRejected
          ).length
        },
        failures: comparedResults.filter(result => !result.pass),
        results: comparedResults
      });
    }
    return { status: 'completed', variants };
  } catch (error) {
    return {
      status: 'unexecuted',
      reason: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
      variants: []
    };
  } finally {
    await browser?.close();
  }
}

function spawnPython(executable, commandArguments, { cwd = REPOSITORY_ROOT } = {}) {
  return new Promise(resolve => {
    const child = spawn(executable, commandArguments, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ code: null, stdout, stderr, error }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function failedPythonBackend(total, result, reason, detail) {
  return {
    backend: 'python-native',
    counts: {
      total,
      passed: 0,
      failed: total,
      unexecuted: 0,
      expectedValidationRejections: 0
    },
    failures: [{ reason, detail }],
    unexecuted: [],
    process: {
      exitCode: result?.code ?? null,
      stderr: result?.stderr?.trim?.() ?? ''
    }
  };
}

function validatePythonBackend(backend, total, expectedValidationRejections) {
  const stateContracts = backend?.stateContracts;
  const stateContractKeys =
    stateContracts !== null &&
    typeof stateContracts === 'object' &&
    !Array.isArray(stateContracts)
      ? Object.keys(stateContracts)
      : [];
  if (backend === null || typeof backend !== 'object' || Array.isArray(backend) ||
      backend.backend !== 'python-native' ||
      backend.counts === null ||
      typeof backend.counts !== 'object' ||
      Array.isArray(backend.counts) ||
      backend.counts.total !== total ||
      !['passed', 'failed', 'unexecuted'].every(
        key => Number.isInteger(backend.counts[key]) && backend.counts[key] >= 0
      ) ||
      backend.counts.passed + backend.counts.failed + backend.counts.unexecuted !== total ||
      backend.counts.expectedValidationRejections !== expectedValidationRejections ||
      !Array.isArray(backend.expectedValidationRejections) ||
      backend.expectedValidationRejections.length !== expectedValidationRejections ||
      !Array.isArray(backend.failures) ||
      backend.failures.length !== backend.counts.failed ||
      !Array.isArray(backend.unexecuted) ||
      backend.unexecuted.length !== backend.counts.unexecuted ||
      stateContractKeys.length !== PYTHON_STATE_CONTRACTS.length ||
      !PYTHON_STATE_CONTRACTS.every(
        key => Object.hasOwn(stateContracts, key) &&
          typeof stateContracts[key] === 'boolean'
      )) {
    throw new Error('Python acceptance summary does not match the expected backend contract');
  }
}

export async function runPythonAcceptanceBackend({
  repoRoot = REPOSITORY_ROOT,
  summaryDirectory,
  python,
  total,
  expectedValidationRejections = 0,
  spawnRunner = spawnPython
}) {
  await fs.mkdir(summaryDirectory, { recursive: true });
  const temporaryRoot = await fs.mkdtemp(
    path.join(summaryDirectory, 'dsp-library-goldens-python-')
  );
  const childSummaryPath = path.join(temporaryRoot, 'summary.json');
  let result = null;
  try {
    result = await spawnRunner(python, [
      path.join(
        repoRoot,
        'dsp',
        'bindings',
        'acceptance',
        'python_golden_runner.py'
      ),
      '--repo-root',
      repoRoot,
      '--summary',
      childSummaryPath
    ], { cwd: repoRoot });
    if (result.code !== 0) {
      return failedPythonBackend(
        total,
        result,
        result.error?.name ?? 'python-runner-failed',
        result.error?.message ??
          (result.stderr.trim() ||
            result.stdout.trim() ||
            `Python runner exited with code ${String(result.code)}`)
      );
    }
    try {
      const backend = await readJson(childSummaryPath);
      validatePythonBackend(backend, total, expectedValidationRejections);
      backend.process = {
        exitCode: result.code,
        stderr: result.stderr.trim()
      };
      return backend;
    } catch (error) {
      return failedPythonBackend(
        total,
        result,
        error?.name ?? 'python-summary-invalid',
        error?.message ?? String(error)
      );
    }
  } catch (error) {
    return failedPythonBackend(
      total,
      result,
      error?.name ?? 'python-runner-failed',
      error?.message ?? String(error)
    );
  } finally {
    await fs.rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 25
    });
  }
}

async function resolvePython(repoRoot, explicit) {
  if (explicit) return explicit;
  const candidates = process.platform === 'win32'
    ? [
        path.join(
          repoRoot,
          '.tmp',
          'phase1-python',
          'release-smoke-cp312',
          'Scripts',
          'python.exe'
        ),
        'python'
      ]
    : ['python3', 'python'];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return candidates.at(-1);
}

export async function runAcceptance(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? REPOSITORY_ROOT);
  const summaryPath = path.resolve(options.summaryPath ?? DEFAULT_SUMMARY);
  const inventory = await discoverFrozenGoldenCases(repoRoot);
  const inventorySummary = summarizeInventory(inventory.cases);
  const summary = {
    formatVersion: 1,
    inventory: inventorySummary,
    backends: [],
    status: 'failed'
  };
  if (inventorySummary.effects !== 90 ||
      inventorySummary.total !== 848 ||
      inventorySummary.assetCases !== 21 ||
      inventorySummary.eventCases !== 146) {
    throw new Error(
      `Frozen inventory mismatch: ${JSON.stringify(inventorySummary)}`
    );
  }
  if (!options.inventoryOnly && !options.skipPython) {
    const python = await resolvePython(repoRoot, options.python);
    const expectedValidationRejections = inventory.cases.filter(
      testCase => expectedValidationRejection(testCase)
    ).length;
    summary.backends.push(await runPythonAcceptanceBackend({
      repoRoot,
      summaryDirectory: path.dirname(summaryPath),
      python,
      total: inventory.cases.length,
      expectedValidationRejections
    }));
  }

  if (!options.inventoryOnly && !options.skipJs) {
    const stageRoot = await stageJsPackage(repoRoot);
    try {
      const api = await import(`${pathToFileURL(path.join(stageRoot, 'index.js')).href}?acceptance=1`);
      for (const variant of ['baseline', 'simd']) {
        const backend = await runJsVariant(api, inventory.cases, variant);
        try {
          backend.stateContracts = await runJsStateContracts(api, variant);
        } catch (error) {
          backend.stateContracts = {
            error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`
          };
        }
        summary.backends.push(backend);
      }
      summary.workletGolden = await runWorkletAcceptance(
        stageRoot,
        inventory.cases,
        { api, mode: 'golden' }
      );
      summary.workletNonIdentity = await runWorkletAcceptance(
        stageRoot,
        inventory.cases,
        { api, mode: 'nonidentity' }
      );
    } finally {
      await fs.rm(stageRoot, { recursive: true, force: true });
    }
  }

  const complete = isAcceptanceComplete(summary);
  summary.status = options.inventoryOnly ? 'inventory-only' : complete ? 'passed' : 'failed';
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return { summary, summaryPath };
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const result = await runAcceptance(options);
  process.stdout.write(`${JSON.stringify({
    status: result.summary.status,
    inventory: result.summary.inventory,
    backends: result.summary.backends.map(backend => ({
      backend: backend.backend,
      counts: backend.counts
    })),
    ...(result.summary.workletGolden
      ? {
          workletGolden: {
            status: result.summary.workletGolden.status,
            variants: result.summary.workletGolden.variants.map(backend => ({
              backend: backend.backend,
              counts: backend.counts
            }))
          }
        }
      : {}),
    ...(result.summary.workletNonIdentity
      ? {
          workletNonIdentity: {
            status: result.summary.workletNonIdentity.status,
            variants: result.summary.workletNonIdentity.variants.map(backend => ({
              backend: backend.backend,
              counts: backend.counts
            }))
          }
        }
      : {}),
    summary: result.summaryPath
  }, null, 2)}\n`);
  if (result.summary.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
