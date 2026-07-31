import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadParamSpecs } from './gen-dsp-params.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlayPath = path.join(repoRoot, 'dsp', 'bindings', 'common', 'effects-v1.overlay.json');
const generatedRoot = path.join(repoRoot, 'dsp', 'bindings', 'generated');
const schemaRoot = path.join(repoRoot, 'dsp', 'bindings', 'schema');
const pythonOutput = path.join(
  repoRoot, 'dsp', 'bindings', 'python', 'src', 'effetune', '_generated_effects.py'
);
const pythonStubOutput = path.join(
  repoRoot, 'dsp', 'bindings', 'python', 'src', 'effetune', '_generated_effects.pyi'
);
const jsOutput = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'generated-effects.js');
const tsOutput = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'generated-effects.d.ts');
const convenienceExportsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'convenience-exports-v0.1.json'
);
const jsIndexPath = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'index.js');
const tsIndexPath = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'index.d.ts');

const chainSchemaId = 'https://effetune.frieve.com/dsp/schemas/chain-v1.schema.json';
const bundleSchemaId = 'https://effetune.frieve.com/dsp/schemas/bundle-v1.schema.json';
const maximumAssetBytes = 32 * 1024 * 1024;
const maximumUint32 = 0xffffffff;
const digestPattern = /^[0-9a-f]{64}$/;

export const EFFECT_CHANNELS = Object.freeze([
  'all',
  'stereo',
  'left',
  'right',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '34',
  '56',
  '78'
]);

const channelImplementation = Object.freeze({
  all: 'A',
  stereo: null,
  left: 'L',
  right: 'R',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '34': '34',
  '56': '56',
  '78': '78'
});

export const PUBLIC_EFFECT_TYPES = Object.freeze([
  'LevelMeter',
  'Oscilloscope',
  'Spectrogram',
  'SpectrumAnalyzer',
  'StereoMeter',
  'ChannelDivider',
  'DCOffset',
  'FIRCrossover',
  'Matrix',
  'MultiChannelPanel',
  'Mute',
  'PolarityInversion',
  'StereoBalance',
  'Volume',
  'Delay',
  'TimeAlignment',
  'AutoLeveler',
  'BrickwallLimiter',
  'Compressor',
  'Expander',
  'Gate',
  'MultibandCompressor',
  'MultibandExpander',
  'MultibandTransient',
  'PowerAmpSag',
  'TransientShaper',
  'BandPassFilter',
  'CombFilter',
  'EarphoneCableSim',
  'FifteenBandGEQ',
  'FifteenBandPEQ',
  'FiveBandDynamicEQ',
  'FiveBandFIRPEQ',
  'FiveBandPEQ',
  'GroupDelayEQ',
  'HiPassFilter',
  'LoPassFilter',
  'LoudnessEqualizer',
  'NarrowRange',
  'RoomEQ',
  'TiltEQ',
  'ToneControl',
  'AMRadioSimulator',
  'BitCrusher',
  'DigitalErrorEmulator',
  'DSD64IMDSimulator',
  'FMRadioSimulator',
  'HumGenerator',
  'NoiseBlender',
  'SimpleJitter',
  'SWRadioSimulator',
  'VinylArtifacts',
  'VinylSimulator',
  'DopplerDistortion',
  'PitchShifter',
  'Tremolo',
  'WowFlutter',
  'Oscillator',
  'HornResonator',
  'HornResonatorPlus',
  'ModalResonator',
  'DattorroPlateReverb',
  'FDNReverb',
  'IRReverb',
  'RSReverb',
  'DynamicSaturation',
  'Exciter',
  'HardClipping',
  'HarmonicDistortion',
  'MultibandSaturation',
  'Saturation',
  'SubSynth',
  'CrossfeedFilter',
  'MSMatrix',
  'MultibandBalance',
  'StereoBlend'
]);
export const FROZEN_PARAM_DIRECTORIES = Object.freeze({
  LevelMeterPlugin: 'dsp/plugins/analyzer/level_meter',
  OscilloscopePlugin: 'dsp/plugins/analyzer/oscilloscope',
  SpectrogramPlugin: 'dsp/plugins/analyzer/spectrogram',
  SpectrumAnalyzerPlugin: 'dsp/plugins/analyzer/spectrum_analyzer',
  StereoMeterPlugin: 'dsp/plugins/analyzer/stereo_meter',
  ChannelDividerPlugin: 'dsp/plugins/basics/channel_divider',
  DCOffsetPlugin: 'dsp/plugins/basics/dc_offset',
  FIRCrossoverPlugin: 'dsp/plugins/basics/fir_crossover',
  MatrixPlugin: 'dsp/plugins/basics/matrix',
  MultiChannelPanelPlugin: 'dsp/plugins/basics/multi_channel_panel',
  MutePlugin: 'dsp/plugins/basics/mute',
  PolarityInversionPlugin: 'dsp/plugins/basics/polarity_inversion',
  StereoBalancePlugin: 'dsp/plugins/basics/stereo_balance',
  VolumePlugin: 'dsp/plugins/basics/volume',
  DelayPlugin: 'dsp/plugins/delay/delay',
  TimeAlignmentPlugin: 'dsp/plugins/delay/time_alignment',
  AutoLevelerPlugin: 'dsp/plugins/dynamics/auto_leveler',
  BrickwallLimiterPlugin: 'dsp/plugins/dynamics/brickwall_limiter',
  CompressorPlugin: 'dsp/plugins/dynamics/compressor',
  ExpanderPlugin: 'dsp/plugins/dynamics/expander',
  GatePlugin: 'dsp/plugins/dynamics/gate',
  MultibandCompressorPlugin: 'dsp/plugins/dynamics/multiband_compressor',
  MultibandExpanderPlugin: 'dsp/plugins/dynamics/multiband_expander',
  MultibandTransientPlugin: 'dsp/plugins/dynamics/multiband_transient',
  PowerAmpSagPlugin: 'dsp/plugins/dynamics/power_amp_sag',
  TransientShaperPlugin: 'dsp/plugins/dynamics/transient_shaper',
  BandPassFilterPlugin: 'dsp/plugins/eq/band_pass_filter',
  CombFilterPlugin: 'dsp/plugins/eq/comb_filter',
  EarphoneCableSimPlugin: 'dsp/plugins/eq/earphone_cable_sim',
  FifteenBandGEQPlugin: 'dsp/plugins/eq/fifteen_band_geq',
  FifteenBandPEQPlugin: 'dsp/plugins/eq/fifteen_band_peq',
  FiveBandDynamicEQ: 'dsp/plugins/eq/five_band_dynamic_eq',
  FiveBandFIRPEQPlugin: 'dsp/plugins/eq/five_band_fir_peq',
  FiveBandPEQPlugin: 'dsp/plugins/eq/five_band_peq',
  GroupDelayEqPlugin: 'dsp/plugins/eq/group_delay_eq',
  HiPassFilterPlugin: 'dsp/plugins/eq/hi_pass_filter',
  LoPassFilterPlugin: 'dsp/plugins/eq/lo_pass_filter',
  LoudnessEqualizerPlugin: 'dsp/plugins/eq/loudness_equalizer',
  NarrowRangePlugin: 'dsp/plugins/eq/narrow_range',
  RoomEqPlugin: 'dsp/plugins/eq/room_eq',
  TiltEQPlugin: 'dsp/plugins/eq/tilt_eq',
  ToneControlPlugin: 'dsp/plugins/eq/tone_control',
  AMRadioSimulatorPlugin: 'dsp/plugins/lofi/am_radio_simulator',
  BitCrusherPlugin: 'dsp/plugins/lofi/bit_crusher',
  DigitalErrorEmulatorPlugin: 'dsp/plugins/lofi/digital_error_emulator',
  DSD64IMDSimulatorPlugin: 'dsp/plugins/lofi/dsd64_imd_simulator',
  FMRadioSimulatorPlugin: 'dsp/plugins/lofi/fm_radio_simulator',
  HumGeneratorPlugin: 'dsp/plugins/lofi/hum_generator',
  NoiseBlenderPlugin: 'dsp/plugins/lofi/noise_blender',
  SimpleJitterPlugin: 'dsp/plugins/lofi/simple_jitter',
  SWRadioSimulatorPlugin: 'dsp/plugins/lofi/sw_radio_simulator',
  VinylArtifactsPlugin: 'dsp/plugins/lofi/vinyl_artifacts',
  VinylSimulatorPlugin: 'dsp/plugins/lofi/vinyl_simulator',
  DopplerDistortionPlugin: 'dsp/plugins/modulation/doppler_distortion',
  PitchShifterPlugin: 'dsp/plugins/modulation/pitch_shifter',
  TremoloPlugin: 'dsp/plugins/modulation/tremolo',
  WowFlutterPlugin: 'dsp/plugins/modulation/wow_flutter',
  OscillatorPlugin: 'dsp/plugins/others/oscillator',
  HornResonatorPlugin: 'dsp/plugins/resonator/horn_resonator',
  HornResonatorPlusPlugin: 'dsp/plugins/resonator/horn_resonator_plus',
  ModalResonatorPlugin: 'dsp/plugins/resonator/modal_resonator',
  DattorroPlateReverbPlugin: 'dsp/plugins/reverb/dattorro_plate_reverb',
  FDNReverbPlugin: 'dsp/plugins/reverb/fdn_reverb',
  IRReverbPlugin: 'dsp/plugins/reverb/ir_reverb',
  RSReverbPlugin: 'dsp/plugins/reverb/rs_reverb',
  DynamicSaturationPlugin: 'dsp/plugins/saturation/dynamic_saturation',
  ExciterPlugin: 'dsp/plugins/saturation/exciter',
  HardClippingPlugin: 'dsp/plugins/saturation/hard_clipping',
  HarmonicDistortionPlugin: 'dsp/plugins/saturation/harmonic_distortion',
  MultibandSaturationPlugin: 'dsp/plugins/saturation/multiband_saturation',
  SaturationPlugin: 'dsp/plugins/saturation/saturation',
  SubSynthPlugin: 'dsp/plugins/saturation/sub_synth',
  CrossfeedFilterPlugin: 'dsp/plugins/spatial/crossfeed_filter',
  MSMatrixPlugin: 'dsp/plugins/spatial/ms_matrix',
  MultibandBalancePlugin: 'dsp/plugins/spatial/multiband_balance',
  StereoBlendPlugin: 'dsp/plugins/spatial/stereo_blend'
});

