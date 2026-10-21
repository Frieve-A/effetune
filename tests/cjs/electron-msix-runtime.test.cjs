const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

test('MSIX sets stable userData and sessionData before configuration modules can read them', () => {
  const startup = section('// Set package storage', '// Import modules');
  assert.ok(source.indexOf(startup) < source.indexOf("require('./config')"));
  for (const isMsix of [false, true]) {
    const calls = [];
    const appData = path.join('profile', 'Roaming');
    vm.runInNewContext(startup, {
      process: { windowsStore: isMsix }, path,
      fs: { mkdirSync(directory, options) { calls.push(['mkdir', directory, options.recursive]); } },
      app: {
        getPath(name) { assert.equal(name, 'appData'); return appData; },
        setPath(name, directory) { calls.push([name, directory]); }
      }
    });
    const store = path.join(appData, 'EffeTune Store');
    assert.deepEqual(calls, isMsix ? [
      ['mkdir', store, true], ['userData', store], ['sessionData', store]
    ] : []);
  }
});

test('MSIX update checks return before any release request or notification', async () => {
  const update = section('async function checkForUpdates()', '// Send pending update info');
  let requests = 0;
  const context = {
    process: { windowsStore: true },
    fetchReleases() { requests++; throw new Error('Unexpected release request'); },
    console: { warn() { assert.fail('Store check must return without errors'); } }
  };
  vm.runInNewContext(update, context);
  await context.checkForUpdates();
  assert.equal(requests, 0);
});

test('MSIX startup leaves login items and protocol registration to the package manifest', () => {
  const login = section('  applyNativeTheme(cfg);', "  if (cfg.pipelineStartup === 'default')");
  const protocol = section('// Register the app as the default handler', '// Main entry point');
  for (const isMsix of [false, true]) {
    const calls = [];
    vm.runInNewContext(login + protocol, {
      process: { windowsStore: isMsix }, cfg: { autoLaunch: true }, applyNativeTheme() {},
      app: {
        setLoginItemSettings(settings) { calls.push(['login', settings.openAtLogin]); },
        setAsDefaultProtocolClient(scheme) { calls.push(['protocol', scheme]); }
      }
    });
    assert.deepEqual(calls, isMsix ? [] : [['login', true], ['protocol', 'effetune']]);
  }
});
