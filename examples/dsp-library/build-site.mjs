import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildDemo, copyTree, fileManifest, validateBuildOutput } from './build.mjs';
import { expandPublicPath, routeMap } from './generate-docs.mjs';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '..', '..');
const schemaRoot = path.join(repoRoot, 'dsp', 'bindings', 'schema');
const generatedDocsRoot = path.join(repoRoot, 'docs', 'dsp');
const routes = JSON.parse(fs.readFileSync(path.join(
  sourceRoot, 'docs', 'routes-v0.1.json'
), 'utf8'));
const routesById = routeMap(routes);

function relativePublicPath(publicPath) {
  const pathname = publicPath.split('#')[0];
  if (!pathname.startsWith(routes.publicRoot)) {
    throw new Error(`Public path is outside ${routes.publicRoot}: ${publicPath}`);
  }
  return pathname.slice(routes.publicRoot.length);
}

function stagedPath(root, publicPath) {
  return path.join(root, ...relativePublicPath(publicPath).split('/').filter(Boolean));
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`${name} requires a path.`);
  }
  return path.resolve(process.cwd(), args[index + 1]);
}

function verifyRenderedSubtree(guidePath) {
  const resolvedGuide = path.resolve(guidePath);
  if (!fs.existsSync(resolvedGuide) || !fs.statSync(resolvedGuide).isFile()) {
    throw new Error(`Rendered DSP guide is missing: ${resolvedGuide}`);
  }
  const guideRoot = path.dirname(resolvedGuide);
  const guides = new Map([['index.html', fs.readFileSync(resolvedGuide)]]);
  for (const locale of routes.localizedOverviews.locales) {
    const publicPath = expandPublicPath(
      routes.localizedOverviews.path,
      { locale },
      `Localized overview path ${locale}`
    );
    const relative = relativePublicPath(publicPath);
    const localizedPath = path.join(guideRoot, relative, 'index.html');
    if (!fs.existsSync(localizedPath) || !fs.statSync(localizedPath).isFile()) {
      throw new Error(`Rendered DSP guide is missing: ${localizedPath}`);
    }
    guides.set(
      `${relative}index.html`,
      fs.readFileSync(localizedPath)
    );
  }
  const demoPath = routesById.get('demo').path;
  for (const [relativePath, guide] of guides) {
    const guideText = guide.toString('utf8').toLowerCase();
    if (!guideText.includes('<html') || !guideText.includes(demoPath)) {
      throw new Error(
        `Rendered DSP guide must be HTML and link to ${demoPath}: ${relativePath}`
      );
    }
  }
  return guideRoot;
}

function buildSite(guidePath, outputRoot) {
  const renderedRoot = verifyRenderedSubtree(guidePath);
  const resolvedOutput = validateBuildOutput(outputRoot, {
    repoOutputRoots: [path.join(repoRoot, '_site', 'dsp')]
  });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-dsp-snapshot-'));
  const snapshotRoot = path.join(temporaryRoot, 'dsp');
  try {
    copyTree(renderedRoot, snapshotRoot);
    const chainSchemaTarget = stagedPath(
      snapshotRoot,
      routesById.get('chain-schema').path
    );
    copyTree(schemaRoot, path.dirname(chainSchemaTarget));
    const catalogTarget = stagedPath(snapshotRoot, routesById.get('catalog').path);
    fs.mkdirSync(path.dirname(catalogTarget), { recursive: true });
    fs.copyFileSync(
      path.join(generatedDocsRoot, 'catalog', 'effects-v1.json'),
      catalogTarget
    );
    const llmsTarget = stagedPath(snapshotRoot, routesById.get('llms').path);
    fs.mkdirSync(path.dirname(llmsTarget), { recursive: true });
    fs.copyFileSync(
      path.join(generatedDocsRoot, 'llms.txt'),
      llmsTarget
    );
    buildDemo(stagedPath(snapshotRoot, routesById.get('demo').path));

    const files = fileManifest(
      snapshotRoot,
      snapshotRoot,
      new Set(['site-manifest.json'])
    );
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(files))
      .digest('hex');
    const manifest = {
      format: 'effetune-dsp-site-build-v1',
      publicPath: routes.publicRoot,
      sha256: digest,
      files
    };
    fs.writeFileSync(
      path.join(snapshotRoot, 'site-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    fs.rmSync(resolvedOutput, { recursive: true, force: true });
    copyTree(snapshotRoot, resolvedOutput);
    return manifest;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const guide = optionValue(args, '--guide');
  if (args.includes('--check')) {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-dsp-site-'));
    try {
      const first = buildSite(guide, path.join(temporaryRoot, 'first', 'dsp'));
      const second = buildSite(guide, path.join(temporaryRoot, 'second', 'dsp'));
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error('DSP site builds are not reproducible.');
      }
      console.log(
        `Verified ${first.files.length} reproducible ${routes.publicRoot} file(s): ${first.sha256}`
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } else {
    const output = optionValue(args, '--output');
    const manifest = buildSite(guide, output);
    console.log(
      `Built ${manifest.files.length} ${routes.publicRoot} file(s) in ${output}: ${manifest.sha256}`
    );
  }
}

export { buildSite };
