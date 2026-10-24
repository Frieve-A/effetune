import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getEcsRuntime, verifyEcsArchive } from '../../scripts/prepare-ecs.mjs';

test('ECS packaging rejects an archive that differs from the pinned official release', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-ecs-archive-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'runtime.zip');
  await writeFile(archive, 'A different runtime must not be packaged.');
  for (const [platform, architecture] of [['win32', 'x64'], ['linux', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
    await assert.rejects(verifyEcsArchive(archive, platform, architecture), /does not match the official ECS.*SHA-256/);
  }
});

test('ECS runtime selection is pinned to the four supported release hosts', () => {
  for (const [platform, architecture, sha256] of [
    ['win32', 'x64', '1ab1e5aa4566f218873d272af1a57c6162ad83911a69bbd4b0e341c37c6c40fc'],
    ['linux', 'x64', '80cb5218ab814597282ebe41d16fb5a98abb0c75370e9195914e40e097359fad'],
    ['darwin', 'x64', '99ca1b2c3bb295d7927ef8d17137952385844d67f63dbe827a7214aecca181fe'],
    ['darwin', 'arm64', '3f49f11710e87974b6b7c7acb2c172c1f37c804f319f7c887e0a791bbda8dc6b'],
  ]) {
    const runtime = getEcsRuntime(platform, architecture);
    assert.equal(runtime.sha256, sha256);
    assert.equal(path.basename(runtime.archive), `electron-v44.9.3+wvcus-${platform}-${architecture}.zip`);
    assert.equal(path.basename(runtime.directory), `${platform}-${architecture}`);
    assert.equal(runtime.url, `https://github.com/castlabs/electron-releases/releases/download/v44.9.3%2Bwvcus/electron-v44.9.3+wvcus-${platform}-${architecture}.zip`);
  }
  for (const [platform, architecture] of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'universal'], ['freebsd', 'x64']]) {
    assert.throws(() => getEcsRuntime(platform, architecture), /Unsupported ECS runtime target/);
  }
});
