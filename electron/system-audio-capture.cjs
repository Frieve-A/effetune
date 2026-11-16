// Reserves and grants the System Audio input: a loopback of the system default output
// that mutes that output while captured. The Browser controller owns the session's only
// display-media handler and hands System Audio requests to this module.
const { createSystemAudioMuteKeeper } = require('./system-audio-mute-keeper.cjs');

// The renderer requests capture right after reserving, so a reservation that outlives
// this has lost its request and must not take a later one.
const RESERVATION_TIMEOUT_MS = 10000;

function createSystemAudioCapture({ mainWindow, ipcMain, desktopCapturer, muteKeeper = createSystemAudioMuteKeeper() }) {
  const trusted = mainWindow.webContents;
  let reservation = null;
  let disposed = false;
  let generation = 0;

  function clearReservation() {
    if (reservation) clearTimeout(reservation.timer);
    reservation = null;
  }

  function fromTrustedFrame(event) {
    return !disposed && !trusted.isDestroyed() && event.sender === trusted && event.senderFrame === trusted.mainFrame;
  }

  const syncPrepare = event => {
    if (!fromTrustedFrame(event)) {
      event.returnValue = { ok: false, error: 'unavailable' };
      return;
    }
    clearReservation();
    const token = { order: process.hrtime.bigint(), frame: trusted.mainFrame, expires: Date.now() + RESERVATION_TIMEOUT_MS };
    token.timer = setTimeout(() => { if (reservation === token) reservation = null; }, RESERVATION_TIMEOUT_MS);
    token.timer.unref?.();
    reservation = token;
    event.returnValue = { ok: true };
  };

  // The renderer reports each granted capture it keeps and each one it stops, so the
  // default output stays muted exactly while a capture is live. A capture is reported
  // as stopped before its tracks stop, so the keeper never mutes again the unmute
  // Chromium applies when the capture ends.
  const syncCaptureStarted = event => {
    if (fromTrustedFrame(event)) muteKeeper.hold();
    event.returnValue = null;
  };
  const syncCaptureStopped = event => {
    if (fromTrustedFrame(event)) muteKeeper.release();
    event.returnValue = null;
  };
  // A reload or crash ends the renderer's captures without their reports.
  const resetCaptures = () => {
    generation++;
    clearReservation();
    muteKeeper.reset();
  };
  ipcMain.on('system-audio:prepare-capture', syncPrepare);
  ipcMain.on('system-audio:capture-started', syncCaptureStarted);
  ipcMain.on('system-audio:capture-stopped', syncCaptureStopped);
  trusted.on('render-process-gone', resetCaptures);
  trusted.on('did-navigate', resetCaptures);

  // Issue order of the unconsumed reservation, comparable with Browser reservations, or null.
  function pendingOrder() {
    return reservation ? reservation.order : null;
  }

  // Consumes the reservation whether the request is granted or rejected.
  async function handleRequest(request, callback) {
    const token = reservation;
    clearReservation();
    if (!token || disposed || request.frame !== token.frame || token.expires < Date.now() ||
      !request.videoRequested || !request.audioRequested) {
      callback({});
      return;
    }
    const requestGeneration = generation;
    const isCurrent = () => !disposed && generation === requestGeneration &&
      !trusted.isDestroyed() && trusted.mainFrame === token.frame;
    let source = null;
    try {
      // Audio-only display capture is not allowed, so the renderer stops this video track at once.
      [source] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    } catch (failure) {
      console.error('System Audio capture source lookup failed:', failure?.name || 'Error');
    }
    // The keeper must read the output's mute state before the granted capture mutes it.
    if (source && isCurrent()) await muteKeeper.prepare();
    if (!source || !isCurrent()) {
      callback({});
      return;
    }
    callback({ video: source, audio: 'loopbackWithMute' });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearReservation();
    ipcMain.removeListener('system-audio:prepare-capture', syncPrepare);
    ipcMain.removeListener('system-audio:capture-started', syncCaptureStarted);
    ipcMain.removeListener('system-audio:capture-stopped', syncCaptureStopped);
    trusted.removeListener('render-process-gone', resetCaptures);
    trusted.removeListener('did-navigate', resetCaptures);
    muteKeeper.dispose();
  }

  return { pendingOrder, handleRequest, dispose };
}

module.exports = { createSystemAudioCapture };
