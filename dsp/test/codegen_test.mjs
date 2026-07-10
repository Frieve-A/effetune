import assert from 'node:assert/strict';

import {
  computeLayoutHash,
  generateOutputs,
  validateParamSpec
} from '../../scripts/gen-dsp-params.mjs';

const valid = validateParamSpec({
  type: 'ExamplePlugin',
  tolerance: { abs: 1e-6, policy: 'per-sample' },
  fields: [
    { name: 'gain', key: 'gn', kind: 'float', min: 0, max: 2, default: 1 },
    { name: 'mode', key: 'md', kind: 'enum', values: ['a', 'b'], default: 'a' },
    { name: 'bands', key: 'b', kind: 'int', count: 2, min: 1, max: 8, default: [2, 4] }
  ]
}, 'valid fixture');

assert.equal(valid.floatCount, 4);
assert.equal(valid.fields[2].keys.join(','), 'b0,b1');
assert.equal(valid.hash, computeLayoutHash(valid.fields));

const structured = validateParamSpec({
  type: 'MatrixFixturePlugin',
  tolerance: { abs: 1e-6, policy: 'per-sample' },
  fields: [],
  structured: {
    name: 'matrixRoutes',
    key: 'mx',
    codec: 'matrix-routes-v1',
    maxItems: 1024,
    default: '0011'
  }
}, 'structured fixture');
assert.equal(structured.floatCount, 0);
assert.equal(structured.byteCapacity, 3076);
assert.equal(structured.hash, computeLayoutHash([], structured.structured));

const arrayField = validateParamSpec({
  type: 'ArrayFixturePlugin',
  tolerance: { abs: 1e-6, policy: 'per-sample' },
  fields: [
    { name: 'mute', key: 'm', arrayKey: 'm', kind: 'bool', count: 2, default: false }
  ]
}, 'array fixture');
assert.equal(arrayField.fields[0].arrayKey, 'm');

const objectArrayFields = validateParamSpec({
  type: 'ObjectArrayFixturePlugin',
  tolerance: { abs: 1e-6, policy: 'per-sample' },
  fields: [
    {
      name: 'drive', key: 'dr', objectArrayKey: 'bands', memberKey: 'dr',
      kind: 'float', count: 3, min: 0, max: 3, default: [0.5, 1, 1.5]
    },
    {
      name: 'active', key: 'ac', objectArrayKey: 'bands', memberKey: 'en',
      kind: 'bool', count: 3, default: true
    }
  ]
}, 'object array fixture');
assert.equal(objectArrayFields.fields[0].objectArrayKey, 'bands');
assert.equal(objectArrayFields.fields[0].memberKey, 'dr');
assert.equal(objectArrayFields.hash, computeLayoutHash(objectArrayFields.fields));

const generatedOutputs = generateOutputs([structured, arrayField, objectArrayFields]);
const generatedJs = [...generatedOutputs]
  .find(([, contents]) => contents.includes('export const DSP_PARAM_PACKERS'))?.[1];
assert.ok(generatedJs);
const generated = await import(`data:text/javascript;base64,${Buffer.from(generatedJs).toString('base64')}`);
const matrixPacker = generated.DSP_PARAM_PACKERS.get('MatrixFixturePlugin');
assert.equal(matrixPacker.byteCapacity, 3076);
assert.deepEqual([...matrixPacker.pack()], []);
assert.deepEqual([...matrixPacker.packBytes()], [1, 0, 2, 0, 0, 0, 0, 1, 1, 0]);
assert.deepEqual(
  [...matrixPacker.packBytes({ mx: 'p01p01p88p99x0p' })],
  [1, 0, 3, 0, 0, 1, 1, 0, 1, 1, 8, 8, 1]
);
assert.deepEqual(
  [...matrixPacker.packBytes({ mx: '0010' })],
  [1, 0, 2, 0, 0, 0, 0, 1, 0, 0]
);
assert.throws(
  () => matrixPacker.packBytes({ mx: '00'.repeat(1025) }),
  /structured route capacity exceeded/
);
const arrayPacker = generated.DSP_PARAM_PACKERS.get('ArrayFixturePlugin');
assert.deepEqual([...arrayPacker.pack({ m: [true, false] })], [1, 0]);
assert.deepEqual([...arrayPacker.pack({ m0: false, m1: true })], [0, 1]);
const objectArrayPacker = generated.DSP_PARAM_PACKERS.get('ObjectArrayFixturePlugin');
assert.deepEqual(
  [...objectArrayPacker.pack({
    bands: [
      { dr: 0.25, en: false },
      { dr: 1.25, en: true },
      { dr: 2.25, en: 0 }
    ]
  })],
  [0.25, 1.25, 2.25, 0, 1, 0]
);
assert.deepEqual(
  [...objectArrayPacker.pack({
    dr0: 0.75, dr1: 1.5, dr2: 2.75,
    ac0: false, ac1: 0, ac2: true
  })],
  [0.75, 1.5, 2.75, 0, 0, 1]
);
assert.deepEqual(
  [...objectArrayPacker.pack({ bands: [{ dr: 2 }] })],
  [2, 1, 1.5, 1, 1, 1]
);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [
    { name: 'first', key: 'x', kind: 'bool', default: true },
    { name: 'second', key: 'x', kind: 'bool', default: false }
  ]
}), /packed key collision/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [{ name: 'mode', key: 'md', kind: 'enum', values: ['a'], default: 'b' }]
}), /enum defaults/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [{ name: 'gain', key: 'gn', kind: 'float', min: 0, max: 1, default: 2 }]
}), /outside min\/max/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [],
  structured: { name: 'routes', key: 'mx', codec: 'unknown', maxItems: 1 }
}), /structured.codec/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [{ name: 'gain', key: 'gn', arrayKey: 'g', kind: 'float', min: 0, max: 1, default: 0 }]
}), /arrayKey/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [{
    name: 'gain', key: 'gn', objectArrayKey: 'bands', kind: 'float', count: 3,
    min: 0, max: 1, default: 0
  }]
}), /objectArrayKey and memberKey/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [{
    name: 'gain', key: 'gn', arrayKey: 'gains', objectArrayKey: 'bands', memberKey: 'gain',
    kind: 'float', count: 3, min: 0, max: 1, default: 0
  }]
}), /cannot combine arrayKey with objectArrayKey/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [
    {
      name: 'gain', key: 'gn', objectArrayKey: 'bands', memberKey: 'value',
      kind: 'float', count: 3, min: 0, max: 1, default: 0
    },
    {
      name: 'mix', key: 'mx', objectArrayKey: 'bands', memberKey: 'value',
      kind: 'float', count: 3, min: 0, max: 1, default: 0
    }
  ]
}), /member key collision/);

assert.throws(() => validateParamSpec({
  type: 'BadPlugin',
  tolerance: { abs: 1e-6 },
  fields: [
    {
      name: 'gain', key: 'gn', objectArrayKey: 'bands', memberKey: 'gain',
      kind: 'float', count: 3, min: 0, max: 1, default: 0
    },
    {
      name: 'mix', key: 'mx', objectArrayKey: 'bands', memberKey: 'mix',
      kind: 'float', count: 2, min: 0, max: 1, default: 0
    }
  ]
}), /must use the same count/);

console.log('DSP parameter codegen tests passed');
