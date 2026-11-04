import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'out/native/renderer-power/win32-x64');
const output = join(outputDir, 'effetune-renderer-power.exe');
const source = join(root, 'native/renderer-power/renderer-power.cpp');

if (process.platform !== 'win32') {
  console.log('Renderer power helper is only needed for Windows packages.');
  process.exit(0);
}

function visualStudioCommand() {
  const installations = ['Community', 'Professional', 'Enterprise', 'BuildTools'];
  for (const edition of installations) {
    const candidate = `C:\\Program Files\\Microsoft Visual Studio\\2022\\${edition}\\Common7\\Tools\\VsDevCmd.bat`;
    if (existsSync(candidate)) return candidate;
  }
  const vswhere = join(process.env['ProgramFiles(x86)'] || '',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (existsSync(vswhere)) {
    const result = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { encoding: 'utf8', windowsHide: true });
    const candidate = join(result.stdout?.trim() || '', 'Common7', 'Tools', 'VsDevCmd.bat');
    if (result.status === 0 && existsSync(candidate)) return candidate;
  }
  throw new Error('Visual Studio 2022 with x64 C++ tools was not found.');
}

function visualStudioEnvironment() {
  // Only the fixed setup command runs through cmd. /u preserves Unicode paths in set's output.
  const result = spawnSync('cmd.exe', ['/d', '/u', '/s', '/c', 'call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set'], {
    cwd: dirname(visualStudioCommand()), encoding: 'utf16le', stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Visual Studio environment setup failed (${result.status}).`);
  const env = Object.create(null);
  for (const line of result.stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) env[line.slice(0, separator).toUpperCase()] = line.slice(separator + 1);
  }
  return env;
}

mkdirSync(outputDir, { recursive: true });
const env = visualStudioEnvironment();
if (!env.VCTOOLSINSTALLDIR) throw new Error('Visual Studio did not configure the C++ tools directory.');
const compiler = join(env.VCTOOLSINSTALLDIR, 'bin', 'Hostx64', 'x64', 'cl.exe');
const result = spawnSync(compiler, ['/nologo', '/std:c++17', '/O2', '/W4', '/WX', '/EHsc', '/MT', `/Fe:${output}`, source], {
  cwd: outputDir, env, stdio: 'inherit', windowsHide: true
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Renderer power helper build failed (${result.status}).`);
if (!existsSync(output)) throw new Error('Renderer power helper binary is missing.');
console.log(output);
