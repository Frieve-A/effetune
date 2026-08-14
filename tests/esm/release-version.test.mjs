import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  compareSemVer,
  isNewerVersion,
  normalizeReleaseVersion,
  normalizeSemVer
} from '../../js/release-version.mjs';

test('release versions normalize labels and compare semantic versions', () => {
  assert.equal(normalizeSemVer('Version 2.10.3+build.4'), '2.10.3');
  assert.equal(normalizeSemVer('v3.0.0-rc.2'), '3.0.0-rc.2');
  assert.equal(normalizeSemVer('3.0'), '3.0.0');
  assert.equal(compareSemVer('3.0.0-rc.2', '3.0.0'), -1);
  assert.equal(compareSemVer('2.10.0', '2.9.9'), 1);
  assert.equal(isNewerVersion('2.1.0', '2.0.0'), true);
  assert.equal(isNewerVersion('2.1.0', '2.1.0'), false);
  assert.equal(isNewerVersion('2.1.0', '2.2.0'), false);
  assert.equal(isNewerVersion('broken', '2.0.0'), false);
  assert.equal(normalizeReleaseVersion({ tag_name: 'v2.2.0', name: 'Version 9.0.0' }), '2.2.0');
  assert.equal(normalizeReleaseVersion({ name: 'Version 2.3.0' }), '2.3.0');
});

test('release versions support the established two-component tag convention', () => {
  assert.equal(normalizeSemVer('v1.64'), '1.64.0');
  assert.equal(normalizeReleaseVersion({ tag_name: 'v1.64' }), '1.64.0');
});

test('release identity is version 2.5.0', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const history = fs.readFileSync(new URL('../../docs/version-history.md', import.meta.url), 'utf8');
  assert.equal(packageJson.version, '2.5.0');
  assert.equal(packageLock.version, '2.5.0');
  assert.equal(packageLock.packages[''].version, '2.5.0');
  assert.match(history, /^### Version 2\.5\.0 \(Aug 14, 2026\)$/m);
});
