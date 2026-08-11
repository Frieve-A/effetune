const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
