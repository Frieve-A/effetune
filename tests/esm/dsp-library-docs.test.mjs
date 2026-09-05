import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  expandPublicPath,
  packageSummary,
  routeMap,
  runDocsGenerator,
  validateEffectSlug,
  validateManifestRelativePath,
  validatePublicPath,
  validatePublicRoot
} from '../../examples/dsp-library/generate-docs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bindingCatalog = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.json'),
  'utf8'
));
const publicCatalog = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'docs', 'dsp', 'catalog', 'effects-v1.json'),
  'utf8'
));
const overlay = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'examples', 'dsp-library', 'docs', 'effects-v1.docs.json'),
  'utf8'
));
const routes = JSON.parse(fs.readFileSync(path.join(
  repoRoot, 'examples', 'dsp-library', 'docs', 'routes-v0.1.json'
), 'utf8'));
const npmPackage = JSON.parse(fs.readFileSync(path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'package.json'
), 'utf8'));

function generatedRoute(outputs, routeId) {
  const route = routes.routes.find(entry => entry.id === routeId);
  assert.ok(route?.output, `Missing generated route output: ${routeId}`);
  return outputs.get(path.resolve(repoRoot, route.output));
}

function slugForType(type) {
  return type
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function snakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

test('DSP documentation outputs are deterministic and catalog-complete', () => {
  const { stale } = runDocsGenerator({ check: true });
  assert.deepEqual(stale, []);
  assert.deepEqual(
    publicCatalog.effects.map(effect => effect.type),
    bindingCatalog.effects.map(effect => effect.type)
  );
  assert.deepEqual(publicCatalog.contractDigests, bindingCatalog.contractDigests);
  for (const [index, effect] of publicCatalog.effects.entries()) {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(effect).filter(([key]) =>
          !['displayName', 'category', 'summary', 'sourceGenerating', 'slug'].includes(key)
        )
      ),
      bindingCatalog.effects[index]
    );
    const page = fs.readFileSync(path.join(
      repoRoot,
      'docs',
      'dsp',
      'effects',
      overlay.effects[effect.type].slug ?? slugForType(effect.type),
      'index.md'
    ), 'utf8');
    assert.match(page, /The following section is reproduced from the English EffeTune app documentation/);
    assert.match(page, new RegExp(`Semantic type: \\\`${effect.type}\\\``));
    if (effect.parameters.length > 0) {
      assert.match(page, /\| Semantic name \| Python constructor keyword \|/);
      for (const parameter of effect.parameters) {
        assert.ok(
          page.includes(`| \`${parameter.name}\` | \`${snakeCase(parameter.name)}\` |`),
          `${effect.type}.${parameter.name}`
        );
      }
    }
  }
});

test('cross-language contract snippets use the generated catalog count', () => {
  const count = bindingCatalog.effects.length;
  const snippets = path.join(
    repoRoot,
    'examples',
    'dsp-library',
    'docs',
    'snippets'
  );
  const python = fs.readFileSync(
    path.join(snippets, 'cross-language-contract.py'),
    'utf8'
  );
  const javascript = fs.readFileSync(
    path.join(snippets, 'cross-language-contract.mjs'),
    'utf8'
  );

  assert.ok(python.includes(`assert len(types) == ${count}`));
  assert.ok(javascript.includes(`types.length, ${count})`));
});

