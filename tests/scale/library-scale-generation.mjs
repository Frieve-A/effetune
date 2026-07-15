import assert from 'node:assert/strict';

import {
  DEFAULT_BATCH_SIZE,
  resolveScaleSize,
  summarizeCatalog
} from '../../tools/library-scale/catalog-fixture.mjs';
import {
  createVirtualizationPlan,
  locateVirtualRow
} from '../../tools/library-scale/benchmark-virtualization.mjs';
import { parseArgs } from '../../tools/library-scale/cli.mjs';

const args = parseArgs(process.argv.slice(2));
const count = resolveScaleSize({ size: args.size, preset: args.preset });
const batchSize = args['batch-size'] === undefined ? DEFAULT_BATCH_SIZE : Number(args['batch-size']);
const first = summarizeCatalog({ count, batchSize });
const second = summarizeCatalog({ count, batchSize });
assert.deepEqual(second, first);
assert.equal(first.count, count);
assert.ok(first.maxBatchRows <= batchSize);
assert.notEqual(first.firstTrackUid, first.lastTrackUid);

const plan = createVirtualizationPlan({ rowCount: count });
assert.ok(plan.maximumRenderedSegmentPixels <= plan.maxSegmentPixels);
assert.equal(locateVirtualRow(plan, count - 1).segmentIndex, plan.segmentCount - 1);

console.log(JSON.stringify({ catalog: first, virtualization: plan }, null, 2));
