'use strict';

const { normalizeConfiguration, sanitizeConfiguration } = require('./network-output-host.cjs');

const CHANNEL_PREFIX = 'network-output-v1:';

// Main-process IPC surface for the renderer `networkOutputV1` bridge (§6).
// Every channel is restricted to the main frame of the main window.
function registerNetworkOutputIpc({ ipcMain, MessageChannelMain, host, getMainWindow, config, constants }) {
  async function updateConfiguration(makePatch) {
    const loaded = config.loadConfig();
    const current = sanitizeConfiguration(loaded.networkOutput, host.onDiagnostic);
    const normalized = normalizeConfiguration({ ...current, ...makePatch(current) });
    const next = { ...loaded, networkOutput: normalized };
    if (config.saveConfig(next) === false) throw new Error('Failed to save network output configuration');
    constants.setAppConfig(next);
    return host.setConfiguration(normalized);
  }

  const handlers = new Map([
    ['get-status', () => host.getStatus()],
    ['get-clock', () => host.clockNow()],
    ['update-route', (_event, route) => host.updateRoute(route)],
    ['set-configuration', async (event, patch) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Invalid network output configuration patch');
      return updateConfiguration(() => patch);
    }],
    ['set-picker-open', (event, open) => {
      if (typeof open !== 'boolean') throw new TypeError('Invalid network output picker state');
      return host.setPickerOpen(open);
    }],
    ['set-target-enabled', async (event, id, enabled) => {
      if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') throw new TypeError('Invalid network output target selection');
      return updateConfiguration(current => {
        const target = current.targets.find(entry => entry.id === id) ?? host.getStatus().targets.find(entry => entry.id === id);
        if (!target) throw new Error('Network output target is unavailable');
        const targets = current.targets.filter(entry => entry.id !== id)
          .map(entry => current.enabled ? entry : { ...entry, enabled: false });
        targets.push({ ...target, enabled });
        return { enabled: current.enabled || enabled, targets };
      });
    }],
    ['renderer-ready', async () => {
      const { port1, port2 } = new MessageChannelMain();
      try {
        await host.attachRendererPort(port1);
        getMainWindow().webContents.postMessage(`${CHANNEL_PREFIX}port`, null, [port2]);
      } catch (error) {
        port1.close();
        port2.close();
        await host.setRendererUnavailable();
        throw error;
      }
      return host.getStatus();
    }],
    ['renderer-unavailable', () => host.setRendererUnavailable()],
    ['resync', () => host.resync()]
  ]);

  for (const [name, handler] of handlers) {
    ipcMain.handle(`${CHANNEL_PREFIX}${name}`, (event, ...args) => {
      const window = getMainWindow();
      if (!window?.webContents || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Network output IPC is only available to the main window');
      }
      return handler(event, ...args);
    });
  }

  return () => {
    for (const name of handlers.keys()) ipcMain.removeHandler(`${CHANNEL_PREFIX}${name}`);
  };
}

module.exports = { registerNetworkOutputIpc };
