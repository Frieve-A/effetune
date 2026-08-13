import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAutomationCatalog,
  generateOutputs,
  loadParamSpecs,
  runGenerator,
  validateAutomationCompatibility,
  validateParamSpec
} from '../../scripts/gen-dsp-params.mjs';

function automation(normalization = 'linear') {
  return normalization === 'linear' ? true : { normalization };
}

function spec(type, fields) {
  return validateParamSpec({
    type,
    tolerance: { abs: 1e-6 },
    fields
  });
}

async function generatedModule(specs) {
  const source = [...generateOutputs(specs)]
    .find(([file]) => file.endsWith('dsp-params.generated.js'))[1];
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('production schemas generate the complete automation catalog', async () => {
  const specs = loadParamSpecs();

  const catalog = buildAutomationCatalog(specs);
  assert.deepEqual(Object.keys(catalog.effects), specs.map(item => item.type));
  assert.equal(Object.values(catalog.effects).filter(parameters => parameters.length > 0).length, 50);
  assert.equal(Object.values(catalog.effects).flat().length, 305);
  assert.equal(
    Object.values(catalog.effects).flat()
      .filter(parameter => parameter.normalization === 'log').length,
    21
  );
  assert.equal(
    Object.values(catalog.effects).flat()
      .filter(parameter => parameter.kind === 'enum').length,
    0
  );
  assert.deepEqual(catalog.effects.PhaseSelectEqPlugin, []);
  assert.deepEqual(catalog.effects.PitchShifterHQPlugin, []);
  assert.deepEqual(
    catalog.effects.MultibandCompressorPlugin
      .filter(parameter => parameter.field === 'attack')
      .map(({ key, arrayKey, objectArrayKey, memberKey, element, unit }) => ({
        key, arrayKey, objectArrayKey, memberKey, element, unit
      })),
    Array.from({ length: 5 }, (_, element) => ({
      key: `a${element}`,
      arrayKey: '',
      objectArrayKey: 'bands',
      memberKey: 'a',
      element,
      unit: 'ms'
    }))
  );
  assert.deepEqual(runGenerator({ check: true }).stale, []);

  const generated = await generatedModule(specs);
  assert.deepEqual(
    Object.keys(generated.DSP_AUTOMATION_CATALOG),
    specs.map(item => item.type)
  );
  assert.equal(
    Object.values(generated.DSP_AUTOMATION_CATALOG)
      .every(parameters => Object.isFrozen(parameters)),
    true
  );
});

test('automation catalog publishes scalar and array JSON storage paths', () => {
  const probe = spec('AutomationArrayProbe', [
    { name: 'privateGain', key: 'pg', kind: 'float', min: 0, max: 1, default: 0 },
    {
      name: 'outputGain', key: 'og', kind: 'float', min: -12, max: 12,
      default: 0, unit: 'dB', automation: automation()
    },
    {
      name: 'bandPan', key: 'pan', kind: 'int', count: 2,
      min: -100, max: 100, default: [-25, 25], unit: '%', automation: automation()
    },
    {
      name: 'bandGain', key: 'bg', keys: ['lowGain', 'highGain'], arrayKey: 'gains',
      kind: 'int', count: 2, min: -12, max: 12, default: [-3, 6], unit: 'dB',
      automation: automation()
    }
  ]);
  const parameters = buildAutomationCatalog([probe]).effects.AutomationArrayProbe;

  assert.equal(parameters.length, 5);
  assert.deepEqual(parameters.map(parameter => parameter.element), [0, 0, 1, 0, 1]);
  assert.deepEqual(parameters.map(parameter => parameter.packedOffset), [1, 2, 3, 4, 5]);
  assert.deepEqual(
    parameters.map(parameter => parameter.key),
    ['og', 'pan0', 'pan1', 'lowGain', 'highGain']
  );
  assert.deepEqual(parameters.map(parameter => parameter.arrayKey), ['', '', '', 'gains', 'gains']);
  assert.deepEqual(parameters.map(parameter => parameter.objectArrayKey), ['', '', '', '', '']);
  assert.deepEqual(parameters.map(parameter => parameter.memberKey), ['', '', '', '', '']);
  assert.deepEqual(parameters.map(parameter => parameter.default), [0, -25, 25, -3, 6]);
  assert.deepEqual(parameters.map(parameter => parameter.unit), ['dB', '%', '%', 'dB', 'dB']);
  assert.equal(parameters.some(parameter => parameter.field === 'privateGain'), false);

  const cpp = [...generateOutputs([probe])]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  assert.match(cpp, /AutomationEffectDescriptor\{"AutomationArrayProbe", 0u, 5u\}/);
  assert.match(
    cpp,
    /AutomationParameterDescriptor\{"highGain", "gains", "", "", 1u, "bandGain", 5u/
  );
});

test('automation catalog publishes object-array JSON storage paths', () => {
  const probe = spec('AutomationObjectArrayProbe', [{
    name: 'attack', key: 'a', objectArrayKey: 'bands', memberKey: 'a',
    kind: 'float', count: 2, min: 0.1, max: 100, default: [10, 20],
    unit: 'ms', automation: automation('log')
  }]);

  const parameters = buildAutomationCatalog([probe]).effects.AutomationObjectArrayProbe;
  assert.deepEqual(parameters.map(parameter => parameter.key), ['a0', 'a1']);
  assert.deepEqual(parameters.map(parameter => parameter.arrayKey), ['', '']);
  assert.deepEqual(parameters.map(parameter => parameter.objectArrayKey), ['bands', 'bands']);
  assert.deepEqual(parameters.map(parameter => parameter.memberKey), ['a', 'a']);
  assert.deepEqual(parameters.map(parameter => parameter.element), [0, 1]);
  assert.deepEqual(parameters.map(parameter => parameter.unit), ['ms', 'ms']);
});

test('parameter schemas reject colliding JSON storage paths', () => {
  const field = (name, key, storage = {}) => ({
    name, key, kind: 'float', count: 2, min: 0, max: 1,
    default: [0.25, 0.75], ...storage
  });

  assert.throws(
    () => spec('DuplicateArrayLeaf', [
      field('left', 'l', { arrayKey: 'values' }),
      field('right', 'r', { arrayKey: 'values' })
    ]),
    /array values leaf collision/
  );
  assert.throws(
    () => spec('DirectArrayShapeCollision', [
      { name: 'values', key: 'values', kind: 'float', min: 0, max: 1, default: 0.5 },
      field('right', 'r', { arrayKey: 'values' })
    ]),
    /JSON storage root shape collision: values/
  );
  assert.throws(
    () => spec('ArrayObjectShapeCollision', [
      field('gain', 'g', { arrayKey: 'bands' }),
      field('attack', 'a', { objectArrayKey: 'bands', memberKey: 'a' })
    ]),
    /JSON storage root shape collision: bands/
  );
  assert.throws(
    () => spec('DirectObjectShapeCollision', [
      { name: 'bands', key: 'bands', kind: 'float', min: 0, max: 1, default: 0.5 },
      field('attack', 'a', { objectArrayKey: 'bands', memberKey: 'a' })
    ]),
    /JSON storage root shape collision: bands/
  );
  assert.doesNotThrow(() => spec('SharedObjectArray', [
    field('attack', 'a', { objectArrayKey: 'bands', memberKey: 'a' }),
    field('release', 'r', { objectArrayKey: 'bands', memberKey: 'r' })
  ]));
});

test('generated catalogs normalize continuous and stepped parameter kinds', async () => {
  const probe = spec('AutomationNormalizationProbe', [
    {
      name: 'linear', key: 'ln', kind: 'float', min: -1, max: 1, default: 0,
      automation: automation()
    },
    {
      name: 'logarithmic', key: 'lg', kind: 'float', min: 20, max: 20000, default: 200,
      automation: automation('log')
    },
    {
      name: 'integer', key: 'in', kind: 'int', min: 1, max: 5, default: 3,
      automation: automation()
    },
    {
      name: 'enabled', key: 'enb', kind: 'bool', default: false,
      automation: automation()
    },
    {
      name: 'mode', key: 'md', kind: 'enum', values: ['low', 'mid', 'high'], default: 'mid',
      automation: automation()
    },
    {
      name: 'quality', key: 'qy', kind: 'enum', values: ['draft', 'high'], default: 'high',
      automation: automation()
    }
  ]);
  const generated = await generatedModule([probe]);
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
  assert.equal(normalize(descriptors.get('in'), 4), 0.75);
  assert.equal(denormalize(descriptors.get('in'), 0.7), 4);
  assert.equal(normalize(descriptors.get('enb'), true), 1);
  assert.equal(denormalize(descriptors.get('enb'), 0.49), false);
  assert.deepEqual(descriptors.get('md').values, ['low', 'mid', 'high']);
  assert.equal(normalize(descriptors.get('md'), 'high'), 1);
  assert.equal(denormalize(descriptors.get('md'), 0.4), 'mid');

  const cpp = [...generateOutputs([probe])]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  assert.match(cpp, /std::uint32_t firstEnumValue;/);
  assert.match(cpp, /std::uint32_t enumValueCount;/);
  assert.match(cpp, /AutomationParameterDescriptor\{"md".* 0u, 3u\}/);
  assert.match(cpp, /AutomationParameterDescriptor\{"qy".* 3u, 2u\}/);
  assert.ok(cpp.includes(
    'inline constexpr std::array<std::string_view, 5> kAutomationEnumValues{{\n' +
    '  "low",\n  "mid",\n  "high",\n  "draft",\n  "high"\n}};'
  ));
});

test('automation metadata validation accepts only the minimal opt-in forms', () => {
  const base = {
    name: 'gain', key: 'gn', kind: 'float', min: 0, max: 1, default: 0.5
  };
  assert.throws(
    () => spec('BadBooleanOptOut', [{ ...base, automation: false }]),
    /must be true or an object/
  );
  assert.throws(
    () => spec('BadLogRange', [{
      ...base, min: 0, automation: automation('log')
    }]),
    /log automation requires min greater than zero/
  );
  assert.throws(
    () => spec('BadIntegerLog', [{
      name: 'count', key: 'ct', kind: 'int', min: 1, max: 3, default: 2,
      automation: automation('log')
    }]),
    /requires float kind/
  );
  assert.throws(
    () => spec('UnknownAutomationMember', [{
      ...base,
      automation: { normalization: 'log', undocumented: true }
    }]),
    /unknown member/
  );
  assert.throws(
    () => spec('RedundantLinearAutomation', [{
      ...base, automation: { normalization: 'linear' }
    }]),
    /normalization must be log/
  );
  assert.throws(
    () => spec('InvalidUnit', [{ ...base, unit: 1, automation: automation() }]),
    /unit must be a string/
  );
  assert.deepEqual(
    buildAutomationCatalog([spec('KeysOnlyAutomation', [{
      name: 'bands', keys: ['b0', 'b1'], kind: 'float', count: 2,
      min: 0, max: 1, default: [0.25, 0.75], automation: automation()
    }])]).effects.KeysOnlyAutomation.map(parameter => parameter.key),
    ['b0', 'b1']
  );
});

test('automation metadata does not change packed layout and released contracts stay stable', () => {
  const privateSpec = spec('StableAutomationProbe', [
    { name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0 }
  ]);
  const publicSpec = spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0,
      automation: automation()
    }
  ]);
  assert.equal(privateSpec.hash, publicSpec.hash);

  const released = buildAutomationCatalog([publicSpec]);
  const withAddition = buildAutomationCatalog([spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0,
      automation: automation()
    },
    {
      name: 'mix', key: 'mx', kind: 'float', min: 0, max: 1, default: 1,
      automation: automation()
    }
  ])]);
  assert.equal(validateAutomationCompatibility(released, withAddition), true);
  assert.throws(
    () => validateAutomationCompatibility(released, buildAutomationCatalog([privateSpec])),
    /removed or renamed/
  );
  const changedRange = buildAutomationCatalog([spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -2, max: 1, default: 0,
      automation: automation()
    }
  ])]);
  assert.throws(
    () => validateAutomationCompatibility(released, changedRange),
    /changed minimum/
  );
  const changedDefault = buildAutomationCatalog([spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0.5,
      automation: automation()
    }
  ])]);
  assert.throws(
    () => validateAutomationCompatibility(released, changedDefault),
    /changed default/
  );
});
