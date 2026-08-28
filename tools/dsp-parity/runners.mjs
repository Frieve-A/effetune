import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { DEFAULT_REPO_ROOT, pathExists } from './cases.mjs';
import { readFloat32File, writeFloat32File } from './golden-io.mjs';
import { DEFAULT_NOISE_SEED } from './stimuli.mjs';
import { canonicalizeProcessingParameters } from '../../dsp/bindings/js/src/effect.js';
import {
  buildDspPipelineDescriptor,
  buildDspPipelineNodes
} from '../../js/audio/dsp-pipeline-descriptor.js';

export function defaultNativeRunnerPath(repoRoot = DEFAULT_REPO_ROOT) {
  const executable = process.platform === 'win32' ? 'effetune-dsp-parity-runner.exe' : 'effetune-dsp-parity-runner';
  return path.join(repoRoot, 'out', 'dsp', 'native', executable);
}

export function defaultWasmPath(variant = 'baseline', repoRoot = DEFAULT_REPO_ROOT) {
  const name = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
  return path.join(repoRoot, 'plugins', 'dsp', name);
}

export const NATIVE_CONTROL_MAGIC = 'ETPC';
export const NATIVE_CONTROL_VERSION = 1;
export const NATIVE_CONTROL_HEADER_BYTES = 36;
export const NATIVE_CONTROL_STRUCTURED_VERSION = 2;
export const NATIVE_CONTROL_STRUCTURED_HEADER_BYTES = 40;
export const NATIVE_CONTROL_ASSET_VERSION = 3;
export const NATIVE_CONTROL_ASSET_HEADER_BYTES = 84;
export const WASM_PIPELINE_TELEMETRY_BYTES = 256 * 1024;

const NATIVE_DIRECT_REFERENCE_ENGINES = new Set([
  'native-fir-crossover-direct-double-v1',
  'native-five-band-fir-peq-direct-double-v1',
  'native-group-delay-eq-direct-double-v1',
  'native-group-delay-peq-direct-double-v1',
  'native-ir-direct-double-v3',
  'native-room-eq-direct-double-v1',
  'native-room-eq-direct-double-v2'
]);

const PINNED_NATIVE_DIRECT_REFERENCE_HASHES = new Map([
  ['native-ir-direct-double-v3', '774ded205afffa4abe9af33a297fd97a7065cb439183a44cdad3007e4a7a6ff1'],
  ['native-room-eq-direct-double-v1', '83045565caf287233033c9a0221826e637f07068df1af63eb59cb246b274133f'],
  ['native-room-eq-direct-double-v2', '35e819cf73a00e7985580701ae3e468f1cead2f3b595e1061471ba0cd39e65be']
]);

export const PRODUCTION_NATIVE_PROMOTED_REFERENCE_ENGINE =
  'production-native-promoted-v1';

export function isNativeDirectReferenceEngine(value) {
  return NATIVE_DIRECT_REFERENCE_ENGINES.has(value);
}

export function pinnedNativeDirectReferenceHash(value) {
  return PINNED_NATIVE_DIRECT_REFERENCE_HASHES.get(value) ?? null;
}

export function isProductionNativePromotedReferenceEngine(value) {
  return value === PRODUCTION_NATIVE_PROMOTED_REFERENCE_ENGINE;
}

export function seedWords(seed = DEFAULT_NOISE_SEED) {
  const mask64 = (1n << 64n) - 1n;
  let normalized = BigInt(seed) & mask64;
  if (normalized === 0n) normalized = DEFAULT_NOISE_SEED;
  return {
    low: Number(normalized & 0xffffffffn),
    high: Number((normalized >> 32n) & 0xffffffffn)
  };
}

async function requireFile(filePath, description) {
  if (!await pathExists(filePath)) {
    throw new Error(`${description} is unavailable at ${filePath}. Build the DSP artifacts before selecting this mode.`);
  }
}

