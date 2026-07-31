import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '..', '..');
const docsDataRoot = path.join(sourceRoot, 'docs');
const bindingCatalogPath = path.join(
  repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.json'
);
const outputRoot = path.join(repoRoot, 'docs', 'dsp');
const validStatuses = new Set(['unreleased', 'published-unverified', 'published']);
const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const manifestSegmentPattern = /^[A-Za-z0-9._-]+$/;
const publicSegmentPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const officialReleasePrefix =
  'https://github.com/Frieve-A/effetune/releases/download/';
const docsOverlayFields = Object.freeze([
  'displayName',
  'category',
  'summary',
  'sourceGenerating',
  'slug'
]);
const categoryOrder = Object.freeze([
  'analyzer',
  'basics',
  'delay',
  'dynamics',
  'eq',
  'lo-fi',
  'modulation',
  'resonator',
  'reverb',
  'saturation',
  'spatial',
  'others'
]);
const publicTelemetryTypes = new Set([
  'LevelMeter',
  'Oscilloscope',
  'Spectrogram',
  'SpectrumAnalyzer',
  'StereoMeter'
]);

function fail(message) {
  throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  try {
    return JSON.parse(read(filePath));
  } catch (error) {
    fail(`${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

function containsPath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
}

export function validateManifestRelativePath(
  value,
  label,
  placeholders = []
) {
  if (typeof value !== 'string' || value.length === 0 ||
      value.includes('\\') || path.posix.isAbsolute(value)) {
    fail(`${label} must be a non-empty repository-relative POSIX path.`);
  }
  const allowedPlaceholders = new Set(placeholders);
  for (const segment of value.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      fail(`${label} contains an unsafe path segment.`);
    }
    const placeholder = segment.match(/^\{([^{}]+)\}$/)?.[1];
    if (placeholder) {
      if (!allowedPlaceholders.has(placeholder)) {
        fail(`${label} contains an unsupported {${placeholder}} placeholder.`);
      }
    } else if (!manifestSegmentPattern.test(segment) ||
        segment.includes('{') || segment.includes('}')) {
      fail(`${label} contains an invalid path segment: ${segment}`);
    }
  }
  return value;
}

export function resolveUnderRoot(root, relative, label) {
  validateManifestRelativePath(relative, label);
  const resolved = path.resolve(root, ...relative.split('/'));
  if (!containsPath(root, resolved)) {
    fail(`${label} resolves outside its allowed root.`);
  }
  return resolved;
}

export function validateEffectSlug(slug, label = 'Effect slug') {
  if (typeof slug !== 'string' || !safeSlugPattern.test(slug)) {
    fail(`${label} must use safe lower-kebab-case.`);
  }
  return slug;
}

export function validatePublicRoot(value, label = 'Public root') {
  if (typeof value !== 'string' || !value.startsWith('/') ||
      !value.endsWith('/') || value.includes('\\') ||
      value.includes('#') || value.includes('?')) {
    fail(`${label} must be an absolute, trailing-slash public path.`);
  }
  const segments = value.slice(1, -1).split('/');
  if (segments.length === 0 || segments.some(segment =>
    !publicSegmentPattern.test(segment))) {
    fail(`${label} contains an invalid public path segment.`);
  }
  return value;
}

export function validatePublicPath(
  value,
  label,
  publicRoot,
  placeholders = []
) {
  validatePublicRoot(publicRoot);
  if (typeof value !== 'string' || value.includes('\\') || value.includes('?')) {
    fail(`${label} must be an absolute public path without a query.`);
  }
  const parts = value.split('#');
  if (parts.length > 2 || !parts[0].startsWith(publicRoot)) {
    fail(`${label} must stay under ${publicRoot}.`);
  }
  const pathname = parts[0];
  if (!pathname.startsWith('/') || pathname.includes('//')) {
    fail(`${label} has an invalid public path format.`);
  }
  const allowed = new Set(placeholders);
  if (allowed.size !== placeholders.length ||
      placeholders.some(name => !safeSlugPattern.test(name))) {
    fail(`${label} declares invalid or duplicate placeholders.`);
  }
  const used = new Set();
  const segments = pathname.slice(1).split('/');
  if (segments.at(-1) === '') segments.pop();
  for (const segment of segments) {
    const placeholder = segment.match(/^\{([^{}]+)\}$/)?.[1];
    if (placeholder) {
      if (!allowed.has(placeholder)) {
        fail(`${label} contains an unsupported {${placeholder}} placeholder.`);
      }
      used.add(placeholder);
    } else if (!publicSegmentPattern.test(segment) ||
        segment.includes('{') || segment.includes('}')) {
      fail(`${label} contains an invalid public path segment: ${segment}`);
    }
  }
  if (used.size !== allowed.size) {
    fail(`${label} does not use every declared placeholder.`);
  }
  if (parts.length === 2 &&
      (!parts[1] || !safeSlugPattern.test(parts[1]))) {
    fail(`${label} contains an invalid fragment.`);
  }
  return value;
}

export function expandPublicPath(template, replacements, label = 'Public path') {
  let expanded = template;
  for (const [name, value] of Object.entries(replacements)) {
    const placeholder = `{${name}}`;
    if (!expanded.includes(placeholder) ||
        typeof value !== 'string' || !safeSlugPattern.test(value)) {
      fail(`${label} has an invalid {${name}} replacement.`);
    }
    expanded = expanded.replaceAll(placeholder, value);
  }
  if (/[{}]/.test(expanded)) {
    fail(`${label} has unresolved placeholders.`);
  }
  return expanded;
}

function validateSchemaValue(schema, value, location = '$') {
  if (schema.const !== undefined && value !== schema.const) {
    fail(`${location} must equal ${JSON.stringify(schema.const)}.`);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`${location} must be an object.`);
    }
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) fail(`${location}.${required} is required.`);
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key] ??
        (typeof schema.additionalProperties === 'object'
          ? schema.additionalProperties
          : null);
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          fail(`${location}.${key} is not allowed by the docs overlay schema.`);
        }
        continue;
      }
      validateSchemaValue(childSchema, child, `${location}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(`${location} must be an array.`);
    value.forEach((item, index) =>
      validateSchemaValue(schema.items ?? {}, item, `${location}[${index}]`)
    );
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength && value.length < schema.minLength)) {
      fail(`${location} must be a non-empty string.`);
    }
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    fail(`${location} must be a boolean.`);
  }
}

export function releaseCohort(release) {
  const states = Object.values(release.surfaces);
  if (states.every(state => state.status === 'unreleased')) return 'unreleased';
  if (states.every(state =>
    state.status === 'published' &&
    state.verifiedVersion === release.docsVersion)) {
    return 'published';
  }
  return 'partial/incomplete';
}

export function validateReleaseState(release) {
  for (const surface of ['python', 'npm', 'githubRelease']) {
    const state = release.surfaces?.[surface];
    if (!state || !validStatuses.has(state.status)) {
      fail(`release-state.json has an invalid ${surface} status.`);
    }
    if (state.status === 'unreleased' &&
        (state.verifiedVersion !== undefined || state.assetUrl !== undefined)) {
      fail(`${surface} must not declare a version or asset URL while unreleased.`);
    }
    if (state.status !== 'unreleased' && !state.verifiedVersion) {
      fail(`${surface} must declare verifiedVersion after publication.`);
    }
    if (surface !== 'githubRelease' && state.assetUrl !== undefined) {
      fail(`${surface} must not declare a GitHub Release asset URL.`);
    }
    if (surface === 'githubRelease' && state.assetUrl !== undefined) {
      const expectedPrefix =
        `${officialReleasePrefix}v${state.verifiedVersion}/`;
      const assetName = state.assetUrl.startsWith(expectedPrefix)
        ? state.assetUrl.slice(expectedPrefix.length)
        : '';
      if (!assetName || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetName)) {
        fail(
          'A GitHub Release assetUrl must use the official Frieve-A/effetune ' +
          'download path for its exact verified version.'
        );
      }
    }
    if (surface === 'githubRelease' && state.status === 'published' &&
        state.assetUrl === undefined) {
      fail('A published GitHub Release requires an HTTPS assetUrl.');
    }
  }
  return releaseCohort(release);
}

function slugForType(type) {
  return validateEffectSlug(type
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase(), `Derived slug for ${type}`);
}

function headingSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function frontMatter(title, permalink, description = '') {
  return [
    '---',
    'layout: dsp',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description || title)}`,
    'lang: en',
    `permalink: ${permalink}`,
    '---',
    ''
  ].join('\n');
}

function codeBlock(language, source) {
  return `\`\`\`${language}\n${source.trimEnd()}\n\`\`\``;
}

function loadSources() {
  const catalog = readJson(bindingCatalogPath);
  const overlay = readJson(path.join(docsDataRoot, 'effects-v1.docs.json'));
  const overlaySchema = readJson(path.join(
    docsDataRoot, 'effects-v1.docs.schema.json'
  ));
  const mapping = readJson(path.join(docsDataRoot, 'effect-prose-map-v0.1.json'));
  const routes = readJson(path.join(docsDataRoot, 'routes-v0.1.json'));
  const release = readJson(path.join(docsDataRoot, 'release-state.json'));
  const locales = readJson(path.join(docsDataRoot, 'release-state.locales.json'));
  const npmPackage = readJson(path.join(repoRoot, 'dsp', 'bindings', 'js', 'package.json'));
  const convenienceExports = readJson(path.join(
    repoRoot,
    'dsp',
    'bindings',
    'js',
    'convenience-exports-v0.1.json'
  ));
  const pythonProject = read(path.join(
    repoRoot, 'dsp', 'bindings', 'python', 'pyproject.toml'
  ));
  const pythonVersion = pythonProject.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  const pythonName = pythonProject.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];

  validateSchemaValue(overlaySchema, overlay);
  if (!Array.isArray(catalog.effects) || catalog.effects.length === 0) {
    fail('The binding catalog must contain effects.');
  }
  const types = catalog.effects.map(effect => effect.type);
  if (new Set(types).size !== types.length) {
    fail('The binding catalog contains duplicate effect types.');
  }
  const overlayTypes = Object.keys(overlay.effects ?? {});
  const mappingTypes = Object.keys(mapping.effects ?? {});
  for (const [label, values] of [
    ['docs overlay', overlayTypes],
    ['effect prose mapping', mappingTypes]
  ]) {
    if (JSON.stringify([...values].sort()) !== JSON.stringify([...types].sort())) {
      fail(`${label} must contain exactly the binding catalog effect types.`);
    }
  }
  if (JSON.stringify(overlay.categories?.map(category => category.id)) !==
      JSON.stringify(categoryOrder)) {
    fail('The docs category taxonomy or order is invalid.');
  }
  const slugs = types.map(type => {
    const explicit = overlay.effects[type].slug;
    return explicit === undefined
      ? slugForType(type)
      : validateEffectSlug(explicit, `Explicit slug for ${type}`);
  });
  if (new Set(slugs).size !== slugs.length) {
    fail('Effect slugs must be unique.');
  }
  for (const type of types) {
    const entry = overlay.effects[type];
    if (!entry.displayName || !entry.summary ||
        !categoryOrder.includes(entry.category) ||
        typeof entry.sourceGenerating !== 'boolean') {
      fail(`The docs overlay entry for ${type} is incomplete.`);
    }
  }
  validateReleaseState(release);
  if (npmPackage.version !== pythonVersion ||
      npmPackage.version !== release.docsVersion ||
      npmPackage.name !== '@effetune/dsp' ||
      pythonName !== 'effetune') {
    fail('Package identities and docs version must match.');
  }
  if (convenienceExports.version !== 1 ||
      !Array.isArray(convenienceExports.exports) ||
      convenienceExports.exports.length === 0) {
    fail('The JavaScript convenience export manifest is invalid.');
  }
  const catalogTypes = new Set(types);
  const convenienceTypes = convenienceExports.exports.map(entry => entry.type);
  if (new Set(convenienceTypes).size !== convenienceTypes.length ||
      convenienceExports.exports.some(entry =>
        !catalogTypes.has(entry.type) ||
        entry.class !== entry.type ||
        entry.factory !== `create${entry.type}`)) {
    fail('The JavaScript convenience export manifest has invalid symbol pairs.');
  }
  const localized = routes.localizedOverviews?.locales;
  if (!Array.isArray(localized) || localized.some(locale => !locales[locale])) {
    fail('Every localized overview must have an explicit locale resource.');
  }
  routeMap(routes);
  const dsd = catalog.effects.find(effect => effect.type === 'DSD64IMDSimulator');
  if (dsd &&
      (dsd.minimumSampleRate !== 88200 || dsd.effectiveDelaySamples !== 63)) {
    fail('DSD64IMDSimulator binding metadata is not docs-ready.');
  }
  return {
    catalog,
    overlay,
    mapping,
    routes,
    release,
    locales,
    npmPackage,
    convenienceExports
  };
}

