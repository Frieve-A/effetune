// Regression guard for the Tube Simulator listening-oriented preset banks. The
// banks store pre-calibrated dr / iv / og values measured against the
// shipped WASM kernel, so a kernel change would silently detune every listening
// preset. This test re-measures each record under the exact calibration
// conditions and fails if the baked reference-sine THD has drifted. THD and
// level matching use the same practical, reproducible -12 dBFS peak point as
// Pipeline Analyzer. It approximates average-to-loud passages; it is not a
// loudness standard or a real-music THD guarantee. Music results vary with its
// waveform, crest factor, spectrum, instantaneous level, and circuit state.
//
// Regenerate the baked values (and the table below) with:
//   node tests/tools/tube-simulator-lineamp/calibrate-listening-presets.mjs
// The coarse grid pitch of the THD solver defaults to 2 dB and every output
// record echoes the pitch it was solved with, so the command needs no flags.
//
// Runtime note: one shared engine drives all 35 presets and each preset gets
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
  CALIBRATION_BANK,
  HIDDEN_AUDIT_BANK,
  LISTENING_BANK,
  MAX_INPUT_REFERENCE,
  PRESET_LEVEL_MATCH_TARGET_RMS_GAIN_DB,
  PRESET_REFERENCE_AMPLITUDE,
  PRESET_REFERENCE_PEAK_DBFS,
  SAMPLE_RATE,
  SETTLE_SAMPLES,
  TELEMETRY_BYTES,
  TONE_HZ,
  analyseTone,
  auditHiddenPresets,
  measureStepSafety,
  measureSteadyState,
  prepareMeasurementParams,
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
const PARAMETER_FIELD_COUNT = 21;
// The only three fields the calibration is allowed to move; the other 18 are
// inherited verbatim from the canonical base named by the bank definition.
const CALIBRATED_FIELDS = Object.freeze(['dr', 'iv', 'og']);
const NO_RUNTIME_FAULT = Object.freeze({ generation: 0, latched: false, cause: 0 });
const RUNTIME_FAULT_LEGEND =
  '(1 = feedbackOscillation, 2 = processingSafetyFailure)';

// Independent compatibility contract for records that stay programmatically
// applicable but are intentionally absent from the selectable bank.
const HIDDEN_LEGACY_DRIVE_TARGETS = Object.freeze([
  Object.freeze({
    source: 'listening', id: 'listening-line-12au7-thd1', iv: 20, target: 1
  }),
  Object.freeze({ source: 'powerOnly', id: 'power-only-se-300b', iv: 20, target: 2 }),
  Object.freeze({ source: 'powerOnly', id: 'power-only-se-2a3', iv: 20, target: 2 })
]);

// Stable serialization order for the 20 fields other than Output Trim.
const LEVEL_MATCH_STATE_FIELDS = Object.freeze([
  'dr', 'tp', 'bi', 'pv', 'sz', 'su', 'mx', 'iv', 'nf', 'os',
  'pt', 'pb', 'kr', 'st', 'zp', 'sl', 'sd', 'sb', 'sr', 'sp'
]);

