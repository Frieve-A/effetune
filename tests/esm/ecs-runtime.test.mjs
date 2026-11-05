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
    ['win32', 'x64', 'a17f87a95a62e8f336d6fa18e57b9bc83d513b02211e4e5771a45cfd7482740e'],
    ['linux', 'x64', '18953cdab1cdc2499f9b0089f85d069559bf992145008a40aacd0d7714b97960'],
    ['darwin', 'x64', '865396e65fc869c2d824a77e1c1bb4c2f5d3392566f00b5e5edeeec1b3f11bed'],
    ['darwin', 'arm64', '93e1976a66d58004bf25e5b777c979cc3c03513868d5faf294bcd6f58e63bd24'],
  ]) {
    const runtime = getEcsRuntime(platform, architecture);
    assert.equal(runtime.sha256, sha256);
    assert.equal(path.basename(runtime.archive), `electron-v45.2.1+wvcus-${platform}-${architecture}.zip`);
    assert.equal(path.basename(runtime.directory), `${platform}-${architecture}`);
    assert.equal(runtime.url, `https://github.com/castlabs/electron-releases/releases/download/v45.2.1%2Bwvcus/electron-v45.2.1+wvcus-${platform}-${architecture}.zip`);
  }
  for (const [platform, architecture] of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'universal'], ['freebsd', 'x64']]) {
    assert.throws(() => getEcsRuntime(platform, architecture), /Unsupported ECS runtime target/);
  }
});
