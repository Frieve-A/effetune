import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DspBindingError,
  DspEngineBinding,
  ET_ERR_STATE,
  REQUIRED_FUNCTION_EXPORTS,
  createDspImports,
  instantiateDspBinding
} from '../../js/audio/dsp-engine-binding.js';

function createFakeInstance(options = {}) {
  const memory = options.memory || new WebAssembly.Memory({ initial: 2, maximum: 8 });
  const calls = [];
  const kernels = options.kernels || [
    { name: 'VolumePlugin', hash: 0x12345678, byteCapacity: 0, assetCapacity: 4096 },
    { name: 'LevelMeterPlugin', hash: 0x9abcdef0, byteCapacity: 0, assetCapacity: 0 }
  ];
  let nextAllocation = 60000;
  const scratchPtr = 45056;
  const exports = {
    memory,
    malloc(size) {
      calls.push(['malloc', size]);
      if (options.mallocFails) return 0;
      if (options.growDuringMalloc) memory.grow(1);
      const ptr = nextAllocation;
      nextAllocation += size;
      return ptr;
    },
    free(ptr) {
      calls.push(['free', ptr]);
    },
    et_abi_version: () => options.abiVersion ?? 1,
    et_build_flags: () => options.buildFlags ?? 0,
    et_kernel_count: () => kernels.length,
    et_kernel_name(index, ptr, size) {
      if (options.badKernelLength !== undefined) return options.badKernelLength;
      const bytes = new TextEncoder().encode(kernels[index].name);
      new Uint8Array(memory.buffer, ptr, size).fill(0);
      new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
      return bytes.length;
    },
    et_kernel_params_hash: index => kernels[index].hash,
    et_kernel_param_bytes_capacity: index => kernels[index].byteCapacity ?? 0,
    et_kernel_asset_capacity: (index, slot) => slot === 0 ? kernels[index].assetCapacity ?? 0 : 0,
    et_engine_memory_required(...args) {
      calls.push(['memoryRequired', ...args]);
      return 123456;
    },
    et_engine_create() {
      calls.push(['engineCreate']);
      if (options.growDuringCreate) memory.grow(1);
      options.onEngineCreate?.();
      return options.engineHandle ?? 7;
    },
    et_engine_destroy(engine) {
      calls.push(['engineDestroy', engine]);
    },
    et_engine_prepare(...args) {
      calls.push(['enginePrepare', ...args]);
      if (options.growDuringPrepare) memory.grow(1);
      return options.prepareStatus ?? 0;
    },
    et_engine_reset(engine) {
      calls.push(['engineReset', engine]);
      return 0;
    },
    et_engine_set_telemetry_rate(engine, rateHz) {
      calls.push(['telemetryRate', engine, rateHz]);
      return options.telemetryRateStatus ?? 0;
    },
    et_instance_create(engine, ptr) {
      const bytes = new Uint8Array(memory.buffer, ptr, 4096);
      const end = bytes.indexOf(0);
      calls.push(['instanceCreate', engine, new TextDecoder().decode(bytes.subarray(0, end))]);
      return 11;
    },
    et_instance_destroy(...args) {
      calls.push(['instanceDestroy', ...args]);
    },
    et_instance_reset(...args) {
      calls.push(['instanceReset', ...args]);
      return 0;
    },
    et_instance_set_midi_channel_mix() { return 0; },
    et_instance_stream_readiness(_engine, _id, ptr) {
      new Uint32Array(memory.buffer, ptr, 6).fill(0); return 0;
    },
    et_instance_stream_boundary(...args) {
      calls.push(['instanceStreamBoundary', ...args]);
      return 0;
    },
    et_instance_latency(...args) {
      calls.push(['instanceLatency', ...args]);
      return 32;
    },
    et_instance_set_tap(...args) {
      calls.push(['instanceSetTap', ...args]);
      return 0;
    },
    et_instance_set_analysis_source(...args) {
      calls.push(['instanceSetAnalysisSource', ...args]);
      return 0;
    },
    et_instance_set_seed(...args) {
      calls.push(['instanceSetSeed', ...args]);
      return 0;
    },
    et_instance_set_params(engine, instance, ptr, count, hash, offset) {
      const values = [...new Float32Array(memory.buffer, ptr, count)];
      calls.push(['instanceSetParams', engine, instance, values, hash >>> 0, offset]);
      return options.paramsStatus ?? 0;
    },
    et_instance_set_param_bytes(engine, instance, ptr, count, hash, offset) {
      const values = [...new Uint8Array(memory.buffer, ptr, count)];
      calls.push(['instanceSetParamBytes', engine, instance, values, hash >>> 0, offset]);
      return options.paramBytesStatus ?? 0;
    },
    et_instance_asset_begin(engine, instance, slot, channels, frames, topology, headBlock,
      rateDivider, pathCount, inputCount, processingChannels, footprintBytes, byteSize) {
      calls.push(['assetBegin', engine, instance, slot, channels, frames, topology, headBlock,
        rateDivider, pathCount, inputCount, processingChannels, footprintBytes, byteSize]);
      if (options.growDuringAssetBegin) memory.grow(1);
      return options.assetBeginFails ? 0 : 70000;
    },
    et_instance_asset_commit(...args) {
      calls.push(['assetCommit', ...args]);
      if (options.growDuringAssetCommit) memory.grow(1);
      if (options.assetCommitThrows) throw new Error('commit failed');
      return options.assetCommitStatus ?? 0;
    },
    et_instance_asset_abort(...args) {
      calls.push(['assetAbort', ...args]);
    },
    et_instance_asset_state(...args) {
      calls.push(['assetState', ...args]);
      return options.assetState ?? 3;
    },
    et_instance_process(...args) {
      calls.push(['instanceProcess', ...args]);
      return options.processStatus ?? 0;
    },
    et_instance_runtime_event(engine, instance, ptr) {
      calls.push(['instanceRuntimeEvent', engine, instance, ptr]);
      if (options.runtimeEventStatus) return options.runtimeEventStatus;
      const data = new DataView(memory.buffer);
      const state = options.runtimeEvent ?? {
        generation: 7,
        latched: true,
        cause: 1
      };
      data.setUint32(ptr, state.generation, true);
      data.setUint32(ptr + 4, state.latched ? 1 : 0, true);
      data.setUint32(ptr + 8, state.cause, true);
      return 0;
    },
    et_arena_combined_ptr: () => 4096,
    et_arena_bus_ptr: (_engine, bus) => 4096 + bus * 4096,
    et_arena_scratch_ptr: (_engine, which) => 24576 + which * 4096,
    et_scratch_ptr: () => scratchPtr,
    et_telemetry_staging_ptr: () => 50000,
    et_telemetry_capacity: () => options.telemetryCapacity ?? 64,
    et_telemetry_read(engine, out, maxBytes, droppedPtr) {
      calls.push(['telemetryRead', engine, out, maxBytes, droppedPtr]);
      const data = new DataView(memory.buffer);
      data.setUint32(droppedPtr, options.droppedFrames ?? 2, true);
      const source = options.telemetryBytes || Uint8Array.of(10, 20, 30, 40);
      new Uint8Array(memory.buffer, out, source.length).set(source);
      return options.badTelemetryCount ?? source.length;
    },
    et_pipeline_configure(engine, ptr, length) {
      calls.push(['pipelineConfigure', engine, [...new Uint8Array(memory.buffer, ptr, length)]]);
      if (options.growDuringPipelineConfigure) memory.grow(1);
      return options.pipelineStatus ?? 0;
    },
    et_pipeline_refresh_latency(engine) {
      calls.push(['pipelineRefreshLatency', engine]);
      if (options.growDuringPipelineRefresh) memory.grow(1);
      return options.pipelineStatus ?? 0;
    },
    et_pipeline_reserve_latency(engine) {
      calls.push(['pipelineReserveLatency', engine]);
      if (options.growDuringPipelineReserve) memory.grow(1);
      return options.pipelineStatus ?? 0;
    },
    et_pipeline_refresh_latency_realtime(engine) {
      calls.push(['pipelineRefreshLatencyRealtime', engine]);
      if (options.growDuringPipelineRealtimeRefresh) memory.grow(1);
      return options.pipelineStatus ?? 0;
    },
    et_pipeline_latency(engine) {
      calls.push(['pipelineLatency', engine]);
      return options.pipelineLatency ?? 384;
    },
    et_pipeline_process(...args) {
      calls.push(['pipelineProcess', ...args]);
      return 0;
    }
  };
  return { instance: { exports }, exports, memory, calls };
}

