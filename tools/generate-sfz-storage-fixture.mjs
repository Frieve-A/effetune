import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseSfz } from '../js/sfz/parser.js';
import { packStreamedSfzAsset } from '../js/sfz/asset.js';
import { sfzResidentRanges, sfzStorageSlots, sfzStorageVariants } from '../js/sfz/storage-plan.js';
const declarations = [];
for (const mode of [0, 1]) {
  const parsed = await parseSfz({ selectedPath: 'storage.sfz', readText: async () =>
    `<region> sample=storage.wav key=60 amp_veltrack=0 loop_mode=loop_continuous loop_start=8192 loop_end=12287 offset=4096 end=12287 load_mode=${mode} load_start=0 load_end=4095`, onDiagnostic: null });
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  const variants = sfzStorageVariants(parsed);
  const samples = new Map(variants.paths.map(path => [path, { frames: 16384, channels: 2, sampleRate: 48000,
    revision: 'a'.repeat(64), storageMode: variants.modes.get(path) }]));
  const ranges = sfzResidentRanges(variants.parsed.regions, samples);
  const asset = packStreamedSfzAsset(variants.parsed.regions, samples, { cacheSlots: 8,
    storagePlan: sfzStorageSlots(8, samples, ranges), modulation: parsed.modulation, effects: parsed.effects });
  const bytes = new Uint8Array(asset.payload), lines = [];
  for (let i = 0; i < bytes.length; i += 24) lines.push('  ' + [...bytes.subarray(i, i + 24)].join(', ') + ',');
  declarations.push(`inline constexpr unsigned kStorage${mode}BaseFootprint = ${asset.payload.byteLength}u;\ninline constexpr std::array<std::uint8_t, ${bytes.length}> kStorage${mode}Payload{\n${lines.join('\n')}\n};`);
}
for (const [order, impulse] of [['First', 'a-impulse.wav'], ['Last', 'z-impulse.wav']]) {
  const parsed = await parseSfz({ selectedPath: 'ir-order.sfz', readText: async () =>
    `<region> sample=constant.wav key=60 amp_veltrack=0 <effect> type=tdfir tdfir_impulse=${impulse} tdfir_dry=0`, hasSample: () => true, onDiagnostic: null });
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  const variants = sfzStorageVariants(parsed);
  const samples = new Map(variants.paths.map(path => [path, { frames: path === impulse ? 441 : 16384, channels: 1,
    sampleRate: path === impulse ? 44100 : 48000, revision: 'a'.repeat(64), storageMode: variants.modes.get(path) }]));
  const ranges = sfzResidentRanges(variants.parsed.regions, samples, variants.mandatory);
  const asset = packStreamedSfzAsset(variants.parsed.regions, samples, { cacheSlots: 8,
    storagePlan: sfzStorageSlots(8, samples, ranges), modulation: parsed.modulation, effects: parsed.effects });
  const bytes = new Uint8Array(asset.payload), lines = [];
  for (let i = 0; i < bytes.length; i += 24) lines.push('  ' + [...bytes.subarray(i, i + 24)].join(', ') + ',');
  declarations.push(`inline constexpr unsigned kStorageIr${order}Id = ${variants.paths.indexOf(impulse)}u;\ninline constexpr std::array<std::uint8_t, ${bytes.length}> kStorageIr${order}Payload{\n${lines.join('\n')}\n};`);
}
await fs.writeFile(new URL('../dsp/plugins/others/soundfont_player/storage_fixture.h', import.meta.url),
  '#pragma once\n#include <array>\n#include <cstdint>\n// Generated through the canonical parser and streamed packer.\n// clang-format off\n' + declarations.join('\n') + '\n// clang-format on\n');