test('DSP landing explains the cross-surface workflow without competitor framing', () => {
  const { sources } = runDocsGenerator({ check: true });
  const landing = fs.readFileSync(path.join(repoRoot, 'docs', 'dsp-library.md'), 'utf8');

  assert.match(
    landing,
    new RegExp(
      `${sources.catalog.effects.length} catalog-registered effects, analyzers, and utilities`
    )
  );
  assert.match(landing, /same host-neutral C\+\+20 core/);
  assert.match(
    landing,
    new RegExp(
      `${sources.convenienceExports.exports.length} generated named class/factory pairs`
    )
  );
  for (const [label, startPath] of [
    ['Python Start', '/dsp/getting-started/python/'],
    ['JavaScript Start', '/dsp/getting-started/javascript/'],
    ['AudioWorklet Start', '/dsp/getting-started/audioworklet/'],
    ['CLI Start', '/dsp/getting-started/cli/']
  ]) {
    assert.match(landing, new RegExp(`\\[${label}\\]\\(${startPath}`));
  }
  assert.match(landing, /Seeded execution is repeatable when the input, sample rate/);
  assert.match(landing, /Source-generating effects require an explicit frame count/);
  assert.match(landing, /stateful effects make block and event history relevant/);
  assert.match(landing, /What stays consistent \{#library-strengths\}/);
  assert.match(
    landing,
    /Five analyzers expose opt-in decoded observations in v0\.1/
  );
  assert.match(landing, /all other catalog telemetry remains metadata-only/);
  assert.doesNotMatch(landing, /v0\.1 has no public observation API/);
  assert.doesNotMatch(landing, /Pedalboard|Spotify|When to choose|comparison/i);
});

test('IR effect documentation reproduces the app .irs import guidance', () => {
  const { outputs } = runDocsGenerator({ check: true });
  const route = routes.routes.find(entry => entry.id === 'effect');
  const page = outputs.get(path.resolve(
    repoRoot,
    route.output.replace('{effect-slug}', 'ir-reverb')
  ));
  assert.match(
    page,
    /WAV audio with an `\.irs` filename extension can be imported without renaming it\./
  );
});

test('DSP pages inherit the shared documentation layout and visual system', () => {
  const dspLayout = fs.readFileSync(path.join(repoRoot, '_layouts', 'dsp.html'), 'utf8');
  const defaultLayout = fs.readFileSync(path.join(repoRoot, '_layouts', 'default.html'), 'utf8');
  const siteCss = fs.readFileSync(path.join(repoRoot, 'assets', 'css', 'site.css'), 'utf8');

  assert.match(dspLayout, /^---\r?\nlayout: default\r?\n---/);
  assert.doesNotMatch(dspLayout, /<!doctype html>|dsp-shell|dsp-nav|<style>/);
  assert.match(dspLayout, /data-dsp-effect-filter/);

  assert.match(defaultLayout, /page\.layout == 'dsp'/);
  assert.match(defaultLayout, /site\.data\["dsp-nav"\]\.groups/);
  assert.match(defaultLayout, /class="docs-shell"/);
  assert.match(defaultLayout, /class="markdown-body doc-content"/);
  assert.match(defaultLayout, /data-page-toc/);

  assert.match(siteCss, /\.button,\r?\n\.dsp-cta \{/);
  assert.match(siteCss, /\.sidebar-search input,\r?\n\[data-dsp-effect-filter\] \{/);
  assert.match(siteCss, /\.dsp-demo-frame \{[^}]*min-height: 42rem;/s);
  assert.match(siteCss, /@media \(max-width: 520px\) \{[\s\S]*\.dsp-demo-frame \{[^}]*min-height: 58rem;/);
});

test('DSD activation, latency declarations, and execution seed stay distinct', () => {
  const dsd = publicCatalog.effects.find(effect => effect.type === 'DSD64IMDSimulator');
  assert.equal(dsd.minimumSampleRate, 88200);
  assert.equal(dsd.effectiveDelaySamples, 63);
  assert.equal(dsd.latency.kind, 'zero');
  const page = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'effects', 'dsd64-imd-simulator', 'index.md'
  ), 'utf8');
  assert.match(page, /lower rates are accepted and use dry passthrough/);
  assert.match(page, /Effective delay on the active processing path: \*\*63 samples\*\*/);
  const determinism = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'concepts', 'determinism', 'index.md'
  ), 'utf8');
  assert.match(determinism, /execution seed defaults to 0 and is an unsigned 32-bit integer/);
  assert.match(determinism, /`BitCrusher\.seed`/);
});

test('localized DSP pages remain short versioned entry points', () => {
  for (const locale of ['ar', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const source = fs.readFileSync(path.join(
      repoRoot, 'docs', 'i18n', locale, 'dsp-library.md'
    ), 'utf8');
    assert.ok(source.split('\n').length < 40, locale);
    const escapedVersion = npmPackage.version.replaceAll('.', '\\.');
    assert.match(
      source,
      new RegExp(`Documentation version: \\*\\*${escapedVersion}\\*\\*`)
    );
    assert.match(source, new RegExp(`v${escapedVersion}`));
    assert.match(source, /\]\(\/dsp\/\)/);
    assert.match(source, /\]\(\/dsp\/demo\/\)/);
  }
});

