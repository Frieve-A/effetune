import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const DSP_FILES = [
  'plugins/dsp/effetune-dsp.wasm',
  'plugins/dsp/effetune-dsp.simd.wasm',
  'plugins/dsp/effetune-dsp.meta.json'
];
const DEBUG_DSP_FILE = 'plugins/dsp/effetune-dsp.debug.wasm';
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

function findPackagedApplications(root) {
  const applications = [];
  const visit = candidatePath => {
    if (!fs.existsSync(candidatePath)) return;
    const stats = fs.statSync(candidatePath);
    const name = path.basename(candidatePath).toLowerCase();
    const parentName = path.basename(path.dirname(candidatePath)).toLowerCase();
    if (stats.isFile()) {
      if (name === 'app.asar' && parentName === 'resources') {
        applications.push({ kind: 'asar', path: candidatePath });
      }
      return;
    }
    if (!stats.isDirectory()) return;
    if (name === 'app' && parentName === 'resources') {
      applications.push({ kind: 'directory', path: candidatePath });
      return;
    }
    for (const entry of fs.readdirSync(candidatePath, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isFile()) visit(path.join(candidatePath, entry.name));
    }
  };
  visit(path.resolve(root));
  return applications.sort((left, right) => left.path.localeCompare(right.path));
}

function readAsarPayload(archivePath, relativePath) {
  const asar = require('@electron/asar');
  const normalizedTarget = `/${relativePath}`;
  const entries = asar.listPackage(archivePath);
  if (!entries.some(entry => entry.replace(/\\/g, '/') === normalizedTarget)) return null;
  return asar.extractFile(archivePath, relativePath.split('/').join(path.sep));
}

function readPackagedAppPayload(application, relativePath) {
  if (application.kind === 'asar') return readAsarPayload(application.path, relativePath);
  const filePath = path.join(application.path, ...relativePath.split('/'));
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function findPackagedAppPayload(root, relativePath) {
  const [application] = findPackagedApplications(root);
  return application ? readPackagedAppPayload(application, relativePath) : null;
}

function verifyPackagedApplication(application) {
  const context = `${application.path}: `;
  assert.equal(
    readPackagedAppPayload(application, DEBUG_DSP_FILE),
    null,
    `${context}Packaged application must not contain ${DEBUG_DSP_FILE}`
  );
  const payloads = new Map();
  for (const relativePath of DSP_FILES) {
    const payload = readPackagedAppPayload(application, relativePath);
    assert.ok(payload, `${context}Packaged application is missing ${relativePath}`);
    payloads.set(relativePath, payload);
  }

  for (const relativePath of DSP_FILES.filter(file => file.endsWith('.wasm'))) {
    const payload = payloads.get(relativePath);
    assert.ok(payload.length >= 8, `${context}${relativePath} is too small to be WebAssembly`);
    assert.deepEqual(
      payload.subarray(0, WASM_MAGIC.length),
      WASM_MAGIC,
      `${context}${relativePath} has invalid WebAssembly magic`
    );
  }

  const meta = JSON.parse(payloads.get('plugins/dsp/effetune-dsp.meta.json').toString('utf8'));
  assert.equal(meta.abiVersion, 1, `${context}Packaged DSP metadata has an unsupported ABI version`);
  assert.ok(Array.isArray(meta.kernels), `${context}Packaged DSP metadata must contain a kernels array`);
  return { kind: application.kind, path: application.path, files: [...payloads.keys()], meta };
}

function verifyPackagedDsp(root) {
  const applications = findPackagedApplications(root);
  assert.ok(
    applications.length > 0,
    `Packaged application is missing ${DSP_FILES[0]}: no resources/app or resources/app.asar found under ${root}`
  );
  const results = applications.map(verifyPackagedApplication);
  return {
    files: [...DSP_FILES],
    meta: results[0].meta,
    applications: results
  };
}

export { DSP_FILES, findPackagedApplications, findPackagedAppPayload, verifyPackagedDsp };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = path.resolve(process.argv[2] || 'dist');
  const result = verifyPackagedDsp(target);
  console.log(`Verified ${result.files.length} DSP files in ${result.applications.length} packaged application(s) under ${target}`);
}