function assertFrozenParamDirectories() {
  const entries = Object.entries(FROZEN_PARAM_DIRECTORIES);
  const types = entries.map(([type]) => type);
  const directories = entries.map(([, directory]) => directory);
  if (entries.length !== PUBLIC_EFFECT_TYPES.length ||
      new Set(types).size !== PUBLIC_EFFECT_TYPES.length ||
      new Set(directories).size !== PUBLIC_EFFECT_TYPES.length) {
    fail('frozen parameter directory mapping must contain all unique approved sources');
  }
}

assertFrozenParamDirectories();

const topOverlayKeys = new Set(['version', 'contractDigests', 'effects']);
const effectOverlayKeys = new Set([
  'type', 'internalType', 'parameters', 'sampleRates', 'minimumSampleRate',
  'effectiveDelaySamples', 'seeded', 'telemetry', 'latency', 'assets'
]);
const parameterOverlayKeys = new Set([
  'name', 'unit', 'transform', 'allowedValues', 'valueMap'
]);
const convenienceManifestKeys = new Set(['version', 'exports']);
const convenienceExportKeys = new Set(['type', 'class', 'factory']);
const jsRootGeneratedValueExports = Object.freeze([
  'EFFECT_CLASSES',
  'EFFECT_METADATA',
  'EFFECT_TYPES',
  'createEffect'
]);
const jsRootGeneratedTypeExports = Object.freeze([
  'CommonEffectOptions',
  'EffectChannel',
  'EffectClassByType',
  'EffectOptionsByType',
  'EffectType',
  'IRReverbAssets'
]);
const transformKinds = new Set(['naturalLog', 'log10', 'decibelsFromReference']);
const latencyKinds = new Set(['dynamic', 'sampleRateDependent']);
const unsafeJsLiteralCharacters = Object.freeze({
  '<': '\\u003C',
  '>': '\\u003E',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
});

function fail(message, source = null) {
  throw new Error(`${source ? `${source}: ` : ''}${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label, source) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`${label} contains unsupported key ${key}`, source);
    }
  }
}

function requireIdentifier(value, label, source) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail(`${label} must be an identifier`, source);
  }
  return value;
}

function requireFinite(value, label, source) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`, source);
  }
  return value;
}

function requireUnique(values, label, source) {
  const keys = values.map(value => `${typeof value}:${String(value)}`);
  if (new Set(keys).size !== keys.length) {
    fail(`${label} must not contain duplicates`, source);
  }
}

function readJson(filePath) {
  const source = path.relative(repoRoot, filePath).replaceAll('\\', '/');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`invalid JSON: ${error.message}`, source);
  }
}

export function loadConvenienceExports(filePath = convenienceExportsPath) {
  const source = path.relative(repoRoot, filePath).replaceAll('\\', '/');
  const manifest = readJson(filePath);
  if (!isPlainObject(manifest)) {
    fail('root must be an object', source);
  }
  assertOnlyKeys(manifest, convenienceManifestKeys, 'root', source);
  if (manifest.version !== 1 || !Array.isArray(manifest.exports) ||
      manifest.exports.length === 0) {
    fail('version must be 1 and exports must be a non-empty array', source);
  }
  for (const [index, entry] of manifest.exports.entries()) {
    const label = `exports[${index}]`;
    if (!isPlainObject(entry)) {
      fail(`${label} must be an object`, source);
    }
    assertOnlyKeys(entry, convenienceExportKeys, label, source);
    requireIdentifier(entry.type, `${label}.type`, source);
    requireIdentifier(entry.class, `${label}.class`, source);
    requireIdentifier(entry.factory, `${label}.factory`, source);
    if (entry.class !== entry.type || entry.factory !== `create${entry.type}`) {
      fail(`${label} must use the canonical class and factory names for its type`, source);
    }
  }
  for (const key of ['type', 'class', 'factory']) {
    requireUnique(
      manifest.exports.map(entry => entry[key]),
      `exports ${key} names`,
      source
    );
  }
  return manifest;
}

function generatedExportNames(sourceText, typeOnly, source) {
  const pattern = typeOnly
    ? /export\s+type\s*\{([^}]*)\}\s*from\s*['"]\.\/generated-effects\.js['"]\s*;/g
    : /export\s+(?!type\b)\{([^}]*)\}\s*from\s*['"]\.\/generated-effects\.js['"]\s*;/g;
  const matches = [...sourceText.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(
      `expected exactly one ${typeOnly ? 'type ' : ''}export block from generated-effects.js`,
      source
    );
  }
  const names = matches[0][1].split(',').map(name => name.trim()).filter(Boolean);
  for (const [index, name] of names.entries()) {
    requireIdentifier(name, `generated export[${index}]`, source);
  }
  requireUnique(names, 'generated exports', source);
  return names;
}

