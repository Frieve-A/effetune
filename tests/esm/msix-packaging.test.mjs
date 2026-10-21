import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { inspectPayload, renderManifest, storeVersion, validateIdentity } from '../../scripts/pack-msix-win.mjs';
import { configureOpenHomeForTrial, fileActivationApplied, installedAppReady, probeAppState } from '../../tools/probe-msix-installed.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const testIdentity = JSON.parse(await readFile(join(root, 'build/msix/test-identity.json'), 'utf8'));

test('MSIX version comes from a stable application version and uses the Store revision', () => {
  assert.equal(storeVersion('2.15.0'), '2.15.0.0');
  for (const invalid of ['2.15.0-beta.1', '02.15.0', '0.1.0', '2.65536.0', '2.15.0.1']) {
    assert.throws(() => storeVersion(invalid));
  }
});

test('MSIX submission identity requires configured Store fields independently of local setup', () => {
  const unset = { name: null, publisher: null, publisherDisplayName: null, productId: null };
  assert.throws(() => validateIdentity(unset), /Set name/);
  assert.throws(() => validateIdentity(testIdentity));
  assert.deepEqual(validateIdentity(testIdentity, true), testIdentity);
  const configured = { name: '12345.EffeTune', publisher: 'CN=11111111-2222-3333-4444-555555555555',
    publisherDisplayName: 'Frieve', productId: '9N1234567890' };
  assert.deepEqual(validateIdentity(configured), configured);
});

test('MSIX manifest derives all associations from package.json and escapes identity', async () => {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const template = await readFile(join(root, 'build/msix/AppxManifest.xml'), 'utf8');
  const manifest = renderManifest(template, packageJson, { ...testIdentity, publisher: 'CN=Test & Co' });
  assert.match(manifest, /Publisher="CN=Test &amp; Co"/);
  assert.match(manifest, /TaskId="EffeTuneStartup" Enabled="false"/);
  assert.match(manifest, /<uap:Protocol Name="effetune">/);
  assert.equal(manifest.includes('{{'), false);
  for (const association of packageJson.build.fileAssociations) {
    for (const extension of [association.ext].flat()) assert.ok(manifest.includes(`<uap:FileType>.${extension}</uap:FileType>`));
  }
});

test('MSIX payload rejects Portable data and missing VMP signatures', async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'effetune-msix-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const executable = Buffer.alloc(256);
  executable.write('MZ');
  executable.writeUInt32LE(128, 0x3c);
  executable.write('PE\0\0', 128, 'binary');
  executable.writeUInt16LE(0x8664, 132);
  for (const name of ['EffeTune.exe', 'EffeTune.exe.sig', 'resources/app.asar',
    'resources/openhome/effetune-openhome-sidecar.exe', 'resources/openhome/THIRD_PARTY_NOTICES.txt',
    'LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    await mkdir(dirname(join(temporary, name)), { recursive: true });
    await writeFile(join(temporary, name), name === 'EffeTune.exe' ? executable : 'fixture');
  }
  await inspectPayload(temporary);
  await mkdir(join(temporary, 'effetune_settings'));
  await assert.rejects(inspectPayload(temporary), /local settings or cache/);
  await rm(join(temporary, 'effetune_settings'), { recursive: true });
  await rm(join(temporary, 'EffeTune.exe.sig'));
  await assert.rejects(inspectPayload(temporary), /ENOENT/);
});

function installedProbeFixture() {
  let config = {};
  let savedPresets = {};
  let playlist;
  let bookmarks = [];
  let browserReads = 0;
  let initialized = false;
  let configWrites = 0;
  const api = {
    isMsix: true,
    libraryRecoveryV1: {
      initialize: async () => {
        await new Promise(setImmediate);
        initialized = true;
        return { apiVersion: 1, status: 'available', available: true };
      },
    },
    getPath: async () => 'C:\\Users\\Test\\AppData\\Roaming\\EffeTune Store',
    joinPaths: async (...parts) => parts.join('\\'),
    saveConfig: async value => { configWrites++; config = value; return { success: true }; },
    loadConfig: async () => ({ success: true, config }),
    saveFile: async (_path, text) => { savedPresets = JSON.parse(text); return { success: true }; },
    getUserPresetsForTray: async () => ({ success: true, presets: Object.keys(savedPresets) }),
    libraryCatalogV1: {
      createPlaylist: async value => {
        assert.equal(initialized, true, 'Catalog handlers require completed Library initialization');
        playlist = value;
        return { kind: 'created' };
      },
      queryPlaylistItems: async () => {
        assert.equal(initialized, true, 'Catalog handlers require completed Library initialization');
        return { playlist };
      },
    },
    browser: {
      saveSettings: async value => {
        if (!value.bookmarks.every(bookmark => typeof bookmark.name === 'string' && typeof bookmark.url === 'string')) {
          return { ok: false, error: 'invalidRequest' };
        }
        bookmarks = value.bookmarks;
        return { ok: true, settings: { bookmarks } };
      },
      getState: async () => { browserReads++; return { ok: true, settings: { bookmarks } }; },
    },
    openHomeV1: { getStatus: async () => ({ available: true }) },
  };
  return { api, presets: () => savedPresets, bookmarks: () => bookmarks, browserReads: () => browserReads,
    configWrites: () => configWrites };
}

