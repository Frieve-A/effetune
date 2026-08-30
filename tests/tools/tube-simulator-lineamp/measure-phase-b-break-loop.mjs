// Restored 2026-08-16 from git dangling blob 2a7ce5217db4d82868baea7a951373fa6899591f
// (git fsck --lost-found; see tmp/dev/tube-simulator/tube-magnetics-phase5-step0-report-20260816.md).
// The original was isolated out of the tree on 2026-08-06 and the archived copy was
// lost; only this comment header differs from the recovered bytes. Its runtime
// dependency ./product-runtime.mjs is a 2026-08-16 reconstruction (the original is
// unrecoverable), so re-measurements drive the CURRENT JS reference and are not
// expected to reproduce the frozen phase-b-break-loop-v2.sha256 bit-exactly.
// WARNING: running this script with no arguments OVERWRITES the local artifact.
// The default output path is tmp/dev/tube-simulator/tube-simulator-lineamp/lineamp-v1/
// phase-b-break-loop-v2.json and a non---check run rewrites both it and its
// .sha256, so the replacement is self-consistent and --check can no longer
// detect it. That file is untracked (~6.9 MiB) and cannot be restored with git.
// Pass --output to keep an additional measurement instead of replacing it.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createJavascriptReferenceSession } from './product-runtime.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..', '..');
const pluginSourcePath = path.join(
  repoRoot,
  'plugins',
  'saturation',
  'tube_simulator.js'
);
const defaultOutputPath = path.join(
  repoRoot,
  'tmp',
  'dev',
  'tube-simulator-lineamp',
  'lineamp-v1',
  'phase-b-break-loop-v2.json'
);

const TUBES = Object.freeze(['12AX7', '12AT7', '12AU7']);
const FAMILIES = Object.freeze([
  Object.freeze({ internalRate: 352800, hostRate: 44100, factor: 8 }),
  Object.freeze({ internalRate: 384000, hostRate: 48000, factor: 8 })
]);
const BASE_PARAMS = Object.freeze({
  dr: -40,
  tp: '12AU7',
  bi: 0,
  pv: 250,
  sz: 10,
  su: 10,
  og: 0,
  mx: 100,
  iv: 0.1,
  nf: 0
});

const sha256 = bytes =>
  crypto.createHash('sha256').update(bytes).digest('hex');

const canonicalText = value => `${JSON.stringify(value, null, 2)}\n`;

function fft(real, imaginary) {
  const length = real.length;
  if (length !== imaginary.length ||
      length < 2 || (length & (length - 1)) !== 0) {
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
      [imaginary[index], imaginary[reversed]] =
        [imaginary[reversed], imaginary[index]];
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
        const oddReal =
          real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary =
          real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
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
    imaginary:
      imaginary[low] + fraction * (imaginary[high] - imaginary[low])
  };
}

function responseFrequencies(internalRate) {
  const frequencies = [];
  const maximumFrequency = internalRate / 2;
  for (let index = 0; index <= 4096; ++index) {
    frequencies.push(
      20 * ((maximumFrequency / 20) ** (index / 4096))
    );
  }
  frequencies.push(1000, 20000);
  return [...new Set(frequencies)].sort((left, right) => left - right);
}

function serializeResponse(frequencyHz, value) {
  return {
    frequencyHz,
    real: value.real,
    imaginary: value.imaginary
  };
}

async function measurePolarity(session, amplitude, captureSamples, factor) {
  session.reset();
  session.beginBreakLoopImpulse({ amplitude, captureSamples });
  session.processSilence(captureSamples / factor);
  const result = session.breakLoopImpulse();
  if (!result || result.sample !== captureSamples ||
      result.detectorResponse.length !== captureSamples ||
      result.outputResponse.length !== captureSamples) {
    throw new Error('Break-loop reference capture is incomplete');
  }
  return result;
}

function centralDifferenceSpectrum(positive, negative, amplitude) {
  const real = new Float64Array(positive.length);
  const imaginary = new Float64Array(positive.length);
  let maximumEvenOrderRemainder = 0;
  let maximumLinearResponse = 0;
  for (let index = 0; index < positive.length; ++index) {
    const linear = (positive[index] - negative[index]) / (2 * amplitude);
    const remainder = (positive[index] + negative[index]) / (2 * amplitude);
    real[index] = linear;
    const absoluteLinear = linear >= 0 ? linear : -linear;
    const absoluteRemainder = remainder >= 0 ? remainder : -remainder;
    if (absoluteLinear > maximumLinearResponse) {
      maximumLinearResponse = absoluteLinear;
    }
    if (absoluteRemainder > maximumEvenOrderRemainder) {
      maximumEvenOrderRemainder = absoluteRemainder;
    }
  }
  fft(real, imaginary);
  return {
    real,
    imaginary,
    maximumEvenOrderRemainder,
    maximumLinearResponse
  };
}