test('SFZ page transport preserves uint64 identities and allocates only at configuration', () => {
  const fake = createFakeInstance({ memory: new WebAssembly.Memory({ initial: 8, maximum: 8 }) });
  const exports = fake.instance.exports, generation = 2 ** 32 + 7, pageIndex = 2 ** 32 + 19;
  let configured = false, published, forecast;
  exports.et_instance_set_midi_events = () => 0;
  exports.et_sfz_stream_capability = () => 1;
  exports.et_instance_stream_configure = (engine, id, low, high) => {
    assert.deepEqual([engine, id, low, high], [7, 11, 7, 1]); configured = true; return 0;
  };
  exports.et_instance_stream_take_requests = (engine, id, ptr, capacity, countPtr) => {
    assert.equal(configured, true); assert.equal(capacity, 4096);
    new Uint32Array(exports.memory.buffer, ptr, 6).set([7, 1, 19, 1, 3, 0]);
    new DataView(exports.memory.buffer).setUint32(countPtr, 1, true); return 0;
  };
  exports.et_instance_stream_publish = (...args) => {
    published = args; assert.deepEqual([...new Float32Array(exports.memory.buffer, args[7], 4)], [.25, -.25, .5, -.5]); return 0;
  };
  exports.et_instance_stream_prefetch = (...args) => {
    forecast = args;
    assert.deepEqual([...new Uint32Array(exports.memory.buffer, args[2], 6)], [0, 0x643c90, 0, 0, 7, 1]);
    return 0;
  };
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine(); binding.prepare(48000, 2, 128, 4096);
  assert.equal(binding.hasSfzSampleStreaming(), true);
  assert.equal(binding.configureSfzSampleStream(11, generation), 0);
  const allocations = fake.calls.filter(call => call[0] === 'malloc').length;
  assert.equal(binding.prefetchSfzSampleStream(11, [{ status: 0x90, data1: 60, data2: 100, renderFrame: 2 ** 32 + 7 }], 2, 12000, 1), 0);
  assert.deepEqual([forecast[0], forecast[1], ...forecast.slice(3)], [7, 11, 1, 2, 12000, 1]);
  exports.et_instance_stream_prefetch = (...args) => {
    assert.deepEqual([...new Uint32Array(exports.memory.buffer, args[2], 2)], [48000, 0x643c90]);
    assert.deepEqual(args.slice(3), [1, 0, 72000, 5]); return 0;
  };
  assert.equal(binding.prefetchSfzSampleStream(11, [{ status: 0x90, data1: 60, data2: 100, offsetFrames: 48000 }], 0, 72000, 5), 0);
  assert.throws(() => binding.instanceSetMidiEvents(11, [{ status: 0x90, data1: 60, data2: 100, offsetFrames: 48000 }], 2), DspBindingError);
  exports.et_instance_stream_readiness = (_engine, _id, ptr) => {
    new Uint32Array(exports.memory.buffer, ptr, 6).set([0, 3, 72000, 0, 42, 4]); return 0;
  };
  assert.deepEqual(binding.instanceStreamReadiness(11), { generation: 0, scope: 3, admittedFrames: 72000,
    readyAheadFrames: 0, plannedPages: 42, pendingPages: 4 });
  assert.throws(() => binding.prefetchSfzSampleStream(11, new Array(257), 2, 12000), /capacity/);
  assert.deepEqual(binding.takeSfzSampleRequests(11), [{ generation, pageIndex, sample: 3 }]);
  assert.equal(binding.publishSfzSamplePage(11, { generation, pageIndex, sample: 3, frames: 2, channels: 2,
    pcm: new Float32Array([.25, -.25, .5, -.5]), resident: true }), 0);
  assert.deepEqual(published.slice(0, 7), [7, 11, 7, 1, 3, 19, 1]);
  assert.deepEqual(published.slice(8), [2, 2, 1]);
  assert.equal(fake.calls.filter(call => call[0] === 'malloc').length, allocations);
  const ptr = binding._sfzStreamPtr;
  binding.destroyEngine(); assert.ok(fake.calls.some(call => call[0] === 'free' && call[1] === ptr));
  delete exports.et_sfz_stream_capability;
  assert.equal(new DspEngineBinding(fake.instance).hasSfzSampleStreaming(), false);
});

