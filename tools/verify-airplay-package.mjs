import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function airplayRuntimeEnvironment(directory, registryPath) {
  return {
    ...process.env,
    PATH: process.platform === 'win32'
      ? `${directory};${path.join(process.env.SystemRoot, 'System32')}`
      : '/usr/bin:/bin',
    GST_PLUGIN_SYSTEM_PATH: '', GST_PLUGIN_SYSTEM_PATH_1_0: '',
    GST_PLUGIN_PATH: path.join(directory, 'plugins'),
    GST_PLUGIN_PATH_1_0: path.join(directory, 'plugins'),
    GST_REGISTRY: registryPath, GST_REGISTRY_1_0: registryPath,
    GST_REGISTRY_FORK: 'no'
  };
}

function runtimeDirectories(target) {
  if (fs.existsSync(path.join(target, 'runtime-manifest.json'))) return [target];
  if (fs.existsSync(path.join(target, 'airplay', 'runtime-manifest.json'))) return [path.join(target, 'airplay')];
  const result = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(target, entry.name);
    if (/^(?:win|linux)(?:-[a-z0-9]+)?-unpacked$/.test(entry.name)) {
      result.push(path.join(root, 'resources', 'airplay'));
    } else if (/^mac(?:-[a-z0-9]+)?$/.test(entry.name)) {
      for (const app of fs.readdirSync(root, { withFileTypes: true })) {
        if (app.isDirectory() && app.name.endsWith('.app')) {
          result.push(path.join(root, app.name, 'Contents', 'Resources', 'airplay'));
        }
      }
    } else if (entry.name.endsWith('.app')) {
      result.push(path.join(root, 'Contents', 'Resources', 'airplay'));
    }
  }
  return result;
}

function safeFile(directory, relative) {
  assert.equal(typeof relative, 'string');
  const absolute = path.resolve(directory, relative);
  const within = path.relative(path.resolve(directory), absolute);
  assert.ok(within && !within.startsWith('..') && !path.isAbsolute(within), 'Package path must remain inside resources');
  return absolute;
}

export function verifyAirplayRuntime(directory, { execute = true, rtpOutput = null } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(['win32', 'darwin', 'linux'].includes(manifest.platform));
  assert.ok(['x64', 'arm64'].includes(manifest.architecture));
  assert.equal(manifest.sampleRate, 44100);
  assert.equal(manifest.channelCount, 2);
  assert.equal(manifest.format, 'S16BE');
  assert.equal(manifest.transport, 'RTP-L16');
  assert.ok(fs.statSync(path.join(directory, 'THIRD_PARTY_NOTICES.txt')).size > 100);
  assert.equal(fs.readFileSync(path.join(directory, 'uxplay.conf'), 'utf8'), '');
  for (const file of manifest.files) assert.ok(fs.statSync(safeFile(directory, file)).isFile());
  assert.ok(Array.isArray(manifest.sources) && manifest.sources.length > 0);
  for (const entry of manifest.sources) {
    const name = entry.file || (entry.commit ? `${entry.name}-${entry.commit}.zip` : entry.name);
    const source = fs.readFileSync(safeFile(path.join(directory, 'source'), name));
    assert.equal(createHash('sha256').update(source).digest('hex'), entry.sha256, `Source archive changed: ${name}`);
  }
  if (manifest.platform === 'win32') {
    assert.ok(fs.statSync(path.join(directory, 'discovery', 'mDNSResponder.exe')).size > 1024);
    assert.ok(fs.statSync(path.join(directory, 'discovery', 'install-discovery.exe')).size > 1024);
  }
  const executable = path.join(directory, manifest.platform === 'win32' ? 'uxplay.exe' : 'uxplay');
  const header = fs.readFileSync(executable).subarray(0, 4096);
  if (manifest.platform === 'win32') {
    assert.equal(header.subarray(0, 2).toString(), 'MZ');
    const offset = header.readUInt32LE(0x3c);
    assert.equal(header.subarray(offset, offset + 4).toString(), 'PE\0\0');
    assert.equal(header.readUInt16LE(offset + 4), 0x8664);
  } else if (manifest.platform === 'linux') {
    assert.equal(header.subarray(0, 4).toString('hex'), '7f454c46');
  } else {
    assert.ok(['cffaedfe', 'cefaedfe', 'cafebabe'].includes(header.subarray(0, 4).toString('hex')));
  }
  const matchingHost = manifest.platform === process.platform && manifest.architecture === process.arch;
  if (execute && matchingHost) {
    const temporaryParent = fs.realpathSync(os.tmpdir());
    const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(temporaryParent, 'effetune-airplay-package-')));
    try {
      const environment = airplayRuntimeEnvironment(directory, path.join(temporaryRoot, 'registry.bin'));
      for (const [program, args] of [
        [executable, ['-h']],
        [path.join(directory, manifest.platform === 'win32' ? 'airplay-package-probe.exe' : 'airplay-package-probe'),
          rtpOutput ? ['--rtp-output', rtpOutput] : []]
      ]) {
        const result = spawnSync(program, args, { cwd: directory, env: environment,
          encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `${path.basename(program)} failed: ${result.stderr || result.stdout}`);
      }
    } finally {
      assert.equal(path.dirname(temporaryRoot), temporaryParent);
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  return { directory, platform: manifest.platform, architecture: manifest.architecture,
    nativeExecution: execute && matchingHost };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || 'dist');
  const directories = runtimeDirectories(target);
  assert.ok(directories.length > 0, 'No unpacked AirPlay runtime was found');
  for (const directory of directories) {
    const result = verifyAirplayRuntime(directory);
    console.log(`AirPlay package passed (${result.platform}-${result.architecture}, native ${result.nativeExecution ? 'executed' : 'unavailable on this host'})`);
  }
}
