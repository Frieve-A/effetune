import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const experimentRoot = path.dirname(fileURLToPath(import.meta.url));
const dspRoot = path.resolve(experimentRoot, '..', '..');

function parseArgs(argv) {
  const options = {
    wasm: path.join(dspRoot, 'build', 'long-convolution-wasm',
      'effetune-long-convolution-worker.wasm'),
    output: '',
    requests: 60,
    deadlineMs: 2048 / 48000 * 1000
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = name => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${name}`);
      return value;
    };
    if (argument === '--wasm') options.wasm = path.resolve(next(argument));
    else if (argument === '--output') options.output = path.resolve(next(argument));
    else if (argument === '--requests') options.requests = Number(next(argument));
    else if (argument === '--deadline-ms') options.deadlineMs = Number(next(argument));
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const wasmBytes = await fs.readFile(options.wasm);
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});
try {
  const page = await browser.newPage();
  await page.route('https://phase0.invalid/**', async route => {
    if (route.request().url().endsWith('/worker.wasm')) {
      await route.fulfill({ status: 200, contentType: 'application/wasm', body: wasmBytes });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' });
    }
  });
  await page.goto('https://phase0.invalid/');
  const result = await page.evaluate(async ({ requests, deadlineMs }) => {
    const channels = 2;
    const irFrames = 480000;
    const blockSize = 2048;
    const wasmModule = await WebAssembly.compileStreaming(fetch('/worker.wasm'));
    const workerSource = `
      const importsFor = module => {
        const imports = {};
        for (const entry of WebAssembly.Module.imports(module)) {
          imports[entry.module] ||= {};
          if (entry.kind === 'function') imports[entry.module][entry.name] = () => 0;
        }
        return imports;
      };
      self.onmessage = async event => {
        const { type, port, module, irBuffer, channels, frames, blockSize } = event.data || {};
        if (type !== 'setup') return;
        const instance = await WebAssembly.instantiate(module, importsFor(module));
        const api = instance.exports;
        const ir = new Float32Array(irBuffer);
        const irPointer = api.malloc(ir.byteLength);
        if (!irPointer) throw new Error('IR staging failed');
        new Float32Array(api.memory.buffer).set(ir, irPointer / 4);
        const handle = api.etlc_worker_create(channels, frames, irPointer);
        api.free(irPointer);
        if (!handle) throw new Error('deferred engine creation failed');
        const audioPointer = api.malloc(channels * blockSize * 4);
        if (!audioPointer) throw new Error('audio slab allocation failed');
        port.onmessage = message => {
          const packet = message.data;
          const audio = new Float32Array(packet.buffer);
          let memory = new Float32Array(api.memory.buffer);
          memory.set(audio, audioPointer / 4);
          const started = performance.now();
          if (api.etlc_worker_process(handle, audioPointer, channels, blockSize) !== 1) {
            throw new Error('deferred processing failed');
          }
          const workerProcessMs = performance.now() - started;
          memory = new Float32Array(api.memory.buffer);
          audio.set(memory.subarray(audioPointer / 4, audioPointer / 4 + audio.length));
          port.postMessage({ ...packet, workerProcessMs }, [packet.buffer]);
        };
        port.start();
        self.postMessage({
          type: 'ready',
          moduleMemoryBytes: api.memory.buffer.byteLength,
          algorithmMemoryBytes: api.etlc_worker_memory_bytes(handle)
        });
      };
    `;
    const workletSource = `
      class LongConvolutionWorkerProbe extends AudioWorkletProcessor {
        constructor(options) {
          super();
          this.endpoint = null;
          this.pool = [];
          this.interval = options.processorOptions.interval;
          this.deadlineMs = options.processorOptions.deadlineMs;
          this.target = options.processorOptions.target;
          this.resetRun();
          this.port.onmessage = event => this.configure(event.data);
        }
        resetRun() {
          this.quantum = 0;
          this.sent = 0;
          this.received = 0;
          this.inFlight = 0;
          this.misses = 0;
          this.samples = [];
          this.processing = [];
          this.recoveryPending = false;
        }
        configure(message) {
          if (message.type !== 'setup') return;
          if (message.recovery) {
            this.resetRun();
            this.target = message.target;
            this.recoveryPending = true;
          }
          this.endpoint = message.endpoint;
          this.pool = [...message.pool];
          this.endpoint.onmessage = event => this.receive(event.data);
          this.endpoint.start();
        }
        receive(packet) {
          const elapsed = currentFrame / sampleRate * 1000 - packet.sentAt;
          this.samples.push(elapsed);
          this.processing.push(packet.workerProcessMs);
          if (elapsed > this.deadlineMs) this.misses++;
          this.pool.push(packet.buffer);
          this.inFlight--;
          this.received++;
          if (this.recoveryPending) {
            this.recoveryPending = false;
            this.port.postMessage({ type: 'recovered' });
          }
          if (this.received >= this.target && this.inFlight === 0) {
            const sorted = [...this.samples].sort((a, b) => a - b);
            const processSorted = [...this.processing].sort((a, b) => a - b);
            const at = (values, fraction) => values[Math.min(
              values.length - 1, Math.floor(values.length * fraction))];
            this.port.postMessage({
              type: 'stats', count: sorted.length, misses: this.misses,
              missRate: this.misses / sorted.length,
              medianMs: at(sorted, 0.5), p95Ms: at(sorted, 0.95),
              worstMs: sorted[sorted.length - 1],
              medianWorkerProcessMs: at(processSorted, 0.5),
              worstWorkerProcessMs: processSorted[processSorted.length - 1]
            });
          }
        }
        process(inputs, outputs) {
          const output = outputs[0]?.[0];
          if (output) output.fill(0);
          if (this.endpoint && this.pool.length && this.sent < this.target &&
              this.quantum % this.interval === 0) {
            const buffer = this.pool.pop();
            this.endpoint.postMessage({
              buffer, sentAt: currentFrame / sampleRate * 1000, index: this.sent
            }, [buffer]);
            this.sent++;
            this.inFlight++;
          }
          this.quantum++;
          return true;
        }
      }
      registerProcessor('long-convolution-worker-probe', LongConvolutionWorkerProbe);
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await context.audioWorklet.addModule(workletUrl);
    function makeIr() {
      const ir = new Float32Array(channels * irFrames);
      for (let channel = 0; channel < channels; channel++) {
        for (let frame = 0; frame < irFrames; frame++) {
          ir[channel * irFrames + frame] = 0.01 * Math.exp(-9 * frame / irFrames) *
            Math.sin((frame + 1) * (channel + 3));
        }
        ir[channel * irFrames] += 0.7;
      }
      return ir;
    }

    async function createWorker(endpoint) {
      const worker = new Worker(workerUrl);
      const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('worker setup timeout')), 30000);
        worker.onmessage = event => {
          if (event.data?.type === 'ready') {
            clearTimeout(timeout);
            resolve(event.data);
          }
        };
        worker.onerror = event => reject(new Error(event.message));
      });
      const ir = makeIr();
      worker.postMessage({
        type: 'setup', port: endpoint, module: wasmModule, irBuffer: ir.buffer,
        channels, frames: irFrames, blockSize
      }, [endpoint, ir.buffer]);
      return { worker, ready: await ready };
    }

    async function createProbe(target) {
      const node = new AudioWorkletNode(context, 'long-convolution-worker-probe', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { target, deadlineMs, interval: 16 }
      });
      node.connect(context.destination);
      const channel = new MessageChannel();
      const worker = await createWorker(channel.port2);
      const pool = Array.from({ length: 4 }, () => new ArrayBuffer(channels * blockSize * 4));
      node.port.postMessage({ type: 'setup', endpoint: channel.port1, pool },
        [channel.port1, ...pool]);
      return { node, worker };
    }

    const probes = await Promise.all(Array.from({ length: 3 }, () => createProbe(requests)));
    const statsPromises = probes.map(({ node }) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worklet stats timeout')), 30000);
      node.port.onmessage = event => {
        if (event.data?.type === 'stats') {
          clearTimeout(timeout);
          resolve(event.data);
        }
      };
    }));
    await context.resume();
    const stats = await Promise.all(statsPromises);
    const totalWorkerModuleMemoryBytes = probes.reduce(
      (sum, probe) => sum + probe.worker.ready.moduleMemoryBytes, 0);

    const recoveryStarted = performance.now();
    probes[0].worker.worker.terminate();
    const replacementChannel = new MessageChannel();
    const replacement = await createWorker(replacementChannel.port2);
    const recoveryPool = Array.from(
      { length: 4 }, () => new ArrayBuffer(channels * blockSize * 4));
    const recovered = new Promise(resolve => {
      probes[0].node.port.onmessage = event => {
        if (event.data?.type === 'recovered') resolve(performance.now() - recoveryStarted);
      };
    });
    probes[0].node.port.postMessage({
      type: 'setup', endpoint: replacementChannel.port1, pool: recoveryPool,
      recovery: true, target: 8
    }, [replacementChannel.port1, ...recoveryPool]);
    const recoveryMs = await recovered;

    for (let index = 0; index < probes.length; index++) {
      probes[index].node.disconnect();
      if (index > 0) probes[index].worker.worker.terminate();
    }
    replacement.worker.terminate();
    await context.close();
    URL.revokeObjectURL(workerUrl);
    URL.revokeObjectURL(workletUrl);
    return {
      kind: 'browser-worklet-worker-wasm-roundtrip',
      implementation: 'C++/PFFFT deferred tail through MessageChannel and transferable buffers',
      workerCount: probes.length,
      deadlineMs,
      perWorkerModuleMemoryBytes: probes[0].worker.ready.moduleMemoryBytes,
      perWorkerAlgorithmMemoryBytes: probes[0].worker.ready.algorithmMemoryBytes,
      totalWorkerModuleMemoryBytes,
      runs: stats,
      aggregateMisses: stats.reduce((sum, item) => sum + item.misses, 0),
      recoveryMs
    };
  }, { requests: options.requests, deadlineMs: options.deadlineMs });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) await fs.writeFile(options.output, serialized);
  process.stdout.write(serialized);
} finally {
  await browser.close();
}
