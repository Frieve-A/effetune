import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadParamSpecs } from './gen-dsp-params.mjs';
import {
  g726PerformanceInputManifest,
  productionWasmConfigureArguments,
  resolvedG726WasmBuildAuthority,
  resolvedG726WasmVariantAuthority
} from '../tools/dsp-parity/g726-performance-inputs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dspRoot = path.join(repoRoot, 'dsp');
const buildRoot = path.join(dspRoot, 'build');
const artifactsRoot = path.join(repoRoot, 'plugins', 'dsp');
const generator = path.join(repoRoot, 'scripts', 'gen-dsp-params.mjs');
const g726PerformanceInputsSource = path.join(
  repoRoot, 'tools', 'dsp-parity', 'g726-performance-inputs.mjs'
);
const bindingSource = path.join(repoRoot, 'js', 'audio', 'dsp-engine-binding.js');
const workletSource = path.join(repoRoot, 'plugins', 'audio-processor.js');
const injectionStart = '// __ETDSP_BINDING_INJECT_START__';
const injectionEnd = '// __ETDSP_BINDING_INJECT_END__';
const isWindows = process.platform === 'win32';
const vsEnvironmentArgs = [
  '/d', '/s', '/c',
  'call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set'
];

function fail(message) {
  throw new Error(message);
}

