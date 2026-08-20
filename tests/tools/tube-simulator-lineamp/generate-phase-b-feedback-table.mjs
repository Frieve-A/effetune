// Restored 2026-08-16 from git dangling blob 19b3374cf2f1421c9b5414dd6126b0613b7a90e1
// (git fsck --lost-found; see tmp/dev/tube-magnetics-phase5-step0-report-20260816.md).
// The original was isolated out of the tree on 2026-08-06 and the archived copy was
// lost; only this comment header differs from the recovered bytes. Verified on
// 2026-08-16 to reproduce all four current generated outputs byte-identically from
// the frozen phase-b-break-loop-v2.json input.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  deriveAnchor,
  evaluateEndpoint,
  loadBreakLoopArtifact,
  responseFromCoefficients
} from './derive-phase-b-anchors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const fixtureRoot = path.join(
  repoRoot,
  'tests',
  'fixtures',
  'tube-simulator',
  'lineamp-v1'
);
const generatedRoot = path.join(fixtureRoot, 'generated');
const artifactPath = path.join(
  fixtureRoot,
  'phase-b-feedback-table-v1.json'
);
const artifactHashPath = artifactPath.replace(/\.json$/u, '.sha256');
const javascriptPath = path.join(
  generatedRoot,
  'tube-feedback-table.generated.mjs'
);
const cppPath = path.join(
  generatedRoot,
  'tube_feedback_table.generated.h'
);
const pluginPath = path.join(
  repoRoot,
  'plugins',
  'saturation',
  'tube_simulator.js'
);
const pluginBlockStart =
  '// BEGIN GENERATED TUBE FEEDBACK CALIBRATION';
const pluginBlockEnd =
  '// END GENERATED TUBE FEEDBACK CALIBRATION';

const TUBES = Object.freeze(['12AX7', '12AT7', '12AU7']);
const INTERNAL_RATES = Object.freeze([352800, 384000]);
const KNOTS_DB = Object.freeze(
  Array.from({ length: 61 }, (_, index) => index * 0.5)
);
const DENSE_DB = Object.freeze(
  Array.from({ length: 601 }, (_, index) => index * 0.05)
);
const RECORD_FIELDS = Object.freeze([
  'b0',
  'b1',
  'a1',
  'a2',
  'a0',
  'beta',
  'makeup'
]);
const FIXED_FREQUENCIES = Object.freeze([
  5, 10, 20, 50, 100, 200, 500, 1000, 2000, 4000, 8000,
  12000, 16000, 24000, 32000, 48000, 64000, 96000, 128000
]);
const TOP_CANDIDATE_COUNT = 128;
const RANDOM_CANDIDATE_COUNT = 1024;
const OUTPUT_NORMALIZATION = 0.001;

const canonicalText = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => crypto
  .createHash('sha256')
  .update(value)
  .digest('hex');
const fail = message => {
  throw new Error(message);
};
const complex = (real, imaginary = 0) => ({ real, imaginary });
const add = (left, right) => complex(
  left.real + right.real,
  left.imaginary + right.imaginary
);
const multiply = (left, right) => complex(
  left.real * right.real - left.imaginary * right.imaginary,
  left.real * right.imaginary + left.imaginary * right.real
);
const scale = (value, factor) =>
  complex(value.real * factor, value.imaginary * factor);
const divide = (left, right) => {
  const denominator =
    right.real * right.real + right.imaginary * right.imaginary;
  return complex(
    (left.real * right.real + left.imaginary * right.imaginary) /
      denominator,
    (left.imaginary * right.real - left.real * right.imaginary) /
      denominator
  );
};
const magnitude = value => Math.hypot(value.real, value.imaginary);

