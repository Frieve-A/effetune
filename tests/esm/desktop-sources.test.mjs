import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AIRPLAY_TARGETS, verifyDesktopSources } from '../../scripts/collect-desktop-sources.mjs';

const hash = contents => createHash('sha256').update(contents).digest('hex');

test('unified source release requires every platform and rejects missing or altered sources', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'effetune-desktop-sources-')));
  const put = (file, contents) => {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  };
  try {
    for (const target of AIRPLAY_TARGETS) {
      const [platform, architecture] = target.split('-');
      put(`airplay/${target}/runtime-manifest.json`, JSON.stringify({
        platform, architecture, sources: [{ file: 'upstream.zip', sha256: hash('source') }],
      }));
      put(`airplay/${target}/source/upstream.zip`, 'source');
      put(`airplay/${target}/source/effetune-airplay-build/scripts/build-airplay-receiver.mjs`, 'recipe');
    }
    const dsc = `Source: libnl3\nVersion: 1\nChecksums-Sha256:\n ${hash('source')} 6 libnl.tar.gz\n`;
    put('openhome/linux-x64/libnl-runtime-manifest.json', JSON.stringify({
      sourceComplete: true,
      runtimeLibraries: [{ sourcePackage: 'libnl3', sourceVersion: '1' }],
      sourceArtifacts: [{ sourcePackage: 'libnl3', sourceVersion: '1', dscFile: 'libnl.dsc', files: [
        { fileName: 'libnl.dsc', size: Buffer.byteLength(dsc), sha256: hash(dsc) },
        { fileName: 'libnl.tar.gz', size: 6, sha256: hash('source') },
      ] }],
    }));
    put('openhome/linux-x64/libnl-source/libnl3/libnl.dsc', dsc);
    put('openhome/linux-x64/libnl-source/libnl3/libnl.tar.gz', 'source');
    verifyDesktopSources(root);
    assert.match(readFileSync(join(root, 'README.txt'), 'utf8'), /not needed to run/);
    put('airplay/darwin-arm64/source/upstream.zip', 'broken');
    assert.throws(() => verifyDesktopSources(root), /Source archive changed/);
    put('airplay/darwin-arm64/source/upstream.zip', 'source');
    put('openhome/linux-x64/libnl-source/libnl3/libnl.tar.gz', 'broken');
    assert.throws(() => verifyDesktopSources(root), assert.AssertionError);
    put('openhome/linux-x64/libnl-source/libnl3/libnl.tar.gz', 'source');
    rmSync(join(root, 'airplay', 'win32-x64'), { recursive: true });
    assert.throws(() => verifyDesktopSources(root), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release aggregation waits for all producers and installers exclude only AirPlay source material', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /needs: \[linux, windows, macos\]/);
  assert.equal(workflow.match(/third_party_source_bundle: true/g).length, 3);
  assert.match(workflow, /node scripts\/collect-desktop-sources.mjs --verify out\/desktop-sources/);
  assert.match(workflow, /ThirdParty-Source\.zip/);
  const config = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).build;
  for (const platform of ['win', 'mac', 'linux']) {
    assert.deepEqual(config[platform].extraResources.find(resource => resource.to === 'airplay').filter,
      ['**/*', '!source{,/**/*}']);
  }
});
