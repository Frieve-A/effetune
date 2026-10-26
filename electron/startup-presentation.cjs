// A hidden restored window may not paint until shown. Presentation depends on
// application preparation, never on native painting or animation frames.
function createStartupPresentation({ window, ipcMain, isQuitting, present }) {
  let prepared = false;

  function onPrepared(event) {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (prepared || window.isDestroyed() || isQuitting()) return;
    prepared = true;
    ipcMain.removeListener('renderer-ready-for-presentation', onPrepared);
    present();
  }

  ipcMain.on('renderer-ready-for-presentation', onPrepared);
  window.once('closed', () => {
    ipcMain.removeListener('renderer-ready-for-presentation', onPrepared);
  });
  return { isReady: () => prepared };
}

module.exports = { createStartupPresentation };