test('binding rejects missing ABI exports and invalid instances', () => {
  assert.throws(() => new DspEngineBinding(null), /exports are unavailable/);
  assert.throws(() => new DspEngineBinding({ exports: {} }), /Missing WASM export: memory/);

  const fake = createFakeInstance();
  delete fake.exports.et_engine_reset;
  assert.throws(() => new DspEngineBinding(fake.instance), /et_engine_reset/);
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_pipeline_process'));
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_pipeline_latency'));
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_instance_set_param_bytes'));
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_instance_asset_begin'));
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_instance_runtime_event'));
});

test('instance spans preserve planar channels and sample times without touching the rest of a block', () => {
  const fake = createFakeInstance();
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  assert.equal(binding.prepare(44100, 16, 128, 65536), 0);
  const audio = new Float32Array(fake.memory.buffer, 4096, 16 * 128);
  for (let channel = 0; channel < 16; channel++) {
    for (let frame = 0; frame < 128; frame++) audio[channel * 128 + frame] = channel * 1000 + frame;
  }
  const times = [];
  fake.exports.et_instance_process = (engine, instance, pointer, channels, frames, time) => {
    times.push([frames, time]);
    const values = new Float32Array(fake.memory.buffer, pointer, channels * frames);
    for (let i = 0; i < values.length; i++) values[i] += 0.5;
    return 0;
  };
  assert.equal(binding.instanceProcessSpan(11, 4096, 16, 128, 18, 110, 2), 0);
  assert.deepEqual(times, [[64, 2 + 18 / 44100], [46, 2 + 82 / 44100]]);
  for (let channel = 0; channel < 16; channel++) {
    for (let frame = 0; frame < 128; frame++) {
      assert.equal(audio[channel * 128 + frame], channel * 1000 + frame + (frame >= 18 ? 0.5 : 0));
    }
  }
  binding.close();
});

test('timed MIDI events and clocks preserve frame values beyond32bits and expose fresh pending state', () => {
  const fake = createFakeInstance({ memory: new WebAssembly.Memory({ initial: 8, maximum: 8 }) });
  let packed;
  let clock;
  fake.exports.et_instance_set_midi_events = (_engine, _id, ptr, count) => {
    packed = Array.from(new Uint32Array(fake.memory.buffer, ptr, count * 6));
    return 0;
  };
  fake.exports.et_instance_set_midi_clock = (...args) => { clock = args; return 0; };
  fake.exports.et_instance_midi_state = () => 6;
  fake.exports.et_instance_midi_clock_low = () => 3;
  fake.exports.et_instance_midi_clock_high = () => 2;
  fake.exports.et_instance_midi_generation = () => 4;
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(48000, 2, 128, 65536);
  assert.equal(binding.instanceSetMidiEvents(11, [{ offsetFrames: 7, status: 0x90, data1: 60, data2: 100,
    noteId: 9, flags: 0, renderFrame: 0x200000003 }], 4), 0);
  assert.deepEqual(packed, [7, 0x643c90, 9, 0, 3, 2]);
  assert.equal(binding.instanceSetMidiClock(11, 0x200000003, 4, 1), 0);
  assert.deepEqual(clock, [7, 11, 3, 2, 4, 1]);
  assert.equal(binding.instanceMidiState(11), 6);
  assert.deepEqual(binding.instanceMidiClock(11), { frame: 0x200000003, generation: 4 });
  assert.throws(() => binding.instanceSetMidiClock(11, -1, 4), /render clock/);
  assert.throws(() => binding.instanceSetMidiEvents(11, [{ offsetFrames: 0, status: 0x90,
    data1: 60, data2: 100, renderFrame: Number.MAX_SAFE_INTEGER + 1 }], 4), /event contract/);
  binding.close();
});

