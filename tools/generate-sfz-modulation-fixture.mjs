import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSfz } from '../js/sfz/parser.js';
import { packSfzAsset, packStreamedSfzAsset } from '../js/sfz/asset.js';
import { prepareSfzOscillatorSources } from '../js/sfz/oscillator-source.js';

export const SFZ_MODULATION_FIXTURES = Object.freeze({
  Basic: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 volume=-6 ampeg_release=.01',
  Delayed: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_delay=.004 ampeg_attack=.002 ampeg_release=.01',
  Flexible: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 eg1_ampeg=1 eg1_sustain=1 eg1_level0=0 eg1_time1=.005 eg1_level1=1 eg1_time2=.01 eg1_level2=0',
  Lfo: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 lfo1_freq=20 lfo1_phase=.25 lfo1_volume=6 ampeg_release=.01',
  Controllers: '<curve> curve_index=7 v000=0 v064=.25 v127=1 <region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 volume_oncc1=-12 volume_curvecc1=7 volume_smoothcc1=10 ampeg_release=.01',
  Filters: '<region> sample=sine.wav key=60 loop_mode=loop_continuous amp_veltrack=0 fil_type=lpf_6p cutoff=1200 fil2_type=hpf_2p cutoff2=250 ampeg_release=.01',
  BendSource: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 bend_up=0 bend_down=0 volume_oncc128=12 ampeg_release=.01',
  OffsetSource: '<region> sample=constant.wav key=60 offset=16 loop_start=16 loop_mode=loop_continuous amp_veltrack=0 volume_oncc155=.1 ampeg_release=.01',
  Scope: '<global> global_volume=-6 global_amplitude=50 <master> master_volume=-3 master_amplitude=80 <group> group_volume=3 group_amplitude=50 <region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0',
  ScopePitch: '<global> global_tune=1200 <master> master_tune=300 <group> group_tune=-300 <region> sample=sine.wav key=60 loop_mode=loop_continuous amp_veltrack=0',
  Bend: '<region> sample=sine.wav key=60 loop_mode=loop_continuous amp_veltrack=0 bend_up=200 bend_down=-200 bend_stepup=100 bend_stepdown=50 bend_smooth=20',
  Initial: '<control> set_hdcc1=.5001 <region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 volume_oncc1=-20',
  KeyOffsets: '<control> note_offset=12 sw_note_offset=2 <region> sample=constant.wav key=60 sw_lokey=24 sw_hikey=25 sw_last=24 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.001',
  Oscillator: '<region> sample=sine.wav key=60 oscillator=on oscillator_quality=3 amp_veltrack=0 ampeg_release=.001',
  AAUpCached: '<region> sample=high.wav key=60 pitch_keycenter=72 loop_mode=loop_continuous',
  AAUpControlled: '<region> sample=high.wav key=60 tune=-1200 loop_mode=loop_continuous',
  AAUpOctavesCached: '<region> sample=high.wav key=60 pitch_keycenter=84 loop_mode=loop_continuous',
  AAUpOctavesControlled: '<region> sample=high.wav key=60 pitch_keycenter=72 tune=-1200 loop_mode=loop_continuous',
  AADownCached: '<region> sample=high.wav key=60 pitch_keycenter=48 loop_mode=loop_continuous',
  AADownControlled: '<region> sample=high.wav key=60 tune=1200 loop_mode=loop_continuous',
  EqStatic: '<region> sample=sine.wav key=60 loop_mode=loop_continuous amp_veltrack=0 eq1_type=peak eq1_freq=1500 eq1_dynamic=0 eq1_gain_oncc1=6',
  EqDynamic: '<region> sample=sine.wav key=60 loop_mode=loop_continuous amp_veltrack=0 eq1_type=peak eq1_freq=1500 eq1_dynamic=1 eq1_gain_oncc1=6',
  EqCents: '<region> sample=sine.wav key=60 loop_mode=loop_continuous amp_veltrack=0 eq1_type=peak eq1_freq=750 eq1_mode=cents eq1_dynamic=1 eq1_freq_oncc1=1200 eq1_gain=6',
  EqLowShelf: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 eq1_type=lshelf eq1_freq=1000 eq1_gain=6',
  EqHighShelf: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 eq1_type=hshelf eq1_freq=1000 eq1_gain=6',
  ChokeFast: '<global> amp_veltrack=0 ampeg_release=.01 <region> sample=constant.wav key=60 loop_mode=loop_continuous off_by=1 off_mode=fast off_time=.01 <region> sample=silence.wav key=61 group=1',
  ChokeNormal: '<global> amp_veltrack=0 ampeg_release=.01 <region> sample=constant.wav key=60 loop_mode=loop_continuous off_by=1 off_mode=normal off_time=.01 <region> sample=silence.wav key=61 group=1',
  PolyphonyOneShot: '<region> sample=long.wav lokey=60 hikey=61 loop_mode=one_shot amp_veltrack=0 polyphony=1 ampeg_release=.001',
  NotePolyphonyOneShot: '<region> sample=long.wav key=60 loop_mode=one_shot amp_veltrack=0 note_polyphony=1 ampeg_release=.001',
  VariableProduct: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 var15_mod=mult var15_volume=-12 var15_oncc84=1 var15_oncc85=.5 var15_oncc86=1',
  VariableFx: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 var15_mod=mult var15_volume=-12 var15_oncc84=1 var15_oncc85=.5 var15_oncc86=1 <effect> type=gain gain=-6 <effect> type=rectify rectify=0',
  VariableProductControl: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 volume_oncc84=-6',
  VariableAdd: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 var7_volume=-12 var7_oncc84=.25 var7_oncc85=.5 var7_oncc86=.25',
  VariableAddControl: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 volume_oncc84=-3 volume_oncc85=-6 volume_oncc86=-3',
  VariableCurve: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 var65535_mod=mult var65535_volume=-12 var65535_oncc84=1 var65535_curvecc84=2',
  VariableCurveControl: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.01 volume_oncc84=-12 volume_curvecc84=2',
  Paged: '<region> sample=constant.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_attack=.01 ampeg_release=.03 lfo1_freq=17 lfo1_pitch=37 lfo1_pan=20 fil_type=comb cutoff=220 resonance=6 fil2_type=lpf_2p_sv cutoff2=4000'
});

