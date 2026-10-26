const constants = require('./constants');

function registerClipboardIpcHandlers(ipcMain, clipboard, logger = console) {
  // Read clipboard text via Electron's native clipboard. The web Clipboard API
  // is denied on file:// pages by the permission handler, so renderers use this
  // for paste operations such as pasting a shared pipeline URL.
  ipcMain.handle('read-clipboard-text', async () => {
    try {
      return await clipboard.readText();
    } catch (error) {
      logger.error('Error reading clipboard text:', error);
      return '';
    }
  });

  ipcMain.handle('write-clipboard-text', async (event, text) => {
    try {
      await clipboard.writeText(String(text ?? ''));
      return true;
    } catch (error) {
      logger.error('Error writing clipboard text:', error);
      return false;
    }
  });

  ipcMain.handle('write-clipboard-image', async (event, bytes) => {
    try {
      const mainWindow = constants.getMainWindow();
      if (!mainWindow?.webContents || event.sender !== mainWindow.webContents ||
          !event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 33 || bytes.byteLength > 32 * 1024 * 1024) return false;
      const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR') return false;
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) return false;
      const { nativeImage, ClipboardItem } = require('electron');
      const image = nativeImage.createFromBuffer(png);
      if (image.isEmpty()) return false;
      const size = image.getSize();
      if (size.width !== width || size.height !== height) return false;
      await clipboard.write([new ClipboardItem({
        'image/png': new Blob([png], { type: 'image/png' })
      })]);
      return true;
    } catch (error) {
      logger.error('Error writing clipboard image:', error);
      return false;
    }
  });
}

module.exports = {
  registerClipboardIpcHandlers
};
