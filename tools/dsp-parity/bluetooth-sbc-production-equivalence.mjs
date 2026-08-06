import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { packBluetoothSBCSimulatorPluginParams } from '../../js/audio/dsp-params.generated.js';
import { preflightArtifactDirectory } from './bench.mjs';
import { isMain, parseArgs } from './cli.mjs';
import { packParams } from './runners.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PLUGIN_TYPE = 'BluetoothSBCSimulatorPlugin';
const PARAMS_HASH = 0xabab1724;
const PARAM_KEYS = Object.freeze(['bp', 'cm', 'bl', 'og', 'mx', 'pl']);
const PARAM_MEMBERS = Object.freeze([
  'bitpool',
  'channelMode',
  'blocks',
  'outputGain',
  'mix',
  'packetLoss'
]);
function usage() {
  return [
    'Usage: node tools/dsp-parity/bluetooth-sbc-production-equivalence.mjs --snapshot-root <path> --evidence <file> --json <file> [options]',
    '  --evidence <file>            accepted formal performance evidence JSON',
    '  --artifacts-dir <path>       production artifact directory (default plugins/dsp)',
    '  --baseline-build-dir <path>  baseline build directory (default dsp/build/wasm)',
    '  --simd-build-dir <path>      SIMD build directory (default dsp/build/wasm-simd)',
    '',
    'Confirms that the promoted Bluetooth SBC production ABI and Release WASM build',
    'match the accepted Phase 0 semantic and build contracts without re-running timing.'
  ].join('\n');
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function readU32(bytes, offset) {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 5; index++) {
    if (offset >= bytes.length) throw new Error('Truncated unsigned LEB128 value');
    const byte = bytes[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset };
    shift += 7;
  }
  throw new Error('Invalid unsigned LEB128 value');
}

export function parseWasmMemory(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 ||
      bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error('Invalid WebAssembly binary');
  }
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset++];
    const size = readU32(bytes, offset);
    offset = size.offset;
    const end = offset + size.value;
    if (end > bytes.length) throw new Error('Truncated WebAssembly section');
    if (id === 5) {
      const count = readU32(bytes, offset);
      offset = count.offset;
      if (count.value !== 1) throw new Error(`Expected one WebAssembly memory, found ${count.value}`);
      const limits = readU32(bytes, offset);
      offset = limits.offset;
      if ((limits.value & ~0x03) !== 0) {
        throw new Error(`Unsupported WebAssembly memory limits flags ${limits.value}`);
      }
      const initial = readU32(bytes, offset);
      offset = initial.offset;
      const maximum = (limits.value & 0x01) !== 0 ? readU32(bytes, offset) : null;
      return {
        initialPages: initial.value,
        maximumPages: maximum?.value ?? null,
        shared: (limits.value & 0x02) !== 0
      };
    }
    offset = end;
  }
  throw new Error('WebAssembly binary has no memory section');
}

export function parseCppParamHeader(source) {
  const struct = /struct\s+BluetoothSBCSimulatorPluginParams\s*\{([\s\S]*?)\};/.exec(source);
  const hash = /kHash\s*=\s*0x([0-9a-f]+)u/i.exec(source);
  const count = /kFloatCount\s*=\s*(\d+)u/.exec(source);
  if (!struct || !hash || !count) throw new Error('Bluetooth SBC parameter header is incomplete');
  return {
    members: [...struct[1].matchAll(/\bfloat\s+([A-Za-z_$][\w$]*)\s*;/g)].map(match => match[1]),
    hash: Number.parseInt(hash[1], 16) >>> 0,
    count: Number.parseInt(count[1], 10)
  };
}

export function projectSchema(schema) {
  return {
    pluginType: schema.type,
    paramsHash: PARAMS_HASH,
    layout: schema.fields.map(field => ({
      key: field.key,
      kind: field.kind,
      default: field.default,
      ...(field.values ? { values: field.values } : {})
    }))
  };
}