test('installed MSIX probe saves Browser bookmarks using name and validates persisted API shapes', async () => {
  const fixture = installedProbeFixture();
  const probe = runInNewContext(`(${probeAppState.toString()})`, { window: { electronAPI: fixture.api } });
  const state = { marker: 'msix-probe-fixture' };
  assert.equal((await probe({ mode: 'seed', state })).browser, true);
  assert.equal(fixture.bookmarks()[0].name, state.marker);
  assert.deepEqual(fixture.presets()[state.marker], { pipeline: [] });
  assert.equal((await probe({ mode: 'check', state })).browser, true);
});

test('installed MSIX probe reports Browser save failure before checking preservation', async () => {
  const fixture = installedProbeFixture();
  fixture.api.browser.saveSettings = async () => ({ ok: false, error: 'saveFailed' });
  const probe = runInNewContext(`(${probeAppState.toString()})`, { window: { electronAPI: fixture.api } });
  await assert.rejects(probe({ mode: 'seed', state: { marker: 'msix-probe-fixture' } }), /Browser settings save failed/);
  assert.equal(fixture.browserReads(), 0);
});

test('installed MSIX probe stops before persistence when Library initialization is unavailable', async () => {
  const fixture = installedProbeFixture();
  fixture.api.libraryRecoveryV1.initialize = async () => ({ apiVersion: 1, status: 'unavailable', available: false });
  const probe = runInNewContext(`(${probeAppState.toString()})`, { window: { electronAPI: fixture.api } });
  await assert.rejects(probe({ mode: 'seed', state: { marker: 'msix-probe-fixture' } }), /Library initialization failed/);
  assert.equal(fixture.configWrites(), 0);
  assert.deepEqual(fixture.presets(), {});
  assert.equal(fixture.browserReads(), 0);
});

test('installed MSIX trial enables and disables the OpenHome host and normal renderer adapter together', async () => {
  const calls = [];
  const configure = runInNewContext(`(${configureOpenHomeForTrial.toString()})`, { window: {
    electronAPI: { openHomeV1: { setEnabled: async enabled => { calls.push(['host', enabled]); return { enabled }; } } },
    uiManager: { setOpenHomeRemoteControlEnabled: async enabled => {
      await new Promise(setImmediate);
      calls.push(['renderer', enabled]);
    } },
  } });
  await configure(true);
  assert.deepEqual(calls, [['host', true], ['renderer', true]]);
  await configure(false);
  assert.deepEqual(calls, [['host', true], ['renderer', true], ['host', false], ['renderer', false]]);
});

test('installed MSIX trial does not enable the renderer when the OpenHome setting is rejected', async () => {
  let rendererCalls = 0;
  const configure = runInNewContext(`(${configureOpenHomeForTrial.toString()})`, { window: {
    electronAPI: { openHomeV1: { setEnabled: async () => ({ enabled: false }) } },
    uiManager: { setOpenHomeRemoteControlEnabled: async () => { rendererCalls++; } },
  } });
  await assert.rejects(configure(true), /OpenHome setting was not applied/);
  assert.equal(rendererCalls, 0);
});

test('file activation observation rejects an ignored preset and requires its distinct plugin parameters', () => {
  let parameters = { type: 'VolumePlugin', enabled: true, vl: -12.5 };
  const window = { app: { audioManager: { pipeline: [{ getParameters: () => parameters }] } } };
  const applied = runInNewContext(`(${fileActivationApplied.toString()})`, { window });
  assert.equal(applied(-37.25), false);
  parameters = { ...parameters, vl: -37.25 };
  assert.equal(applied(-37.25), true);
  parameters = { ...parameters, enabled: false };
  assert.equal(applied(-37.25), false);
});

test('installed trial waits for application initialization and the startup overlay to finish', () => {
  let starting = true;
  let height = 600;
  const window = { electronAPI: { isMsix: true }, app: { initialized: false } };
  const document = { documentElement: { classList: { contains: () => starting } },
    body: { getBoundingClientRect: () => ({ height }) } };
  const ready = runInNewContext(`(${installedAppReady.toString()})`, { window, document });
  assert.equal(ready(), false);
  window.app.initialized = true;
  assert.equal(ready(), false);
  starting = false;
  assert.equal(ready(), true);
  height = 0;
  assert.equal(ready(), false);
});