test('MIDI checkpoint control copies retain independent bytes and propagate stale restore failure', () => {
  const fake = createFakeInstance({ memory: new WebAssembly.Memory({ initial: 8, maximum: 8 }) });
  fake.exports.et_instance_midi_checkpoint_size = () => 4;
  fake.exports.et_instance_write_midi_checkpoint = (_engine, _id, ptr) => {
    new Uint8Array(fake.memory.buffer, ptr, 4).set([1, 2, 3, 4]); return 0;
  };
  let restored;
  fake.exports.et_instance_read_midi_checkpoint = (_engine, _id, ptr, size) => {
    restored = [...new Uint8Array(fake.memory.buffer, ptr, size)]; return -3;
  };
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(48000, 2, 128, 65536);
  const snapshot = binding.instanceWriteMidiCheckpoint(11);
  assert.deepEqual([...snapshot], [1, 2, 3, 4]);
  assert.equal(binding.instanceReadMidiCheckpoint(11, snapshot), -3);
  assert.deepEqual(restored, [1, 2, 3, 4]);
  assert.equal(fake.calls.filter(call => call[0] === 'free').length, 2);
  fake.exports.et_instance_midi_checkpoint_size = () => 0;
  assert.throws(() => binding.instanceWriteMidiCheckpoint(11), /checkpoint size/);
  fake.exports.et_instance_midi_checkpoint_size = () => 32 * 1024 * 1024 + 1;
  assert.throws(() => binding.instanceWriteMidiCheckpoint(11), /checkpoint size/);
  binding.close();
});

