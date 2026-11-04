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
    ['win32', 'x64', 'f118d8b611998270acfdc85872d12203035078f07252a761822e9324223302e6'],
    ['linux', 'x64', 'ee726ff1e8db21a1975b827063cb9d1f6fd024122d6ae07da4661451a00daa93'],
    ['darwin', 'x64', '33260e6456488853d81bcf0dba5d52faed5418f2a89eea6906a08f4cc90200ef'],
    ['darwin', 'arm64', '4eeca8c117a778b4bfaa2ab90c82b62d119b23bff172da382e14aa289c5ddf33'],
  ]) {
    const runtime = getEcsRuntime(platform, architecture);
    assert.equal(runtime.sha256, sha256);
    assert.equal(path.basename(runtime.archive), `electron-v44.10.1+wvcus-${platform}-${architecture}.zip`);
    assert.equal(path.basename(runtime.directory), `${platform}-${architecture}`);
    assert.equal(runtime.url, `https://github.com/castlabs/electron-releases/releases/download/v44.10.1%2Bwvcus/electron-v44.10.1+wvcus-${platform}-${architecture}.zip`);
  }
  for (const [platform, architecture] of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'universal'], ['freebsd', 'x64']]) {
    assert.throws(() => getEcsRuntime(platform, architecture), /Unsupported ECS runtime target/);
  }
});