function normalizedKernelSource(source) {
  return source
    .replace(/^#include "(?:phase0_params|BluetoothSBCSimulatorPluginParams)\.h"\r?\n/m, '')
    .replace(/\r\n/g, '\n');
}

function cacheValue(source, name) {
  const match = new RegExp(`^${name}:[^=]*=(.*)$`, 'm').exec(source);
  return match?.[1].trim() ?? null;
}

export function inspectBuildConfiguration(cache, ninja, { simd }) {
  const requiredCompileFlags = ['-std=c++20', '-O3', '-flto', '-fwasm-exceptions', '-fno-rtti'];
  const requiredLinkFlags = [
    '-sSTANDALONE_WASM=1',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=8388608',
    '-sMAXIMUM_MEMORY=268435456',
    '-sEXPORTED_FUNCTIONS='
  ];
  return {
    buildType: cacheValue(cache, 'CMAKE_BUILD_TYPE'),
    buildTesting: cacheValue(cache, 'BUILD_TESTING'),
    debugState: cacheValue(cache, 'ET_DEBUG_STATE'),
    requiredCompileFlags: Object.fromEntries(requiredCompileFlags.map(flag => [flag, ninja.includes(flag)])),
    requiredLinkFlags: Object.fromEntries(requiredLinkFlags.map(flag => [flag, ninja.includes(flag)])),
    simdFlagPresent: ninja.includes('-msimd128'),
    expectedSimd: simd
  };
}

function allValues(object, expected = true) {
  return Object.values(object).every(value => value === expected);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addCheck(checks, id, passed, actual, expected) {
  checks.push({ id, passed, actual, expected });
}

async function inspectVariant({
  name,
  simd,
  buildDir,
  committedPath,
  smoke,
  declaredExports
}) {
  const [cache, ninja, buildBytes, committedBytes] = await Promise.all([
    fs.readFile(path.join(buildDir, 'CMakeCache.txt'), 'utf8'),
    fs.readFile(path.join(buildDir, 'build.ninja'), 'utf8'),
    fs.readFile(path.join(buildDir, 'effetune-dsp.wasm')),
    fs.readFile(committedPath)
  ]);
  const module = await WebAssembly.compile(committedBytes);
  const exports = WebAssembly.Module.exports(module).map(entry => entry.name).sort();
  const imports = WebAssembly.Module.imports(module);
  const configuration = inspectBuildConfiguration(cache, ninja, { simd });
  return {
    name,
    buildDir,
    committedPath,
    buildFlags: smoke.buildFlags,
    bytes: committedBytes.length,
    sha256: sha256(committedBytes),
    exactBuildArtifactMatch: Buffer.compare(buildBytes, committedBytes) === 0,
    configuration,
    memory: parseWasmMemory(committedBytes),
    declaredExportsPresent: declaredExports.every(exportName => exports.includes(exportName)),
    unexpectedImports: imports.filter(entry => entry.kind !== 'function'),
    exports,
    imports
  };
}

export async function evaluateBluetoothSbcProductionEquivalence({
  repoRoot = REPO_ROOT,
  snapshotRoot,
  evidencePath,
  artifactsDir = path.join(repoRoot, 'plugins', 'dsp'),
  baselineBuildDir = path.join(repoRoot, 'dsp', 'build', 'wasm'),
  simdBuildDir = path.join(repoRoot, 'dsp', 'build', 'wasm-simd')
}) {
  if (!evidencePath) throw new Error('evidencePath is required');
  const [
    evidence,
    snapshotSchema,
    finalSchema,
    snapshotHeaderSource,
    finalHeaderSource,
    snapshotKernelSource,
    finalKernelSource,
    emsdkVersion,
    declaredExportSource
  ] = await Promise.all([
    fs.readFile(evidencePath, 'utf8').then(JSON.parse),
    fs.readFile(path.join(snapshotRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'phase0-params.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'params.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(snapshotRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'phase0_params.h'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'generated', 'cpp', 'BluetoothSBCSimulatorPluginParams.h'), 'utf8'),
    fs.readFile(path.join(snapshotRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'kernel.cpp'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'kernel.cpp'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'EMSDK_VERSION'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'exports.txt'), 'utf8')
  ]);
  const accepted = evidence.inputManifests?.productionEquivalence?.start?.semanticProjection;
  if (!accepted?.build) throw new Error(`Accepted production-equivalence projection is missing in ${evidencePath}`);

  const artifactSet = await preflightArtifactDirectory(artifactsDir, repoRoot);
  const declaredExports = JSON.parse(declaredExportSource).map(name => name.replace(/^_/, ''));
  const snapshotHeader = parseCppParamHeader(snapshotHeaderSource);
  const finalHeader = parseCppParamHeader(finalHeaderSource);
  const snapshotProjection = projectSchema(snapshotSchema);
  const finalProjection = projectSchema(finalSchema);
  const joint = { bp: 53, cm: 'Joint Stereo', bl: '4', og: 0, mx: 100, pl: 0 };
  const stereo = { ...joint, cm: 'Stereo' };
  const packed = {
    snapshotJoint: [...packParams(snapshotSchema, joint)],
    finalJoint: [...packBluetoothSBCSimulatorPluginParams(joint)],
    snapshotStereo: [...packParams(snapshotSchema, stereo)],
    finalStereo: [...packBluetoothSBCSimulatorPluginParams(stereo)]
  };
  const variants = await Promise.all([
    inspectVariant({
      name: 'baseline',
      simd: false,
      buildDir: baselineBuildDir,
      committedPath: artifactSet.baselinePath,
      smoke: artifactSet.baseline,
      declaredExports
    }),
    inspectVariant({
      name: 'simd',
      simd: true,
      buildDir: simdBuildDir,
      committedPath: artifactSet.simdPath,
      smoke: artifactSet.simd,
      declaredExports
    })
  ]);

  const checks = [];
  addCheck(checks, 'accepted-formal-evidence', evidence.passed === true, evidence.passed, true);
  addCheck(checks, 'snapshot-header-layout', same(snapshotHeader.members, PARAM_MEMBERS), snapshotHeader.members, PARAM_MEMBERS);
  addCheck(checks, 'final-header-layout', same(finalHeader.members, PARAM_MEMBERS), finalHeader.members, PARAM_MEMBERS);
  addCheck(checks, 'snapshot-header-hash-count', snapshotHeader.hash === PARAMS_HASH && snapshotHeader.count === PARAM_KEYS.length, snapshotHeader, { hash: PARAMS_HASH, count: PARAM_KEYS.length });
  addCheck(checks, 'final-header-hash-count', finalHeader.hash === PARAMS_HASH && finalHeader.count === PARAM_KEYS.length, finalHeader, { hash: PARAMS_HASH, count: PARAM_KEYS.length });
  addCheck(checks, 'schema-keys', same(finalSchema.fields.map(field => field.key), PARAM_KEYS), finalSchema.fields.map(field => field.key), PARAM_KEYS);
  addCheck(checks, 'phase0-final-schema', same(snapshotProjection, finalProjection), finalProjection, snapshotProjection);
  addCheck(checks, 'accepted-schema', same(finalProjection, {
    pluginType: accepted.pluginType,
    paramsHash: accepted.paramsHash,
    layout: accepted.layout
  }), finalProjection, accepted);
  addCheck(checks, 'kernel-source', normalizedKernelSource(finalKernelSource) === normalizedKernelSource(snapshotKernelSource), sha256(normalizedKernelSource(finalKernelSource)), sha256(normalizedKernelSource(snapshotKernelSource)));
  addCheck(checks, 'joint-packing', same(packed.finalJoint, [53, 0, 0, 0, 100, 0]) && same(packed.finalJoint, packed.snapshotJoint), packed.finalJoint, [53, 0, 0, 0, 100, 0]);
  addCheck(checks, 'stereo-packing', same(packed.finalStereo, [53, 1, 0, 0, 100, 0]) && same(packed.finalStereo, packed.snapshotStereo), packed.finalStereo, [53, 1, 0, 0, 100, 0]);
  addCheck(checks, 'emsdk-version', emsdkVersion.trim() === accepted.build.emsdkVersion && artifactSet.metadata.emsdkVersion === accepted.build.emsdkVersion, { source: emsdkVersion.trim(), artifact: artifactSet.metadata.emsdkVersion }, accepted.build.emsdkVersion);
  addCheck(checks, 'artifact-kernel-hash', artifactSet.kernels.get(PLUGIN_TYPE) === PARAMS_HASH, artifactSet.kernels.get(PLUGIN_TYPE), PARAMS_HASH);

  for (const variant of variants) {
    const expectedBuildFlags = variant.name === 'simd'
      ? accepted.build.simd.buildFlags
      : accepted.build.baseline.buildFlags;
    addCheck(checks, `${variant.name}-artifact-match`, variant.exactBuildArtifactMatch, variant.sha256, 'committed artifact bytes equal build artifact bytes');
    addCheck(checks, `${variant.name}-build-flags`, variant.buildFlags === expectedBuildFlags, variant.buildFlags, expectedBuildFlags);
    addCheck(checks, `${variant.name}-build-type`, variant.configuration.buildType === accepted.build.buildType, variant.configuration.buildType, accepted.build.buildType);
    addCheck(checks, `${variant.name}-build-testing`, variant.configuration.buildTesting === (accepted.build.buildTesting ? 'ON' : 'OFF'), variant.configuration.buildTesting, accepted.build.buildTesting ? 'ON' : 'OFF');
    addCheck(checks, `${variant.name}-debug-state`, variant.configuration.debugState === (accepted.build.debugState ? 'ON' : 'OFF'), variant.configuration.debugState, accepted.build.debugState ? 'ON' : 'OFF');
    addCheck(checks, `${variant.name}-compile-flags`, allValues(variant.configuration.requiredCompileFlags), variant.configuration.requiredCompileFlags, 'all true');
    addCheck(checks, `${variant.name}-link-flags`, allValues(variant.configuration.requiredLinkFlags), variant.configuration.requiredLinkFlags, 'all true');
    addCheck(checks, `${variant.name}-simd-flag`, variant.configuration.simdFlagPresent === variant.configuration.expectedSimd, variant.configuration.simdFlagPresent, variant.configuration.expectedSimd);
    addCheck(checks, `${variant.name}-memory`, variant.memory.initialPages * 65536 === accepted.build.wasm.initialMemoryBytes && variant.memory.maximumPages * 65536 === accepted.build.wasm.maximumMemoryBytes && !variant.memory.shared, variant.memory, { initialPages: 128, maximumPages: 4096, shared: false });
    addCheck(checks, `${variant.name}-exports`, variant.declaredExportsPresent, variant.exports, declaredExports);
    addCheck(checks, `${variant.name}-imports`, variant.unexpectedImports.length === 0, variant.unexpectedImports, []);
  }

  return {
    contract: 'bluetooth-sbc-production-equivalence-v1',
    passed: checks.every(check => check.passed),
    checkedAt: new Date().toISOString(),
    snapshotRoot,
    evidencePath,
    artifactsDir: artifactSet.root,
    acceptedProjection: accepted,
    finalProjection: { ...finalProjection, build: accepted.build },
    packed,
    artifactSourceDigest: artifactSet.metadata.sourceDigest,
    variants,
    checks
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args['snapshot-root'] || !args.evidence || !args.json) throw new Error(usage());
  const result = await evaluateBluetoothSbcProductionEquivalence({
    repoRoot: REPO_ROOT,
    snapshotRoot: path.resolve(String(args['snapshot-root'])),
    evidencePath: path.resolve(String(args.evidence)),
    artifactsDir: path.resolve(REPO_ROOT, String(args['artifacts-dir'] ?? 'plugins/dsp')),
    baselineBuildDir: path.resolve(REPO_ROOT, String(args['baseline-build-dir'] ?? 'dsp/build/wasm')),
    simdBuildDir: path.resolve(REPO_ROOT, String(args['simd-build-dir'] ?? 'dsp/build/wasm-simd'))
  });
  const outputPath = path.resolve(REPO_ROOT, String(args.json));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) throw new Error(`Bluetooth SBC production equivalence failed; see ${outputPath}`);
}

if (isMain(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