// Independent ship contract for every selectable listening-oriented preset.
// These values are intentionally literal rather than derived from the canonical
// bank or calibration source. Power-only KT88 uses its stable nf=2 direct-drive loop.
const LEVEL_MATCHED_PRESET_FINGERPRINTS = Object.freeze([
  Object.freeze({ group: 'Pre', id: 'listening-line-12at7-thd0p01', og: 0.619,
    state: Object.freeze([-13.748, '12AT7', 0, 250, 10, 10, 100, 2.828, 30, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12at7-thd0p1', og: -17.268,
    state: Object.freeze([0, '12AT7', 0, 250, 10, 10, 100, 4.5552, 30, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12ax7-thd0p01', og: 8.508,
    state: Object.freeze([-24.2637, '12AX7', 0, 250, 10, 10, 100, 2.828, 30, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12ax7-thd0p1', og: -11.264,
    state: Object.freeze([-4.4922, '12AX7', 0, 250, 10, 10, 100, 2.828, 30, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12au7-open-loop-thd0p1', og: 28.495,
    state: Object.freeze([-19.2715, '12AU7', 0, 250, 10, 10, 100, 2.828, 0, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12at7-thd1', og: -21.421,
    state: Object.freeze([0, '12AT7', 0, 250, 10, 10, 100, 7.3556, 30, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12ax7-thd1', og: -23.276,
    state: Object.freeze([0, '12AX7', 0, 250, 10, 10, 100, 6.7213, 30, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre', id: 'listening-line-12au7-open-loop-thd1', og: 18.592,
    state: Object.freeze([-9.2656, '12AU7', 0, 250, 10, 10, 100, 2.828, 0, 'Line',
      'EL84', 320, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-el84-pentode-10w-thd0p1', og: 8.696,
    state: Object.freeze([-26.5957, 'Bypass', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 329.696, 270, '0', '8.0', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-el84-distributed-10w-thd0p1', og: 7.363,
    state: Object.freeze([-21.7676, 'Bypass', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 330.107, 270, '20', '6.6', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-el34-distributed-20-37w-thd0p1', og: 3.767,
    state: Object.freeze([-8.1543, 'Bypass', 0, 250, 10, 10, 100, 2.828, 4, 'Power',
      'EL34', 443.775, 470, '43', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-6l6gc-pentode-thd0p1', og: 12.251,
    state: Object.freeze([-19.3047, 'Bypass', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      '6L6GC', 391.454, 483.871, '0', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-kt88-distributed-thd0p1', og: -3.485,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 3.1263, 2, 'Power',
      'KT88', 379.29, 400, '43', '6.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-se-300b-thd0p1', og: 16.582,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 35.4586, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-se-300b-thd1', og: -1.794,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 295.9454, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-se-2a3-thd0p1', og: 21.072,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 18.1347, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '2A3', 300, 750, '2.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-se-2a3-thd1', og: 1.816,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 167.2455, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '2A3', 300, 750, '2.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-el84-pentode-10w', og: -7.483,
    state: Object.freeze([-9.7148, 'Bypass', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 329.696, 270, '0', '8.0', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-el84-distributed-10w', og: -7.322,
    state: Object.freeze([-6.5352, 'Bypass', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 330.107, 270, '20', '6.6', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-el34-distributed-20-37w', og: -9.51,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 5.2781, 4, 'Power',
      'EL34', 443.775, 470, '43', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-6l6gc-pentode', og: -7.187,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 3.3694, 3, 'Power',
      '6L6GC', 391.454, 483.871, '0', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Power', id: 'power-only-kt88-distributed', og: -10.748,
    state: Object.freeze([0, 'Bypass', 0, 250, 10, 10, 100, 7.4992, 2, 'Power',
      'KT88', 379.29, 400, '43', '6.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-el84-distributed-thd0p1', og: 9.91,
    state: Object.freeze([-58.4629, '12AX7', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 330.107, 270, '20', '6.6', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-el34-distributed-thd0p1', og: 17.947,
    state: Object.freeze([-56.4629, '12AX7', 0, 250, 10, 10, 100, 2.828, 4, 'Power',
      'EL34', 443.775, 470, '43', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-6l6gc-pentode-thd0p1', og: 17.255,
    state: Object.freeze([-58.4551, '12AX7', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      '6L6GC', 391.454, 483.871, '0', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-kt88-distributed-thd0p1', og: 21.698,
    state: Object.freeze([-56.4629, '12AX7', 0, 250, 10, 10, 100, 2.828, 4, 'Power',
      'KT88', 379.29, 400, '43', '6.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-se-300b-thd0p1', og: 12.027,
    state: Object.freeze([-15.2227, '12AU7', 0, 250, 10, 10, 100, 2.828, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-se-2a3-thd0p1', og: 18.722,
    state: Object.freeze([-23.2598, '12AU7', 0, 250, 10, 10, 100, 2.828, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '2A3', 300, 750, '2.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-el84-pentode-thd2', og: -7.372,
    state: Object.freeze([-44.0059, '12AX7', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 329.696, 270, '0', '8.0', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-el84-distributed-thd2', og: -7.091,
    state: Object.freeze([-40.9746, '12AX7', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      'EL84', 330.107, 270, '20', '6.6', '15', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-el34-distributed-thd2', og: -6.779,
    state: Object.freeze([-31.6797, '12AX7', 0, 250, 10, 10, 100, 2.828, 4, 'Power',
      'EL34', 443.775, 470, '43', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-6l6gc-pentode-thd2', og: -5.145,
    state: Object.freeze([-35.207, '12AX7', 0, 250, 10, 10, 100, 2.828, 3, 'Power',
      '6L6GC', 391.454, 483.871, '0', '6.6', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-power-kt88-distributed-thd2', og: -3.147,
    state: Object.freeze([-31.5391, '12AX7', 0, 250, 10, 10, 100, 2.828, 4, 'Power',
      'KT88', 379.29, 400, '43', '6.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-se-300b-thd2', og: -0.439,
    state: Object.freeze([-2.4824, '12AU7', 0, 250, 10, 10, 100, 2.828, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '300B', 400, 1000, '3.5']) }),
  Object.freeze({ group: 'Pre+Power', id: 'listening-se-2a3-thd2', og: -0.093,
    state: Object.freeze([-4.2266, '12AU7', 0, 250, 10, 10, 100, 2.828, 3,
      'SingleEnded', 'EL84', 329.696, 270, '0', '8.0', '8', '2A3', 300, 750, '2.5']) }),
]);

// Reference-sine calibration output baked into plugins/saturation/tube_simulator.js.
// `reachedTarget: false` records legacy calibrations that were bounded at
// 20 Vpk; their established measured maxima remain baked for compatibility.
const BAKED_MEASUREMENTS = Object.freeze([
  Object.freeze({
    id: 'listening-line-12at7-thd0p01', targetThdPercent: 0.01,
    reachedTarget: true, thdPercent: 0.0100
  }),
  Object.freeze({
    id: 'listening-line-12at7-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-line-12ax7-thd0p01', targetThdPercent: 0.01,
    reachedTarget: true, thdPercent: 0.0100
  }),
  Object.freeze({
    id: 'listening-line-12ax7-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-line-12au7-open-loop-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-line-12at7-thd1',
    targetThdPercent: 1,
    reachedTarget: true,
    thdPercent: 0.9974
  }),
  Object.freeze({
    id: 'listening-line-12ax7-thd1',
    targetThdPercent: 1,
    reachedTarget: true,
    thdPercent: 1.0003
  }),
  Object.freeze({
    id: 'listening-line-12au7-open-loop-thd1',
    targetThdPercent: 1,
    reachedTarget: true,
    thdPercent: 1.0002
  }),
  Object.freeze({
    id: 'power-only-el84-pentode-10w-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1001
  }),
  Object.freeze({
    id: 'power-only-el84-distributed-10w-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1002
  }),
  Object.freeze({
    id: 'power-only-el34-distributed-20-37w-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'power-only-6l6gc-pentode-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1003
  }),
  Object.freeze({
    id: 'power-only-kt88-distributed-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1002
  }),
  Object.freeze({
    id: 'power-only-se-300b-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'power-only-se-300b-thd1', targetThdPercent: 1,
    reachedTarget: true, thdPercent: 1.0000
  }),
  Object.freeze({
    id: 'power-only-se-2a3-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'power-only-se-2a3-thd1', targetThdPercent: 1,
    reachedTarget: true, thdPercent: 1.0000
  }),
  Object.freeze({
    id: 'listening-power-el84-distributed-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-power-el34-distributed-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-power-6l6gc-pentode-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-power-kt88-distributed-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-se-300b-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-se-2a3-thd0p1', targetThdPercent: 0.1,
    reachedTarget: true, thdPercent: 0.1000
  }),
  Object.freeze({
    id: 'listening-power-el84-pentode-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0004
  }),
  Object.freeze({
    id: 'listening-power-el84-distributed-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0005
  }),
  Object.freeze({
    id: 'listening-power-el34-distributed-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0000
  }),
  Object.freeze({
    id: 'listening-power-6l6gc-pentode-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9998
  }),
  Object.freeze({
    id: 'listening-power-kt88-distributed-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9997
  }),
  Object.freeze({
    id: 'listening-se-300b-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0000
  }),
  Object.freeze({
    id: 'listening-se-2a3-thd2',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0002
  }),
  Object.freeze({
    id: 'power-only-el84-pentode-10w',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9995
  }),
  Object.freeze({
    id: 'power-only-el84-distributed-10w',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0005
  }),
  Object.freeze({
    id: 'power-only-el34-distributed-20-37w',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9995
  }),
  Object.freeze({
    id: 'power-only-6l6gc-pentode',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 2.0004
  }),
  Object.freeze({
    id: 'power-only-kt88-distributed',
    targetThdPercent: 2,
    reachedTarget: true,
    thdPercent: 1.9970
  }),
]);

test('Tube Simulator level matching keeps its fixed measurement contract and preset states', () => {
  assert.equal(SAMPLE_RATE, 96000, 'level matching must run at 96 kHz');
  assert.equal(TONE_HZ, 1000, 'level matching must use a 1 kHz sine');
  assert.equal(PRESET_REFERENCE_PEAK_DBFS, -12,
    'THD and level matching must use the shared reproducible reference point');
  assert.equal(PRESET_REFERENCE_AMPLITUDE, 0.251188643150958,
    'the reproducible reference point must be a -12 dBFS peak sine');
  assert.equal(SETTLE_SAMPLES, 288000,
    'level matching must discard exactly three seconds before analysis');
  assert.equal(PRESET_LEVEL_MATCH_TARGET_RMS_GAIN_DB, 0,
    'level matching must target 0 dB AC RMS gain');

  const tables = readPluginPresetTables(repoRoot);
  const actual = tables.groups.flatMap(group =>
    group.presets.map(preset => ({ group: group.label, ...preset })));
  assert.deepEqual(
    actual.map(preset => [preset.group, preset.id]),
    LEVEL_MATCHED_PRESET_FINGERPRINTS.map(preset => [preset.group, preset.id]),
    'the 35 listening-oriented preset ids or signal-path groups changed'
  );

  for (let index = 0; index < LEVEL_MATCHED_PRESET_FINGERPRINTS.length; index++) {
    const expected = LEVEL_MATCHED_PRESET_FINGERPRINTS[index];
    const preset = actual[index];
    const name = `${expected.group}/${expected.id}`;
    assert.equal(preset.params.og, expected.og,
      `${name} Output Trim changed from the frozen level calibration`);
    assert.deepEqual(
      LEVEL_MATCH_STATE_FIELDS.map(field => preset.params[field]),
      expected.state,
      `${name} changed a non-Output Trim state field; field order is ` +
        LEVEL_MATCH_STATE_FIELDS.join(', ')
    );

    const prepared = prepareMeasurementParams(
      preset.params, { disableAutoGainReduction: true });
    assert.equal(prepared.rl, Number(preset.params.sl),
      `${name} must be measured at its design speaker load`);
    assert.equal(prepared.ag, false,
      `${name} must be measured with Auto Gain Reduction disabled`);
  }
});

test('Tube Simulator hidden compatibility presets keep their legacy 20 Vpk audit point',
  async () => {
    assert.equal(MAX_INPUT_REFERENCE, 300);
    assert.deepEqual(
      HIDDEN_AUDIT_BANK.map(entry => ({
        source: entry.source, id: entry.id, iv: entry.auditInputReference,
        target: entry.targetThdPercent
      })),
      HIDDEN_LEGACY_DRIVE_TARGETS,
      'the hidden audit bank changed independently of its compatibility contract'
    );

    const tables = readPluginPresetTables(repoRoot);
    const selectableIds = new Set(tables.groups.flatMap(group => group.presets)
      .map(preset => preset.id));
    const sourceTables = { listening: tables.listening, powerOnly: tables.powerOnly };
    for (const expected of HIDDEN_LEGACY_DRIVE_TARGETS) {
      assert.equal(selectableIds.has(expected.id), false,
        `${expected.id} must remain outside the selectable bank`);
      const preset = sourceTables[expected.source].find(candidate => candidate.id === expected.id);
      assert.ok(preset, `${expected.id} must remain programmatically available`);
      assert.equal(preset.params.dr, 0, `${expected.id} must retain its legacy Input Volume`);
      assert.equal(preset.params.iv, expected.iv,
        `${expected.id} must retain its legacy Input Reference`);
    }

    // Do not pin the legacy readings exactly; the contract is that widening the
    // parameter range does not silently rewrite these compatibility records.
    const results = await auditHiddenPresets({ log: () => {} });
    assert.deepEqual(results.map(result => result.id),
      HIDDEN_LEGACY_DRIVE_TARGETS.map(expected => expected.id));
    for (const result of results) {
      assert.equal(result.finite, true, `${result.id} produced a non-finite output`);
      assert.deepEqual(result.runtimeEvent, NO_RUNTIME_FAULT,
        `${result.id} raised a runtime fault ${RUNTIME_FAULT_LEGEND}`);
      assert.equal(result.dr, 0);
      assert.equal(result.iv, 20);
      assert.equal(result.reachedTarget, false,
        `${result.id} reached its target at the legacy audit drive`);
      assert.ok(result.auditDriveThdPercent < result.targetThdPercent,
        `${result.id} legacy-drive THD must remain below its hidden-preset target`);
    }
  });

test('Tube Simulator level matching measures AC RMS with DC excluded', () => {
  // Mean 2, AC samples +1/-1: the known AC RMS is exactly 1. Raw RMS would be sqrt(5).
  const analysed = analyseTone(new Float64Array([3, 1, 3, 1]));
  assert.equal(analysed.rmsAmplitude, 1,
    'the level oracle must subtract DC before calculating RMS');
  assert.equal(20 * Math.log10(analysed.rmsAmplitude / 1), 0,
    'equal AC RMS input and output must report 0 dB gain');
});

test('Tube Simulator selectable presets keep the frozen 21-field record shape', () => {
  const tables = readPluginPresetTables(repoRoot);
  const canonicalIds = new Set(tables.canonical.map(preset => preset.id));
  const selectable = tables.groups.flatMap(group => group.presets);

  assert.deepEqual(new Set(selectable.map(preset => preset.id)),
    new Set(BAKED_MEASUREMENTS.map(entry => entry.id)),
    'selectable bank membership drifted from the baked calibration table');

  for (const preset of selectable) {
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
    assert.ok(preset.params.iv >= 0.1 && preset.params.iv <= MAX_INPUT_REFERENCE,
      `${preset.id} input reference is outside the parameter range`);
  }
});

test('Tube Simulator SE preset measurements use their matched 8 ohm load', () => {
  const tables = readPluginPresetTables(repoRoot);
  const presetsById = new Map(tables.groups.flatMap(group => group.presets)
    .map(preset => [preset.id, preset]));

  for (const id of [
    'power-only-se-300b-thd0p1', 'power-only-se-300b-thd1',
    'power-only-se-2a3-thd0p1', 'power-only-se-2a3-thd1',
    'listening-se-300b-thd0p1', 'listening-se-2a3-thd0p1',
    'listening-se-300b-thd2', 'listening-se-2a3-thd2'
  ]) {
    const preset = presetsById.get(id);
    assert.ok(preset, `${id} is missing from the selectable listening bank`);

    const safetyParams = prepareMeasurementParams(preset.params);
    assert.equal(Number(safetyParams.sl), 8, `${id} must assume an 8 ohm speaker load`);
    assert.equal(safetyParams.rl, 8, `${id} safety and decay measurements must use 8 ohms`);
    assert.equal(safetyParams.ag, preset.params.ag,
      `${id} safety and decay measurements must preserve Auto Gain Reduction`);

    const thdParams = prepareMeasurementParams(
      preset.params, { disableAutoGainReduction: true });
    assert.equal(thdParams.rl, 8, `${id} THD measurement must use 8 ohms`);
    assert.equal(thdParams.ag, false, `${id} THD measurement must disable Auto Gain Reduction`);
  }
});

test('Tube Simulator selectable presets inherit every circuit value from their canonical base',
  () => {
    const tables = readPluginPresetTables(repoRoot);
    const canonicalById = new Map(tables.canonical.map(preset => [preset.id, preset.params]));
    const selectableById = new Map(tables.groups.flatMap(group => group.presets)
      .map(preset => [preset.id, preset]));

    assert.deepEqual(new Set(selectableById.keys()),
      new Set(CALIBRATION_BANK.map(entry => entry.id)),
      'the shipped banks and the calibration harness disagree on membership');

    for (const entry of CALIBRATION_BANK) {
      const preset = selectableById.get(entry.id);
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

test('Tube Simulator selectable presets reproduce their baked reference-sine THD', async () => {
  const tables = readPluginPresetTables(repoRoot);
  const presetsById = new Map(tables.groups.flatMap(group => group.presets)
    .map(preset => [preset.id, preset]));
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
      const measured = measureSteadyState(binding, packer, preset.params, {
        amplitude: PRESET_REFERENCE_AMPLITUDE
      });

      assert.equal(measured.finite, true, `${baked.id} produced a non-finite output`);
      assert.deepEqual(measured.runtimeEvent, NO_RUNTIME_FAULT,
        `${baked.id} raised a runtime fault ${RUNTIME_FAULT_LEGEND}`);
      assert.ok(Math.abs(measured.thdPercent - baked.thdPercent) <= THD_TOLERANCE_POINTS,
        `${baked.id} THD drifted: baked ${baked.thdPercent} %, ` +
        `measured ${measured.thdPercent.toFixed(4)} %`);
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

test('Tube Simulator selectable presets match AC RMS level with Output Trim',
  async () => {
    const tables = readPluginPresetTables(repoRoot);
    const grouped = tables.groups.flatMap(group =>
      group.presets.map(preset => ({ group: group.label, ...preset })));

    const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
    const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
    assert.ok(packer, 'TubeSimulatorPlugin parameter packer is unavailable');

    const binding = await instantiateDsp(wasmBytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      for (const preset of grouped) {
        const measured = measureSteadyState(binding, packer, preset.params, {
          amplitude: PRESET_REFERENCE_AMPLITUDE
        });
        assert.equal(measured.finite, true, `${preset.id} produced a non-finite output`);
        assert.deepEqual(measured.runtimeEvent, NO_RUNTIME_FAULT,
          `${preset.id} raised a runtime fault ${RUNTIME_FAULT_LEGEND}`);
        assert.ok(Math.abs(measured.rmsGainDb) <= GAIN_TOLERANCE_DB,
          `${preset.group}/${preset.id} RMS gain is ${measured.rmsGainDb.toFixed(4)} dB; ` +
          `Output Trim must match it to 0 dB at -12 dBFS`);
      }
    } finally {
      binding.close();
    }
  });

test('Tube Simulator Power-only KT88 keeps its stable feedback and calibrated trim', () => {
  const tables = readPluginPresetTables(repoRoot);
  const powerOnly = tables.groups
    .find(group => group.label === 'Power')
    ?.presets.find(preset => preset.id === 'power-only-kt88-distributed');
  const preAndPower = tables.groups
    .find(group => group.label === 'Pre+Power')
    ?.presets.find(preset => preset.id === 'listening-power-kt88-distributed-thd2');

  assert.ok(powerOnly, 'Power-only KT88 preset is unavailable');
  assert.ok(preAndPower, 'Pre+Power KT88 preset is unavailable');
  assert.equal(powerOnly.params.nf, 2);
  assert.equal(powerOnly.params.dr, 0);
  assert.equal(powerOnly.params.iv, 7.4992);
  assert.equal(powerOnly.params.og, -10.748);
  assert.equal(preAndPower.params.nf, 4,
    'the canonical driver-and-power KT88 circuit must keep its original feedback');
});

// The ship gate the calibration harness applies has to be a
// standing guard, not a one-off reading taken while the bank was generated: a
// preset that latches the permanent dry state on a reference-level transient
// must not ship. The 13 s noise-decay tail stays in the harness because it is
// far too slow for a regression file; the silence -> reference step is 1.25 s
// per preset.
test('Tube Simulator selectable presets survive a silence to reference-level step', async () => {
  const tables = readPluginPresetTables(repoRoot);
  const selectable = tables.groups.flatMap(group => group.presets);
  const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
  const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
  assert.ok(packer, 'TubeSimulatorPlugin parameter packer is unavailable');
  assert.equal(selectable.length, CALIBRATION_BANK.length);

  const binding = await instantiateDsp(wasmBytes);
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);

    for (const preset of selectable) {
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
