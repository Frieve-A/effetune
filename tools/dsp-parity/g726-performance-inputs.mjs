import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..'
);

export const G726_PERFORMANCE_INPUT_CONTRACT =
  'g726-production-performance-input-sha256-v2';
export const G726_PERFORMANCE_HASH_ALGORITHM =
  'SHA-256 over the contract and ordered UTF-8 components as id\\0content\\0; CRLF and CR normalize to LF';

const FILE_INPUTS = Object.freeze([
  'dsp/EMSDK_VERSION',
  'dsp/core/abi.cpp',
  'dsp/core/allocation_guard.cpp',
  'dsp/core/allocation_guard.h',
  'dsp/core/arena.cpp',
  'dsp/core/arena.h',
  'dsp/core/engine.cpp',
  'dsp/core/engine.h',
  'dsp/core/registry.cpp',
  'dsp/core/registry.h',
  'dsp/core/telemetry.cpp',
  'dsp/exports.txt',
  'dsp/generated/cpp/G726ADPCMSimulatorPluginParams.h',
  'dsp/include/effetune/abi.h',
  'dsp/include/effetune/dsp/halfband.h',
  'dsp/include/effetune/dsp/rational_resampler.h',
  'dsp/include/effetune/dsp/xorshift_rng.h',
  'dsp/include/effetune/kernel.h',
  'dsp/include/effetune/telemetry.h',
  'dsp/plugins/lofi/g726_adpcm_simulator/kernel.cpp',
  'dsp/plugins/lofi/g726_adpcm_simulator/kernel.h',
  'dsp/plugins/lofi/g726_adpcm_simulator/params.json',
  'dsp/wasm/no_entry.cpp',
  'js/audio/dsp-engine-binding.js',
  'tools/dsp-parity/cases.mjs',
  'tools/dsp-parity/g726-cpu-gate.mjs',
  'tools/dsp-parity/g726-performance-inputs.mjs',
  'tools/dsp-parity/runners.mjs',
  'tools/dsp-parity/stimuli.mjs'
]);

const COMPILED_SOURCE_INPUTS = Object.freeze(FILE_INPUTS.filter(relative =>
  relative.startsWith('dsp/') && relative.endsWith('.cpp')));
const RELEVANT_TARGETS = new Set(['effetune_dsp_core', 'effetune-dsp', 'pffft']);
const RELEVANT_TARGET_COMMANDS = new Set([
  'set_target_properties',
  'set_property',
  'target_compile_definitions',
  'target_compile_features',
  'target_compile_options',
  'target_include_directories',
  'target_link_libraries',
  'target_link_options'
]);
const RELEVANT_DIRECTORY_COMMANDS = new Set([
  'add_compile_definitions',
  'add_compile_options',
  'add_definitions',
  'add_link_options',
  'include_directories',
  'link_libraries'
]);