test('binding discovers capabilities and drives engine and instance lifecycle', () => {
  const fake = createFakeInstance();
  const binding = new DspEngineBinding(fake.instance);

  assert.equal(binding.getAbiVersion(), 1);
  assert.equal(binding.getBuildFlags(), 0);
  assert.equal(binding.getKernelCount(), 2);
  assert.equal(binding.memoryRequired(48000, 8, 128, 262144), 123456);
  assert.deepEqual(binding.getCapabilities(), {
    abiVersion: 1,
    buildFlags: 0,
    simd: false,
    kernels: [
      { name: 'VolumePlugin', hash: 0x12345678, byteCapacity: 0, assetCapacity: 4096,
        kernelIndex: 0 },
      { name: 'LevelMeterPlugin', hash: 0x9abcdef0, byteCapacity: 0, assetCapacity: 0,
        kernelIndex: 1 }
    ]
  });
  assert.equal(binding.engine, 0);
  assert.equal(binding.createEngine(), 7);
  assert.throws(() => binding.createEngine(), /already exists/);
  assert.equal(binding.getKernelName(0), 'VolumePlugin');
  assert.equal(binding.getKernelParamsHash(1), 0x9abcdef0);
  assert.equal(binding.getKernelParamBytesCapacity(1), 0);
  assert.equal(binding.getKernelAssetCapacity(0), 4096);
  assert.throws(() => binding.getKernelName(2), RangeError);
  assert.throws(() => binding.getKernelParamsHash(-1), RangeError);
  assert.throws(() => binding.getKernelParamBytesCapacity(2), RangeError);
  assert.throws(() => binding.getKernelAssetCapacity(2), RangeError);

  assert.equal(binding.prepare(48000, 2, 4, 64), 0);
  assert.equal(binding.live, true);
  assert.equal(binding.createInstance('VolumePlugin'), 11);
  assert.equal(binding.resetInstance(11), 0);
  assert.equal(binding.streamBoundaryInstance(11), 0);
  assert.deepEqual(fake.calls.find(call => call[0] === 'instanceStreamBoundary'),
    ['instanceStreamBoundary', 7, 11]);
  assert.equal(binding.instanceLatency(11), 32);
  assert.equal(binding.instanceSetTap(11, 99), 0);
  assert.equal(binding.instanceSetAnalysisSource(11, 12), 0);
  assert.deepEqual(fake.calls.find(call => call[0] === 'instanceSetAnalysisSource'),
    ['instanceSetAnalysisSource', 7, 11, 12]);
  assert.equal(binding.instanceSetSeed(11, 0x89abcdef, 0x01234567), 0);
  assert.equal(binding.setTelemetryRate(30), 0);
  assert.equal(binding.instanceSetParams(11, [0.25, 0.5], 0xfeedbeef, 3), 0);
  assert.deepEqual(binding.instanceRuntimeEvent(11), {
    generation: 7,
    latched: true,
    cause: 1
  });
  assert.equal(binding.instanceSetParamBytes(11, Uint8Array.of(1, 0, 0, 0), 0xfeedbeef), 0);
  const assetPayload = new Uint8Array(64);
  const assetHeader = new DataView(assetPayload.buffer);
  assetHeader.setUint32(0, 0x31415445, true);
  assetHeader.setUint32(4, 2, true);
  assetHeader.setUint32(8, 4, true);
  assetHeader.setUint32(12, 48000, true);
  assetHeader.setUint32(16, 2, true);
  assert.equal(binding.instanceSetAsset(11, 0, assetPayload, {
    channels: 2, frames: 4, topology: 2, headBlock: 128, rateDivider: 1,
    processingChannels: 2, footprintBytes: 1024
  }), 0);
  assert.equal(binding.instanceAssetState(11, 0), 3);
  binding.instanceAssetAbort(11, 0);
  assert.equal(binding.instanceProcess(11, 4096, 2, 128, 1.5), 0);
  binding.destroyInstance(11);
  assert.equal(binding.reset(), 0);

  const paramsCall = fake.calls.find(call => call[0] === 'instanceSetParams');
  assert.deepEqual(paramsCall, ['instanceSetParams', 7, 11, [0.25, 0.5], 0xfeedbeef, 3]);
  const paramBytesCall = fake.calls.find(call => call[0] === 'instanceSetParamBytes');
  assert.deepEqual(paramBytesCall, [
    'instanceSetParamBytes', 7, 11, [1, 0, 0, 0], 0xfeedbeef, 0
  ]);
  assert.ok(fake.calls.some(call => call[0] === 'instanceCreate' && call[2] === 'VolumePlugin'));
  assert.ok(fake.calls.some(call => call[0] === 'instanceSetSeed' &&
    call[3] === 0x89abcdef && call[4] === 0x01234567));
  assert.ok(fake.calls.some(call => call[0] === 'telemetryRate' && call[2] === 30));
  assert.ok(fake.calls.some(call => call[0] === 'assetBegin' &&
    call[11] === 2 && call[12] === 1024));

  binding.markFailed();
  assert.equal(binding.live, false);
  binding.destroyEngine();
  binding.destroyEngine();
  assert.ok(fake.calls.some(call => call[0] === 'engineDestroy' && call[1] === 7));
  assert.equal(binding.reset(), ET_ERR_STATE);
  assert.equal(binding.setTelemetryRate(60), ET_ERR_STATE);
  assert.equal(binding.createInstance('VolumePlugin'), 0);
  assert.equal(binding.instanceSetSeed(1, 2, 3), ET_ERR_STATE);
  assert.equal(binding.instanceSetParams(1, [], 0), ET_ERR_STATE);
  assert.equal(binding.instanceRuntimeEvent(1), null);
  assert.equal(binding.instanceSetParamBytes(1, new Uint8Array(0), 0), ET_ERR_STATE);
});

test('an older Chain-only artifact stays usable and reports Graph as unsupported', () => {
  const fake = createFakeInstance();
  const binding = new DspEngineBinding(fake.instance);

  assert.equal(binding.graphCapabilities(), 0);
  assert.equal(binding.graphSupported, false);
  assert.equal(binding.createEngine(), 7);
  assert.equal(binding.prepare(48000, 2, 128, 64), 0);
  assert.equal(binding.graphConfigure(Uint8Array.of(1)), ET_ERR_STATE);
  assert.equal(binding.graphProcess(2, 128, 0), ET_ERR_STATE);
  assert.equal(binding.graphReset(), ET_ERR_STATE);
  assert.equal(binding.graphLatency(), 0);
  assert.equal(binding.graphSnapshot(), null);
  assert.equal(binding.graphDiagnostic(), null);
  assert.equal(binding.createInstance('VolumePlugin'), 11);
  binding.close();
});

test('binding adopts every arena slab and resolves only arena-backed views', () => {
  const fake = createFakeInstance();
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(96000, 2, 4, 32);

  const arena = binding.getArenaViews();
  assert.equal(arena.combined.length, 8);
  assert.equal(arena.buses.size, 5);
  assert.equal(arena.buses.get(4).byteOffset, 20480);
  assert.equal(arena.scratch.allChannels.byteOffset, 24576);
  assert.equal(arena.scratch.mono.byteOffset, 36864);
  assert.equal(arena.scratch.stereo.length, 8);
  assert.equal(arena.scratch.mono.length, 4);
  assert.equal(arena.offsets.buses.get(2), 12288);
  assert.equal(binding.pointerForArenaView(arena.combined.subarray(2, 6)), 4104);
  assert.equal(binding.pointerForArenaView(new Float32Array(4)), null);
  assert.equal(binding.arenaCombinedPtr(), 4096);
  assert.equal(binding.arenaBusPtr(3), 16384);
  assert.equal(binding.arenaScratchPtr(2), 32768);
  assert.equal(binding.scratchPtr(), 45056);
});

