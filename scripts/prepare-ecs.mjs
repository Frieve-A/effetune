import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ECS_VERSION = '44.10.1';
const archiveHashes = Object.freeze({
  'win32-x64': 'f118d8b611998270acfdc85872d12203035078f07252a761822e9324223302e6',
  'linux-x64': 'ee726ff1e8db21a1975b827063cb9d1f6fd024122d6ae07da4661451a00daa93',
  'darwin-x64': '33260e6456488853d81bcf0dba5d52faed5418f2a89eea6906a08f4cc90200ef',
  'darwin-arm64': '4eeca8c117a778b4bfaa2ab90c82b62d119b23bff172da382e14aa289c5ddf33',
});

export function getEcsRuntime(platform = process.platform, architecture = process.arch) {
  const target = `${platform}-${architecture}`;
  if (!Object.hasOwn(archiveHashes, target)) {
    throw new Error(`Unsupported ECS runtime target: ${target}.`);
  }
  const archiveName = `electron-v${ECS_VERSION}+wvcus-${target}.zip`;
  return {
    target,
    sha256: archiveHashes[target],
    url: `https://github.com/castlabs/electron-releases/releases/download/v${ECS_VERSION}%2Bwvcus/${archiveName}`,
    archive: join(root, 'out', 'ecs', 'runtime', archiveName),
    directory: join(root, 'out', 'ecs', 'runtime', target),
  };
}

export async function verifyEcsArchive(archive, platform = process.platform, architecture = process.arch) {
  const runtime = getEcsRuntime(platform, architecture);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest('hex') !== runtime.sha256) {
    throw new Error(`The runtime ZIP does not match the official ECS ${ECS_VERSION}+wvcus ${runtime.target} SHA-256.`);
  }
}

async function prepareEcsRuntime(archive) {
  const runtime = getEcsRuntime();
  if (!archive && !existsSync(runtime.archive)) {
    await mkdir(dirname(runtime.archive), { recursive: true });
    const temporary = `${runtime.archive}.download`;
    try {
      const response = await fetch(runtime.url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`ECS download failed with HTTP ${response.status}.`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      await verifyEcsArchive(temporary);
      await rename(temporary, runtime.archive);
    } finally { await rm(temporary, { force: true }); }
  }
  const runtimeZip = archive ? resolve(archive) : runtime.archive;
  await verifyEcsArchive(runtimeZip);
  await mkdir(runtime.directory, { recursive: true });
  const command = process.platform === 'win32' ? 'tar.exe' : process.platform === 'darwin' ? 'ditto' : 'unzip';
  const args = process.platform === 'win32' ? ['-xf', runtimeZip, '-C', runtime.directory]
    : process.platform === 'darwin' ? ['-x', '-k', runtimeZip, runtime.directory]
      : ['-q', '-o', runtimeZip, '-d', runtime.directory];
  const result = spawnSync(command, args, {
    stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not extract the ECS runtime ZIP.');
  console.log(`Official ECS runtime ready: ${runtime.directory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'runtime-zip': { type: 'string' } } });
  await prepareEcsRuntime(values['runtime-zip']);
}
