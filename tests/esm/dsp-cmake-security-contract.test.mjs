import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cmakeSource = await readFile(
  new URL('../../dsp/CMakeLists.txt', import.meta.url),
  'utf8'
);

test('the primitives test target is absent when BUILD_TESTING is disabled', () => {
  const declarations = [...cmakeSource.matchAll(
    /et_add_dsp_test\(effetune_dsp_primitives_tests\b/g
  )];
  assert.equal(declarations.length, 1);

  const declarationOffset = declarations[0].index;
  const guardOffset = cmakeSource.lastIndexOf('if(BUILD_TESTING)', declarationOffset);
  const guardEndOffset = cmakeSource.indexOf('endif()', declarationOffset);
  assert.ok(guardOffset >= 0 && guardOffset < declarationOffset);
  assert.ok(guardEndOffset > declarationOffset);
});
