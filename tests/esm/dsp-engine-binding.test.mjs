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
    { name: 'VolumePlugin', hash: 0x12345678, byteCapacity: 0 },
    { name: 'LevelMeterPlugin', hash: 0x9abcdef0, byteCapacity: 0 }
  ];
  let nextAllocation = 60000;
  const scratchPtr = 45056;
  const exports = {
    memory,
    malloc(size) {
      calls.push(['malloc', size]);
      if (options.mallocFails) return 0;
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
    et_engine_memory_required(...args) {
      calls.push(['memoryRequired', ...args]);
      return 123456;
    },
    et_engine_create() {
      calls.push(['engineCreate']);
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
    et_instance_latency(...args) {
      calls.push(['instanceLatency', ...args]);
      return 32;
    },
    et_instance_set_tap(...args) {
      calls.push(['instanceSetTap', ...args]);
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
    et_instance_process(...args) {
      calls.push(['instanceProcess', ...args]);
      return options.processStatus ?? 0;
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
      return options.pipelineStatus ?? 0;
    },
    et_pipeline_process(...args) {
      calls.push(['pipelineProcess', ...args]);
      return 0;
    }
  };
  return { instance: { exports }, exports, memory, calls };
}

test('binding rejects missing ABI exports and invalid instances', () => {
  assert.throws(() => new DspEngineBinding(null), /exports are unavailable/);
  assert.throws(() => new DspEngineBinding({ exports: {} }), /Missing WASM export: memory/);

  const fake = createFakeInstance();
  delete fake.exports.et_engine_reset;
  assert.throws(() => new DspEngineBinding(fake.instance), /et_engine_reset/);
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_pipeline_process'));
  assert.ok(REQUIRED_FUNCTION_EXPORTS.includes('et_instance_set_param_bytes'));
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
      { name: 'VolumePlugin', hash: 0x12345678, byteCapacity: 0, kernelIndex: 0 },
      { name: 'LevelMeterPlugin', hash: 0x9abcdef0, byteCapacity: 0, kernelIndex: 1 }
    ]
  });
  assert.equal(binding.engine, 0);
  assert.equal(binding.createEngine(), 7);
  assert.throws(() => binding.createEngine(), /already exists/);
  assert.equal(binding.getKernelName(0), 'VolumePlugin');
  assert.equal(binding.getKernelParamsHash(1), 0x9abcdef0);
  assert.equal(binding.getKernelParamBytesCapacity(1), 0);
  assert.throws(() => binding.getKernelName(2), RangeError);
  assert.throws(() => binding.getKernelParamsHash(-1), RangeError);
  assert.throws(() => binding.getKernelParamBytesCapacity(2), RangeError);

  assert.equal(binding.prepare(48000, 2, 4, 64), 0);
  assert.equal(binding.live, true);
  assert.equal(binding.createInstance('VolumePlugin'), 11);
  assert.equal(binding.resetInstance(11), 0);
  assert.equal(binding.instanceLatency(11), 32);
  assert.equal(binding.instanceSetTap(11, 99), 0);
  assert.equal(binding.instanceSetSeed(11, 0x89abcdef, 0x01234567), 0);
  assert.equal(binding.setTelemetryRate(30), 0);
  assert.equal(binding.instanceSetParams(11, [0.25, 0.5], 0xfeedbeef, 3), 0);
  assert.equal(binding.instanceSetParamBytes(11, Uint8Array.of(1, 0, 0, 0), 0xfeedbeef), 0);
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
  assert.equal(binding.instanceSetParamBytes(1, new Uint8Array(0), 0), ET_ERR_STATE);
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

test('binding reads telemetry and stages pipeline descriptors without leaking allocations', () => {
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
  assert.equal(binding.pipelineProcess(2, 128, 4.25, true), 0);
  assert.ok(fake.calls.some(call => call[0] === 'pipelineConfigure' && String(call[2]) === '1,2,3'));
  assert.ok(fake.calls.some(call => call[0] === 'pipelineProcess' && call.at(-1) === 1));
  assert.ok(fake.calls.filter(call => call[0] === 'free').length >= 1);
});

test('binding rejects unsafe staging sizes and invalid native return values', () => {
  const failedEngine = createFakeInstance({ engineHandle: 0 });
  assert.throws(() => new DspEngineBinding(failedEngine.instance).createEngine(), /creation failed/);

  const failedMalloc = createFakeInstance({ mallocFails: true });
  const mallocBinding = new DspEngineBinding(failedMalloc.instance);
  mallocBinding.createEngine();
  mallocBinding.prepare(48000, 2, 128, 64);
  assert.throws(() => mallocBinding.pipelineConfigure(Uint8Array.of(1)), /descriptor staging/);

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
