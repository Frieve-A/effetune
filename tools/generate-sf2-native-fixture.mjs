import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSf2Fixture } from '../tests/helpers/sf2-fixture.mjs';
import { openSf2Source } from '../js/sf2/source.js';
import { sf2SamplerRegions } from '../js/sf2/asset.js';
import { packStreamedSfzAsset } from '../js/sfz/asset.js';

export async function createSf2NativeFixture({ frames = 64, forecast = null } = {}) {
  const bytes = createSf2Fixture({ keyRange: [0, 127], sampleFrames: frames,
    loopStart: forecast === 'paused' ? 8192 : forecast ? 64 : 8,
    loopEnd: forecast === 'paused' ? 12288 : forecast ? 256 : frames - 8, sampleRate: 48000,
    pcm16: Array(frames).fill(8192), presets: [
      { name: 'Base', bank: 0, program: 0, attenuation: 0 },
      { name: 'Quiet', bank: 0, program: 1, attenuation: 200 },
      { name: 'Other bank', bank: 1, program: 2, attenuation: 100 },
      { name: 'Drums', bank: 128, program: 0, attenuation: 400 }
    ], modulators: forecast ? (forecast === 'resetCc' ? [{ source: 0x81, destination: 51, amount: -12 }] : []) : [
      { source: 0, destination: 15, amount: 600 },
      { source: 0, destination: 16, amount: 500 }
    ] });
  const source = await openSf2Source({ size: bytes.length,
    async readRange(offset, length) { return bytes.subarray(offset, offset + length); } });
  if (forecast) for (const region of source.compiled.regions) {
    region.generators[54] = forecast === 'release' ? 3 : forecast === 'paused' ? 1 : 0;
    region.generators[38] = 0; // One second, so the source tail remains audible past page0.
  }
  if (forecast === 'prefix') {
    // Fifteen melodic channels exceed the 4096-source limit unless identical
    // selected-preset prefixes share their geometry. Keep the other presets.
    const base = source.compiled.regions[0];
    assert.equal(source.compiled.presets[0].regionCount, 1);
    source.compiled.regions = [
      ...Array.from({ length: 274 }, () => ({ ...base, keyRange: [127, 127] })),
      ...source.compiled.regions.slice(1)
    ];
    source.compiled.presets = source.compiled.presets.map((preset, index) =>
      index ? { ...preset, firstRegion: preset.firstRegion + 273 }
        : { ...preset, regionCount: 274 });
  }
  const samples = new Map(source.samples.map(sample => [sample.path,
    { frames: sample.frames, channels: 1, sampleRate: sample.sampleRate, revision: 'a'.repeat(64) }]));
  return packStreamedSfzAsset(sf2SamplerRegions(source), samples, { cacheSlots: forecast === 'paused' || forecast === 'prefix' ? 4 : forecast ? 16 : 8,
    sourceProfile: source.compiled.sourceProfile, presets: source.compiled.presets,
    modulation: source.compiled });
}

export async function updateSf2NativeFixture({ check = false } = {}) {
  const descriptor = await createSf2NativeFixture();
  const hostDescriptor = await createSf2NativeFixture({ frames: 8192 });
  const forecasts = await Promise.all(['release', 'reset', 'resetCc', 'paused', 'prefix'].map(forecast =>
    createSf2NativeFixture({ frames: forecast === 'paused' || forecast === 'prefix' ? 65536 : 16384, forecast })));
  const forecastNames = ['Release', 'Reset', 'ResetCc', 'Paused', 'Prefix'];
  const bytes = new Uint8Array(descriptor.payload);
  const filename = fileURLToPath(new URL('../dsp/plugins/others/soundfont_player/sf2_fixture.h', import.meta.url));
  if (check) {
    const source = fs.readFileSync(filename, 'utf8');
    const match = /kSf2NativeFixture\s*\{([\s\S]*?)\};/.exec(source);
    assert.ok(match);
    assert.deepEqual(Uint8Array.from(match[1].split(',').map(value => value.trim()).filter(Boolean).map(Number)), bytes);
    assert.ok(source.includes(`kSf2NativeFootprint = ${descriptor.footprintBytes}u`));
    const hostMatch = /kSf2HostFixture\s*\{([\s\S]*?)\};/.exec(source);
    assert.ok(hostMatch);
    assert.deepEqual(Uint8Array.from(hostMatch[1].split(',').map(value => value.trim()).filter(Boolean).map(Number)), new Uint8Array(hostDescriptor.payload));
    assert.ok(source.includes(`kSf2HostFootprint = ${hostDescriptor.footprintBytes}u`));
    for (let i = 0; i < forecasts.length; ++i) {
      const match = new RegExp(`kSf2Forecast${forecastNames[i]}Fixture\\s*\\{([\\s\\S]*?)\\};`).exec(source);
      assert.ok(match);
      assert.deepEqual(Uint8Array.from(match[1].split(',').map(value => value.trim()).filter(Boolean).map(Number)), new Uint8Array(forecasts[i].payload));
    }
    return;
  }
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 24) lines.push(`  ${[...bytes.subarray(offset, offset + 24)].join(', ')},`);
  const hostBytes = new Uint8Array(hostDescriptor.payload), hostLines = [];
  for (let offset = 0; offset < hostBytes.length; offset += 24) hostLines.push(`  ${[...hostBytes.subarray(offset, offset + 24)].join(', ')},`);
  const forecastDeclarations = forecasts.map((asset, index) => {
    const bytes = new Uint8Array(asset.payload), lines = [];
    for (let offset = 0; offset < bytes.length; offset += 24) lines.push(`  ${[...bytes.subarray(offset, offset + 24)].join(', ')},`);
    return `inline constexpr std::array<std::uint8_t, ${bytes.length}> kSf2Forecast${forecastNames[index]}Fixture{\n${lines.join('\n')}\n};`;
  });
  fs.writeFileSync(filename, `#ifndef EFFETUNE_SF2_NATIVE_FIXTURE_H
#define EFFETUNE_SF2_NATIVE_FIXTURE_H
#include <array>
#include <cstdint>
// Generated from the independently authored SF2 fixture by tools/generate-sf2-native-fixture.mjs.
inline constexpr std::uint32_t kSf2NativeFootprint = ${descriptor.footprintBytes}u;
inline constexpr std::array<std::uint8_t, ${bytes.length}> kSf2NativeFixture{
${lines.join('\n')}
};
inline constexpr std::uint32_t kSf2HostFootprint = ${hostDescriptor.footprintBytes}u;
inline constexpr std::array<std::uint8_t, ${hostBytes.length}> kSf2HostFixture{
${hostLines.join('\n')}
};
${forecastDeclarations.join('\n')}
#endif
`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await updateSf2NativeFixture({ check: process.argv.includes('--check') });
}
