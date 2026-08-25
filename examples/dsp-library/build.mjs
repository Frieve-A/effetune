import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '..', '..');
const packageRoot = path.join(repoRoot, 'dsp', 'bindings', 'js');
const packageDist = path.join(packageRoot, 'dist');
const schemaRoot = path.join(repoRoot, 'dsp', 'bindings', 'schema');
const demoOutputRoot = path.join(repoRoot, 'out', 'examples', 'dsp-library');
const siteOutputRoot = path.join(repoRoot, '_site', 'dsp');
const demoManifestFormat = 'effetune-dsp-demo-build-v1';
const demoSourceFiles = Object.freeze(['index.html', 'app.js', 'styles.css']);

function canonicalPath(value) {
  const resolved = path.resolve(value);
  let existing = resolved;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.push(path.basename(existing));
    existing = parent;
  }
  const canonical = fs.realpathSync.native(existing);
  return path.resolve(canonical, ...suffix.reverse());
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function validateBuildOutput(outputRoot, { repoOutputRoots = [] } = {}) {
  const output = canonicalPath(outputRoot);
  if (fs.existsSync(output) && !fs.statSync(output).isDirectory()) {
    throw new Error(`Refusing non-directory DSP build output: ${output}`);
  }
  const repository = canonicalPath(repoRoot);
  const temporary = canonicalPath(os.tmpdir());
  const protectedPaths = [
    path.parse(output).root,
    repository,
    canonicalPath(sourceRoot),
    canonicalPath(schemaRoot),
    canonicalPath(packageRoot),
    canonicalPath(packageDist)
  ];
  if (protectedPaths.includes(output)) {
    throw new Error(`Refusing unsafe DSP build output directory: ${output}`);
  }
  if (containsPath(repository, output)) {
    const allowed = repoOutputRoots.map(canonicalPath);
    if (!allowed.some(root => containsPath(root, output))) {
      throw new Error(`Refusing unowned repository DSP build output directory: ${output}`);
    }
  } else if (output === temporary || !containsPath(temporary, output)) {
    throw new Error(`DSP build output outside the repository must be under the OS temp directory: ${output}`);
  }
  return output;
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function fileManifest(root, directory = root, excludedPaths = new Set()) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...fileManifest(root, entryPath, excludedPaths));
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, entryPath).replaceAll('\\', '/');
      if (excludedPaths.has(relativePath)) continue;
      const bytes = fs.readFileSync(entryPath);
      entries.push({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex')
      });
    }
  }
  return entries;
}

function buildDemo(outputRoot) {
  const resolvedOutput = validateBuildOutput(outputRoot, {
    repoOutputRoots: [demoOutputRoot, path.join(siteOutputRoot, 'demo')]
  });
  if (!fs.existsSync(path.join(packageDist, 'worklet.js'))) {
    throw new Error('Build @effetune/dsp before building the demo.');
  }
  fs.rmSync(resolvedOutput, { recursive: true, force: true });
  fs.mkdirSync(resolvedOutput, { recursive: true });
  for (const file of demoSourceFiles) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(resolvedOutput, file));
  }
  copyTree(packageDist, path.join(resolvedOutput, 'vendor', '@effetune', 'dsp'));
  const manifest = {
    format: demoManifestFormat,
    files: fileManifest(resolvedOutput, resolvedOutput, new Set(['build-manifest.json']))
  };
  fs.writeFileSync(
    path.join(resolvedOutput, 'build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return manifest;
}

function parseOutput(args) {
  const index = args.indexOf('--output');
  if (index === -1) return demoOutputRoot;
  if (!args[index + 1]) throw new Error('--output requires a directory.');
  return path.resolve(process.cwd(), args[index + 1]);
}

const args = process.argv.slice(2);
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (args.includes('--check')) {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-dsp-demo-'));
    try {
      const first = buildDemo(path.join(temporaryRoot, 'first'));
      const second = buildDemo(path.join(temporaryRoot, 'second'));
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error('Demo builds are not reproducible.');
      }
      console.log(`Verified ${first.files.length} reproducible demo file(s).`);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } else {
    const output = parseOutput(args);
    const manifest = buildDemo(output);
    console.log(`Built ${manifest.files.length} demo file(s) in ${output}.`);
  }
}

export {
  buildDemo,
  copyTree,
  demoManifestFormat,
  demoSourceFiles,
  fileManifest,
  validateBuildOutput
};
