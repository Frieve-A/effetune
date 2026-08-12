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

function automation(key, normalization, eligibility = 'continuous') {
  return {
    eligibility,
    key,
    title: key,
    unit: '',
    normalization,
    safety: {
      latencyChanging: false,
      structural: false,
      asset: false,
      expensiveApply: false
    }
  };
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

test('production schemas generate a fresh private automation catalog for every effect', async () => {
  const specs = loadParamSpecs();
  const runtimeSpecs = specs.filter(item => !item.phase0);
  assert.equal(specs.every(item => item.fields.every(field => field.automation === null)), true);

  const catalog = buildAutomationCatalog(specs);
  assert.deepEqual(Object.keys(catalog.effects), specs.map(item => item.type));
  assert.equal(Object.values(catalog.effects).every(parameters => parameters.length === 0), true);
  assert.deepEqual(runGenerator({ check: true }).stale, []);

  const generated = await generatedModule(specs);
  assert.deepEqual(
    Object.keys(generated.DSP_AUTOMATION_CATALOG),
    runtimeSpecs.map(item => item.type)
  );
  assert.equal(
    Object.values(generated.DSP_AUTOMATION_CATALOG)
      .every(parameters => Object.isFrozen(parameters) && parameters.length === 0),
    true
  );
});

test('automation catalog publishes only opted-in fields and expands array elements', () => {
  const probe = spec('AutomationArrayProbe', [
    { name: 'privateGain', key: 'pg', kind: 'float', min: 0, max: 1, default: 0 },
    {
      name: 'bandGain', key: 'bg', kind: 'int', count: 2,
      min: -12, max: 12, default: [-3, 6],
      automation: automation('bandGain', 'integer', 'stepped')
    }
  ]);
  const parameters = buildAutomationCatalog([probe]).effects.AutomationArrayProbe;

  assert.equal(parameters.length, 2);
  assert.deepEqual(parameters.map(parameter => parameter.element), [0, 1]);
  assert.deepEqual(parameters.map(parameter => parameter.packedOffset), [1, 2]);
  assert.deepEqual(parameters.map(parameter => parameter.key), ['bandGain', 'bandGain']);
  assert.deepEqual(parameters.map(parameter => parameter.default), [-3, 6]);
  assert.equal(parameters.some(parameter => parameter.field === 'privateGain'), false);

  const cpp = [...generateOutputs([probe])]
    .find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  assert.match(cpp, /AutomationEffectDescriptor\{"AutomationArrayProbe", 0u, 2u\}/);
  assert.match(cpp, /AutomationParameterDescriptor\{"bandGain", 1u, "bandGain", 2u/);
});

test('generated JavaScript normalizes continuous and stepped parameter kinds', async () => {
  const probe = spec('AutomationNormalizationProbe', [
    {
      name: 'linear', key: 'ln', kind: 'float', min: -1, max: 1, default: 0,
      automation: automation('linear', 'linear')
    },
    {
      name: 'logarithmic', key: 'lg', kind: 'float', min: 20, max: 20000, default: 200,
      automation: automation('logarithmic', 'log')
    },
    {
      name: 'integer', key: 'in', kind: 'int', min: 1, max: 5, default: 3,
      automation: automation('integer', 'integer', 'stepped')
    },
    {
      name: 'enabled', key: 'enb', kind: 'bool', default: false,
      automation: automation('enabled', 'bool', 'stepped')
    },
    {
      name: 'mode', key: 'md', kind: 'enum', values: ['low', 'mid', 'high'], default: 'mid',
      automation: automation('mode', 'enum', 'stepped')
    }
  ]);
  const generated = await generatedModule([probe]);
  const descriptors = new Map(
    generated.DSP_AUTOMATION_CATALOG.AutomationNormalizationProbe
      .map(descriptor => [descriptor.key, descriptor])
  );
  const normalize = generated.normalizeDSPAutomationValue;
  const denormalize = generated.denormalizeDSPAutomationValue;

  assert.equal(normalize(descriptors.get('linear'), 0), 0.5);
  assert.equal(denormalize(descriptors.get('linear'), 0.25), -0.5);
  assert.ok(Math.abs(normalize(descriptors.get('logarithmic'), 200) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(denormalize(descriptors.get('logarithmic'), 2 / 3) - 2000) < 1e-9);
  assert.equal(normalize(descriptors.get('integer'), 4), 0.75);
  assert.equal(denormalize(descriptors.get('integer'), 0.7), 4);
  assert.equal(normalize(descriptors.get('enabled'), true), 1);
  assert.equal(denormalize(descriptors.get('enabled'), 0.49), false);
  assert.equal(normalize(descriptors.get('mode'), 'high'), 1);
  assert.equal(denormalize(descriptors.get('mode'), 0.4), 'mid');
});

test('automation metadata validation rejects unsafe and incompatible declarations', () => {
  const base = {
    name: 'gain', key: 'gn', kind: 'float', min: 0, max: 1, default: 0.5
  };
  assert.throws(
    () => spec('BadSteppedFloat', [{
      ...base, automation: automation('gain', 'linear', 'stepped')
    }]),
    /requires continuous/
  );
  assert.throws(
    () => spec('BadLogRange', [{
      ...base, min: 0, automation: automation('gain', 'log')
    }]),
    /log automation requires min greater than zero/
  );
  assert.throws(
    () => spec('UnsafeAutomation', [{
      ...base,
      automation: {
        ...automation('gain', 'linear'),
        safety: {
          ...automation('gain', 'linear').safety,
          latencyChanging: true
        }
      }
    }]),
    /safety exclusion/
  );
  assert.throws(
    () => spec('UnknownAutomationMember', [{
      ...base,
      automation: { ...automation('gain', 'linear'), undocumented: true }
    }]),
    /unknown member/
  );
  assert.throws(
    () => spec('DuplicateAutomationKey', [
      { ...base, automation: automation('gain', 'linear') },
      {
        name: 'mix', key: 'mx', kind: 'float', min: 0, max: 1, default: 1,
        automation: automation('gain', 'linear')
      }
    ]),
    /duplicate automation key/
  );
});

test('automation metadata does not change packed layout and released contracts stay stable', () => {
  const privateSpec = spec('StableAutomationProbe', [
    { name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0 }
  ]);
  const publicSpec = spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0,
      automation: automation('gain', 'linear')
    }
  ]);
  assert.equal(privateSpec.hash, publicSpec.hash);

  const released = buildAutomationCatalog([publicSpec]);
  const withAddition = buildAutomationCatalog([spec('StableAutomationProbe', [
    {
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0,
      automation: automation('gain', 'linear')
    },
    {
      name: 'mix', key: 'mx', kind: 'float', min: 0, max: 1, default: 1,
      automation: automation('mix', 'linear')
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
      automation: automation('gain', 'linear')
    }
  ])]);
  assert.throws(
    () => validateAutomationCompatibility(released, changedRange),
    /changed minimum/
  );
});
