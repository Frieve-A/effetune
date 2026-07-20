import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const experimentRoot = path.dirname(fileURLToPath(import.meta.url));
const dspRoot = path.resolve(experimentRoot, '..', '..');
const repoRoot = path.resolve(dspRoot, '..');
const buildRoot = path.join(dspRoot, 'build');

function fail(message) {
  throw new Error(message);
}

function run(command, args, { cwd = repoRoot, env = process.env, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true
  });
  if (result.error) fail(`Unable to start ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd() : '';
    fail(`${command} exited with ${result.status}${output}`);
  }
  return result.stdout ?? '';
}

function nativeEnvironment() {
  if (process.platform !== 'win32' || process.env.VCINSTALLDIR) return process.env;
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) fail('Visual Studio vswhere.exe was not found');
  const installation = run(vswhere, [
    '-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'
  ], { capture: true }).trim();
  if (!installation) fail('Visual C++ tools were not found');
  const tools = path.join(installation, 'Common7', 'Tools');
  const result = spawnSync('cmd.exe', [
    '/d', '/s', '/c', 'call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set'
  ], {
    cwd: tools,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  if (result.error) fail(`Unable to start cmd.exe: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
    fail(`cmd.exe exited with ${result.status}${output}`);
  }
  const environmentText = result.stdout ?? '';
  const environment = { ...process.env };
  for (const line of environmentText.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return environment;
}

function emsdk() {
  const root = path.resolve(process.env.EMSDK || path.join(dspRoot, '.emsdk'));
  const emcmake = path.join(root, 'upstream', 'emscripten',
    process.platform === 'win32' ? 'emcmake.exe' : 'emcmake');
  if (!fs.existsSync(emcmake)) fail(`emcmake was not found under ${root}`);
  return emcmake;
}

function configureAndBuild(variant) {
  const directory = path.join(buildRoot, `long-convolution-${variant}`);
  const common = [
    '-S', dspRoot, '-B', directory, '-G', 'Ninja',
    '-DBUILD_TESTING=OFF', '-DET_BUILD_LONG_CONVOLUTION_EXPERIMENT=ON'
  ];
  if (variant === 'native' || variant === 'native-release') {
    const env = nativeEnvironment();
    run('cmake', [...common,
      `-DCMAKE_BUILD_TYPE=${variant === 'native' ? 'Debug' : 'Release'}`], { env });
    run('cmake', ['--build', directory, '--target',
      'effetune-long-convolution-experiment', '--parallel'], { env });
    return path.join(directory, 'effetune-long-convolution-experiment.exe');
  }
  run(emsdk(), ['cmake', ...common, '-DCMAKE_BUILD_TYPE=Release',
    `-DET_SIMD=${variant === 'simd' ? 'ON' : 'OFF'}`]);
  run('cmake', ['--build', directory, '--target',
    'effetune-long-convolution-experiment', '--parallel']);
  run('cmake', ['--build', directory, '--target',
    'effetune-long-convolution-worker', '--parallel']);
  return path.join(directory, 'effetune-long-convolution-experiment.js');
}

function parseArguments(argv) {
  let variants = ['native'];
  let savePrefix = '';
  const separator = argv.indexOf('--');
  const buildArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const experimentArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  for (let index = 0; index < buildArgs.length; index++) {
    if (buildArgs[index] === '--variants') {
      variants = String(buildArgs[++index] ?? '').split(',').filter(Boolean);
    } else if (buildArgs[index] === '--save-prefix') {
      savePrefix = path.resolve(repoRoot, String(buildArgs[++index] ?? ''));
    } else if (buildArgs[index] === '--help') {
      console.log('Usage: node run.mjs [--variants native,wasm,simd] [--save-prefix PATH] -- [experiment args]');
      process.exit(0);
    } else {
      fail(`Unknown runner option ${buildArgs[index]}`);
    }
  }
  for (const variant of variants) {
    if (!['native', 'native-release', 'wasm', 'simd'].includes(variant)) {
      fail(`Unknown variant ${variant}`);
    }
  }
  return { variants, experimentArgs, savePrefix };
}

const { variants, experimentArgs, savePrefix } = parseArguments(process.argv.slice(2));
for (const variant of variants) {
  const executable = configureAndBuild(variant);
  console.log(`\n=== ${variant} ===`);
  const command = variant === 'native' || variant === 'native-release' ? executable : process.execPath;
  const args = variant === 'native' || variant === 'native-release'
    ? experimentArgs
    : [executable, ...experimentArgs];
  if (!savePrefix) {
    run(command, args);
    continue;
  }
  const output = run(command, args, { capture: true });
  process.stdout.write(output);
  const outputPath = `${savePrefix}-${variant}.json`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`Saved ${outputPath}`);
}