test('binding reads telemetry and stages pipeline descriptors without temporary allocations', () => {
  const fake = createFakeInstance();
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(48000, 2, 128, 64);

  const packet = new Uint8Array(16);
  assert.equal(binding.telemetryRead(packet), 4);
  assert.deepEqual([...packet.subarray(0, 4)], [10, 20, 30, 40]);
  assert.equal(binding.lastTelemetryDroppedFrames, 2);
  assert.equal(binding.telemetryRead(new ArrayBuffer(0)), 0);

  const emptyFake = createFakeInstance({ telemetryBytes: new Uint8Array(0) });
  const emptyBinding = new DspEngineBinding(emptyFake.instance);
  emptyBinding.createEngine();
  emptyBinding.prepare(48000, 2, 128, 64);
  let stagingViewCalls = 0;
  emptyBinding.u8 = {
    subarray() {
      stagingViewCalls++;
      return new Uint8Array(0);
    }
  };
  assert.equal(emptyBinding.telemetryRead(new Uint8Array(16)), 0);
  assert.equal(stagingViewCalls, 0);

  assert.equal(binding.pipelineConfigure(Uint8Array.of(1, 2, 3)), 0);
  assert.equal(binding.pipelineRefreshLatency(), 0);
  assert.equal(binding.pipelineLatency(), 384);
  assert.equal(binding.pipelineProcess(2, 128, 4.25, true), 0);
  assert.ok(fake.calls.some(call => call[0] === 'pipelineConfigure' && String(call[2]) === '1,2,3'));
  assert.ok(fake.calls.some(call => call[0] === 'pipelineLatency' && call[1] === 7));
  assert.ok(fake.calls.some(call => call[0] === 'pipelineProcess' && call.at(-1) === 1));
  assert.equal(fake.calls.some(call => call[0] === 'malloc'), false);
  assert.equal(fake.calls.some(call => call[0] === 'free'), false);
});

test('binding rejects unsafe staging sizes and invalid native return values', () => {
  const failedEngine = createFakeInstance({ engineHandle: 0 });
  assert.throws(() => new DspEngineBinding(failedEngine.instance).createEngine(), /creation failed/);

  const oversizedDescriptor = createFakeInstance();
  const descriptorBinding = new DspEngineBinding(oversizedDescriptor.instance);
  descriptorBinding.createEngine();
  descriptorBinding.prepare(48000, 2, 128, 64);
  assert.throws(
    () => descriptorBinding.pipelineConfigure(new Uint8Array(4097)),
    /scratch-buffer capacity/
  );

  const badTelemetry = createFakeInstance({ badTelemetryCount: 100 });
  const telemetryBinding = new DspEngineBinding(badTelemetry.instance);
  telemetryBinding.createEngine();
  telemetryBinding.prepare(48000, 2, 128, 64);
  assert.throws(() => telemetryBinding.telemetryRead(new Uint8Array(8)), /invalid byte count/);
  assert.throws(() => telemetryBinding.telemetryRead({}), TypeError);
  assert.throws(
    () => telemetryBinding.instanceSetParams(1, new Float32Array(1025), 0),
    /scratch-buffer capacity/
  );
  assert.throws(
    () => telemetryBinding.instanceSetParamBytes(1, new Uint8Array(4097), 0),
    /scratch-buffer capacity/
  );

  const badName = createFakeInstance({ badKernelLength: 4096 });
  const nameBinding = new DspEngineBinding(badName.instance);
  nameBinding.createEngine();
  assert.throws(() => nameBinding.getKernelName(0), /Invalid kernel name length/);

  const failedPrepare = createFakeInstance({ prepareStatus: -1 });
  const prepareBinding = new DspEngineBinding(failedPrepare.instance);
  prepareBinding.createEngine();
  assert.equal(prepareBinding.prepare(48000, 2, 128, 64), -1);
  assert.equal(prepareBinding.live, false);
  assert.throws(() => prepareBinding.getArenaViews(), /must be prepared/);
});

test('engine creation permits memory growth and refreshes views even on failure', () => {
  for (const engineHandle of [7, 0]) {
    let binding;
    const fake = createFakeInstance({
      engineHandle,
      growDuringCreate: true,
      onEngineCreate: () => binding.handleMemoryGrowthNotification()
    });
    binding = new DspEngineBinding(fake.instance);
    if (engineHandle) {
      assert.equal(binding.createEngine(), engineHandle);
      assert.equal(binding.prepare(48000, 2, 128, 64), 0);
      assert.equal(binding.live, true);
    } else {
      assert.throws(() => binding.createEngine(), /creation failed/);
    }
    assert.equal(binding.u8.buffer, fake.memory.buffer);
    assert.equal(binding.memoryGrowthViolation, false);
    fake.memory.grow(1);
    assert.equal(binding.checkMemoryBuffer(), true);
    assert.equal(binding.memoryGrowthViolation, true);
  }
});

test('binding distinguishes preparation growth from unexpected audio-time growth', () => {
  const expected = createFakeInstance({ growDuringPrepare: true });
  const expectedBinding = new DspEngineBinding(expected.instance);
  expectedBinding.createEngine();
  expectedBinding.prepare(48000, 2, 128, 64);
  assert.equal(expectedBinding.memoryGrowthViolation, false);

  const warnings = [];
  let growthCallbacks = 0;
  const unexpected = createFakeInstance();
  const binding = new DspEngineBinding(unexpected.instance, {
    warning: message => warnings.push(message),
    onUnexpectedMemoryGrowth: () => growthCallbacks++
  });
  unexpected.memory.grow(1);
  assert.equal(binding.checkMemoryBuffer(), true);
  assert.equal(binding.checkMemoryBuffer(), false);
  assert.equal(binding.memoryGrowthViolation, true);
  assert.equal(growthCallbacks, 1);
  assert.equal(warnings.length, 1);
});

