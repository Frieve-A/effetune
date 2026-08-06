// Regression guard for the Tube Simulator "Listening (THD-matched)" preset
// bank. The bank stores pre-calibrated dr / iv / og values measured against the
// shipped WASM kernel, so a kernel change would silently detune every listening
// preset. This test re-measures each record under the exact calibration
// conditions and fails if the baked THD or 1 kHz gain has drifted.
//
// Regenerate the baked values (and the table below) with:
//   node tests/tools/tube-simulator-lineamp/calibrate-listening-presets.mjs
// The coarse grid pitch of the THD solver defaults to 2 dB and every output
// record echoes the pitch it was solved with, so the command needs no flags.
//
// Runtime note: one shared engine drives all seven presets and each preset gets
// a fresh instance, so the first setParams applies without a reset-class
// transition. Each measurement is 3 s of settling (the measured steady-state
// floor of this kernel) plus a 4608-sample analysis window, and the safety step
// adds 1.25 s per preset.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import {
  BLOCK_SIZE,
  LISTENING_BANK,
  SAMPLE_RATE,
  TELEMETRY_BYTES,
  measureStepSafety,
  measureSteadyState,
  readPluginPresetTables
} from '../tools/tube-simulator-lineamp/calibrate-listening-presets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THD_TOLERANCE_POINTS = 0.3;
// Every record has to still be sitting where it was baked: on its target when the
// calibration reached one, on the measured maximum when it could not.
const TARGET_TOLERANCE_POINTS = 0.05;
// Re-measuring against an unchanged kernel is bit-reproducible: two consecutive runs of the
// calibration harness returned identical readings, and each one sits within 5e-5 dB of its
// baked value - that residual is the 4-decimal rounding of the table below, nothing else.
// 0.02 dB is therefore ~400x the observed spread, tight enough that a kernel change which
// detunes any preset by an audible amount cannot slip through.
const GAIN_TOLERANCE_DB = 0.02;
const PARAMETER_FIELD_COUNT = 17;
// The only three fields the calibration is allowed to move; the other 14 are
// inherited verbatim from the canonical base named by the bank definition.
const CALIBRATED_FIELDS = Object.freeze(['dr', 'iv', 'og']);
const NO_RUNTIME_FAULT = Object.freeze({ generation: 0, latched: false, cause: 0 });
const RUNTIME_FAULT_LEGEND =
  '(1 = feedbackOscillation, 2 = processingSafetyFailure)';

// Calibration output baked into plugins/saturation/tube_simulator.js.
// `reachedTarget: false` records the one circuit that cannot be driven to its
// target: the 12AU7 line stage tops out below 1 % at the 20 Vpk `iv` ceiling,
// so the measured maximum is baked as-is rather than fitted.
const BAKED_MEASUREMENTS = Object.freeze([
  Object.freeze({
    id: 'listening-line-12au7-thd1',
    targetThdPercent: 1,
    reachedTarget: false,
    thdPercent: 0.9763,
    gainDb: 0.0004
  }),
  Object.freeze({
    id: 'listening-line-12at7-thd1',
    targetThdPercent: 1,
    reachedTarget: true,
    thdPercent: 0.9972,
    gainDb: 0.0002
  }),
  Object.freeze({
    id: 'listening-line-12ax7-thd1',
    targetThdPercent: 1,
    reachedTarget: true,
    thdPercent: 1.0004,
    gainDb: -0.0001
  }),
  Object.freeze({
    id: 'listening-line-12au7-open-loop-thd3',
    targetThdPercent: 3,
    reachedTarget: true,
    thdPercent: 3.0008,
    gainDb: -0.0005
  }),
  Object.freeze({
    id: 'listening-power-el84-pentode-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9994,
    gainDb: -0.0003
  }),
  Object.freeze({
    id: 'listening-power-el84-distributed-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9997,
    gainDb: 0.0001
  }),
  Object.freeze({
    id: 'listening-power-el34-distributed-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0000,
    gainDb: 0.0002
  })
]);