function responseAt(response, frequencyHz) {
  const exact = response.find(sample =>
    sample.frequencyHz === frequencyHz);
  if (exact) return complex(exact.real, exact.imaginary);
  let low = 0;
  let high = response.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (response[middle].frequencyHz <= frequencyHz) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const left = response[low];
  const right = response[high];
  const fraction = (frequencyHz - left.frequencyHz) /
    (right.frequencyHz - left.frequencyHz);
  return complex(
    left.real + fraction * (right.real - left.real),
    left.imaginary + fraction * (right.imaginary - left.imaginary)
  );
}

function maximumPoleMagnitude(coefficients) {
  const discriminant =
    coefficients.a1 * coefficients.a1 - 4 * coefficients.a2;
  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    const first = (-coefficients.a1 + root) / 2;
    const second = (-coefficients.a1 - root) / 2;
    const firstAbs = first >= 0 ? first : -first;
    const secondAbs = second >= 0 ? second : -second;
    return firstAbs > secondAbs ? firstAbs : secondAbs;
  }
  return Math.sqrt(coefficients.a2 >= 0
    ? coefficients.a2
    : -coefficients.a2);
}

function juryStable(coefficients) {
  return 1 + coefficients.a1 + coefficients.a2 > 0 &&
    1 - coefficients.a1 + coefficients.a2 > 0 &&
    1 - coefficients.a2 > 0;
}

function dcUnity(coefficients) {
  const numerator = coefficients.b0 + coefficients.b1;
  const denominator = 1 + coefficients.a1 + coefficients.a2;
  return {
    gain: numerator / denominator,
    residual: numerator - denominator
  };
}

function score(result) {
  const responsePenalty =
    Math.max(0, Math.abs(result.relative20kTo1kDb) - 12);
  const distancePenalty =
    Math.max(0, 0.35 - result.minimumDistanceToMinusOne);
  const phasePenalty =
    Math.max(0, 45 - result.minimumPhaseMarginDegrees);
  const gainPenalty = result.minimumGainMarginDb === null
    ? 0
    : Math.max(0, -result.minimumGainMarginDb);
  return (result.acceptable ? 1e12 : 0) +
    1e7 * result.minimumDistanceToMinusOne +
    1e4 * result.minimumPhaseMarginDegrees +
    1e3 * (result.minimumGainMarginDb ?? 100) -
    1e9 * responsePenalty -
    1e9 * distancePenalty -
    1e8 * phasePenalty -
    1e9 * gainPenalty;
}

function reducedRecord(record) {
  return {
    ...record,
    detectorResponse: record.detectorResponse.filter(
      (_, index) =>
        index % 32 === 0 ||
        index === record.detectorResponse.length - 1
    )
  };
}