test('binding permits asset preparation memory growth during begin and CONTROL commit', () => {
  const beginGrowth = createFakeInstance({ growDuringAssetBegin: true });
  const beginBinding = new DspEngineBinding(beginGrowth.instance);
  beginBinding.createEngine();
  beginBinding.prepare(48000, 2, 128, 64);
  const payload = new Uint8Array(64);
  const header = new DataView(payload.buffer);
  header.setUint32(0, 0x31415445, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, 4, true);
  header.setUint32(12, 48000, true);
  header.setUint32(16, 2, true);
  assert.equal(beginBinding.instanceSetAsset(11, 0, payload, {
    headBlock: 128, rateDivider: 1
  }), 0);
  assert.equal(beginBinding.memoryGrowthViolation, false);

  const commitGrowth = createFakeInstance({ growDuringAssetCommit: true });
  const commitBinding = new DspEngineBinding(commitGrowth.instance);
  commitBinding.createEngine();
  commitBinding.prepare(48000, 2, 128, 64);
  assert.equal(commitBinding.instanceSetAsset(11, 0, payload, {
    headBlock: 128, rateDivider: 1
  }), 0);
  assert.equal(commitBinding.checkMemoryBuffer(), false);
  assert.equal(commitBinding.memoryGrowthViolation, false);
  assert.equal(commitBinding.getArenaViews().buffer, commitGrowth.memory.buffer);

  const failed = createFakeInstance({ growDuringAssetCommit: true, assetCommitThrows: true });
  const failedBinding = new DspEngineBinding(failed.instance);
  failedBinding.createEngine(); failedBinding.prepare(48000, 2, 128, 64);
  assert.throws(() => failedBinding.instanceAssetCommit(11, 0, 64, 1), /commit failed/);
  assert.equal(failedBinding.getArenaViews().buffer, failed.memory.buffer);
  assert.equal(failedBinding.memoryGrowthViolation, false);
  failed.memory.grow(1);
  assert.equal(failedBinding.checkMemoryBuffer(), true, 'the CONTROL guard is restored after a failed commit');
});

test('pipeline configuration after asset growth reuses scratch memory without growing the heap', () => {
  const fake = createFakeInstance({ growDuringAssetBegin: true, growDuringMalloc: true });
  const warnings = [];
  const binding = new DspEngineBinding(fake.instance, {
    warning: message => warnings.push(message)
  });
  binding.createEngine();
  binding.prepare(48000, 2, 128, 64);

  const payload = new Uint8Array(64);
  const header = new DataView(payload.buffer);
  header.setUint32(0, 0x31415445, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, 4, true);
  header.setUint32(12, 48000, true);
  header.setUint32(16, 2, true);
  assert.equal(binding.instanceSetAsset(11, 0, payload, {
    headBlock: 128, rateDivider: 1
  }), 0);
  const memoryAfterAsset = fake.memory.buffer;

  assert.equal(binding.pipelineConfigure(Uint8Array.of(1, 2, 3)), 0);
  assert.equal(fake.memory.buffer, memoryAfterAsset);
  assert.equal(binding.memoryGrowthViolation, false);
  assert.deepEqual(warnings, []);
  assert.equal(fake.calls.some(call => call[0] === 'malloc'), false);
});

test('pipeline configuration permits memory growth and refreshes arena views', () => {
  const fake = createFakeInstance({ growDuringPipelineConfigure: true });
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(48000, 2, 128, 64);
  const previousBuffer = fake.memory.buffer;

  assert.equal(binding.pipelineConfigure(Uint8Array.of(1, 2, 3)), 0);
  assert.notEqual(fake.memory.buffer, previousBuffer);
  assert.equal(binding.memoryGrowthViolation, false);
  assert.equal(binding.getArenaViews().combined.buffer, fake.memory.buffer);
});

test('pipeline latency refresh permits memory growth and refreshes arena views', () => {
  const fake = createFakeInstance({ growDuringPipelineRefresh: true });
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(48000, 2, 128, 64);
  const previousBuffer = fake.memory.buffer;

  assert.equal(binding.pipelineRefreshLatency(), 0);
  assert.notEqual(fake.memory.buffer, previousBuffer);
  assert.equal(binding.memoryGrowthViolation, false);
  assert.equal(binding.getArenaViews().combined.buffer, fake.memory.buffer);
});

test('latency reservation permits growth while realtime refresh keeps memory fixed', () => {
  const fake = createFakeInstance({ growDuringPipelineReserve: true });
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine();
  binding.prepare(48000, 2, 128, 64);
  const beforeReservation = fake.memory.buffer;
  assert.equal(binding.pipelineReserveLatency(), 0);
  assert.notEqual(fake.memory.buffer, beforeReservation);
  assert.equal(binding.memoryGrowthViolation, false);
  const reserved = fake.memory.buffer;
  assert.equal(binding.pipelineRefreshLatencyRealtime(), 0);
  assert.equal(fake.memory.buffer, reserved);
  assert.equal(binding.memoryGrowthViolation, false);

  const faulty = createFakeInstance({ growDuringPipelineRealtimeRefresh: true });
  const faultyBinding = new DspEngineBinding(faulty.instance, { warning: () => {} });
  faultyBinding.createEngine();
  faultyBinding.prepare(48000, 2, 128, 64);
  faultyBinding.pipelineRefreshLatencyRealtime();
  assert.equal(faultyBinding.memoryGrowthViolation, true);
});

