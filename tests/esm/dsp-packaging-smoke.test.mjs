import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { DSP_FILES, verifyPackagedDsp } from '../../tools/verify-dsp-package.mjs';

const MINIMAL_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const require = createRequire(import.meta.url);

function createPackageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dspDirectory = path.join(root, 'resources', 'app', 'plugins', 'dsp');
  fs.mkdirSync(dspDirectory, { recursive: true });
  fs.writeFileSync(path.join(dspDirectory, 'effetune-dsp.wasm'), MINIMAL_WASM);
  fs.writeFileSync(path.join(dspDirectory, 'effetune-dsp.simd.wasm'), MINIMAL_WASM);
  fs.writeFileSync(path.join(dspDirectory, 'effetune-dsp.meta.json'), JSON.stringify({ abiVersion: 1, kernels: [] }));
  return root;
}

test('DSP packaging smoke accepts complete unpacked application payloads', t => {
  const root = createPackageFixture(t);
  const result = verifyPackagedDsp(root);

  assert.deepEqual(result.files, DSP_FILES);
  assert.deepEqual(result.meta.kernels, []);
  assert.equal(result.applications.length, 1);
  assert.equal(result.applications[0].kind, 'directory');
});

test('DSP packaging smoke reads complete ASAR application payloads', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-package-asar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const dspDirectory = path.join(source, 'plugins', 'dsp');
  fs.mkdirSync(dspDirectory, { recursive: true });
  fs.writeFileSync(path.join(dspDirectory, 'effetune-dsp.wasm'), MINIMAL_WASM);
  fs.writeFileSync(path.join(dspDirectory, 'effetune-dsp.simd.wasm'), MINIMAL_WASM);
  fs.writeFileSync(
    path.join(dspDirectory, 'effetune-dsp.meta.json'),
    JSON.stringify({ abiVersion: 1, kernels: [] })
  );
  const archivePath = path.join(root, 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  await require('@electron/asar').createPackage(source, archivePath);

  const result = verifyPackagedDsp(root);
  assert.deepEqual(result.files, DSP_FILES);
  assert.deepEqual(result.meta.kernels, []);
  assert.equal(result.applications.length, 1);
  assert.equal(result.applications[0].kind, 'asar');
});

test('DSP packaging smoke validates every ASAR without combining their payloads', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-package-multiple-asar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixtures = [
    { name: 'arm64', wasm: 'effetune-dsp.simd.wasm' },
    { name: 'x64', wasm: 'effetune-dsp.wasm' }
  ];

  for (const fixture of fixtures) {
    const source = path.join(root, `${fixture.name}-source`);
    const dspDirectory = path.join(source, 'plugins', 'dsp');
    fs.mkdirSync(dspDirectory, { recursive: true });
    fs.writeFileSync(path.join(dspDirectory, fixture.wasm), MINIMAL_WASM);
    fs.writeFileSync(
      path.join(dspDirectory, 'effetune-dsp.meta.json'),
      JSON.stringify({ abiVersion: 1, kernels: [] })
    );
    const archivePath = path.join(root, fixture.name, 'resources', 'app.asar');
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    await require('@electron/asar').createPackage(source, archivePath);
  }

  assert.throws(
    () => verifyPackagedDsp(root),
    /Packaged application is missing plugins\/dsp\/effetune-dsp(?:\.simd)?\.wasm/
  );
});

test('DSP packaging smoke rejects missing or invalid WebAssembly payloads', t => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-package-missing-'));
  t.after(() => fs.rmSync(missingRoot, { recursive: true, force: true }));
  assert.throws(() => verifyPackagedDsp(missingRoot), /missing plugins\/dsp\/effetune-dsp\.wasm/);

  const invalidRoot = createPackageFixture(t);
  fs.writeFileSync(path.join(invalidRoot, 'resources', 'app', 'plugins', 'dsp', 'effetune-dsp.wasm'), Buffer.from('invalid'));
  assert.throws(() => verifyPackagedDsp(invalidRoot), /too small|invalid WebAssembly magic/);
});

test('DSP packaging smoke rejects local debug WebAssembly payloads', t => {
  const root = createPackageFixture(t);
  fs.writeFileSync(
    path.join(root, 'resources', 'app', 'plugins', 'dsp', 'effetune-dsp.debug.wasm'),
    MINIMAL_WASM
  );

  assert.throws(
    () => verifyPackagedDsp(root),
    /must not contain plugins\/dsp\/effetune-dsp\.debug\.wasm/
  );
});
