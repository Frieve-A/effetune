import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.platform;
const architecture = process.arch;
const source = join(root, 'native', 'audio-engine');
const output = join(root, 'out', 'native', 'audio-engine', `${platform}-${architecture}`);

function run(command, args, { cwd = root, env = process.env, encoding } = {}) {
  const result = spawnSync(command, args, {
    cwd, env, encoding, windowsHide: true,
    stdio: encoding ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
  return result.stdout;
}

function visualStudioEnvironment() {
  const vswhere = join(process.env['ProgramFiles(x86)'] || '',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = process.env.VSINSTALLDIR || (existsSync(vswhere) && run(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath', '-utf8',
  ], { encoding: 'utf8' }).trim());
  if (!installation) throw new Error('Visual Studio with the x64 C++ tools was not found.');
  // Only the fixed environment setup command runs through cmd.
  const setup = spawnSync('cmd.exe', [
    '/d', '/u', '/s', '/c', 'call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set',
  ], { cwd: join(installation, 'Common7', 'Tools'), encoding: 'utf16le', windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit'] });
  if (setup.error) throw setup.error;
  if (setup.status !== 0) throw new Error(`Visual Studio environment setup failed (${setup.status ?? setup.signal}).`);
  const env = Object.create(null);
  for (const line of setup.stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) env[line.slice(0, separator).toUpperCase()] = line.slice(separator + 1);
  }
  if (!env.VCTOOLSINSTALLDIR) throw new Error('Visual Studio did not configure the C++ tools directory.');
  return env;
}

function build({ compiler, env, configuration, variant, test }) {
  const buildName = `${compiler[0]}-${variant}-${configuration}${test ? '-tests' : ''}`;
  const buildDirectory = join(output, 'cmake', buildName);
  const runtimeDirectory = test ? join(output, 'tests', buildName) : output;
  const definitions = [
    `-DCMAKE_C_COMPILER=${compiler[0]}`,
    `-DCMAKE_CXX_COMPILER=${compiler[1]}`,
    `-DCMAKE_BUILD_TYPE=${configuration}`,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${runtimeDirectory}`,
    `-DET_AUDIO_ENGINE_X64_V3=${variant === 'v3' ? 'ON' : 'OFF'}`,
    `-DET_AUDIO_ENGINE_BUILD_TESTS=${test ? 'ON' : 'OFF'}`,
  ];
  if (platform === 'darwin') {
    definitions.push(`-DCMAKE_OSX_ARCHITECTURES=${architecture === 'x64' ? 'x86_64' : 'arm64'}`);
  }

  run('cmake', ['-S', source, '-B', buildDirectory, '-G', 'Ninja', ...definitions], { env });
  run('cmake', ['--build', buildDirectory], { env });
  if (test) {
    run('ctest', ['--test-dir', buildDirectory, '--output-on-failure', '--no-tests=error'], { env });
  }
}

function main(args) {
  let test = false;
  let gcc = false;
  let requestedArchitecture = architecture;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--native-tests') test = true;
    else if (argument === '--gcc') gcc = true;
    else if (argument === '--arch') requestedArchitecture = args[++index];
    else if (argument.startsWith('--arch=')) requestedArchitecture = argument.slice('--arch='.length);
    else throw new Error(`Unknown audio engine build argument: ${argument}`);
  }
  if (!['x64', 'arm64'].includes(requestedArchitecture)) throw new Error('--arch must be x64 or arm64.');
  if (requestedArchitecture !== architecture) {
    throw new Error(`The audio engine must be built on a ${requestedArchitecture} runner (current: ${architecture}).`);
  }
  if (!['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64'].includes(`${platform}-${architecture}`)) {
    throw new Error(`The audio engine does not support ${platform}-${architecture}.`);
  }
  if (gcc && (!test || platform !== 'linux')) {
    throw new Error('--gcc requires --native-tests on Linux.');
  }

  const env = platform === 'win32' ? visualStudioEnvironment() : process.env;
  let compiler = ['clang', 'clang++'];
  if (platform === 'win32') {
    compiler = ['clang-cl', 'clang-cl'];
  } else if (gcc) {
    compiler = ['gcc', 'g++'];
  }
  const configurations = gcc ? ['Debug'] : ['Debug', 'Release'];
  const variants = architecture === 'x64' && !gcc ? ['baseline', 'v3'] : ['baseline'];
  for (const configuration of test ? configurations : ['Release']) {
    for (const variant of variants) {
      build({ compiler, env, configuration, variant, test });
    }
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
