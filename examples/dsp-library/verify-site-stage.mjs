import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { expandPublicPath, routeMap } from './generate-docs.mjs';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '..', '..');
const routeManifestPath = path.join(
  sourceRoot, 'docs', 'routes-v0.1.json'
);
const catalogPath = path.join(
  repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.json'
);
const docsOverlayPath = path.join(
  sourceRoot, 'docs', 'effects-v1.docs.json'
);
const npmPackagePath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'package.json'
);
const canonicalOrigin = 'https://effetune.frieve.com';
const docsFields = ['displayName', 'category', 'summary', 'sourceGenerating', 'slug'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugForType(type) {
  return type
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function routeFile(stageRoot, routePath, publicRoot) {
  const pathname = routePath.split('#')[0];
  if (!pathname.startsWith(publicRoot)) {
    throw new Error(`Public route is outside ${publicRoot}: ${routePath}`);
  }
  const withoutRoot = pathname.slice(publicRoot.length);
  if (!withoutRoot) return path.join(stageRoot, 'index.html');
  if (pathname.endsWith('/')) return path.join(stageRoot, withoutRoot, 'index.html');
  return path.join(stageRoot, withoutRoot);
}

function routeHrefTarget(stageRoot, href, publicRoot) {
  const [pathname, anchor = ''] = href.split('#');
  const target = pathname || publicRoot;
  return { filePath: routeFile(stageRoot, target, publicRoot), anchor };
}

function verifyAnchor(filePath, anchor, source) {
  if (!anchor) return;
  const html = fs.readFileSync(filePath, 'utf8');
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\bid=["']${escaped}["']`).test(html)) {
    throw new Error(`${source} links to missing anchor #${anchor}.`);
  }
}

function verifyManifest(stageRoot, publicRoot) {
  const manifestPath = path.join(stageRoot, 'site-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('site-manifest.json is missing from the staged DSP subtree.');
  }
  const manifest = readJson(manifestPath);
  if (manifest.format !== 'effetune-dsp-site-build-v1' ||
      manifest.publicPath !== publicRoot ||
      !Array.isArray(manifest.files)) {
    throw new Error('The staged DSP site manifest has an invalid contract.');
  }
  const listed = new Set();
  for (const entry of manifest.files) {
    if (listed.has(entry.path) || path.isAbsolute(entry.path) ||
        entry.path.split('/').includes('..')) {
      throw new Error(`The staged manifest has an unsafe or duplicate path: ${entry.path}`);
    }
    listed.add(entry.path);
    const filePath = path.join(stageRoot, entry.path);
    if (!fs.existsSync(filePath)) {
      throw new Error(`The staged manifest references a missing file: ${entry.path}`);
    }
    const bytes = fs.readFileSync(filePath);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== entry.bytes || digest !== entry.sha256) {
      throw new Error(`The staged manifest digest is stale for ${entry.path}.`);
    }
  }
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(manifest.files))
    .digest('hex');
  if (digest !== manifest.sha256) {
    throw new Error('The staged DSP site manifest aggregate digest is stale.');
  }
  const diskFiles = listFiles(stageRoot)
    .map(filePath => path.relative(stageRoot, filePath).replaceAll('\\', '/'))
    .filter(relative => relative !== 'site-manifest.json');
  const missing = diskFiles.filter(relative => !listed.has(relative));
  if (missing.length) {
    throw new Error(`Files were added after staging: ${missing.join(', ')}`);
  }
}

function listFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function expectedPublicCatalog(catalog, overlay) {
  return {
    ...catalog,
    effects: catalog.effects.map(effect => {
      const docs = overlay.effects[effect.type];
      const overlap = docsFields.filter(field => Object.hasOwn(effect, field));
      if (overlap.length) {
        throw new Error(`Docs overlay collides with binding data for ${effect.type}.`);
      }
      return {
        ...effect,
        displayName: docs.displayName,
        category: docs.category,
        summary: docs.summary,
        sourceGenerating: docs.sourceGenerating,
        ...(docs.slug ? { slug: docs.slug } : {})
      };
    })
  };
}

