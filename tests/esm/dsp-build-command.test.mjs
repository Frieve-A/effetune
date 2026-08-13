import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createVsEnvironmentInvocation,
  emscriptenExecutableName,
  metadataContents,
  parseArtifactsDirectory,
  parseNativeBuildType,
  sourceDigest,
  sourceDigestInputPaths
} from '../../scripts/build-dsp-wasm.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('DSP build invokes tools without placing dynamic paths in shell input', () => {
  assert.equal(emscriptenExecutableName('emcc', true), 'emcc.exe');
  assert.equal(emscriptenExecutableName('emcmake', true), 'emcmake.exe');
  assert.equal(emscriptenExecutableName('emcc', false), 'emcc');

  const vsDevCmd = path.join(
    path.parse(process.cwd()).root,
    'Visual Studio & Tools',
    'Common7',
    'Tools',
    'VsDevCmd.bat'
  );
  const invocation = createVsEnvironmentInvocation(vsDevCmd);

  assert.equal(invocation.command, 'cmd.exe');
  assert.deepEqual(invocation.args, [
    '/d', '/s', '/c',
    'call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set'
  ]);
  assert.equal(invocation.cwd, path.dirname(vsDevCmd));
  assert.equal(invocation.args.some(argument => argument.includes('Visual Studio & Tools')), false);
  assert.equal(Object.hasOwn(invocation, 'shell'), false);
});

test('DSP native build type accepts only explicit CMake configurations', () => {
  assert.equal(parseNativeBuildType([]), 'Debug');
  assert.equal(parseNativeBuildType(['--native-build-type=Debug']), 'Debug');
  assert.equal(parseNativeBuildType(['--native-build-type=Release']), 'Release');
  assert.throws(
    () => parseNativeBuildType(['--native-build-type=RelWithDebInfo']),
    /must be Debug or Release/
  );
  assert.throws(
    () => parseNativeBuildType([
      '--native-build-type=Debug',
      '--native-build-type=Release'
    ]),
    /may only be specified once/
  );
});

test('DSP scratch artifact directory accepts paired and equals syntax', () => {
  assert.equal(parseArtifactsDirectory([]), null);
  assert.equal(
    parseArtifactsDirectory(['--artifacts-dir', 'tmp/dsp-scratch']),
    path.join(repoRoot, 'tmp', 'dsp-scratch')
  );
  assert.equal(
    parseArtifactsDirectory(['--artifacts-dir=tmp/dsp-scratch']),
    path.join(repoRoot, 'tmp', 'dsp-scratch')
  );
  assert.throws(
    () => parseArtifactsDirectory(['--artifacts-dir']),
    /requires a path/
  );
  assert.throws(
    () => parseArtifactsDirectory([
      '--artifacts-dir=tmp/first', '--artifacts-dir', 'tmp/second'
    ]),
    /may only be specified once/
  );
});

test('DSP source digest ignores retained all-golden transaction directories', t => {
  const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
  const baseline = {
    abiVersion: 1,
    buildFlags: 0,
    kernels: [{ name: 'fixture', hash: 123, byteCapacity: 16 }],
    bytes: 100
  };
  const simd = { ...baseline, buildFlags: 1, bytes: 80 };
  const digestBefore = sourceDigest();
  const metadataBefore = metadataContents('fixture-sdk', baseline, simd);

  const transactionRoot = fs.mkdtempSync(path.join(pluginsRoot, '.golden-all-'));
  t.after(() => fs.rmSync(transactionRoot, { recursive: true, force: true }));

  assert.equal(sourceDigest(), digestBefore);
  assert.equal(metadataContents('fixture-sdk', baseline, simd), metadataBefore);

  const stagedRoot = path.join(transactionRoot, 'staged', '001');
  const backupRoot = path.join(transactionRoot, 'backup');
  fs.mkdirSync(stagedRoot, { recursive: true });
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.writeFileSync(path.join(stagedRoot, 'case-001.json'), '{"staged":true}\n');
  fs.writeFileSync(path.join(stagedRoot, 'retained-source.cpp'), 'int staged = 1;\n');
  fs.writeFileSync(
    path.join(backupRoot, 'golden-base-hash.json'),
    '{"pluginBaseHash":"retained-transaction"}\n'
  );

  assert.equal(sourceDigest(), digestBefore);
  assert.equal(metadataContents('fixture-sdk', baseline, simd), metadataBefore);
});

test('DSP source digest ignores generated JavaScript package output', t => {
  const distRoot = path.join(repoRoot, 'dsp', 'bindings', 'js', 'dist');
  const distExisted = fs.existsSync(distRoot);
  const sentinelPath = path.join(
    distRoot,
    `.source-digest-sentinel-${process.pid}-${Date.now()}.json`
  );
  const digestBefore = sourceDigest();

  fs.mkdirSync(distRoot, { recursive: true });
  t.after(() => {
    fs.rmSync(sentinelPath, { force: true });
    if (!distExisted && fs.existsSync(distRoot) && fs.readdirSync(distRoot).length === 0) {
      fs.rmdirSync(distRoot);
    }
  });
  fs.writeFileSync(sentinelPath, '{"generated":true}\n');

  assert.equal(sourceDigest(), digestBefore);
});

test('production source digest includes promoted GSM inputs', () => {
  const productionPaths = new Set(sourceDigestInputPaths());
  const gsmDirectory = 'dsp/plugins/lofi/gsm_full_rate_simulator/';
  const gsmHeader = 'dsp/generated/cpp/GSMFullRateSimulatorPluginParams.h';

  assert.equal([...productionPaths].some(file => file.startsWith(gsmDirectory)), true);
  assert.equal(productionPaths.has(gsmHeader), true);
});

test('CMake compiles promoted GSM Full Rate sources exactly once by default', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8');
  assert.doesNotMatch(source, /ET_PHASE0_GSM_FR/);
  assert.equal(source.match(/gsm_full_rate_simulator\/kernel\.cpp/g)?.length ?? 0, 0);
  assert.equal(source.match(/gsm_full_rate_simulator\/codec\.cpp/g)?.length ?? 0, 2);
  assert.match(source, /GLOB_RECURSE EFFETUNE_PLUGIN_SOURCES[\s\S]*?plugins\/\*\/kernel\.cpp/);
});