export function routeMap(routes) {
  const publicRoot = validatePublicRoot(routes.publicRoot);
  const result = new Map();
  const canonicalPaths = new Set();
  for (const route of routes.routes) {
    if (result.has(route.id)) fail(`Duplicate route id: ${route.id}`);
    if (!['launch', 'merged', 'post-launch'].includes(route.status)) {
      fail(`Invalid route status: ${route.id}`);
    }
    const pathPlaceholders = route.pathPlaceholders ?? [];
    if (!Array.isArray(pathPlaceholders)) {
      fail(`Route ${route.id} pathPlaceholders must be an array.`);
    }
    validatePublicPath(
      route.path,
      `Route ${route.id} path`,
      publicRoot,
      pathPlaceholders
    );
    if (route.status === 'launch' && route.path.includes('#')) {
      fail(`Launch route ${route.id} must not contain a fragment.`);
    }
    if (route.status === 'merged' && !route.path.includes('#')) {
      fail(`Merged route ${route.id} must contain a fragment.`);
    }
    const anchors = route.anchors ?? [];
    if (!Array.isArray(anchors) ||
        new Set(anchors).size !== anchors.length ||
        anchors.some(anchor => !safeSlugPattern.test(anchor))) {
      fail(`Route ${route.id} anchors must be unique safe lower-kebab-case.`);
    }
    if (['launch', 'merged'].includes(route.status)) {
      if (canonicalPaths.has(route.path)) {
        fail(`Duplicate canonical public route: ${route.path}`);
      }
      canonicalPaths.add(route.path);
    }
    if (route.dynamic === 'catalog-effects' &&
        JSON.stringify(pathPlaceholders) !== JSON.stringify(['effect-slug'])) {
      fail('The catalog effect route must declare {effect-slug}.');
    }
    if (route.status === 'launch' && !route.output && !route.source) {
      fail(`Launch route ${route.id} must declare output or source.`);
    }
    if (route.output) {
      validateManifestRelativePath(
        route.output,
        `Route ${route.id} output`,
        route.dynamic === 'catalog-effects' ? ['effect-slug'] : []
      );
    }
    if (route.source) {
      validateManifestRelativePath(route.source, `Route ${route.id} source`);
      resolveUnderRoot(repoRoot, route.source, `Route ${route.id} source`);
    }
    result.set(route.id, route);
  }
  const launchByPath = new Map(
    [...result.values()]
      .filter(route => route.status === 'launch')
      .map(route => [route.path, route])
  );
  for (const route of result.values()) {
    if (route.status !== 'merged') continue;
    const [pathname, fragment] = route.path.split('#');
    const launch = launchByPath.get(pathname);
    if (!launch) {
      fail(`Merged route ${route.id} must resolve to a launch route.`);
    }
    if (!(launch.anchors ?? []).includes(fragment)) {
      fail(
        `Merged route ${route.id} fragment must be declared by launch route ` +
        `${launch.id}: ${fragment}`
      );
    }
  }
  const localized = routes.localizedOverviews;
  if (!localized || !Array.isArray(localized.locales) ||
      localized.locales.length === 0) {
    fail('Localized overview routes must declare at least one locale.');
  }
  validatePublicPath(
    localized.path,
    'Localized overview path',
    publicRoot,
    ['locale']
  );
  if (new Set(localized.locales).size !== localized.locales.length) {
    fail('Localized overview locales must be unique.');
  }
  for (const locale of localized.locales) {
    validateEffectSlug(locale, 'Localized overview locale');
    const publicPath = expandPublicPath(
      localized.path,
      { locale },
      `Localized overview path ${locale}`
    );
    if (canonicalPaths.has(publicPath)) {
      fail(`Duplicate canonical public route: ${publicPath}`);
    }
    canonicalPaths.add(publicPath);
  }
  validateManifestRelativePath(
    localized.output,
    'Localized overview output',
    ['locale']
  );
  const navigation = routes.navigation;
  if (!navigation || !Array.isArray(navigation.groups) ||
      navigation.groups.length === 0) {
    fail('DSP navigation must declare at least one group.');
  }
  validateManifestRelativePath(navigation.output, 'Navigation output');
  resolveUnderRoot(repoRoot, navigation.output, 'Navigation output');
  const navigationLabels = new Set();
  const navigationRouteIds = new Set();
  for (const group of navigation.groups) {
    if (typeof group.label !== 'string' || !group.label.trim() ||
        navigationLabels.has(group.label)) {
      fail('DSP navigation group labels must be non-empty and unique.');
    }
    navigationLabels.add(group.label);
    if (!Array.isArray(group.routeIds) || group.routeIds.length === 0) {
      fail(`DSP navigation group ${group.label} has no route IDs.`);
    }
    for (const routeId of group.routeIds) {
      if (navigationRouteIds.has(routeId)) {
        fail(`DSP navigation route ID is duplicated: ${routeId}`);
      }
      navigationRouteIds.add(routeId);
      const route = result.get(routeId);
      if (!route) fail(`DSP navigation route ID is missing: ${routeId}`);
      if (route.status !== 'launch') {
        fail(`DSP navigation target must be a launch route: ${routeId}`);
      }
    }
  }
  const outputIds = new Set();
  for (const descriptor of routes.nonRouteOutputs ?? []) {
    if (!descriptor.id || outputIds.has(descriptor.id)) {
      fail(`Duplicate or missing non-route output ID: ${descriptor.id ?? ''}`);
    }
    outputIds.add(descriptor.id);
    validateManifestRelativePath(
      descriptor.output,
      `Non-route output ${descriptor.id}`
    );
    resolveUnderRoot(
      repoRoot,
      descriptor.output,
      `Non-route output ${descriptor.id}`
    );
    const hasSnippet = typeof descriptor.snippet === 'string';
    const hasSummary = typeof descriptor.summary === 'string';
    if (hasSnippet === hasSummary) {
      fail(`Non-route output ${descriptor.id} must declare one content source.`);
    }
    if (hasSnippet) {
      validateManifestRelativePath(
        descriptor.snippet,
        `Non-route snippet ${descriptor.id}`
      );
      resolveUnderRoot(
        path.join(docsDataRoot, 'snippets'),
        descriptor.snippet,
        `Non-route snippet ${descriptor.id}`
      );
    } else if (!['python', 'javascript'].includes(descriptor.summary)) {
      fail(`Non-route output ${descriptor.id} has an invalid summary source.`);
    }
  }
  return result;
}

function routeOutput(routes, id, replacements = {}) {
  const route = routeMap(routes).get(id);
  if (!route?.output) fail(`Route ${id} has no generated output.`);
  let relative = route.output;
  for (const [key, value] of Object.entries(replacements)) {
    relative = relative.replace(`{${key}}`, value);
  }
  if (relative.includes('{')) fail(`Route ${id} has unresolved output variables.`);
  return resolveUnderRoot(repoRoot, relative, `Route ${id} output`);
}

function releaseSummary(release) {
  const surfaces = Object.entries(release.surfaces)
    .map(([surface, state]) =>
      `${surface}: ${state.status}${state.verifiedVersion ? ` (${state.verifiedVersion})` : ''}`
    )
    .join('; ');
  return `cohort: ${releaseCohort(release)}; ${surfaces}`;
}

function installNotice(release, surface) {
  const state = release.surfaces[surface];
  const ready = state.status === 'published' &&
    state.verifiedVersion === release.docsVersion;
  return [
    '<!-- DSP-RELEASE-NOTICE -->',
    `> **Release state:** ${surface} is **${state.status}**` +
      `${state.verifiedVersion ? ` for ${state.verifiedVersion}` : ''}. ` +
      (ready
        ? `The verified package matches these ${release.docsVersion} docs.`
        : 'The public install command is intentionally disabled until a version-matched smoke test passes.'),
    ...(state.assetUrl
      ? [
          `> [` +
          (state.status === 'published'
            ? 'Verified public Release asset'
            : 'Public Release asset (verification pending)') +
          `](${state.assetUrl})`
        ]
      : []),
    ''
  ].join('\n');
}

function packageInstall(release, surface, command) {
  const state = release.surfaces[surface];
  return state.status === 'published' && state.verifiedVersion === release.docsVersion
    ? codeBlock('console', command)
    : '> Use the CI candidate artifact for pre-release testing. Do not substitute an older registry version.';
}