export function verifyStage(stageRoot) {
  const resolvedStage = path.resolve(stageRoot);
  const routes = readJson(routeManifestPath);
  const catalog = readJson(catalogPath);
  const overlay = readJson(docsOverlayPath);
  const version = readJson(npmPackagePath).version;
  const routesById = routeMap(routes);
  const expectedRoutes = routes.routes.filter(route => route.status === 'launch');
  const dynamic = expectedRoutes.find(route => route.dynamic === 'catalog-effects');
  const expanded = expectedRoutes.filter(route => !route.dynamic);
  for (const effect of catalog.effects) {
    const entry = overlay.effects[effect.type];
    expanded.push({
      ...dynamic,
      id: `effect-${effect.type}`,
      path: expandPublicPath(
        dynamic.path,
        { 'effect-slug': entry.slug ?? slugForType(effect.type) },
        `Effect route ${effect.type}`
      )
    });
  }
  for (const locale of routes.localizedOverviews.locales) {
    expanded.push({
      id: `locale-${locale}`,
      path: expandPublicPath(
        routes.localizedOverviews.path,
        { locale },
        `Localized overview path ${locale}`
      ),
      anchors: [],
      installSurfaces: []
    });
  }
  for (const route of expanded) {
    const filePath = routeFile(resolvedStage, route.path, routes.publicRoot);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Launch route is missing from the staged site: ${route.path}`);
    }
    if (route.raw) {
      if (route.path.endsWith('.json')) readJson(filePath);
      continue;
    }
    const html = fs.readFileSync(filePath, 'utf8');
    if (!/<html\b/i.test(html)) {
      throw new Error(`Launch route is not rendered HTML: ${route.path}`);
    }
    const canonical = `${canonicalOrigin}${route.path.split('#')[0]}`;
    if (!html.includes(`<link rel="canonical" href="${canonical}">`)) {
      throw new Error(`Canonical URL is missing or incorrect on ${route.path}.`);
    }
    if (/<title>\s*(?:404|page not found)\b/i.test(html) ||
        /\b404\s*[-—:]\s*page not found\b/i.test(html)) {
      throw new Error(`A launch route rendered a 404 page: ${route.path}.`);
    }
    for (const anchor of route.anchors ?? []) {
      verifyAnchor(filePath, anchor, route.path);
    }
    for (const surface of route.installSurfaces ?? []) {
      const command = surface === 'python' ? 'pip install effetune' : 'npm install @effetune/dsp';
      if (!html.includes(command)) {
        throw new Error(`The ${surface} install command is missing from ${route.path}.`);
      }
    }
  }
  for (const route of routes.routes.filter(entry => entry.status === 'merged')) {
    const [, anchor] = route.path.split('#');
    verifyAnchor(
      routeFile(resolvedStage, route.path, routes.publicRoot),
      anchor,
      route.path
    );
  }

  const chainRoute = routesById.get('chain-schema');
  const bundleRoute = routesById.get('bundle-schema');
  const chainSchema = readJson(routeFile(
    resolvedStage,
    chainRoute.path,
    routes.publicRoot
  ));
  const bundleSchema = readJson(routeFile(
    resolvedStage,
    bundleRoute.path,
    routes.publicRoot
  ));
  if (chainSchema.$id !== `${canonicalOrigin}${chainRoute.path}` ||
      bundleSchema.$id !== `${canonicalOrigin}${bundleRoute.path}` ||
      bundleSchema.properties?.chain?.$ref !== chainSchema.$id) {
    throw new Error('The staged schema IDs or Bundle-to-Chain reference are invalid.');
  }
  const stagedCatalog = readJson(routeFile(
    resolvedStage,
    routesById.get('catalog').path,
    routes.publicRoot
  ));
  if (JSON.stringify(stagedCatalog) !==
      JSON.stringify(expectedPublicCatalog(catalog, overlay))) {
    throw new Error('The staged public catalog does not match the binding catalog and docs overlay.');
  }
  const llms = fs.readFileSync(routeFile(
    resolvedStage,
    routesById.get('llms').path,
    routes.publicRoot
  ), 'utf8');
  for (const exact of [
    `Version: ${version}`,
    'Python package: effetune',
    'npm package: @effetune/dsp',
    `${canonicalOrigin}${routesById.get('landing').path}`,
    `${canonicalOrigin}${routesById.get('catalog').path}`,
    `${canonicalOrigin}${chainRoute.path}`,
    `${canonicalOrigin}${bundleRoute.path}`
  ]) {
    if (!llms.includes(exact)) {
      throw new Error(`llms.txt is missing required metadata: ${exact}`);
    }
  }

  const htmlFiles = expanded
    .filter(route => !route.raw)
    .map(route => routeFile(resolvedStage, route.path, routes.publicRoot));
  for (const filePath of new Set(htmlFiles)) {
    const html = fs.readFileSync(filePath, 'utf8');
    for (const match of html.matchAll(/\bhref=["']([^"']+)["']/g)) {
      const href = match[1];
      if (!href.startsWith(routes.publicRoot)) continue;
      const { filePath: target, anchor } = routeHrefTarget(
        resolvedStage,
        href,
        routes.publicRoot
      );
      if (!fs.existsSync(target)) {
        throw new Error(
          `${path.relative(resolvedStage, filePath)} links to missing ${href}.`
        );
      }
      verifyAnchor(target, anchor, href);
    }
  }
  const declared = new Set(expanded.map(route =>
    path.relative(
      resolvedStage,
      routeFile(resolvedStage, route.path, routes.publicRoot)
    )
      .replaceAll('\\', '/')
  ));
  for (const filePath of listFiles(resolvedStage)) {
    const relative = path.relative(resolvedStage, filePath).replaceAll('\\', '/');
    if (relative === 'site-manifest.json' || relative.startsWith('demo/assets/')) continue;
    if (relative.startsWith('demo/') && !relative.endsWith('index.html')) continue;
    if ((relative.endsWith('index.html') || relative.endsWith('.json') ||
         relative.endsWith('.txt')) && !declared.has(relative)) {
      throw new Error(`Undeclared or post-launch output is staged: ${relative}`);
    }
  }
  verifyManifest(resolvedStage, routes.publicRoot);
  return {
    routes: expanded.length,
    effects: catalog.effects.length,
    version
  };
}

function main() {
  const index = process.argv.indexOf('--stage');
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error('Usage: node verify-site-stage.mjs --stage <_site/dsp>');
  }
  const result = verifyStage(process.argv[index + 1]);
  console.log(
    `Verified ${result.routes} staged DSP routes, ${result.effects} effect pages, ` +
    `and documentation version ${result.version}.`
  );
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