function requireSameNames(actual, expected, label, source) {
  const actualNames = new Set(actual);
  const expectedNames = new Set(expected);
  const missing = [...expectedNames].filter(name => !actualNames.has(name));
  const extra = [...actualNames].filter(name => !expectedNames.has(name));
  if (missing.length !== 0 || extra.length !== 0) {
    fail(
      `${label} mismatch (missing: ${missing.join(', ') || 'none'}; ` +
        `extra: ${extra.join(', ') || 'none'})`,
      source
    );
  }
}

export function validateConvenienceExports(catalog, {
  manifest = loadConvenienceExports(),
  indexSource = fs.readFileSync(jsIndexPath, 'utf8'),
  declarationsSource = fs.readFileSync(tsIndexPath, 'utf8')
} = {}) {
  const source = path.relative(repoRoot, convenienceExportsPath).replaceAll('\\', '/');
  const catalogTypeList = catalog.effects.map(effect => effect.type);
  const catalogTypes = new Set(catalogTypeList);
  for (const entry of manifest.exports) {
    if (!catalogTypes.has(entry.type)) {
      fail(`convenience export references unknown effect type ${entry.type}`, source);
    }
  }
  if (JSON.stringify(manifest.exports.map(entry => entry.type)) !==
      JSON.stringify(catalogTypeList)) {
    fail('convenience exports must cover the complete catalog in canonical order', source);
  }
  const valueExports = [
    ...jsRootGeneratedValueExports,
    ...manifest.exports.flatMap(entry => [entry.class, entry.factory])
  ];
  const typeExports = [
    ...jsRootGeneratedTypeExports,
    ...manifest.exports.map(entry => `${entry.class}Options`)
  ];
  requireSameNames(
    generatedExportNames(indexSource, false, 'dsp/bindings/js/src/index.js'),
    valueExports,
    'index.js generated value exports',
    source
  );
  requireSameNames(
    generatedExportNames(declarationsSource, false, 'dsp/bindings/js/src/index.d.ts'),
    valueExports,
    'index.d.ts generated value exports',
    source
  );
  requireSameNames(
    generatedExportNames(declarationsSource, true, 'dsp/bindings/js/src/index.d.ts'),
    typeExports,
    'index.d.ts generated type exports',
    source
  );
  return manifest;
}

function loadOverlay(filePath = overlayPath) {
  const source = path.relative(repoRoot, filePath).replaceAll('\\', '/');
  const overlay = readJson(filePath);
  if (!isPlainObject(overlay)) {
    fail('root must be an object', source);
  }
  assertOnlyKeys(overlay, topOverlayKeys, 'root', source);
  if (overlay.version !== 1 || !Array.isArray(overlay.effects)) {
    fail('version must be 1 and effects must be an array', source);
  }
  if (overlay.contractDigests !== undefined) {
    if (!isPlainObject(overlay.contractDigests)) {
      fail('contractDigests must be an object', source);
    }
    assertOnlyKeys(
      overlay.contractDigests,
      new Set(['publicCatalogSha256', 'privateLayoutSha256']),
      'contractDigests',
      source
    );
    for (const key of ['publicCatalogSha256', 'privateLayoutSha256']) {
      if (!digestPattern.test(overlay.contractDigests[key] ?? '')) {
        fail(`contractDigests.${key} must be a lowercase SHA-256 digest`, source);
      }
    }
  }
  const types = overlay.effects.map(effect => effect?.type);
  if (JSON.stringify(types) !== JSON.stringify(PUBLIC_EFFECT_TYPES)) {
    fail('effects must contain all frozen public types in canonical order', source);
  }
  return { overlay, source };
}

function rawFieldsFor(spec) {
  const raw = readJson(path.join(repoRoot, spec.source));
  const byName = new Map(raw.fields.map(field => [field.name, field]));
  return byName;
}

function publicValueType(values, label, source) {
  if (values.every(value => typeof value === 'string')) {
    return 'string';
  }
  if (values.every(value => Number.isSafeInteger(value))) {
    return 'integer';
  }
  if (values.every(value => typeof value === 'number' && Number.isFinite(value))) {
    return 'number';
  }
  fail(`${label} public values must be all strings or all finite numbers`, source);
}

function validateValueMap(valueMap, field, label, source) {
  if (!Array.isArray(valueMap) || valueMap.length === 0) {
    fail(`${label}.valueMap must be a non-empty array`, source);
  }
  const internalValues = [];
  const publicValues = [];
  for (const [index, entry] of valueMap.entries()) {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 2 ||
        !Object.hasOwn(entry, 'internal') || !Object.hasOwn(entry, 'public')) {
      fail(`${label}.valueMap[${index}] must contain only internal and public`, source);
    }
    if (typeof entry.public !== 'string' &&
        (typeof entry.public !== 'number' || !Number.isFinite(entry.public))) {
      fail(`${label}.valueMap[${index}].public must be a string or finite number`, source);
    }
    internalValues.push(entry.internal);
    publicValues.push(entry.public);
  }
  requireUnique(internalValues, `${label}.valueMap internal values`, source);
  requireUnique(publicValues, `${label}.valueMap public values`, source);
  if (field.kind === 'enum' &&
      JSON.stringify(internalValues) !== JSON.stringify(field.values)) {
    fail(`${label}.valueMap must cover enum values in params.json order`, source);
  }
  for (const defaultValue of field.defaults) {
    if (!internalValues.some(value => Object.is(value, defaultValue))) {
      fail(`${label}.valueMap does not map default ${defaultValue}`, source);
    }
  }
  return { internalValues, publicValues };
}

function validateParameterOverlay(parameterOverlay, field, label, source) {
  if (!isPlainObject(parameterOverlay)) {
    fail(`${label} must be an object`, source);
  }
  assertOnlyKeys(parameterOverlay, parameterOverlayKeys, label, source);
  if (parameterOverlay.name !== undefined) {
    requireIdentifier(parameterOverlay.name, `${label}.name`, source);
  }
  if (parameterOverlay.unit !== undefined &&
      (typeof parameterOverlay.unit !== 'string' || parameterOverlay.unit.length === 0)) {
    fail(`${label}.unit must be a non-empty string`, source);
  }
  if (parameterOverlay.transform !== undefined) {
    const transform = parameterOverlay.transform;
    if (!isPlainObject(transform) || !transformKinds.has(transform.kind)) {
      fail(`${label}.transform.kind is unsupported`, source);
    }
    const allowed = transform.kind === 'decibelsFromReference'
      ? new Set(['kind', 'reference', 'unit'])
      : new Set(['kind', 'unit']);
    assertOnlyKeys(transform, allowed, `${label}.transform`, source);
    if (field.kind !== 'float' || field.count !== 1) {
      fail(`${label}.transform requires one float field`, source);
    }
    if (transform.kind === 'decibelsFromReference' &&
        requireFinite(transform.reference, `${label}.transform.reference`, source) <= 0) {
      fail(`${label}.transform.reference must be greater than zero`, source);
    }
    if (transform.unit !== undefined &&
        (typeof transform.unit !== 'string' || transform.unit.length === 0)) {
      fail(`${label}.transform.unit must be a non-empty string`, source);
    }
  }
  if (parameterOverlay.allowedValues !== undefined) {
    if (!Array.isArray(parameterOverlay.allowedValues) ||
        parameterOverlay.allowedValues.length === 0) {
      fail(`${label}.allowedValues must be a non-empty array`, source);
    }
    requireUnique(parameterOverlay.allowedValues, `${label}.allowedValues`, source);
    for (const value of parameterOverlay.allowedValues) {
      if (field.kind === 'int' && !Number.isSafeInteger(value)) {
        fail(`${label}.allowedValues must contain safe integers`, source);
      }
      if (field.kind === 'float' && (typeof value !== 'number' || !Number.isFinite(value))) {
        fail(`${label}.allowedValues must contain finite numbers`, source);
      }
      if ((field.kind === 'int' || field.kind === 'float') &&
          (value < field.min || value > field.max)) {
        fail(`${label}.allowedValues contains an out-of-range value`, source);
      }
    }
    for (const defaultValue of field.defaults) {
      if (!parameterOverlay.allowedValues.some(value => Object.is(value, defaultValue))) {
        fail(`${label}.allowedValues does not contain default ${defaultValue}`, source);
      }
    }
  }
  if (parameterOverlay.valueMap !== undefined) {
    validateValueMap(parameterOverlay.valueMap, field, label, source);
  }
  const representations = [
    parameterOverlay.transform !== undefined,
    parameterOverlay.allowedValues !== undefined,
    parameterOverlay.valueMap !== undefined
  ].filter(Boolean).length;
  if (representations > 1) {
    fail(`${label} may declare only one of transform, allowedValues, or valueMap`, source);
  }
}

