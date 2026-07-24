import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DSP_PARAM_LAYOUTS,
  DSP_PARAM_PACKERS
} from '../../js/audio/dsp-params.generated.js';
import { loadParamSpecs } from '../../scripts/gen-dsp-params.mjs';
import {
  defaultParamsFromSchema,
  discoverCasePlan
} from '../../tools/dsp-parity/cases.mjs';

const metadata = JSON.parse(fs.readFileSync(
  new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url),
  'utf8'
));

function paramsWithFieldValue(field, value) {
  if (field.arrayKey) {
    return { [field.arrayKey]: Array(field.count).fill(value) };
  }
  if (field.objectArrayKey) {
    return {
      [field.objectArrayKey]: Array.from(
        { length: field.count },
        () => ({ [field.memberKey]: value })
      )
    };
  }
  return Object.fromEntries(field.keys.map(key => [key, value]));
}

function assertPackedField(packer, field, offset, value, expected, label) {
  const packed = packer.pack(paramsWithFieldValue(field, value));
  for (let index = 0; index < field.count; ++index) {
    const fieldExpected = typeof expected === 'function' ? expected(index) : expected;
    assert.equal(
      packed[offset + index],
      Math.fround(fieldExpected),
      `${label}[${index}]`
    );
  }
}

test('every shipped DSP type packs explicit schema defaults matching artifact metadata', async () => {
  assert.equal(metadata.kernels.length, 70);
  assert.equal(DSP_PARAM_PACKERS.size, metadata.kernels.length);
  assert.deepEqual(
    new Set(Object.keys(DSP_PARAM_LAYOUTS)),
    new Set(metadata.kernels.map(kernel => kernel.name))
  );

  const schemas = new Map(await Promise.all(metadata.kernels.map(async kernel => {
    const plan = await discoverCasePlan({ type: kernel.name });
    assert.ok(plan.schema, `${kernel.name} schema`);
    return [kernel.name, plan.schema];
  })));

  for (const kernel of metadata.kernels) {
    const layout = DSP_PARAM_LAYOUTS[kernel.name];
    const packer = DSP_PARAM_PACKERS.get(kernel.name);
    assert.ok(layout, `${kernel.name} layout`);
    assert.ok(packer, `${kernel.name} packer`);
    assert.equal(layout.hash, kernel.hash, `${kernel.name} layout hash`);
    assert.equal(packer.hash, kernel.hash, `${kernel.name} packer hash`);
    assert.equal(packer.floatCount, layout.floatCount, `${kernel.name} float count`);

    const packed = packer.pack({});
    assert.ok(packed instanceof Float32Array, `${kernel.name} numeric payload`);
    assert.equal(packed.length, layout.floatCount, `${kernel.name} numeric payload length`);
    assert.equal(packed.every(Number.isFinite), true, `${kernel.name} finite defaults`);
    const explicitDefaults = defaultParamsFromSchema(schemas.get(kernel.name));
    assert.deepEqual(
      packer.pack(explicitDefaults),
      packed,
      `${kernel.name} explicit schema defaults`
    );

    const byteCapacity = kernel.byteCapacity ?? 0;
    assert.equal(layout.byteCapacity ?? 0, byteCapacity, `${kernel.name} byte capacity`);
    assert.equal(packer.byteCapacity ?? 0, byteCapacity, `${kernel.name} packer byte capacity`);
    if (byteCapacity > 0) {
      assert.equal(typeof packer.packBytes, 'function', `${kernel.name} byte packer`);
      const packedBytes = packer.packBytes({});
      assert.ok(packedBytes instanceof Uint8Array, `${kernel.name} structured payload`);
      assert.ok(packedBytes.byteLength <= byteCapacity, `${kernel.name} structured payload capacity`);
      assert.deepEqual(
        packer.packBytes(explicitDefaults),
        packedBytes,
        `${kernel.name} explicit structured defaults`
      );
    } else {
      assert.equal(packer.packBytes, undefined, `${kernel.name} has no structured payload`);
    }
  }
});

test('numeric DSP parameters clamp to schema bounds and reject invalid values', () => {
  for (const spec of loadParamSpecs()) {
    const packer = DSP_PARAM_PACKERS.get(spec.type);
    assert.ok(packer, `${spec.type} packer`);
    let offset = 0;
    for (const field of spec.fields) {
      if (field.kind === 'float' || field.kind === 'int') {
        const below = field.kind === 'int'
          ? field.min - 1
          : field.min - Math.max(1, Math.abs(field.min) * 0.5);
        const above = field.kind === 'int'
          ? field.max + 1
          : field.max + Math.max(1, Math.abs(field.max) * 0.5);
        assertPackedField(
          packer, field, offset, below, field.min,
          `${spec.type}.${field.name} clamps below min`
        );
        assertPackedField(
          packer, field, offset, above, field.max,
          `${spec.type}.${field.name} clamps above max`
        );
        for (const invalid of [NaN, Infinity, '1', null]) {
          assertPackedField(
            packer, field, offset, invalid, index => field.defaults[index],
            `${spec.type}.${field.name} rejects ${String(invalid)}`
          );
        }
        if (field.kind === 'int') {
          assertPackedField(
            packer, field, offset, field.min + 0.5,
            index => field.defaults[index],
            `${spec.type}.${field.name} rejects non-integer values`
          );
        }
      }
      offset += field.count;
    }
  }
});