test('Tube Simulator listening presets keep the frozen 17-field record shape', () => {
  const tables = readPluginPresetTables(repoRoot);
  const canonicalIds = new Set(tables.canonical.map(preset => preset.id));

  assert.deepEqual(
    tables.listening.map(preset => preset.id),
    BAKED_MEASUREMENTS.map(entry => entry.id),
    'listening bank membership drifted from the baked calibration table'
  );

  for (const preset of tables.listening) {
    assert.equal(canonicalIds.has(preset.id), false,
      `${preset.id} must not collide with a canonical preset id`);
    assert.match(preset.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${preset.id} is not kebab-case`);
    assert.equal(typeof preset.label, 'string');
    assert.ok(preset.label.length > 0, `${preset.id} needs a dropdown label`);
    assert.deepEqual(Object.keys(preset.params).sort(), [...tables.fields].sort(),
      `${preset.id} must carry exactly the ${PARAMETER_FIELD_COUNT} serialized fields`);
    assert.equal(Object.keys(preset.params).length, PARAMETER_FIELD_COUNT);
    assert.ok(preset.params.og >= -48 && preset.params.og <= 48,
      `${preset.id} output trim is outside the parameter range`);
    assert.ok(preset.params.dr >= -96 && preset.params.dr <= 0,
      `${preset.id} input volume is outside the parameter range`);
    assert.ok(preset.params.iv >= 0.1 && preset.params.iv <= 20,
      `${preset.id} input reference is outside the parameter range`);
  }
});

test('Tube Simulator listening presets inherit every circuit value from their canonical base',
  () => {
    const tables = readPluginPresetTables(repoRoot);
    const canonicalById = new Map(tables.canonical.map(preset => [preset.id, preset.params]));
    const listeningById = new Map(tables.listening.map(preset => [preset.id, preset]));

    assert.deepEqual(
      tables.listening.map(preset => preset.id),
      LISTENING_BANK.map(entry => entry.id),
      'the shipped bank and the calibration harness disagree on membership'
    );

    for (const entry of LISTENING_BANK) {
      const preset = listeningById.get(entry.id);
      assert.ok(preset, `${entry.id} is missing from the shipped bank`);
      assert.equal(preset.label, entry.label,
        `${entry.id} dropdown label drifted from the calibration harness`);
      const base = canonicalById.get(entry.base);
      assert.ok(base, `${entry.id} names an unknown canonical base "${entry.base}"`);
      const expected = { ...base, ...entry.overrides };
      for (const field of tables.fields) {
        if (CALIBRATED_FIELDS.includes(field)) continue;
        const source = field in entry.overrides
          ? `the declared override on ${entry.id}`
          : `canonical ${entry.base}`;
        assert.equal(preset.params[field], expected[field],
          `${entry.id} ${field} is ${preset.params[field]} but ${source} says ` +
          `${expected[field]}: circuit values must be inherited verbatim`);
      }
    }
  });

test('Tube Simulator listening presets reproduce their baked THD and 1 kHz gain', async () => {
  const tables = readPluginPresetTables(repoRoot);
  const presetsById = new Map(tables.listening.map(preset => [preset.id, preset]));
  const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
  const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
  assert.ok(packer, 'TubeSimulatorPlugin parameter packer is unavailable');

  const binding = await instantiateDsp(wasmBytes);
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);

    for (const baked of BAKED_MEASUREMENTS) {
      const preset = presetsById.get(baked.id);
      assert.ok(preset, `${baked.id} is missing from the listening bank`);
      const measured = measureSteadyState(binding, packer, preset.params);

      assert.equal(measured.finite, true, `${baked.id} produced a non-finite output`);
      assert.deepEqual(measured.runtimeEvent, NO_RUNTIME_FAULT,
        `${baked.id} raised a runtime fault ${RUNTIME_FAULT_LEGEND}`);
      assert.ok(Math.abs(measured.thdPercent - baked.thdPercent) <= THD_TOLERANCE_POINTS,
        `${baked.id} THD drifted: baked ${baked.thdPercent} %, ` +
        `measured ${measured.thdPercent.toFixed(4)} %`);
      assert.ok(Math.abs(measured.gainDb - baked.gainDb) <= GAIN_TOLERANCE_DB,
        `${baked.id} 1 kHz gain drifted: baked ${baked.gainDb} dB, ` +
        `measured ${measured.gainDb.toFixed(4)} dB`);
      if (baked.reachedTarget) {
        assert.ok(
          Math.abs(measured.thdPercent - baked.targetThdPercent) <= TARGET_TOLERANCE_POINTS,
          `${baked.id} has slid off its ${baked.targetThdPercent} % THD target: ` +
          `measured ${measured.thdPercent.toFixed(4)} %`);
      } else {
        assert.ok(measured.thdPercent < baked.targetThdPercent,
          `${baked.id} is baked as unable to reach ${baked.targetThdPercent} % THD, but ` +
          `measured ${measured.thdPercent.toFixed(4)} %: recalibrate the bank`);
        // Staying below the unreachable target is a weak claim on its own - it leaves the
        // whole span under the target green. The maximum this circuit tops out at is the
        // baked figure, so hold it to the same band the on-target records get.
        assert.ok(Math.abs(measured.thdPercent - baked.thdPercent) <= TARGET_TOLERANCE_POINTS,
          `${baked.id} has slid off its baked ${baked.thdPercent} % ceiling: ` +
          `measured ${measured.thdPercent.toFixed(4)} %`);
      }
    }
  } finally {
    binding.close();
  }
});

// The ship gate the calibration harness applies has to be a
// standing guard, not a one-off reading taken while the bank was generated: a
// preset that latches the permanent dry state on a transient must not ship.
// The 13 s noise-decay tail stays in the harness because it is far too slow for
// a regression file; the silence -> full-scale step is 1.25 s per preset.
test('Tube Simulator listening presets survive a silence to full-scale step', async () => {
  const tables = readPluginPresetTables(repoRoot);
  const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
  const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
  assert.ok(packer, 'TubeSimulatorPlugin parameter packer is unavailable');
  assert.equal(tables.listening.length, LISTENING_BANK.length);

  const binding = await instantiateDsp(wasmBytes);
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);

    for (const preset of tables.listening) {
      const stepped = measureStepSafety(binding, packer, preset.params);
      assert.equal(stepped.finite, true,
        `${preset.id} emitted a non-finite sample across the step`);
      assert.deepEqual(stepped.runtimeEvent, NO_RUNTIME_FAULT,
        `${preset.id} latched a runtime fault across the step ${RUNTIME_FAULT_LEGEND}`);
    }
  } finally {
    binding.close();
  }
});
