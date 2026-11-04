import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileAcceptanceInstrument } from '../tests/helpers/sfz-native-acceptance.mjs';
import { parseSfz } from '../js/sfz/parser.js';
import { packStreamedSfzAsset } from '../js/sfz/asset.js';
import { SFZ_EFFECT_ASSET_SOURCES } from '../tests/helpers/sfz-effects-asset-fixture.mjs';

const region = '<region> sample=tone.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.001';
const amp = '<region> sample=tone.wav key=60 loop_mode=loop_continuous ampeg_release=.02';
const noise = '<region> sample=silence.wav key=60 loop_mode=loop_continuous amp_veltrack=0 noise_level=-6 noise_tone=80';
export const SOURCES = Object.freeze({
  Dry: region,
  AmpOrdinary: amp,
  AmpExplicitZero: `${amp} amp_veltrack_random=0`,
  AmpHalf: `${amp} amp_veltrack=50`,
  AmpNegative: `${amp} amp_veltrack=-100`,
  AmpCurveHalf: `${amp} amp_veltrack=50 amp_velcurve_64=.75`,
  AmpCurveNegative: `${amp} amp_veltrack=-100 amp_velcurve_64=.75`,
  AmpRandom: `${amp} amp_veltrack_random=.25`,
  AmpRandomNegative: `${amp} amp_veltrack_random=-100`,
  AmpRandomCurve: `${amp} amp_veltrack_random=-100 amp_velcurve_64=.75`,
  AmpRandomReadout: `${amp} amp_veltrack_random=.25 pan_law=mma pan_oncc135=100`,
  AmpPanZero: `${amp} amp_veltrack_random=0 pan_law=mma pan_oncc135=100`,
  AmpRandomDynamic: `${amp} amp_veltrack=0 amp_veltrack_oncc1=100 amp_veltrack_random=.25`,
  AmpNegativeSteal: `${amp} amp_veltrack=-100 polyphony=1`,
  PlaybackBeat: `${region} delay_beats=.01`,
  Drive: `${region} dsp_order=1 drive=60`,
  Bit: `${region} dsp_order=1 bitred=70`,
  Decim: `${region} dsp_order=1 decim=70`,
  Order0: `${region} dsp_order=0 drive=60 bitred=40 decim=57 fil_type=lpf_2p cutoff=1200 fil2_type=hpf_2p cutoff2=300`,
  Order1: `${region} dsp_order=1 drive=60 bitred=40 decim=57 fil_type=lpf_2p cutoff=1200 fil2_type=hpf_2p cutoff2=300`,
  Order14: `${region} dsp_order=14 drive=60 bitred=40 decim=57 fil_type=lpf_2p cutoff=1200 fil2_type=hpf_2p cutoff2=300`,
  NoiseMono: `${noise} noise_stereo=off noise_filter=off`,
  NoiseStereo: `${noise} noise_stereo=on noise_filter=off`,
  NoiseComb: `${noise} noise_stereo=on noise_filter=comb cutoff=750 resonance=3`,
  OptionalUnion: '<region> sample=tone.wav key=60 oscillator=on oscillator_quality=3 ' +
    '<region> sample=tone.wav key=61 dsp_order=1 drive=60 ' +
    '<region> sample=silence.wav key=62 loop_mode=loop_continuous noise_level=-6 noise_filter=off',
  FxGlobal: `${region} <effect> type=comp comp_ratio=1 comp_threshold=0 comp_attack=0 comp_release=0 comp_gain_oncc7=12`,
  FxGlobalInit: `<control> set_hdcc7=.25 ${region} <effect> type=comp comp_ratio=1 comp_threshold=0 comp_attack=0 comp_release=0 comp_gain_oncc7=12`,
  FxBend: `${region} <effect> type=comp comp_ratio=1 comp_threshold=0 comp_attack=0 comp_release=0 comp_gain_oncc128=12`,
  FxPressure: `${region} <effect> type=comp comp_ratio=1 comp_threshold=0 comp_attack=0 comp_release=0 comp_gain_oncc129=12`,
  FxPolyPressure: `${region} <effect> type=comp comp_ratio=1 comp_threshold=0 comp_attack=0 comp_release=0 comp_gain_oncc130=12`,
  PagedVoiceNoise: SFZ_EFFECT_ASSET_SOURCES.Paged.replace(' <effect>',
    ' dsp_order=1 drive=40 noise_level=-30 noise_stereo=on noise_filter=comb <effect>'),
  LoopTuneQuality: '<region> sample=loop-quality.wav key=60 loop_mode=loop_continuous loop_start=0 loop_end=4095 amp_veltrack=0 loop_tune=1200',
  DynamicLoopTune: '<region> sample=loop-tune.wav key=60 loop_mode=loop_continuous loop_start=0 loop_end=4095 amp_veltrack=0 loop_tune_oncc1=1200',
  DynamicLoopBounds: '<region> sample=loop-bounds.wav key=60 loop_mode=loop_continuous loop_start=0 loop_end=4095 amp_veltrack=0 loop_start_oncc2=512 loop_length_oncc3=-512',
  DynamicFadeout: '<region> sample=fadeout.wav key=60 loop_mode=no_loop amp_veltrack=0 sample_fadeout_oncc1=.05',
  HostPlaying: '<region> sample=host.wav key=60 loop_mode=loop_continuous amp_veltrack=0 volume=-60 volume_oncc143=60',
  HostPosition: '<region> sample=host.wav key=60 loop_mode=loop_continuous amp_veltrack=0 volume=-6 volume_oncc148=6',
  ShiftedOffset: '<control> note_offset=12 <region> sample=shift-offset.wav key=72 loop_mode=no_loop offset_oncc1=8192 amp_veltrack=0'
});

