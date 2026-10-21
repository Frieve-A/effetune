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
export const ECS_VERSION = '44.5.1';
const archiveHashes = Object.freeze({
  'win32-x64': 'c7d51e4bf80de9ef18b3306b0d140059bb203510d3dfc88f3404049a12c90f89',
  'linux-x64': 'afa7d4ea49abf1e91c5be0f88cfe1abdb977ff3454d57658e90b004aacbde9cc',
  'darwin-x64': 'f3ebb426b24fd47dfb86fcd6ea3170f8d5058c4b1c5cb2ee35993fea32ecf454',
  'darwin-arm64': '9503ac243997f151a3687d4e87d6f15d45127f50726ff2a8fd4c758b966d0dd4',
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
