import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sourceDigestInputPaths } from '../../scripts/build-dsp-wasm.mjs';
import { openHomeSidecarBuildContract } from '../../scripts/build-openhome-sidecar.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A shipped file must never depend on a path that happens to exist on the
// developer's machine but would be absent from a clean checkout. Such a
// dependency leaves every local run green while every CI job fails, and because
// gitignored files appear in neither `git status` nor `git diff`, review cannot
// see it. This gate makes the whole class mechanically detectable.

const SCANNED_DIRECTORIES = ['scripts/', 'tools/', 'tests/esm/', 'tests/cjs/'];
const SCANNED_EXTENSIONS = ['.mjs', '.js', '.cjs'];
const SCANNED_FILES = ['dsp/CMakeLists.txt', 'package.json'];

// Referenced by name only as an artifact that must be ABSENT from shipped
// output: `tools/verify-dsp-package.mjs` asserts the packaged application does
// not contain it, and `tests/esm/service-worker.test.mjs` asserts the precache
// manifest omits it (writing it into a temporary fixture root, not the repo).
// It is declared ignored by the tracked `plugins/dsp/.gitignore`, is produced
// only by a local debug build, and is never read as an input.
const ABSENCE_ONLY_REFERENCES = new Set([
  'plugins/dsp/effetune-dsp.debug.wasm'
]);