export function validateEffectOverlay(effectOverlay, spec, source) {
  const label = `effect ${effectOverlay?.type ?? '<unknown>'}`;
  if (!isPlainObject(effectOverlay)) {
    fail(`${label} must be an object`, source);
  }
  assertOnlyKeys(effectOverlay, effectOverlayKeys, label, source);
  requireIdentifier(effectOverlay.type, `${label}.type`, source);
  requireIdentifier(effectOverlay.internalType, `${label}.internalType`, source);
  if (effectOverlay.internalType !== spec.type) {
    fail(`${label}.internalType does not match ${spec.source}`, source);
  }
  const fieldsByName = new Map(spec.fields.map(field => [field.name, field]));
  if (effectOverlay.parameters !== undefined && !isPlainObject(effectOverlay.parameters)) {
    fail(`${label}.parameters must be an object`, source);
  }
  for (const [fieldName, parameterOverlay] of Object.entries(effectOverlay.parameters ?? {})) {
    const field = fieldsByName.get(fieldName);
    if (!field) {
      fail(`${label}.parameters references unknown field ${fieldName}`, source);
    }
    validateParameterOverlay(
      parameterOverlay, field, `${label}.parameters.${fieldName}`, source
    );
  }
  if (effectOverlay.sampleRates !== undefined) {
    if (!Array.isArray(effectOverlay.sampleRates) || effectOverlay.sampleRates.length === 0 ||
        effectOverlay.sampleRates.some(rate => !Number.isSafeInteger(rate) || rate <= 0)) {
      fail(`${label}.sampleRates must contain positive safe integers`, source);
    }
    requireUnique(effectOverlay.sampleRates, `${label}.sampleRates`, source);
  }
  if (effectOverlay.minimumSampleRate !== undefined &&
      (!Number.isSafeInteger(effectOverlay.minimumSampleRate) ||
       effectOverlay.minimumSampleRate <= 0)) {
    fail(`${label}.minimumSampleRate must be a positive safe integer`, source);
  }
  if (effectOverlay.effectiveDelaySamples !== undefined &&
      (!Number.isSafeInteger(effectOverlay.effectiveDelaySamples) ||
       effectOverlay.effectiveDelaySamples < 0)) {
    fail(`${label}.effectiveDelaySamples must be a non-negative safe integer`, source);
  }
  if (effectOverlay.seeded !== undefined && effectOverlay.seeded !== true) {
    fail(`${label}.seeded may only be the exception marker true`, source);
  }
  if (effectOverlay.telemetry !== undefined) {
    if (!Array.isArray(effectOverlay.telemetry) || effectOverlay.telemetry.length === 0 ||
        effectOverlay.telemetry.some(tag =>
          typeof tag !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(tag))) {
      fail(`${label}.telemetry must contain semantic lower-camel-case tags`, source);
    }
    requireUnique(effectOverlay.telemetry, `${label}.telemetry`, source);
  }
  if (effectOverlay.latency !== undefined) {
    if (!isPlainObject(effectOverlay.latency) ||
        !latencyKinds.has(effectOverlay.latency.kind) ||
        !Array.isArray(effectOverlay.latency.dependsOn) ||
        effectOverlay.latency.dependsOn.length === 0 ||
        effectOverlay.latency.dependsOn.some(item =>
          typeof item !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(item))) {
      fail(`${label}.latency must declare a supported kind and dependency names`, source);
    }
    assertOnlyKeys(
      effectOverlay.latency, new Set(['kind', 'dependsOn']), `${label}.latency`, source
    );
  }
  if (effectOverlay.assets !== undefined) {
    if (!Array.isArray(effectOverlay.assets) || effectOverlay.assets.length === 0) {
      fail(`${label}.assets must be a non-empty array`, source);
    }
    for (const [index, asset] of effectOverlay.assets.entries()) {
      if (!isPlainObject(asset)) {
        fail(`${label}.assets[${index}] must be an object`, source);
      }
      assertOnlyKeys(
        asset, new Set(['name', 'kind', 'slot', 'required']), `${label}.assets[${index}]`, source
      );
      requireIdentifier(asset.name, `${label}.assets[${index}].name`, source);
      requireIdentifier(asset.kind, `${label}.assets[${index}].kind`, source);
      if (!Number.isSafeInteger(asset.slot) || asset.slot < 0 || asset.required !== true) {
        fail(`${label}.assets[${index}] must declare a non-negative slot and required true`, source);
      }
      if (!spec.assets.some(sourceAsset => sourceAsset.slot === asset.slot)) {
        fail(`${label}.assets[${index}] references an undeclared params.json slot`, source);
      }
    }
  }
}

function convertTransformedValue(value, transform) {
  if (!transform) {
    return value;
  }
  if (transform.kind === 'naturalLog') {
    return Math.exp(value);
  }
  if (transform.kind === 'log10') {
    return 10 ** value;
  }
  return transform.reference * (10 ** (value / 20));
}

function parameterType(field) {
  if (field.kind === 'float') return 'number';
  if (field.kind === 'int') return 'integer';
  if (field.kind === 'bool') return 'boolean';
  return 'string';
}

