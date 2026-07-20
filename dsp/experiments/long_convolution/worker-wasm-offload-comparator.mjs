import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const BLOCK_SIZE = 2048;
const DEEP_OFFSET = 4096;

function importsFor(module) {
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ||= {};
    if (entry.kind === 'function') imports[entry.module][entry.name] = () => 0;
  }
  return imports;
}

if (!isMainThread) {
  const setupStarted = performance.now();
  const instance = await WebAssembly.instantiate(workerData.module, importsFor(workerData.module));
  const api = instance.exports;
  const channels = workerData.irBuffers.length;
  const frames = workerData.irFrames;
  const irPointer = api.malloc(channels * frames * Float32Array.BYTES_PER_ELEMENT);
  if (!irPointer) throw new Error('IR staging allocation failed');
  let memory = new Float32Array(api.memory.buffer);
  for (let channel = 0; channel < channels; channel++) {
    memory.set(new Float32Array(workerData.irBuffers[channel]),
      irPointer / Float32Array.BYTES_PER_ELEMENT + channel * frames);
  }
  const handle = api.etlc_worker_create(channels, frames, irPointer);
  api.free(irPointer);
  if (!handle) throw new Error('deferred-tail engine creation failed');
  const audioBytes = channels * BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT;
  const audioPointer = api.malloc(audioBytes);
  if (!audioPointer) throw new Error('audio slab allocation failed');
  memory = new Float32Array(api.memory.buffer);
  parentPort.postMessage({
    type: 'ready',
    setupMs: performance.now() - setupStarted,
    algorithmMemoryBytes: api.etlc_worker_memory_bytes(handle),
    wasmMemoryBytes: api.memory.buffer.byteLength
  });
  parentPort.on('message', message => {
    if (message.type !== 'process') return;
    const started = performance.now();
    const audio = new Float32Array(message.buffer);
    memory.set(audio, audioPointer / Float32Array.BYTES_PER_ELEMENT);
    if (api.etlc_worker_process(handle, audioPointer, channels, BLOCK_SIZE) !== 1) {
      throw new Error('deferred-tail process failed');
    }
    audio.set(memory.subarray(audioPointer / Float32Array.BYTES_PER_ELEMENT,
      audioPointer / Float32Array.BYTES_PER_ELEMENT + audio.length));
    parentPort.postMessage({
      type: 'result',
      buffer: message.buffer,
      targetFrame: message.index * BLOCK_SIZE + DEEP_OFFSET,
      workerProcessMs: performance.now() - started,
      index: message.index
    }, [message.buffer]);
  });
}

