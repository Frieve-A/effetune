const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');

test('Electron bootstrap keeps OpenHome off by default and gates it on renderer lifetime', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  assert.match(source, /openHomeRemoteControl:\s*false/);
  assert.match(source, /createOpenHomeControlHost\(\{/);
  assert.match(source, /registerOpenHomeIpc\(\{/);
  assert.match(source, /appendSwitch\('autoplay-policy',\s*'no-user-gesture-required'\)/);
  assert.match(source, /did-start-navigation[\s\S]*openHomeControlHost\?\.setRendererUnavailable\(\)/);
  assert.match(source, /render-process-gone[\s\S]*openHomeControlHost\?\.setRendererUnavailable\(\)/);
  assert.match(source, /mainWindow\.on\('closed'[\s\S]*openHomeControlHost\?\.setRendererUnavailable\(\)/);
  assert.match(source, /networkOutput:\s*\{ enabled: false, localTrimMs: 0, targets: \[\] \}/);
  assert.match(source, /did-start-navigation[\s\S]*networkOutputHost\?\.setRendererUnavailable\(\)/);
  assert.match(source, /render-process-gone[\s\S]*networkOutputHost\?\.setRendererUnavailable\(\)/);
  assert.match(source, /mainWindow\.on\('closed'[\s\S]*networkOutputHost\?\.setRendererUnavailable\(\)/);
});

test('Electron network traces require explicit opt-in while failures remain visible', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');
  const cases = [
    {
      factory: 'createOpenHomeControlHost', variable: 'openHomeControlHost', next: 'disposeOpenHomeIpc',
      label: 'OpenHome diagnostic:', traces: ['sidecar-stderr'], failure: 'sidecar-exited'
    },
    {
      factory: 'createAirPlayReceiverHost', variable: 'airPlayReceiverHost', next: 'disposeAirPlayIpc',
      label: 'AirPlay diagnostic:', traces: ['airplay-helper-output', 'invalid-rtp', 'rtp-rebuffer',
        'rtp-packet-loss', 'rtp-clock-discontinuity', 'airplay-pcm-rebuffer'], failure: 'airplay-helper-failed'
    }
  ];
  for (const entry of cases) {
    const start = source.indexOf(`${entry.variable} = ${entry.factory}({`);
    const end = source.indexOf(`\n  ${entry.next} = `, start);
    assert.ok(start >= 0 && end > start);
    for (const enabled of [undefined, '0', '1']) {
      const logs = [];
      let options;
      vm.runInNewContext(source.slice(start, end), {
        path, process: { env: { EFFETUNE_NETWORK_DEBUG: enabled }, platform: process.platform },
        airPlayResourceDirectory: '/resources/airplay', constants: {}, configModule: {},
        app: { getPath: () => '/user-data' },
        [entry.factory](value) { options = value; return {}; },
        console: { error: (...args) => logs.push(args) }
      });
      const output = 'audio progress\rOpen connections: 0\n';
      const failure = new Error('test helper failure');
      for (const code of entry.traces) options.onDiagnostic(code, output);
      options.onDiagnostic(entry.failure, failure);
      assert.deepEqual(logs, [
        ...(enabled === '1' ? entry.traces.map(code => [entry.label, code, output]) : []),
        [entry.label, entry.failure, failure]
      ]);
    }
  }
});

test('desktop decoder fallback preserves switches and limits the MIDI workaround to Electron 44/45', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');
  const start = source.indexOf('const disabledFeatures =');
  const end = source.indexOf("app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));", start);
  assert.ok(start >= 0 && end > start);
  const bootstrap = source.slice(start, source.indexOf('\n', end));
  for (const version of ['43.9.0', '44.9.3', '45.1.0', '46.0.0']) {
    for (const existing of ['', 'OtherFeature', 'OtherFeature, SymphoniaAudioDecoding,BlockMidiByDefault']) {
      const switches = new Map([['disable-features', existing], ['enable-features', 'OtherEnabledFeature']]);
      vm.runInNewContext(bootstrap, {
        process: { versions: { electron: version } },
        app: { commandLine: {
          getSwitchValue: name => switches.get(name) || '',
          appendSwitch: (name, value) => switches.set(name, value)
        } }
      });
      const expected = existing.split(',').map(value => value.trim()).filter(Boolean);
      if ((version.startsWith('44.') || version.startsWith('45.')) && !expected.includes('BlockMidiByDefault')) expected.push('BlockMidiByDefault');
      if (!expected.includes('SymphoniaAudioDecoding')) expected.push('SymphoniaAudioDecoding');
      assert.deepEqual(switches.get('disable-features').split(','), expected);
      assert.equal(switches.get('enable-features'), 'OtherEnabledFeature');
    }
  }
  assert.ok(
    source.indexOf("getSwitchValue('disable-features')") < source.indexOf('app.whenReady()')
  );
  assert.match(source, /GRANTED_PERMISSIONS\s*=\s*\[[^\]]*'midi'[^\]]*\]/);
  assert.doesNotMatch(source.match(/GRANTED_PERMISSIONS\s*=\s*\[[^\]]*\]/)[0], /'midiSysex'/);
  assert.match(source, /setPermissionCheckHandler\([\s\S]*GRANTED_PERMISSIONS\.includes\(permission\)/);
  assert.match(source, /setPermissionRequestHandler\([\s\S]*GRANTED_PERMISSIONS\.includes\(permission\)/);
});

test('desktop startup keeps background audio priority before readiness on every platform', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');
  const start = source.indexOf('const disabledFeatures =');
  const end = source.indexOf('function presentMainWindow', start);
  assert.ok(start >= 0 && end > start);
  assert.ok(end < source.indexOf('app.whenReady()'));
  assert.ok(end < source.indexOf('new BrowserWindow('));
  for (const platform of ['win32', 'darwin', 'linux']) {
    const switches = new Map();
    let readinessObserved = false;
    const app = {
      commandLine: {
        getSwitchValue: name => switches.get(name) || '',
        appendSwitch: (name, value) => switches.set(name, value)
      },
      whenReady() {
        assert.equal(switches.has('disable-renderer-backgrounding'), true, platform);
        readinessObserved = true;
      }
    };
    vm.runInNewContext(`${source.slice(start, end)}\napp.whenReady();`, {
      app, process: { platform, versions: { electron: '45.1.0' } }
    });
    assert.equal(readinessObserved, true);
  }
});

test('Electron shutdown awaits OpenHome and catalog cleanup through one idempotent promise', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  assert.match(source, /if \(appServicesClosePromise\) return appServicesClosePromise/);
  assert.match(source, /appServicesClosePromise = Promise\.allSettled\(\[[\s\S]*closeLibraryCatalogRecovery\(\)[\s\S]*openHomeHost\?\.dispose\(\)/);
  assert.match(source, /app\.on\('before-quit'[\s\S]*closeApplicationServices\(\)/);
});

test('Electron power lifecycle pauses OpenHome advertisement and removes listeners before shutdown', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  assert.match(source, /handleSystemSuspendForWatchdog[\s\S]*updateOpenHomeEnvironmentAvailability\(false\)/);
  assert.match(source, /handleSystemResumeForWatchdog[\s\S]*updateOpenHomeEnvironmentAvailability\(true\)/);
  assert.match(source, /powerMonitor\.on\('suspend',\s*handleSystemSuspendForWatchdog\)/);
  assert.match(source, /powerMonitor\.on\('resume',\s*handleSystemResumeForWatchdog\)/);
  assert.match(source, /disposePowerMonitorEvents[\s\S]*removeListener\('suspend',\s*handleSystemSuspendForWatchdog\)[\s\S]*removeListener\('resume',\s*handleSystemResumeForWatchdog\)/);
  assert.match(source, /closeApplicationServices[\s\S]*disposePowerMonitorEvents\?\.\(\)[\s\S]*openHomeControlHost = null/);
});

test('Windows power resume notifies the current registered window without a global window binding', () => {
  const mainPath = path.join(repoRoot, 'electron', 'main.js');
  const source = fs.readFileSync(mainPath, 'utf8');
  const start = source.indexOf('// Renderer watchdog state');
  const end = source.indexOf('// Renderer-ping IPC:', start);
  assert.ok(start >= 0 && end > start);
  const notifications = [];
  const availability = [];
  const airPlayAvailability = [];
  const networkOutputAvailability = [];
  const powerMonitor = new EventEmitter();
  const makeWindow = name => ({
    isDestroyed: () => false,
    webContents: { send: channel => notifications.push([name, channel]) }
  });
  let currentWindow = makeWindow('first');
  const hostProcess = { platform: 'win32' };
  // Execute the production event registration and handler in their module scope.
  // mainWindow exists only inside createWindow, so do not inject it into this scope.
  vm.runInNewContext(`${source.slice(start, end)}\nregisterWatchdogPowerEvents();`, {
    constants: { getMainWindow: () => currentWindow },
    process: hostProcess,
    powerMonitor,
    disposePowerMonitorEvents: null,
    openHomeControlHost: {
      setEnvironmentAvailable(available) {
        availability.push(available);
        return Promise.resolve();
      }
    },
    airPlayReceiverHost: {
      setEnvironmentAvailable(available) {
        airPlayAvailability.push(available);
        return Promise.resolve();
      }
    },
    networkOutputHost: {
      setEnvironmentAvailable(available) {
        networkOutputAvailability.push(available);
        return Promise.resolve();
      }
    },
    console
  }, { filename: mainPath });

  powerMonitor.emit('suspend');
  assert.doesNotThrow(() => powerMonitor.emit('resume'));
  currentWindow = makeWindow('replacement');
  powerMonitor.emit('resume');
  currentWindow = { isDestroyed: () => true };
  powerMonitor.emit('resume');
  currentWindow = null;
  powerMonitor.emit('resume');
  currentWindow = makeWindow('non-windows');
  hostProcess.platform = 'darwin';
  powerMonitor.emit('resume');
  assert.deepEqual(notifications, [['first', 'system-resume'], ['replacement', 'system-resume']]);
  assert.deepEqual(availability, [false, true, true, true, true, true]);
  assert.deepEqual(airPlayAvailability, availability);
  assert.deepEqual(networkOutputAvailability, availability);
});

test('Electron splash generates a valid module import from an installation path containing an apostrophe', () => {
  const { Linter } = require('eslint');
  const { pathToFileURL } = require('node:url');
  const mainPath = path.join(repoRoot, 'electron', 'main.js');
  const source = fs.readFileSync(mainPath, 'utf8');
  const start = source.indexOf('function createSplashScreen() {');
  const end = source.indexOf('// Store tray menu labels for translation', start);
  assert.ok(start >= 0 && end > start);
  const installationDirectory = path.join(repoRoot, "Listener's % 音楽 apps", 'EffeTune', 'electron');
  let html;
  vm.runInNewContext(`${source.slice(start, end)}\ncreateSplashScreen();`, {
    __dirname: installationDirectory,
    path,
    pathToFileURL,
    themeRegistry: {
      getThemePreset: () => ({ id: 'dark', windowBackground: '#000000', windowForeground: '#ffffff' })
    },
    constants: { getAppConfig: () => ({}), getMainWindow: () => null, getAppVersion: () => 'test-version' },
    BrowserWindow: class { loadFile() {} once() {} },
    app: { getPath: () => repoRoot },
    fs: { writeFileSync: (_file, contents) => { html = contents; } },
    setTimeout() {}
  }, { filename: mainPath });
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const messages = new Linter().verify(script, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }
  });
  assert.deepEqual(messages, []);
  const moduleSpecifier = script.match(/\bfrom\s+("[^\r\n]+")\s*;/)?.[1];
  assert.ok(moduleSpecifier);
  assert.equal(JSON.parse(moduleSpecifier), pathToFileURL(
    path.join(installationDirectory, '../js/ui/brand-animation.js')
  ).href);
});