function buildParameter(field, rawField, parameterOverlay, offset, source) {
  const publicName = parameterOverlay.name ?? field.name;
  const valueMap = parameterOverlay.valueMap
    ? validateValueMap(parameterOverlay.valueMap, field, publicName, source)
    : null;
  const toPublic = value => {
    if (valueMap) {
      const index = valueMap.internalValues.findIndex(candidate => Object.is(candidate, value));
      return valueMap.publicValues[index];
    }
    return convertTransformedValue(value, parameterOverlay.transform);
  };
  const publicType = valueMap
    ? publicValueType(valueMap.publicValues, `${publicName}.valueMap`, source)
    : parameterType(field);
  const defaults = field.defaults.map(toPublic);
  const descriptor = {
    name: publicName,
    type: publicType,
    count: field.count,
    default: field.count === 1 ? defaults[0] : defaults
  };
  const unit = parameterOverlay.unit ?? parameterOverlay.transform?.unit ?? rawField?.unit;
  if (unit !== undefined) {
    descriptor.unit = unit;
  }
  if (valueMap) {
    descriptor.values = valueMap.publicValues;
  } else if (parameterOverlay.allowedValues) {
    descriptor.values = parameterOverlay.allowedValues;
  } else if (field.kind === 'enum') {
    descriptor.values = field.values;
  } else if (field.kind === 'float' || field.kind === 'int') {
    descriptor.minimum = convertTransformedValue(field.min, parameterOverlay.transform);
    descriptor.maximum = convertTransformedValue(field.max, parameterOverlay.transform);
  }
  const transform = valueMap
    ? {
        kind: 'map',
        values: parameterOverlay.valueMap.map(entry => ({
          public: entry.public,
          internal: entry.internal
        }))
      }
    : parameterOverlay.transform
      ? {
          kind: parameterOverlay.transform.kind,
          ...(parameterOverlay.transform.reference !== undefined
            ? { reference: parameterOverlay.transform.reference }
            : {})
        }
      : { kind: 'identity' };
  const implementation = {
    publicName,
    field: field.name,
    keys: field.keys,
    offset,
    count: field.count,
    transform
  };
  return { descriptor, implementation };
}

function loadFrozenParamSpecs() {
  return Object.entries(FROZEN_PARAM_DIRECTORIES).map(([type, directory]) => {
    const specs = loadParamSpecs(path.join(repoRoot, directory));
    if (specs.length !== 1 || specs[0].type !== type) {
      fail(`frozen parameter source for ${type} is missing or ambiguous`);
    }
    return specs[0];
  });
}

export function buildCatalog({
  specs = null,
  overlayFile = overlayPath
} = {}) {
  const { overlay, source } = loadOverlay(overlayFile);
  specs ??= loadFrozenParamSpecs();
  const specsByType = new Map(specs.map(spec => [spec.type, spec]));
  const effects = [];
  for (const effectOverlay of overlay.effects) {
    const spec = specsByType.get(effectOverlay.internalType);
    if (!spec) {
      fail(`missing params.json for ${effectOverlay.internalType}`, source);
    }
    validateEffectOverlay(effectOverlay, spec, source);
    const rawFields = rawFieldsFor(spec);
    const parameters = [];
    const packedParameters = [];
    const publicNames = new Set();
    let offset = 0;
    for (const field of spec.fields) {
      const parameterOverlay = effectOverlay.parameters?.[field.name] ?? {};
      const { descriptor, implementation } = buildParameter(
        field, rawFields.get(field.name), parameterOverlay, offset, source
      );
      if (publicNames.has(descriptor.name)) {
        fail(`effect ${effectOverlay.type} has duplicate public parameter ${descriptor.name}`, source);
      }
      publicNames.add(descriptor.name);
      parameters.push(descriptor);
      packedParameters.push(implementation);
      offset += field.count;
    }
    let structuredParameter = null;
    if (spec.structured) {
      if (publicNames.has(spec.structured.name)) {
        fail(
          `effect ${effectOverlay.type} has duplicate public parameter ${spec.structured.name}`,
          source
        );
      }
      publicNames.add(spec.structured.name);
      parameters.push({
        name: spec.structured.name,
        type: 'string',
        count: 1,
        default: spec.structured.defaultValue,
        maximumLength: spec.structured.maxItems * 3,
        pattern: '^(?:p?[0-8][0-8])*$'
      });
      structuredParameter = {
        publicName: spec.structured.name,
        key: spec.structured.key,
        codec: spec.structured.codec,
        maxItems: spec.structured.maxItems,
        byteCapacity: spec.structured.byteCapacity
      };
    }
    const assets = (effectOverlay.assets ?? []).map(asset => {
      const sourceAsset = spec.assets.find(candidate => candidate.slot === asset.slot);
      return {
        name: asset.name,
        kind: asset.kind,
        required: true,
        implementation: {
          slot: sourceAsset.slot,
          format: sourceAsset.format,
          capacity: sourceAsset.capacity
        }
      };
    });
    effects.push({
      type: effectOverlay.type,
      parameters,
      seeded: effectOverlay.seeded === true,
      ...(effectOverlay.sampleRates ? { sampleRates: effectOverlay.sampleRates } : {}),
      ...(effectOverlay.minimumSampleRate !== undefined
        ? { minimumSampleRate: effectOverlay.minimumSampleRate }
        : {}),
      ...(effectOverlay.effectiveDelaySamples !== undefined
        ? { effectiveDelaySamples: effectOverlay.effectiveDelaySamples }
        : {}),
      telemetry: effectOverlay.telemetry ?? [],
      latency: effectOverlay.latency ?? { kind: 'zero' },
      assets,
      implementation: {
        internalType: spec.type,
        source: spec.source,
        layoutHash: spec.hash,
        floatCount: spec.floatCount,
        packedParameters,
        structuredParameter
      }
    });
  }
  return {
    version: 1,
    channels: [...EFFECT_CHANNELS],
    effects
  };
}

function scalarSchema(parameter) {
  const schema = { type: parameter.type };
  if (parameter.values) {
    schema.enum = parameter.values;
  } else if (parameter.minimum !== undefined) {
    schema.minimum = parameter.minimum;
    schema.maximum = parameter.maximum;
  }
  if (parameter.unit) {
    schema['x-effetune-unit'] = parameter.unit;
  }
  if (parameter.maximumLength !== undefined) {
    schema.maxLength = parameter.maximumLength;
  }
  if (parameter.pattern !== undefined) {
    schema.pattern = parameter.pattern;
  }
  return schema;
}

function parameterSchema(parameter) {
  if (parameter.count === 1) {
    return {
      ...scalarSchema(parameter),
      default: parameter.default
    };
  }
  return {
    type: 'array',
    minItems: parameter.count,
    maxItems: parameter.count,
    items: scalarSchema(parameter),
    default: parameter.default
  };
}

function effectSchema(effect) {
  const properties = {};
  for (const parameter of effect.parameters) {
    properties[parameter.name] = parameterSchema(parameter);
  }
  const definition = {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'parameters'],
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        maxLength: 128
      },
      type: {
        const: effect.type
      },
      enabled: {
        type: 'boolean',
        default: true
      },
      channel: {
        $ref: '#/$defs/channel'
      },
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties
      }
    }
  };
  if (effect.assets.length !== 0) {
    const assetProperties = {};
    const required = [];
    for (const asset of effect.assets) {
      assetProperties[asset.name] = { $ref: '#/$defs/assetReference' };
      if (asset.required) required.push(asset.name);
    }
    definition.properties.assets = {
      type: 'object',
      additionalProperties: false,
      required,
      properties: assetProperties
    };
    definition.required.push('assets');
  }
  return definition;
}

function chainSchema(catalog) {
  const definitions = {
    channel: {
      type: 'string',
      enum: [...EFFECT_CHANNELS],
      default: 'all'
    },
    assetReference: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Opaque bundle asset ID or resolver key.'
    },
    effect: {
      oneOf: catalog.effects.map(effect => ({
        $ref: `#/$defs/${effect.type}`
      }))
    }
  };
  for (const effect of catalog.effects) {
    definitions[effect.type] = effectSchema(effect);
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: chainSchemaId,
    title: 'EffeTune DSP Chain v1',
    description:
      'Canonical semantic v1 ordered serial effect chain. Application pipeline/plugins presets are not accepted.',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'chain'],
    properties: {
      version: {
        type: 'integer',
        const: 1
      },
      chain: {
        type: 'array',
        description: 'Effects in processing order; an empty chain is the identity.',
        items: {
          $ref: '#/$defs/effect'
        }
      }
    },
    $comment: 'Duplicate explicit effect IDs are rejected by the runtime because JSON Schema cannot express uniqueness by one object property.',
    $defs: definitions
  };
}

