import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { packBluetoothSBCSimulatorPluginParams } from '../../js/audio/dsp-params.generated.js';
import {
  inspectBuildConfiguration,
  parseCppParamHeader,
  parseWasmMemory,
  projectSchema
} from '../../tools/dsp-parity/bluetooth-sbc-production-equivalence.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('SBC production schema and generated header preserve the accepted ABI order', async () => {
  const [schema, header] = await Promise.all([
    fs.readFile(path.join(
      repoRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'params.json'
    ), 'utf8').then(JSON.parse),
    fs.readFile(path.join(
      repoRoot, 'dsp', 'generated', 'cpp', 'BluetoothSBCSimulatorPluginParams.h'
    ), 'utf8')
  ]);

  assert.deepEqual(projectSchema(schema).layout.map(field => field.key), [
    'bp', 'cm', 'bl', 'og', 'mx', 'pl'
  ]);
  assert.deepEqual(parseCppParamHeader(header), {
    members: ['bitpool', 'channelMode', 'blocks', 'outputGain', 'mix', 'packetLoss'],
    hash: 0xa0d7750b,
    count: 6
  });
  assert.deepEqual([...packBluetoothSBCSimulatorPluginParams({
    bp: 53, cm: 'Joint Stereo', bl: '4', og: 0, mx: 100
  })], [53, 0, 0, 0, 100, 0]);
  assert.deepEqual([...packBluetoothSBCSimulatorPluginParams({
    bp: 53, cm: 'Stereo', bl: '4', og: 0, mx: 100, pl: 7.5
  })], [53, 1, 0, 0, 100, 7.5]);
  // Dual Channel was appended to the enum, so the two accepted indices above cannot shift.
  assert.deepEqual([...packBluetoothSBCSimulatorPluginParams({
    bp: 38, cm: 'Dual Channel', bl: '4', og: 0, mx: 100
  })], [38, 2, 0, 0, 100, 0]);
});

test('SBC equivalence parser reads the fixed WebAssembly memory contract', () => {
  const bytes = Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x05, 0x06, 0x01, 0x01, 0x80, 0x01, 0x80, 0x20
  ]);
  assert.deepEqual(parseWasmMemory(bytes), {
    initialPages: 128,
    maximumPages: 4096,
    shared: false
  });
});

test('SBC equivalence parser distinguishes baseline and SIMD Release flags', () => {
  const cache = [
    'CMAKE_BUILD_TYPE:STRING=Release',
    'BUILD_TESTING:BOOL=OFF',
    'ET_DEBUG_STATE:BOOL=OFF'
  ].join('\n');
  const common = [
    '-std=c++20 -O3 -flto -fwasm-exceptions -fno-rtti',
    '-sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=8388608 -sMAXIMUM_MEMORY=268435456',
    '-sEXPORTED_FUNCTIONS=@dsp/exports.txt'
  ].join(' ');

  const baseline = inspectBuildConfiguration(cache, common, { simd: false });
  const simd = inspectBuildConfiguration(cache, `${common} -msimd128`, { simd: true });
  assert.equal(baseline.simdFlagPresent, false);
  assert.equal(baseline.buildTesting, 'OFF');
  assert.equal(baseline.debugState, 'OFF');
  assert.equal(simd.simdFlagPresent, true);
});
