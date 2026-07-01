function registerClipboardIpcHandlers(ipcMain, clipboard, logger = console) {
  // Read clipboard text via Electron's native clipboard. The web Clipboard API
  // is denied on file:// pages by the permission handler, so renderers use this
  // for paste operations such as pasting a shared pipeline URL.
  ipcMain.handle('read-clipboard-text', () => {
    try {
      return clipboard.readText();
    } catch (error) {
      logger.error('Error reading clipboard text:', error);
      return '';
    }
  });

  ipcMain.handle('write-clipboard-text', (event, text) => {
    try {
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch (error) {
      logger.error('Error writing clipboard text:', error);
      return false;
    }
  });
}

module.exports = {
  registerClipboardIpcHandlers
};
