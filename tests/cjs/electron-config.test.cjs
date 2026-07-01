const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createTempDir,
  loadFreshModule,
  withModuleLoadStub,
  withMutedConsole,
  withPatchedProperty
} = require('../helpers/cjs-module-utils.cjs');

function loadConfigModule(userDataPath) {
  return withModuleLoadStub({
    './file-handlers': { getUserDataPath: () => userDataPath }
  }, () => loadFreshModule('../../electron/config.js'));
}

test('getConfigPath resolves config.json under user data', () => {
  const dir = createTempDir('effetune-config');
  const config = loadConfigModule(dir);

  assert.equal(config.getConfigPath(), path.join(dir, 'config.json'));
});

test('loadConfig returns parsed config or an empty object', () => {
  const populatedDir = createTempDir('effetune-config');
  fs.writeFileSync(path.join(populatedDir, 'config.json'), JSON.stringify({ audio: { volume: 0.5 } }));
  assert.deepEqual(loadConfigModule(populatedDir).loadConfig(), { audio: { volume: 0.5 } });

  assert.deepEqual(loadConfigModule(createTempDir('effetune-config')).loadConfig(), {});
});

test('loadConfig recovers from invalid JSON', () => {
  const dir = createTempDir('effetune-config');
  fs.writeFileSync(path.join(dir, 'config.json'), '{invalid json');

  withMutedConsole('error', () => {
    assert.deepEqual(loadConfigModule(dir).loadConfig(), {});
  });
});

test('saveConfig creates missing directories and writes formatted JSON', () => {
  const dir = path.join(createTempDir('effetune-config'), 'missing');
  const config = loadConfigModule(dir);

  assert.equal(config.saveConfig({ theme: 'dark' }), true);
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), '{\n  "theme": "dark"\n}');
});

test('saveConfig writes into existing directories', () => {
  const dir = createTempDir('effetune-config');
  const config = loadConfigModule(dir);

  assert.equal(config.saveConfig({ theme: 'light' }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')), { theme: 'light' });
});

test('saveConfig reports write failures', () => {
  const config = loadConfigModule(createTempDir('effetune-config'));

  withMutedConsole('error', () => {
    withPatchedProperty(fs, 'writeFileSync', () => {
      throw new Error('write denied');
    }, () => {
      assert.equal(config.saveConfig({ theme: 'dark' }), false);
    });
  });
});