function extractAppSections(catalog, overlay, mapping) {
  const sourceCache = new Map();
  const destinationBySourceFragment = new Map();
  for (const effect of catalog.effects) {
    const [source, heading] = mapping.effects[effect.type];
    const sourceKey = source.replaceAll('\\', '/');
    destinationBySourceFragment.set(
      `${sourceKey}#${headingSlug(heading)}`,
      `/dsp/effects/${overlay.effects[effect.type].slug ?? slugForType(effect.type)}/`
    );
  }
  const sections = new Map();
  for (const effect of catalog.effects) {
    const [relativeSource, heading] = mapping.effects[effect.type];
    const sourcePath = path.join(repoRoot, relativeSource);
    const source = sourceCache.get(sourcePath) ?? read(sourcePath);
    sourceCache.set(sourcePath, source);
    const lines = source.replaceAll('\r\n', '\n').split('\n');
    const startIndexes = lines.flatMap((line, index) =>
      line === `## ${heading}` ? [index] : []
    );
    if (startIndexes.length !== 1) {
      fail(`${relativeSource}: expected exactly one "## ${heading}" heading.`);
    }
    const start = startIndexes[0];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        end = index;
        break;
      }
    }
    const sourceKey = relativeSource.replaceAll('\\', '/');
    const section = lines.slice(start, end).join('\n').trimEnd().replace(
      /\]\(#([^)]+)\)/g,
      (match, fragment) => {
        const destination = destinationBySourceFragment.get(
          `${sourceKey}#${fragment.toLowerCase()}`
        );
        if (!destination) {
          fail(`${relativeSource}: unresolved fragment-only link #${fragment}.`);
        }
        return `](${destination})`;
      }
    );
    sections.set(effect.type, section);
  }
  return sections;
}

function snakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function parameterTable(effect) {
  if (effect.parameters.length === 0) {
    return 'This effect has no semantic parameters.';
  }
  const rows = [
    '| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |',
    '|---|---|---:|---|---|---|'
  ];
  for (const parameter of effect.parameters) {
    const bounds = parameter.values
      ? parameter.values.map(value => `\`${value}\``).join(', ')
      : parameter.minimum !== undefined || parameter.maximum !== undefined
        ? `${parameter.minimum ?? 'not declared'} … ${parameter.maximum ?? 'not declared'}`
        : parameter.maximumLength !== undefined
          ? `maximum length ${parameter.maximumLength}`
          : 'Not declared in catalog';
    rows.push(
      `| \`${parameter.name}\` | \`${snakeCase(parameter.name)}\` | ` +
      `${parameter.type} / ${parameter.count} | ` +
      `\`${JSON.stringify(parameter.default)}\` | ` +
      `${parameter.unit ?? 'Not declared in catalog'} | ${bounds} |`
    );
  }
  return rows.join('\n');
}

function effectContractDetails(effect) {
  if (effect.type !== 'Matrix') return '';
  return `### Matrix route grammar

\`matrixRoutes\` uses the complete grammar \`(p?[0-8][0-8])*\`. Two independent
limits apply: the string is at most 3,072 characters, and it may contain at
most 1,024 routes. Exceeding either raises \`ValidationError\`; the route-count
limit is enforced when the chain is prepared for processing, not when the
effect is constructed. Route tokens are concatenated directly, with no
separators and no whitespace. Each token is an optional \`p\`, one
input-channel digit, and one output-channel digit.
For example, \`p01\` sends input 0 to output 1 with polarity inverted.
Without \`p\`, the route keeps its polarity.

The empty string is valid and produces silence. Channel indices are zero-based.
The grammar accepts the digits 0 through 8, but audio carries at most 8
channels, so index \`8\` is never routable and index \`n\` is routable only when
the processing call has more than \`n\` channels. Any route whose input or
output is unavailable is silently ignored. Routes targeting the
same available output are summed, and an output with no surviving route stays
silent. A string that does not match \`^(?:p?[0-8][0-8])*$\` raises
\`ValidationError\`.

\`"0011"\` is stereo passthrough, \`"0110"\` swaps left and right, and
\`"p0011"\` inverts the left channel only.`;
}

const npmExportDescriptions = Object.freeze({
  '.': 'Main ESM API: Chain, effects, ETA1, and catalog helpers',
  './worklet': 'AudioWorklet `EffeTuneNode` wrapper',
  './processor': 'Side-effect AudioWorklet processor module',
  './schemas/chain-v1.json': 'Chain v1 JSON Schema',
  './schemas/bundle-v1.json': 'Bundle v1 JSON Schema',
  './catalog': 'ESM catalog exports',
  './catalog.json': 'Machine-readable effect catalog JSON'
});

function npmExportTable(npmPackage) {
  const exportPaths = Object.keys(npmPackage.exports ?? {});
  const describedPaths = Object.keys(npmExportDescriptions);
  if (JSON.stringify([...exportPaths].sort()) !==
      JSON.stringify([...describedPaths].sort())) {
    fail('Every npm package export needs one public documentation description.');
  }
  return [
    '| Import specifier | Use |',
    '|---|---|',
    ...exportPaths.map(exportPath => {
      const specifier = exportPath === '.'
        ? npmPackage.name
        : `${npmPackage.name}${exportPath.slice(1)}`;
      return `| \`${specifier}\` | ${npmExportDescriptions[exportPath]} |`;
    })
  ].join('\n');
}

function contractBadges(effect) {
  const badges = [
    `Seeded: **${effect.seeded ? 'yes' : 'no'}**`,
    effect.sampleRates
      ? `Catalog sample rates: **${effect.sampleRates.join(', ')} Hz**`
      : 'Catalog sample rates: **not declared; this does not mean unsupported**',
    `Assets: **${effect.assets.length
      ? effect.assets.map(asset => `${asset.name} (${asset.kind})`).join(', ')
      : 'none'}**`,
    `Catalog-declared latency: **${effect.latency.kind}**` +
      `${effect.latency.dependsOn?.length
        ? `; depends on ${effect.latency.dependsOn.join(', ')}`
        : ''}`
  ];
  if (effect.minimumSampleRate !== undefined) {
    badges.push(
      `Simulation activation: **${effect.minimumSampleRate} Hz or higher**; ` +
      'lower rates are accepted and use dry passthrough'
    );
  }
  if (effect.effectiveDelaySamples !== undefined) {
    badges.push(
      `Effective delay on the active processing path: ` +
      `**${effect.effectiveDelaySamples} samples**`
    );
  }
  if (effect.telemetry.length) {
    badges.push(
      publicTelemetryTypes.has(effect.type)
        ? 'Analyzer telemetry: **decoded semantic observations are available in v0.1**'
        : 'Telemetry: **catalog metadata only; observation API unavailable in v0.1**'
    );
  }
  return badges.map(item => `- ${item}`).join('\n');
}

function effectPage(effect, docsEntry, appSection) {
  const slug = docsEntry.slug ?? slugForType(effect.type);
  const concept = effect.assets.length
    ? '\nSee [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.\n'
    : publicTelemetryTypes.has(effect.type)
      ? '\nUse the opt-in decoded telemetry callback or subscription API to observe this analyzer. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).\n'
      : effect.telemetry.length
        ? '\nThis type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).\n'
      : docsEntry.sourceGenerating
        ? '\nThis type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).\n'
        : '';
  return frontMatter(
    `${docsEntry.displayName} — EffeTune DSP`,
    `/dsp/effects/${slug}/`,
    docsEntry.summary
  ) + [
    `# ${docsEntry.displayName}`,
    '',
    `Semantic type: \`${effect.type}\` · Category: ${docsEntry.category}`,
    '',
    docsEntry.summary,
    concept,
    '## Contract',
    '',
    contractBadges(effect),
    '',
    parameterTable(effect),
    '',
    effectContractDetails(effect),
    '',
    '## EffeTune app documentation',
    '',
    '> The following section is reproduced from the English EffeTune app documentation. ' +
      'Its parameter names and values describe the app UI and can differ from semantic API ' +
      'parameters through transforms or value maps. The generated contract above is authoritative.',
    '',
    appSection.replace(/(\S)([ \t]+)$/gm, (_match, content, trailing) =>
      trailing.length >= 2 ? `${content}<br>` : content),
    '',
    '[Back to all effects](/dsp/effects/)',
    ''
  ].join('\n');
}

function effectsIndex(catalog, overlay) {
  const categories = new Map(categoryOrder.map(category => [category, []]));
  for (const effect of catalog.effects) {
    categories.get(overlay.effects[effect.type].category).push(effect);
  }
  const blocks = [];
  for (const category of overlay.categories) {
    blocks.push(`## ${category.label}`, '');
    for (const effect of categories.get(category.id)) {
      const entry = overlay.effects[effect.type];
      const slug = entry.slug ?? slugForType(effect.type);
      blocks.push(
        `- [${entry.displayName}](/dsp/effects/${slug}/) (\`${effect.type}\`) — ` +
        `${entry.summary} ` +
        `<span data-effect-tags="${category.id} ${effect.seeded ? 'seeded' : ''} ` +
        `${effect.assets.length ? 'asset' : ''}"></span>`
      );
    }
    blocks.push('');
  }
  return frontMatter(
    'EffeTune DSP effects',
    '/dsp/effects/',
    'Browse every semantic effect type in the EffeTune DSP binding catalog.'
  ) + [
    '# Effects',
    '',
    `Browse all ${catalog.effects.length} semantic types registered in the v1 binding catalog. ` +
      'The list remains readable without JavaScript.',
    '',
    '<label for="effect-filter">Filter effects</label>',
    '<input id="effect-filter" type="search" placeholder="Name, type, category, seeded, or asset" data-dsp-effect-filter>',
    '<p role="status" aria-live="polite" data-dsp-effect-count></p>',
    '',
    ...blocks
  ].join('\n');
}

