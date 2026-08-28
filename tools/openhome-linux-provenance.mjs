import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const LIBNL_RUNTIME_FILE = /^libnl(?:-genl)?-3\.so(?:\..+)?$/;
const MANIFEST_FILE = 'libnl-runtime-manifest.json';
const ORIGINS_FILE = 'libnl-runtime-origins.json';

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    stdio: options.capture ? undefined : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${basename(command)} exited with code ${result.status}.`);
  }
  return options.capture ? result.stdout.trim() : '';
}

export function parseDpkgSearch(output, expectedPath) {
  const canonicalPath = realpathSync(expectedPath);
  const owners = new Set();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(': ');
    if (separator < 1) continue;
    const registeredPath = line.slice(separator + 2);
    if (existsSync(registeredPath) && realpathSync(registeredPath) === canonicalPath) {
      for (const owner of line.slice(0, separator).split(', ')) owners.add(owner);
    }
  }
  assert.equal(owners.size, 1, `${expectedPath} must have exactly one dpkg owner`);
  return [...owners][0];
}

export function parseDpkgRecord(output) {
  const fields = output.trim().split('\t');
  assert.equal(fields.length, 5, 'dpkg-query returned an incomplete package record');
  const [binaryPackage, version, architecture, sourcePackageField, sourceVersionField] = fields;
  assert.ok(binaryPackage && version && architecture, 'dpkg package identity is incomplete');
  const sourcePackage = sourcePackageField || binaryPackage.replace(/:[^:]+$/, '');
  const sourceVersion = sourceVersionField || version;
  assert.match(sourcePackage, /^[a-z0-9][a-z0-9+.-]*$/, 'Invalid Debian source package name');
  assert.ok(sourceVersion.length <= 256 && !/[\r\n]/.test(sourceVersion));
  return { binaryPackage, version, architecture, sourcePackage, sourceVersion };
}

function parseDscField(contents, field) {
  const match = contents.match(new RegExp(`^${field}:\\s*(\\S+)\\s*$`, 'm'));
  assert.ok(match, `Debian source descriptor is missing ${field}`);
  return match[1];
}

export function parseDscChecksums(contents) {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex(line => line === 'Checksums-Sha256:');
  assert.notEqual(start, -1, 'Debian source descriptor is missing Checksums-Sha256');
  const files = [];
  for (let index = start + 1; index < lines.length && /^\s/.test(lines[index]); index += 1) {
    const match = lines[index].trim().match(/^([0-9a-f]{64})\s+(\d+)\s+(\S+)$/i);
    assert.ok(match, 'Debian source descriptor has an invalid SHA-256 entry');
    files.push({ sha256: match[1].toLowerCase(), size: Number(match[2]), fileName: match[3] });
  }
  assert.ok(files.length > 0, 'Debian source descriptor does not reference source archives');
  return files;
}

function requireInside(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  assert.ok(child && !child.startsWith('..') && !child.includes(':'), `Path escapes ${parent}`);
}

function runtimeRootForArchitecture(architecture = process.arch) {
  return join(repositoryRoot, 'out', 'native', 'openhome-sidecar', `linux-${architecture}`);
}

function readOrigins(runtimeRoot) {
  const origins = JSON.parse(readFileSync(join(runtimeRoot, ORIGINS_FILE), 'utf8'));
  assert.equal(origins.schemaVersion, 1, 'Unsupported libnl origin manifest');
  assert.ok(Array.isArray(origins.libraries) && origins.libraries.length >= 2);
  return origins.libraries;
}

function queryPackage(sourcePath) {
  const search = run('dpkg-query', ['--search', `*/${basename(sourcePath)}`], { capture: true });
  const owner = parseDpkgSearch(search, sourcePath);
  const record = run('dpkg-query', [
    '--show',
    '--showformat=${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}',
    owner,
  ], { capture: true });
  return parseDpkgRecord(record);
}

function collectRuntimeLibraries(runtimeRoot) {
  const expectedArchitecture = process.arch === 'x64' ? 'amd64' : process.arch;
  return readOrigins(runtimeRoot).map(origin => {
    assert.ok(LIBNL_RUNTIME_FILE.test(origin.soname));
    assert.equal(origin.packagedFile, origin.soname);
    const packagedPath = join(runtimeRoot, origin.packagedFile);
    assert.equal(sha256(packagedPath), origin.sha256, `${origin.packagedFile} changed after collection`);
    assert.equal(sha256(origin.sourcePath), origin.sha256, `${origin.packagedFile} differs from its dpkg file`);
    const packageRecord = queryPackage(origin.sourcePath);
    assert.equal(packageRecord.architecture, expectedArchitecture, 'libnl package architecture mismatch');
    return {
      fileName: origin.packagedFile,
      soname: origin.soname,
      sha256: origin.sha256,
      installedPath: origin.sourcePath,
      ...packageRecord,
    };
  });
}

function collectSourceArtifacts(runtimeRoot, runtimeLibraries) {
  const sourceRoot = join(runtimeRoot, 'libnl-source');
  requireInside(runtimeRoot, sourceRoot);
  rmSync(sourceRoot, { recursive: true, force: true });
  mkdirSync(sourceRoot, { recursive: true });
  const sources = new Map();
  for (const library of runtimeLibraries) {
    const key = `${library.sourcePackage}\u0000${library.sourceVersion}`;
    sources.set(key, { sourcePackage: library.sourcePackage, sourceVersion: library.sourceVersion });
  }

  const artifacts = [];
  for (const source of sources.values()) {
    const packageRoot = join(sourceRoot, source.sourcePackage);
    requireInside(sourceRoot, packageRoot);
    mkdirSync(packageRoot, { recursive: true });
    run('apt-get', [
      'source',
      '--download-only',
      `${source.sourcePackage}=${source.sourceVersion}`,
    ], { cwd: packageRoot });
    const downloaded = readdirSync(packageRoot, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort();
    const descriptors = downloaded.filter(name => name.endsWith('.dsc'));
    assert.equal(descriptors.length, 1, `${source.sourcePackage} must provide exactly one .dsc`);
    const dscFile = descriptors[0];
    const dscContents = readFileSync(join(packageRoot, dscFile), 'utf8');
    assert.equal(parseDscField(dscContents, 'Source'), source.sourcePackage);
    assert.equal(parseDscField(dscContents, 'Version'), source.sourceVersion);
    const checksums = parseDscChecksums(dscContents);
    const expectedFiles = new Set([dscFile, ...checksums.map(file => file.fileName)]);
    assert.deepEqual(new Set(downloaded), expectedFiles, `${source.sourcePackage} source set is incomplete`);
    for (const expected of checksums) {
      const filePath = join(packageRoot, expected.fileName);
      assert.equal(statSync(filePath).size, expected.size, `${expected.fileName} size mismatch`);
      assert.equal(sha256(filePath), expected.sha256, `${expected.fileName} hash mismatch`);
    }
    const verificationRoot = join(packageRoot, '.verified-source');
    requireInside(packageRoot, verificationRoot);
    try {
      run('dpkg-source', ['--no-check', '-x', dscFile, verificationRoot], { cwd: packageRoot });
    } finally {
      rmSync(verificationRoot, { recursive: true, force: true });
    }
    artifacts.push({
      ...source,
      dscFile,
      files: downloaded.map(fileName => ({
        fileName,
        size: statSync(join(packageRoot, fileName)).size,
        sha256: sha256(join(packageRoot, fileName)),
      })),
    });
  }
  return artifacts;
}

export function verifyLinuxRuntimeManifest(runtimeRoot, { requireSource = false } = {}) {
  const manifestPath = join(runtimeRoot, MANIFEST_FILE);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.platform, 'linux');
  assert.ok(['x64', 'arm64'].includes(manifest.architecture));
  assert.ok(Array.isArray(manifest.runtimeLibraries) && manifest.runtimeLibraries.length >= 2);
  for (const library of manifest.runtimeLibraries) {
    assert.ok(LIBNL_RUNTIME_FILE.test(library.fileName));
    assert.equal(sha256(join(runtimeRoot, library.fileName)), library.sha256);
    for (const field of ['binaryPackage', 'version', 'architecture', 'sourcePackage', 'sourceVersion']) {
      assert.ok(typeof library[field] === 'string' && library[field].length > 0);
    }
  }
  assert.equal(manifest.sourceComplete, manifest.sourceArtifacts.length > 0);
  assert.deepEqual(
    new Set(manifest.runtimeLibraries.map(library => library.fileName)),
    new Set(readdirSync(runtimeRoot).filter(name => LIBNL_RUNTIME_FILE.test(name))),
    'Every packaged libnl runtime must have exactly one provenance record'
  );
  if (requireSource) assert.equal(manifest.sourceComplete, true, 'Linux release source is incomplete');
  const sourceKeys = new Set(manifest.sourceArtifacts.map(source => (
    `${source.sourcePackage}\u0000${source.sourceVersion}`
  )));
  if (requireSource) {
    for (const library of manifest.runtimeLibraries) {
      assert.ok(
        sourceKeys.has(`${library.sourcePackage}\u0000${library.sourceVersion}`),
        `${library.fileName} is missing its exact source package`
      );
    }
  }
  for (const source of manifest.sourceArtifacts) {
    const packageRoot = join(runtimeRoot, 'libnl-source', source.sourcePackage);
    requireInside(join(runtimeRoot, 'libnl-source'), packageRoot);
    const files = new Set(source.files.map(file => file.fileName));
    assert.ok(files.has(source.dscFile));
    for (const file of source.files) {
      const filePath = join(packageRoot, file.fileName);
      assert.equal(statSync(filePath).size, file.size);
      assert.equal(sha256(filePath), file.sha256);
    }
    const dscContents = readFileSync(join(packageRoot, source.dscFile), 'utf8');
    assert.equal(parseDscField(dscContents, 'Source'), source.sourcePackage);
    assert.equal(parseDscField(dscContents, 'Version'), source.sourceVersion);
    const checksums = parseDscChecksums(dscContents);
    assert.deepEqual(
      new Set(checksums.map(file => file.fileName)),
      new Set([...files].filter(file => file !== source.dscFile))
    );
  }
  return manifest;
}

function parseOptions(args) {
  const options = { withSource: false, verify: false, requireSource: false };
  for (const argument of args) {
    if (argument === '--with-source') options.withSource = true;
    else if (argument === '--verify') options.verify = true;
    else if (argument === '--require-source') options.requireSource = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  if (process.platform !== 'linux') throw new Error('Linux libnl provenance must be collected on Linux.');
  const options = parseOptions(process.argv.slice(2));
  const runtimeRoot = runtimeRootForArchitecture();
  if (options.verify) {
    verifyLinuxRuntimeManifest(runtimeRoot, { requireSource: options.requireSource });
    return;
  }
  assert.ok(existsSync(runtimeRoot), `Missing Linux OpenHome build: ${runtimeRoot}`);
  const runtimeLibraries = collectRuntimeLibraries(runtimeRoot);
  const sourceArtifacts = options.withSource
    ? collectSourceArtifacts(runtimeRoot, runtimeLibraries)
    : [];
  const manifest = {
    schemaVersion: 1,
    platform: 'linux',
    architecture: process.arch,
    sourceComplete: sourceArtifacts.length > 0,
    runtimeLibraries,
    sourceArtifacts,
  };
  writeFileSync(join(runtimeRoot, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  verifyLinuxRuntimeManifest(runtimeRoot, { requireSource: options.withSource });
}

export { LIBNL_RUNTIME_FILE, MANIFEST_FILE, ORIGINS_FILE, parseOptions };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
