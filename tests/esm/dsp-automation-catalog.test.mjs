import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildAutomationCatalog,
  generateOutputs,
  loadParamSpecs,
  runGenerator,
  validateAutomationCompatibility,
  validateParamSpec
} from '../../scripts/gen-dsp-params.mjs';
import {
  guardedParityOptions,
  parseVerificationArguments,
  usage as automationUsage
} from '../../tools/verify-dsp-automation.mjs';

function spec(type, fields) {
  return validateParamSpec({
    type,
    tolerance: { abs: 1e-6 },
    fields
  });
}

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

function bodyBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source contract: ${start}`);
  assert.notEqual(endIndex, -1, `missing source contract boundary: ${end}`);
  return text.slice(startIndex, endIndex);
}

async function generatedModule(specs) {
  const source = [...generateOutputs(specs)]
    .find(([file]) => file.endsWith('dsp-params.generated.js'))[1];
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('production schemas expose the audited automation population', async () => {
  const specs = loadParamSpecs();
  const catalog = buildAutomationCatalog(specs);
  const entries = Object.entries(catalog.effects);
  const privateEffects = entries
    .filter(([, parameters]) => parameters.length === 0)
    .map(([type]) => type);

  assert.equal(entries.length, 99);
  assert.equal(entries.filter(([, parameters]) => parameters.length !== 0).length, 87);
  assert.equal(entries.reduce((count, [, parameters]) => count + parameters.length, 0), 951);
  for (const effect of specs) {
    const expectedLeaves = [];
    let packedOffset = 0;
    for (const field of effect.fields) {
      if (field.automation) {
        for (let element = 0; element < field.count; ++element) {
          expectedLeaves.push({
            key: field.key,
            publicName: field.publicName,
            element,
            field: field.keys[element],
            packedOffset: packedOffset + element
          });
        }
      }
      packedOffset += field.count;
    }
    assert.deepEqual(
      catalog.effects[effect.type].map(parameter => ({
        key: parameter.key,
        publicName: parameter.publicName,
        element: parameter.element,
        field: parameter.field,
        packedOffset: parameter.packedOffset
      })),
      expectedLeaves,
      `${effect.type} automation must match the opted-in leaf fields exactly`
    );
  }
  assert.equal(
    createHash('sha256').update(JSON.stringify(catalog.effects)).digest('hex'),
    '06f94bce612763e4cfddf123e3c153e209bd33276c45eba2ccb8cc595b3b1d99'
  );
  assert.deepEqual(privateEffects, [
    'FIRCrossoverPlugin', 'FiveBandFIRPEQPlugin', 'GroupDelayEqPlugin',
    'GroupDelayPEQPlugin', 'LevelMeterPlugin', 'MatrixPlugin', 'MutePlugin',
    'OscilloscopePlugin', 'PolarityInversionPlugin', 'SpectrogramPlugin',
    'SpectrumAnalyzerPlugin', 'StereoMeterPlugin'
  ]);
  const nonAutomatedByReason = {
    analyzerOnly: {
      OscilloscopePlugin: [
        'displayTime', 'triggerMode', 'triggerLevel', 'triggerEdge', 'holdoff',
        'displayLevel', 'verticalOffset'
      ],
      SpectrogramPlugin: ['dBRange', 'points'],
      SpectrumAnalyzerPlugin: ['dBRange', 'points'],
      StereoMeterPlugin: ['windowTime']
    },
    requiresAssetRestage: {
      FIRCrossoverPlugin: ['latencyMode', 'filterDelaySamples', 'bandCount'],
      FiveBandFIRPEQPlugin: ['latencyMode', 'filterDelaySamples'],
      GroupDelayEqPlugin: ['latencyMode', 'filterDelaySamples'],
      GroupDelayPEQPlugin: ['latencyMode', 'filterDelaySamples'],
      IRReverbPlugin: ['channelMode', 'latency', 'convRate'],
      CrosstalkCancellationPlugin: ['latencyMode', 'filterDelaySamples'],
      RoomEqPlugin: ['latencyMode', 'filterDelaySamples']
    },
    changesCompensatedLatency: {
      BrickwallLimiterPlugin: ['lookahead', 'oversampling']
    },
    violatesCoupledFrequencyOrder: {
      MultibandBalancePlugin: ['frequency4'],
      MultibandCompressorPlugin: ['frequency4'],
      MultibandExpanderPlugin: ['frequency4']
    },
    coercesAnotherParameter: {
      OscillatorPlugin: ['waveform']
    },
    reconfiguresTemporalState: {
      PitchShifterPlugin: ['windowSize', 'crossfadeTime']
    },
    lacksDeterministicTransitionParity: {
      VinylSimulatorPlugin: ['stylusShape']
    },
    uiOnly: {
      MultiChannelPanelPlugin: ['link']
    }
  };
  const expectedNonAutomated = Object.assign({}, ...Object.values(nonAutomatedByReason));
  const actualNonAutomated = Object.fromEntries(specs.flatMap(effect => {
    const fields = effect.fields.filter(field => !field.automation).map(field => field.name);
    return fields.length === 0 ? [] : [[effect.type, fields]];
  }));
  assert.deepEqual(actualNonAutomated, expectedNonAutomated);
  assert.deepEqual(Object.fromEntries(specs.flatMap(effect => effect.fields
    .filter(field => field.automation && field.publicName !== field.name)
    .map(field => [`${effect.type}.${field.name}`, field.publicName]))), {
    'DigitalErrorEmulatorPlugin.bitErrorRateExponent': 'bitErrorRate',
    'DigitalErrorEmulatorPlugin.referenceFs': 'referenceSampleRate',
    'FifteenBandPEQPlugin.frequency': 'frequencies',
    'FifteenBandPEQPlugin.gain': 'gains',
    'FifteenBandPEQPlugin.q': 'qValues',
    'FiveBandPEQPlugin.frequency': 'frequencies',
    'FiveBandPEQPlugin.gain': 'gains',
    'FiveBandPEQPlugin.q': 'qValues',
    'FMRadioSimulatorPlugin.ifBand': 'ifBandwidth',
    'G726ADPCMSimulatorPlugin.radioBitErrorExponent': 'radioBitErrorRate',
    'SimpleJitterPlugin.rmsJitter': 'rmsJitterNanoseconds',
    'TiltEQPlugin.pivotExponent': 'pivotFrequency',
    'VinylSimulatorPlugin.hfCutoff': 'highFrequencyCutoff'
  });
  const logarithmicFieldNames = specs.flatMap(effect => effect.fields
    .filter(field => field.automation?.normalization === 'log')
    .map(field => `${effect.type}.${field.publicName}`));
  const logarithmicFields = Object.fromEntries(Object.entries(catalog.effects).flatMap(
    ([type, parameters]) => parameters
      .filter(parameter => parameter.normalization === 'log')
      .map(parameter => [`${type}.${parameter.publicName}`, [
        parameter.minimum, parameter.maximum
      ]])
  ));
  assert.deepEqual(logarithmicFields, {
    'AMRadioSimulatorPlugin.detectorRc': [20, 500],
    'AMRadioSimulatorPlugin.fadingSpeed': [0.05, 2],
    'AutoFilterPlugin.attack': [1, 500],
    'AutoFilterPlugin.maximumFrequency': [20, 20000],
    'AutoFilterPlugin.minimumFrequency': [20, 20000],
    'AutoFilterPlugin.rate': [0.05, 20],
    'AutoFilterPlugin.release': [10, 2000],
    'AutoPanPlugin.rate': [0.05, 20],
    'ChorusPlugin.rate': [0.05, 10],
    'CompressorPlugin.ratio': [0.5, 20],
    'DigitalErrorEmulatorPlugin.bitErrorRate': [1e-12, 0.01],
    'ExpanderPlugin.ratio': [0.05, 20],
    'FMRadioSimulatorPlugin.pathDelay': [0.5, 50],
    'FrequencyShifterPlugin.carrierFrequency': [0.1, 10000],
    'FrequencyShifterPlugin.rate': [0.01, 2],
    'G726ADPCMSimulatorPlugin.radioBitErrorRate': [0.000001, 0.01],
    'OscillatorPlugin.frequency': [20, 96000],
    'PhaserPlugin.centerFrequency': [80, 8000],
    'PhaserPlugin.rate': [0.05, 10],
    'PhaseSelectEqPlugin.coreFrequencyHigh': [20, 40000],
    'PhaseSelectEqPlugin.coreFrequencyLow': [20, 40000],
    'PhaseSelectEqPlugin.outerFrequencyHigh': [20, 40000],
    'PhaseSelectEqPlugin.outerFrequencyLow': [20, 40000],
    'RotarySpeakerPlugin.crossover': [200, 2000],
    'SimpleJitterPlugin.rmsJitterNanoseconds': [0.001, 10000000],
    'SWRadioSimulatorPlugin.delaySpread': [0.2, 8],
    'SWRadioSimulatorPlugin.detectorRc': [20, 500],
    'SWRadioSimulatorPlugin.fadingSpeed': [0.1, 10],
    'SWRadioSimulatorPlugin.interferenceOffset': [0.1, 10],
    'TiltEQPlugin.pivotFrequency': [Math.exp(3), Math.exp(9.9)],
    'TubeSimulatorPlugin.actualSpeakerLoad': [2, 32],
    'TubeSimulatorPlugin.inputReference': [0.1, 300],
    'TubeSimulatorPlugin.sourceZ': [0.6, 100],
    'TubeSimulatorPlugin.supply': [0.1, 47],
    'VinylSimulatorPlugin.roughness': [0.1, 100]
  });
  assert.deepEqual(new Set(Object.keys(logarithmicFields)), new Set(logarithmicFieldNames));
  assert.equal(
    Object.values(logarithmicFields).every(([minimum, maximum]) =>
      minimum > 0 && maximum > minimum),
    true
  );

  assert.deepEqual(
    catalog.effects.DCOffsetPlugin.map(parameter => parameter.key),
    ['of']
  );
  assert.deepEqual(
    catalog.effects.BrickwallLimiterPlugin.map(parameter => parameter.key),
    ['th', 'rl', 'ig', 'sm']
  );
  for (const type of [
    'AMRadioSimulatorPlugin', 'FMRadioSimulatorPlugin', 'SWRadioSimulatorPlugin'
  ]) {
    assert.deepEqual(
      catalog.effects[type].find(parameter => parameter.key === 'rd'),
      {
        key: 'rd',
        publicName: 'radio',
        element: 0,
        field: 'rd',
        containerKey: '',
        memberKey: '',
        packedOffset: 0,
        kind: 'bool',
        eligibility: 'stepped',
        normalization: 'bool',
        transform: 'identity',
        transformReference: 1,
        minimum: 0,
        maximum: 1,
        step: 1,
        default: true,
        packedDefault: 1,
        stepCount: 1,
        title: 'Radio',
        shortTitle: 'Radio',
        unit: '',
        safetyFlags: 0
      }
    );
  }
  assert.equal(catalog.effects.BrickwallLimiterPlugin.some(
    parameter => parameter.field === 'la' || parameter.field === 'os'
  ), false);
  assert.equal(catalog.effects.TubeSimulatorPlugin.length, 24);
  assert.deepEqual(catalog.effects.VinylSimulatorPlugin.map(parameter => parameter.key), [
    'lv', 'hf', 'mb', 'sm', 'rp', 'rd', 'rg', 'dr', 'st', 'sc', 'rs', 'rc',
    'tf', 'tm', 'cm', 'dz', 'ql', 'og', 'mx'
  ]);
  assert.equal(catalog.effects.SimpleJitterPlugin[0].field, 'rj');
  assert.equal(catalog.effects.SimpleJitterPlugin[0].unit, 'ns');
  assert.deepEqual(runGenerator({ check: true }).stale, []);

  const generated = await generatedModule(specs);
  assert.equal(Object.isFrozen(generated.DSP_AUTOMATION_CATALOG), true);
  assert.equal(Object.isFrozen(generated.DSP_AUTOMATION_CATALOG.DCOffsetPlugin), true);
  assert.equal(generated.DSP_AUTOMATION_CATALOG.VolumePlugin.length, 1);
});

test('legacy integer automation retains one-unit precision', async () => {
  const specs = loadParamSpecs();
  const catalog = buildAutomationCatalog(specs).effects;
  const generated = await generatedModule(specs);
  const cases = [
    { type: 'LoudnessEqualizerPlugin', key: 'hf', stepCount: 3000, values: [3001, 3050] },
    { type: 'RSReverbPlugin', key: 'hd', stepCount: 19000, values: [2001, 2050] },
    { type: 'VinylArtifactsPlugin', key: 'cm', stepCount: 2000, values: [1, 50] }
  ];

  for (const expected of cases) {
    const sourceDescriptor = catalog[expected.type]
      .find(parameter => parameter.key === expected.key);
    const descriptor = generated.DSP_AUTOMATION_CATALOG[expected.type]
      .find(parameter => parameter.key === expected.key);
    assert.ok(sourceDescriptor, `${expected.type}.${expected.key} must be public`);
    assert.ok(descriptor, `${expected.type}.${expected.key} must be generated`);
    assert.equal(sourceDescriptor.step, 1);
    assert.equal(sourceDescriptor.stepCount, expected.stepCount);
    assert.equal(descriptor.stepCount, expected.stepCount);
    for (const value of expected.values) {
      const normalized = generated.normalizeDSPAutomationValue(descriptor, value);
      assert.equal(normalized, (value - descriptor.minimum) / expected.stepCount);
      assert.equal(generated.denormalizeDSPAutomationValue(descriptor, normalized), value);
    }
  }
});

test('minimal opt-in derives identity, display, layout, and array access metadata', () => {
  const probe = spec('AutomationArrayProbe', [
    { name: 'privateGain', key: 'pg', kind: 'float', min: 0, max: 1, default: 0 },
    {
      name: 'bandGain', key: 'bg', arrayKey: 'bands', kind: 'int', count: 2,
      min: -12, max: 12, step: 1, default: [-3, 6], unit: 'dB', automation: true
    },
    {
      name: 'attackTime', publicName: 'attackMilliseconds', key: 'at',
      objectArrayKey: 'stages', memberKey: 'attack',
      kind: 'float', count: 2, min: 0.1, max: 100, step: 0.1, default: [1, 10],
      unit: 'ms', automation: { normalization: 'log' }
    }
  ]);
  const parameters = buildAutomationCatalog([probe]).effects.AutomationArrayProbe;

  assert.deepEqual(parameters.map(parameter => parameter.element), [0, 1, 0, 1]);
  assert.deepEqual(parameters.map(parameter => parameter.packedOffset), [1, 2, 3, 4]);
  assert.deepEqual(parameters.map(parameter => parameter.key), ['bg', 'bg', 'at', 'at']);
  assert.deepEqual(parameters.map(parameter => parameter.publicName),
    ['bandGain', 'bandGain', 'attackMilliseconds', 'attackMilliseconds']);
  assert.deepEqual(parameters.map(parameter => parameter.field), ['bg0', 'bg1', 'at0', 'at1']);
  assert.deepEqual(parameters.map(parameter => parameter.containerKey),
    ['bands', 'bands', 'stages', 'stages']);
  assert.deepEqual(parameters.map(parameter => parameter.memberKey),
    ['', '', 'attack', 'attack']);
  assert.deepEqual(parameters.map(parameter => parameter.title),
    ['Band Gain', 'Band Gain', 'Attack Milliseconds', 'Attack Milliseconds']);
  assert.deepEqual(parameters.map(parameter => parameter.normalization),
    ['integer', 'integer', 'log', 'log']);
  assert.deepEqual(parameters.map(parameter => parameter.unit), ['dB', 'dB', 'ms', 'ms']);
  assert.equal(parameters.some(parameter => parameter.field === 'pg'), false);

  const cpp = [...generateOutputs([probe])]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  assert.match(cpp, /AutomationEffectDescriptor\{"AutomationArrayProbe", 0u, 4u\}/);
  assert.match(cpp,
    /AutomationParameterDescriptor\{"bg", "bandGain", 1u, "bg1", "bands", "", 2u/);
  assert.match(cpp, /"Band Gain", "Band Gain", "dB", 0u/);
  assert.match(cpp, /"Attack Milliseconds", "Attack Milliseconds", "ms", 0u/);
});

test('generated JavaScript normalizes continuous and stepped parameter kinds', async () => {
  const probe = spec('AutomationNormalizationProbe', [
    {
      name: 'linear', key: 'ln', kind: 'float', min: -1, max: 1, step: 0.01,
      default: 0, automation: true
    },
    {
      name: 'logarithmic', key: 'lg', kind: 'float', min: 20, max: 20000,
      step: 1, default: 200, automation: { normalization: 'log' }
    },
    {
      name: 'integer', key: 'in', kind: 'int', min: 1, max: 5, step: 1,
      default: 3, automation: true
    },
    {
      name: 'integerTwelve', key: 'it', kind: 'int', min: -96, max: 0, step: 12,
      default: -24, automation: true
    },
    {
      name: 'integerTwo', key: 'iw', kind: 'int', min: 2, max: 12, step: 2,
      default: 6, automation: true
    },
    {
      name: 'enabled', key: 'ok', kind: 'bool', step: 1, default: false,
      automation: true
    },
    {
      name: 'mode', key: 'md', kind: 'enum', values: ['low', 'mid', 'high'],
      step: 1, default: 'mid', automation: true
    }
  ]);
  const generated = await generatedModule([probe]);
  const cpp = [...generateOutputs([probe])]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  const descriptors = new Map(
    generated.DSP_AUTOMATION_CATALOG.AutomationNormalizationProbe
      .map(descriptor => [descriptor.key, descriptor])
  );
  const normalize = generated.normalizeDSPAutomationValue;
  const denormalize = generated.denormalizeDSPAutomationValue;

  assert.equal(normalize(descriptors.get('ln'), 0), 0.5);
  assert.equal(denormalize(descriptors.get('ln'), 0.25), -0.5);
  assert.ok(Math.abs(normalize(descriptors.get('lg'), 200) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(denormalize(descriptors.get('lg'), 2 / 3) - 2000) < 1e-9);
  const integer = descriptors.get('in');
  assert.equal(integer.stepCount, 4);
  assert.equal(normalize(integer, 1), 0);
  assert.equal(normalize(integer, 3), 0.5);
  assert.equal(normalize(integer, 5), 1);
  assert.equal(denormalize(integer, 0), 1);
  assert.equal(denormalize(integer, 0.5), 3);
  assert.equal(denormalize(integer, 1), 5);
  assert.equal(denormalize(integer, normalize(integer, 4)), 4);

  const integerTwelve = descriptors.get('it');
  assert.equal(integerTwelve.stepCount, 8);
  assert.equal(normalize(integerTwelve, -96), 0);
  assert.equal(normalize(integerTwelve, -48), 0.5);
  assert.equal(normalize(integerTwelve, 0), 1);
  assert.equal(denormalize(integerTwelve, 0), -96);
  assert.equal(denormalize(integerTwelve, 0.5), -48);
  assert.equal(denormalize(integerTwelve, 1), 0);
  assert.equal(denormalize(integerTwelve, normalize(integerTwelve, -24)), -24);

  const integerTwo = descriptors.get('iw');
  assert.equal(integerTwo.stepCount, 5);
  assert.equal(normalize(integerTwo, 2), 0);
  assert.equal(normalize(integerTwo, 6), 0.4);
  assert.equal(normalize(integerTwo, 12), 1);
  assert.equal(denormalize(integerTwo, 0), 2);
  assert.equal(denormalize(integerTwo, 0.5), 8);
  assert.equal(denormalize(integerTwo, 1), 12);
  assert.equal(denormalize(integerTwo, normalize(integerTwo, 6)), 6);
  assert.equal(normalize(descriptors.get('ok'), true), 1);
  assert.equal(denormalize(descriptors.get('ok'), 0.49), false);
  assert.equal(normalize(descriptors.get('md'), 'high'), 1);
  assert.equal(denormalize(descriptors.get('md'), 0.4), 'mid');
  assert.doesNotMatch(cpp, /\b(?:false|true|low|mid|high)f\b/);
  assert.match(cpp,
    /AutomationParameterDescriptor\{"ok".*AutomationParameterKind::Bool.*0\.0f, 1\.0f, 1\.0f, 0\.0f, 0\.0f, 1u/);
  assert.match(cpp,
    /AutomationParameterDescriptor\{"md".*AutomationParameterKind::Enum.*0\.0f, 2\.0f, 1\.0f, 1\.0f, 1\.0f, 2u/);
});

test('overlay transforms expose public domains and round-trip packed values', async () => {
  const specs = loadParamSpecs();
  const catalog = buildAutomationCatalog(specs).effects;
  const generated = await generatedModule(specs);
  const cpp = [...generateOutputs(specs)]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  assert.match(cpp,
    /enum class AutomationValueTransform\s*:\s*std::uint8_t\s*\{\s*Identity,\s*NaturalLog,\s*Log10,\s*DecibelsFromReference\s*\}/);
  assert.match(cpp,
    /AutomationNormalization::Logarithmic, AutomationValueTransform::NaturalLog, 1\.0f/);
  assert.match(cpp,
    /AutomationNormalization::Logarithmic, AutomationValueTransform::DecibelsFromReference, 0\.001f/);
  const expectations = [
    {
      type: 'TiltEQPlugin', key: 'f0', publicName: 'pivotFrequency', transform: 'naturalLog',
      reference: 1, packedMinimum: 3, packedMaximum: 9.9, packedDefault: 6.91,
      minimum: Math.exp(3), maximum: Math.exp(9.9), defaultValue: Math.exp(6.91), unit: 'Hz'
    },
    {
      type: 'DigitalErrorEmulatorPlugin', key: 'be', publicName: 'bitErrorRate', transform: 'log10',
      reference: 1, packedMinimum: -12, packedMaximum: -2, packedDefault: -6,
      minimum: 1e-12, maximum: 1e-2, defaultValue: 1e-6, unit: ''
    },
    {
      type: 'G726ADPCMSimulatorPlugin', key: 're', publicName: 'radioBitErrorRate',
      transform: 'log10', reference: 1, packedMinimum: -6, packedMaximum: -2,
      packedDefault: -6, minimum: 1e-6, maximum: 1e-2, defaultValue: 1e-6, unit: ''
    },
    {
      type: 'SimpleJitterPlugin', key: 'rj', publicName: 'rmsJitterNanoseconds',
      transform: 'decibelsFromReference', reference: 0.001, packedMinimum: 0,
      packedMaximum: 200, packedDefault: 100, minimum: 0.001, maximum: 1e7,
      defaultValue: 100, unit: 'ns'
    }
  ];

  for (const expected of expectations) {
    const descriptor = catalog[expected.type]
      .find(parameter => parameter.key === expected.key);
    assert.ok(descriptor, `${expected.type}.${expected.key} must be public`);
    assert.equal(descriptor.transform, expected.transform);
    assert.equal(descriptor.transformReference, expected.reference);
    assert.equal(descriptor.normalization, 'log');
    assert.equal(descriptor.unit, expected.unit);
    assert.ok(Math.abs(descriptor.minimum - expected.minimum) <= expected.minimum * 1e-12);
    assert.ok(Math.abs(descriptor.maximum - expected.maximum) <= expected.maximum * 1e-12);
    assert.ok(Math.abs(descriptor.default - expected.defaultValue) <= expected.defaultValue * 1e-12);
    assert.equal(descriptor.packedDefault, expected.packedDefault);

    assert.ok(Math.abs(
      generated.unpackDSPAutomationValue(descriptor, expected.packedMinimum) - expected.minimum
    ) <= expected.minimum * 1e-12);
    assert.ok(Math.abs(
      generated.unpackDSPAutomationValue(descriptor, expected.packedMaximum) - expected.maximum
    ) <= expected.maximum * 1e-12);
    assert.ok(Math.abs(
      generated.packDSPAutomationValue(descriptor, expected.minimum) - expected.packedMinimum
    ) < 1e-12);
    assert.ok(Math.abs(
      generated.packDSPAutomationValue(descriptor, expected.maximum) - expected.packedMaximum
    ) < 1e-12);
    const midpoint = Math.sqrt(expected.minimum * expected.maximum);
    assert.ok(Math.abs(generated.normalizeDSPAutomationValue(descriptor, midpoint) - 0.5) < 1e-12);
    assert.ok(Math.abs(
      generated.denormalizeDSPAutomationValue(descriptor, 0.5) - midpoint
    ) <= midpoint * 1e-12);
    const publicDefault = generated.unpackDSPAutomationValue(
      descriptor, expected.packedDefault
    );
    assert.ok(Math.abs(
      generated.packDSPAutomationValue(descriptor, publicDefault) - expected.packedDefault
    ) < 1e-12);
  }
});

test('native catalog carries the exact enum table generated from the field schema', () => {
  const probe = spec('AutomationEnumProbe', [{
    name: 'mode', key: 'md', kind: 'enum', values: ['low', 'mid', 'high'],
    step: 1, default: 'mid', automation: true
  }]);
  const cpp = [...generateOutputs([probe])]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  assert.match(cpp, /std::array<std::string_view, 3> kAutomationEnumValues/);
  assert.match(cpp, /"low",\n  "mid",\n  "high"/);
  assert.match(cpp, /0u, 3u}/);
});

test('automation validation accepts only the minimal opt-in schema', () => {
  const base = {
    name: 'gain', key: 'gn', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.5
  };
  assert.throws(
    () => spec('FalseAutomation', [{ ...base, automation: false }]),
    /must be true or an object/
  );
  assert.throws(
    () => spec('BadLogRange', [{ ...base, automation: { normalization: 'log' } }]),
    /log automation requires min greater than zero/
  );
  assert.throws(
    () => spec('BadOverride', [{ ...base, automation: { normalization: 'linear' } }]),
    /override must be log/
  );
  assert.throws(
    () => spec('UnknownAutomationMember', [{
      ...base, automation: { normalization: 'log', title: 'Gain' }
    }]),
    /unknown member/
  );
  assert.throws(
    () => spec('IntegerLog', [{
      name: 'steps', key: 'st', kind: 'int', min: 1, max: 5, step: 1, default: 3,
      automation: { normalization: 'log' }
    }]),
    /requires float kind/
  );
  assert.throws(
    () => spec('UnevenIntegerSteps', [{
      name: 'steps', key: 'st', kind: 'int', min: 0, max: 4, step: 3, default: 0,
      automation: true
    }]),
    /step count must fit uint32/
  );
  assert.throws(
    () => spec('MisalignedIntegerDefault', [{
      name: 'steps', key: 'st', kind: 'int', min: 0, max: 4, step: 2, default: 3,
      automation: true
    }]),
    /defaults must align to its step/
  );
  assert.throws(
    () => spec('EmptyUnit', [{ ...base, unit: '', automation: true }]),
    /unit must be a non-empty string/
  );
  assert.throws(
    () => spec('NonStringUnit', [{ ...base, unit: 12, automation: true }]),
    /unit must be a non-empty string/
  );
});

test('automation metadata does not change layout and released contracts stay stable', () => {
  const privateSpec = spec('StableAutomationProbe', [
    { name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0 }
  ]);
  const publicSpec = spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, step: 0.01,
      default: 0, automation: true
    }
  ]);
  assert.equal(privateSpec.hash, publicSpec.hash);

  const released = buildAutomationCatalog([publicSpec]);
  const withAddition = buildAutomationCatalog([spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, step: 0.01,
      default: 0, automation: true
    },
    {
      name: 'mix', key: 'mx', kind: 'float', min: 0, max: 1, step: 0.01,
      default: 1, automation: true
    }
  ])]);
  assert.equal(validateAutomationCompatibility(released, withAddition), true);
  assert.throws(
    () => validateAutomationCompatibility(released, buildAutomationCatalog([privateSpec])),
    /removed or renamed/
  );
  const changedRange = buildAutomationCatalog([spec('StableAutomationProbe', [{
    name: 'gain', key: 'gn', kind: 'float', min: -2, max: 1, step: 0.01, default: 0,
    automation: true
  }])]);
  assert.throws(
    () => validateAutomationCompatibility(released, changedRange),
    /changed minimum/
  );
  const renamedPublicField = buildAutomationCatalog([spec('StableAutomationProbe', [{
    name: 'gain', publicName: 'inputGain', key: 'gn', kind: 'float', min: -1, max: 1,
    step: 0.01, default: 0, automation: true
  }])]);
  assert.throws(
    () => validateAutomationCompatibility(released, renamedPublicField),
    /removed or renamed/
  );
  const renamedPackedKey = buildAutomationCatalog([spec('StableAutomationProbe', [{
    name: 'gain', key: 'ig', kind: 'float', min: -1, max: 1, step: 0.01, default: 0,
    automation: true
  }])]);
  assert.throws(
    () => validateAutomationCompatibility(released, renamedPackedKey),
    /changed key/
  );
  const changedUnit = buildAutomationCatalog([spec('StableAutomationProbe', [{
    name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, step: 0.01, default: 0,
    unit: 'dB', automation: true
  }])]);
  assert.throws(
    () => validateAutomationCompatibility(released, changedUnit),
    /changed unit/
  );
});

test('A/B full-image commits retain representative heavy-path guards', () => {
  const brickwall = source('dsp/plugins/dynamics/brickwall_limiter/kernel.cpp');
  const brickwallProcess = bodyBetween(brickwall, 'void process(', 'void writeTelemetry(');
  assert.doesNotMatch(brickwallProcess, /buildThresholdLookup\s*\(/);
  assert.equal((brickwall.match(/buildThresholdLookup\s*\(/g) ?? []).length, 2,
    'the magnitude lookup must only be called by reset and defined once');

  const fm = source('dsp/plugins/lofi/fm_radio_simulator/kernel.cpp');
  const fmControls = bodyBetween(fm, 'void configureControls()', 'void configureIfFilters()');
  assert.match(fmControls,
    /const bool if_band_changed\s*=\s*!controlsConfigured_\s*\|\|\s*ifBandKhz_\s*!=\s*params_\.ifBand/);
  assert.match(fmControls, /if \(if_band_changed\) \{\s*configureIfFilters\(\);\s*\}/);

  const dsd = source('dsp/plugins/lofi/dsd64_imd_simulator/kernel.cpp');
  const dsdCoefficients = bodyBetween(dsd, 'void updateCoefficients()',
    'static BiquadCoefficients coefficientStep(');
  assert.match(dsdCoefficients,
    /const bool hu_changed\s*=\s*!coefficients_valid_\s*\|\|\s*params_\.noiseColor\s*!=\s*coefficient_noise_color_\s*\|\|\s*params_\.noiseTexture\s*!=\s*coefficient_noise_texture_/);
  assert.match(dsdCoefficients, /if \(hu_changed\) \{\s*normalization_ = computeNormalization\(\);\s*\}/);
  assert.equal((dsdCoefficients.match(/computeNormalization\s*\(/g) ?? []).length, 1,
    'published A/B controls must not add another normalization path');

  const horn = source('dsp/plugins/resonator/horn_waveguide_common.h');
  const hornConfiguration = bodyBetween(horn, 'bool configurationChanged(',
    'template <Variant BoundaryVariant>');
  for (const continuousControl of ['crossover', 'damping', 'throatReflection', 'waveguideGain']) {
    assert.doesNotMatch(hornConfiguration, new RegExp(`params\\.${continuousControl}\\b`),
      `${continuousControl} must not clear the horn history`);
  }
  for (const structuralControl of ['length', 'throatDiameter', 'mouthDiameter', 'curve']) {
    assert.match(hornConfiguration, new RegExp(`params\\.${structuralControl}\\b`));
  }

  const tube = source('dsp/plugins/saturation/tube_simulator/kernel.cpp');
  const tubeCommit = bodyBetween(tube,
    '    if (has_applied_parameters_ &&\n'
      + '        feedback_transition_.phase == FeedbackTransitionPhase::inactive &&\n'
      + '        fastAutomationOnlyChanged(decoded_parameters_, applied_parameters_)) {',
    'if (!has_applied_parameters_)');
  assert.match(tubeCommit,
    /applyFastAutomationParameters\(decoded_parameters_\);\s*parameter_commit_pending_ = false;\s*return;/);
  assert.doesNotMatch(tubeCommit, /applyPath2Parameters|applyPowerParameters|solveDc/);
});

test('AudioWorklet fallback control ramps reuse context-owned hot-path storage', () => {
  const contracts = [
    {
      file: 'plugins/dynamics/multiband_compressor.js',
      required: /context\.curveControlTargets/,
      forbidden: /const controlTargets = new Float64Array|gainReductions\.slice\(0, 5\)|const frequencies = \[|const curveControlAt\s*=\s*\(/
    },
    {
      file: 'plugins/dynamics/multiband_expander.js',
      required: /context\.curveControlTargets/,
      forbidden: /const controlTargets = new Float64Array|gainBoosts\.slice\(0, 5\)|const frequencies = \[|const curveControlAt\s*=\s*\(/
    },
    {
      file: 'plugins/others/oscillator.js',
      required: /context\.oscillatorControlScratch/,
      forbidden: /const targetControls = \[|targetOscillatorControls = targetControls\.slice|oscillatorControls = context\.targetOscillatorControls\.slice|const controlAt\s*=\s*\(/
    },
    {
      file: 'plugins/reverb/rs_reverb.js',
      required: /context\.rsFeedbackScratch/,
      forbidden: /const feedbackGains = new Array|const targetControls = \[|rsControls = context\.targetRsControls\.slice|rsFeedbackGains = context\.targetRsFeedbackGains\.slice|const rs(?:Control|Feedback)At\s*=\s*\(/
    },
    {
      file: 'plugins/saturation/harmonic_distortion.js',
      required: /context\.harmonicScratch/,
      forbidden: /const target = \[|target\.map\(|harmonicCurrent = context\.harmonicTarget\.slice|const\s*\[\s*a2,\s*a3,\s*a4,\s*a5,\s*currentSensitivity\s*\]/
    },
    {
      file: 'plugins/saturation/saturation.js',
      required: /context\.saturationCurrentDrive/,
      forbidden: /const targets = \{|Object\.keys\(targets\)|context\.saturationStep = \{\}/
    }
  ];
  for (const contract of contracts) {
    const processor = source(contract.file);
    assert.match(processor, contract.required, contract.file);
    assert.doesNotMatch(processor, contract.forbidden, contract.file);
  }
});

test('simple dynamics fallback ramps avoid per-block and per-frame allocation', () => {
  for (const file of [
    'plugins/dynamics/compressor.js',
    'plugins/dynamics/expander.js'
  ]) {
    const processor = source(file);
    assert.match(processor, /context\.curveCurrent = new Float64Array\(4\)/, file);
    assert.match(processor, /const thresholdDb = curveCurrent\[0\]/, file);
    assert.doesNotMatch(processor,
      /const curveTargets = \[parameters\.th|curveTargets\.(?:some|forEach)|const curveAt\s*=|context\.curveCurrent = context\.curveCurrent\.map/,
      file);
  }
});

test('multiband compressor quiet shortcut is stationary-only', () => {
  const compressor = source('plugins/dynamics/multiband_compressor.js');
  assert.doesNotMatch(compressor, /false\s*&&\s*maxDiff/);
  assert.match(compressor, /const curveRamping = curveRampRemaining > 0;/);
  assert.match(compressor, /if \(!curveRamping && maxDiff <= -halfKneeDb\) \{/);
  assert.match(compressor,
    /let frameThresholdDb = thresholdDb;[\s\S]*?if \(curveRamping\) \{[\s\S]*?curveControlSteps\[curveBase\]/);
});

test('AudioWorklet transition hot bodies do not create per-call helpers or destructure frames', () => {
  const transitionSetups = [
    [
      'plugins/dynamics/multiband_compressor.js',
      'const rampFrames = Math.max(1, Math.ceil(sampleRate * 0.005));',
      '// --- Lookup Table Setup (as in original) ---'
    ],
    [
      'plugins/dynamics/multiband_expander.js',
      'const rampFrames = Math.max(1, Math.ceil(sampleRate * 0.005));',
      '// --- Lookup Table Setup ---'
    ],
    [
      'plugins/others/oscillator.js',
      'const rampFrames = Math.max(1, Math.ceil(safeSampleRate * 0.005));',
      'const timeIncrementPerSample = 1.0 / safeSampleRate;'
    ],
    [
      'plugins/reverb/rs_reverb.js',
      'const rampFramesRaw = Math.ceil(sampleRate * 0.005);',
      '// Process each channel'
    ]
  ];
  for (const [file, start, end] of transitionSetups) {
    const setup = bodyBetween(source(file), start, end);
    assert.doesNotMatch(setup, /=>|\bfunction\s*\(/, file);
  }

  const harmonic = source('plugins/saturation/harmonic_distortion.js');
  const frameBody = bodyBetween(harmonic,
    'for (let i = 0; i < blockSize; ++i) {',
    '// Return the modified data buffer');
  assert.doesNotMatch(frameBody, /=>|\bfunction\s*\(|const\s*\[/);
});

test('canonical automation verification requires a guarded Debug runner', () => {
  assert.throws(
    () => parseVerificationArguments(['--native-runner', 'release-runner'], {}),
    /--allocation-runner is required/
  );
  assert.deepEqual(
    parseVerificationArguments([
      '--native-runner', 'release-runner',
      '--allocation-runner', 'debug-runner',
      '--ir-native-test', 'ir-tests'
    ], {}),
    {
      help: false,
      nativeRunner: 'release-runner',
      allocationRunner: 'debug-runner',
      irNativeTest: 'ir-tests'
    }
  );
  assert.match(automationUsage(), /--allocation-runner <file>.*Debug/s);
  assert.deepEqual(
    guardedParityOptions('debug-runner'),
    { runnerPath: 'debug-runner', allocations: true }
  );
  const nativeRunner = source('dsp/test/parity_runner.cpp');
  assert.match(nativeRunner,
    /options\.allocations && \(et_build_flags\(\) & ET_BUILD_DEBUG\) == 0u/);
  assert.match(nativeRunner, /--allocations requires a Debug native runner build/);
});

test('native-reference automation replays use an independent WASM transition trace', () => {
  const events = source('tools/dsp-parity/automation-events.mjs');
  const referenceBranch = bodyBetween(
    events,
    '      const nativeReference = Boolean(schema.parityReference);',
    '      if (!native.every(Number.isFinite))'
  );
  assert.match(referenceBranch, /hasWasmTransitionReference\s*\? \{ output: await runWasmCase\(/);
  assert.doesNotMatch(referenceBranch, /await runNativeCase\(/);
  assert.match(events, /CHECK native-only/);
  assert.match(events, /CHECK oracle-deferred/);
  assert.match(events, /WASM\/native transition parity/);
  assert.match(events, /native-only finiteness\/allocation replays were checked separately/);
  const canonical = source('tools/verify-dsp-automation.mjs');
  assert.match(canonical, /room_eq\/automation_parity\.mjs/);
  assert.match(canonical, /ir_reverb\/automation_test\.mjs/);
});

test('canonical automation verification accepts explicit runner environment inputs', () => {
  assert.deepEqual(
    parseVerificationArguments([], {
      EFFETUNE_DSP_NATIVE_RUNNER: 'release-runner',
      EFFETUNE_DSP_ALLOCATION_RUNNER: 'debug-runner'
    }),
    {
      help: false,
      nativeRunner: 'release-runner',
      allocationRunner: 'debug-runner',
      irNativeTest: null
    }
  );
});
