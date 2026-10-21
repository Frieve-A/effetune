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
    ['win32', 'x64', 'c7d51e4bf80de9ef18b3306b0d140059bb203510d3dfc88f3404049a12c90f89'],
    ['linux', 'x64', 'afa7d4ea49abf1e91c5be0f88cfe1abdb977ff3454d57658e90b004aacbde9cc'],
    ['darwin', 'x64', 'f3ebb426b24fd47dfb86fcd6ea3170f8d5058c4b1c5cb2ee35993fea32ecf454'],
    ['darwin', 'arm64', '9503ac243997f151a3687d4e87d6f15d45127f50726ff2a8fd4c758b966d0dd4'],
  ]) {
    const runtime = getEcsRuntime(platform, architecture);
    assert.equal(runtime.sha256, sha256);
    assert.equal(path.basename(runtime.archive), `electron-v44.5.1+wvcus-${platform}-${architecture}.zip`);
    assert.equal(path.basename(runtime.directory), `${platform}-${architecture}`);
    assert.equal(runtime.url, `https://github.com/castlabs/electron-releases/releases/download/v44.5.1%2Bwvcus/electron-v44.5.1+wvcus-${platform}-${architecture}.zip`);
  }
  for (const [platform, architecture] of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'universal'], ['freebsd', 'x64']]) {
    assert.throws(() => getEcsRuntime(platform, architecture), /Unsupported ECS runtime target/);
  }
});
