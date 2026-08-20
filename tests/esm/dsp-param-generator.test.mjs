import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeLayoutHash,
  generateOutputs,
  validateParamSpec
} from '../../scripts/gen-dsp-params.mjs';

test('DSP layout hash changes when enum value order changes', () => {
  const fields = [{
    name: 'waveform',
    kind: 'enum',
    count: 1,
    values: ['sine', 'square', 'triangle']
  }];
  const reorderedFields = [{
    ...fields[0],
    values: ['sine', 'triangle', 'square']
  }];

  assert.notEqual(computeLayoutHash(fields), computeLayoutHash(reorderedFields));
});

test('DSP schemas generate C++ and renderer JavaScript bindings', () => {
  const spec = validateParamSpec({
    type: 'ProductionProbe',
    tolerance: { abs: 1e-6 },
    fields: [{
      name: 'gain', key: 'gn', kind: 'float', min: -1, max: 1, default: 0
    }]
  });
  const outputs = generateOutputs([spec]);
  const generatedJs = [...outputs.entries()]
    .find(([file]) => file.endsWith('dsp-params.generated.js'))[1];

  assert.ok([...outputs.keys()].some(file => file.endsWith('ProductionProbeParams.h')));
  assert.match(generatedJs, /ProductionProbe/);
});

test('DSP parameter generator requires a positive display step on automatable fields', () => {
  const withStep = step => ({
    type: 'StepProbe',
    tolerance: { abs: 1e-6 },
    fields: [{
      name: 'gain',
      key: 'gn',
      kind: 'float',
      min: -1,
      max: 1,
      default: 0,
      automation: true,
      ...(step === undefined ? {} : { step })
    }]
  });

  assert.throws(
    () => validateParamSpec(withStep(undefined)),
    /must declare a display step/
  );
  assert.throws(() => validateParamSpec(withStep(0)), /must be greater than zero/);
  assert.throws(() => validateParamSpec(withStep(-1)), /must be greater than zero/);
  assert.ok(validateParamSpec(withStep(0.01)));
});

test('DSP parameter generator publishes the display step to both bindings', () => {
  const spec = validateParamSpec({
    type: 'StepPublicationProbe',
    tolerance: { abs: 1e-6 },
    fields: [{
      name: 'bandGain',
      key: 'bg',
      kind: 'float',
      min: -24,
      max: 24,
      step: 0.25,
      default: 0,
      unit: 'dB',
      automation: true
    }]
  });
  const outputs = [...generateOutputs([spec]).entries()];
  const cpp = outputs.find(([file]) => file.endsWith('AutomationCatalog.h'))[1];
  const generatedJs = outputs.find(([file]) => file.endsWith('dsp-params.generated.js'))[1];

  // The struct member order is part of the native ABI: step sits between the
  // range and the default value, so assert the initializer position, not just
  // the presence of the number.
  assert.match(cpp, /float minimum;\n  float maximum;\n  float step;\n  float defaultValue;/);
  assert.match(cpp, /AutomationParameterDescriptor\{"bg".*-24\.0f, 24\.0f, 0\.25f, 0\.0f,/);
  assert.match(generatedJs, /"publicName":"bandGain".*"maximum":24,"step":0\.25,"default":0/);
});

test('DSP parameter generator can reject invalid enum values before packing', async () => {
  const spec = validateParamSpec({
    type: 'StrictEnumProbe',
    tolerance: { abs: 1e-6 },
    fields: [{
      name: 'mode',
      key: 'mode',
      kind: 'enum',
      values: ['line', 'power'],
      default: 'line',
      rejectInvalid: true
    }]
  });
  const generatedJs = [...generateOutputs([spec]).entries()]
    .find(([file]) => file.endsWith('dsp-params.generated.js'))[1];
  const module = await import(`data:text/javascript,${encodeURIComponent(generatedJs)}`);

  assert.deepEqual([...module.packStrictEnumProbeParams({})], [0]);
  assert.deepEqual([...module.packStrictEnumProbeParams({ mode: 'power' })], [1]);
  assert.throws(
    () => module.packStrictEnumProbeParams({ mode: 'unknown' }),
    /Invalid enum value for mode/
  );
  assert.throws(
    () => module.packStrictEnumProbeParams({ mode: 1 }),
    /Invalid enum value for mode/
  );
});

test('DSP parameter generator escapes values embedded in JavaScript source', async t => {
  const probeName = '__effetuneDspCodegenProbe';
  const hostileKey = `gain</script>\u2028\u2029"];globalThis.${probeName}=true;//`;
  const hostileEnumValue = 'wide</script><!--\u2028\u2029';
  const spec = validateParamSpec({
    type: 'SecurityProbe',
    tolerance: { abs: 1e-6 },
    fields: [
      {
        name: 'mode',
        key: 'mode',
        kind: 'enum',
        values: [hostileEnumValue, 'narrow'],
        default: hostileEnumValue
      },
      {
        name: 'gain',
        key: hostileKey,
        kind: 'float',
        min: -1,
        max: 1,
        default: 0
      }
    ]
  });
  const generatedJs = [...generateOutputs([spec]).entries()]
    .find(([filePath]) => filePath.endsWith('dsp-params.generated.js'))?.[1];

  assert.equal(typeof generatedJs, 'string');
  assert.equal(generatedJs.includes('</script>'), false);
  assert.equal(generatedJs.includes('\u2028'), false);
  assert.equal(generatedJs.includes('\u2029'), false);
  assert.match(generatedJs, /\\u003C\/script\\u003E/);
  assert.match(generatedJs, /\\u2028/);
  assert.match(generatedJs, /\\u2029/);

  globalThis[probeName] = false;
  t.after(() => {
    delete globalThis[probeName];
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(generatedJs).toString('base64')}`;
  const generatedModule = await import(moduleUrl);
  const packed = generatedModule.packSecurityProbeParams({
    mode: hostileEnumValue,
    [hostileKey]: 2
  });

  assert.equal(globalThis[probeName], false);
  assert.deepEqual([...packed], [0, 1]);
});
