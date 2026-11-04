const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const profile = require('../../electron/settings-profile.cjs');
const access = require('../../electron/file-access.cjs');
const { accessRendererSettings } = require('../../electron/renderer-settings.cjs');
const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

test('settings names accept both command-line forms without treating names as input files', () => {
  assert.deepEqual(profile.parseSettingsArguments(['app', '--settings-name=headphones', 'song.flac']),
    { name: 'headphones', args: ['app', 'song.flac'] });
  assert.deepEqual(profile.parseSettingsArguments(['app', '--settings-name', 'name.flac', 'preset.effetune_preset']),
    { name: 'name.flac', args: ['app', 'preset.effetune_preset'] });
  for (const args of [['--settings-name'], ['--settings-name='], ['--settings-name', '--other'],
    ['--settings-name=\n'], [`--settings-name=${'a'.repeat(65)}`]]) {
    assert.throws(() => profile.parseSettingsArguments(args), /Use --settings-name/);
  }
});

test('named settings isolate configuration and state while resource paths stay shared', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-settings-profile-')));
  t.after(() => { profile.configureSettingsProfile([]); access.clear(); fs.rmSync(root, { recursive: true, force: true }); });
  const config = withModuleLoadStub({ './file-handlers': { getUserDataPath: () => root } },
    () => loadFreshModule('../../electron/config.js'));
  profile.configureSettingsProfile([]);
  assert.equal(profile.getSettingsPath(root), root);
  assert.equal(config.saveConfig({ theme: 'graphite' }), true);
  const paths = new Set([root]);
  for (const name of ['Headphones', 'headphones', '../speakers', 'スピーカー']) {
    profile.configureSettingsProfile([`--settings-name=${name}`]);
    const directory = profile.getSettingsPath(root);
    assert.equal(path.dirname(directory), path.join(root, 'settings'));
    assert.equal(paths.has(directory), false);
    paths.add(directory);
    assert.deepEqual(config.loadConfig(), {});
    assert.equal(config.saveConfig({ theme: name }), true);
    assert.deepEqual(config.loadConfig(), { theme: name });
    assert.equal(accessRendererSettings(root, { operation: 'get', key: 'theme' }), null);
    accessRendererSettings(root, { operation: 'set', key: 'theme', value: name });
    assert.equal(accessRendererSettings(root, { operation: 'get', key: 'theme' }), name);
    accessRendererSettings(root, { operation: 'set', key: '__proto__', value: 'a setting' });
    assert.equal(accessRendererSettings(root, { operation: 'get', key: '__proto__' }), 'a setting');
    accessRendererSettings(root, { operation: 'remove', key: 'theme' });
    assert.equal(accessRendererSettings(root, { operation: 'get', key: 'theme' }), null);
    assert.throws(() => accessRendererSettings(root, { operation: 'clear', key: 'theme' }));
    access.assertPath(path.join(directory, 'pipeline-state.json'), 'read', root, directory);
    access.assertPath(path.join(directory, 'player-state.json'), 'write', root, directory);
    access.assertPath(path.join(root, 'effetune_presets.json'), 'write', root, directory);
    assert.throws(() => access.assertPath(path.join(directory, 'effetune_presets.json'), 'write', root, directory));
    assert.throws(() => access.assertPath(path.join(root, 'pipeline-state.json'), 'read', root, directory));
  }
  profile.configureSettingsProfile([]);
  assert.deepEqual(config.loadConfig(), { theme: 'graphite' });
});

test('settings locks use the named directory and restore shared browser storage even on failure', t => {
  t.after(() => profile.configureSettingsProfile([]));
  for (const name of ['', 'headphones']) {
    profile.configureSettingsProfile(name ? [`--settings-name=${name}`] : []);
    let current = 'shared-browser-storage';
    const app = {
      getPath: () => current,
      setPath: (_key, value) => { current = value; },
      requestSingleInstanceLock() {
        assert.equal(current, name ? profile.getSettingsPath('resources') : 'shared-browser-storage');
        return false;
      }
    };
    assert.equal(profile.requestSingleInstanceLock(app, 'resources'), false);
    assert.equal(current, 'shared-browser-storage');
    app.requestSingleInstanceLock = () => { throw new Error('lock failed'); };
    assert.throws(() => profile.requestSingleInstanceLock(app, 'resources'), /lock failed/);
    assert.equal(current, 'shared-browser-storage');
  }
});

test('Windows startup independently registers and removes the default and named settings', t => {
  t.after(() => profile.configureSettingsProfile([]));
  const entries = new Map();
  const apply = (name, enabled) => {
    const args = name ? [`--settings-name=${name}`] : [];
    profile.configureSettingsProfile(args);
    const settings = profile.getLoginItemSettings(enabled, 'win32');
    assert.equal(settings.openAtLogin, enabled);
    assert.deepEqual(settings.args, args);
    if (!name) assert.equal(settings.name, undefined);
    const key = (settings.name ?? 'com.frieve.effetune').toLowerCase();
    if (settings.openAtLogin) entries.set(key, settings.args);
    else entries.delete(key);
  };
  apply('', true);
  apply('Living room', false);
  assert.deepEqual([...entries.values()], [[]]);
  apply('Living room', true);
  apply('living room', true);
  assert.deepEqual([...entries.values()], [[], ['--settings-name=Living room'], ['--settings-name=living room']]);
  apply('Living room', false);
  assert.deepEqual([...entries.values()], [[], ['--settings-name=living room']]);
  apply('', false);
  assert.deepEqual([...entries.values()], [['--settings-name=living room']]);
  apply('living room', false);
  assert.equal(entries.size, 0);
  assert.deepEqual(profile.getLoginItemSettings(false, 'darwin'), { openAtLogin: false });
});