function landingPage(catalog, release, convenienceExports) {
  const pythonReady = release.surfaces.python.status === 'published' &&
    release.surfaces.python.verifiedVersion === release.docsVersion;
  const npmReady = release.surfaces.npm.status === 'published' &&
    release.surfaces.npm.verifiedVersion === release.docsVersion;
  return frontMatter(
    'EffeTune DSP Library',
    '/dsp/',
    'Deterministic MIT-licensed DSP for Python, JavaScript, and AudioWorklet.'
  ) + [
    '# EffeTune DSP Library',
    '',
    '**Deterministic DSP for Python, JavaScript, browsers, humans, and agents.**',
    '',
    `EffeTune DSP v${release.docsVersion} is an MIT-licensed audio processing library with ` +
      `${catalog.effects.length} catalog-registered effects, analyzers, and utilities. ` +
      'Python and WebAssembly run the same host-neutral C++20 core and use the same semantic ' +
      'Chain JSON, so a preset does not need to be reauthored for each surface.',
    '',
    'Process arrays and files offline, keep state across a continuous stream, or run the ' +
      'package-owned AudioWorklet in a browser. The EffeTune app is an optional visual preset ' +
      'editor; the Python and JavaScript packages work independently.',
    '',
    `<p class="dsp-release-state"><strong>Release state:</strong> ${releaseSummary(release)}.</p>`,
    '',
    `[Python Start](/dsp/getting-started/python/){: .dsp-cta${pythonReady ? '' : ' .is-disabled'} } · ` +
      `[JavaScript Start](/dsp/getting-started/javascript/){: .dsp-cta${npmReady ? '' : ' .is-disabled'} } · ` +
      `[AudioWorklet Start](/dsp/getting-started/audioworklet/){: .dsp-cta${npmReady ? '' : ' .is-disabled'} } · ` +
      `[CLI Start](/dsp/getting-started/cli/){: .dsp-cta${pythonReady ? '' : ' .is-disabled'} }`,
    '',
    'Try the [live demo](/dsp/demo/) or follow the ' +
      '[schema-driven agent recipe](/dsp/cookbook/schema-driven-agent/).',
    '',
    '<iframe class="dsp-demo-frame" src="/dsp/demo/?compact=1" title="EffeTune DSP live demo"></iframe>',
    '',
    '**No upload. No CDN.** The demo uses the package-owned WASM and AudioWorklet.',
    '',
    '## One library, several ways to work',
    '',
    `The [Python API](/dsp/api/python/) provides semantic classes for all ` +
      `${catalog.effects.length} catalog types, with NumPy-oriented offline and streaming ` +
      'processing. The [JavaScript API](/dsp/api/javascript/) makes every catalog type ' +
      `available through generic \`createEffect\` and Chain APIs, plus ` +
      `${convenienceExports.exports.length} generated named class/factory pairs. ` +
      'The generic and named JavaScript surfaces both cover the complete catalog.',
    '',
    'In a browser, use JavaScript for offline rendering or the packaged ' +
      '[AudioWorklet path](/dsp/getting-started/audioworklet/) for real-time processing. ' +
      'In Python, use the same model from an application, notebook, or the ' +
      '[CLI](/dsp/getting-started/cli/) for file and batch workflows.',
    '',
    '## From one effect to a reproducible pipeline',
    '',
    '[Chain JSON](/dsp/concepts/chain-and-presets/) is an ordered serial pipeline with ' +
      'strict semantic effect names and parameters. It is readable as a preset, accepted by ' +
      'both language bindings, and described by a public schema that humans and automation ' +
      'can validate before processing.',
    '',
    'Offline calls begin with fresh DSP state. Streaming calls preserve history across ' +
      'blocks, including delay and reverb tails, and scheduled parameter events are part of ' +
      'that history. Seeded execution is repeatable when the input, sample rate, channel ' +
      'layout, Chain, seed, block boundaries, and event sequence are the same. See ' +
      '[Determinism](/dsp/concepts/determinism/) and ' +
      '[Streaming and events](/dsp/concepts/streaming-and-events/) for the exact contract.',
    '',
    '## Catalog-driven, inspectable behavior',
    '',
    'The generated [effect reference](/dsp/effects/) and machine-readable ' +
      '[catalog](/dsp/catalog/effects-v1.json) come from the binding catalog. Entries expose ' +
      'parameter types, defaults and ranges, channel and latency declarations, capability ' +
      'metadata, external-asset requirements, and whether an effect can generate output ' +
      'without input.',
    '',
    'Asset-backed effects use explicit resolver and ' +
      '[bundle](/dsp/concepts/assets-and-bundles/) contracts, including ETA1 assets and ' +
      'digest-addressed bundle records. Source-generating effects require an explicit frame ' +
      'count, while stateful effects make block and event history relevant. These behaviors ' +
      'are documented instead of being hidden behind a host application.',
    '',
    '## Practical paths',
    '',
    '- **ML and audio data:** start with [Python](/dsp/getting-started/python/) and the [augmentation recipe](/dsp/cookbook/ml-data-augmentation/).',
    '- **Web audio:** prototype offline with [JavaScript](/dsp/getting-started/javascript/), then move the same Chain to [AudioWorklet](/dsp/getting-started/audioworklet/).',
    '- **Agents and automation:** discover types through the public [catalog](/dsp/catalog/effects-v1.json), validate Chains with the [schema](/dsp/schemas/chain-v1.schema.json), and render through a normal library or CLI call.',
    '- **Research and teaching:** record the complete [reproducibility conditions](/dsp/concepts/determinism/#reproducible-experiment) alongside an experiment.',
    '- **Listening and batch workflows:** design a preset visually in the optional app or write Chain JSON directly, then render files with the [CLI batch path](/dsp/getting-started/cli/#batch-rendering).',
    '',
    '## What stays consistent {#library-strengths}',
    '',
    'The library, schemas, and examples are MIT licensed. Python and WebAssembly use one C++ ' +
      'core and one semantic catalog; seeded repeatability is defined by explicit execution ' +
      'conditions rather than by a vague promise. Generated reference pages and schemas make ' +
      'the contract inspectable, while [verification](/dsp/reference/verification/) and ' +
      '[release integrity](/dsp/reference/release-integrity/) document how packages, native ' +
      'artifacts, examples, and public pages are checked together.',
    '',
    '## Boundaries',
    '',
    'EffeTune DSP does not host VST/AU plugins, decode or encode audio in JavaScript, ' +
      'resample audio, call ffmpeg, or expose integrated-LUFS/true-peak measurements. ' +
      'Five analyzers expose opt-in decoded observations in v0.1; all other catalog ' +
      'telemetry remains metadata-only. ' +
      'MCP is planned only after its implementation and acceptance exist.',
    '',
    'See [Compatibility and boundaries](/dsp/reference/compatibility/) for supported runtimes, ' +
      'channel behavior, and the precise v0.1 surface.',
    '',
    'Package identities are `effetune` on PyPI and `@effetune/dsp` on npm. ' +
      'Source: [Frieve-A/effetune](https://github.com/Frieve-A/effetune). ' +
      'Canonical documentation: https://effetune.frieve.com/dsp/.',
    '',
    '## Continue',
    '',
    '[Concepts](/dsp/concepts/processing-model/) · [Compatibility](/dsp/reference/compatibility/) · ' +
      '[Verification](/dsp/reference/verification/) · [Release integrity](/dsp/reference/release-integrity/) · ' +
      '[FAQ](/dsp/faq/) · [Chain schema](/dsp/schemas/chain-v1.schema.json) · ' +
      '[Bundle schema](/dsp/schemas/bundle-v1.schema.json)',
    ''
  ].join('\n');
}

