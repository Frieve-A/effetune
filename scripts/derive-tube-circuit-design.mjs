// Tube Simulator circuit-design derivation.
//
// This is the single maintenance tool behind the Tube Simulator Power output stage tables. It
// derives the complete circuit design that scripts/generate-tube-phase-c-tables.mjs turns into
// dsp/plugins/saturation/tube_simulator/phase_c_tables.generated.h and into the JavaScript
// reference tables injected into plugins/saturation/tube_simulator.js. Nothing else feeds those
// artifacts: the primary data below plus the derivation code in this file is the whole provenance.
//
// The derivation has four stages:
//
//   1. Output-tube LUT construction. The ordinary pentode model - composite control voltage,
//      power-law cathode current, tanh knee - is solved against the published Mullard EL84 and
//      EL34 rows and sampled onto the axes the kernel interpolates over.
//   2. Quiescent DC solve. The running Power branch is iterated to its fixed point node for node
//      as the kernel evaluates it, and the supply parameter is bisected until the branch settles
//      on the node the datasheet row fixes.
//   3. A0 sweep (--sweep). The loop is opened at the compensator insertion point of the shipped
//      JavaScript reference processor, opposite-polarity impulses are injected on the settled
//      circuit, and the central difference of the feedback tap is transformed into the complex
//      plant response; gdet0 is that response at 1 kHz. All 432 keys (driver tube x output tube x
//      screen tap x primary x speaker load x internal rate family) are measured; none is scaled
//      from another.
//   4. Ladder fit. A two-pole one-zero compensator is searched per key against the measured plant
//      under the Line acceptance envelope and the anchor shaping rules, and the winning anchor is
//      expanded into the 61-knot runtime feedback ladder.
//
// Stages 1, 2 and 4's ladder expansion run on every invocation from the primary data in this
// file; they are cheap and deterministic. Stage 3 and the anchor search consume about a day of
// compute across the 432 keys, so their result - the measured break-loop table below - is carried
// as primary data and re-derived only when the amplifier model changes:
//
//   node scripts/derive-tube-circuit-design.mjs                   derive + verify invariants
//   node scripts/derive-tube-circuit-design.mjs --sweep           re-measure + re-fit all keys
//       [--key-start N --key-count N]                             shard the sweep across processes
//       [--write]                                                 rewrite the measured table below
//                                                                 (full unsharded sweep only)
//   node scripts/derive-tube-circuit-design.mjs --ltp [--write]   re-measure the phase-inverter
//                                                                 standing currents
//
// After a sweep lands, regenerate the shipped tables with
// scripts/generate-tube-phase-c-tables.mjs and re-promote the DSP golden vectors.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  deriveAnchor,
  evaluateEndpoint,
  interpolateCoefficients,
  responseFromCoefficients
} from '../tests/tools/tube-simulator-lineamp/derive-phase-b-anchors.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownPath = fileURLToPath(import.meta.url);
const pluginSourcePath = path.join(repoRoot, 'plugins', 'saturation', 'tube_simulator.js');

// ================================================================================================
// Primary data 1/5: published output-tube data.
//
// Mullard/Philips EL84 and Mullard EL34 Issue 2 published rows. Every constant of the pentode
// model is solved from these; none is adjusted to make a particular output power appear.
// ================================================================================================
export const OUTPUT_TUBE_DATASHEETS = Object.freeze({
  EL84: Object.freeze({
    typicalGridCathodeV: -7.3,
    typicalPlateCathodeV: 250,
    typicalScreenCathodeV: 250,
    typicalPlateCurrentA: 0.048,
    typicalScreenCurrentA: 0.0055,
    typicalMutualConductanceS: 0.0113,
    typicalPlateResistanceOhm: 38000,
    kneePlateCathodeV: 30,
    kneeScreenCathodeV: 250,
    // Mullard 5-10 push-pull zero-signal row, which the canonical pentode preset reproduces.
    presetPlateCurrentA: 0.035,
    presetScreenCurrentA: 0.004,
    presetCathodeResistorOhm: 270,
    presetCenterTapGroundV: 320,
    presetScreenGroundV: 300,
    presetProfileId: 'power-v1-el84-0-8_0',
    // Axis reach. A push-pull plate swings to nearly twice the centre-tap supply, a twenty per
    // cent tap swings the screen by that fraction of the same induced emf, and the control voltage
    // has to stay on the axis for the whole box those two span plus room for grid conduction.
    controlVoltageMaxV: 40,
    plateCathodeMaxV: 700,
    screenCathodeMaxV: 400
  }),
  EL34: Object.freeze({
    typicalGridCathodeV: -13.5,
    typicalPlateCathodeV: 250,
    typicalScreenCathodeV: 250,
    typicalPlateCurrentA: 0.100,
    typicalScreenCurrentA: 0.015,
    typicalMutualConductanceS: 0.011,
    typicalPlateResistanceOhm: 15000,
    kneePlateCathodeV: 35,
    kneeScreenCathodeV: 250,
    // Mullard EL34 Issue 2 distributed-load zero-signal row: the normative DC point.
    presetPlateCurrentA: 0.0625,
    presetScreenCurrentA: 0.005,
    presetCathodeResistorOhm: 470,
    presetPlateGroundV: 430,
    presetScreenSeriesResistanceOhm: 1000,
    presetProfileId: 'power-v1-el34-43-6_6',
    controlVoltageMaxV: 90,
    plateCathodeMaxV: 900,
    screenCathodeMaxV: 600
  })
});

// The EL34 normative DC oracle is anchored to this published operating row; the tolerance is the
// one volt the kernel's acceptance check allows between the settled screen node and the nominal.
export const EL34_NORMATIVE_SOURCE = Object.freeze({
  circuitProfileId: 'power-v1-el34-43-6_6',
  screenGroundToleranceV: 1,
  maximumQuiescentPlateDissipationW: 25,
  sourcePoint: Object.freeze({
    "plateGroundV": 430,
    "screenGroundNominalV": 425,
    "cathodeResistanceOhmPerValve": 470,
    "screenResistanceOhm": 1000,
    "screenTapTurnsRatio": 0.43,
    "primaryPlateToPlateOhm": 6600,
    "iaA": 0.0625,
    "ig2A": 0.005
  })
});

