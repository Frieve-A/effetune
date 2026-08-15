import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildAutomationCatalog, loadParamSpecs } from '../../scripts/gen-dsp-params.mjs';
import { defaultParamsFromSchema } from './cases.mjs';
import { createReferenceSession } from './node-host.mjs';
import {
  isProductionNativePromotedReferenceEngine,
  runNativeCase,
  runWasmCase
} from './runners.mjs';
import { generateStimulus } from './stimuli.mjs';
import { compareAudio, formatComparison } from './tolerance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exactRates = Object.freeze([
  Object.freeze({ sampleRate: 44100, quantum: 8 }),
  Object.freeze({ sampleRate: 48000, quantum: 8 }),
  Object.freeze({ sampleRate: 88200, quantum: 16 }),
  Object.freeze({ sampleRate: 96000, quantum: 16 }),
  Object.freeze({ sampleRate: 176400, quantum: 32 }),
  Object.freeze({ sampleRate: 192000, quantum: 32 })
]);

function clone(value) {
  return structuredClone(value);
}

function automationValue(field, high) {
  if (field.kind === 'bool') return high;
  if (field.kind === 'enum') return field.values[high ? field.values.length - 1 : 0];
  return high ? field.max : field.min;
}

function fieldKeys(field) {
  if (Array.isArray(field.keys)) return field.keys;
  const count = field.count ?? 1;
  return count === 1
    ? [field.key]
    : Array.from({ length: count }, (_, index) => `${field.key}${index}`);
}

function leafEventParams(field, element, value, current) {
  if (field.objectArrayKey) {
    current[field.objectArrayKey][element][field.memberKey] = value;
    return { [field.objectArrayKey]: clone(current[field.objectArrayKey]) };
  }
  if (field.arrayKey) {
    current[field.arrayKey][element] = value;
    return { [field.arrayKey]: [...current[field.arrayKey]] };
  }
  return { [fieldKeys(field)[element]]: value };
}

async function caseFixture(spec, schema, sampleRate, quantum, fieldName = null) {
  const defaults = defaultParamsFromSchema(schema);
  let asset;
  let channels = 2;
  let channelMode = 'stereo';
  const casesPath = path.join(repoRoot, path.dirname(spec.source), 'cases.json');
  const cases = JSON.parse(await fs.readFile(casesPath, 'utf8'));
  const fixture = cases.cases.find(candidate => candidate.events?.length) ?? cases.cases[0];
  let initial = { ...defaults, ...(cases.defaults?.params ?? {}), ...(fixture?.params ?? {}) };
  if (schema.assets?.length) {
    const assetFixture = cases.cases.find(candidate => candidate.asset);
    if (!assetFixture) throw new Error(`${spec.type} has no asset fixture for automation parity`);
    asset = clone(assetFixture.asset);
    channels = assetFixture.channels ?? cases.defaults?.channels ?? channels;
    channelMode = assetFixture.channelMode ?? cases.defaults?.channelMode ?? channelMode;
    initial = { ...initial, ...(assetFixture.params ?? {}) };
  }
  const events = [];
  const current = clone(defaults);
  let frame = 2 * quantum;
  for (const field of schema.fields.filter(candidate =>
    candidate.automation !== undefined && (!fieldName || candidate.name === fieldName))) {
    const count = field.count ?? 1;
    const fieldDefaults = Array.isArray(field.default)
      ? field.default
      : Array(count).fill(field.default);
    for (let element = 0; element < count; ++element) {
      for (const value of [automationValue(field, true), automationValue(field, false), fieldDefaults[element]]) {
        events.push({ frame, params: leafEventParams(field, element, value, current) });
        frame += quantum;
      }
    }
  }
  const frames = frame + 2 * quantum;
  return {
    id: `automation-dense-${sampleRate}`,
    stimulus: 'noise',
    sampleRate,
    frames,
    channels,
    channelMode,
    channel: null,
    blockSize: 128,
    caseIndex: 9000 + quantum,
    seed: 0xeffe7a5en ^ BigInt(sampleRate),
    params: initial,
    events,
    asset
  };
}

async function runReference(type, testCase, input) {
  const session = await createReferenceSession(type, {
    repoRoot,
    params: testCase.params,
    caseIndex: testCase.caseIndex,
    seed: testCase.seed
  });
  if (testCase.params?.fr === true && 'fr' in session.plugin) session.plugin.fr = true;
  if (typeof session.plugin.onMessage === 'function') {
    session.plugin.onMessage({ sampleRate: testCase.sampleRate });
  }
  return { output: await session.process(input, testCase) };
}

