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
});

test('Electron 44 preserves disabled features while enabling explicitly permitted basic Web MIDI', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  assert.match(
    source,
    /process\.versions\.electron\?\.startsWith\('44\.'\)[\s\S]*getSwitchValue\('disable-features'\)[\s\S]*\.split\(','\)[\s\S]*disabledFeatures\.includes\('BlockMidiByDefault'\)[\s\S]*disabledFeatures\.push\('BlockMidiByDefault'\)[\s\S]*appendSwitch\('disable-features',\s*disabledFeatures\.join\(','\)\)/
  );
  assert.ok(
    source.indexOf("getSwitchValue('disable-features')") < source.indexOf('app.whenReady()')
  );
  assert.match(source, /GRANTED_PERMISSIONS\s*=\s*\[[^\]]*'midi'[^\]]*\]/);
  assert.match(source, /setPermissionCheckHandler\([\s\S]*GRANTED_PERMISSIONS\.includes\(permission\)/);
  assert.match(source, /setPermissionRequestHandler\([\s\S]*GRANTED_PERMISSIONS\.includes\(permission\)/);
});

test('Electron shutdown awaits OpenHome and catalog cleanup through one idempotent promise', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron', 'main.js'), 'utf8');

  assert.match(source, /if \(appServicesClosePromise\) return appServicesClosePromise/);
  assert.match(source, /appServicesClosePromise = Promise\.all\(\[[\s\S]*closeLibraryCatalogRecovery\(\)[\s\S]*openHomeHost\?\.dispose\(\)/);
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
