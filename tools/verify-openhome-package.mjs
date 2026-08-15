import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const TRACKED_NOTICE_PATH = path.join(
  repositoryRoot,
  'native',
  'openhome-sidecar',
  'THIRD_PARTY_NOTICES.txt'
);
const TRACKED_LIBNL_LICENSE_PATH = path.join(
  repositoryRoot,
  'native',
  'openhome-sidecar',
  'licenses',
  'libnl-LGPL-2.1.txt'
);
const OPENHOME_RESOURCE_DIRECTORY = 'openhome';
const SIDECAR_BASENAME = 'effetune-openhome-sidecar';
const NOTICE_FILE = 'THIRD_PARTY_NOTICES.txt';
const LIBNL_LICENSE_FILE = 'libnl-LGPL-2.1.txt';
const LIBNL_MANIFEST_FILE = 'libnl-runtime-manifest.json';
const UNPACKED_DIRECTORY = /^(?:(win|linux)(?:-(?:x64|ia32|arm64))?-unpacked|(mac)(?:-(?:x64|arm64))?)$/i;
const EXECUTABLE_MAGIC = Object.freeze({
  win: [Buffer.from('MZ')],
  linux: [Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
  mac: [
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  ],
});
const USAGE = 'Usage: node tools/verify-openhome-package.mjs [dist-directory]';
const LIBNL_RUNTIME_FILE = /^libnl(?:-genl)?-3\.so(?:\..+)?$/;

function requireRealDirectory(candidatePath, description) {
  const stats = fs.lstatSync(candidatePath);
  assert.ok(!stats.isSymbolicLink(), `${description} must not be a symbolic link: ${candidatePath}`);
  assert.ok(stats.isDirectory(), `${description} must be a directory: ${candidatePath}`);
}

function findUnpackedResources(root) {
  const absoluteRoot = path.resolve(root);
  requireRealDirectory(absoluteRoot, 'Package root');
  const canonicalRoot = fs.realpathSync.native(absoluteRoot);
  const resources = [];

  for (const entry of fs.readdirSync(canonicalRoot, { withFileTypes: true })) {
    const match = entry.name.match(UNPACKED_DIRECTORY);
    if (!match) continue;
    const platform = (match[1] || match[2]).toLowerCase();
    const unpackedPath = path.join(canonicalRoot, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Unpacked directory must not be a symbolic link: ${unpackedPath}`);
    assert.ok(entry.isDirectory(), `Unpacked path must be a directory: ${unpackedPath}`);
    let resourcesPath = path.join(unpackedPath, 'resources');
    if (platform === 'mac') {
      const applications = fs.readdirSync(unpackedPath, { withFileTypes: true })
        .filter(candidate => candidate.isDirectory() && candidate.name.endsWith('.app'));
      assert.equal(applications.length, 1, `${unpackedPath} must contain exactly one application bundle`);
      resourcesPath = path.join(unpackedPath, applications[0].name, 'Contents', 'Resources');
    }
    if (!fs.existsSync(resourcesPath)) continue;
    requireRealDirectory(resourcesPath, 'Unpacked resources path');
    resources.push({ platform, resourcesPath });
  }

  return resources.sort((left, right) => left.resourcesPath.localeCompare(right.resourcesPath));
}

function readFileWithoutLinks(filePath, description) {
  const stats = fs.lstatSync(filePath);
  assert.ok(!stats.isSymbolicLink(), `${description} must not be a symbolic link: ${filePath}`);
  assert.ok(stats.isFile(), `${description} must be a regular file: ${filePath}`);
  return fs.readFileSync(filePath);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function verifyLinuxLoader(executablePath, openHomePath) {
  const readelf = spawnSync('readelf', ['-d', executablePath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(readelf.status, 0, `readelf failed for ${executablePath}: ${readelf.stderr}`);
  assert.match(
    readelf.stdout,
    /(?:RPATH|RUNPATH).*\[\$ORIGIN\]/,
    `${executablePath} must load adjacent runtime libraries through $ORIGIN`
  );

  const ldd = spawnSync('ldd', [executablePath], { encoding: 'utf8', windowsHide: true });
  assert.equal(ldd.status, 0, `ldd failed for ${executablePath}: ${ldd.stderr}`);
  const dependencies = new Map();
  for (const line of ldd.stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=>');
    if (separator < 0) continue;
    const soname = line.slice(0, separator).trim();
    if (!LIBNL_RUNTIME_FILE.test(soname)) continue;
    const resolution = line.slice(separator + 2).trimStart();
    let pathEnd = 0;
    while (pathEnd < resolution.length && resolution[pathEnd] !== ' ' &&
           resolution[pathEnd] !== '\t') {
      pathEnd += 1;
    }
    if (pathEnd > 0) dependencies.set(soname, resolution.slice(0, pathEnd));
  }
  assert.ok(
    [...dependencies].some(([name]) => name.startsWith('libnl-3.so.')),
    `${executablePath} must resolve libnl`
  );
  assert.ok(
    [...dependencies].some(([name]) => name.startsWith('libnl-genl-3.so.')),
    `${executablePath} must resolve libnl-genl`
  );
  const canonicalOpenHomePath = fs.realpathSync.native(openHomePath);
  for (const [name, resolvedPath] of dependencies) {
    assert.notEqual(resolvedPath, 'not', `${name} was not found by the Linux loader`);
    assert.equal(
      fs.realpathSync.native(path.dirname(resolvedPath)),
      canonicalOpenHomePath,
      `${name} must resolve beside the packaged OpenHome sidecar`
    );
  }
}

function verifyOpenHomeResources(
  platform,
  resourcesPath,
  trackedNotice,
  trackedLibnlLicense,
  verifyLoader
) {
  const openHomePath = path.join(resourcesPath, OPENHOME_RESOURCE_DIRECTORY);
  requireRealDirectory(openHomePath, 'Packaged OpenHome resource directory');

  const executablePath = path.join(
    openHomePath,
    platform === 'win' ? `${SIDECAR_BASENAME}.exe` : SIDECAR_BASENAME
  );
  const executable = readFileWithoutLinks(executablePath, 'Packaged OpenHome sidecar');
  const signatures = EXECUTABLE_MAGIC[platform];
  assert.ok(
    executable.length > 4 && signatures.some(signature => executable.subarray(0, signature.length).equals(signature)),
    `${executablePath} does not have a valid ${platform} executable header`
  );

  const noticePath = path.join(openHomePath, NOTICE_FILE);
  const notice = readFileWithoutLinks(noticePath, 'Packaged OpenHome third-party notice');
  assert.ok(notice.length > 0, `${noticePath} must not be empty`);
  assert.deepEqual(notice, trackedNotice, `${noticePath} does not match the tracked third-party notice`);

  if (platform === 'linux') {
    const libnlLicensePath = path.join(openHomePath, LIBNL_LICENSE_FILE);
    const libnlLicense = readFileWithoutLinks(libnlLicensePath, 'Packaged libnl license');
    assert.deepEqual(
      libnlLicense,
      trackedLibnlLicense,
      `${libnlLicensePath} does not match the tracked libnl license`
    );
    const runtimeFiles = fs.readdirSync(openHomePath).filter(name => LIBNL_RUNTIME_FILE.test(name));
    assert.ok(
      runtimeFiles.some(name => name.startsWith('libnl-3.so.')),
      `${openHomePath} must contain the loader-resolved libnl runtime library`
    );
    assert.ok(
      runtimeFiles.some(name => name.startsWith('libnl-genl-3.so.')),
      `${openHomePath} must contain the loader-resolved libnl-genl runtime library`
    );
    for (const name of runtimeFiles) {
      readFileWithoutLinks(path.join(openHomePath, name), 'Packaged libnl runtime library');
    }
    const manifestPath = path.join(openHomePath, LIBNL_MANIFEST_FILE);
    const manifest = JSON.parse(
      readFileWithoutLinks(manifestPath, 'Packaged libnl provenance manifest').toString('utf8')
    );
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.platform, 'linux');
    assert.ok(Array.isArray(manifest.runtimeLibraries) && manifest.runtimeLibraries.length >= 2);
    assert.equal(manifest.sourceComplete, manifest.sourceArtifacts?.length > 0);
    assert.deepEqual(
      new Set(manifest.runtimeLibraries.map(library => library.fileName)),
      new Set(runtimeFiles),
      'Packaged libnl runtime files must exactly match the provenance manifest'
    );
    for (const library of manifest.runtimeLibraries) {
      assert.ok(runtimeFiles.includes(library.fileName));
      const packagedLibrary = readFileWithoutLinks(
        path.join(openHomePath, library.fileName),
        'Manifest-listed libnl runtime library'
      );
      assert.equal(sha256(packagedLibrary), library.sha256);
      for (const field of ['binaryPackage', 'version', 'architecture', 'sourcePackage', 'sourceVersion']) {
        assert.ok(typeof library[field] === 'string' && library[field].length > 0);
      }
    }
    if (verifyLoader) verifyLinuxLoader(executablePath, openHomePath);
  }

  return { resourcesPath, executablePath, noticePath };
}

function verifyPackagedOpenHome(root, { verifyLinuxLoader = false } = {}) {
  const trackedNotice = readFileWithoutLinks(TRACKED_NOTICE_PATH, 'Tracked OpenHome third-party notice');
  const trackedLibnlLicense = readFileWithoutLinks(
    TRACKED_LIBNL_LICENSE_PATH,
    'Tracked libnl license'
  );
  const resources = findUnpackedResources(root);
  assert.ok(
    resources.length > 0,
    `No supported unpacked resources directory was found directly under ${path.resolve(root)}`
  );
  return resources.map(({ platform, resourcesPath }) =>
    verifyOpenHomeResources(
      platform,
      resourcesPath,
      trackedNotice,
      trackedLibnlLicense,
      verifyLinuxLoader && process.platform === 'linux'
    ));
}

function parseTarget(args) {
  assert.ok(args.length <= 1, USAGE);
  return path.resolve(args[0] || 'dist');
}

export {
  NOTICE_FILE,
  LIBNL_LICENSE_FILE,
  LIBNL_MANIFEST_FILE,
  OPENHOME_RESOURCE_DIRECTORY,
  EXECUTABLE_MAGIC,
  SIDECAR_BASENAME,
  TRACKED_NOTICE_PATH,
  TRACKED_LIBNL_LICENSE_PATH,
  findUnpackedResources,
  parseTarget,
  verifyPackagedOpenHome
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const target = parseTarget(process.argv.slice(2));
    const results = verifyPackagedOpenHome(target, { verifyLinuxLoader: true });
    console.log(`Verified OpenHome resources in ${results.length} unpacked package(s) under ${target}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