const samples = new Map([
  ['tone.wav', { sampleRate: 48000, channels: [Float32Array.from({ length: 4096 }, (_, index) => .25 * Math.sin(2 * Math.PI * index / 64))] }],
  ['silence.wav', { sampleRate: 48000, channels: [new Float32Array(4096)] }]
]);
const extraSamples = new Map([
  ['LoopTuneQuality', ['loop-quality.wav', Float32Array.from({ length: 4096 }, (_, index) => .25 * Math.sin(2 * Math.PI * index * 18000 / 48000))]],
  ['DynamicLoopTune', ['loop-tune.wav', Float32Array.from({ length: 4096 }, (_, index) => .25 * Math.sin(2 * Math.PI * index * 1500 / 48000))]],
  ['DynamicLoopBounds', ['loop-bounds.wav', Float32Array.from({ length: 4096 }, (_, index) => (index / 4095 - .5) * .5)]],
  ['DynamicFadeout', ['fadeout.wav', new Float32Array(4800).fill(.25)]],
  ['HostPlaying', ['host.wav', new Float32Array(4096).fill(.25)]],
  ['HostPosition', ['host.wav', new Float32Array(4096).fill(.25)]]
]);
export async function generateSfzFutureMainFixture({ check = false } = {}) {
  const declarations = [], summary = [];
  for (const [name, source] of Object.entries(SOURCES)) {
    let asset;
    if (name === 'PagedVoiceNoise' || name === 'ShiftedOffset') {
      const parsed = await parseSfz({ selectedPath: 'fixture.sfz', readText: async () => source, onDiagnostic: null });
      assert.deepEqual(parsed.unsupportedOpcodes, []);
      asset = { ...packStreamedSfzAsset(parsed.regions, new Map([[name === 'ShiftedOffset' ? 'shift-offset.wav' : 'constant.wav', {
        frames: 16384, channels: 1, sampleRate: 48000, revision: 'a'.repeat(64)
      }]]), { cacheSlots: 4, modulation: parsed.modulation, effects: parsed.effects }), parsed };
    } else {
      const extra = extraSamples.get(name);
      const selected = extra ? new Map([[extra[0], { sampleRate: 48000, channels: [extra[1]] }]]) : new Map(samples);
      asset = await compileAcceptanceInstrument(source, { samples: selected });
    }
    assert.deepEqual(asset.parsed.modulation.diagnostics, [], name);
    const bytes = new Uint8Array(asset.payload), lines = [];
    for (let index = 0; index < bytes.length; index += 24) lines.push('  ' + [...bytes.subarray(index, index + 24)].join(', ') + ',');
    declarations.push(`inline constexpr char kFuture${name}Source[] = R"SFZ(${source})SFZ";\n` +
      `inline constexpr std::uint32_t kFuture${name}BaseFootprint = ${asset.footprintBytes}u;\n` +
      `inline constexpr std::array<std::uint8_t, ${bytes.length}> kFuture${name}Payload{\n${lines.join('\n')}\n};`);
    summary.push({ name, bytes: bytes.length, baseFootprint: asset.footprintBytes, effects: !!asset.parsed.effects });
  }
  const output = '#pragma once\n#include <array>\n#include <cstdint>\n' +
    '// Generated by tools/generate-sfz-future-main-fixture.mjs through the normal SFZ compiler.\n' +
    '// BaseFootprint is the supplied payload extent; add the complete target-native preparation query.\n' +
    '// clang-format off\n' + declarations.join('\n') + '\n// clang-format on\n';
  const destination = new URL('../dsp/plugins/others/soundfont_player/future_main_fixture.h', import.meta.url);
  if (check) assert.equal((await fs.readFile(destination, 'utf8')).replaceAll('\r\n', '\n'), output);
  else await fs.writeFile(destination, output);
  return summary;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await generateSfzFutureMainFixture({ check: process.argv.includes('--check') });
