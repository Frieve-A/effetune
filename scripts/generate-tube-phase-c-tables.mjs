import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyDesignInvariants } from './derive-tube-circuit-design.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(
  repoRoot,
  'dsp',
  'plugins',
  'saturation',
  'tube_simulator',
  'phase_c_tables.generated.h'
);
const pluginPath = path.join(repoRoot, 'plugins', 'saturation', 'tube_simulator.js');

// The design is derived, not read from a fixture: scripts/derive-tube-circuit-design.mjs holds
// the primary data (published tube rows, frozen circuit values, measured break-loop plant) and
// the derivation, so this generator always emits the tables of the current derivation.
const design = verifyDesignInvariants();
const checkOnly = process.argv.includes('--check');
const tubeCodes = new Map([['12AX7', 0], ['12AT7', 1], ['12AU7', 2]]);
const powerTubeCodes = new Map([['EL84', 0], ['EL34', 1], ['6L6GC', 2], ['KT88', 3]]);
const outputTubeLutCodes = new Map(design.tubeLuts.map((lut, index) => [lut.id, index]));
const screenTapCodes = new Map([['0', 0], ['20', 1], ['43', 2]]);
const primaryCodes = new Map([['6.0', 0], ['6.6', 1], ['8.0', 2]]);
const seTubeCodes = new Map([['300B', 0], ['2A3', 1]]);
const sePrimaryCodes = new Map([['2.5', 0], ['3.5', 1], ['5.0', 2]]);
const speakerCodes = new Map([['4', 0], ['8', 1], ['15', 2], ['16', 3]]);

function fail(message) {
  throw new Error(`Tube Simulator Phase C table generation failed: ${message}`);
}

