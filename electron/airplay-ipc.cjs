function registerAirPlayIpc({ ipcMain, MessageChannelMain, host, getMainWindow, config, constants, getFriendlyName }) {
  const handlers = new Map([
    ['airplay-v1:get-status', () => host.getStatus()],
    ['airplay-v1:set-enabled', async (_event, request) => {
      if (typeof request?.enabled !== 'boolean') throw new TypeError('Invalid AirPlay setting');
      const next = { ...config.loadConfig(), airPlayReceiver: request.enabled };
      if (config.saveConfig(next) !== true) throw new Error('AirPlay setting could not be saved');
      constants.setAppConfig(next);
      await host.setConfiguration({ enabled: request.enabled, friendlyName: getFriendlyName() });
      return host.getStatus();
    }],
    ['airplay-v1:renderer-ready', async () => {
      const { port1, port2 } = new MessageChannelMain();
      try {
        await host.attachRendererPort(port1);
        getMainWindow().webContents.postMessage('airplay-v1:port', null, [port2]);
        return host.getStatus();
      } catch (error) {
        port1.close();
        port2.close();
        await host.setRendererUnavailable();
        throw error;
      }
    }],
    ['airplay-v1:renderer-unavailable', () => host.setRendererUnavailable()],
    ['airplay-v1:stop-session', () => host.stopSession()]
  ]);
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getMainWindow();
      if (!window?.webContents || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('AirPlay request is unavailable');
      }
      return handler(event, ...args);
    });
  }
  return () => {
    for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
  };
}

module.exports = { registerAirPlayIpc };
