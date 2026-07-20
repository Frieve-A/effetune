import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';

import {
  SHIPPED_ENABLED_TYPES,
  filterEnabledDspTypes,
  getDspRolloutConfig,
  getDspRuntimeFlags,
  isWasmDspEnabled
} from '../../js/audio/dsp-rollout.js';

test('runtime flags parse the support query control', () => {
  assert.deepEqual(getDspRuntimeFlags('?dsp=off'), { forceOff: true });
  assert.deepEqual(getDspRuntimeFlags({ search: '?dsp=on' }), { forceOff: false });
  assert.deepEqual(getDspRuntimeFlags('https://example.test/app?dsp=OFF'), { forceOff: true });
  assert.deepEqual(getDspRuntimeFlags(null), { forceOff: false });
});

test('user preference and support URL independently disable WASM DSP', () => {
  assert.equal(isWasmDspEnabled(true, ''), true);
  assert.equal(isWasmDspEnabled({ useWasmDsp: true }, ''), true);
  assert.equal(isWasmDspEnabled(false, ''), false);
  assert.equal(isWasmDspEnabled({ useWasmDsp: false }, ''), false);
  assert.equal(isWasmDspEnabled(true, '?dsp=off'), false);
});

test('rollout enables only shipped kernels with matching generated layouts', () => {
  const pack = () => new Float32Array(0);
  const meta = {
    kernels: [
      { name: 'VolumePlugin', hash: 10 },
      { name: 'MutePlugin', hash: 20 },
      { name: 'UnknownPlugin', hash: 30 },
      { name: 'VolumePlugin', hash: 10 },
      null
    ]
  };
  const paramPackers = new Map([
    ['VolumePlugin', { pack, hash: 10 }],
    ['MutePlugin', { pack, hash: 21 }],
    ['UnknownPlugin', { pack: null, hash: 30 }]
  ]);
  assert.deepEqual(filterEnabledDspTypes({
    meta,
    paramPackers,
    shippedTypes: ['VolumePlugin', 'MutePlugin', 'UnknownPlugin'],
    location: ''
  }), ['VolumePlugin']);
  assert.deepEqual(filterEnabledDspTypes({
    meta,
    paramPackers,
    shippedTypes: ['VolumePlugin'],
    location: '?dsp=off'
  }), []);
  assert.deepEqual(filterEnabledDspTypes({ meta: null, paramPackers }), []);
  assert.deepEqual(filterEnabledDspTypes({ meta, paramPackers: null }), []);
  assert.deepEqual(SHIPPED_ENABLED_TYPES, [
    'LevelMeterPlugin',
    'OscilloscopePlugin',
    'SpectrogramPlugin',
    'SpectrumAnalyzerPlugin',
    'StereoMeterPlugin',
    'ChannelDividerPlugin',
    'DCOffsetPlugin',
    'MatrixPlugin',
    'MultiChannelPanelPlugin',
    'MutePlugin',
    'PolarityInversionPlugin',
    'StereoBalancePlugin',
    'VolumePlugin',
    'DelayPlugin',
    'TimeAlignmentPlugin',
    'AutoLevelerPlugin',
    'BrickwallLimiterPlugin',
    'CompressorPlugin',
    'ExpanderPlugin',
    'GatePlugin',
    'MultibandCompressorPlugin',
    'MultibandExpanderPlugin',
    'MultibandTransientPlugin',
    'PowerAmpSagPlugin',
    'TransientShaperPlugin',
    'BandPassFilterPlugin',
    'CombFilterPlugin',
    'EarphoneCableSimPlugin',
    'FifteenBandGEQPlugin',
    'FifteenBandPEQPlugin',
    'FiveBandDynamicEQ',
    'FiveBandPEQPlugin',
    'HiPassFilterPlugin',
    'LoPassFilterPlugin',
    'LoudnessEqualizerPlugin',
    'NarrowRangePlugin',
    'TiltEQPlugin',
    'ToneControlPlugin',
    'BitCrusherPlugin',
    'DigitalErrorEmulatorPlugin',
    'DSD64IMDSimulatorPlugin',
    'HumGeneratorPlugin',
    'NoiseBlenderPlugin',
    'SimpleJitterPlugin',
    'VinylArtifactsPlugin',
    'VinylSimulatorPlugin',
    'DopplerDistortionPlugin',
    'PitchShifterPlugin',
    'TremoloPlugin',
    'WowFlutterPlugin',
    'OscillatorPlugin',
    'HornResonatorPlugin',
    'HornResonatorPlusPlugin',
    'ModalResonatorPlugin',
    'DattorroPlateReverbPlugin',
    'FDNReverbPlugin',
    'IRReverbPlugin',
    'RSReverbPlugin',
    'DynamicSaturationPlugin',
    'ExciterPlugin',
    'HardClippingPlugin',
    'HarmonicDistortionPlugin',
    'MultibandSaturationPlugin',
    'SaturationPlugin',
    'SubSynthPlugin',
    'CrossfeedFilterPlugin',
    'MSMatrixPlugin',
    'MultibandBalancePlugin',
    'StereoBlendPlugin'
  ]);
  assert.equal(Object.isFrozen(SHIPPED_ENABLED_TYPES), true);
});

test('rollout config keeps runtime flags beside its enabled type list', () => {
  const pack = () => Float32Array.of(1);
  const config = getDspRolloutConfig({
    meta: { kernels: [{ name: 'VolumePlugin', hash: 4 }] },
    paramPackers: new Map([['VolumePlugin', { pack, hash: 4 }]]),
    shippedTypes: ['VolumePlugin'],
    location: ''
  });
  assert.deepEqual(config, {
    forceOff: false,
    enabledTypes: ['VolumePlugin']
  });
});

test('every shipped rollout entry exists in the committed artifact with a matching packer', () => {
  const meta = JSON.parse(fs.readFileSync(
    new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url),
    'utf8'
  ));
  assert.deepEqual(filterEnabledDspTypes({
    meta,
    paramPackers: DSP_PARAM_PACKERS,
    location: ''
  }), SHIPPED_ENABLED_TYPES);
});
