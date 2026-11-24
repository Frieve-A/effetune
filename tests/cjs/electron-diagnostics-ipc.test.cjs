'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMainDiagnostics } = require('../../electron/diagnostics.cjs');

test('only the main document can collect redacted desktop diagnostics', async () => {
  const { redactDiagnosticText } = await import('../../js/diagnostics/diagnostic-redaction.js');
  const diagnostics = createMainDiagnostics();
  const webContents = { mainFrame: {} };
  const window = { webContents, isDestroyed: () => false };
  const handlers = new Map();
  diagnostics.registerIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getMainWindow: () => window, app: { getVersion: () => '2.20.0', isPackaged: true },
    nativeAudio: { active: { droppedFeed: 7 }, lastExit: {
      variant: 'baseline', exitCode: 1, signal: null, spawnError: null, epochMs: 10,
      droppedFeedPackets: 42, stderr: 'Failed to open /Users/listener/private.wav', privateField: 'secret'
    } }, redactDiagnosticText
  });
  diagnostics.processGone('childProcessGone', { type: 'GPU', reason: 'crashed', exitCode: 3, serviceName: 'secret' });
  diagnostics.record('browserCapture', { decision: 'noReservation' });
  diagnostics.record('browserCapture', { decision: 'noReservation' });
  const collect = handlers.get('diagnostics:collect');
  assert.throws(() => collect({ sender: {}, senderFrame: webContents.mainFrame }), /main window/);
  assert.throws(() => collect({ sender: webContents, senderFrame: {} }), /main window/);
  const data = collect({ sender: webContents, senderFrame: webContents.mainFrame });
  assert.equal(data.environment.appVersion, '2.20.0');
  assert.equal(data.nativeHost.droppedFeedPackets, 7);
  assert.equal(data.nativeHost.lastExit.droppedFeedPackets, 42);
  assert.equal(data.nativeHost.lastExit.stderr, 'Failed to open <path>');
  assert.doesNotMatch(JSON.stringify(data), /listener|private\.wav|secret/);
  assert.deepEqual(data.events.map(event => event.origin), ['main', 'main']);
  assert.equal(data.events[0].processType, 'GPU');
  assert.equal(data.events[1].decision, 'noReservation');
  assert.equal(data.events[1].count, 2);
  assert.ok(data.events[1].epochMs <= data.events[1].lastEpochMs);
});