function number(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} is not finite`);
  return Object.is(value, -0) ? '-0.0' : String(value);
}

function uint64Bits(value) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return `0x${view.getBigUint64(0, false).toString(16).padStart(16, '0')}ull`;
}

// The pre-power volume wiper must sit strictly inside the track: at either end one of the two
// pot sections is a short and the divider stops being a divider.
function wiperPosition(value) {
  if (typeof value !== 'number' || !(value > 0) || !(value < 1)) {
    fail('ltp pre-power volume wiper position must lie strictly between 0 and 1');
  }
  return String(value);
}

function code(map, value, label) {
  const result = map.get(value);
  if (result === undefined) fail(`unknown ${label}: ${String(value)}`);
  return result;
}

if (design.circuitProfiles?.length !== 36) fail('expected 36 circuit profiles');
if (design.speakerProfiles?.length !== 4) fail('expected 4 speaker profiles');
if (design.tubeLuts?.length !== 4) fail('expected 4 output-tube LUTs');
if (design.powerA0Records?.length !== 864) fail('expected 864 Power feedback records');
if (design.seA0Records?.length !== 144) fail('expected 144 SE feedback records');

const profileRows = design.circuitProfiles.map((profile, index) => {
  const opt = profile.optCoefficients;
  return `    {${code(powerTubeCodes, profile.key.pt, 'power tube')}u, ` +
    `${code(screenTapCodes, profile.key.st, 'screen tap')}u, ` +
    `${code(primaryCodes, profile.key.zp, 'primary impedance')}u, ${index}u, ` +
    `${number(profile.ltpRc.plateResistanceOhm, 'ltp plate R')}, ` +
    `${number(profile.ltpRc.tailResistanceOhm, 'ltp tail R')}, ` +
    `${number(profile.ltpRc.inputCouplingCapacitanceF, 'ltp input C')}, ` +
    `${number(profile.ltpRc.gridLeakResistanceOhm, 'ltp grid leak R')}, ` +
    `${number(profile.ltpRc.tailSupplyV, 'ltp tail supply')}, ` +
    `${number(profile.ltpRc.preVolumeResistanceOhm, 'ltp pre-power volume R')}, ` +
    `${wiperPosition(profile.ltpRc.preVolumeWiperPosition)}, ` +
    `${number(profile.gridRc.couplingCapacitanceF, 'grid coupling C')}, ` +
    `${number(profile.gridRc.gridLeakResistanceOhm, 'grid leak R')}, ` +
    `${number(profile.gridRc.gridStopperResistanceOhm, 'grid stopper R')}, ` +
    `${number(profile.cathodeRc.capacitanceF, 'cathode C')}, ` +
    `${number(profile.screenSupplyRc.seriesResistanceOhm, 'screen R')}, ` +
    `${number(profile.screenSupplyRc.capacitanceF, 'screen C')}, ` +
    `${number(profile.powerSupplyRc.theveninResistanceOhm, 'power R')}, ` +
    `${number(profile.powerSupplyRc.capacitanceF, 'power C')}, ` +
    `${number(opt.primaryCenterToTapResistanceOhm, 'OPT center-to-tap R')}, ` +
    `${number(opt.primaryTapToPlateResistanceOhm, 'OPT tap-to-plate R')}, ` +
    `${number(opt.magnetizingInductanceH, 'OPT magnetizing L')}, ` +
    `${number(opt.leakageInductanceH, 'OPT leakage L')}, ` +
    `${number(opt.interwindingCapacitanceF, 'OPT interwinding C')}, ` +
    `${number(opt.coreLossResistanceOhm, 'OPT core-loss R')}, ` +
    `${number(opt.resonanceHz, 'OPT resonance')}, ` +
    `${number(opt.dampingRatio, 'OPT damping')}, ` +
    `${number(opt.feedbackDampingCoupling, 'OPT feedback coupling')}, ` +
    `${number(profile.nfbTapTurnsRatio, 'NFB tap turns ratio')}, ` +
    `${number(profile.nfbPolarity, 'NFB polarity')}, ` +
    `${number(profile.screenTapTurnsRatio, 'screen tap ratio')}, ` +
    `${number(profile.fluxSaturationWbT, 'OPT saturation flux linkage')}, ` +
    `${number(profile.coerciveCurrentA, 'OPT coercive current')}, ` +
    `${code(outputTubeLutCodes, profile.outputTubeLutId, 'output-tube LUT')}u, ` +
    `${profile.sentinelProfile === true ? 'true' : 'false'}}`;
});

const speakerRows = design.speakerProfiles.map(profile =>
  `    {${code(speakerCodes, profile.sl, 'speaker load')}u, ${number(Number(profile.sl), 'speaker load')}, ` +
  `${number(profile.voiceResistanceOhm, 'speaker voice R')}, ` +
  `${number(profile.voiceInductanceH, 'speaker voice L')}, ` +
  `${number(profile.resonanceResistanceOhm, 'speaker resonance R')}, ` +
  `${number(profile.resonanceInductanceH, 'speaker resonance L')}, ` +
  `${number(profile.resonanceCapacitanceF, 'speaker resonance C')}}`
);

// Each output tube carries its own axes because their cutoff voltages and operating boxes differ,
// so one shared axis set would spend most knots outside the selected valve's operating box.
const tubeAxes = design.tubeLuts.map(lut => {
  const axes = lut.axes;
  if (axes?.controlVoltageV?.length !== 11 || axes?.plateCathodeV?.length !== 11 ||
      axes?.screenCathodeV?.length !== 6 || lut.valuesBinary64.length !== 1452) {
    fail('output-tube LUT axes or value count differ from the contract');
  }
  const control = lut.controlVoltage;
  if (!(control?.screenAmplificationFactor > 0) || !(control?.plateAmplificationFactor > 0)) {
    fail('output-tube LUT is missing its composite control-voltage constants');
  }
  return axes;
});
// The composite control voltage is Vgk + Vg2k / mu(g1-g2) + Vak / mu(g1-a). The kernel needs the
// two reciprocals, so they are emitted here and both the C++ kernel and the JavaScript reference
// read the identical rounded constant.
const tubeModelRows = design.tubeLuts.map(lut =>
  `    {${number(1 / lut.controlVoltage.screenAmplificationFactor, 'inverse screen mu')}, ` +
  `${number(1 / lut.controlVoltage.plateAmplificationFactor, 'inverse plate mu')}, ` +
  `${number(lut.controlVoltage.datasheet.presetPlateCurrentA, 'standing plate current')}, ` +
  `${number(lut.controlVoltage.datasheet.presetScreenCurrentA, 'standing screen current')}, ` +
  `${number(lut.controlVoltage.datasheet.fixedScreenGroundV, 'fixed screen voltage')}, ` +
  `${number(lut.fixedScreenSupplyDropV, 'fixed screen supply drop')}}`);
const tubeModels = design.tubeLuts.map(lut => ({
  inverseScreenAmplificationFactor: 1 / lut.controlVoltage.screenAmplificationFactor,
  inversePlateAmplificationFactor: 1 / lut.controlVoltage.plateAmplificationFactor,
  standingPlateCurrentA: lut.controlVoltage.datasheet.presetPlateCurrentA,
  standingScreenCurrentA: lut.controlVoltage.datasheet.presetScreenCurrentA,
  fixedScreenGroundV: lut.controlVoltage.datasheet.fixedScreenGroundV,
  fixedScreenSupplyDropV: lut.fixedScreenSupplyDropV
}));

function doubleMatrix(name, values) {
  const width = values[0].length;
  return `inline constexpr std::array<std::array<double, ${width}>, ${values.length}> ${name} = {{\n` +
    values.map(row => `    {{${row.map(value => number(value, name)).join(', ')}}}`).join(',\n') +
    '\n}};\n';
}

function bitMatrix(name, values) {
  const width = values[0].length;
  return `inline constexpr std::array<std::array<std::uint64_t, ${width}>, ${values.length}> ${name} = {{\n` +
    values.map(row =>
      `    {{\n${row.map(value => `        ${uint64Bits(value)}`).join(',\n')}\n    }}`
    ).join(',\n') + '\n}};\n';
}

// The Power ladder is the anchor blended towards the identity filter along
// v = log1p(q)/log1p(q30). The runtime evaluates that rule directly, so the sixty-one knots the
// design fixture records are verified against it here instead of being shipped one by one.
const LOG1P_Q30 = Math.log1p(10 ** (30 / 20) - 1);

function ladderKnot(anchor, nf) {
  const v = Math.log1p(10 ** (nf / 20) - 1) / LOG1P_Q30;
  return {
    b0: 1 + v * (anchor.b0 - 1),
    b1: v * anchor.b1,
    a1: v * anchor.a1,
    a2: v * anchor.a2
  };
}

function responseAtOneKilohertz(coefficients, internalRate) {
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

const a0Rows = design.powerA0Records.map(record => {
  const key = record.a0Key;
  if (!Array.isArray(key) || key.length !== 7 || key[0] !== 'power-v1') {
    fail('invalid Power feedback key');
  }
  const anchor = record.anchor;
  if (!anchor || ![anchor.b0, anchor.b1, anchor.a1, anchor.a2].every(Number.isFinite)) {
    fail(`Power record ${key.join('/')} carries no compensator anchor`);
  }
  const internalRate = key[6];
  if (record.endpoints?.length !== 61) fail('Power ladder must carry 61 knots');
  for (const endpoint of record.endpoints) {
    const knot = ladderKnot(anchor, endpoint.nf);
    for (const field of ['b0', 'b1', 'a1', 'a2']) {
      if (knot[field] !== endpoint[field]) {
        fail(`Power ladder knot ${endpoint.nf} dB of ${key.join('/')} does not match the anchor`);
      }
    }
    const response = responseAtOneKilohertz(knot, internalRate);
    const detectedReal = record.gdet0.real * response.real -
      record.gdet0.imaginary * response.imaginary;
    const detectedImaginary = record.gdet0.real * response.imaginary +
      record.gdet0.imaginary * response.real;
    if (Math.hypot(detectedReal, detectedImaginary) !== endpoint.a0) {
      fail(`Power ladder a0 at ${endpoint.nf} dB of ${key.join('/')} does not match the anchor`);
    }
  }
  return `    {${code(tubeCodes, key[1], 'driver tube')}u, ` +
    `${code(powerTubeCodes, key[2], 'power tube')}u, ` +
    `${code(screenTapCodes, key[3], 'screen tap')}u, ` +
    `${code(primaryCodes, key[4], 'primary impedance')}u, ` +
    `${code(speakerCodes, key[5], 'speaker load')}u, ` +
    `${key[6] === 352800 ? 0 : 1}u, ` +
    `${number(record.gdet0.real, 'Power detector real')}, ` +
    `${number(record.gdet0.imaginary, 'Power detector imaginary')}, ` +
    `${number(anchor.b0, 'Power anchor b0')}, ${number(anchor.b1, 'Power anchor b1')}, ` +
    `${number(anchor.a1, 'Power anchor a1')}, ${number(anchor.a2, 'Power anchor a2')}}`;
});

const seA0Rows = design.seA0Records.map(record => {
  const key = record.a0Key;
  if (!Array.isArray(key) || key.length !== 6 || key[0] !== 'single-ended-v1') {
    fail('invalid SE feedback key');
  }
  return `    {${code(tubeCodes, key[1], 'driver tube')}u, ` +
    `${code(seTubeCodes, key[2], 'SE tube')}u, ` +
    `${code(sePrimaryCodes, key[3], 'SE primary impedance')}u, ` +
    `${code(speakerCodes, key[4], 'speaker load')}u, ` +
    `${key[5] === 352800 ? 0 : 1}u, ` +
    `${number(record.gdet0.real, 'SE detector real')}, ` +
    `${number(record.gdet0.imaginary, 'SE detector imaginary')}, ` +
    `${number(record.a0, 'SE A0')}}`;
});

const dc = design.el34NormativeFixture.dc;
const sourcePoint = design.el34NormativeFixture.sourcePoint;
const addedPowerTubeDcRows = design.addedPowerTubeFixtures.map(fixture => {
  const sourceIaA = fixture.sourceAnchor.plateCurrentA ?? fixture.abiProjection.plateCurrentA;
  const sourceIg2A = fixture.sourceAnchor.screenCurrentA ?? fixture.abiProjection.screenCurrentA;
  const expectedRuntimeScreenCathodeV =
    fixture.abiProjection.runtimeScreenCathodeExpectation ?? fixture.sourceAnchor.screenCathodeV;
  return `  {${code(powerTubeCodes, fixture.powerTube, 'canonical power tube')}u, ` +
    `${number(fixture.dc.supplyGroundV, 'canonical supply')}, ` +
    `${number(fixture.dc.centerTapGroundV, 'canonical center tap')}, ` +
    `${number(fixture.dc.plateGroundV, 'canonical plate')}, ` +
    `${number(fixture.dc.screenGroundV, 'canonical screen')}, ` +
    `${number(fixture.dc.cathodeGroundV, 'canonical cathode')}, ` +
    `${number(fixture.dc.plateCathodeV, 'canonical Vak')}, ` +
    `${number(fixture.dc.screenCathodeV, 'canonical Vg2k')}, ` +
    `${number(fixture.dc.iaA, 'canonical Ia')}, ${number(fixture.dc.ig2A, 'canonical Ig2')}, ` +
    `${number(fixture.sourceAnchor.plateCathodeV, 'source Vak')}, ` +
    `${number(fixture.sourceAnchor.screenCathodeV, 'source Vg2k')}, ` +
    `${number(sourceIaA, 'source Ia')}, ${number(sourceIg2A, 'source Ig2')}, ` +
    `${number(expectedRuntimeScreenCathodeV, 'ABI projected Vg2k')}}`;
});
const output = `// Generated by scripts/generate-tube-phase-c-tables.mjs. Do not edit.\n` +
`#ifndef EFFETUNE_TUBE_SIMULATOR_PHASE_C_TABLES_GENERATED_H\n` +
`#define EFFETUNE_TUBE_SIMULATOR_PHASE_C_TABLES_GENERATED_H\n\n` +
`#include <array>\n#include <cstdint>\n\n` +
`namespace effetune::dsp::tube_simulator_phase_c_generated {\n\n` +
`struct PowerProfile {\n` +
`  std::uint32_t powerTube; std::uint32_t screenTap; std::uint32_t primary; std::uint32_t id;\n` +
`  double ltpPlateResistanceOhm; double ltpTailResistanceOhm; double ltpInputCapacitanceF;\n` +
`  double ltpGridLeakResistanceOhm; double ltpTailSupplyV;\n` +
`  double ltpPreVolumeResistanceOhm; double ltpPreVolumeWiperPosition;\n` +
`  double gridCouplingCapacitanceF; double gridLeakResistanceOhm; double gridStopperResistanceOhm;\n` +
`  double cathodeCapacitanceF; double screenResistanceOhm; double screenCapacitanceF;\n` +
`  double powerTheveninResistanceOhm; double powerCapacitanceF;\n` +
`  double primaryCenterToTapResistanceOhm; double primaryTapToPlateResistanceOhm;\n` +
`  double magnetizingInductanceH; double leakageInductanceH; double interwindingCapacitanceF;\n` +
`  double coreLossResistanceOhm; double resonanceHz; double dampingRatio; double feedbackDampingCoupling;\n` +
`  double nfbTapTurnsRatio; double nfbPolarity; double screenTapTurnsRatio;\n` +
// Magnetic constants of the core, derived in closed form from the transformer rating by stage 5
// of the design derivation. fluxSaturationWbT is where the anhysteretic curve runs out of flux
// and coerciveCurrentA is the offset a traversed B-H loop puts on the magnetising current; both
// are referred to the whole primary, so they sit alongside the magnetising inductance they
// qualify.
`  double fluxSaturationWbT; double coerciveCurrentA;\n` +
`  std::uint32_t outputTubeLut; bool sentinelProfile;\n};\n` +
`inline constexpr std::array<PowerProfile, 36> kPowerProfiles = {{\n${profileRows.join(',\n')}\n}};\n\n` +
`struct SpeakerProfile {\n` +
`  std::uint32_t code; double loadOhm; double voiceResistanceOhm; double voiceInductanceH;\n` +
`  double resonanceResistanceOhm; double resonanceInductanceH; double resonanceCapacitanceF;\n};\n` +
`inline constexpr std::array<SpeakerProfile, 4> kSpeakerProfiles = {{\n${speakerRows.join(',\n')}\n}};\n\n` +
doubleMatrix('kControlVoltageAxes', tubeAxes.map(axes => axes.controlVoltageV)) + '\n' +
doubleMatrix('kPlateCathodeAxes', tubeAxes.map(axes => axes.plateCathodeV)) + '\n' +
doubleMatrix('kScreenCathodeAxes', tubeAxes.map(axes => axes.screenCathodeV)) + '\n' +
`struct OutputTubeModel {\n` +
`  double inverseScreenAmplificationFactor; double inversePlateAmplificationFactor;\n` +
`  double standingPlateCurrentA; double standingScreenCurrentA; double fixedScreenGroundV;\n` +
`  double fixedScreenSupplyDropV;\n};\n` +
`inline constexpr std::array<OutputTubeModel, 4> kOutputTubeModels = {{\n` +
`${tubeModelRows.join(',\n')}\n}};\n\n` +
bitMatrix('kOutputTubeLutBits', design.tubeLuts.map(lut => lut.valuesBinary64)) + '\n' +
`struct PowerFeedbackRecord {\n` +
`  std::uint32_t driverTube; std::uint32_t powerTube; std::uint32_t screenTap;\n` +
`  std::uint32_t primary; std::uint32_t speakerLoad; std::uint32_t family;\n` +
`  double detectorReal; double detectorImaginary;\n` +
// The design's measured acceptance bound is deliberately not carried here. Nothing in the kernel
// reads it - the runtime ladder is a function of the requested feedback alone, and a setting above
// the bound is left to run into the fault detector, which is what an amplifier does - so emitting
// it only put a value into the shipped artifact that no consumer could keep honest. It stays in
// the design fixture, where the canonical feedback derivation checks itself against it.
`  double anchorB0; double anchorB1; double anchorA1; double anchorA2;\n};\n` +
`inline constexpr std::array<PowerFeedbackRecord, 864> kPowerFeedbackRecords = ` +
`{{\n${a0Rows.join(',\n')}\n}};\n\n` +
`struct SeFeedbackRecord {\n` +
`  std::uint32_t driverTube; std::uint32_t seTube; std::uint32_t primary;\n` +
`  std::uint32_t speakerLoad; std::uint32_t family;\n` +
`  double detectorReal; double detectorImaginary; double a0;\n` +
`};\n` +
`inline constexpr std::array<SeFeedbackRecord, 144> kSeFeedbackRecords = ` +
`{{\n${seA0Rows.join(',\n')}\n}};\n\n` +
// The DC oracle is the settled state of the running branch, so it carries the supply parameter
// separately from the centre tap it feeds: the reservoir Thevenin resistance sits between them and
// both valves' cathode current crosses it.
`struct El34NormativeDc {\n` +
`  double supplyGroundV; double centerTapGroundV; double plateGroundV; double screenGroundV;\n` +
`  double cathodeGroundV; double plateCathodeV; double screenCathodeV; double iaA; double ig2A;\n` +
`  double quiescentPlateDissipationW; double maximumQuiescentPlateDissipationW;\n` +
`  double screenGroundToleranceV; double datasheetIaA; double datasheetIg2A;\n};\n` +
`inline constexpr El34NormativeDc kEl34NormativeDc{` +
`${number(dc.supplyGroundV, 'EL34 supply')}, ` +
`${number(dc.centerTapGroundV, 'EL34 center tap')}, ${number(dc.plateGroundV, 'EL34 plate')}, ` +
`${number(dc.screenGroundV, 'EL34 screen')}, ${number(dc.cathodeGroundV, 'EL34 cathode')}, ` +
`${number(dc.plateCathodeV, 'EL34 Vak')}, ${number(dc.screenCathodeV, 'EL34 Vg2k')}, ` +
`${number(dc.iaA, 'EL34 Ia')}, ${number(dc.ig2A, 'EL34 Ig2')}, ` +
`${number(dc.quiescentPlateDissipationW, 'EL34 plate loss')}, ` +
`${number(design.el34NormativeFixture.dcDisposition.maximumQuiescentPlateDissipationW,
  'EL34 plate loss limit')}, ` +
`${number(design.el34NormativeFixture.screenGroundToleranceV, 'EL34 screen tolerance')}, ` +
`${number(sourcePoint.iaA, 'EL34 datasheet Ia')}, ` +
`${number(sourcePoint.ig2A, 'EL34 datasheet Ig2')}};\n` +
`inline constexpr double kEl34NominalScreenCathodeV = ` +
`${number(sourcePoint.screenGroundNominalV - dc.cathodeGroundV, 'EL34 nominal Vg2k')};\n\n` +
`struct AddedPowerTubeCanonicalDc {\n` +
`  std::uint32_t powerTube; double supplyGroundV; double centerTapGroundV;\n` +
`  double plateGroundV; double screenGroundV; double cathodeGroundV;\n` +
`  double plateCathodeV; double screenCathodeV; double iaA; double ig2A;\n` +
`  double sourcePlateCathodeV; double sourceScreenCathodeV;\n` +
`  double sourceIaA; double sourceIg2A; double expectedRuntimeScreenCathodeV;\n` +
`};\n` +
`inline constexpr std::array<AddedPowerTubeCanonicalDc, 2> kAddedPowerTubeCanonicalDc = {{\n` +
`${addedPowerTubeDcRows.join(',\n')}\n}};\n\n` +
`} // namespace effetune::dsp::tube_simulator_phase_c_generated\n\n#endif\n`;

function writeOrCheck(filePath, contents, label) {
  if (checkOnly) {
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== contents) {
      fail(`${label} is stale`);
    }
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function cppTokens(contents) {
  return contents.replace(/\s+/g, '');
}

function formatCpp(contents) {
  const executable = process.env.EFFETUNE_CLANG_FORMAT || 'clang-format';
  const result = spawnSync(
    executable,
    ['--style=file', `--assume-filename=${outputPath}`],
    { cwd: repoRoot, input: contents, encoding: 'utf8' }
  );
  return result.status === 0 ? result.stdout : null;
}

function writeOrCheckCpp(filePath, contents, label) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  const formatted = formatCpp(contents);
  const expected = formatted ??
    (existing !== null && cppTokens(existing) === cppTokens(contents) ? existing : null);
  if (expected === null) {
    fail(`${label} requires clang-format; set EFFETUNE_CLANG_FORMAT or add clang-format to PATH`);
  }
  writeOrCheck(filePath, expected, label);
}

writeOrCheckCpp(outputPath, output, 'C++ Phase C tables');
const referenceTables = {
  profiles: design.circuitProfiles,
  speakers: design.speakerProfiles,
  axes: tubeAxes,
  tubeModels,
  luts: design.tubeLuts.map(lut => lut.valuesBinary64),
  a0: design.powerA0Records.map(record => ({
    key: record.a0Key,
    detector: record.gdet0,
    anchor: {
      b0: record.anchor.b0,
      b1: record.anchor.b1,
      a1: record.anchor.a1,
      a2: record.anchor.a2
    }
  })),
  seA0: design.seA0Records.map(record => ({
    key: record.a0Key,
    detector: record.gdet0,
    a0: record.a0
  })),
  el34Dc: design.el34NormativeFixture.dc
};
const referenceStart = '// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_START__';
const referenceEnd = '// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_END__';
const pluginSource = fs.readFileSync(pluginPath, 'utf8');
const startIndex = pluginSource.indexOf(referenceStart);
const endIndex = pluginSource.indexOf(referenceEnd);
if (startIndex < 0 || endIndex < startIndex) fail('JS reference injection markers are missing');
const generatedReference = `${referenceStart}\n` +
  `const TUBE_SIMULATOR_PHASE_C_REFERENCE_TABLES = Object.freeze(${JSON.stringify(referenceTables)});\n`;
writeOrCheck(
  pluginPath,
  pluginSource.slice(0, startIndex) + generatedReference + pluginSource.slice(endIndex),
  'JS Phase C reference tables'
);
console.log(path.relative(repoRoot, outputPath).replaceAll('\\', '/'));
console.log(path.relative(repoRoot, pluginPath).replaceAll('\\', '/'));
