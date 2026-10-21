import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ECS_VERSION } from './prepare-ecs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const msixDirectory = join(root, 'build', 'msix');
const require = createRequire(import.meta.url);
const requiredFiles = [
  'EffeTune.exe', 'EffeTune.exe.sig', 'resources/app.asar',
  'resources/openhome/effetune-openhome-sidecar.exe',
  'resources/openhome/THIRD_PARTY_NOTICES.txt',
  'LICENSE.electron.txt', 'LICENSES.chromium.html',
];
const forbiddenDirectories = new Set([
  'effetune_settings', 'widevinecdm', 'cdm', 'cache', 'code cache',
  'gpucache', 'browser profiles', 'user data',
]);

export function storeVersion(version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'MSIX requires a stable X.Y.Z version.');
  const parts = version.split('.').map(Number);
  assert.ok(parts[0] >= 1 && parts.every(part => part <= 65535), 'MSIX version components must fit Windows package version limits.');
  return `${version}.0`;
}

export function validateIdentity(identity, testIdentity = false) {
  assert.ok(identity && typeof identity === 'object', 'Store identity must be a JSON object.');
  for (const key of ['name', 'publisher', 'publisherDisplayName', 'productId']) {
    assert.ok(typeof identity[key] === 'string' && identity[key].trim() === identity[key] && identity[key],
      `Set ${key} in build/msix/store-identity.json using Partner Center values.`);
  }
  assert.match(identity.name, /^[A-Za-z0-9.-]{3,50}$/, 'Invalid package Identity Name.');
  assert.ok(identity.publisher.startsWith('CN='), 'Publisher must be the full Partner Center distinguished name.');
  assert.ok([...Object.values(identity).join('')].every(character => character.charCodeAt(0) >= 32), 'Identity contains control characters.');
  if (!testIdentity) {
    assert.match(identity.productId, /^[A-Z0-9]{12}$/, 'Use the real 12-character Store Product ID.');
    assert.ok(!/localtest|placeholder|example|replace|unset/i.test(`${identity.name} ${identity.publisher}`),
      'Test or placeholder identity cannot produce a Store submission.');
  }
  return Object.fromEntries(['name', 'publisher', 'publisherDisplayName', 'productId'].map(key => [key, identity[key]]));
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

export function renderManifest(template, packageJson, identity) {
  const associations = packageJson.build.fileAssociations.map((association, index) => {
    const extensions = [association.ext].flat();
    assert.ok(extensions.length && extensions.every(extension => /^[a-z0-9_]+$/.test(extension)), 'Invalid file association extension.');
    return `        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="effetune.file${index}">
            <uap:DisplayName>${xml(association.name)}</uap:DisplayName>
            <uap:SupportedFileTypes>${extensions.map(extension => `<uap:FileType>.${extension}</uap:FileType>`).join('')}</uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>`;
  }).join('\n');
  const substitutions = {
    NAME: xml(identity.name), PUBLISHER: xml(identity.publisher),
    PUBLISHER_DISPLAY_NAME: xml(identity.publisherDisplayName),
    VERSION: storeVersion(packageJson.version), FILE_ASSOCIATIONS: associations,
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    assert.ok(Object.hasOwn(substitutions, key), `Unknown manifest substitution: ${key}`);
    return substitutions[key];
  });
}

