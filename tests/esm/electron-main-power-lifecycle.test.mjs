import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../../electron/main.js', import.meta.url), 'utf8');

test('desktop watchdog pauses for system sleep and receives a fresh wake grace period', () => {
  const armStart = mainSource.indexOf('function armRendererWatchdog(');
  const disarmStart = mainSource.indexOf('function disarmRendererWatchdog(');
  const suspendStart = mainSource.indexOf('function handleSystemSuspendForWatchdog()');
  const resumeStart = mainSource.indexOf('function handleSystemResumeForWatchdog()');
  const registrationStart = mainSource.indexOf('function registerWatchdogPowerEvents()');
  assert.ok(armStart >= 0);
  assert.ok(disarmStart > armStart);
  assert.ok(suspendStart >= 0);
  assert.ok(resumeStart > suspendStart);
  assert.ok(registrationStart > resumeStart);

  const armSource = mainSource.slice(armStart, disarmStart);
  assert.match(armSource, /if \(watchdogSystemSuspended\) return/);

  const suspendSource = mainSource.slice(suspendStart, resumeStart);
  assert.match(suspendSource, /watchdogArmedBeforeSystemSuspend \|\| watchdogArmed/);
  assert.match(suspendSource, /watchdogSystemSuspended = true/);
  assert.match(suspendSource, /disarmRendererWatchdog\('system-suspend'\)/);

  const resumeSource = mainSource.slice(resumeStart, registrationStart);
  assert.match(resumeSource, /watchdogArmedBeforeSystemSuspend \|\| watchdogArmed/);
  assert.match(resumeSource, /watchdogSystemSuspended = false/);
  assert.match(resumeSource, /armRendererWatchdog\('system-resume'\)/);

  const registrationSource = mainSource.slice(registrationStart, mainSource.indexOf("ipcMain.on('renderer-ping'"));
  assert.match(registrationSource, /powerMonitor\.on\('suspend', handleSystemSuspendForWatchdog\)/);
  assert.match(registrationSource, /powerMonitor\.on\('resume', handleSystemResumeForWatchdog\)/);

  const readySource = mainSource.slice(mainSource.indexOf('app.whenReady().then'));
  assert.ok(readySource.indexOf('registerWatchdogPowerEvents();') < readySource.indexOf('startWatchdog();'));
});

test('desktop power policy receives native window visibility without throttling renderer timers', () => {
  assert.match(mainSource, /backgroundThrottling:\s*false/);
  assert.match(mainSource, /const hidden = mainWindow\.isMinimized\(\) \|\| !mainWindow\.isVisible\(\)/);
  assert.match(mainSource, /webContents\.send\('window-visibility-changed', \{ hidden \}\)/);
  assert.match(mainSource, /mainWindow\.on\('hide', \(\) => sendWindowVisibilityState\(mainWindow\)\)/);
  assert.match(mainSource, /mainWindow\.on\('show', \(\) => sendWindowVisibilityState\(mainWindow\)\)/);

  const minimizeSource = mainSource.slice(
    mainSource.indexOf("mainWindow.on('minimize'"),
    mainSource.indexOf("mainWindow.on('restore'")
  );
  assert.match(minimizeSource, /sendWindowVisibilityState\(mainWindow\)/);

  const restoreSource = mainSource.slice(
    mainSource.indexOf("mainWindow.on('restore'"),
    mainSource.indexOf('// Flag to track if we')
  );
  assert.match(restoreSource, /sendWindowVisibilityState\(mainWindow\)/);
});

test('Linux selects X11 before Electron becomes ready so minimize remains observable', () => {
  const linuxSwitchStart = mainSource.indexOf("if (process.platform === 'linux')");
  const readyStart = mainSource.indexOf('app.whenReady().then');
  assert.ok(linuxSwitchStart >= 0);
  assert.ok(readyStart > linuxSwitchStart);
  assert.match(
    mainSource.slice(linuxSwitchStart, readyStart),
    /app\.commandLine\.appendSwitch\('ozone-platform', 'x11'\)/
  );
});

test('every existing-window presentation restores minimized state before show and focus', () => {
  const helperStart = mainSource.indexOf('function presentMainWindow(mainWindow)');
  const visibilityStart = mainSource.indexOf('function sendWindowVisibilityState(mainWindow)');
  assert.ok(helperStart >= 0);
  assert.ok(visibilityStart > helperStart);
  const helperSource = mainSource.slice(helperStart, visibilityStart);
  assert.ok(helperSource.indexOf('mainWindow.restore()') < helperSource.indexOf('mainWindow.show()'));
  assert.ok(helperSource.indexOf('mainWindow.show()') < helperSource.indexOf('mainWindow.focus()'));

  const traySource = mainSource.slice(
    mainSource.indexOf('function updateTrayMenuTemplate('),
    mainSource.indexOf('// Initialize the app')
  );
  assert.equal((traySource.match(/presentMainWindow\(constants\.getMainWindow\(\)\)/g) || []).length, 3);

  const secondInstanceSource = mainSource.slice(mainSource.indexOf("app.on('second-instance'"));
  assert.match(secondInstanceSource, /if \(!pendingMainWindowShow\) \{\s*presentMainWindow\(mainWindow\)/);
});
