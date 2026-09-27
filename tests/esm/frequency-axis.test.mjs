import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { frequencyAxisSource } from '../helpers/spectrum-overlay-harness.mjs';

const context = { window: {} };
vm.runInNewContext(frequencyAxisSource, context);
const axes = context.window.FrequencyAxis;
const files = {
  BandPassFilterPlugin: 'eq/band_pass_filter', CombFilterPlugin: 'eq/comb_filter',
  FifteenBandGEQPlugin: 'eq/fifteen_band_geq', HiPassFilterPlugin: 'eq/hi_pass_filter',
  LoPassFilterPlugin: 'eq/lo_pass_filter', LoudnessEqualizerPlugin: 'eq/loudness_equalizer',
  NarrowRangePlugin: 'eq/narrow_range', TiltEQPlugin: 'eq/tilt_eq', ToneControlPlugin: 'eq/tone_control',
  ChannelDividerPlugin: 'basics/channel_divider', FIRCrossoverPlugin: 'basics/fir_crossover',
  FiveBandDynamicEQ: 'eq/five_band_dynamic_eq', FiveBandPEQPlugin: 'eq/five_band_peq',
  FifteenBandPEQPlugin: 'eq/fifteen_band_peq', FiveBandFIRPEQPlugin: 'eq/five_band_fir_peq',
  RoomEqPlugin: 'eq/room_eq', EarphoneCableSimPlugin: 'eq/earphone_cable_sim', SubSynthPlugin: 'saturation/sub_synth',
  GroupDelayEqPlugin: 'eq/group_delay_eq', GroupDelayPEQPlugin: 'eq/group_delay_peq',
  ExciterPlugin: 'saturation/exciter', DSD64IMDSimulatorPlugin: 'lofi/dsd64_imd_simulator',
  SpectrumAnalyzerPlugin: 'analyzer/spectrum_analyzer', SpectrogramPlugin: 'analyzer/spectrogram',
  ChromaSpiralPlugin: 'analyzer/chroma_spiral',
  NoteSpectrogramPlugin: 'analyzer/note_spectrogram', PitchMeterPlugin: 'analyzer/pitch_meter',
  PhaseSelectEqPlugin: 'spatial/phase_select_eq'
};

test('all frequency axes match plugin selectors and coordinate definitions', () => {
  assert.deepEqual([...axes.targets.keys()].sort(), Object.keys(files).sort());
  for (const [name, target] of axes.targets) {
    const source = fs.readFileSync(new URL(`../../plugins/${files[name]}.js`, import.meta.url), 'utf8');
    const graphClass = target.plotSelector.match(/\.([\w-]+)/)[1];
    assert.ok(source.includes(graphClass) || (graphClass === 'graph-container' && source.includes('this.createResponsiveGraph(')), `${name} selector`);
    if (target.axisCheck.ownerOf) {
      const sandbox = { window: {}, PluginBase: class {}, console };
      vm.runInNewContext(`${source}\nthis.Loaded = ${name};`, sandbox);
      const plugin = Object.create(sandbox.Loaded.prototype);
      if (name === 'RoomEqPlugin') plugin._additionalEqEditor = sandbox.Loaded.createAdditionalEqEditor();
      const owner = target.axisCheck.ownerOf(plugin);
      for (const frequency of [10, 20, 200, 2000, 20000, 40000]) {
        const expected = (Math.log10(frequency) - Math.log10(target.minFreq)) /
          (Math.log10(target.maxFreq) - Math.log10(target.minFreq)) * 100;
        assert.ok(Math.abs(owner.freqToX(frequency) - expected) <= 1e-9, name);
      }
    } else {
      for (const marker of target.axisCheck) assert.ok(source.includes(marker), `${name}: ${marker}`);
    }
  }
});

