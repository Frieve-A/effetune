import assert from 'node:assert/strict';
import test from 'node:test';

import { computeLayoutHash } from '../../scripts/gen-dsp-params.mjs';

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