// Path-like string literals. The alternations are unambiguous, so these cannot
// backtrack catastrophically on the large sources in the scan set.
const STRING_LITERAL_PATTERNS = [
  /'((?:[^'\\\n]|\\.)*)'/g,
  /"((?:[^"\\\n]|\\.)*)"/g,
  /`((?:[^`\\$\n]|\\.)*)`/g
];
const CMAKE_SOURCE_DIRECTORY_PATTERN =
  /\$\{CMAKE_CURRENT_SOURCE_DIR\}\/[^\s"'();$]+/g;
const CMAKE_SOURCE_DIRECTORY_TOKEN = '${CMAKE_CURRENT_SOURCE_DIR}';
const NAMED_EXTENSION_PATTERN = /\/[^/]*\.[A-Za-z0-9_+-]{1,10}$/;
const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:\//;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

function gitFiles(args) {
  const result = spawnSync('git', ['ls-files', '-z', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(result.status, 0, `git ls-files failed: ${result.stderr}`);
  return new Set(result.stdout.split('\0').filter(Boolean));
}

function gitTrackedFiles() {
  return gitFiles([]);
}

// Pre-commit verification runs before staging. Include non-ignored additions so
// a new tracked source can satisfy another new reference while both remain
// visible to review; ignored build products remain excluded.
function gitReviewableFiles() {
  return gitFiles(['--cached', '--others', '--exclude-standard']);
}

function scannedSources(tracked) {
  return [...tracked]
    .filter(file =>
      SCANNED_FILES.includes(file) ||
      (SCANNED_DIRECTORIES.some(directory => file.startsWith(directory)) &&
        SCANNED_EXTENSIONS.some(extension => file.endsWith(extension))))
    .sort();
}

export function rawReferences(relativeFile, source) {
  const raw = [];
  if (relativeFile.endsWith('CMakeLists.txt') || relativeFile.endsWith('.cmake')) {
    for (const match of source.matchAll(CMAKE_SOURCE_DIRECTORY_PATTERN)) {
      raw.push(match[0]);
    }
    for (const match of source.matchAll(STRING_LITERAL_PATTERNS[1])) {
      raw.push(match[1]);
    }
    return raw;
  }
  for (const pattern of STRING_LITERAL_PATTERNS) {
    for (const match of source.matchAll(pattern)) raw.push(match[1]);
  }
  return raw;
}

// Returns the repository-relative path a reference denotes, or null when the
// reference is not a usable repository path (a glob, a template, a URL, an
// absolute or out-of-tree location, or a bare name without a directory).
export function resolveReference(relativeFile, rawValue) {
  const normalized = rawValue
    .replaceAll('\\', '/')
    .replaceAll(CMAKE_SOURCE_DIRECTORY_TOKEN, path.posix.dirname(relativeFile))
    .replace(/\/{2,}/gu, '/');
  if (normalized.includes('${') || normalized.includes('*') ||
    normalized.includes('?')) {
    return null;
  }
  if (!normalized.includes('/')) return null;
  if (!NAMED_EXTENSION_PATTERN.test(normalized)) return null;
  if (normalized.startsWith('/') || WINDOWS_ROOT_PATTERN.test(normalized)) {
    return null;
  }
  if (URL_SCHEME_PATTERN.test(normalized)) return null;
  const base = normalized.startsWith('.')
    ? path.posix.dirname(relativeFile)
    : '.';
  const resolved = path.posix.normalize(path.posix.join(base, normalized));
  if (resolved.startsWith('..') || resolved.startsWith('/')) return null;
  return resolved;
}

export function findUntrackedReferences({
  files, readSource, fileExists, isTracked, isGeneratedOutput = () => false
}) {
  const violations = [];
  for (const file of files) {
    const seen = new Set();
    for (const raw of rawReferences(file, readSource(file))) {
      const resolved = resolveReference(file, raw);
      if (resolved === null || seen.has(resolved)) continue;
      seen.add(resolved);
      if (ABSENCE_ONLY_REFERENCES.has(resolved)) continue;
      if (!fileExists(resolved)) continue;
      if (isTracked(resolved)) continue;
      if (isGeneratedOutput(file, resolved)) continue;
      violations.push(`${file} -> ${resolved}`);
    }
  }
  return violations.sort();
}

function existingRepositoryFile(relativePath) {
  const absolute = path.join(repoRoot, ...relativePath.split('/'));
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function isOpenHomeGeneratedPackageReference(file, candidate) {
  return candidate === openHomeSidecarBuildContract.output &&
    (file === 'package.json' || file === openHomeSidecarBuildContract.producer);
}

test('review-visible scripts, tools, and tests reference no hidden repository file', () => {
  const tracked = gitTrackedFiles();
  const reviewable = gitReviewableFiles();
  const files = scannedSources(reviewable);
  assert.ok(files.length > 100, `scan set unexpectedly small: ${files.length}`);
  assert.ok(files.includes('dsp/CMakeLists.txt'));
  assert.ok(files.includes('package.json'));

  const violations = findUntrackedReferences({
    files,
    readSource: file => fs.readFileSync(path.join(repoRoot, file), 'utf8'),
    fileExists: existingRepositoryFile,
    isTracked: candidate => reviewable.has(candidate),
    isGeneratedOutput: isOpenHomeGeneratedPackageReference
  });
  assert.deepEqual(
    violations,
    [],
    'shipped files must not depend on paths missing from a clean checkout:\n' +
      violations.map(violation => `  ${violation}`).join('\n')
  );

  for (const reference of ABSENCE_ONLY_REFERENCES) {
    assert.equal(
      tracked.has(reference),
      false,
      `${reference} is now tracked; drop it from ABSENCE_ONLY_REFERENCES`
    );
  }
});

test('the OpenHome package input is produced from review-visible sources before packaging', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const tracked = gitTrackedFiles();
  const reviewable = gitReviewableFiles();
  const contract = openHomeSidecarBuildContract;

  assert.equal(tracked.has(contract.output), false, 'generated sidecar must not be tracked');
  assert.equal(reviewable.has(contract.output), false, 'generated sidecar must remain ignored');
  for (const input of [contract.producer, ...contract.inputs]) {
    assert.equal(
      reviewable.has(input),
      true,
      `OpenHome sidecar build input must be visible for review: ${input}`
    );
  }

  assert.equal(
    packageJson.scripts['build:openhome-sidecar'],
    `node ${contract.producer}`,
    'the package producer must invoke the canonical sidecar build script'
  );
  const resources = packageJson.build?.win?.extraResources ?? [];
  assert.equal(
    resources.filter(resource => resource.from === contract.output).length,
    1,
    'the Windows package must contain exactly one canonical sidecar output'
  );
  for (const resource of resources) {
    if (resource.from === contract.output) continue;
    assert.equal(
      reviewable.has(resource.from),
      true,
      `non-generated package resource must be visible for review: ${resource.from}`
    );
  }

  const windowsPackageScripts = ['build', 'build:portable', 'build:installer', 'pack:win'];
  for (const scriptName of windowsPackageScripts) {
    const command = packageJson.scripts[scriptName];
    const producerIndex = command.indexOf('npm run build:openhome-sidecar');
    const builderIndex = command.indexOf('electron-builder');
    assert.ok(
      producerIndex >= 0 && builderIndex > producerIndex,
      `${scriptName} must build the sidecar before electron-builder`
    );
  }
});

test('the generated-output exemption is limited to its package and producer', () => {
  const generated = openHomeSidecarBuildContract.output;
  const sources = new Map([
    ['package.json', `{"from":"${generated}"}`],
    [openHomeSidecarBuildContract.producer, `const output = '${generated}';`],
    ['tools/unrelated.mjs', `const hiddenInput = '${generated}';`]
  ]);

  const violations = findUntrackedReferences({
    files: [...sources.keys()],
    readSource: file => sources.get(file),
    fileExists: candidate => candidate === generated,
    isTracked: () => false,
    isGeneratedOutput: isOpenHomeGeneratedPackageReference
  });

  assert.deepEqual(violations, [`tools/unrelated.mjs -> ${generated}`]);
});

test('the DSP wasm source digest reads only tracked repository files', () => {
  const tracked = gitTrackedFiles();
  const inputs = sourceDigestInputPaths();
  assert.ok(inputs.length > 0);
  const untracked = inputs.filter(input => !tracked.has(input));
  assert.deepEqual(
    untracked,
    [],
    `build:dsp --check would fail on a clean checkout:\n${untracked.join('\n')}`
  );
});

test('the reference scan flags an existing repository file that git does not track', () => {
  const sources = new Map([
    ['tools/example.mjs', [
      "import helper from '../tests/tools/local-only.mjs';",
      "const tracked = 'tests/esm/app.test.mjs';",
      "const glob = 'tests/esm/*.test.mjs';",
      "const missing = 'tests/tools/never-existed.mjs';",
      'export { helper, tracked, glob, missing };'
    ].join('\n')],
    ['dsp/CMakeLists.txt', [
      'add_custom_target(demo COMMAND node ' +
        '${CMAKE_CURRENT_SOURCE_DIR}/../tests/tools/local-only.mjs)'
    ].join('\n')]
  ]);
  const present = new Set([
    'tests/tools/local-only.mjs',
    'tests/esm/app.test.mjs'
  ]);
  const tracked = new Set(['tests/esm/app.test.mjs']);

  const violations = findUntrackedReferences({
    files: [...sources.keys()],
    readSource: file => sources.get(file),
    fileExists: candidate => present.has(candidate),
    isTracked: candidate => tracked.has(candidate)
  });

  assert.deepEqual(violations, [
    'dsp/CMakeLists.txt -> tests/tools/local-only.mjs',
    'tools/example.mjs -> tests/tools/local-only.mjs'
  ]);
});
