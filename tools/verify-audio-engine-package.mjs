import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  executableNames, forceBaselineEnv, protocolVersion, unsupportedCpuExitCode, withAudioEngine,
} from './audio-engine-session.mjs';

const notice = 'THIRD_PARTY_NOTICES.txt';
const expectedNotice = new URL(`../native/audio-engine/${notice}`, import.meta.url);

async function verifyNullSession(executable, allowUnsupportedCpu) {
  await withAudioEngine(executable, ['--backend', 'null'], async session => {
    const hello = await session.readFrame();
    if (hello === null && allowUnsupportedCpu) {
      const { code, signal, diagnostics } = await session.finish();
      assert.equal(signal, null, diagnostics);
      assert.equal(code, unsupportedCpuExitCode, diagnostics);
      return;
    }
    assert.ok(hello && hello.kind === 1 && hello.message.type === 'hello');
    assert.equal(hello.message.version, protocolVersion);
    assert.ok(hello.message.backends.includes('null'));
    await session.send({ type: 'hello', version: protocolVersion });
    await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2, periodFrames: 128 });
    const { message } = await session.receive('sessionState');
    assert.equal(message.state, 'open', JSON.stringify(message));
    await session.send({ type: 'closeSession' });
    await session.receive('sessionState', state => state.state === 'closed');
    const { code, signal, diagnostics } = await session.finish();
    assert.equal(signal, null, diagnostics);
    assert.equal(code, 0, diagnostics);
  });
}

export async function verifyAudioEngineResources(resources, platform, architecture, verifySignature = false) {
  const directory = join(resources, 'audio-engine');
  assert.ok(lstatSync(directory).isDirectory(), `${directory} must be a resource directory`);
  const { baseline, v3 } = executableNames(platform, architecture);
  const names = v3 ? [baseline, v3] : [baseline];
  assert.deepEqual(readdirSync(directory).sort(), [...names, notice].sort(),
    `${directory} must contain only the engine executable(s) and third-party notices`);
  for (const name of [...names, notice]) {
    const entry = lstatSync(join(directory, name));
    assert.ok(entry.isFile() && entry.size > 0, `Missing or empty audio engine resource: ${name}`);
  }
  assert.deepEqual(readFileSync(join(directory, notice)), readFileSync(expectedNotice));

  if (platform !== process.platform || architecture !== process.arch) return;
  if (platform === 'darwin') {
    const plist = spawnSync('plutil', ['-extract', 'NSMicrophoneUsageDescription', 'raw', '-o', '-',
      join(resources, '..', 'Info.plist')], { encoding: 'utf8', timeout: 15_000 });
    if (plist.error) throw plist.error;
    assert.equal(plist.status, 0, plist.stderr);
    assert.ok(plist.stdout.trim(), 'The packaged app must describe its microphone access.');
  }
  if (verifySignature && platform === 'darwin') {
    for (const name of names) {
      const result = spawnSync('codesign', ['--verify', '--strict', join(directory, name)], {
        encoding: 'utf8', timeout: 15_000,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr);
    }
  }
  await verifyNullSession(join(directory, baseline), false);
  if (v3) {
    const optimized = join(directory, v3);
    await verifyNullSession(optimized, true);
    await withAudioEngine(optimized, ['--backend', 'null'], async session => {
      assert.equal(await session.readFrame(), null);
      const { code, signal, diagnostics } = await session.finish();
      assert.equal(signal, null, diagnostics);
      assert.equal(code, unsupportedCpuExitCode, diagnostics);
    }, { env: { ...process.env, [forceBaselineEnv]: '1' } });
  }
}

export async function verifyAudioEnginePackage(directory, verifySignature = false) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(directory, entry.name);
    const windowsOrLinux = /^(win|linux)(?:-x64)?-unpacked$/.exec(entry.name);
    if (windowsOrLinux) {
      paths.push([join(root, 'resources'), windowsOrLinux[1] === 'win' ? 'win32' : 'linux', 'x64']);
    } else if (/^mac(?:-x64|-arm64)?$/.test(entry.name)) {
      const app = readdirSync(root, { withFileTypes: true })
        .filter(child => child.isDirectory() && child.name.endsWith('.app'));
      assert.equal(app.length, 1, `${root} must contain one app bundle`);
      paths.push([join(root, app[0].name, 'Contents', 'Resources'), 'darwin',
        entry.name.endsWith('-arm64') ? 'arm64' : 'x64']);
    }
  }
  assert.ok(paths.length > 0, `No unpacked desktop package found in ${directory}`);
  for (const [resources, platform, architecture] of paths) {
    await verifyAudioEngineResources(resources, platform, architecture, verifySignature);
    console.log(`Native audio engine package passed (${platform}-${architecture}).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyAudioEnginePackage(resolve(process.argv[2] ?? 'dist'), process.argv[3] === '--verify-signature');
}
