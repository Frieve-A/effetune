import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { loadOverlay } from '../helpers/spectrum-overlay-harness.mjs';

const files = {
  BandPassFilterPlugin: 'eq/band_pass_filter', CombFilterPlugin: 'eq/comb_filter',
  FifteenBandGEQPlugin: 'eq/fifteen_band_geq', HiPassFilterPlugin: 'eq/hi_pass_filter',
  LoPassFilterPlugin: 'eq/lo_pass_filter', LoudnessEqualizerPlugin: 'eq/loudness_equalizer',
  NarrowRangePlugin: 'eq/narrow_range', TiltEQPlugin: 'eq/tilt_eq', ToneControlPlugin: 'eq/tone_control',
  ChannelDividerPlugin: 'basics/channel_divider', FIRCrossoverPlugin: 'basics/fir_crossover',
  FiveBandDynamicEQ: 'eq/five_band_dynamic_eq', FiveBandPEQPlugin: 'eq/five_band_peq',
  FifteenBandPEQPlugin: 'eq/fifteen_band_peq', FiveBandFIRPEQPlugin: 'eq/five_band_fir_peq',
  RoomEqPlugin: 'eq/room_eq', EarphoneCableSimPlugin: 'eq/earphone_cable_sim', SubSynthPlugin: 'saturation/sub_synth'
};
const overlay = loadOverlay();

test('the registry defines exactly the 18 level-response graphs and matches their actual axes', () => {
  assert.deepEqual([...overlay.TARGETS.keys()].sort(), Object.keys(files).sort());
  for (const [name, target] of overlay.TARGETS) {
    const source = fs.readFileSync(new URL(`../../plugins/${files[name]}.js`, import.meta.url), 'utf8');
    const graphClass = target.plotSelector.match(/\.([\w-]+)/)[1];
    assert.ok(source.includes(graphClass), `${name} selector`);
    if (target.axisCheck.ownerOf) {
      assert.equal(target.inset, 20);
      const context = { window: {}, PluginBase: class {}, console };
      vm.runInNewContext(`${source}\nthis.Loaded = ${name};`, context);
      const plugin = Object.create(context.Loaded.prototype);
      if (name === 'RoomEqPlugin') plugin._additionalEqEditor = context.Loaded.createAdditionalEqEditor();
      const owner = target.axisCheck.ownerOf(plugin);
      for (const frequency of [10, 20, 200, 2000, 20000, 40000]) {
        const expected = (Math.log10(frequency) - Math.log10(target.minFreq)) /
          (Math.log10(target.maxFreq) - Math.log10(target.minFreq)) * 100;
        assert.ok(Math.abs(owner[target.axisCheck.freqToXName](frequency) - expected) <= 1e-9, name);
      }
    } else {
      assert.equal(target.inset, 0);
      for (const marker of target.axisCheck) assert.ok(source.includes(marker), `${name}: ${marker}`);
    }
  }
});