test('every install surface always documents an unpinned install command', () => {
  const { outputs } = runDocsGenerator({ check: true });
  const commands = {
    python: 'pip install effetune',
    npm: 'npm install @effetune/dsp'
  };
  const pinned = new RegExp(
    `(?:pip install effetune|npm install @effetune/dsp)[=@]${
      npmPackage.version.replaceAll('.', '\\.')
    }\\n`
  );
  for (const route of routes.routes.filter(entry => entry.installSurfaces?.length)) {
    const source = generatedRoute(outputs, route.id);
    assert.ok(source, route.id);
    for (const surface of route.installSurfaces) {
      const command = commands[surface];
      assert.ok(command, `Unknown install surface: ${surface}`);
      assert.match(source, new RegExp(`\`\`\`console\\n${command}\\n`), `${route.id}:${surface}`);
      assert.doesNotMatch(source, pinned, `${route.id}:${surface}`);
    }
  }

  const landing = generatedRoute(outputs, 'landing');
  assert.doesNotMatch(landing, /is-disabled/);
  assert.doesNotMatch(landing, /dsp-release-state/);
});

test('route and non-route manifests declare every generated output', () => {
  const { outputs, sources } = runDocsGenerator({ check: true });
  const actual = new Set([...outputs.keys()].map(filePath =>
    path.relative(repoRoot, filePath).replaceAll('\\', '/')
  ));
  for (const route of routes.routes.filter(route => route.output && !route.dynamic)) {
    assert.ok(actual.has(route.output), route.id);
  }
  for (const effect of bindingCatalog.effects) {
    const slug = overlay.effects[effect.type].slug ?? slugForType(effect.type);
    assert.ok(actual.has(routes.routes.find(route => route.id === 'effect')
      .output.replace('{effect-slug}', slug)));
  }
  assert.ok(actual.has(routes.navigation.output));
  for (const descriptor of routes.nonRouteOutputs) {
    assert.ok(actual.has(descriptor.output), descriptor.id);
    const readme = fs.readFileSync(path.join(repoRoot, descriptor.output), 'utf8');
    const canonical = descriptor.summary
      ? packageSummary(sources, descriptor.summary)
      : fs.readFileSync(path.join(
          repoRoot,
          'examples',
          'dsp-library',
          'docs',
          'snippets',
          descriptor.snippet
        ), 'utf8').trimEnd();
    assert.ok(readme.includes(canonical), descriptor.id);
    if (descriptor.install) assert.ok(readme.includes(descriptor.install));
    assert.equal(readme.split(`<!-- BEGIN ${descriptor.marker} -->`).length, 2);
    assert.equal(readme.split(`<!-- END ${descriptor.marker} -->`).length, 2);
  }
});

test('package README summaries derive version and surface counts from authorities', () => {
  const { sources } = runDocsGenerator({ check: true });
  const python = packageSummary(sources, 'python');
  const javascript = packageSummary(sources, 'javascript');
  assert.match(python, new RegExp(`Version ${sources.npmPackage.version}`));
  assert.match(
    python,
    new RegExp(`provides ${sources.catalog.effects.length} semantic effect classes`)
  );
  assert.match(javascript, new RegExp(`Version ${sources.npmPackage.version}`));
  assert.match(
    javascript,
    new RegExp(`all ${sources.catalog.effects.length} catalog types`)
  );
  assert.match(
    javascript,
    new RegExp(
      `${sources.convenienceExports.exports.length} generated named convenience`
    )
  );
});

test('analyzer telemetry documentation matches the public Phase 1 facade', () => {
  const compatibility = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'reference', 'compatibility', 'index.md'
  ), 'utf8');
  for (const type of [
    'LevelMeter',
    'Oscilloscope',
    'SpectrumAnalyzer',
    'Spectrogram',
    'StereoMeter'
  ]) {
    assert.match(compatibility, new RegExp(`\\\`${type}\\\``));
  }
  assert.match(compatibility, /first callback or\s+subscriber enables it/);
  assert.match(compatibility, /binary frame types, versions, tap IDs/);
  assert.match(compatibility, /Unknown or malformed frames are discarded/);
  assert.match(compatibility, /`effectType` \/ `effect_type`/);
  assert.match(compatibility, /`currentDb` \/ `current_db`/);
  assert.match(
    compatibility,
    /`intensities` \/ `intensities`.*high-to-low log-frequency cells from index 0 through 255/
  );
  assert.match(
    compatibility,
    /JavaScript `Float32Array\[side0, mid0, \.\.\.\]`; Python `tuple\[\(side, mid\), \.\.\.\]`/
  );
  assert.match(
    compatibility,
    /`frame\.dropped` reports loss since the previous decoded delivery/
  );
  assert.match(compatibility, /cumulative for that object's lifetime/);
  assert.match(
    compatibility,
    /does not automatically collect, persist,\s+or send telemetry over the network/
  );
  assert.match(compatibility, /does not collect device or user identifiers/);
  assert.match(compatibility, /Integrated LUFS/);

  const python = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'python', 'index.md'
  ), 'utf8');
  assert.match(python, /on_telemetry=callback/);
  assert.match(python, /dropped_telemetry_frames/);

  const javascript = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'javascript', 'index.md'
  ), 'utf8');
  assert.match(javascript, /onTelemetry/);
  assert.match(javascript, /droppedTelemetryFrames/);
});

