import test from 'node:test';
import assert from 'node:assert/strict';
import { DspEngineBinding } from '../../js/audio/dsp-engine-binding.js';

test('CONTROL cost binding stages only metadata, preserves u64 bytes and frees its storage on native success and rejection', () => {
  const memory = new WebAssembly.Memory({ initial: 1 }), freed = [], calls = [], allocations = [];
  let status = 0;
  const binding = Object.assign(Object.create(DspEngineBinding.prototype), { engine: 0, prepared: false,
    _preparing: false, _memoryBuffer: null, memory, exports: { malloc: size => { allocations.push(size); return 64; },
      free: pointer => freed.push(pointer), et_sample_player_preparation_bytes(...args) {
        calls.push(args); const result = new DataView(memory.buffer, args[8], 8);
        result.setUint32(0, 5, true); result.setUint32(4, 1, true); return status;
      } } });
  const payload = Uint8Array.of(1, 2, 3, 4).buffer;
  const context = { processingChannels: 4, sampleRate: 96000, maxFrames: 256, minimumPhysicalBpm: 15, playerKind: 1 };
  assert.equal(binding.estimateSfzEffectPreparation(payload, context, 1, 1024 * 1024), 0x100000005);
  assert.deepEqual(calls[0], [64, 4, 1024 * 1024, 1, 96000, 4, 256, 15, 72, 1]);
  assert.equal(binding.estimateSfzEffectPreparation(payload, { ...context, playerKind: 0 }), 0x100000005);
  assert.equal(calls[1].at(-1), 0);
  assert.deepEqual(allocations, [16, 16], 'Only aligned control metadata plus8 result bytes are allocated');
  assert.deepEqual([...new Uint8Array(memory.buffer, 64, 4)], [1, 2, 3, 4]);
  assert.throws(() => binding.estimateSfzEffectPreparation(payload, { ...context, playerKind: 2 }), /player kind/);
  assert.equal(calls.length, 2);
  status = -1;
  assert.throws(() => binding.estimateSfzEffectPreparation(payload, context), /geometry is invalid/);
  assert.deepEqual(freed, [64, 64, 64]); assert.equal(binding._preparing, false);
  binding.engine = 7;
  assert.throws(() => binding.estimateSfzEffectPreparation(payload, context), /separate CONTROL/);
});

test('asset context is an argument of its own begin transaction and never leaks into a legacy begin', () => {
  const memory = new WebAssembly.Memory({ initial: 1 }), calls = [];
  const binding = Object.assign(Object.create(DspEngineBinding.prototype), { engine: 7, prepared: true,
    _preparing: false, _memoryBuffer: null, memory, exports: {
      et_instance_asset_begin_ptr(...args) { calls.push(['context', ...args]); return 64; },
      et_instance_asset_begin_with_context() { assert.fail('The private compatibility bridge must not be required'); },
      et_instance_asset_begin(...args) { calls.push(['legacy', ...args]); return 64; }
    } });
  const info = { channels: 1, frames: 8, topology: 0, headBlock: 128, rateDivider: 1,
    processingChannels: 4, byteSize: 64, footprintBytes: 2048,
    preparationContext: { minimumPhysicalBpm: 15 } };
  assert.equal(binding.instanceAssetBegin(11, 0, info), 64);
  assert.deepEqual(calls[0], ['context', 7, 11, 0, 1, 8, 0, 128, 1, 0, 0, 4, 2048, 64, 15]);
  assert.equal(binding.instanceAssetBegin(12, 1, { ...info, preparationContext: null }), 64);
  assert.equal(calls[1][0], 'legacy'); assert.equal(calls[1].length, 14);
  assert.equal(binding.instanceAssetBegin(13, 0, { ...info, preparationContext: { minimumPhysicalBpm: 0 } }), 64);
  assert.equal(calls[2][0], 'context'); assert.equal(calls[2].at(-1), 0);
});

test('CONTROL IR publication refreshes memory views while growth is permitted', () => {
  const memory = new WebAssembly.Memory({ initial: 3 });
  const binding = Object.assign(Object.create(DspEngineBinding.prototype), { engine: 7, prepared: true,
    _preparing: false, _memoryBuffer: null, memory, _sfzStreamPtr: 64,
    hasSfzSampleStreaming: () => true, exports: { et_instance_stream_publish() { memory.grow(1); return 0; } } });
  assert.equal(binding.publishSfzSamplePage(11, { generation: 1, sample: 0, pageIndex: 0,
    frames: 1, channels: 1, pcm: Float32Array.of(1), resident: true }), 0);
  assert.equal(binding.u8.buffer, memory.buffer);
  assert.equal(binding._preparing, false);
  assert.notEqual(binding.memoryGrowthViolation, true);
});
