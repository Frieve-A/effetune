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
