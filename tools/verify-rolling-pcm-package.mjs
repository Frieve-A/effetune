import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  findPackagedApplications
} from './verify-dsp-package.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const workerRelative = 'js/vendor/rolling-pcm-decoder-worker.mjs';
const noticeRelative = 'js/vendor/rolling-pcm-decoder-worker.NOTICE.txt';
const transportRelative = 'js/ui/audio-player/rolling-pcm-transport.js';
for (const relativePath of [workerRelative, noticeRelative]) {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} must exist`);
}
assert.equal(packageJson.build.files.includes('js/**/*'), true, 'Electron package must include js assets');
const precache = fs.readFileSync(path.join(repoRoot, 'sw-precache.js'), 'utf8');
assert.match(precache, /rolling-pcm-decoder-worker\.mjs/);
assert.match(precache, /rolling-pcm-decoder-worker\.NOTICE\.txt/);

const sourceWorker = fs.readFileSync(path.join(repoRoot, workerRelative));
const sourceNotice = fs.readFileSync(path.join(repoRoot, noticeRelative));
const digest = payload => crypto.createHash('sha256').update(payload).digest('hex');

function readApplicationPayload(application, relativePath) {
  if (application.kind === 'directory') {
    const filePath = path.join(application.path, ...relativePath.split('/'));
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  }
  const asar = requireAsar();
  const normalizedTarget = `/${relativePath}`;
  const entries = asar.listPackage(application.path);
  if (!entries.some(entry => entry.replace(/\\/g, '/') === normalizedTarget)) return null;
  return asar.extractFile(application.path, relativePath.split('/').join(path.sep));
}

let asarModule = null;
function requireAsar() {
  if (asarModule) return asarModule;
  const require = createRequire(import.meta.url);
  asarModule = require('@electron/asar');
  return asarModule;
}

function verifyRollingPcmApplication(application) {
  const context = `${application.path}: `;
  const packagedWorker = readApplicationPayload(application, workerRelative);
  const packagedNotice = readApplicationPayload(application, noticeRelative);
  const packagedTransport = readApplicationPayload(application, transportRelative);
  assert.ok(packagedWorker, `${context}Packaged application is missing ${workerRelative}`);
  assert.ok(packagedNotice, `${context}Packaged application is missing ${noticeRelative}`);
  assert.ok(packagedTransport, `${context}Packaged application is missing ${transportRelative}`);
  assert.equal(
    digest(packagedWorker),
    digest(sourceWorker),
    `${context}Packaged rolling PCM Worker must match the generated source asset`
  );
  assert.equal(
    digest(packagedNotice),
    digest(sourceNotice),
    `${context}Packaged rolling PCM Worker notice must match the generated source asset`
  );

  const transportSource = packagedTransport.toString('utf8');
  const workerSpecifier = transportSource.match(
    /DEFAULT_WORKER_URL\s*=\s*new URL\(['"]([^'"]+)['"],\s*import\.meta\.url\)/
  )?.[1];
  assert.ok(
    workerSpecifier,
    `${context}Packaged transport must construct its production Worker URL from import.meta.url`
  );
  const resolvedWorkerRelative = path.posix.normalize(path.posix.join(
    path.posix.dirname(transportRelative),
    workerSpecifier
  ));
  assert.equal(
    resolvedWorkerRelative,
    workerRelative,
    `${context}Packaged production Worker URL must resolve to the packaged rolling PCM Worker asset`
  );
  return { kind: application.kind, path: application.path };
}

function verifyRollingPcmPackage(packageRoot) {
  const root = path.resolve(packageRoot);
  const applications = findPackagedApplications(root);
  assert.ok(
    applications.length > 0,
    `No packaged resources/app or resources/app.asar was found under ${root}`
  );
  return applications.map(verifyRollingPcmApplication);
}

export { verifyRollingPcmPackage };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const packageRoot = path.resolve(process.argv[2] || 'dist');
  const applications = verifyRollingPcmPackage(packageRoot);
  console.log(
    `Verified rolling PCM Worker URL and byte-identical assets in ${applications.length} packaged application(s) under ${packageRoot}.`
  );
}