function parseArgs(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dspRoot = path.resolve(here, '..', '..');
  const options = {
    sampleRate: 48000,
    channels: 2,
    irSeconds: 10,
    renderSeconds: 2,
    residentModuleMemoryBytes: 16 * 1024 * 1024,
    output: '',
    wasm: path.join(dspRoot, 'build', 'long-convolution-wasm',
      'effetune-long-convolution-worker.wasm')
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = name => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${name}`);
      return value;
    };
    if (argument === '--sample-rate') options.sampleRate = Number(next(argument));
    else if (argument === '--channels') options.channels = Number(next(argument));
    else if (argument === '--ir-seconds') options.irSeconds = Number(next(argument));
    else if (argument === '--render-seconds') options.renderSeconds = Number(next(argument));
    else if (argument === '--resident-module-memory') {
      options.residentModuleMemoryBytes = Number(next(argument));
    }
    else if (argument === '--output') options.output = path.resolve(next(argument));
    else if (argument === '--wasm') options.wasm = path.resolve(next(argument));
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

function randomGenerator(seed) {
  let state = BigInt.asUintN(64, seed);
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    state = BigInt.asUintN(64, state);
    return Number(state >> 40n) / 8388607.5 - 1;
  };
}

function makeIr(channels, frames) {
  const random = randomGenerator(0x4952524556455242n);
  const decay = Math.log(0.0001) / Math.max(1, frames - 1);
  return Array.from({ length: channels }, () => {
    const ir = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
      ir[frame] = 0.03 * Math.exp(decay * frame) * random();
    }
    ir[0] += 0.7;
    if (frames > 43) ir[43] += 0.2;
    return ir;
  });
}

async function createWorker(ir, module) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: {
      module,
      irFrames: ir[0].length,
      irBuffers: ir.map(channel => channel.slice().buffer)
    }
  });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker setup timeout')), 120000);
    const onError = error => {
      clearTimeout(timeout);
      reject(error);
    };
    worker.once('error', onError);
    worker.once('message', message => {
      clearTimeout(timeout);
      worker.off('error', onError);
      if (message.type !== 'ready') reject(new Error('unexpected setup response'));
      else resolve(message);
    });
  });
  return { worker, ready };
}

async function createResident(ir, module, latencySamples = 128) {
  const instance = await WebAssembly.instantiate(module, importsFor(module));
  const api = instance.exports;
  const channels = ir.length;
  const frames = ir[0].length;
  const irPointer = api.malloc(channels * frames * Float32Array.BYTES_PER_ELEMENT);
  if (!irPointer) throw new Error('resident IR staging allocation failed');
  let memory = new Float32Array(api.memory.buffer);
  for (let channel = 0; channel < channels; channel++) {
    memory.set(ir[channel], irPointer / Float32Array.BYTES_PER_ELEMENT + channel * frames);
  }
  const handle = api.etlc_worker_create_resident(channels, frames, irPointer, latencySamples);
  api.free(irPointer);
  if (!handle) throw new Error('resident-head engine creation failed');
  return {
    algorithmMemoryBytes: api.etlc_worker_memory_bytes(handle),
    moduleMemoryBytes: api.memory.buffer.byteLength
  };
}

async function processBlock(worker, buffer, index) {
  const sentAt = performance.now();
  return new Promise((resolve, reject) => {
    const onError = error => {
      worker.off('message', onMessage);
      reject(error);
    };
    const onMessage = message => {
      if (message.type !== 'result' || message.index !== index) return;
      worker.off('message', onMessage);
      worker.off('error', onError);
      resolve({ ...message, roundtripMs: performance.now() - sentAt });
    };
    worker.once('error', onError);
    worker.on('message', onMessage);
    worker.postMessage({ type: 'process', buffer, index }, [buffer]);
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function accuracyProbe(module) {
  const channels = 2;
  const frames = 32768;
  const ir = makeIr(channels, 12000);
  const input = Array.from({ length: channels }, () => new Float32Array(frames));
  input[0][0] = 0.8;
  input[0][9000] = -0.3;
  input[1][17] = 0.6;
  input[1][11000] = 0.25;
  const expected = Array.from({ length: channels }, () => new Float64Array(frames));
  const actual = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let channel = 0; channel < channels; channel++) {
    for (let frame = 0; frame < frames; frame++) {
      const sample = input[channel][frame];
      if (sample === 0) continue;
      for (let tap = 0; tap < ir[channel].length && frame + tap < frames; tap++) {
        expected[channel][frame + tap] += sample * ir[channel][tap];
        if (tap < DEEP_OFFSET) actual[channel][frame + tap] += sample * ir[channel][tap];
      }
    }
  }
  const engine = await createWorker(ir, module);
  const blocks = Math.ceil((frames - DEEP_OFFSET) / BLOCK_SIZE);
  for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
    const block = new Float32Array(channels * BLOCK_SIZE);
    for (let channel = 0; channel < channels; channel++) {
      block.set(input[channel].subarray(blockIndex * BLOCK_SIZE, (blockIndex + 1) * BLOCK_SIZE),
        channel * BLOCK_SIZE);
    }
    const result = await processBlock(engine.worker, block.buffer, blockIndex);
    const output = new Float32Array(result.buffer);
    for (let channel = 0; channel < channels; channel++) {
      for (let frame = 0; frame < BLOCK_SIZE && result.targetFrame + frame < frames; frame++) {
        actual[channel][result.targetFrame + frame] += output[channel * BLOCK_SIZE + frame];
      }
    }
  }
  await engine.worker.terminate();
  let maxAbsError = 0;
  let errorEnergy = 0;
  let count = 0;
  for (let channel = 0; channel < channels; channel++) {
    for (let frame = 0; frame < frames; frame++) {
      const error = Math.abs(expected[channel][frame] - actual[channel][frame]);
      maxAbsError = Math.max(maxAbsError, error);
      errorEnergy += error * error;
      count++;
    }
  }
  return {
    pass: maxAbsError <= 2e-4,
    finite: Number.isFinite(maxAbsError),
    maxAbsError,
    rmsError: Math.sqrt(errorEnergy / count),
    setup: engine.ready
  };
}

async function benchmarkProbe(options, ir, module) {
  const deadlineMs = BLOCK_SIZE / options.sampleRate * 1000;
  const engine = await createWorker(ir, module);
  const blocks = Math.ceil(options.renderSeconds * options.sampleRate / BLOCK_SIZE);
  const random = randomGenerator(0x574f524b45524450n);
  const roundtrips = [];
  const processing = [];
  let misses = 0;
  let buffer = new ArrayBuffer(options.channels * BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
  for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
    const samples = new Float32Array(buffer);
    for (let index = 0; index < samples.length; index++) samples[index] = 0.1 * random();
    const result = await processBlock(engine.worker, buffer, blockIndex);
    buffer = result.buffer;
    roundtrips.push(result.roundtripMs);
    processing.push(result.workerProcessMs);
    if (result.roundtripMs > deadlineMs) misses++;
  }
  const recoveryStarted = performance.now();
  await engine.worker.terminate();
  const replacement = await createWorker(ir, module);
  const recoveryMs = performance.now() - recoveryStarted;
  await replacement.worker.terminate();
  return {
    deadlineMs,
    blocks,
    misses,
    missRate: misses / blocks,
    medianRoundtripMs: median(roundtrips),
    p95RoundtripMs: percentile(roundtrips, 0.95),
    worstRoundtripMs: Math.max(...roundtrips),
    medianWorkerProcessMs: median(processing),
    worstWorkerProcessMs: Math.max(...processing),
    setupMs: engine.ready.setupMs,
    recoveryMs,
    algorithmMemoryBytes: engine.ready.algorithmMemoryBytes,
    workerModuleMemoryBytes: engine.ready.wasmMemoryBytes
  };
}

async function coResidentProbe(options, ir, module) {
  const workers = await Promise.all(Array.from({ length: 3 }, () => createWorker(ir, module)));
  const started = performance.now();
  await Promise.all(workers.map(async (engine, workerIndex) => {
    let buffer = new ArrayBuffer(options.channels * BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
    for (let blockIndex = 0; blockIndex < 8; blockIndex++) {
      const result = await processBlock(engine.worker, buffer, workerIndex * 1000 + blockIndex);
      buffer = result.buffer;
    }
  }));
  const elapsedMs = performance.now() - started;
  const totalWorkerModuleMemoryBytes = workers.reduce(
    (sum, engine) => sum + engine.ready.wasmMemoryBytes, 0);
  await Promise.all(workers.map(engine => engine.worker.terminate()));
  return { workerCount: workers.length, totalWorkerModuleMemoryBytes, eightBlocksEachElapsedMs: elapsedMs };
}

if (isMainThread) {
  const options = parseArgs(process.argv.slice(2));
  const module = await WebAssembly.compile(await fs.readFile(options.wasm));
  const ir = makeIr(options.channels, options.sampleRate * options.irSeconds);
  const resident = await createResident(ir, module);
  const realtime = await benchmarkProbe(options, ir, module);
  const rawStagingBytes = options.channels * options.sampleRate * options.irSeconds *
    Float32Array.BYTES_PER_ELEMENT;
  const convolutionMemoryPeakBytes = resident.algorithmMemoryBytes +
    realtime.algorithmMemoryBytes + rawStagingBytes;
  const fullLogicalInstanceHighWaterBytes = options.residentModuleMemoryBytes +
    realtime.workerModuleMemoryBytes;
  const result = {
    kind: 'worker-wasm-offload-comparator',
    implementation: 'C++/PFFFT deferred tail in a dedicated WASM Worker',
    blockSize: BLOCK_SIZE,
    deepOffset: DEEP_OFFSET,
    sampleRate: options.sampleRate,
    channels: options.channels,
    irSeconds: options.irSeconds,
    accuracy: await accuracyProbe(module),
    resident,
    realtime,
    combined: {
      algorithmMemoryBytes: resident.algorithmMemoryBytes + realtime.algorithmMemoryBytes,
      rawStagingBytes,
      convolutionMemoryPeakBytes,
      convolutionMemoryUnder32MiB: convolutionMemoryPeakBytes <= 32 * 1024 * 1024,
      residentProfileModuleHighWaterBytes: options.residentModuleMemoryBytes,
      workerModuleHighWaterBytes: realtime.workerModuleMemoryBytes,
      fullLogicalInstanceHighWaterBytes,
      fullLogicalInstanceUnder48MiB: fullLogicalInstanceHighWaterBytes <= 48 * 1024 * 1024,
      residentModuleHeadroomWithin64MiB: 64 * 1024 * 1024 - options.residentModuleMemoryBytes,
      workerModuleHeadroomWithin64MiB: 64 * 1024 * 1024 - realtime.workerModuleMemoryBytes,
      eachModulePreserves16MiBHeadroom:
        options.residentModuleMemoryBytes <= 48 * 1024 * 1024 &&
        realtime.workerModuleMemoryBytes <= 48 * 1024 * 1024
    },
    coResident: await coResidentProbe(options, ir, module)
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) await fs.writeFile(options.output, serialized);
  process.stdout.write(serialized);
}