function parseArguments(argv) {
  const typeIndex = argv.indexOf('--type');
  const fieldIndex = argv.indexOf('--field');
  const runnerIndex = argv.indexOf('--native-runner');
  const wasmIndex = argv.indexOf('--wasm-path');
  const afterIndex = argv.indexOf('--after');
  return {
    type: typeIndex >= 0 ? argv[typeIndex + 1] : null,
    field: fieldIndex >= 0 ? argv[fieldIndex + 1] : null,
    runnerPath: runnerIndex >= 0 ? argv[runnerIndex + 1] : null,
    wasmPath: wasmIndex >= 0 ? argv[wasmIndex + 1] : null,
    after: afterIndex >= 0 ? argv[afterIndex + 1] : null,
    allocations: argv.includes('--allocations')
  };
}

export async function runAutomationEventParity({
  type = null, field = null, after = null, runnerPath, wasmPath = null, allocations = false
} = {}) {
  if (!runnerPath) throw new Error('--native-runner is required');
  const specs = loadParamSpecs();
  const catalog = buildAutomationCatalog(specs);
  let comparisons = 0;
  let jsNativeComparisons = 0;
  let wasmNativeComparisons = 0;
  let nativeOnlyReplays = 0;
  let matchedCases = 0;
  let afterReached = after === null;
  for (const spec of specs) {
    if (!afterReached) {
      afterReached = spec.type === after;
      continue;
    }
    if (type && spec.type !== type) continue;
    if (catalog.effects[spec.type].length === 0) continue;
    const schema = JSON.parse(await fs.readFile(path.join(repoRoot, spec.source), 'utf8'));
    for (const { sampleRate, quantum } of exactRates) {
      ++matchedCases;
      const testCase = await caseFixture(spec, schema, sampleRate, quantum, field);
      const input = generateStimulus({
        id: testCase.stimulus,
        sampleRate,
        frames: testCase.frames,
        channels: testCase.channels,
        caseIndex: testCase.caseIndex,
        seed: testCase.seed
      });
      const native = await runNativeCase({
        type: spec.type,
        testCase,
        input,
        schema,
        runnerPath,
        repoRoot,
        allocations
      });
      const nativeReference = Boolean(schema.parityReference);
      const hasWasmTransitionReference =
        isProductionNativePromotedReferenceEngine(schema.parityReference);
      const reference = hasWasmTransitionReference
        ? { output: await runWasmCase({
            type: spec.type,
            testCase,
            input,
            schema,
            repoRoot,
            wasmPath: wasmPath ?? undefined
          }) }
        : (nativeReference ? null : await runReference(spec.type, testCase, input));
      if (!native.every(Number.isFinite)) {
        throw new Error(`${spec.type}/${testCase.id} produced non-finite native output`);
      }
      if (nativeReference) {
        ++nativeOnlyReplays;
        console.log(
          `CHECK native-only ${spec.type}/${testCase.id}: finite output` +
          (allocations ? ', allocation guard passed' : '')
        );
      }
      if (reference === null) {
        console.log(
          `CHECK oracle-deferred ${spec.type}/${testCase.id}: ` +
          'effect-specific transition oracle is run by canonical verification'
        );
        continue;
      }
      if (!reference.output.every(Number.isFinite)) {
        throw new Error(`${spec.type}/${testCase.id} produced non-finite reference output`);
      }
      const comparison = compareAudio(reference.output, native, schema.tolerance, {
        channels: testCase.channels,
        frames: testCase.frames
      });
      const coverage = hasWasmTransitionReference
        ? 'WASM/native transition parity'
        : 'JS/native parity';
      console.log(`${comparison.pass ? 'PASS' : 'FAIL'} ${spec.type}/${testCase.id} (${coverage}): ${formatComparison(comparison)}`);
      if (!comparison.pass) {
        if (comparison.firstOffendingIndex >= 0) {
          const index = comparison.firstOffendingIndex;
          const referenceLabel = hasWasmTransitionReference ? 'WASM' : 'JS';
          console.error(
            `  first mismatch[${index}]: ${referenceLabel}=${reference.output[index]} ` +
            `native=${native[index]}`
          );
        }
        throw new Error(`${spec.type}/${testCase.id} automation parity failed`);
      }
      if (hasWasmTransitionReference) ++wasmNativeComparisons;
      else ++jsNativeComparisons;
      ++comparisons;
    }
  }
  if (type && matchedCases === 0) throw new Error(`No automated effect matched ${type}`);
  console.log(
    `Automation parameter-event verification completed: ${comparisons} independent parity cases ` +
    `(${jsNativeComparisons} JS/native, ${wasmNativeComparisons} WASM/native); ` +
    `${nativeOnlyReplays} native-only finiteness/allocation replays were checked separately.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAutomationEventParity({ ...parseArguments(process.argv.slice(2)) }).catch(error => {
    console.error(`Automation parameter-event parity failed: ${error.message}`);
    process.exitCode = 1;
  });
}