function bundleSchema() {
  const topologyNames = ['unspecified', 'mono', 'independent', 'trueStereo', 'matrix'];
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: bundleSchemaId,
    title: 'EffeTune DSP Bundle v1',
    description:
      'Manifest form for a canonical chain and bounded external impulse-response assets. Container and transport are outside this schema.',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'chain', 'assets'],
    properties: {
      version: {
        type: 'integer',
        const: 1
      },
      chain: {
        $ref: chainSchemaId
      },
      assets: {
        type: 'array',
        maxItems: 64,
        items: {
          $ref: '#/$defs/asset'
        }
      }
    },
    $comment: 'Duplicate asset IDs, missing chain references, digest verification, and byteLength === 32 + pathCount*12 + channels*frames*4 are runtime validation responsibilities.',
    $defs: {
      asset: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'reference', 'sha256', 'byteLength', 'format'],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 128
          },
          kind: {
            const: 'impulseResponse'
          },
          reference: {
            type: 'string',
            minLength: 1,
            maxLength: 2048,
            description: 'Opaque resolver reference. The bundle schema does not require ZIP or filesystem paths.'
          },
          sha256: {
            type: 'string',
            pattern: '^[0-9a-f]{64}$'
          },
          byteLength: {
            type: 'integer',
            minimum: 36,
            maximum: maximumAssetBytes
          },
          format: {
            type: 'object',
            additionalProperties: false,
            required: [
              'formatTag', 'magic', 'headerBytes', 'pathRecordBytes', 'sampleType',
              'byteOrder', 'layout', 'channels', 'frames', 'sampleRate', 'topology',
              'pathCount', 'reservedBytes'
            ],
            properties: {
              formatTag: {
                type: 'integer',
                const: 1,
                description: 'ET_ASSET_F32_MULTICH format tag.'
              },
              magic: {
                const: 'ETA1',
                description: 'ASCII bytes stored at payload offsets 0..3.'
              },
              headerBytes: {
                type: 'integer',
                const: 32
              },
              pathRecordBytes: {
                type: 'integer',
                const: 12
              },
              reservedBytes: {
                type: 'integer',
                const: 8,
                description: 'Zero-filled payload header bytes at offsets 24..31.'
              },
              sampleType: {
                const: 'float32'
              },
              byteOrder: {
                const: 'little-endian'
              },
              layout: {
                const: 'planar'
              },
              channels: {
                type: 'integer',
                minimum: 1,
                maximum: 8
              },
              frames: {
                type: 'integer',
                minimum: 1,
                maximum: (maximumAssetBytes - 32) / 4
              },
              sampleRate: {
                type: 'integer',
                minimum: 1,
                maximum: maximumUint32
              },
              topology: {
                type: 'string',
                enum: topologyNames,
                description:
                  'Decoded uint32 header tag: unspecified=0, mono=1, independent=2, trueStereo=3, matrix=4.'
              },
              pathCount: {
                type: 'integer',
                minimum: 0,
                maximum: 8
              },
              paths: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                description:
                  'Matrix routes. Distinct inputSlot values must be exactly 0..N-1, and N must not exceed the selected effect processing-channel count.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['inputSlot', 'outputSlot', 'irChannel'],
                  properties: {
                    inputSlot: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 7,
                      description:
                        'Zero-based matrix input; the set of input slots must be contiguous from 0.'
                    },
                    outputSlot: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 7
                    },
                    irChannel: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 7
                    }
                  }
                }
              }
            },
            allOf: [
              {
                if: {
                  properties: {
                    topology: {
                      const: 'matrix'
                    }
                  },
                  required: ['topology']
                },
                then: {
                  required: ['paths'],
                  properties: {
                    pathCount: {
                      type: 'integer',
                      minimum: 1,
                      maximum: 8
                    }
                  }
                },
                else: {
                  properties: {
                    pathCount: {
                      const: 0
                    }
                  },
                  not: {
                    required: ['paths']
                  }
                }
              }
            ]
          }
        }
      }
    }
  };
}

function publicCatalog(catalog) {
  return {
    version: catalog.version,
    channels: [...EFFECT_CHANNELS],
    effects: catalog.effects.map(effect => ({
      type: effect.type,
      parameters: effect.parameters,
      seeded: effect.seeded,
      ...(effect.sampleRates ? { sampleRates: effect.sampleRates } : {}),
      ...(effect.minimumSampleRate !== undefined
        ? { minimumSampleRate: effect.minimumSampleRate }
        : {}),
      ...(effect.effectiveDelaySamples !== undefined
        ? { effectiveDelaySamples: effect.effectiveDelaySamples }
        : {}),
      telemetry: effect.telemetry,
      latency: effect.latency,
      assets: effect.assets.map(asset => ({
        name: asset.name,
        kind: asset.kind,
        required: asset.required
      }))
    }))
  };
}

function privateCatalog(catalog) {
  return {
    version: catalog.version,
    channelMapping: { ...channelImplementation },
    effects: Object.fromEntries(catalog.effects.map(effect => [
      effect.type,
      {
        internalType: effect.implementation.internalType,
        layoutHash: effect.implementation.layoutHash,
        floatCount: effect.implementation.floatCount,
        packedParameters: effect.implementation.packedParameters,
        ...(effect.implementation.structuredParameter
          ? { structuredParameter: effect.implementation.structuredParameter }
          : {}),
        assets: effect.assets.map(asset => ({
          publicName: asset.name,
          ...asset.implementation
        }))
      }
    ]))
  };
}