function spawnAndCollect(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Native DSP runner exited with code ${code}: ${stderr.trim() || stdout.trim() || 'no diagnostic output'}`));
    });
  });
}

export async function runNativeCase({
  type,
  testCase,
  input,
  schema,
  runnerPath = defaultNativeRunnerPath(),
  repoRoot = DEFAULT_REPO_ROOT,
  allocations = false,
  referenceDirect = false
}) {
  const resolvedRunner = path.resolve(repoRoot, runnerPath);
  await requireFile(resolvedRunner, 'Native DSP parity runner');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-native-'));
  const inputPath = path.join(tempDir, 'input.f32');
  const outputPath = path.join(tempDir, 'output.f32');
  const controlPath = path.join(tempDir, 'case.etpc');
  try {
    await writeFloat32File(inputPath, input);
    await fs.writeFile(controlPath, encodeNativeControl(schema, testCase));
    const args = [
      '--type', type,
      '--control', controlPath,
      '--input', inputPath,
      '--output', outputPath
    ];
    const seed = seedWords(testCase.seed);
    args.push('--seed-low', String(seed.low), '--seed-high', String(seed.high));
    if (allocations) args.push('--allocations');
    if (referenceDirect) args.push('--reference-direct');
    await spawnAndCollect(resolvedRunner, args, { cwd: repoRoot, env: process.env });
    return await readFloat32File(outputPath, input.length);
  } finally {
    await fs.rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
}

export function runNativeReferenceCase(options) {
  return runNativeCase({ ...options, referenceDirect: true });
}

function fnv1a32(source) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(source)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function paramsLayoutHash(schema) {
  let signature = schema.fields
    .map(field => {
      const enumLayout = field.kind === 'enum'
        ? `:${JSON.stringify(field.values)}`
        : '';
      return `${field.name}:${field.kind}:${field.count ?? 1}${enumLayout};`;
    })
    .join('');
  if (schema.structured) {
    signature += `${schema.structured.name}:structured:${schema.structured.codec}:${schema.structured.maxItems};`;
  }
  return fnv1a32(signature);
}

function fieldKeys(field) {
  const count = field.count ?? 1;
  if (field.keys) return field.keys;
  const key = field.key ?? field.name;
  return count === 1 ? [key] : Array.from({ length: count }, (_, index) => `${key}${index}`);
}

function canonicalizeMultibandParams(schema, params) {
  if (!['MultibandCompressorPlugin', 'MultibandExpanderPlugin', 'MultibandBalancePlugin',
    'MultibandTransientPlugin', 'MultibandSaturationPlugin'].includes(schema.type)) return params;
  const fields = schema.fields.filter(field => /^frequency[1-4]$/.test(field.name));
  const frequencies = Object.fromEntries(fields.map(field => [
    field.name, params[field.key] ?? field.default
  ]));
  const canonical = canonicalizeProcessingParameters(schema.type.slice(0, -6), frequencies);
  return {
    ...params,
    ...Object.fromEntries(fields.map(field => [field.key, canonical[field.name]]))
  };
}

export function packParams(schema, params = {}) {
  params = canonicalizeMultibandParams(schema, params);
  const packed = [];
  for (const field of schema.fields) {
    const keys = fieldKeys(field);
    for (let index = 0; index < keys.length; index++) {
      const fallback = field.defaults?.[index] ??
        (Array.isArray(field.default) ? field.default[index] : field.default);
      const hasObjectArray = field.objectArrayKey && Array.isArray(params[field.objectArrayKey]);
      const objectValue = hasObjectArray
        ? params[field.objectArrayKey][index]?.[field.memberKey]
        : undefined;
      const arrayValue = field.arrayKey &&
        (Array.isArray(params[field.arrayKey]) || ArrayBuffer.isView(params[field.arrayKey]))
        ? params[field.arrayKey][index]
        : undefined;
      const value = hasObjectArray
        ? objectValue ?? fallback
        : arrayValue ?? params[keys[index]] ?? fallback;
      if (field.kind === 'bool') packed.push(value ? 1 : 0);
      else if (field.kind === 'enum') {
        const enumIndex = field.values.indexOf(value);
        if (enumIndex < 0) throw new Error(`Invalid enum value ${value} for ${field.name}`);
        packed.push(enumIndex);
      } else packed.push(Number(value));
    }
  }
  if (packed.some(value => !Number.isFinite(value))) throw new Error(`Non-finite packed parameter for ${schema.type}`);
  return Float32Array.from(packed);
}

export function packStructuredParams(schema, params = {}) {
  const descriptor = schema.structured;
  if (!descriptor) return new Uint8Array(0);
  if (descriptor.codec !== 'matrix-routes-v1') {
    throw new Error(`Unsupported structured parameter codec ${descriptor.codec}`);
  }
  const source = typeof params[descriptor.key] === 'string'
    ? params[descriptor.key]
    : descriptor.default;
  const routes = [];
  let offset = 0;
  while (offset < source.length) {
    let phase = 0;
    if (source[offset] === 'p') {
      phase = 1;
      offset++;
    }
    if (offset + 1 >= source.length) break;
    const inputText = source[offset];
    const outputText = source[offset + 1];
    const input = /^[0-9a-f]$/.test(inputText) ? parseInt(inputText, 16) : -1;
    const output = /^[0-9a-f]$/.test(outputText) ? parseInt(outputText, 16) : -1;
    if (input >= 0 && output >= 0) {
      if (routes.length >= descriptor.maxItems * 3) {
        throw new RangeError(`${schema.type} structured route capacity exceeded`);
      }
      routes.push(input, output, phase);
    }
    offset += 2;
  }
  const packed = new Uint8Array(4 + routes.length);
  packed[0] = 1;
  packed[2] = (routes.length / 3) & 0xff;
  packed[3] = (routes.length / 3) >>> 8;
  packed.set(routes, 4);
  return packed;
}

function syntheticIrBytes(asset, sampleRate) {
  const spec = asset.ir;
  if (!spec || spec.kind !== 'sparse-decay-v1') return null;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 ||
      !Number.isInteger(asset.channels) || asset.channels <= 0 ||
      !Number.isInteger(asset.frames) || asset.frames <= 0 ||
      !Number.isInteger(asset.rateDivider) || asset.rateDivider <= 0) {
    throw new Error('Synthetic IR asset dimensions are invalid');
  }
  const tapCount = spec.tapCount ?? 17;
  if (!Number.isInteger(tapCount) || tapCount < 1 || tapCount > asset.frames) {
    throw new Error(`Synthetic IR tapCount is invalid: ${tapCount}`);
  }
  let state = Number(spec.seed ?? 0x49525631) >>> 0;
  if (state === 0) state = 0x49525631;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const samples = new Float32Array(asset.channels * asset.frames);
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
  if (asset.topology === 4 &&
      (!Array.isArray(paths) || paths.length !== asset.pathCount || paths.length < 1 ||
       paths.length > 16)) {
    throw new Error('Synthetic matrix IR asset paths must match pathCount in the range 1..16');
  }
  const pathTableBytes = paths.length * 12;
  const bytes = Buffer.alloc(32 + pathTableBytes + samples.byteLength);
  bytes.writeUInt32LE(0x31415445, 0);
  bytes.writeUInt32LE(asset.channels, 4);
  bytes.writeUInt32LE(asset.frames, 8);
  bytes.writeUInt32LE(Math.round(sampleRate / asset.rateDivider), 12);
  bytes.writeUInt32LE(asset.topology, 16);
  bytes.writeUInt32LE(paths.length, 20);
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    for (const key of ['input', 'output', 'irChannel']) {
      if (!Number.isInteger(path?.[key]) || path[key] < 0 || path[key] > 0xffffffff) {
        throw new Error(`Synthetic matrix IR path ${index} has invalid ${key}`);
      }
    }
    const offset = 32 + index * 12;
    bytes.writeUInt32LE(path.input, offset);
    bytes.writeUInt32LE(path.output, offset + 4);
    bytes.writeUInt32LE(path.irChannel, offset + 8);
  }
  for (let index = 0; index < samples.length; index++) {
    bytes.writeFloatLE(samples[index], 32 + pathTableBytes + index * 4);
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function normalizeAsset(asset, sampleRate, processingChannels) {
  if (!asset) return null;
  const bytes = asset.bytes instanceof Uint8Array
    ? asset.bytes
    : Buffer.isBuffer(asset.bytes)
      ? new Uint8Array(asset.bytes.buffer, asset.bytes.byteOffset, asset.bytes.byteLength)
      : syntheticIrBytes(asset, sampleRate);
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Native DSP parity asset bytes must be a non-empty Uint8Array');
  }
  const normalized = {
    slot: asset.slot ?? 0,
    format: asset.format ?? 1,
    channels: asset.channels,
    frames: asset.frames,
    topology: asset.topology,
    headBlock: asset.headBlock,
    rateDivider: asset.rateDivider,
    pathCount: asset.pathCount ?? 0,
    inputCount: asset.inputCount ?? 0,
    processingChannels,
    footprintBytes: 32 * 1024 * 1024,
    bytes
  };
  for (const key of [
    'slot', 'format', 'channels', 'frames', 'topology', 'headBlock', 'rateDivider',
    'pathCount', 'inputCount', 'processingChannels', 'footprintBytes'
  ]) {
    if (!Number.isInteger(normalized[key]) || normalized[key] < 0 || normalized[key] > 0xffffffff) {
      throw new Error(`Native DSP parity asset has invalid ${key}: ${normalized[key]}`);
    }
  }
  return normalized;
}

export function activePipelinePlugins(pipeline) {
  const active = [];
  buildDspPipelineNodes(pipeline, {
    getInstanceId(plugin) {
      active.push(plugin);
      return active.length;
    },
    getParameters: plugin => plugin.params ?? plugin.parameters ?? {},
    omitInactive: true
  });
  return active;
}

export function encodeNativeControl(schema, testCase) {
  if (!schema || !Array.isArray(schema.fields)) {
    throw new Error('Native DSP parity requires a parameter schema');
  }
  for (const key of ['sampleRate', 'frames', 'channels', 'blockSize']) {
    if (!Number.isInteger(testCase[key]) || testCase[key] <= 0) {
      throw new Error(`Native DSP parity case has invalid ${key}: ${testCase[key]}`);
    }
  }
  const structured = Boolean(schema.structured);
  const asset = normalizeAsset(testCase.asset, testCase.sampleRate, testCase.channels);
  const initial = packParams(schema, testCase.params ?? {});
  const initialBytes = packStructuredParams(schema, testCase.params ?? {});
  const events = [...(testCase.events ?? [])].sort((left, right) => left.frame - right.frame);
  let currentParams = canonicalizeMultibandParams(schema, { ...(testCase.params ?? {}) });
  const packedEvents = events.map(event => {
    if (!Number.isInteger(event.frame) || event.frame < 0 || event.frame >= testCase.frames) {
      throw new Error(`Native DSP parameter event has invalid frame ${event.frame}`);
    }
    currentParams = canonicalizeMultibandParams(schema, {
      ...currentParams, ...(event.params ?? {})
    });
    return {
      frame: event.frame,
      packed: packParams(schema, currentParams),
      packedBytes: packStructuredParams(schema, currentParams)
    };
  });
  if (asset) {
    const eventBytes = packedEvents.reduce(
      (total, event) => total + 8 + event.packed.byteLength + event.packedBytes.byteLength,
      0
    );
    const buffer = Buffer.alloc(
      NATIVE_CONTROL_ASSET_HEADER_BYTES + initial.byteLength + initialBytes.byteLength +
      asset.bytes.byteLength + eventBytes
    );
    buffer.write(NATIVE_CONTROL_MAGIC, 0, 4, 'ascii');
    buffer.writeUInt32LE(NATIVE_CONTROL_ASSET_VERSION, 4);
    buffer.writeFloatLE(testCase.sampleRate, 8);
    buffer.writeUInt32LE(testCase.frames, 12);
    buffer.writeUInt32LE(testCase.channels, 16);
    buffer.writeUInt32LE(testCase.blockSize, 20);
    buffer.writeUInt32LE(paramsLayoutHash(schema), 24);
    buffer.writeUInt32LE(initial.length, 28);
    buffer.writeUInt32LE(initialBytes.byteLength, 32);
    buffer.writeUInt32LE(packedEvents.length, 36);
    buffer.writeUInt32LE(asset.slot, 40);
    buffer.writeUInt32LE(asset.format, 44);
    buffer.writeUInt32LE(asset.channels, 48);
    buffer.writeUInt32LE(asset.frames, 52);
    buffer.writeUInt32LE(asset.topology, 56);
    buffer.writeUInt32LE(asset.headBlock, 60);
    buffer.writeUInt32LE(asset.rateDivider, 64);
    buffer.writeUInt32LE(asset.pathCount, 68);
    buffer.writeUInt32LE(asset.inputCount, 72);
    buffer.writeUInt32LE(asset.bytes.byteLength, 76);
    buffer.writeUInt32LE(0, 80);
    let offset = NATIVE_CONTROL_ASSET_HEADER_BYTES;
    for (const value of initial) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    buffer.set(initialBytes, offset);
    offset += initialBytes.byteLength;
    buffer.set(asset.bytes, offset);
    offset += asset.bytes.byteLength;
    for (const event of packedEvents) {
      buffer.writeUInt32LE(event.frame, offset);
      offset += 4;
      for (const value of event.packed) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
      buffer.writeUInt32LE(event.packedBytes.byteLength, offset);
      offset += 4;
      buffer.set(event.packedBytes, offset);
      offset += event.packedBytes.byteLength;
    }
    return buffer;
  }
  if (structured) {
    const eventBytes = packedEvents.reduce(
      (total, event) => total + 8 + event.packed.byteLength + event.packedBytes.byteLength,
      0
    );
    const buffer = Buffer.alloc(
      NATIVE_CONTROL_STRUCTURED_HEADER_BYTES + initial.byteLength + initialBytes.byteLength + eventBytes
    );
    buffer.write(NATIVE_CONTROL_MAGIC, 0, 4, 'ascii');
    buffer.writeUInt32LE(NATIVE_CONTROL_STRUCTURED_VERSION, 4);
    buffer.writeFloatLE(testCase.sampleRate, 8);
    buffer.writeUInt32LE(testCase.frames, 12);
    buffer.writeUInt32LE(testCase.channels, 16);
    buffer.writeUInt32LE(testCase.blockSize, 20);
    buffer.writeUInt32LE(paramsLayoutHash(schema), 24);
    buffer.writeUInt32LE(initial.length, 28);
    buffer.writeUInt32LE(initialBytes.byteLength, 32);
    buffer.writeUInt32LE(packedEvents.length, 36);
    let offset = NATIVE_CONTROL_STRUCTURED_HEADER_BYTES;
    for (const value of initial) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    buffer.set(initialBytes, offset);
    offset += initialBytes.byteLength;
    for (const event of packedEvents) {
      buffer.writeUInt32LE(event.frame, offset);
      offset += 4;
      for (const value of event.packed) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
      buffer.writeUInt32LE(event.packedBytes.byteLength, offset);
      offset += 4;
      buffer.set(event.packedBytes, offset);
      offset += event.packedBytes.byteLength;
    }
    return buffer;
  }
  const eventBytes = packedEvents.length * (4 + initial.byteLength);
  const buffer = Buffer.alloc(NATIVE_CONTROL_HEADER_BYTES + initial.byteLength + eventBytes);
  buffer.write(NATIVE_CONTROL_MAGIC, 0, 4, 'ascii');
  buffer.writeUInt32LE(NATIVE_CONTROL_VERSION, 4);
  buffer.writeFloatLE(testCase.sampleRate, 8);
  buffer.writeUInt32LE(testCase.frames, 12);
  buffer.writeUInt32LE(testCase.channels, 16);
  buffer.writeUInt32LE(testCase.blockSize, 20);
  buffer.writeUInt32LE(paramsLayoutHash(schema), 24);
  buffer.writeUInt32LE(initial.length, 28);
  buffer.writeUInt32LE(packedEvents.length, 32);
  let offset = NATIVE_CONTROL_HEADER_BYTES;
  for (const value of initial) {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  }
  for (const event of packedEvents) {
    buffer.writeUInt32LE(event.frame, offset);
    offset += 4;
    for (const value of event.packed) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
  }
  return buffer;
}

function getExport(exports, name, required = true) {
  const value = exports[name] ?? exports[`_${name}`];
  if (required && typeof value !== 'function') throw new Error(`WASM DSP artifact is missing export ${name}`);
  return value;
}

function createImportObject(module) {
  const imports = {};
  for (const descriptor of WebAssembly.Module.imports(module)) {
    imports[descriptor.module] ??= {};
    if (descriptor.kind === 'function') {
      imports[descriptor.module][descriptor.name] = descriptor.name === 'proc_exit'
        ? code => { throw new Error(`WASM DSP called proc_exit(${code})`); }
        : () => 0;
    } else if (descriptor.kind === 'memory') {
      imports[descriptor.module][descriptor.name] = new WebAssembly.Memory({ initial: 128, maximum: 1024 });
    } else if (descriptor.kind === 'table') {
      imports[descriptor.module][descriptor.name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
    } else if (descriptor.kind === 'global') {
      imports[descriptor.module][descriptor.name] = 0;
    }
  }
  return imports;
}

function checkStatus(operation, status) {
  if (status !== 0) throw new Error(`${operation} failed with et_status ${status}`);
}

function copyInputBlock(input, frames, channels, startFrame, blockFrames, target) {
  for (let channel = 0; channel < channels; channel++) {
    const sourceOffset = channel * frames + startFrame;
    target.set(input.subarray(sourceOffset, sourceOffset + blockFrames), channel * blockFrames);
  }
}

function copyOutputBlock(source, output, frames, channels, startFrame, blockFrames) {
  for (let channel = 0; channel < channels; channel++) {
    const targetOffset = channel * frames + startFrame;
    const sourceOffset = channel * blockFrames;
    output.set(source.subarray(sourceOffset, sourceOffset + blockFrames), targetOffset);
  }
}

export function createProcessTimer(timingSource = 'wall', clocks = {}) {
  if (timingSource === 'wall') {
    const now = clocks.performanceNow ?? (() => performance.now());
    return {
      clock: 'high-resolution-wall',
      start: now,
      elapsedMilliseconds: started => now() - started
    };
  }
  if (timingSource !== 'cpu') {
    throw new Error(`Unknown process timing source ${timingSource}`);
  }

  const threadCpuUsage = clocks.threadCpuUsage ??
    (typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage.bind(process) : null);
  if (threadCpuUsage) {
    return {
      clock: 'current-thread-cpu',
      start: () => threadCpuUsage(),
      elapsedMilliseconds: started => {
        const elapsed = threadCpuUsage(started);
        return (elapsed.user + elapsed.system) / 1000;
      }
    };
  }

  const cpuUsage = clocks.cpuUsage ?? process.cpuUsage.bind(process);
  return {
    clock: 'process-cpu',
    start: () => cpuUsage(),
    elapsedMilliseconds: started => {
      const elapsed = cpuUsage(started);
      return (elapsed.user + elapsed.system) / 1000;
    }
  };
}

export async function runWasmCase({
  type,
  testCase,
  input,
  schema,
  variant = 'baseline',
  wasmPath = defaultWasmPath(variant),
  repoRoot = DEFAULT_REPO_ROOT,
  onProcess = null,
  onProcessBatch = null,
  onProcessBatchBoundary = null,
  processBatchCalls = 1,
  processWarmupCalls = 0,
  collectOutput = true
}) {
  if (onProcessBatch && (!Number.isInteger(processBatchCalls) || processBatchCalls <= 0)) {
    throw new Error('processBatchCalls must be a positive integer when onProcessBatch is used');
  }
  const resolvedWasm = path.resolve(repoRoot, wasmPath);
  await requireFile(resolvedWasm, `${variant === 'simd' ? 'SIMD' : 'Baseline'} WASM DSP artifact`);
  const bytes = await fs.readFile(resolvedWasm);
  let module;
  try {
    module = await WebAssembly.compile(bytes);
  } catch (error) {
    throw new Error(`Unable to compile WASM DSP artifact ${resolvedWasm}: ${error.message}`, { cause: error });
  }
  const instance = await WebAssembly.instantiate(module, createImportObject(module));
  const exports = instance.exports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('WASM DSP artifact does not export memory');
  const engineCreate = getExport(exports, 'et_engine_create');
  const engineDestroy = getExport(exports, 'et_engine_destroy');
  const enginePrepare = getExport(exports, 'et_engine_prepare');
  const instanceCreate = getExport(exports, 'et_instance_create');
  const instanceDestroy = getExport(exports, 'et_instance_destroy');
  const instanceReset = getExport(exports, 'et_instance_reset', false);
  const instanceSetSeed = getExport(exports, 'et_instance_set_seed');
  const instanceProcess = getExport(exports, 'et_instance_process');
  const instanceAssetBegin = getExport(exports, 'et_instance_asset_begin', false);
  const instanceAssetCommit = getExport(exports, 'et_instance_asset_commit', false);
  const instanceAssetState = getExport(exports, 'et_instance_asset_state', false);
  const setParams = getExport(exports, 'et_instance_set_params', false);
  const setParamBytes = getExport(exports, 'et_instance_set_param_bytes', false);
  const arenaPtr = getExport(exports, 'et_arena_combined_ptr');
  const scratchPtr = getExport(exports, 'et_scratch_ptr');
  const malloc = getExport(exports, 'malloc', false);
  const free = getExport(exports, 'free', false);

  const engine = engineCreate();
  if (!engine) throw new Error('et_engine_create returned an invalid handle');
  let dspInstance = 0;
  let paramsPtr = 0;
  let paramBytesPtr = 0;
  let paramBytesCapacity = 0;
  try {
    const preparedFrames = testCase.blockSize < 32 ? 32 : testCase.blockSize;
    checkStatus('et_engine_prepare', enginePrepare(
      engine,
      testCase.sampleRate,
      testCase.channels,
      preparedFrames,
      64 * 1024
    ));
    const nameBytes = new TextEncoder().encode(`${type}\0`);
    const namePtr = scratchPtr(engine);
    new Uint8Array(memory.buffer, namePtr, nameBytes.length).set(nameBytes);
    dspInstance = instanceCreate(engine, namePtr);
    if (!dspInstance) throw new Error(`et_instance_create could not create ${type}`);
    const seed = seedWords(testCase.seed);
    checkStatus('et_instance_set_seed', instanceSetSeed(
      engine,
      dspInstance,
      seed.low,
      seed.high
    ));

    const applyParams = params => {
      if (!schema || !setParams) return;
      const packed = packParams(schema, params);
      if (packed.length > 0) {
        if (!malloc) throw new Error('WASM DSP artifact needs malloc to stage packed parameters');
        if (!paramsPtr) paramsPtr = malloc(packed.byteLength);
        if (!paramsPtr) throw new Error('WASM DSP malloc failed for packed parameters');
        new Float32Array(memory.buffer, paramsPtr, packed.length).set(packed);
      }
      checkStatus('et_instance_set_params', setParams(
        engine,
        dspInstance,
        paramsPtr,
        packed.length,
        paramsLayoutHash(schema),
        0
      ));
      if (schema.structured) {
        if (!setParamBytes) {
          throw new Error('WASM DSP artifact is missing structured parameter staging');
        }
        const packedBytes = packStructuredParams(schema, params);
        if (packedBytes.byteLength > paramBytesCapacity) {
          if (!malloc) throw new Error('WASM DSP artifact needs malloc to stage structured parameters');
          if (paramBytesPtr && free) free(paramBytesPtr);
          paramBytesPtr = malloc(packedBytes.byteLength);
          paramBytesCapacity = packedBytes.byteLength;
        }
        if (!paramBytesPtr) throw new Error('WASM DSP malloc failed for structured parameters');
        new Uint8Array(memory.buffer, paramBytesPtr, packedBytes.byteLength).set(packedBytes);
        checkStatus('et_instance_set_param_bytes', setParamBytes(
          engine,
          dspInstance,
          paramBytesPtr,
          packedBytes.byteLength,
          paramsLayoutHash(schema),
          0
        ));
      }
    };
    let currentParams = canonicalizeMultibandParams(schema, { ...(testCase.params ?? {}) });
    applyParams(currentParams);
    const asset = normalizeAsset(testCase.asset, testCase.sampleRate, testCase.channels);
    if (asset) {
      if (!instanceReset || !instanceAssetBegin || !instanceAssetCommit || !instanceAssetState) {
        throw new Error('WASM DSP artifact is missing asset staging exports');
      }
      const assetPtr = instanceAssetBegin(
        engine,
        dspInstance,
        asset.slot,
        asset.channels,
        asset.frames,
        asset.topology,
        asset.headBlock,
        asset.rateDivider,
        asset.pathCount,
        asset.inputCount,
        asset.processingChannels,
        asset.footprintBytes,
        asset.bytes.byteLength
      );
      if (!assetPtr) throw new Error('et_instance_asset_begin returned an invalid pointer');
      new Uint8Array(memory.buffer, assetPtr, asset.bytes.byteLength).set(asset.bytes);
      checkStatus('et_instance_asset_commit', instanceAssetCommit(
        engine,
        dspInstance,
        asset.slot,
        asset.bytes.byteLength,
        asset.format
      ));

      const maximumPreparationCalls = 100000;
      let preparationCalls = 0;
      let assetState = instanceAssetState(engine, dspInstance, asset.slot) & 0xff;
      while (assetState === 2 && preparationCalls < maximumPreparationCalls) {
        const audioPtr = arenaPtr(engine);
        const silence = new Float32Array(
          memory.buffer,
          audioPtr,
          testCase.channels * preparedFrames
        );
        silence.fill(0);
        checkStatus('et_instance_process preparation', instanceProcess(
          engine,
          dspInstance,
          audioPtr,
          testCase.channels,
          preparedFrames,
          0
        ));
        preparationCalls++;
        assetState = instanceAssetState(engine, dspInstance, asset.slot) & 0xff;
      }
      if (assetState !== 3) {
        throw new Error(
          `WASM DSP asset did not become active (state ${assetState} after ${preparationCalls} calls)`
        );
      }
      checkStatus('et_instance_reset', instanceReset(engine, dspInstance));
    }
    if (processWarmupCalls > 0) {
      if (!instanceReset) {
        throw new Error('WASM DSP artifact is missing reset for process timing warmup');
      }
      const blockFrames = Math.min(testCase.blockSize, testCase.frames);
      const audioPtr = arenaPtr(engine);
      const audio = new Float32Array(memory.buffer, audioPtr, testCase.channels * blockFrames);
      for (let call = 0; call < processWarmupCalls; call++) {
        copyInputBlock(input, testCase.frames, testCase.channels, 0, blockFrames, audio);
        checkStatus('et_instance_process timing warmup', instanceProcess(
          engine,
          dspInstance,
          audioPtr,
          testCase.channels,
          blockFrames,
          call * blockFrames / testCase.sampleRate
        ));
      }
      checkStatus('et_instance_reset timing warmup', instanceReset(engine, dspInstance));
    }
    const events = [...(testCase.events ?? [])].sort((left, right) => left.frame - right.frame);
    let eventIndex = 0;
    const output = collectOutput ? new Float32Array(input.length) : null;
    const batchCpuTimer = onProcessBatch ? createProcessTimer('cpu') : null;
    const batchWallTimer = onProcessBatch ? createProcessTimer('wall') : null;
    let batchCpuStarted;
    let batchWallStarted;
    let batchCalls = 0;
    let batchFrames = 0;
    let startFrame = 0;
    onProcessBatchBoundary?.({ phase: 'start' });
    while (startFrame < testCase.frames) {
      while (eventIndex < events.length && events[eventIndex].frame === startFrame) {
        currentParams = canonicalizeMultibandParams(schema, {
          ...currentParams, ...(events[eventIndex].params ?? {})
        });
        applyParams(currentParams);
        eventIndex++;
      }
      const nextEvent = events[eventIndex]?.frame ?? testCase.frames;
      let blockFrames = Math.min(testCase.blockSize, testCase.frames - startFrame);
      if (nextEvent > startFrame && nextEvent < startFrame + blockFrames) blockFrames = nextEvent - startFrame;
      const audioPtr = arenaPtr(engine);
      const audio = new Float32Array(memory.buffer, audioPtr, testCase.channels * blockFrames);
      copyInputBlock(input, testCase.frames, testCase.channels, startFrame, blockFrames, audio);
      if (onProcessBatch && batchCalls === 0) {
        batchWallStarted = batchWallTimer.start();
        batchCpuStarted = batchCpuTimer.start();
      }
      const processStarted = onProcess ? performance.now() : 0;
      const processStatus = instanceProcess(
        engine,
        dspInstance,
        audioPtr,
        testCase.channels,
        blockFrames,
        startFrame / testCase.sampleRate
      );
      if (onProcess) {
        onProcess({
          elapsedMilliseconds: performance.now() - processStarted,
          blockFrames,
          sampleRate: testCase.sampleRate,
          clock: 'high-resolution-wall'
        });
      }
      checkStatus('et_instance_process', processStatus);
      batchCalls++;
      batchFrames += blockFrames;
      if (onProcessBatch &&
          (batchCalls === processBatchCalls || startFrame + blockFrames === testCase.frames)) {
        const elapsedMilliseconds = batchCpuTimer.elapsedMilliseconds(batchCpuStarted);
        const wallElapsedMilliseconds = batchWallTimer.elapsedMilliseconds(batchWallStarted);
        onProcessBatch({
          elapsedMilliseconds,
          wallElapsedMilliseconds,
          blockFrames: batchFrames,
          processCalls: batchCalls,
          sampleRate: testCase.sampleRate,
          clock: batchCpuTimer.clock,
          wallClock: batchWallTimer.clock
        });
        batchCalls = 0;
        batchFrames = 0;
      }
      if (output) {
        copyOutputBlock(audio, output, testCase.frames, testCase.channels, startFrame, blockFrames);
      }
      startFrame += blockFrames;
    }
    onProcessBatchBoundary?.({ phase: 'end' });
    return output;
  } finally {
    if (paramsPtr && free) free(paramsPtr);
    if (paramBytesPtr && free) free(paramBytesPtr);
    if (dspInstance) instanceDestroy(engine, dspInstance);
    engineDestroy(engine);
  }
}

export async function runWasmPipelineCase({
  pipeline,
  testCase,
  input,
  schemas,
  variant = 'baseline',
  wasmPath = defaultWasmPath(variant),
  repoRoot = DEFAULT_REPO_ROOT,
  onCall = null
}) {
  const activePlugins = activePipelinePlugins(pipeline);
  if (activePlugins.length === 0) {
    throw new Error('WASM DSP pipeline benchmark has no active plugins');
  }
  if (!(schemas instanceof Map)) {
    throw new Error('WASM DSP pipeline benchmark requires a schema map');
  }
  const resolvedWasm = path.resolve(repoRoot, wasmPath);
  await requireFile(resolvedWasm, `${variant === 'simd' ? 'SIMD' : 'Baseline'} WASM DSP artifact`);
  const bytes = await fs.readFile(resolvedWasm);
  let module;
  try {
    module = await WebAssembly.compile(bytes);
  } catch (error) {
    throw new Error(`Unable to compile WASM DSP artifact ${resolvedWasm}: ${error.message}`, { cause: error });
  }
  const instance = await WebAssembly.instantiate(module, createImportObject(module));
  const exports = instance.exports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('WASM DSP artifact does not export memory');
  const engineCreate = getExport(exports, 'et_engine_create');
  const engineDestroy = getExport(exports, 'et_engine_destroy');
  const enginePrepare = getExport(exports, 'et_engine_prepare');
  const instanceCreate = getExport(exports, 'et_instance_create');
  const instanceDestroy = getExport(exports, 'et_instance_destroy');
  const instanceSetSeed = getExport(exports, 'et_instance_set_seed');
  const setParams = getExport(exports, 'et_instance_set_params');
  const setParamBytes = getExport(exports, 'et_instance_set_param_bytes', false);
  const pipelineConfigure = getExport(exports, 'et_pipeline_configure');
  const pipelineProcess = getExport(exports, 'et_pipeline_process');
  const arenaPtr = getExport(exports, 'et_arena_combined_ptr');
  const scratchPtr = getExport(exports, 'et_scratch_ptr');
  const malloc = getExport(exports, 'malloc');
  const free = getExport(exports, 'free');

  const engine = engineCreate();
  if (!engine) throw new Error('et_engine_create returned an invalid handle');
  const instanceHandles = new Map();
  const currentParameters = new Map();
  const createdInstances = [];
  try {
    const preparedFrames = testCase.blockSize < 32 ? 32 : testCase.blockSize;
    checkStatus('et_engine_prepare', enginePrepare(
      engine,
      testCase.sampleRate,
      testCase.channels,
      preparedFrames,
      WASM_PIPELINE_TELEMETRY_BYTES
    ));
    onCall?.('et_engine_prepare', {
      preparedFrames,
      telemetryBytes: WASM_PIPELINE_TELEMETRY_BYTES
    });
    const seed = seedWords(testCase.seed);
    const stagePluginParameters = plugin => {
      const type = plugin.definition?.type;
      const schema = schemas.get(type);
      const dspInstance = instanceHandles.get(plugin);
      const parameters = canonicalizeMultibandParams(schema, currentParameters.get(plugin) ?? {});
      currentParameters.set(plugin, parameters);
      const packed = packParams(schema, parameters);
      let paramsPtr = 0;
      try {
        if (packed.byteLength > 0) {
          paramsPtr = malloc(packed.byteLength);
          if (!paramsPtr) throw new Error(`WASM DSP malloc failed for ${type} parameters`);
          new Float32Array(memory.buffer, paramsPtr, packed.length).set(packed);
        }
        checkStatus('et_instance_set_params', setParams(
          engine, dspInstance, paramsPtr, packed.length, paramsLayoutHash(schema), 0
        ));
      } finally {
        if (paramsPtr) free(paramsPtr);
      }
      if (schema.structured) {
        if (!setParamBytes) throw new Error('WASM DSP artifact is missing structured parameter staging');
        const packedBytes = packStructuredParams(schema, parameters);
        const paramBytesPtr = malloc(packedBytes.byteLength);
        if (!paramBytesPtr) throw new Error(`WASM DSP malloc failed for ${type} structured parameters`);
        try {
          new Uint8Array(memory.buffer, paramBytesPtr, packedBytes.byteLength).set(packedBytes);
          checkStatus('et_instance_set_param_bytes', setParamBytes(
            engine, dspInstance, paramBytesPtr, packedBytes.byteLength,
            paramsLayoutHash(schema), 0
          ));
        } finally {
          free(paramBytesPtr);
        }
      }
    };
    for (const plugin of activePlugins) {
      const type = plugin.definition?.type;
      const schema = schemas.get(type);
      if (!type || !schema) {
        throw new Error(`WASM DSP pipeline benchmark is missing a schema for ${type ?? 'an active plugin'}`);
      }
      const nameBytes = new TextEncoder().encode(`${type}\0`);
      const namePtr = scratchPtr(engine);
      new Uint8Array(memory.buffer, namePtr, nameBytes.length).set(nameBytes);
      const dspInstance = instanceCreate(engine, namePtr);
      if (!dspInstance) throw new Error(`et_instance_create could not create ${type}`);
      createdInstances.push(dspInstance);
      instanceHandles.set(plugin, dspInstance);
      checkStatus('et_instance_set_seed', instanceSetSeed(
        engine,
        dspInstance,
        seed.low,
        seed.high
      ));
      currentParameters.set(plugin, structuredClone(plugin.params ?? {}));
      stagePluginParameters(plugin);
    }

    const descriptor = buildDspPipelineDescriptor(pipeline, {
      getInstanceId(plugin) { return instanceHandles.get(plugin); },
      getParameters: plugin => plugin.params ?? {},
      omitInactive: true
    });
    const descriptorPtr = malloc(descriptor.byteLength || 1);
    if (!descriptorPtr) throw new Error('WASM DSP malloc failed for the pipeline descriptor');
    try {
      new Uint8Array(memory.buffer, descriptorPtr, descriptor.byteLength).set(descriptor);
      onCall?.('et_pipeline_configure', { bytes: descriptor.byteLength });
      checkStatus('et_pipeline_configure', pipelineConfigure(
        engine,
        descriptorPtr,
        descriptor.byteLength
      ));
    } finally {
      free(descriptorPtr);
    }

    const events = [...(testCase.events ?? [])].sort((left, right) => left.frame - right.frame);
    if (events.some(event => !Number.isInteger(event.frame) ||
      event.frame < 0 || event.frame >= testCase.frames)) {
      throw new Error('WASM DSP pipeline events must use in-range integer frame offsets');
    }
    let eventIndex = 0;
    const blockSplits = testCase.blockSplits ?? null;
    let splitIndex = 0;
    let splitRemaining = blockSplits?.[0] ?? testCase.blockSize;
    if (blockSplits?.some(frames => !Number.isInteger(frames) || frames <= 0) ||
      blockSplits && blockSplits.reduce((total, frames) => total + frames, 0) !== testCase.frames) {
      throw new Error('WASM DSP pipeline block splits must cover the complete case');
    }
    const output = new Float32Array(input.length);
    let startFrame = 0;
    while (startFrame < testCase.frames) {
      while (eventIndex < events.length && events[eventIndex].frame === startFrame) {
        const event = events[eventIndex++];
        const plugin = activePlugins[event.plugin];
        if (!plugin) throw new Error(`WASM DSP pipeline event has invalid plugin index ${event.plugin}`);
        currentParameters.set(plugin, {
          ...currentParameters.get(plugin),
          ...(event.params ?? {})
        });
        stagePluginParameters(plugin);
      }
      const nextEvent = events[eventIndex]?.frame ?? testCase.frames;
      if (nextEvent < startFrame) throw new Error(`WASM DSP pipeline event at ${nextEvent} was not consumed`);
      let blockFrames = Math.min(splitRemaining, testCase.frames - startFrame);
      if (nextEvent > startFrame && nextEvent < startFrame + blockFrames) {
        blockFrames = nextEvent - startFrame;
      }
      const audioPtr = arenaPtr(engine);
      const audio = new Float32Array(memory.buffer, audioPtr, testCase.channels * blockFrames);
      copyInputBlock(input, testCase.frames, testCase.channels, startFrame, blockFrames, audio);
      onCall?.('et_pipeline_process', { startFrame, blockFrames });
      checkStatus('et_pipeline_process', pipelineProcess(
        engine,
        testCase.channels,
        blockFrames,
        startFrame / testCase.sampleRate,
        0
      ));
      copyOutputBlock(audio, output, testCase.frames, testCase.channels, startFrame, blockFrames);
      startFrame += blockFrames;
      splitRemaining -= blockFrames;
      if (splitRemaining === 0 && startFrame < testCase.frames) {
        splitIndex++;
        splitRemaining = blockSplits?.[splitIndex] ?? testCase.blockSize;
      }
    }
    if (!testCase.captureFinalState) return output;
    return {
      output,
      state: activePlugins.map((plugin, index) => ({
        index,
        type: plugin.definition.type,
        parameters: structuredClone(currentParameters.get(plugin))
      }))
    };
  } finally {
    for (let index = createdInstances.length - 1; index >= 0; index--) {
      instanceDestroy(engine, createdInstances[index]);
    }
    engineDestroy(engine);
  }
}