function staticPages(sources) {
  const { convenienceExports, npmPackage, release, routes } = sources;
  const pythonSnippet = read(path.join(docsDataRoot, 'snippets', 'python-start.py'));
  const javascriptSnippet = read(path.join(
    docsDataRoot, 'snippets', 'javascript-start.mjs'
  ));
  const workletSnippet = read(path.join(
    docsDataRoot, 'snippets', 'audioworklet-start.js'
  ));
  const workletBootstrap = read(path.join(
    docsDataRoot, 'snippets', 'audioworklet-bootstrap.html'
  ));
  const cliGenerator = read(path.join(docsDataRoot, 'snippets', 'cli-start.py'));
  const batchSnippet = read(path.join(docsDataRoot, 'snippets', 'batch-render.py'));
  const researchSnippet = read(path.join(
    docsDataRoot, 'snippets', 'research-experiment.py'
  ));
  const visualSnippet = read(path.join(
    docsDataRoot, 'snippets', 'visual-editor-to-code.py'
  ));
  const assetPythonSnippet = read(path.join(
    docsDataRoot, 'snippets', 'asset-required-examples.py'
  ));
  const assetJavascriptSnippet = read(path.join(
    docsDataRoot, 'snippets', 'asset-required-examples.mjs'
  ));
  const assetFixtureSnippet = read(path.join(
    docsDataRoot, 'snippets', 'asset-fixtures.mjs'
  ));
  const bundlePackSnippet = read(path.join(
    docsDataRoot, 'snippets', 'bundle-pack.py'
  ));
  const visualInput = read(path.join(
    docsDataRoot, 'fixtures', 'visual-editor-input-v0.1.json'
  ));
  const visualGolden = read(path.join(
    docsDataRoot, 'fixtures', 'visual-editor-golden-v0.1.json'
  ));
  const mlSnippet = read(path.join(
    docsDataRoot, 'snippets', 'ml-data-augmentation.py'
  ));
  const pages = new Map();
  const byId = routeMap(routes);
  const add = (id, body) => {
    const route = byId.get(id);
    if (!route || route.status !== 'launch' || route.raw || route.dynamic ||
        route.externalSource) {
      fail(`Static page route ${id} is not a generated launch page.`);
    }
    pages.set(
      routeOutput(routes, id),
      frontMatter(route.title, route.path) + `# ${route.title}\n\n${body.trim()}\n`
    );
  };

  add('python-start', `
Use this path to process a planar NumPy array.

${installNotice(release, 'python')}
${packageInstall(release, 'python', 'pip install effetune')}

Wheels target CPython 3.10+ on manylinux x86-64, Windows AMD64, macOS Intel, and
macOS Apple Silicon. musllinux is not provided. Input must be C-contiguous
\`float32\` with shape \`(channels, frames)\`; the core does not resample.

Generated effect constructors and \`create_effect()\` accept Python
\`snake_case\` keywords:

${codeBlock('python', `shift = et.PitchShifter(pitch_shift=3)
same_shift = et.create_effect("PitchShifter", pitch_shift=3)`)}

Chain JSON and scheduled event parameter objects use the semantic catalog name
\`pitchShift\`. The camelCase semantic name is not a Python constructor alias.

${codeBlock('python', pythonSnippet)}

Offline calls start with fresh state. Use \`Chain.stream()\` when filter history,
tails, or seeded random state must continue. See [Python API](/dsp/api/python/)
and [Determinism](/dsp/concepts/determinism/).

## Reading an audio file

SoundFile returns \`(frames, channels)\`. Convert it explicitly to the library's
planar, C-contiguous \`float32\` layout:

${codeBlock('python', `import numpy as np
import soundfile as sf

decoded, sample_rate = sf.read("input.wav", dtype="float32", always_2d=True)
audio = np.ascontiguousarray(decoded.T, dtype=np.float32)
output = chain.process(audio, sample_rate=sample_rate)
sf.write("output.wav", output.T, sample_rate, subtype="FLOAT")`)}
`);

  add('javascript-start', `
Use this path for offline processing in Node.js or a browser module.

${installNotice(release, 'npm')}
${packageInstall(release, 'npm', 'npm install @effetune/dsp')}

The package is ESM-only. Save the example as \`start.mjs\` and run
\`node start.mjs\`, or set \`"type": "module"\` in the consumer's
\`package.json\`. CommonJS \`require()\` is not supported.

Node.js \`>=18\` is required. Chromium is acceptance-tested; other evergreen
browsers are designed for but not verified in v0.1. The package accepts equal-length
\`Float32Array[]\` channels and does not decode, encode, or resample audio.
In Node.js, \`@effetune/dsp\` resolves after installation. In a browser, use a bundler
or an import map that maps the bare \`@effetune/dsp\` specifier to the package's
\`dist/index.js\`; serve that module and its relative WASM/metadata assets from the
same secure origin.

${codeBlock('js', javascriptSnippet)}

The generic \`createEffect(type)\`, Chain JSON, catalog, and generated named
class/factory exports all support every registered type.

Every input sample must be finite. Offline and streaming calls reject \`NaN\`,
\`Infinity\`, and \`-Infinity\` with \`ValidationError\` before native processing;
a rejected stream block does not change filter state.
`);

  add('audioworklet-start', `
Use this path to run the package-owned WASM processor in a browser audio graph.

${installNotice(release, 'npm')}
Serve the app over HTTPS or localhost. Direct \`file:\` loading is unsupported because
ordinary browser module, AudioWorklet, and WASM security rules generally reject it.
Start from a user gesture, keep processor/WASM/meta assets same-origin with correct MIME
types, and permit them in CSP.

## Browser audio

Copy the package's complete \`dist/\` directory to
\`/vendor/@effetune/dsp/dist/\`. This import map resolves the package's bare Worklet
specifier; the module script is the runnable Start below.

${codeBlock('html', workletBootstrap)}

${codeBlock('js', workletSnippet)}

By default, \`worklet-processor.js\`, \`assets/effetune-dsp.wasm\`,
\`assets/effetune-dsp.simd.wasm\`, and \`assets/effetune-dsp.meta.json\` resolve
beside the mapped \`dist/worklet.js\`. If a deployment rebases them, pass
\`processorUrl\`, \`wasmUrl\`, \`simdWasmUrl\`, and \`metaUrl\` in the third
\`EffeTuneNode.create\` options argument; each accepts a string or \`URL\`.

The example starts a 440 Hz oscillator after a user click and routes it through a
-6 dB Volume effect. Use [Verification](/dsp/reference/verification/) for the
candidate-package browser checks.

## API

\`EffeTuneNode.create(context, chain, options)\` creates the node.
\`setParam(effectId, semanticName, value)\` applies an immediate update.
\`subscribe(callback)\` enables decoded analyzer telemetry on the first subscriber and
returns an unsubscribe function; \`unsubscribe(callback)\` removes it. Callbacks run on
the node side, never inside DSP processing. \`droppedTelemetryFrames\` reports loss.
\`reset()\` clears state and \`close()\` releases the worklet-side instance.
Scheduled frame events belong to Python/JavaScript streams, not this Worklet API.
`);

  add('cli-start', `
Use this path to validate a Chain and render files with the Python package.

${installNotice(release, 'python')}
Save the following as \`start.py\` and run \`python start.py\`. It creates both
\`input.wav\` and \`volume.json\` without ffmpeg:

${codeBlock('python', cliGenerator)}

${codeBlock('console', `effetune chain validate volume.json
effetune render input.wav output.wav --preset volume.json
effetune preset inspect volume.json`)}

The CLI delegates codecs to SoundFile and does not resample, call ffmpeg, or measure
loudness. It preserves the input sample rate and channel count.

## Batch rendering

The CLI has no special batch operation. Run this source from an empty directory. It
creates \`batch-demo/inputs\`, \`batch-demo/outputs\`, the Volume preset, two valid
WAV files, and one invalid WAV. It prints the one expected file failure, verifies that
both valid files were written, and exits successfully:

${codeBlock('python', batchSnippet)}

## API

| Command | Purpose and options |
|---|---|
| \`effetune render INPUT OUTPUT (--preset PRESET | --chain CHAIN) [--subtype SUBTYPE]\` | Render one file. \`PRESET\` accepts Chain JSON, a Bundle directory, or its \`bundle.json\`. \`CHAIN\` accepts a JSON string or JSON file. \`SUBTYPE\` is passed to SoundFile; for WAV, omission keeps its PCM_16 default and \`FLOAT\` writes 32-bit float. |
| \`effetune chain validate DOCUMENT\` | Validate canonical Chain v1 and runtime-only rules. |
| \`effetune preset inspect DOCUMENT\` | Print the materialized canonical Chain v1 document. |
| \`effetune bundle pack DOCUMENT DESTINATION [--asset REF=FILE ...]\` | Write a Bundle directory. Supply each referenced IR exactly once. |

Successful commands return 0. Argument errors and plain-language library failures return
non-zero; file-rendering scripts can handle one failure and continue with other files.
\`effetune render\` also prints a warning to standard error, while still exiting 0, when
the default output subtype reduces the input's precision (for example a 24-bit or float
input written as the WAV \`PCM_16\` default) and when the rendered peak exceeds full
scale and is therefore clipped by an integer PCM output. Passing \`--subtype\`
explicitly silences the precision warning; the clipping warning is independent of
\`--subtype\`, but it only fires when an integer PCM output actually clips the peak, so a
float output such as \`--subtype FLOAT\` never triggers it:

${codeBlock('console', `effetune: warning: PCM_24 input written as PCM_16 output; precision is reduced. Pass --subtype to keep more precision.
effetune: warning: rendered peak 3.184857 (+10.06 dBFS) exceeds full scale; samples were clipped by the PCM_16 output.`)}
`);

  add('processing-model', `
Audio uses planar channels and an explicit sample rate. Chain effects run serially in
array order. The caller owns decode, encode, resampling, and buffers. Offline processing
starts fresh; streams retain filter, delay, tail, and random history.

Catalog latency badges are qualitative declarations. Python
\`Stream.latency_samples\` and JavaScript \`ChainStream.latencySamples\` expose the same
runtime aggregate. \`Chain.latency_samples()\` in Python and \`chain.latencySamples()\`
in JavaScript report the same aggregate without opening a stream, so offline
\`process()\` output can be phase-aligned.
The AudioWorklet wrapper does not expose a latency getter.

## Source-generating effects

The docs overlay explicitly marks types that can intentionally produce non-zero output
from zero input at an active setting and sample rate. The candidate-package gate runs
all 76 catalog types exactly once, using the same canonical assets as the public asset
examples where required. It requires the overlay, public catalog, and frozen
\`source-generation-v0.1.json\` member sets to match exactly, and treats a peak above
\`1e-7\` as generated output. Those effect pages carry a warning; the absence of that
mark is a fixture result for the selected settings, not proof that every possible future
setting is non-generating.

Render such an effect by processing a zero input whose frame count defines the rendered
length:

${codeBlock('python', `rendered = chain.process(np.zeros((2, frames), np.float32), sample_rate=sr)`)}
`);

  add('determinism', `
Repeatability requires the same package version, backend/artifact bytes and digest,
OS/architecture/runtime, Chain, input bytes, sample rate, channel layout, offline or
stream mode, block schedule, execution seed, assets, and complete stream operation
history. Cross-version byte identity is not promised. Backend comparisons use frozen
golden tolerances rather than cross-backend byte identity.

The execution seed defaults to 0 and is an unsigned 32-bit integer. It is distinct from
an effect parameter such as \`BitCrusher.seed\`, whose catalog default is 11 and range is
0–1000.

## Reproducible experiment

v0.1 has no standard experiment-manifest API. This source owns the complete experiment
record: candidate wheel filename and twice-computed SHA-256, package and environment
versions, input construction and SHA-256, stream mode, parameters, seeds, each ordered
open/process/close operation, exact process block spans, and every output hash. It uses
\`SimpleJitter.rmsJitterNanoseconds = 100\`, stereo 48 kHz, 4096 frames, 256-frame
blocks, execution seed 0 for identical runs and 1 for the variant. Save the emitted JSON
and pass it back with \`--replay-record\`; the script reconstructs a new stream from that
record and requires identical input and output digests in the same environment.

${codeBlock('python', researchSnippet)}

${codeBlock('console', 'python research-experiment.py --wheel /path/to/effetune-0.1.0.whl')}
`);

  add('chain-and-presets', `
Chain v1 is an ordered serial list. Each item uses a unique optional ID, semantic type,
enabled flag, channel selector, semantic parameters, and optional asset references.
Unknown fields are rejected. EffeTune app presets with \`pipeline\` or \`plugins\` are a
different contract and require the explicit legacy importer.

The importer accepts app presets whose effects form one ordered serial path. It rejects
branched or multi-bus routing because flattening it into Chain v1 would change the
acoustic result. To migrate such a preset, first move or copy the desired effects into
one serial path in the app and export it again, or reproduce the branching in the host
around separate Chains.

App presets containing \`FIR Crossover\`, \`5Band FIR PEQ\`, \`Group Delay EQ\`,
\`Room EQ\`, or \`IR Reverb\` cannot be imported in v0.1: the library drives these five
effects from a caller-supplied precomputed impulse-response asset instead of the app's
filter-design parameters, so those parameters have no conversion and the importer
rejects the node with an \`EffectError\` naming the effect. Construct such an effect
directly and supply its asset.

## Visual editor to code

The example below exports an asset-free stereo app pipeline, imports it explicitly, and
processes a fixed stereo input through the canonical Chain. The import report identifies
editor-only metadata that is intentionally discarded; unsupported fields are not
silently dropped.

Input exported by the visual editor:

${codeBlock('json', visualInput)}

Golden long-format export with \`Date.now()\` frozen to \`1710000000000\`:

${codeBlock('json', visualGolden)}

Import and process that exact golden:

${codeBlock('python', visualSnippet)}
`);

  add('streaming-and-events', `
Use streams for tails, filter history, stateful dynamics, and seeded random continuity.
Reproduction requires the exact input block list and every event's content, frame, and
order, including \`setParam\` and \`reset\` positions. Scheduled frame events are stream
operations. Close streams deterministically. Python exposes the aggregate
\`latency_samples\`; JavaScript exposes the same value as \`latencySamples\` on a
\`ChainStream\`. The AudioWorklet wrapper has no latency getter.

Python and JavaScript event \`parameters\` are partial updates merged with the effect's
current semantic values. Frames are zero-based within that \`process()\` input. Events
must be in non-decreasing frame order; events sharing a frame are merged in supplied
order before that sample:

${codeBlock('python', `output = stream.process(audio, events=[
    {"frame": 0, "effectId": "voice", "parameters": {"threshold": -24}},
    {"frame": 0, "effectId": "voice", "parameters": {"ratio": 6}},
])`)}

A scheduled event replaces the semantic parameter value at its frame; the event
mechanism itself generates no ramp between the old and new value. For value-only
effects such as \`Volume\`, schedule a series of small events across successive
frames when an audible-click-free ramp is required.

An open stream or AudioWorklet accepts only values the native parameter commit can
apply immediately. Open a new stream after changing \`IRReverb.channelMode\`,
\`latency\`, or \`convolutionRate\`; \`FIRCrossover.bandCount\`, \`latencyMode\`, or
\`filterDelaySamples\`; or \`latencyMode\` / \`filterDelaySamples\` on
\`FiveBandFIRPEQ\`, \`GroupDelayEQ\`, or \`RoomEQ\`. Live updates to those
asset-configuration parameters raise \`ValidationError\` before processing or posting
a Worklet command.

## Processing a file in blocks

A frame-direction slice of a multi-channel planar array, such as
\`audio[:, start:stop]\`, is a non-contiguous view, so copy each block before passing it
to the stream. Mono arrays stay contiguous under the same slice, and the copy is a
no-op for them, so the pattern below is correct for any channel count:

${codeBlock('python', `with chain.stream(sample_rate, channels=audio.shape[0]) as stream:
    blocks = [
        stream.process(np.ascontiguousarray(audio[:, start:start + 4096]))
        for start in range(0, audio.shape[1], 4096)
    ]
output = np.concatenate(blocks, axis=1)`)}

Passing a non-contiguous view directly raises \`ValidationError\` with the same guidance.
`);

  add('assets-and-bundles', `
## Asset-required effects

\`FIRCrossover\`, \`FiveBandFIRPEQ\`, \`GroupDelayEQ\`, \`IRReverb\`, and \`RoomEQ\`
require \`assets.impulseResponse\`. FIR filter effects require prepared coefficients at
the processing rate; IR Reverb accepts supported convolution topologies. The resolver
returns Python \`AssetData\` or deterministic ETA1 bytes/\`{bytes, format}\` in
JavaScript. It never relies on repository fixtures.

The examples below run each effect with two distinct caller-owned IRs and require
finite, non-zero, different output. FIR Crossover uses two coefficient channels,
accepts stereo in processing lanes 0 and 1, and routes its two bands to four output
lanes.

Bundle v1 combines Chain JSON with external ETA1 manifests. Python
\`Bundle.pack()\` writes a deterministic directory bundle, and
\`effetune bundle pack CHAIN DESTINATION --asset ID=FILE\` provides the same writer for
decoded IR audio files. Payloads are SHA-256 and size checked, with a 32 MiB cap. ETA1
is little-endian planar float32 with a 32-byte header, optional 12-byte matrix paths,
and explicit rate/channel/topology metadata. ZIP is not part of Bundle v1.

Programmatic and CLI bundle writing:

${codeBlock('python', bundlePackSnippet)}

${codeBlock('console', `effetune bundle pack room-chain.json cli-bundle \\
  --asset room-ir=room-ir.wav
effetune render input.wav convolved.wav --preset cli-bundle --subtype FLOAT`)}

\`--preset cli-bundle/bundle.json\` is equivalent to the Bundle-directory form above.
For WAV output, omitting \`--subtype\` keeps SoundFile's PCM_16 default; use
\`--subtype FLOAT\` when the rendered samples must remain 32-bit floating point.

Python \`AssetData\` examples for all five types:

${codeBlock('python', assetPythonSnippet)}

Use the public \`encodeEta1()\` helper to encode deterministic JavaScript IR data:

${codeBlock('js', assetFixtureSnippet)}

Then run the JavaScript resolver examples for all five types:

${codeBlock('js', assetJavascriptSnippet)}
`);

  add('ml-data-augmentation', `
**Goal:** create repeatable seeded audio degradation without using the EffeTune app.
Use a candidate or verified Python wheel and the canonical experiment fixture.

${codeBlock('python', mlSnippet)}

The same seed must produce byte-identical float32 output in the same installed artifact
and environment. The different seed must change output. All output must remain finite
and within [-1, 1].
`);

  add('schema-driven-agent', `
**Goal:** create only documented Chain JSON and render it without inventing effect or
parameter names.

1. Read the [public effect catalog](/dsp/catalog/effects-v1.json).
2. Constrain output with the [Chain v1 schema](/dsp/schemas/chain-v1.schema.json).
3. Run \`effetune chain validate chain.json\`.
4. Run \`effetune render input.wav output.wav --preset chain.json\`.

Runtime validation still enforces duplicate IDs, assets, and cross-field rules. MCP,
measurement, resampling, ffmpeg, LUFS, and true-peak tools are not v0.1 capabilities.
`);

  add('python-api', `
${installNotice(release, 'python')}

These signatures summarize the typed public surface. The installed \`py.typed\`
package and generated effect stubs remain authoritative for individual effect options;
the 76 effect signatures are not repeated here.

## Effect names and constructor keywords

Generated effect constructors and \`create_effect()\` accept Python \`snake_case\`
keywords. Chain JSON, scheduled event parameter objects, and the machine-readable
catalog keep their semantic names:

${codeBlock('python', `shift = PitchShifter(pitch_shift=3)
same_shift = create_effect("PitchShifter", pitch_shift=3)

chain_document = {
    "version": 1,
    "chain": [{
        "type": "PitchShifter",
        "parameters": {"pitchShift": 3},
    }],
}`)}

\`pitchShift\` is not an alias for the \`pitch_shift\` constructor keyword. Every
effect page lists both names directly from the generated catalog.

## Chain

${codeBlock('python', `Chain(effects: Iterable[Effect] = (), *, asset_resolver: AssetResolver | None = None)
Chain.from_preset(source: Any, *, asset_resolver: AssetResolver | None = None) -> Chain
Chain.from_legacy_preset(source: Any, *, asset_resolver: AssetResolver | None = None) -> tuple[Chain, LegacyImportReport]
Chain.from_bundle(source: str) -> Chain

chain.to_dict() -> dict[str, Any]
chain.process(
    audio: np.ndarray,
    *,
    sample_rate: float,
    seed: int = 0,
    block_size: int = 128,
    asset_resolver: AssetResolver | None = None,
    on_telemetry: Callable[[TelemetryFrame], None] | None = None,
) -> np.ndarray
chain(audio: np.ndarray, sample_rate: float, **options) -> np.ndarray
chain.stream(
    sample_rate: float,
    *,
    channels: int,
    block_size: int = 128,
    seed: int = 0,
    asset_resolver: AssetResolver | None = None,
    on_telemetry: Callable[[TelemetryFrame], None] | None = None,
) -> Stream
chain.latency_samples(
    sample_rate: float,
    *,
    channels: int = 2,
    block_size: int = 128,
    asset_resolver: AssetResolver | None = None,
) -> int`)}

\`process()\` returns a new planar, C-contiguous \`float32\` array and starts fresh
state. \`stream()\` returns a stateful context. \`from_bundle()\` accepts a Bundle
directory or its \`bundle.json\`.

\`latency_samples()\` reports the same aggregate an opened stream would report for that
sample rate and channel layout, without processing audio. Offline \`process()\` output is
not latency-compensated, so use this value to align it against the input.

## Stream

${codeBlock('python', `stream.process(
    audio: np.ndarray,
    *,
    events: Iterable[Mapping[str, object]] = (),
) -> np.ndarray
stream.subscribe(callback: Callable[[TelemetryFrame], None]) -> Callable[[], bool]
stream.unsubscribe(callback: Callable[[TelemetryFrame], None]) -> bool
stream.reset() -> None
stream.close() -> None

stream.closed: bool
stream.latency_samples: int
stream.dropped_telemetry_frames: int`)}

Event parameter objects are partial updates. Events use zero-based frames relative to
the current input, must be in non-decreasing frame order, and merge in supplied order
when several share a frame. A Stream is a context manager; processing, resetting, or
inspecting runtime properties after close raises \`StateError\`.
Asset-configuration parameters listed under
[Streaming and events](/dsp/concepts/streaming-and-events/) require a newly opened
stream.

## Assets and bundles

${codeBlock('python', `AssetData(
    samples: np.ndarray,
    sample_rate: int,
    kind: str = "impulseResponse",
    topology: str = "automatic",
    paths: tuple[ConvolutionPath, ...] = (),
    input_count: int | None = None,
)
ConvolutionPath(input_slot: int, output_slot: int, ir_channel: int)

Bundle.load(source: str | Path) -> Bundle
Bundle.pack(
    destination: str | Path,
    chain: Mapping[str, Any],
    assets: Mapping[str, AssetData | Mapping[str, Any]],
) -> Bundle
bundle.manifest: Mapping[str, Any]
bundle.chain_document: Mapping[str, Any]
bundle.resolver(reference: str) -> AssetData | None`)}

\`AssetData.samples\` must be finite, planar, C-contiguous \`float32\`. Bundle methods
raise \`ValidationError\` for documents/paths and \`AssetError\` for missing, malformed,
oversized, or unverifiable IR assets.

## Telemetry and catalog

\`Chain.process(..., on_telemetry=callback)\`, \`Chain.stream(...,
on_telemetry=callback)\`, and Stream subscriptions deliver decoded
\`TelemetryFrame\` subclasses. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry)
for exact frame fields.

\`EFFECT_METADATA\` is the machine-readable catalog, \`EFFECT_CLASSES\` maps all 76
semantic names to their classes, and
\`create_effect(effect_type: str, **options: object) -> Effect\` is the generic
constructor. \`Stream.latency_samples\` is the live aggregate, distinct from catalog
latency declarations.

## Errors

\`ValidationError\` covers audio, document, event, and option validation;
\`EffectError\` covers unknown effects; \`AssetError\` covers assets and bundles;
\`EffeTuneRuntimeError\` covers backend failures; and \`StateError\` covers invalid
lifecycle operations. All derive from \`EffeTuneError\`.
`);

  add('javascript-api', `
${installNotice(release, 'npm')}

The package is ESM-only. These signatures follow the shipped \`index.d.ts\` and
\`worklet.d.ts\`. The generated declarations remain authoritative for individual
effect options; the ${convenienceExports.exports.length} named class/factory pairs are
not repeated here.

## Chain creation and offline processing

${codeBlock('ts', `createChain(
  input: string | ChainDocumentInput | BundleDocument |
    readonly (Effect | ChainEffectInput)[],
  options?: CreateChainOptions
): Promise<Chain>

class Chain {
  readonly preset: ChainDocument
  readonly effects: readonly ChainEffect[]
  setParam(effectId: string, parameterName: string, value: unknown): this
  reset(): this
  prewarm(options: PrewarmOptions): Promise<this>
  latencySamples(options: {
    sampleRate: number
    channels?: number
    blockSize?: number
  }): Promise<number>
  stream(options: StreamOptions): Promise<ChainStream>
  process(
    audio: readonly Float32Array[],
    options: ProcessOptions
  ): Promise<Float32Array[]>
  close(): void
}`)}

\`ProcessOptions\` requires \`sampleRate\` and optionally accepts \`seed\`,
\`blockSize\`, and \`onTelemetry\`. \`CreateChainOptions\` accepts
\`assetResolver\` plus baseline/SIMD artifact selection and URLs. Offline processing
returns newly owned channels with fresh state. All input channels must have equal
length, and every sample must be finite; non-finite input raises \`ValidationError\`
before native state is reached.

\`latencySamples()\` takes the same option shape as \`prewarm()\` without a seed
(\`channels\` defaults to 2 and \`blockSize\` to 128) and resolves to the aggregate an
opened stream would report for that rate and layout, without processing audio. Offline
\`process()\` output is not latency-compensated, so use this value to align it.

## Stateful stream

${codeBlock('ts', `interface ChainStream {
  readonly preset: ChainDocument
  readonly effects: readonly ChainEffect[]
  readonly latencySamples: number
  readonly droppedTelemetryFrames: number
  subscribe(callback: TelemetryCallback): () => void
  unsubscribe(callback: TelemetryCallback): boolean
  setParam(effectId: string, parameterName: string, value: unknown): this
  reset(): this
  process(
    audio: readonly Float32Array[],
    options?: { events?: readonly ParameterEvent[] }
  ): Promise<Float32Array[]>
  close(): void
}`)}

\`StreamOptions\` requires \`sampleRate\` and optionally accepts \`channels\`,
\`seed\`, \`blockSize\`, and \`onTelemetry\`. Event parameter objects are partial
updates applied in input order. Rejected non-finite blocks do not change stream state.
\`latencySamples\` is the live aggregate and is numerically symmetric with Python
\`Stream.latency_samples\`. Asset-configuration parameters listed under
[Streaming and events](/dsp/concepts/streaming-and-events/) require a newly opened
stream and are rejected before processing.

## ETA1 and catalog

${codeBlock('ts', `encodeEta1(options: {
  channels: readonly Float32Array[]
  sampleRate: number
  topology?: "unspecified" | "mono" | "independent" | "trueStereo" | "matrix"
  paths?: readonly MatrixPath[]
}): ArrayBuffer

getEffectCatalog(): Readonly<{
  version: 1
  channels: readonly EffectChannel[]
  effects: readonly Readonly<Record<string, unknown>>[]
}>
const EFFECT_CATALOG: ReturnType<typeof getEffectCatalog>
createEffect<T extends EffectType>(
  type: T,
  ...options: T extends RequiredAssetEffectType
    ? [options: EffectOptionsByType[T]]
    : [options?: EffectOptionsByType[T]]
): EffectClassByType[T]`)}

\`encodeEta1()\` validates finite, equal-length planar channels and matrix paths.
\`EFFECT_CATALOG\`, \`EFFECT_CLASSES\`, and all 76 root class/factory pairs cover the
same semantic catalog as Python without private implementation data.

## AudioWorklet

${codeBlock('ts', `EffeTuneNode.create(
  context: BaseAudioContext,
  input: string | ChainDocumentInput | BundleDocument |
    readonly (Effect | ChainEffectInput)[],
  options?: EffeTuneNodeOptions
): Promise<EffeTuneNode>

node.subscribe(callback: TelemetryCallback): () => void
node.unsubscribe(callback: TelemetryCallback): boolean
node.setParam(effectId: string, parameterName: string, value: unknown): Promise<void>
node.reset(): Promise<void>
node.close(): void
node.droppedTelemetryFrames: number`)}

Import \`EffeTuneNode\` from \`@effetune/dsp/worklet\`. It has no latency getter and
does not accept scheduled frame events. See
[Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry) for decoded
telemetry frame fields. Asset-configuration parameters listed under
[Streaming and events](/dsp/concepts/streaming-and-events/) cannot be changed on an
open node.

## Other exports and errors

\`parsePreset()\`, \`importLegacyPreset()\`, and \`isBundleDocument()\` handle semantic
documents. The public package entry points are derived from the package export map:

${npmExportTable(npmPackage)}

\`ValidationError\` covers audio/documents/options,
\`EffectError\` unknown effects, \`AssetError\` assets, \`EffeTuneRuntimeError\`
backend failures, and \`StateError\` invalid lifecycle operations.
`);

  add('chain-v1', `
The [raw schema](/dsp/schemas/chain-v1.schema.json) is authoritative. A document has
\`version: 1\` and ordered \`chain\` items. IDs are unique when present; semantic types,
parameters, channels, enabled state, and asset references reject unknown fields.
Some asset and cross-field rules require runtime validation after schema validation.
`);

  add('bundle-v1', `
The [raw schema](/dsp/schemas/bundle-v1.schema.json) is authoritative. A Bundle contains
Chain v1 plus external asset manifests with ID, reference, SHA-256, byte length, and
ETA1 format. Python \`Bundle.pack()\` and \`effetune bundle pack\` write this directory
layout; JavaScript \`encodeEta1()\` writes canonical ETA1 bytes for resolvers. The
resolver verifies hash, size, rate, channel, topology, and cross-field rules before
processing. ZIP containers are outside v1.
`);

  add('compatibility', `
Python wheels cover CPython 3.10+ on manylinux x86-64, Windows AMD64, macOS Intel, and
macOS Apple Silicon; musllinux is not provided. Node.js \`>=18\` is required. Chromium
is acceptance-tested. Other evergreen browsers are designed for but unverified.
AudioWorklet support requires HTTPS or localhost; direct \`file:\` loading is unsupported.
The npm package is ESM-only; use \`.mjs\` or a consumer package with
\`"type": "module"\`. CommonJS \`require()\` is unsupported.

The core does not decode, encode, resample, call ffmpeg, host VST/AU, or expose public
integrated-LUFS/true-peak measurement.

## Analyzers and telemetry

\`LevelMeter\`, \`Oscilloscope\`, \`SpectrumAnalyzer\`, \`Spectrogram\`, and
\`StereoMeter\` expose decoded semantic observations in Python, JavaScript offline and
streaming processing, and AudioWorklet. Telemetry is opt-in: the first callback or
subscriber enables it and the last unsubscribe disables it. Long renders drain after
every processing block. Public frames identify the semantic effect and contain owned
arrays; binary frame types, versions, tap IDs, payload bytes, and Worklet transport stay
private. Unknown or malformed frames are discarded.

Common metadata:

| JavaScript / Python | Meaning |
|---|---|
| \`kind\` / \`kind\` | \`level\`, \`oscilloscope\`, \`spectrum\`, \`spectrogram\`, or \`stereo\` |
| \`effectType\` / \`effect_type\` | Semantic effect type |
| \`effectId\` / \`effect_id\` | Declared effect ID, or null / \`None\` |
| \`effectIndex\` / \`effect_index\` | Zero-based position in the declared DSP chain |
| \`sequence\` / \`sequence\` | Per-tap telemetry sequence number |
| \`dropped\` / \`dropped\` | Frames lost since the previous decoded delivery |

Analyzer fields:

| Kind | JavaScript / Python | Unit and shape / order |
|---|---|---|
| Level | \`channels\` / \`channels\` | Processing-channel order; each item has linear-amplitude \`peak\`, linear-amplitude \`rms\`, and boolean \`clipped\` (a sample exceeded full scale) |
| Oscilloscope | \`sampleRate\` / \`sample_rate\` | Hz |
| Oscilloscope | \`captureSampleCount\` / \`capture_sample_count\` | Samples in the full capture |
| Oscilloscope | \`triggerOffset\` / \`trigger_offset\` | Trigger position in samples from capture start |
| Oscilloscope | \`triggered\` / \`triggered\` | True for a real trigger; false for an automatic sweep |
| Oscilloscope | \`encoding\` / \`encoding\` | \`samples\` for raw points or \`minMax\` for ordered envelope points |
| Oscilloscope | \`sampleIndices\` / \`sample_indices\` | \`[point]\` capture indices, paired by position with \`values\` |
| Oscilloscope | \`values\` / \`values\` | \`[point]\` linear-amplitude values |
| Spectrum | \`sampleRate\` / \`sample_rate\` | Hz |
| Spectrum | \`points\` / \`points\` | FFT size exponent; FFT size is \`2 ** points\` |
| Spectrum | \`binsTruncated\` / \`bins_truncated\` | True when the highest bins were omitted to fit transport capacity |
| Spectrum | \`currentDb\` / \`current_db\` | dBFS \`[bin]\`, ascending frequency from DC |
| Spectrum | \`peakDb\` / \`peak_db\` | Peak-held dBFS \`[bin]\`, same order and length as current |
| Spectrogram | \`sampleRate\` / \`sample_rate\` | Hz |
| Spectrogram | \`timeSeconds\` / \`time_seconds\` | Observation time in seconds on the processing timeline |
| Spectrogram | \`points\` / \`points\` | FFT size exponent; FFT size is \`2 ** points\` |
| Spectrogram | \`intensities\` / \`intensities\` | \`uint8[256]\` display intensity, high-to-low log-frequency cells from index 0 through 255 |
| Stereo | \`sampleRate\` / \`sample_rate\` | Hz |
| Stereo | \`discontinuity\` / \`discontinuity\` | True when the sample delta is incomplete after truncation or a window change |
| Stereo | \`samples\` / \`samples\` | JavaScript \`Float32Array[side0, mid0, ...]\`; Python \`tuple[(side, mid), ...]\`; linear amplitude where side is R-L and mid is L+R |
| Stereo | \`envelope\` / \`envelope\` | Linear-amplitude \`[360]\` polar-angle bins in index order |
| Stereo | \`correlation\` / \`correlation\` | Unitless stereo correlation in [-1, 1] |
| Stereo | \`balance\` / \`balance\` | Right-versus-left energy balance in dB |
| Stereo | \`peakLeft\` / \`peak_left\` | Left linear-amplitude peak |
| Stereo | \`peakRight\` / \`peak_right\` | Right linear-amplitude peak |

\`frame.dropped\` reports loss since the previous decoded delivery. By contrast,
\`dropped_telemetry_frames\` on a Python stream and \`droppedTelemetryFrames\` on a
JavaScript stream or node are cumulative for that object's lifetime.

Telemetry stays local: the library only passes decoded frames to in-process Python
callbacks or callbacks in the browser page. It does not automatically collect, persist,
or send telemetry over the network, and it does not collect device or user identifiers.

Other catalog telemetry remains metadata-only in v0.1. Integrated LUFS, BS.1770/EBU
R128, true peak, and dynamics gain-reduction observations are not part of this API.
`);

  add('verification', `
The frozen wrapper reference origin is 71 JavaScript-derived cases plus 5 native
direct-double cases. Maintainers run:

${codeBlock('console', 'node tools/verify-dsp-library-goldens.mjs')}

See the stable [DSP Library workflow and runs](https://github.com/Frieve-A/effetune/actions/workflows/dsp-library-ci.yml).
CI acceptance summaries are temporary workflow artifacts, not public Release assets.
The repository Chromium harness uses a special \`file:\` flag; that exception is not a
public browser-support claim.
`);

  add('release-integrity', `
EffeTune is MIT licensed. Python wheels include PFFFT and nanobind notices; the npm
tarball includes the PFFFT notice. Release automation builds and clean-installs
candidates, checks goldens, emits checksums, an SPDX SBOM, and provenance attestations.

${installNotice(release, 'python')}
${installNotice(release, 'npm')}
${installNotice(release, 'githubRelease')}

Only an existing, version-verified public asset receives a link. A surface can be
\`published-unverified\` independently; mismatched verified versions form a
partial/incomplete release cohort rather than changing that surface status.
`);

  add('faq', `
**Why does the registry return 404?** The package is not yet published or its smoke test
is incomplete. Use the CI candidate named by the release process; do not install an
older version and assume it matches these docs.

**Why does my Python array fail?** Use finite C-contiguous planar \`float32\` shaped
\`(channels, frames)\`.

**Why was JavaScript audio rejected?** Every \`Float32Array\` sample must be finite.
\`NaN\` and positive or negative infinity are rejected before native processing, so a
bad stream block can be fixed and retried without resetting the stream.

**Why does Worklet loading fail?** Use HTTPS/localhost and verify same-origin URLs,
MIME types, CSP, processor/WASM/meta files, and a resumed AudioContext. Direct
\`file:\` loading is unsupported.

**Does the library decode, encode, resample, call ffmpeg, or measure loudness?** No.
Those are caller responsibilities in v0.1.

**Why do offline and streaming output differ?** Offline starts fresh. Streams retain
history and require the same block/event schedule for reproduction.

**Why is an IR rejected?** Check resolver output, SHA-256, byte length, ETA1 topology,
rate, channel mapping, and the 32 MiB cap.

## Errors

\`ValidationError\` covers document/parameter failures, \`EffectError\` unknown effects,
\`AssetError\` resolver/asset failures, runtime errors backend failures, and state errors
invalid lifecycle operations. Show users a plain-language cause and next action; send
technical diagnostics to the developer console.
`);
  return pages;
}