function frozenGoldenIndexes(catalog) {
  return Object.fromEntries(catalog.effects.map(effect => {
    const source = effect.implementation.source;
    return [
      source,
      path.posix.join(path.posix.dirname(source), 'golden', 'index.json')
    ];
  }));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function contractDigests(catalog) {
  return {
    publicCatalogSha256: sha256(publicCatalog(catalog)),
    privateLayoutSha256: sha256(privateCatalog(catalog))
  };
}

function snakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function pythonLiteral(value) {
  if (Array.isArray(value)) {
    const members = value.map(pythonLiteral);
    return `(${members.join(', ')}${members.length === 1 ? ',' : ''})`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  if (value === null) {
    return 'None';
  }
  if (Object.is(value, -0)) {
    return '-0.0';
  }
  return String(value);
}

function pythonForCatalog(catalog) {
  const metadataLiteral = JSON.stringify(JSON.stringify(publicCatalog(catalog)));
  const implementationLiteral = JSON.stringify(JSON.stringify(privateCatalog(catalog).effects));
  const chunks = [
    '# Generated by scripts/gen-dsp-library-bindings.mjs. Do not edit.\n',
    '# The runtime contract is Effect(effect_type, *, parameters=None, id=None,\n',
    '# enabled=True, channel="all", assets=None) from effetune._base.\n\n',
    'import json as _json\n\n',
    'from ._base import Effect\n',
    'from .errors import EffectError\n\n',
    `EFFECT_METADATA = _json.loads(${metadataLiteral})\n`,
    `_EFFECT_IMPLEMENTATION = _json.loads(${implementationLiteral})\n\n`
  ];
  for (const effect of catalog.effects) {
    const argumentsList = effect.parameters.map(parameter =>
      `${snakeCase(parameter.name)}=${pythonLiteral(parameter.default)}`
    );
    argumentsList.push('id=None', 'enabled=True', 'channel="all"');
    if (effect.assets.length !== 0) {
      argumentsList.push('assets=None');
    }
    chunks.push(`class ${effect.type}(Effect):\n`);
    chunks.push(`    """Thin semantic wrapper for ${effect.type}."""\n\n`);
    chunks.push(`    effect_type = ${JSON.stringify(effect.type)}\n\n`);
    chunks.push('    def __init__(\n');
    chunks.push('        self,\n');
    chunks.push('        *,\n');
    for (const argument of argumentsList) {
      chunks.push(`        ${argument},\n`);
    }
    chunks.push('    ):\n');
    chunks.push('        super().__init__(\n');
    chunks.push('            self.effect_type,\n');
    chunks.push('            parameters={\n');
    for (const parameter of effect.parameters) {
      chunks.push(
        `                ${JSON.stringify(parameter.name)}: ${snakeCase(parameter.name)},\n`
      );
    }
    chunks.push('            },\n');
    chunks.push('            id=id,\n');
    chunks.push('            enabled=enabled,\n');
    chunks.push('            channel=channel,\n');
    if (effect.assets.length !== 0) {
      chunks.push('            assets=assets,\n');
    }
    chunks.push('        )\n\n\n');
  }
  chunks.push('EFFECT_CLASSES = {\n');
  for (const effect of catalog.effects) {
    chunks.push(`    ${JSON.stringify(effect.type)}: ${effect.type},\n`);
  }
  chunks.push('}\n\n');
  chunks.push('def create_effect(effect_type, **options):\n');
  chunks.push('    """Create one of the frozen v1 semantic effect classes."""\n');
  chunks.push('    try:\n');
  chunks.push('        effect_class = EFFECT_CLASSES[effect_type]\n');
  chunks.push('    except KeyError as error:\n');
  chunks.push('        raise EffectError(f"Unknown effect type: {effect_type}") from error\n');
  chunks.push('    return effect_class(**options)\n\n');
  chunks.push('__all__ = [\n');
  chunks.push('    "EFFECT_CLASSES",\n');
  chunks.push('    "EFFECT_METADATA",\n');
  chunks.push('    "create_effect",\n');
  for (const effect of catalog.effects) {
    chunks.push(`    ${JSON.stringify(effect.type)},\n`);
  }
  chunks.push(']\n');
  return chunks.join('');
}

function pythonParameterType(parameter) {
  let scalar;
  if (parameter.values) {
    scalar = `Literal[${parameter.values.map(pythonLiteral).join(', ')}]`;
  } else if (parameter.type === 'string') {
    scalar = 'str';
  } else if (parameter.type === 'boolean') {
    scalar = 'bool';
  } else if (parameter.type === 'integer') {
    scalar = 'int';
  } else {
    scalar = 'float';
  }
  if (parameter.count === 1) {
    return scalar;
  }
  return `tuple[${Array.from({ length: parameter.count }, () => scalar).join(', ')}]`;
}

function pythonStubForCatalog(catalog) {
  const channelType = EFFECT_CHANNELS.map(pythonLiteral).join(', ');
  const chunks = [
    '# Generated by scripts/gen-dsp-library-bindings.mjs. Do not edit.\n',
    'from typing import Literal, TypeAlias, TypedDict\n\n',
    'from ._base import Effect\n\n',
    `EffectChannel: TypeAlias = Literal[${channelType}]\n\n`,
    'class IRReverbAssets(TypedDict):\n',
    '    impulseResponse: str\n\n',
    'EFFECT_METADATA: dict[str, object]\n',
    '_EFFECT_IMPLEMENTATION: dict[str, dict[str, object]]\n\n'
  ];
  for (const effect of catalog.effects) {
    chunks.push(`class ${effect.type}(Effect):\n`);
    chunks.push(`    effect_type: Literal[${pythonLiteral(effect.type)}]\n`);
    chunks.push('    def __init__(\n');
    chunks.push('        self,\n');
    chunks.push('        *,\n');
    for (const parameter of effect.parameters) {
      chunks.push(
        `        ${snakeCase(parameter.name)}: ${pythonParameterType(parameter)} = ...,\n`
      );
    }
    chunks.push('        id: str | None = ...,\n');
    chunks.push('        enabled: bool = ...,\n');
    chunks.push('        channel: EffectChannel = ...,\n');
    if (effect.assets.length !== 0) {
      chunks.push('        assets: IRReverbAssets,\n');
    }
    chunks.push('    ) -> None: ...\n\n');
  }
  chunks.push('EFFECT_CLASSES: dict[str, type[Effect]]\n');
  chunks.push('def create_effect(effect_type: str, **options: object) -> Effect: ...\n\n');
  chunks.push('__all__: list[str]\n');
  return chunks.join('');
}

function jsLiteral(value) {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    character => unsafeJsLiteralCharacters[character]
  );
}

function jsForCatalog(catalog) {
  const chunks = [
    '// Generated by scripts/gen-dsp-library-bindings.mjs. Do not edit.\n',
    "import { Effect } from './effect.js';\n",
    "import { EffectError } from './errors.js';\n\n",
    `export const EFFECT_METADATA = Object.freeze(JSON.parse(${jsLiteral(JSON.stringify(publicCatalog(catalog)))}));\n\n`,
    '// Package-internal runtime mapping. Public entry points must not re-export this symbol.\n',
    `export const _EFFECT_IMPLEMENTATION = Object.freeze(JSON.parse(${jsLiteral(JSON.stringify(privateCatalog(catalog).effects))}));\n\n`,
    `export const EFFECT_TYPES = Object.freeze(${jsLiteral(catalog.effects.map(effect => effect.type))});\n\n`
  ];
  for (const effect of catalog.effects) {
    chunks.push(`export class ${effect.type} extends Effect {\n`);
    chunks.push(`  static effectType = ${jsLiteral(effect.type)};\n\n`);
    chunks.push('  constructor(options = {}) {\n');
    chunks.push(`    super(${jsLiteral(effect.type)}, options);\n`);
    chunks.push('  }\n');
    chunks.push('}\n\n');
    chunks.push(`export function create${effect.type}(options = {}) {\n`);
    chunks.push(`  return new ${effect.type}(options);\n`);
    chunks.push('}\n\n');
  }
  chunks.push('export const EFFECT_CLASSES = new Map([\n');
  for (const effect of catalog.effects) {
    chunks.push(`  [${jsLiteral(effect.type)}, ${effect.type}],\n`);
  }
  chunks.push(']);\n\n');
  chunks.push('export function createEffect(type, options = {}) {\n');
  chunks.push('  const EffectClass = EFFECT_CLASSES.get(type);\n');
  chunks.push('  if (!EffectClass) throw new EffectError(`Unknown effect type: ${type}`);\n');
  chunks.push('  return new EffectClass(options);\n');
  chunks.push('}\n');
  return chunks.join('');
}

function tsLiteral(value) {
  return typeof value === 'string' ? jsLiteral(value) : String(value);
}

function tupleType(memberType, count) {
  return `readonly [${Array.from({ length: count }, () => memberType).join(', ')}]`;
}

function tsParameterType(parameter) {
  let scalar;
  if (parameter.values) {
    scalar = parameter.values.map(tsLiteral).join(' | ');
  } else if (parameter.type === 'string') {
    scalar = 'string';
  } else if (parameter.type === 'boolean') {
    scalar = 'boolean';
  } else {
    scalar = 'number';
  }
  return parameter.count === 1 ? scalar : tupleType(scalar, parameter.count);
}

function tsForCatalog(catalog) {
  const requiredAssetTypes = catalog.effects
    .filter(effect => effect.assets.length !== 0)
    .map(effect => jsLiteral(effect.type))
    .join(' | ');
  const chunks = [
    '// Generated by scripts/gen-dsp-library-bindings.mjs. Do not edit.\n',
    "import { Effect } from './effect.js';\n\n",
    `export type EffectType = ${catalog.effects.map(effect => jsLiteral(effect.type)).join(' | ')};\n`,
    `type RequiredAssetEffectType = ${requiredAssetTypes};\n`,
    `export type EffectChannel = ${EFFECT_CHANNELS.map(jsLiteral).join(' | ')};\n\n`,
    'export interface CommonEffectOptions {\n',
    '  readonly id?: string;\n',
    '  readonly enabled?: boolean;\n',
    '  readonly channel?: EffectChannel;\n',
    '}\n\n',
    'export interface IRReverbAssets {\n',
    '  readonly impulseResponse: string;\n',
    '}\n\n'
  ];
  for (const effect of catalog.effects) {
    chunks.push(`export interface ${effect.type}Options extends CommonEffectOptions {\n`);
    for (const parameter of effect.parameters) {
      chunks.push(`  readonly ${parameter.name}?: ${tsParameterType(parameter)};\n`);
    }
    chunks.push(effect.assets.length === 0
      ? '  readonly assets?: never;\n'
      : '  readonly assets: IRReverbAssets;\n');
    chunks.push('}\n\n');
    chunks.push(`export declare class ${effect.type} extends Effect {\n`);
    chunks.push(`  static readonly effectType: ${jsLiteral(effect.type)};\n`);
    chunks.push(effect.assets.length === 0
      ? `  constructor(options?: ${effect.type}Options);\n`
      : `  constructor(options: ${effect.type}Options);\n`);
    chunks.push('}\n\n');
    chunks.push(effect.assets.length === 0
      ? `export declare function create${effect.type}(options?: ${effect.type}Options): ${effect.type};\n\n`
      : `export declare function create${effect.type}(options: ${effect.type}Options): ${effect.type};\n\n`);
  }
  chunks.push('export interface EffectOptionsByType {\n');
  for (const effect of catalog.effects) {
    chunks.push(`  readonly ${effect.type}: ${effect.type}Options;\n`);
  }
  chunks.push('}\n\n');
  chunks.push('export interface EffectClassByType {\n');
  for (const effect of catalog.effects) {
    chunks.push(`  readonly ${effect.type}: ${effect.type};\n`);
  }
  chunks.push('}\n\n');
  chunks.push('export declare const EFFECT_TYPES: readonly EffectType[];\n');
  chunks.push('export declare const EFFECT_METADATA: Readonly<Record<string, unknown>>;\n');
  chunks.push('/** @internal Package-internal runtime mapping; not re-exported publicly. */\n');
  chunks.push('export declare const _EFFECT_IMPLEMENTATION: Readonly<Record<EffectType, unknown>>;\n');
  chunks.push('export declare const EFFECT_CLASSES: ReadonlyMap<EffectType, typeof Effect>;\n');
  chunks.push('export declare function createEffect<T extends EffectType>(\n');
  chunks.push('  type: T,\n');
  chunks.push('  ...options: T extends RequiredAssetEffectType\n');
  chunks.push('    ? [options: EffectOptionsByType[T]]\n');
  chunks.push('    : [options?: EffectOptionsByType[T]]\n');
  chunks.push('): EffectClassByType[T];\n');
  return chunks.join('');
}

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateOutputs(catalog = buildCatalog()) {
  const digests = contractDigests(catalog);
  const publicOutput = {
    ...publicCatalog(catalog),
    contractDigests: digests
  };
  const privateOutput = {
    ...privateCatalog(catalog),
    frozenGoldenIndexes: frozenGoldenIndexes(catalog),
    contractDigest: digests.privateLayoutSha256
  };
  return new Map([
    [path.join(generatedRoot, 'effects-v1.json'), jsonFile(publicOutput)],
    [path.join(generatedRoot, 'effects-v1.private.json'), jsonFile(privateOutput)],
    [path.join(schemaRoot, 'chain-v1.schema.json'), jsonFile(chainSchema(catalog))],
    [path.join(schemaRoot, 'bundle-v1.schema.json'), jsonFile(bundleSchema())],
    [pythonOutput, pythonForCatalog(catalog)],
    [pythonStubOutput, pythonStubForCatalog(catalog)],
    [jsOutput, jsForCatalog(catalog)],
    [tsOutput, tsForCatalog(catalog)]
  ]);
}

function updateOutputs(outputs, check) {
  const stale = [];
  for (const [filePath, contents] of outputs) {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (current === contents) {
      continue;
    }
    stale.push(path.relative(repoRoot, filePath).replaceAll('\\', '/'));
    if (!check) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents, 'utf8');
    }
  }
  return stale;
}

