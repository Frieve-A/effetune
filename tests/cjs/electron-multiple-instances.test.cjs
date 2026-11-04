const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
const startup = source.slice(
  source.indexOf('// Handle second instance'),
  source.indexOf('// Handle macOS file open events')
);

test('startup permits additional instances only when explicitly enabled', () => {
  for (const value of [undefined, false, 'true', true]) {
    for (const lockAvailable of [false, true]) {
      const calls = [];
      vm.runInNewContext(startup, {
        configModule: { loadConfig: () => ({ allowMultipleInstances: value }) },
        fs: { mkdirSync() {} },
        fileHandlers: { getUserDataPath: () => 'profile' },
        settingsProfile: {
          getSettingsName: () => '',
          getSettingsPath: directory => directory,
          requestSingleInstanceLock: app => app.requestSingleInstanceLock()
        },
        app: {
          requestSingleInstanceLock() { calls.push('lock'); return lockAvailable; },
          quit() { calls.push('quit'); },
          on(event) { calls.push(event); }
        }
      });
      assert.deepEqual(calls, value === true
        ? ['second-instance']
        : lockAvailable ? ['lock', 'second-instance'] : ['lock', 'quit']);
    }
  }
});
