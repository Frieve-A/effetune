// Tube Simulator circuit-design derivation.
//
// This is the single maintenance tool behind the Tube Simulator Power output stage tables. It
// derives the complete circuit design that scripts/generate-tube-phase-c-tables.mjs turns into
// dsp/plugins/saturation/tube_simulator/phase_c_tables.generated.h and into the JavaScript
// reference tables injected into plugins/saturation/tube_simulator.js. Nothing else feeds those
// artifacts: the primary data below plus the derivation code in this file is the whole provenance.
//
// The derivation has five stages:
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
//      plant response; gdet0 is that response at 1 kHz. All 864 keys (driver tube x output tube x
//      screen tap x primary x speaker load x internal rate family) are measured; none is scaled
//      from another.
//   4. Ladder fit. A two-pole one-zero compensator is searched per key against the measured plant
//      under the Line acceptance envelope and the anchor shaping rules, and the winning anchor is
//      expanded into the 61-knot runtime feedback ladder.
//   5. Output-transformer magnetics. The saturation flux linkage and the coercive current of each
//      transformer family are derived in closed form from the published transformer rating, so
//      the nonlinear core model has its two constants per family without a search.
//
// Stages 1, 2, 5 and 4's ladder expansion run on every invocation from the primary data in this
// file; they are cheap and deterministic. Stage 3 and the anchor search cost about eight and a
// half seconds per key, so a full re-derivation is intentionally a long-running maintenance job.
// Its result - the measured
// break-loop table below - is therefore carried as primary data and re-derived only when the
// amplifier model changes:
//
//   node scripts/derive-tube-circuit-design.mjs                   derive + verify invariants
//   node scripts/derive-tube-circuit-design.mjs --sweep           re-measure + re-fit all keys
//       [--write]                                                 rewrite the measured table below
//   node scripts/derive-tube-circuit-design.mjs --ltp [--write]   re-measure the phase-inverter
//                                                                 standing currents
//   node scripts/derive-tube-circuit-design.mjs --magnetics       report the magnetic constants
//       [--k-sat <margin>]                                        and check the hand-maintained
//                                                                 single-ended transcription
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

// The added Power families deliberately keep four kinds of information separate. Source anchors
// are transcribed published rows, ABI projections map those rows onto the selectable controls,
// OPT anchors are measured transformer data, and model fits are the remaining kernel parameters.
// In particular, the Monolith capacitances and the GEC 22 dB feedback figure are provenance only:
// neither has the same topology as the corresponding runtime coefficient.
export const ADDITIONAL_POWER_TUBE_DESIGNS = Object.freeze({
  '6L6GC': Object.freeze({
    sourceAnchor: Object.freeze({
      url: 'https://frank.pocnet.net/sheets/084/6/6L6GC.pdf',
      location: 'Operating Characteristics, Push-Pull Class AB1, Va=360 V column',
      voltageReference: 'cathode',
      plateCathodeV: 360,
      screenCathodeV: 270,
      gridCathodeV: -22.5,
      plateCurrentA: 0.044,
      screenCurrentA: 0.0025,
      primaryPlateToPlateOhm: 6600,
      outputPowerW: 26.5,
      distortionPercent: 2
    }),
    abiProjection: Object.freeze({
      description: 'Fixed-bias row represented by an individual cathode-resistor DC equivalent',
      canonicalScreenTapPercent: 0,
      canonicalPrimaryKOhm: '6.6',
      cathodeGroundV: 22.5,
      cathodeResistorOhm: 22.5 / (0.044 + 0.0025),
      plateGroundV: 382.5,
      screenGroundV: 292.5,
      fixedScreenPreResistorGroundV: 297.5
    }),
    optAnchor: Object.freeze({
      url: 'https://www.monolithmagnetics.com/sites/default/files/datasheets/' +
        'Push-Pull-output-transformers/' +
        'datasheet%20B-8%206K6%20300B%20push%20pull%20output%20tube%20amplifier%20transformer%20prelim.pdf',
      location: 'B-8/6K6 preliminary datasheet, page 1 specification table',
      measurementLevel: '10 Vrms',
      primaryPlateToPlateOhm: 6600,
      fullPrimaryDcrOhm: 141,
      leakageInductanceH: 0.0102,
      magnetizingInductanceH: 328,
      floatingPrimaryCapacitanceF: 260e-12,
      groundedPrimaryCapacitanceF: 630e-12
    }),
    modelFit: Object.freeze({
      gridCouplingCapacitanceF: 1e-7,
      gridLeakResistanceOhm: 220000,
      gridStopperResistanceOhm: 1500,
      cathodeCapacitanceF: 0.0001,
      screenSeriesResistanceOhm: 1000,
      screenSupplyCapacitanceF: 0.000016,
      powerTheveninResistanceOhm: 60,
      powerSupplyCapacitanceF: 0.000032,
      interwindingCapacitanceF: 7.5e-10,
      coreLossResistanceOhm: 200000,
      resonanceHz: 850,
      nfbTapTurnsRatio: 0.11,
      feedbackDampingCoupling: 0.002
    })
  }),
  KT88: Object.freeze({
    sourceAnchor: Object.freeze({
      url: 'https://keith-snook.info/valve-data/KT88%20GEC%20Data.pdf',
      alternateUrl:
        'https://www.jacmusic.com/techcorner/ARTICLES/English/Portraits/KT88/kt88_spec_sheet.pdf',
      location: 'Issue 5 page 3, Push-Pull Class AB1 Cathode Bias Ultra-Linear, right column',
      voltageReference: 'cathode',
      plateCathodeV: 328,
      screenCathodeV: 328,
      supplyContextV: 375,
      cathodeCurrentA: 0.087,
      cathodeResistorOhm: 400,
      screenTapPercent: 40,
      primaryPlateToPlateOhm: 5000,
      outputPowerW: 30,
      distortionPercent: 1,
      currentSplitSourceLocation: 'Issue 5 page 2, Characteristics, Tetrode Connected',
      currentSplitModelAssumption: 'Use the 140 mA:3 mA typical ratio at the 87 mA source total'
    }),
    abiProjection: Object.freeze({
      description: '40%/5 kOhm source row projected onto the existing 43%/6.0 kOhm ABI choices',
      canonicalScreenTapPercent: 43,
      canonicalPrimaryKOhm: '6.0',
      plateCurrentA: 0.087 * 140 / 143,
      screenCurrentA: 0.087 * 3 / 143,
      cathodeGroundV: 0.087 * 400,
      runtimePlateCathodeTargetV: 328,
      // Uniform-gauge B-8/6K6 winding projection makes the screen approximately 3.24 V above
      // the published equal-voltage source anchor. The source LUT point remains 328 V / 328 V.
      runtimeScreenCathodeExpectation:
        328 + (0.087 * 140 / 143) * 40.185 - (0.087 * 3 / 143) * 100
    }),
    optAnchor: Object.freeze({
      sixK6: Object.freeze({
        url: 'https://www.monolithmagnetics.com/sites/default/files/datasheets/' +
          'Push-Pull-output-transformers/' +
          'datasheet%20B-8%206K6%20300B%20push%20pull%20output%20tube%20amplifier%20transformer%20prelim.pdf',
        location: 'B-8/6K6 preliminary datasheet, page 1 specification table',
        measurementLevel: '10 Vrms',
        primaryPlateToPlateOhm: 6600,
        fullPrimaryDcrOhm: 141,
        leakageInductanceH: 0.0102,
        magnetizingInductanceH: 328,
        floatingPrimaryCapacitanceF: 260e-12,
        groundedPrimaryCapacitanceF: 630e-12
      }),
      eightK: Object.freeze({
        url: 'https://www.monolithmagnetics.com/sites/default/files/B-8_8k_0.pdf',
        location: 'B-8/8k datasheet, page 1 specification table',
        primaryPlateToPlateOhm: 8000,
        fullPrimaryDcrOhm: 141,
        leakageInductanceH: 0.0102,
        magnetizingInductanceH: 220,
        floatingPrimaryCapacitanceF: 260e-12,
        groundedPrimaryCapacitanceF: 630e-12
      }),
      sixKProjection: 'Use the B-8/6K6 small-signal constants unchanged at the 6.0 kOhm ABI point',
      tapSplitProjection: 'Uniform-gauge half-winding: 70.5 ohm multiplied by tap turns fraction'
    }),
    modelFit: Object.freeze({
      circuitUrl: 'https://www.cieri.net/Documenti/Documenti%20audio/' +
        'An%20Approach%20to%20Audio%20Frequency%20Amplifier%20Design%20-%20G.E.C.%20%281957%29.pdf',
      circuitLocation: 'Chapter 5 section 5-2, printed pages 53-54, Fig. 5-2 and component list',
      gridCouplingCapacitanceF: 0.5e-6,
      gridLeakResistanceOhm: 220000,
      gridStopperResistanceOhm: 10000,
      cathodeCapacitanceF: 50e-6,
      screenSeriesResistanceOhm: 100,
      sourceFeedbackDbMetadataOnly: 22,
      screenSupplyCapacitanceF: 0.000016,
      powerTheveninResistanceOhm: 50,
      powerSupplyCapacitanceF: 0.000032,
      interwindingCapacitanceF: 9e-10,
      coreLossResistanceOhm: 160000,
      resonanceHz: 800,
      nfbTapTurnsRatio: 0.12,
      feedbackDampingCoupling: 0.002
    })
  })
});

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
    fixedScreenGroundV: 300,
    fixedScreenSupplyDropV: 20,
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
    fixedScreenGroundV: 425,
    fixedScreenSupplyDropV: 20,
    presetProfileId: 'power-v1-el34-43-6_6',
    controlVoltageMaxV: 90,
    plateCathodeMaxV: 900,
    screenCathodeMaxV: 600
  }),
  '6L6GC': Object.freeze({
    // RCA/Svetlana characteristic point: Class A tetrode connection.
    typicalGridCathodeV: -18,
    typicalPlateCathodeV: 350,
    typicalScreenCathodeV: 250,
    typicalPlateCurrentA: 0.054,
    typicalScreenCurrentA: 0.0025,
    typicalMutualConductanceS: 0.0052,
    typicalPlateResistanceOhm: 33000,
    kneePlateCathodeV: 40,
    kneeScreenCathodeV: 250,
    // Ei-RC fixed-bias AB1 row, projected to an individual cathode-resistor DC equivalent.
    presetPlateCurrentA: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].sourceAnchor.plateCurrentA,
    presetScreenCurrentA: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].sourceAnchor.screenCurrentA,
    presetCathodeResistorOhm:
      ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].abiProjection.cathodeResistorOhm,
    presetPlateCathodeV: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].sourceAnchor.plateCathodeV,
    presetScreenCathodeV: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].sourceAnchor.screenCathodeV,
    fixedScreenGroundV: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].abiProjection.screenGroundV,
    presetProfileId: 'power-v1-6l6gc-0-6_6',
    controlVoltageMaxV: 80,
    plateCathodeMaxV: 900,
    screenCathodeMaxV: 600
  }),
  KT88: Object.freeze({
    // GEC KT88 characteristic point at 250 V plate and screen.
    typicalGridCathodeV: -15,
    typicalPlateCathodeV: 250,
    typicalScreenCathodeV: 250,
    typicalPlateCurrentA: 0.140,
    typicalScreenCurrentA: 0.003,
    typicalMutualConductanceS: 0.0115,
    typicalPlateResistanceOhm: 12000,
    kneePlateCathodeV: 40,
    kneeScreenCathodeV: 250,
    // GEC 40%/5 kOhm cathode-bias row, projected onto the nearest ABI tap and primary choices.
    presetPlateCurrentA: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.abiProjection.plateCurrentA,
    presetScreenCurrentA: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.abiProjection.screenCurrentA,
    presetCathodeResistorOhm: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.sourceAnchor.cathodeResistorOhm,
    presetPlateCathodeV: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.sourceAnchor.plateCathodeV,
    presetScreenCathodeV: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.sourceAnchor.screenCathodeV,
    presetScreenSeriesResistanceOhm:
      ADDITIONAL_POWER_TUBE_DESIGNS.KT88.modelFit.screenSeriesResistanceOhm,
    fixedScreenGroundV: 300,
    fixedScreenSupplyDropV: 20,
    presetProfileId: 'power-v1-kt88-43-6_0',
    controlVoltageMaxV: 120,
    plateCathodeMaxV: 950,
    screenCathodeMaxV: 650
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
// The thirty-six Power circuit profiles (output tube x screen tap x primary impedance) and the four
// selectable loudspeaker networks. These are the frozen component values of the amplifier being
// simulated - resistors, capacitors, the output transformer parasitics and the feedback winding -
// chosen during the design phases and carried here as data, exactly as a schematic carries them.
// ================================================================================================
const ADDITIONAL_POWER_PROFILE_FAMILIES = Object.freeze(
  Object.entries(ADDITIONAL_POWER_TUBE_DESIGNS).map(([tube, design]) =>
    Object.freeze({ tube, ...design.modelFit })));

const ADDITIONAL_POWER_TAPS = Object.freeze([
  Object.freeze({ key: '0', turnsRatio: 0 }),
  Object.freeze({ key: '20', turnsRatio: 0.2 }),
  Object.freeze({ key: '43', turnsRatio: 0.43 })
]);

function buildAdditionalPowerProfiles(family) {
  return ADDITIONAL_POWER_TAPS.flatMap(tap =>
    ['6.0', '6.6', '8.0'].map(primary => {
      const halfPrimaryDcrOhm = 0.5 *
        ADDITIONAL_POWER_TUBE_DESIGNS.KT88.optAnchor.sixK6.fullPrimaryDcrOhm;
      const optAnchor = primary === '8.0'
        ? ADDITIONAL_POWER_TUBE_DESIGNS.KT88.optAnchor.eightK
        : ADDITIONAL_POWER_TUBE_DESIGNS.KT88.optAnchor.sixK6;
      return {
        circuitProfileId:
          `power-v1-${family.tube.toLowerCase()}-${tap.key}-${primary.replace('.', '_')}`,
        key: { pt: family.tube, st: tap.key, zp: primary },
        ltpRc: {
          tube: '12AX7',
          plateResistanceOhm: 100000,
          tailResistanceOhm: 47000,
          inputCouplingCapacitanceF: 1e-7,
          gridLeakResistanceOhm: 1000000,
          tailSupplyV: -100,
          preVolumeResistanceOhm: 1000000,
          preVolumeWiperPosition: 0.024
        },
        gridRc: {
          couplingCapacitanceF: family.gridCouplingCapacitanceF,
          gridLeakResistanceOhm: family.gridLeakResistanceOhm,
          gridStopperResistanceOhm: family.gridStopperResistanceOhm
        },
        cathodeRc: { capacitanceF: family.cathodeCapacitanceF },
        screenSupplyRc: {
          seriesResistanceOhm: family.screenSeriesResistanceOhm,
          capacitanceF: 0.000016
        },
        powerSupplyRc: {
          theveninResistanceOhm: family.powerTheveninResistanceOhm,
          capacitanceF: 0.000032
        },
        outputTubeLutId: `${family.tube.toLowerCase()}-ia-ig2-lut-v2`,
        optCoefficients: {
          order: 2,
          primaryCenterToTapResistanceOhm: halfPrimaryDcrOhm * tap.turnsRatio,
          primaryTapToPlateResistanceOhm: halfPrimaryDcrOhm * (1 - tap.turnsRatio),
          magnetizingInductanceH: optAnchor.magnetizingInductanceH,
          leakageInductanceH: optAnchor.leakageInductanceH,
          interwindingCapacitanceF: family.interwindingCapacitanceF,
          coreLossResistanceOhm: family.coreLossResistanceOhm,
          resonanceHz: family.resonanceHz,
          dampingRatio: tap.key === '0' ? 0.26 : 0.23,
          feedbackDampingCoupling: 0.002
        },
        nfbTapNode: 'fixed-secondary-feedback-winding',
        nfbTapTurnsRatio: family.nfbTapTurnsRatio,
        nfbPolarity: 1,
        screenTapTurnsRatio: tap.turnsRatio,
        sentinelProfile: false
      };
    })
  );
}

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
    },
    ...ADDITIONAL_POWER_PROFILE_FAMILIES.flatMap(buildAdditionalPowerProfiles)
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
  'power-v1-el84-0-6_0': 0.002163331519049361,
  'power-v1-el84-0-6_6': 0.0021633315628430583,
  'power-v1-el84-0-8_0': 0.0021633316578475556,
  'power-v1-el84-20-6_0': 0.002163331531007325,
  'power-v1-el84-20-6_6': 0.0021633315366800664,
  'power-v1-el84-20-8_0': 0.0021633316164288144,
  'power-v1-el84-43-6_0': 0.0021633316063486814,
  'power-v1-el84-43-6_6': 0.002163331629809604,
  'power-v1-el84-43-8_0': 0.0021633316137329847,
  'power-v1-el34-0-6_0': 0.002186619387291694,
  'power-v1-el34-0-6_6': 0.002186644255130474,
  'power-v1-el34-0-8_0': 0.0021866982365622606,
  'power-v1-el34-20-6_0': 0.0021866472601277803,
  'power-v1-el34-20-6_6': 0.0021866735735618084,
  'power-v1-el34-20-8_0': 0.0021867302841594776,
  'power-v1-el34-43-6_0': 0.002186663153626634,
  'power-v1-el34-43-6_6': 0.0021866901338867656,
  'power-v1-el34-43-8_0': 0.002186748424548785,
  'power-v1-6l6gc-0-6_0': 0.0021799004099704302,
  'power-v1-6l6gc-0-6_6': 0.00217990043317635,
  'power-v1-6l6gc-0-8_0': 0.0021799004835194574,
  'power-v1-6l6gc-20-6_0': 0.0021799005848642606,
  'power-v1-6l6gc-20-6_6': 0.0021799005748313277,
  'power-v1-6l6gc-20-8_0': 0.0021799005873536863,
  'power-v1-6l6gc-43-6_0': 0.0021799005941955715,
  'power-v1-6l6gc-43-6_6': 0.0021799005780740346,
  'power-v1-6l6gc-43-8_0': 0.0021799004079984196,
  'power-v1-kt88-0-6_0': 0.0021794322068289396,
  'power-v1-kt88-0-6_6': 0.002179460207442414,
  'power-v1-kt88-0-8_0': 0.0021795208420978484,
  'power-v1-kt88-20-6_0': 0.0021794743506848464,
  'power-v1-kt88-20-6_6': 0.002179504265520546,
  'power-v1-kt88-20-8_0': 0.002179569183177315,
  'power-v1-kt88-43-6_0': 0.002179490052650192,
  'power-v1-kt88-43-6_6': 0.0021797972465504903,
  'power-v1-kt88-43-8_0': 0.0021814915993892646
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
// reference tables and the DSP parity goldens are generated from exactly these rows. Rewriting the
// rows is therefore never done in isolation: a re-sweep, table regeneration and golden promotion
// land together.
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
  ["12AX7|EL84|0|6.0|4|352800",228.61008062323538,9.360402890290604,2.0315492559190696e-7,44160,65536,0.09106584441917089,-0.09086281064275105,-1.9645482165974153,0.9647512503738352,6,125.32741086623943,404.7239454742835,1610.2129390711355],
  ["12AX7|EL84|0|6.0|8|352800",323.35913293309824,13.301876699933521,2.0358608917603882e-7,44160,65536,0.09076851415737153,-0.09059203687901606,-1.973210468449191,0.9733869457275464,6,109.2760055710362,659.6565903690295,854.9069680048295],
  ["12AX7|EL84|0|6.0|15|352800",442.82942480824704,18.25914251111656,2.0367677520700591e-7,44160,65536,0.09062782581386082,-0.09056522241014116,-1.9772677850368465,0.9773303884405663,6,38.800304694840584,180.3137891565353,1107.2316672406835],
  ["12AX7|EL84|0|6.0|16|352800",457.34454424815004,18.85168436514381,2.036122699419576e-7,44160,65536,0.08901079707598844,-0.08894860909840827,-1.9600640510010594,0.9601262389786396,6,39.24318130705065,91.21455360207668,2193.5517218296623],
  ["12AX7|EL84|0|6.0|4|384000",229.24110913943036,8.886795336587763,3.9216297143263506e-7,48000,65536,0.08421823088884388,-0.08418267510870928,-1.972280187823972,0.9723157436041066,6,25.80757192913801,82.4553536655123,1633.343199272813],
  ["12AX7|EL84|0|6.0|8|384000",324.251927411983,12.632013011582863,3.935963068271895e-7,48000,65536,0.08302525295137891,-0.08290247782820068,-1.9629209998549486,0.9630437749781269,6,90.44255769975715,225.0449937726108,2076.3453433656246],
  ["12AX7|EL84|0|6.0|15|384000",444.0522242768297,17.341775181681598,3.941305424837084e-7,48000,65536,0.08227934504071595,-0.08202128607216272,-1.9653070651886244,0.9655651241571775,6,191.98240781862825,663.7095827079053,1477.8830899694356],
  ["12AX7|EL84|0|6.0|16|384000",458.60740475871614,17.904250893908806,3.940103120986212e-7,48000,65536,0.08217934108044399,-0.08170127028294967,-1.956265469327053,0.9567435401245472,6,356.57198952627715,1330.8706878809594,1371.65093163954],
  ["12AX7|EL84|0|6.6|4|352800",238.16321177040305,9.79800116791127,1.9868667555078659e-7,44160,65536,0.08900444666327954,-0.08870708022201594,-1.9645670287930126,0.9648643952342763,6,187.91241163240127,771.9269937461725,1236.425088754266],
  ["12AX7|EL84|0|6.6|8|352800",336.8716136638585,13.923431526403926,2.0067229518864307e-7,44160,65536,0.08803062152104829,-0.08794564728903569,-1.9664838720235824,0.9665688462555949,6,54.226538243506035,155.3635160602986,1753.8862876781304],
  ["12AX7|EL84|0|6.6|15|352800",461.33430291970194,19.11212434128487,2.0105944699539382e-7,44160,65536,0.0914736702575168,-0.09131200930708867,-1.9736786376927133,0.9738402986431416,6,99.32115860038994,550.8985079046154,937.5194580087618],
  ["12AX7|EL84|0|6.6|16|352800",476.4559788499508,19.73237623889115,2.0006075240634093e-7,44160,65536,0.09002021969865129,-0.08988920063149629,-1.9760768435809488,0.9762078626481038,6,81.78231111063825,478.6787632123731,873.3954295927628],
  ["12AX7|EL84|0|6.6|4|384000",238.81699553162363,9.307253055205262,3.876428350839135e-7,48000,65536,0.0816353096475607,-0.08159494159891893,-1.9754685096334144,0.9755088776820561,6,30.228630213248113,108.50426508415573,1406.9167461505876],
  ["12AX7|EL84|0|6.6|8|384000",337.7966034732777,13.229323836391695,3.88677543861414e-7,48000,65536,0.03420004468329998,-0.004236967041808807,-1.6535213663229604,0.6834844439644516,6,127632.33865142797,11112.475650059496,12145.111659386188],
  ["12AX7|EL84|0|6.6|15|384000",462.6011982243566,18.161554612326906,3.891455265908483e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AX7|EL84|0|6.6|16|384000",477.764379829378,18.750652326750703,3.8933354911114874e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AX7|EL84|0|8.0|4|352800",258.1155930526206,10.678117750460437,1.937360254073178e-7,44160,65536,0.08932635874451385,-0.08914670788239311,-1.9710486726544416,0.9712283235165624,6,113.04086447698927,508.09695766931213,1131.1250821106858],
  ["12AX7|EL84|0|8.0|8|352800",365.0933823856005,15.173729469267899,1.957158115446485e-7,44160,65536,0.08992831902000697,-0.08989426380504151,-1.9770702953184722,0.9771043505334377,6,21.267581401542706,89.70564147209043,1210.8277111492007],
  ["12AX7|EL84|0|8.0|15|352800",499.9830513219064,20.828089945847893,1.9495996745765884e-7,44160,65536,0.09496284871133766,-0.09489463732852434,-1.9761941907651819,0.9762624021479953,6,40.346684322427954,187.3795807364096,1161.5576777416434],
  ["12AX7|EL84|0|8.0|16|352800",516.3715624801871,21.504067883664685,1.9621053238775859e-7,44160,65536,0.0889793237253196,-0.08893209804989036,-1.971769916823554,0.9718171424989833,6,29.809388119511297,100.36543065421826,1504.825386152945],
  ["12AX7|EL84|0|8.0|4|384000",258.81511241215986,10.152467144501822,3.834915351067096e-7,48000,65536,0.08182535221243627,-0.08169140882863912,-1.9578920027018578,0.958025946085655,6,100.12451816067993,212.21208240095226,2408.4460110678347],
  ["12AX7|EL84|0|8.0|8|384000",366.08308152389867,14.430254192723726,3.8384237019038357e-7,48000,65536,0.08117728435092253,-0.08101996359023242,-1.9713183243981158,0.9714756451588059,6,118.55613822835231,453.21114208957914,1315.4151355428367],
  ["12AX7|EL84|0|8.0|15|384000",501.3385756135237,19.809910152877553,3.8364024185168664e-7,48000,65536,0.08240952825181315,-0.08213665195973965,-1.9639621234178486,0.9642349997099221,6,202.70280099220204,664.9541469198703,1560.886868432541],
  ["12AX7|EL84|0|8.0|16|384000",517.7714959783855,20.452518365542407,3.837737101634555e-7,48000,65536,0.08098391242427597,-0.08090202034512534,-1.9641136896352693,0.96419558171442,6,61.83212528600117,149.8635458726729,2078.475926468154],
  ["12AX7|EL84|20|6.0|4|352800",169.16991810475074,5.492875503089632,1.859691028781943e-7,44160,65536,0.09062886110336568,-0.09038044399020354,-1.9651297597323876,0.9653781768455497,6,154.12020780095415,563.2382699567997,1415.222472815008],
  ["12AX7|EL84|20|6.0|8|352800",239.28396601727377,7.815291928433686,1.8536167880990356e-7,44160,65536,0.08831219700940648,-0.08807631577515501,-1.9676625016968785,0.9678983829311301,6,150.17652670640155,627.5617316388714,1204.5057719397066],
  ["12AX7|EL84|20|6.0|15|352800",327.6915870301131,10.73434409908469,1.8747383398912127e-7,44160,65536,0.08831504751251598,-0.08817568166723645,-1.9763702281173443,0.9765095939626237,6,88.67746097258306,640.367261519168,694.3545259709742],
  ["12AX7|EL84|20|6.0|16|352800",338.4326664261847,11.081787966798224,1.8567882967122413e-7,44160,65536,0.09300492267692528,-0.09294832723043356,-1.9751460042762403,0.975202599722732,6,34.17877040456675,142.5684086369837,1267.3566387656901],
  ["12AX7|EL84|20|6.0|4|384000",169.53389055883318,5.2232009202004495,3.6670826895102683e-7,48000,65536,0.08476144383204906,-0.08465346255973628,-1.9743968283866171,0.9745048096589299,6,77.90731385078571,326.3096348732446,1252.0484964735683],
  ["12AX7|EL84|20|6.0|8|384000",239.7989370434961,7.433846398757089,3.6848139326121935e-7,48000,65536,0.08888412714459573,-0.08872755592374584,-1.9704760936446966,0.9706326648655463,6,107.75113969032066,424.9868735067164,1396.6942863075433],
  ["12AX7|EL84|20|6.0|15|384000",328.39691499008023,10.211939803021885,3.707141767838378e-7,48000,65536,0.08202113520293912,-0.08189559981866683,-1.9775743789941453,0.9776999143784176,6,93.61044244651622,662.0889327938124,716.217852999654],
  ["12AX7|EL84|20|6.0|16|384000",339.1611012371489,10.54226542729985,3.6984356936331965e-7,48000,65536,0.08114774834428222,-0.08112066295429304,-1.9743967503772795,0.9744238357672688,6,20.402456692929256,67.6087371515883,1515.8278353585276],
  ["12AX7|EL84|20|6.6|4|352800",172.640351860732,5.570952329505276,1.8404092498896855e-7,44160,65536,0.09695469579603674,-0.09687397941965215,-1.9657463812213454,0.96582709759773,6,46.765152857592554,143.11818736989824,1809.2377803843078],
  ["12AX7|EL84|20|6.6|8|352800",244.19276284375425,7.926668562416305,1.8368421143117645e-7,44160,65536,0.10172510230419676,-0.10167984620839832,-1.9695792890935515,0.9696245451893499,6,24.985858812909946,88.14309549960656,1643.8752162530272],
  ["12AX7|EL84|20|6.6|15|352800",334.4140306282835,10.887517896654012,1.8394512928950087e-7,44160,65536,0.08867373404889912,-0.08859858405119614,-1.963291018633963,0.9633661686316659,6,47.60655744586948,122.32606633272952,1973.2824245744748],
  ["12AX7|EL84|20|6.6|16|352800",345.3754574688426,11.239892061747284,1.8494233007986885e-7,44160,65536,0.09852118467616859,-0.09846697793788523,-1.9746149007839953,0.9746691075222786,6,30.90237519601848,132.3095437171295,1308.341130500401],
  ["12AX7|EL84|20|6.6|4|384000",173.00435329853772,5.300059870013859,3.6306455710356135e-7,48000,65536,0.08239818383092243,-0.08208143411281797,-1.9601315706136524,0.9604483203317569,6,235.38893125712107,673.2252489869641,1793.096984973906],
  ["12AX7|EL84|20|6.6|8|384000",244.70777638488144,7.543498332763219,3.6509308244110353e-7,48000,65536,0.08548843393057654,-0.08532080698864132,-1.9716106419624821,0.9717782689044173,6,119.95378344821899,514.033123143439,1235.558070108183],
  ["12AX7|EL84|20|6.6|15|384000",335.1194178791748,10.362749948909485,3.654352935625887e-7,48000,65536,0.0856364260521629,-0.08556229509099565,-1.9776770877188317,0.977751218679999,6,52.92739189613493,248.5628693745309,1126.5369961375168],
  ["12AX7|EL84|20|6.6|16|384000",346.10395333139394,10.69792872698167,3.6482960983839843e-7,48000,65536,0.08658231037744273,-0.08644566233136329,-1.9721876102619864,0.9723242583080659,6,96.53138752640338,390.79596131741187,1324.467397061985],
  ["12AX7|EL84|20|8.0|4|352800",178.7989890364865,5.67227382184022,1.8030272354855704e-7,44160,65536,0.09222606074942535,-0.09214675961280455,-1.966576112391608,0.9666554135282286,6,48.301569569923934,144.50412756829752,1759.7170401417964],
  ["12AX7|EL84|20|8.0|8|352800",252.90393098154567,8.071651788991032,1.8017571209687765e-7,44160,65536,0.09708640237574646,-0.09700972277230238,-1.9724165951880566,0.9724932747915005,6,44.36512598847061,176.39580424851843,1389.742876221355],
  ["12AX7|EL84|20|8.0|15|352800",346.34370977810465,11.087215840087463,1.811223405880493e-7,44160,65536,0.09059982992601454,-0.09031789085082598,-1.9626645006027543,0.9629464396779429,6,175.00611276522,593.268831598313,1526.8089213666972],
  ["12AX7|EL84|20|8.0|16|352800",357.69616520239333,11.445975464463482,1.79746957005083e-7,44160,65536,0.08934457202174585,-0.08927511833948162,-1.9773606727218795,0.9774301264041436,6,43.66612658134798,205.84630517480485,1075.9692696894663],
  ["12AX7|EL84|20|8.0|4|384000",179.1595357237725,5.400472994391393,3.597436911097749e-7,48000,65536,0.08247900723130916,-0.08243460516756343,-1.9790521695404655,0.9790965716042113,6,32.91000992201408,146.42599770573372,1144.6387910773021],
  ["12AX7|EL84|20|8.0|8|384000",253.41406110777982,7.687192204527285,3.584199304250469e-7,48000,65536,0.08412104103513633,-0.08403645146256745,-1.9622447883704055,0.9623293779429742,6,61.48681482921168,146.36482340428896,2200.3785224384583],
  ["12AX7|EL84|20|8.0|15|384000",347.0424106759997,10.560678194605723,3.5886014997105973e-7,48000,65536,0.08526715557209867,-0.08493238414040091,-1.9595969314422914,0.9599317028739892,6,240.4207347845575,715.4462636461624,1783.7583515759034],
  ["12AX7|EL84|20|8.0|16|384000",358.41775543762,10.902184937937072,3.5869697168877006e-7,48000,65536,0.08596771808336288,-0.08583724510830247,-1.969812592264889,0.9699430652399494,6,92.82528572360215,320.303843694904,1544.8131127860245],
  ["12AX7|EL84|43|6.0|4|352800",135.2873502223427,3.73600684180464,1.7855673511837025e-7,44160,65536,0.09116535380891776,-0.09096848027478778,-1.9695355287136929,0.9697324022478229,6,121.38795092484627,524.8471181111911,1200.9256603778322],
  ["12AX7|EL84|43|6.0|8|352800",191.35863022175965,5.321085194636105,1.8051198626781882e-7,44160,65536,0.10803016483780878,-0.1077926150187118,-1.9670555780394579,0.9672931278585549,6,123.60507461202629,601.7603708475051,1265.4302622842422],
  ["12AX7|EL84|43|6.0|15|352800",262.0595251956287,7.312284905674363,1.7804062669038465e-7,44160,65536,0.0895376876364845,-0.08947089792668274,-1.9768908896110455,0.9769576793208473,6,41.90003824719903,190.47107758486064,1118.4914533511312],
  ["12AX7|EL84|43|6.0|16|352800",270.6492988825913,7.5484436209803905,1.791385749820474e-7,44160,65536,0.0965056871402557,-0.0964400985529168,-1.9730818328280786,0.9731474214154177,6,38.17435434096798,152.33197771730548,1376.0502502132138],
  ["12AX7|EL84|43|6.0|4|384000",135.53107968932449,3.5590365707571903,3.542760249281063e-7,48000,65536,0.08120763728033754,-0.08097941695209404,-1.9640872493036121,0.9643154696318555,6,171.99656680049952,506.30257146938305,1714.4382824448232],
  ["12AX7|EL84|43|6.0|8|384000",191.70348168086426,5.070753774131399,3.5818308863528157e-7,48000,65536,0.08575918611001986,-0.08572295493389578,-1.9722204004833455,0.9722566316594695,6,25.82527132858633,83.90791430921432,1635.6062688520033],
  ["12AX7|EL84|43|6.0|15|384000",262.53185364676295,6.9694340025931165,3.5793508991056774e-7,48000,65536,0.08138315026750588,-0.08125290945189656,-1.977165657880616,0.9772958986962252,6,97.88399989927109,681.1885139843528,722.3782952453558],
  ["12AX7|EL84|43|6.0|16|384000",271.1371005123286,7.194359995202764,3.575187637653769e-7,48000,65536,0.08410755757533557,-0.0840786994932251,-1.9779228823794113,0.9779517404615217,6,20.972891742814397,85.33635619028294,1277.2309429084446],
  ["12AX7|EL84|43|6.6|4|352800",136.02725561734925,3.712639865610406,1.730370535406471e-7,44160,65536,0.0892228870231092,-0.0891645132938036,-1.9771964095554484,0.9772547832847539,6,36.747854033913555,165.23980777995487,1126.649505589334],
  ["12AX7|EL84|43|6.6|8|352800",192.40520910994383,5.288233691169867,1.770307159328209e-7,44160,65536,0.0906294635664459,-0.09052893380020623,-1.9650976889031204,0.9651982186693602,6,62.318207226655026,178.15619672450597,1810.7725359777507],
  ["12AX7|EL84|43|6.6|15|352800",263.4927896323615,7.267433594383124,1.7616850580389234e-7,44160,65536,0.08917477684000845,-0.08902781375433452,-1.9757332002414132,0.9758801633270872,6,92.61323424686464,656.687026087622,714.2390547581035],
  ["12AX7|EL84|43|6.6|16|352800",272.12954167693835,7.502102866209684,1.7656952424515902e-7,44160,65536,0.09781292626280383,-0.09777518966212387,-1.972769029445152,0.972806766045832,6,21.667011917996575,82.29546134310574,1465.7457626372209],
  ["12AX7|EL84|43|6.6|4|384000",136.26534602171452,3.538280000964018,3.515904701194942e-7,48000,65536,0.08193851528138267,-0.08167560308370836,-1.9615323230144965,0.9617952352121708,6,196.4136581903642,545.6468303102838,1835.0282054970046],
  ["12AX7|EL84|43|6.6|8|384000",192.742083875148,5.04159267730614,3.551093132954485e-7,48000,65536,0.0830363218573152,-0.08299660348714125,-1.9769535664663007,0.9769932848364746,6,29.24008018345923,114.76872150370632,1307.7250685316947],
  ["12AX7|EL84|43|6.6|15|384000",263.9541939486175,6.929635084226945,3.542529278001545e-7,48000,65536,0.08190295138294981,-0.08183552370420134,-1.9739944758834957,0.9740619035622442,6,50.33485753881586,178.7728680878391,1427.368173655533],
  ["12AX7|EL84|43|6.6|16|384000",272.6060610362147,7.15323756461931,3.546795031498082e-7,48000,65536,0.08107475102431885,-0.08103316137630939,-1.964686095604712,0.9647276852527216,6,31.359013560720967,74.59727772374735,2120.0241362670995],
  ["12AX7|EL84|43|8.0|4|352800",136.59206240011036,3.6307594012972992,1.7059204502381221e-7,44160,65536,0.10452134217072252,-0.1044467896953359,-1.9679301055937675,0.9680046580691541,6,40.06459251265714,141.85691140627466,1684.0456816183646],
  ["12AX7|EL84|43|8.0|8|352800",193.20413239541406,5.172569257857175,1.7292837067104842e-7,44160,65536,0.09810392360082835,-0.0978730040704156,-1.969102597657244,0.9693335171876568,6,132.3227827330866,715.7425779356795,1033.1313668835976],
  ["12AX7|EL84|43|8.0|15|352800",264.58690782199915,7.109139753188531,1.721572160698853e-7,44160,65536,0.08888457486211689,-0.0887730101760064,-1.968564388623041,0.9686759533091516,6,70.52153462299906,229.44814694116536,1557.5289385258525],
  ["12AX7|EL84|43|8.0|16|352800",273.25952018895987,7.33860589167301,1.7025461523872294e-7,44160,65536,0.11046191640385211,-0.11031667564914997,-1.9660222395509321,0.9661674803056342,6,73.87717906164058,282.2823805704568,1650.2883940503418],
  ["12AX7|EL84|43|8.0|4|384000",136.81688453124195,3.462162210189097,3.471957973758993e-7,48000,65536,0.08678634781343371,-0.0867149915971098,-1.9710295158577154,0.9711008720740392,6,50.27017044635522,166.34319519340227,1625.8645927153927],
  ["12AX7|EL84|43|8.0|8|384000",193.52223826753635,4.934075361170708,3.458196543287639e-7,48000,65536,0.08686669442014322,-0.08681669863662474,-1.9724667782408687,0.9725167740243872,6,35.18491026245423,119.57275574550607,1583.5912137923517],
  ["12AX7|EL84|43|8.0|15|384000",265.0226075299777,6.7824956308357685,3.4581317142728944e-7,48000,65536,0.0853213018287839,-0.08524152021549183,-1.9779190674205176,0.9779988490338096,6,57.17416417605677,278.78513030251935,1080.8382663495863],
  ["12AX7|EL84|43|8.0|16|384000",273.709492672513,7.001260977243166,3.4595169196317423e-7,48000,65536,0.08180508376808629,-0.08160216118276133,-1.9711164448521492,0.9713193674374743,6,151.78912374642826,741.930150672127,1036.528343686379],
  ["12AX7|EL34|0|6.0|4|352800",208.9493480778098,4.4505177691785605,1.7759636958864739e-7,44160,65536,0.09153405461311324,-0.09138560465932268,-1.9721702298552077,0.9723186798089983,6,91.13778768041712,405.3862172004365,1170.8341418731297],
  ["12AX7|EL34|0|6.0|8|352800",295.5509830151652,6.351678633313196,1.7802310203496335e-7,44160,65536,0.0906163670804294,-0.09053720084266213,-1.977281682088239,0.9773608483260063,6,49.07630373341383,241.83510405725792,1043.9603895933838],
  ["12AX7|EL34|0|6.0|15|352800",404.7478665892862,8.737379671188354,1.798699377349515e-7,44160,65536,0.0913097397935134,-0.09116925147781403,-1.9711064036722328,0.9712468919879321,6,86.4581869163475,348.4872478019937,1289.661298599694],
  ["12AX7|EL34|0|6.0|16|352800",418.01463702209355,9.018332860417791,1.7947667921949595e-7,44160,65536,0.0940569884595319,-0.09394586249684879,-1.9667819005660347,0.9668930265287179,6,66.37887008511727,212.31910084858453,1678.1015978021073],
  ["12AX7|EL34|0|6.0|4|384000",209.25685611309635,4.2239963027089145,3.6739860089592657e-7,48000,65536,0.08732686847589864,-0.08728513962030986,-1.977685098814753,0.9777268276703416,6,29.210818577488354,126.04043235214483,1250.584041128156],
  ["12AX7|EL34|0|6.0|8|384000",295.98609052880676,6.03123251637738,3.6712330702032117e-7,48000,65536,0.09652857595188945,-0.0963731219380784,-1.975063733522012,0.9752191875358229,6,98.50251867812963,765.6576299098906,767.9151248110123],
  ["12AX7|EL34|0|6.0|15|384000",405.34382358997374,8.298479659558236,3.677518784818173e-7,48000,65536,0.0834299685779945,-0.08331796926908484,-1.9696795301793668,0.9697915294882766,6,82.09870147569269,263.67784318678736,1610.9880309601122],
  ["12AX7|EL34|0|6.0|16|384000",418.6301160903452,8.565056495934652,3.6785517338085383e-7,48000,65536,0.10167131431604222,-0.10149220471993621,-1.970562354059759,0.9707414636558649,6,107.75925793025095,527.3923622587128,1287.43870907707],
  ["12AX7|EL34|0|6.6|4|352800",215.83085935591964,4.6716223787310485,1.7671131702456e-7,44160,65536,0.0894778870152966,-0.08939466228363965,-1.9721695117627942,0.9722527364944511,6,52.25013802368189,191.66649666645947,1388.3621135300175],
  ["12AX7|EL34|0|6.6|8|352800",305.2846014280481,6.6662867499308955,1.790250062790139e-7,44160,65536,0.10248204582149681,-0.10243069941718198,-1.9660309042657476,0.9660822506700623,6,28.139720369149188,89.10030056626817,1848.423904624029],
  ["12AX7|EL34|0|6.6|15|352800",418.07773987360235,9.169508898337462,1.7990910332370622e-7,44160,65536,0.0958411591378572,-0.09568466603632186,-1.9729817754746042,0.9731382685761395,6,91.75857410958494,474.20577062434563,1054.7045716345285],
  ["12AX7|EL34|0|6.6|16|352800",431.7814369881973,9.464447065709924,1.7995867106977198e-7,44160,65536,0.09836031586785973,-0.09822873954440046,-1.9742993558144866,0.9744309321379458,6,75.16180130556451,397.69403303684976,1056.6794006229802],
  ["12AX7|EL34|0|6.6|4|384000",216.1455987703916,4.439531532557575,3.6643080329431926e-7,48000,65536,0.08726311529428168,-0.08721883399342645,-1.9778311773768391,0.9778754586776942,6,31.02067382359001,135.809660758776,1231.5249298701976],
  ["12AX7|EL34|0|6.6|8|384000",305.72994169537986,6.337961179151574,3.6663700814078207e-7,48000,65536,0.08189691958819544,-0.0817713284300099,-1.9775476244329762,0.9776732155911617,6,93.79421842508998,649.1686742163117,730.8070612606402],
  ["12AX7|EL34|0|6.6|15|384000",418.6877131278742,8.719815706119714,3.6574707414456875e-7,48000,65536,0.09058334167266552,-0.09042769947683701,-1.9748152036992828,0.9749708458951114,6,105.10024819072741,668.6888495669665,880.4490787059121],
  ["12AX7|EL34|0|6.6|16|384000",432.4113913983723,9.000024352190096,3.661631339108071e-7,48000,65536,0.08802958903836897,-0.08782832847160144,-1.9687471678155226,0.9689484283822901,6,139.88730606695225,557.1397320297192,1370.68081829726],
  ["12AX7|EL34|0|8.0|4|352800",229.49449727313666,5.084688252173459,1.663688286705381e-7,44160,65536,0.08906712574877376,-0.08901513848551111,-1.9769846201087833,0.9770366073720459,6,32.78347625904725,142.73868800118476,1161.6876993369622],
  ["12AX7|EL34|0|8.0|8|352800",324.61126952744627,7.2542540593409415,1.6905726213684026e-7,44160,65536,0.09320992467403023,-0.09313934739340984,-1.972913524187166,0.9729841014677865,6,42.5320136579341,164.22705816946825,1373.5793970027091],
  ["12AX7|EL34|0|8.0|15|352800",444.5449872807205,9.9772595360897,1.7081237269373047e-7,44160,65536,0.11358584942551288,-0.1135162260585117,-1.971526906006298,0.9715965293732993,6,34.42806673703024,151.8975517683305,1466.041345614004],
  ["12AX7|EL34|0|8.0|16|352800",459.1162275224903,10.298318240254494,1.7015356656660725e-7,44160,65536,0.09884905188474136,-0.09875968712964392,-1.9728343196896407,0.9729236844447381,6,50.78539750128601,215.4353634197014,1325.857801295892],
  ["12AX7|EL34|0|8.0|4|384000",229.8222600081134,4.842475620153139,3.5882236987856655e-7,48000,65536,0.0891379489526823,-0.08906972358248061,-1.9761598316304763,0.9762280570006779,6,46.795153435921925,203.59197743920024,1266.7891480168307],
  ["12AX7|EL34|0|8.0|8|384000",325.07503948012607,6.911607108025056,3.611621382228214e-7,48000,65536,0.0854159159686499,-0.08531814855653133,-1.9771834926756922,0.9772812600878107,6,69.99311782219651,350.45133824758307,1054.0309076958251],
  ["12AX7|EL34|0|8.0|15|384000",445.1802043890001,9.507948579293545,3.6192121615117597e-7,48000,65536,0.0870759594108087,-0.08698210091908393,-1.9737823394567122,0.973876197948437,6,65.91144382771255,262.0151154858292,1355.7787514907045],
  ["12AX7|EL34|0|8.0|16|384000",459.77225246022863,9.81363550791763,3.62029157835858e-7,48000,65536,0.0889029620287372,-0.08869679138798614,-1.9674436238619957,0.9676497945027468,6,141.89464602924232,528.4520562279239,1481.3335268225533],
  ["12AX7|EL34|20|6.0|4|352800",136.49028938056563,2.3961980103425837,1.7694948260627948e-7,44160,65536,0.10688635020409079,-0.10669044588786225,-1.971775013588827,0.9719709179050556,6,103.00748006692658,695.349979127843,900.9566714273128],
  ["12AX7|EL34|20|6.0|8|352800",193.0605118469741,3.4262938328133097,1.7570664171159732e-7,44160,65536,0.09304139235452485,-0.09286209923591027,-1.9731840759380228,0.9733633690566373,6,108.30659766244568,718.5179053769334,797.4056906486976],
  ["12AX7|EL34|20|6.0|15|352800",264.39045364030966,4.717646093741313,1.7735406107926105e-7,44160,65536,0.0920243113231295,-0.0918623721579221,-1.9729061717256617,0.9730681108908691,6,98.89638845686329,502.056814427298,1030.9017567597584],
  ["12AX7|EL34|20|6.0|16|352800",273.05659458849493,4.868727459235106,1.766585342842366e-7,44160,65536,0.09652091606536424,-0.09638879428787066,-1.9746211496138029,0.9747532713912964,6,76.9128829635477,412.1654492335352,1023.6368249177735],
  ["12AX7|EL34|20|6.0|4|384000",136.64723130280456,2.2820657372900843,3.6684769621048714e-7,48000,65536,0.09076713211023404,-0.09062387983586605,-1.9758156788338526,0.9759589311082204,6,96.531088667919,637.0366117132959,850.1951158482284],
  ["12AX7|EL34|20|6.0|8|384000",193.28258803172497,3.264820311639666,3.656328130039419e-7,48000,65536,3.2662066523559803,-3.2451207015018255,-1.1519395801633816,0.1730255310175364,6,395.82801634903615,1587.3689241952468,105628.53448855312],
  ["12AX7|EL34|20|6.0|15|384000",264.6946324939447,4.496466237353012,3.6348840287144963e-7,48000,65536,0.08917935165287158,-0.08904564440271563,-1.9768717897529027,0.9770054970030586,6,91.69967078794555,701.8459080607881,719.8839586281026],
  ["12AX7|EL34|20|6.0|16|384000",273.37073678102263,4.640305505422692,3.639290380821288e-7,48000,65536,0.09195027400060528,-0.09177004231524172,-1.971983175418642,0.9721634071040056,6,119.9100130822502,614.720277814876,1110.6542287718535],
  ["12AX7|EL34|20|6.6|4|352800",137.49769655649243,2.444694091043812,1.7661014329705555e-7,44160,65536,0.09589555003836614,-0.09577738896247708,-1.9714438563979004,0.9715620174737893,6,69.22969102695765,282.6115593504095,1337.3218623228518],
  ["12AX7|EL34|20|6.6|8|352800",194.48544402597457,3.495162791714222,1.7583194539493766e-7,44160,65536,0.08960673498294908,-0.08948068101835789,-1.9762245870592974,0.9763506410238886,6,79.04423756438302,449.92088764835444,893.9415293040745],
  ["12AX7|EL34|20|6.6|15|352800",266.3418489579623,4.812147689996044,1.7610580395681207e-7,44160,65536,0.08846585584471645,-0.08842148762240176,-1.9776820218652373,0.9777263900875519,6,28.167868303996055,124.00719269076734,1140.7916722624054],
  ["12AX7|EL34|20|6.6|16|352800",275.07195319880435,4.966300410404342,1.7664955566896562e-7,44160,65536,0.10390517953737105,-0.10371845633923095,-1.970417506720703,0.9706042299188432,6,100.99510057382537,514.9624754631465,1160.352039676389],
  ["12AX7|EL34|20|6.6|4|384000",137.65266244787708,2.329940502752699,3.628817513037947e-7,48000,65536,0.10178234127351535,-0.10163220622976318,-1.9696183895663755,0.9697685246101276,6,90.21556980111897,380.81105148759366,1495.3045891514453],
  ["12AX7|EL34|20|6.6|8|384000",194.70472566277132,3.3328090917224795,3.676610196745359e-7,48000,65536,0.1043206754924586,-0.10422566159762561,-1.9718001947244561,0.971895208619289,6,55.688553406744,239.55270172861736,1502.684551657228],
  ["12AX7|EL34|20|6.6|15|384000",266.64220094444914,4.589761898725305,3.6566501407520656e-7,48000,65536,0.09245075222874775,-0.09239601763591933,-1.9766817811217767,0.9767365157146052,6,36.19356731863736,162.04798709862328,1276.5100231557851],
  ["12AX7|EL34|20|6.6|16|384000",275.38214313747056,4.736633030192375,3.6642120514410307e-7,48000,65536,0.08399956741898919,-0.08394861546479936,-1.9778597394585002,0.9779106914126899,6,37.08232031993903,159.64021687578048,1205.4924293836748],
  ["12AX7|EL34|20|8.0|4|352800",138.60417196667547,2.5138053550322765,1.7443019227636373e-7,44160,65536,0.8060294797087555,-0.4720518104702626,-0.8418753919447692,0.1758530611832621,7,30041.94983036381,43910.19543993617,53684.24870855212],
  ["12AX7|EL34|20|8.0|8|352800",196.05049953247382,3.5932178892658477,1.7814962507019747e-7,44160,65536,0.7869779661308111,-0.419197321693576,-0.7847553093976116,0.1525359538348466,7,35366.46944948997,47373.50813225466,58208.166317299576],
  ["12AX7|EL34|20|8.0|15|352800",268.4851350684269,4.9466376823456395,1.734206548163361e-7,44160,65536,0.7620814243335907,-0.35277530215310005,-0.7195538028188925,0.1288599249993831,7,43247.86552204145,53763.748810306104,61288.96853016138],
  ["12AX7|EL34|20|8.0|16|352800",277.2854928772933,5.105169903718823,1.7373186225412295e-7,44160,65536,0.734688552950321,-0.6709313520235995,-1.0627386182381444,0.12649581916486594,7,5097.276064941358,4307.325416014048,111785.10234205837],
  ["12AX7|EL34|20|8.0|4|384000",138.75389398909113,2.3978551313811867,3.6905773965648934e-7,48000,65536,1.2891774664875688,-1.0591305341220376,-1.0373490225959094,0.26739595496144075,7,12012.62221882207,35543.57171248324,45069.282446530844],
  ["12AX7|EL34|20|8.0|8|384000",196.26236458982962,3.42916968194568,3.679675661188267e-7,48000,65536,1.3778125376769472,-1.2481034225678094,-1.2056242666128147,0.3353333817219525,7,6042.6107233233915,15950.365228892524,50826.265954295624],
  ["12AX7|EL34|20|8.0|15|384000",268.77533104302887,4.721929536450038,3.689810947396454e-7,48000,65536,1.3541803194871547,-1.1880302066855217,-1.184769694376778,0.35091980717841104,7,8000,32000,32000],
  ["12AX7|EL34|20|8.0|16|384000",277.58519372834377,4.873104237580116,3.6941484189150764e-7,48000,65536,1.3650155109636675,-1.234785253432988,-1.1983050620715425,0.3285353196022221,7,6127.9728212150985,15684.629594145592,52343.699326231246],
  ["12AX7|EL34|43|6.0|4|352800",100.97809684887703,1.5934142493016217,1.7430483348371024e-7,44160,65536,0.8190818007412457,-0.26200854015077335,-0.5007989973837561,0.05787225797422844,7,64000,64000,96000],
  ["12AX7|EL34|43|6.0|8|352800",142.82986561135323,2.2811686980110246,1.7681278962475134e-7,44160,65536,0.8863047435514028,-0.6951112394963151,-0.9621217255768834,0.1533152296319709,7,13643.796826894597,15370.272973479463,89925.27327374998],
  ["12AX7|EL34|43|6.0|15|352800",195.60115638119876,3.1428122010622133,1.801828845483053e-7,44160,65536,0.8190818007412457,-0.3483921850778281,-0.6062629996957107,0.07695261535912837,7,48000,48000,96000],
  ["12AX7|EL34|43|6.0|16|352800",202.01252995224286,3.24319846787253,1.7763001549295273e-7,44160,65536,1.0228744077553655,-0.8943900719313519,-1.1903864972714695,0.3188708330954832,7,7536.995547298502,13714.011657671777,50463.551712694134],
  ["12AX7|EL34|43|6.0|4|384000",101.07819341774336,1.5219040669510546,3.603199958120983e-7,48000,65536,1.4202142898502583,-1.12798094778329,-0.9160760268361721,0.2083093689031403,7,14079.69715067252,42775.17050390477,53098.603196355456],
  ["12AX7|EL34|43|6.0|8|384000",142.971509592679,2.1799877859145034,3.6259521786264243e-7,48000,65536,1.6648412067115215,-1.5593668922570796,-1.3504638133115545,0.4559381277659963,7,4000,24000,24000],
  ["12AX7|EL34|43|6.0|15|384000",195.79516991760136,3.004210691300338,3.629235832844913e-7,48000,65536,1.6648412067115215,-1.5593668922570796,-1.3504638133115545,0.4559381277659963,7,4000,24000,24000],
  ["12AX7|EL34|43|6.0|16|384000",202.2128980039008,3.1000599181641175,3.610060898717229e-7,48000,65536,1.6648412067115215,-1.5593668922570796,-1.3504638133115545,0.4559381277659963,7,4000,24000,24000],
  ["12AX7|EL34|43|6.6|4|352800",100.20694262281674,1.6013552981014436,1.8200983292735216e-7,44160,65536,0.5746551995630436,-0.37478129259419585,-1.0775294372055302,0.2774033441743779,7,24000,24000,48000],
  ["12AX7|EL34|43|6.6|8|352800",141.73909024847356,2.2921922128695225,1.7798297407804935e-7,44160,65536,0.4884788382763336,-0.16620318333782783,-0.8365853206350337,0.15886097557353937,7,60534.332495854236,34059.71855155266,69240.6362732948],
  ["12AX7|EL34|43|6.6|15|352800",194.10736921274645,3.1577649783764024,1.7724148206965927e-7,44160,65536,0.5195021220778919,-0.23312105170389263,-0.923126897313324,0.2095079676873234,7,44993.61824058427,36609.87315133695,51151.999658852066],
  ["12AX7|EL34|43|6.6|16|352800",200.46978024185037,3.2586614222816737,1.7745565461067723e-7,44160,65536,0.4771611764862085,-0.0863271408060735,-0.7452255985619582,0.13605963424209325,7,96000,48000,64000],
  ["12AX7|EL34|43|6.6|4|384000",100.30400170608296,1.529902801502847,3.579817265701442e-7,48000,65536,1.0789455626723845,-0.9465651666755436,-1.2676167538441663,0.39999714984100715,7,8000,24000,32000],
  ["12AX7|EL34|43|6.6|8|384000",141.87643758344637,2.191092634791896,3.6222642685806485e-7,48000,65536,1.1807518055836648,-1.1059464807678663,-1.444897319149017,0.5197026439648156,7,4000,16000,24000],
  ["12AX7|EL34|43|6.6|15|384000",194.2954981900127,3.019274581937918,3.6014688214124616e-7,48000,65536,1.147009389021883,-1.0743417805483657,-1.4141098052222663,0.48677741369578376,7,4000,12000,32000],
  ["12AX7|EL34|43|6.6|16|384000",200.664070918551,3.115637634748661,3.610041121004188e-7,48000,65536,1.147009389021883,-1.0743417805483657,-1.4141098052222663,0.48677741369578376,7,4000,12000,32000],
  ["12AX7|EL34|43|8.0|4|352800",98.01951918569543,1.601792200480719,1.771922993375791e-7,44160,65536,0.07042920515761333,-0.012741924972340776,-1.432788545356921,0.4904758255421935,8,96000,8000,32000],
  ["12AX7|EL34|43|8.0|8|352800",138.64504960275724,2.292218209513159,1.710793212005661e-7,44160,65536,0.07042920515761333,-0.012741924972340776,-1.432788545356921,0.4904758255421935,8,96000,8000,32000],
  ["12AX7|EL34|43|8.0|15|352800",189.87016794556158,3.157392806293456,1.7394972365822842e-7,44160,65536,0.07042920515761333,-0.012741924972340776,-1.432788545356921,0.4904758255421935,8,96000,8000,32000],
  ["12AX7|EL34|43|8.0|16|352800",196.09369384014153,3.2583339921418397,1.7434738811944718e-7,44160,65536,0.07169575645553286,-0.014984529365726893,-1.4315853527805684,0.4882965798703743,8,87897.7419746256,7760.597720460118,32489.439059186807],
  ["12AX7|EL34|43|8.0|4|384000",98.11010043293369,1.530291942761951,3.566034896280891e-7,48000,65536,0.08543744531319246,-0.008941410273938834,-1.007183427884918,0.08367946292417183,8,137943.24992868392,5374.7855123293575,146238.20137819933],
  ["12AX7|EL34|43|8.0|8|384000",138.77323333662744,2.191050593706888,3.5514572618234344e-7,48000,65536,0.11704860867663357,-0.02332342317995431,-1.0748649343483472,0.1685901198450265,8,98587.31472531546,7522.023523384937,101280.97109041423],
  ["12AX7|EL34|43|8.0|15|384000",190.04574730434192,3.0188092732256995,3.5564119872696855e-7,48000,65536,0.23528848170692707,-0.04268015091303489,-1.1219867740142941,0.3145951048081864,8,104328.94561091678,34153.145975996296,36525.023793691245],
  ["12AX7|EL34|43|8.0|16|384000",196.2750235630097,3.115214008108577,3.549288779623258e-7,48000,65536,0.12269423090165434,-0.025505624740518467,-1.0851853454491076,0.18237395161024347,8,96000,8000,96000],
  ["12AX7|6L6GC|0|6.0|4|352800",107.12890467793743,2.0122819049564726,1.7362660073815356e-7,44160,65536,1.4022716496679937,-0.5964489549864345,-0.20464745001817633,0.010470144699735494,8,48000,128000,128000],
  ["12AX7|6L6GC|0|6.0|8|352800",151.5298738096923,2.8753084652877097,1.7293532189519998e-7,44160,65536,1.4022716496679937,-0.5964489549864345,-0.20464745001817633,0.010470144699735494,8,48000,128000,128000],
  ["12AX7|6L6GC|0|6.0|15|352800",207.5154930865863,3.9576159607925145,1.7272215789842214e-7,44160,65536,1.4022716496679937,-0.5964489549864345,-0.20464745001817633,0.010470144699735494,8,48000,128000,128000],
  ["12AX7|6L6GC|0|6.0|16|352800",214.31740058918038,4.084549401438794,1.7541306272058937e-7,44160,65536,1.4022716496679937,-0.5964489549864345,-0.20464745001817633,0.010470144699735494,8,48000,128000,128000],
  ["12AX7|6L6GC|0|6.0|4|384000",107.24524304694896,1.928830471205985,3.4241776874966875e-7,48000,65536,1.9485194013230354,-1.1968797346209563,-0.2651092557950589,0.016748922497137914,8,29784.751306051192,111534.20788616131,138392.81513326202],
  ["12AX7|6L6GC|0|6.0|8|384000",151.69449716942876,2.757238287884083,3.4725962499043294e-7,48000,65536,1.8862772701672212,-1.117402072442941,-0.24628942214026633,0.015164619864546577,8,32000,128000,128000],
  ["12AX7|6L6GC|0|6.0|15|384000",207.74097987904634,3.795884642318634,3.460516485165148e-7,48000,65536,1.8862772701672212,-1.117402072442941,-0.24628942214026633,0.015164619864546577,8,32000,128000,128000],
  ["12AX7|6L6GC|0|6.0|16|384000",214.5502730898752,3.917523003300982,3.5001952402529243e-7,48000,65536,1.8862772701672212,-1.117402072442941,-0.24628942214026633,0.015164619864546577,8,32000,128000,128000],
  ["12AX7|6L6GC|0|6.6|4|352800",111.53345874195986,2.119938238363466,1.7356685133798618e-7,44160,65536,1.1848256782928834,-0.3790029836113242,-0.20464745001817633,0.010470144699735494,8,64000,128000,128000],
  ["12AX7|6L6GC|0|6.6|8|352800",157.759945816407,3.0287775305999753,1.70834806190444e-7,44160,65536,1.1848256782928834,-0.3790029836113242,-0.20464745001817633,0.010470144699735494,8,64000,128000,128000],
  ["12AX7|6L6GC|0|6.6|15|352800",216.04738031344505,4.16860828894824,1.726972900381602e-7,44160,65536,1.1848256782928834,-0.3790029836113242,-0.20464745001817633,0.010470144699735494,8,64000,128000,128000],
  ["12AX7|6L6GC|0|6.6|16|352800",223.12894521666954,4.302342899573698,1.6993724374709347e-7,44160,65536,1.1848256782928834,-0.3790029836113242,-0.20464745001817633,0.010470144699735494,8,64000,128000,128000],
  ["12AX7|6L6GC|0|6.6|4|384000",111.6541190870364,2.0330484194618297,3.456710315769997e-7,48000,65536,1.6267202078818115,-0.8758813016693388,-0.26428665723413813,0.015125563446611017,8,37836.0269301098,104638.48562430503,151519.12014098794],
  ["12AX7|6L6GC|0|6.6|8|384000",157.93068521523116,2.9058421489928254,3.514826398296714e-7,48000,65536,1.6827756682861028,-1.0518746380057893,-0.4076188609873327,0.03851989126764644,8,28716.380168440228,82621.76809343844,116405.77232573062],
  ["12AX7|6L6GC|0|6.6|15|384000",216.28124427539225,4.000212548252135,3.4900244563297024e-7,48000,65536,1.5881270386913031,-0.8958167082790237,-0.32583876135310064,0.018149091765380064,8,34993.194885667675,83625.09400782014,161395.17398908135],
  ["12AX7|6L6GC|0|6.6|16|384000",223.3704692642104,4.128434063686095,3.463938331465641e-7,48000,65536,1.5393313060965659,-0.9118765405343174,-0.41575915270152386,0.04321391826377226,8,32000,96000,96000],
  ["12AX7|6L6GC|0|8.0|4|352800",120.66145167410424,2.3388349995397775,1.7245843972770467e-7,44160,65536,0.8190818007412457,-0.26200854015077335,-0.5007989973837561,0.05787225797422844,8,64000,64000,96000],
  ["12AX7|6L6GC|0|8.0|8|352800",170.6711413023712,3.34087089252198,1.7346455990872398e-7,44160,65536,0.8190818007412457,-0.26200854015077335,-0.5007989973837561,0.05787225797422844,8,64000,64000,96000],
  ["12AX7|6L6GC|0|8.0|15|352800",233.7288558965281,4.597712074659193,1.720925744276541e-7,44160,65536,0.8190818007412457,-0.26200854015077335,-0.5007989973837561,0.05787225797422844,8,64000,64000,96000],
  ["12AX7|6L6GC|0|8.0|16|352800",241.3899824470816,4.745274284023593,1.72578221389907e-7,44160,65536,0.7920203342874659,-0.37846132857715903,-0.6263594950455746,0.03991850075588147,8,41465.16792968402,33126.12665532471,147727.833888997],
  ["12AX7|6L6GC|0|8.0|4|384000",120.79084097528029,2.2448361226637505,3.438021498341376e-7,48000,65536,1.1532783265730793,-0.5258235610108309,-0.41575915270152386,0.04321391826377226,8,48000,96000,96000],
  ["12AX7|6L6GC|0|8.0|8|384000",170.85423327594387,3.207877117170936,3.4473236452099196e-7,48000,65536,1.1532783265730793,-0.5258235610108309,-0.41575915270152386,0.04321391826377226,8,48000,96000,96000],
  ["12AX7|6L6GC|0|8.0|15|384000",233.9796397181705,4.415538417654725,3.4526479559296503e-7,48000,65536,1.1532783265730793,-0.5258235610108309,-0.41575915270152386,0.04321391826377226,8,48000,96000,96000],
  ["12AX7|6L6GC|0|8.0|16|384000",241.64898051763902,4.557136268773911,3.4657669091098466e-7,48000,65536,1.1532783265730793,-0.5258235610108309,-0.41575915270152386,0.04321391826377226,8,48000,96000,96000],
  ["12AX7|6L6GC|20|6.0|4|352800",76.50753111179066,1.3157684344848948,2.9992704947385167e-7,44160,65536,0.7622201079849845,-0.26512069772390984,-0.5426390914749664,0.03973850173604108,8,59297.0741382613,44169.59975263296,136938.12222776067],
  ["12AX7|6L6GC|20|6.0|8|352800",108.21710619345384,1.8818233271857399,3.0528270995436544e-7,44160,65536,0.7584763634459522,-0.24262202449804013,-0.5276685254460446,0.04352286439395661,8,64000,48000,128000],
  ["12AX7|6L6GC|20|6.0|15|352800",148.20001506177766,2.5913601894865,3.0376106672461415e-7,44160,65536,0.7584763634459522,-0.24262202449804013,-0.5276685254460446,0.04352286439395661,8,64000,48000,128000],
  ["12AX7|6L6GC|20|6.0|16|352800",153.0576868300407,2.6743078555113486,3.0782261750519864e-7,44160,65536,0.7584763634459522,-0.24262202449804013,-0.5276685254460446,0.04352286439395661,8,64000,48000,128000],
  ["12AX7|6L6GC|20|6.0|4|384000",76.57899600322945,1.2604755465336652,7.679334640084479e-7,48000,65536,1.07009116997831,-0.37551618703210876,-0.33102428742089507,0.025599270367096267,8,64000,96000,128000],
  ["12AX7|6L6GC|20|6.0|8|384000",108.31823724726601,1.8035877816290007,7.744534489251595e-7,48000,65536,1.07009116997831,-0.37551618703210876,-0.33102428742089507,0.025599270367096267,8,64000,96000,128000],
  ["12AX7|6L6GC|20|6.0|15|384000",148.33853871566535,2.4841898700221288,7.677703138508085e-7,48000,65536,1.0750972680569058,-0.2327826315801323,-0.1641095626070648,0.006424199083838212,8,93510.4592740304,140951.93156627324,167539.74854754473],
  ["12AX7|6L6GC|20|6.0|16|384000",153.20074726963617,2.5636294564823463,7.659472178552199e-7,48000,65536,1.07009116997831,-0.37551618703210876,-0.33102428742089507,0.025599270367096267,8,64000,96000,128000],
  ["12AX7|6L6GC|20|6.6|4|352800",77.7951632699037,1.3536570488352158,3.4982487742393216e-7,44160,65536,0.503654887842014,-0.5028955307929631,-1.0682224113796326,0.0689817684286835,8,84.72065039694685,45.81840859339741,150094.03464642205],
  ["12AX7|6L6GC|20|6.6|8|352800",110.03841057304396,1.9357639740963568,3.4855270048272856e-7,44160,65536,0.5356409028117533,-0.1586897271150163,-0.6772057258378541,0.05415690153459102,8,68307.0441912482,30146.612607514584,133579.0833320347],
  ["12AX7|6L6GC|20|6.6|15|352800",150.6942327215816,2.6654704007643963,3.4786022564269203e-7,44160,65536,0.5654953932496395,-0.05798642340565872,-0.5720469092974314,0.07955587914141213,8,127880.93580642779,61659.722430502305,80472.1822901972],
  ["12AX7|6L6GC|20|6.6|16|352800",155.6336598333694,2.750813724033276,3.4702455526727124e-7,44160,65536,0.49480078797624427,-0.48978604565879685,-1.0714181199949249,0.07643286231237219,8,571.9750131983594,305.8492914140082,144074.6844460929],
  ["12AX7|6L6GC|20|6.6|4|384000",77.86694893791034,1.2967708596776466,8.106851851922745e-7,48000,65536,0.8267087388037888,-0.14706402899932436,-0.3486825786404309,0.02832728844489533,8,105521.06444898152,92588.88473426038,125222.45319965298],
  ["12AX7|6L6GC|20|6.6|8|384000",110.13999620294838,1.8552743169652406,8.098476485888404e-7,48000,65536,0.8293101980711155,-0.17750347193503088,-0.37439491014809706,0.02620163628418168,8,94215.9024968557,77531.05143736463,145047.52353559594],
  ["12AX7|6L6GC|20|6.6|15|384000",150.83337951936414,2.5552124543147015,8.117944028383536e-7,48000,65536,0.8768552889298669,-0.7692702036425689,-1.0004504801684788,0.10803556545577674,8,8000,8000,128000],
  ["12AX7|6L6GC|20|6.6|16|384000",155.77736389691717,2.63694661805337,8.096812830258999e-7,48000,65536,0.8214836393005345,-0.8203436763133811,-1.0710016261852693,0.07214158917242264,8,84.86814217597016,75.13960173523297,160605.11847504208],
  ["12AX7|6L6GC|20|8.0|4|352800",79.93070958095245,1.4210657605042913,4.317594161655644e-7,44160,65536,0.16179236892505544,-0.014129866505580738,-0.9928698778515765,0.14053238027105122,8,136894.66479028316,11014.324791425706,99169.5275079139],
  ["12AX7|6L6GC|20|8.0|8|352800",113.05905430684375,2.0316897662604676,4.330212453161298e-7,44160,65536,0.15992359602228626,-0.05115648753462929,-1.048126690047799,0.15689379853545599,8,64000,8000,96000],
  ["12AX7|6L6GC|20|8.0|15|352800",154.8309061907412,2.797235694902224,4.3779425379751347e-7,44160,65536,0.12815520172071626,-0.02579663667073687,-1.0094101960794124,0.11176876112939188,8,90008.11513448555,6999.222606085275,116043.27546720594],
  ["12AX7|6L6GC|20|8.0|16|352800",159.90592528431222,2.886842541115508,4.3551327071737223e-7,44160,65536,0.11973172834907424,-0.020101619090529994,-0.9947505670860939,0.09438067634463812,8,100196.80881632054,6636.218181526564,125900.98334362046],
  ["12AX7|6L6GC|20|8.0|4|384000",80.00255560403609,1.361003902464961,8.943442861056727e-7,48000,65536,0.44581578052189846,-0.09267599558537651,-0.8068579349444072,0.15999771988092912,8,96000,48000,64000],
  ["12AX7|6L6GC|20|8.0|8|384000",113.16072720212833,1.946706847831299,8.966143526547634e-7,48000,65536,0.3712263468297472,-0.1692562455509653,-0.892810123563373,0.09478022484215488,8,48000,16000,128000],
  ["12AX7|6L6GC|20|8.0|15|384000",154.9701734897346,2.680823365972057,9.004622872820002e-7,48000,65536,0.43305899740258197,-0.04867691431081711,-0.7559467086528263,0.14032879174459117,8,133578.25537194862,51818.498854795194,68198.10554541298],
  ["12AX7|6L6GC|20|8.0|16|384000",160.049753544596,2.766619382430073,8.982497390372427e-7,48000,65536,0.3712263468297472,-0.1692562455509653,-0.892810123563373,0.09478022484215488,8,48000,16000,128000],
  ["12AX7|6L6GC|43|6.0|4|352800",58.85141097361189,0.9598559465900202,1.875714248745671e-7,44160,65536,0.13598010652960985,-0.01835578637245729,-0.9418898577722865,0.05951417792943913,8,112443.68155824253,7576.2045461833395,150852.9223891537],
  ["12AX7|6L6GC|43|6.0|8|352800",83.24318367201661,1.3736167634966447,1.7164486004375758e-7,44160,65536,0.14553343418329606,-0.02632964684438436,-0.9695322157981329,0.08873600313704458,8,96000,8000,128000],
  ["12AX7|6L6GC|43|6.0|15|352800",113.9990023666946,1.89209569980059,1.6478612160221908e-7,44160,65536,0.14553343418329606,-0.02632964684438436,-0.9695322157981329,0.08873600313704458,8,96000,8000,128000],
  ["12AX7|6L6GC|43|6.0|16|352800",117.73563851891063,1.9525826196021094,1.6361148219871157e-7,44160,65536,0.14553343418329606,-0.02632964684438436,-0.9695322157981329,0.08873600313704458,8,96000,8000,128000],
  ["12AX7|6L6GC|43|6.0|4|384000",58.90120731209294,0.9190968977501525,3.4333183568663125e-7,48000,65536,0.40761515281161104,-0.05019565022079402,-0.7155295582585222,0.07294906084933915,8,128000,32000,128000],
  ["12AX7|6L6GC|43|6.0|8|384000",83.31365423574155,1.3159435752997526,3.4739360587934423e-7,48000,65536,0.45354210787126337,-0.10886645208606943,-0.7735516620625655,0.11822731784775951,8,87209.74986465232,35013.19758774101,95477.31902953962],
  ["12AX7|6L6GC|43|6.0|15|384000",114.09553040650746,1.8130906505243711,3.383089342121464e-7,48000,65536,0.3870865959738998,-0.13030464393624103,-0.7929916796452583,0.04977363168291715,8,66540.92298827114,19715.386126800502,163647.60457711288],
  ["12AX7|6L6GC|43|6.0|16|384000",117.83532774427877,1.8709916470183676,3.4838306308347043e-7,48000,65536,0.40761515281161104,-0.05019565022079402,-0.7155295582585222,0.07294906084933915,8,128000,32000,128000],
  ["12AX7|6L6GC|43|6.6|4|352800",58.93240006243647,0.9738496360557881,1.6068514316560823e-7,44160,65536,0.0909244932727493,-0.09078349454903421,-1.9388764264574347,0.93901742518115,11,87.14048109611764,134.98375007255225,3398.0354697462712],
  ["12AX7|6L6GC|43|6.6|8|352800",83.3577363698964,1.3934324835295635,1.68978800043582e-7,44160,65536,0.08897728377012261,-0.08882587802250788,-1.971121698292474,0.9712731040400887,11,95.62725538530044,387.8609366660007,1248.7722552839089],
  ["12AX7|6L6GC|43|6.6|15|352800",114.1558763415337,1.9192477756424489,1.7079971349059549e-7,44160,65536,0.09465861379533877,-0.09446233993707573,-1.9718929547287134,0.9720892285869763,11,116.54715326144438,731.6359303404695,857.8364371184025],
  ["12AX7|6L6GC|43|6.6|16|352800",117.89765474740257,1.9806226869511931,1.6702887527134645e-7,44160,65536,0.09799382546038547,-0.09779950776739679,-1.9642751349513787,0.9644694526443676,11,111.45339242756828,377.0931078886522,1654.2471920370233],
  ["12AX7|6L6GC|43|6.6|4|384000",58.981517258613955,0.9322091940617948,3.4106932804898065e-7,48000,65536,0.04682974348496125,-0.005766835230944004,-1.591390370527117,0.6324532787811343,13,128000,12000,16000],
  ["12AX7|6L6GC|43|6.6|8|384000",83.4272463936886,1.3345122411787083,3.4205854088114416e-7,48000,65536,0.03747443327133084,-0.004370333365177671,-1.6124024205950638,0.6455065205012169,13,131326.18210953663,8304.992877236498,18446.480971658053],
  ["12AX7|6L6GC|43|6.6|15|384000",114.25108936295774,1.838534750374298,3.4922874823741187e-7,48000,65536,0.04682974348496125,-0.005766835230944004,-1.591390370527117,0.6324532787811343,13,128000,12000,16000],
  ["12AX7|6L6GC|43|6.6|16|384000",117.99598584552123,1.897267756892248,3.511263399960292e-7,48000,65536,0.04506290464473774,-0.010555348669010253,-1.6078710516227352,0.6423786075984628,13,88704.66459349723,8746.507893600574,18301.831455043004],
  ["12AX7|6L6GC|43|8.0|4|352800",58.67297659289296,0.9947120677204175,1.7222590575015805e-7,44160,65536,0.08908229813741729,-0.08883581572589479,-1.9663577254633877,0.9666042078749102,9,155.57676978422276,608.7090143835703,1298.486601698327],
  ["12AX7|6L6GC|43|8.0|8|352800",82.99078453577425,1.4228715413500153,1.670209320003287e-7,44160,65536,0.08935249715684696,-0.08921901156598787,-1.9763176913697205,0.9764511769605796,9,83.94619289570662,521.6583355324237,816.422563687326],
  ["12AX7|6L6GC|43|8.0|15|352800",113.65334224454655,1.9595153527003044,1.6809817302420399e-7,44160,65536,0.08900356100009611,-0.08886195233869132,-1.975021945118534,0.9751635537799389,9,89.40809939972374,490.563372299274,921.6098933376355],
  ["12AX7|6L6GC|43|8.0|16|352800",117.37864938099344,2.022216864303333,1.6718403777378694e-7,44160,65536,0.09128066592693657,-0.0911172305463497,-1.962038785516001,0.9622022208965879,9,100.62480997371806,278.6920776028408,1884.79820369235],
  ["12AX7|6L6GC|43|8.0|4|384000",58.72038314264975,0.951418709407343,3.379289078658901e-7,48000,65536,0.08505355744203129,-0.08492069678627721,-1.976942536432251,0.9770753970880051,11,95.54207901821586,694.7158458266769,722.6416547776946],
  ["12AX7|6L6GC|43|8.0|8|384000",83.05787519449267,1.361612920442823,3.388093294695089e-7,48000,65536,0.08144134835423339,-0.08140096227274064,-1.9554907905903125,0.9555311766718051,11,30.31417976995762,56.65936617750745,2723.355518956275],
  ["12AX7|6L6GC|43|8.0|15|384000",113.74524227237265,1.8755998460742362,3.4363264612668196e-7,48000,65536,0.08328095279438655,-0.08323488191262157,-1.9787670294903907,0.9788131003721557,11,33.81834485532608,150.1140524191649,1158.6476566319723],
  ["12AX7|6L6GC|43|8.0|16|384000",117.4735588100061,1.93555447272808,3.430461641715278e-7,48000,65536,0.08426092661648686,-0.08417581595273378,-1.966090196273465,0.9661753069372179,11,61.763021253825784,167.0514970204202,1935.9318208978027],
  ["12AX7|KT88|0|6.0|4|352800",170.04789187802416,4.636585098208903,1.822063003447289e-7,44160,65536,0.517565716758786,-0.5166661619973449,-1.0647538967028851,0.06565345146432616,10,97.67614249913265,54.088744410047724,152862.49136410325],
  ["12AX7|KT88|0|6.0|8|352800",240.52606379527464,6.604334100765157,1.8277024626603572e-7,44160,65536,0.6332073661801432,-0.6283156920025671,-1.0548832242913202,0.05977489846889635,10,435.4549276961882,292.98908227590357,157890.6929797334],
  ["12AX7|KT88|0|6.0|15|352800",329.3927642894704,9.076135260746707,1.8307119186378325e-7,44160,65536,0.6298496199668885,-0.6262137438960317,-1.0666481000922419,0.0702839761630986,10,325.0704107786105,220.08338990180178,148869.67772191315],
  ["12AX7|KT88|0|6.0|16|352800",340.18958187441575,9.369204146032256,1.8248140373554958e-7,44160,65536,0.6382620292766752,-0.6194992876824708,-1.0471592771679243,0.0659220187621287,10,1675.36325362383,1141.0291772187677,151546.32829362902],
  ["12AX7|KT88|0|6.0|4|384000",170.40288784303584,4.365303341433026,3.591961052577415e-7,48000,65536,0.8768552889298669,-0.10798009120558659,-0.24628942214026633,0.015164619864546577,10,128000,128000,128000],
  ["12AX7|KT88|0|6.0|8|384000",241.0283381474764,6.220612011917769,3.6174310848772507e-7,48000,65536,0.8768552889298669,-0.10798009120558659,-0.24628942214026633,0.015164619864546577,10,128000,128000,128000],
  ["12AX7|KT88|0|6.0|15|384000",330.08070447156973,8.55061107289101,3.629398765890836e-7,48000,65536,0.8768552889298669,-0.10798009120558659,-0.24628942214026633,0.015164619864546577,10,128000,128000,128000],
  ["12AX7|KT88|0|6.0|16|384000",340.90005898731454,8.826459883287372,3.625739224126444e-7,48000,65536,0.9310899545802253,-0.2244836495454727,-0.3143106886640298,0.02091699369878233,10,86940.03646268582,92914.63510061527,143430.81320736418],
  ["12AX7|KT88|0|6.6|4|352800",175.84602997481173,4.800868255785169,1.7435766922961154e-7,44160,65536,0.4750955678190633,-0.4668815946986583,-1.095165790878723,0.10337976399912792,10,979.2703722506544,517.3163887180689,126906.15506703981],
  ["12AX7|KT88|0|6.6|8|352800",248.72730058017498,6.838277115701992,1.7526307718660087e-7,44160,65536,0.454029218226824,-0.4428733788106243,-1.0588820001145633,0.07003783953076302,10,1396.8767027582137,678.2718434369734,148608.4729307998],
  ["12AX7|KT88|0|6.6|15|352800",340.6240949725833,9.397593963453145,1.761900364119832e-7,44160,65536,0.43723010951737834,-0.40709667780419034,-1.060926175841007,0.091059607554195,10,4009.60159411928,1899.7116804849766,132648.89208435922],
  ["12AX7|KT88|0|6.6|16|352800",351.7890526969457,9.701048672764461,1.7609346336204864e-7,44160,65536,0.44609337334406474,-0.4073923146007027,-1.0285136134495982,0.06721467219296026,10,5095.692701228217,2386.9836722710197,149209.99676423983],
  ["12AX7|KT88|0|6.6|4|384000",176.20919735350847,4.522875764392204,3.5699910113074637e-7,48000,65536,0.7680826679413144,-0.7445815748659231,-1.0570827858576977,0.08058387893308887,10,1899.1611579670443,1586.181667643036,152330.55183635565],
  ["12AX7|KT88|0|6.6|8|384000",249.24113744751557,6.44506155089937,3.5656676544426575e-7,48000,65536,0.7255235711242828,-0.7235443326546304,-1.0691378021057891,0.07111704057544142,10,166.9517624841199,130.3835135627296,161424.05387888462],
  ["12AX7|KT88|0|6.6|15|384000",341.32787229374406,8.859067104300753,3.5644384843059403e-7,48000,65536,0.7195251262351142,-0.7191871488846625,-1.0839264632728027,0.08426444062325435,10,28.71408671841605,22.561282786123922,151164.67215895234],
  ["12AX7|KT88|0|6.6|16|384000",352.51588569448955,9.144875691973663,3.568421544332758e-7,48000,65536,0.7327858707723115,-0.7292032974629772,-1.0556750117523672,0.059257585061701507,10,299.5250518445106,233.2430952991824,172470.68951493036],
  ["12AX7|KT88|0|8.0|4|352800",187.37150701612157,5.099257623088885,1.7873745347281808e-7,44160,65536,0.2038100666756379,-0.1118447237781255,-0.9791838807151093,0.07114922361262173,10,33694.24188882745,5907.143439535747,142495.59181494266],
  ["12AX7|KT88|0|8.0|8|352800",265.0296396564974,7.2634592282681805,1.7798826931086696e-7,44160,65536,0.20770587048763958,-0.13007989569153602,-0.979735532413845,0.05736150720994858,10,26276.684888324013,4853.298030477583,155644.45145586305],
  ["12AX7|KT88|0|8.0|15|352800",362.9496308424507,9.982016559883748,1.7836428342955316e-7,44160,65536,0.20539519358806363,-0.07850646451868233,-0.9467180322329142,0.07360676130229546,10,54002.408166616704,8386.913873943378,138109.1138059815],
  ["12AX7|KT88|0|8.0|16|352800",374.8463732428017,10.304327287168437,1.7835590130952622e-7,44160,65536,0.20743532370289505,-0.08823153636398336,-0.9695322157981329,0.08873600313704458,10,48000,8000,128000],
  ["12AX7|KT88|0|8.0|4|384000",187.7491108887912,4.8093806300476505,3.517146409915835e-7,48000,65536,0.4154292632183497,-0.3177476902723145,-0.9601087315437997,0.05779030448983492,10,16382.297365008319,6740.017181396137,167496.2502892825],
  ["12AX7|KT88|0|8.0|8|384000",265.5639041376608,6.853430861354748,3.508948357093399e-7,48000,65536,0.43680160205876756,-0.43149181921995927,-1.0949607166132331,0.10027049945204146,10,747.4755893988289,361.9839283245309,140196.55715744096],
  ["12AX7|KT88|0|8.0|15|384000",363.6813880662239,9.420461280931525,3.5185063565917405e-7,48000,65536,0.43081682701659013,-0.1942489380475732,-0.817890631179106,0.054458520148122934,10,48681.090592089684,18009.561931468892,159855.8480535274],
  ["12AX7|KT88|0|8.0|16|384000",375.60210262306646,9.724371776442704,3.5287809493055854e-7,48000,65536,0.3690110721980247,-0.3638155629420006,-1.0559498979177608,0.061145407173784916,10,866.5936559873326,339.26847680563026,170448.0233166157],
  ["12AX7|KT88|20|6.0|4|352800",97.07672898215648,1.8673925961257825,1.646389412914852e-7,44160,65536,0.08087200088639446,-0.027797457060277336,-1.335302302112967,0.3883768459390843,9,59963.738146054486,5468.88187017414,47636.489169354216],
  ["12AX7|KT88|20|6.0|8|352800",137.31143103409767,2.6676460057160605,1.64789320818068e-7,44160,65536,0.06864377763480861,-0.007133674895202267,-1.2902604175928165,0.35177052033242284,9,127129.13007075038,5981.773638072078,52682.27045275365],
  ["12AX7|KT88|20|6.0|15|352800",188.04376561658074,3.6713549713530944,1.6599434901755946e-7,44160,65536,0.11318984163250867,-0.008189759345202793,-1.3178213318739398,0.4228214141612456,9,147459.75688647077,15011.397450904991,33322.70737809753],
  ["12AX7|KT88|20|6.0|16|352800",194.20743331786335,3.789167079951107,1.653724057040155e-7,44160,65536,0.12290684650726126,-0.039315540155769824,-1.3731595471062725,0.45675085345776395,9,64000,12000,32000],
  ["12AX7|KT88|20|6.0|4|384000",97.21584592502074,1.75220343770345,3.3760402466130355e-7,48000,65536,0.1358191028475969,-0.02823401756029901,-1.0004504801684788,0.10803556545577674,9,96000,8000,128000],
  ["12AX7|KT88|20|6.0|8|384000",137.5082785352982,2.504695894191776,3.3640948091896695e-7,48000,65536,0.12953234801428104,-0.011303908538531937,-0.970723159260443,0.08895159873619203,9,149047.38213707873,8632.22327222949,139246.67969680144],
  ["12AX7|KT88|20|6.0|15|384000",188.31338605689558,3.4481716238148055,3.348219558435205e-7,48000,65536,0.12432350976309574,-0.01812163629048305,-0.9847463524916721,0.09094822596428474,9,117695.03570199976,7702.864532967719,138819.3958880781],
  ["12AX7|KT88|20|6.0|16|384000",194.48588554109745,3.558672958331561,3.349784015603626e-7,48000,65536,0.1358191028475969,-0.02823401756029901,-1.0004504801684788,0.10803556545577674,9,96000,8000,128000],
  ["12AX7|KT88|20|6.6|4|352800",96.95943998215704,1.8523311831391938,1.6265975277445003e-7,44160,65536,0.044260954384258595,-0.008759185969828148,-1.6138468681504665,0.6493486365648969,10,90962.77521523176,9186.523985868822,15058.173988136567],
  ["12AX7|KT88|20|6.6|8|352800",137.14553358229674,2.646310604135298,1.6239142830286344e-7,44160,65536,0.04610921930914921,-0.007323872512767461,-1.6022677590993428,0.6410531058957247,10,103308.6576171918,10547.329947521826,14419.31270425224],
  ["12AX7|KT88|20|6.6|15|352800",187.81657663194176,3.6421148892929924,1.632922079665379e-7,44160,65536,0.05443994462986234,-0.01741429293808127,-1.6151589850767927,0.6521846367685737,10,64000,12000,12000],
  ["12AX7|KT88|20|6.6|16|352800",193.97279722454826,3.758971587475895,1.634496133242325e-7,44160,65536,0.05443994462986234,-0.01741429293808127,-1.6151589850767927,0.6521846367685737,10,64000,12000,12000],
  ["12AX7|KT88|20|6.6|4|384000",97.09435244732455,1.7381388270985654,3.2742428982317737e-7,48000,65536,0.08011800990248585,-0.024337410043738662,-1.2861491490531682,0.3419297489119154,10,72818.26024442798,5717.87955048099,59868.2157924859],
  ["12AX7|KT88|20|6.6|8|384000",137.33643368828868,2.484768928800966,3.292543901522172e-7,48000,65536,0.06910377529537826,-0.008786462592621898,-1.2581091168108611,0.3184264295136174,10,126044.43037635209,5962.0765016184,63976.28849216886],
  ["12AX7|KT88|20|6.6|15|384000",188.07805203068634,3.4208596687557384,3.2930031850149354e-7,48000,65536,0.09437020345275501,-0.017895824990591027,-1.310843017425491,0.3873173958876549,10,101614.16807093513,9147.034390517649,48821.67428512867],
  ["12AX7|KT88|20|6.6|16|384000",194.24283740679897,3.5304690110400285,3.283749288753998e-7,48000,65536,0.0768999691751756,-0.008079117405424956,-1.279603445660906,0.34842429743065667,10,137706.836370897,7354.190689699646,57081.97504815591],
  ["12AX7|KT88|20|8.0|4|352800",96.03468458782065,1.8078652394325476,1.5400072637685233e-7,44160,65536,0.09932792833134793,-0.09927526926621058,-1.9723671969269352,0.9724198559920726,8,29.775949700944757,115.73798887380904,1454.6399098253753],
  ["12AX7|KT88|20|8.0|8|352800",135.83750867169107,2.5831644266198315,1.561859351723477e-7,44160,65536,0.08899825636978842,-0.08883767567774574,-1.9679610651028845,0.9681216457949272,8,101.4034267832609,350.3051374946598,1468.8119014288052],
  ["12AX7|KT88|20|8.0|15|352800",186.02528202364215,3.555465685966705,1.5489663172461276e-7,44160,65536,0.08932883990732325,-0.08927227905869674,-1.9735513166474656,0.9736078774960921,8,35.56398838142836,131.92361043285027,1369.896936356846],
  ["12AX7|KT88|20|8.0|16|352800",192.12278714543297,3.669506362339148,1.5569065598065825e-7,44160,65536,0.08983065567193356,-0.08968902962064458,-1.9520605162827005,0.9522021423339896,8,88.59513255772775,177.88082873282846,2572.22340772089],
  ["12AX7|KT88|20|8.0|4|384000",96.16033178051502,1.6961462455546745,3.2034131858551956e-7,48000,65536,0.08434650229290279,-0.08423720906125946,-1.9773308190934802,0.9774401123251235,10,79.24266440862928,426.551072473612,967.9979586663303],
  ["12AX7|KT88|20|8.0|8|384000",136.0153022180462,2.425119497663127,3.2289308090550956e-7,48000,65536,0.08636078322152634,-0.0862355182390394,-1.9688960451828244,0.9690213101653113,10,88.71143917329582,291.22821069256634,1631.9955635458045],
  ["12AX7|KT88|20|8.0|15|384000",186.26880755341537,3.338997947439475,3.227807649037376e-7,48000,65536,0.08368941921962054,-0.08365598955958288,-1.970373619240215,0.9704070489002529,10,24.417405510884038,71.85133421252121,1764.0372960344184],
  ["12AX7|KT88|20|8.0|16|384000",192.37428926330105,3.4459482355718025,3.21365042599131e-7,48000,65536,0.08596891239543052,-0.08586041067520025,-1.9626840073167773,0.9627925090370075,10,77.18283986171409,194.55647124396452,2122.7814761595355],
  ["12AX7|KT88|43|6.0|4|352800",65.0746369538868,1.0206058164862315,1.529523898213564e-7,44160,65536,0.09003002938753758,-0.08979950912501931,-1.9692311748763254,0.9694616951388436,7,143.9550873421819,729.1880048303879,1012.2615617133755],
  ["12AX7|KT88|43|6.0|8|352800",92.04572187702304,1.4612303295753113,1.5413366835238197e-7,44160,65536,0.08765771378162585,-0.08707370481122924,-1.9502077111164238,0.9507917200868203,7,375.3434452755349,1072.080565615606,1761.255712009914],
  ["12AX7|KT88|43|6.0|15|352800",126.05381758229811,2.0132394765578043,1.5557742099588118e-7,44160,65536,0.08983280639792415,-0.08978246820462728,-1.9646044072881137,0.9646547454814106,7,31.472632647697843,83.41150714482146,1937.1423772375272],
  ["12AX7|KT88|43|6.0|16|352800",130.18558293142434,2.0775353246642916,1.5608646049230848e-7,44160,65536,0.0915092727479638,-0.09147626984225177,-1.9762856756556415,0.9763186785613537,7,20.254154056661026,83.42380826794022,1262.2767979817063],
  ["12AX7|KT88|43|6.0|4|384000",65.14919349473034,0.9558974224803607,3.1823689199422326e-7,48000,65536,0.08255572261292604,-0.08236201250661165,-1.966246758056966,0.9664404681632806,8,143.5709152738338,449.7159677993969,1636.496856231075],
  ["12AX7|KT88|43|6.0|8|384000",92.15122378853752,1.3696844967752058,3.2110670469830196e-7,48000,65536,0.08155281463954493,-0.08149336328532672,-1.9769751846273143,0.9770346359815325,8,44.56895998232259,181.38340973192228,1238.5237275718375],
  ["12AX7|KT88|43|6.0|15|384000",126.19832605971054,1.8878480669125606,3.219189271391643e-7,48000,65536,0.08100238408415442,-0.08080356749020841,-1.9715840025963045,0.9717828191902507,8,150.18954711829022,766.3692045106975,982.935820235994],
  ["12AX7|KT88|43|6.0|16|384000",130.3348244938814,1.9480374441296255,3.203345509129719e-7,48000,65536,0.08336604141459682,-0.08332730993580569,-1.9766154262397104,0.9766541577185016,8,28.40057679232858,109.73345162197205,1333.9780079958657],
  ["12AX7|KT88|43|6.6|4|352800",64.03023647459895,1.0012661670884222,1.6169081501374833e-7,44160,65536,0.08825374919176368,-0.0881394025532382,-1.9762861145376216,0.9764004611761471,6,72.79816737875501,379.41460119338,961.5827350353636],
  ["12AX7|KT88|43|6.6|8|352800",90.56845621685689,1.4335921864794703,1.5644519360352395e-7,44160,65536,0.09204146374547882,-0.09192158589618431,-1.973903338064646,0.9740232159139406,6,73.17910733832613,335.1103066473596,1142.761971831626],
  ["12AX7|KT88|43|6.6|15|352800",124.0307475901857,1.9751952402067434,1.5341359819708744e-7,44160,65536,0.09115720223020546,-0.09101573133526536,-1.9754480848532383,0.9755895557481785,6,87.2091472788479,521.1320661275456,866.5173857977112],
  ["12AX7|KT88|43|6.6|16|352800",128.09620115152396,2.0382712998553254,1.5377499820857634e-7,44160,65536,0.08795311433079238,-0.08781320692426944,-1.9647512157908138,0.9648911231973367,6,89.38895052346092,256.5567317050379,1750.2399501505636],
  ["12AX7|KT88|43|6.6|4|384000",64.10129445053408,0.9375669248336552,3.3183087232110856e-7,48000,65536,0.08150286247709417,-0.08144859091106774,-1.9688902060352649,0.9689444776012914,7,40.70947324019358,113.48329635090144,1814.586446228202],
  ["12AX7|KT88|43|6.6|8|384000",90.66900854096038,1.3434735614241298,3.325302967881528e-7,48000,65536,0.08745763256273562,-0.08739110325216286,-1.9633932719040788,0.9634598012146515,7,46.50845354208705,117.32522561134311,2157.6694677326263],
  ["12AX7|KT88|43|6.6|15|384000",124.16847743438059,1.8517580886112002,3.343025751874144e-7,48000,65536,0.08093841759986002,-0.08084285052489776,-1.9556029745932588,0.9556985416682212,7,72.20403375317422,138.7957168303675,2630.5154888279662],
  ["12AX7|KT88|43|6.6|16|384000",128.23844192762726,1.9107918041250227,3.325421280847152e-7,48000,65536,0.08119647704221475,-0.08103731278924362,-1.9743647183376174,0.9745238825905886,7,119.91836889971617,648.3918192357822,928.770176082728],
  ["12AX7|KT88|43|8.0|4|352800",61.59520840683851,0.9596257533922872,1.4551255618256407e-7,44160,65536,0.09404703582915834,-0.09400792314865346,-1.9744567417509806,0.9744958544314856,5,23.356700951793368,91.9374271783689,1358.6950984347532],
  ["12AX7|KT88|43|8.0|8|352800",87.1241978009992,1.3740340526433605,1.4667880500590196e-7,44160,65536,0.09061435515155751,-0.09053093356676294,-1.9768475791646591,0.9769310007494538,5,51.71661928080786,251.2001405126159,1059.2957409860483],
  ["12AX7|KT88|43|8.0|15|352800",119.31394108898395,1.8931784677746273,1.4830034454786626e-7,44160,65536,0.08897767090262196,-0.0889016387441228,-1.976728059801029,0.9768040919595283,5,48.00103645513157,221.1707818737633,1096.6197541781646],
  ["12AX7|KT88|43|8.0|16|352800",123.22478805738545,1.9536295895907183,1.4860359302048957e-7,44160,65536,0.09940444587221658,-0.09910283758465145,-1.9651295899696517,0.9654311982572168,5,170.62625654513099,899.5629392127596,1075.8139724059156],
  ["12AX7|KT88|43|8.0|4|384000",61.65933671313686,0.8980475268479049,3.0838658186099137e-7,48000,65536,0.08274698040587289,-0.08271645458394555,-1.9672137248490582,0.9672442506709855,6,22.55000731400338,58.64475109581801,1976.7598199539366],
  ["12AX7|KT88|43|8.0|8|384000",87.2149470022884,1.2869148876846361,3.1504078032989055e-7,48000,65536,0.08242090523506006,-0.0823145024301332,-1.9638804868990447,0.9639868897039714,6,78.94916367822941,198.07338734891314,2043.495451420435],
  ["12AX7|KT88|43|8.0|15|384000",119.43824485024574,1.773848976420287,3.132493860343846e-7,48000,65536,0.08766841182281623,-0.08760756206835181,-1.977487994047593,0.9775488438020573,6,42.434375038145795,192.28638381010705,1195.4644724724985],
  ["12AX7|KT88|43|8.0|16|384000",123.35316273639128,1.8303923529769415,3.1477207119328895e-7,48000,65536,0.08143727200480545,-0.08141051182996988,-1.9720149211081561,0.9720416812829917,6,20.085768338921163,60.61676317089741,1672.4105720631846],
  ["12AT7|EL84|0|6.0|4|352800",169.02594263958017,10.888450751149108,3.119849499856925e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|8|352800",239.07885671839358,15.447122028209387,3.1325092407436276e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|15|352800",327.4096902534158,21.185892178532313,3.1298728611885593e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|16|352800",338.14167010762725,21.87591626208448,3.124060042182769e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|4|384000",169.53648763300677,10.533260354236866,8.075618956080261e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|8|384000",239.80117615233436,14.944758888274452,8.071857253184853e-7,48000,65536,0.033526279142781425,-0.002097155725996535,-1.6365075957935935,0.6679367192103786,6,169396.7336530237,9339.558769011292,15324.324216898467],
  ["12AT7|EL84|0|6.0|15|384000",328.39899483161463,20.49792335033284,8.068814505084908e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.0|16|384000",339.163386954003,21.165398363318936,8.070944309893037e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|4|352800",176.08773659914996,11.378358715754286,3.088672024113991e-7,44160,65536,0.08861915111621385,-0.08849105762174776,-1.9690085988300554,0.9691366923245214,6,81.2198640495159,276.4650201287233,1483.811410285043],
  ["12AT7|EL84|0|6.6|8|352800",249.06740640174593,16.14199288864004,3.0869083575438126e-7,44160,65536,0.08921195600533176,-0.08890056484002673,-1.954450409594325,0.9547618007596299,6,196.3319511680299,472.34148881141994,2127.026223100587],
  ["12AT7|EL84|0|6.6|15|352800",341.0886347213709,22.13881407343797,3.087535420039393e-7,44160,65536,0.08924727304496023,-0.08919672439358142,-1.9643146667238898,0.9643652153752686,6,31.811660947570232,83.03407316467327,1954.3750812650544],
  ["12AT7|EL84|0|6.6|16|352800",352.26898999819355,22.859888800127592,3.0853879565334436e-7,44160,65536,0.08863999088612358,-0.08847533351632196,-1.9727106583386091,0.9728753157084108,6,104.40080894164117,507.9618527852545,1036.1228623044958],
  ["12AT7|EL84|0|6.6|4|384000",176.61695864827652,11.010285419584005,8.148968912154846e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|8|384000",249.8161505609185,15.62140831060509,8.13929948473175e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|15|384000",342.1141314034449,21.42589114920063,8.129330720746692e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|6.6|16|384000",353.32808467890396,22.123599067741623,8.132811177969696e-7,48000,65536,0.03334042004560261,-0.003411853236667646,-1.6490307749315232,0.6789593417404582,6,139313.68628002622,9649.214462630636,14014.341733597488],
  ["12AT7|EL84|0|8.0|4|352800",190.83708024860127,12.376763111232847,3.0597272541801443e-7,44160,65536,0.08833914623457272,-0.08828459562468455,-1.961956818374167,0.962011368984055,6,34.68400552810895,83.86421564434346,2090.76444343763],
  ["12AT7|EL84|0|8.0|8|352800",269.9296123370974,17.558196682542217,3.06009674478232e-7,44160,65536,0.08962174621876576,-0.08957919531553513,-1.9700267946084773,0.970069345511708,6,26.665345066152323,83.9568133694681,1622.3095195469748],
  ["12AT7|EL84|0|8.0|15|352800",369.6586484487282,24.081013472773883,3.0637986066556793e-7,44160,65536,0.09048969586978148,-0.0903155225856748,-1.9723115637927329,0.9724857370768396,6,108.18060795258185,545.1704958068412,1021.403399284811],
  ["12AT7|EL84|0|8.0|16|352800",381.77548555363546,24.865364995401205,3.0619657031730397e-7,44160,65536,0.0896196953638189,-0.08958452686477007,-1.9707953928216675,0.9708305613207164,6,22.038615349070533,70.70557434666617,1591.5171001278586],
  ["12AT7|EL84|0|8.0|4|384000",191.40399100615375,11.982439841315005,8.223231206561137e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|0|8.0|8|384000",270.7316794808316,17.000484360400087,8.202741289666453e-7,48000,65536,0.03411018829809996,-0.0020865219911296784,-1.6394122534867437,0.671435919793714,6,170762.66400822514,10534.637470474872,13809.908137472787],
  ["12AT7|EL84|0|8.0|15|384000",370.75717812974665,23.317244084199068,8.201861211781762e-7,48000,65536,0.03300268419609719,-0.002907693772218918,-1.649978180674176,0.6800731710980543,6,148463.5189726832,10069.635412305703,13493.743266991878],
  ["12AT7|EL84|0|8.0|16|384000",382.9100058914009,24.076562436159954,8.199445663210222e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|EL84|20|6.0|4|352800",125.08577363174301,7.010603633011467,2.9902374791275384e-7,44160,65536,0.09174406204475492,-0.09156626884681465,-1.9732877026902007,0.9734654958881411,6,108.91985140815841,711.1731087997543,798.859463314825],
  ["12AT7|EL84|20|6.0|8|352800",176.92793896919846,9.950136240226767,2.9923195050446735e-7,44160,65536,0.09516015102023573,-0.0950194169213795,-1.9719405771136405,0.9720813112124967,6,83.1025333378033,368.4151379942955,1221.5145550855088],
  ["12AT7|EL84|20|6.0|15|352800",242.2964923146307,13.649738198165647,2.9942549414991365e-7,44160,65536,0.0930141396852882,-0.0924434358487812,-1.9520604743614016,0.9526311781979085,6,345.5781606063525,1249.5884974140693,1475.221866316229],
  ["12AT7|EL84|20|6.0|16|352800",250.23856688305798,14.09388868897276,2.995557385928196e-7,44160,65536,0.09503310660808832,-0.09493990861035459,-1.970020421108066,0.9701136191057997,6,55.092617279683715,198.14428665079845,1505.5594464187286],
  ["12AT7|EL84|20|6.0|4|384000",125.3873793188172,6.807110629483359,8.423018892089229e-7,48000,65536,0.0823076604216148,-0.08214450034133823,-1.9505633439158265,0.9507265039961031,6,121.2706821173872,217.72630692347406,2870.369263000562],
  ["12AT7|EL84|20|6.0|8|384000",177.35465969522596,9.662312224268756,8.414820349950481e-7,48000,65536,0.08570568917359007,-0.08553958546752376,-1.97012953902668,0.9702956427327463,6,118.56109834645792,453.21087810586596,1389.6944306469302],
  ["12AT7|EL84|20|6.0|15|384000",242.88094288313818,13.255559316303327,8.415414471011633e-7,48000,65536,0.08225231024998471,-0.08175729695880268,-1.9551887702552981,0.9556837835464802,6,368.91833666085984,1219.7449758345451,1550.509997012634],
  ["12AT7|EL84|20|6.0|16|384000",250.84216495913955,13.686792284472258,8.407051601302034e-7,48000,65536,0.08146274488021853,-0.08128105484568253,-1.9694294616261658,0.9696111516607019,6,136.46088638830653,495.6757675931133,1390.358432405765],
  ["12AT7|EL84|20|6.6|4|352800",127.65118608067219,7.129885533281095,2.9942733744826286e-7,44160,65536,0.08926660539237426,-0.08911989072071659,-1.9757736903219643,0.9759204049936221,6,92.36137135983044,677.616641615764,690.9940755222607],
  ["12AT7|EL84|20|6.6|8|352800",180.55660084351274,10.119551168777399,2.995508253000718e-7,44160,65536,0.09331821301341069,-0.09328450050341648,-1.9692679569480476,0.9693016694580417,6,20.288588880522912,64.0030656825709,1686.7157292628256],
  ["12AT7|EL84|20|6.6|15|352800",247.26581963219138,13.88222512237802,2.9957917733517985e-7,44160,65536,0.08791680185401202,-0.0876964666827925,-1.956041746712456,0.9562620818836756,6,140.8981960903257,324.9037714354928,2186.3011508505842],
  ["12AT7|EL84|20|6.6|16|352800",255.3707798093265,14.33392927379694,2.994545423922276e-7,44160,65536,0.08972359969326527,-0.08963083433458997,-1.9713316340318348,0.9714243993905102,6,58.08345647070624,209.15398247335784,1418.7334182862176],
  ["12AT7|EL84|20|6.6|4|384000",127.95351590294477,6.925385064213609,8.467583328215849e-7,48000,65536,0.08265583251998841,-0.08225745789728368,-1.9585859168278714,0.9589842914505762,6,295.26923891272145,935.6406833864237,1623.91209295191],
  ["12AT7|EL84|20|6.6|8|384000",180.98434713256643,9.830300826320734,8.441478155052829e-7,48000,65536,0.08429742226603042,-0.08425448896663446,-1.9579036704168864,0.9579466037162825,6,31.134503515848024,63.95209338786039,2561.7677097924325],
  ["12AT7|EL84|20|6.6|15|384000",247.85167559838777,13.486091695667566,8.441047129198761e-7,48000,65536,0.08163738258127985,-0.08158656520390961,-1.9622854064933049,0.9623362238706751,6,38.05482559402627,85.58123718579834,2260.7273398520983],
  ["12AT7|EL84|20|6.6|16|384000",255.97582928333188,13.924814420476553,8.434761690849521e-7,48000,65536,0.08352530252908208,-0.08333581823504865,-1.9595019049298292,0.9596913892238625,6,138.8032388340005,330.82400413225537,2183.682457141012],
  ["12AT7|EL84|20|8.0|4|352800",132.20383227292228,7.314511457259225,2.9579639445614665e-7,44160,65536,0.0879548587395308,-0.08786300409750358,-1.9688887330350302,0.9689805876770574,6,58.67010366903042,185.77901802540657,1583.5425355315497],
  ["12AT7|EL84|20|8.0|8|352800",186.99612364875009,10.381931028165265,2.9554588531403214e-7,44160,65536,0.08804785895293024,-0.08799833858781295,-1.962027920383178,0.9620774407482953,6,31.589001920225954,75.9819510245628,2094.790419767677],
  ["12AT7|EL84|20|8.0|15|352800",256.0845292432741,14.242395217527404,2.9672442805599533e-7,44160,65536,0.0895573726209339,-0.08948829031213382,-1.95327764242771,0.9533467247365103,6,43.3293090437573,85.89523010446128,2596.755313620936],
  ["12AT7|EL84|20|8.0|16|352800",264.4785501466356,14.705786362229931,2.960685319417503e-7,44160,65536,0.09189984287900217,-0.09167077220017462,-1.959493663233351,0.9597227339121787,6,140.1345647345368,382.8450103710845,1925.5239080054803],
  ["12AT7|EL84|20|8.0|4|384000",132.50487966102324,7.109139829131549,8.56944498132032e-7,48000,65536,0.08241504317896624,-0.08222882155066574,-1.9650313345215005,0.9652175561498009,6,138.2503071255093,401.84658017729544,1761.7493892532088],
  ["12AT7|EL84|20|8.0|8|384000",187.4220580709876,10.09144557091441,8.560757885711176e-7,48000,65536,0.08367999994869549,-0.08351356948924116,-1.9741892471146898,0.9743556775741441,6,121.67314604554818,772.5620801637949,815.1494982141614],
  ["12AT7|EL84|20|8.0|15|384000",256.66790517393713,13.844567676412803,8.548114943277559e-7,48000,65536,0.08138608636634467,-0.08132381775352072,-1.973647771282257,0.9737100398950811,6,46.77745338301286,160.59450581059681,1467.627481912892],
  ["12AT7|EL84|20|8.0|16|384000",265.0810381410961,14.294922322118925,8.55075475415042e-7,48000,65536,0.08299386428555787,-0.08284013088341992,-1.971311247687686,0.9714649810898238,6,113.31206409668164,437.39757560607336,1331.8995819074098],
  ["12AT7|EL84|43|6.0|4|352800",100.03621143172083,5.127227931851495,2.972763536316623e-7,44160,65536,0.09195697149945102,-0.09178201253029221,-1.972839927828073,0.9730148867972318,6,106.93348862661055,592.9507443446328,943.0791507473554],
  ["12AT7|EL84|43|6.0|8|352800",141.4966422368263,7.279380323877119,2.9753043435106787e-7,44160,65536,0.1005240417486018,-0.10047028575148619,-1.9727446504975332,0.9727984064946488,6,30.034598812687555,120.31187266703137,1428.2118620179604],
  ["12AT7|EL84|43|6.0|15|352800",193.77468633239607,9.987545927347442,2.9728437186264964e-7,44160,65536,0.08984899746616627,-0.08981418159070537,-1.9622794732958329,0.9623142891712937,6,21.76190696631496,53.1855384554773,2103.7653150416345],
  ["12AT7|EL84|43|6.0|16|352800",200.126284616475,10.312310473117565,2.982283393008738e-7,44160,65536,0.09523614857861257,-0.09519111166637235,-1.9714708000193344,0.9715158369315745,6,26.559396356257317,94.25526348371461,1528.3471517719224],
  ["12AT7|EL84|43|6.0|4|384000",100.24237712759542,4.992913657913613,8.607333885444707e-7,48000,65536,0.08436566156253708,-0.0843281661190211,-1.9745124207145346,0.9745499161580505,6,27.168187217799293,95.87567360297356,1479.6536955470397],
  ["12AT7|EL84|43|6.0|8|384000",141.78833621813467,7.089395757887858,8.592403150500081e-7,48000,65536,0.08485041566011432,-0.08473052425762212,-1.9770845388090583,0.9772044302115506,6,86.4156550993317,496.0095305647721,913.2775560443475],
  ["12AT7|EL84|43|6.0|15|384000",194.17420239350326,9.727351164787951,8.592285399040145e-7,48000,65536,0.0852559543403032,-0.08512445815151988,-1.9737848531539455,0.9739163493427286,6,94.33545276774565,414.4436574172133,1200.8305649829963],
  ["12AT7|EL84|43|6.0|16|384000",200.53888916588383,10.043590228909716,8.586887606152418e-7,48000,65536,0.09023413479343846,-0.09010197527841529,-1.9752777137224218,0.9754098732374451,6,89.57713503191434,479.69071644566054,1041.9332245149226],
  ["12AT7|EL84|43|6.6|4|352800",100.58291286300826,5.1238751739827615,2.9891372426356984e-7,44160,65536,0.09662114393454149,-0.09652934258284833,-1.9681380846975065,0.9682298860491998,6,53.37427708910728,180.15180658593195,1632.687781725126],
  ["12AT7|EL84|43|6.6|8|352800",142.26993473120532,7.274786020616714,2.9733122383979025e-7,44160,65536,0.08865863185289777,-0.08859879341009924,-1.9715365408254146,0.9715963792682131,6,37.910068287831784,128.4979209049418,1489.449651251908],
  ["12AT7|EL84|43|6.6|15|352800",194.83368916921148,9.981355978942052,2.9777037881854373e-7,44160,65536,0.08858311128122391,-0.08847105250367339,-1.9692214872134235,0.969333545990974,6,71.07526664671649,237.4080021709315,1511.4642741799644],
  ["12AT7|EL84|43|6.6|16|352800",201.2199988677884,10.305903420561227,2.9775378978882406e-7,44160,65536,0.09163253202985963,-0.09140356343272435,-1.967001211387791,0.9672301799849264,6,140.4811684333671,559.9042562432511,1310.940522098724],
  ["12AT7|EL84|43|6.6|4|384000",100.78509250820166,4.9914490371876195,8.65680928793262e-7,48000,65536,0.08789679600441351,-0.08786545497777634,-1.9753515692623496,0.9753829102889867,6,21.795607019998144,82.24985598145359,1441.0635048299418],
  ["12AT7|EL84|43|6.6|8|384000",142.5559903238411,7.0874707550411244,8.639462002492027e-7,48000,65536,0.08725126591429143,-0.08722102140889573,-1.9556927069411332,0.955722951446529,6,21.1885573388154,42.39593578462143,2725.3543208455685],
  ["12AT7|EL84|43|6.6|15|384000",195.22548340504315,9.724815748865566,8.637766264396554e-7,48000,65536,0.08151441986553735,-0.08147651379073492,-1.9771114402982735,0.9771493463730759,6,28.42671839663638,109.93775882002572,1302.794432016865],
  ["12AT7|EL84|43|6.6|16|384000",201.62462853861842,10.040957627362108,8.641606210465066e-7,48000,65536,0.08140770295614166,-0.08137671818675772,-1.9756787487574583,0.9757097335268422,6,23.2657354487915,82.48688823729763,1420.3518270079044],
  ["12AT7|EL84|43|8.0|4|352800",100.99984595483038,5.0752333056782435,2.943854236447127e-7,44160,65536,0.09170464911463018,-0.09164568182377276,-1.9722733330488587,0.9723323003397161,6,36.116711158919074,130.47710831933193,1444.9566921849218],
  ["12AT7|EL84|43|8.0|8|352800",142.85968650362096,7.2060964886962715,2.9437224412397227e-7,44160,65536,0.0901104536315616,-0.09002287450062535,-1.9758430589427896,0.9759306380737257,6,54.59907639538427,249.9931024091886,1118.0288545799651],
  ["12AT7|EL84|43|8.0|15|352800",195.64134662520738,9.887365291747097,2.9480994735862057e-7,44160,65536,0.08914298093070318,-0.08909612879190419,-1.9770195040905203,0.9770663562293194,6,29.51923719481809,127.1149191269069,1175.6018405007096],
  ["12AT7|EL84|43|8.0|16|352800",202.05412816336457,10.20882107647826,2.946980703905676e-7,44160,65536,0.08973491283392881,-0.08952095857599578,-1.9695776212049085,0.9697915754628416,6,134.0375417441182,623.1566377951353,1099.1899722005994],
  ["12AT7|EL84|43|8.0|4|384000",101.19242006652273,4.947007762714628,8.752221756927976e-7,48000,65536,0.08253913002274912,-0.08231407836990776,-1.9699910613951146,0.970216113047956,6,166.8654501879807,906.1417223046885,941.773085918232],
  ["12AT7|EL84|43|8.0|8|384000",143.13215443958475,7.024719978421394,8.742204615359959e-7,48000,65536,0.08276008389807168,-0.08260805131347534,-1.9674752599265073,0.9676272925111036,6,112.37412513772034,346.83305109548115,1664.373744904687],
  ["12AT7|EL84|43|8.0|15|384000",196.01453214428219,9.638955990531866,8.724696928131761e-7,48000,65536,0.08505557257116686,-0.0849461953132879,-1.9745431179021986,0.9746524951600776,6,78.64208245373662,335.426963650859,1233.669859779204],
  ["12AT7|EL84|43|8.0|16|384000",202.43953921754976,9.952273054448911,8.734398070798812e-7,48000,65536,0.08366277359591054,-0.08363288021566297,-1.9745467316893826,0.97457662506963,6,21.840960036395817,75.48120650263158,1498.3732293870505],
  ["12AT7|EL34|0|6.0|4|352800",154.51606534494658,6.952098974347991,2.8089050502584144e-7,44160,65536,0.09698675645184551,-0.0969285967635892,-1.973881768191605,0.9739399278798614,6,33.68128026126257,138.1938017963578,1344.4800169968762],
  ["12AT7|EL34|0|6.0|8|352800",218.55616361876397,9.875350079581837,2.7965400962070074e-7,44160,65536,0.08848383128011786,-0.0882573550703062,-1.9697777117261224,0.970004187935934,6,143.900984093678,777.047297452456,932.9906337581247],
  ["12AT7|EL34|0|6.0|15|352800",299.3051771206179,13.552804768141025,2.802283410713401e-7,44160,65536,0.0961957339538654,-0.09612138529829958,-1.9696663504634442,0.96974069911901,6,43.41440966954342,151.21785924796833,1574.0745122812327],
  ["12AT7|EL34|0|6.0|16|352800",309.11585671664915,13.993012239347811,2.796874283960977e-7,44160,65536,0.0883005846949472,-0.08814586629763961,-1.9741220010648013,0.9742767194621089,6,98.47088601479724,528.9101546237416,934.3502157445173],
  ["12AT7|EL34|0|6.0|4|384000",154.78361520906458,6.778905263329148,8.83190368664315e-7,48000,65536,0.08138518264415393,-0.08127239326474738,-1.977561091909194,0.9776738812886004,6,84.7569524437231,466.36818811862815,913.5659338456641],
  ["12AT7|EL34|0|6.0|8|384000",218.93471698268007,9.630357058024963,8.82555929600413e-7,48000,65536,0.0890256211296907,-0.08892395788256376,-1.9768037087584,0.976905372005527,6,69.83102406752619,359.5792893924814,1068.4141067168705],
  ["12AT7|EL34|0|6.0|15|384000",299.82366462685883,13.21725889361008,8.80976177528366e-7,48000,65536,0.08362432545791254,-0.0835616789946525,-1.9766405624077832,0.9767032088710432,6,45.80132171986815,189.18886867778798,1251.453223630012],
  ["12AT7|EL34|0|6.0|16|384000",309.6513296908334,13.646474133276369,8.816283823974315e-7,48000,65536,0.08344608010919406,-0.08330610605682544,-1.9739091102431539,0.9740490842955225,6,102.60238434195426,463.118547499595,1143.8268178952303],
  ["12AT7|EL34|0|6.6|4|352800",159.60306700811356,7.2366464740370615,2.807105601448561e-7,44160,65536,0.09074000880925716,-0.09066128559228545,-1.9770101652648546,0.9770888884818262,6,48.73502377814634,235.57663560458826,1065.8452597428122],
  ["12AT7|EL34|0|6.6|8|352800",225.75148826198043,10.279210571499423,2.8112516518399855e-7,44160,65536,0.0975427448899278,-0.09739805024779104,-1.9663713635461564,0.9665160581882931,6,83.35439437022342,285.1693536903665,1627.1470952736945],
  ["12AT7|EL34|0|6.6|15|352800",309.15891731534714,14.10682812031852,2.806171492882788e-7,44160,65536,0.10124723364815504,-0.10117969461555842,-1.974740760193651,0.9748082992262477,6,37.468410581796945,170.93367485522575,1261.6988553989283],
  ["12AT7|EL34|0|6.6|16|352800",319.29258603353077,14.565062708394855,2.7967030425278497e-7,44160,65536,0.10129173014534067,-0.10124388918819233,-1.9722476074257398,0.9722954483828883,6,26.5263294685316,103.78995435945319,1473.7719988082436],
  ["12AT7|EL34|0|6.6|4|384000",159.87730448193955,7.059155505516894,8.782907274110267e-7,48000,65536,0.08184656718595472,-0.08174813979407397,-1.9686445656403364,0.9687429930322171,6,73.54076330479496,216.63355817654792,1724.146004782747],
  ["12AT7|EL34|0|6.6|8|384000",226.139504277735,10.028137974997271,8.779653172612078e-7,48000,65536,0.08329276084238314,-0.08316699125409205,-1.977122160138373,0.9772479297266642,6,92.35232428291299,563.9514149202503,842.6152221243108],
  ["12AT7|EL34|0|6.6|15|384000",309.690365738177,13.762955037831244,8.769914453700305e-7,48000,65536,0.09266407641043821,-0.09263300107617971,-1.9740592063745548,0.9740902817088132,6,20.498807394779334,76.99538716176362,1527.3651524449715],
  ["12AT7|EL34|0|6.6|16|384000",319.8414444628634,14.209924727019102,8.777551664781152e-7,48000,65536,0.08472533658464283,-0.08460386950093947,-1.9757141064509738,0.9758355735346773,6,87.6815379221881,432.1126046547471,1062.8443824558065],
  ["12AT7|EL34|0|8.0|4|352800",169.70383593704466,7.782624475902745,2.7601592027702623e-7,44160,65536,0.09365278512012382,-0.09349539429266046,-1.967203394734283,0.9673607855617465,6,94.4436184845923,328.7808579888579,1534.482487887286],
  ["12AT7|EL34|0|8.0|8|352800",240.0385559353014,11.054213317541695,2.7793045041244855e-7,44160,65536,0.09228437914727604,-0.09222084010503509,-1.97004926195853,0.9701128010007709,6,38.67325521858024,129.16544697422813,1574.5856377709247],
  ["12AT7|EL34|0|8.0|15|352800",328.7245498797852,15.170054569223323,2.7765930722705363e-7,44160,65536,0.0925881545484988,-0.09251805736489498,-1.971499750643492,0.9715698478270958,6,42.52636870676124,152.87444967639374,1466.606431147246],
  ["12AT7|EL34|0|8.0|16|352800",339.4995469186444,15.662876412033853,2.7824745774743133e-7,44160,65536,0.08876575914159081,-0.08867926101128684,-1.9774343758215946,0.9775208739518986,6,54.742123804423706,275.5303682812321,1001.0723266075322],
  ["12AT7|EL34|0|8.0|4|384000",169.99036661156822,7.5972872645837,8.817796637591348e-7,48000,65536,0.09120665937682947,-0.09108111962648605,-1.9755391621344867,0.97566470188483,6,84.17926461630219,449.44255831176355,1056.2168674895677],
  ["12AT7|EL34|0|8.0|8|384000",240.44396677881363,10.792040022752985,8.810482708678269e-7,48000,65536,0.08261277010336296,-0.08247696989417472,-1.9757776101492865,0.9759134103584748,6,100.5453071172856,540.9726678063544,949.1096798886122],
  ["12AT7|EL34|0|8.0|15|384000",329.27982398332654,14.810976208376506,8.806728535328297e-7,48000,65536,0.08719898018843313,-0.08705546444247406,-1.9760358834010652,0.9761793991470243,6,100.66932075129459,722.3428007867552,751.0845627442993],
  ["12AT7|EL34|0|8.0|16|384000",340.0730113776839,15.292035199020821,8.804937546398039e-7,48000,65536,0.08683837830583076,-0.08674954633485533,-1.974431432843208,0.9745202648141835,6,62.550556356032345,253.9613385359091,1323.4275394907033],
  ["12AT7|EL34|20|6.0|4|352800",100.93480571022465,4.1697413476379745,2.7850715932751655e-7,44160,65536,0.10058152388439101,-0.100378900952135,-1.9703113218687132,0.9705139448009693,6,113.22880053124268,600.2646811780232,1080.2731090331256],
  ["12AT7|EL34|20|6.0|8|352800",142.7679342558533,5.925289429086567,2.7724547016157085e-7,44160,65536,0.09308970511833659,-0.09295460334815082,-1.9748366519332392,0.974971753703425,6,81.54989967331537,437.7264253797818,985.4917643606373],
  ["12AT7|EL34|20|6.0|15|352800",195.5158632660568,8.133324214138018,2.784317880903636e-7,44160,65536,0.08894424739415598,-0.08890577473925078,-1.9762446893526393,0.9762831620075445,6,24.2927647178174,98.24660647987712,1249.4966585670472],
  ["12AT7|EL34|20|6.0|16|352800",201.92450817301835,8.397288452764759,2.786739374633025e-7,44160,65536,0.09620894919224715,-0.09605840855419047,-1.9746084877738939,0.9747590284119505,6,87.92795790354324,532.2103198337352,903.2603268368388],
  ["12AT7|EL34|20|6.0|4|384000",101.07714626843163,4.08146857481859,8.990272484709878e-7,48000,65536,0.08433767987899865,-0.0842436954585078,-1.9762868910876923,0.9763808755081831,6,68.14400772289177,308.22441141308974,1152.5904572509326],
  ["12AT7|EL34|20|6.0|8|384000",142.96933704550972,5.800410951626937,8.983888595673357e-7,48000,65536,0.09537045413977424,-0.09513246871314904,-1.9677891089184716,0.9680270943450968,6,152.69692714827264,705.6294558475851,1280.3310061395691],
  ["12AT7|EL34|20|6.0|15|384000",195.79171913960204,7.962277922288424,8.975610329089701e-7,48000,65536,0.08670437222286921,-0.08664585253394685,-1.9736285274178256,0.9736870471067478,6,41.26282594429773,149.66587853655307,1479.9992824588128],
  ["12AT7|EL34|20|6.0|16|384000",202.20940056707715,8.220640502525832,8.978465626588208e-7,48000,65536,0.08280826733991652,-0.08276496158421158,-1.975120253654492,0.9751635594101968,6,31.96957515536505,115.1973264488258,1421.861657439025],
  ["12AT7|EL34|20|6.6|4|352800",101.67871010357987,4.223786874860923,2.8241176039910306e-7,44160,65536,0.0976628908545942,-0.09761722839255726,-1.975297766746396,0.975343429208433,6,26.259110106740682,113.1137580707992,1288.703245374055],
  ["12AT7|EL34|20|6.6|8|352800",143.8201486715018,6.0019365127368,2.784684643252627e-7,44160,65536,0.09335444939046057,-0.0932385384238165,-1.9738430465476964,0.9739589575143406,6,69.76024037804989,318.32380300605695,1163.252924562826],
  ["12AT7|EL34|20|6.6|15|352800",196.95683088975073,8.238428822746126,2.81281876997003e-7,44160,65536,0.0900502378774056,-0.08993318296016556,-1.973689685522902,0.973806740440142,6,73.03582263991717,319.36753470715234,1170.985369615796],
  ["12AT7|EL34|20|6.6|16|352800",203.41270860755725,8.505818763034693,2.797552691598236e-7,44160,65536,0.09247611575036901,-0.09237153868141698,-1.9743853824780098,0.9744899595469618,6,63.53327918211313,286.92322178421597,1164.0489645503687],
  ["12AT7|EL34|20|6.6|4|384000",101.81983071292925,4.135024989409672,9.058413105569252e-7,48000,65536,0.08213964816411311,-0.08203524515325154,-1.9768637627384529,0.9769681657493144,6,77.72982516468967,376.6672180867735,1047.3979085012784],
  ["12AT7|EL34|20|6.6|8|384000",144.01982630084103,5.876365431296532,9.051030922313353e-7,48000,65536,0.08131071676593599,-0.08126134483857839,-1.9758264452655778,0.9758758171929353,6,37.12064665889839,137.80159047883768,1354.6350329819043],
  ["12AT7|EL34|20|6.6|15|384000",197.23032462104996,8.06643333683291,9.050206225597806e-7,48000,65536,0.08130935732531266,-0.08110607802459117,-1.9711277200758985,0.9713309993766199,6,152.98450159041016,748.510021060549,1029.2165950686494],
  ["12AT7|EL34|20|6.6|16|384000",203.6951613890589,8.328190698274339,9.050627021579216e-7,48000,65536,0.08916310484922728,-0.08907577573509878,-1.9767994038596688,0.9768867329737972,6,59.88774976930561,289.5976852595393,1139.5617854861835],
  ["12AT7|EL34|20|8.0|4|352800",102.49496888061395,4.295333598138367,2.757527076449083e-7,44160,65536,0.09834856261091854,-0.09826131670919303,-1.9690962309714461,0.9691834768731716,6,49.833160451592526,176.74276644474756,1580.8231251399288],
  ["12AT7|EL34|20|8.0|8|352800",144.97470138980026,6.103358069868385,2.743632489327345e-7,44160,65536,0.09018936897402721,-0.09009222599252752,-1.9748702321689984,0.974967375150498,6,60.51162040346978,268.5729969457045,1154.8973597956083],
  ["12AT7|EL34|20|8.0|15|352800",198.537944789783,8.377474956464361,2.7327597807792115e-7,44160,65536,0.08998902676412479,-0.08994511643157485,-1.976337190232191,0.9763811005647408,6,27.405129483927233,114.08781525438174,1228.0229027444998],
  ["12AT7|EL34|20|8.0|16|352800",205.0456494927563,8.649401264491889,2.7364179503600923e-7,44160,65536,0.09129292181798973,-0.09111461026945383,-1.9693198341049691,0.9694981456535049,6,109.77805862259726,439.1093843584886,1300.2290591023382],
  ["12AT7|EL34|20|8.0|4|384000",102.632535000521,4.205651011938234,9.061151163306068e-7,48000,65536,0.08587554184833802,-0.08583901017946945,-1.9758291590920412,0.9758656907609097,6,26.004216280721764,99.0853615400051,1393.9854462480998],
  ["12AT7|EL34|20|8.0|8|384000",145.1693518227934,5.976483196486417,9.037449861719782e-7,48000,65536,0.08438055825023523,-0.08428056210055077,-1.9761644386801607,0.9762644348298452,6,72.46857134741275,333.017006991,1135.0867738292604],
  ["12AT7|EL34|20|8.0|15|384000",198.80455430475328,8.203692887115098,9.046989654335218e-7,48000,65536,0.08338974822435911,-0.08321952146647923,-1.9708986752667272,0.9710689020246072,6,124.88496882783869,497.60583906256664,1296.6139928220614],
  ["12AT7|EL34|20|8.0|16|384000",205.32099232094276,8.469928178429246,9.049090395047186e-7,48000,65536,0.08614762684232405,-0.086101435300528,-1.9771576195314955,0.9772038110732916,6,32.77833991789103,137.1930909573447,1272.13271728866],
  ["12AT7|EL34|43|6.0|4|352800",74.67392181481699,2.9545771818682924,2.74216517339564e-7,44160,65536,0.11032072959971129,-0.11011411027159942,-1.9712059289769426,0.9714125483050544,6,105.26149642896557,768.168468031198,860.4039483561426],
  ["12AT7|EL34|43|6.0|8|352800",105.62308064923907,4.199369579172809,2.7658913281897243e-7,44160,65536,0.09690936913377787,-0.09673839698012635,-1.9725488664797934,0.9727198386334448,6,99.14976918402462,538.9189955150342,1014.1398544059607],
  ["12AT7|EL34|43|6.0|15|352800",144.64726519541563,5.764832469937848,2.750299421030386e-7,44160,65536,0.09978632172350949,-0.09973809295190654,-1.9741348607831612,0.9741830895547642,6,27.14493882682923,113.69623257572991,1354.96050936378],
  ["12AT7|EL34|43|6.0|16|352800",149.38852905389487,5.951846623958246,2.7590130205356545e-7,44160,65536,0.09243363844781428,-0.09239905382255172,-1.972176315460039,0.9722109000853015,6,21.01275484466168,73.27379554548804,1509.1710168745158],
  ["12AT7|EL34|43|6.0|4|384000",74.76740066982188,2.89877210877261,9.094794228241055e-7,48000,65536,0.09461319070680095,-0.09446213324979764,-1.9753978774318184,0.9755489348888217,6,97.65371286572046,724.9866302866157,787.9248539310993],
  ["12AT7|EL34|43|6.0|8|384000",105.7553501036541,4.120417463307397,9.107209804680787e-7,48000,65536,0.08564236795432928,-0.08560152247768756,-1.9775158467355651,0.9775566922122069,6,29.1548118074744,121.94660280880505,1265.3135797100324],
  ["12AT7|EL34|43|6.0|15|384000",144.82843261800997,5.656686265396514,9.105908861655124e-7,48000,65536,0.09086940089091157,-0.09072264431591931,-1.9734898043125253,0.9736365608875175,6,98.78299602273829,483.2148556084059,1149.6192603833051],
  ["12AT7|EL34|43|6.0|16|384000",149.5756309700907,5.840159569535856,9.112327688530074e-7,48000,65536,0.08357924693410147,-0.0833551850234117,-1.9693070318837853,0.9695310937944751,6,164.0603840717648,735.4901826356285,1155.5903479140834],
  ["12AT7|EL34|43|6.6|4|352800",74.10291065125149,2.9472351861106207,2.763345686121893e-7,44160,65536,0.0914107850922311,-0.09137243032999251,-1.9743577451204253,0.974396099882664,6,23.56468789679013,89.62900613346129,1366.751610680417],
  ["12AT7|EL34|43|6.6|8|352800",104.81540552303754,4.188830009993923,2.751901176700866e-7,44160,65536,0.09176209206712393,-0.09172683362701266,-1.9716181375517094,0.9716533959918208,6,21.579031336702776,73.1557584667004,1541.4968370859335],
  ["12AT7|EL34|43|6.6|15|352800",143.54117843931851,5.750292409871455,2.764792427039666e-7,44160,65536,0.09076051324304339,-0.09058350161282862,-1.9731041343787916,0.9732811460090064,6,109.61687501919792,648.8714192936338,871.7955316720668],
  ["12AT7|EL34|43|6.6|16|352800",148.24618722721752,5.936844798041136,2.760896541947365e-7,44160,65536,0.0881538885165406,-0.08787237622941514,-1.9623856633696621,0.9626671756567877,6,179.59694950796705,581.9253030957453,1554.4388292046208],
  ["12AT7|EL34|43|6.6|4|384000",74.1940401592593,2.8914937361530257,9.130331013882806e-7,48000,65536,0.08539965604638514,-0.08527362390857261,-1.9772697389316491,0.9773957710694616,6,90.2603885864431,589.2225366809632,808.0990422229436],
  ["12AT7|EL34|43|6.6|8|384000",104.94435168191775,4.109967595303485,9.17205326949927e-7,48000,65536,0.0843848090961469,-0.08433354486961138,-1.973348494191416,0.9733997584179516,6,37.139276962191865,127.67615761325555,1520.023937834399],
  ["12AT7|EL34|43|6.6|15|384000",143.71779446631368,5.642268864424379,9.150339204202616e-7,48000,65536,0.0865649032431803,-0.08650286719189516,-1.9763429425148522,0.9764049785661375,6,43.81363820923654,183.84735036080212,1275.4588322476015],
  ["12AT7|EL34|43|6.6|16|384000",148.42858861893276,5.825284471893028,9.171532719275615e-7,48000,65536,0.08168100955935301,-0.08151214504708176,-1.9714872649460509,0.9716561294583221,6,126.47886481616005,515.1048306421675,1242.168240739903],
  ["12AT7|EL34|43|8.0|4|352800",72.48395383299409,2.909743120442242,2.8077464122983926e-7,44160,65536,0.08935306719116504,-0.08919876430943735,-1.9750977074174847,0.9752520102992124,6,97.04843569454503,655.0219296433112,752.058245459283],
  ["12AT7|EL34|43|8.0|8|352800",102.52545283815907,4.135360454841333,2.8064120487443476e-7,44160,65536,0.08969262204309693,-0.089169817074633,-1.9528285187947765,0.9533513237632404,6,328.2467977406278,1008.4332840660483,1673.9463885318808],
  ["12AT7|EL34|43|8.0|15|352800",140.40516016472478,5.6767656418571395,2.818165020600071e-7,44160,65536,0.09020908903594277,-0.09016582641905545,-1.9754616914257936,0.9755049540426809,6,26.934899363607133,107.46433351425624,1285.054563976522],
  ["12AT7|EL34|43|8.0|16|352800",145.00737687527183,5.860950235280079,2.7997162108166503e-7,44160,65536,0.0925287001572067,-0.09249372111545379,-1.969937746789077,0.9699727258308299,6,21.230599453472156,68.12040607521692,1643.7387766233928],
  ["12AT7|EL34|43|8.0|4|384000",72.56996903166605,2.8540266703322867,9.289334434873371e-7,48000,65536,0.08233442140964982,-0.0822574014194136,-1.9747468983671514,0.9748239183573876,7,57.19743949918386,217.25812857513097,1341.090563662419],
  ["12AT7|EL34|43|8.0|8|384000",102.64716435488366,4.056532914637207,9.287972848433241e-7,48000,65536,0.08355238548831213,-0.08341063061549922,-1.9761606297473315,0.9763023846201444,7,103.77653627209602,697.6557202156355,768.0723976404585],
  ["12AT7|EL34|43|8.0|15|384000",140.5718681384711,5.568789850037388,9.274421553518938e-7,48000,65536,0.08515725684453719,-0.08493467103347778,-1.969912167921219,0.9701347537322784,7,159.95409844989823,806.625598484485,1046.4143808552662],
  ["12AT7|EL34|43|8.0|16|384000",145.17954552745744,5.7494391233396565,9.278862887168003e-7,48000,65536,0.08279511886638866,-0.08229806895039954,-1.9554076937934166,0.9559047437094058,7,368.00482693415233,1361.6996804143341,1394.4266342038313],
  ["12AT7|6L6GC|0|6.0|4|352800",79.21850800530689,3.3711668171803044,3.1065624690829687e-7,44160,65536,0.09369344627669804,-0.09357666938214047,-1.9724001242182545,0.9725169011128121,6,70.02727120187403,293.71848642665236,1271.0560729263868],
  ["12AT7|6L6GC|0|6.0|8|352800",112.05114009777772,4.789852518751421,3.1151424855831856e-7,44160,65536,0.09478667522827883,-0.09463223739806864,-1.9737184728368116,0.9738729106670218,6,91.56071009077121,500.2552688077836,986.2823784893488],
  ["12AT7|6L6GC|0|6.0|15|352800",153.4502328697192,6.574328931451794,3.114920650295435e-7,44160,65536,0.08838099296527269,-0.08803127473568007,-1.9618789264502956,0.9622286446798883,6,222.62234913828297,869.9891180014529,1291.9592093963315],
  ["12AT7|6L6GC|0|6.0|16|352800",158.4800475079804,6.787758189865932,3.11572317936393e-7,44160,65536,0.1031744911633472,-0.10307351732884805,-1.9737224563393858,0.9738234301738848,6,54.97912499924227,263.0559538880907,1226.334625766933],
  ["12AT7|6L6GC|0|6.0|4|384000",79.3251809378715,3.306429269090845,9.133448785844946e-7,48000,65536,0.08679382933733079,-0.08675223059791802,-1.9724976848608566,0.9725392836002694,6,29.29859348174719,98.25371976638593,1603.4957055090617],
  ["12AT7|6L6GC|0|6.0|8|384000",112.20207660654383,4.698266788113236,9.104780197867382e-7,48000,65536,0.0819027832490573,-0.08180653290709884,-1.9768471903257316,0.9769434406676901,6,71.86381827908595,332.8388384207741,1092.773016970481],
  ["12AT7|6L6GC|0|6.0|15|384000",153.6569670968946,6.448881275957795,9.12256679966684e-7,48000,65536,0.08866870358769591,-0.0885248224474961,-1.97422420331969,0.9743680844598898,6,99.25158877625142,501.6374689141705,1085.29590475608],
  ["12AT7|6L6GC|0|6.0|16|384000",158.69355387335892,6.658202621626644,9.117811643152399e-7,48000,65536,0.08423471632105374,-0.08419766615114455,-1.9779179856236513,0.9779550357935605,6,26.887224341639598,111.90720848721494,1250.4541545602067],
  ["12AT7|6L6GC|0|6.6|4|352800",82.47502019229607,3.528279909362685,3.0698005843352773e-7,44160,65536,0.09047393352644136,-0.09040765448896013,-1.9700770537642835,0.9701433328017647,6,41.14912018295434,135.42359476553992,1566.5603454862726],
  ["12AT7|6L6GC|0|6.6|8|352800",116.65733012081786,5.012965583882182,3.0634380604185017e-7,44160,65536,0.08853490716288308,-0.0884585373707104,-1.9679557492250344,0.9680321190172072,6,48.45550879842673,145.79134712798202,1678.518374816192],
  ["12AT7|6L6GC|0|6.6|15|352800",159.75825028764172,6.880482745618394,3.061952469167843e-7,44160,65536,0.09053668505563658,-0.09039534006239087,-1.9708693941042994,0.971010739097545,6,87.72912088106662,346.43579521010787,1305.3669158228124],
  ["12AT7|6L6GC|0|6.6|16|352800",164.99483057205205,7.103862206793605,3.080192540192926e-7,44160,65536,0.0914930384143369,-0.09141587847474263,-1.9732355844426586,0.9733127443822529,6,47.37352819314939,184.83979208214777,1334.0042369408789],
  ["12AT7|6L6GC|0|6.6|4|384000",82.58574667172998,3.4608789521891534,9.170239002188098e-7,48000,65536,0.09110585206900737,-0.09097333564320723,-1.974262006924232,0.9743945233500322,6,88.95919305414876,436.4650595425143,1148.8100044545781],
  ["12AT7|6L6GC|0|6.6|8|384000",116.81400232305951,4.917611704425949,9.14084786143989e-7,48000,65536,0.08098474566092016,-0.08080677981482305,-1.9714616055488983,0.9716395713949955,6,134.45049970392677,565.1852571479504,1193.1292967919578],
  ["12AT7|6L6GC|0|6.6|15|384000",159.97284076455273,6.749873771849838,9.134308087968422e-7,48000,65536,0.08414779195561504,-0.08411566641146086,-1.9724858836480261,0.9725180091921805,6,23.336839467654404,74.72045502092871,1628.365893390937],
  ["12AT7|6L6GC|0|6.6|16|384000",165.21645048172243,6.9689762820156815,9.136356319823976e-7,48000,65536,0.08243830443458218,-0.08240906084069226,-1.97902855118865,0.97905779478254,6,21.683535238347517,91.86612693479289,1201.619170480245],
  ["12AT7|6L6GC|0|8.0|4|352800",89.22384844791401,3.8507992091077456,3.095102333108666e-7,44160,65536,0.09526935309921658,-0.0951623418244975,-1.9755531398329942,0.9756601511077132,6,63.10576764606115,321.63778324840786,1061.9487137211063],
  ["12AT7|6L6GC|0|8.0|8|352800",126.20324514425943,5.470985817473289,3.119048856639113e-7,44160,65536,0.09766977829368126,-0.09757253990355128,-1.9753460016579627,0.9754432400480927,6,55.92970699917396,277.4999229952513,1118.5713316620659],
  ["12AT7|6L6GC|0|8.0|15|352800",172.83105031799002,7.508986058097383,3.0792406991175766e-7,44160,65536,0.09107445868647394,-0.09098934149364017,-1.9760704739616062,0.97615559115444,6,52.50158613170899,244.58572786108434,1110.495115423249],
  ["12AT7|6L6GC|0|8.0|16|352800",178.4961336718293,7.752790749292275,3.089615690145146e-7,44160,65536,0.09124875245662836,-0.09115978737410489,-1.9734035614493743,0.9734925265318977,6,54.77131364905073,220.76078222786737,1287.712673612709],
  ["12AT7|6L6GC|0|8.0|4|384000",89.34280983013248,3.7778900757471314,9.158679257710744e-7,48000,65536,0.08421286315992339,-0.08414639831418375,-1.9741036609626048,0.9741701258083445,6,48.25433815899743,176.80798465005097,1422.5432534271001],
  ["12AT7|6L6GC|0|8.0|8|384000",126.37156983369299,5.367839118694577,9.147899408086546e-7,48000,65536,0.08364310015742427,-0.08357805501938143,-1.973471375758427,0.9735364208964699,6,47.54501557933369,167.29135182314704,1471.8289087484081],
  ["12AT7|6L6GC|0|8.0|15|384000",173.06160108791727,7.3677028779658915,9.152154327361651e-7,48000,65536,0.08111002454061438,-0.08100712120585542,-1.977789021627872,0.977891924962631,6,77.58574061333015,403.819102334133,962.4863830801935],
  ["12AT7|6L6GC|0|8.0|16|384000",178.73423672665027,7.606881067205772,9.146242985272724e-7,48000,65536,0.08838774358391062,-0.08825684441608667,-1.9731911575650902,0.973322056732914,6,90.5770100690654,393.63872219923104,1258.9401157102488],
  ["12AT7|6L6GC|20|6.0|4|352800",56.57513078450391,2.3195305147228393,8.653435580286625e-7,44160,65536,0.0975122162675601,-0.013735937905146309,-1.1924903822076476,0.2762666605700613,8,110051.60308721372,7321.949087398816,64908.60239210481],
  ["12AT7|6L6GC|20|6.0|8|352800",80.0230900037385,3.2962170131784694,8.580018495265287e-7,44160,65536,0.07760356723071529,-0.013786990423692422,-1.200256689670015,0.26407326647703794,8,97020.67444558458,5289.527365472884,69475.62737637566],
  ["12AT7|6L6GC|20|6.0|15|352800",109.58892172564374,4.52461795895165,8.57852064577522e-7,44160,65536,0.07431532494647905,-0.008796732457180347,-1.1936766358758102,0.2591952283651088,8,119820.2635957976,5399.297729598366,70412.77313162044],
  ["12AT7|6L6GC|20|6.0|16|352800",113.1810414869414,4.671451865226472,8.590486236417164e-7,44160,65536,0.10227269848575311,-0.034970281304884054,-1.25577194178946,0.3230743589703289,8,60256.898842580515,6250.356043261328,57191.8461706986],
  ["12AT7|6L6GC|20|6.0|4|384000",56.64281785955092,2.27643747879767,7.701536566499798e-7,48000,65536,0.08112676278809605,-0.0067225515363674195,-1.0133779171930062,0.08778212844473486,8,152210.906198164,5247.147178549808,143440.58615667417],
  ["12AT7|6L6GC|20|6.0|8|384000",80.11886679794657,3.235249057817603,7.720662008188399e-7,48000,65536,0.16770771438560994,-0.054255418302859036,-0.9561418275665661,0.06959412364931694,8,68970.0500451956,8037.621814257311,154839.77330489314],
  ["12AT7|6L6GC|20|6.0|15|384000",109.72010691479828,4.441105749527873,7.687915363567338e-7,48000,65536,0.14271936451717515,-0.010209347823782607,-0.9369035654762828,0.0694135821696754,8,161196.79939210176,9517.293103593698,153518.854202764],
  ["12AT7|6L6GC|20|6.0|16|384000",113.31652374097013,4.585205341630689,7.698116077537112e-7,48000,65536,0.10535139762452944,-0.0168119712475022,-0.992143604840257,0.08068303121728429,8,112159.78556243426,6251.284596037717,147590.29719830197],
  ["12AT7|6L6GC|20|6.6|4|352800",57.52687064074679,2.3703489042093286,9.088069070848146e-7,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,8,128000,8000,24000],
  ["12AT7|6L6GC|20|6.6|8|352800",81.36928187070869,3.368355626687906,9.085726038106008e-7,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,8,128000,8000,24000],
  ["12AT7|6L6GC|20|6.6|15|352800",111.43248395714419,4.623587125784332,9.120091332838633e-7,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,8,128000,8000,24000],
  ["12AT7|6L6GC|20|6.6|16|352800",115.08503251143863,4.773640263316114,9.093822932279259e-7,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,8,128000,8000,24000],
  ["12AT7|6L6GC|20|6.6|4|384000",57.59507106589388,2.3260415122854874,7.846630765249897e-7,48000,65536,0.09082273444337066,-0.011184339391628313,-1.2282255762767567,0.307863971328499,8,128000,8000,64000],
  ["12AT7|6L6GC|20|6.6|8|384000",81.46578550972195,3.305669592594605,7.801071056359838e-7,48000,65536,0.07365158530236346,-0.011706812452617631,-1.2450230891748468,0.3069678620245927,8,112402.08006208768,6010.837657657622,66167.31253662676],
  ["12AT7|6L6GC|20|6.6|15|384000",111.56466492146377,4.537721631358994,7.77773861426098e-7,48000,65536,0.09082273444337066,-0.011184339391628313,-1.2282255762767567,0.307863971328499,8,128000,8000,64000],
  ["12AT7|6L6GC|20|6.6|16|384000",115.22154316149921,4.684963332482094,7.76260499464917e-7,48000,65536,0.09082273444337066,-0.011184339391628313,-1.2282255762767567,0.307863971328499,8,128000,8000,64000],
  ["12AT7|6L6GC|20|8.0|4|352800",59.10517632747565,2.4580833487648146,0.000001002375033206653,44160,65536,0.09014549257803527,-0.09008623745190879,-1.9712891200368716,0.971348375162998,8,36.92099485542344,125.82470596964832,1506.4571871234964],
  ["12AT7|6L6GC|20|8.0|8|352800",83.60172110247741,3.492880342223983,0.000001000582352411171,44160,65536,0.09341751062221874,-0.09335542178089913,-1.9748557548328067,0.9749178436741265,8,37.33174903651814,156.07323412352258,1270.2497886433757],
  ["12AT7|6L6GC|20|8.0|15|352800",114.4897299095432,4.7944143874201695,0.0000010039674706387448,44160,65536,0.09204655268109309,-0.09183915342085888,-1.9672318484317985,0.9674392476920327,8,126.65960204013527,483.35462744068343,1375.354616858699],
  ["12AT7|6L6GC|20|8.0|16|352800",118.24248986028974,4.9500257537231915,0.0000010015996490816501,44160,65536,0.08952091793706801,-0.08935988570500618,-1.9721111483335982,0.9722721805656601,8,101.09458562222369,460.2818212410779,1118.6238597062595],
  ["12AT7|6L6GC|20|8.0|4|384000",59.17389636069845,2.4113673560608966,8.025414690589045e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,9,128000,12000,12000],
  ["12AT7|6L6GC|20|8.0|8|384000",83.69896109364473,3.426786702628419,8.017423275730213e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,9,128000,12000,12000],
  ["12AT7|6L6GC|20|8.0|15|384000",114.62292012112029,4.703881417281063,8.000674488379666e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,9,128000,12000,12000],
  ["12AT7|6L6GC|20|8.0|16|384000",118.38004273452249,4.85652847459277,8.002238541514961e-7,48000,65536,0.03891234392369181,-0.010303042712140106,-1.661708045427655,0.6903173466392066,9,81214.6904036017,11249.072811983944,11400.566979635494],
  ["12AT7|6L6GC|43|6.0|4|352800",43.518978700775335,1.7463457793554498,3.0753838779902226e-7,44160,65536,0.08802488529217144,-0.08779141917030091,-1.9622516923026532,0.9624851584245236,8,149.12267344999384,439.3521450622896,1707.629581152864],
  ["12AT7|6L6GC|43|6.0|8|352800",61.55573451910789,2.4819310913183084,3.1269229201174896e-7,44160,65536,0.08771934691261295,-0.08767396105544066,-1.9417234036497537,0.9417687895069259,8,29.059372796473646,44.34762260320887,3324.3904668128694],
  ["12AT7|6L6GC|43|6.0|15|352800",84.29850858333674,3.4070436644752573,3.1081624609192305e-7,44160,65536,0.08885906146194894,-0.08871881536678367,-1.9630611457929508,0.9632013918881162,8,88.69123718727272,241.76409984132377,1863.449236429336],
  ["12AT7|6L6GC|43|6.0|16|352800",87.06165499631159,3.517585906831779,3.0953477748107756e-7,44160,65536,0.08916860976450086,-0.08911471626180263,-1.9643458878957618,0.96439978139846,8,33.947234466097115,88.8845736125208,1946.5120209646511],
  ["12AT7|6L6GC|43|6.0|4|384000",43.56726417906654,1.7144899496079338,9.315095918826454e-7,48000,65536,0.08509678049473088,-0.08504767474533978,-1.927099146195327,0.9271482519447183,8,35.27734612363314,41.5688870236582,4581.317377370522],
  ["12AT7|6L6GC|43|6.0|8|384000",61.624059695263,2.4368599964426334,9.276324198689243e-7,48000,65536,0.08838432617159125,-0.08822438935986797,-1.9390917593743302,0.9392516961860535,8,110.69239208535244,168.3009624075027,3661.916619836771],
  ["12AT7|6L6GC|43|6.0|15|384000",84.39209429388029,3.345305214856894,9.290672710379583e-7,48000,65536,0.08290034029045121,-0.08249149099882469,-1.923555845920819,0.9239646952124456,8,302.1561443182961,354.6613418124585,4478.438834915641],
  ["12AT7|6L6GC|43|6.0|16|384000",87.15830599121317,3.453826233961014,9.276028521501062e-7,48000,65536,0.08502256221556977,-0.08392694542195549,-1.9229710091541314,0.9240666259477457,8,792.6641007202184,1161.350188675354,3665.0081676091527],
  ["12AT7|6L6GC|43|6.6|4|352800",43.57851772319981,1.7582369436113547,3.106321889633336e-7,44160,65536,0.08898646106441292,-0.08883793656662198,-1.9685480408773768,0.9686965653751677,7,93.79626632274432,325.88703641043827,1459.8952713967815],
  ["12AT7|6L6GC|43|6.6|8|352800",61.639947243606215,2.498766884525377,3.072955379125155e-7,44160,65536,0.0944755516378538,-0.09439449116889334,-1.9762749937706188,0.9763560542395794,7,48.19752792424716,232.86463911899568,1110.6864650027248],
  ["12AT7|6L6GC|43|6.6|15|352800",84.4138334094667,3.430110868077558,3.1414333081221125e-7,44160,65536,0.09522510380164426,-0.09506303323858138,-1.9742119042146915,0.9743739747777544,7,95.64697415086624,612.4472503002658,845.2083467138436],
  ["12AT7|6L6GC|43|6.6|16|352800",87.1807601725905,3.54140759230492,3.092460309450447e-7,44160,65536,0.0969317132980922,-0.096701422800546,-1.9690775785916559,0.969307869089202,7,133.5596422925752,706.3951547070778,1043.9645081499875],
  ["12AT7|6L6GC|43|6.6|4|384000",43.62634353177144,1.725727351730076,9.338468304167937e-7,48000,65536,0.0816565409196833,-0.08160451945388318,-1.9736907208729717,0.9737427423387718,8,38.94765717007846,131.75969723195743,1494.4097363498158],
  ["12AT7|6L6GC|43|6.6|8|384000",61.70762255530563,2.4527709563951037,9.322748181378321e-7,48000,65536,0.08791941133660154,-0.08786226753807447,-1.9765944365696506,0.9766515803681776,8,39.735333720695685,169.4675046078973,1274.405236519408],
  ["12AT7|6L6GC|43|6.6|15|384000",84.50652916068812,3.367105806532216,9.301086539393011e-7,48000,65536,0.08364735162080392,-0.08329465206775646,-1.9608651464653375,0.9612178460183849,8,258.23867541687656,866.2107950887564,1551.1643855151667],
  ["12AT7|6L6GC|43|6.6|16|384000",87.27649205809266,3.4763398835024573,9.30468463886839e-7,48000,65536,0.08131766440208953,-0.08117695771987209,-1.9735338073503246,0.9736745140325421,8,105.84179357288407,451.91989297157085,1178.5319376271102],
  ["12AT7|6L6GC|43|8.0|4|352800",43.385985662853386,1.7693275799160266,3.1192596767018067e-7,44160,65536,0.08934934139890024,-0.0892287014860085,-1.9739263590489156,0.9740469989618072,5,75.8650460447669,338.70974669548264,1137.7915186739692],
  ["12AT7|6L6GC|43|8.0|8|352800",61.36761381540515,2.514402036866206,3.0911329992205883e-7,44160,65536,0.08837239025392227,-0.08807333631407455,-1.96396288247373,0.9642619364135778,5,190.3344947308056,732.3155235928691,1311.1073381987926],
  ["12AT7|6L6GC|43|8.0|15|352800",84.0408783099338,3.451486961736723,3.095659753784813e-7,44160,65536,0.09073860743538092,-0.0904048556606318,-1.957020223461118,0.9573539752358673,5,206.90934822180535,574.1590409164933,1872.9685868994354],
  ["12AT7|6L6GC|43|8.0|16|352800",86.79558079749035,3.5634893812103923,3.072502555252595e-7,44160,65536,0.09059730181898926,-0.0905036164323408,-1.964573743107045,0.9646674284936934,5,58.09382118996047,161.8541296223839,1857.9615168197956],
  ["12AT7|6L6GC|43|8.0|4|384000",43.43255274015611,1.7356041299732432,9.382353214879982e-7,48000,65536,0.08418062324608248,-0.08412614968404,-1.9709825322599008,0.9710370058219434,6,39.56084402750593,123.4278273626186,1672.7994669442112],
  ["12AT7|6L6GC|43|8.0|8|384000",61.43350891115118,2.466689063437978,9.295141916240506e-7,48000,65536,0.08289707298850792,-0.08273145216169901,-1.9738804699958927,0.9740460908227017,6,122.22535578941657,665.9798004354082,941.1533869765004],
  ["12AT7|6L6GC|43|8.0|15|384000",84.13113646390045,3.386130261320093,9.29639581422506e-7,48000,65536,0.08087091263051109,-0.08079768964142889,-1.9620092596277585,0.9620824826168408,6,55.36090121029797,124.59255095622218,2237.8326052504194],
  ["12AT7|6L6GC|43|8.0|16|384000",86.88879515838555,3.495992944684288,9.312301275943551e-7,48000,65536,0.08396321659695155,-0.08392284582745338,-1.9777261359398128,0.977766506709311,6,29.392311671331246,121.76069711428384,1252.3835794864715],
  ["12AT7|KT88|0|6.0|4|352800",125.7486810685525,6.39394129957667,3.0422158863458935e-7,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,6,128000,8000,24000],
  ["12AT7|KT88|0|6.0|8|352800",177.86576732859106,9.078066509897722,3.035882735348357e-7,44160,65536,0.045796561956547334,-0.005067660015380717,-1.5286035909441558,0.5693324928853224,6,123604.37131430663,6792.566256781447,24836.1281846135],
  ["12AT7|KT88|0|6.0|15|352800",243.5809365172307,12.455586910095736,3.0374385966118605e-7,44160,65536,0.05242364725800591,-0.008703863100357102,-1.505025570182836,0.5487453543404847,6,100822.17972391419,6865.139318290648,26831.560845328517],
  ["12AT7|KT88|0|6.0|16|352800",251.56509596350057,12.860578784544694,3.0320853187830275e-7,44160,65536,0.05145165166666046,-0.005264724656402758,-1.5193931275576185,0.5655800545678762,6,128000,8000,24000],
  ["12AT7|KT88|0|6.0|4|384000",126.04395872900467,6.1890284008387875,8.556655122276647e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|6.0|8|384000",178.28353755384498,8.788231778206532,8.552219489409893e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|6.0|15|384000",244.1531297643527,12.058652759108881,8.548034131878305e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|6.0|16|384000",252.1560350088788,12.45063707084442,8.550068776243135e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|6.6|4|352800",130.03556461964916,6.6171064792922065,2.978088166168123e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|KT88|0|6.6|8|352800",183.92936700031234,9.3948870172609,2.980796537578819e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|KT88|0|6.6|15|352800",251.88482287403167,12.890262436916345,2.980181969080178e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|KT88|0|6.6|16|352800",260.14116938491884,13.309390356380241,2.9794664061441364e-7,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AT7|KT88|0|6.6|4|384000",130.33801733284807,6.407079663082069,8.623604223980452e-7,48000,65536,0.04830394419666783,-0.008785905675822037,-1.4872716847555418,0.5267897232763875,6,104163.07981644511,6065.867450923474,33106.34437244037],
  ["12AT7|KT88|0|6.6|8|384000",184.35728921190622,9.097818341952653,8.612567309867496e-7,48000,65536,0.05703566860971629,-0.007023640931635376,-1.4696906162867347,0.5197026439648156,6,128000,8000,32000],
  ["12AT7|KT88|0|6.6|15|384000",252.47092097312262,12.483420550629251,8.607901233544091e-7,48000,65536,0.05703566860971629,-0.007023640931635376,-1.4696906162867347,0.5197026439648156,6,128000,8000,32000],
  ["12AT7|KT88|0|6.6|16|384000",260.74646882046306,12.889216305910995,8.608053004583515e-7,48000,65536,0.05966733221607507,-0.008736145536256871,-1.4361284657357398,0.48705965241555804,6,117422.15958487825,7324.850876259407,36639.72397709405],
  ["12AT7|KT88|0|8.0|4|352800",138.55717873384512,7.040120439729315,3.072250337742526e-7,44160,65536,0.08939394208315324,-0.08911908532391441,-1.9659566240215594,0.9662314807807981,6,172.9081854631948,744.0698832962253,1184.7815579517667],
  ["12AT7|KT88|0|8.0|8|352800",195.98280383386657,9.995533609608414,3.074377988458958e-7,44160,65536,0.09403738926447025,-0.09374809145876929,-1.965695875582634,0.9659851733883349,6,173.00640296355988,845.1800034982209,1097.9867337235162],
  ["12AT7|KT88|0|8.0|15|352800",268.3915841672403,13.714418859854224,3.074183679939129e-7,44160,65536,0.0954885651774806,-0.09511693323276167,-1.9592785986854486,0.9596502306301676,6,218.956008525787,780.7707330902377,1531.8402471429945],
  ["12AT7|KT88|0|8.0|16|352800",277.18899335903126,14.160338927802918,3.071788702129154e-7,44160,65536,0.08785134413341186,-0.08779312885205322,-1.963755897070745,0.9638141123521036,6,37.22041679592434,94.66356646982754,1974.8425616757854],
  ["12AT7|KT88|0|8.0|4|384000",138.87255571130405,6.820996708486286,8.726536789105944e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|8.0|8|384000",196.42901318662388,9.68559618117679,8.724593760036759e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|8.0|15|384000",269.00272979120115,13.289951348085904,8.715516035889584e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|0|8.0|16|384000",277.8201607770151,13.721961890971999,8.713617999621403e-7,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AT7|KT88|20|6.0|4|352800",71.79018229073228,3.0825028903833003,3.007102259787844e-7,44160,65536,0.0879452348264187,-0.08771071613968102,-1.9582582222111025,0.9584927408978401,8,149.93172846529382,376.94918069928735,2003.4282797347337],
  ["12AT7|KT88|20|6.0|8|352800",101.54408843593977,4.37953582222917,3.0046206818717534e-7,44160,65536,0.09560262079769684,-0.09547781613062356,-1.9643943470630156,0.9645191517300888,7,73.34885959309128,221.75282423848031,1806.694149210694],
  ["12AT7|KT88|20|6.0|15|352800",139.0611771288959,6.011027637993049,2.996464262401259e-7,44160,65536,0.08993896995865065,-0.08979127527651411,-1.9753193267883977,0.9754670214705342,8,92.28316758777466,575.5611273214881,819.1412036488816],
  ["12AT7|KT88|20|6.0|16|352800",143.61934587799598,6.206186539844102,3.0005670972819547e-7,44160,65536,0.09790574750527085,-0.09779390767819299,-1.9748701817120822,0.97498202153916,7,64.17785201861625,325.4789478942411,1097.1479072344264],
  ["12AT7|KT88|20|6.0|4|384000",71.91196145158564,2.9946277458382853,8.912493215682967e-7,48000,65536,0.08263442390720943,-0.08245379744937252,-1.9677752777103703,0.9679559041682072,9,133.73552956758377,443.1743310497405,1547.2808223981392],
  ["12AT7|KT88|20|6.0|8|384000",101.71639534464613,4.255230926132173,8.904757784132796e-7,48000,65536,0.08534853106115999,-0.08524380455648534,-1.9774956537738502,0.9776003802785248,9,75.03752479017967,403.10241670862365,981.4265091003347],
  ["12AT7|KT88|20|6.0|15|384000",139.2971800857638,5.840778940748871,8.892545741946172e-7,48000,65536,0.08161677899304079,-0.08158625375363392,-1.9756026327868401,0.975633158026247,9,22.861894203474886,80.90329294359579,1426.732067614347],
  ["12AT7|KT88|20|6.0|16|384000",143.863079952064,6.030360378512994,8.902536786105951e-7,48000,65536,0.0827203135906093,-0.08247527901608943,-1.9681279639312823,0.9683729985058022,9,181.30533426051613,796.554941735468,1167.5710807723335],
  ["12AT7|KT88|20|6.6|4|352800",71.70298478865067,3.069897980848742,3.054024843700315e-7,44160,65536,0.09508890662243193,-0.09504174990881631,-1.9734724637289511,0.9735196204425668,7,27.852879227012973,107.68883965021361,1399.221894150165],
  ["12AT7|KT88|20|6.6|8|352800",101.42075379076213,4.361682971225187,3.064398514531669e-7,44160,65536,0.09122019018652676,-0.09107590394951327,-1.9735905356438863,0.9737348218808998,7,88.88456227692211,435.17726009157207,1059.3226338463223],
  ["12AT7|KT88|20|6.6|15|352800",138.89227620208806,5.986562396937326,3.0710164736837456e-7,44160,65536,0.09016673222064929,-0.09012246631025371,-1.9689090568918142,0.9689533228022098,7,27.572643456519287,84.04683205259758,1686.854671165589],
  ["12AT7|KT88|20|6.6|16|352800",143.44490844210952,6.1809216607925075,3.07642610784146e-7,44160,65536,0.0896656354978746,-0.0896131111895928,-1.9772189222964565,0.9772714466047383,7,32.90108729047928,146.3511242372233,1144.5807774224177],
  ["12AT7|KT88|20|6.6|4|384000",71.82167771659542,2.982753558948601,8.991315601638263e-7,48000,65536,0.08486725903042591,-0.08479834174481093,-1.9783353096556353,0.9784042269412504,8,49.64959843033107,237.20426720801595,1097.0921675210104],
  ["12AT7|KT88|20|6.6|8|384000",101.58869507256843,4.238410899695081,8.988023521348329e-7,48000,65536,0.08236698127107779,-0.08233812079887666,-1.9762636608729316,0.9762925213451327,8,21.41794190007197,78.61427755271293,1387.731274020803],
  ["12AT7|KT88|20|6.6|15|384000",139.12230036729903,5.817727621952395,8.977949891475078e-7,48000,65536,0.0845890763291451,-0.08441201402996401,-1.9730630628514039,0.9732401251505851,8,128.06135811271508,699.8429667859018,957.8806227452765],
  ["12AT7|KT88|20|6.6|16|384000",143.68246778531523,6.006555854585837,8.990432167268105e-7,48000,65536,0.08369124227512735,-0.0834953916842165,-1.9705404566465141,0.9707363072374249,8,143.1874261442823,622.541219945957,1192.6144876914575],
  ["12AT7|KT88|20|8.0|4|352800",71.0182309934874,3.021964816593142,2.9894409405309523e-7,44160,65536,0.09014234092228013,-0.09010524931915259,-1.9688725766364064,0.9689096682395338,5,23.109196576757633,69.73026266150579,1703.701035248669],
  ["12AT7|KT88|20|8.0|8|352800",100.45220433195705,4.293697595856704,2.9707112353833655e-7,44160,65536,0.08777420595487187,-0.08760821026781915,-1.9600005625356842,0.9601665582227369,5,106.28931022550088,264.6893538155124,2017.7190311183103],
  ["12AT7|KT88|20|8.0|15|352800",137.56588408495975,5.893330770912987,2.973585587434507e-7,44160,65536,0.09090288304851589,-0.09081259419984267,-1.9630913410802153,0.9631816299288886,5,55.79829589333036,148.110587290891,1958.2547850068195],
  ["12AT7|KT88|20|8.0|16|352800",142.07503920249079,6.084651923374351,2.98120552573861e-7,44160,65536,0.08910658583633475,-0.08906869645843504,-1.9652397416437932,0.965277631021693,5,23.8807921935922,63.29011689230623,1921.0190368802205],
  ["12AT7|KT88|20|8.0|4|384000",71.12998739028868,2.936656185915738,9.138956409848751e-7,48000,65536,0.08194842688208812,-0.08117040682368705,-1.9360641474838092,0.9368421675422102,6,583.0037272377193,1007.4801482631666,2979.7227822992363],
  ["12AT7|KT88|20|8.0|8|384000",100.61033332502039,4.1730207856938355,9.115614946078968e-7,48000,65536,0.08626205313216972,-0.08613227268171951,-1.9771996172778803,0.9773293977283305,6,92.01693083510078,674.2243445410945,727.2476283652451],
  ["12AT7|KT88|20|8.0|15|384000",137.7824701387002,5.728049201039337,9.111497874146071e-7,48000,65536,0.08288151495211665,-0.08258685495991859,-1.9646652940816054,0.9649599540738035,6,217.6646963083276,829.8735115742728,1350.03544379502],
  ["12AT7|KT88|20|8.0|16|384000",142.2987199710839,5.913955933583458,9.103773828488094e-7,48000,65536,0.08137264432229671,-0.08114533495215226,-1.96361680941654,0.9638441187866845,6,170.96120085833135,491.6276370124648,1758.9933600720692],
  ["12AT7|KT88|43|6.0|4|352800",48.124902274055344,1.898025581871938,3.1761179275184517e-7,44160,65536,0.10088802996531514,-0.10082182597130933,-1.9567662094126188,0.9568324134066246,4,36.85834160948245,89.33580960389452,2388.3903290339713],
  ["12AT7|KT88|43|6.0|8|352800",68.07062534437644,2.6977242202597678,3.122896705660877e-7,44160,65536,0.0997486719423328,-0.09965254289594343,-1.9727702313816138,0.9728663604280031,4,54.13841933034853,234.5443820040109,1310.0571928338222],
  ["12AT7|KT88|43|6.0|15|352800",93.22043876826041,3.703424425707283,3.1465133906008684e-7,44160,65536,0.08849558703681056,-0.08844008115445579,-1.9544790397299003,0.9545345456122551,4,35.22916408246112,70.44972855150861,2542.2845261555476],
  ["12AT7|KT88|43|6.0|16|352800",96.27602831585524,3.823561507194567,3.154743991168388e-7,44160,65536,0.08905734679808316,-0.08890246905559844,-1.9716906137219128,0.9718454914643975,4,97.73404539740527,417.6754283091503,1185.8774596489898],
  ["12AT7|KT88|43|6.0|4|384000",48.19275895699347,1.8482972615744329,9.047609853802156e-7,48000,65536,0.08255249387576825,-0.0824395264787351,-1.975270349661881,0.9753833170589142,5,83.68962096598268,370.65525875868605,1152.6326146863628],
  ["12AT7|KT88|43|6.0|8|384000",68.16664025274206,2.6273757311761305,9.047991839101459e-7,48000,65536,0.08568829624181708,-0.08564533808017782,-1.9719429395643115,0.9719858977259509,5,30.6467496995479,99.4084261018343,1637.1263078077902],
  ["12AT7|KT88|43|6.0|15|384000",93.35194910791462,3.607070460740791,9.042663246019613e-7,48000,65536,0.08173954939818284,-0.08158294488323639,-1.9715063625702816,0.971662967085228,5,117.20327831681522,456.2429975371686,1300.6000003945378],
  ["12AT7|KT88|43|6.0|16|384000",96.41184649070087,3.7240515516002204,9.044422813056719e-7,48000,65536,0.08535013045586809,-0.08519027464224765,-1.9741186126363464,0.9742784684499669,5,114.57308943081736,625.5197514843361,967.0348848865251],
  ["12AT7|KT88|43|6.6|4|352800",47.35219523196172,1.8657153090084473,3.1247357837880473e-7,44160,65536,0.09095314838063465,-0.09071528440648846,-1.9631591393838383,0.9633970033579844,4,147.03751452947157,470.7222048453405,1623.0891106620056],
  ["12AT7|KT88|43|6.6|8|352800",66.97766466711923,2.6518131548194,3.1520181495137643e-7,44160,65536,0.08805556695521087,-0.08796525279345385,-1.9722926987937397,0.9723830129554966,4,57.61964232649489,212.28218378440442,1360.2231608616344],
  ["12AT7|KT88|43|6.6|15|352800",91.72366605292669,3.6404065829235757,3.138108985863175e-7,44160,65536,0.09390447424345963,-0.09376620899849121,-1.9734017132757398,0.9735399785207083,4,82.73616273769832,399.29968794014053,1106.436861651363],
  ["12AT7|KT88|43|6.6|16|352800",94.73019421424637,3.75849813361993,3.1354558992331217e-7,44160,65536,0.08808416160683873,-0.08781786498009672,-1.9673007049618374,0.9675670015885794,4,170.00976131862384,868.1562608780355,983.1386777365013],
  ["12AT7|KT88|43|6.6|4|384000",47.417296113753906,1.816758475190719,9.046880377985747e-7,48000,65536,0.0830207456596748,-0.08289026266480665,-1.976124898382917,0.9762553813777852,4,96.13026833844623,519.8688256430199,948.8017163727015],
  ["12AT7|KT88|43|6.6|8|384000",67.06978095627588,2.5825556735277337,9.050493143279132e-7,48000,65536,0.0869978282293237,-0.08689876779584481,-1.968706451877496,0.9688055123109747,4,69.62906154566616,218.79460199620524,1718.0409080984825],
  ["12AT7|KT88|43|6.6|15|384000",91.84983709212199,3.5455465943828637,9.031971462762578e-7,48000,65536,0.09195485264701019,-0.09189219333939976,-1.9758448033458658,0.9759074626534762,4,41.659140356661894,180.90641251626653,1309.5484047622015],
  ["12AT7|KT88|43|6.6|16|384000",94.86049807892954,3.660531197686695,9.035484919071996e-7,48000,65536,0.08516967769485233,-0.08500551754963007,-1.9743737293961559,0.9745378895413781,4,117.91062908770715,780.2399832154799,796.043597896489],
  ["12AT7|KT88|43|8.0|4|352800",45.55076872513072,1.7927544667194026,3.1117528320729204e-7,44160,65536,0.09294433406401251,-0.09288980160966524,-1.9619104875983444,0.9619650200526918,3,32.954009959110536,83.72437641203345,2093.6096029684045],
  ["12AT7|KT88|43|8.0|8|352800",64.42962407541421,2.54812472656858,3.1163503636623444e-7,44160,65536,0.09437204015304668,-0.09431178072769561,-1.9700352676226225,0.9700955270479735,3,35.86485192817962,121.85651246768404,1582.8943928482618],
  ["12AT7|KT88|43|8.0|15|352800",88.2342102776763,3.4980725985754506,3.1040989433833696e-7,44160,65536,0.09137235152642723,-0.091294589748527,-1.9767096281523155,0.9767873899302156,3,47.806280444371374,227.2688738923191,1091.4817571250605],
  ["12AT7|KT88|43|8.0|16|352800",91.12636061390143,3.6115456478738754,3.109235044985787e-7,44160,65536,0.09105670145807229,-0.09101796646458764,-1.9654588739784016,0.9654976089718862,3,23.890908832539466,65.19413332426305,1906.320437456975],
  ["12AT7|KT88|43|8.0|4|384000",45.61033797990152,1.7454274768595344,9.344383963306392e-7,48000,65536,0.08392311500581548,-0.08389471694922607,-1.9671104556432193,0.9671388536998087,3,20.683873355102598,54.25670026720223,1987.8077598071266],
  ["12AT7|KT88|43|8.0|8|384000",64.51391491434029,2.4811721171651393,9.282952766723084e-7,48000,65536,0.08295129817013455,-0.08292038873162738,-1.97710036732626,0.9771312767647671,3,22.777193491771666,88.09287829974468,1325.7694809480417],
  ["12AT7|KT88|43|8.0|15|384000",88.34966384057145,3.4063689623659,9.279660368018651e-7,48000,65536,0.08128341442231954,-0.0810143325385749,-1.9501854943622887,0.9504545762460335,3,202.65331766498943,377.91484566599456,2727.6635407994227],
  ["12AT7|KT88|43|8.0|16|384000",91.24559583545731,3.5168385096208605,9.281958725309255e-7,48000,65536,0.08257902966679923,-0.08251809467241877,-1.9747655523987377,0.9748264873931182,3,45.11371982003678,165.51928150397464,1392.6683481164216],
  ["12AU7|EL84|0|6.0|4|352800",12.864356775316764,0.8525610786240252,0.000001999157953011675,44160,65536,0.08982421895096719,-0.08975829005943015,-1.9720223639348953,0.9720882928264323,6,41.22782864656821,146.04887666279447,1443.4775422668258],
  ["12AU7|EL84|0|6.0|8|352800",18.195991542350683,1.2094028675117203,0.000002012030941941997,44160,65536,0.08807158738805183,-0.08789453128704641,-1.9659845100413151,0.9661615661423204,6,112.9953812482681,361.35890816099277,1571.5555754837885],
  ["12AU7|EL84|0|6.0|15|352800",24.918735917053034,1.658640118120139,0.0000020078414684988754,44160,65536,0.09120959800714631,-0.09106843604943202,-1.9755268285647252,0.9756679905224396,6,86.96852961282448,525.1344703317288,858.000865133233],
  ["12AU7|EL84|0|6.0|16|352800",25.7355339220078,1.712671585877832,0.000002009770850743746,44160,65536,0.08884586551534385,-0.08880254290185036,-1.9773032800706396,0.9773466026841331,6,27.386216654982572,118.25016943191967,1168.363749351624],
  ["12AU7|EL84|0|6.0|4|384000",12.898323291204735,0.831428605142711,0.000001906038084092857,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.0|8|384000",18.24404742101699,1.1795135657928122,0.0000018956723952582648,48000,65536,0.03410615843442524,-0.003163710971482071,-1.6284423787076867,0.65938482617063,6,145316.29217796982,8232.003239722028,17219.421299066722],
  ["12AU7|EL84|0|6.0|15|384000",24.98455424517954,1.61770693736122,0.0000018970056117776535,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.0|16|384000",25.803508632093138,1.6703969066189748,0.0000018974370328703894,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|4|352800",13.401795444892066,0.8908582839384008,0.000001995987131778117,44160,65536,0.09089123154241834,-0.09079994200641178,-1.974131712616923,0.9742230021529298,6,56.42426492788614,237.23954987026246,1229.1167609982726],
  ["12AU7|EL84|0|6.6|8|352800",18.956170991708593,1.2637185576009755,0.000001993261267848819,44160,65536,0.08839360600442299,-0.08806385520423597,-1.9494556233464315,0.9497853741466186,6,209.85776384888678,433.78417703360947,2459.014242963136],
  ["12AU7|EL84|0|6.6|15|352800",25.959772967778594,1.7331240978350457,0.0000019949988590716215,44160,65536,0.0893214112754719,-0.08821309294255049,-1.932601802410113,0.9337101207430344,6,701.077599805142,1621.9637723517724,2229.3134027804426],
  ["12AU7|EL84|0|6.6|16|352800",26.810694653688763,1.789582998709299,0.0000019940877008430247,44160,65536,0.09136882338063398,-0.0909026095600375,-1.9567979621631966,0.9572641759837931,6,287.2408391312304,1190.348507417836,1262.0461923568785],
  ["12AU7|EL84|0|6.6|4|384000",13.436976664875486,0.8689919077454439,0.0000018521579089761231,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|8|384000",19.005945510371113,1.2327911970315857,0.0000018573101264637263,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|15|384000",26.027945227093134,1.690769131079383,0.000001846401870529382,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|6.6|16|384000",26.88110037965161,1.745839939966753,0.0000018515048786154663,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|4|352800",14.524289844298854,0.9689627161403388,0.0000019786086713743477,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|8|352800",20.543882361324794,1.3744985968227488,0.0000019714941982774787,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|15|352800",28.134084131770088,1.885043299742992,0.0000019747651935846827,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|16|352800",29.05627646053908,1.9464525357590214,0.000001979477683661054,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|4|384000",14.561908186743167,0.94561519946549,0.0000019049318501103873,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|8|384000",20.597104991182608,1.341476291736617,0.0000019043015725466381,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|15|384000",28.206979085046203,1.8398193058475136,0.000001897088651175462,48000,65536,0.036245422693190636,-0.004463432105167809,-1.6434499160677545,0.6752319066557773,6,128000,12000,12000],
  ["12AU7|EL84|0|8.0|16|384000",29.13155966019764,1.8997464437003093,0.0000018939875941906384,48000,65536,0.03157661930906451,-0.0019466240819103699,-1.652606458773521,0.6822364540006752,6,170287.35430891754,9964.540768074856,13404.740738424036],
  ["12AU7|EL84|20|6.0|4|352800",9.519719943838203,0.5515925209564798,0.000001950022232859251,44160,65536,0.08877478679265763,-0.08873982806426318,-1.975428492944606,0.9754634516730005,6,22.1156761568174,85.20496082684613,1309.7028553194548],
  ["12AU7|EL84|20|6.0|8|352800",13.465190922233488,0.7827870244141183,0.000001949424958998044,44160,65536,0.08989298503282325,-0.08974692698319958,-1.9639858566852464,0.9641319147348701,6,91.30645107016,262.1595014158099,1788.835153423386],
  ["12AU7|EL84|20|6.0|15|352800",18.440094633175796,1.0737786199654333,0.0000019550391543615554,44160,65536,0.08800036204048187,-0.08777846491343298,-1.9701628162926617,0.9703847134197104,6,141.76337756853638,797.446474516779,890.5685989128796],
  ["12AU7|EL84|20|6.0|16|352800",19.044530665741828,1.1087268223815556,0.000001958883532255512,44160,65536,0.08922681339281177,-0.08918922670318502,-1.9564339278883636,0.9564715145779902,6,23.658047089687702,49.46448087024349,2449.4443042480607],
  ["12AU7|EL84|20|6.0|4|384000",9.539062346220465,0.5405291037629735,0.000001827339245614647,48000,65536,0.08253187896990227,-0.08245156234535045,-1.9712884938045874,0.9713688104291391,6,59.50404316487511,192.26497479245904,1583.082641453375],
  ["12AU7|EL84|20|6.0|8|384000",13.492557189930602,0.7671379420850266,0.0000018398852099155261,48000,65536,0.0847513749235303,-0.08469616874267609,-1.9790927851751237,0.979147991355978,6,39.822983444817396,189.76821483428805,1098.0870220837758],
  ["12AU7|EL84|20|6.0|15|384000",18.477576343329282,1.0523460299177239,0.0000018258263001014522,48000,65536,0.0854465383154784,-0.08538414184617511,-1.9677636342864657,0.9678260307557691,6,44.64527648166445,126.53577993884637,1872.119964873125],
  ["12AU7|EL84|20|6.0|16|384000",19.083240276905133,1.086591968928309,0.0000018192168561790558,48000,65536,0.08152461572998122,-0.0814211246066322,-1.9375341172096592,0.9376376083330081,6,77.6321295014097,104.18078838613327,3831.1530703196413],
  ["12AU7|EL84|20|6.6|4|352800",9.714923736048563,0.5610685493448887,0.0000019473718173896927,44160,65536,0.09041165379123407,-0.09032598553449747,-1.9756213247552417,0.9757069930119782,6,53.229214860273245,239.57675416624988,1141.3140260502207],
  ["12AU7|EL84|20|6.6|8|352800",13.741297851021173,0.7962433585205664,0.0000019462971729094807,44160,65536,0.09166727163090502,-0.0916315682427379,-1.976347633497535,0.9763833368857022,6,21.874010920123155,91.06672197447715,1250.9153895061238],
  ["12AU7|EL84|20|6.6|15|352800",18.81821341255705,1.0922430042979026,0.0000019360307348232416,44160,65536,0.08962458588904794,-0.08958850521908927,-1.9768974159693151,0.9769334966392738,6,22.609115475532757,94.66963562183099,1215.682792864666],
  ["12AU7|EL84|20|6.6|16|352800",19.435043452561715,1.1277913244143747,0.000001929459529381048,44160,65536,0.08953446908563391,-0.08947830964599966,-1.9746732109836604,0.9747293704232947,6,35.23038991111479,138.04275957509984,1299.1363271440237],
  ["12AU7|EL84|20|6.6|4|384000",9.73424585710861,0.5500221196308233,0.0000017892373678887143,48000,65536,0.08259914167568574,-0.08254923010417732,-1.958941231931302,0.9589911435028106,6,36.94097151607607,76.68120097148478,2482.4348997160478],
  ["12AU7|EL84|20|6.6|8|384000",13.76863556753362,0.7806182981342812,0.0000018074231471937961,48000,65536,0.08163653672646763,-0.08147789645419579,-1.9747608753106776,0.9749195155829493,6,118.87828849958109,727.713055982819,824.6425686903655],
  ["12AU7|EL84|20|6.6|15|384000",18.855656160787287,1.0708432355220134,0.00000180095299109395,48000,65536,0.0876469742694822,-0.0876032364671594,-1.9771621990557906,0.9772059368581134,6,30.50561390013504,129.0969863295595,1280.0958729291826],
  ["12AU7|EL84|20|6.6|16|384000",19.47371286527726,1.1056903950235681,0.0000017986623615029751,48000,65536,0.08552122271632713,-0.08535587785092418,-1.9690815074433583,0.9692468523087613,6,118.27374101569943,421.7844197413092,1487.2162239940371],
  ["12AU7|EL84|20|8.0|4|352800",10.061321664478356,0.5758388547798289,0.0000019388518933705537,44160,65536,0.09173915355234472,-0.09106825903801032,-1.9474744908984105,0.9481453854127448,6,412.1365132516291,1244.6389008777485,1745.19695496521],
  ["12AU7|EL84|20|8.0|8|352800",14.231262693189741,0.817229314686487,0.0000019565441066748645,44160,65536,0.09036820270974258,-0.0902163871544734,-1.9685020295011781,0.9686538450564474,6,94.4092160286715,334.52820202767157,1453.7304157649362],
  ["12AU7|EL84|20|8.0|15|352800",19.48920366637615,1.1210472439948544,0.000001965638181243093,44160,65536,0.08828981972156377,-0.08812155070411139,-1.9739892646929689,0.9741575337104212,6,107.11651153768236,681.9842536955407,788.1454926716718],
  ["12AU7|EL84|20|8.0|16|352800",20.12802753237958,1.1575306407791635,0.000001972447002893523,44160,65536,0.0940285773493412,-0.09382192423675986,-1.9686361501428045,0.9688428032553859,6,123.54024858694271,531.1765408532931,1246.1298234730862],
  ["12AU7|EL84|20|8.0|4|384000",10.080412647087917,0.5648943339452343,0.000001776464661503098,48000,65536,0.08336386947390913,-0.08330323811340033,-1.9776617510650962,0.9777223824256049,6,44.46607393562104,193.5382960559392,1183.3640402755875],
  ["12AU7|EL84|20|8.0|8|384000",14.258273591390289,0.8017480643475459,0.0000018003984360132506,48000,65536,0.09167037828647195,-0.09163387675710748,-1.9713766380520696,0.9714131395814343,6,24.339960675804594,81.81246821893942,1690.74615956072],
  ["12AU7|EL84|20|8.0|15|384000",19.526198848636785,1.099844189831933,0.000001800297925638909,48000,65536,0.08466131799625404,-0.0846110635007285,-1.9789381939176534,0.978988448413179,6,36.288597008664595,167.89379963048066,1129.9204434616158],
  ["12AU7|EL84|20|8.0|16|384000",20.166234730414974,1.1356329714917561,0.0000017935201473890462,48000,65536,0.08234975053788333,-0.08224489287220704,-1.9784748569028672,0.9785797145685434,6,77.86923324548783,456.99497877939194,866.3406978545233],
  ["12AU7|EL84|43|6.0|4|352800",7.613121549903589,0.4048174770640601,0.000001945833407654615,44160,65536,0.09211018320053288,-0.09195940968490564,-1.9706624979967589,0.9708132715123862,6,91.9860162268921,374.2970798426584,1288.9255930544414],
  ["12AU7|EL84|43|6.0|8|352800",10.768407996126825,0.5746622906970572,0.00000193779898520547,44160,65536,0.09249195200653801,-0.09243723394200574,-1.9762725791534708,0.976327297218003,6,33.227983473888905,145.5322620341542,1199.672671775053],
  ["12AU7|EL84|43|6.0|15|352800",14.746954109557285,0.7884023790981755,0.0000019254403384227324,44160,65536,0.08856127440888471,-0.08841212343296677,-1.9750395965514493,0.9751887475273674,6,94.64483461048982,559.2369936994131,851.4856360816606],
  ["12AU7|EL84|43|6.0|16|352800",15.230334087518255,0.8140462297117936,0.000001926766569667296,44160,65536,0.08814283618776243,-0.08804597858959762,-1.9742539994315051,0.9743508570296698,6,61.73537760136934,257.47597136810504,1201.5118387815162],
  ["12AU7|EL84|43|6.0|4|384000",7.625926389587326,0.39815996176001195,0.0000018166514665567014,48000,65536,0.082271354961994,-0.08208895278662752,-1.9626441115217446,0.962826513697111,6,135.64837569115076,354.01876588398414,1961.1606945942842],
  ["12AU7|EL84|43|6.0|8|384000",10.786525125119608,0.5652446143789132,0.0000017854539663677614,48000,65536,0.08257281719075418,-0.08246739478621723,-1.978743004289856,0.9788484266943929,6,78.07725848476892,483.62853939972575,822.9274913442852],
  ["12AU7|EL84|43|6.0|15|384000",14.771768138673881,0.7755033349890372,0.000001798862249088752,48000,65536,0.08833695389268491,-0.08822682444501713,-1.9711857972007962,0.9712959266484641,6,76.24006453775415,277.86148793917266,1502.0719206771957],
  ["12AU7|EL84|43|6.0|16|384000",15.255961045068913,0.800724671791763,0.0000017960062953600709,48000,65536,0.09080936604329053,-0.0905585268942962,-1.966283276359634,0.9665341155086283,6,169.05053118119167,681.0688351033214,1399.2222306030292],
  ["12AU7|EL84|43|6.6|4|352800",7.654692647144722,0.4046686038022264,0.000001937815388746115,44160,65536,0.08835485352133113,-0.08822915641192954,-1.9749475000738221,0.9750731971832237,6,79.93789226019133,391.0201129301427,1026.3561216398552],
  ["12AU7|EL84|43|6.6|8|352800",10.827209056552043,0.5744629588901151,0.000001932146380316353,44160,65536,0.09536085695616534,-0.09523014825426451,-1.9750862266316134,0.9752169353335142,6,77.01598475529602,423.3132722158048,985.7863706211219],
  ["12AU7|EL84|43|6.6|15|352800",14.827480545476684,0.788137131656646,0.0000019275792322349212,44160,65536,0.08925254925256411,-0.0890900005707974,-1.9738654204456425,0.9740279691274092,6,102.35458558196513,575.8276043709383,901.7706645835442],
  ["12AU7|EL84|43|6.6|16|352800",15.313499958503817,0.8137711608761004,0.0000019384635247648326,44160,65536,0.08871046605559511,-0.08864498436572613,-1.9716484589106966,0.9717139406005657,6,41.462364239900076,142.60951032740041,1468.544445025435],
  ["12AU7|EL84|43|6.6|4|384000",7.667177552851507,0.39817730111747807,0.0000018168086189484446,48000,65536,0.08317919183626998,-0.08304739124048159,-1.9670274327382495,0.9671592333340381,6,96.91663759981049,285.11098721555805,1755.6656553229154],
  ["12AU7|EL84|43|6.6|8|384000",10.844873569207484,0.5652803076022832,0.0000017942752163478068,48000,65536,0.08600799491903466,-0.08591171739915739,-1.9757924330027508,0.975888710522628,6,68.45112900032714,307.3814461179822,1184.2477210581785],
  ["12AU7|EL84|43|6.6|15|384000",14.851674720628196,0.775559875541356,0.0000017728612126473777,48000,65536,0.08224442525379312,-0.08221542324430688,-1.9691453724227244,0.9691743744322106,6,21.555076106234917,59.340256271719895,1854.230623768319],
  ["12AU7|EL84|43|6.6|16|384000",15.33848675700955,0.8007819891442719,0.0000017682099851176334,48000,65536,0.09139781154065003,-0.09131554626108934,-1.9759550217973079,0.9760372870768684,6,55.03356668391363,252.99350778794164,1229.3316897150705],
  ["12AU7|EL84|43|8.0|4|352800",7.6863522461883464,0.401081612062662,0.0000019451533744442,44160,65536,0.0890535227640836,-0.0889494594441539,-1.9630419406474022,0.963146003967332,6,65.65218005453949,172.69453410076778,1935.7477360813434],
  ["12AU7|EL84|43|8.0|8|352800",10.871991496261439,0.5693978566618753,0.0000019432739949837877,44160,65536,0.09446131894309732,-0.09425745638057477,-1.9707419260654007,0.9709457886279232,6,121.31129589547885,646.2690208157101,1009.2896548644954],
  ["12AU7|EL84|43|8.0|15|352800",14.88880952247896,0.781206485821045,0.0000019469365978107503,44160,65536,0.09666322746905637,-0.09653526914545699,-1.9687739130362414,0.9689018713598407,6,74.37784076347731,273.0792932986867,1500.8038480697846],
  ["12AU7|EL84|43|8.0|16|352800",15.376839040398822,0.8066125555740254,0.000001954207904776379,44160,65536,0.09279068989880133,-0.09269391127059964,-1.959925236675908,0.9600220153041097,6,58.593621928937324,145.1217942225367,2145.739995068699],
  ["12AU7|EL84|43|8.0|4|384000",7.698092670913179,0.3949314890612273,0.0000018000597617575996,48000,65536,0.08285193011328591,-0.08275932090465453,-1.9789304332283644,0.9790230424369958,6,68.35113524825398,383.0766436256944,912.5780299147546],
  ["12AU7|EL84|43|8.0|8|384000",10.888602922239127,0.5606975024193813,0.0000017811380672482602,48000,65536,0.08842917155892926,-0.08838328643143765,-1.9766608954584748,0.9767067805859663,6,31.72053054438145,132.597672051333,1307.8209268393755],
  ["12AU7|EL84|43|8.0|15|384000",14.911561451322706,0.7692896122052265,0.00000178091542904368,48000,65536,0.08418635424501418,-0.08406511623667104,-1.9763330003554413,0.9764542383637845,6,88.07676432757732,459.9908309950146,996.2321420851576],
  ["12AU7|EL84|43|8.0|16|384000",15.400336340748499,0.7943053983085973,0.000001781763239477959,48000,65536,0.08351469686096519,-0.08340657052180395,-1.9785705983991981,0.9786787247383595,6,79.17740032255676,498.9260611729261,818.2264198915203],
  ["12AU7|EL34|0|6.0|4|352800",11.758988700075163,0.5519002387745011,0.0000025624581826901537,44160,65536,0.09001383126790265,-0.08993179882501204,-1.9731294707762745,0.9732115032191652,6,51.194472711202025,197.5377161915746,1327.1471622767135],
  ["12AU7|EL34|0|6.0|8|352800",16.632565031318737,0.7838284759494409,0.00000256104324104306,44160,65536,0.10103698913465396,-0.10084286754176934,-1.9719687840458249,0.9721629056387096,6,107.98407095993812,705.9485861446184,879.2682052413687],
  ["12AU7|EL34|0|6.0|15|352800",22.7777236378048,1.0756220960378022,0.00000255598677403413,44160,65536,0.0954745177792865,-0.09543146728933412,-1.9716023241082854,0.9716453745982376,6,25.324289259384642,90.30066294054636,1524.8154744667768],
  ["12AU7|EL34|0|6.0|16|352800",23.524336595003874,1.1105723439442678,0.000002553544856514726,44160,65536,0.09939203097961155,-0.09926091041730022,-1.970854865362915,0.9709859859252263,6,74.12326994678654,313.0243196565371,1340.2097915837246],
  ["12AU7|EL34|0|6.0|4|384000",11.774908167788073,0.5442725886237864,0.0000023664226258196083,48000,65536,0.08701003173649911,-0.08698012741169348,-1.9753684159784544,0.9753983203032601,6,21.00828844802608,78.31758676565654,1444.0302216977611],
  ["12AU7|EL34|0|6.0|8|384000",16.65508969920249,0.7730369926763478,0.0000023786974454001148,48000,65536,0.08461292229971855,-0.08458400429175243,-1.97803964481769,0.9780685628256561,6,20.890905232012592,86.04825739645693,1269.2188547100293],
  ["12AU7|EL34|0|6.0|15|384000",22.808574799622622,1.0608399286231112,0.0000023885713244852313,48000,65536,0.08537421048459794,-0.08502281151836537,-1.9625004272827014,0.962851826248934,6,252.06958504073134,1132.2241466828818,1181.3486184485753],
  ["12AU7|EL34|0|6.0|16|384000",23.556198450065885,1.0953063095285867,0.000002391361271449782,48000,65536,0.08189324361193207,-0.08175286918440958,-1.973113854730182,0.9732542291577045,6,104.84887202952808,434.94798380898953,1221.8899381947274],
  ["12AU7|EL34|0|6.6|4|352800",12.146095030675927,0.574318802313311,0.000002540770693137019,44160,65536,0.09602932901749349,-0.09598283067940477,-1.9740153103836782,0.9740618087217668,6,27.19489652610386,108.65905866426772,1366.9884905234164],
  ["12AU7|EL34|0|6.6|8|352800",17.18010851112263,0.8156436123522884,0.000002513119429167401,44160,65536,0.09719643925603601,-0.09702994059791625,-1.9666188564576266,0.9667853551157464,6,96.26786324111761,343.78634661188585,1552.8874448492425],
  ["12AU7|EL34|0|6.6|15|352800",23.527564687483643,1.1192641989458452,0.0000025117247105753764,44160,65536,0.09244942250638824,-0.09223274937753775,-1.9652468712552227,0.9654635443840732,6,131.75253635607024,459.05980709471004,1514.435872386881],
  ["12AU7|EL34|0|6.6|16|352800",24.298756215904678,1.1556349098345495,0.0000025014669544165626,44160,65536,0.09010462835679334,-0.0900053124270092,-1.9750630495074937,0.9751623654372777,6,61.92413904183481,280.0624367410175,1132.1792536428118],
  ["12AU7|EL34|0|6.6|4|384000",12.162374236297799,0.566546433961603,0.0000023514180849180363,48000,65536,0.08834932162303752,-0.08829405218106538,-1.9773462055250786,0.9774014749670505,6,38.24450944221014,170.2104481359929,1226.754473274931],
  ["12AU7|EL34|0|6.6|8|384000",17.20314219555065,0.8046473237057394,0.000002361004599381479,48000,65536,0.0887663484925104,-0.08865879168144938,-1.9744575879305875,0.9745651447416485,6,74.09760404755627,325.893466578122,1248.6809025399787],
  ["12AU7|EL34|0|6.6|15|384000",23.559113098353034,1.1042013951520946,0.000002354367843451549,48000,65536,0.08412622696629252,-0.08401767791647068,-1.9736182360485726,0.9737267850983944,6,78.9089581273769,312.53232027309645,1314.6386536984],
  ["12AU7|EL34|0|6.6|16|384000",24.331338117773168,1.1400789770090543,0.0000023635777841480863,48000,65536,0.08267501187659256,-0.08264228153739718,-1.9693833725442316,0.9694161028834269,6,24.19990031632494,67.8284438818537,1830.5010997729141],
  ["12AU7|EL34|0|8.0|4|352800",12.914730275422578,0.6173904226924816,0.0000025186369851124205,44160,65536,0.08909643582895602,-0.0882650594308148,-1.9175084621557617,0.9183398385539029,6,526.4052771157501,663.8249460285328,4119.456318575126],
  ["12AU7|EL34|0|8.0|8|352800",18.267306847558547,0.876775109234527,0.000002509839025502617,44160,65536,0.08803297152834624,-0.08696098041634913,-1.9220282049906336,0.9231001961026307,6,687.9427242337522,1009.7295029086946,3483.2419834917373],
  ["12AU7|EL34|0|8.0|15|352800",25.01644397644761,1.20312520389001,0.0000025001413084194506,44160,65536,0.09440335604824877,-0.09433178038149156,-1.9207815168501847,0.9208530925169419,6,42.588404229336724,51.34834271685328,4578.475442269399],
  ["12AU7|EL34|0|8.0|16|352800",25.836438452281588,1.2422246666841807,0.0000024984355246381205,44160,65536,0.09629608096857836,-0.09606332239716525,-1.9273335954530264,0.9275663540244395,6,135.88489318985046,188.88642710737616,4033.074977679608],
  ["12AU7|EL34|0|8.0|4|384000",12.931649202568513,0.6093834550169426,0.0000023564467621221375,48000,65536,0.09044255814940481,-0.09012625624712725,-1.964096311956466,0.9644126138587438,6,214.1119235815263,955.2758866852971,1259.308559932047],
  ["12AU7|EL34|0|8.0|8|384000",18.291245904907747,0.865446692257678,0.0000023434670155183274,48000,65536,0.08625757318070926,-0.08619047009502391,-1.9770033373954792,0.9770704404811645,6,47.562600745888986,209.9463342898275,1207.721199977707],
  ["12AU7|EL34|0|8.0|15|384000",25.049232454921366,1.1876073541491734,0.000002344757588203233,48000,65536,0.08206763024736391,-0.08198069580194392,-1.9657985582211424,0.9658854926665623,6,64.77411337625028,169.2455169311079,1952.0727764265848],
  ["12AU7|EL34|0|8.0|16|384000",25.87030107232542,1.2261988006026299,0.0000023456868453942658,48000,65536,0.08156886122405081,-0.08144235946579091,-1.9758156468678663,0.9759421486261262,6,94.85505956975915,469.4278159508826,1018.8548560094289],
  ["12AU7|EL34|20|6.0|4|352800",7.6811584452980455,0.3324119113335457,0.000002459502347852932,44160,65536,0.08792147342947307,-0.08776959368402197,-1.9677553059683197,0.9679071857137708,6,97.07982658630687,322.52969090351365,1509.02714667076],
  ["12AU7|EL34|20|6.0|8|352800",10.86466361188869,0.47226535444389145,0.000002443211971702222,44160,65536,0.09319532095355654,-0.09311964120253716,-1.9697276222522988,0.9698033020033181,6,45.61531619342179,154.60940484401908,1567.058255480633],
  ["12AU7|EL34|20|6.0|15|352800",14.878787069952322,0.6481853636186572,0.0000024394794932360377,44160,65536,0.08818707971213628,-0.08794178641727006,-1.9545807389258139,0.9548260322206802,6,156.39905411749592,352.8714661427591,2242.718898912916],
  ["12AU7|EL34|20|6.0|16|352800",15.366486325885484,0.6692314001465034,0.0000024441490050847294,44160,65536,0.090955807424926,-0.09085683929770262,-1.9611459870956198,0.9612449552228433,6,61.129382640053095,154.0883293814564,2065.2915468283854],
  ["12AU7|EL34|20|6.0|4|384000",7.689089526726917,0.32934518351605196,0.0000024746894237456626,48000,65536,0.08850378829720248,-0.0882851459312488,-1.9670959776935188,0.9673146200594726,6,151.16832942560865,567.2758855629456,1463.6825450269143],
  ["12AU7|EL34|20|6.0|8|384000",10.875886005011543,0.46792532944064325,0.000002506559252369412,48000,65536,0.0900191047959714,-0.08977995378430043,-1.9689350404384305,0.9691741914501013,6,162.57973701772647,866.6810127618971,1046.9014060106033],
  ["12AU7|EL34|20|6.0|15|384000",14.894158149684696,0.6422390059389166,0.000002502321469884189,48000,65536,0.08613544107730803,-0.0860990085283085,-1.9728184916605334,0.9728549242095328,6,25.855378168411313,86.47166423994028,1595.4457566402232],
  ["12AU7|EL34|20|6.0|16|384000",15.382360921514575,0.6630906517782067,0.0000025001721281333343,48000,65536,0.08501660545059143,-0.0849749104421254,-1.974234459724289,0.9742761547327551,6,29.98045226404741,106.13303128432607,1486.566742388094],
  ["12AU7|EL34|20|6.6|4|352800",7.737748272332199,0.3366486245734595,0.0000024556841040324443,44160,65536,0.09087962986648546,-0.09072392946423927,-1.9593256641580603,0.9594813645603066,8,96.28179726446407,240.71891303835656,2081.7734186270754],
  ["12AU7|EL34|20|6.6|8|352800",10.94470703116212,0.47827336975266993,0.0000024697879154489253,44160,65536,0.09613815485836591,-0.09606206024227419,-1.9696935806258944,0.9697696752419862,8,44.46095504957989,155.33895834508198,1568.275664630923],
  ["12AU7|EL34|20|6.6|15|352800",14.988403369284276,0.6564236603106718,0.0000024641916181291623,44160,65536,0.09744022667013483,-0.09723969928293097,-1.9712356460401241,0.9714361734273279,8,115.67283510327636,670.3889729894901,956.8178739780155],
  ["12AU7|EL34|20|6.6|16|352800",15.479695666256465,0.6777382545955662,0.0000024360314964466015,44160,65536,0.09357762270536389,-0.09349264591948744,-1.9743789436360308,0.9744639204219074,8,51.01222473053832,220.25047164875338,1232.2221025026897],
  ["12AU7|EL34|20|6.6|4|384000",7.745563756947305,0.33357215886690605,0.0000025035316102370874,48000,65536,0.04544326975879502,-0.005596098324528933,-1.552537675754123,0.592384847188389,8,128000,8000,24000],
  ["12AU7|EL34|20|6.6|8|384000",10.955765807176679,0.473919487424702,0.0000025010394922749896,48000,65536,0.05892346032294556,-0.006165567137968101,-1.5248364460671338,0.5775943392521112,8,137953.52005687976,11894.80242340891,21650.48560982002],
  ["12AU7|EL34|20|6.6|15|384000",15.003550534708998,0.6504583074357295,0.000002498178820921703,48000,65536,0.03924784848092864,-0.002345968473044665,-1.5534413858980625,0.5903432659059464,8,172174.47842612653,7085.876460388079,25125.114349129126],
  ["12AU7|EL34|20|6.6|16|384000",15.495339020470267,0.6715779030959053,0.000002493887640478128,48000,65536,0.04544326975879502,-0.005596098324528933,-1.552537675754123,0.592384847188389,8,128000,8000,24000],
  ["12AU7|EL34|20|8.0|4|352800",7.799823101567919,0.342241724392785,0.0000024617665690808506,44160,65536,0.09021481759053895,-0.09014497571646578,-1.9729456652504056,0.9730155071244787,5,43.4865426427515,162.52643200908045,1373.4676658100498],
  ["12AU7|EL34|20|8.0|8|352800",11.032508368580896,0.4862015285616629,0.000002450657112629575,44160,65536,0.0915258128327883,-0.09142093098662737,-1.973844716973363,0.973949598819524,5,64.38050672167759,278.3394462043972,1203.7768235711674],
  ["12AU7|EL34|20|8.0|15|352800",15.108643735389629,0.6672925652151769,0.0000024484882315530957,44160,65536,0.10033031880739511,-0.09998805274864041,-1.9616908367271755,0.96203310278593,5,191.8766728859362,802.5604982691282,1370.799635021716],
  ["12AU7|EL34|20|8.0|16|352800",15.603877386145289,0.6889618038898723,0.0000024443239270868913,44160,65536,0.08911706263054063,-0.08873345812908515,-1.9600488997197332,0.9604325042211886,5,242.21884610376844,908.4565275991299,1358.4016761320436],
  ["12AU7|EL34|20|8.0|4|384000",7.8073417981392845,0.33912602277099857,0.0000024894999583241804,48000,65536,0.08444184968644755,-0.06938797538989909,-1.7546115381966914,0.7696654124932398,6,12000,8000,8000],
  ["12AU7|EL34|20|8.0|8|384000",11.04314741777143,0.4817918921511624,0.000002491273077237316,48000,65536,0.08444184968644755,-0.06938797538989909,-1.7546115381966914,0.7696654124932398,6,12000,8000,8000],
  ["12AU7|EL34|20|8.0|15|384000",15.12321613018215,0.6612509976513763,0.000002481498708905312,48000,65536,0.08444184968644755,-0.06938797538989909,-1.7546115381966914,0.7696654124932398,6,12000,8000,8000],
  ["12AU7|EL34|20|8.0|16|384000",15.618927080443202,0.6827226707613685,0.0000024888826385765625,48000,65536,0.08444184968644755,-0.06938797538989909,-1.7546115381966914,0.7696654124932398,6,12000,8000,8000],
  ["12AU7|EL34|43|6.0|4|352800",5.682630618038299,0.2360737040364926,0.0000024946048934824133,44160,65536,0.09379674811388967,-0.09373142233154869,-1.9768995019433993,0.9769648277257403,5,39.119817878628,185.54681117747327,1123.004872388095],
  ["12AU7|EL34|43|6.0|8|352800",8.037835864365992,0.33545702109829717,0.0000024768379392621853,44160,65536,0.09176107857169535,-0.09168271270495154,-1.9673487278961332,0.967427093762877,5,47.973638038201145,146.6568371340026,1712.757821749951],
  ["12AU7|EL34|43|6.0|15|352800",11.007544421062404,0.4604578902164946,0.000002464788967942157,44160,65536,0.08950200880250167,-0.08939413823640414,-1.9636731607327382,0.9637810312988359,5,67.71435206372706,183.48492999735114,1887.9484665850066],
  ["12AU7|EL34|43|6.0|16|352800",11.368351155826645,0.47540266777940754,0.000002461727782094333,44160,65536,0.09053147949442994,-0.09040467291807791,-1.9718377619883034,0.9719645685646554,5,78.70370931944537,316.8502185457623,1279.8232287492576],
  ["12AU7|EL34|43|6.0|4|384000",5.687598053193817,0.2345366530879559,0.0000025028167903652263,48000,65536,0.0827103186238874,-0.08266853812834611,-1.9719172979489632,0.9719590784445044,6,30.879834367166342,96.40857113385147,1641.8125003684067],
  ["12AU7|EL34|43|6.0|8|384000",8.044864967910028,0.3332809890995422,0.0000025059614809039695,48000,65536,0.08454442334268115,-0.08450689665789157,-1.9765013882313807,0.9765389149161702,6,27.133323447522223,105.41513020215555,1345.5082342490812],
  ["12AU7|EL34|43|6.0|15|384000",11.017172245919857,0.4574755882241793,0.0000025135266313302525,48000,65536,0.08477536460640239,-0.08461679835217942,-1.9733120242987,0.9734705905529228,6,114.41920662103206,548.1257437795311,1095.1272746269544],
  ["12AU7|EL34|43|6.0|16|384000",11.378294385259622,0.47232297368380094,0.000002508965305286996,48000,65536,0.0834490009176401,-0.08341146571165378,-1.975402187917811,0.9754397231237971,6,27.495822071559942,99.97980849089512,1419.7738799626884],
  ["12AU7|EL34|43|6.6|4|352800",5.639161761039086,0.23543823733403016,0.0000024322550348914265,44160,65536,0.08844206004641382,-0.0883172753658198,-1.9611228476993836,0.9612476323799775,4,79.27891313518094,198.57603596070527,2020.647457842505],
  ["12AU7|EL34|43|6.6|8|352800",7.976350760161727,0.33454647693138767,0.000002438334155730489,44160,65536,0.08822275868581622,-0.08815841132440899,-1.9752356679214547,0.975300015282862,4,40.96917768367117,165.87221998307857,1238.4441495252672],
  ["12AU7|EL34|43|6.6|15|352800",10.923342432890585,0.4592026960346285,0.0000024761938402447872,44160,65536,0.09178863845605204,-0.09173199946243041,-1.9747360769757805,0.9747927159694022,4,34.65846589923991,139.79863511276366,1293.7315123918372],
  ["12AU7|EL34|43|6.6|16|352800",11.281389241018811,0.4741075005437774,0.000002472259686996182,44160,65536,0.08951478573753528,-0.08925748758128314,-1.9678049629626,0.9680622611188521,4,161.62759658993463,834.0387314611503,988.5226512251819],
  ["12AU7|EL34|43|6.6|4|384000",5.643965885216134,0.2338857099424758,0.0000024995987453589956,48000,65536,0.09086874877289089,-0.09074017316718741,-1.9696280103336468,0.9697565859393502,5,86.53719675347311,311.5385703813712,1565.3294583632019],
  ["12AU7|EL34|43|6.6|8|384000",7.983148772506679,0.3323485333065318,0.0000025065064536053068,48000,65536,0.08358441803657439,-0.08345595509708649,-1.972547040928716,0.9726755038682038,5,94.00216176250706,366.7847155311317,1326.4050693387294],
  ["12AU7|EL34|43|6.6|15|384000",10.932653807183216,0.45619051293244584,0.000002496929479712702,48000,65536,0.08582209270593899,-0.0857561869405837,-1.975652686467287,0.9757185922326422,5,46.95074326261302,189.88439432402822,1312.3994409793725],
  ["12AU7|EL34|43|6.6|16|384000",11.291005618802712,0.47099693993460595,0.0000024696470928803757,48000,65536,0.08388431847308762,-0.08372840279586496,-1.97206810800275,0.9722240236799726,5,113.70100024306261,473.0504312584646,1248.5135052960218],
  ["12AU7|EL34|43|8.0|4|352800",5.515931818625982,0.23235914320012743,0.000002478305921226881,44160,65536,0.09967975432610796,-0.09959222079755231,-1.973843100202751,0.9739306337313066,3,49.329525942209074,221.66417699575322,1261.5454732710036],
  ["12AU7|EL34|43|8.0|8|352800",7.802046735048591,0.33015772955354883,0.000002425830725810301,44160,65536,0.09023006710536433,-0.09016223849275419,-1.9708820587806497,0.9709498873932599,3,42.22538799524805,143.55340192296092,1511.7682423669842],
  ["12AU7|EL34|43|8.0|15|352800",10.684638583071353,0.4531694243878559,0.000002417488558847702,44160,65536,0.09063302322485414,-0.09057218230130648,-1.9607778234164737,0.9608386643400213,3,37.70542569782571,90.91994045592195,2152.197902084961],
  ["12AU7|EL34|43|8.0|16|352800",11.034861208358818,0.4678797097487078,0.000002407975480245553,44160,65536,0.09993260537468823,-0.09965256547508942,-1.957797564124607,0.9580776040242058,3,157.5689467041129,465.00869744072924,1939.6933377632336],
  ["12AU7|EL34|43|8.0|4|384000",5.520391564552622,0.23075047633258977,0.0000025389598322249797,48000,65536,0.0848420812917642,-0.0847569867296198,-1.971385796361102,0.9714708909232463,3,61.328131718607885,206.36759638652148,1562.5577707670343],
  ["12AU7|EL34|43|8.0|8|384000",7.80835768638525,0.3278804516407719,0.0000025411509058072237,48000,65536,0.08276278304586619,-0.08264230321199204,-1.9778624893313301,0.9779829691652042,3,89.03216379496982,592.0942776800583,768.5214657017837],
  ["12AU7|EL34|43|8.0|15|384000",10.693282805820816,0.4500486509746867,0.0000025483191390095993,48000,65536,0.08311925878836839,-0.08291238549330823,-1.9646957868028974,0.9649026600979574,3,152.29832937507348,455.0848275935991,1728.4529351840451],
  ["12AU7|EL34|43|8.0|16|384000",11.043788563141105,0.46465700227093537,0.000002539104329940021,48000,65536,0.08427193983793174,-0.08377241574102533,-1.9471511969237065,0.9476507210206131,3,363.34161695973756,758.0786262033671,2528.057850185757],
  ["12AU7|6L6GC|0|6.0|4|352800",6.028486524330916,0.2684215256136342,0.000002161523242276454,44160,65536,0.09281560284604706,-0.08690928344994102,-1.8454217561353734,0.8513280755314795,8,3691.848168002831,4019.6860045512803,5018.067342977975],
  ["12AU7|6L6GC|0|6.0|8|352800",8.52702931607483,0.3813056990420209,0.0000021839525695188665,44160,65536,0.09335691174101225,-0.09296262819476483,-1.861258173404733,0.8616524569509805,8,237.64550431873414,163.21615021381098,8197.682299562204],
  ["12AU7|6L6GC|0|6.0|15|352800",11.677474960107833,0.5233106988753058,0.0000021808903600420475,44160,65536,0.09109343811265473,-0.08916701449537263,-1.8787997543731487,0.8807261779904308,8,1200.1805237180993,1066.5557501971475,6064.9547775267265],
  ["12AU7|6L6GC|0|6.0|16|352800",12.060241307424029,0.54030667841393,0.0000021800630139710285,44160,65536,0.09066457433086841,-0.09013678839222734,-1.8648439451537546,0.8653717310923957,8,327.8204585070308,226.45191413874386,7892.600403739271],
  ["12AU7|6L6GC|0|6.0|4|384000",6.034321346819924,0.2663606366960141,0.000002461000521137261,48000,65536,0.058188894593956195,-0.004216843879727207,-1.4064861590525268,0.46045820976675583,8,160404.19905468274,7267.433883357712,40129.66256467103],
  ["12AU7|6L6GC|0|6.0|8|384000",8.535285504250718,0.3783886315521238,0.0000024960525044475995,48000,65536,0.05192397850531442,-0.0034919684618315875,-1.3813135353234913,0.42974554536697424,8,164969.98642330966,5894.728519549024,45721.09885184669],
  ["12AU7|6L6GC|0|6.0|15|384000",11.688783428435531,0.5193136249545751,0.000002514788805798202,48000,65536,0.07350738672324603,-0.014451147905556346,-1.4038616530669823,0.462917891884672,8,99411.2057019056,8193.974044114679,38877.52365122696],
  ["12AU7|6L6GC|0|6.0|16|384000",12.071920189320215,0.5361789650182857,0.0000025352072283980325,48000,65536,0.05354884126085163,-0.00669159299332776,-1.4412887076814065,0.48814595594893023,8,127104.48037641324,6627.581560202274,37200.83737183325],
  ["12AU7|6L6GC|0|6.6|4|352800",6.276300059479519,0.28086804610871513,0.00000219115510133668,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,8,128000,12000,12000],
  ["12AU7|6L6GC|0|6.6|8|352800",8.877550130601907,0.3989778823249834,0.000002188064053955178,44160,65536,0.044294239180563244,-0.00981879570332603,-1.6285984387558052,0.6630738822330423,8,84592.92280415741,11324.418652155744,11745.811857112642],
  ["12AU7|6L6GC|0|6.6|15|352800",12.157501039957614,0.5475585109511891,0.0000021713581750709654,44160,65536,0.08988028912065803,-0.08008249873127657,-1.791395955629942,0.8011937460193232,8,6480.891782073494,4160.731660281343,8285.024985357983],
  ["12AU7|6L6GC|0|6.6|16|352800",12.556001819518107,0.5653428280126246,0.000002178085518589926,44160,65536,0.04124610700238894,-0.004220455310607872,-1.6151589850767927,0.6521846367685737,8,128000,12000,12000],
  ["12AU7|6L6GC|0|6.6|4|384000",6.282348592892703,0.2787218860753873,0.0000025439509641151585,48000,65536,0.08680994220743618,-0.08668351897129373,-1.871243449180748,0.8713698724168903,8,89.06872189071636,60.50263370883297,8354.413280275636],
  ["12AU7|6L6GC|0|6.6|8|384000",8.88610888428642,0.3959402699528959,0.0000025497484486420128,48000,65536,0.08202667469376441,-0.07918806773385453,-1.889438685785524,0.8922772927454341,8,2152.4186598536558,2529.1202678773175,4436.722050559235],
  ["12AU7|6L6GC|0|6.6|15|384000",12.169223847787428,0.5433961853163944,0.0000025448808826327813,48000,65536,0.08433241452948331,-0.08196019721837434,-1.896923973448327,0.899296190759436,8,1743.78256199223,2157.5663954658135,4329.405648095082],
  ["12AU7|6L6GC|0|6.6|16|384000",12.568108616122192,0.5610444761557951,0.0000025268323464494127,48000,65536,0.08962668458479481,-0.08720768832939639,-1.9015843058702635,0.9040033021256619,8,1672.1566206833425,2984.046853863433,3183.8676948251255],
  ["12AU7|6L6GC|0|8.0|4|352800",6.789870218720153,0.30642854533602054,0.0000021511604771017464,44160,65536,0.09032900847760192,-0.09021568775436585,-1.976250382187096,0.976363702910332,6,70.48608081781488,372.53222081203836,970.5790128977821],
  ["12AU7|6L6GC|0|8.0|8|352800",9.603971952678066,0.4352713951875174,0.0000021570708567218633,44160,65536,0.09079128993947214,-0.09039853145636541,-1.960179414381162,0.9605721728642687,6,243.42835322993008,1019.7241670056779,1238.9691681953966],
  ["12AU7|6L6GC|0|8.0|15|352800",13.152310337970896,0.5973571048303746,0.000002122428826045953,44160,65536,0.09097899973286808,-0.0908817448880829,-1.9747353219614867,0.974832576806272,6,60.05525637189908,266.6683113721859,1164.5658251248751],
  ["12AU7|6L6GC|0|8.0|16|352800",13.583419197274685,0.6167603638749968,0.000002130475184910554,44160,65536,0.09384149524193604,-0.09363902090920284,-1.9715364651855112,0.9717389395182444,6,121.28098305105497,789.9064254660382,819.803002118403],
  ["12AU7|6L6GC|0|8.0|4|384000",6.796349497986006,0.3041067237996012,0.000002617451604427477,48000,65536,0.08161851581547827,-0.08142123095651313,-1.9695652729132445,0.9697625577722095,7,147.90464970654858,574.868897419756,1301.6227787208873],
  ["12AU7|6L6GC|0|8.0|8|384000",9.61314010752987,0.43198518836908606,0.0000026015922936718446,48000,65536,0.08445015511848288,-0.08439092651966323,-1.9688092783418762,0.9688685069406959,7,42.878018013014454,124.2635449876253,1808.598181963851],
  ["12AU7|6L6GC|0|8.0|15|384000",13.164867955698718,0.5928541601777946,0.0000025792057517416333,48000,65536,0.0815640421678942,-0.08149852889667465,-1.9796242368203696,0.9796897500915891,7,49.108466708617215,245.0028926008829,1009.0467307677275],
  ["12AU7|6L6GC|0|8.0|16|384000",13.596388157218726,0.6121102125836382,0.0000025925181765852706,48000,65536,0.084533967606097,-0.08449268000941762,-1.9752107588840082,0.9752520464806878,7,29.856973727475147,109.83825032054253,1421.6753191643272],
  ["12AU7|6L6GC|20|6.0|4|352800",4.305284346030933,0.18504316812276944,0.0000023631982646835723,44160,65536,0.09080307204144779,-0.0907603806356467,-1.9754053374191534,0.9754480288249545,6,26.405277441432517,105.62826489968414,1290.1673319868098],
  ["12AU7|6L6GC|20|6.0|8|352800",6.089637319070561,0.2629030777119034,0.000002410091360496109,44160,65536,0.09088715414278875,-0.09068896058785464,-1.9602051032712093,0.9604032968261434,6,122.57719663181226,328.6694895283628,1939.8962950970824],
  ["12AU7|6L6GC|20|6.0|15|352800",8.339551230880458,0.3608405630390815,0.0000023765529319977738,44160,65536,0.09081237764875608,-0.0907599699923956,-1.9681520120685794,0.96820441972494,6,32.41333708684592,97.82503726974112,1716.4914208092455],
  ["12AU7|6L6GC|20|6.0|16|352800",8.612906324417866,0.37255599764448416,0.0000023642666888716946,44160,65536,0.09674430268365704,-0.0966380595388181,-1.968759233084627,0.9688654762294662,6,61.696823402920444,218.48538876327018,1557.506965169628],
  ["12AU7|6L6GC|20|6.0|4|384000",4.308805427862539,0.18381645744817066,0.000002349372383640951,48000,65536,0.08406157812447512,-0.08401541554411576,-1.9785697444122916,0.9786159069926509,7,33.57091418386382,148.66166613133717,1172.413717249962],
  ["12AU7|6L6GC|20|6.0|8|384000",6.094619904541046,0.26116651096118265,0.0000023192449660288745,48000,65536,0.08163049763203115,-0.08131954773309766,-1.9639184756895876,0.9642294255885211,7,233.24793800092675,875.9426298539712,1350.251687536779],
  ["12AU7|6L6GC|20|6.0|15|384000",8.346376054306601,0.3584606744263517,0.000002373613180700932,48000,65536,0.08460213487969682,-0.08450437919644532,-1.9490611115227998,0.9491588672060514,7,70.65828276058475,122.19411219689383,3066.7569372553917],
  ["12AU7|6L6GC|20|6.0|16|384000",8.619954629263834,0.37009841523249887,0.0000023430391119803334,48000,65536,0.08386054719703369,-0.0837241723354293,-1.9652332189977832,0.9653695938593877,7,99.46753456695335,276.05590753381324,1877.9141194700737],
  ["12AU7|6L6GC|20|6.6|4|352800",4.377703330500924,0.1890574723869511,0.0000023312999453757317,44160,65536,0.0935669233551253,-0.0934202160136111,-1.9698514380909316,0.9699981454324458,5,88.10872213559621,343.5980889719223,1366.7896209402409],
  ["12AU7|6L6GC|20|6.6|8|352800",6.192070561810349,0.26860089371854406,0.000002379116801311271,44160,65536,0.09537037263912924,-0.09519572315622717,-1.9729972443752866,0.9731718938581886,5,102.92016954873993,606.1827467744355,920.7874576296924],
  ["12AU7|6L6GC|20|6.6|15|352800",8.479829964932845,0.36865705736032817,0.0000023841792604032683,44160,65536,0.09183875744849805,-0.0917215371116803,-1.968894470668606,0.9690116910054237,5,71.71384064051838,246.88689048035837,1520.6323363339393],
  ["12AU7|6L6GC|20|6.6|16|352800",8.75778315317326,0.3806267873664308,0.000002363630816441579,44160,65536,0.09479035930517263,-0.09472845534462715,-1.9700107511554417,0.9700726551159872,5,36.681308828913124,125.3558602886616,1580.7189053818252],
  ["12AU7|6L6GC|20|6.6|4|384000",4.38123562225986,0.18777283549386278,0.0000024514678539523407,48000,65536,0.08877607260672461,-0.08872735371325688,-1.9742283051001532,0.9742770239936209,6,33.54841740197979,125.6680993752932,1466.9771463412844],
  ["12AU7|6L6GC|20|6.6|8|384000",6.197069045997818,0.2667821968519373,0.0000024445298660921595,48000,65536,0.08125139600258117,-0.08106121592511048,-1.9720122501754374,0.9722024302529081,6,143.21691152846904,714.1488791792931,1008.7724685019009],
  ["12AU7|6L6GC|20|6.6|15|384000",8.486676520985105,0.36616465770979006,0.000002460346701283065,48000,65536,0.08205313832242052,-0.08189609517278323,-1.974656095956647,0.9748131391062842,6,117.0822583490918,663.1268371819458,895.8976519156562],
  ["12AU7|6L6GC|20|6.6|16|384000",8.764853976703455,0.378053043848349,0.000002428342090952389,48000,65536,0.08570657305124268,-0.08565344490615072,-1.9725567650286546,0.9726098931737466,6,37.89627470488034,128.23341591337808,1569.078982824005],
  ["12AU7|6L6GC|20|8.0|4|352800",4.497795302230584,0.19597984565341178,0.0000023498651533889464,44160,65536,0.09568678035813236,-0.09562970663724188,-1.9661095446343637,0.9661666183552543,4,33.50136527140178,99.88210537773978,1832.7387624402693],
  ["12AU7|6L6GC|20|8.0|8|352800",6.361935027427012,0.27842485584500987,0.0000023307548988760708,44160,65536,0.0923703328470604,-0.09225474945962192,-1.96914118948286,0.9692567728702985,4,70.30455714033897,245.47240359705398,1507.8472283804228],
  ["12AU7|6L6GC|20|8.0|15|352800",8.712453179405372,0.382133046438881,0.00000239756898475738,44160,65536,0.08900431971756369,-0.08872415652671375,-1.9664110894869922,0.9666912526778421,4,177.0243959203412,872.5466549762605,1029.5927718755424],
  ["12AU7|6L6GC|20|8.0|16|352800",8.998031396635623,0.39454136766782594,0.000002377882461088529,44160,65536,0.09449140997118645,-0.09434018553291006,-1.9750610078097948,0.9752122322480713,4,89.93445639898988,587.2760369735106,822.0943950948613],
  ["12AU7|6L6GC|20|8.0|4|384000",4.50132053588265,0.19456932058900772,0.0000024263193505142033,48000,65536,0.08674228778221747,-0.08660469762955807,-1.9765309172159913,0.9766685073686506,4,97.01804119454279,700.9608807050497,741.8526361071338],
  ["12AU7|6L6GC|20|8.0|8|384000",6.3669235797641175,0.27642799938014145,0.00000247332317825263,48000,65536,0.08338077012067739,-0.08334461870253591,-1.9741483182375272,0.9741844696556687,4,26.503605463669434,90.73542302405508,1507.715946644511],
  ["12AU7|6L6GC|20|8.0|15|384000",8.719286224516571,0.3793966662654808,0.000002442166878642131,48000,65536,0.08105076924685661,-0.08088071410284424,-1.9684297478841486,0.968599803028161,4,128.36303903953186,422.57151057614465,1527.2422083015895],
  ["12AU7|6L6GC|20|8.0|16|384000",9.0050882239351,0.39171560611226114,0.000002450659700416952,48000,65536,0.08100327051800307,-0.08082134403168098,-1.963513812256045,0.9636957387423669,4,137.4146022572884,365.31415421812545,1894.7160598079702],
  ["12AU7|6L6GC|43|6.0|4|352800",3.311709404148144,0.13947637478997088,0.0000022946321797920774,44160,65536,0.09775227675359448,-0.09746405719084648,-1.9572239626361791,0.957512182198927,4,165.80068542505887,472.4766349603809,1965.3727470281071],
  ["12AU7|6L6GC|43|6.0|8|352800",4.684269544673311,0.19818136832286237,0.0000023828266981955028,44160,65536,0.09400469812362149,-0.09383255569455039,-1.9622026941965143,0.9623748366255853,4,102.91650327302635,298.1920955266272,1855.2259990694147],
  ["12AU7|6L6GC|43|6.0|15|352800",6.4149484557477,0.27202094329821164,0.000002334242000743759,44160,65536,0.09352901315221657,-0.09327279154539275,-1.9664575302834604,0.9667137518902841,4,154.0329591862928,664.5748098056692,1236.2577747507432],
  ["12AU7|6L6GC|43|6.0|16|352800",6.625218489251633,0.280850947479047,0.0000023600619507727163,44160,65536,0.09095002533016926,-0.09052195572729693,-1.949939992499539,0.9503680621024113,4,264.9014397928933,617.8592055891463,2240.502152822333],
  ["12AU7|6L6GC|43|6.0|4|384000",3.3141302185543116,0.13863384660300235,0.0000024192774877826733,48000,65536,0.0811695573878003,-0.08110392396839351,-1.9748466357841798,0.9749122692035866,4,49.43776774075839,180.98233082562695,1371.8275546591572],
  ["12AU7|6L6GC|43|6.0|8|384000",4.68769534009876,0.19698834576669927,0.000002526286340562112,48000,65536,0.08561516415098015,-0.0855053963619559,-1.96948418423927,0.9695939520282943,4,78.40687298789155,255.12365392497796,1631.9946646135556],
  ["12AU7|6L6GC|43|6.0|15|384000",6.419640912461138,0.2703857765183914,0.0000024795628902124153,48000,65536,0.08463284826546182,-0.08453990875905194,-1.96375569270786,0.96384863221427,4,67.15082148148414,169.95541428229717,2080.3793957269436],
  ["12AU7|6L6GC|43|6.0|16|384000",6.630064710896529,0.27916240521137525,0.0000025250319369999675,48000,65536,0.08151910468807236,-0.0812719261251379,-1.9637166274093554,0.9639638059722897,4,185.59318088722338,558.0488913169229,1684.983443136271],
  ["12AU7|6L6GC|43|6.6|4|352800",3.316234585534175,0.14039337388940587,0.0000023696285359100746,44160,65536,0.09284475604490605,-0.09269678618392604,-1.9738135626233513,0.9739615324843314,3,89.55934310266194,465.1242113647162,1016.3040663928623],
  ["12AU7|6L6GC|43|6.6|8|352800",4.690670043557204,0.1994796777409993,0.0000024349798552167636,44160,65536,0.09523131482933175,-0.09506654441318686,-1.9712708569534938,0.9714356273696387,3,97.23534246702206,446.3105044854591,1180.927905104892],
  ["12AU7|6L6GC|43|6.6|15|352800",6.4237134361339665,0.27379967688341,0.0000023524615781945598,44160,65536,0.08882106175004705,-0.08866813085585248,-1.974791540529216,0.9749444714234106,3,96.76139597681362,573.8484665719833,850.9409663743459],
  ["12AU7|6L6GC|43|6.6|16|352800",6.634270901421459,0.28268790841819463,0.0000023645315613301417,44160,65536,0.08868719475548317,-0.0886208860072336,-1.976897842739728,0.9769641514879776,3,41.99726655055612,188.89558431016812,1119.6949652108826],
  ["12AU7|6L6GC|43|6.6|4|384000",3.318618304916548,0.13950322725915962,0.000002489016225934288,48000,65536,0.08758507273571162,-0.08753148159383499,-1.9759878220686649,0.9760414132105415,4,37.40650844644496,152.37032446211768,1329.6965118233845],
  ["12AU7|6L6GC|43|6.6|8|384000",4.694043372222848,0.1982192922610747,0.0000024437223411918378,48000,65536,0.08681327633553895,-0.08670181335333704,-1.975655829676534,0.975767292658736,4,78.51901101494043,374.82599650001646,1124.407495652698],
  ["12AU7|6L6GC|43|6.6|15|384000",6.428334163290678,0.2720723098004471,0.0000024694638817358484,48000,65536,0.08155359240080341,-0.08151026754205805,-1.975117317945398,0.9751606428041434,4,32.475870344497416,115.23668992839426,1422.005083909619],
  ["12AU7|6L6GC|43|6.6|16|384000",6.6390429122026955,0.2809040566490432,0.0000024707092242120813,48000,65536,0.08272563136857257,-0.08258011560633632,-1.9604088024566488,0.960554318218885,4,107.5978392430035,251.09224765599498,2208.4854732563526],
  ["12AU7|6L6GC|43|8.0|4|352800",3.301572030270999,0.14121433098362587,0.0000024027576855623424,44160,65536,0.09211326374340652,-0.09197288724126595,-1.9704757111999411,0.9706160877020816,3,85.63515483158605,335.4405944212231,1339.1879471487796],
  ["12AU7|6L6GC|43|8.0|8|352800",4.669930023911104,0.20063691772434242,0.000002309432603143448,44160,65536,0.0882557946764189,-0.08815634711774963,-1.962666150122816,0.9627655976814853,3,63.305931456230326,162.33821989548287,1968.2855060140578],
  ["12AU7|6L6GC|43|8.0|15|352800",6.395310597503903,0.2753817625144816,0.000002341365726735973,44160,65536,0.0917537838952632,-0.09160261297400037,-1.9748231214160314,0.9749742923372943,3,92.58720967688012,557.9151947019096,865.156792073975],
  ["12AU7|6L6GC|43|8.0|16|352800",6.604937006076453,0.284322155636699,0.000002312094177384868,44160,65536,0.08976906748134267,-0.08966578410429141,-1.9708346708059117,0.9709379541829628,3,64.64015386252007,232.0757049593355,1423.9360390572833],
  ["12AU7|6L6GC|43|8.0|4|384000",3.3038647709726923,0.14022482497403813,0.000002553162522405141,48000,65536,0.08241942286942379,-0.08214549980233181,-1.9638199479280396,0.9640938709951314,3,203.45721176452622,662.8690849589385,1571.9176572907347],
  ["12AU7|6L6GC|43|8.0|8|384000",4.673174737607726,0.19923606226955368,0.000002467693561468034,48000,65536,0.09745743344591515,-0.09715776717615439,-1.9652099267529968,0.9655095930227575,3,188.21004494923812,966.2519649594138,1178.8556550304309],
  ["12AU7|6L6GC|43|8.0|15|384000",6.39975503275154,0.27346200296059664,0.0000024806093717394316,48000,65536,0.0830772202754711,-0.0830400120456348,-1.9768312119187228,0.976868420148559,3,27.37824978034326,106.19153090073124,1324.113628377324],
  ["12AU7|6L6GC|43|8.0|16|384000",6.6095270365378,0.28233974096798337,0.000002463891116512257,48000,65536,0.08201394980527077,-0.08174892138380728,-1.9628672257007793,0.9631322541222428,3,197.81477967781396,592.0048581442297,1703.7707824237996],
  ["12AU7|KT88|0|6.0|4|352800",9.570199431525205,0.504793719792162,0.000002199046784865707,44160,65536,0.09015632010705488,-0.08955831058542074,-1.9017174873162057,0.9023154968378397,8,373.6844025236388,367.1087950651964,5404.594411668835],
  ["12AU7|KT88|0|6.0|8|352800",13.536605159991929,0.7166052932879668,0.000002196383443384751,44160,65536,0.09195625998258412,-0.09177701537785322,-1.9139823194266645,0.9141615640313953,8,109.55623947521546,120.1148649159005,4919.220722053928],
  ["12AU7|KT88|0|6.0|15|352800",18.53790317655653,0.9831538954033368,0.000002201849178631317,44160,65536,0.08906483643504495,-0.08683842163839979,-1.9043371193090524,0.9065635341056976,8,1421.458199188611,2291.7745554814614,3216.1994035204953],
  ["12AU7|KT88|0|6.0|16|352800",19.145543833972674,1.0151303023993,0.0000022014769612101656,44160,65536,0.09410955852546213,-0.0940686018024598,-1.9052289389845676,0.9052698957075699,8,24.441884813955944,24.382967913607835,5563.77234900815],
  ["12AU7|KT88|0|6.0|4|384000",9.589063064578648,0.49366712093526793,0.0000019123131930160926,48000,65536,0.08159736753867503,-0.08155388545893091,-1.9712656347818027,0.9713091168615469,8,32.57626255557068,98.02397272713152,1681.0794921537058],
  ["12AU7|KT88|0|6.0|8|384000",13.563294290670814,0.7008667255555249,0.0000019115168533789976,48000,65536,0.08198366699937674,-0.08194974275312472,-1.9642535958199752,0.9642875200662272,8,25.294383148489846,59.65673191925815,2162.855509507689],
  ["12AU7|KT88|0|6.0|15|384000",18.57445751234231,0.9615987309783328,0.0000019123372412513432,48000,65536,0.08198020726341089,-0.08194283457046443,-1.9761458223041304,0.976183194997077,8,27.867354833708728,103.11915883378074,1370.0705590185853],
  ["12AU7|KT88|0|6.0|16|384000",19.183295788879104,0.9928689015529912,0.000001909938596175978,48000,65536,0.08170591434810008,-0.0814186203784628,-1.9571683221436005,0.9574556161132377,8,215.27273322197573,510.97708627045574,2146.074989881871],
  ["12AU7|KT88|0|6.6|4|352800",9.896433020379128,0.5224125867553921,0.000002263810122288105,44160,65536,0.0920962980618,-0.09205395794248707,-1.973257039936021,0.9732993800553338,7,25.8201322265376,94.97503022107028,1424.6399845864594],
  ["12AU7|KT88|0|6.6|8|352800",13.99804739656546,0.7416149466091754,0.0000022531740201899426,44160,65536,0.08816535663358911,-0.08795012664871354,-1.9706330444068874,0.9708482743917629,7,137.2410892455474,795.7236914070515,865.4745226771626],
  ["12AU7|KT88|0|6.6|15|352800",19.169831944861624,1.0174647576037505,0.000002260064331395473,44160,65536,0.09131373323804633,-0.09115531042597286,-1.971099052553686,0.9712574753657595,7,97.50061047838075,414.31866341347495,1223.2180385724744],
  ["12AU7|KT88|0|6.6|16|352800",19.798186157155435,1.0505572568633024,0.000002250740368503344,44160,65536,0.0890433810492299,-0.08900013625787466,-1.9609074632490877,0.9609507080404429,7,27.276356190259893,64.01513810170796,2172.5554327874156],
  ["12AU7|KT88|0|6.6|4|384000",9.91571847835291,0.5110501865902025,0.000001954987972167046,48000,65536,0.08368917565851137,-0.0830237673810374,-1.9297347323633702,0.9304001406408442,8,487.8682309985643,693.3709912960014,3715.5332294482287],
  ["12AU7|KT88|0|6.6|8|384000",14.025333458251323,0.7255428064031563,0.000001939508218351269,48000,65536,0.09130460558415344,-0.09125665709807186,-1.9258597558259685,0.9259077043120502,8,32.10314868128662,39.88897489910367,4664.826116753535],
  ["12AU7|KT88|0|6.6|15|384000",19.20720393213249,0.9954525649964255,0.0000019477684540476815,48000,65536,0.08449187368551402,-0.08340609740526533,-1.926121831898445,0.9272076081786936,8,790.4643859060265,1249.9284755897515,3369.04528647756],
  ["12AU7|KT88|0|6.6|16|384000",19.83678251092188,1.0278239434822434,0.0000019480846186800382,48000,65536,0.08243543023986734,-0.08238902924894552,-1.9229436940342999,0.9229900950252218,8,34.410181091145006,37.105357072473836,4860.493617113823],
  ["12AU7|KT88|0|8.0|4|352800",10.544925019750258,0.555874983945606,0.0000020654332238386715,44160,65536,0.0895517108159352,-0.0895178600079784,-1.9397133059978495,0.9397471568058063,6,21.228824912545534,31.83625876689721,3457.5645813166625],
  ["12AU7|KT88|0|8.0|8|352800",14.915309594105182,0.7891219390876385,0.000002068363975950438,44160,65536,0.09250051444547706,-0.09237376624892008,-1.974369523926506,0.9744962721230631,6,76.9917273237902,377.0728036495865,1073.5356548316836],
  ["12AU7|KT88|0|8.0|15|352800",20.425990233137547,1.0826450690186236,0.0000020644946395970295,44160,65536,0.09185700112755713,-0.09166513969087274,-1.951990637486762,0.9521824989234464,6,117.40270071599555,247.57611187609174,2503.686477575357],
  ["12AU7|KT88|0|8.0|16|352800",21.095519188120566,1.1178571670403268,0.0000020685874953020706,44160,65536,0.09586118631828812,-0.09579699407182592,-1.969518698345941,0.9695828905924033,6,37.61265009606946,127.93618950840886,1606.4943447919713],
  ["12AU7|KT88|0|8.0|4|384000",10.564946783772498,0.5441264124373514,0.000001808315426127109,48000,65536,0.08229517044443337,-0.08197201204293834,-1.9640040117246658,0.9643271701261606,7,240.46205538326856,1055.40969659922,1164.5896186563455],
  ["12AU7|KT88|0|8.0|8|384000",14.943637448528348,0.7725034248907591,0.000001812394591957019,48000,65536,0.0826081040738005,-0.0825391234046153,-1.973695724807755,0.9737647054769402,7,51.05490742203121,180.81424809500047,1443.9767177108445],
  ["12AU7|KT88|0|8.0|15|384000",20.464789210116667,1.0598844453021297,0.000001808080765973387,48000,65536,0.08159402590055029,-0.0814355294922528,-1.9736886788317483,0.9738471752400457,7,118.83231817834407,573.3740535048094,1046.2411576168497],
  ["12AU7|KT88|0|8.0|16|384000",21.13558923191012,1.0943508821063208,0.000001812476243981842,48000,65536,0.08584622509691159,-0.08581705178257008,-1.9748092415772938,0.9748384148916353,7,20.772545976795158,74.4154633088907,1483.0243916424606],
  ["12AU7|KT88|20|6.0|4|352800",5.46338131736141,0.2452135670083436,0.0000019204703732702,44160,65536,0.09551879524402226,-0.09542559299482277,-1.97401311408915,0.9741063163383495,4,54.81485026857625,241.798460900234,1231.2835021011929],
  ["12AU7|KT88|20|6.0|8|352800",7.727712229471214,0.34832570599827856,0.0000019551112896091034,44160,65536,0.09006600187612977,-0.08946833129367911,-1.9507774570321708,0.9513751276146214,4,373.847667507464,1236.174870561012,1562.7183145835907],
  ["12AU7|KT88|20|6.0|15|352800",10.5828372500286,0.478040227211824,0.0000019549385776991226,44160,65536,0.09085891653240342,-0.09075042113372621,-1.9765142228962929,0.97662271829497,4,67.08908996653034,356.03332165019907,972.1841283356736],
  ["12AU7|KT88|20|6.0|16|352800",10.92972338189523,0.49356705001678414,0.000001959078846773678,44160,65536,0.09068008813845212,-0.09057475786048422,-1.9705587873752446,0.9706641176532124,4,65.25929177783235,234.49908220028377,1437.3510091353623],
  ["12AU7|KT88|20|6.0|4|384000",5.470591539053236,0.24111172874974995,0.0000019101573699641088,48000,65536,0.08166858361748855,-0.08163817188560193,-1.9743361817420073,0.9743665934738939,4,22.762416160087607,76.16340636826061,1510.8634868076492],
  ["12AU7|KT88|20|6.0|8|384000",7.737914297394946,0.3425225766705102,0.0000019162560726785243,48000,65536,0.08187802893495265,-0.08185036946257183,-1.9761206420149315,0.9761483014873124,4,20.649105050444078,74.649398696629,1400.7249217556998],
  ["12AU7|KT88|20|6.0|15|384000",10.59681075129644,0.47009139317477916,0.0000019026936735728313,48000,65536,0.0848463815459564,-0.08471883944881181,-1.9772405211446182,0.977368063241763,4,91.93866791801526,613.0605696418785,785.9935742530299],
  ["12AU7|KT88|20|6.0|16|384000",10.944154615041933,0.48535797615854126,0.000001900461706402105,48000,65536,0.08455257604248682,-0.08448427612253037,-1.9789114555517482,0.9789797554717047,4,49.387856023741335,244.6979369495694,1053.6589844633609],
  ["12AU7|KT88|20|6.6|4|352800",5.456724069388138,0.24425709698718306,0.0000020854128524667177,44160,65536,0.09096966985421033,-0.09090885410404907,-1.9774256253264402,0.9774864410766014,3,37.55029619624806,175.86886641573307,1102.7117251773027],
  ["12AU7|KT88|20|6.6|8|352800",7.718296008617568,0.34697099956324007,0.0000020881931223206846,44160,65536,0.08969331437675256,-0.08958585297323708,-1.9601954876780774,0.9603029490815929,3,67.31338611380204,163.79732924495204,2110.6355807866903],
  ["12AU7|KT88|20|6.6|15|352800",10.569942124098109,0.4761837900636064,0.000002084895294401735,44160,65536,0.08925817266269558,-0.08920489904241187,-1.974723695349975,0.9747769689702586,3,33.52297581654585,130.45992145824368,1303.9772896573322],
  ["12AU7|KT88|20|6.6|16|352800",10.916405615345585,0.4916499277846225,0.000002088139491619485,44160,65536,0.08889277051871304,-0.08871558609445623,-1.9733776066087896,0.9735547910330463,3,112.0317174423837,749.0584937631709,755.8237362901646],
  ["12AU7|KT88|20|6.6|4|384000",5.463701267256273,0.2402092761795796,0.000001940674550640138,48000,65536,0.08130423319167308,-0.0811526754722607,-1.9570265175625559,0.9571780752819682,4,114.03058550427693,237.3715988996741,2437.3987973201256],
  ["12AU7|KT88|20|6.6|8|384000",7.728168445280303,0.34124430131951816,0.000001926753022861062,48000,65536,0.08389119371007253,-0.0834445486364245,-1.9577178665745074,0.9581645116481553,4,326.2542791301023,1271.7334940214002,1340.0857041707147],
  ["12AU7|KT88|20|6.6|15|384000",10.583464201193035,0.46833948865904096,0.0000019372014341862085,48000,65536,0.08149411190255265,-0.08134612036587603,-1.9725750765408407,0.9727230680775174,4,111.08531165405876,452.9967241704105,1237.2045622100657],
  ["12AU7|KT88|20|6.6|16|384000",10.930370600353708,0.4835488013066584,0.0000019305288611093367,48000,65536,0.10070285658227837,-0.10048841770137795,-1.9706183705162161,0.9708328093971166,4,130.2794471359868,831.644749919973,977.4356884765182],
  ["12AU7|KT88|20|8.0|4|352800",5.404571161560623,0.24053868344207402,0.0000021686161886378727,44160,65536,0.10141716951298597,-0.10126540962352892,-1.973026907092635,0.973178666982092,3,84.0851618398419,450.8771706297825,1075.7022408790024],
  ["12AU7|KT88|20|8.0|8|352800",7.64452839854338,0.34169736232126896,0.0000021738202688350247,44160,65536,0.09270059302466686,-0.09264419573549382,-1.9748745704172201,0.9749309677063932,3,34.17091175423694,140.08551725072536,1285.4816390904207],
  ["12AU7|KT88|20|8.0|15|352800",10.468920154761163,0.4689519240397648,0.00000216102405214244,44160,65536,0.09154173468848542,-0.09141588701072545,-1.976586152516615,0.976712000194375,3,77.24555041819175,471.3649748259447,851.7195438108868],
  ["12AU7|KT88|20|8.0|16|352800",10.812072268059794,0.48418239084021863,0.0000021690833275803225,44160,65536,0.09358905772239588,-0.09344492317083117,-1.9757630683761576,0.9759072029277223,3,86.54188955813675,590.8984837032874,778.4718232681536],
  ["12AU7|KT88|20|8.0|4|384000",5.411038891978564,0.236609081722109,0.000002059695056837713,48000,65536,0.08338952401416515,-0.08327394516226357,-1.9784929625166479,0.9786085413685495,3,84.76554912150291,645.7216080685698,675.8137673044482],
  ["12AU7|KT88|20|8.0|8|384000",7.653680167508261,0.3361376575488765,0.0000020565931351577825,48000,65536,0.0823493847692755,-0.0822388044541862,-1.977109559832893,0.9772201401479822,3,82.12219954207504,424.8307836062553,983.4737932601297],
  ["12AU7|KT88|20|8.0|15|384000",10.481455286406385,0.4613363559674112,0.000002056820127280024,48000,65536,0.08682797072234205,-0.08662328374162587,-1.9704771653725146,0.9706818523532309,3,144.2428610426415,683.814296254455,1134.7698715098982],
  ["12AU7|KT88|20|8.0|16|384000",10.825017973212503,0.47631749510921473,0.000002058975531882292,48000,65536,0.08887425288749418,-0.08872847984086848,-1.9717696419165334,0.971915414963159,3,100.32496938224452,417.2009034562518,1323.7657315304336],
  ["12AU7|KT88|43|6.0|4|352800",3.6623258154517337,0.15164040391096711,0.0000021215888015030995,44160,65536,0.09075705153867601,-0.09048018572464764,-1.9566133264452708,0.9568901922592993,2,171.55403724441385,438.24080040869796,2036.094800115983],
  ["12AU7|KT88|43|6.0|8|352800",5.180202008852783,0.21548191890097296,0.000002111967958460024,44160,65536,0.09263694984915676,-0.09259221886048453,-1.9749983767297894,0.9750431077184615,2,27.119259816358415,109.01373467218232,1310.0952369123163],
  ["12AU7|KT88|43|6.0|15|352800",7.094111562501628,0.29577882521653726,0.000002098627990889221,44160,65536,0.09354778545566746,-0.09340265814065261,-1.9662938623610633,0.9664389896760782,2,87.17690602610062,285.265271379214,1631.5286603702598],
  ["12AU7|KT88|43|6.0|16|352800",7.326643314292019,0.3053784333637202,0.000002110610871656002,44160,65536,0.09099664064215614,-0.09094739592823163,-1.9700495395425648,0.9700987842564893,2,30.394885212182814,98.12276647293493,1606.4396094633926],
  ["12AU7|KT88|43|6.0|4|384000",3.6661115515937546,0.14959970536526376,0.0000018400910805682524,48000,65536,0.08325866527368558,-0.08306436080322661,-1.9708469579086432,0.9710412623791022,2,142.79465912429663,633.6082534578532,1162.3511406150783],
  ["12AU7|KT88|43|6.0|8|384000",5.185558914757085,0.21259436714717647,0.0000018906968047495852,48000,65536,0.08113097033980869,-0.08082945054242313,-1.9649879615181904,0.965289481315576,2,227.55626105904423,941.2516942596648,1217.7902981560942],
  ["12AU7|KT88|43|6.0|15|384000",7.101448966795701,0.29182309256068556,0.0000018715322830599787,48000,65536,0.08686796898090851,-0.08670006796514042,-1.9733608537655982,0.9735287547813664,2,118.24017370243517,628.7860562340428,1010.8154603830359],
  ["12AU7|KT88|43|6.0|16|384000",7.3342210329014526,0.301293261794435,0.0000018734748603562502,48000,65536,0.08130439289150801,-0.08097261204457028,-1.9608363375237583,0.9611681183706962,2,249.9057706634972,762.1885318858899,1658.3484799186026],
  ["12AU7|KT88|43|6.6|4|352800",3.603509853217248,0.1490750371754454,0.0000021693310998766698,44160,65536,0.09628156689362077,-0.09621696990661963,-1.9726834500470525,0.9727480470340536,2,37.684568686881484,147.03041601487266,1404.4001388646607],
  ["12AU7|KT88|43|6.6|8|352800",5.097009436827065,0.21183734683945857,0.0000021764627490461283,44160,65536,0.08856133732773447,-0.08848335279984869,-1.9767420484172495,0.9768200329451353,2,49.465712966736916,228.58462555092754,1088.28957847864],
  ["12AU7|KT88|43|6.6|15|352800",6.980182157415694,0.29077673563635464,0.0000021691886876974593,44160,65536,0.0932386926846513,-0.09300375140213919,-1.9653261622506344,0.9655611035331464,2,141.6640348034872,521.0008388161133,1446.8212383575517],
  ["12AU7|KT88|43|6.6|16|352800",7.208979514634561,0.3002139108546618,0.000002164462452682207,44160,65536,0.09321645248557361,-0.09309504480114354,-1.974044842830177,0.9741662505146069,2,73.17880027932675,344.7610728519575,1124.8662443268033],
  ["12AU7|KT88|43|6.6|4|384000",3.607107493538178,0.14706582874527788,0.0000018412010988228406,48000,65536,0.08959911212977115,-0.0894347021866283,-1.9736775465613823,0.9738419565045251,2,112.24693433949017,626.1720954537229,993.770627503221],
  ["12AU7|KT88|43|6.6|8|384000",5.102100235628694,0.208994308202337,0.0000018710913155180362,48000,65536,0.0848365889264249,-0.08479084726577511,-1.9766016536046562,0.9766473952653059,2,32.96075808501625,131.72489779127386,1312.4097332463791],
  ["12AU7|KT88|43|6.6|15|384000",6.987155142591225,0.28688195773285996,0.0000018662691443015123,48000,65536,0.08987299129955667,-0.08982293610648903,-1.964356818607146,0.9644068738002137,2,34.04805197836351,89.57021210027519,2125.377987101181],
  ["12AU7|KT88|43|6.6|16|384000",7.216180896502882,0.29619169234975895,0.000001865888657721659,48000,65536,0.0812821438890869,-0.08121070277488553,-1.9717990454670877,0.9718704865812893,2,53.739714129905245,172.22747997836083,1571.564384306715],
  ["12AU7|KT88|43|8.0|4|352800",3.4663976664250242,0.1432693370395497,0.0000020891589629648297,44160,65536,0.09444124982715664,-0.09433023910319781,-1.9722773164026997,0.9723883271266583,2,66.04003388562214,273.2342821604066,1298.9641986590796],
  ["12AU7|KT88|43|8.0|8|352800",4.903070169576009,0.2035882887985232,0.0000021240539874649217,44160,65536,0.0896515537042831,-0.08955077554588113,-1.9734818403266745,0.9735826184850764,2,63.154095160262145,258.7374895765667,1244.5398125068377],
  ["12AU7|KT88|43|8.0|15|352800",6.714588944663223,0.2794543424374348,0.00000213952381080829,44160,65536,0.09426796982778048,-0.09392986659062777,-1.9566934412182835,0.9570315444554361,2,201.75015338725854,576.7014395706066,1889.3402935085578],
  ["12AU7|KT88|43|8.0|16|352800",6.93468061496647,0.2885239675759455,0.0000021275835413163487,44160,65536,0.09142576296635223,-0.09136590099378566,-1.9752980517323606,0.9753579137049272,2,36.776750767579415,153.14350548275004,1247.839641451867],
  ["12AU7|KT88|43|8.0|4|384000",3.4696250006975626,0.14132058783796153,0.0000021064073143250234,48000,65536,0.08402704072404642,-0.08391490591097349,-1.9776780483896264,0.9777901832026993,2,81.61363038065687,468.4067116229639,904.2576787690774],
  ["12AU7|KT88|43|8.0|8|384000",4.907637062949203,0.20083072194571994,0.0000020857711381374892,48000,65536,0.0830976148293884,-0.08306755012949027,-1.9754338949485646,0.9754639596484628,2,22.115575565169024,78.99712198586737,1439.2380627184455],
  ["12AU7|KT88|43|8.0|15|384000",6.720844403935795,0.2756765699820548,0.0000021116648419878576,48000,65536,0.08513910526020135,-0.08510957641481702,-1.9736511722737053,0.9736807011190897,2,21.20040044621181,71.72443817482102,1558.3390432685583],
  ["12AU7|KT88|43|8.0|16|384000",6.941140979276828,0.2846225964777403,0.000002103856965506037,48000,65536,0.08248452152940954,-0.08243197615141652,-1.9791838546202376,0.9792363999982305,2,38.945006778699316,179.90116736316122,1102.4361148170008]
]);
// __TUBE_POWER_BREAK_LOOP_ROWS_END__

// The SE branch needs only the measured secondary-tap plant at 1 kHz for its approved 0/3/6 dB
// range. The identity compensator is retained unless the stability fixtures prove it insufficient;
// each row is key, complex Gdet(1 kHz), small-signal delta, settle frames, analysis frames,
// measured 3/6 dB reduction, and the worst 3/6 dB stability margins of the identity compensator.
export const SE_BREAK_LOOP_METHOD = Object.freeze({
  settleSeconds: 1,
  captureSamples: 131072,
  smallSignalCaptureSamples: 131072,
  stimulusPeakV: 1e-4,
  smallSignalScale: 0.5,
  maximumRelativeComplexGainDelta: 0.02
});

// __TUBE_SE_BREAK_LOOP_ROWS_START__
export const SE_BREAK_LOOP_ROWS = Object.freeze([
  ["12AX7|300B|2.5|4|352800",24.96157080214843,0.14571310878047358,4.755253088865545e-8,44160,16384,2.9999694020982175,5.999963003039417,0.5425374999576165,180,7.399451175736963,-1.4213925048398743],
  ["12AX7|300B|2.5|8|352800",35.307306293775575,0.21286375400513555,4.938859159814622e-8,44160,16384,2.9999673628785724,5.999960537347856,0.5434034376395652,180,7.417026608718938,-1.4227451503423443],
  ["12AX7|300B|2.5|15|352800",48.352328269649426,0.29616231424235545,4.697655558715182e-8,44160,16384,2.9999663130212135,5.999959267928635,0.5440767907819296,180,7.430590962954129,-1.4236545813368155],
  ["12AX7|300B|2.5|16|352800",49.937204296731046,0.30522020340604794,4.68678281670056e-8,44160,16384,2.999966455957095,5.99995944075741,0.5439924658237036,180,7.428886405021117,-1.4235232073156021],
  ["12AX7|300B|2.5|4|384000",24.98077454727613,0.1378877430241333,7.800306060035165e-8,48000,16384,2.999972642351766,5.999966920942436,0.5448049718745468,180,7.372091394387416,-1.405106450075945],
  ["12AX7|300B|2.5|8|384000",35.334481449912346,0.20178555100974183,7.982244105484776e-8,48000,16384,2.99997071661225,5.999964592464026,0.5457760602816955,180,7.391670643820386,-1.4064589357949633],
  ["12AX7|300B|2.5|15|384000",48.389550707849615,0.28098068280026045,7.831610794980107e-8,48000,16384,2.9999697247268697,5.999963393140947,0.5465073766704593,180,7.406521661902678,-1.4073677478211477],
  ["12AX7|300B|2.5|16|384000",49.97564589296551,0.28954272369257095,8.082177722380821e-8,48000,16384,2.9999698597504403,5.99996355640264,0.546416193937312,180,7.404663883590437,-1.4072364716816785],
  ["12AX7|300B|3.5|4|352800",22.67830171854805,0.19346085336829358,4.9730376905207425e-8,44160,16384,2.999934657989138,5.999920992692902,0.5150931457641054,180,6.800873373001741,-1.0597529998932855],
  ["12AX7|300B|3.5|8|352800",32.07768203889059,0.2797832334181151,4.640191710350277e-8,44160,16384,2.9999316932155518,5.999917407875733,0.5160936055052713,180,6.815517309706047,-1.0610593077583306],
  ["12AX7|300B|3.5|15|352800",43.9294405438464,0.38738117023824564,4.274858837921064e-8,44160,16384,2.999930178106413,5.999915575901157,0.516855631360909,180,6.82717475891332,-1.0619374269697208],
  ["12AX7|300B|3.5|16|352800",45.369346220686744,0.3994885122978869,4.280541535238348e-8,44160,16384,2.9999303839197133,5.999915824757647,0.5167603728699349,180,6.825695435916764,-1.061810574608826],
  ["12AX7|300B|3.5|4|384000",22.694820515460222,0.18627258831570292,8.992237112331587e-8,48000,16384,2.9999395114370726,5.999926861174832,0.5144264824297693,180,6.933048364393048,-1.048275940199608],
  ["12AX7|300B|3.5|8|384000",32.101058311491144,0.26960682316112833,8.390016009575782e-8,48000,16384,2.999936663940546,5.999923418162498,0.5153037374472861,180,6.949432640926987,-1.0495823070136836],
  ["12AX7|300B|3.5|15|384000",43.961460006494285,0.37343537604503096,8.401241176945273e-8,48000,16384,2.9999352090680986,5.99992165902276,0.515993125969171,180,6.962197962716149,-1.0504600158513582],
  ["12AX7|300B|3.5|16|384000",45.402414360904366,0.3850871125948739,8.377936954524813e-8,48000,16384,2.9999354066717245,5.999921897952572,0.5159061457865386,180,6.960587687564975,-1.0503332322550867],
  ["12AX7|300B|5.0|4|352800",20.10432525737882,0.21787673575568406,5.312995197698481e-8,44160,16384,2.999894547343023,5.9998724933868655,0.5019845045518536,180,6.529250307563611,-0.8441263015775093],
  ["12AX7|300B|5.0|8|352800",28.436867825859082,0.3136219368015697,4.642536690500572e-8,44160,16384,2.999890789855582,5.999867950061255,0.5028223924737643,180,6.546515802931587,-0.8453941804747812],
  ["12AX7|300B|5.0|15|352800",38.94344406123979,0.43324262141734166,4.154567213364271e-8,44160,16384,2.99988887630521,5.999865636312042,0.5034804740961482,180,6.559875240861479,-0.8462463468315874],
  ["12AX7|300B|5.0|16|352800",40.219921502317526,0.44692013024687754,3.992756297519867e-8,44160,16384,2.999889136007668,5.999865950328537,0.5033970672658176,180,6.55819229124522,-0.8461232439979613],
  ["12AX7|300B|5.0|4|384000",20.11826360198293,0.21144926946949816,8.925633543860377e-8,48000,16384,2.9999008145061423,5.999880071258062,0.5025719913690855,180,6.462116684937601,-0.8358909640005985],
  ["12AX7|300B|5.0|8|384000",28.4565929835078,0.30452249845547485,8.42938251407614e-8,48000,16384,2.999897177396252,5.999875673487013,0.5035729331953852,180,6.4755482470052685,-0.8371592097557445],
  ["12AX7|300B|5.0|15|384000",38.97046267950157,0.4207726676183021,8.16652508325861e-8,48000,16384,2.9998953259633754,5.9998734348472045,0.5043361127599876,180,6.486356477081071,-0.838011146833144],
  ["12AX7|300B|5.0|16|384000",40.247824947180035,0.43404275894083155,8.128677882766066e-8,48000,16384,2.999895577200454,5.999873738627781,0.5042405915630307,180,6.484978769149537,-0.8378880913796644],
  ["12AX7|2A3|2.5|4|352800",26.442468413637396,0.32521804810610283,5.177746807726522e-8,44160,16384,2.999864184103931,5.999835779978668,0.5132818494015539,180,6.694968027339093,-1.1469568659183431],
  ["12AX7|2A3|2.5|8|352800",37.40194003745833,0.4671685667063374,5.3609479002606854e-8,44160,16384,2.9998599242521524,5.99983062921702,0.5143178722929851,180,6.714836181227727,-1.1482769036579756],
  ["12AX7|2A3|2.5|15|352800",51.22083638707264,0.6447013916063223,5.0570956846927395e-8,44160,16384,2.9998577582169004,5.999828010174474,0.515100138990907,180,6.729888513606631,-1.1491640334661777],
  ["12AX7|2A3|2.5|16|352800",52.899739763804035,0.6651450700633219,4.9288502738683244e-8,44160,16384,2.999858052065329,5.999828365478742,0.5150026275692204,180,6.728008409121305,-1.1490358849889943],
  ["12AX7|2A3|2.5|4|384000",26.46299242066695,0.317282370001668,6.974706204325506e-8,48000,16384,2.999870931161692,5.999843938121017,0.5103707842121252,180,6.678070987156239,-1.1328416853330756],
  ["12AX7|2A3|2.5|8|384000",37.43098360783841,0.455933937620241,7.7788348175254e-8,48000,16384,2.9998667867299473,5.999838926920104,0.5114733575063718,180,6.69394259712929,-1.1341615370090499],
  ["12AX7|2A3|2.5|15|384000",51.26061804501096,0.6293051319861404,7.595334452285995e-8,48000,16384,2.9998646805139026,5.999836380208277,0.5122960554762854,180,6.706454070336249,-1.1350480301786412],
  ["12AX7|2A3|2.5|16|384000",52.940824458782316,0.6492458638859682,7.529991392860404e-8,48000,16384,2.999864966183965,5.999836725623631,0.5121939376354827,180,6.704874117413108,-1.1349199910874144],
  ["12AX7|2A3|3.5|4|352800",24.159336698074945,0.3446804610290876,5.168842523746964e-8,44160,16384,2.999817251444666,5.999779031715455,0.491420987736199,180,6.448037257236966,-0.9120362218060902],
  ["12AX7|2A3|3.5|8|352800",34.17251792851419,0.4940795659967847,5.11550855305623e-8,44160,16384,2.999812315280044,5.999773063182592,0.49236636011826196,180,6.464926467278525,-0.9133189123716414],
  ["12AX7|2A3|3.5|15|352800",46.79823061998141,0.6811298331531543,5.266015306929594e-8,44160,16384,2.999809809313555,5.9997700331082,0.4931061744518584,180,6.478044804863602,-0.9141808027822801],
  ["12AX7|2A3|3.5|16|352800",48.33217223026903,0.7028269564029861,5.007753976911879e-8,44160,16384,2.9998101491241136,5.999770443988126,0.49301302129509655,180,6.476393079053276,-0.914056308814112],
  ["12AX7|2A3|3.5|4|384000",24.17709832868801,0.3372768695970227,7.603499878216019e-8,48000,16384,2.9998252738501128,5.999788731954255,0.49791114960527894,180,6.4388791406034676,-0.9020412927602771],
  ["12AX7|2A3|3.5|8|384000",34.197652947023805,0.4835980529744318,7.852942554969977e-8,48000,16384,2.999820457146259,5.999782907868908,0.49883703028204684,180,6.457847083412299,-0.9033240905389954],
  ["12AX7|2A3|3.5|15|384000",46.83265912451491,0.6667657687950274,7.721600036954219e-8,48000,16384,2.9998180132248606,5.99977995281713,0.49955892278020875,180,6.472318602322891,-0.9041855750625962],
  ["12AX7|2A3|3.5|16|384000",48.36772837217018,0.687993661458879,7.755745467834425e-8,48000,16384,2.999818344534451,5.999780353418003,0.4994680096310194,180,6.470505922803343,-0.9040611525248505],
  ["12AX7|2A3|5.0|4|352800",21.52116831632779,0.34371138818204416,5.340549215692759e-8,44160,16384,2.999771001664979,5.99972310902534,0.48662720741232074,180,6.176770052877984,-0.7793507631704124],
  ["12AX7|2A3|5.0|8|352800",30.44091309429071,0.49199465700934053,4.772518854878968e-8,44160,16384,2.9997654800113,5.99971643253705,0.4876912288379989,180,6.190965693633532,-0.7806034623220102],
  ["12AX7|2A3|5.0|15|352800",41.68790373456522,0.6777830848506652,4.9333356307037734e-8,44160,16384,2.999762679691613,5.999713046539589,0.48849636889751635,180,6.202298866344513,-0.7814451111578707],
  ["12AX7|2A3|5.0|16|352800",43.05434122601372,0.6994391465506248,4.431269965435172e-8,44160,16384,2.999763059304449,5.999713505547244,0.4883961668500807,180,6.200858065189124,-0.7813235460117294],
  ["12AX7|2A3|5.0|4|384000",21.53623033939563,0.3369985463853176,8.250898814100433e-8,48000,16384,2.9997801655680205,5.9997341895228296,0.4813590504894217,180,6.334813109732266,-0.7719805516715705],
  ["12AX7|2A3|5.0|8|384000",30.46222838858587,0.48249103820468336,7.77389341334521e-8,48000,16384,2.9997747667469388,5.999727661560045,0.4823336889327079,180,6.350772524651763,-0.773233655129767],
  ["12AX7|2A3|5.0|15|384000",41.7171005662003,0.6647589867487765,7.975776630907363e-8,48000,16384,2.9997720305283204,5.999724353071668,0.4830917253425302,180,6.363256428895292,-0.7740751224820709],
  ["12AX7|2A3|5.0|16|384000",43.084494261548826,0.6859895976175933,7.933641699769589e-8,48000,16384,2.9997724013569957,5.999724801457783,0.4829963576718791,180,6.361679718887904,-0.7739535923076744],
  ["12AT7|300B|2.5|4|352800",18.462652387762287,0.547671749827588,3.2913059053177285e-7,44160,16384,2.9992103161273724,5.999045148999561,0.5719611128655905,180,8.119032955591845,-0.8465102232973615],
  ["12AT7|300B|2.5|8|352800",26.114684626483303,0.7796621349049719,3.286527266504629e-7,44160,16384,2.999200090433509,5.9990327843022,0.5728695106984587,180,8.137326496678256,-0.8477727053789113],
  ["12AT7|300B|2.5|15|352800",35.763218482090096,1.0711655381325,3.285440806529612e-7,44160,16384,2.999194925719695,5.999026539234842,0.5735590875138474,180,8.15137592419142,-0.848620144855943],
  ["12AT7|300B|2.5|16|352800",36.93546439474449,1.105795294657272,3.2906426734079114e-7,44160,16384,2.999195625069724,5.999027384874827,0.5734730311482293,180,8.149615775302628,-0.8484977554181876],
  ["12AT7|300B|2.5|4|384000",18.48158181432807,0.541097636755992,3.000110994010477e-7,48000,16384,2.9992307275889507,5.999069830098201,0.5742868875447286,180,8.194234554437484,-0.8647449290700939],
  ["12AT7|300B|2.5|8|384000",26.141469094077593,0.7703577699073283,3.048864659088543e-7,48000,16384,2.999220656416166,5.999057652256545,0.5752515892976222,180,8.213733376947667,-0.8660067646519161],
  ["12AT7|300B|2.5|15|384000",35.79990455338098,1.0584168256003161,3.0596924387040236e-7,48000,16384,2.999215573687381,5.999051506329928,0.5759696528398507,180,8.228441448834646,-0.8668533154633863],
  ["12AT7|300B|2.5|16|384000",36.97335226885725,1.0926298670122903,3.0839255661772777e-7,48000,16384,2.999216261621893,5.999052338165671,0.5758807751560581,180,8.22660466500733,-0.8667310723414858],
  ["12AT7|300B|3.5|4|352800",16.772611663952354,0.5428897995005062,3.306518330766677e-7,44160,16384,2.9990598964507087,5.998863264025925,0.5560930086012015,180,7.777350484549666,-0.4902615281098732],
  ["12AT7|300B|3.5|8|352800",23.724177206675698,0.7724407447898252,3.270381152428938e-7,44160,16384,2.9990487421538123,5.998849776382978,0.5571401580791808,180,7.797579486156173,-0.4914829102884425],
  ["12AT7|300B|3.5|15|352800",32.489487215947484,1.0609611358027906,3.2649764007883985e-7,44160,16384,2.999043110700838,5.998842966894361,0.5579123149701355,180,7.8128568573293435,-0.4923025729359819],
  ["12AT7|300B|3.5|16|352800",33.55442803868011,1.095300424657435,3.265278548441774e-7,44160,16384,2.999043873113754,5.9988438887954585,0.5578167995066934,180,7.8109500083470005,-0.4921842015386564],
  ["12AT7|300B|3.5|4|384000",16.789135460006,0.5368764621151743,3.0133976673735655e-7,48000,16384,2.9990824012447885,5.998890476532813,0.5541253449931403,180,7.705512694747686,-0.5108027830778925],
  ["12AT7|300B|3.5|8|384000",23.74755821149002,0.7639298404739534,3.048279053161094e-7,48000,16384,2.999071404999393,5.998877180018321,0.555114654516296,180,7.721895431304499,-0.5120240943273336],
  ["12AT7|300B|3.5|15|384000",32.52151188543289,1.0492995451143303,3.0439133860996587e-7,48000,16384,2.9990658575830684,5.998870472153203,0.5558577578903453,180,7.734740842890542,-0.5128432693664523],
  ["12AT7|300B|3.5|16|384000",33.58750168174298,1.083257597057064,3.053954439226284e-7,48000,16384,2.999066608380012,5.9988713800074045,0.5557653614425853,180,7.733120831996098,-0.5127249701423062],
  ["12AT7|300B|5.0|4|352800",14.86798573716885,0.5156823032288986,3.222475096796697e-7,44160,16384,2.9989206300553866,5.998694864239895,0.5461760186622355,180,7.592158622092365,-0.262369425653794],
  ["12AT7|300B|5.0|8|352800",21.030151943979654,0.7334410225080299,3.237164968053418e-7,44160,16384,2.998908680361094,5.998680414714679,0.5470303232557093,180,7.60905348074346,-0.2635585657155164],
  ["12AT7|300B|5.0|15|352800",28.800101049178696,1.007197204554777,3.2346221607174343e-7,44160,16384,2.9989026491342208,5.998673121774764,0.5476973154312066,180,7.6221769851069885,-0.2643564501835184],
  ["12AT7|300B|5.0|16|352800",29.74411203309251,1.0398238130942907,3.228250668724381e-7,44160,16384,2.9989034655833278,5.9986741090224935,0.5476133830938973,180,7.620524075833053,-0.2642412287202704],
  ["12AT7|300B|5.0|4|384000",14.882125251826004,0.5103200741387036,3.0225777596217626e-7,48000,16384,2.9989449497609577,5.998724271510348,0.5507662521318151,180,7.639919703362312,-0.2838036907429884],
  ["12AT7|300B|5.0|8|384000",21.050159519289835,0.7258515214571449,3.0407183106732077e-7,48000,16384,2.998933161062729,5.99871001667772,0.5516820755308962,180,7.658741378313868,-0.28499329252348043],
  ["12AT7|300B|5.0|15|384000",28.827505362304525,0.9967980591804372,2.993939374852317e-7,48000,16384,2.9989272156196813,5.998702827475817,0.5523779295633917,180,7.673030343171438,-0.2857910591859498],
  ["12AT7|300B|5.0|16|384000",29.772413989521734,1.029084715052634,3.0067632651542614e-7,48000,16384,2.9989280201897377,5.9987038003582835,0.5522908666115665,180,7.671239123537024,-0.28567586350235213],
  ["12AT7|2A3|2.5|4|352800",19.555007082008096,0.7065283671252501,3.4355318074340066e-7,44160,16384,2.9988288172725257,5.998583844356017,0.5455132821141776,180,7.496543249329433,-0.5779554260049581],
  ["12AT7|2A3|2.5|8|352800",27.65974249027599,1.0046554491781012,3.4277589239815935e-7,44160,16384,2.9988163711680125,5.998568794506697,0.5465510689014775,180,7.516494259276923,-0.5791889733342945],
  ["12AT7|2A3|2.5|15|352800",37.87910184548656,1.3794910639150968,3.424941069021684e-7,44160,16384,2.9988100903563226,5.998561199735813,0.5473236430624707,180,7.531545878301236,-0.5800165942488097],
  ["12AT7|2A3|2.5|16|352800",39.12070541403067,1.4241985974157814,3.434211759974128e-7,44160,16384,2.9988109405579273,5.998562227801542,0.5472279019589046,180,7.529670249549839,-0.5798970749862826],
  ["12AT7|2A3|2.5|4|384000",19.575187391797687,0.6998645357997979,3.165912538316447e-7,48000,16384,2.9988531539048697,5.998613272224377,0.5458615215091651,180,7.499178833454736,-0.5965116529868411],
  ["12AT7|2A3|2.5|8|384000",27.68829689995723,0.9952238734266254,3.161852722841575e-7,48000,16384,2.998840864355426,5.998598411699173,0.5469583930440932,180,7.520535661328742,-0.597744771912444],
  ["12AT7|2A3|2.5|15|384000",37.918212181691196,1.3665678623246322,3.1613400842276997e-7,48000,16384,2.9988346672843087,5.998590918196426,0.5477592629124273,180,7.536453525227339,-0.5985716661713198],
  ["12AT7|2A3|2.5|16|384000",39.161096928945106,1.4108528980085722,3.146842368721284e-7,48000,16384,2.998835505952648,5.998591932314898,0.5476604794130717,180,7.5344763855984915,-0.598452264668866],
  ["12AT7|2A3|3.5|4|352800",17.865549287489262,0.6808399244375372,3.366795102314516e-7,44160,16384,2.9986971407999734,5.998424620499307,0.5311872417876805,180,7.209883622731126,-0.33659305682075524],
  ["12AT7|2A3|3.5|8|352800",25.27006528234042,0.9678626088967678,3.387675072197725e-7,44160,16384,2.9986840154505634,5.998408749205052,0.5322218487084596,180,7.227034140496183,-0.33779467969177845],
  ["12AT7|2A3|3.5|15|352800",34.60651140388586,1.3287895206804772,3.3968820538926034e-7,44160,16384,2.998677393150655,5.998400741454766,0.5330006735463237,180,7.2403765617922655,-0.33860073660710704],
  ["12AT7|2A3|3.5|16|352800",35.74084672675176,1.371879115699067,3.401120886658615e-7,44160,16384,2.998678289569418,5.998401825413314,0.532903827849766,180,7.2386989608504795,-0.3384843364643141],
  ["12AT7|2A3|3.5|4|384000",17.88327236419758,0.6746492331081864,3.1812034130460434e-7,48000,16384,2.9987232365320065,5.998456175670732,0.5327753599211703,180,7.311210347516419,-0.3570129597323313],
  ["12AT7|2A3|3.5|8|384000",25.29514322372869,0.959100586785246,3.123048580505585e-7,48000,16384,2.998710271377413,5.998440498105303,0.5337346419613143,180,7.329510636162302,-0.3582147194992159],
  ["12AT7|2A3|3.5|15|384000",34.64086034160814,1.3167836490681,3.130701569976131e-7,48000,16384,2.9987037350572496,5.998432594332587,0.5344713716992171,180,7.343510505230145,-0.3590204304713798],
  ["12AT7|2A3|3.5|16|384000",35.77632082138826,1.3594808086235683,3.130296769953574e-7,48000,16384,2.9987046195119316,5.998433663822691,0.534379251860796,180,7.341756582563002,-0.35890408806354807],
  ["12AT7|2A3|5.0|4|352800",15.913872092247182,0.633733551232628,3.3265964019066106e-7,44160,16384,2.998577460215828,5.998279901255388,0.5331979182751286,180,7.2342382324876064,-0.18597820627638628],
  ["12AT7|2A3|5.0|8|352800",22.509492875120834,0.9007038402488595,3.3563307624761514e-7,44160,16384,2.998563746624378,5.998263318557559,0.5342085517714467,180,7.253796523985843,-0.18715544240342458],
  ["12AT7|2A3|5.0|15|352800",30.825994540526107,1.236453798333292,3.3373575504671273e-7,44160,16384,2.9985568287060644,5.998254953294059,0.5349675303385343,180,7.268641279928561,-0.18794503938911664],
  ["12AT7|2A3|5.0|16|352800",31.83641245002362,1.276567661209295,3.354716789046007e-7,44160,16384,2.998557765052614,5.998256085540261,0.5348732891893064,180,7.266785530095612,-0.1878310172901328],
  ["12AT7|2A3|5.0|4|384000",15.929113048502415,0.6281383074173672,3.115361246677402e-7,48000,16384,2.998605113817318,5.998313340406765,0.5306238114262067,180,7.106741585252082,-0.20703334449079158],
  ["12AT7|2A3|5.0|8|384000",22.531058955372206,0.8927844336955015,3.081748752589931e-7,48000,16384,2.998591563823279,5.998296955555478,0.5317053985992545,180,7.1276136147477995,-0.2082111949519086],
  ["12AT7|2A3|5.0|15|384000",30.855533534566156,1.2256025207981651,3.0902934911751717e-7,48000,16384,2.9985847336085785,5.998288696355755,0.5325072408939749,180,7.14334445718316,-0.20900078556850993],
  ["12AT7|2A3|5.0|16|384000",31.86691901648406,1.2653616572463908,3.083431690467546e-7,48000,16384,2.9985856577994823,5.998289813901643,0.5324078802061599,180,7.141382263624205,-0.20888677257557417],
  ["12AU7|300B|2.5|4|352800",1.4049887845638074,0.04447694685133755,5.267616557106575e-7,44160,16384,2.999100728752367,5.998912637896925,0.5746930666150223,180,8.168157801816095,-0.7758903915046822],
  ["12AU7|300B|2.5|8|352800",1.9872997542793256,0.06329157282214144,5.5818387640324e-7,44160,16384,2.999089818312134,5.998899445148571,0.5755419990108217,180,8.185596396039468,-0.7771233246771254],
  ["12AU7|300B|2.5|15|352800",2.7215424052977917,0.08693783170487755,5.375762018332918e-7,44160,16384,2.999084309415239,5.998892783866569,0.57619469431134,180,8.199072563006164,-0.777950902667526],
  ["12AU7|300B|2.5|16|352800",2.810749134265666,0.0897508565768322,5.452678492177434e-7,44160,16384,2.9990850557799935,5.998893686360619,0.5761129043325551,180,8.197378091688401,-0.7778314304713367],
  ["12AU7|300B|2.5|4|384000",1.4059029714294577,0.04465358993259471,7.016192316609474e-7,48000,16384,2.999094753861235,5.998905413144847,0.5756343216427948,180,8.185378825208694,-0.8028027397990776],
  ["12AU7|300B|2.5|8|384000",1.988593453724175,0.06354087085822943,6.367647382014744e-7,48000,16384,2.9990838311612187,5.998892205568333,0.5765861881653561,180,8.204717308157981,-0.804035931223793],
  ["12AU7|300B|2.5|15|384000",2.723314379103841,0.08727861211878056,6.169529080768593e-7,48000,16384,2.9990783212331835,5.9988855430375665,0.5772968988191141,180,8.219424283762754,-0.8048629840781043],
  ["12AU7|300B|2.5|16|384000",2.8125791195083876,0.09010296950314106,6.193038734999128e-7,48000,16384,2.9990790661791444,5.998886443816293,0.5772086106529875,180,8.217583469777844,-0.804743457378228],
  ["12AU7|300B|3.5|4|352800",1.276366569785494,0.04386079717379244,5.266774304807572e-7,44160,16384,2.9989404571120772,5.998718839023627,0.5511548828444269,180,7.565779847004156,-0.40992163064369597],
  ["12AU7|300B|3.5|8|352800",1.8053679227393193,0.06238518303766834,5.53172880688844e-7,44160,16384,2.9989286186057864,5.998704523960232,0.5520934123199147,180,7.580313602634137,-0.4111164659946337],
  ["12AU7|300B|3.5|15|352800",2.4723920477869883,0.08567259224398403,5.393786883320378e-7,44160,16384,2.998922642335139,5.998697297480156,0.5528067209079681,180,7.592841205379135,-0.41191827422881916],
  ["12AU7|300B|3.5|16|352800",2.553432209342413,0.08844752022283017,5.521521007245126e-7,44160,16384,2.9989234513089253,5.998698275687806,0.5527175948191058,180,7.591251371047154,-0.4118024659639849],
  ["12AU7|300B|3.5|4|384000",1.2771440199472608,0.04401724824639231,5.921470091920036e-7,48000,16384,2.9989341884831493,5.998711259029475,0.5511649150396454,180,7.7338582943530865,-0.4383067911881834],
  ["12AU7|300B|3.5|8|384000",1.8064680930367578,0.06260596108437924,5.950402019061382e-7,48000,16384,2.998922340763829,5.998696932821403,0.5519950141782394,180,7.74996388783026,-0.43950220487621533],
  ["12AU7|300B|3.5|15|384000",2.4738989243321354,0.08597439102322803,6.085472419020263e-7,48000,16384,2.9989163647720574,5.998689706676359,0.5526440731219412,180,7.762543544860037,-0.44030376908657687],
  ["12AU7|300B|3.5|16|384000",2.554988477283033,0.08875927906361118,6.167318835100921e-7,48000,16384,2.998917173948957,5.998690685129909,0.5525623039292245,180,7.760955266642737,-0.4401880849421424],
  ["12AU7|300B|5.0|4|352800",1.1314187369749773,0.041504059664418155,5.449948824597795e-7,44160,16384,2.998792729639505,5.998540207108082,0.5420133060571031,180,7.43831264426573,-0.1671592948824121],
  ["12AU7|300B|5.0|8|352800",1.6003444902697177,0.05901249209689214,5.436819735075285e-7,44160,16384,2.9987800919078285,5.998524925516257,0.5428040103683988,180,7.455043670247034,-0.168324758568689],
  ["12AU7|300B|5.0|15|352800",2.191618699655431,0.08102681040463593,5.519862511158094e-7,44160,16384,2.9987737143224495,5.998517213712931,0.5434270716081869,180,7.467970517181669,-0.16910667711903327],
  ["12AU7|300B|5.0|16|352800",2.2634557217738465,0.08365320072167486,5.548137642134465e-7,44160,16384,2.998774578338667,5.998518258485146,0.5433482599228531,180,7.4663389417196955,-0.16899371641536937],
  ["12AU7|300B|5.0|4|384000",1.1320678162134301,0.041639702334549056,6.056019705541679e-7,48000,16384,2.9987862243428376,5.998532340880484,0.5420644230246303,180,7.256295746072718,-0.19575843777314716],
  ["12AU7|300B|5.0|8|384000",1.601263014819845,0.059203774092648424,6.331744778677222e-7,48000,16384,2.998773584689543,5.998517056960245,0.5430175465664553,180,7.271517215040941,-0.1969248976401897],
  ["12AU7|300B|5.0|15|384000",2.1928768576567297,0.08128823616694554,5.75016133880784e-7,48000,16384,2.9987672101780456,5.998509348871449,0.543738937794129,180,7.2866559184374395,-0.19770713041726798],
  ["12AU7|300B|5.0|16|384000",2.2647551076239933,0.0839232959815005,6.057366024128954e-7,48000,16384,2.998768073019829,5.998510392223862,0.5436492389971185,180,7.284756995903444,-0.19759422174443608],
  ["12AU7|2A3|2.5|4|352800",1.4880977686806873,0.0567314245898305,5.406980242742788e-7,44160,16384,2.998696159875686,5.998423434356905,0.5450832131083249,180,7.456035585445992,-0.5008761133012217],
  ["12AU7|2A3|2.5|8|352800",2.104851484984836,0.08064763068056019,5.604734610259221e-7,44160,16384,2.998683029355149,5.998407556808924,0.5460963182803034,180,7.475781206794361,-0.5020823841573502],
  ["12AU7|2A3|2.5|15|352800",2.8825238711643286,0.11072191803661462,5.46431510375819e-7,44160,16384,2.998676405091363,5.998399546683518,0.5468539382604563,180,7.490748107642067,-0.5028914962002077],
  ["12AU7|2A3|2.5|16|352800",2.9770075113891212,0.11431241269633188,5.392789092943299e-7,44160,16384,2.998677301338901,5.998400630435071,0.5467598212346046,180,7.488878055500817,-0.5027746906484201],
  ["12AU7|2A3|2.5|4|384000",1.4890712869148404,0.056937786541245886,6.411638108623699e-7,48000,16384,2.998688381175957,5.998414028281807,0.5419693893139321,180,7.359475311549904,-0.527428368630066],
  ["12AU7|2A3|2.5|8|384000",2.1062290496414664,0.08093892034300568,6.293067223523635e-7,48000,16384,2.998675240737045,5.998398138734473,0.5430056117266979,180,7.3753201579826975,-0.5286347991602689],
  ["12AU7|2A3|2.5|15|384000",2.884410749520507,0.11112025240086491,6.069362535014638e-7,48000,16384,2.9986686154837168,5.998390127409495,0.5437789260946316,180,7.387823879385882,-0.529443668724826],
  ["12AU7|2A3|2.5|16|384000",2.978956178328939,0.11472387068826756,6.094878568601999e-7,48000,16384,2.9986695121641467,5.998391211684915,0.5436829400326832,180,7.386244025335845,-0.5293268826227613],
  ["12AU7|2A3|3.5|4|352800",1.3595225821377155,0.05452455330475371,5.679917720116121e-7,44160,16384,2.9985571945121885,5.998255395633064,0.5281216193477344,180,7.205551516003526,-0.24733142914219022],
  ["12AU7|2A3|3.5|8|352800",1.9229865593763686,0.07749127390252698,5.602927173318989e-7,44160,16384,2.9985433836330055,5.998238695276985,0.5290156719349656,180,7.222244661682188,-0.24850827575639878],
  ["12AU7|2A3|3.5|15|352800",2.633465419299307,0.10637544878515362,5.390879392913933e-7,44160,16384,2.998536416608419,5.998230270625077,0.52971240299186,180,7.235236256364114,-0.24929758391133536],
  ["12AU7|2A3|3.5|16|352800",2.7197854603817997,0.10982680267991057,5.36162980726687e-7,44160,16384,2.998537359542321,5.998231410837943,0.5296247307319435,180,7.233599315770779,-0.2491835979545522],
  ["12AU7|2A3|3.5|4|384000",1.3603561689877761,0.054704670039757236,5.787005890915344e-7,48000,16384,2.9985494339104357,5.9982460113793845,0.533726313815087,180,7.242962657416148,-0.2750742379933625],
  ["12AU7|2A3|3.5|8|384000",1.9241661548225684,0.077745488439183,5.974423823052955e-7,48000,16384,2.998535616248887,5.9982293028157,0.5346256961413333,180,7.261653687688882,-0.2762518734972396],
  ["12AU7|2A3|3.5|15|384000",2.635081209605457,0.10672297836734147,5.571058429327994e-7,48000,16384,2.998528652224276,5.998220881788267,0.5353170771795124,180,7.275934891646232,-0.2770414275799468],
  ["12AU7|2A3|3.5|16|384000",2.721454134133553,0.1101858047113784,5.882539858905054e-7,48000,16384,2.998529594821674,5.998222021594647,0.5352302009117357,180,7.2741444892079,-0.2769273479942212],
  ["12AU7|2A3|5.0|4|352800",1.2109965474219568,0.0506466289838157,5.341892965232706e-7,44160,16384,2.9984311831520065,5.998103020085878,0.5250683850218775,180,6.666917132054392,-0.08165017538941167],
  ["12AU7|2A3|5.0|8|352800",1.712902264329456,0.07196586548330491,5.333650992110637e-7,44160,16384,2.9984167831706587,5.998085607271228,0.5260895135115762,180,6.668481026120963,-0.0828049887140748],
  ["12AU7|2A3|5.0|15|352800",2.3457617029674824,0.09878086532960736,5.437412257571538e-7,44160,16384,2.998409520574832,5.998076825155618,0.526854968823652,180,6.669529511783306,-0.08357953776321426],
  ["12AU7|2A3|5.0|16|352800",2.422651392794522,0.10198715488180893,5.436209359236123e-7,44160,16384,2.998410503430178,5.998078013649484,0.526759672870368,180,6.669378249866221,-0.08346767810160623],
  ["12AU7|2A3|5.0|4|384000",1.2116963765745152,0.05080039292865966,6.1390310004743e-7,48000,16384,2.9984234742161933,5.998093698250968,0.5209765884142342,180,7.128925356916994,-0.10950247149804763],
  ["12AU7|2A3|5.0|8|384000",1.7138926395481193,0.07218286782345026,6.015749939440954e-7,48000,16384,2.998409069957775,5.998076280257911,0.5218949513092579,180,7.144673967048188,-0.11065864579589368],
  ["12AU7|2A3|5.0|15|384000",2.3471182045406143,0.0990775085876886,5.868919691427455e-7,48000,16384,2.9984018114902735,5.998067503131112,0.5226063781423039,180,7.156988200936203,-0.11143345950901559],
  ["12AU7|2A3|5.0|16|384000",2.4240523349257947,0.10229359055880834,6.01388323215141e-7,48000,16384,2.9984027939647735,5.998068691164891,0.5225169849423854,180,7.155436063378932,-0.11132157065704357]
]);
// __TUBE_SE_BREAK_LOOP_ROWS_END__

// ================================================================================================
// Primary data 5/5: the key space.
// ================================================================================================
export const DRIVER_TUBES = Object.freeze(['12AX7', '12AT7', '12AU7']);
export const POWER_TUBES = Object.freeze(['EL84', 'EL34', '6L6GC', 'KT88']);
export const SCREEN_TAPS = Object.freeze(['0', '20', '43']);
export const PRIMARIES = Object.freeze(['6.0', '6.6', '8.0']);
export const SE_TUBES = Object.freeze(['300B', '2A3']);
export const SE_PRIMARIES = Object.freeze(['2.5', '3.5', '5.0']);
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
  if (Number.isFinite(sheet.presetPlateCathodeV) &&
      Number.isFinite(sheet.presetScreenCathodeV)) {
    return {
      gridCathodeV: -cathodeGroundV,
      plateCathodeV: sheet.presetPlateCathodeV,
      screenCathodeV: sheet.presetScreenCathodeV,
      iaA,
      ig2A
    };
  }
  if (Number.isFinite(sheet.presetPlateGroundV)) {
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
  const lowResidual = residual(low);
  const highResidual = residual(high);
  if (lowResidual * highResidual > 0) {
    throw new Error(`${pt} pentode exponent is not bracketed by the datasheet numbers ` +
      `(${lowResidual}, ${highResidual})`);
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
  const sheet = OUTPUT_TUBE_DATASHEETS[pt];
  let fixedScreenSupplyDropV = sheet.fixedScreenSupplyDropV;
  if (!Number.isFinite(fixedScreenSupplyDropV)) {
    const ltpStandingCurrentA = LTP_STANDING_CURRENT_A[profile.circuitProfileId];
    if (profile.screenTapTurnsRatio !== 0 ||
        !Number.isFinite(sheet.presetPlateCathodeV) ||
        !Number.isFinite(sheet.presetScreenCathodeV) || !(ltpStandingCurrentA > 0)) {
      throw new Error(`${pt} fixed-screen supply drop cannot be derived from its preset`);
    }
    const iaA = sheet.presetPlateCurrentA;
    const ig2A = sheet.presetScreenCurrentA;
    const cathodeGroundV = (iaA + ig2A) * sheet.presetCathodeResistorOhm;
    const plateGroundV = cathodeGroundV + sheet.presetPlateCathodeV;
    const centerTapGroundV = plateGroundV +
      iaA * (profile.optCoefficients.primaryCenterToTapResistanceOhm +
        profile.optCoefficients.primaryTapToPlateResistanceOhm) +
      ig2A * profile.optCoefficients.primaryCenterToTapResistanceOhm;
    const presetSupplyGroundV = centerTapGroundV +
      (2 * (sheet.presetPlateCurrentA + sheet.presetScreenCurrentA) + ltpStandingCurrentA) *
        profile.powerSupplyRc.theveninResistanceOhm;
    const screenGroundV = cathodeGroundV + sheet.presetScreenCathodeV;
    fixedScreenSupplyDropV = presetSupplyGroundV - screenGroundV -
      2 * sheet.presetScreenCurrentA * profile.screenSupplyRc.seriesResistanceOhm;
  }
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
    fixedScreenSupplyDropV,
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

// Each output tube carries its own axes: their cutoff voltages and plate and screen swings differ,
// so one shared axis set
// would spend most of its knots outside the operating box of whichever valve is selected.
export function buildTubeLuts(circuitProfiles = CIRCUIT_PROFILES) {
  return POWER_TUBES.map(pt => {
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
//            = pb - Vdrop - 2*Ig2*Rs                   pentode connection, own supply branch
//   (Ia,Ig2) = valve table (Vgk = -Vk, Vak, Vg2k)
//
// No constant is adjusted to reach an output power or a gain: the only inputs are the published
// operating row of the valve and the circuit resistances in the profile.
// ================================================================================================

export function solveRunningPowerDc({
  profile, evaluate, supplyV, cathodeResistorOhm, powerTube, fixedScreenSupplyDropV,
  ltpStandingCurrentA = 0
}) {
  const opt = profile.optCoefficients;
  const centerToTap = opt.primaryCenterToTapResistanceOhm;
  const tapToPlate = opt.primaryTapToPlateResistanceOhm;
  const winding = centerToTap + tapToPlate;
  const thevenin = profile.powerSupplyRc.theveninResistanceOhm;
  const screenSeries = profile.screenSupplyRc.seriesResistanceOhm;
  const distributed = profile.screenTapTurnsRatio > 0;
  let iaA = OUTPUT_TUBE_DATASHEETS[powerTube].presetPlateCurrentA;
  let ig2A = OUTPUT_TUBE_DATASHEETS[powerTube].presetScreenCurrentA;
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
        : supplyV - fixedScreenSupplyDropV - 2 * ig2A * screenSeries
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

// Published rows fix either cathode-referenced anode voltage, anode-to-ground voltage, or the HT
// centre-tap supply. Bisect the supply parameter until the running circuit settles on that node.
export function solvePowerSupplyForDatasheetRow({
  profile, evaluate, cathodeResistorOhm, powerTube, fixedScreenSupplyDropV,
  ltpStandingCurrentA = 0
}) {
  const sheet = OUTPUT_TUBE_DATASHEETS[powerTube];
  const targetsPlateCathode = Number.isFinite(sheet.presetPlateCathodeV);
  const targetsPlateGround = Number.isFinite(sheet.presetPlateGroundV);
  const targetV = targetsPlateCathode
    ? sheet.presetPlateCathodeV
    : targetsPlateGround ? sheet.presetPlateGroundV : sheet.presetCenterTapGroundV;
  const observe = targetsPlateCathode
    ? dc => dc.plateCathodeV
    : targetsPlateGround ? dc => dc.plateGroundV : dc => dc.centerTapGroundV;
  let low = 200;
  let high = 700;
  for (let iteration = 0; iteration < 300; ++iteration) {
    const middle = 0.5 * (low + high);
    const dc = solveRunningPowerDc({
      profile, evaluate, supplyV: middle, cathodeResistorOhm, powerTube, fixedScreenSupplyDropV,
      ltpStandingCurrentA
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
  const fixedScreenSupplyDrops = new Map(
    POWER_TUBES.map((powerTube, index) => [powerTube, luts[index].fixedScreenSupplyDropV]));
  const table = new Map();
  for (const profile of circuitProfiles) {
    const powerTube = profile.key.pt;
    const evaluate = evaluators.get(`${powerTube.toLowerCase()}-ia-ig2-lut-v2`);
    if (!evaluate) throw new Error(`Tube Simulator valve table for ${powerTube} is missing`);
    const cathodeResistorOhm = OUTPUT_TUBE_DATASHEETS[powerTube].presetCathodeResistorOhm;
    const ltpStandingCurrentA = LTP_STANDING_CURRENT_A[profile.circuitProfileId];
    const fixedScreenSupplyDropV = fixedScreenSupplyDrops.get(powerTube);
    if (!(ltpStandingCurrentA > 0)) {
      throw new Error(
        `Phase-inverter standing current for ${profile.circuitProfileId} is missing`);
    }
    const supplyGroundV = solvePowerSupplyForDatasheetRow({
      profile, evaluate, cathodeResistorOhm, powerTube, fixedScreenSupplyDropV,
      ltpStandingCurrentA
    });
    table.set(profile.circuitProfileId, {
      supplyGroundV,
      cathodeResistorOhm,
      powerTube,
      ltpStandingCurrentA,
      dc: solveRunningPowerDc({
        profile, evaluate, supplyV: supplyGroundV, cathodeResistorOhm, powerTube,
        fixedScreenSupplyDropV, ltpStandingCurrentA
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
  const keyFields = row[0].split('|');
  const internalRate = Number(keyFields[keyFields.length - 1]);
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
  if (rows.size !== 864) throw new Error('Power break-loop measurement must carry 864 keys');
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

export function buildSeA0Records() {
  const rows = new Map(SE_BREAK_LOOP_ROWS.map(row => [row[0], row]));
  if (rows.size !== 144) throw new Error('SE break-loop measurement must carry 144 keys');
  const records = [];
  for (const tp of DRIVER_TUBES) {
    for (const sd of SE_TUBES) {
      for (const sp of SE_PRIMARIES) {
        for (const family of RATE_FAMILIES) {
          for (const sl of SPEAKER_LOADS) {
            const key = [tp, sd, sp, sl, family.internalRate].join('|');
            const row = rows.get(key);
            if (!row) throw new Error(`SE break-loop measurement is missing ${key}`);
            const [, real, imaginary, observedDelta, settleFrames, analysisFrames,
              reduction3Db, reduction6Db, minimumDistanceToMinusOne,
              minimumPhaseMarginDegrees, minimumGainMarginDb, relative20kTo1kDb] = row;
            records.push({
              a0Key: ['single-ended-v1', tp, sd, sp, sl, family.internalRate],
              internalRateFamily: family.internalRate,
              representativeHostRate: family.hostRate,
              stimulusPeak: SE_BREAK_LOOP_METHOD.stimulusPeakV,
              smallSignalScale: SE_BREAK_LOOP_METHOD.smallSignalScale,
              maximumRelativeComplexGainDelta:
                SE_BREAK_LOOP_METHOD.maximumRelativeComplexGainDelta,
              observedRelativeComplexGainDelta: observedDelta,
              settleFrames,
              analysisFrames,
              gdet0: { real, imaginary },
              a0: Math.hypot(real, imaginary),
              measuredReductionDb: { 3: reduction3Db, 6: reduction6Db },
              stability: {
                minimumDistanceToMinusOne,
                minimumPhaseMarginDegrees,
                minimumGainMarginDb,
                relative20kTo1kDb
              }
            });
          }
        }
      }
    }
  }
  return records;
}

// ================================================================================================
// Stage 5: output-transformer magnetics.
//
// The core the output transformer is wound on is not linear, and the two constants derived here
// are everything a nonlinear core model needs on top of the magnetising inductance the circuit
// design already carries. The model is written in flux-linkage space (lambda, Wb-turns, referred
// to the whole primary) so it plugs straight onto that inductance:
//
//   anhysteretic curve   i_an(lambda) = (lambda / Lm) / (1 - |lambda| / lambda_sat)
//   hysteresis offset    i_h = i_c * min(1, |lambda - lambda0| / (0.5 * lambda_sat)) * s
//
// lambda_sat is where the core runs out of flux and i_c is the coercive current, the offset a
// traversed B-H loop puts on the magnetising current. Both follow in closed form from figures an
// output-transformer datasheet actually publishes, so a family costs no search, no measurement and
// no free parameter beyond the single margin k_sat below.
//
// lambda_sat. An output transformer is rated "P_rated watts down to f_min hertz": at rated power
// and the lowest guaranteed frequency the core still passes the wave without the distortion
// running away, which is the standard way OPT data sheets state their low-frequency capability.
// At that corner the primary voltage is a sine of amplitude sqrt(2 * P_rated * Z_primary), and
// integrating it gives the peak flux linkage the rating implies:
//
//   lambda_rated = sqrt(2) * sqrt(P_rated * Z_primary) / (2 * pi * f_min)
//
// Saturation sits above that working peak by the margin k_sat:
//
//   push-pull      lambda_sat = k_sat * lambda_rated               (differential drive, lambda0 = 0)
//   single-ended   lambda_sat = k_sat * (lambda0 + lambda_rated)   (signal rides the DC bias flux)
//
// The single-ended lambda0 used for the derivation is the conservative approximation
// lambda0 ~ Lm * standing current. The runtime seeds the exact solution of i_an(lambda0) = ia,
// which is linear in lambda0 - clearing the denominator of the Frohlich form gives
// lambda0 = Lm*ia / (1 + Lm*ia/lambda_sat), not a quadratic - and that value is always smaller
// than the approximation, so the derived headroom can only come out on the safe side.
//
// i_c. The coercive current is set by how much of the rated primary emf the hysteresis offset is
// allowed to disturb, theta_h = 1 per cent, the low edge of the hysteresis contribution reported
// for output transformers. The offset current works against the impedance that drives the
// primary: the half primary for push-pull (primaryDriveOhm = Zpp/2 in the kernel) and the whole
// primary for single-ended.
//
//   Vhat_rated = sqrt(2 * P_rated * Z_primary)
//   push-pull      i_c = theta_h * Vhat_rated / (Z_primary / 2) = 2*theta_h*sqrt(2*P_rated/Z)
//   single-ended   i_c = theta_h * Vhat_rated / Z_primary
//
// Remanent flux is a result of these two constants, not a target of the derivation: forcing the
// gapless-GOSS textbook ratio Br/Bs ~ 0.6 would need a coercive current in the tens of
// milliamps, whose amplitude-independent emf disturbance would wreck the small-signal response.
//
// This stage reads nothing but the frozen circuit profiles and the anchors below, so it is a pure
// closed-form computation - it never touches the measured break-loop tables or the A0 anchor
// search, and re-running it can never move a frozen calibration.
// ================================================================================================

// Ratio of the saturation flux linkage to the working peak the transformer rating implies. This is
// the one free parameter of the whole magnetics derivation; it is one-dimensional and monotone
// (raising it lowers the distortion the core adds), and 1.3 is the midpoint of the 1.1-1.5 band the
// low-frequency distortion targets bracket. Phase 4 confirmed the measured M2/M3 of every family
// lands inside the target band at that midpoint, so it was fixed without any search; only if a
// family ever falls outside would it be reset by a monotone bisection over 1.1-1.5, and changing it
// here and regenerating the tables is the whole update.
export const MAGNETICS_SATURATION_MARGIN = 1.3;

// Share of the rated primary emf the hysteresis offset may disturb. A design constant shared by
// every family - it carries no per-family freedom.
export const MAGNETICS_HYSTERESIS_EMF_FRACTION = 0.01;

// Published transformer ratings, one anchor per family.
//
// Push-pull: the rating of the general-purpose push-pull output transformers these families are
// built around (Hammond 1650-series and the equivalent guitar-amplifier and hi-fi irons), quoted
// at the 30 Hz low corner such data sheets use. The primary impedance is not part of the anchor:
// it is the selected Zpp of the profile, so the same valve set wound onto a higher-impedance
// primary correctly derives a proportionally larger saturation flux.
//
// Single-ended: a single-ended output transformer is rated as one part, so its power and its
// primary impedance come from the same published row - the canonical load of the valve it is sold
// for (3.5k for the 300B, 2.5k for the 2A3), at the 40 Hz corner generic single-ended irons quote.
// magnetizingInductanceH and standingCurrentA mirror kSeTubeModels in
// dsp/plugins/saturation/tube_simulator/kernel.cpp and TUBE_SIMULATOR_SE_TUBE_MODELS in
// plugins/saturation/tube_simulator.js; the --magnetics stage reads both files back and fails if
// the transcription ever drifts.
export const OPT_MAGNETIC_ANCHORS = Object.freeze({
  pushPull: Object.freeze({
    EL84: Object.freeze({ ratedPowerW: 15, minimumFrequencyHz: 30 }),
    EL34: Object.freeze({ ratedPowerW: 40, minimumFrequencyHz: 30 }),
    '6L6GC': Object.freeze({ ratedPowerW: 40, minimumFrequencyHz: 30 }),
    KT88: Object.freeze({ ratedPowerW: 60, minimumFrequencyHz: 30 })
  }),
  singleEnded: Object.freeze({
    '300B': Object.freeze({
      ratedPowerW: 8,
      minimumFrequencyHz: 40,
      primaryImpedanceOhm: 3500,
      magnetizingInductanceH: 12,
      standingCurrentA: 0.06
    }),
    '2A3': Object.freeze({
      ratedPowerW: 3.5,
      minimumFrequencyHz: 40,
      primaryImpedanceOhm: 2500,
      magnetizingInductanceH: 10,
      standingCurrentA: 0.06
    })
  })
});

// Peak flux linkage the rating implies: the primary sine of amplitude sqrt(2*P*Z) integrated at
// the low corner.
export function ratedFluxLinkageWbT(ratedPowerW, primaryImpedanceOhm, minimumFrequencyHz) {
  return Math.SQRT2 * Math.sqrt(ratedPowerW * primaryImpedanceOhm) /
    (2 * Math.PI * minimumFrequencyHz);
}

export function ratedPrimaryPeakV(ratedPowerW, primaryImpedanceOhm) {
  return Math.sqrt(2 * ratedPowerW * primaryImpedanceOhm);
}

// The push-pull primary impedance is the plate-to-plate value the profile key names, in kilohms.
export function powerPrimaryImpedanceOhm(profile) {
  return Number(profile.key.zp) * 1000;
}

export function derivePowerMagnetics(profile, {
  saturationMargin = MAGNETICS_SATURATION_MARGIN,
  hysteresisEmfFraction = MAGNETICS_HYSTERESIS_EMF_FRACTION
} = {}) {
  const anchor = OPT_MAGNETIC_ANCHORS.pushPull[profile.key.pt];
  if (!anchor) throw new Error(`no magnetic anchor for power tube ${profile.key.pt}`);
  const primaryImpedanceOhm = powerPrimaryImpedanceOhm(profile);
  const ratedFluxWbT =
    ratedFluxLinkageWbT(anchor.ratedPowerW, primaryImpedanceOhm, anchor.minimumFrequencyHz);
  const ratedPeakV = ratedPrimaryPeakV(anchor.ratedPowerW, primaryImpedanceOhm);
  return {
    ratedPowerW: anchor.ratedPowerW,
    minimumFrequencyHz: anchor.minimumFrequencyHz,
    primaryImpedanceOhm,
    ratedPrimaryPeakV: ratedPeakV,
    ratedFluxLinkageWbT: ratedFluxWbT,
    // The differential drive of a push-pull primary cancels the standing ampere-turns, so the
    // signal flux swings about zero and no bias term enters lambda_sat.
    biasFluxLinkageWbT: 0,
    fluxSaturationWbT: saturationMargin * ratedFluxWbT,
    // The plate pair drives the primary through primaryDriveOhm = Zpp/2 (kernel.cpp,
    // refreshPowerOptCoefficients), so that is the impedance the offset current disturbs.
    coerciveCurrentA: hysteresisEmfFraction * ratedPeakV / (0.5 * primaryImpedanceOhm)
  };
}

export function deriveSeMagnetics(seTube, {
  saturationMargin = MAGNETICS_SATURATION_MARGIN,
  hysteresisEmfFraction = MAGNETICS_HYSTERESIS_EMF_FRACTION
} = {}) {
  const anchor = OPT_MAGNETIC_ANCHORS.singleEnded[seTube];
  if (!anchor) throw new Error(`no magnetic anchor for single-ended tube ${seTube}`);
  const ratedFluxWbT = ratedFluxLinkageWbT(
    anchor.ratedPowerW, anchor.primaryImpedanceOhm, anchor.minimumFrequencyHz);
  const ratedPeakV = ratedPrimaryPeakV(anchor.ratedPowerW, anchor.primaryImpedanceOhm);
  // Conservative bias flux for the derivation only: the whole standing current through the linear
  // magnetising inductance. The runtime seeds the exact, smaller solution of i_an(lambda0) = ia.
  const biasFluxWbT = anchor.magnetizingInductanceH * anchor.standingCurrentA;
  const fluxSaturationWbT = saturationMargin * (biasFluxWbT + ratedFluxWbT);
  return {
    seTube,
    ratedPowerW: anchor.ratedPowerW,
    minimumFrequencyHz: anchor.minimumFrequencyHz,
    primaryImpedanceOhm: anchor.primaryImpedanceOhm,
    magnetizingInductanceH: anchor.magnetizingInductanceH,
    standingCurrentA: anchor.standingCurrentA,
    ratedPrimaryPeakV: ratedPeakV,
    ratedFluxLinkageWbT: ratedFluxWbT,
    biasFluxLinkageWbT: biasFluxWbT,
    // What the runtime will actually seed, reported so the derivation and the kernel can be read
    // against each other: i_an(lambda0) = ia solved exactly.
    runtimeBiasFluxLinkageWbT: biasFluxWbT / (1 + biasFluxWbT / fluxSaturationWbT),
    fluxSaturationWbT,
    // A single-ended primary is driven as a whole winding, so the offset current sees Z_primary.
    coerciveCurrentA: hysteresisEmfFraction * ratedPeakV / anchor.primaryImpedanceOhm
  };
}

// The circuit profiles carrying their magnetic constants. The two values sit behind
// screenTapTurnsRatio so the shipped PowerProfile keeps its transformer parameters together.
export function buildMagneticsProfiles(circuitProfiles = CIRCUIT_PROFILES, options = {}) {
  return Object.freeze(circuitProfiles.map(profile => {
    const magnetics = derivePowerMagnetics(profile, options);
    const { sentinelProfile, ...leading } = profile;
    return Object.freeze({
      ...leading,
      fluxSaturationWbT: magnetics.fluxSaturationWbT,
      coerciveCurrentA: magnetics.coerciveCurrentA,
      sentinelProfile
    });
  }));
}

export function buildSeMagnetics(options = {}) {
  return Object.freeze(SE_TUBES.map(seTube => deriveSeMagnetics(seTube, options)));
}

// The complete derived circuit design: everything scripts/generate-tube-phase-c-tables.mjs needs
// to emit the C++ tables and the JavaScript reference tables.
export function deriveTubeCircuitDesign() {
  const tubeLuts = buildTubeLuts();
  const supplyTable = buildPowerSupplyTable(CIRCUIT_PROFILES, tubeLuts);
  const el34Entry = supplyTable.get(EL34_NORMATIVE_SOURCE.circuitProfileId);
  const addedPowerTubeFixtures = Object.freeze([
    Object.freeze({
      powerTube: '6L6GC',
      circuitProfileId: OUTPUT_TUBE_DATASHEETS['6L6GC'].presetProfileId,
      sourceAnchor: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].sourceAnchor,
      abiProjection: ADDITIONAL_POWER_TUBE_DESIGNS['6L6GC'].abiProjection,
      dc: { ...supplyTable.get(OUTPUT_TUBE_DATASHEETS['6L6GC'].presetProfileId).dc }
    }),
    Object.freeze({
      powerTube: 'KT88',
      circuitProfileId: OUTPUT_TUBE_DATASHEETS.KT88.presetProfileId,
      sourceAnchor: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.sourceAnchor,
      abiProjection: ADDITIONAL_POWER_TUBE_DESIGNS.KT88.abiProjection,
      dc: { ...supplyTable.get(OUTPUT_TUBE_DATASHEETS.KT88.presetProfileId).dc }
    })
  ]);
  return {
    circuitProfiles: buildMagneticsProfiles(),
    seMagnetics: buildSeMagnetics(),
    speakerProfiles: SPEAKER_PROFILES,
    tubeLuts,
    powerSupplyTable: supplyTable,
    additionalPowerTubeDesigns: ADDITIONAL_POWER_TUBE_DESIGNS,
    addedPowerTubeFixtures,
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
    powerA0Records: buildPowerA0Records(),
    seA0Records: buildSeA0Records()
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
  if (design.circuitProfiles.length !== 36) fail('expected 36 circuit profiles');
  if (design.speakerProfiles.length !== 4) fail('expected 4 speaker profiles');
  if (design.tubeLuts.length !== 4) fail('expected 4 output-tube LUTs');
  if (design.powerA0Records.length !== 864) fail('expected 864 Power A0 records');
  if (design.seA0Records.length !== 144) fail('expected 144 SE A0 records');
  if (design.seMagnetics.length !== 2) fail('expected 2 single-ended magnetic records');
  // The magnetic constants are shipped, so the shape a consumer may rely on is checked here: a
  // positive saturation flux that leaves headroom above the rated working peak, and a coercive
  // current small enough that the offset it puts on the magnetising current stays a perturbation.
  for (const profile of design.circuitProfiles) {
    const derived = derivePowerMagnetics(profile);
    if (profile.fluxSaturationWbT !== derived.fluxSaturationWbT ||
        profile.coerciveCurrentA !== derived.coerciveCurrentA) {
      fail(`${profile.circuitProfileId} carries magnetic constants that are not the derived ones`);
    }
    if (!(profile.fluxSaturationWbT > derived.ratedFluxLinkageWbT) ||
        !(profile.coerciveCurrentA > 0) || !(profile.coerciveCurrentA < 0.01)) {
      fail(`${profile.circuitProfileId} magnetic constants are outside the derivation contract`);
    }
  }
  for (const record of design.seMagnetics) {
    if (!(record.fluxSaturationWbT > record.biasFluxLinkageWbT + record.ratedFluxLinkageWbT) ||
        !(record.coerciveCurrentA > 0) || !(record.coerciveCurrentA < 0.01)) {
      fail(`${record.seTube} magnetic constants are outside the derivation contract`);
    }
    // The bias point has to sit well inside the curve: at the seeded flux the incremental
    // inductance is 1/(1-x0)^2 times the linear one, and a bias point near the knee would make
    // that factor - and with it the low-frequency loading of the valve - unreasonable.
    const x0 = record.runtimeBiasFluxLinkageWbT / record.fluxSaturationWbT;
    if (!(x0 > 0) || !(x0 < 0.4)) fail(`${record.seTube} bias flux sits too close to saturation`);
  }
  for (const lut of design.tubeLuts) {
    if (lut.axes.controlVoltageV.length !== 11 || lut.axes.plateCathodeV.length !== 11 ||
        lut.axes.screenCathodeV.length !== 6 || lut.valuesBinary64.length !== 1452) {
      fail(`${lut.id} axes or value count differ from the contract`);
    }
    if (lut.valuesBinary64.some(value => !Number.isFinite(value) || value < 0)) {
      fail(`${lut.id} carries a non-finite or negative current`);
    }
    if (!Number.isFinite(lut.fixedScreenSupplyDropV) || lut.fixedScreenSupplyDropV < 0) {
      fail(`${lut.id} carries an invalid fixed-screen supply drop`);
    }
  }
  const sixL6Design = design.additionalPowerTubeDesigns['6L6GC'];
  const kt88Design = design.additionalPowerTubeDesigns.KT88;
  if (sixL6Design.sourceAnchor.url !== 'https://frank.pocnet.net/sheets/084/6/6L6GC.pdf' ||
      sixL6Design.sourceAnchor.voltageReference !== 'cathode' ||
      sixL6Design.sourceAnchor.plateCathodeV !== 360 ||
      sixL6Design.sourceAnchor.screenCathodeV !== 270 ||
      sixL6Design.sourceAnchor.plateCurrentA !== 0.044 ||
      sixL6Design.sourceAnchor.screenCurrentA !== 0.0025) {
    fail('6L6GC source anchor differs from the frozen Ei-RC AB1 row');
  }
  if (kt88Design.sourceAnchor.url !==
        'https://keith-snook.info/valve-data/KT88%20GEC%20Data.pdf' ||
      kt88Design.sourceAnchor.voltageReference !== 'cathode' ||
      kt88Design.sourceAnchor.plateCathodeV !== 328 ||
      kt88Design.sourceAnchor.screenCathodeV !== 328 ||
      kt88Design.sourceAnchor.cathodeCurrentA !== 0.087 ||
      kt88Design.sourceAnchor.primaryPlateToPlateOhm !== 5000 ||
      kt88Design.sourceAnchor.screenTapPercent !== 40) {
    fail('KT88 source anchor differs from the frozen GEC cathode-bias UL row');
  }
  for (const profile of design.circuitProfiles.filter(row =>
    row.key.pt === '6L6GC' || row.key.pt === 'KT88')) {
    const expectedCenterToTap = 70.5 * Number(profile.key.st) / 100;
    const expectedTapToPlate = 70.5 - expectedCenterToTap;
    const expectedLm = profile.key.zp === '8.0' ? 220 : 328;
    if (Math.abs(profile.optCoefficients.primaryCenterToTapResistanceOhm -
          expectedCenterToTap) > 1e-12 ||
        Math.abs(profile.optCoefficients.primaryTapToPlateResistanceOhm -
          expectedTapToPlate) > 1e-12 ||
        profile.optCoefficients.leakageInductanceH !== 0.0102 ||
        profile.optCoefficients.magnetizingInductanceH !== expectedLm) {
      fail(`${profile.circuitProfileId} differs from the Monolith anchor/ABI projection`);
    }
  }
  const sixL6Fixture = design.addedPowerTubeFixtures.find(row => row.powerTube === '6L6GC');
  if (Math.abs(sixL6Fixture.dc.plateCathodeV - sixL6Fixture.sourceAnchor.plateCathodeV) >
        0.001 ||
      Math.abs(sixL6Fixture.dc.screenCathodeV - sixL6Fixture.sourceAnchor.screenCathodeV) >
        0.1 ||
      Math.abs(sixL6Fixture.dc.iaA - sixL6Fixture.sourceAnchor.plateCurrentA) >
        0.01 * sixL6Fixture.sourceAnchor.plateCurrentA ||
      Math.abs(sixL6Fixture.dc.ig2A - sixL6Fixture.sourceAnchor.screenCurrentA) >
        0.01 * sixL6Fixture.sourceAnchor.screenCurrentA) {
    fail('6L6GC canonical runtime DC does not reproduce the Ei-RC source projection');
  }
  const kt88Fixture = design.addedPowerTubeFixtures.find(row => row.powerTube === 'KT88');
  const sourceIa = kt88Fixture.abiProjection.plateCurrentA;
  const sourceIg2 = kt88Fixture.abiProjection.screenCurrentA;
  if (Math.abs(kt88Fixture.dc.plateCathodeV -
        kt88Fixture.abiProjection.runtimePlateCathodeTargetV) > 0.001 ||
      Math.abs(kt88Fixture.dc.screenCathodeV -
        kt88Fixture.abiProjection.runtimeScreenCathodeExpectation) > 0.2 ||
      Math.abs(kt88Fixture.dc.iaA - sourceIa) > 0.05 * sourceIa ||
      Math.abs(kt88Fixture.dc.ig2A - sourceIg2) > 0.05 * sourceIg2) {
    fail('KT88 canonical runtime DC does not reproduce the GEC/ABI projection');
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
  for (const record of design.seA0Records) {
    if (!Number.isFinite(record.gdet0.real) || !Number.isFinite(record.gdet0.imaginary) ||
        !(record.a0 > 0) || !(record.observedRelativeComplexGainDelta <
          SE_BREAK_LOOP_METHOD.maximumRelativeComplexGainDelta)) {
      fail(`invalid SE feedback record ${record.a0Key.join('/')}`);
    }
    if (Math.abs(record.measuredReductionDb[3] - 3) > 0.1 ||
        Math.abs(record.measuredReductionDb[6] - 6) > 0.1 ||
        !(record.gdet0.real > 0) ||
        !(record.stability.minimumDistanceToMinusOne > 0.35) ||
        !(record.stability.minimumPhaseMarginDegrees >= 45) ||
        !(record.stability.minimumGainMarginDb === null ||
          record.stability.minimumGainMarginDb > 0) ||
        Math.abs(record.stability.relative20kTo1kDb) > 12) {
      fail(`SE feedback target or stability envelope failed for ${record.a0Key.join('/')}`);
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
  if (!Object.hasOwn(target, key)) {
    throw new Error(`reference state property ${key} changed shape after the settle snapshot`);
  }
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
    const checkpoint = session.checkpoint();
    throw new Error(`Power break-loop capture is incomplete: sample ${result?.sample ?? 'none'}, ` +
      `detector ${result?.detectorResponse?.length ?? 'none'}, expected ${captureSamples}, ` +
      `finite faults ${checkpoint.finiteFaults}, safety limits ${checkpoint.safetyLimits}`);
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

// The parameter set one measurement runs at: the Power defaults with the derived supply rail and
// cathode resistor of the key's circuit profile. Actual and Assumed Speaker Load use the same key,
// so every plant is measured at the transformer's design point. The driver stage stays at the
// A0 calibration condition (dr = -40 dB, iv = 0.1 Vpk, nf = 0).
function measurementParams(supplyTable, { tp, pt, st, zp, sl }) {
  const circuitProfileId = `power-v1-${pt.toLowerCase()}-${st}-${zp.replace('.', '_')}`;
  const entry = supplyTable.get(circuitProfileId);
  if (!entry) throw new Error(`no supply-table entry for ${circuitProfileId}`);
  return {
    dr: -40, tp, bi: 0, pv: 250, sz: 10, su: 10, og: 0, mx: 100, iv: 0.1, nf: 0,
    os: 'Power', pt, pb: entry.supplyGroundV, kr: entry.cathodeResistorOhm, st, zp, sl,
    rl: Number(sl)
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

function seMeasurementParams({ tp, sd, sp, sl }) {
  const operatingPoint = sd === '300B'
    ? { sb: 400, sr: 1000 }
    : { sb: 300, sr: 750 };
  return {
    dr: -40, tp, bi: 0, pv: 250, sz: 10, su: 10, og: 0, mx: 100, iv: 0.1, nf: 0,
    os: 'SingleEnded', pt: 'EL84', pb: 350, kr: 390, st: '0', zp: '6.6', sl,
    rl: Number(sl), sd, sb: operatingPoint.sb, sr: operatingPoint.sr, sp
  };
}

function enumerateSeSweepKeys() {
  const keys = [];
  for (const tp of DRIVER_TUBES) {
    for (const sd of SE_TUBES) {
      for (const sp of SE_PRIMARIES) {
        for (const family of RATE_FAMILIES) {
          for (const sl of SPEAKER_LOADS) keys.push({ tp, sd, sp, sl, family });
        }
      }
    }
  }
  return keys;
}

function sweepSeKey({ tp, sd, sp, sl, family }, method) {
  const params = seMeasurementParams({ tp, sd, sp, sl });
  const key = [tp, sd, sp, sl, family.internalRate].join('|');
  const settledSession = createSettledSession({
    params, family, settleSeconds: method.settleSeconds
  });
  const settledCheckpoint = settledSession.session.checkpoint();
  if (settledCheckpoint.finiteFaults > 0 || settledCheckpoint.safetyLimits > 0) {
    throw new Error(`SE settle failed for ${key}: finite ${settledCheckpoint.finiteFaults}, ` +
      `safety ${settledCheckpoint.safetyLimits}, fast ${JSON.stringify(settledCheckpoint.fastState?.[0])}, ` +
      `power ${JSON.stringify(settledCheckpoint.powerState?.[0])}`);
  }
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
    throw new Error(`SE small-signal check failed for ${key}: delta ${observedDelta}`);
  }
  const stabilityRecord = {
    key: `single-ended-v1-${key}`,
    internalRate: family.internalRate,
    detectorResponse: plant.detectorResponse,
    outputResponse: plant.detectorResponse
  };
  const identity = { b0: 1, b1: 0, a1: 0, a2: 0 };
  const feedbackResults = [3, 6].map(feedbackDb => ({
    feedbackDb,
    result: evaluateEndpoint(stabilityRecord, identity, feedbackDb)
  }));
  for (const { feedbackDb, result } of feedbackResults) {
    if (!result.acceptable) {
      throw new Error(`SE ${feedbackDb} dB stability check failed for ${key}: ` +
        JSON.stringify(result));
    }
  }
  const measuredReduction = feedbackDb => {
    const q = 10 ** (feedbackDb / 20) - 1;
    const a0 = Math.hypot(full1k.real, full1k.imaginary);
    const beta = q / a0;
    return 20 * Math.log10(Math.hypot(
      1 + beta * full1k.real, beta * full1k.imaginary));
  };
  const gainMargins = feedbackResults
    .map(({ result }) => result.minimumGainMarginDb)
    .filter(value => value !== null);
  const worstRelative20k = feedbackResults.reduce((worst, { result }) =>
    Math.abs(result.relative20kTo1kDb) > Math.abs(worst)
      ? result.relative20kTo1kDb
      : worst, 0);
  return [key, full1k.real, full1k.imaginary, observedDelta,
    plant.settleFrames, method.captureSamples / family.factor,
    measuredReduction(3), measuredReduction(6),
    Math.min(...feedbackResults.map(({ result }) => result.minimumDistanceToMinusOne)),
    Math.min(...feedbackResults.map(({ result }) => result.minimumPhaseMarginDegrees)),
    gainMargins.length === 0 ? null : Math.min(...gainMargins), worstRelative20k];
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

function runSeSweep(args) {
  const keyStart = Number(readOption(args, 'key-start', '0'));
  const keyCount = Number(readOption(args, 'key-count', '0'));
  const write = args.includes('--write');
  const sharded = keyStart !== 0 || keyCount !== 0;
  if (write && sharded) throw new Error('--write requires a full unsharded SE sweep');
  const recorded = new Map(SE_BREAK_LOOP_ROWS.map(row => [row[0], row]));
  const keys = enumerateSeSweepKeys();
  const selected = keys.slice(keyStart, keyCount > 0 ? keyStart + keyCount : keys.length);
  const rows = [];
  let moved = 0;
  for (const key of selected) {
    const row = sweepSeKey(key, SE_BREAK_LOOP_METHOD);
    rows.push(row);
    const prior = recorded.get(row[0]);
    const drift = prior
      ? Math.hypot(row[1] - prior[1], row[2] - prior[2]) / Math.hypot(prior[1], prior[2])
      : Infinity;
    if (drift !== 0) ++moved;
    process.stdout.write(`${row[0]}  gdet0=(${row[1]},${row[2]})  ` +
      `reduction=${row[6].toFixed(3)}/${row[7].toFixed(3)} dB  ` +
      `distance=${row[8].toFixed(3)}  phase=${row[9].toFixed(1)} deg  ` +
      `delta=${row[3].toExponential(2)}  drift=${drift === 0 ? 'none' : drift.toExponential(2)}\n`);
  }
  if (write) {
    rewriteOwnDataBlock(
      '// __TUBE_SE_BREAK_LOOP_ROWS_START__',
      '// __TUBE_SE_BREAK_LOOP_ROWS_END__',
      'export const SE_BREAK_LOOP_ROWS = Object.freeze([\n' +
      rows.map(row => `  ${JSON.stringify(row)}`).join(',\n') + '\n]);\n');
    process.stdout.write(`rewrote ${rows.length} SE rows in ${path.basename(ownPath)}\n`);
  } else {
    process.stdout.write(`${rows.length} SE keys measured, ${moved} moved from recorded table\n`);
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

// The single-ended magnetic constants are not generated: kSeTubeModels in kernel.cpp and
// TUBE_SIMULATOR_SE_TUBE_MODELS in the plugin are hand-maintained primary data, so the derivation
// reads both back and reports what it finds. A transcription that diverges between the kernel and
// the plugin is caught by parity (golden 1e-5, output-safety 1e-6), because the two implementations
// then disagree. Drift of the derived values against both implementations at once moves neither
// side relative to the other, so parity stays silent and this check is the only defence.
function readJsSeTubeModels() {
  const source = fs.readFileSync(pluginSourcePath, 'utf8');
  const start = source.indexOf('const TUBE_SIMULATOR_SE_TUBE_MODELS = Object.freeze({');
  if (start < 0) return null;
  const end = source.indexOf('\n});', start);
  if (end < 0) return null;
  const block = source.slice(start, end);
  const models = new Map();
  for (const seTube of SE_TUBES) {
    const tubeStart = block.indexOf(`'${seTube}': Object.freeze({`);
    if (tubeStart < 0) return null;
    const tubeEnd = block.indexOf('})', tubeStart);
    const fields = new Map();
    for (const match of block.slice(tubeStart, tubeEnd).matchAll(
      /([A-Za-z][A-Za-z0-9]*)\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g)) {
      fields.set(match[1], Number(match[2]));
    }
    models.set(seTube, fields);
  }
  return models;
}

function readKernelSeTubeModels() {
  const kernelPath = path.join(
    repoRoot, 'dsp', 'plugins', 'saturation', 'tube_simulator', 'kernel.cpp');
  const source = fs.readFileSync(kernelPath, 'utf8');
  const start = source.indexOf('constexpr std::array<SeTubeModel, 2> kSeTubeModels = {{');
  if (start < 0) return null;
  const end = source.indexOf('}};', start);
  if (end < 0) return null;
  const rows = source.slice(source.indexOf('{{', start) + 2, end)
    .split('},')
    .map(row => row.trim())
    .filter(row => row.startsWith('{'))
    .map(row => [...row.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(match => Number(match[0])));
  return rows.length === SE_TUBES.length ? rows : null;
}

function reportSeTranscription(records, out) {
  const jsModels = readJsSeTubeModels();
  const kernelRows = readKernelSeTubeModels();
  const failures = [];
  records.forEach((record, index) => {
    const expected = [
      ['standingCurrentA', record.standingCurrentA],
      ['magnetizingInductanceH', record.magnetizingInductanceH],
      ['fluxSaturationWbT', record.fluxSaturationWbT],
      ['coerciveCurrentA', record.coerciveCurrentA]
    ];
    const jsFields = jsModels?.get(record.seTube);
    for (const [field, value] of expected) {
      const found = jsFields?.get(field);
      if (found === undefined) {
        failures.push(`${record.seTube}: plugin carries no ${field}`);
      } else if (Math.abs(found - value) > 1e-12 * Math.max(1, Math.abs(value))) {
        failures.push(`${record.seTube}: plugin ${field} is ${found}, derived ${value}`);
      }
    }
    // The kernel row is a positional initialiser, so only the two trailing magnetic constants can
    // be checked by name-free position: they are the last two entries of the row by construction.
    const row = kernelRows?.[index];
    if (!row || row.length < 2) {
      failures.push(`${record.seTube}: kernel row could not be read`);
    } else {
      const kernelPairs = [
        ['fluxSaturationWbT', row[row.length - 2], record.fluxSaturationWbT],
        ['coerciveCurrentA', row[row.length - 1], record.coerciveCurrentA]
      ];
      for (const [field, found, value] of kernelPairs) {
        if (Math.abs(found - value) > 1e-12 * Math.max(1, Math.abs(value))) {
          failures.push(`${record.seTube}: kernel ${field} is ${found}, derived ${value}`);
        }
      }
    }
  });
  out(failures.length === 0
    ? 'single-ended transcription: kernel.cpp and tube_simulator.js carry the derived constants\n'
    : `single-ended transcription mismatch:\n${failures.join('\n')}\n`);
  return failures.length === 0;
}

// Stage 5 report. Closed form throughout, so it costs nothing to run and always prints the same
// table for the same margin.
function runMagnetics(args) {
  const marginOption = readOption(args, 'k-sat', null);
  const saturationMargin = marginOption === null ?
    MAGNETICS_SATURATION_MARGIN : Number(marginOption);
  if (!(saturationMargin > 0)) {
    process.stderr.write('--k-sat must be a positive number\n');
    process.exitCode = 2;
    return;
  }
  const exploring = saturationMargin !== MAGNETICS_SATURATION_MARGIN;
  const options = { saturationMargin };
  const out = text => process.stdout.write(text);
  out(`k_sat = ${saturationMargin}, theta_h = ${MAGNETICS_HYSTERESIS_EMF_FRACTION}\n`);
  if (exploring) {
    out('exploration only: the shipped tables carry MAGNETICS_SATURATION_MARGIN, so a value\n' +
      'settled here has to be written into that constant before regenerating them\n');
  }
  out('\npush-pull families\n');
  out('profile                   P_rated  f_min    Zpp    lambda_rated   lambda_sat        i_c\n');
  for (const profile of CIRCUIT_PROFILES) {
    const record = derivePowerMagnetics(profile, options);
    out(`${profile.circuitProfileId.padEnd(24)} ` +
      `${String(record.ratedPowerW).padStart(6)}W ` +
      `${String(record.minimumFrequencyHz).padStart(4)}Hz ` +
      `${String(record.primaryImpedanceOhm).padStart(6)} ` +
      `${record.ratedFluxLinkageWbT.toFixed(6).padStart(13)} ` +
      `${record.fluxSaturationWbT.toFixed(6).padStart(12)} ` +
      `${(record.coerciveCurrentA * 1000).toFixed(6).padStart(10)} mA\n`);
  }
  const seRecords = buildSeMagnetics(options);
  out('\nsingle-ended families\n');
  for (const record of seRecords) {
    out(`${record.seTube.padEnd(6)} ${record.ratedPowerW}W ${record.minimumFrequencyHz}Hz ` +
      `Z=${record.primaryImpedanceOhm} Lm=${record.magnetizingInductanceH}H ` +
      `ia=${record.standingCurrentA}A\n` +
      `       Vhat_rated=${record.ratedPrimaryPeakV.toFixed(6)} V ` +
      `lambda_rated=${record.ratedFluxLinkageWbT.toFixed(6)} Wb-t ` +
      `lambda0(derivation)=${record.biasFluxLinkageWbT.toFixed(6)} Wb-t\n` +
      `       lambda_sat=${record.fluxSaturationWbT.toFixed(6)} Wb-t ` +
      `lambda0(runtime)=${record.runtimeBiasFluxLinkageWbT.toFixed(6)} Wb-t ` +
      `x0=${(record.runtimeBiasFluxLinkageWbT / record.fluxSaturationWbT).toFixed(6)}\n` +
      `       i_c=${(record.coerciveCurrentA * 1000).toFixed(6)} mA\n`);
  }
  out('\n');
  if (!exploring && !reportSeTranscription(seRecords, out)) process.exitCode = 2;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === ownPath;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--se-sweep')) {
    runSeSweep(args);
  } else if (args.includes('--sweep')) {
    runSweep(args);
  } else if (args.includes('--magnetics')) {
    runMagnetics(args);
  } else if (args.includes('--ltp')) {
    runLtpMeasurement(args);
  } else {
    const design = verifyDesignInvariants();
    const dc = design.el34NormativeFixture.dc;
    process.stdout.write(
      `${design.circuitProfiles.length} circuit profiles, ` +
      `${design.speakerProfiles.length} speaker profiles, ` +
      `${design.tubeLuts.length} output-tube LUTs, ` +
      `${design.powerA0Records.length} Power A0 records, ` +
      `${design.seA0Records.length} SE A0 records\n` +
      `EL34 normative DC: supply ${dc.supplyGroundV} V, plate ${dc.plateGroundV.toFixed(3)} V, ` +
      `screen ${dc.screenGroundV.toFixed(3)} V, Ia ${(dc.iaA * 1000).toFixed(3)} mA, ` +
      `dissipation ${dc.quiescentPlateDissipationW.toFixed(3)} W\n` +
      'all invariants hold\n');
  }
}