function localizedOverview(locale, resource, release, permalink) {
  const statuses = Object.entries(release.surfaces).map(([surface, state]) =>
    `- ${surface}: **${resource[state.status] ?? resource.unreleased}**` +
    `${state.verifiedVersion ? ` (${state.verifiedVersion})` : ''}`
  );
  return [
    '---',
    'layout: dsp',
    `title: ${JSON.stringify(resource.title)}`,
    `description: ${JSON.stringify(resource.coverage)}`,
    `lang: ${locale}`,
    `permalink: ${permalink}`,
    '---',
    '',
    `# ${resource.title}`,
    '',
    resource.coverage,
    '',
    `Documentation version: **${release.docsVersion}**`,
    `Release cohort: **${releaseCohort(release)}**`,
    '',
    '<!-- DSP-RELEASE-NOTICE -->',
    '',
    `## ${resource.release}`,
    '',
    ...statuses,
    '',
    `- [${resource.fullDocs}](/dsp/)`,
    `- [${resource.demo}](/dsp/demo/)`,
    `- [${resource.chainSchema}](/dsp/schemas/chain-v1.schema.json)`,
    `- [${resource.bundleSchema}](/dsp/schemas/bundle-v1.schema.json)`,
    ''
  ].join('\n');
}

export function packageSummary(sources, surface) {
  const version = sources.npmPackage.version;
  const effectCount = sources.catalog.effects.length;
  if (surface === 'python') {
    return [
      'EffeTune is a deterministic audio-effects library backed by the same',
      `host-neutral C++20 DSP core used by the EffeTune application. Version ${version}`,
      `provides ${effectCount} semantic effect classes, ordered serial chains, stateful block`,
      'processing, semantic presets, bounded impulse-response bundles, and a small',
      'audio-file CLI.'
    ].join('\n');
  }
  if (surface === 'javascript') {
    return [
      'EffeTune DSP provides the same MIT-licensed C++ audio kernels used by EffeTune',
      'as a self-contained WebAssembly package for Node.js and evergreen browsers.',
      `Version ${version} exposes all ${effectCount} catalog types through the generic Chain and`,
      `\`createEffect\` APIs and ${sources.convenienceExports.exports.length} generated named convenience classes,`,
      'decoded analyzer telemetry, versioned semantic presets, deterministic seeds, and an AudioWorklet wrapper.'
    ].join('\n');
  }
  fail(`Unknown package summary surface: ${surface}`);
}