export async function inspectPayload(directory) {
  assert.ok(!(await lstat(directory)).isSymbolicLink(), 'Package input must not be a link.');
  async function inspect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), `Package input must not contain links: ${join(current, entry.name)}`);
      if (entry.isDirectory()) {
        assert.ok(!forbiddenDirectories.has(entry.name.toLowerCase()), `Remove local settings or cache before MSIX packaging: ${entry.name}`);
        await inspect(join(current, entry.name));
      } else {
        assert.ok(entry.isFile(), `Unsupported package entry: ${entry.name}`);
      }
    }
  }
  await inspect(directory);
  for (const name of requiredFiles) {
    const stats = await lstat(join(directory, name));
    assert.ok(stats.isFile() && stats.size > 0, `Missing or empty MSIX input: ${name}`);
  }
  const executable = await readFile(join(directory, 'EffeTune.exe'));
  assert.ok(executable.length >= 64 && executable.subarray(0, 2).equals(Buffer.from('MZ')), 'EffeTune.exe must be a PE executable.');
  const offset = executable.readUInt32LE(0x3c);
  assert.ok(offset + 6 <= executable.length && executable.toString('binary', offset, offset + 4) === 'PE\0\0' &&
    executable.readUInt16LE(offset + 4) === 0x8664, 'MSIX requires the x64 EffeTune executable.');
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed with exit code ${result.status}.`);
}

async function sdkDirectory(override) {
  if (override) return resolve(override);
  const bin = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = (await readdir(bin)).filter(name => /^10\.0\.\d+\.0$/.test(name))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = join(bin, version, 'x64');
    try {
      await Promise.all(['makeappx.exe', 'makepri.exe'].map(name => lstat(join(candidate, name))));
      return candidate;
    } catch { /* Try the next installed Windows SDK. */ }
  }
  throw new Error('Install a Windows 10/11 SDK with MakeAppx and MakePRI, or pass --sdk-dir.');
}

export async function packMsix(options) {
  assert.equal(process.platform, 'win32', 'MSIX packaging requires Windows.');
  assert.ok(options.prepackaged, 'Pass --prepackaged with the final VMP-signed ECS win-unpacked directory.');
  const identityPath = options.identity || join(msixDirectory, options.testIdentity ? 'test-identity.json' : 'store-identity.json');
  const identity = validateIdentity(JSON.parse(await readFile(identityPath, 'utf8')), options.testIdentity);
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const version = storeVersion(packageJson.version);
  assert.ok(!(await lstat(resolve(options.prepackaged))).isSymbolicLink(), 'Package input must not be a link.');
  const input = await realpath(resolve(options.prepackaged));
  await inspectPayload(input);
  const appPackage = JSON.parse(require('@electron/asar').extractFile(join(input, 'resources', 'app.asar'), 'package.json').toString('utf8'));
  assert.equal(appPackage.name, packageJson.name, 'The prepackaged application name does not match this checkout.');
  assert.equal(appPackage.version, packageJson.version, 'The prepackaged application version does not match this checkout.');
  const output = resolve(options.output || join(root, 'dist', 'store'));
  const relation = relative(input, output);
  assert.ok(relation && (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)), 'MSIX output must be outside the input payload.');
  const sdk = await sdkDirectory(options.sdkDir);
  const makeAppx = join(sdk, 'makeappx.exe');
  const makePri = join(sdk, 'makepri.exe');
  const executableSha256 = await sha256(join(input, 'EffeTune.exe'));
  const signatureSha256 = await sha256(join(input, 'EffeTune.exe.sig'));
  await mkdir(join(root, 'out', 'msix'), { recursive: true });
  const work = await mkdtemp(join(root, 'out', 'msix', 'pack-'));
  try {
    const staging = join(work, 'staging');
    await mkdir(staging);
    await cp(input, join(staging, 'app'), { recursive: true });
    await cp(join(msixDirectory, 'Assets'), join(staging, 'Assets'), { recursive: true });
    await writeFile(join(staging, 'AppxManifest.xml'), renderManifest(await readFile(join(msixDirectory, 'AppxManifest.xml'), 'utf8'), packageJson, identity));
    const priConfig = join(work, 'priconfig.xml');
    run(makePri, ['createconfig', '/cf', priConfig, '/dq', 'en-US', '/o']);
    run(makePri, ['new', '/pr', staging, '/cf', priConfig, '/of', join(staging, 'resources.pri'), '/o']);
    const filename = `EffeTune-${packageJson.version}-Store-x64.msix`;
    const temporaryPackage = join(work, filename);
    run(makeAppx, ['pack', '/d', staging, '/p', temporaryPackage, '/o']);
    const unpacked = join(work, 'verified');
    run(makeAppx, ['unpack', '/p', temporaryPackage, '/d', unpacked, '/o']);
    await inspectPayload(join(unpacked, 'app'));
    assert.equal(await readFile(join(unpacked, 'AppxManifest.xml'), 'utf8'), await readFile(join(staging, 'AppxManifest.xml'), 'utf8'));
    for (const directory of [input, join(staging, 'app'), join(unpacked, 'app')]) {
      assert.equal(await sha256(join(directory, 'EffeTune.exe')), executableSha256, 'VMP executable changed during MSIX packaging.');
      assert.equal(await sha256(join(directory, 'EffeTune.exe.sig')), signatureSha256, 'VMP signature changed during MSIX packaging.');
    }
    const git = args => {
      const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, 'Could not identify MSIX source revision.');
      return result.stdout.trim();
    };
    const metadata = {
      schemaVersion: 1, tag: `v${packageJson.version}`, commit: git(['rev-parse', 'HEAD']),
      packageVersion: packageJson.version, version, architecture: 'x64', identity,
      filename, sha256: await sha256(temporaryPackage), executableSha256, signatureSha256,
      ecsVersion: ECS_VERSION, sdkVersion: dirname(sdk).split(/[\\/]/).pop(),
      testIdentity: Boolean(options.testIdentity),
      testOnly: Boolean(options.testIdentity),
    };
    await mkdir(output, { recursive: true });
    await cp(temporaryPackage, join(output, filename));
    await writeFile(join(output, 'store-package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Unsigned ${options.testIdentity ? 'TEST ONLY' : 'Store'} MSIX: ${join(output, filename)}`);
    return metadata;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    prepackaged: { type: 'string' }, output: { type: 'string' }, identity: { type: 'string' },
    'test-identity': { type: 'boolean', default: false }, 'sdk-dir': { type: 'string' },
  } });
  await packMsix({ ...values, testIdentity: values['test-identity'], sdkDir: values['sdk-dir'] });
}
