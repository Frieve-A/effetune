import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseSfz } from '../js/sfz/parser.js';
import { packSfzModulation, sfzModulationFootprint } from '../js/sfz/modulation.js';
const source = `<control> set_hdcc90=.333 note_offset=-3 sw_note_offset=12
<region> sample=*sine oscillator_multi=3 oscillator_table_size=16777217
 delay_samples=4294967296 delay_samples_oncc1=-16777217 offset_random=4294967296 count=4294967296
 offset_oncc2=4294967296 note_selfmask=off rt_decay2=20 rt_decay1=-10 rt_decay1_time=.5
 dsp_order=1 noise_level=-20 reverse_locc64=10 amp_veltrack=50 amp_velcurve_64=.25 xfin_locc1=10 xfin_hicc1=100
 sample_quality=10 position_keycenter=48 position_keytrack=2 position_veltrack=-20 position_random=50
 lohdcc2=.25 on_lohdcc3=.5 stop_locc4=64 lobpm=80 lotimer=.1 eq1_type=lshelf
<region> key=-1 end=-1 sample=plain.wav eg1_time0=.1 eg2_time0=.2 eg3_time0=.3 lfo1_freq=1 lfo2_freq=2 lfo3_freq=3`;
export async function generateSfzPreparationFixture({ check = false } = {}) {
  const parsed = await parseSfz({ selectedPath: 'fixture.sfz', readText: async () => source, onDiagnostic: null });
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  const bytes = packSfzModulation(parsed.modulation), words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const lines = [];
  for (let index = 0; index < words.length; index += 12) lines.push('  ' + [...words.subarray(index, index + 12)].map(value => value + 'u').join(', ') + ',');
  let output = '#pragma once\n#include <array>\n#include <cstdint>\n// Generated from normal SFZ parsing by tools/generate-sfz-preparation-fixture.mjs.\n// clang-format off\n' +
    `inline constexpr std::uint32_t kPreparationRegions = ${parsed.regions.length}u;\n` +
    `inline constexpr std::uint64_t kPreparationBudget = ${sfzModulationFootprint(parsed.modulation)}u;\n` +
    `inline constexpr std::array<std::uint32_t, ${words.length}> kPreparationWords{\n${lines.join('\n')}\n};\n// clang-format on\n`;
  const variable = await parseSfz({ selectedPath: 'variable.sfz',
    readText: async () => '<region> sample=*sine var1_mod=mult var1_oncc1=1 var1_oncc2=.5 var2_oncc3=1 var1_oncc4=.25 var1_volume=12 var2_pan=20', onDiagnostic: null });
  assert.deepEqual(variable.modulation.diagnostics, []);
  const variableBytes = packSfzModulation(variable.modulation);
  const variableWords = new Uint32Array(variableBytes.buffer, variableBytes.byteOffset, variableBytes.byteLength / 4);
  output += `// clang-format off\ninline constexpr std::uint64_t kVariableBudget = ${sfzModulationFootprint(variable.modulation)}u;\n` +
    `inline constexpr std::array<std::uint32_t, ${variableWords.length}> kVariableWords{\n`;
  for (let at = 0; at < variableWords.length; at += 12) output += '  ' + [...variableWords.subarray(at, at + 12)].map(value => value + 'u').join(', ') + ',\n';
  output += '};\n// clang-format on\n';
  const destination = new URL('../dsp/plugins/others/sfz/preparation_fixture.h', import.meta.url);
  if (check) assert.equal((await fs.readFile(destination, 'utf8')).replaceAll('\r\n', '\n'), output);
  else await fs.writeFile(destination, output);
}
if (process.argv[1]?.endsWith('generate-sfz-preparation-fixture.mjs')) await generateSfzPreparationFixture({ check: process.argv.includes('--check') });