export async function generateSfzModulationFixture({ check = false } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destination = path.join(root, 'dsp/plugins/others/soundfont_player/modulation_fixture.h');
  const fixtures = [];
  for (const [name, source] of Object.entries(SFZ_MODULATION_FIXTURES)) {
    let parsed = await parseSfz({ selectedPath: 'fixture.sfz', readText: async () => source,
      hasSample: () => true, onDiagnostic: null });
    assert.deepEqual(parsed.unsupportedOpcodes, [], `${name}: unsupported fixture`);
    const samples = new Map([
      ['constant.wav', { channels: [new Float32Array(64).fill(.25)], sampleRate: 48000 }],
      ['long.wav', { channels: [new Float32Array(4096).fill(.25)], sampleRate: 48000 }],
      ['silence.wav', { channels: [new Float32Array(64)], sampleRate: 48000 }],
      ['high.wav', { channels: [Float32Array.from({ length: 4096 }, (_, i) => .25 * Math.sin(2 * Math.PI * i * 3 / 8))], sampleRate: 48000 }],
      ['sine.wav', { channels: [Float32Array.from({ length: 64 }, (_, i) => .25 * Math.sin(2 * Math.PI * i / 32))], sampleRate: 48000 }]
    ]);
    if (name === 'Oscillator') {
      const prepared = await prepareSfzOscillatorSources(parsed, async name => samples.get(name), 1048576);
      parsed = prepared.parsed;
      for (const [name, sample] of prepared.samples) samples.set(name, sample);
    }
    const asset = name === 'Paged'
      ? packStreamedSfzAsset(parsed.regions, new Map([['constant.wav', {
        frames: 16384, channels: 1, sampleRate: 48000, revision: 'a'.repeat(64)
      }]]), { cacheSlots: 4, modulation: parsed.modulation })
      : packSfzAsset(parsed.regions, samples, { modulation: parsed.modulation, effects: name === 'VariableFx' ? parsed.effects : null });
    fixtures.push({ name, source, bytes: new Uint8Array(asset.payload), footprint: asset.footprintBytes });
  }
  const declarations = fixtures.map(({ name, source, bytes, footprint }) => {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 24) lines.push(`  ${[...bytes.subarray(i, i + 24)].join(', ')},`);
    return `inline constexpr char kV3${name}Source[] = R"SFZ(${source})SFZ";
inline constexpr std::uint32_t kV3${name}Footprint = ${footprint}u;
inline constexpr std::array<std::uint8_t, ${bytes.length}> kV3${name}Payload{
${lines.join('\n')}
};`;
  }).join('\n');
  const output = `#ifndef EFFETUNE_SFZ_MODULATION_FIXTURE_H
#define EFFETUNE_SFZ_MODULATION_FIXTURE_H
#include <array>
#include <cstdint>
// Generated from authored sources by tools/generate-sfz-modulation-fixture.mjs.
${declarations}
#endif
`;
  if (check) {
    const existing = fs.readFileSync(destination, 'utf8');
    for (const fixture of fixtures) {
      const match = new RegExp(`kV3${fixture.name}Payload\\s*\\{([\\s\\S]*?)\\};`).exec(existing);
      assert.ok(match, `${fixture.name}: missing payload`);
      const values = match[1].split(',').map(value => value.trim()).filter(Boolean).map(Number);
      assert.deepEqual(Uint8Array.from(values), fixture.bytes, `${fixture.name}: stale payload`);
      assert(existing.includes(fixture.source), `${fixture.name}: stale authored source`);
      assert(new RegExp(`kV3${fixture.name}Footprint\\s*=\\s*${fixture.footprint}u`).test(existing), `${fixture.name}: stale footprint`);
    }
  } else fs.writeFileSync(destination, output);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await generateSfzModulationFixture({ check: process.argv.includes('--check') });
}