async function measureRecord({
  tube,
  family,
  amplitude,
  captureSamples
}) {
  const session = await createJavascriptReferenceSession({
    sampleRate: family.hostRate,
    params: { ...BASE_PARAMS, tp: tube },
    pluginSourcePath
  });
  const positive = await measurePolarity(
    session,
    amplitude,
    captureSamples,
    family.factor
  );
  const positiveCheckpoint = session.checkpoint();
  const negative = await measurePolarity(
    session,
    -amplitude,
    captureSamples,
    family.factor
  );
  const negativeCheckpoint = session.checkpoint();
  const detectorSpectrum = centralDifferenceSpectrum(
    positive.detectorResponse,
    negative.detectorResponse,
    amplitude
  );
  const outputSpectrum = centralDifferenceSpectrum(
    positive.outputResponse,
    negative.outputResponse,
    amplitude
  );
  const frequencies = responseFrequencies(family.internalRate);
  const detectorResponse = frequencies.map(frequencyHz =>
    serializeResponse(frequencyHz, interpolateSpectrum(
      detectorSpectrum.real,
      detectorSpectrum.imaginary,
      family.internalRate,
      frequencyHz
    )));
  const outputResponse = frequencies.map(frequencyHz =>
    serializeResponse(frequencyHz, interpolateSpectrum(
      outputSpectrum.real,
      outputSpectrum.imaginary,
      family.internalRate,
      frequencyHz
    )));
  return {
    key: `${tube}-${family.internalRate}`,
    tube,
    hostRate: family.hostRate,
    internalRate: family.internalRate,
    factor: family.factor,
    params: { ...BASE_PARAMS, tp: tube },
    feedbackNode: 'second-stage-plate-before-220nF-output-branch',
    feedbackDetect: 'Vplate2-plateReference',
    insertionPoint: 'complete-error-before-2p1z',
    feedbackTransportInternalSamples: 2,
    detectorResponse,
    outputResponse,
    linearity: {
      positiveImpulseV: amplitude,
      negativeImpulseV: -amplitude,
      detectorMaximumLinearResponse:
        detectorSpectrum.maximumLinearResponse,
      detectorMaximumEvenOrderRemainder:
        detectorSpectrum.maximumEvenOrderRemainder,
      outputMaximumLinearResponse:
        outputSpectrum.maximumLinearResponse,
      outputMaximumEvenOrderRemainder:
        outputSpectrum.maximumEvenOrderRemainder
    },
    residuals: {
      maximumFastKclResidualA: Math.max(
        positiveCheckpoint.maximumFastKclResidual,
        negativeCheckpoint.maximumFastKclResidual
      ),
      maximumSlowKclResidualA: Math.max(
        positiveCheckpoint.maximumSlowKclResidual,
        negativeCheckpoint.maximumSlowKclResidual
      ),
      maximumDcResidualA: Math.max(
        positiveCheckpoint.maximumDcResidual,
        negativeCheckpoint.maximumDcResidual
      ),
      finiteFaults: positiveCheckpoint.finiteFaults +
        negativeCheckpoint.finiteFaults,
      safetyLimits: positiveCheckpoint.safetyLimits +
        negativeCheckpoint.safetyLimits
    }
  };
}

function parseArgs(args) {
  const outputIndex = args.indexOf('--output');
  const samplesIndex = args.indexOf('--capture-samples');
  const amplitudeIndex = args.indexOf('--amplitude');
  const known = new Set([
    '--output',
    '--capture-samples',
    '--amplitude',
    '--check'
  ]);
  for (let index = 0; index < args.length; ++index) {
    const argument = args[index];
    if (!known.has(argument) &&
        (index === 0 || !known.has(args[index - 1]) ||
          args[index - 1] === '--check')) {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  const captureSamples = samplesIndex < 0
    ? 524288
    : Number(args[samplesIndex + 1]);
  const amplitude = amplitudeIndex < 0
    ? 1e-4
    : Number(args[amplitudeIndex + 1]);
  if (!Number.isInteger(captureSamples) ||
      captureSamples < 4096 ||
      (captureSamples & (captureSamples - 1)) !== 0 ||
      captureSamples % 8 !== 0 ||
      !Number.isFinite(amplitude) || amplitude <= 0) {
    throw new Error('Break-loop capture parameters are invalid');
  }
  return {
    outputPath: outputIndex < 0
      ? defaultOutputPath
      : path.resolve(args[outputIndex + 1]),
    captureSamples,
    amplitude,
    check: args.includes('--check')
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pluginBytes = await fs.readFile(pluginSourcePath);
  const records = [];
  for (const tube of TUBES) {
    for (const family of FAMILIES) {
      process.stdout.write(
        `Measuring actual break loop ${tube}/${family.internalRate}...\n`
      );
      records.push(await measureRecord({
        tube,
        family,
        amplitude: options.amplitude,
        captureSamples: options.captureSamples
      }));
    }
  }
  const artifact = {
    contract: 'tube-line-break-loop-v2',
    method: 'central-difference-complete-error-impulse-fft',
    referenceProcessor:
      'plugins/saturation/tube_simulator.js#TUBE_SIMULATOR_REFERENCE_PROCESSOR',
    pluginSourceSha256: sha256(pluginBytes),
    captureSamples: options.captureSamples,
    frequencyResolutionHzByFamily: Object.fromEntries(
      FAMILIES.map(family => [
        family.internalRate,
        family.internalRate / options.captureSamples
      ])
    ),
    records
  };
  const text = canonicalText(artifact);
  const hashText = `${sha256(text)}  ${path.basename(options.outputPath)}\n`;
  const hashPath = options.outputPath.replace(/\.json$/u, '.sha256');
  if (options.check) {
    const [existingText, existingHash] = await Promise.all([
      fs.readFile(options.outputPath, 'utf8'),
      fs.readFile(hashPath, 'utf8')
    ]);
    if (existingText !== text || existingHash !== hashText) {
      throw new Error('Frozen Phase B break-loop response is not current');
    }
  } else {
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await Promise.all([
      fs.writeFile(options.outputPath, text, 'utf8'),
      fs.writeFile(hashPath, hashText, 'utf8')
    ]);
  }
  process.stdout.write(
    `Actual break-loop response ${sha256(text)} (${records.length} records).\n`
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