function seededRandom(key) {
  let state = [...key].reduce(
    (value, character) =>
      Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0,
    2166136261
  );
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function coefficientDistance(left, right) {
  return Math.abs(left.b0 - right.b0) +
    Math.abs(left.b1 - right.b1) +
    Math.abs(left.a1 - right.a1) +
    Math.abs(left.a2 - right.a2);
}

function maximumCoefficientDelta(left, right) {
  return Math.max(
    Math.abs(left.b0 - right.b0),
    Math.abs(left.b1 - right.b1),
    Math.abs(left.a1 - right.a1),
    Math.abs(left.a2 - right.a2)
  );
}

function coefficientKey(coefficients) {
  const bytes = Buffer.allocUnsafe(32);
  bytes.writeDoubleLE(coefficients.b0, 0);
  bytes.writeDoubleLE(coefficients.b1, 8);
  bytes.writeDoubleLE(coefficients.a1, 16);
  bytes.writeDoubleLE(coefficients.a2, 24);
  return bytes.toString('hex');
}

function comparePathObjective(left, right) {
  const primary =
    left.maximumRequiredMakeup - right.maximumRequiredMakeup;
  if (primary !== 0) return primary;
  const secondary =
    left.maximumAdjacentRawCoefficientDelta -
    right.maximumAdjacentRawCoefficientDelta;
  if (secondary !== 0) return secondary;
  if (left.canonicalTieBreak < right.canonicalTieBreak) return -1;
  if (left.canonicalTieBreak > right.canonicalTieBreak) return 1;
  return 0;
}

function segmentPasses(record, left, right, rightFeedbackDb) {
  const leftFeedbackDb = rightFeedbackDb - 0.5;
  for (let step = 1; step <= 10; ++step) {
    const fraction = step / 10;
    const feedbackDb = leftFeedbackDb + 0.5 * fraction;
    const coefficients = interpolateCoefficients(left, right, fraction);
    if (!checkPoint(
      record,
      feedbackDb,
      calibrationAt(record, coefficients, feedbackDb)
    ).passed) {
      return false;
    }
  }
  return true;
}

function maximumSegmentMakeup(
  record,
  left,
  right,
  rightFeedbackDb
) {
  const leftFeedbackDb = rightFeedbackDb - 0.5;
  let maximum = 0;
  for (let step = 1; step <= 10; ++step) {
    const fraction = step / 10;
    const feedbackDb = leftFeedbackDb + 0.5 * fraction;
    const makeup = calibrationAt(
      record,
      interpolateCoefficients(left, right, fraction),
      feedbackDb
    ).makeup;
    if (makeup > maximum) maximum = makeup;
  }
  return maximum;
}

function selectCompensation(
  record,
  feedbackDb,
  previous,
  target = null,
  requireSegment = true,
  forwardTarget = null,
  returnCandidates = false
) {
  const searchRecord = reducedRecord(record);
  const top = [];
  let ordinal = 0;
  const consider = coefficients => {
    const result = evaluateEndpoint(
      searchRecord,
      coefficients,
      feedbackDb
    );
    const candidate = {
      coefficients,
      ordinal: ordinal++,
      score: score(result)
    };
    if (top.length < TOP_CANDIDATE_COUNT ||
        candidate.score > top[top.length - 1].score) {
      top.push(candidate);
      top.sort((left, right) =>
        right.score - left.score || left.ordinal - right.ordinal);
      if (top.length > TOP_CANDIDATE_COUNT) top.pop();
    }
  };
  const frequencies = FIXED_FREQUENCIES.filter(
    frequency => frequency < record.internalRate / 2
  );
  for (const zeroHz of frequencies) {
    for (const pole1Hz of frequencies) {
      for (const pole2Hz of frequencies) {
        if (pole2Hz < pole1Hz) continue;
        consider(deriveAnchor(
          record.internalRate,
          zeroHz,
          pole1Hz,
          pole2Hz
        ));
      }
    }
  }
  consider(previous);
  consider({ b0: 1, b1: 0, a1: 0, a2: 0 });
  if (target) {
    consider(target);
    for (let step = 1; step < 20; ++step) {
      consider(interpolateCoefficients(
        previous,
        target,
        step / 20
      ));
    }
  }
  const random = seededRandom(
    `${record.key}-${feedbackDb}-feedback-table-v1`
  );
  const minimumFrequency = 1;
  const maximumFrequency = record.internalRate * 0.49;
  const logarithmicFrequency = () =>
    minimumFrequency *
    ((maximumFrequency / minimumFrequency) ** random());
  for (let index = 0; index < RANDOM_CANDIDATE_COUNT; ++index) {
    const zeroHz = logarithmicFrequency();
    const first = logarithmicFrequency();
    const second = logarithmicFrequency();
    consider(deriveAnchor(
      record.internalRate,
      zeroHz,
      first < second ? first : second,
      first < second ? second : first
    ));
  }
  const exact = top.map(candidate => ({
    ...candidate,
    result: evaluateEndpoint(
      record,
      candidate.coefficients,
      feedbackDb
    )
  })).sort((left, right) =>
    score(right.result) - score(left.result) ||
    coefficientDistance(left.coefficients, previous) -
      coefficientDistance(right.coefficients, previous) ||
    left.ordinal - right.ordinal);
  const valid = exact.filter(candidate =>
    candidate.result.acceptable &&
    (!requireSegment ||
      segmentPasses(
        record,
        previous,
        candidate.coefficients,
        feedbackDb
      )) &&
    (!forwardTarget ||
      segmentPasses(
        record,
        candidate.coefficients,
        forwardTarget,
        feedbackDb + 0.5
      )));
  if (target) {
    valid.sort((left, right) =>
      coefficientDistance(left.coefficients, target) -
        coefficientDistance(right.coefficients, target) ||
      score(right.result) - score(left.result) ||
      left.ordinal - right.ordinal);
  }
  if (returnCandidates) return valid;
  const selected = valid[0];
  if (!selected) {
    const best = exact[0];
    fail(
      `${record.key}/${feedbackDb} dB has no acceptable deterministic ` +
      `2p1z segment: ` +
      `${JSON.stringify(best.result)}`
    );
  }
  return selected;
}

function interpolateCoefficients(left, right, fraction) {
  return {
    b0: left.b0 + fraction * (right.b0 - left.b0),
    b1: left.b1 + fraction * (right.b1 - left.b1),
    a1: left.a1 + fraction * (right.a1 - left.a1),
    a2: left.a2 + fraction * (right.a2 - left.a2)
  };
}

function calibrationAt(record, coefficients, feedbackDb) {
  if (feedbackDb === 0) {
    return {
      coefficients: { b0: 1, b1: 0, a1: 0, a2: 0 },
      a0: magnitude(responseAt(record.detectorResponse, 1000)),
      beta: 0,
      makeup: 1
    };
  }
  const detector = responseAt(record.detectorResponse, 1000);
  const output = scale(
    responseAt(record.outputResponse, 1000),
    1 / OUTPUT_NORMALIZATION
  );
  const compensation = responseFromCoefficients(
    coefficients,
    1000,
    record.internalRate
  );
  const compensatedDetector = multiply(detector, compensation);
  const a0 = magnitude(compensatedDetector);
  const q = 10 ** (feedbackDb / 20) - 1;
  const beta = q / a0;
  const closedGain = divide(
    multiply(output, compensation),
    add(complex(1), scale(compensatedDetector, beta))
  );
  return {
    coefficients,
    a0,
    beta,
    makeup: magnitude(output) / magnitude(closedGain)
  };
}

function denseCalibration(record, knots, feedbackDb) {
  const coefficientsAt = knot => ({
    b0: knot.b0,
    b1: knot.b1,
    a1: knot.a1,
    a2: knot.a2
  });
  if (feedbackDb >= 30) {
    return calibrationAt(record, coefficientsAt(knots[60]), 30);
  }
  const position = feedbackDb * 2;
  const low = Math.floor(position);
  const fraction = position - low;
  const coefficients = interpolateCoefficients(
    coefficientsAt(knots[low]),
    coefficientsAt(knots[low + 1]),
    fraction
  );
  return calibrationAt(record, coefficients, feedbackDb);
}

function checkPoint(record, feedbackDb, calibration) {
  const coefficients = calibration.coefficients;
  const analysis = evaluateEndpoint(record, coefficients, feedbackDb);
  const dc = dcUnity(coefficients);
  const finite = [
    coefficients.b0,
    coefficients.b1,
    coefficients.a1,
    coefficients.a2,
    calibration.a0,
    calibration.beta,
    calibration.makeup,
    dc.gain,
    dc.residual
  ].every(Number.isFinite);
  const identity = feedbackDb !== 0 ||
    (coefficients.b0 === 1 &&
      coefficients.b1 === 0 &&
      coefficients.a1 === 0 &&
      coefficients.a2 === 0 &&
      calibration.beta === 0 &&
      calibration.makeup === 1);
  const passed = finite &&
    identity &&
    juryStable(coefficients) &&
    maximumPoleMagnitude(coefficients) < 1 &&
    Math.abs(dc.residual) <= 1e-12 &&
    analysis.acceptable;
  return {
    passed,
    dcGain: dc.gain,
    dcResidual: dc.residual,
    maximumPoleMagnitude: maximumPoleMagnitude(coefficients),
    minimumDistanceToMinusOne: analysis.minimumDistanceToMinusOne,
    minimumPhaseMarginDegrees: analysis.minimumPhaseMarginDegrees,
    minimumGainMarginDb: analysis.minimumGainMarginDb,
    relative20kTo1kDb: analysis.relative20kTo1kDb
  };
}

function flattenedValues(groups) {
  const values = [];
  for (const group of groups) {
    values.push(
      group.detectorAt1k.real,
      group.detectorAt1k.imaginary
    );
    for (const knot of group.knots) {
      for (const field of RECORD_FIELDS) values.push(knot[field]);
    }
  }
  return values;
}

function javascriptSource(groups, values, binary64Sha256) {
  const runtimeGroups = groups.map(group => ({
    tube: group.tube,
    internalRate: group.internalRate,
    detectorReal: group.detectorAt1k.real,
    detectorImaginary: group.detectorAt1k.imaginary,
    knots: group.knots.map(knot => [
      knot.b0,
      knot.b1,
      knot.a1,
      knot.a2
    ])
  }));
  return `// Generated by generate-phase-b-feedback-table.mjs. Do not edit.
export const TUBE_FEEDBACK_TABLE_BINARY64_SHA256 =
  '${binary64Sha256}';
export const TUBE_FEEDBACK_TABLE_VALUES = new Float64Array(${
  JSON.stringify(values)});
export const TUBE_FEEDBACK_CALIBRATION = Object.freeze(${
  JSON.stringify(runtimeGroups)});
`;
}

function cppSource(values, binary64Sha256) {
  const words = values.map(value => {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleLE(value);
    return `0x${bytes.readBigUInt64LE().toString(16).padStart(16, '0')}ULL`;
  });
  return `// Generated by generate-phase-b-feedback-table.mjs. Do not edit.
#pragma once

#include <array>
#include <cstdint>

// clang-format off
namespace effetune::tube_feedback_table_fixture {
inline constexpr char kBinary64Sha256[] = "${binary64Sha256}";
inline constexpr std::array<std::uint64_t, ${words.length}> kBinary64Bits = {
  ${words.join(',\n  ')}
};
}  // namespace effetune::tube_feedback_table_fixture
// clang-format on
`;
}

function pluginBlock(groups, binary64Sha256) {
  const runtimeGroups = groups.map(group => ({
    detectorReal: group.detectorAt1k.real,
    detectorImaginary: group.detectorAt1k.imaginary,
    knots: group.knots.map(knot => [
      knot.b0,
      knot.b1,
      knot.a1,
      knot.a2
    ])
  }));
  return `${pluginBlockStart}
const TUBE_SIMULATOR_FEEDBACK_TABLE_BINARY64_SHA256 =
    '${binary64Sha256}';
const TUBE_SIMULATOR_FEEDBACK_CALIBRATION = Object.freeze(${
  JSON.stringify(runtimeGroups)});
${pluginBlockEnd}`;
}

function replacePluginBlock(source, replacement) {
  const start = source.indexOf(pluginBlockStart);
  const end = source.indexOf(pluginBlockEnd);
  if (start < 0 || end < start) {
    fail('Tube Simulator generated feedback calibration markers are missing');
  }
  return source.slice(0, start) +
    replacement +
    source.slice(end + pluginBlockEnd.length);
}

function writeOrCheck(filePath, expected, check) {
  if (check) {
    if (!fs.existsSync(filePath) ||
        fs.readFileSync(filePath, 'utf8') !== expected) {
      fail(`${path.relative(repoRoot, filePath)} is not current`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, expected, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--check')) {
    fail('Usage: node generate-phase-b-feedback-table.mjs [--check]');
  }
  const check = args.includes('--check');
  const breakLoop = loadBreakLoopArtifact();
  const groups = [];
  let endpointPassed = 0;
  let densePassed = 0;
  const failureSamples = [];
  for (const tube of TUBES) {
    for (const internalRate of INTERNAL_RATES) {
      const record = breakLoop.records.find(candidate =>
        candidate.tube === tube &&
        candidate.internalRate === internalRate);
      if (!record) fail(`${tube}/${internalRate} break-loop record is absent`);
      process.stdout.write(
        `Deriving canonical feedback table ${tube}/${internalRate}...\n`
      );
      const identity = { b0: 1, b1: 0, a1: 0, a2: 0 };
      const selectedByKnot = new Array(KNOTS_DB.length);
      selectedByKnot[0] = {
        coefficients: identity,
        result: evaluateEndpoint(record, identity, 0)
      };
      let reachable = [{
        candidate: selectedByKnot[0],
        parent: null,
        objective: {
          maximumRequiredMakeup: 1,
          maximumAdjacentRawCoefficientDelta: 0,
          canonicalTieBreak: coefficientKey(identity)
        }
      }];
      const edgeSearchRecord = reducedRecord(record);
      for (let index = 1; index < KNOTS_DB.length; ++index) {
        const feedbackDb = KNOTS_DB[index];
        const candidates = selectCompensation(
          record,
          feedbackDb,
          identity,
          null,
          false,
          null,
          true
        );
        const nextReachable = [];
        for (const candidate of candidates) {
          const parents = reachable.map(parent => ({
            parent,
            objective: {
              maximumRequiredMakeup: Math.max(
                parent.objective.maximumRequiredMakeup,
                maximumSegmentMakeup(
                  record,
                  parent.candidate.coefficients,
                  candidate.coefficients,
                  feedbackDb
                )
              ),
              maximumAdjacentRawCoefficientDelta: Math.max(
                parent.objective.maximumAdjacentRawCoefficientDelta,
                maximumCoefficientDelta(
                  parent.candidate.coefficients,
                  candidate.coefficients
                )
              ),
              canonicalTieBreak:
                `${parent.objective.canonicalTieBreak}/${
                  coefficientKey(candidate.coefficients)}`
            }
          })).sort((left, right) =>
            comparePathObjective(left.objective, right.objective));
          const selectedParent = parents.find(option =>
            segmentPasses(
              edgeSearchRecord,
              option.parent.candidate.coefficients,
              candidate.coefficients,
              feedbackDb
            ) &&
            segmentPasses(
              record,
              option.parent.candidate.coefficients,
              candidate.coefficients,
              feedbackDb
            ));
          if (selectedParent) {
            nextReachable.push({
              candidate,
              parent: selectedParent.parent,
              objective: selectedParent.objective
            });
          }
        }
        if (nextReachable.length === 0) {
          fail(
            `${record.key}/${feedbackDb} dB has no reachable ` +
            `binary64 coefficient-table record`
          );
        }
        reachable = nextReachable;
      }
      let selectedNode = [...reachable].sort((left, right) =>
        comparePathObjective(left.objective, right.objective))[0];
      const pathObjective = {
        maximumRequiredMakeup:
          selectedNode.objective.maximumRequiredMakeup,
        maximumAdjacentRawCoefficientDelta:
          selectedNode.objective.maximumAdjacentRawCoefficientDelta,
        canonicalTieBreakSha256:
          sha256(selectedNode.objective.canonicalTieBreak)
      };
      for (let index = KNOTS_DB.length - 1; index >= 1; --index) {
        selectedByKnot[index] = selectedNode.candidate;
        selectedNode = selectedNode.parent;
      }
      selectedByKnot[0] = selectedNode.candidate;
      const selections = [];
      const knots = KNOTS_DB.map((feedbackDb, index) => {
        const selected = selectedByKnot[index];
        selections.push({
          feedbackDb,
          coefficients: selected.coefficients,
          result: selected.result
        });
        const calibration = calibrationAt(
          record,
          selected.coefficients,
          feedbackDb
        );
        const checked = checkPoint(record, feedbackDb, calibration);
        if (checked.passed) ++endpointPassed;
        else if (failureSamples.length < 12) {
          failureSamples.push({
            key: record.key,
            kind: 'endpoint',
            feedbackDb,
            checked
          });
        }
        return {
          feedbackDb,
          b0: calibration.coefficients.b0,
          b1: calibration.coefficients.b1,
          a1: calibration.coefficients.a1,
          a2: calibration.coefficients.a2,
          a0: calibration.a0,
          beta: calibration.beta,
          makeup: calibration.makeup,
          checks: checked
        };
      });
      for (const feedbackDb of DENSE_DB) {
        const checked = checkPoint(
          record,
          feedbackDb,
          denseCalibration(record, knots, feedbackDb)
        );
        if (checked.passed) ++densePassed;
        else if (failureSamples.length < 12) {
          failureSamples.push({
            key: record.key,
            kind: 'dense',
            feedbackDb,
            checked
          });
        }
      }
      groups.push({
        tube,
        internalRate,
        detectorAt1k: responseAt(record.detectorResponse, 1000),
        pathObjective,
        selections,
        knots
      });
      process.stdout.write(
        `Selected ${record.key}: max makeup ${
          pathObjective.maximumRequiredMakeup}, max adjacent delta ${
          pathObjective.maximumAdjacentRawCoefficientDelta}.\n`
      );
    }
  }
  if (endpointPassed !== 366 || densePassed !== 3606) {
    fail(
      `Feedback table checks failed: endpoints ${endpointPassed}/366, ` +
      `dense ${densePassed}/3606; ${JSON.stringify(failureSamples)}`
    );
  }
  const values = flattenedValues(groups);
  const binaryBytes = Buffer.concat(values.map(value => {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleLE(value);
    return bytes;
  }));
  const binary64Sha256 = sha256(binaryBytes);
  const artifact = {
    contract: 'tube-line-feedback-table-v1',
    generator:
      'tests/tools/tube-simulator-lineamp/generate-phase-b-feedback-table.mjs',
    breakLoopContract: breakLoop.contract,
    breakLoopSha256: sha256(canonicalText(breakLoop)),
    coefficientEncoding: 'IEEE-754 binary64 little-endian',
    binary64Sha256,
    recordFields: RECORD_FIELDS,
    tubeOrder: TUBES,
    internalRateOrder: INTERNAL_RATES,
    knotCountPerGroup: KNOTS_DB.length,
    recordCount: groups.length * KNOTS_DB.length,
    denseCount: groups.length * DENSE_DB.length,
    endpointChecksPassed: endpointPassed,
    denseChecksPassed: densePassed,
    interpolation:
      'linear raw b0/b1/a1/a2 between adjacent 0.5 dB knots; derive H(1k), A0, beta, and makeup from the interpolated coefficients',
    pathSelection:
      'lexicographically minimize family maximum required makeup, then maximum adjacent raw coefficient delta, then stable canonical coefficient-bit path identity; no makeup cap or additional hard predicate',
    groups
  };
  const artifactText = canonicalText(artifact);
  const hashText = `${sha256(artifactText)}  ${
    path.basename(artifactPath)}\n`;
  const jsText = javascriptSource(groups, values, binary64Sha256);
  const cppText = cppSource(values, binary64Sha256);
  const currentPlugin = fs.readFileSync(pluginPath, 'utf8');
  const expectedPlugin = replacePluginBlock(
    currentPlugin,
    pluginBlock(groups, binary64Sha256)
  );
  writeOrCheck(artifactPath, artifactText, check);
  writeOrCheck(artifactHashPath, hashText, check);
  writeOrCheck(javascriptPath, jsText, check);
  writeOrCheck(cppPath, cppText, check);
  writeOrCheck(pluginPath, expectedPlugin, check);
  process.stdout.write(
    `${check ? 'Checked' : 'Generated'} feedback table: ` +
    `${endpointPassed}/366 endpoints, ${densePassed}/3606 dense, ` +
    `${binary64Sha256}.\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