test('WASI imports report debug writes and surface proc_exit without host dependencies', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const bytes = new TextEncoder().encode('diagnostic');
  new Uint8Array(memory.buffer, 128, bytes.length).set(bytes);
  const data = new DataView(memory.buffer);
  data.setUint32(64, 128, true);
  data.setUint32(68, bytes.length, true);
  const messages = [];
  let growthCalls = 0;
  const imports = createDspImports({
    getMemory: () => memory,
    debug: true,
    debugWrite: message => messages.push(message),
    onMemoryGrowth: () => growthCalls++
  });

  assert.equal(imports.wasi_snapshot_preview1.fd_write(2, 64, 1, 80), 0);
  assert.equal(data.getUint32(80, true), bytes.length);
  assert.deepEqual(messages, ['diagnostic']);
  assert.equal(imports.wasi_snapshot_preview1.fd_close(), 0);
  assert.equal(imports.wasi_snapshot_preview1.fd_seek(), 0);
  assert.throws(() => imports.wasi_snapshot_preview1.proc_exit(4), DspBindingError);
  imports.env.emscripten_notify_memory_growth();
  assert.equal(growthCalls, 1);

  const memoryless = createDspImports({ getMemory: () => null });
  assert.equal(memoryless.wasi_snapshot_preview1.fd_write(2, 0, 1, 0), 0);
});

test('WASI realtime profiling clock writes exact little-endian nanoseconds and rejects unsupported clocks or pointers', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const clock = createDspImports({ getMemory: () => memory }).wasi_snapshot_preview1.clock_time_get;
  const before = BigInt(Date.now()) * 1000000n;
  assert.equal(clock(0, 1n, 8), 0);
  const after = BigInt(Date.now()) * 1000000n;
  const actual = new DataView(memory.buffer).getBigUint64(8, true);
  assert.ok(actual >= before && actual <= after);
  assert.equal(actual % 1000000n, 0n);
  assert.equal(clock(1, 1n, 8), 28);
  assert.equal(clock(0, 1n, memory.buffer.byteLength - 7), 21);
  assert.equal(clock(0, 1n, -1), 21);
  assert.equal(createDspImports().wasi_snapshot_preview1.clock_time_get(0, 1n, 0), 21);
});

test('instantiateDspBinding supplies imports and returns a validated binding', async () => {
  const fake = createFakeInstance();
  let receivedImports = null;
  const webAssembly = {
    async instantiate(_module, imports) {
      receivedImports = imports;
      imports.env.emscripten_notify_memory_growth();
      return { instance: fake.instance };
    }
  };
  const binding = await instantiateDspBinding({ fake: true }, { webAssembly });
  assert.ok(receivedImports.wasi_snapshot_preview1.fd_write);
  assert.equal(binding.getAbiVersion(), 1);

  await assert.rejects(
    instantiateDspBinding(new ArrayBuffer(0), { webAssembly: null }),
    /WebAssembly\.instantiate is unavailable/
  );
});


test('offline Graph binding preserves 64-bit tokens, NEED_SAMPLE and grown preparation memory', () => {
  const fake = createFakeInstance();
  const exports = fake.instance.exports;
  exports.et_graph_capabilities = () => 1;
  for (const name of ['configure', 'latency', 'process', 'snapshot_size', 'snapshot_copy',
    'read_diagnostic', 'set_instance_params', 'reset']) exports[`et_graph_${name}`] = () => 0;
  exports.et_graph_configure_offline = (_engine, ptr, size) => {
    assert.deepEqual([...new Uint8Array(exports.memory.buffer, ptr, size)], [1, 2, 3]);
    exports.memory.grow(1);
    return 0;
  };
  exports.et_graph_prepare_offline = (_engine, low, high) => {
    exports.memory.grow(1);
    new DataView(exports.memory.buffer).setUint32(low, 0xfedcba98, true);
    new DataView(exports.memory.buffer).setUint32(high, 0x87654321, true);
    return 0;
  };
  exports.et_graph_process_offline = (...args) => {
    assert.deepEqual(args.slice(1), [2, 127, 0.25, 0xfedcba98, 0x87654321]);
    return 1;
  };
  const binding = new DspEngineBinding(fake.instance);
  binding.createEngine(); binding.prepare(48000, 2, 128, 64);
  assert.equal(binding.hasOfflineGraph(), true);
  assert.equal(binding.graphConfigureOffline(Uint8Array.of(1, 2, 3)), 0);
  const generation = binding.graphPrepareOffline();
  assert.deepEqual(generation, { low: 0xfedcba98, high: 0x87654321 });
  assert.equal(binding.graphProcessOffline(2, 127, 0.25, generation), 1);
  assert.equal(binding.getArenaViews().combined.buffer, exports.memory.buffer);
  binding.close();
});
