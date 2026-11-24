'use strict';

const PROCESS_EXIT_REASONS = [
  'clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction'
];
const CHILD_TYPES = ['Utility', 'Zygote', 'Sandbox helper', 'GPU', 'Pepper Plugin', 'Pepper Plugin Broker'];
const MEDIA_STATUSES = ['not-determined', 'granted', 'denied', 'restricted', 'unknown'];

function readSystemValue(read) {
  try { return read() ?? 'unavailable'; }
  catch { return 'unavailable'; }
}

function createMainDiagnostics() {
  const startedAtEpochMs = Date.now();
  const events = [];
  let previousSignature;

  // Event producers pass only the fixed codes and numbers for their own event.
  function record(kind, fields) {
    const epochMs = Date.now();
    const signature = JSON.stringify([kind, fields]);
    if (signature === previousSignature) {
      const previous = events.at(-1);
      previous.count = (previous.count ?? 1) + 1;
      previous.lastEpochMs = epochMs;
      return;
    }
    previousSignature = signature;
    events.push({ epochMs, origin: 'main', kind, ...fields });
    if (events.length > 500) events.shift();
  }

  function processGone(kind, details) {
    const fields = {
      reason: PROCESS_EXIT_REASONS.includes(details?.reason) ? details.reason : 'unknown',
      exitCode: Number.isInteger(details?.exitCode) ? details.exitCode : null
    };
    if (kind === 'childProcessGone') fields.processType = CHILD_TYPES.includes(details?.type) ? details.type : 'unknown';
    record(kind, fields);
  }

  function registerIpc({ ipcMain, getMainWindow, app, systemPreferences, nativeAudio, redactDiagnosticText }) {
    function mediaAccess(type) {
      if (process.platform !== 'darwin') return 'unavailable';
      const value = readSystemValue(() => systemPreferences.getMediaAccessStatus(type));
      return MEDIA_STATUSES.includes(value) ? value : 'unavailable';
    }
    ipcMain.handle('diagnostics:collect', event => {
      const mainWindow = getMainWindow();
      const contents = mainWindow?.webContents;
      if (!contents || mainWindow.isDestroyed() || !event.senderFrame ||
          event.sender !== contents || event.senderFrame !== contents.mainFrame) {
        throw new Error('Only the main window can read diagnostic information.');
      }
      const exit = nativeAudio.lastExit;
      return {
        startedAtEpochMs,
        environment: {
          appVersion: app.getVersion(), isPackaged: app.isPackaged,
          platform: process.platform, systemVersion: readSystemValue(() => process.getSystemVersion()), arch: process.arch,
          runningUnderARM64Translation: readSystemValue(() => app.runningUnderARM64Translation),
          electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
          mediaAccess: { microphone: mediaAccess('microphone'), screen: mediaAccess('screen') }
        },
        nativeHost: {
          droppedFeedPackets: nativeAudio.active?.droppedFeed ?? null,
          lastExit: exit ? {
            variant: exit.variant, epochMs: exit.epochMs, exitCode: exit.exitCode, signal: exit.signal,
            spawnError: exit.spawnError, droppedFeedPackets: exit.droppedFeedPackets, stderr: redactDiagnosticText(exit.stderr)
          } : null
        },
        events: events.slice()
      };
    });
  }
  return { record, processGone, registerIpc };
}

module.exports = { createMainDiagnostics };