test('FAQ and release integrity point at the latest published packages', () => {
  const { outputs } = runDocsGenerator({ check: true });
  const version = npmPackage.version;
  const faq = generatedRoute(outputs, 'faq');
  assert.match(faq, /```console\npip install effetune\n```/);
  assert.match(faq, /```console\nnpm install @effetune\/dsp\n```/);
  assert.ok(faq.includes(`pip install effetune==${version}`), 'pinning example');
  assert.ok(faq.includes(`npm install @effetune/dsp@${version}`), 'pinning example');

  const integrity = generatedRoute(outputs, 'release-integrity');
  assert.ok(integrity.includes(`v${version}`), 'documented version');
  for (const page of [faq, integrity]) {
    assert.doesNotMatch(page, /intentionally disabled|verification pending|release cohort/i);
  }
});

test('navigation authority rejects missing, duplicate, and non-launch route IDs', () => {
  assert.doesNotThrow(() => routeMap(routes));
  const duplicate = structuredClone(routes);
  duplicate.navigation.groups[1].routeIds.push('landing');
  assert.throws(() => routeMap(duplicate), /duplicated: landing/);
  const missing = structuredClone(routes);
  missing.navigation.groups[0].routeIds[0] = 'missing-route';
  assert.throws(() => routeMap(missing), /missing: missing-route/);
  const nonLaunch = structuredClone(routes);
  nonLaunch.navigation.groups[0].routeIds[0] = 'library-strengths';
  assert.throws(() => routeMap(nonLaunch), /must be a launch route/);
});

test('manifest paths and explicit effect slugs fail closed', () => {
  assert.equal(validateEffectSlug('safe-lower-kebab'), 'safe-lower-kebab');
  for (const slug of ['Unsafe', '../escape', 'double--dash', 'trailing-']) {
    assert.throws(() => validateEffectSlug(slug), /lower-kebab-case/);
  }
  assert.equal(
    validateManifestRelativePath(
      'docs/dsp/effects/{effect-slug}/index.md',
      'effect route',
      ['effect-slug']
    ),
    'docs/dsp/effects/{effect-slug}/index.md'
  );
  for (const unsafe of [
    '../outside.md',
    '/absolute.md',
    'docs\\windows.md',
    'docs//empty.md',
    'docs/{unknown}/index.md'
  ]) {
    assert.throws(
      () => validateManifestRelativePath(
        unsafe,
        'unsafe route',
        ['effect-slug']
      ),
      /relative POSIX path|unsafe path segment|unsupported/
    );
  }
  const escapedRoute = structuredClone(routes);
  escapedRoute.nonRouteOutputs[0].output = '../README.md';
  assert.throws(() => routeMap(escapedRoute), /unsafe path segment/);
});