// ================================================================================================
// Primary data 2/5: the fixed circuit.
//
// The eighteen Power circuit profiles (output tube x screen tap x primary impedance) and the four
// selectable loudspeaker networks. These are the frozen component values of the amplifier being
// simulated - resistors, capacitors, the output transformer parasitics and the feedback winding -
// chosen during the design phases and carried here as data, exactly as a schematic carries them.
// ================================================================================================
export const CIRCUIT_PROFILES = Object.freeze([
    {
      "circuitProfileId": "power-v1-el84-0-6_0",
      "key": {
        "pt": "EL84",
        "st": "0",
        "zp": "6.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 4.099889133756051,
        "primaryTapToPlateResistanceOhm": 77.8978935413649,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.26,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-0-6_6",
      "key": {
        "pt": "EL84",
        "st": "0",
        "zp": "6.6"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 4.299999999999997,
        "primaryTapToPlateResistanceOhm": 81.7,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.26,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-0-8_0",
      "key": {
        "pt": "EL84",
        "st": "0",
        "zp": "8.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 4.734144190043352,
        "primaryTapToPlateResistanceOhm": 89.94873961082367,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.26,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-20-6_0",
      "key": {
        "pt": "EL84",
        "st": "20",
        "zp": "6.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 28.699223936292327,
        "primaryTapToPlateResistanceOhm": 53.29855873882862,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.2,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-20-6_6",
      "key": {
        "pt": "EL84",
        "st": "20",
        "zp": "6.6"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 30.1,
        "primaryTapToPlateResistanceOhm": 55.9,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.2,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-20-8_0",
      "key": {
        "pt": "EL84",
        "st": "20",
        "zp": "8.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 33.13900933030345,
        "primaryTapToPlateResistanceOhm": 61.543874470563566,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.2,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-43-6_0",
      "key": {
        "pt": "EL84",
        "st": "43",
        "zp": "6.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 62.47450108580644,
        "primaryTapToPlateResistanceOhm": 19.52328158931451,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.085,
        "feedbackDampingCoupling": 0.003
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.43,
      "sentinelProfile": true
    },
    {
      "circuitProfileId": "power-v1-el84-43-6_6",
      "key": {
        "pt": "EL84",
        "st": "43",
        "zp": "6.6"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 65.52380952380952,
        "primaryTapToPlateResistanceOhm": 20.476190476190474,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.43,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el84-43-8_0",
      "key": {
        "pt": "EL84",
        "st": "43",
        "zp": "8.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 4.7e-8,
        "gridLeakResistanceOhm": 470000,
        "gridStopperResistanceOhm": 1500
      },
      "cathodeRc": {
        "capacitanceF": 0.00005
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 120,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el84-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 72.13934003875582,
        "primaryTapToPlateResistanceOhm": 22.543543762111195,
        "magnetizingInductanceH": 55,
        "leakageInductanceH": 0.024,
        "interwindingCapacitanceF": 6e-10,
        "coreLossResistanceOhm": 220000,
        "resonanceHz": 900,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.1,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.43,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-0-6_0",
      "key": {
        "pt": "EL34",
        "st": "0",
        "zp": "6.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 2.002271437415743,
        "primaryTapToPlateResistanceOhm": 38.04315731089913,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.26,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-0-6_6",
      "key": {
        "pt": "EL34",
        "st": "0",
        "zp": "6.6"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 2.1000000000000014,
        "primaryTapToPlateResistanceOhm": 39.9,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.26,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-0-8_0",
      "key": {
        "pt": "EL34",
        "st": "0",
        "zp": "8.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 2.3120239067653614,
        "primaryTapToPlateResistanceOhm": 43.92845422854178,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.26,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-20-6_0",
      "key": {
        "pt": "EL34",
        "st": "20",
        "zp": "6.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 14.015900061910205,
        "primaryTapToPlateResistanceOhm": 26.02952868640467,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.2,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-20-6_6",
      "key": {
        "pt": "EL34",
        "st": "20",
        "zp": "6.6"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 14.7,
        "primaryTapToPlateResistanceOhm": 27.3,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.2,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-20-8_0",
      "key": {
        "pt": "EL34",
        "st": "20",
        "zp": "8.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 16.184167347357498,
        "primaryTapToPlateResistanceOhm": 30.056310787949645,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.085,
        "feedbackDampingCoupling": 0.003
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.2,
      "sentinelProfile": true
    },
    {
      "circuitProfileId": "power-v1-el34-43-6_0",
      "key": {
        "pt": "EL34",
        "st": "43",
        "zp": "6.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 30.510802855858955,
        "primaryTapToPlateResistanceOhm": 9.534625892455923,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.43,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-43-6_6",
      "key": {
        "pt": "EL34",
        "st": "43",
        "zp": "6.6"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 32,
        "primaryTapToPlateResistanceOhm": 10,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.43,
      "sentinelProfile": false
    },
    {
      "circuitProfileId": "power-v1-el34-43-8_0",
      "key": {
        "pt": "EL34",
        "st": "43",
        "zp": "8.0"
      },
      "ltpRc": {
        "tube": "12AX7",
        "plateResistanceOhm": 100000,
        "tailResistanceOhm": 47000,
        "inputCouplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 1000000,
        "tailSupplyV": -100,
        "preVolumeResistanceOhm": 1000000,
        "preVolumeWiperPosition": 0.024
      },
      "gridRc": {
        "couplingCapacitanceF": 1e-7,
        "gridLeakResistanceOhm": 220000,
        "gridStopperResistanceOhm": 5600
      },
      "cathodeRc": {
        "capacitanceF": 0.0001
      },
      "screenSupplyRc": {
        "seriesResistanceOhm": 1000,
        "capacitanceF": 0.000016
      },
      "powerSupplyRc": {
        "theveninResistanceOhm": 80,
        "capacitanceF": 0.000032
      },
      "outputTubeLutId": "el34-ia-ig2-lut-v2",
      "optCoefficients": {
        "order": 2,
        "primaryCenterToTapResistanceOhm": 35.23084048404354,
        "primaryTapToPlateResistanceOhm": 11.009637651263604,
        "magnetizingInductanceH": 42,
        "leakageInductanceH": 0.018,
        "interwindingCapacitanceF": 7.5e-10,
        "coreLossResistanceOhm": 180000,
        "resonanceHz": 820,
        "dampingRatio": 0.23,
        "feedbackDampingCoupling": 0.002
      },
      "nfbTapNode": "fixed-secondary-feedback-winding",
      "nfbTapTurnsRatio": 0.12,
      "nfbPolarity": 1,
      "screenTapTurnsRatio": 0.43,
      "sentinelProfile": false
    }
  ]);

export const SPEAKER_PROFILES = Object.freeze([
    {
      "id": "speaker-two-branch-4-ohm-v1",
      "sl": "4",
      "topology": "series-voice-rl-parallel-resonance-rlc",
      "voiceResistanceOhm": 3.2,
      "voiceInductanceH": 0.00035,
      "resonanceResistanceOhm": 24,
      "resonanceInductanceH": 0.014,
      "resonanceCapacitanceF": 0.00075
    },
    {
      "id": "speaker-two-branch-8-ohm-v1",
      "sl": "8",
      "topology": "series-voice-rl-parallel-resonance-rlc",
      "voiceResistanceOhm": 6.4,
      "voiceInductanceH": 0.0006,
      "resonanceResistanceOhm": 48,
      "resonanceInductanceH": 0.022,
      "resonanceCapacitanceF": 0.0005
    },
    {
      "id": "speaker-two-branch-15-ohm-v1",
      "sl": "15",
      "topology": "series-voice-rl-parallel-resonance-rlc",
      "voiceResistanceOhm": 12,
      "voiceInductanceH": 0.0009,
      "resonanceResistanceOhm": 70,
      "resonanceInductanceH": 0.032,
      "resonanceCapacitanceF": 0.00033
    },
    {
      "id": "speaker-two-branch-16-ohm-v1",
      "sl": "16",
      "topology": "series-voice-rl-parallel-resonance-rlc",
      "voiceResistanceOhm": 12.8,
      "voiceInductanceH": 0.001,
      "resonanceResistanceOhm": 80,
      "resonanceInductanceH": 0.035,
      "resonanceCapacitanceF": 0.0003
    }
  ]);

// ================================================================================================
// Primary data 3/5: measured phase-inverter standing current.
//
// Both 12AX7 plate loads of the long-tailed pair return to the reservoir node the output valves
// feed from, so their current crosses the reservoir Thevenin resistance with everything else. The
// value is measured rather than derived: the phase-inverter triode is a Hermite-interpolated
// softplus table inside the kernel, and re-deriving it here would be a second implementation of
// the same valve that could drift from the first. It moves by roughly two tenths of a microamp
// per volt of reservoir, so it is effectively a circuit constant. Re-measured by --ltp.
// ================================================================================================
// __TUBE_LTP_STANDING_CURRENT_START__
export const LTP_STANDING_CURRENT_A = Object.freeze({
  'power-v1-el84-0-6_0': 0.002163277992305543,
  'power-v1-el84-0-6_6': 0.0021632778355838754,
  'power-v1-el84-0-8_0': 0.002163277930501473,
  'power-v1-el84-20-6_0': 0.002163279571529746,
  'power-v1-el84-20-6_6': 0.0021632795768629157,
  'power-v1-el84-20-8_0': 0.002163279655875822,
  'power-v1-el84-43-6_0': 0.0021632796396080893,
  'power-v1-el84-43-6_6': 0.0021632796623796448,
  'power-v1-el84-43-8_0': 0.0021632796448089607,
  'power-v1-el34-0-6_0': 0.0021865810330729363,
  'power-v1-el34-0-6_6': 0.0021866056990302645,
  'power-v1-el34-0-8_0': 0.0021866594785601968,
  'power-v1-el34-20-6_0': 0.0021865973809291764,
  'power-v1-el34-20-6_6': 0.002186622886452429,
  'power-v1-el34-20-8_0': 0.002186678183129947,
  'power-v1-el34-43-6_0': 0.0021865961054269574,
  'power-v1-el34-43-6_6': 0.0021866214696608624,
  'power-v1-el34-43-8_0': 0.002186676326185223
});
// __TUBE_LTP_STANDING_CURRENT_END__

// ================================================================================================
// Primary data 4/5: measured Power break-loop plant and fitted compensator anchors.
//
// One row per key: the loop is opened at the compensator insertion point of the shipped
// JavaScript reference, opposite-polarity 1e-4 V impulses land on the settled circuit, a
// 524288-sample capture of the fixed secondary feedback tap is central-differenced and
// transformed, and gdet0 is the complex plant response at 1 kHz. The small-signal check repeats
// every measurement at a tenth of the stimulus; the observed relative complex-gain delta is
// recorded per row and stays orders inside the 1e-3 the record schema allows. The anchor is the
// two-pole one-zero compensator the ladder-fit search selected against that measured plant.
// The loudspeaker is a key of the table, not a scale factor: the reflected impedance loads the
// transformer, so the plant of each of the four selectable loads is measured separately.
// Produced by --sweep; the columns are
// [key, gdet0 real, gdet0 imaginary, observed relative complex gain delta, settle frames,
//  analysis frames, anchor b0, anchor b1, anchor a1, anchor a2, maximum acceptable feedback dB,
//  anchor zero Hz, anchor first pole Hz, anchor second pole Hz].
//
// This table is the calibration of record: the shipped C++ tables, the injected JavaScript
// reference tables and the DSP parity goldens were all generated from exactly these rows. The
// reference model has moved slightly since they were measured (the post-calibration break-loop
// detector fixes shift gdet0 by under one per cent, orders below anything audible in a feedback
// calibration), so a --sweep against the current reference reports that drift; that is the sweep
// describing the model change, not a defect in either. Rewriting the rows is therefore never done
// in isolation: a re-sweep, the table regeneration and the golden re-promotion land together.
// ================================================================================================
export const POWER_BREAK_LOOP_METHOD = Object.freeze({
  stimulusPeakV: 1e-4,
  captureSamples: 524288,
  smallSignalCaptureSamples: 131072,
  settleSeconds: 1,
  smallSignalScale: 0.1,
  maximumRelativeComplexGainDelta: 1e-3
});

// __TUBE_POWER_BREAK_LOOP_ROWS_START__
export const POWER_BREAK_LOOP_ROWS = Object.freeze([
  ["12AX7|EL84|0|6.0|4|352800",224.76695368000605,11.186545879809728,1.7954478603994422e-7,44160,65536,0.09106584441917089,-0.09086281064275105,-1.9645482165974153,0.9647512503738352,6,125.32741086623943,404.7239454742835,1610.2129390711355],
  ["12AX7|EL84|0|6.0|4|384000",225.53890829771427,10.996662102346981,5.606217359836663e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AX7|EL84|0|6.0|8|352800",317.9226581136335,15.88385722728667,1.7802146376240018e-7,44160,65536,0.09076851415737153,-0.09059203687901606,-1.973210468449191,0.9733869457275464,6,109.2760055710362,659.6565903690295,854.9069680048295],
  ["12AX7|EL84|0|6.0|8|384000",319.01471097185095,15.615353081176657,5.620392451716442e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AX7|EL84|0|6.0|15|352800",435.3839864476783,21.794375539615565,1.778405517997571e-7,44160,65536,0.09062782581386082,-0.09056522241014116,-1.9772677850368465,0.9773303884405663,6,38.800304694840584,180.3137891565353,1107.2316672406835],
  ["12AX7|EL84|0|6.0|15|384000",436.8796119677524,21.42668754726903,5.615927266206605e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AX7|EL84|0|6.0|16|352800",449.6551099642532,22.502893785436118,1.7776565783605273e-7,44160,65536,0.08901079707598844,-0.08894860909840827,-1.9600640510010594,0.9601262389786396,6,39.24318130705065,91.21455360207668,2193.5517218296623],
  ["12AX7|EL84|0|6.0|16|384000",451.19974641489404,22.12315275190878,5.62450822014429e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AX7|EL84|0|6.6|4|352800",234.1822032952259,11.690940952400515,1.7719189471994916e-7,44160,65536,0.09123395907010444,-0.09113544051325231,-1.9732739978904328,0.9733725164472851,6,60.66592434779227,248.49930344677534,1266.8966146910227],
  ["12AX7|EL84|0|6.6|4|384000",234.98206550932073,11.4941015719721,5.600623356848078e-7,48000,65536,0.0816353096475607,-0.08159494159891893,-1.9754685096334144,0.9755088776820561,6,30.228630213248113,108.50426508415573,1406.9167461505876],
  ["12AX7|EL84|0|6.6|8|352800",331.24009183598,16.599856736425103,1.7799562103237985e-7,44160,65536,0.08803062152104829,-0.08794564728903569,-1.9664838720235824,0.9665688462555949,6,54.226538243506035,155.3635160602986,1753.8862876781304],
  ["12AX7|EL84|0|6.6|8|384000",332.3716250876818,16.32151620431253,5.605239122046987e-7,48000,65536,0.08254212859440731,-0.08234173371626302,-1.9663074125568647,0.9665078074350091,6,148.5559431050798,473.2594173382863,1608.6951725840256],
  ["12AX7|EL84|0|6.6|15|352800",453.6217405751061,22.776671092421594,1.787063312987744e-7,44160,65536,0.0914736702575168,-0.09131200930708867,-1.9736786376927133,0.9738402986431416,6,99.32115860038994,550.8985079046154,937.5194580087618],
  ["12AX7|EL84|0|6.6|15|384000",455.1714369454662,22.395512406680464,5.597845861274843e-7,48000,65536,0.08321758275967428,-0.08290184934900587,-1.961683432557481,0.9619991659681494,6,232.31752800124812,737.5393379922137,1630.1786689577134],
  ["12AX7|EL84|0|6.6|16|352800",468.4906666338672,23.51714156846898,1.7927524154813699e-7,44160,65536,0.09002021969865129,-0.08988920063149629,-1.9760768435809488,0.9762078626481038,6,81.78231111063825,478.6787632123731,873.3954295927628],
  ["12AX7|EL84|0|6.6|16|384000",470.0911458482731,23.12348845454606,5.595916403869669e-7,48000,65536,0.08171831547524447,-0.08160954112627197,-1.9701817114059952,0.9702904857549677,6,81.40435617390253,260.6086302255324,1582.6214992206073],
  ["12AX7|EL84|0|8.0|4|352800",253.85760821915372,12.707026080934224,1.8074816931531366e-7,44160,65536,0.08932635874451385,-0.08914670788239311,-1.9710486726544416,0.9712283235165624,6,113.04086447698927,508.09695766931213,1131.1250821106858],
  ["12AX7|EL84|0|8.0|4|384000",254.71369326372192,12.495750110849235,5.518973107681651e-7,48000,65536,0.08182535221243627,-0.08169140882863912,-1.9578920027018578,0.958025946085655,6,100.12451816067993,212.21208240095226,2408.4460110678347],
  ["12AX7|EL84|0|8.0|8|352800",359.0700494137902,18.04240307216442,1.7967765572674897e-7,44160,65536,0.08992831902000697,-0.08989426380504151,-1.9770702953184722,0.9771043505334377,6,21.267581401542706,89.70564147209043,1210.8277111492007],
  ["12AX7|EL84|0|8.0|8|384000",360.2811204398516,17.743646207703193,5.52510205830926e-7,48000,65536,0.08117728435092253,-0.08101996359023242,-1.9713183243981158,0.9714756451588059,6,118.55613822835231,453.21114208957914,1315.4151355428367],
  ["12AX7|EL84|0|8.0|15|352800",491.73388952144586,24.755863597242477,1.800996231510421e-7,44160,65536,0.09496284871133766,-0.09489463732852434,-1.9761941907651819,0.9762624021479953,6,40.346684322427954,187.3795807364096,1161.5576777416434],
  ["12AX7|EL84|0|8.0|15|384000",493.39251812218936,24.346745202174173,5.531029252801857e-7,48000,65536,0.08240952825181315,-0.08213665195973965,-1.9639621234178486,0.9642349997099221,6,202.70280099220204,664.9541469198703,1560.886868432541],
  ["12AX7|EL84|0|8.0|16|352800",507.8520659024325,25.560695216172025,1.8048387127447446e-7,44160,65536,0.0889793237253196,-0.08893209804989036,-1.971769916823554,0.9718171424989833,6,29.809388119511297,100.36543065421826,1504.825386152945],
  ["12AX7|EL84|0|8.0|16|384000",509.56504685219215,25.13816612791057,5.538768354399244e-7,48000,65536,0.08098391242427597,-0.08090202034512534,-1.9641136896352693,0.96419558171442,6,61.83212528600117,149.8635458726729,2078.475926468154],
  ["12AX7|EL84|20|6.0|4|352800",166.9615013071403,6.627514031415738,1.8375675306679768e-7,44160,65536,0.09062886110336568,-0.09038044399020354,-1.9651297597323876,0.9653781768455497,6,154.12020780095415,563.2382699567997,1415.222472815008],
  ["12AX7|EL84|20|6.0|4|384000",167.41216409519478,6.520851489352578,5.45879728449929e-7,48000,65536,0.08476144383204906,-0.08465346255973628,-1.9743968283866171,0.9745048096589299,6,77.90731385078571,326.3096348732446,1252.0484964735683],
  ["12AX7|EL84|20|6.0|8|352800",236.15992375189123,9.419604169049403,1.824175323153978e-7,44160,65536,0.08831219700940648,-0.08807631577515501,-1.9676625016968785,0.9678983829311301,6,150.17652670640155,627.5617316388714,1204.5057719397066],
  ["12AX7|EL84|20|6.0|8|384000",236.7974713031283,9.268759170356244,5.472430324878041e-7,48000,65536,0.08888412714459573,-0.08872755592374584,-1.9704760936446966,0.9706326648655463,6,107.75113969032066,424.9868735067164,1396.6942863075433],
  ["12AX7|EL84|20|6.0|15|352800",323.4130883562306,12.93099271612598,1.8396015788811428e-7,44160,65536,0.08831504751251598,-0.08817568166723645,-1.9763702281173443,0.9765095939626237,6,88.67746097258306,640.367261519168,694.3545259709742],
  ["12AX7|EL84|20|6.0|15|384000",324.2862511606161,12.724407073665695,5.465083081936543e-7,48000,65536,0.08202113520293912,-0.08189559981866683,-1.9775743789941453,0.9776999143784176,6,93.61044244651622,662.0889327938124,716.217852999654],
  ["12AX7|EL84|20|6.0|16|352800",334.01395840834397,13.350494853781422,1.8414491231576362e-7,44160,65536,0.09300492267692528,-0.09294832723043356,-1.9751460042762403,0.975202599722732,6,34.17877040456675,142.5684086369837,1267.3566387656901],
  ["12AX7|EL84|20|6.0|16|384000",334.915733537089,13.137140211881459,5.471006214115976e-7,48000,65536,0.08114774834428222,-0.08112066295429304,-1.9743967503772795,0.9744238357672688,6,20.402456692929256,67.6087371515883,1515.8278353585276],
  ["12AX7|EL84|20|6.6|4|352800",170.4323019750051,6.7104911747843055,1.8328131791643612e-7,44160,65536,0.09240990367820504,-0.09202621667141125,-1.960003732063135,0.9603874190699289,6,233.62022860434064,903.8622778556926,1365.6318055620045],
  ["12AX7|EL84|20|6.6|4|384000",170.8833475985372,6.602524767581263,5.43143742886874e-7,48000,65536,0.08239818383092243,-0.08208143411281797,-1.9601315706136524,0.9604483203317569,6,235.38893125712107,673.2252489869641,1793.096984973906],
  ["12AX7|EL84|20|6.6|8|352800",241.06923815333423,9.537912152873878,1.8428548564568345e-7,44160,65536,0.10172510230419676,-0.10167984620839832,-1.9695792890935515,0.9696245451893499,6,24.985858812909946,88.14309549960656,1643.8752162530272],
  ["12AX7|EL84|20|6.6|8|384000",241.70732888138176,9.385221069155111,5.432880181622793e-7,48000,65536,0.08548843393057654,-0.08532080698864132,-1.9716106419624821,0.9717782689044173,6,119.95378344821899,514.033123143439,1235.558070108183],
  ["12AX7|EL84|20|6.6|15|352800",330.13623978072394,13.093658853096853,1.8477043770162675e-7,44160,65536,0.08867373404889912,-0.08859858405119614,-1.963291018633963,0.9633661686316659,6,47.60655744586948,122.32606633272952,1973.2824245744748],
  ["12AX7|EL84|20|6.6|15|384000",331.0101475756299,12.884543214389941,5.459678627865508e-7,48000,65536,0.0856364260521629,-0.08556229509099565,-1.9776770877188317,0.977751218679999,6,52.92739189613493,248.5628693745309,1126.5369961375168],
  ["12AX7|EL84|20|6.6|16|352800",340.9574806872131,13.518402434949431,1.8568494015493464e-7,44160,65536,0.09852118467616859,-0.09846697793788523,-1.9746149007839953,0.9746691075222786,6,30.90237519601848,132.3095437171295,1308.341130500401],
  ["12AX7|EL84|20|6.6|16|384000",341.8600249868211,13.302435290518334,5.441950812032395e-7,48000,65536,0.08800791131803534,-0.08794122608569174,-1.9748856096727867,0.9749522949051302,6,46.325903599448004,184.72008695745114,1365.5807107333344],
  ["12AX7|EL84|20|8.0|4|352800",176.61304054245903,6.812089704728311,1.868494097645762e-7,44160,65536,0.09222606074942535,-0.09214675961280455,-1.966576112391608,0.9666554135282286,6,48.301569569923934,144.50412756829752,1759.7170401417964],
  ["12AX7|EL84|20|8.0|4|384000",177.0605923845625,6.701453788815353,5.384312586167936e-7,48000,65536,0.08247900723130916,-0.08243460516756343,-1.9790521695404655,0.9790965716042113,6,32.91000992201408,146.42599770573372,1144.6387910773021],
  ["12AX7|EL84|20|8.0|8|352800",249.81166817325683,9.683293199800397,1.8680481878257748e-7,44160,65536,0.09708640237574646,-0.09700972277230238,-1.9724165951880566,0.9724932747915005,6,44.36512598847061,176.39580424851843,1389.742876221355],
  ["12AX7|EL84|20|8.0|8|384000",250.4448204090789,9.526821526500378,5.386519719073178e-7,48000,65536,0.08412104103513633,-0.08403645146256745,-1.9622447883704055,0.9623293779429742,6,61.48681482921168,146.36482340428896,2200.3785224384583],
  ["12AX7|EL84|20|8.0|15|352800",342.1087309713618,13.293905765986915,1.85964295854816e-7,44160,65536,0.09059982992601454,-0.09031789085082598,-1.9626645006027543,0.9629464396779429,6,175.00611276522,593.268831598313,1526.8089213666972],
  ["12AX7|EL84|20|8.0|15|384000",342.9758775183089,13.079608604899589,5.37665737242418e-7,48000,65536,0.08526715557209867,-0.08493238414040091,-1.9595969314422914,0.9599317028739892,6,240.4207347845575,715.4462636461624,1783.7583515759034],
  ["12AX7|EL84|20|8.0|16|352800",353.32240370789145,13.725052201661743,1.8667841081640384e-7,44160,65536,0.08934457202174585,-0.08927511833948162,-1.9773606727218795,0.9774301264041436,6,43.66612658134798,205.84630517480485,1075.9692696894663],
  ["12AX7|EL84|20|8.0|16|384000",354.21796494185185,13.503734239675376,5.371243685331757e-7,48000,65536,0.08596771808336288,-0.08583724510830247,-1.969812592264889,0.9699430652399494,6,92.82528572360215,320.303843694904,1544.8131127860245],
  ["12AX7|EL84|43|6.0|4|352800",133.81206109344464,4.5258847937317945,1.836123479942095e-7,44160,65536,0.09116535380891776,-0.09096848027478778,-1.9695355287136929,0.9697324022478229,6,121.38795092484627,524.8471181111911,1200.9256603778322],
  ["12AX7|EL84|43|6.0|4|384000",134.11626083010944,4.459419182430647,5.339383383818271e-7,48000,65536,0.08120763728033754,-0.08097941695209404,-1.9640872493036121,0.9643154696318555,6,171.99656680049952,506.30257146938305,1714.4382824448232],
  ["12AX7|EL84|43|6.0|8|352800",189.27166685431368,6.437943011875877,1.8793468139081846e-7,44160,65536,0.10803016483780878,-0.1077926150187118,-1.9670555780394579,0.9672931278585549,6,123.60507461202629,601.7603708475051,1265.4302622842422],
  ["12AX7|EL84|43|6.0|8|384000",189.70202178302506,6.343934471298237,5.386641427831408e-7,48000,65536,0.08575918611001986,-0.08572295493389578,-1.9722204004833455,0.9722566316594695,6,25.82527132858633,83.90791430921432,1635.6062688520033],
  ["12AX7|EL84|43|6.0|15|352800",259.2013407749545,8.841515067624732,1.8735486876030153e-7,44160,65536,0.0895376876364845,-0.08947089792668274,-1.9768908896110455,0.9769576793208473,6,41.90003824719903,190.47107758486064,1118.4914533511312],
  ["12AX7|EL84|43|6.0|15|384000",259.7907434067989,8.712756098978538,5.360367084651098e-7,48000,65536,0.08138315026750588,-0.08125290945189656,-1.977165657880616,0.9772958986962252,6,97.88399989927109,681.1885139843528,722.3782952453558],
  ["12AX7|EL84|43|6.0|16|352800",267.6974506266574,9.127836591054134,1.8896828331160756e-7,44160,65536,0.0965056871402557,-0.0964400985529168,-1.9730818328280786,0.9731474214154177,6,38.17435434096798,152.33197771730548,1376.0502502132138],
  ["12AX7|EL84|43|6.0|16|384000",268.3061667040519,8.994860702229241,5.362817555083589e-7,48000,65536,0.08410755757533557,-0.0840786994932251,-1.9779228823794113,0.9779517404615217,6,20.972891742814397,85.33635619028294,1277.2309429084446],
  ["12AX7|EL84|43|6.6|4|352800",134.58647278229583,4.4841313567759755,1.899994233311085e-7,44160,65536,0.0892228870231092,-0.0891645132938036,-1.9771964095554484,0.9772547832847539,6,36.747854033913555,165.23980777995487,1126.649505589334],
  ["12AX7|EL84|43|6.6|4|384000",134.88395120135948,4.4187927550897275,5.343613896768819e-7,48000,65536,0.08193851528138267,-0.08167560308370836,-1.9615323230144965,0.9617952352121708,6,196.4136581903642,545.6468303102838,1835.0282054970046],
  ["12AX7|EL84|43|6.6|8|352800",190.36705879594726,6.379093677492253,1.889659073823298e-7,44160,65536,0.0906294635664459,-0.09052893380020623,-1.9650976889031204,0.9651982186693602,6,62.318207226655026,178.15619672450597,1810.7725359777507],
  ["12AX7|EL84|43|6.6|8|384000",190.78790657014204,6.286677058764091,5.324290971160501e-7,48000,65536,0.0830363218573152,-0.08299660348714125,-1.9769535664663007,0.9769932848364746,6,29.24008018345923,114.76872150370632,1307.7250685316947],
  ["12AX7|EL84|43|6.6|15|352800",260.70145683273154,8.761066897506561,1.9045687170671183e-7,44160,65536,0.08917477684000845,-0.08902781375433452,-1.9757332002414132,0.9758801633270872,6,92.61323424686464,656.687026087622,714.2390547581035],
  ["12AX7|EL84|43|6.6|15|384000",261.27783959213565,8.634486362919946,5.324669572837862e-7,48000,65536,0.08190295138294981,-0.08183552370420134,-1.9739944758834957,0.9740619035622442,6,50.33485753881586,178.7728680878391,1427.368173655533],
  ["12AX7|EL84|43|6.6|16|352800",269.24673582068516,9.044731427795556,1.9012260118871907e-7,44160,65536,0.09781292626280383,-0.09777518966212387,-1.972769029445152,0.972806766045832,6,21.667011917996575,82.29546134310574,1465.7457626372209],
  ["12AX7|EL84|43|6.6|16|384000",269.842005201045,8.914005568175469,5.332467209011837e-7,48000,65536,0.08861859523855917,-0.08852727694878056,-1.9727763818253998,0.9728677001151783,6,63.00980310999592,239.9426006165769,1441.1722332678273],
  ["12AX7|EL84|43|8.0|4|352800",135.2325949965377,4.346162436299575,1.9206581622333558e-7,44160,65536,0.10452134217072252,-0.1044467896953359,-1.9679301055937675,0.9680046580691541,6,40.06459251265714,141.85691140627466,1684.0456816183646],
  ["12AX7|EL84|43|8.0|4|384000",135.5140776046742,4.286004634566405,5.278573793555111e-7,48000,65536,0.08678634781343371,-0.0867149915971098,-1.9710295158577154,0.9711008720740392,6,50.27017044635522,166.34319519340227,1625.8645927153927],
  ["12AX7|EL84|43|8.0|8|352800",191.28101543099032,6.1841159964751045,1.9367777204514208e-7,44160,65536,0.09810392360082835,-0.0978730040704156,-1.969102597657244,0.9693335171876568,6,132.3227827330866,715.7425779356795,1033.1313668835976],
  ["12AX7|EL84|43|8.0|8|384000",191.6792363972212,6.099022574883717,5.274920701694996e-7,48000,65536,0.08686669442014322,-0.08681669863662474,-1.9724667782408687,0.9725167740243872,6,35.18491026245423,119.57275574550607,1583.5912137923517],
  ["12AX7|EL84|43|8.0|15|352800",261.9531202549788,8.494170877684798,1.925254014208993e-7,44160,65536,0.08888457486211689,-0.0887730101760064,-1.968564388623041,0.9686759533091516,6,70.52153462299906,229.44814694116536,1557.5289385258525],
  ["12AX7|EL84|43|8.0|15|384000",262.49851539579,8.377615933804321,5.283488152893088e-7,48000,65536,0.0853213018287839,-0.08524152021549183,-1.9779190674205176,0.9779988490338096,6,57.17416417605677,278.78513030251935,1080.8382663495863],
  ["12AX7|EL84|43|8.0|16|352800",270.5394221470442,8.769070353959775,1.9328913773643212e-7,44160,65536,0.11046191640385211,-0.11031667564914997,-1.9660222395509321,0.9661674803056342,6,73.87717906164058,282.2823805704568,1650.2883940503418],
  ["12AX7|EL84|43|8.0|16|384000",271.1026883350686,8.648699174502344,5.277696735282222e-7,48000,65536,0.08180508376808629,-0.08160216118276133,-1.9711164448521492,0.9713193674374743,6,151.78912374642826,741.930150672127,1036.528343686379],
  ["12AX7|EL34|0|6.0|4|352800",207.08687061181547,5.510593861790939,1.8990375358358144e-7,44160,65536,0.09022347588881122,-0.09012024737989871,-1.971602646406963,0.9717058749158755,6,64.28022285851173,240.85490348750346,1370.7651241922558],
  ["12AX7|EL34|0|6.0|4|384000",207.47533403503763,5.421598144491633,5.463765644124818e-7,48000,65536,0.08732686847589864,-0.08728513962030986,-1.977685098814753,0.9777268276703416,6,29.210818577488354,126.04043235214483,1250.584041128156],
  ["12AX7|EL34|0|6.0|8|352800",292.9162810300563,7.850618217542938,1.909245112874427e-7,44160,65536,0.0906163670804294,-0.09053720084266213,-1.977281682088239,0.9773608483260063,6,49.07630373341383,241.83510405725792,1043.9603895933838],
  ["12AX7|EL34|0|6.0|8|384000",293.46586000987514,7.724721490934366,5.4657341968149e-7,48000,65536,0.09652857595188945,-0.0963731219380784,-1.975063733522012,0.9752191875358229,6,98.50251867812963,765.6576299098906,767.9151248110123],
  ["12AX7|EL34|0|6.0|15|352800",401.1395192522838,10.789787861643338,1.8982989663982957e-7,44160,65536,0.0913097397935134,-0.09116925147781403,-1.9711064036722328,0.9712468919879321,6,86.4581869163475,348.4872478019937,1289.661298599694],
  ["12AX7|EL34|0|6.0|15|384000",401.89221649665654,10.617333987551598,5.458886164521104e-7,48000,65536,0.0834299685779945,-0.08331796926908484,-1.9696795301793668,0.9697915294882766,6,82.09870147569269,263.67784318678736,1610.9880309601122],
  ["12AX7|EL34|0|6.0|16|352800",414.2880442952466,11.1380623483091,1.900656705072535e-7,44160,65536,0.09763305431116932,-0.09755292552308165,-1.9683838962964535,0.9684640250845412,6,46.10188502265136,156.2371153804445,1643.025856654895],
  ["12AX7|EL34|0|6.0|16|384000",415.0654048103095,10.959963441718628,5.459782048539663e-7,48000,65536,0.10167131431604222,-0.10149220471993621,-1.970562354059759,0.9707414636558649,6,107.75925793025095,527.3923622587128,1287.43870907707],
  ["12AX7|EL34|0|6.6|4|352800",213.9248019790405,5.757491571731748,1.9280178910110824e-7,44160,65536,0.0894778870152966,-0.08939466228363965,-1.9721695117627942,0.9722527364944511,6,52.25013802368189,191.66649666645947,1388.3621135300175],
  ["12AX7|EL34|0|6.6|4|384000",214.322464631521,5.666152738125362,5.431458504496032e-7,48000,65536,0.08726311529428168,-0.08721883399342645,-1.9778311773768391,0.9778754586776942,6,31.02067382359001,135.809660758776,1231.5249298701976],
  ["12AX7|EL34|0|6.6|8|352800",302.58825009772556,8.201698161710334,1.930967067873856e-7,44160,65536,0.10248204582149681,-0.10243069941718198,-1.9660309042657476,0.9660822506700623,6,28.139720369149188,89.10030056626817,1848.423904624029],
  ["12AX7|EL34|0|6.6|8|384000",303.1508446264796,8.07248570848482,5.426790824226302e-7,48000,65536,0.08189691958819544,-0.0817713284300099,-1.9775476244329762,0.9776732155911617,6,93.79421842508998,649.1686742163117,730.8070612606402],
  ["12AX7|EL34|0|6.6|15|352800",414.38496084118094,11.271855995740658,1.9098742702671357e-7,44160,65536,0.0958411591378572,-0.09568466603632186,-1.9729817754746042,0.9731382685761395,6,91.75857410958494,474.20577062434563,1054.7045716345285],
  ["12AX7|EL34|0|6.6|15|384000",415.15548444133714,11.094859491394242,5.420296307053062e-7,48000,65536,0.09058334167266552,-0.09042769947683701,-1.9748152036992828,0.9749708458951114,6,105.10024819072741,668.6888495669665,880.4490787059121],
  ["12AX7|EL34|0|6.6|16|352800",427.9676459561697,11.63575359555542,1.898087522090114e-7,44160,65536,0.09836031586785973,-0.09822873954440046,-1.9742993558144866,0.9744309321379458,6,75.16180130556451,397.69403303684976,1056.6794006229802],
  ["12AX7|EL34|0|6.6|16|384000",428.76341672961587,11.452963458065174,5.414006144871399e-7,48000,65536,0.08802958903836897,-0.08782832847160144,-1.9687471678155226,0.9689484283822901,6,139.88730606695225,557.1397320297192,1370.68081829726],
  ["12AX7|EL34|0|8.0|4|352800",227.5099619378965,6.2183079397546015,1.9497369292469637e-7,44160,65536,0.08906712574877376,-0.08901513848551111,-1.9769846201087833,0.9770366073720459,6,32.78347625904725,142.73868800118476,1161.6876993369622],
  ["12AX7|EL34|0|8.0|4|384000",227.92428738019655,6.12265980877549,5.387573735274254e-7,48000,65536,0.0891379489526823,-0.08906972358248061,-1.9761598316304763,0.9762280570006779,6,46.795153435921925,203.59197743920024,1266.7891480168307],
  ["12AX7|EL34|0|8.0|8|352800",321.80390062099235,8.857185657156142,1.927088709530894e-7,44160,65536,0.09320992467403023,-0.09313934739340984,-1.972913524187166,0.9729841014677865,6,42.5320136579341,164.22705816946825,1373.5793970027091],
  ["12AX7|EL34|0|8.0|8|384000",322.3900711089806,8.721874637495063,5.394513816327498e-7,48000,65536,0.0854159159686499,-0.08531814855653133,-1.9771834926756922,0.9772812600878107,6,69.99311782219651,350.45133824758307,1054.0309076958251],
  ["12AX7|EL34|0|8.0|15|352800",440.7001638464483,12.172059165391437,1.9303825707915948e-7,44160,65536,0.11358584942551288,-0.1135162260585117,-1.971526906006298,0.9715965293732993,6,34.42806673703024,151.8975517683305,1466.041345614004],
  ["12AX7|EL34|0|8.0|15|384000",441.5029781358434,11.986706325831978,5.384547745095261e-7,48000,65536,0.0870759594108087,-0.08698210091908393,-1.9737823394567122,0.973876197948437,6,65.91144382771255,262.0151154858292,1355.7787514907045],
  ["12AX7|EL34|0|8.0|16|352800",455.14540946426564,12.565109671698078,1.923016830791132e-7,44160,65536,0.09884905188474136,-0.09875968712964392,-1.9728343196896407,0.9729236844447381,6,50.78539750128601,215.4353634197014,1325.857801295892],
  ["12AX7|EL34|0|8.0|16|384000",455.9745288887695,12.373690057028606,5.387782757048162e-7,48000,65536,0.0889029620287372,-0.08869679138798614,-1.9674436238619957,0.9676497945027468,6,141.89464602924232,528.4520562279239,1481.3335268225533],
  ["12AX7|EL34|20|6.0|4|352800",135.5422658323451,2.9748318601685497,2.0261705622034433e-7,44160,65536,0.10688635020409079,-0.10669044588786225,-1.971775013588827,0.9719709179050556,6,103.00748006692658,695.349979127843,900.9566714273128],
  ["12AX7|EL34|20|6.0|4|384000",135.74267140370935,2.9297922142233706,5.317827212650586e-7,48000,65536,0.09076713211023404,-0.09062387983586605,-1.9758156788338526,0.9759589311082204,6,96.531088667919,637.0366117132959,850.1951158482284],
  ["12AX7|EL34|20|6.0|8|352800",191.7194061953471,4.244496495074697,2.0315553303060904e-7,44160,65536,0.09304139235452485,-0.09286209923591027,-1.9731840759380228,0.9733633690566373,6,108.30659766244568,718.5179053769334,797.4056906486976],
  ["12AX7|EL34|20|6.0|8|384000",192.00294144180418,4.180764563873046,5.339102895529158e-7,48000,65536,0.08569707937557547,-0.08564616785013127,-1.972783579868472,0.9728344913939162,6,36.31871557133237,123.61715527741602,1559.5838843498984],
  ["12AX7|EL34|20|6.0|15|352800",262.5537393912486,5.837974649288313,2.0143456312200653e-7,44160,65536,0.0920243113231295,-0.0918623721579221,-1.9729061717256617,0.9730681108908691,6,98.89638845686329,502.056814427298,1030.9017567597584],
  ["12AX7|EL34|20|6.0|15|384000",262.9420722724584,5.750658146307423,5.365278898566687e-7,48000,65536,0.08917935165287158,-0.08904564440271563,-1.9768717897529027,0.9770054970030586,6,91.69967078794555,701.8459080607881,719.8839586281026],
  ["12AX7|EL34|20|6.0|16|352800",271.1596923830587,6.025802426138528,2.0136915361538008e-7,44160,65536,0.09652091606536424,-0.09638879428787066,-1.9746211496138029,0.9747532713912964,6,76.9128829635477,412.1654492335352,1023.6368249177735],
  ["12AX7|EL34|20|6.0|16|384000",271.5607487827745,5.935630198173562,5.365847973808065e-7,48000,65536,0.09195027400060528,-0.09177004231524172,-1.971983175418642,0.9721634071040056,6,119.9100130822502,614.720277814876,1110.6542287718535],
  ["12AX7|EL34|20|6.6|4|352800",136.56158042914836,3.0195709613458273,2.0603156743425563e-7,44160,65536,0.09589555003836614,-0.09577738896247708,-1.9714438563979004,0.9715620174737893,6,69.22969102695765,282.6115593504095,1337.3218623228518],
  ["12AX7|EL34|20|6.6|4|384000",136.7596112501256,2.972885140270714,5.32233732295344e-7,48000,65536,0.10178234127351535,-0.10163220622976318,-1.9696183895663755,0.9697685246101276,6,90.21556980111897,380.81105148759366,1495.3045891514453],
  ["12AX7|EL34|20|6.6|8|352800",193.16118207397184,4.308054474996925,2.0640497329636122e-7,44160,65536,0.08960673498294908,-0.08948068101835789,-1.9762245870592974,0.9763506410238886,6,79.04423756438302,449.92088764835444,893.9415293040745],
  ["12AX7|EL34|20|6.6|8|384000",193.44135920590176,4.2419928310797435,5.385664768694028e-7,48000,65536,0.1043206754924586,-0.10422566159762561,-1.9718001947244561,0.971895208619289,6,55.688553406744,239.55270172861736,1502.684551657228],
  ["12AX7|EL34|20|6.6|15|352800",264.52820238770806,5.92520539840645,2.0583641992946291e-7,44160,65536,0.08846585584471645,-0.08842148762240176,-1.9776820218652373,0.9777263900875519,6,28.167868303996055,124.00719269076734,1140.7916722624054],
  ["12AX7|EL34|20|6.6|15|384000",264.9119368280742,5.834697449027535,5.368501721157896e-7,48000,65536,0.09245075222874775,-0.09239601763591933,-1.9766817811217767,0.9767365157146052,6,36.19356731863736,162.04798709862328,1276.5100231557851],
  ["12AX7|EL34|20|6.6|16|352800",273.1988746157156,6.115865811651287,2.0662423219586947e-7,44160,65536,0.10390517953737105,-0.10371845633923095,-1.970417506720703,0.9706042299188432,6,100.99510057382537,514.9624754631465,1160.352039676389],
  ["12AX7|EL34|20|6.6|16|384000",273.5951817767674,6.022397684235293,5.359400377870012e-7,48000,65536,0.08399956741898919,-0.08394861546479936,-1.9778597394585002,0.9779106914126899,6,37.08232031993903,159.64021687578048,1205.4924293836748],
  ["12AX7|EL34|20|8.0|4|352800",137.6996779087609,3.0751032266378306,2.0916780501509129e-7,44160,65536,0.7601598450005749,-0.42993124661573345,-0.8506896008739129,0.1809181992587543,7,32000,48000,48000],
  ["12AX7|EL34|20|8.0|4|384000",137.89132196838264,3.025370597833728,5.305857119980567e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|20|8.0|8|352800",194.7709697039247,4.386910942643022,2.106694333668549e-7,44160,65536,0.7601598450005749,-0.42993124661573345,-0.8506896008739129,0.1809181992587543,7,32000,48000,48000],
  ["12AX7|EL34|20|8.0|8|384000",195.042114142118,4.316537598794559,5.308612396870427e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|20|8.0|15|352800",266.73275055613533,6.033409293352416,2.092482254898466e-7,44160,65536,0.7601598450005749,-0.42993124661573345,-0.8506896008739129,0.1809181992587543,7,32000,48000,48000],
  ["12AX7|EL34|20|8.0|15|384000",267.1041159200829,5.936994651884919,5.315525332963695e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|20|8.0|16|352800",275.4756840667774,6.227586752296282,2.0880418882393038e-7,44160,65536,0.7601598450005749,-0.42993124661573345,-0.8506896008739129,0.1809181992587543,7,32000,48000,48000],
  ["12AX7|EL34|20|8.0|16|384000",275.85921655202856,6.128018629754451,5.337174825766211e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|43|6.0|4|352800",100.37458254577234,1.9259857779973577,2.1362172122930204e-7,44160,65536,1.0230297703833793,-0.6672042992009216,-0.7464982538266305,0.10232372500908815,7,24000,32000,96000],
  ["12AX7|EL34|43|6.0|4|384000",100.50315521433421,1.911452222895722,5.343867594317479e-7,48000,65536,1.5331600380084363,-1.1800202530719144,-0.8068579349444072,0.15999771988092912,7,16000,48000,64000],
  ["12AX7|EL34|43|6.0|8|352800",141.97612379732675,2.7514171732563235,2.1005921181453223e-7,44160,65536,1.0230297703833793,-0.6672042992009216,-0.7464982538266305,0.10232372500908815,7,24000,32000,96000],
  ["12AX7|EL34|43|6.0|8|384000",142.15803089683737,2.7308362181693324,5.337768731796243e-7,48000,65536,1.5331600380084363,-1.1800202530719144,-0.8068579349444072,0.15999771988092912,7,16000,48000,64000],
  ["12AX7|EL34|43|6.0|15|352800",194.43191941324628,3.78669176161852,2.115960359495129e-7,44160,65536,1.0230297703833793,-0.6672042992009216,-0.7464982538266305,0.10232372500908815,7,24000,32000,96000],
  ["12AX7|EL34|43|6.0|15|384000",194.68106135873498,3.7584750991813287,5.344586639045736e-7,48000,65536,1.5331600380084363,-1.1800202530719144,-0.8068579349444072,0.15999771988092912,7,16000,48000,64000],
  ["12AX7|EL34|43|6.0|16|352800",200.80497684960196,3.908198503469682,2.132137345857943e-7,44160,65536,1.0230297703833793,-0.6672042992009216,-0.7464982538266305,0.10232372500908815,7,24000,32000,96000],
  ["12AX7|EL34|43|6.0|16|384000",201.06228174862207,3.879062189994278,5.3528987541496e-7,48000,65536,1.5331600380084363,-1.1800202530719144,-0.8068579349444072,0.15999771988092912,7,16000,48000,64000],
  ["12AX7|EL34|43|6.6|4|352800",99.62206056704726,1.8834140715383485,2.1235653274249222e-7,44160,65536,0.8190818007412457,-0.5341925667001787,-0.833102836027328,0.11799207006839511,7,24000,24000,96000],
  ["12AX7|EL34|43|6.6|4|384000",99.7467616380906,1.8787744620717872,5.34649155433392e-7,48000,65536,1.2208725083746101,-0.8898364179031846,-0.8455137556996483,0.17654984617107378,7,19329.81798609536,46224.51184138215,59759.05320766747],
  ["12AX7|EL34|43|6.6|8|352800",140.91171707818896,2.6909971764662495,2.1269623046848003e-7,44160,65536,0.9054759382742175,-0.64380775424855,-0.9639514814073181,0.22561966543298567,7,19150.502956369943,32185.683249289617,51416.107080175454],
  ["12AX7|EL34|43|6.6|8|384000",141.08814493378145,2.6844102371536542,5.337641936800417e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|43|6.6|15|352800",192.97425243209906,3.7038079642502666,2.1295673138502896e-7,44160,65536,0.8049385598717416,-0.34237643111265703,-0.6397615962500036,0.10232372500908817,7,48000,64000,64000],
  ["12AX7|EL34|43|6.6|15|384000",193.21588875518938,3.694755449063008,5.350930582103129e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|43|6.6|16|352800",199.29952999765993,3.822617547393496,2.1141427992475724e-7,44160,65536,0.8049385598717416,-0.34237643111265703,-0.6397615962500036,0.10232372500908817,7,48000,64000,64000],
  ["12AX7|EL34|43|6.6|16|384000",199.549083571045,3.813273608308008,5.327226429753875e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|43|8.0|4|352800",97.47538832555068,1.60625500269966,2.1806826258811455e-7,44160,65536,0.9694043680698614,-0.41233110747938906,-0.5007989973837561,0.05787225797422844,8,48000,64000,96000],
  ["12AX7|EL34|43|8.0|4|384000",97.59173527508737,1.6751012454642713,5.292968295771031e-7,48000,65536,1.0100607434147812,-0.36965901065582685,-0.39937221789698824,0.03977395065594256,8,61432.36746783712,95462.57746431418,101606.97960159188],
  ["12AX7|EL34|43|8.0|8|352800",137.87539273989364,2.2983833210151743,2.1898128761525877e-7,44160,65536,0.9786174669258455,-0.5280323682006036,-0.6299606866671384,0.0805457853923804,8,34643.52510063299,44635.94373405467,96801.60456296252],
  ["12AX7|EL34|43|8.0|8|384000",138.0399829011802,2.3957387641874512,5.291740619764256e-7,48000,65536,1.0572779685758549,-0.6263154478504581,-0.6638177041167581,0.09478022484215486,8,32000,48000,96000],
  ["12AX7|EL34|43|8.0|15|352800",188.81614378840837,3.165734476443313,2.182254990105025e-7,44160,65536,0.8976762749909118,-0.09185358030935267,-0.20464745001817633,0.010470144699735494,8,128000,128000,128000],
  ["12AX7|EL34|43|8.0|15|384000",189.041554676225,3.299027641628987,5.29169560785824e-7,48000,65536,1.0572779685758549,-0.6263154478504581,-0.6638177041167581,0.09478022484215486,8,32000,48000,96000],
  ["12AX7|EL34|43|8.0|16|352800",195.00512136016783,3.2669630772723464,2.1785618027595683e-7,44160,65536,0.8976762749909118,-0.09185358030935267,-0.20464745001817633,0.010470144699735494,8,128000,128000,128000],
  ["12AX7|EL34|43|8.0|16|384000",195.2379197291082,3.4046307260926105,5.296011867171213e-7,48000,65536,1.0572984856482297,-0.5889637903706544,-0.6279103944211185,0.09624508969869379,8,35759.144286036535,62074.75016061042,80987.9112405058],
  ["12AT7|EL84|0|6.0|4|352800",165.87433284385776,12.403835844144226,4.850517384344817e-7,44160,65536,0.09006768954362983,-0.0899869364890218,-1.9666487674439175,0.9667295204985256,6,50.3655299674063,147.78092570163219,1752.135774515507],
  ["12AT7|EL84|0|6.0|4|384000",166.5017793281691,12.281111924943545,4.7255992837721754e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|8|352800",234.6205950006915,17.589732859373374,4.844449618759887e-7,44160,65536,0.08935099602100599,-0.0892789178557256,-1.9628587945473421,0.9629308727126226,6,45.31356819376497,115.46583566842065,2005.5196417698226],
  ["12AT7|EL84|0|6.0|8|384000",235.50820482660336,17.416220164995867,4.721895198165338e-7,48000,65536,0.033526279142781425,-0.002097155725996535,-1.6365075957935935,0.6679367192103786,6,169396.7336530237,9339.558769011292,15324.324216898467],
  ["12AT7|EL84|0|6.0|15|352800",321.3039448220013,24.119549739098495,4.852604690975156e-7,44160,65536,0.08875161751070502,-0.08810086374650189,-1.941797108030158,0.942447861794361,6,413.2246261061624,854.1261215068142,2474.1391081053966],
  ["12AT7|EL84|0|6.0|15|384000",322.51956687864464,23.881956083168316,4.713664965840742e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|16|352800",331.83583260948626,24.905813956260697,4.84606104019139e-7,44160,65536,0.09093958518937431,-0.09075545420176034,-1.969622680473781,0.9698068114613951,6,113.80534628226427,471.6605611315132,1249.8039082609937],
  ["12AT7|EL84|0|6.0|16|384000",333.09129102331127,24.660430178233646,4.712728059943901e-7,48000,65536,0.03621293631458846,-0.0029664162582577524,-1.5874863658436258,0.6207328858999566,6,152914.7554152431,7111.3381225540115,22031.857605685178],
  ["12AT7|EL84|0|6.6|4|352800",172.82118171459456,12.950125257591573,4.818588500433135e-7,44160,65536,0.08861915111621385,-0.08849105762174776,-1.9690085988300554,0.9691366923245214,6,81.2198640495159,276.4650201287233,1483.811410285043],
  ["12AT7|EL84|0|6.6|4|384000",173.47165122831566,12.823002751895713,4.7422629138272514e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|8|352800",244.4465432189637,18.36432219995102,4.800574967767121e-7,44160,65536,0.08921195600533176,-0.08890056484002673,-1.954450409594325,0.9547618007596299,6,196.3319511680299,472.34148881141994,2127.026223100587],
  ["12AT7|EL84|0|6.6|8|384000",245.36672269241237,18.184590297915253,4.73221365641746e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|15|352800",334.76020059985734,25.181622368228773,4.799145060163668e-7,44160,65536,0.08924727304496023,-0.08919672439358142,-1.9643146667238898,0.9643652153752686,6,31.811660947570232,83.03407316467327,1954.3750812650544],
  ["12AT7|EL84|0|6.6|15|384000",336.0204285422247,24.93551221643797,4.723803109400038e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|16|352800",345.7331660691698,26.002518017404878,4.79710691838122e-7,44160,65536,0.08863999088612358,-0.08847533351632196,-1.9727106583386091,0.9728753157084108,6,104.40080894164117,507.9618527852545,1036.1228623044958],
  ["12AT7|EL84|0|6.6|16|384000",347.03469207986706,25.748338536773307,4.728427158179672e-7,48000,65536,0.03334042004560261,-0.003411853236667646,-1.6490307749315232,0.6789593417404582,6,139313.68628002622,9649.214462630636,14014.341733597488],
  ["12AT7|EL84|0|8.0|4|352800",187.33861281735415,14.06378501410127,4.7599889412932175e-7,44160,65536,0.08833914623457272,-0.08828459562468455,-1.961956818374167,0.962011368984055,6,34.68400552810895,83.86421564434346,2090.76444343763],
  ["12AT7|EL84|0|8.0|4|384000",188.03565225549062,13.927534556897722,4.82531449012802e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|8.0|8|352800",264.98068499511174,19.943488322211866,4.7593169953695957e-7,44160,65536,0.08962174621876576,-0.08957919531553513,-1.9700267946084773,0.970069345511708,6,26.665345066152323,83.9568133694681,1622.3095195469748],
  ["12AT7|EL84|0|8.0|8|384000",265.96674507404526,19.750849702813685,4.808012389102115e-7,48000,65536,0.03411018829809996,-0.0020865219911296784,-1.6394122534867437,0.671435919793714,6,170762.66400822514,10534.637470474872,13809.908137472787],
  ["12AT7|EL84|0|8.0|15|352800",362.8809184340193,27.346950896817734,4.7566603277745277e-7,44160,65536,0.09048969586978148,-0.0903155225856748,-1.9723115637927329,0.9724857370768396,6,108.18060795258185,545.1704958068412,1021.403399284811],
  ["12AT7|EL84|0|8.0|15|384000",364.2313733150703,27.083166038108768,4.798637026603083e-7,48000,65536,0.03300268419609719,-0.002907693772218918,-1.649978180674176,0.6800731710980543,6,148463.5189726832,10069.635412305703,13493.743266991878],
  ["12AT7|EL84|0|8.0|16|352800",374.7756418868556,28.238443007542962,4.7652512553149654e-7,44160,65536,0.0896196953638189,-0.08958452686477007,-1.9707953928216675,0.9708305613207164,6,22.038615349070533,70.70557434666617,1591.5171001278586],
  ["12AT7|EL84|0|8.0|16|384000",376.1703515172413,27.966009523972,4.801719461843088e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|20|6.0|4|352800",123.22444224983593,7.977822132547856,4.6366580754911177e-7,44160,65536,0.09174406204475492,-0.09156626884681465,-1.9732877026902007,0.9734654958881411,6,108.91985140815841,711.1731087997543,798.859463314825],
  ["12AT7|EL84|20|6.0|4|384000",123.599910093332,7.9115743134492185,5.052276745401692e-7,48000,65536,0.08065708767153582,-0.07991221340458365,-1.9398180729021854,0.9405629471691377,6,567.0285432424022,1073.919542996669,2671.036686158322],
  ["12AT7|EL84|20|6.0|8|352800",174.29488330118915,11.317732138719672,4.6470430715640816e-7,44160,65536,0.09516015102023573,-0.0950194169213795,-1.9719405771136405,0.9720813112124967,6,83.1025333378033,368.4151379942955,1221.5145550855088],
  ["12AT7|EL84|20|6.0|8|384000",174.82604244674565,11.224058527723876,5.043676257215753e-7,48000,65536,0.08570568917359007,-0.08553958546752376,-1.97012953902668,0.9702956427327463,6,118.56109834645792,453.21087810586596,1389.6944306469302],
  ["12AT7|EL84|20|6.0|15|352800",238.69041690148455,15.522275235103898,4.6480496820800546e-7,44160,65536,0.0930141396852882,-0.0924434358487812,-1.9520604743614016,0.9526311781979085,6,345.5781606063525,1249.5884974140693,1475.221866316229],
  ["12AT7|EL84|20|6.0|15|384000",239.41786767062254,15.393994745635556,5.032862683692367e-7,48000,65536,0.08225231024998471,-0.08175729695880268,-1.9551887702552981,0.9556837835464802,6,368.91833666085984,1219.7449758345451,1550.509997012634],
  ["12AT7|EL84|20|6.0|16|352800",246.51431813900723,16.027851387005544,4.646204059440823e-7,44160,65536,0.09503310660808832,-0.09493990861035459,-1.970020421108066,0.9701136191057997,6,55.092617279683715,198.14428665079845,1505.5594464187286],
  ["12AT7|EL84|20|6.0|16|384000",247.26560725157816,15.895366782858718,5.025562341914505e-7,48000,65536,0.08146274488021853,-0.08128105484568253,-1.9694294616261658,0.9696111516607019,6,136.46088638830653,495.6757675931133,1390.358432405765],
  ["12AT7|EL84|20|6.6|4|352800",125.78546495917695,8.103709349795341,4.60404205030514e-7,44160,65536,0.08926660539237426,-0.08911989072071659,-1.9757736903219643,0.9759204049936221,6,92.36137135983044,677.616641615764,690.9940755222607],
  ["12AT7|EL84|20|6.6|4|384000",126.16214377504552,8.036737101737037,5.064726295767085e-7,48000,65536,0.08659507864944399,-0.08647527480004343,-1.97120675820068,0.9713265620500806,6,84.61152311342367,309.08826552569826,1468.9175448653045],
  ["12AT7|EL84|20|6.6|8|352800",177.91733421995806,11.496488912797917,4.619430567299299e-7,44160,65536,0.09331821301341069,-0.09328450050341648,-1.9692679569480476,0.9693016694580417,6,20.288588880522912,64.0030656825709,1686.7157292628256],
  ["12AT7|EL84|20|6.6|8|384000",178.45020743084635,11.401789427874453,5.058031722284901e-7,48000,65536,0.08429742226603042,-0.08425448896663446,-1.9579036704168864,0.9579466037162825,6,31.134503515848024,63.95209338786039,2561.7677097924325],
  ["12AT7|EL84|20|6.6|15|352800",243.65123729628058,15.76755473906709,4.617105397135662e-7,44160,65536,0.08791680185401202,-0.0876964666827925,-1.956041746712456,0.9562620818836756,6,140.8981960903257,324.9037714354928,2186.3011508505842],
  ["12AT7|EL84|20|6.6|15|384000",244.38103620612804,15.63786824205788,5.05523910792415e-7,48000,65536,0.08163738258127985,-0.08158656520390961,-1.9622854064933049,0.9623362238706751,6,38.05482559402627,85.58123718579834,2260.7273398520983],
  ["12AT7|EL84|20|6.6|16|352800",251.637745508766,16.28110389711363,4.6125164066585816e-7,44160,65536,0.08972359969326527,-0.08963083433458997,-1.9713316340318348,0.9714243993905102,6,58.08345647070624,209.15398247335784,1418.7334182862176],
  ["12AT7|EL84|20|6.6|16|384000",252.39145959461268,16.147167396977334,5.043711779720125e-7,48000,65536,0.08352530252908208,-0.08333581823504865,-1.9595019049298292,0.9596913892238625,6,138.8032388340005,330.82400413225537,2183.682457141012],
  ["12AT7|EL84|20|8.0|4|352800",130.34620957009696,8.294026133857,4.573346145441813e-7,44160,65536,0.0879548587395308,-0.08786300409750358,-1.9688887330350302,0.9689805876770574,6,58.67010366903042,185.77901802540657,1583.5425355315497],
  ["12AT7|EL84|20|8.0|4|384000",130.7219892647832,8.22549430784324,5.149855133168889e-7,48000,65536,0.08241504317896624,-0.08222882155066574,-1.9650313345215005,0.9652175561498009,6,138.2503071255093,401.84658017729544,1761.7493892532088],
  ["12AT7|EL84|20|8.0|8|352800",184.36831042688408,11.766920478812267,4.562894416956314e-7,44160,65536,0.08804785895293024,-0.08799833858781295,-1.962027920383178,0.9620774407482953,6,31.589001920225954,75.9819510245628,2094.790419767677],
  ["12AT7|EL84|20|8.0|8|384000",184.8999142736454,11.67001220584939,5.142456883788812e-7,48000,65536,0.08367999994869549,-0.08351356948924116,-1.9741892471146898,0.9743556775741441,6,121.67314604554818,772.5620801637949,815.1494982141614],
  ["12AT7|EL84|20|8.0|15|352800",252.48563097311896,16.138752933818143,4.5784072822567125e-7,44160,65536,0.0895573726209339,-0.08948829031213382,-1.95327764242771,0.9533467247365103,6,43.3293090437573,85.89523010446128,2596.755313620936],
  ["12AT7|EL84|20|8.0|15|384000",253.21369288366463,16.006038927407136,5.135462032856031e-7,48000,65536,0.08138608636634467,-0.08132381775352072,-1.973647771282257,0.9737100398950811,6,46.77745338301286,160.59450581059681,1467.627481912892],
  ["12AT7|EL84|20|8.0|16|352800",260.76171416803066,16.6643504566553,4.57591203902292e-7,44160,65536,0.09189984287900217,-0.09167077220017462,-1.959493663233351,0.9597227339121787,6,140.1345647345368,382.8450103710845,1925.5239080054803],
  ["12AT7|EL84|20|8.0|16|384000",261.5136341240742,16.527287587949033,5.144928271626816e-7,48000,65536,0.08299386428555787,-0.08284013088341992,-1.971311247687686,0.9714649810898238,6,113.31206409668164,437.39757560607336,1331.8995819074098],
  ["12AT7|EL84|43|6.0|4|352800",98.76335379143818,5.816650250376477,4.5410618023814034e-7,44160,65536,0.09195697149945102,-0.09178201253029221,-1.972839927828073,0.9730148867972318,6,106.93348862661055,592.9507443446328,943.0791507473554],
  ["12AT7|EL84|43|6.0|4|384000",99.02218001902021,5.777372450913472,5.213611770833802e-7,48000,65536,0.08436566156253708,-0.0843281661190211,-1.9745124207145346,0.9745499161580505,6,27.168187217799293,95.87567360297356,1479.6536955470397],
  ["12AT7|EL84|43|6.0|8|352800",139.69603898691298,8.254201806167034,4.579483700028315e-7,44160,65536,0.1005240417486018,-0.10047028575148619,-1.9727446504975332,0.9727984064946488,6,30.034598812687555,120.31187266703137,1428.2118620179604],
  ["12AT7|EL84|43|6.0|8|384000",140.06219390093912,8.198658427091846,5.197954871293179e-7,48000,65536,0.08485041566011432,-0.08473052425762212,-1.9770845388090583,0.9772044302115506,6,86.4156550993317,496.0095305647721,913.2775560443475],
  ["12AT7|EL84|43|6.0|15|352800",191.3086827603799,11.322299056902457,4.574048646834496e-7,44160,65536,0.08984899746616627,-0.08981418159070537,-1.9622794732958329,0.9623142891712937,6,21.76190696631496,53.1855384554773,2103.7653150416345],
  ["12AT7|EL84|43|6.0|15|384000",191.810153435529,11.246228451054545,5.197446650529447e-7,48000,65536,0.0852559543403032,-0.08512445815151988,-1.9737848531539455,0.9739163493427286,6,94.33545276774565,414.4436574172133,1200.8305649829963],
  ["12AT7|EL84|43|6.0|16|352800",197.57946934784835,11.690846734496924,4.568765972091576e-7,44160,65536,0.09523614857861257,-0.09519111166637235,-1.9714708000193344,0.9715158369315745,6,26.559396356257317,94.25526348371461,1528.3471517719224],
  ["12AT7|EL84|43|6.0|16|384000",198.09737280036236,11.612284252984628,5.197747739371458e-7,48000,65536,0.09023413479343846,-0.09010197527841529,-1.9752777137224218,0.9754098732374451,6,89.57713503191434,479.69071644566054,1041.9332245149226],
  ["12AT7|EL84|43|6.6|4|352800",99.33469961474404,5.80062912747828,4.555798728037209e-7,44160,65536,0.09662114393454149,-0.09652934258284833,-1.9681380846975065,0.9682298860491998,6,53.37427708910728,180.15180658593195,1632.687781725126],
  ["12AT7|EL84|43|6.6|4|384000",99.58878734617561,5.762215608323107,5.266185890506436e-7,48000,65536,0.08789679600441351,-0.08786545497777634,-1.9753515692623496,0.9753829102889867,6,21.795607019998144,82.24985598145359,1441.0635048299418],
  ["12AT7|EL84|43|6.6|8|352800",140.5041937661569,8.231694990538674,4.5563665503036466e-7,44160,65536,0.08865863185289777,-0.08859879341009924,-1.9715365408254146,0.9715963792682131,6,37.910068287831784,128.4979209049418,1489.449651251908],
  ["12AT7|EL84|43|6.6|8|384000",140.86364621908402,8.17737264523466,5.24296008740003e-7,48000,65536,0.08725126591429143,-0.08722102140889573,-1.9556927069411332,0.955722951446529,6,21.1885573388154,42.39593578462143,2725.3543208455685],
  ["12AT7|EL84|43|6.6|15|352800",192.41543083032312,11.29158312951962,4.5629205661619647e-7,44160,65536,0.08858311128122391,-0.08847105250367339,-1.9692214872134235,0.969333545990974,6,71.07526664671649,237.4080021709315,1511.4642741799644],
  ["12AT7|EL84|43|6.6|15|384000",192.90772259947414,11.217183414106968,5.234177048239608e-7,48000,65536,0.08151441986553735,-0.08147651379073492,-1.9771114402982735,0.9771493463730759,6,28.42671839663638,109.93775882002572,1302.794432016865],
  ["12AT7|EL84|43|6.6|16|352800",198.72249350753478,11.659109098115003,4.559939947125504e-7,44160,65536,0.09163253202985963,-0.09140356343272435,-1.967001211387791,0.9672301799849264,6,140.4811684333671,559.9042562432511,1310.940522098724],
  ["12AT7|EL84|43|6.6|16|384000",199.23091719842404,11.582272517625075,5.247361214215763e-7,48000,65536,0.08140770295614166,-0.08137671818675772,-1.9756787487574583,0.9757097335268422,6,23.2657354487915,82.48688823729763,1420.3518270079044],
  ["12AT7|EL84|43|8.0|4|352800",99.8114995184881,5.711699593599274,4.5292190398263776e-7,44160,65536,0.09170464911463018,-0.09164568182377276,-1.9722733330488587,0.9723323003397161,6,36.116711158919074,130.47710831933193,1444.9566921849218],
  ["12AT7|EL84|43|8.0|4|384000",100.05394816999618,5.677105197685034,5.362968557462719e-7,48000,65536,0.08253913002274912,-0.08231407836990776,-1.9699910613951146,0.970216113047956,6,166.8654501879807,906.1417223046885,941.773085918232],
  ["12AT7|EL84|43|8.0|8|352800",141.17863618653703,8.106036057621424,4.49600998209909e-7,44160,65536,0.0901104536315616,-0.09002287450062535,-1.9758430589427896,0.9759306380737257,6,54.59907639538427,249.9931024091886,1118.0288545799651],
  ["12AT7|EL84|43|8.0|8|384000",141.5216245453361,8.057112258466061,5.350120409195123e-7,48000,65536,0.08276008389807168,-0.08260805131347534,-1.9674752599265073,0.9676272925111036,6,112.37412513772034,346.83305109548115,1664.373744904687],
  ["12AT7|EL84|43|8.0|15|352800",193.33907716957268,11.119585647686105,4.5137793257985385e-7,44160,65536,0.08914298093070318,-0.08909612879190419,-1.9770195040905203,0.9770663562293194,6,29.51923719481809,127.1149191269069,1175.6018405007096],
  ["12AT7|EL84|43|8.0|15|384000",193.80882117341213,11.052576653953148,5.333350864668263e-7,48000,65536,0.08505557257116686,-0.0849461953132879,-1.9745431179021986,0.9746524951600776,6,78.64208245373662,335.426963650859,1233.669859779204],
  ["12AT7|EL84|43|8.0|16|352800",199.6764123940397,11.481461550758716,4.50189997971822e-7,44160,65536,0.08973491283392881,-0.08952095857599578,-1.9695776212049085,0.9697915754628416,6,134.0375417441182,623.1566377951353,1099.1899722005994],
  ["12AT7|EL84|43|8.0|16|384000",200.16154939340012,11.412258292849918,5.33888771276442e-7,48000,65536,0.08366277359591054,-0.08363288021566297,-1.9745467316893826,0.97457662506963,6,21.840960036395817,75.48120650263158,1498.3732293870505],
  ["12AT7|EL34|0|6.0|4|352800",152.85887511717266,7.903198246883945,4.382682019507474e-7,44160,65536,0.09698675645184551,-0.0969285967635892,-1.973881768191605,0.9739399278798614,6,33.68128026126257,138.1938017963578,1344.4800169968762],
  ["12AT7|EL34|0|6.0|4|384000",153.19889604008293,7.852222495003975,5.439468992158911e-7,48000,65536,0.08138518264415393,-0.08127239326474738,-1.977561091909194,0.9776738812886004,6,84.7569524437231,466.36818811862815,913.5659338456641],
  ["12AT7|EL34|0|6.0|8|352800",216.21186346924753,11.220201138351253,4.377865835313897e-7,44160,65536,0.0903811258012506,-0.09033410596631113,-1.9713344382036952,0.9713814580386347,6,29.21898024067113,98.16419535738285,1532.2053381954809],
  ["12AT7|EL34|0|6.0|8|384000",216.69289174252475,11.148102326066672,5.436517546989394e-7,48000,65536,0.0890256211296907,-0.08892395788256376,-1.9768037087584,0.976905372005527,6,69.83102406752619,359.5792893924814,1068.4141067168705],
  ["12AT7|EL34|0|6.0|15|352800",296.0945472673219,15.394231321165885,4.3798796052195116e-7,44160,65536,0.09752202258172557,-0.09742250410838663,-1.9709235489327006,0.9710230674060396,6,57.32860846193802,222.94765931275884,1428.1421569785184],
  ["12AT7|EL34|0|6.0|15|384000",296.7533487386303,15.295473896388941,5.425356123004325e-7,48000,65536,0.08362432545791254,-0.0835616789946525,-1.9766405624077832,0.9767032088710432,6,45.80132171986815,189.18886867778798,1251.453223630012],
  ["12AT7|EL34|0|6.0|16|352800",305.80001495977433,15.894839434905228,4.377383832772188e-7,44160,65536,0.0883005846949472,-0.08814586629763961,-1.9741220010648013,0.9742767194621089,6,98.47088601479724,528.9101546237416,934.3502157445173],
  ["12AT7|EL34|0|6.0|16|384000",306.4804041752574,15.792849030749153,5.425677740500007e-7,48000,65536,0.08344608010919406,-0.08330610605682544,-1.9739091102431539,0.9740490842955225,6,102.60238434195426,463.118547499595,1143.8268178952303],
  ["12AT7|EL34|0|6.6|4|352800",157.90437416691648,8.212352163821345,4.370039157982477e-7,44160,65536,0.09074000880925716,-0.09066128559228545,-1.9770101652648546,0.9770888884818262,6,48.73502377814634,235.57663560458826,1065.8452597428122],
  ["12AT7|EL34|0|6.6|4|384000",158.25295374925267,8.160147082895392,5.431660788850432e-7,48000,65536,0.08184656718595472,-0.08174813979407397,-1.9686445656403364,0.9687429930322171,6,73.54076330479496,216.63355817654792,1724.146004782747],
  ["12AT7|EL34|0|6.6|8|352800",223.34847725387078,11.658855270223507,4.3706791382473717e-7,44160,65536,0.0975427448899278,-0.09739805024779104,-1.9663713635461564,0.9665160581882931,6,83.35439437022342,285.1693536903665,1627.1470952736945],
  ["12AT7|EL34|0|6.6|8|384000",223.8416139766198,11.585017125118108,5.429206187686134e-7,48000,65536,0.08329276084238314,-0.08316699125409205,-1.977122160138373,0.9772479297266642,6,92.35232428291299,563.9514149202503,842.6152221243108],
  ["12AT7|EL34|0|6.6|15|352800",305.8678799939697,15.995895934627022,4.3763878801339576e-7,44160,65536,0.10124723364815504,-0.10117969461555842,-1.974740760193651,0.9748082992262477,6,37.468410581796945,170.93367485522575,1261.6988553989283],
  ["12AT7|EL34|0|6.6|15|384000",306.5432651792906,15.894755361331933,5.423543247930388e-7,48000,65536,0.08576370133420275,-0.08558358930127125,-1.9662612915794806,0.9664414036124122,6,128.48339332703145,407.6915107742196,1678.4621576083987],
  ["12AT7|EL34|0|6.6|16|352800",315.89370192212607,16.51609384236877,4.3786423914705985e-7,44160,65536,0.10129173014534067,-0.10124388918819233,-1.9722476074257398,0.9722954483828883,6,26.5263294685316,103.78995435945319,1473.7719988082436],
  ["12AT7|EL34|0|6.6|16|384000",316.59121818361217,16.411642402265574,5.427385707216619e-7,48000,65536,0.08472533658464283,-0.08460386950093947,-1.9757141064509738,0.9758355735346773,6,87.6815379221881,432.1126046547471,1062.8443824558065],
  ["12AT7|EL34|0|8.0|4|352800",167.9287152477241,8.804715781705122,4.3530234999744025e-7,44160,65536,0.09365278512012382,-0.09349539429266046,-1.967203394734283,0.9673607855617465,6,94.4436184845923,328.7808579888579,1534.482487887286],
  ["12AT7|EL34|0|8.0|4|384000",168.29311084853873,8.750315538001558,5.518073837146762e-7,48000,65536,0.09120665937682947,-0.09108111962648605,-1.9755391621344867,0.97566470188483,6,84.17926461630219,449.44255831176355,1056.2168674895677],
  ["12AT7|EL34|0|8.0|8|352800",237.5274275858316,12.499448293223848,4.3634760783443086e-7,44160,65536,0.09228437914727604,-0.09222084010503509,-1.97004926195853,0.9701128010007709,6,38.67325521858024,129.16544697422813,1574.5856377709247],
  ["12AT7|EL34|0|8.0|8|384000",238.04294051134332,12.422503800208517,5.500537832753787e-7,48000,65536,0.08261277010336296,-0.08247696989417472,-1.9757776101492865,0.9759134103584748,6,100.5453071172856,540.9726678063544,949.1096798886122],
  ["12AT7|EL34|0|8.0|15|352800",325.28544034877496,17.148932257015815,4.368811220491344e-7,44160,65536,0.0925881545484988,-0.09251805736489498,-1.971499750643492,0.9715698478270958,6,42.52636870676124,152.87444967639374,1466.606431147246],
  ["12AT7|EL34|0|8.0|15|384000",325.9914719111831,17.043535055413713,5.489072030737086e-7,48000,65536,0.08719898018843313,-0.08705546444247406,-1.9760358834010652,0.9761793991470243,6,100.66932075129459,722.3428007867552,751.0845627442993],
  ["12AT7|EL34|0|8.0|16|352800",335.9477382019801,17.706663108936528,4.3624449512408873e-7,44160,65536,0.08876575914159081,-0.08867926101128684,-1.9774343758215946,0.9775208739518986,6,54.742123804423706,275.5303682812321,1001.0723266075322],
  ["12AT7|EL34|0|8.0|16|384000",336.6769050527854,17.597815893762746,5.493791099183791e-7,48000,65536,0.08683837830583076,-0.08674954633485533,-1.974431432843208,0.9745202648141835,6,62.550556356032345,253.9613385359091,1323.4275394907033],
  ["12AT7|EL34|20|6.0|4|352800",100.051273910005,4.709349683783379,4.338217771739991e-7,44160,65536,0.10058152388439101,-0.100378900952135,-1.9703113218687132,0.9705139448009693,6,113.22880053124268,600.2646811780232,1080.2731090331256],
  ["12AT7|EL34|20|6.0|4|384000",100.23416168127254,4.685552227489641,5.45460475043929e-7,48000,65536,0.08433767987899865,-0.0842436954585078,-1.9762868910876923,0.9763808755081831,6,68.14400772289177,308.22441141308974,1152.5904572509326],
  ["12AT7|EL34|20|6.0|8|352800",141.518060605914,6.688308930844946,4.326740984014989e-7,44160,65536,0.09308970511833659,-0.09295460334815082,-1.9748366519332392,0.974971753703425,6,81.54989967331537,437.7264253797818,985.4917643606373],
  ["12AT7|EL34|20|6.0|8|384000",141.776798714426,6.654640516089315,5.459363560342783e-7,48000,65536,0.09537045413977424,-0.09513246871314904,-1.9677891089184716,0.9680270943450968,6,152.69692714827264,705.6294558475851,1280.3310061395691],
  ["12AT7|EL34|20|6.0|15|352800",193.80409615762107,9.178093173277297,4.337157222184962e-7,44160,65536,0.08894424739415598,-0.08890577473925078,-1.9762446893526393,0.9762831620075445,6,24.2927647178174,98.24660647987712,1249.4966585670472],
  ["12AT7|EL34|20|6.0|15|384000",194.1584592084395,9.131964594630494,5.451038929778141e-7,48000,65536,0.08670437222286921,-0.08664585253394685,-1.9736285274178256,0.9736870471067478,6,41.26282594429773,149.66587853655307,1479.9992824588128],
  ["12AT7|EL34|20|6.0|16|352800",200.15664747718603,9.476325363110988,4.335495979456383e-7,44160,65536,0.09620894919224715,-0.09605840855419047,-1.9746084877738939,0.9747590284119505,6,87.92795790354324,532.2103198337352,903.2603268368388],
  ["12AT7|EL34|20|6.0|16|384000",200.52262198972477,9.428688564736403,5.457235660811127e-7,48000,65536,0.08280826733991652,-0.08276496158421158,-1.975120253654492,0.9751635594101968,6,31.96957515536505,115.1973264488258,1421.861657439025],
  ["12AT7|EL34|20|6.6|4|352800",100.8025897897134,4.761531342886926,4.319153370227174e-7,44160,65536,0.0976628908545942,-0.09761722839255726,-1.975297766746396,0.975343429208433,6,26.259110106740682,113.1137580707992,1288.703245374055],
  ["12AT7|EL34|20|6.6|4|384000",100.98403482884189,4.736591888440847,5.463053134424891e-7,48000,65536,0.08213964816411311,-0.08203524515325154,-1.9768637627384529,0.9769681657493144,6,77.72982516468967,376.6672180867735,1047.3979085012784],
  ["12AT7|EL34|20|6.6|8|352800",142.5807588221736,6.762321684074998,4.304752583069025e-7,44160,65536,0.09335444939046057,-0.0932385384238165,-1.9738430465476964,0.9739589575143406,6,69.76024037804989,318.32380300605695,1163.252924562826],
  ["12AT7|EL34|20|6.6|8|384000",142.83745682193714,6.727037039195727,5.457184867921112e-7,48000,65536,0.08131071676593599,-0.08126134483857839,-1.9758264452655778,0.9758758171929353,6,37.12064665889839,137.80159047883768,1354.6350329819043],
  ["12AT7|EL34|20|6.6|15|352800",195.25942149923677,9.279591597150151,4.3143698724424373e-7,44160,65536,0.0900502378774056,-0.08993318296016556,-1.973689685522902,0.973806740440142,6,73.03582263991717,319.36753470715234,1170.985369615796],
  ["12AT7|EL34|20|6.6|15|384000",195.610991188005,9.231248903739036,5.458805343480432e-7,48000,65536,0.08130935732531266,-0.08110607802459117,-1.9711277200758985,0.9713309993766199,6,152.98450159041016,748.510021060549,1029.2165950686494],
  ["12AT7|EL34|20|6.6|16|352800",201.6596762070153,9.581131119773328,4.314628204251247e-7,44160,65536,0.09247611575036901,-0.09237153868141698,-1.9743853824780098,0.9744899595469618,6,63.53327918211313,286.92322178421597,1164.0489645503687],
  ["12AT7|EL34|20|6.6|16|384000",202.0227657632649,9.531207711479567,5.463125789844608e-7,48000,65536,0.08916310484922728,-0.08907577573509878,-1.9767994038596688,0.9768867329737972,6,59.88774976930561,289.5976852595393,1139.5617854861835],
  ["12AT7|EL34|20|8.0|4|352800",101.6407000218018,4.824149830438461,4.3143004102796075e-7,44160,65536,0.09834856261091854,-0.09826131670919303,-1.9690962309714461,0.9691834768731716,6,49.833160451592526,176.74276644474756,1580.8231251399288],
  ["12AT7|EL34|20|8.0|4|384000",101.817821300289,4.79704146776054,5.57205074418494e-7,48000,65536,0.08587554184833802,-0.08583901017946945,-1.9758291590920412,0.9758656907609097,6,26.004216280721764,99.0853615400051,1393.9854462480998],
  ["12AT7|EL34|20|8.0|8|352800",143.76622212392755,6.851120407023078,4.309636182884265e-7,44160,65536,0.09018936897402721,-0.09009222599252752,-1.9748702321689984,0.974967375150498,6,60.51162040346978,268.5729969457045,1154.8973597956083],
  ["12AT7|EL34|20|8.0|8|384000",144.01680527392375,6.812766324724276,5.544685546123408e-7,48000,65536,0.08438055825023523,-0.08428056210055077,-1.9761644386801607,0.9762644348298452,6,72.46857134741275,333.017006991,1135.0867738292604],
  ["12AT7|EL34|20|8.0|15|352800",196.8828682260821,9.401355116487716,4.3108459809097284e-7,44160,65536,0.08998902676412479,-0.08994511643157485,-1.976337190232191,0.9763811005647408,6,27.405129483927233,114.08781525438174,1228.0229027444998],
  ["12AT7|EL34|20|8.0|15|384000",197.22606436816383,9.348807648878767,5.531664948363117e-7,48000,65536,0.08338974822435911,-0.08321952146647923,-1.9708986752667272,0.9710689020246072,6,124.88496882783869,497.60583906256664,1296.6139928220614],
  ["12AT7|EL34|20|8.0|16|352800",203.33633729001855,9.70686397820408,4.314608914284688e-7,44160,65536,0.09129292181798973,-0.09111461026945383,-1.9693198341049691,0.9694981456535049,6,109.77805862259726,439.1093843584886,1300.2290591023382],
  ["12AT7|EL34|20|8.0|16|384000",203.69077865884822,9.652598126396253,5.553025987157414e-7,48000,65536,0.08614762684232405,-0.086101435300528,-1.9771576195314955,0.9772038110732916,6,32.77833991789103,137.1930909573447,1272.13271728866],
  ["12AT7|EL34|43|6.0|4|352800",74.09373658077772,3.284126944599172,4.3100981075596763e-7,44160,65536,0.11032072959971129,-0.11011411027159942,-1.9712059289769426,0.9714125483050544,6,105.26149642896557,768.168468031198,860.4039483561426],
  ["12AT7|EL34|43|6.0|4|384000",74.21430824295939,3.2803219004292825,5.58610545969441e-7,48000,65536,0.09461319070680095,-0.09446213324979764,-1.9753978774318184,0.9755489348888217,6,97.65371286572046,724.9866302866157,787.9248539310993],
  ["12AT7|EL34|43|6.0|8|352800",104.80233787292467,4.665350178702622,4.335602533704467e-7,44160,65536,0.09690936913377787,-0.09673839698012635,-1.9725488664797934,0.9727198386334448,6,99.14976918402462,538.9189955150342,1014.1398544059607],
  ["12AT7|EL34|43|6.0|8|384000",104.97291525133205,4.659958219186614,5.559976759802242e-7,48000,65536,0.08564236795432928,-0.08560152247768756,-1.9775158467355651,0.9775566922122069,6,29.1548118074744,121.94660280880505,1265.3135797100324],
  ["12AT7|EL34|43|6.0|15|352800",143.52321991773672,6.402871485683308,4.323042577285954e-7,44160,65536,0.09978632172350949,-0.09973809295190654,-1.9741348607831612,0.9741830895547642,6,27.14493882682923,113.69623257572991,1354.96050936378],
  ["12AT7|EL34|43|6.0|15|384000",143.75683923841973,6.395469329836464,5.563886747539958e-7,48000,65536,0.09086940089091157,-0.09072264431591931,-1.9734898043125253,0.9736365608875175,6,98.78299602273829,483.2148556084059,1149.6192603833051],
  ["12AT7|EL34|43|6.0|16|352800",148.22764881976937,6.610814077377191,4.333596257194332e-7,44160,65536,0.09243363844781428,-0.09239905382255172,-1.972176315460039,0.9722109000853015,6,21.01275484466168,73.27379554548804,1509.1710168745158],
  ["12AT7|EL34|43|6.0|16|384000",148.46892322927064,6.6031724676085215,5.565634146270462e-7,48000,65536,0.08357924693410147,-0.0833551850234117,-1.9693070318837853,0.9695310937944751,6,164.0603840717648,735.4901826356285,1155.5903479140834],
  ["12AT7|EL34|43|6.6|4|352800",73.53827623146138,3.2389107144664937,4.344874503419506e-7,44160,65536,0.0914107850922311,-0.09137243032999251,-1.9743577451204253,0.974396099882664,6,23.56468789679013,89.62900613346129,1366.751610680417],
  ["12AT7|EL34|43|6.6|4|384000",73.65563402532706,3.2423516173283984,5.62365929875905e-7,48000,65536,0.08539965604638514,-0.08527362390857261,-1.9772697389316491,0.9773957710694616,6,90.2603885864431,589.2225366809632,808.0990422229436],
  ["12AT7|EL34|43|6.6|8|352800",104.01666918193338,4.60124286488097,4.2751201286476435e-7,44160,65536,0.09176209206712393,-0.09172683362701266,-1.9716181375517094,0.9716533959918208,6,21.579031336702776,73.1557584667004,1541.4968370859335],
  ["12AT7|EL34|43|6.6|8|384000",104.18269840226583,4.606099570499827,5.59139945250683e-7,48000,65536,0.0843848090961469,-0.08433354486961138,-1.973348494191416,0.9733997584179516,6,37.139276962191865,127.67615761325555,1520.023937834399],
  ["12AT7|EL34|43|6.6|15|352800",142.44727728989972,6.314974934164051,4.315999130792513e-7,44160,65536,0.09076051324304339,-0.09058350161282862,-1.9731041343787916,0.9732811460090064,6,109.61687501919792,648.8714192936338,871.7955316720668],
  ["12AT7|EL34|43|6.6|15|384000",142.674666597911,6.321607615641344,5.599503466344055e-7,48000,65536,0.0865649032431803,-0.08650286719189516,-1.9763429425148522,0.9764049785661375,6,43.81363820923654,183.84735036080212,1275.4588322476015],
  ["12AT7|EL34|43|6.6|16|352800",147.1164382596671,6.520050945440122,4.298218830304232e-7,44160,65536,0.10443020616021968,-0.10421997617378312,-1.9705617803522655,0.9707720103387021,6,113.15004850196003,688.3831182670226,977.2260676611232],
  ["12AT7|EL34|43|6.6|16|384000",147.3512786263461,6.526904250288483,5.597532110628721e-7,48000,65536,0.08168100955935301,-0.08151214504708176,-1.9714872649460509,0.9716561294583221,6,126.47886481616005,515.1048306421675,1242.168240739903],
  ["12AT7|EL34|43|8.0|4|352800",71.95711147333236,2.994757199652584,4.2951005081629747e-7,44160,65536,0.0967388673986583,-0.009150351252425457,-0.9678203436222714,0.0554088597685043,8,132413.900148113,5498.866417785464,156943.5756411296],
  ["12AT7|EL34|43|8.0|4|384000",72.06643484432028,3.0522670420486695,5.635358303596201e-7,48000,65536,0.10144422491128045,-0.012065312611093042,-0.9835283977939445,0.07290731009413193,8,130125.56203532714,6251.435932440601,153783.55216243243],
  ["12AT7|EL34|43|8.0|8|352800",101.78022821191516,4.255467438765271,4.319656581872182e-7,44160,65536,0.09251177333764819,-0.008575672760151495,-0.9811685496088394,0.0651046501863361,8,133547.19963108675,5320.652922304185,148067.26009228732],
  ["12AT7|EL34|43|8.0|8|384000",101.93487753507029,4.336801632315026,5.644472452217026e-7,48000,65536,0.11569754367843142,-0.04254409064387011,-1.0172637025474485,0.09041715558200977,8,61142.29355255203,5171.517746210837,141708.65798867663],
  ["12AT7|EL34|43|8.0|15|352800",139.38458024550587,5.841150642506923,4.2979569309385537e-7,44160,65536,0.09661794198529926,-0.018187367540990495,-1.0424360377611972,0.12086661220550608,8,93772.36135051074,5323.3143674313405,113325.15056568898],
  ["12AT7|EL34|43|8.0|15|384000",139.59637459404425,5.952516449927671,5.657455020091399e-7,48000,65536,0.10652963071296438,-0.03138552153485044,-1.0071294451448778,0.08227355432299176,8,74687.81285844473,5265.310417524523,147383.20883739006],
  ["12AT7|EL34|43|8.0|16|352800",143.95334704479905,6.030737010034732,4.3366288717548423e-7,44160,65536,0.10921258747465327,-0.006906867276495432,-0.9713216450060919,0.0736273652042497,8,155017.42988123788,6641.23636157058,139839.07612614974],
  ["12AT7|EL34|43|8.0|16|384000",144.17208281056944,6.145756347764994,5.652292443807059e-7,48000,65536,0.1358191028475969,-0.02823401756029901,-1.0004504801684788,0.10803556545577674,8,96000,8000,128000],
  ["12AU7|EL84|0|6.0|4|352800",12.65511304430348,0.9496914209414329,0.0000025193529787003678,44160,65536,0.08982421895096719,-0.08975829005943015,-1.9720223639348953,0.9720882928264323,6,41.22782864656821,146.04887666279447,1443.4775422668258],
  ["12AU7|EL84|0|6.0|4|384000",12.696616264874132,0.9439731705646193,0.0000028170437711643514,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.0|8|352800",17.89999661488111,1.3467340215501318,0.0000025187791006938165,44160,65536,0.08807158738805183,-0.08789453128704641,-1.9659845100413151,0.9661615661423204,6,112.9953812482681,361.35890816099277,1571.5555754837885],
  ["12AU7|EL84|0|6.0|8|384000",17.95870875403039,1.338649843550883,0.0000028083433140040777,48000,65536,0.03410615843442524,-0.003163710971482071,-1.6284423787076867,0.65938482617063,6,145316.29217796982,8232.003239722028,17219.421299066722],
  ["12AU7|EL84|0|6.0|15|352800",24.513361180614492,1.8466722038267802,0.0000025321411996601935,44160,65536,0.09120959800714631,-0.09106843604943202,-1.9755268285647252,0.9756679905224396,6,86.96852961282448,525.1344703317288,858.000865133233],
  ["12AU7|EL84|0|6.0|15|384000",24.593770164949067,1.8356020365914731,0.000002811381850346506,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.0|16|352800",25.316874496869307,1.9068723452800713,0.0000025379518255567913,44160,65536,0.08884586551534385,-0.08880254290185036,-1.9773032800706396,0.9773466026841331,6,27.386216654982572,118.25016943191967,1168.363749351624],
  ["12AU7|EL84|0|6.0|16|384000",25.39991851264028,1.8954392952771721,0.0000028141071484664733,48000,65536,0.036094570412117485,-0.005117502063894248,-1.640643841152659,0.6716209095008823,6,119387.65935234244,9468.535880151427,14859.173897873618],
  ["12AU7|EL84|0|6.6|4|352800",13.18508699406421,0.9915148324546341,0.000002522882968050856,44160,65536,0.09089123154241834,-0.09079994200641178,-1.974131712616923,0.9742230021529298,6,56.42426492788614,237.23954987026246,1229.1167609982726],
  ["12AU7|EL84|0|6.6|4|384000",13.228078425569475,0.9856131366613106,0.000002800079848613674,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|8|352800",18.64961655227218,1.4060353892326074,0.000002514266462388405,44160,65536,0.08839360600442299,-0.08806385520423597,-1.9494556233464315,0.9497853741466186,6,209.85776384888678,433.78417703360947,2459.014242963136],
  ["12AU7|EL84|0|6.6|8|384000",18.710434048596213,1.3976917929057173,0.000002793968988193878,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|15|352800",25.539936645443245,1.9279825187652808,0.0000025117207119661972,44160,65536,0.0893214112754719,-0.08821309294255049,-1.932601802410113,0.9337101207430344,6,701.077599805142,1621.9637723517724,2229.3134027804426],
  ["12AU7|EL84|0|6.6|15|384000",25.62322897351097,1.916557057817796,0.000002820778101925698,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|16|352800",26.37709973750202,1.9908339989725976,0.0000025112879337772575,44160,65536,0.09136882338063398,-0.0909026095600375,-1.9567979621631966,0.9572641759837931,6,287.2408391312304,1190.348507417836,1262.0461923568785],
  ["12AU7|EL84|0|6.6|16|384000",26.46312156760927,1.979034038308637,0.000002817128874146087,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|4|352800",14.292608886010985,1.0767852195949201,0.000002505452188828816,44160,65536,0.05314895486128553,-0.00543839904174662,-1.5596300590350092,0.607340614854548,6,128000,12000,16000],
  ["12AU7|EL84|0|8.0|4|384000",14.338592942307805,1.0705058443471844,0.000002772815983754837,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|8|352800",20.21614781124191,1.5269474288327918,0.0000025090849550244026,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,6,128000,8000,24000],
  ["12AU7|EL84|0|8.0|8|384000",20.281198915980053,1.5180697984036857,0.0000027717513696886653,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|15|352800",27.685240866632032,2.093774494627569,0.0000025039236805220876,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,6,128000,8000,24000],
  ["12AU7|EL84|0|8.0|15|384000",27.774331378880802,2.081617696168307,0.0000027760845581695142,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|16|352800",28.59272400575696,2.162031470644992,0.0000025054162481382157,44160,65536,0.047632690745048126,-0.005006579209540753,-1.519056591351823,0.5616827028873305,6,126492.52773574914,6998.260644477252,25390.00134150538],
  ["12AU7|EL84|0|8.0|16|384000",28.684734043230986,2.1494761783969953,0.000002774063882659045,48000,65536,0.03157661930906451,-0.0019466240819103699,-1.652606458773521,0.6822364540006752,6,170287.35430891754,9964.540768074856,13404.740738424036],
  ["12AU7|EL84|20|6.0|4|352800",9.40058740078567,0.6112823771557269,0.0000025069323264143743,44160,65536,0.08877478679265763,-0.08873982806426318,-1.975428492944606,0.9754634516730005,6,22.1156761568174,85.20496082684613,1309.7028553194548],
  ["12AU7|EL84|20|6.0|4|384000",9.424508664380735,0.6089899336977032,0.0000027329335540589815,48000,65536,0.08253187896990227,-0.08245156234535045,-1.9712884938045874,0.9713688104291391,6,59.50404316487511,192.26497479245904,1583.082641453375],
  ["12AU7|EL84|20|6.0|8|352800",13.296665532566834,0.8671841780710022,0.0000025013397314358792,44160,65536,0.08989298503282325,-0.08974692698319958,-1.9639858566852464,0.9641319147348701,6,91.30645107016,262.1595014158099,1788.835153423386],
  ["12AU7|EL84|20|6.0|8|384000",13.330506171432651,0.863942753847871,0.00000274256485244711,48000,65536,0.0847513749235303,-0.08469616874267609,-1.9790927851751237,0.979147991355978,6,39.822983444817396,189.76821483428805,1098.0870220837758],
  ["12AU7|EL84|20|6.0|15|352800",18.209292741108218,1.189335864431634,0.000002510906712577666,44160,65536,0.08800036204048187,-0.08777846491343298,-1.9701628162926617,0.9703847134197104,6,141.76337756853638,797.446474516779,890.5685989128796],
  ["12AU7|EL84|20|6.0|15|384000",18.25563932542026,1.1848961858574267,0.0000027624089925325262,48000,65536,0.0854465383154784,-0.08538414184617511,-1.9677636342864657,0.9678260307557691,6,44.64527648166445,126.53577993884637,1872.119964873125],
  ["12AU7|EL84|20|6.0|16|352800",18.806165149866455,1.2280748306165958,0.0000025106968799046314,44160,65536,0.08922681339281177,-0.08918922670318502,-1.9564339278883636,0.9564715145779902,6,23.658047089687702,49.46448087024349,2449.4443042480607],
  ["12AU7|EL84|20|6.0|16|384000",18.854030510218692,1.2234897748299385,0.000002752536706212819,48000,65536,0.08152461572998122,-0.0814211246066322,-1.9375341172096592,0.9376376083330081,6,77.6321295014097,104.18078838613327,3831.1530703196413],
  ["12AU7|EL84|20|6.6|4|352800",9.595915847446145,0.6209505454452947,0.000002524039312582302,44160,65536,0.09041165379123407,-0.09032598553449747,-1.9756213247552417,0.9757069930119782,6,53.229214860273245,239.57675416624988,1141.3140260502207],
  ["12AU7|EL84|20|6.6|4|384000",9.6198303955545,0.6186625494254631,0.0000027326960843906536,48000,65536,0.08259914167568574,-0.08254923010417732,-1.958941231931302,0.9589911435028106,6,36.94097151607607,76.68120097148478,2482.4348997160478],
  ["12AU7|EL84|20|6.6|8|352800",13.572948797311197,0.8809124179844713,0.0000025163280778546127,44160,65536,0.09166727163090502,-0.0916315682427379,-1.976347633497535,0.9763833368857022,6,21.874010920123155,91.06672197447715,1250.9153895061238],
  ["12AU7|EL84|20|6.6|8|384000",13.606779946169018,0.8776770805856879,0.000002743320828246082,48000,65536,0.08163653672646763,-0.08147789645419579,-1.9747608753106776,0.9749195155829493,6,118.87828849958109,727.713055982819,824.6425686903655],
  ["12AU7|EL84|20|6.6|15|352800",18.58765297744417,1.2081726951165328,0.0000025209379709566506,44160,65536,0.08962458588904794,-0.08958850521908927,-1.9768974159693151,0.9769334966392738,6,22.609115475532757,94.66963562183099,1215.682792864666],
  ["12AU7|EL84|20|6.6|15|384000",18.6339866517394,1.203741306550779,0.000002737307634696585,48000,65536,0.0876469742694822,-0.0876032364671594,-1.9771621990557906,0.9772059368581134,6,30.50561390013504,129.0969863295595,1280.0958729291826],
  ["12AU7|EL84|20|6.6|16|352800",19.19692738819289,1.2475239640693208,0.0000025151491531519456,44160,65536,0.08953446908563391,-0.08947830964599966,-1.9746732109836604,0.9747293704232947,6,35.23038991111479,138.04275957509984,1299.1363271440237],
  ["12AU7|EL84|20|6.6|16|384000",19.244779389306863,1.24294751479227,0.000002736125708579431,48000,65536,0.08552122271632713,-0.08535587785092418,-1.9690815074433583,0.9692468523087613,6,118.27374101569943,421.7844197413092,1487.2162239940371],
  ["12AU7|EL84|20|8.0|4|352800",9.94374068629046,0.6355887721739738,0.0000025054248461823737,44160,65536,0.09173915355234472,-0.09106825903801032,-1.9474744908984105,0.9481453854127448,6,412.1365132516291,1244.6389008777485,1745.19695496521],
  ["12AU7|EL84|20|8.0|4|384000",9.967410036838228,0.6332897111213763,0.0000027180440319236926,48000,65536,0.08105498810994809,-0.08076142617590608,-1.951534780703201,0.9518283426372431,6,221.74763416870155,435.2322665983823,2582.074884186114],
  ["12AU7|EL84|20|8.0|8|352800",14.064931907078494,0.9017118590359371,0.0000024951660801466574,44160,65536,0.09036820270974258,-0.0902163871544734,-1.9685020295011781,0.9686538450564474,6,94.4092160286715,334.52820202767157,1453.7304157649362],
  ["12AU7|EL84|20|8.0|8|384000",14.098416455294362,0.8984606546873167,0.000002707864851999789,48000,65536,0.08198597482615835,-0.08184316444716229,-1.942759619929531,0.9429024303085269,6,106.5491731489085,159.98513083187166,3433.1459013086874],
  ["12AU7|EL84|20|8.0|15|352800",19.261407277058,1.2367217421550691,0.0000024936641062687847,44160,65536,0.08828981972156377,-0.08812155070411139,-1.9739892646929689,0.9741575337104212,6,107.11651153768236,681.9842536955407,788.1454926716718],
  ["12AU7|EL84|20|8.0|15|384000",19.307266302618885,1.232268331263875,0.0000027128774573907704,48000,65536,0.08081347288496364,-0.08018332938662429,-1.9347778299809626,0.9354079734793019,6,478.41609178293544,725.0977612209367,3355.737424795591],
  ["12AU7|EL84|20|8.0|16|352800",19.892766088810475,1.2769997641926727,0.0000024855208028178675,44160,65536,0.0940285773493412,-0.09382192423675986,-1.9686361501428045,0.9688428032553859,6,123.54024858694271,531.1765408532931,1246.1298234730862],
  ["12AU7|EL84|20|8.0|16|384000",19.940127876787553,1.272400560897789,0.0000027072088072894807,48000,65536,0.08081350796579839,-0.08073540366320174,-1.9461406313002798,0.9462187356028765,6,59.09521375818002,91.21895555749705,3287.338377524391],
  ["12AU7|EL84|43|6.0|4|352800",7.534202250144624,0.4459425087247568,0.0000024921343678025536,44160,65536,0.09211018320053288,-0.09195940968490564,-1.9706624979967589,0.9708132715123862,6,91.9860162268921,374.2970798426584,1288.9255930544414],
  ["12AU7|EL84|43|6.0|4|384000",7.550164730678002,0.4451850279318926,0.0000027262842101049255,48000,65536,0.082271354961994,-0.08208895278662752,-1.9626441115217446,0.962826513697111,6,135.64837569115076,354.01876588398414,1961.1606945942842],
  ["12AU7|EL84|43|6.0|8|352800",10.65676804096602,0.6328109750852395,0.0000024910709869334394,44160,65536,0.09249195200653801,-0.09243723394200574,-1.9762725791534708,0.976327297218003,6,33.227983473888905,145.5322620341542,1199.672671775053],
  ["12AU7|EL84|43|6.0|8|384000",10.679349941890136,0.6317396085570861,0.0000027196287312553714,48000,65536,0.08257281719075418,-0.08246739478621723,-1.978743004289856,0.9788484266943929,6,78.07725848476892,483.62853939972575,822.9274913442852],
  ["12AU7|EL84|43|6.0|15|352800",14.594058770738263,0.8680205961017785,0.0000025073806283976586,44160,65536,0.08856127440888471,-0.08841212343296677,-1.9750395965514493,0.9751887475273674,6,94.64483461048982,559.2369936994131,851.4856360816606],
  ["12AU7|EL84|43|6.0|15|384000",14.624986017864204,0.8665522984074555,0.0000027335653036628956,48000,65536,0.08833695389268491,-0.08822682444501713,-1.9711857972007962,0.9712959266484641,6,76.24006453775415,277.86148793917266,1502.0719206771957],
  ["12AU7|EL84|43|6.0|16|352800",15.072428261585898,0.8962761561891575,0.0000024991435364278125,44160,65536,0.08814283618776243,-0.08804597858959762,-1.9742539994315051,0.9743508570296698,6,61.73537760136934,257.47597136810504,1201.5118387815162],
  ["12AU7|EL84|43|6.0|16|384000",15.104368966000331,0.8947599578085988,0.0000027305905637825703,48000,65536,0.09080936604329053,-0.0905585268942962,-1.966283276359634,0.9665341155086283,6,169.05053118119167,681.0688351033214,1399.2222306030292],
  ["12AU7|EL84|43|6.6|4|352800",7.577742741179115,0.4447417235182177,0.000002500846747354683,44160,65536,0.08835485352133113,-0.08822915641192954,-1.9749475000738221,0.9750731971832237,6,79.93789226019133,391.0201129301427,1026.3561216398552],
  ["12AU7|EL84|43|6.6|4|384000",7.593321158916973,0.444065809864596,0.0000027305058623691554,48000,65536,0.08317919183626998,-0.08304739124048159,-1.9670274327382495,0.9671592333340381,6,96.91663759981049,285.11098721555805,1755.6656553229154],
  ["12AU7|EL84|43|6.6|8|352800",10.718354980949,0.6311243020863148,0.0000024989243172670135,44160,65536,0.09536085695616534,-0.09523014825426451,-1.9750862266316134,0.9752169353335142,6,77.01598475529602,423.3132722158048,985.7863706211219],
  ["12AU7|EL84|43|6.6|8|384000",10.740393637039366,0.6301681632064327,0.000002724040554818461,48000,65536,0.08600799491903466,-0.08591171739915739,-1.9757924330027508,0.975888710522628,6,68.45112900032714,307.3814461179822,1184.2477210581785],
  ["12AU7|EL84|43|6.6|15|352800",14.678400574349453,0.8657188823821373,0.000002490368491086776,44160,65536,0.08925254925256411,-0.0890900005707974,-1.9738654204456425,0.9740279691274092,6,102.35458558196513,575.8276043709383,901.7706645835442],
  ["12AU7|EL84|43|6.6|15|384000",14.708583825841737,0.8644082360241269,0.0000027407401919961303,48000,65536,0.08224442525379312,-0.08221542324430688,-1.9691453724227244,0.9691743744322106,6,21.555076106234917,59.340256271719895,1854.230623768319],
  ["12AU7|EL84|43|6.6|16|352800",15.159534543904119,0.8938978500252144,0.0000024817962752829724,44160,65536,0.08871046605559511,-0.08864498436572613,-1.9716484589106966,0.9717139406005657,6,41.462364239900076,142.60951032740041,1468.544445025435],
  ["12AU7|EL84|43|6.6|16|384000",15.19070691560924,0.8925444844094201,0.0000027392364296475803,48000,65536,0.09139781154065003,-0.09131554626108934,-1.9759550217973079,0.9760372870768684,6,55.03356668391363,252.99350778794164,1229.3316897150705],
  ["12AU7|EL84|43|8.0|4|352800",7.614023949862068,0.4379862840604018,0.000002489916890026598,44160,65536,0.0889890086393235,-0.08892744913077782,-1.9568139056100602,0.956875465118606,5,38.85596879855473,82.93200653430597,2392.267782291312],
  ["12AU7|EL84|43|8.0|4|384000",7.628695137421646,0.43761831116161115,0.0000027137450216285278,48000,65536,0.08285193011328591,-0.08275932090465453,-1.9789304332283644,0.9790230424369958,6,68.35113524825398,383.0766436256944,912.5780299147546],
  ["12AU7|EL84|43|8.0|8|352800",10.76967540465225,0.6215787238549679,0.0000024846272005495942,44160,65536,0.09353091834680975,-0.0928861096929009,-1.941560511275977,0.942205319929886,6,388.4415812108058,835.1450976414505,2507.5723324001074],
  ["12AU7|EL84|43|8.0|8|384000",10.790430750366966,0.6210578719725964,0.0000027002053278796458,48000,65536,0.08842917155892926,-0.08838328643143765,-1.9766608954584748,0.9767067805859663,6,31.72053054438145,132.597672051333,1307.8209268393755],
  ["12AU7|EL84|43|8.0|15|352800",14.748683640620568,0.8526532787224886,0.000002464828775567459,44160,65536,0.09089512762812492,-0.09043054538292929,-1.9535566227706624,0.9540212050158582,6,287.728554896902,824.7385699910196,1818.200728838375],
  ["12AU7|EL84|43|8.0|15|384000",14.777109463569586,0.8519386240725809,0.000002692063820042924,48000,65536,0.08418635424501418,-0.08406511623667104,-1.9763330003554413,0.9764542383637845,6,88.07676432757732,459.9908309950146,996.2321420851576],
  ["12AU7|EL84|43|8.0|16|352800",15.232121176021513,0.8804030645844299,0.0000024633875266708267,44160,65536,0.09279068989880133,-0.09269391127059964,-1.959925236675908,0.9600220153041097,5,58.593621928937324,145.1217942225367,2145.739995068699],
  ["12AU7|EL84|43|8.0|16|384000",15.261478449255154,0.8796652451543093,0.0000026932428083399365,48000,65536,0.08351469686096519,-0.08340657052180395,-1.9785705983991981,0.9786787247383595,6,79.17740032255676,498.9260611729261,818.2264198915203],
  ["12AU7|EL34|0|6.0|4|352800",11.660476113999227,0.6064034439391455,0.0000029278222351929846,44160,65536,0.09001383126790265,-0.08993179882501204,-1.9731294707762745,0.9732115032191652,6,51.194472711202025,197.5377161915746,1327.1471622767135],
  ["12AU7|EL34|0|6.0|4|384000",11.680568436480131,0.6060281376211549,0.0000033686168484274212,48000,65536,0.08701003173649911,-0.08698012741169348,-1.9753684159784544,0.9753983203032601,6,21.00828844802608,78.31758676565654,1444.0302216977611],
  ["12AU7|EL34|0|6.0|8|352800",16.49320743180165,0.8608949164561661,0.0000029697095546495975,44160,65536,0.10103698913465396,-0.10084286754176934,-1.9719687840458249,0.9721629056387096,6,107.98407095993812,705.9485861446184,879.2682052413687],
  ["12AU7|EL34|0|6.0|8|384000",16.52163249667995,0.8603627888319575,0.000003374746536232315,48000,65536,0.08461292229971855,-0.08458400429175243,-1.97803964481769,0.9780685628256561,6,20.890905232012592,86.04825739645693,1269.2188547100293],
  ["12AU7|EL34|0|6.0|15|352800",22.58686709345955,1.1811439940870923,0.000002959364944201767,44160,65536,0.0954745177792865,-0.09543146728933412,-1.9716023241082854,0.9716453745982376,6,25.324289259384642,90.30066294054636,1524.8154744667768],
  ["12AU7|EL34|0|6.0|15|384000",22.62579737607083,1.180412686102575,0.0000033870348718724294,48000,65536,0.08537421048459794,-0.08502281151836537,-1.9625004272827014,0.962851826248934,6,252.06958504073134,1132.2241466828818,1181.3486184485753],
  ["12AU7|EL34|0|6.0|16|352800",23.327225693925993,1.2195556391621454,0.0000029556940051799387,44160,65536,0.09939203097961155,-0.09926091041730022,-1.970854865362915,0.9709859859252263,6,74.12326994678654,313.0243196565371,1340.2097915837246],
  ["12AU7|EL34|0|6.0|16|384000",23.367431640025742,1.2188007834717913,0.0000033809340304993955,48000,65536,0.08189324361193207,-0.08175286918440958,-1.973113854730182,0.9732542291577045,6,104.84887202952808,434.94798380898953,1221.8899381947274],
  ["12AU7|EL34|0|6.6|4|352800",12.045339168411791,0.6301072872504604,0.0000029412290098128975,44160,65536,0.09602932901749349,-0.09598283067940477,-1.9740153103836782,0.9740618087217668,6,27.19489652610386,108.65905866426772,1366.9884905234164],
  ["12AU7|EL34|0|6.6|4|384000",12.06588944985148,0.6297526262897608,0.0000033243667930850726,48000,65536,0.08834932162303752,-0.08829405218106538,-1.9773462055250786,0.9774014749670505,6,38.24450944221014,170.2104481359929,1226.754473274931],
  ["12AU7|EL34|0|6.6|8|352800",17.037577505983844,0.8945273839787823,0.0000029418071578440285,44160,65536,0.09719643925603601,-0.09702994059791625,-1.9666188564576266,0.9667853551157464,6,96.26786324111761,343.78634661188585,1552.8874448492425],
  ["12AU7|EL34|0|6.6|8|384000",17.06665049201244,0.8940243998038577,0.0000033508163747876094,48000,65536,0.0887663484925104,-0.08865879168144938,-1.9744575879305875,0.9745651447416485,6,74.09760404755627,325.893466578122,1248.6809025399787],
  ["12AU7|EL34|0|6.6|15|352800",23.33236214351727,1.227274442522364,0.000002944159935300186,44160,65536,0.10623429161385581,-0.1061675330628622,-1.970382935033649,0.9704496935846426,6,35.29615325211396,138.1898422115963,1546.065376789659],
  ["12AU7|EL34|0|6.6|15|384000",23.372179765415066,1.22658284782409,0.0000033598737312051665,48000,65536,0.08412622696629252,-0.08401767791647068,-1.9736182360485726,0.9737267850983944,6,78.9089581273769,312.53232027309645,1314.6386536984],
  ["12AU7|EL34|0|6.6|16|352800",24.09715685391408,1.2671881210351126,0.0000029408866058647064,44160,65536,0.09010462835679334,-0.0900053124270092,-1.9750630495074937,0.9751623654372777,6,61.92413904183481,280.0624367410175,1132.1792536428118],
  ["12AU7|EL34|0|6.6|16|384000",24.138279195068385,1.2664743307737936,0.0000033506684148491246,48000,65536,0.08267501187659256,-0.08264228153739718,-1.9693833725442316,0.9694161028834269,6,24.19990031632494,67.8284438818537,1830.5010997729141],
  ["12AU7|EL34|0|8.0|4|352800",12.809972680662074,0.6755358440245512,0.00000294256363143885,44160,65536,0.09346017661046702,-0.0923503041677018,-1.8650135404870087,0.8661234129297739,6,670.7902324782908,496.0314778801688,7574.268944066476],
  ["12AU7|EL34|0|8.0|4|384000",12.831342349836657,0.6752421829524237,0.000003383665090517403,48000,65536,0.09044255814940481,-0.09012625624712725,-1.964096311956466,0.9644126138587438,6,214.1119235815263,955.2758866852971,1259.308559932047],
  ["12AU7|EL34|0|8.0|8|352800",18.119114882449416,0.9589916590951132,0.0000029469496722866392,44160,65536,0.0943491542854144,-0.09308003488699676,-1.870153834656636,0.8714229540550537,6,760.4148633331481,601.0359848390799,7126.747608301053],
  ["12AU7|EL34|0|8.0|8|384000",18.1493471999839,0.9585747466748361,0.000003365462451910768,48000,65536,0.08625757318070926,-0.08619047009502391,-1.9770033373954792,0.9770704404811645,6,47.562600745888986,209.9463342898275,1207.721199977707],
  ["12AU7|EL34|0|8.0|15|352800",24.813488545615257,1.3156989280209062,0.000002949579307047574,44160,65536,0.09155827780700225,-0.09147333106538719,-1.8651899613916885,0.8652749081333037,6,52.11939461410259,35.55945112800234,8089.775600452053],
  ["12AU7|EL34|0|8.0|15|384000",24.85489400134249,1.315124989586182,0.000003355482241420958,48000,65536,0.08206763024736391,-0.08198069580194392,-1.9657985582211424,0.9658854926665623,6,64.77411337625028,169.2455169311079,1952.0727764265848],
  ["12AU7|EL34|0|8.0|16|352800",25.62683218469909,1.3584909856337797,0.0000029484486103484774,44160,65536,0.1081539562210639,-0.10723953822490671,-1.8601042414081146,0.8610186594042719,6,476.75306672185394,387.3187133368811,8014.896558054325],
  ["12AU7|EL34|0|8.0|16|384000",25.669594371083658,1.3578988014407505,0.000003349289551129053,48000,65536,0.08156886122405081,-0.08144235946579091,-1.9758156468678663,0.9759421486261262,6,94.85505956975915,469.4278159508826,1018.8548560094289],
  ["12AU7|EL34|20|6.0|4|352800",7.631896780692719,0.36161514225387636,0.000002892631596480393,44160,65536,0.08792147342947307,-0.08776959368402197,-1.9677553059683197,0.9679071857137708,6,97.07982658630687,322.52969090351365,1509.02714667076],
  ["12AU7|EL34|20|6.0|4|384000",7.642021927529044,0.3621211109279061,0.0000034822512675543064,48000,65536,0.08850378829720248,-0.0882851459312488,-1.9670959776935188,0.9673146200594726,6,151.16832942560865,567.2758855629456,1463.6825450269143],
  ["12AU7|EL34|20|6.0|8|352800",10.794976638929105,0.5135590355071932,0.0000028298386094763537,44160,65536,0.09319532095355654,-0.09311964120253716,-1.9697276222522988,0.9698033020033181,6,45.61531619342179,154.60940484401908,1567.058255480633],
  ["12AU7|EL34|20|6.0|8|384000",10.80930151123546,0.5142731236170212,0.000003475071163812009,48000,65536,0.0900191047959714,-0.08977995378430043,-1.9689350404384305,0.9691741914501013,6,162.57973701772647,866.6810127618971,1046.9014060106033],
  ["12AU7|EL34|20|6.0|15|352800",14.783347208259945,0.7047266899099509,0.000002814549426933735,44160,65536,0.08818707971213628,-0.08794178641727006,-1.9545807389258139,0.9548260322206802,6,156.39905411749592,352.8714661427591,2242.718898912916],
  ["12AU7|EL34|20|6.0|15|384000",14.802966461306614,0.7057023188552728,0.0000034755090943158046,48000,65536,0.08613544107730803,-0.0860990085283085,-1.9728184916605334,0.9728549242095328,6,25.855378168411313,86.47166423994028,1595.4457566402232],
  ["12AU7|EL34|20|6.0|16|352800",15.267918917882206,0.7276273608914412,0.000002814744563405887,44160,65536,0.090955807424926,-0.09085683929770262,-1.9611459870956198,0.9612449552228433,6,61.129382640053095,154.0883293814564,2065.2915468283854],
  ["12AU7|EL34|20|6.0|16|384000",15.288181011114276,0.7286353341463122,0.0000034741715140783115,48000,65536,0.08501660545059143,-0.0849749104421254,-1.974234459724289,0.9742761547327551,6,29.98045226404741,106.13303128432607,1486.566742388094],
  ["12AU7|EL34|20|6.6|4|352800",7.6891855165909195,0.3656179691978928,0.000002846512706736853,44160,65536,0.09087962986648546,-0.09072392946423927,-1.9593256641580603,0.9594813645603066,8,96.28179726446407,240.71891303835656,2081.7734186270754],
  ["12AU7|EL34|20|6.6|4|384000",7.699170711885273,0.3660541738571572,0.0000034373851252421803,48000,65536,0.04544326975879502,-0.005596098324528933,-1.552537675754123,0.592384847188389,8,128000,8000,24000],
  ["12AU7|EL34|20|6.6|8|352800",10.876008592805318,0.5192365019836757,0.0000028481612039766587,44160,65536,0.09613815485836591,-0.09606206024227419,-1.9696935806258944,0.9697696752419862,8,44.46095504957989,155.33895834508198,1568.275664630923],
  ["12AU7|EL34|20|6.6|8|384000",10.890135560445882,0.5198516870953297,0.0000034463498446338956,48000,65536,0.04544326975879502,-0.005596098324528933,-1.552537675754123,0.592384847188389,8,128000,8000,24000],
  ["12AU7|EL34|20|6.6|15|352800",14.894317505203317,0.7125124506081999,0.0000028586668926685877,44160,65536,0.09744022667013483,-0.09723969928293097,-1.9712356460401241,0.9714361734273279,8,115.67283510327636,670.3889729894901,956.8178739780155],
  ["12AU7|EL34|20|6.6|15|384000",14.913665688183062,0.7133526338794095,0.000003434165988308654,48000,65536,0.03924784848092864,-0.002345968473044665,-1.5534413858980625,0.5903432659059464,8,172174.47842612653,7085.876460388079,25125.114349129126],
  ["12AU7|EL34|20|6.6|16|352800",15.38252668390174,0.7356668154889383,0.0000028464745576567306,44160,65536,0.09357762270536389,-0.09349264591948744,-1.9743789436360308,0.9744639204219074,8,51.01222473053832,220.25047164875338,1232.2221025026897],
  ["12AU7|EL34|20|6.6|16|384000",15.402508783952738,0.7365349247016472,0.0000034333923100878397,48000,65536,0.05048756566770173,-0.0073492723534165595,-1.561579384359726,0.6047176776740113,8,117777.2515954596,9868.051019525972,20872.652085505284],
  ["12AU7|EL34|20|8.0|4|352800",7.753072134574564,0.37042399555881733,0.0000028502124873689094,44160,65536,0.09021481759053895,-0.09014497571646578,-1.9729456652504056,0.9730155071244787,5,43.4865426427515,162.52643200908045,1373.4676658100498],
  ["12AU7|EL34|20|8.0|4|384000",7.762693254511054,0.3707141536119272,0.000003413021034010234,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL34|20|8.0|8|352800",10.966372910928788,0.5260516956162419,0.000002836333540776755,44160,65536,0.0915258128327883,-0.09142093098662737,-1.973844716973363,0.973949598819524,5,64.38050672167759,278.3394462043972,1203.7768235711674],
  ["12AU7|EL34|20|8.0|8|384000",10.979984886866687,0.5264603403482683,0.000003399941980795011,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL34|20|8.0|15|352800",15.018067977716525,0.7218575877470074,0.000002840035628308313,44160,65536,0.10033031880739511,-0.09998805274864041,-1.9616908367271755,0.96203310278593,5,191.8766728859362,802.5604982691282,1370.799635021716],
  ["12AU7|EL34|20|8.0|15|384000",15.036710991524249,0.7224148002283706,0.0000033842277960258724,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL34|20|8.0|16|352800",15.510333480583151,0.7453165813490049,0.000002838768752981348,44160,65536,0.08911706263054063,-0.08873345812908515,-1.9600488997197332,0.9604325042211886,5,242.21884610376844,908.4565275991299,1358.4016761320436],
  ["12AU7|EL34|20|8.0|16|384000",15.52958735989537,0.7458924538648126,0.0000034024439278307488,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL34|43|6.0|4|352800",5.651758552271654,0.2523039083777186,0.0000028636243718510208,44160,65536,0.08944162412297745,-0.08622169751162424,-1.8767769729655286,0.8799968995768819,6,2058.696060752641,2152.5585093790964,5025.465733699571],
  ["12AU7|EL34|43|6.0|4|384000",5.658123102651185,0.2537416393795569,0.0000035089126923585654,48000,65536,0.0827103186238874,-0.08266853812834611,-1.9719172979489632,0.9719590784445044,7,30.879834367166342,96.40857113385147,1641.8125003684067],
  ["12AU7|EL34|43|6.0|8|352800",7.994163897335215,0.35840572793268,0.0000028530628468918503,44160,65536,0.0919587675138037,-0.08983616755675018,-1.8823902424176948,0.8845128423747485,6,1311.247918093789,1264.1071183751126,5626.505702489981],
  ["12AU7|EL34|43|6.0|8|384000",8.003168378397389,0.3604379169152863,0.0000034208103315046764,48000,65536,0.08454442334268115,-0.08450689665789157,-1.9765013882313807,0.9765389149161702,7,27.133323447522223,105.41513020215555,1345.5082342490812],
  ["12AU7|EL34|43|6.0|15|352800",10.947733911099085,0.49187961179616313,0.0000028549557096839426,44160,65536,0.09006571280515886,-0.0876736086261123,-1.8783145255107416,0.8807066296897881,6,1511.4768478452013,1401.5816772396593,5731.175147721635],
  ["12AU7|EL34|43|6.0|15|384000",10.96006635836995,0.49466074113412567,0.0000034305919076671513,48000,65536,0.08104976051938924,-0.08094607615113976,-1.966265243866185,0.9663689282344345,7,78.23315476721923,209.39125522684535,1881.3457587201103],
  ["12AU7|EL34|43|6.0|16|352800",11.306580694998997,0.5078551737072378,0.0000028534907536010864,44160,65536,0.09855266171520342,-0.09764205851831406,-1.885115981371237,0.8860265845681264,6,521.2231265368089,482.9838535046014,6311.617054167693],
  ["12AU7|EL34|43|6.0|16|384000",11.319317203317915,0.5107277459106254,0.0000034482245579688442,48000,65536,0.0834490009176401,-0.08341146571165378,-1.975402187917811,0.9754397231237971,7,27.495822071559942,99.97980849089512,1419.7738799626884],
  ["12AU7|EL34|43|6.6|4|352800",5.609374019896222,0.24884456529702542,0.0000028848332185965622,44160,65536,0.08844206004641382,-0.0883172753658198,-1.9611228476993836,0.9612476323799775,5,79.27891313518094,198.57603596070527,2020.647457842505],
  ["12AU7|EL34|43|6.6|4|384000",5.61551416635489,0.25082290759583975,0.0000034407111128763238,48000,65536,0.08507766546113561,-0.0842760205487845,-1.8656709801727291,0.8664726250850803,6,578.591411093051,383.7516200565586,8375.612657831745],
  ["12AU7|EL34|43|6.6|8|352800",7.934213256417002,0.3535012238740321,0.00000286286334383277,44160,65536,0.08822275868581622,-0.08815841132440899,-1.9752356679214547,0.975300015282862,5,40.96917768367117,165.87221998307857,1238.4441495252672],
  ["12AU7|EL34|43|6.6|8|384000",7.942900130627687,0.3562979555910597,0.0000034358262057253853,48000,65536,0.08664549274731166,-0.0858539705139392,-1.8870839296281985,0.8878754518615708,6,560.8668477015119,460.6608718739329,6807.426574122418],
  ["12AU7|EL34|43|6.6|15|352800",10.865633842040536,0.48515515341331533,0.0000028379392586915214,44160,65536,0.09178863845605204,-0.09173199946243041,-1.9747360769757805,0.9747927159694022,5,34.65846589923991,139.79863511276366,1293.7315123918372],
  ["12AU7|EL34|43|6.6|15|384000",10.877531232582454,0.4889832282275669,0.0000034114463024620134,48000,65536,0.08342289835910398,-0.08149154836189426,-1.876994754524143,0.8789261045213528,6,1431.5400046740451,1139.7804642297965,6747.446688256556],
  ["12AU7|EL34|43|6.6|16|352800",11.221789447440143,0.500911432957575,0.0000028569098215472676,44160,65536,0.08951478573753528,-0.08925748758128314,-1.9678049629626,0.9680622611188521,5,161.62759658993463,834.0387314611503,988.5226512251819],
  ["12AU7|EL34|43|6.6|16|384000",11.234076723411642,0.5048652816659029,0.0000034035797009867933,48000,65536,0.09098507249516102,-0.08957574644654376,-1.8899050023856838,0.891314328434301,6,954.0653746867168,910.4682459173365,6121.3668127770725],
  ["12AU7|EL34|43|8.0|4|352800",5.488739871712618,0.23018822765247904,0.0000028797062475028077,44160,65536,0.08777010063520166,-0.0877333724928441,-1.9470357849914222,0.9470725131337796,7,23.501303864412858,39.47471175449318,3013.9334002936585],
  ["12AU7|EL34|43|8.0|4|384000",5.494328333954217,0.2362591990485195,0.0000034594032664686697,48000,65536,0.09059590011115083,-0.08485628937945751,-1.7895297013765599,0.7952693121082534,6,4000,2000,12000],
  ["12AU7|EL34|43|8.0|8|352800",7.763585192309981,0.327079820721622,0.0000028604304739117743,44160,65536,0.09023006710536433,-0.09016223849275419,-1.9708820587806497,0.9709498873932599,7,42.22538799524805,143.55340192296092,1511.7682423669842],
  ["12AU7|EL34|43|8.0|8|384000",7.771490495259672,0.3356652746514667,0.0000034918574400621487,48000,65536,0.09059590011115083,-0.08485628937945751,-1.7895297013765599,0.7952693121082534,6,4000,2000,12000],
  ["12AU7|EL34|43|8.0|15|352800",10.631966985485494,0.44894938751097896,0.000002859997673242367,44160,65536,0.09063302322485414,-0.09057218230130648,-1.9607778234164737,0.9608386643400213,7,37.70542569782571,90.91994045592195,2152.197902084961],
  ["12AU7|EL34|43|8.0|15|384000",10.642793284348809,0.46070493280060976,0.000003471987344969581,48000,65536,0.09059590011115083,-0.08485628937945751,-1.7895297013765599,0.7952693121082534,6,4000,2000,12000],
  ["12AU7|EL34|43|8.0|16|352800",10.980463118265424,0.46352202495873407,0.000002862166268342961,44160,65536,0.09122339446786111,-0.09115366563767571,-1.9445228807152812,0.9445926095454668,7,42.93593190851944,72.2966948461188,3128.332325519073],
  ["12AU7|EL34|43|8.0|16|384000",10.991644259061735,0.47566323217762585,0.0000034746334773251534,48000,65536,0.09059590011115083,-0.08485628937945751,-1.7895297013765599,0.7952693121082534,6,4000,2000,12000]
]);
// __TUBE_POWER_BREAK_LOOP_ROWS_END__

// ================================================================================================
// Primary data 5/5: the key space.
// ================================================================================================
export const DRIVER_TUBES = Object.freeze(['12AX7', '12AT7', '12AU7']);
export const POWER_TUBES = Object.freeze(['EL84', 'EL34']);
export const SCREEN_TAPS = Object.freeze(['0', '20', '43']);
export const PRIMARIES = Object.freeze(['6.0', '6.6', '8.0']);
export const SPEAKER_LOADS = Object.freeze(['4', '8', '15', '16']);
export const RATE_FAMILIES = Object.freeze([
  Object.freeze({ internalRate: 352800, hostRate: 44100, factor: 8 }),
  Object.freeze({ internalRate: 384000, hostRate: 48000, factor: 8 })
]);

// ================================================================================================
// Stage 1: output-tube LUT construction.
//
// The screen shields the cathode from the anode, so the cathode current follows a single
// composite control voltage,
//
//   Vc = Vgk + Vg2k / mu(g1-g2) + Vak / mu(g1-a),      Ik = K * max(Vc, 0)^n,
//
// which cuts off exactly at Vc = 0. The anode then takes the share of that current the knee lets
// through, and the screen collects the rest:
//
//   f = tanh(kappa * Vak / Vg2k),   Ia = Ik * (1 - s) * f,   Ig2 = Ik - Ia.
//
// Constants:
//   mu(g1-a) = gm * ra at the datasheet typical operating point;
//   mu(g1-g2), K and n solve the three datasheet numbers Ik(typical), Ik(preset zero signal) and
//     gm(typical) simultaneously;
//   s        is the screen share of the cathode current at the preset zero-signal point;
//   kappa    places the knee, tanh(1.4722) = 0.9, at the anode voltage where the published Ia-Va
//     curves reach ninety per cent of their saturated value.
// ================================================================================================

// Zero-signal tube coordinates of the canonical preset, taken from the same DC circuit the
// running-branch oracle solves: the cathode resistor sets Vk, the primary section resistances set
// the plate, and for the distributed connection the screen sits one screen-resistor drop below
// the tap.
function presetOperatingPoint(pt, profile) {
  const sheet = OUTPUT_TUBE_DATASHEETS[pt];
  const opt = profile.optCoefficients;
  const iaA = sheet.presetPlateCurrentA;
  const ig2A = sheet.presetScreenCurrentA;
  const cathodeGroundV = (iaA + ig2A) * sheet.presetCathodeResistorOhm;
  if (pt === 'EL34') {
    const tapGroundV = sheet.presetPlateGroundV + iaA * opt.primaryTapToPlateResistanceOhm;
    const screenGroundV = tapGroundV - ig2A * sheet.presetScreenSeriesResistanceOhm;
    return {
      gridCathodeV: -cathodeGroundV,
      plateCathodeV: sheet.presetPlateGroundV - cathodeGroundV,
      screenCathodeV: screenGroundV - cathodeGroundV,
      iaA,
      ig2A
    };
  }
  const tapGroundV = sheet.presetCenterTapGroundV -
    (iaA + ig2A) * opt.primaryCenterToTapResistanceOhm;
  const plateGroundV = tapGroundV - iaA * opt.primaryTapToPlateResistanceOhm;
  return {
    gridCathodeV: -cathodeGroundV,
    plateCathodeV: plateGroundV - cathodeGroundV,
    screenCathodeV: sheet.presetScreenGroundV - cathodeGroundV,
    iaA,
    ig2A
  };
}

// Solve mu(g1-g2), K and n from Ik(typical), Ik(preset) and gm(typical). mu(g1-a) = gm * ra is
// independent of the three and is substituted first.
function solveTubeConstants(pt, profile) {
  const sheet = OUTPUT_TUBE_DATASHEETS[pt];
  const point = presetOperatingPoint(pt, profile);
  const typicalCathodeCurrentA = sheet.typicalPlateCurrentA + sheet.typicalScreenCurrentA;
  const presetCathodeCurrentA = point.iaA + point.ig2A;
  const screenShare = point.ig2A / presetCathodeCurrentA;
  const plateAmplificationFactor =
    sheet.typicalMutualConductanceS * sheet.typicalPlateResistanceOhm;
  const currentRatioLog = Math.log(typicalCathodeCurrentA / presetCathodeCurrentA);
  // gm = (1 - s) * n * Ik / Vc at the typical point, so the exponent fixes Vc there.
  const typicalControlV = exponent => (1 - screenShare) * exponent *
    typicalCathodeCurrentA / sheet.typicalMutualConductanceS;
  const residual = exponent => {
    const vc1 = typicalControlV(exponent);
    const mu = sheet.typicalScreenCathodeV /
      (vc1 - sheet.typicalGridCathodeV - sheet.typicalPlateCathodeV / plateAmplificationFactor);
    const fromCircuit = point.gridCathodeV + point.screenCathodeV / mu +
      point.plateCathodeV / plateAmplificationFactor;
    return fromCircuit - vc1 / Math.exp(currentRatioLog / exponent);
  };
  let low = 0.6;
  let high = 3.0;
  if (residual(low) * residual(high) > 0) {
    throw new Error(`${pt} pentode exponent is not bracketed by the datasheet numbers`);
  }
  for (let iteration = 0; iteration < 200; iteration++) {
    const mid = 0.5 * (low + high);
    if (residual(low) * residual(mid) <= 0) high = mid; else low = mid;
  }
  const exponent = 0.5 * (low + high);
  const controlV = typicalControlV(exponent);
  const screenAmplificationFactor = sheet.typicalScreenCathodeV /
    (controlV - sheet.typicalGridCathodeV -
      sheet.typicalPlateCathodeV / plateAmplificationFactor);
  return {
    tube: pt,
    screenAmplificationFactor,
    plateAmplificationFactor,
    perveance: typicalCathodeCurrentA / Math.pow(controlV, exponent),
    exponent,
    screenShare,
    // tanh(1.4722) = 0.9.
    kneeFactor: 1.4722 * sheet.kneeScreenCathodeV / sheet.kneePlateCathodeV,
    presetOperatingPoint: point,
    controlVoltageMaxV: sheet.controlVoltageMaxV,
    plateCathodeMaxV: sheet.plateCathodeMaxV,
    screenCathodeMaxV: sheet.screenCathodeMaxV
  };
}

// The control-voltage and plate axes are spaced as the square of the node index so that the knots
// crowd where the curvature is - just above cut-off and across the knee - while still reaching
// the far corner of the operating box. The screen axis only carries the knee ratio, which is
// smooth, so it stays uniform.
function squareLawAxis(maximum, count) {
  return Array.from({ length: count }, (_, index) => maximum * (index / (count - 1)) ** 2);
}
function uniformAxis(maximum, count) {
  return Array.from({ length: count }, (_, index) => maximum * index / (count - 1));
}

function makeTubeLutDefinition(pt, profile) {
  const constants = solveTubeConstants(pt, profile);
  const controlVoltageV = squareLawAxis(constants.controlVoltageMaxV, 11);
  const plateCathodeV = squareLawAxis(constants.plateCathodeMaxV, 11);
  const screenCathodeV = uniformAxis(constants.screenCathodeMaxV, 6);
  const values = [];
  for (const vc of controlVoltageV) {
    for (const vak of plateCathodeV) {
      for (const vg2k of screenCathodeV) {
        const ik = vc > 0 ? constants.perveance * Math.pow(vc, constants.exponent) : 0;
        // With the screen at cathode potential nothing is left to divert current, so the anode
        // takes the whole collectable share.
        const collected = vg2k > 0
          ? Math.tanh(constants.kneeFactor * vak / vg2k)
          : 1;
        const iaA = ik * (1 - constants.screenShare) * collected;
        values.push(iaA, ik - iaA);
      }
    }
  }
  return {
    id: `${pt.toLowerCase()}-ia-ig2-lut-v2`,
    interpolation: 'bounded-trilinear',
    controlVoltage: {
      definition: 'Vc = Vgk + Vg2k / screenAmplificationFactor + Vak / plateAmplificationFactor',
      screenAmplificationFactor: constants.screenAmplificationFactor,
      plateAmplificationFactor: constants.plateAmplificationFactor,
      perveance: constants.perveance,
      exponent: constants.exponent,
      screenShare: constants.screenShare,
      kneeFactor: constants.kneeFactor,
      datasheet: OUTPUT_TUBE_DATASHEETS[pt],
      presetOperatingPoint: constants.presetOperatingPoint
    },
    axes: { controlVoltageV, plateCathodeV, screenCathodeV },
    fieldOrder: ['iaA', 'ig2A'],
    valueCount: values.length,
    valuesBinary64: values
  };
}

// Each output tube carries its own axes: an EL84 cuts off near -15 V of grid and an EL34 near
// -39 V, and their plate and screen swings differ by the same factor, so one shared axis set
// would spend most of its knots outside the operating box of whichever valve is selected.
export function buildTubeLuts(circuitProfiles = CIRCUIT_PROFILES) {
  return ['EL84', 'EL34'].map(pt => {
    const profileId = OUTPUT_TUBE_DATASHEETS[pt].presetProfileId;
    const profile = circuitProfiles.find(row => row.circuitProfileId === profileId);
    if (!profile) throw new Error(`Tube Simulator circuit profile ${profileId} is missing`);
    return makeTubeLutDefinition(pt, profile);
  });
}

function boundedTrilinearBracket(axis, value) {
  if (value <= axis[0]) return { lower: 0, upper: 0, fraction: 0 };
  const last = axis.length - 1;
  if (value >= axis[last]) return { lower: last, upper: last, fraction: 0 };
  let upper = 1;
  while (value > axis[upper]) ++upper;
  while (value <= axis[upper - 1]) --upper;
  return {
    lower: upper - 1,
    upper,
    fraction: (value - axis[upper - 1]) / (axis[upper] - axis[upper - 1])
  };
}

// Same bounded trilinear read the kernel performs, so the DC solve lands on the table the running
// branch uses instead of on the continuous model the table was sampled from.
export function makeTubeLutEvaluator(lut) {
  const { controlVoltageV, plateCathodeV, screenCathodeV } = lut.axes;
  const inverseScreenMu = 1 / lut.controlVoltage.screenAmplificationFactor;
  const inversePlateMu = 1 / lut.controlVoltage.plateAmplificationFactor;
  const values = lut.valuesBinary64;
  const plateCount = plateCathodeV.length;
  const screenCount = screenCathodeV.length;
  return (vgk, vak, vg2k) => {
    const control = boundedTrilinearBracket(
      controlVoltageV, vgk + vg2k * inverseScreenMu + vak * inversePlateMu);
    const plate = boundedTrilinearBracket(plateCathodeV, vak);
    const screen = boundedTrilinearBracket(screenCathodeV, vg2k);
    let iaA = 0;
    let ig2A = 0;
    for (let cx = 0; cx < 2; ++cx) {
      const ci = cx === 0 ? control.lower : control.upper;
      const cw = cx === 0 ? 1 - control.fraction : control.fraction;
      for (let px = 0; px < 2; ++px) {
        const pi = px === 0 ? plate.lower : plate.upper;
        const pw = px === 0 ? 1 - plate.fraction : plate.fraction;
        for (let sx = 0; sx < 2; ++sx) {
          const si = sx === 0 ? screen.lower : screen.upper;
          const sw = sx === 0 ? 1 - screen.fraction : screen.fraction;
          const base = ((ci * plateCount + pi) * screenCount + si) * 2;
          const weight = cw * pw * sw;
          iaA += values[base] * weight;
          ig2A += values[base + 1] * weight;
        }
      }
    }
    return { iaA, ig2A };
  };
}

// ================================================================================================
// Stage 2: quiescent DC solve of the running Power branch.
//
// The whole quiescent network is iterated to its fixed point and then inverted for the supply
// parameter. It is written node for node as the kernel evaluates the branch, so the answer is the
// state the running circuit actually settles to rather than a closed form the circuit only
// approximately obeys:
//
//   V(B+)    = pb - (2*(Ia + Ig2) + Iltp)*Rthevenin    reservoir, both valves + phase inverter
//   Vk       = (Ia + Ig2)*Rk                           cathode bias resistor
//   Vplate   = V(B+) - Ia*(Rct + Rtp) - Ig2*Rct        plate node (kernel plate KVL)
//   Vtap     = V(B+) - (Ia + Ig2)*Rct                  screen tap node
//   Vscreen  = Vtap - Ig2*Rs                           distributed connection
//            = pb - 20 - 2*Ig2*Rs                      pentode connection, own supply branch
//   (Ia,Ig2) = valve table (Vgk = -Vk, Vak, Vg2k)
//
// No constant is adjusted to reach an output power or a gain: the only inputs are the published
// operating row of the valve and the circuit resistances in the profile.
// ================================================================================================

export function solveRunningPowerDc({
  profile, evaluate, supplyV, cathodeResistorOhm, powerTube, ltpStandingCurrentA = 0
}) {
  const opt = profile.optCoefficients;
  const centerToTap = opt.primaryCenterToTapResistanceOhm;
  const tapToPlate = opt.primaryTapToPlateResistanceOhm;
  const winding = centerToTap + tapToPlate;
  const thevenin = profile.powerSupplyRc.theveninResistanceOhm;
  const screenSeries = profile.screenSupplyRc.seriesResistanceOhm;
  const distributed = profile.screenTapTurnsRatio > 0;
  let iaA = powerTube === 'EL34' ? 0.0625 : 0.035;
  let ig2A = powerTube === 'EL34' ? 0.005 : 0.004;
  const nodes = () => {
    const centerTapGroundV =
      supplyV - (2 * (iaA + ig2A) + ltpStandingCurrentA) * thevenin;
    const cathodeGroundV = (iaA + ig2A) * cathodeResistorOhm;
    return {
      centerTapGroundV,
      cathodeGroundV,
      // The screen taps off part-way along the half primary, so the centre-to-tap section carries
      // the anode and the screen current while the tap-to-plate section carries the anode current
      // alone. Charging the whole winding with the anode current only would put the anode a
      // screen-drop above the node the running branch settles on.
      plateGroundV: centerTapGroundV - iaA * winding - ig2A * centerToTap,
      screenTapGroundV: centerTapGroundV - (iaA + ig2A) * centerToTap,
      screenGroundV: distributed
        ? centerTapGroundV - (iaA + ig2A) * centerToTap - ig2A * screenSeries
        : supplyV - 20 - 2 * ig2A * screenSeries
    };
  };
  // Damped fixed-point iteration. The valve table is piecewise trilinear and the network is
  // resistive, so the map is a contraction once the step is short enough; the loop runs to
  // machine precision instead of to a tolerance so the answer does not depend on where it
  // started.
  for (let iteration = 0; iteration < 20000; ++iteration) {
    const node = nodes();
    const next = evaluate(
      -node.cathodeGroundV,
      node.plateGroundV - node.cathodeGroundV,
      node.screenGroundV - node.cathodeGroundV);
    const nextIa = iaA + 0.05 * (next.iaA - iaA);
    const nextIg2 = ig2A + 0.05 * (next.ig2A - ig2A);
    const settled = Math.abs(nextIa - iaA) < 1e-15 && Math.abs(nextIg2 - ig2A) < 1e-15;
    iaA = nextIa;
    ig2A = nextIg2;
    if (settled) break;
  }
  const node = nodes();
  return {
    supplyGroundV: supplyV,
    centerTapGroundV: node.centerTapGroundV,
    plateGroundV: node.plateGroundV,
    screenTapGroundV: node.screenTapGroundV,
    screenGroundV: node.screenGroundV,
    cathodeGroundV: node.cathodeGroundV,
    plateCathodeV: node.plateGroundV - node.cathodeGroundV,
    screenCathodeV: node.screenGroundV - node.cathodeGroundV,
    iaA,
    ig2A,
    quiescentPlateDissipationW: (node.plateGroundV - node.cathodeGroundV) * iaA,
    maximumDcResidualA: 0
  };
}

// The published row fixes a different node for the two valves: Mullard EL34 Issue 2 quotes the
// distributed-load point by its anode-to-ground voltage, the Mullard 5-10 EL84 row by its HT
// centre-tap supply. Bisect the supply parameter until the running circuit settles on whichever
// node the datasheet fixes.
export function solvePowerSupplyForDatasheetRow({
  profile, evaluate, cathodeResistorOhm, powerTube, ltpStandingCurrentA = 0
}) {
  const sheet = OUTPUT_TUBE_DATASHEETS[powerTube];
  const targetV = powerTube === 'EL34' ? sheet.presetPlateGroundV : sheet.presetCenterTapGroundV;
  const observe = powerTube === 'EL34'
    ? dc => dc.plateGroundV
    : dc => dc.centerTapGroundV;
  let low = 200;
  let high = 700;
  for (let iteration = 0; iteration < 300; ++iteration) {
    const middle = 0.5 * (low + high);
    const dc = solveRunningPowerDc({
      profile, evaluate, supplyV: middle, cathodeResistorOhm, powerTube, ltpStandingCurrentA
    });
    if (observe(dc) > targetV) high = middle; else low = middle;
  }
  // A supply rail is a millivolt-resolvable quantity and the parameter travels to the kernel as a
  // single-precision float, so the shipped value is quantised here and the recorded DC state is
  // the state the quantised rail actually produces. One millivolt of rail moves the anode by the
  // same millivolt, which is five orders below the one volt the screen tolerance allows.
  return Math.round(0.5 * (low + high) * 1000) / 1000;
}

// Supply parameter and settled DC state of every circuit profile, keyed by profile id.
export function buildPowerSupplyTable(circuitProfiles = CIRCUIT_PROFILES, tubeLuts = null) {
  const luts = tubeLuts ?? buildTubeLuts(circuitProfiles);
  const evaluators = new Map(luts.map(lut => [lut.id, makeTubeLutEvaluator(lut)]));
  const table = new Map();
  for (const profile of circuitProfiles) {
    const powerTube = profile.key.pt;
    const evaluate = evaluators.get(`${powerTube.toLowerCase()}-ia-ig2-lut-v2`);
    if (!evaluate) throw new Error(`Tube Simulator valve table for ${powerTube} is missing`);
    const cathodeResistorOhm = OUTPUT_TUBE_DATASHEETS[powerTube].presetCathodeResistorOhm;
    const ltpStandingCurrentA = LTP_STANDING_CURRENT_A[profile.circuitProfileId];
    if (!(ltpStandingCurrentA > 0)) {
      throw new Error(
        `Phase-inverter standing current for ${profile.circuitProfileId} is missing`);
    }
    const supplyGroundV = solvePowerSupplyForDatasheetRow({
      profile, evaluate, cathodeResistorOhm, powerTube, ltpStandingCurrentA
    });
    table.set(profile.circuitProfileId, {
      supplyGroundV,
      cathodeResistorOhm,
      powerTube,
      ltpStandingCurrentA,
      dc: solveRunningPowerDc({
        profile, evaluate, supplyV: supplyGroundV, cathodeResistorOhm, powerTube,
        ltpStandingCurrentA
      })
    });
  }
  return table;
}

// ================================================================================================
// Stage 4 (expansion): the runtime feedback ladder of every measured key.
//
// The anchor is the compensator at 30 dB; every setting below it is the anchor blended towards
// the identity filter along v = log1p(q)/log1p(q30), which is the rule the runtime evaluates
// directly. The sixty-one knots recorded per key are that rule applied to the measured plant, so
// the table generator can verify them against the anchor instead of trusting them one by one.
// ================================================================================================

const LOG1P_Q30 = Math.log1p(10 ** (30 / 20) - 1);

export function powerLadderKnot(anchor, nf) {
  const v = Math.log1p(10 ** (nf / 20) - 1) / LOG1P_Q30;
  return {
    b0: 1 + v * (anchor.b0 - 1),
    b1: v * anchor.b1,
    a1: v * anchor.a1,
    a2: v * anchor.a2
  };
}

export function powerResponseAtOneKilohertz(coefficients, internalRate) {
  const angle = 2 * Math.PI * 1000 / internalRate;
  const z1Real = Math.cos(angle);
  const z1Imaginary = -Math.sin(angle);
  const z2Real = Math.cos(2 * angle);
  const z2Imaginary = -Math.sin(2 * angle);
  const numeratorReal = coefficients.b0 + coefficients.b1 * z1Real;
  const numeratorImaginary = coefficients.b1 * z1Imaginary;
  const denominatorReal = 1 + coefficients.a1 * z1Real + coefficients.a2 * z2Real;
  const denominatorImaginary = coefficients.a1 * z1Imaginary + coefficients.a2 * z2Imaginary;
  const magnitudeSquared =
    denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary;
  return {
    real: (numeratorReal * denominatorReal + numeratorImaginary * denominatorImaginary) /
      magnitudeSquared,
    imaginary: (numeratorImaginary * denominatorReal - numeratorReal * denominatorImaginary) /
      magnitudeSquared
  };
}

// The 61 runtime knots of one measured row: 0 to 30 dB in half-decibel steps. a0 is the loop gain
// the detector sees at 1 kHz under the interpolated compensator, and beta is the feedback
// fraction that makes the closed loop deliver the requested amount of feedback there.
function buildRowEndpoints(row) {
  const [, real, imaginary, , , , b0, b1, a1, a2] = row;
  const internalRate = Number(row[0].split('|')[5]);
  const anchor = { b0, b1, a1, a2 };
  return Array.from({ length: 61 }, (_, index) => {
    const nf = index * 0.5;
    const knot = powerLadderKnot(anchor, nf);
    const response = powerResponseAtOneKilohertz(knot, internalRate);
    const detectedReal = real * response.real - imaginary * response.imaginary;
    const detectedImaginary = real * response.imaginary + imaginary * response.real;
    const a0 = Math.hypot(detectedReal, detectedImaginary);
    return {
      nf,
      v: nf / 30,
      b0: knot.b0,
      b1: knot.b1,
      a1: knot.a1,
      a2: knot.a2,
      a0,
      beta: (10 ** (nf / 20) - 1) / a0
    };
  });
}

// ================================================================================================
// Design assembly.
// ================================================================================================

// One A0 record per key, in the order the generated tables carry them: driver tube, output tube,
// screen tap, primary, internal rate family, speaker load.
export function buildPowerA0Records() {
  const rows = new Map(POWER_BREAK_LOOP_ROWS.map(row => [row[0], row]));
  if (rows.size !== 432) {
    throw new Error('Power break-loop measurement must carry 432 distinct keys');
  }
  const records = [];
  for (const tp of DRIVER_TUBES) {
    for (const pt of POWER_TUBES) {
      for (const st of SCREEN_TAPS) {
        for (const zp of PRIMARIES) {
          for (const family of RATE_FAMILIES) {
            for (const sl of SPEAKER_LOADS) {
              const key = [tp, pt, st, zp, sl, family.internalRate].join('|');
              const row = rows.get(key);
              if (!row) throw new Error(`Power break-loop measurement is missing ${key}`);
              const [, real, imaginary, observedDelta, settleFrames, analysisFrames,
                b0, b1, a1, a2, maximumFeedbackDb, zeroHz, pole1Hz, pole2Hz] = row;
              records.push({
                a0Key: ['power-v1', tp, pt, st, zp, sl, family.internalRate],
                internalRateFamily: family.internalRate,
                representativeHostRate: family.hostRate,
                circuitProfileId: `power-v1-${pt.toLowerCase()}-${st}-${zp.replace('.', '_')}`,
                stimulusPeak: POWER_BREAK_LOOP_METHOD.stimulusPeakV,
                smallSignalScale: POWER_BREAK_LOOP_METHOD.smallSignalScale,
                maximumRelativeComplexGainDelta:
                  POWER_BREAK_LOOP_METHOD.maximumRelativeComplexGainDelta,
                observedRelativeComplexGainDelta: observedDelta,
                settleFrames,
                analysisFrames,
                gdet0: { real, imaginary },
                anchor: { zeroHz, pole1Hz, pole2Hz, b0, b1, a1, a2 },
                maximumFeedbackDb,
                endpoints: buildRowEndpoints(row)
              });
            }
          }
        }
      }
    }
  }
  return records;
}

// The complete derived circuit design: everything scripts/generate-tube-phase-c-tables.mjs needs
// to emit the C++ tables and the JavaScript reference tables.
export function deriveTubeCircuitDesign() {
  const tubeLuts = buildTubeLuts();
  const supplyTable = buildPowerSupplyTable(CIRCUIT_PROFILES, tubeLuts);
  const el34Entry = supplyTable.get(EL34_NORMATIVE_SOURCE.circuitProfileId);
  return {
    circuitProfiles: CIRCUIT_PROFILES,
    speakerProfiles: SPEAKER_PROFILES,
    tubeLuts,
    powerSupplyTable: supplyTable,
    el34NormativeFixture: {
      circuitProfileId: EL34_NORMATIVE_SOURCE.circuitProfileId,
      sourcePoint: EL34_NORMATIVE_SOURCE.sourcePoint,
      dc: { ...el34Entry.dc, maximumDcResidualA: 0 },
      screenGroundToleranceV: EL34_NORMATIVE_SOURCE.screenGroundToleranceV,
      dcDisposition: {
        maximumQuiescentPlateDissipationW:
          EL34_NORMATIVE_SOURCE.maximumQuiescentPlateDissipationW
      }
    },
    powerA0Records: buildPowerA0Records()
  };
}

// ================================================================================================
// Invariants. Cheap checks that run on every derivation: they catch a corrupted primary-data edit
// before the table generator turns it into shipped artifacts.
// ================================================================================================

export function verifyDesignInvariants(design = deriveTubeCircuitDesign()) {
  const fail = message => {
    throw new Error(`Tube circuit design invariant failed: ${message}`);
  };
  if (design.circuitProfiles.length !== 18) fail('expected 18 circuit profiles');
  if (design.speakerProfiles.length !== 4) fail('expected 4 speaker profiles');
  if (design.tubeLuts.length !== 2) fail('expected 2 output-tube LUTs');
  if (design.powerA0Records.length !== 432) fail('expected 432 Power A0 records');
  for (const lut of design.tubeLuts) {
    if (lut.axes.controlVoltageV.length !== 11 || lut.axes.plateCathodeV.length !== 11 ||
        lut.axes.screenCathodeV.length !== 6 || lut.valuesBinary64.length !== 1452) {
      fail(`${lut.id} axes or value count differ from the contract`);
    }
    if (lut.valuesBinary64.some(value => !Number.isFinite(value) || value < 0)) {
      fail(`${lut.id} carries a non-finite or negative current`);
    }
  }
  const dc = design.el34NormativeFixture.dc;
  const sourcePoint = design.el34NormativeFixture.sourcePoint;
  if (!(dc.quiescentPlateDissipationW <=
      EL34_NORMATIVE_SOURCE.maximumQuiescentPlateDissipationW)) {
    fail(`EL34 quiescent plate dissipation ${dc.quiescentPlateDissipationW} W exceeds the ` +
      `${EL34_NORMATIVE_SOURCE.maximumQuiescentPlateDissipationW} W limit`);
  }
  if (!(Math.abs(dc.screenGroundV - sourcePoint.screenGroundNominalV) <=
      EL34_NORMATIVE_SOURCE.screenGroundToleranceV)) {
    fail(`EL34 settled screen ${dc.screenGroundV} V is outside the ` +
      `${EL34_NORMATIVE_SOURCE.screenGroundToleranceV} V tolerance of the nominal ` +
      `${sourcePoint.screenGroundNominalV} V`);
  }
  for (const record of design.powerA0Records) {
    const shaping = anchorShapingVerdict(record.anchor, record.internalRateFamily);
    if (!shaping.acceptable) {
      fail(`anchor of ${record.a0Key.join('/')} violates the shaping rules`);
    }
    if (!(record.observedRelativeComplexGainDelta <
        POWER_BREAK_LOOP_METHOD.maximumRelativeComplexGainDelta)) {
      fail(`small-signal delta of ${record.a0Key.join('/')} is outside the schema bound`);
    }
  }
  return design;
}

// ================================================================================================
// Stage 4 (search): the two-pole one-zero compensator fit against a measured plant.
//
// The acceptance envelope, unchanged from the Line branch: phase margin at least 45 degrees,
// distance to the -1 point above 0.35, gain margin above 0 dB, closed-loop 20 kHz within 12 dB of
// 1 kHz. The shaping rules constrain the anchor itself - they describe what a compensation
// network is, so they hold at every feedback setting including the ones the envelope is never
// applied at: every corner inside the measured band, in-band magnitude within the same 12 dB the
// envelope allows the closed loop, and an instantaneous gain conditioned within a factor of a
// thousand of the DC gain.
// ================================================================================================

export const POWER_ANCHOR_SHAPING = Object.freeze({
  minimumCornerHz: 20,
  audioBandHz: Object.freeze([20, 40, 80, 160, 320, 640, 1000, 1280, 2560, 5120, 10240, 20000]),
  maximumBandDeviationDb: 12,
  minimumInstantaneousGain: 1e-3,
  maximumInstantaneousGain: 1e3
});

function anchorMagnitude(anchor, frequencyHz, internalRate) {
  const response = responseFromCoefficients(anchor, frequencyHz, internalRate);
  return Math.hypot(response.real, response.imaginary);
}

export function anchorShapingVerdict(anchor, internalRate) {
  const nyquist = internalRate / 2;
  const corners = [anchor.zeroHz, anchor.pole1Hz, anchor.pole2Hz];
  const cornersInBand = corners.every(
    corner => corner >= POWER_ANCHOR_SHAPING.minimumCornerHz && corner < nyquist);
  let maximumDeviationDb = 0;
  for (const frequencyHz of POWER_ANCHOR_SHAPING.audioBandHz) {
    const deviation = Math.abs(
      20 * Math.log10(anchorMagnitude(anchor, frequencyHz, internalRate)));
    if (!Number.isFinite(deviation)) {
      maximumDeviationDb = Infinity;
      break;
    }
    if (deviation > maximumDeviationDb) maximumDeviationDb = deviation;
  }
  const instantaneousGain = Math.abs(anchor.b0);
  return {
    cornersInBand,
    maximumBandDeviationDb: maximumDeviationDb,
    instantaneousGain,
    acceptable: cornersInBand &&
      maximumDeviationDb <= POWER_ANCHOR_SHAPING.maximumBandDeviationDb &&
      instantaneousGain >= POWER_ANCHOR_SHAPING.minimumInstantaneousGain &&
      instantaneousGain <= POWER_ANCHOR_SHAPING.maximumInstantaneousGain
  };
}

// The ladder the maximum-feedback search walks: 0 to 30 dB in one-decibel steps. A knot is only
// counted once every knot below it also passes, because the runtime ladder is continuous and a
// setting is only reachable through the ones beneath it.
const MAX_NF_LADDER_DB = Object.freeze(Array.from({ length: 31 }, (_, index) => index));

const SEARCH_FREQUENCIES = Object.freeze([
  20, 50, 100, 200, 500, 1000, 2000, 4000, 8000, 12000,
  16000, 24000, 32000, 48000, 64000, 96000, 128000
]);

// Candidate anchors. The deterministic refinement is seeded from the record key, so a rebuild
// reproduces the same anchor. Candidates that fail the shaping rules are not offered.
function* candidateAnchors(record, refinementCount) {
  const nyquist = record.internalRate / 2;
  const offer = anchor =>
    anchorShapingVerdict(anchor, record.internalRate).acceptable ? anchor : null;
  for (const zeroHz of SEARCH_FREQUENCIES) {
    if (zeroHz >= nyquist) continue;
    for (const pole1Hz of SEARCH_FREQUENCIES) {
      if (pole1Hz >= nyquist) continue;
      for (const pole2Hz of SEARCH_FREQUENCIES) {
        if (pole2Hz < pole1Hz || pole2Hz >= nyquist) continue;
        const anchor = offer(deriveAnchor(record.internalRate, zeroHz, pole1Hz, pole2Hz));
        if (anchor) yield anchor;
      }
    }
  }
  let randomState = [...record.key].reduce(
    (value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0x100000000;
  };
  const minimumFrequency = POWER_ANCHOR_SHAPING.minimumCornerHz;
  const maximumFrequency = record.internalRate * 0.45;
  const logarithmicFrequency = () =>
    minimumFrequency * ((maximumFrequency / minimumFrequency) ** random());
  for (let index = 0; index < refinementCount; ++index) {
    const zeroHz = logarithmicFrequency();
    const first = logarithmicFrequency();
    const second = logarithmicFrequency();
    const anchor = offer(deriveAnchor(
      record.internalRate, zeroHz, Math.min(first, second), Math.max(first, second)));
    if (anchor) yield anchor;
  }
}

// Walk the ladder from the bottom and stop at the first knot that fails. The returned reach is
// the highest feedback setting the anchor keeps inside the acceptance envelope.
function acceptableReach(record, anchor, ladder) {
  let reach = -1;
  let worstDistance = Infinity;
  let worstPhaseMargin = Infinity;
  for (const feedbackDb of ladder) {
    const evaluated = evaluateEndpoint(
      record, interpolateCoefficients(anchor, feedbackDb), feedbackDb);
    if (!evaluated.acceptable) break;
    reach = feedbackDb;
    worstDistance = Math.min(worstDistance, evaluated.minimumDistanceToMinusOne);
    worstPhaseMargin = Math.min(worstPhaseMargin, evaluated.minimumPhaseMarginDegrees);
  }
  return { reach, worstDistance, worstPhaseMargin };
}

// The largest feedback the measured plant accepts under a two-pole one-zero compensator. Nothing
// about the plant is altered to reach it; the answer is whatever the measured response allows.
export function deriveMaxStableCompensator(record, { ladder = MAX_NF_LADDER_DB } = {}) {
  // A quarter of the measured grid is enough to rank candidates; the winner is re-walked on the
  // undecimated response so the reported reach is the measured one.
  const searchRecord = {
    ...record,
    detectorResponse: record.detectorResponse.filter(
      (_, index) => index % 4 === 0 || index === record.detectorResponse.length - 1),
    outputResponse: record.outputResponse.filter(
      (_, index) => index % 4 === 0 || index === record.outputResponse.length - 1)
  };
  let best = null;
  for (const anchor of candidateAnchors(record, 4096)) {
    const walked = acceptableReach(searchRecord, anchor, ladder);
    if (walked.reach < 0) continue;
    const candidate = {
      anchor,
      score: walked.reach * 1e6 + walked.worstDistance * 1000 + walked.worstPhaseMargin
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  if (!best) return { anchor: null, maximumFeedbackDb: null };
  const verified = acceptableReach(record, best.anchor, ladder);
  const shaping = anchorShapingVerdict(best.anchor, record.internalRate);
  if (!shaping.acceptable) {
    throw new Error(`shaping rules rejected the selected anchor for ${record.key}`);
  }
  return {
    anchor: best.anchor,
    maximumFeedbackDb: verified.reach,
    worstDistanceToMinusOne: verified.worstDistance,
    worstPhaseMarginDegrees: verified.worstPhaseMargin
  };
}

// ================================================================================================
// Stage 3: the A0 sweep. The shipped JavaScript reference processor is loaded in a bare VM, run
// to its settled state, and measured through the break-loop diagnostic hooks it already carries.
// ================================================================================================

function createReferenceProcessor(pluginSource) {
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 1;
    }

    registerProcessor(processor) {
      this.processorString = processor;
    }

    parseFiniteNumber(value, minimum, maximum, fallback) {
      if (!Number.isFinite(value)) return fallback;
      return value < minimum ? minimum : value > maximum ? maximum : value;
    }

    updateParameters() {}

    setEnabled(enabled) {
      this.enabled = enabled !== false;
    }

    _setSectionEnabled() {}

    getSerializableParameters() {
      return {};
    }

    getWorkletPluginData(parameters) {
      return { parameters };
    }
  }
  const context = {
    PluginBase,
    performance: { now: () => 0 },
    console: { warn() {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    window: { devicePixelRatio: 1 }
  };
  vm.runInNewContext(pluginSource, context);
  const plugin = new context.window.TubeSimulatorPlugin();
  return new Function('context', 'data', 'parameters', plugin.processorString);
}

// The processor string is a constant of the shipped plugin and every session's state lives on its
// own context object, so the half-megabyte source is read, run and compiled once for the whole
// sweep instead of once per measured plant.
let cachedReferenceProcessor = null;

function referenceProcessor() {
  if (!cachedReferenceProcessor) {
    cachedReferenceProcessor = createReferenceProcessor(
      fs.readFileSync(pluginSourcePath, 'utf8'));
  }
  return cachedReferenceProcessor;
}

// Properties of the reference state that are the shipped tables or the parameter-derived circuit
// profile. Nothing writes through them, and within one measured key the parameters never change,
// so a settle snapshot carries them by reference instead of copying them four times.
const SHARED_REFERENCE_STATE_KEYS = new Set([
  'tables', 'coefficients', 'powerProfile', 'powerSpeaker'
]);

function cloneReferenceValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value.slice();
  if (Array.isArray(value)) return value.map(cloneReferenceValue);
  const copy = {};
  for (const key of Object.keys(value)) {
    const entry = value[key];
    copy[key] = typeof entry === 'function' ? entry : cloneReferenceValue(entry);
  }
  return copy;
}

// Restoring writes the snapshot back into the objects the state already holds instead of hanging
// the copies off it. The reference processor reads those objects millions of times per capture and
// a fresh object graph per restore costs far more in the inner loop than the copy itself saves.
function restoreReferenceValue(target, key, source) {
  const current = target[key];
  if (ArrayBuffer.isView(current) && ArrayBuffer.isView(source) &&
      current.length === source.length) {
    current.set(source);
    return;
  }
  if (Array.isArray(current) && Array.isArray(source) && current.length === source.length) {
    for (let index = 0; index < source.length; ++index) {
      restoreReferenceValue(current, index, source[index]);
    }
    return;
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current) &&
      !ArrayBuffer.isView(current) && source !== null && typeof source === 'object' &&
      !Array.isArray(source) && !ArrayBuffer.isView(source)) {
    const live = Object.keys(current).filter(inner => typeof current[inner] !== 'function');
    const stored = Object.keys(source);
    if (live.length !== stored.length) {
      throw new Error(`reference state property ${key} changed shape after the settle snapshot`);
    }
    for (const inner of stored) restoreReferenceValue(current, inner, source[inner]);
    return;
  }
  target[key] = source;
}

function createReferenceSession({ sampleRate, params }) {
  const processor = referenceProcessor();
  const context = {};
  const channels = 2;
  const currentParams = { ...params, fr: true };
  const process = input => {
    processor(context, input, {
      ...currentParams,
      enabled: true,
      sampleRate,
      channelCount: channels,
      blockSize: input.length / channels
    });
    if (!context.__tubeSimulatorReferenceV1) {
      throw new Error('Tube JavaScript reference session did not initialize');
    }
    return input;
  };
  process(new Float32Array(channels));
  return {
    state: () => context.__tubeSimulatorReferenceV1,
    processSilence(frameCount, blockSize = 128) {
      let remaining = frameCount;
      while (remaining > 0) {
        const frames = Math.min(remaining, blockSize);
        process(new Float32Array(channels * frames));
        remaining -= frames;
      }
    },
    reset() {
      context.__tubeSimulatorReferenceV1.reset();
    },
    // The settled circuit is the same for every polarity and every stimulus amplitude of one key,
    // so it is reached once and replayed. The snapshot is taken and reapplied property by property
    // on the live state object because the diagnostic hooks the session drives are closures bound
    // to that object; replacing it wholesale would leave them pointing at the discarded state.
    snapshot() {
      const extras = Object.keys(context).filter(key => key !== '__tubeSimulatorReferenceV1');
      if (extras.length > 0) {
        throw new Error(`reference context carries unsnapshotted state: ${extras.join(', ')}`);
      }
      const state = context.__tubeSimulatorReferenceV1;
      const captured = new Map();
      for (const key of Object.keys(state)) {
        if (typeof state[key] === 'function' || SHARED_REFERENCE_STATE_KEYS.has(key)) continue;
        captured.set(key, cloneReferenceValue(state[key]));
      }
      return captured;
    },
    restore(captured) {
      const state = context.__tubeSimulatorReferenceV1;
      for (const key of Object.keys(state)) {
        if (captured.has(key) || typeof state[key] === 'function' ||
            SHARED_REFERENCE_STATE_KEYS.has(key)) {
          continue;
        }
        throw new Error(`reference state gained property ${key} after the settle snapshot`);
      }
      for (const [key, value] of captured) restoreReferenceValue(state, key, value);
    },
    checkpoint() {
      return context.__tubeSimulatorReferenceV1.checkpoint();
    },
    beginBreakLoopImpulse({ amplitude, captureSamples }) {
      context.__tubeSimulatorReferenceV1.beginBreakLoopImpulse(amplitude, captureSamples);
    },
    breakLoopImpulse() {
      return context.__tubeSimulatorReferenceV1.breakLoopImpulse();
    },
    endDiagnostic() {
      context.__tubeSimulatorReferenceV1.endDiagnostic();
    }
  };
}

function fft(real, imaginary) {
  const length = real.length;
  if (length !== imaginary.length || length < 2 || (length & (length - 1)) !== 0) {
    throw new Error('FFT arrays must have the same power-of-two length');
  }
  for (let index = 1, reversed = 0; index < length; ++index) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = size >> 1;
    for (let offset = 0; offset < length; offset += size) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < half; ++index) {
        const even = offset + index;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function interpolateSpectrum(real, imaginary, internalRate, frequencyHz) {
  const bin = frequencyHz * real.length / internalRate;
  const low = Math.floor(bin);
  const fraction = bin - low;
  const high = Math.min(low + 1, real.length / 2);
  return {
    real: real[low] + fraction * (real[high] - real[low]),
    imaginary: imaginary[low] + fraction * (imaginary[high] - imaginary[low])
  };
}

function responseFrequencies(internalRate) {
  const frequencies = [];
  const maximumFrequency = internalRate / 2;
  for (let index = 0; index <= 4096; ++index) {
    frequencies.push(20 * ((maximumFrequency / 20) ** (index / 4096)));
  }
  frequencies.push(1000, 20000);
  return [...new Set(frequencies)].sort((left, right) => left - right);
}

// Central difference of the two polarities. The odd part is the linearised plant; the even part
// is what the valve curvature contributed.
function centralDifferenceSpectrum(positive, negative, amplitude) {
  const real = new Float64Array(positive.length);
  const imaginary = new Float64Array(positive.length);
  for (let index = 0; index < positive.length; ++index) {
    real[index] = (positive[index] - negative[index]) / (2 * amplitude);
  }
  fft(real, imaginary);
  return { real, imaginary };
}

// The Power branch reaches its quiescent point through the reservoir, cathode-bias and coupling
// capacitors, so the impulse has to land on the settled circuit rather than on the reset seed. The
// settle is a pure function of the parameters, which do not change across the polarities or the
// small-signal repeat of one key, so it is walked once here and replayed from the snapshot.
function createSettledSession({ params, family, settleSeconds }) {
  const settleFrames = Math.ceil(settleSeconds * family.hostRate / 128) * 128;
  // Measures the amplifier model, so the post-model output-safety reduction is switched off: left
  // on it would attenuate whatever runs past full scale and report that as the model's own
  // behaviour.
  const session = createReferenceSession({
    sampleRate: family.hostRate,
    params: { ...params, ag: false }
  });
  session.reset();
  session.processSilence(settleFrames);
  return { session, settleFrames, settled: session.snapshot() };
}

function capturePolarity(settledSession, amplitude, captureSamples, factor) {
  const { session, settled } = settledSession;
  session.restore(settled);
  session.beginBreakLoopImpulse({ amplitude, captureSamples });
  session.processSilence(captureSamples / factor);
  const result = session.breakLoopImpulse();
  session.endDiagnostic();
  if (!result || result.sample !== captureSamples ||
      result.detectorResponse.length !== captureSamples) {
    throw new Error('Power break-loop capture is incomplete');
  }
  return result;
}

function measurePowerPlant(settledSession, { family, amplitude, captureSamples }) {
  const { session, settleFrames } = settledSession;
  const positive = capturePolarity(
    settledSession, amplitude, captureSamples, family.factor);
  const negative = capturePolarity(
    settledSession, -amplitude, captureSamples, family.factor);
  const checkpoint = session.checkpoint();
  if (checkpoint.finiteFaults > 0 || checkpoint.safetyLimits > 0) {
    throw new Error('Power break-loop capture tripped the fault detector');
  }
  const spectrum = centralDifferenceSpectrum(
    positive.detectorResponse, negative.detectorResponse, amplitude);
  const frequencies = responseFrequencies(family.internalRate);
  return {
    settleFrames,
    detectorResponse: frequencies.map(frequencyHz => {
      const value = interpolateSpectrum(
        spectrum.real, spectrum.imaginary, family.internalRate, frequencyHz);
      return { frequencyHz, real: value.real, imaginary: value.imaginary };
    })
  };
}

function responseAt(response, frequencyHz) {
  let low = 0;
  let high = response.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (response[middle].frequencyHz <= frequencyHz) low = middle; else high = middle;
  }
  const left = response[low];
  const right = response[high];
  const fraction = right.frequencyHz === left.frequencyHz
    ? 0
    : (frequencyHz - left.frequencyHz) / (right.frequencyHz - left.frequencyHz);
  return {
    real: left.real + fraction * (right.real - left.real),
    imaginary: left.imaginary + fraction * (right.imaginary - left.imaginary)
  };
}

// The parameter set one measurement runs at: the plugin defaults of the Power branch with the
// derived supply rail and cathode resistor of the key's circuit profile. The driver stage is set
// exactly as the shipped A0 records were measured (dr = -40 dB, iv = 0.1 Vpk, nf = 0).
function measurementParams(supplyTable, { tp, pt, st, zp, sl }) {
  const circuitProfileId = `power-v1-${pt.toLowerCase()}-${st}-${zp.replace('.', '_')}`;
  const entry = supplyTable.get(circuitProfileId);
  if (!entry) throw new Error(`no supply-table entry for ${circuitProfileId}`);
  return {
    dr: -40, tp, bi: 0, pv: 250, sz: 10, su: 10, og: 0, mx: 100, iv: 0.1, nf: 0,
    os: 'Power', pt, pb: entry.supplyGroundV, kr: entry.cathodeResistorOhm, st, zp, sl
  };
}

function enumerateSweepKeys() {
  const keys = [];
  for (const tp of DRIVER_TUBES) {
    for (const pt of POWER_TUBES) {
      for (const st of SCREEN_TAPS) {
        for (const zp of PRIMARIES) {
          for (const family of RATE_FAMILIES) {
            for (const sl of SPEAKER_LOADS) keys.push({ tp, pt, st, zp, sl, family });
          }
        }
      }
    }
  }
  return keys;
}

// Measure one key and fit its compensator; returns the row in the primary-data format above.
function sweepKey(supplyTable, { tp, pt, st, zp, sl, family }, method) {
  const params = measurementParams(supplyTable, { tp, pt, st, zp, sl });
  const key = [tp, pt, st, zp, sl, family.internalRate].join('|');
  const settledSession = createSettledSession({
    params, family, settleSeconds: method.settleSeconds
  });
  const plant = measurePowerPlant(settledSession, {
    family,
    amplitude: method.stimulusPeakV,
    captureSamples: method.captureSamples
  });
  const small = measurePowerPlant(settledSession, {
    family,
    amplitude: method.stimulusPeakV * method.smallSignalScale,
    captureSamples: method.smallSignalCaptureSamples
  });
  const full1k = responseAt(plant.detectorResponse, 1000);
  const small1k = responseAt(small.detectorResponse, 1000);
  const observedDelta = Math.hypot(full1k.real - small1k.real,
    full1k.imaginary - small1k.imaginary) / Math.hypot(small1k.real, small1k.imaginary);
  if (!(observedDelta < method.maximumRelativeComplexGainDelta)) {
    throw new Error(`small-signal check failed for ${key}: delta ${observedDelta}`);
  }
  const record = {
    // The refinement stage of the anchor search is seeded from this string, so it stays in the
    // format the shipped anchors were derived with; changing it would re-seed the search and move
    // anchors that the plant itself never moved.
    key: `power-v1-${tp}-${pt}-${st}-${zp}-${sl}-${family.internalRate}`,
    internalRate: family.internalRate,
    detectorResponse: plant.detectorResponse,
    outputResponse: plant.detectorResponse
  };
  const fitted = deriveMaxStableCompensator(record);
  if (!fitted.anchor) throw new Error(`no stable compensator for ${key}`);
  const anchor = fitted.anchor;
  return [key, full1k.real, full1k.imaginary, observedDelta,
    plant.settleFrames, method.captureSamples / family.factor,
    anchor.b0, anchor.b1, anchor.a1, anchor.a2, fitted.maximumFeedbackDb,
    anchor.zeroHz, anchor.pole1Hz, anchor.pole2Hz];
}

// Rewrite one marker-delimited primary-data block of this file in place.
function rewriteOwnDataBlock(startMarker, endMarker, body) {
  const source = fs.readFileSync(ownPath, 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < start) throw new Error('primary-data markers are missing');
  fs.writeFileSync(
    ownPath,
    source.slice(0, start) + startMarker + '\n' + body + endMarker + source.slice(end + endMarker.length));
}

// ================================================================================================
// CLI.
// ================================================================================================

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`--${name} requires a value`);
  return value;
}

function runSweep(args) {
  const keyStart = Number(readOption(args, 'key-start', '0'));
  const keyCount = Number(readOption(args, 'key-count', '0'));
  const write = args.includes('--write');
  const sharded = keyStart !== 0 || keyCount !== 0;
  if (write && sharded) {
    throw new Error('--write requires a full unsharded sweep');
  }
  const supplyTable = buildPowerSupplyTable();
  const recorded = new Map(POWER_BREAK_LOOP_ROWS.map(row => [row[0], row]));
  const keys = enumerateSweepKeys();
  const selected = keys.slice(keyStart, keyCount > 0 ? keyStart + keyCount : keys.length);
  const rows = [];
  let moved = 0;
  for (const key of selected) {
    const row = sweepKey(supplyTable, key, POWER_BREAK_LOOP_METHOD);
    rows.push(row);
    const prior = recorded.get(row[0]);
    const drift = prior
      ? Math.hypot(row[1] - prior[1], row[2] - prior[2]) / Math.hypot(prior[1], prior[2])
      : Infinity;
    if (drift !== 0) ++moved;
    process.stdout.write(
      `${row[0]}  gdet0=(${row[1]},${row[2]})  ` +
      `maxNf=${row[10]} dB  zero=${row[11].toFixed(1)} p1=${row[12].toFixed(1)} ` +
      `p2=${row[13].toFixed(1)}  drift=${drift === 0 ? 'none' : drift.toExponential(2)}\n`);
  }
  if (write) {
    rewriteOwnDataBlock(
      '// __TUBE_POWER_BREAK_LOOP_ROWS_START__',
      '// __TUBE_POWER_BREAK_LOOP_ROWS_END__',
      'export const POWER_BREAK_LOOP_ROWS = Object.freeze([\n' +
      rows.map(row => `  ${JSON.stringify(row)}`).join(',\n') + '\n]);\n');
    process.stdout.write(`rewrote ${rows.length} rows in ${path.basename(ownPath)}\n`);
  } else {
    process.stdout.write(`${rows.length} keys measured, ${moved} moved from the recorded table\n`);
    if (moved > 0 && !sharded) process.exitCode = 2;
  }
}

// Standing reservoir current of the phase inverter: the reference is run on silence until the
// reservoir, cathode-bias, screen and coupling capacitors stop moving, and the current the two
// 12AX7 plate loads draw at that fixed point is read off the settled node voltages. The quantity
// is a DC one, so the host rate only decides how many samples a second of settling takes.
function runLtpMeasurement(args) {
  const settleSeconds = Number(readOption(args, 'settle-seconds', '2'));
  const toleranceA = Number(readOption(args, 'tolerance', '1e-6'));
  const write = args.includes('--write');
  const supplyTable = buildPowerSupplyTable();
  const sampleRate = 96000;
  const rows = [];
  const failures = [];
  for (const profile of CIRCUIT_PROFILES) {
    const params = measurementParams(supplyTable, {
      tp: '12AX7', pt: profile.key.pt, st: profile.key.st, zp: profile.key.zp, sl: '8'
    });
    const session = createReferenceSession({ sampleRate, params });
    session.processSilence(Math.ceil(sampleRate * settleSeconds / 128) * 128);
    const state = session.state();
    const power = state.power[0];
    const measuredA = (2 * power.bPlusV - power.ltpPlateAV - power.ltpPlateBV) /
      state.powerProfile.ltpRc.plateResistanceOhm;
    const recordedA = LTP_STANDING_CURRENT_A[profile.circuitProfileId];
    rows.push({ circuitProfileId: profile.circuitProfileId, measuredA });
    const delta = Math.abs(measuredA - recordedA);
    if (delta > toleranceA) {
      failures.push(`${profile.circuitProfileId}: recorded ${recordedA} measured ${measuredA}`);
    }
    process.stdout.write(
      `${profile.circuitProfileId.padEnd(24)} measured=${measuredA.toExponential(10)} A  ` +
      `recorded=${recordedA.toExponential(10)} A  delta=${delta.toExponential(2)} A\n`);
  }
  if (write) {
    rewriteOwnDataBlock(
      '// __TUBE_LTP_STANDING_CURRENT_START__',
      '// __TUBE_LTP_STANDING_CURRENT_END__',
      'export const LTP_STANDING_CURRENT_A = Object.freeze({\n' +
      rows.map(row => `  '${row.circuitProfileId}': ${row.measuredA}`).join(',\n') + '\n});\n');
    process.stdout.write(`rewrote ${rows.length} standing currents in ${path.basename(ownPath)}\n`);
  } else if (failures.length > 0) {
    process.stderr.write(
      `phase-inverter standing current moved beyond ${toleranceA} A:\n${failures.join('\n')}\n`);
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === ownPath;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--sweep')) {
    runSweep(args);
  } else if (args.includes('--ltp')) {
    runLtpMeasurement(args);
  } else {
    const design = verifyDesignInvariants();
    const dc = design.el34NormativeFixture.dc;
    process.stdout.write(
      `${design.circuitProfiles.length} circuit profiles, ` +
      `${design.speakerProfiles.length} speaker profiles, ` +
      `${design.tubeLuts.length} output-tube LUTs, ` +
      `${design.powerA0Records.length} Power A0 records\n` +
      `EL34 normative DC: supply ${dc.supplyGroundV} V, plate ${dc.plateGroundV.toFixed(3)} V, ` +
      `screen ${dc.screenGroundV.toFixed(3)} V, Ia ${(dc.iaA * 1000).toFixed(3)} mA, ` +
      `dissipation ${dc.quiescentPlateDissipationW.toFixed(3)} W\n` +
      'all invariants hold\n');
  }
}
