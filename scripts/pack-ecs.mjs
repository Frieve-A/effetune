import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import electronBuilder from 'electron-builder';
import { getEcsRuntime, ECS_VERSION, verifyEcsArchive } from './prepare-ecs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  'runtime-zip': { type: 'string' },
  'app-dir': { type: 'string' },
  output: { type: 'string' },
  prepackaged: { type: 'string' },
  'sign-vmp': { type: 'boolean', default: false },
} });
const runtime = getEcsRuntime();
if (values['sign-vmp'] && (process.platform !== 'darwin' || values.prepackaged)) {
  throw new Error('--sign-vmp requires a fresh macOS application build.');
}
const runtimeZip = resolve(values['runtime-zip'] || runtime.archive);
if (!values.prepackaged) await verifyEcsArchive(runtimeZip);

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = values.output ? resolve(values.output) : join(root, 'out', 'ecs', runtime.target);
const platform = process.platform === 'win32' ? electronBuilder.Platform.WINDOWS
  : process.platform === 'darwin' ? electronBuilder.Platform.MAC : electronBuilder.Platform.LINUX;
const targets = process.platform === 'linux' ? ['AppImage']
  : values.prepackaged ? process.platform === 'win32' ? ['nsis', 'portable'] : ['dmg'] : ['dir'];
let vmpDirectory;
function runVmp(action, directory) {
  const result = spawnSync('python', [
    '-m', 'castlabs_evs.vmp', '--no-ask', action, '--streaming', directory,
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ECS VMP ${action} failed.`);
}
await electronBuilder.build({
  projectDir: root,
  targets: platform.createTarget(targets, electronBuilder.Arch[process.arch]),
  ...(values.prepackaged ? { prepackaged: resolve(values.prepackaged) } : {}),
  publish: 'never',
  config: {
    extends: null,
    electronVersion: ECS_VERSION,
    electronDist: runtimeZip,
    directories: {
      output,
      ...(values['app-dir'] ? { app: resolve(values['app-dir']) } : {}),
    },
    win: { signExecutable: false },
    ...(process.platform === 'darwin' ? {
      mac: {
        identity: values['sign-vmp'] ? '-' : null,
        notarize: false,
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.plist',
      },
      dmg: { sign: false },
    } : {}),
    ...(values['sign-vmp'] ? {
      // afterPack runs after resource edits and before electron-builder's ad-hoc signing.
      afterPack: async context => {
        vmpDirectory = context.appOutDir;
        runVmp('sign-pkg', vmpDirectory);
      },
    } : {}),
  },
});

if (values['sign-vmp']) runVmp('verify-pkg', vmpDirectory);

if (process.platform === 'win32' && !values.prepackaged) {
  const unpacked = join(output, 'win-unpacked');
  // Resource edits invalidate the runtime's development signature. Sign this final app separately.
  await rm(join(unpacked, 'electron.exe.sig'), { force: true });
  await rm(join(unpacked, `${packageJson.build.productName}.exe.sig`), { force: true });
  console.log(`ECS application ready for VMP signing: ${unpacked}`);
}