test('public route paths stay canonical, rooted, and placeholder-driven', () => {
  assert.equal(validatePublicRoot('/dsp/'), '/dsp/');
  for (const invalid of ['dsp/', '/dsp', '/DSP/', '/dsp//']) {
    assert.throws(() => validatePublicRoot(invalid), /public path/);
  }
  assert.equal(
    validatePublicPath(
      '/dsp/effects/{effect-slug}/',
      'effect path',
      '/dsp/',
      ['effect-slug']
    ),
    '/dsp/effects/{effect-slug}/'
  );
  assert.equal(
    expandPublicPath(
      routes.localizedOverviews.path,
      { locale: 'ja' },
      'localized path'
    ),
    '/dsp/ja/'
  );

  const outside = structuredClone(routes);
  outside.routes[0].path = '/other/';
  assert.throws(() => routeMap(outside), /must stay under/);

  const unsupported = structuredClone(routes);
  unsupported.routes[0].path = '/dsp/{locale}/';
  assert.throws(() => routeMap(unsupported), /unsupported/);

  const duplicate = structuredClone(routes);
  duplicate.routes.find(route => route.id === 'library-strengths').path =
    duplicate.routes.find(route => route.id === 'visual-editor-to-code').path;
  assert.throws(() => routeMap(duplicate), /Duplicate canonical public route/);

  const missingLocalizedPlaceholder = structuredClone(routes);
  missingLocalizedPlaceholder.localizedOverviews.path = '/dsp/localized/';
  assert.throws(() => routeMap(missingLocalizedPlaceholder), /does not use every/);
});

test('merged routes resolve to declared launch anchors', () => {
  assert.doesNotThrow(() => routeMap(routes));

  const missingLaunch = structuredClone(routes);
  missingLaunch.routes.find(route => route.id === 'library-strengths').path =
    '/dsp/missing/#library-strengths';
  assert.throws(() => routeMap(missingLaunch), /must resolve to a launch route/);

  const missingAnchor = structuredClone(routes);
  missingAnchor.routes.find(route => route.id === 'landing').anchors = [];
  assert.throws(
    () => routeMap(missingAnchor),
    /fragment must be declared by launch route landing/
  );
});

