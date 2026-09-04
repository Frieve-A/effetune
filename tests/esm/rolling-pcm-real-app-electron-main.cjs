'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { statSync } = require('node:fs');
const { readFileBytes } = require('../../electron/bounded-file-reader');

const tracks = JSON.parse(process.env.EFFETUNE_ROLLING_REAL_APP_TRACKS ?? '[]').map((filePath, index) => ({
  entryInstanceId: `rolling-real-entry-${index + 1}`,
  trackUid: `rolling-real-track-${index + 1}`,
  name: `Rolling fixture ${index + 1}`,
  fileName: `rolling-fixture-${index + 1}.wav`,
  path: filePath,
  size: statSync(filePath).size
}));

if (tracks.length !== 2) throw new Error('The rolling real-app fixture requires exactly two tracks');

const operationId = 'rolling-real-app-operation';
const sequenceId = 'rolling-real-app-sequence';
const terminalResult = Object.freeze({
  operationKind: 'play',
  destination: 'replace',
  sequenceId,
  itemCount: tracks.length,
  firstOrdinal: 0,
  firstEntry: tracks[0]
});

global.rollingRealAppFixtureObservations = {
  boundedReads: [],
  sourceResolutions: [],
  starts: 0,
  commits: 0
};

ipcMain.handle('read-file-bytes', async (_event, filePath, expectedByteLength) => {
  const bytes = await readFileBytes(filePath, expectedByteLength);
  global.rollingRealAppFixtureObservations.boundedReads.push({
    filePath,
    expectedByteLength,
    byteLength: bytes.byteLength
  });
  return bytes;
});

ipcMain.handle('library-service-v1:start', async (_event, request) => {
  if (request?.operationKind !== 'play') throw new Error('Fixture only supports Play');
  global.rollingRealAppFixtureObservations.starts += 1;
  return { kind: 'started', operationId, provisionalEntry: tracks[0] };
});
ipcMain.handle('library-service-v1:status', async () => ({
  terminalKind: 'succeeded',
  finishedAt: Date.now(),
  result: terminalResult
}));
ipcMain.handle('library-service-v1:cancel', async () => ({ kind: 'cancelled' }));
ipcMain.handle('library-playback-v1:get-provisional-entry', async () => tracks[0]);
ipcMain.handle('library-playback-v1:read-sequence-page', async (_event, request) => {
  if (request?.sequenceId !== sequenceId) throw new Error('Unknown fixture sequence');
  const ordinal = request.ordinal ?? request.startOrdinal ?? 0;
  const limit = request.limit ?? tracks.length;
  return { items: tracks.slice(ordinal, ordinal + limit) };
});
ipcMain.handle('library-playback-v1:resolve-sequence-entry-source', async (_event, request) => {
  const track = tracks.find(candidate => candidate.entryInstanceId === request?.entryInstanceId);
  if (!track) throw new Error('Unknown fixture entry');
  global.rollingRealAppFixtureObservations.sourceResolutions.push(track.path);
  return {
    kind: 'electron-file',
    path: track.path,
    fileName: track.fileName,
    byteLength: track.size,
    canonicalSourceKey: track.path
  };
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: require.resolve('../../electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await window.loadURL(process.env.EFFETUNE_ROLLING_REAL_APP_TEST_URL);
});

app.on('window-all-closed', () => app.quit());
