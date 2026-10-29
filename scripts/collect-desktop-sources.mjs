import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyAirplayRuntime, verifyAirplaySources } from '../tools/verify-airplay-package.mjs';
import { verifyLinuxRuntimeManifest, verifyLinuxSources } from '../tools/openhome-linux-provenance.mjs';

export const AIRPLAY_TARGETS = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'];

export function collectDesktopSources(root, target) {
  assert.ok(AIRPLAY_TARGETS.includes(target), `Unsupported source target: ${target}`);
  const output = join(root, 'out', 'desktop-sources');
  const runtime = join(root, 'out', 'native', 'airplay-receiver', target);
  verifyAirplayRuntime(runtime, { execute: false });
  const destination = join(output, 'airplay', target);
  mkdirSync(destination, { recursive: true });
  for (const name of ['source', 'licenses', 'runtime-manifest.json', 'THIRD_PARTY_NOTICES.txt']) {
    cpSync(join(runtime, name), join(destination, name), { recursive: true });
  }
  if (target === 'linux-x64') {
    const openhome = join(root, 'out', 'native', 'openhome-sidecar', target);
    verifyLinuxRuntimeManifest(openhome, { requireSource: true });
    const openhomeDestination = join(output, 'openhome', target);
    mkdirSync(openhomeDestination, { recursive: true });
    for (const name of ['libnl-source', 'libnl-runtime-manifest.json']) {
      cpSync(join(openhome, name), join(openhomeDestination, name), { recursive: true });
    }
    copyFileSync(join(root, 'native', 'openhome-sidecar', 'THIRD_PARTY_NOTICES.txt'),
      join(openhomeDestination, 'THIRD_PARTY_NOTICES.txt'));
  }
  return output;
}

export function verifyDesktopSources(directory) {
  for (const target of AIRPLAY_TARGETS) {
    const manifest = verifyAirplaySources(join(directory, 'airplay', target));
    assert.equal(`${manifest.platform}-${manifest.architecture}`, target);
  }
  verifyLinuxSources(join(directory, 'openhome', 'linux-x64'));
  // Each producer verifies its exact source hashes before uploading. The final
  // job requires all platform slices before making the single public archive.
  writeFileSync(join(directory, 'README.txt'), `EffeTune third-party corresponding source

airplay/<platform>-<architecture>/ contains the matching runtime manifest,
upstream and dependency source archives, notices, and EffeTune build recipes
and adaptations under source/effetune-airplay-build/.
openhome/linux-x64/ contains the exact libnl Debian source packages and the
provenance manifest shipped with the Linux OpenHome runtime.

Use the source slice matching your application download. Runtime binaries and
license notices remain in the application; this archive is not needed to run it.
EffeTune application source: https://github.com/Frieve-A/effetune
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--verify') verifyDesktopSources(resolve(process.argv[3]));
  else collectDesktopSources(process.cwd(), `${process.platform}-${process.arch}`);
}