test('browser Start and ML safety snippets retain their public contracts', () => {
  const javascript = fs.readFileSync(path.join(
    repoRoot,
    'examples',
    'dsp-library',
    'docs',
    'snippets',
    'javascript-start.mjs'
  ), 'utf8');
  assert.doesNotMatch(javascript, /node:assert/);
  assert.doesNotMatch(javascript, /function assert\(condition, message\)/);
  assert.match(javascript, /console\.log\(output\.length/);
  const javascriptPage = fs.readFileSync(path.join(
    repoRoot,
    'docs',
    'dsp',
    'getting-started',
    'javascript',
    'index.md'
  ), 'utf8');
  assert.match(javascriptPage, /import map/);
  assert.match(javascriptPage, /dist\/index\.js/);
  assert.match(javascriptPage, /ESM-only/);
  assert.match(javascriptPage, /start\.mjs/);

  const ml = fs.readFileSync(path.join(
    repoRoot,
    'examples',
    'dsp-library',
    'docs',
    'snippets',
    'ml-data-augmentation.py'
  ), 'utf8');
  assert.match(ml, /for output in \(first, repeat, variant\):/);
  assert.match(ml, /np\.isfinite\(output\)\.all\(\)/);
  assert.match(ml, /np\.max\(np\.abs\(output\)\) <= 1/);
});

test('Graph quickstarts publish exact lifecycle, conversion, and stable error APIs', () => {
  const { outputs } = runDocsGenerator({ check: true });
  const pythonStart = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'getting-started', 'python', 'index.md'
  ), 'utf8');
  const javascriptStart = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'getting-started', 'javascript', 'index.md'
  ), 'utf8');
  const graphReference = generatedRoute(outputs, 'graph-v1');
  const pythonReadme = fs.readFileSync(path.join(
    repoRoot, 'dsp', 'bindings', 'python', 'README.md'
  ), 'utf8');
  const javascriptReadme = fs.readFileSync(path.join(
    repoRoot, 'dsp', 'bindings', 'js', 'README.md'
  ), 'utf8');
  const pythonApi = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'python', 'index.md'
  ), 'utf8');
  const javascriptApi = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'javascript', 'index.md'
  ), 'utf8');

  for (const source of [javascriptStart, javascriptReadme]) {
    assert.match(source, /import \{ Graph, createGraph, createVolume \} from '@effetune\/dsp'/);
    assert.match(source, /Graph\.wetDry\(/);
    assert.match(source, /await createGraph\(graphDocument\)/);
    assert.match(source, /await graph\.process\(/);
    assert.match(source, /await graph\.stream\(/);
    assert.match(source, /stream\.compileSnapshot\.effectiveSchedule/);
    assert.match(source, /stream\?\.close\(\)/);
    assert.match(source, /graph\.close\(\)/);
  }
  for (const source of [pythonStart, pythonReadme]) {
    assert.match(source, /import effetune as et/);
    assert.match(source, /et\.Graph\.wet_dry\(/);
    assert.match(source, /graph\.process\(/);
    assert.match(source, /graph\.stream\(48_000, channels=2/);
    assert.match(source, /stream\.compile_snapshot\["effectiveSchedule"\]/);
    assert.match(source, /stream\.close\(\)/);
    assert.match(source, /graph\.close\(\)/);
  }
  assert.match(graphReference, /await Graph\.fromChain\(chain\)/);
  assert.match(graphReference, /et\.Graph\.from_chain\(chain\)/);
  assert.match(graphReference, /JavaScript `toChain\(\)`\s+returns a Chain document/);
  assert.match(graphReference, /Python `to_chain\(\)` returns a new `Chain`/);
  assert.match(graphReference, /`gain = 1`, `mute = false`, `solo = false`/);
  assert.match(
    graphReference,
    /non-identity edge control raises\s+`GRAPH_DOCUMENT_CONNECTIVITY`/
  );
  assert.match(graphReference, /error instanceof EffeTuneError/);
  assert.match(graphReference, /except et\.EffeTuneError as error/);
  assert.match(graphReference, /error\.code \?\? error\.name, error\.path \?\? ''/);
  assert.match(graphReference, /error\.code or type\(error\)\.__name__, error\.path or ""/);
  assert.match(graphReference, /stream\?\.close\(\);\s+graph\?\.close\(\)/);
  assert.match(graphReference, /if stream is not None:\s+stream\.close\(\)\s+if graph is not None:/);
  assert.doesNotMatch(
    graphReference,
    /graph = et\.Graph\.from_chain\(chain\)\s+graph\.close\(\)\s+chain\.close\(\)/
  );
  assert.match(graphReference, /AudioWorklet \/ `EffeTuneNode` \| No \| No/);
  assert.match(graphReference, /Graph v1 has no scheduled parameter events/);
  assert.match(graphReference, /`Volume\.volume`/);
  assert.match(graphReference, /`IRReverb\.dryLevel`/);
  assert.match(graphReference, /`IRReverb\.dryEnabled`/);
  assert.match(
    graphReference,
    /wet-only when\s+`dryEnabled` is false or `dryLevel` is `-96 dB`/
  );
  assert.match(
    graphReference,
    /Graph v1 has no telemetry callback, subscription, or observation\s+API/
  );
  assert.match(graphReference, /selected DSP artifact while creating a nonempty Graph/);
  assert.match(graphReference, /graph compilation happen when\s+`stream\(\)` is called/);

  assert.match(pythonApi, /Graph\.load\(json_text: str/);
  assert.match(pythonApi, /graph\.nodes: tuple\[dict\[str, Any\], \.\.\.\]/);
  assert.match(pythonApi, /graph\.edges: tuple\[dict\[str, Any\], \.\.\.\]/);
  assert.match(pythonApi, /graph\.to_chain\(\) -> Chain/);
  assert.match(pythonApi, /graph_stream\.closed: bool/);
  assert.match(pythonApi, /A GraphStream is a context manager/);
  assert.match(pythonApi, /graph_stream\.process\(audio: np\.ndarray\)/);
  assert.match(pythonApi, /GRAPH_RECONFIGURATION_REQUIRED/);
  assert.match(javascriptApi, /static load\(input: string \| GraphDocumentInput/);
  assert.match(javascriptApi, /readonly nodes: readonly GraphNode\[\]/);
  assert.match(javascriptApi, /readonly edges: readonly GraphEdge\[\]/);
  assert.match(javascriptApi, /toChain\(\): ChainDocument/);
  assert.match(javascriptApi, /process\(audio: readonly Float32Array\[\]\): Promise<Float32Array\[\]>/);
  assert.match(javascriptApi, /passing options, including `events`, raises `ValidationError`/);
});

test('Phase 1 docs publish symmetric catalogs, latency, and bundle writers', () => {
  const python = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'python', 'index.md'
  ), 'utf8');
  const javascript = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'javascript', 'index.md'
  ), 'utf8');
  const assets = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'concepts', 'assets-and-bundles', 'index.md'
  ), 'utf8');
  const processing = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'concepts', 'processing-model', 'index.md'
  ), 'utf8');
  const javascriptReadme = fs.readFileSync(path.join(
    repoRoot, 'dsp', 'bindings', 'js', 'README.md'
  ), 'utf8');
  const workletTypes = fs.readFileSync(path.join(
    repoRoot, 'dsp', 'bindings', 'js', 'src', 'worklet.d.ts'
  ), 'utf8');
  const dspReadme = fs.readFileSync(path.join(repoRoot, 'dsp', 'README.md'), 'utf8');

  assert.match(python, /`EFFECT_METADATA` is the machine-readable catalog/);
  assert.match(python, /Chain\.from_bundle\(source: str\) -> Chain/);
  assert.match(python, /stream\.process\(/);
  assert.match(python, /Bundle\.pack\(/);
  assert.match(javascript, /encodeEta1\(options:/);
  assert.match(javascript, /class Chain \{/);
  assert.match(javascript, /interface ChainStream \{/);
  assert.match(javascript, /EffeTuneNode\.create\(/);
  assert.match(javascript, /all 92 root class\/factory pairs/);
  assert.match(javascript, /numerically symmetric with Python/);
  assert.match(assets, /`effetune bundle pack CHAIN DESTINATION --asset ID=FILE`/);
  assert.match(assets, /public `encodeEta1\(\)` helper/);
  assert.match(assets, /--preset cli-bundle --subtype FLOAT/);
  assert.match(processing, /ChainStream\.latencySamples/);
  assert.match(javascriptReadme, /`EffeTuneNode\.latencySamples` exposes the cached/);
  assert.match(workletTypes, /readonly latencySamples: number;/);
  assert.match(dspReadme, /routed EffeTune host reports and compensates aggregate pipeline latency/);
});

test('Generated docs distinguish semantic names from language-specific entry points', () => {
  const pythonStart = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'getting-started', 'python', 'index.md'
  ), 'utf8');
  const pythonApi = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'python', 'index.md'
  ), 'utf8');
  const javascriptApi = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'api', 'javascript', 'index.md'
  ), 'utf8');
  const legacy = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'concepts', 'chain-and-presets', 'index.md'
  ), 'utf8');
  const matrix = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'effects', 'matrix', 'index.md'
  ), 'utf8');
  const pythonReadme = fs.readFileSync(path.join(
    repoRoot, 'dsp', 'bindings', 'python', 'README.md'
  ), 'utf8');
  const javascriptReadme = fs.readFileSync(path.join(
    repoRoot, 'dsp', 'bindings', 'js', 'README.md'
  ), 'utf8');

  for (const source of [pythonStart, pythonApi, pythonReadme]) {
    assert.match(source, /PitchShifter\(pitch_shift=3\)/);
    assert.match(source, /"PitchShifter", pitch_shift=3/);
    assert.match(source, /pitchShift/);
  }
  assert.match(pythonApi, /`pitchShift` is not an alias for the `pitch_shift`/);

  for (const exportPath of Object.keys(npmPackage.exports)) {
    const specifier = exportPath === '.'
      ? npmPackage.name
      : `${npmPackage.name}${exportPath.slice(1)}`;
    assert.ok(javascriptApi.includes(`\`${specifier}\``), specifier);
    assert.ok(javascriptReadme.includes(`\`${specifier}\``), specifier);
  }
  assert.doesNotMatch(javascriptApi, /@effetune\/dsp\/package\.json/);
  assert.doesNotMatch(
    javascriptApi,
    /@effetune\/dsp\/schemas\/(?:chain|bundle)-v1\.schema\.json/
  );

  assert.match(legacy, /one ordered serial path/);
  assert.match(legacy, /branched or multi-bus routing/);
  assert.match(legacy, /flattening it into Chain v1 would change the\s+acoustic result/);
  assert.match(legacy, /move or copy the desired effects into\s+one serial path/);

  assert.match(matrix, /complete grammar `\(p\?\[0-9a-f\]\[0-9a-f\]\)\*`/);
  assert.match(matrix, /`p01` sends input 0 to output 1 with\s+polarity inverted/);
  assert.match(matrix, /empty string is valid and produces silence/);
  assert.match(matrix, /Channel indices are zero-based/);
  assert.match(matrix, /lowercase hexadecimal digits `0` through `f`/);
  assert.match(matrix, /input or\s+output is unavailable is silently ignored/);
});

