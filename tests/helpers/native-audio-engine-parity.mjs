import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { buildDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { protocolVersion, withAudioEngine } from '../../tools/audio-engine-session.mjs';
import { loadAudioWorkletArtifacts } from './audio-worklet-artifacts.mjs';

const quantum = 128;

function packPlugin(plugin) {
  const packer = DSP_PARAM_PACKERS.get(plugin.type);
  const parameters = { enabled: true, ...plugin.parameters };
  return {
    enabled: true, inputBus: 0, outputBus: 0, channel: 'A', ...plugin, parameters,
    constructor: { name: plugin.type },
    wasmParams: packer?.pack(parameters),
    wasmParamBytes: packer?.packBytes?.(parameters),
    wasmParamsHash: packer?.hash,
  };
}

function littleEndianFloat32(samples) {
  const buffer = Buffer.alloc(samples.length * Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < samples.length; i += 1) buffer.writeFloatLE(samples[i], i * 4);
  return buffer;
}

function nativePluginPayload(plugins, initialContents = []) {
  const contents = [...initialContents];
  let size = contents.reduce((total, part) => total + part.length, 0);
  function append(bytes) {
    const offset = size;
    contents.push(bytes);
    size += bytes.length;
    return offset;
  }
  const packed = plugins.map(plugin => {
    const params = plugin.wasmParams ?? [];
    const bytes = plugin.wasmParamBytes ?? [];
    return {
      id: plugin.id, type: plugin.type, skip: plugin.skip === true,
      layoutHash: plugin.wasmParamsHash ?? 0,
      paramsOffset: append(littleEndianFloat32(params)), paramsCount: params.length,
      bytesOffset: append(Buffer.from(bytes)), bytesLength: bytes.length,
    };
  });
  return { packed, attachment: Buffer.concat(contents, size) };
}

async function createReferenceWorklet({ channels, sampleRate, started, outputDelay }) {
  const { source, module } = await loadAudioWorkletArtifacts('simd');
  const errors = [];
  let Processor;
  const sandbox = {
    WebAssembly, ArrayBuffer, Uint8Array, Uint32Array, Float32Array, Float64Array, DataView,
    TextDecoder, TextEncoder, Map, Set, performance, Date, sampleRate, currentFrame: 0, currentTime: 0,
    console: { log() {}, warn: (...args) => errors.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage() {} }; }
    },
    registerProcessor(name, Type) { if (name === 'plugin-processor') Processor = Type; },
  };
  vm.runInNewContext(source, sandbox, { filename: 'plugins/audio-processor.js' });
  assert.ok(Processor);
  const processor = new Processor({ processorOptions: { initialOutputChannelCount: channels, lowLatencyMode: false } });
  const send = data => processor.port.onmessage({ data });
  send({ type: 'updatePlugins', ...started });
  if (outputDelay > 0) send({ type: 'setOutputDelay', samples: outputDelay });
  send({ type: 'dspEnableTypes', types: started.plugins
    .filter(plugin => !plugin.skip && plugin.wasmParams).map(plugin => plugin.type) });
  send({ type: 'dspModule', module });
  try {
    const deadline = performance.now() + 5000;
    while (!processor.dspLive) {
      assert.ok(performance.now() < deadline, `WASM worklet startup timed out: ${errors.join('\n')}`);
      await setImmediate();
    }
  } catch (error) {
    processor.disableDspEngine();
    throw error;
  }
  // Initial configuration was applied while the worklet gate was settling.
  // Measure the steady-state output without the startup fade.
  processor.transition.phase = 'open';
  processor.transition.gain = 1;
  return {
    send,
    render(input) {
      const frames = input.length / channels;
      assert.ok(frames > 0 && frames % quantum === 0);
      const rendered = new Float32Array(input.length);
      const inputs = Array(channels);
      const outputs = Array.from({ length: channels }, () => new Float32Array(quantum));
      let milliseconds = 0;
      for (let offset = 0; offset < frames; offset += quantum) {
        for (let channel = 0; channel < channels; channel += 1) {
          const start = channel * frames + offset;
          inputs[channel] = input.subarray(start, start + quantum);
        }
        const startedAt = performance.now();
        processor.process([inputs], [outputs], {});
        milliseconds += performance.now() - startedAt;
        sandbox.currentFrame += quantum;
        sandbox.currentTime = sandbox.currentFrame / sampleRate;
        for (let channel = 0; channel < channels; channel += 1) {
          rendered.set(outputs[channel], channel * frames + offset);
        }
      }
      assert.deepEqual(errors, []);
      return { output: rendered, processingNanoseconds: Math.round(milliseconds * 1e6) };
    },
    close() { processor.disableDspEngine(); },
  };
}

export async function withNativeWorkletParity(executable, options, action) {
  const { channels = 2, sampleRate = 48000, plugins, masterBypass = false,
    nativePeriod = quantum, outputDelay = 0 } = options;
  const packedPlugins = plugins.map(packPlugin);
  const descriptor = Buffer.from(buildDspPipelineDescriptor(packedPlugins, { getInstanceId: plugin => plugin.id }));
  const pipelinePlugins = packedPlugins.filter(plugin => plugin.type !== 'SectionPlugin');
  const { packed, attachment } = nativePluginPayload(pipelinePlugins, [descriptor]);
  const reference = await createReferenceWorklet({ channels, sampleRate, outputDelay,
    started: { plugins: packedPlugins, masterBypass } });
  try {
    return await withAudioEngine(executable, ['--backend', 'null'], async session => {
      const { message: hello } = await session.receive('hello');
      assert.equal(hello.version, protocolVersion);
      await session.send({ type: 'hello', version: protocolVersion });
      await session.send({ type: 'openSession', sampleRate, outputChannels: channels, inputChannels: 0, periodFrames: nativePeriod });
      await session.receive('sessionState', message => message.state === 'open');
      await session.send({ type: 'configurePipeline', revision: 1, plugins: packed,
        descriptorOffset: 0, descriptorBytes: descriptor.length, masterBypass }, attachment);
      await session.receive('pipelineApplied', message => message.revision === 1);
      if (outputDelay > 0) {
        await session.send({ type: 'setOutputDelay', samples: outputDelay });
        await session.receive('outputDelaySet', message => message.samples === outputDelay);
      }

      const result = await action({
        async render(input) {
          const frames = input.length / channels;
          const worklet = reference.render(input);
          await session.send({ type: 'renderNull', frames }, littleEndianFloat32(input));
          const { message, attachment } = await session.receive('nullOutput');
          assert.equal(message.frames, frames);
          assert.equal(message.channelCount, channels);
          assert.equal(attachment.length, input.length * Float32Array.BYTES_PER_ELEMENT);
          const actual = new Float32Array(input.length);
          for (let i = 0; i < actual.length; i += 1) actual[i] = attachment.readFloatLE(i * 4);
          return { expected: worklet.output, actual,
            workletProcessingNanoseconds: worklet.processingNanoseconds,
            nativeProcessingNanoseconds: message.processingNanoseconds };
        },
        async update(plugin) {
          const updated = packPlugin(plugin);
          reference.send({ type: 'updatePlugin', plugin: updated });
          const { packed: [config], attachment } = nativePluginPayload([updated]);
          await session.send({ ...config, type: 'updateParameters', pluginType: updated.type }, attachment);
        },
      });
      const { code, signal, diagnostics } = await session.finish();
      assert.equal(signal, null, diagnostics);
      assert.equal(code, 0, diagnostics);
      return result;
    });
  } finally {
    reference.close();
  }
}