function updateContractDigestSource(digests) {
  const overlay = readJson(overlayPath);
  overlay.contractDigests = digests;
  fs.writeFileSync(overlayPath, jsonFile(overlay), 'utf8');
}

export function verifyContractDigests(catalog) {
  const { overlay, source } = loadOverlay();
  const expected = overlay.contractDigests;
  const actual = contractDigests(catalog);
  if (!expected ||
      expected.publicCatalogSha256 !== actual.publicCatalogSha256 ||
      expected.privateLayoutSha256 !== actual.privateLayoutSha256) {
    fail(
      'frozen v1 contract digest mismatch; inspect the params/overlay change, then run ' +
      'with --update-contract-digests only for an intentional contract revision',
      source
    );
  }
  return actual;
}

export function runGenerator({ check = false, updateContractDigests = false } = {}) {
  if (check && updateContractDigests) {
    fail('--check and --update-contract-digests cannot be combined');
  }
  const catalog = buildCatalog();
  validateConvenienceExports(catalog);
  const digests = contractDigests(catalog);
  if (updateContractDigests) {
    updateContractDigestSource(digests);
  } else {
    verifyContractDigests(catalog);
  }
  const stale = updateOutputs(generateOutputs(catalog), check);
  return { catalog, digests, stale };
}

function printHelp() {
  console.log(
    'Usage: node scripts/gen-dsp-library-bindings.mjs ' +
    '[--check | --update-contract-digests]'
  );
  console.log('  default  validate sources and update deterministic Phase 1 binding contracts');
  console.log('  --check  fail if generated outputs are stale; write nothing');
  console.log(
    '  --update-contract-digests  accept an intentional reviewed v1 contract change and regenerate'
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    printHelp();
    return;
  }
  const unknown = args.filter(argument =>
    argument !== '--check' && argument !== '--update-contract-digests'
  );
  if (unknown.length !== 0) {
    fail(`unknown argument(s): ${unknown.join(', ')}`);
  }
  const check = args.includes('--check');
  const updateContractDigests = args.includes('--update-contract-digests');
  const { catalog, stale } = runGenerator({ check, updateContractDigests });
  if (check && stale.length !== 0) {
    console.error('DSP library binding outputs are stale:');
    for (const file of stale) {
      console.error(`  ${file}`);
    }
    process.exitCode = 1;
    return;
  }
  const action = check
    ? 'Checked'
    : updateContractDigests
      ? 'Accepted and generated'
      : 'Generated';
  console.log(`${action} ${catalog.effects.length} public DSP effect binding(s).`);
}

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
