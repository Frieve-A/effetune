'use strict';

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getMainWindow } = require('../../electron/constants.js');

const origin = process.env.EFFETUNE_BROWSER_FIXTURE_ORIGIN;
if (!origin) throw new Error('The browser integration test requires its fixture origin.');
const fixtureDirectory = path.join(__dirname, '../fixtures/desktop-browser');
const certificate = fs.readFileSync(path.join(fixtureDirectory, 'cert.pem'), 'utf8').replace(/\s/g, '');
app.setAppPath(path.resolve(__dirname, '../..'));
process.on('uncaughtExceptionMonitor', error => {
  process.stderr.write(`Browser fixture uncaught exception: ${error.stack}\n`);
});
for (const event of ['before-quit', 'will-quit', 'quit']) {
  app.on(event, () => process.stderr.write(`Browser fixture lifecycle: ${event}\n`));
}
app.on('browser-window-created', (_event, window) => {
  const id = window.id;
  for (const event of ['close', 'closed']) {
    window.on(event, () => process.stderr.write(`Browser fixture window ${id}: ${event}\n`));
  }
});

// Trust the fixture before Chromium reaches production's certificate-error denial.
app.whenReady().then(() => {
  const browserSession = session.fromPartition('persist:effetune-browser');
  browserSession.webRequest.onBeforeRequest({ urls: ['https://effetune.frieve.com/streaming/'] }, (_request, callback) => {
    callback({ redirectURL: `${origin}/source?default-start-page=1` });
  });
  browserSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === new URL(origin).hostname &&
      request.certificate.data.replace(/\s/g, '') === certificate ? 0 : -3);
  });
});

globalThis.browserFixture = {
  contents() {
    const mainWindow = getMainWindow();
    return mainWindow?.contentView.children.find(view =>
      view.webContents?.getURL().startsWith(`${origin}/`))?.webContents;
  },
  async createObserver() {
    const observer = new BrowserWindow({ show: false, webPreferences: {
      partition: 'browser-test-output-observer', sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false
    } });
    const observerContents = observer.webContents;
    observerContents.session.setPermissionCheckHandler((sender, permission) =>
      sender === observerContents && ['media', 'display-capture'].includes(permission));
    observerContents.session.setPermissionRequestHandler((sender, permission, callback) =>
      callback(sender === observerContents && ['media', 'display-capture'].includes(permission)));
    observerContents.session.setDisplayMediaRequestHandler((request, callback) => {
      const target = this.contents();
      if (request.frame !== observerContents.mainFrame || !request.audioRequested || !target) {
        callback({});
        return;
      }
      // System loopback is a measurement instrument only, never the app input.
      callback({ video: target.mainFrame, audio: 'loopback' });
    });
    await observer.loadFile(path.join(fixtureDirectory, 'observer.html'));
    globalThis.browserFixtureObserver = observer;
    return observerContents.executeJavaScript('startObserver()', true);
  },
  async measureOutput() {
    return globalThis.browserFixtureObserver.webContents.executeJavaScript('measureOutput()');
  },
  async closeObserver() {
    const observer = globalThis.browserFixtureObserver;
    if (!observer || observer.isDestroyed()) return;
    await observer.webContents.executeJavaScript('stopObserver()');
    observer.destroy();
    globalThis.browserFixtureObserver = null;
  }
};

require('../../electron/main.js');
