import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { demoManifestFormat, demoSourceFiles } from './build.mjs';
import { expandPublicPath, routeMap } from './generate-docs.mjs';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '..', '..');
const schemaRoot = path.join(repoRoot, 'dsp', 'bindings', 'schema');
const canonicalOrigin = 'https://effetune.frieve.com';
const routes = JSON.parse(fs.readFileSync(path.join(
  sourceRoot, 'docs', 'routes-v0.1.json'
), 'utf8'));
const routesById = routeMap(routes);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function requireText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label} is missing ${JSON.stringify(expected)}.`);
  }
}

function verifyGuide(relativePath, permalink) {
  const guide = read(relativePath);
  requireText(guide, `permalink: ${permalink}`, relativePath);
  requireText(guide, `](${routesById.get('demo').path})`, relativePath);
  requireText(
    guide,
    `](${routesById.get('chain-schema').path})`,
    relativePath
  );
  requireText(
    guide,
    `](${routesById.get('bundle-schema').path})`,
    relativePath
  );
  if (guide.includes('examples/dsp-library')) {
    throw new Error(
      `${relativePath} links to the source tree instead of ${routes.publicRoot}.`
    );
  }
}

const landing = routesById.get('landing');
verifyGuide(landing.output, landing.path);
for (const locale of routes.localizedOverviews.locales) {
  verifyGuide(
    routes.localizedOverviews.output.replace('{locale}', locale),
    expandPublicPath(
      routes.localizedOverviews.path,
      { locale },
      `Localized overview path ${locale}`
    )
  );
}

const englishGuide = read(landing.output);
for (const identity of [
  '`effetune`',
  '`@effetune/dsp`',
  `${canonicalOrigin}${routes.publicRoot}`,
  'https://github.com/Frieve-A/effetune'
]) {
  requireText(englishGuide, identity, landing.output);
}

const chainSchema = JSON.parse(
  fs.readFileSync(path.join(schemaRoot, 'chain-v1.schema.json'), 'utf8')
);
const bundleSchema = JSON.parse(
  fs.readFileSync(path.join(schemaRoot, 'bundle-v1.schema.json'), 'utf8')
);
if (
  chainSchema.$id !== `${canonicalOrigin}${routesById.get('chain-schema').path}` ||
  bundleSchema.$id !== `${canonicalOrigin}${routesById.get('bundle-schema').path}` ||
  bundleSchema.properties?.chain?.$ref !== chainSchema.$id
) {
  throw new Error('DSP schema public IDs do not match their manifest routes.');
}
if (
  chainSchema.properties?.version?.const !== 1 ||
  bundleSchema.properties?.version?.const !== 1
) {
  throw new Error('DSP schemas must describe version 1 documents.');
}

const npmPackage = JSON.parse(read('dsp/bindings/js/package.json'));
const pythonProject = read('dsp/bindings/python/pyproject.toml');
const pythonName = pythonProject.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
const pythonVersion = pythonProject.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
if (
  npmPackage.name !== '@effetune/dsp' ||
  pythonName !== 'effetune' ||
  npmPackage.version !== pythonVersion ||
  npmPackage.homepage !== `${canonicalOrigin}${routes.publicRoot}`
) {
  throw new Error('DSP package identities, versions, or documentation URL drifted.');
}

if (
  demoManifestFormat !== 'effetune-dsp-demo-build-v1' ||
  JSON.stringify(demoSourceFiles) !==
    JSON.stringify(['index.html', 'app.js', 'styles.css'])
) {
  throw new Error('DSP demo manifest contract drifted.');
}
for (const file of demoSourceFiles) {
  if (!fs.statSync(path.join(sourceRoot, file)).isFile()) {
    throw new Error(`DSP demo input is missing: ${file}`);
  }
}
const demoHtml = read('examples/dsp-library/index.html');
const demoApp = read('examples/dsp-library/app.js');
const demoCanonical =
  `<link rel="canonical" href="${canonicalOrigin}${routesById.get('demo').path}">`;
requireText(demoHtml, 'href="./styles.css"', 'examples/dsp-library/index.html');
requireText(demoHtml, 'src="./app.js"', 'examples/dsp-library/index.html');
requireText(demoHtml, demoCanonical, 'examples/dsp-library/index.html');
requireText(
  demoApp,
  "from './vendor/@effetune/dsp/worklet.js'",
  'examples/dsp-library/app.js'
);
for (const file of demoSourceFiles) {
  const source = read(`examples/dsp-library/${file}`)
    .replace(demoCanonical, '');
  if (
    /https?:\/\//i.test(source) ||
    /(?:href|src)\s*=\s*["']\/\//i.test(source) ||
    /(?:from|import)\s*["']\/\//i.test(source)
  ) {
    throw new Error(`DSP demo input uses an external URL: ${file}`);
  }
}

console.log(
  'Verified DSP package identities, localized overview routes, schemas, and static demo inputs.'
);
