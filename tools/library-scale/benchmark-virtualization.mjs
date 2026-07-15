import {
  DEFAULT_SCALE_SIZE,
  resolveScaleSize
} from './catalog-fixture.mjs';
import { elapsedMilliseconds, isMain, parseArgs, printResult } from './cli.mjs';

export const DEFAULT_ROW_HEIGHT = 40;
export const DEFAULT_MAX_SEGMENT_PIXELS = 8_000_000;

function positiveInteger(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return number;
}

export function createVirtualizationPlan({
  rowCount,
  rowHeight = DEFAULT_ROW_HEIGHT,
  maxSegmentPixels = DEFAULT_MAX_SEGMENT_PIXELS
}) {
  const count = positiveInteger(rowCount, 'rowCount');
  const height = positiveInteger(rowHeight, 'rowHeight');
  const pixelBudget = positiveInteger(maxSegmentPixels, 'maxSegmentPixels');
  const rowsPerSegment = Math.floor(pixelBudget / height);
  if (rowsPerSegment < 1) throw new RangeError('maxSegmentPixels must fit at least one row');
  const segmentCount = Math.ceil(count / rowsPerSegment);
  const finalSegmentRows = count - ((segmentCount - 1) * rowsPerSegment);
  const logicalHeight = BigInt(count) * BigInt(height);
  return {
    rowCount: count,
    rowHeight: height,
    maxSegmentPixels: pixelBudget,
    rowsPerSegment,
    segmentCount,
    finalSegmentRows,
    maximumRenderedSegmentPixels: Math.min(rowsPerSegment, count) * height,
    logicalHeight: logicalHeight.toString()
  };
}

export function locateVirtualRow(plan, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= plan.rowCount) {
    throw new RangeError('ordinal is outside the virtualized collection');
  }
  const segmentIndex = Math.floor(ordinal / plan.rowsPerSegment);
  const rowWithinSegment = ordinal - (segmentIndex * plan.rowsPerSegment);
  return {
    segmentIndex,
    rowWithinSegment,
    offsetWithinSegment: rowWithinSegment * plan.rowHeight
  };
}

function usage() {
  return [
    'Usage: node tools/library-scale/benchmark-virtualization.mjs [options]',
    `  --size <rows>          row count (safe default: ${DEFAULT_SCALE_SIZE})`,
    '  --preset <name>        million or boundary',
    `  --row-height <px>      row height (default: ${DEFAULT_ROW_HEIGHT})`,
    `  --segment-pixels <px>  per-segment pixel ceiling (default: ${DEFAULT_MAX_SEGMENT_PIXELS})`,
    '  --json                 print JSON'
  ].join('\n');
}

export function runVirtualizationBenchmark(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const rowCount = resolveScaleSize({ size: args.size, preset: args.preset });
  const startedAt = process.hrtime.bigint();
  const plan = createVirtualizationPlan({
    rowCount,
    rowHeight: positiveInteger(args['row-height'], 'row-height', DEFAULT_ROW_HEIGHT),
    maxSegmentPixels: positiveInteger(
      args['segment-pixels'],
      'segment-pixels',
      DEFAULT_MAX_SEGMENT_PIXELS
    )
  });
  const probes = [0, Math.floor(rowCount / 2), rowCount - 1]
    .map(ordinal => ({ ordinal, ...locateVirtualRow(plan, ordinal) }));
  const result = { ...plan, probes, elapsedMs: elapsedMilliseconds(startedAt) };
  printResult(result, { json: args.json, output: io });
  return result;
}

if (isMain(import.meta.url)) {
  try {
    runVirtualizationBenchmark();
  } catch (error) {
    console.error(`Virtualization benchmark failed: ${error.message}`);
    process.exitCode = 1;
  }
}
