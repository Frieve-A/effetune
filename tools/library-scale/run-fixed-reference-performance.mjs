import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  REFERENCE_FIXTURE_COUNT,
  REFERENCE_FIXTURE_SEED,
  referenceTrackBatches
} from './reference-fixture.mjs';

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDirectory, '..', '..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('Invalid fixed-reference arguments');
    result[name.slice(2)] = value;
  }
  return result;
}

function currentMachine() {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    logicalCores: os.cpus().length,
    totalMemoryBytes: os.totalmem()
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeInitialManifest(filePath) {
  if (fs.existsSync(filePath)) throw new Error(`Refusing to overwrite ${filePath}`);
  const manifest = {
    schemaVersion: 1,
    kind: 'effetune-library-reference-machine',
    id: `reference-${os.hostname()}`,
    machine: currentMachine(),
    fixture: { count: REFERENCE_FIXTURE_COUNT, seed: REFERENCE_FIXTURE_SEED },
    measurement: { querySamples: 20, audioWorkletSeconds: 60 }
  };
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function loadManifest(filePath) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'effetune-library-reference-machine' ||
      typeof manifest.id !== 'string' || manifest.fixture?.count !== REFERENCE_FIXTURE_COUNT ||
      manifest.fixture?.seed !== REFERENCE_FIXTURE_SEED ||
      !Number.isSafeInteger(manifest.measurement?.querySamples) || manifest.measurement.querySamples < 1 ||
      !Number.isFinite(manifest.measurement?.audioWorkletSeconds) || manifest.measurement.audioWorkletSeconds < 60) {
    throw new Error('Reference-machine manifest is invalid');
  }
  if (stableJson(manifest.machine) !== stableJson(currentMachine())) {
    throw new Error('This computer does not match the fixed reference-machine manifest');
  }
  return manifest;
}

function fixtureDigest(manifest) {
  const hash = crypto.createHash('sha256');
  for (const batch of referenceTrackBatches(manifest.fixture)) {
    for (const track of batch) hash.update(`${JSON.stringify(track)}\n`);
  }
  return `sha256:${hash.digest('hex')}`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}

function sourceIdentity() {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (commit.status !== 0) throw new Error('Unable to read the source commit');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  return { commitSha: commit.stdout.trim(), dirty: Boolean(status.stdout.trim()) };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args['init-manifest']) {
    writeInitialManifest(path.resolve(args['init-manifest']));
    return;
  }
  if (!args.manifest || !args.output) {
    throw new Error('Use --init-manifest <path>, or --manifest <path> --output <path>');
  }
  const manifestPath = path.resolve(args.manifest);
  const outputPath = path.resolve(args.output);
  const manifest = loadManifest(manifestPath);
  const digest = fixtureDigest(manifest);
  const fixture = { ...manifest.fixture, digest };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-fixed-reference-'));
  const electronOutput = path.join(temporary, 'electron.json');
  const browserOutput = path.join(temporary, 'browser.json');
  try {
    const common = [
      '--count', String(fixture.count), '--seed', String(fixture.seed), '--digest', fixture.digest,
      '--samples', String(manifest.measurement.querySamples)
    ];
    const electronExecutable = require('electron');
    await run(electronExecutable, [
      path.join(toolsDirectory, 'measure-electron-utility.cjs'),
      ...common, '--directory', path.join(temporary, 'electron-catalog'), '--output', electronOutput
    ]);
    await run(process.execPath, [
      path.join(toolsDirectory, 'measure-web-worker-worklet.mjs'),
      ...common, '--audio-seconds', String(manifest.measurement.audioWorkletSeconds), '--output', browserOutput
    ]);
    const browser = JSON.parse(fs.readFileSync(browserOutput, 'utf8'));
    const source = sourceIdentity();
    const measurement = {
      schemaVersion: 1,
      kind: 'library-scale-fixed-reference-measurement',
      measuredAt: new Date().toISOString(),
      source,
      referenceMachine: {
        id: manifest.id,
        machine: manifest.machine
      },
      fixture,
      measurement: manifest.measurement,
      adapters: {
        electron: JSON.parse(fs.readFileSync(electronOutput, 'utf8')),
        web: browser.web,
        audioWorklet: browser.audioWorklet
      }
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(measurement, null, 2)}\n`, 'utf8');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