test('DSP walkthroughs keep copyable examples aligned with public runtime behavior', () => {
  const pythonStart = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'getting-started', 'python', 'index.md'
  ), 'utf8');
  const cliStart = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'getting-started', 'cli', 'index.md'
  ), 'utf8');
  const streaming = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'concepts', 'streaming-and-events', 'index.md'
  ), 'utf8');
  const faq = fs.readFileSync(path.join(
    repoRoot, 'docs', 'dsp', 'faq', 'index.md'
  ), 'utf8');

  assert.match(pythonStart, /SoundFile returns `\(frames, channels\)`/);
  assert.match(pythonStart, /np\.ascontiguousarray\(decoded\.T, dtype=np\.float32\)/);
  assert.match(cliStart, /--preset PRESET \| --chain CHAIN/);
  assert.match(cliStart, /Bundle directory, or its `bundle\.json`/);
  assert.match(cliStart, /`FLOAT` writes 32-bit float/);
  assert.match(
    cliStart,
    /`effetune preset inspect DOCUMENT` \| Print the materialized canonical Chain v1 document/
  );
  assert.doesNotMatch(cliStart, /preset inspect[^\n]*legacy/i);
  assert.match(streaming, /partial updates merged with the effect's\s+current/);
  assert.match(streaming, /non-decreasing frame order/);
  assert.match(faq, /rejected before native processing/);
});

