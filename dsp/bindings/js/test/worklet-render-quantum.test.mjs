import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EngineSession } from '../dist/engine.js';
import { packEffect } from '../dist/semantics.js';
import { Effect } from '../dist/effect.js';

test('engine session reuses undersized arena channel views', () => {
  let subarrayCalls = 0;
  class TrackedFloat32Array extends Float32Array {
    subarray(begin, end) {
      subarrayCalls++;
      return super.subarray(begin, end);
    }
  }
  const arena = new TrackedFloat32Array(2 * 512);
  const session = new EngineSession({
    getArenaViews: () => ({ combined: arena }),
    pipelineProcess: () => 0,
    close() {}
  }, [], { channels: 2, maxFrames: 512, seed: 0 });
  assert.equal(subarrayCalls, 2);

  const input = Array.from({ length: 2 }, () => new Float32Array(192).fill(0.25));
  const output = Array.from({ length: 2 }, () => new Float32Array(192));
  session.process(input, output, 0, 192, 48000);
  assert.equal(subarrayCalls, 4);
  assert.deepEqual(output, input);

  session.process(input, output, 0, 192, 48000);
  assert.equal(subarrayCalls, 4);
  assert.deepEqual(output, input);
});

test('worklet wrapper sends the prepared render-quantum capacity', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = {
        messages: [],
        postMessage: message => {
          this.port.messages.push(message);
          if (message.type === 'initialize') {
            queueMicrotask(() => this.port.onmessage?.({
              data: { type: 'ready', latencySamples: 0 }
            }));
          }
        },
        start() {}
      };
    }
    disconnect() {}
  };
  try {
    const { EffeTuneNode } = await import(`../dist/worklet.js?quantum=${Date.now()}`);
    for (const [renderQuantumSize, expected] of [[undefined, 128], [64, 128], [512, 512]]) {
      const context = {
        sampleRate: 48000,
        renderQuantumSize,
        audioWorklet: { async addModule() {} }
      };
      const node = await EffeTuneNode.create(context, { version: 1, chain: [] });
      assert.equal(node.port.messages[0].maxFrames, expected);
      node.close();
    }
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});

test('package processor follows each output render-quantum length', async () => {
  const priorProcessor = globalThis.AudioWorkletProcessor;
  const priorRegister = globalThis.registerProcessor;
  const priorSampleRate = globalThis.sampleRate;
  let Processor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = {
        messages: [],
        postMessage: message => this.port.messages.push(message),
        onmessage: null
      };
    }
  };
  globalThis.registerProcessor = (_name, RegisteredProcessor) => {
    Processor = RegisteredProcessor;
  };
  globalThis.sampleRate = 48000;
  try {
    await import(`../dist/worklet-processor.js?quantum=${Date.now()}`);
    const processor = new Processor();
    await processor.initialize({
      channels: 2,
      maxFrames: 512,
      document: { version: 1, chain: [{
        type: 'Volume', id: 'gain', enabled: true,
        channel: 'all', parameters: { volume: -6 }
      }] },
      resolvedAssets: new Map(),
      wasmBytes: await readFile(new URL('../dist/assets/effetune-dsp.wasm', import.meta.url)),
      seed: 0
    });
    assert.deepEqual(processor.port.messages, [{ type: 'ready', latencySamples: 0 }]);

    const renderQuantumSizes = [512, 129, 192, 255, 256, 257, 384, 511];
    for (const frames of renderQuantumSizes) {
      const input = Array.from({ length: 2 }, () => new Float32Array(frames).fill(0.25));
      const output = Array.from({ length: 2 }, () => new Float32Array(frames));
      assert.equal(processor.process([input], [output]), true);
    }
    assert.equal(
      processor.processedFrames,
      renderQuantumSizes.reduce((total, frames) => total + frames, 0)
    );

    processor.handleMessage({ type: 'reset', commandId: 1 });
    const input = Array.from({ length: 2 }, () => new Float32Array(192));
    const output = Array.from({ length: 2 }, () => new Float32Array(192));
    assert.equal(processor.process([input], [output]), true);
    assert.equal(processor.processedFrames, 192);
    processor.handleMessage({ type: 'close' });

    const dynamic = new Processor();
    const limiter = new Effect('BrickwallLimiter', {
      id: 'limiter', channel: 'left', lookahead: 3
    }).toJSON();
    const shaper = new Effect('Saturation', {
      id: 'shaper', channel: 'right', oversampling: 1, mix: 0, gain: 0
    }).toJSON();
    await dynamic.initialize({ channels: 2, maxFrames: 128,
      document: { version: 1, chain: [limiter, shaper] }, resolvedAssets: new Map(),
      wasmBytes: await readFile(new URL('../dist/assets/effetune-dsp.wasm', import.meta.url)), seed: 0 });
    assert.equal(dynamic.ready, true);
    const binding = dynamic.session.binding;
    const initializedMemory = binding.memory.buffer;
    let realtimeRefreshes = 0;
    const refresh = binding.pipelineRefreshLatencyRealtime.bind(binding);
    binding.pipelineRefreshLatencyRealtime = () => { realtimeRefreshes++; return refresh(); };
    binding.pipelineRefreshLatency = () => assert.fail('Audio callbacks must use reserved refresh');
    const silence = Array.from({ length: 2 }, () => new Float32Array(128));
    const rendered = Array.from({ length: 2 }, () => new Float32Array(128));
    let commandId = 10;
    for (const [effect, parameter, value, expected] of [
      [limiter, 'lookahead', 6, 288], [limiter, 'lookahead', 0, 1],
      [limiter, 'lookahead', 10, 480], [limiter, 'lookahead', 0, 1],
      [shaper, 'oversampling', 8, 64], [shaper, 'oversampling', 1, 1]
    ]) {
      effect.parameters[parameter] = value;
      const packed = packEffect(effect);
      dynamic.handleMessage({ type: 'setParam', commandId: commandId++, effectId: effect.id,
        values: packed.values, hash: packed.hash });
      assert.equal(dynamic.process([silence], [rendered]), true);
      assert.equal(dynamic.latencySamples, expected);
      assert.equal(binding.memory.buffer, initializedMemory);
      assert.equal(binding.memoryGrowthViolation, false);
    }
    dynamic.handleMessage({ type: 'reset', commandId: commandId++ });
    dynamic.process([silence], [rendered]);
    assert.equal(dynamic.latencySamples, 144);
    assert.equal(binding.memory.buffer, initializedMemory);
    assert.equal(realtimeRefreshes, 7);
    assert.equal(dynamic.port.messages.some(message => message.type === 'commandResult' && !message.ok), false);
    dynamic.handleMessage({ type: 'close' });
  } finally {
    if (priorProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = priorProcessor;
    if (priorRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = priorRegister;
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});
