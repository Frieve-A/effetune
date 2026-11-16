import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadOverlay } from '../helpers/spectrum-overlay-harness.mjs';

const files = {
  BandPassFilterPlugin: 'eq/band_pass_filter', CombFilterPlugin: 'eq/comb_filter',
  FifteenBandGEQPlugin: 'eq/fifteen_band_geq', HiPassFilterPlugin: 'eq/hi_pass_filter',
  LoPassFilterPlugin: 'eq/lo_pass_filter', LoudnessEqualizerPlugin: 'eq/loudness_equalizer',
  NarrowRangePlugin: 'eq/narrow_range', TiltEQPlugin: 'eq/tilt_eq', ToneControlPlugin: 'eq/tone_control',
  ChannelDividerPlugin: 'basics/channel_divider', FIRCrossoverPlugin: 'basics/fir_crossover',
  FiveBandDynamicEQ: 'eq/five_band_dynamic_eq', FiveBandPEQPlugin: 'eq/five_band_peq',
  FifteenBandPEQPlugin: 'eq/fifteen_band_peq', FiveBandFIRPEQPlugin: 'eq/five_band_fir_peq',
  RoomEqPlugin: 'eq/room_eq', EarphoneCableSimPlugin: 'eq/earphone_cable_sim', SubSynthPlugin: 'saturation/sub_synth',
  SpeakerDistortionCorrectionPlugin: 'others/speaker_distortion_correction'
};
const overlay = loadOverlay();

test('the spectrum registry retains exactly the 19 level-response graphs and selectors', () => {
  assert.deepEqual([...overlay.TARGETS.keys()].sort(), Object.keys(files).sort());
  for (const [name, target] of overlay.TARGETS) {
    const source = fs.readFileSync(new URL(`../../plugins/${files[name]}.js`, import.meta.url), 'utf8');
    const graphClass = target.plotSelector.match(/\.([\w-]+)/)[1];
    assert.ok(source.includes(graphClass), `${name} selector`);
  }
});