function finishRun(command, result, capture) {
  if (result.error) {
    fail(`failed to start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    fail(`${command} exited with status ${result.status}${details}`);
  }
  return result.stdout ?? '';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true
  });
  return finishRun(command, result, options.capture);
}

function normalized(contents) {
  return contents.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function writeIfChanged(filePath, contents) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (current === contents) {
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
  return true;
}

function copyIfChanged(source, destination) {
  const sourceBytes = fs.readFileSync(source);
  const current = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
  if (current !== null && sourceBytes.equals(current)) {
    return false;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, sourceBytes);
  return true;
}

function resetBuildDirectory(directory) {
  const relative = path.relative(buildRoot, directory);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`refusing to reset build directory outside dsp/build: ${directory}`);
  }
  fs.rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  });
  fs.mkdirSync(directory, { recursive: true });
}

function runCodegen(check) {
  run(process.execPath, [generator, ...(check ? ['--check'] : [])]);
}

function transformBindingForWorklet(source) {
  let output = normalized(source);
  if (/^\s*import\s/m.test(output)) {
    fail('dsp-engine-binding.js must remain dependency-free for worklet injection');
  }
  if (/^\s*export\s+default\s/m.test(output)) {
    fail('default exports are not supported in the injected DSP binding');
  }
  output = output.replace(/^[ \t]*export[ \t]*\{[^}]*\};?[ \t]*(?:\n|$)/gm, '');
  output = output.replace(/^(\s*)export\s+(?=(?:async\s+)?(?:class|function|const|let|var)\b)/gm,
    '$1');
  if (/^\s*(?:import|export)\s/m.test(output)) {
    fail('unable to transform all module syntax in dsp-engine-binding.js');
  }
  return output.trim();
}

function refreshWorkletBinding(check) {
  const hasBinding = fs.existsSync(bindingSource);
  const hasWorklet = fs.existsSync(workletSource);
  if (!hasBinding || !hasWorklet) {
    if (hasBinding !== hasWorklet) {
      fail('binding injection requires both dsp-engine-binding.js and audio-processor.js');
    }
    return;
  }

  const worklet = normalized(fs.readFileSync(workletSource, 'utf8'));
  const start = worklet.indexOf(injectionStart);
  const end = worklet.indexOf(injectionEnd);
  if (start < 0 && end < 0) {
    fail('audio-processor.js is missing DSP binding injection markers');
  }
  if (start < 0 || end < 0 || end <= start ||
      worklet.indexOf(injectionStart, start + injectionStart.length) >= 0 ||
      worklet.indexOf(injectionEnd, end + injectionEnd.length) >= 0) {
    fail('audio-processor.js must contain one ordered DSP binding marker pair');
  }
  const binding = transformBindingForWorklet(fs.readFileSync(bindingSource, 'utf8'));
  const replacement = `${injectionStart}\n${binding}\n${injectionEnd}`;
  const next = worklet.slice(0, start) + replacement + worklet.slice(end + injectionEnd.length);
  if (next === worklet) {
    return;
  }
  if (check) {
    fail('plugins/audio-processor.js contains a stale inlined DSP binding');
  }
  fs.writeFileSync(workletSource, next, 'utf8');
}

function findVsDevCmd() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) {
    return null;
  }
  const installation = run(vswhere, [
    '-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'
  ], { capture: true }).trim();
  if (!installation) {
    return null;
  }
  const candidate = path.join(installation, 'Common7', 'Tools', 'VsDevCmd.bat');
  return fs.existsSync(candidate) ? candidate : null;
}

export function createVsEnvironmentInvocation(vsDevCmd) {
  return {
    command: 'cmd.exe',
    args: [...vsEnvironmentArgs],
    cwd: path.dirname(vsDevCmd)
  };
}

function readVsEnvironment(vsDevCmd) {
  // Keep the command shell isolated from run(), which receives dynamic build paths.
  const result = spawnSync('cmd.exe', vsEnvironmentArgs, {
    cwd: path.dirname(vsDevCmd),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  return finishRun('cmd.exe', result, true);
}

function nativeEnvironment() {
  if (!isWindows || process.env.VCINSTALLDIR) {
    return process.env;
  }
  const vsDevCmd = findVsDevCmd();
  if (!vsDevCmd) {
    fail('Visual C++ tools were not found; install the Desktop C++ workload');
  }
  const output = readVsEnvironment(vsDevCmd);
  const env = { ...process.env };
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      env[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return env;
}

export function parseNativeBuildType(args) {
  const prefix = '--native-build-type=';
  const values = [...args]
    .filter(argument => argument.startsWith(prefix))
    .map(argument => argument.slice(prefix.length));
  if (values.length > 1) {
    fail('--native-build-type may only be specified once');
  }
  const buildType = values[0] ?? 'Debug';
  if (buildType !== 'Debug' && buildType !== 'Release') {
    fail('--native-build-type must be Debug or Release');
  }
  return buildType;
}

function runNativeTests(buildType) {
  const buildDirectory = path.join(buildRoot, 'native');
  resetBuildDirectory(buildDirectory);
  const env = nativeEnvironment();
  run('cmake', [
    '-S', dspRoot, '-B', buildDirectory, '-G', 'Ninja',
    `-DCMAKE_BUILD_TYPE=${buildType}`, '-DBUILD_TESTING=ON'
  ], { env });
  run('cmake', ['--build', buildDirectory, '--parallel'], { env });
  run('ctest', ['--test-dir', buildDirectory, '--output-on-failure'], { env });
}

function runNativeTestWarningCheck() {
  const buildDirectory = path.join(buildRoot, 'native-test-warnings');
  resetBuildDirectory(buildDirectory);
  const { emcmake } = emsdkPaths();
  run(emcmake, [
    'cmake', '-S', dspRoot, '-B', buildDirectory, '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=OFF',
    '-DET_NATIVE_TEST_WARNING_CHECK=ON'
  ]);
  run('cmake', [
    '--build', buildDirectory, '--target',
    'effetune_dsp_native_test_warning_check', '--parallel'
  ]);
}

export function emscriptenExecutableName(name, windows = isWindows) {
  return windows ? `${name}.exe` : name;
}

function emsdkPaths() {
  const pinned = fs.readFileSync(path.join(dspRoot, 'EMSDK_VERSION'), 'utf8').trim();
  const root = path.resolve(process.env.EMSDK || path.join(dspRoot, '.emsdk'));
  const emscripten = path.join(root, 'upstream', 'emscripten');
  const findCommand = name => {
    const candidate = path.join(emscripten, emscriptenExecutableName(name));
    return fs.existsSync(candidate) ? candidate : null;
  };
  const emcc = findCommand('emcc');
  const emcmake = findCommand('emcmake');
  if (emcc === null || emcmake === null) {
    fail(`Emscripten ${pinned} not found under ${root}. Set EMSDK to the activated SDK root.`);
  }
  const versionText = run(emcc, ['--version'], { capture: true });
  const match = versionText.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!match || match[1] !== pinned) {
    fail(`Expected Emscripten ${pinned}, got ${match?.[1] ?? 'an unknown version'}`);
  }
  return { root, emcc, emcmake, version: pinned };
}

function configureAndBuildWasm({
  emcmake,
  name,
  simd,
  debugState = false
}) {
  const buildDirectory = path.join(buildRoot, name);
  resetBuildDirectory(buildDirectory);
  const configureArguments = productionWasmConfigureArguments({
    dspRoot,
    buildDirectory,
    simd,
    debugState
  });
  run(emcmake, configureArguments);
  run('cmake', ['--build', buildDirectory, '--parallel']);
  const artifact = path.join(buildDirectory, 'effetune-dsp.wasm');
  if (!fs.existsSync(artifact)) {
    fail(`WASM build did not produce ${artifact}`);
  }
  return { artifact, buildDirectory, configureArguments };
}

function createImports(module) {
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ??= {};
    if (entry.kind !== 'function') {
      fail(`unsupported WASM import ${entry.module}.${entry.name} (${entry.kind})`);
    }
    imports[entry.module][entry.name] = (...args) => {
      if (entry.name === 'proc_exit') {
        fail(`WASM called proc_exit(${args[0] ?? ''}) during smoke test`);
      }
      return 0;
    };
  }
  return imports;
}

function readCString(memory, pointer, maximum) {
  const bytes = new Uint8Array(memory.buffer, pointer, maximum);
  let length = 0;
  while (length < bytes.length && bytes[length] !== 0) {
    ++length;
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}

export async function smokeWasm(filePath, expectedSimd) {
  const bytes = fs.readFileSync(filePath);
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, createImports(module));
  const api = instance.exports;
  const required = [
    'memory', 'malloc', 'free', 'et_abi_version', 'et_build_flags',
    'et_graph_capabilities', 'et_graph_version', 'et_kernel_count',
    'et_kernel_name', 'et_kernel_params_hash', 'et_kernel_param_bytes_capacity',
    'et_kernel_asset_capacity', 'et_engine_create', 'et_engine_prepare',
    'et_instance_set_param_bytes', 'et_instance_asset_begin', 'et_instance_asset_commit',
    'et_instance_asset_abort', 'et_instance_asset_state',
    'et_instance_process', 'et_instance_runtime_event',
    'et_pipeline_configure', 'et_pipeline_latency', 'et_pipeline_process',
    'et_graph_configure', 'et_graph_reset', 'et_graph_set_instance_params',
    'et_graph_latency', 'et_graph_process',
    'et_graph_snapshot_size', 'et_graph_snapshot_copy', 'et_graph_read_diagnostic'
  ];
  for (const name of required) {
    if (!(name in api)) {
      fail(`${path.basename(filePath)} is missing export ${name}`);
    }
  }
  const abiVersion = api.et_abi_version();
  const buildFlags = api.et_build_flags();
  if (abiVersion !== 1) {
    fail(`${path.basename(filePath)} reports ABI ${abiVersion}, expected 1`);
  }
  if (Boolean(buildFlags & 1) !== expectedSimd) {
    fail(`${path.basename(filePath)} reports incorrect SIMD build flags`);
  }
  if ((buildFlags & 4) === 0 || (api.et_graph_capabilities() & 1) === 0 ||
      api.et_graph_version() !== 1) {
    fail(`${path.basename(filePath)} does not expose Graph v1 capability`);
  }
  const count = api.et_kernel_count();
  const kernels = [];
  const paramSpecs = new Map(loadParamSpecs().map(spec => [spec.type, spec]));
  const namePointer = api.malloc(256);
  if (namePointer === 0) {
    fail('WASM malloc failed during capability smoke test');
  }
  try {
    for (let index = 0; index < count; ++index) {
      const length = api.et_kernel_name(index, namePointer, 256);
      if (length < 0 || length >= 256) {
        fail(`invalid kernel name length at index ${index}: ${length}`);
      }
      const name = readCString(api.memory, namePointer, length + 1);
      const assets = (paramSpecs.get(name)?.assets ?? []).map(asset => {
        const byteCapacity = api.et_kernel_asset_capacity(index, asset.slot) >>> 0;
        if (byteCapacity === 0) {
          fail(`${name} declares asset slot ${asset.slot} but exports zero capacity`);
        }
        return { ...asset, byteCapacity };
      });
      kernels.push({
        name,
        hash: api.et_kernel_params_hash(index) >>> 0,
        byteCapacity: api.et_kernel_param_bytes_capacity(index) >>> 0,
        assets
      });
    }
  } finally {
    api.free(namePointer);
  }
  return { abiVersion, buildFlags, kernels, bytes: bytes.length };
}

function collectDigestFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    // Hidden directories never hold digest inputs: they are toolchain and tool
    // caches (.emsdk, .pytest_cache), golden scratch (.golden-all-*), and
    // transient fixture directories that tests create and delete while the
    // digest walks the tree. Enumerating them makes the digest racy, so skip
    // every dot-directory (and vendored dependencies) rather than naming them.
    if (entry.isDirectory() &&
        (entry.name.startsWith('.') || entry.name === 'node_modules')) {
      continue;
    }
    if (entry.name === 'build' || entry.name === 'dist' || entry.name === 'golden') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectDigestFiles(fullPath, output);
    } else if (entry.isFile() &&
               (/\.(?:c|cc|cpp|h|hpp|inc|cmake|json|js|mjs)$/i.test(entry.name) ||
                ['CMakeLists.txt', 'EMSDK_VERSION', 'exports.txt'].includes(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
}

export function sourceDigestInputPaths() {
  const files = collectDigestFiles(dspRoot);
  files.push(
    generator,
    g726PerformanceInputsSource,
    fileURLToPath(import.meta.url)
  );
  files.sort((left, right) => left.localeCompare(right, 'en'));
  return files.map(filePath =>
    path.relative(repoRoot, filePath).replaceAll('\\', '/'));
}

export function sourceDigest() {
  const hash = crypto.createHash('sha256');
  for (const relative of sourceDigestInputPaths()) {
    const filePath = path.join(repoRoot, ...relative.split('/'));
    hash.update(relative);
    hash.update('\0');
    hash.update(normalized(fs.readFileSync(filePath, 'utf8')));
    hash.update('\0');
  }
  hash.update('baseline:-O3,-flto,standalone,growth,8MiB,256MiB\0');
  hash.update('simd:-O3,-flto,-msimd128,standalone,growth,8MiB,256MiB\0');
  return `sha256:${hash.digest('hex')}`;
}

export function metadataContents(
  emsdkVersion,
  baseline,
  simd,
  g726PerformanceInput = g726PerformanceInputManifest({ repoRoot })
) {
  if (JSON.stringify(baseline.kernels) !== JSON.stringify(simd.kernels)) {
    fail('baseline and SIMD artifacts expose different kernel registries');
  }
  return `${JSON.stringify({
    abiVersion: baseline.abiVersion,
    sourceDigest: sourceDigest(),
    emsdkVersion,
    g726PerformanceInput,
    kernels: baseline.kernels,
    sizes: { baseline: baseline.bytes, simd: simd.bytes }
  }, null, 2)}\n`;
}

function compareFile(source, destination) {
  return fs.existsSync(destination) && fs.readFileSync(source).equals(fs.readFileSync(destination));
}

async function buildWasm({
  check,
  outputRoot = artifactsRoot
}) {
  const g726PerformanceInputAtStart = g726PerformanceInputManifest({ repoRoot });
  const emsdk = emsdkPaths();
  const scratchTag = path.resolve(outputRoot) === path.resolve(artifactsRoot)
    ? ''
    : `-scratch-${crypto.createHash('sha256').update(path.resolve(outputRoot)).digest('hex').slice(0, 12)}`;
  const baselineBuild = configureAndBuildWasm({
    emcmake: emsdk.emcmake,
    name: `wasm${scratchTag}`,
    simd: false
  });
  const simdBuild = configureAndBuildWasm({
    emcmake: emsdk.emcmake,
    name: `wasm-simd${scratchTag}`,
    simd: true
  });
  const baselineArtifact = baselineBuild.artifact;
  const simdArtifact = simdBuild.artifact;
  const baseline = await smokeWasm(baselineArtifact, false);
  const simd = await smokeWasm(simdArtifact, true);
  for (const artifact of [baselineArtifact, simdArtifact]) {
    const module = await WebAssembly.compile(fs.readFileSync(artifact));
    const exports = new Set(
      WebAssembly.Module.exports(module).map(entry => entry.name)
    );
    for (const name of [
      'et_instance_debug_state',
      'et_instance_debug_state_v2',
      'et_instance_debug_begin_observation',
      'et_instance_debug_clear_detector_observation'
    ]) {
      if (exports.has(name)) {
        fail(`${path.basename(artifact)} leaked test-only export ${name}`);
      }
    }
  }
  const baselineDestination = path.join(outputRoot, 'effetune-dsp.wasm');
  const simdDestination = path.join(outputRoot, 'effetune-dsp.simd.wasm');
  const metaDestination = path.join(outputRoot, 'effetune-dsp.meta.json');
  const resolvedBuildAuthority = resolvedG726WasmBuildAuthority({
    baseline: resolvedG726WasmVariantAuthority({
      repoRoot,
      buildDirectory: baselineBuild.buildDirectory,
      configureArguments: baselineBuild.configureArguments,
      emsdkVersion: emsdk.version,
      variant: 'baseline'
    }),
    simd: resolvedG726WasmVariantAuthority({
      repoRoot,
      buildDirectory: simdBuild.buildDirectory,
      configureArguments: simdBuild.configureArguments,
      emsdkVersion: emsdk.version,
      variant: 'simd'
    })
  });
  const g726PerformanceInputWithoutResolvedAuthorityAtEnd =
    g726PerformanceInputManifest({ repoRoot });
  if (g726PerformanceInputWithoutResolvedAuthorityAtEnd.digest !==
      g726PerformanceInputAtStart.digest) {
    fail('G.726 performance inputs changed during the WASM build');
  }
  const g726PerformanceInputAtEnd = g726PerformanceInputManifest({
    repoRoot,
    resolvedBuildAuthority
  });
  const meta = metadataContents(
    emsdk.version,
    baseline,
    simd,
    g726PerformanceInputAtEnd
  );

  if (check) {
    const metaCurrent = fs.existsSync(metaDestination)
      ? fs.readFileSync(metaDestination, 'utf8')
      : null;
    if (!compareFile(baselineArtifact, baselineDestination) ||
        !compareFile(simdArtifact, simdDestination) || metaCurrent !== meta) {
      fail('committed DSP WASM artifacts or metadata are stale');
    }
  } else {
    copyIfChanged(baselineArtifact, baselineDestination);
    copyIfChanged(simdArtifact, simdDestination);
    writeIfChanged(metaDestination, meta);
  }
  console.log(`${check ? 'Checked' : 'Built'} ${baseline.kernels.length} DSP kernel(s).`);
}

async function buildDebugStateWasm() {
  const emsdk = emsdkPaths();
  const variants = {};
  for (const [name, simd] of [['wasm-debug-state', false], ['wasm-simd-debug-state', true]]) {
    const build = configureAndBuildWasm({
      emcmake: emsdk.emcmake,
      name,
      simd,
      debugState: true
    });
    const artifact = build.artifact;
    const smoke = await smokeWasm(artifact, simd);
    const bytes = fs.readFileSync(artifact);
    const module = await WebAssembly.compile(bytes);
    const debugExports = WebAssembly.Module.exports(module)
      .map(entry => entry.name);
    if (!debugExports.includes('et_instance_debug_state') ||
        !debugExports.includes('et_instance_debug_state_v2') ||
        !debugExports.includes('et_instance_debug_begin_observation') ||
        !debugExports.includes(
          'et_instance_debug_clear_detector_observation'
        )) {
      fail(
        `${path.basename(artifact)} is missing a test-only debug state export`
      );
    }
    variants[simd ? 'simd' : 'baseline'] = {
      path: path.relative(repoRoot, artifact).replaceAll('\\', '/'),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: smoke.bytes,
      simd,
      debugState: true,
      abiVersion: smoke.abiVersion,
      buildFlags: smoke.buildFlags
    };
  }
  const metadata = {
    contract: 'effetune-dsp-debug-state-wasm-v1',
    sourceDigest: sourceDigest(),
    emsdkVersion: emsdk.version,
    variants
  };
  const metadataPath = path.join(buildRoot, 'debug-state-wasm.meta.json');
  writeIfChanged(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`${JSON.stringify({
    ...metadata,
    metadataPath:
      path.relative(repoRoot, metadataPath).replaceAll('\\', '/')
  }, null, 2)}\n`);
}

function printHelp() {
  console.log('Usage: node scripts/build-dsp-wasm.mjs [--check|--native-tests|--native-test-warning-check|--debug-state-wasm] [--native-build-type=Debug|Release] [--artifacts-dir <path>]');
  console.log('  default         check native test warnings, update codegen/inlining, and build committed baseline + SIMD WASM');
  console.log('  --check         write-free codegen/inlining/artifact freshness verification');
  console.log('  --native-tests  configure, compile, and run native CTest tests (no emsdk needed)');
  console.log('  --native-test-warning-check  compile registered native test sources with Emscripten Clang warnings');
  console.log('  --debug-state-wasm  build uncommitted baseline + SIMD WASM with test state export');
  console.log('  --native-build-type  native CMake build type (default Debug; requires --native-tests)');
  console.log('  --artifacts-dir  build baseline, SIMD, and metadata into a scratch directory');
}

export function parseArtifactsDirectory(args) {
  const equals = args.find(arg => arg.startsWith('--artifacts-dir='));
  const index = args.indexOf('--artifacts-dir');
  if (equals !== undefined && index !== -1) {
    fail('--artifacts-dir may only be specified once');
  }
  const value = equals?.slice('--artifacts-dir='.length) ??
    (index === -1 ? null : args[index + 1]);
  if (index !== -1 && (value === undefined || value.startsWith('--'))) {
    fail('--artifacts-dir requires a path');
  }
  if (value === '') {
    fail('--artifacts-dir requires a path');
  }
  return value === null ? null : path.resolve(repoRoot, value);
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const args = new Set(cliArgs);
  if (args.has('--help')) {
    printHelp();
    return;
  }
  const artifactsDirectory = parseArtifactsDirectory(cliArgs);
  const allowed = new Set([
    '--check', '--native-tests', '--native-test-warning-check',
    '--debug-state-wasm'
  ]);
  const unknown = cliArgs.filter((arg, index) =>
    !allowed.has(arg) && !arg.startsWith('--native-build-type=') &&
    !arg.startsWith('--artifacts-dir=') && arg !== '--artifacts-dir' &&
    !(index > 0 && cliArgs[index - 1] === '--artifacts-dir'));
  if (unknown.length !== 0) {
    fail(`unknown argument(s): ${unknown.join(', ')}`);
  }
  const check = args.has('--check');
  const nativeTests = args.has('--native-tests');
  const nativeTestWarningCheck = args.has('--native-test-warning-check');
  const debugStateWasm = args.has('--debug-state-wasm');
  if ([check, nativeTests, nativeTestWarningCheck, debugStateWasm]
    .filter(Boolean).length > 1) {
    fail('--check, --native-tests, --native-test-warning-check, and --debug-state-wasm are mutually exclusive');
  }
  if (artifactsDirectory !== null &&
      (check || nativeTests || nativeTestWarningCheck || debugStateWasm)) {
    fail('--artifacts-dir cannot be combined with --check, --native-tests, --native-test-warning-check, or --debug-state-wasm');
  }
  const nativeBuildType = parseNativeBuildType(cliArgs);
  if (!nativeTests && cliArgs.some(arg => arg.startsWith('--native-build-type='))) {
    fail('--native-build-type requires --native-tests');
  }
  if (nativeTestWarningCheck) {
    runNativeTestWarningCheck();
    return;
  }
  const writeFreePreparation = check || debugStateWasm || artifactsDirectory !== null;
  runCodegen(writeFreePreparation);
  refreshWorkletBinding(writeFreePreparation);
  if (nativeTests) {
    runNativeTests(nativeBuildType);
    return;
  }
  runNativeTestWarningCheck();
  if (debugStateWasm) {
    await buildDebugStateWasm();
    return;
  }
  await buildWasm({
    check,
    outputRoot: artifactsDirectory ?? artifactsRoot
  });
}

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