function replaceGeneratedBlock(source, descriptor, sources) {
  const begin = `<!-- BEGIN ${descriptor.marker} -->`;
  const end = `<!-- END ${descriptor.marker} -->`;
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  if (start === -1 || finish === -1 || finish < start) {
    fail(`${descriptor.output} is missing the ${descriptor.marker} marker pair.`);
  }
  let contents;
  if (descriptor.summary) {
    contents = packageSummary(sources, descriptor.summary);
  } else {
    const snippet = read(resolveUnderRoot(
      path.join(docsDataRoot, 'snippets'),
      descriptor.snippet,
      `Non-route snippet ${descriptor.id}`
    ));
    contents = descriptor.language === 'markdown'
      ? snippet.trimEnd()
      : [
          ...(descriptor.install
            ? [codeBlock('console', descriptor.install), '']
            : []),
          codeBlock(descriptor.language, snippet)
        ].join('\n');
  }
  const replacement = [
    begin,
    contents,
    end
  ].join('\n');
  return source.slice(0, start) + replacement +
    source.slice(finish + end.length);
}

function publicCatalog(catalog, overlay) {
  return {
    ...catalog,
    effects: catalog.effects.map(effect => {
      const docs = overlay.effects[effect.type];
      const overlap = docsOverlayFields.filter(field => Object.hasOwn(effect, field));
      if (overlap.length) {
        fail(`Docs overlay collides with binding fields for ${effect.type}: ${overlap.join(', ')}`);
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

function llmsText(sources) {
  const { catalog, release, npmPackage } = sources;
  return [
    '# EffeTune DSP Library',
    '',
    `Version: ${release.docsVersion}`,
    'Python package: effetune',
    `npm package: ${npmPackage.name}`,
    `Catalog entries: ${catalog.effects.length}`,
    `Release state: ${releaseSummary(release)}`,
    '',
    'Canonical resources:',
    '- https://effetune.frieve.com/dsp/',
    '- https://effetune.frieve.com/dsp/catalog/effects-v1.json',
    '- https://effetune.frieve.com/dsp/schemas/chain-v1.schema.json',
    '- https://effetune.frieve.com/dsp/schemas/bundle-v1.schema.json',
    '- https://effetune.frieve.com/dsp/getting-started/python/',
    '- https://effetune.frieve.com/dsp/getting-started/javascript/',
    '- https://effetune.frieve.com/dsp/concepts/determinism/',
    '- https://effetune.frieve.com/dsp/reference/compatibility/',
    '',
    'MCP, measurement, resampling, ffmpeg, integrated LUFS, and true-peak APIs are not implemented in v0.1.',
    ''
  ].join('\n');
}

function navYaml(routes) {
  const byId = routeMap(routes);
  const lines = ['# Generated from examples/dsp-library/docs/routes-v0.1.json.', 'groups:'];
  for (const group of routes.navigation.groups) {
    lines.push(`  - label: ${JSON.stringify(group.label)}`, '    links:');
    for (const id of group.routeIds) {
      const route = byId.get(id);
      lines.push(
        `      - title: ${JSON.stringify(route.title)}`,
        `        url: ${JSON.stringify(route.path)}`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function generatedOutputs(sources) {
  const { catalog, overlay, mapping, routes, release, locales } = sources;
  routeMap(routes);
  const appSections = extractAppSections(catalog, overlay, mapping);
  const outputs = staticPages(sources);
  outputs.set(
    routeOutput(routes, 'landing'),
    landingPage(catalog, release, sources.convenienceExports)
  );
  outputs.set(
    routeOutput(routes, 'effects'),
    effectsIndex(catalog, overlay)
  );
  for (const effect of catalog.effects) {
    const entry = overlay.effects[effect.type];
    const slug = entry.slug ?? slugForType(effect.type);
    outputs.set(
      routeOutput(routes, 'effect', { 'effect-slug': slug }),
      effectPage(effect, entry, appSections.get(effect.type))
    );
  }
  outputs.set(
    routeOutput(routes, 'catalog'),
    `${JSON.stringify(publicCatalog(catalog, overlay), null, 2)}\n`
  );
  outputs.set(routeOutput(routes, 'llms'), llmsText(sources));
  outputs.set(
    resolveUnderRoot(repoRoot, routes.navigation.output, 'Navigation output'),
    navYaml(routes)
  );
  for (const locale of routes.localizedOverviews.locales) {
    const relative = routes.localizedOverviews.output.replace('{locale}', locale);
    const permalink = expandPublicPath(
      routes.localizedOverviews.path,
      { locale },
      `Localized overview path ${locale}`
    );
    outputs.set(
      resolveUnderRoot(repoRoot, relative, `Localized overview output ${locale}`),
      localizedOverview(
        locale,
        locales[locale] ?? locales.en,
        release,
        permalink
      )
    );
  }
  for (const descriptor of routes.nonRouteOutputs) {
    const filePath = resolveUnderRoot(
      repoRoot,
      descriptor.output,
      `Non-route output ${descriptor.id}`
    );
    outputs.set(
      filePath,
      replaceGeneratedBlock(
        outputs.get(filePath) ?? read(filePath),
        descriptor,
        sources
      )
    );
  }
  const declared = new Set([
    ...routes.routes
      .filter(route => route.status === 'launch' && route.output && !route.dynamic)
      .map(route => resolveUnderRoot(
        repoRoot,
        route.output,
        `Route ${route.id} output`
      )),
    ...catalog.effects.map(effect => {
      const docs = overlay.effects[effect.type];
      return routeOutput(routes, 'effect', {
        'effect-slug': docs.slug ?? slugForType(effect.type)
      });
    }),
    ...routes.localizedOverviews.locales.map(locale => resolveUnderRoot(
      repoRoot,
      routes.localizedOverviews.output.replace('{locale}', locale),
      `Localized overview output ${locale}`
    )),
    resolveUnderRoot(repoRoot, routes.navigation.output, 'Navigation output'),
    ...routes.nonRouteOutputs.map(descriptor =>
      resolveUnderRoot(
        repoRoot,
        descriptor.output,
        `Non-route output ${descriptor.id}`
      )
    )
  ]);
  const actual = new Set(outputs.keys());
  const undeclared = [...actual].filter(filePath => !declared.has(filePath));
  const missing = [...declared].filter(filePath => !actual.has(filePath));
  if (undeclared.length || missing.length) {
    fail(`Generator output contract mismatch: undeclared=${undeclared.length}, missing=${missing.length}.`);
  }
  return outputs;
}

function updateOutputs(outputs, check) {
  const stale = [];
  for (const [filePath, contents] of outputs) {
    const current = fs.existsSync(filePath) ? read(filePath) : null;
    if (current === contents) continue;
    stale.push(path.relative(repoRoot, filePath).replaceAll('\\', '/'));
    if (!check) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents, 'utf8');
    }
  }
  return stale;
}

export function runDocsGenerator({ check = false } = {}) {
  const sources = loadSources();
  const outputs = generatedOutputs(sources);
  const stale = updateOutputs(outputs, check);
  return { sources, outputs, stale };
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(argument => argument !== '--check');
  if (unknown.length) fail(`Unknown argument(s): ${unknown.join(', ')}`);
  const check = args.includes('--check');
  const { sources, stale } = runDocsGenerator({ check });
  if (check && stale.length) {
    console.error('DSP documentation outputs are stale:');
    for (const file of stale) console.error(`  ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `${check ? 'Checked' : 'Generated'} ${sources.catalog.effects.length} effect pages ` +
    `and the v${sources.release.docsVersion} DSP documentation tree.`
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