function normalizeText(contents) {
  return contents.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function normalizeWhitespace(contents) {
  return normalizeText(contents).replace(/\s+/gu, ' ').trim();
}

function componentHash(contents) {
  return `sha256:${crypto.createHash('sha256').update(contents).digest('hex')}`;
}

function readRepositoryText(repoRoot, relative, readFile) {
  return normalizeText(readFile(path.join(repoRoot, ...relative.split('/')), 'utf8'));
}

function replaceAllCaseInsensitive(source, value, replacement) {
  if (!value) return source;
  return source.replace(new RegExp(
    value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu'
  ), replacement);
}

function normalizedBuildText(contents, { repoRoot, buildDirectory }) {
  let result = normalizeWhitespace(contents).replaceAll('\\', '/');
  result = replaceAllCaseInsensitive(
    result, path.resolve(buildDirectory).replaceAll('\\', '/'), '<build>'
  );
  result = replaceAllCaseInsensitive(
    result, path.resolve(repoRoot).replaceAll('\\', '/'), '<repo>'
  );
  return result.replaceAll('$:', ':');
}

function toolchainExecutableIdentity(executable) {
  return path.basename(
    normalizeWhitespace(executable).replaceAll('\\', '/')
  ).replace(/\.exe$/iu, '');
}

function extractCMakeCalls(source) {
  const calls = [];
  const normalized = normalizeText(source);
  const commandPattern = /(^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu;
  for (const match of normalized.matchAll(commandPattern)) {
    const command = match[2].toLowerCase();
    const open = match.index + match[0].lastIndexOf('(');
    let depth = 1;
    let quoted = false;
    let escaped = false;
    let index = open + 1;
    for (; index < normalized.length && depth > 0; index++) {
      const character = normalized[index];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (!quoted && character === '(') {
        depth++;
      } else if (!quoted && character === ')') {
        depth--;
      }
    }
    if (depth !== 0) throw new Error(`unterminated CMake command ${command}`);
    calls.push({
      command,
      body: normalized.slice(open + 1, index - 1),
      source: normalized.slice(match.index + match[1].length, index)
    });
  }
  return calls;
}

function firstCMakeArgument(body) {
  return normalizeWhitespace(body).split(' ')[0]?.replace(/^"|"$/gu, '') ?? '';
}

export function canonicalG726CMakeAuthority(source) {
  const selected = extractCMakeCalls(source).filter(call => {
    if (RELEVANT_DIRECTORY_COMMANDS.has(call.command)) return true;
    if (call.command === 'set_property') {
      const arguments_ = normalizeWhitespace(call.body).split(' ');
      return arguments_[0]?.toUpperCase() === 'TARGET' &&
        RELEVANT_TARGETS.has(arguments_[1]?.replace(/^"|"$/gu, ''));
    }
    if (RELEVANT_TARGET_COMMANDS.has(call.command)) {
      return RELEVANT_TARGETS.has(firstCMakeArgument(call.body));
    }
    if (call.command !== 'set') return false;
    const name = firstCMakeArgument(call.body);
    return name.startsWith('CMAKE_CXX_') ||
      name === 'CMAKE_INTERPROCEDURAL_OPTIMIZATION';
  });
  if (!selected.some(call => call.command === 'target_compile_options' &&
      firstCMakeArgument(call.body) === 'effetune_dsp_core')) {
    throw new Error('G.726 performance CMake authority is missing core compile options');
  }
  if (!selected.some(call => call.command === 'target_link_options' &&
      firstCMakeArgument(call.body) === 'effetune-dsp')) {
    throw new Error('G.726 performance CMake authority is missing WASM link options');
  }
  return selected.map(call => normalizeWhitespace(call.source));
}

export function productionWasmConfigureArguments({
  dspRoot,
  buildDirectory,
  simd,
  debugState = false
}) {
  return Object.freeze([
    'cmake', '-S', dspRoot, '-B', buildDirectory, '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release', `-DET_SIMD=${simd ? 'ON' : 'OFF'}`,
    `-DET_DEBUG_STATE=${debugState ? 'ON' : 'OFF'}`,
    '-DBUILD_TESTING=OFF'
  ]);
}

function canonicalConfigureArguments(arguments_, { repoRoot, buildDirectory }) {
  return arguments_.map(argument => normalizedBuildText(
    argument, { repoRoot, buildDirectory }
  ));
}

export function canonicalG726BuilderInvocation(source) {
  const match = normalizeText(source).match(
    /function configureAndBuildWasm\([\s\S]*?\n\}\n(?=\nfunction createImports\()/u
  );
  if (!match) {
    throw new Error('G.726 performance authority is missing the production WASM builder');
  }
  const normalized = normalizeWhitespace(match[0]);
  if (!normalized.includes(
    'const configureArguments = productionWasmConfigureArguments({'
  ) || !normalized.includes('run(emcmake, configureArguments)')) {
    throw new Error('G.726 production WASM builder does not use normalized configure arguments');
  }
  return normalized;
}

export function g726SourceBuildAuthority({
  repoRoot = DEFAULT_REPO_ROOT,
  readFile = fs.readFileSync,
  configureArguments = productionWasmConfigureArguments
} = {}) {
  const dspRoot = path.join(repoRoot, 'dsp');
  const baselineBuild = path.join(dspRoot, 'build', 'wasm');
  const simdBuild = path.join(dspRoot, 'build', 'wasm-simd');
  const authority = {
    cmakeTargetDeclarations: canonicalG726CMakeAuthority(
      readRepositoryText(repoRoot, 'dsp/CMakeLists.txt', readFile)
    ),
    builderInvocation: canonicalG726BuilderInvocation(
      readRepositoryText(repoRoot, 'scripts/build-dsp-wasm.mjs', readFile)
    ),
    productionConfigureArguments: {
      baseline: canonicalConfigureArguments(configureArguments({
        dspRoot,
        buildDirectory: baselineBuild,
        simd: false
      }), { repoRoot, buildDirectory: baselineBuild }),
      simd: canonicalConfigureArguments(configureArguments({
        dspRoot,
        buildDirectory: simdBuild,
        simd: true
      }), { repoRoot, buildDirectory: simdBuild })
    }
  };
  authority.digest = componentHash(JSON.stringify(authority));
  return authority;
}

function ninjaBuildBlocks(source) {
  const blocks = [];
  let current = null;
  for (const line of normalizeText(source).split('\n')) {
    if (line.startsWith('build ')) {
      current = { header: line, variables: {} };
      blocks.push(current);
    } else if (current && line.startsWith('  ')) {
      const separator = line.indexOf(' = ');
      if (separator > 2) {
        current.variables[line.slice(2, separator)] = line.slice(separator + 3);
      }
    } else if (line.length !== 0) {
      current = null;
    }
  }
  return blocks;
}

function compilerValue(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = normalizeText(source).match(new RegExp(
    `^set\\(${escapedName}\\s+"?([^"\\n)]*)"?\\)$`, 'mu'
  ));
  if (!match) throw new Error(`G.726 build authority is missing ${name}`);
  return match[1];
}

function findCompilerFile(buildDirectory) {
  const cmakeFiles = path.join(buildDirectory, 'CMakeFiles');
  const versions = fs.readdirSync(cmakeFiles, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(cmakeFiles, entry.name, 'CMakeCXXCompiler.cmake'))
    .filter(filePath => fs.existsSync(filePath));
  if (versions.length !== 1) {
    throw new Error('G.726 build authority requires one CMake C++ compiler identity');
  }
  return versions[0];
}

export function resolvedG726WasmVariantAuthority({
  repoRoot = DEFAULT_REPO_ROOT,
  buildDirectory,
  configureArguments,
  emsdkVersion,
  variant
}) {
  const ninjaSource = fs.readFileSync(path.join(buildDirectory, 'build.ninja'), 'utf8');
  const blocks = ninjaBuildBlocks(ninjaSource);
  const compileCommands = COMPILED_SOURCE_INPUTS.map(relative => {
    const sourceSuffix = relative.replace(/^dsp\//u, '').replaceAll(':', '$:');
    const matches = blocks.filter(block =>
      block.header.includes('CXX_COMPILER__') &&
      block.header.replaceAll('\\', '/').includes(sourceSuffix));
    if (matches.length !== 1) {
      throw new Error(`G.726 build authority requires one compile edge for ${relative}`);
    }
    const block = matches[0];
    return {
      source: relative,
      definitions: normalizedBuildText(
        block.variables.DEFINES ?? '', { repoRoot, buildDirectory }
      ),
      flags: normalizedBuildText(
        block.variables.FLAGS ?? '', { repoRoot, buildDirectory }
      ),
      includes: normalizedBuildText(
        block.variables.INCLUDES ?? '', { repoRoot, buildDirectory }
      )
    };
  });
  const linkMatches = blocks.filter(block =>
    block.header.startsWith('build effetune-dsp.wasm:'));
  if (linkMatches.length !== 1) {
    throw new Error('G.726 build authority requires one effetune-dsp link edge');
  }
  const link = linkMatches[0];
  const compilerSource = fs.readFileSync(findCompilerFile(buildDirectory), 'utf8');
  return {
    variant,
    configureArguments: canonicalConfigureArguments(
      configureArguments, { repoRoot, buildDirectory }
    ),
    emsdkVersion,
    compiler: {
      id: compilerValue(compilerSource, 'CMAKE_CXX_COMPILER_ID'),
      version: compilerValue(compilerSource, 'CMAKE_CXX_COMPILER_VERSION'),
      platform: compilerValue(compilerSource, 'CMAKE_CXX_PLATFORM_ID'),
      frontendVariant: compilerValue(
        compilerSource, 'CMAKE_CXX_COMPILER_FRONTEND_VARIANT'
      ),
      // The toolchain is pinned by emsdkVersion plus the compiler id, version,
      // platform, and frontend variant. Recording the full CMAKE_CXX_COMPILER
      // path would additionally bind the digest to where the SDK happens to
      // live and to the host executable suffix, which differ between developer
      // machines and CI, so only the suffix-free basename identity is kept.
      executable: toolchainExecutableIdentity(
        compilerValue(compilerSource, 'CMAKE_CXX_COMPILER')
      )
    },
    compileCommands,
    linkCommand: {
      flags: normalizedBuildText(
        link.variables.FLAGS ?? '', { repoRoot, buildDirectory }
      ),
      options: normalizedBuildText(
        link.variables.LINK_FLAGS ?? '', { repoRoot, buildDirectory }
      ),
      libraries: normalizedBuildText(
        link.variables.LINK_LIBRARIES ?? '', { repoRoot, buildDirectory }
      )
    }
  };
}

export function resolvedG726WasmBuildAuthority({ baseline, simd }) {
  const authority = {
    source: 'configured CMake Ninja compile/link edges',
    variants: { baseline, simd }
  };
  authority.digest = componentHash(JSON.stringify(authority));
  return authority;
}

export function canonicalG726RegistryEntry(source) {
  const matches = normalizeText(source).match(
    /^\s*EFFETUNE_PLUGIN\(\s*G726ADPCMSimulatorPlugin\s*,\s*lofi\s*\/\s*g726_adpcm_simulator\s*\)\s*$/gmu
  ) ?? [];
  if (matches.length !== 1) {
    throw new Error('G.726 performance registry contract requires exactly one production entry');
  }
  return 'EFFETUNE_PLUGIN(G726ADPCMSimulatorPlugin,lofi/g726_adpcm_simulator)';
}

export function g726PerformanceInputManifest({
  repoRoot = DEFAULT_REPO_ROOT,
  readFile = fs.readFileSync,
  configureArguments = productionWasmConfigureArguments,
  resolvedBuildAuthority = null
} = {}) {
  const components = FILE_INPUTS.map(relative => ({
    id: relative,
    kind: 'file',
    contents: readRepositoryText(repoRoot, relative, readFile)
  }));
  const registryEntry = canonicalG726RegistryEntry(
    readRepositoryText(repoRoot, 'dsp/registry.inc', readFile)
  );
  const sourceBuildAuthority = g726SourceBuildAuthority({
    repoRoot, readFile, configureArguments
  });
  const buildAuthority = {
    source: sourceBuildAuthority,
    resolved: resolvedBuildAuthority
  };
  components.push(
    {
      id: 'dsp/registry.inc#G726ADPCMSimulatorPlugin-entry',
      kind: 'derived',
      contents: registryEntry
    },
    {
      id: 'production-build#g726-source-authority',
      kind: 'derived',
      contents: JSON.stringify(sourceBuildAuthority)
    },
    {
      id: 'production-build#g726-resolved-authority',
      kind: 'derived',
      contents: JSON.stringify(resolvedBuildAuthority)
    }
  );
  components.sort((left, right) => left.id.localeCompare(right.id, 'en'));

  const hash = crypto.createHash('sha256');
  hash.update(G726_PERFORMANCE_INPUT_CONTRACT);
  hash.update('\0');
  for (const component of components) {
    hash.update(component.id);
    hash.update('\0');
    hash.update(component.contents);
    hash.update('\0');
  }
  return {
    contract: G726_PERFORMANCE_INPUT_CONTRACT,
    hashAlgorithm: G726_PERFORMANCE_HASH_ALGORITHM,
    digest: `sha256:${hash.digest('hex')}`,
    inputs: components.map(component => ({
      id: component.id,
      kind: component.kind,
      sha256: componentHash(component.contents)
    })),
    registryEntry,
    buildAuthority
  };
}
