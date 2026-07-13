import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createVsEnvironmentInvocation,
  emscriptenExecutableName,
  metadataContents,
  sourceDigest
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
