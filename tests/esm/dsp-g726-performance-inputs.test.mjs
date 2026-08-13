import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalG726RegistryEntry,
  G726_PERFORMANCE_HASH_ALGORITHM,
  G726_PERFORMANCE_INPUT_CONTRACT,
  g726PerformanceInputManifest,
  productionWasmConfigureArguments,
  resolvedG726WasmBuildAuthority,
  resolvedG726WasmVariantAuthority
} from '../../tools/dsp-parity/g726-performance-inputs.mjs';
import {
  evaluateG726PerformanceInputProvenance
} from '../../tools/dsp-parity/g726-cpu-gate.mjs';
import { metadataContents } from '../../scripts/build-dsp-wasm.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('G.726 performance manifest lists production dependencies without unrelated plugin sources', () => {
  const manifest = g726PerformanceInputManifest({ repoRoot });
  const ids = manifest.inputs.map(input => input.id);
  assert.equal(manifest.contract, G726_PERFORMANCE_INPUT_CONTRACT);
  assert.equal(manifest.hashAlgorithm, G726_PERFORMANCE_HASH_ALGORITHM);
  assert.match(manifest.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(ids.includes('dsp/plugins/lofi/g726_adpcm_simulator/kernel.cpp'), true);
  assert.equal(ids.includes('dsp/include/effetune/dsp/halfband.h'), true);
  assert.equal(ids.includes('dsp/include/effetune/dsp/rational_resampler.h'), true);
  assert.equal(ids.includes('dsp/include/effetune/dsp/xorshift_rng.h'), true);
  assert.equal(ids.includes('dsp/core/abi.cpp'), true);
  assert.equal(ids.includes('js/audio/dsp-engine-binding.js'), true);
  assert.equal(ids.includes('dsp/registry.inc#G726ADPCMSimulatorPlugin-entry'), true);
  assert.equal(ids.includes('production-build#g726-source-authority'), true);
  assert.equal(ids.includes('production-build#g726-resolved-authority'), true);
  assert.equal(ids.some(id => /\/(?:mp3_codec|bluetooth_sbc|gsm_full_rate)_simulator\//u.test(id)), false);
  assert.equal(manifest.buildAuthority.resolved, null);
  assert.equal(
    manifest.buildAuthority.source.cmakeTargetDeclarations.some(source =>
      source.startsWith('target_compile_options(effetune_dsp_core ')),
    true
  );
});

test('G.726 source build authority detects added applicable flags and configure toggles', () => {
  const baseline = g726PerformanceInputManifest({ repoRoot });
  const cmakeMutations = [
    'target_compile_options(effetune_dsp_core PRIVATE -fno-builtin)',
    'target_compile_definitions(effetune_dsp_core PRIVATE ET_G726_MUTATION=1)',
    'target_link_options(effetune-dsp PRIVATE -sASSERTIONS=0)'
  ];
  for (const mutation of cmakeMutations) {
    const changed = g726PerformanceInputManifest({
      repoRoot,
      readFile(filePath, encoding) {
        const source = fs.readFileSync(filePath, encoding);
        return filePath.endsWith(path.join('dsp', 'CMakeLists.txt'))
          ? `${source}\n${mutation}\n`
          : source;
      }
    });
    assert.notEqual(changed.digest, baseline.digest, mutation);
  }

  const changedConfigure = g726PerformanceInputManifest({
    repoRoot,
    configureArguments(options) {
      return [...productionWasmConfigureArguments(options), '-DET_G726_MUTATION=ON'];
    }
  });
  assert.notEqual(changedConfigure.digest, baseline.digest);
});

test('G.726 source build authority ignores flags scoped to another plugin target', () => {
  const baseline = g726PerformanceInputManifest({ repoRoot });
  const changed = g726PerformanceInputManifest({
    repoRoot,
    readFile(filePath, encoding) {
      const source = fs.readFileSync(filePath, encoding);
      return filePath.endsWith(path.join('dsp', 'CMakeLists.txt'))
        ? `${source}\ntarget_compile_options(unrelated_plugin PRIVATE -funroll-loops)\n`
        : source;
    }
  });
  assert.equal(changed.digest, baseline.digest);
});

test('G.726 resolved build authority participates in the component digest', () => {
  const resolved = {
    source: 'configured CMake Ninja compile/link edges',
    digest: `sha256:${'1'.repeat(64)}`,
    variants: {
      baseline: {
        compiler: { id: 'Clang', version: '23.0.0' },
        compileCommands: [{ source: 'kernel.cpp', flags: '-O3' }],
        linkCommand: { options: '-flto' }
      },
      simd: {
        compiler: { id: 'Clang', version: '23.0.0' },
        compileCommands: [{ source: 'kernel.cpp', flags: '-O3 -msimd128' }],
        linkCommand: { options: '-flto -msimd128' }
      }
    }
  };
  const baseline = g726PerformanceInputManifest({
    repoRoot, resolvedBuildAuthority: resolved
  });
  const changed = structuredClone(resolved);
  changed.variants.baseline.linkCommand.options += ' -sASSERTIONS=0';
  const changedManifest = g726PerformanceInputManifest({
    repoRoot, resolvedBuildAuthority: changed
  });
  assert.notEqual(changedManifest.digest, baseline.digest);
  assert.deepEqual(baseline.buildAuthority.resolved, resolved);
});

function posix(value) {
  return value.replaceAll('\\', '/');
}

function compiledG726Sources() {
  return g726PerformanceInputManifest({ repoRoot }).inputs
    .filter(input => input.kind === 'file' &&
      input.id.startsWith('dsp/') && input.id.endsWith('.cpp'))
    .map(input => input.id);
}

function writeVariantBuildFixture(buildDirectory, { compilerExecutable, simd }) {
  const compilerDirectory = path.join(buildDirectory, 'CMakeFiles', '4.1.2');
  fs.mkdirSync(compilerDirectory, { recursive: true });
  fs.writeFileSync(path.join(compilerDirectory, 'CMakeCXXCompiler.cmake'), [
    `set(CMAKE_CXX_COMPILER "${compilerExecutable}")`,
    'set(CMAKE_CXX_COMPILER_ID "Clang")',
    'set(CMAKE_CXX_COMPILER_VERSION "23.0.0")',
    'set(CMAKE_CXX_PLATFORM_ID "emscripten")',
    'set(CMAKE_CXX_COMPILER_FRONTEND_VARIANT "GNU")',
    ''
  ].join('\n'));

  const sourceRoot = posix(repoRoot);
  const edges = compiledG726Sources().map(relative => {
    const suffix = relative.replace(/^dsp\//u, '');
    return [
      `build CMakeFiles/effetune_dsp_core.dir/${suffix}.o: ` +
        `CXX_COMPILER__effetune_dsp_core_Release ${sourceRoot}/dsp/${suffix}`,
      '  DEFINES = -DPFFFT_STATIC_DEFINE=1',
      `  FLAGS = -O3 -DNDEBUG -std=c++20 -flto${simd ? ' -msimd128' : ''}`,
      `  INCLUDES = -I${sourceRoot}/dsp/include`,
      ''
    ].join('\n');
  });
  edges.push([
    'build effetune-dsp.wasm: CXX_EXECUTABLE_LINKER__effetune-dsp_Release ' +
      'libeffetune_dsp_core.a',
    '  FLAGS = -O3 -DNDEBUG',
    '  LINK_FLAGS = --no-entry ' +
      `-sEXPORTED_FUNCTIONS=@${sourceRoot}/dsp/exports.txt`,
    '  LINK_LIBRARIES = libeffetune_dsp_core.a libpffft.a -lm',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(buildDirectory, 'build.ninja'), edges.join('\n'));
}

function fixtureBuildAuthority(root, compilerExecutable) {
  const dspRoot = path.join(repoRoot, 'dsp');
  const variants = ['baseline', 'simd'].map(variant => {
    const buildDirectory = path.join(root, variant);
    const simd = variant === 'simd';
    writeVariantBuildFixture(buildDirectory, { compilerExecutable, simd });
    return resolvedG726WasmVariantAuthority({
      repoRoot,
      buildDirectory,
      configureArguments: productionWasmConfigureArguments({
        dspRoot, buildDirectory, simd
      }),
      emsdkVersion: '6.0.2',
      variant
    });
  });
  return resolvedG726WasmBuildAuthority({
    baseline: variants[0], simd: variants[1]
  });
}

function collectAuthorityStrings(value, location, sink) {
  if (typeof value === 'string') {
    sink.push({ location, value });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectAuthorityStrings(entry, `${location}[${index}]`, sink));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      collectAuthorityStrings(entry, `${location}.${key}`, sink);
    }
  }
}

test('G.726 resolved build authority records a host-independent toolchain identity', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-g726-authority-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const windowsHost = fixtureBuildAuthority(
    path.join(root, 'windows'),
    `${posix(repoRoot)}/dsp/.emsdk/upstream/emscripten/em++.exe`
  );
  const linuxHost = fixtureBuildAuthority(
    path.join(root, 'linux'),
    '/opt/hostedtoolcache/emsdk/6.0.2/upstream/emscripten/em++'
  );

  for (const authority of [windowsHost, linuxHost]) {
    for (const variant of Object.values(authority.variants)) {
      assert.equal(variant.compiler.executable, 'em++');
      assert.equal(variant.compiler.id, 'Clang');
      assert.equal(variant.compiler.version, '23.0.0');
      assert.equal(variant.emsdkVersion, '6.0.2');
    }
    const strings = [];
    collectAuthorityStrings(authority, 'resolved', strings);
    for (const { location, value } of strings) {
      const scrubbed = value.replaceAll('dsp/EMSDK_VERSION', '<emsdk-version-file>');
      assert.equal(/[A-Za-z]:[\\/]/u.test(scrubbed), false, `${location}: ${value}`);
      assert.equal(
        /(?:^|[\s=@])(?:-(?:I|L|isystem|iquote))?\/(?![*/])/u.test(scrubbed),
        false,
        `${location}: ${value}`
      );
      assert.equal(/\.exe(?:$|[\s"'])/iu.test(scrubbed), false, `${location}: ${value}`);
      assert.equal(/emsdk/iu.test(scrubbed), false, `${location}: ${value}`);
    }
  }

  assert.equal(windowsHost.digest, linuxHost.digest);
  assert.match(windowsHost.digest, /^sha256:[0-9a-f]{64}$/u);
});

test('G.726 performance digest ignores unrelated registry entries but changes with G code', () => {
  const baseline = g726PerformanceInputManifest({ repoRoot });
  const unrelatedRegistry = g726PerformanceInputManifest({
    repoRoot,
    readFile(filePath, encoding) {
      const source = fs.readFileSync(filePath, encoding);
      return filePath.endsWith(path.join('dsp', 'registry.inc'))
        ? `${source}\nEFFETUNE_PLUGIN(UnrelatedPlugin, others/unrelated)\n`
        : source;
    }
  });
  assert.equal(unrelatedRegistry.digest, baseline.digest);

  const changedKernel = g726PerformanceInputManifest({
    repoRoot,
    readFile(filePath, encoding) {
      const source = fs.readFileSync(filePath, encoding);
      return filePath.endsWith(path.join('g726_adpcm_simulator', 'kernel.cpp'))
        ? `${source}\n`
        : source;
    }
  });
  assert.notEqual(changedKernel.digest, baseline.digest);
});

test('G.726 registry normalization requires one exact production entry', () => {
  assert.equal(
    canonicalG726RegistryEntry(
      'EFFETUNE_PLUGIN( G726ADPCMSimulatorPlugin , lofi / g726_adpcm_simulator )\n' +
      'EFFETUNE_PLUGIN(OtherPlugin, others/other)\n'
    ),
    'EFFETUNE_PLUGIN(G726ADPCMSimulatorPlugin,lofi/g726_adpcm_simulator)'
  );
  assert.throws(
    () => canonicalG726RegistryEntry('EFFETUNE_PLUGIN(OtherPlugin, others/other)\n'),
    /exactly one production entry/u
  );
});

test('G.726 CPU provenance fails closed unless artifact, start, end, and current match', () => {
  const manifest = g726PerformanceInputManifest({ repoRoot });
  const accepted = evaluateG726PerformanceInputProvenance({
    artifact: manifest,
    start: manifest,
    end: manifest,
    current: manifest
  });
  assert.equal(accepted.passed, true);
  assert.deepEqual(accepted.failures, []);

  const changed = { ...manifest, digest: `sha256:${'0'.repeat(64)}` };
  const rejected = evaluateG726PerformanceInputProvenance({
    artifact: manifest,
    start: manifest,
    end: changed,
    current: changed
  });
  assert.equal(rejected.passed, false);
  assert.deepEqual(rejected.failures, ['endDigest', 'currentDigest']);
});

test('production DSP metadata records the complete G.726 performance manifest', () => {
  const resolvedBuildAuthority = {
    source: 'configured CMake Ninja compile/link edges',
    digest: `sha256:${'2'.repeat(64)}`,
    variants: { baseline: {}, simd: {} }
  };
  const manifest = g726PerformanceInputManifest({
    repoRoot, resolvedBuildAuthority
  });
  const kernels = [{ name: 'G726ADPCMSimulatorPlugin', hash: 0xee385372 }];
  const metadata = JSON.parse(metadataContents(
    'fixture-sdk',
    { abiVersion: 1, kernels, bytes: 1 },
    { abiVersion: 1, kernels, bytes: 1 },
    manifest
  ));
  assert.equal('phase0Plugins' in metadata, false);
  assert.deepEqual(metadata.g726PerformanceInput, manifest);
  assert.deepEqual(
    metadata.g726PerformanceInput.buildAuthority.resolved,
    resolvedBuildAuthority
  );
});