test('Chroma pointer coordinates follow C, A and adjacent spiral turns at each graph size', () => {
  const sandbox = { window: {}, PluginBase: class {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/analyzer/chroma_spiral.js', import.meta.url), 'utf8'), sandbox);
  const Plugin = sandbox.window.ChromaSpiralPlugin;
  const plugin = Object.create(Plugin.prototype);
  for (const size of [306, 640]) {
    for (const [lo, hi] of [[1, 7], [4, 4], [8, 9]]) {
      Object.assign(plugin, { lo, hi });
      const geometry = plugin.getSpiralGeometry(size, size);
      const axis = axes.getAxis(plugin, axes.targets.get('ChromaSpiralPlugin'), { width: size, height: size });
      for (const midi of [(lo + 1) * 12 - 0.25, (lo + 1) * 12, (lo + 1) * 12 + 9,
        (hi + 1) * 12, (hi + 1) * 12 + 9.25, (hi + 2) * 12 - 0.5]) {
        const rendered = Plugin.spiralPoint(midi, geometry.midiLow, geometry.inner, geometry.pitch);
        const frequency = axes.noteFrequency(midi);
        const point = axis.toPoint(frequency);
        assert.ok(Math.abs(point.x - size / 2 - rendered.x) < 1e-9);
        assert.ok(Math.abs(point.y - size / 2 - rendered.y) < 1e-9);
        assert.ok(Math.abs(axis.pointToFreq(point.x, point.y) / frequency - 1) < 1e-10);
      }
      assert.equal(axis.pointToFreq(size / 2, size / 2 - size * 2), axes.noteFrequency(geometry.midiEnd));
      assert.equal(axis.pointToFreq(size / 2, size / 2), axes.noteFrequency(geometry.midiLow - 0.5));
    }
  }
});

test('logarithmic, linear and vertical coordinates round trip and clamp', () => {
  for (const scale of ['log', 'linear']) {
    for (const orientation of ['x', 'y']) {
      for (const frequency of [20, 440, 20000]) {
        const position = axes.frequencyToPosition(frequency, 480, 20, 20000, scale, orientation);
        const actual = axes.positionToFrequency(position, 480, 20, 20000, scale, orientation);
        assert.ok(Math.abs(actual / frequency - 1) < 1e-10);
      }
      assert.equal(axes.positionToFrequency(-1, 480, 20, 20000, scale, orientation), orientation === 'x' ? 20 : 20000);
    }
  }
});

test('semitone snapping respects half-step boundaries and reference tuning', () => {
  for (const a4 of [440, 442]) {
    assert.equal(axes.nearestSemitone(a4 * 2 ** (0.499 / 12), a4), a4);
    assert.equal(axes.nearestSemitone(a4 * 2 ** (0.501 / 12), a4), axes.noteFrequency(70, a4));
    assert.equal(axes.nearestSemitone(a4 * 2 ** (-0.501 / 12), a4), axes.noteFrequency(68, a4));
  }
});

test('note-axis keys follow the rendered equal white-key geometry and black priority', () => {
  const keys = axes.noteAxisKeys(60, 71, 120);
  const c = keys.find(key => key.midi === 60);
  assert.equal(c.start, 0);
  assert.equal(c.end, 10);
  assert.equal(c.whiteStart, 0);
  assert.equal(c.whiteEnd, 120 / 7);
  assert.equal(axes.hitKey(keys, 12, 5, 45, 28).midi, 61);
  assert.equal(axes.hitKey(keys, 12, 35, 45, 28).midi, 60);
  assert.equal(axes.hitKey(keys, 120, 35, 45, 28).midi, 71);
  for (const name of ['NoteSpectrogramPlugin', 'PitchMeterPlugin']) {
    const source = fs.readFileSync(new URL(`../../plugins/${files[name]}.js`, import.meta.url), 'utf8');
    assert.ok(source.includes('keyboardDepths(12 * rowHeight, width'));
    for (const ly of ['Horizontal', 'Vertical']) {
      const axis = axes.getAxis({ mn: 60, mx: 71, rf: 442, ly }, axes.targets.get(name), { width: 120, height: 120 });
      assert.ok(Math.abs(axis.gutter - 120 * 150 / (7 * 23.5) / 2) < 1e-12);
      assert.ok(Math.abs(axis.blackDepth - axis.gutter * 95 / 150) < 1e-12);
      const position = ly === 'Horizontal' ? 15 : 105;
      assert.equal(axis.toFreq(position), axes.noteFrequency(61, axis.a4));
      assert.ok(Math.abs(axis.toPos(axis.toFreq(position)) - position) < 1e-10);
      assert.equal(axes.hitKey(axis.keys, position, 5, axis.gutter, axis.blackDepth).midi, 61);
    }
  }
});

test('keyboards keep piano key proportions and leave room for the plot', () => {
  // 23.5 mm white-key pitch, 150 mm white length and 95 mm black length, drawn at half
  // length by default; a length scale of 2 gives the real proportion.
  const whitePitch = 10;
  const { gutter, blackDepth } = axes.keyboardDepths(7 * whitePitch, 1000);
  assert.ok(Math.abs(gutter / whitePitch - 150 / 23.5 / 2) < 1e-12);
  assert.ok(Math.abs(blackDepth / gutter - 95 / 150) < 1e-12);
  const real = axes.keyboardDepths(7 * whitePitch, 1000, 2);
  assert.ok(Math.abs(real.gutter / whitePitch - 150 / 23.5) < 1e-12);
  assert.ok(Math.abs(real.blackDepth / real.gutter - 95 / 150) < 1e-12);
  assert.equal(axes.keyboardDepths(7 * whitePitch, 40, 2).gutter, 20);
});