test('AudioWorklet Start publishes the browser bootstrap and asset routing', () => {
  const bootstrap = fs.readFileSync(path.join(
    repoRoot,
    'examples',
    'dsp-library',
    'docs',
    'snippets',
    'audioworklet-bootstrap.html'
  ), 'utf8').trimEnd();
  assert.match(
    bootstrap,
    /"@effetune\/dsp\/worklet": "\/vendor\/@effetune\/dsp\/dist\/worklet\.js"/
  );
  assert.match(
    bootstrap,
    /<script type="module" src="\.\/audioworklet-start\.js"><\/script>/
  );
  const page = fs.readFileSync(path.join(
    repoRoot,
    'docs',
    'dsp',
    'getting-started',
    'audioworklet',
    'index.md'
  ), 'utf8');
  assert.ok(page.includes(bootstrap));
  for (const contract of [
    'complete `dist/` directory',
    '`worklet-processor.js`',
    '`assets/effetune-dsp.wasm`',
    '`assets/effetune-dsp.simd.wasm`',
    '`assets/effetune-dsp.meta.json`',
    '`processorUrl`',
    '`wasmUrl`',
    '`simdWasmUrl`',
    '`metaUrl`'
  ]) {
    assert.ok(page.includes(contract), contract);
  }
});

test('research record captures input, mode, and replayable ordered operations', () => {
  const research = fs.readFileSync(path.join(
    repoRoot,
    'examples',
    'dsp-library',
    'docs',
    'snippets',
    'research-experiment.py'
  ), 'utf8');
  for (const contract of [
    '"processingMode": "stream"',
    '"sha256": digest_bytes(audio.tobytes())',
    '"operation": "open"',
    '"operation": "process"',
    '"startFrame": start',
    '"endFrame": min(',
    '"operation": "close"',
    'stream.process(np.ascontiguousarray(audio[:, start:end]))',
    '--replay-record',
    'render_from_history(audio, experiment, run["operations"])'
  ]) {
    assert.ok(research.includes(contract), contract);
  }
});

test('DSP Library coordinator watches the root bridge and runs documentation gates', () => {
  const coordinator = fs.readFileSync(path.join(
    repoRoot, '.github', 'workflows', 'ci.yml'
  ), 'utf8');
  const workflow = fs.readFileSync(path.join(
    repoRoot, '.github', 'workflows', 'dsp-library-ci.yml'
  ), 'utf8');
  const libraryScope = coordinator.slice(
    coordinator.indexOf('            dsp_library:'),
    coordinator.indexOf('\n\n  common:')
  );
  assert.equal(libraryScope.split("- 'README.md'").length, 2);
  const preflight = workflow.slice(
    workflow.indexOf('  preflight:'),
    workflow.indexOf('  linux:')
  );
  for (const testFile of [
    'tests/esm/dsp-library-docs.test.mjs',
    'tests/esm/dsp-library-demo.test.mjs'
  ]) {
    assert.ok(preflight.includes(testFile), testFile);
  }
  assert.ok(preflight.includes('examples/dsp-library/generate-docs.mjs --check'));
});
