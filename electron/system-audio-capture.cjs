// Reserves and grants the System Audio input: a loopback of the system default output
// that mutes that output while captured. The Browser controller owns the session's only
// display-media handler and hands System Audio requests to this module.

// The renderer requests capture right after reserving, so a reservation that outlives
// this has lost its request and must not take a later one.
const RESERVATION_TIMEOUT_MS = 10000;

function createSystemAudioCapture({ mainWindow, ipcMain, desktopCapturer }) {
  const trusted = mainWindow.webContents;
  let reservation = null;
  let disposed = false;

  function clearReservation() {
    if (reservation) clearTimeout(reservation.timer);
    reservation = null;
  }

  const syncPrepare = event => {
    if (disposed || trusted.isDestroyed() || event.sender !== trusted || event.senderFrame !== trusted.mainFrame) {
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
  ipcMain.on('system-audio:prepare-capture', syncPrepare);

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
    let source = null;
    try {
      // Audio-only display capture is not allowed, so the renderer stops this video track at once.
      [source] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    } catch (failure) {
      console.error('System Audio capture source lookup failed:', failure?.name || 'Error');
    }
    if (!source || disposed) {
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
  }

  return { pendingOrder, handleRequest, dispose };
}

module.exports = { createSystemAudioCapture };
