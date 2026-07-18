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
