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
export const ECS_VERSION = '45.2.1';
const archiveHashes = Object.freeze({
  'win32-x64': 'a17f87a95a62e8f336d6fa18e57b9bc83d513b02211e4e5771a45cfd7482740e',
  'linux-x64': '18953cdab1cdc2499f9b0089f85d069559bf992145008a40aacd0d7714b97960',
  'darwin-x64': '865396e65fc869c2d824a77e1c1bb4c2f5d3392566f00b5e5edeeec1b3f11bed',
  'darwin-arm64': '93e1976a66d58004bf25e5b777c979cc3c03513868d5faf294bcd6f58e63bd24',
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
