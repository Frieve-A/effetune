const { validateRules } = require('../js/browser/url-rules.js');
const { browserShortcut } = require('../js/browser/shortcuts.js');
const path = require('node:path');

const PARTITION = 'persist:effetune-browser';
const CAPTURE_TIMEOUT_MS = 30000;
const { name: APP_NAME, version: APP_VERSION } = require('../package.json');

// User-origin normal declarations let site styles take precedence.
function browserScrollbarCSS({ windowBackground, windowForeground }) {
  return `
  ::-webkit-scrollbar { width: 15px; height: 15px; }
  ::-webkit-scrollbar-track {
    background: color-mix(in srgb, ${windowBackground}, ${windowForeground} 7%);
  }
  ::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, ${windowBackground}, ${windowForeground} 28%);
    border: 3px solid color-mix(in srgb, ${windowBackground}, ${windowForeground} 7%);
    border-radius: 999px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, ${windowBackground}, ${windowForeground} 42%);
  }
  ::-webkit-scrollbar-thumb:active {
    background: color-mix(in srgb, ${windowBackground}, ${windowForeground} 50%);
  }
  ::-webkit-scrollbar-corner { background: color-mix(in srgb, ${windowBackground}, ${windowForeground} 7%); }
`;
}

function normalizeBrowserURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || !value.trim()) return null;
  const text = value.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function validNavigationURL(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) && normalizeBrowserURL(value) !== null;
}

function validUserAgent(value) {
  return typeof value === 'string' && value.length <= 1024 && !/[^\x20-\x7e\x80-\xff]/.test(value);
}

function normalizeBrowserSettings(value) {
  const bookmarks = [];
  for (const item of Array.isArray(value?.bookmarks) ? value.bookmarks.slice(0, 100) : []) {
    const url = normalizeBrowserURL(item?.url);
    if (url && typeof item.name === 'string' && item.name.trim()) {
      bookmarks.push({ name: item.name.trim().slice(0, 120), url });
    }
  }
  let urlRules = [];
  try { urlRules = validateRules(value?.urlRules || []); } catch { /* Ignore invalid saved rules. */ }
  return {
    urlRules,
    bookmarks,
    startPage: normalizeBrowserURL(value?.startPage) || '',
    userAgent: validUserAgent(value?.userAgent) && value.userAgent.trim() !== 'EffeTune' ? value.userAgent.trim() : '',
    openTabsExternally: value?.openTabsExternally !== false
  };
}

function createBrowserController({ mainWindow, WebContentsView, session, ipcMain, shell, Menu, clipboard, translate, components, getSettings, saveSettings, themePreset, allowStartupCapture = false }) {
  const trusted = mainWindow.webContents;
  const chromiumUserAgent = trusted.getUserAgent().replace(/\sElectron\/\S+/g, '').trim();
  const defaultUserAgent = chromiumUserAgent.toLowerCase().includes(`${APP_NAME.toLowerCase()}/`) ?
    chromiumUserAgent : `${chromiumUserAgent} ${APP_NAME}/${APP_VERSION}`;
  const captureSession = trusted.session;
  let view = null;
  let auxiliary = null;
  let popupPending = false;
  let ready = Promise.resolve();
  let componentsReady = null;
  let viewRevision = 0;
  let stateRevision = 0;
  let partition = null;
  let generation = 0;
  let reservation = null;
  let captureActive = false;
  let captureGranted = false;
  let error = null;
  let disposed = false;
  let clearing = false;
  let htmlFullscreen = false;
  let presentation = { visible: false, zoomFactor: 1, bounds: { x: 0, y: 0, width: 0, height: 0 } };
  const listeners = [];
  const channels = [];
  const scrollbarStyles = new WeakMap();
  let scrollbarCSS = themePreset ? browserScrollbarCSS(themePreset) : '';

  function applyScrollbarStyle(wc) {
    let style = scrollbarStyles.get(wc);
    if (!style) {
      style = { pending: Promise.resolve(), key: null };
      scrollbarStyles.set(wc, style);
    }
    style.pending = style.pending.then(async () => {
      if (disposed || wc.isDestroyed() || !scrollbarCSS) return;
      if (style.key) await wc.removeInsertedCSS(style.key);
      style.key = await wc.insertCSS(scrollbarCSS, { cssOrigin: 'user' });
    }).catch(failure => {
      if (!wc.isDestroyed()) console.error('Browser scrollbar styling failed:', failure?.name || 'Error');
    });
    return style.pending;
  }

  function updateTheme(preset) {
    const css = browserScrollbarCSS(preset);
    if (css === scrollbarCSS || disposed) return Promise.resolve();
    scrollbarCSS = css;
    return Promise.all([view?.webContents, auxiliary?.webContents]
      .filter(wc => wc && !wc.isDestroyed()).map(applyScrollbarStyle));
  }

  function listen(target, name, callback) {
    target.on(name, callback);
    listeners.push(() => target.removeListener(name, callback));
  }

  function state() {
    const wc = view?.webContents;
    const live = wc && !wc.isDestroyed();
    return {
      ok: true, revision: ++stateRevision, url: live && wc.getURL() !== 'about:blank' ? wc.getURL() : '',
      title: live ? wc.getTitle().slice(0, 512) : '', loading: Boolean(live && wc.isLoading()),
      canGoBack: Boolean(live && wc.navigationHistory.canGoBack()),
      canGoForward: Boolean(live && wc.navigationHistory.canGoForward()),
      captureGeneration: generation, captureActive, error,
      auxiliaryURL: auxiliary && !auxiliary.isDestroyed() ? auxiliary.webContents.getURL() : '',
      settings: normalizeBrowserSettings(getSettings()), defaultUserAgent
    };
  }

  function publish() {
    if (!disposed && !trusted.isDestroyed()) trusted.send('browser:state', state());
  }

  function cancelReservation() {
    if (reservation) clearTimeout(reservation.timer);
    reservation = null;
  }

  function muteCapture(reason = null) {
    if (view && !view.webContents.isDestroyed()) view.webContents.setAudioMuted(true);
    cancelReservation();
    captureActive = false;
    captureGranted = false;
    generation += 1;
    error = reason;
    publish();
    return state();
  }

  function closeAuxiliary() {
    const old = auxiliary;
    auxiliary = null;
    popupPending = false;
    if (old && !old.isDestroyed()) old.destroy();
  }

  function destroyView(reason = null) {
    viewRevision += 1;
    muteCapture(reason);
    closeAuxiliary();
    const old = view;
    view = null;
    htmlFullscreen = false;
    if (old) {
      if (!mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(old);
      if (!old.webContents.isDestroyed()) old.webContents.close({ waitForBeforeUnload: false });
    }
    publish();
  }

  function applyZoom(wc) {
    if (wc && !wc.isDestroyed() && Math.abs(wc.getZoomFactor() - presentation.zoomFactor) > 0.000001) {
      wc.setZoomFactor(presentation.zoomFactor);
    }
  }

  function applyPresentation() {
    if (!view || mainWindow.isDestroyed()) return;
    applyZoom(view.webContents);
    applyZoom(auxiliary?.webContents);
    const { width, height } = mainWindow.getContentBounds();
    const factor = trusted.getZoomFactor();
    const requested = presentation.bounds;
    const x = Math.max(0, Math.min(width, Math.round(requested.x * factor)));
    const y = Math.max(0, Math.min(height, Math.round(requested.y * factor)));
    const bounds = htmlFullscreen ? { x: 0, y: 0, width, height } : {
      x, y,
      width: Math.max(0, Math.min(width - x, Math.round(requested.width * factor))),
      height: Math.max(0, Math.min(height - y, Math.round(requested.height * factor)))
    };
    view.setBounds(bounds);
    view.setVisible(presentation.visible && bounds.width > 0 && bounds.height > 0);
  }

  function guardPage(wc, popup = false) {
    applyZoom(wc);
    wc.on('dom-ready', () => { void applyScrollbarStyle(wc); });
    const guardNavigation = (event, url) => {
      if (!validNavigationURL(event.url || url)) event.preventDefault();
    };
    wc.on('will-navigate', guardNavigation);
    wc.on('will-frame-navigate', guardNavigation);
    wc.on('will-redirect', guardNavigation);
    wc.setIgnoreMenuShortcuts(true);
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.on('certificate-error', (event, _url, _error, _certificate, callback) => {
      event.preventDefault();
      callback(false);
    });
    wc.on('before-input-event', (event, input) => {
      if (popup || input.type !== 'keyDown' || !presentation.visible || disposed || clearing) return;
      const action = browserShortcut(input, true);
      if (!action || (action === 'stop' && (!wc.isLoading() || htmlFullscreen))) return;
      event.preventDefault();
      if (action === 'address' || action === 'bookmarks') trusted.focus();
      trusted.send('browser:command', { action });
    });
    wc.on('context-menu', (_event, params) => showContextMenu(wc, params, popup));
    if (popup) {
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.setAudioMuted(true);
      return;
    }
    wc.on('enter-html-full-screen', () => { htmlFullscreen = true; applyPresentation(); });
    wc.on('leave-html-full-screen', () => { htmlFullscreen = false; applyPresentation(); });
    wc.setWindowOpenHandler(details => {
      if (disposed || clearing) return { action: 'deny' };
      const tab = ['foreground-tab', 'background-tab'].includes(details.disposition) && !details.postBody;
      if (tab && validNavigationURL(details.url)) {
        if (normalizeBrowserSettings(getSettings()).openTabsExternally) {
          void shell.openExternal(details.url).catch(failure => {
            console.error('Browser external link failed:', failure?.name || 'Error');
            error = 'loadFailed';
            publish();
          });
        } else void loadURL(details.url);
        return { action: 'deny' };
      }
      if (auxiliary || popupPending || (!validNavigationURL(details.url) && details.url !== 'about:blank')) {
        return { action: 'deny' };
      }
      popupPending = true;
      return {
        action: 'allow', overrideBrowserWindowOptions: {
          width: 700, height: 760, parent: mainWindow, autoHideMenuBar: true,
          webPreferences: remotePreferences()
        }
      };
    });
    wc.on('did-create-window', child => {
      popupPending = false;
      if (disposed || auxiliary || clearing) { child.destroy(); return; }
      auxiliary = child;
      child.setMenu(null);
      guardPage(child.webContents, true);
      const updateURL = () => {
        if (!child.isDestroyed()) child.setTitle(child.webContents.getURL());
        publish();
      };
      child.webContents.on('page-title-updated', event => { event.preventDefault(); updateURL(); });
      child.webContents.on('did-navigate', updateURL);
      child.webContents.on('did-navigate-in-page', updateURL);
      child.on('closed', () => { if (auxiliary === child) auxiliary = null; publish(); });
      updateURL();
    });
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      wc.on(event, publish);
    }
    wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (code !== -3 && isMainFrame) { error = 'loadFailed'; publish(); }
    });
    wc.on('render-process-gone', () => destroyView('captureEnded'));
    wc.on('destroyed', () => {
      if (view?.webContents === wc) { view = null; htmlFullscreen = false; muteCapture('captureEnded'); }
    });
  }

  function remotePreferences() {
    return {
      partition: PARTITION, nodeIntegration: false, nodeIntegrationInSubFrames: false,
      preload: path.join(__dirname, 'browser-fullscreen-preload.js'),
      zoomFactor: presentation.zoomFactor, zoomMode: 'isolated',
      contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, backgroundThrottling: false
    };
  }

  function ensureView() {
    if (view) return view;
    if (disposed || clearing) throw new Error('Browser unavailable');
    if (!partition) {
      partition = session.fromPartition(PARTITION);
      partition.setUserAgent(normalizeBrowserSettings(getSettings()).userAgent || defaultUserAgent);
      const permitted = (wc, permission, origin) => (permission === 'mediaKeySystem' || permission === 'fullscreen') &&
        (wc === view?.webContents || wc === auxiliary?.webContents) && validNavigationURL(origin) && new URL(origin).protocol === 'https:';
      partition.setPermissionCheckHandler((wc, permission, origin) => permitted(wc, permission, origin));
      partition.setPermissionRequestHandler((wc, permission, callback, details) => {
        callback(permitted(wc, permission, details.requestingUrl || wc?.getURL()));
      });
      partition.on('will-download', cancelDownload);
    }
    view = new WebContentsView({ webPreferences: remotePreferences() });
    view.webContents.setAudioMuted(true);
    guardPage(view.webContents);
    mainWindow.contentView.addChildView(view);
    applyPresentation();
    ready = view.webContents.loadURL('about:blank').catch(() => {});
    return view;
  }

  function cancelDownload(event) { event.preventDefault(); }

  function showContextMenu(wc, params, popup) {
    if (disposed || clearing || wc.isDestroyed() || (!popup && !presentation.visible)) return;
    const items = [];
    const item = (key, click, enabled = true) => ({ label: translate(key), enabled, click: () => {
      if (!disposed && !clearing && !wc.isDestroyed()) click();
    } });
    const command = (action, url) => trusted.send('browser:command', { action, url });
    if (!popup) {
      items.push(
        item('browser.back', () => command('back'), wc.navigationHistory.canGoBack()),
        item('browser.forward', () => command('forward'), wc.navigationHistory.canGoForward()),
        item('browser.reload', () => command('reload')),
        item('browser.home', () => command('home'))
      );
      if (validNavigationURL(params.linkURL)) {
        const url = params.linkURL;
        items.push({ type: 'separator' },
          item('browser.openLink', () => command('navigate', url)),
          item('browser.openLinkExternal', () => {
            void shell.openExternal(url).catch(failure => {
              console.error('Browser external link failed:', failure?.name || 'Error');
              error = 'loadFailed'; publish();
            });
          }),
          item('browser.copyLink', () => clipboard.writeText(url)));
      }
    }
    if (params.isEditable || params.selectionText) {
      if (items.length) items.push({ type: 'separator' });
      const actions = params.isEditable ? ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] : ['copy'];
      for (const action of actions) {
        const flag = `can${action[0].toUpperCase()}${action.slice(1)}`;
        items.push(item(`menu.edit.${action}`, () => { wc.focus(); wc[action](); }, params.editFlags?.[flag] === true));
      }
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: popup ? auxiliary : mainWindow });
  }

  async function prepareView() {
    const revision = viewRevision;
    if (components?.whenReady) {
      componentsReady ??= components.whenReady().catch(failure => {
        componentsReady = null;
        throw failure;
      });
      await componentsReady;
    }
    if (revision !== viewRevision) throw new Error('Browser initialization cancelled');
    const target = ensureView();
    await ready;
    return target;
  }

  async function loadURL(url) {
    let target;
    try { target = await prepareView(); }
    catch (failure) {
      console.error('Browser initialization failed:', failure);
      if (!disposed) { error = 'loadFailed'; publish(); }
      return { ok: false, error: 'loadFailed' };
    }
    if (disposed || view !== target || target.webContents.isDestroyed()) {
      return { ok: false, error: 'unavailable' };
    }
    const wc = target.webContents;
    error = null;
    try { await wc.loadURL(url); }
    catch (failure) {
      if (failure?.code !== 'ERR_ABORTED') { error = 'loadFailed'; publish(); }
    }
    return state();
  }

  function trustedEvent(event) {
    return !disposed && !trusted.isDestroyed() && event.sender === trusted &&
      event.senderFrame === trusted.mainFrame;
  }

  function prepareCapture() {
    muteCapture();
    if (!components?.whenReady) ensureView();
    const token = { generation, frame: trusted.mainFrame, consumed: false,
      allowWithoutGesture: allowStartupCapture === true, expires: Date.now() + CAPTURE_TIMEOUT_MS };
    allowStartupCapture = false;
    token.timer = setTimeout(() => {
      if (reservation === token) muteCapture('captureFailed');
    }, CAPTURE_TIMEOUT_MS);
    token.timer.unref?.();
    reservation = token;
    return { ok: true, generation };
  }

  captureSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const token = reservation;
    if (!token || token.consumed || (!request.userGesture && !token.allowWithoutGesture) || !request.videoRequested || !request.audioRequested ||
      request.frame !== trusted.mainFrame || request.frame !== token.frame || token.expires < Date.now()) {
      callback({}); return;
    }
    token.consumed = true;
    try { await prepareView(); }
    catch (failure) {
      console.error('Browser capture initialization failed:', failure);
      if (reservation === token) muteCapture('captureFailed');
      callback({}); return;
    }
    if (disposed || reservation !== token || !view || view.webContents.isDestroyed() || request.frame !== trusted.mainFrame) {
      callback({}); return;
    }
    captureGranted = true;
    callback({ video: view.webContents.mainFrame, audio: view.webContents.mainFrame, enableLocalEcho: false });
  }, { useSystemPicker: false });

  const syncPrepare = event => {
    if (!trustedEvent(event)) { event.returnValue = { ok: false, error: 'unavailable' }; return; }
    try { event.returnValue = prepareCapture(); }
    catch { event.returnValue = { ok: false, error: 'captureFailed' }; }
  };
  ipcMain.on('browser:prepare-capture', syncPrepare);

  function handle(name, action) {
    const channel = `browser:${name}`;
    channels.push(channel);
    ipcMain.handle(channel, async (event, value) => {
      if (!trustedEvent(event) || clearing) return { ok: false, error: 'unavailable' };
      try { return await action(value); }
      catch (failure) {
        console.error('Browser operation failed:', name, failure?.name || 'Error');
        return { ok: false, error: 'operationFailed' };
      }
    });
  }
  handle('get-state', state);
  handle('navigate', value => {
    const url = normalizeBrowserURL(value);
    return url ? loadURL(url) : { ok: false, error: 'invalidURL' };
  });
  for (const [name, method] of [['back', 'goBack'], ['forward', 'goForward']]) {
    handle(name, () => {
      const history = view?.webContents.navigationHistory;
      if (history?.[name === 'back' ? 'canGoBack' : 'canGoForward']()) history[method]();
      return state();
    });
  }
  handle('reload', () => { view?.webContents.reload(); error = null; return state(); });
  handle('stop', () => { view?.webContents.stop(); return state(); });
  handle('open-external', async () => {
    const url = view?.webContents.getURL();
    if (!validNavigationURL(url)) return { ok: false, error: 'invalidURL' };
    await shell.openExternal(url);
    return state();
  });
  handle('set-presentation', value => {
    const bounds = value?.bounds;
    const zoomFactor = value?.zoomFactor === undefined ? 1 : value.zoomFactor;
    if (typeof value?.visible !== 'boolean' || !bounds ||
      !Number.isFinite(zoomFactor) || zoomFactor < 0.3 || zoomFactor > 3 ||
      !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= 100000)) {
      return { ok: false, error: 'invalidRequest' };
    }
    presentation = { visible: value.visible, zoomFactor, bounds };
    applyPresentation();
    return state();
  });
  handle('set-capture-state', value => {
    if (!Number.isSafeInteger(value?.generation) || typeof value.active !== 'boolean') {
      return { ok: false, error: 'captureExpired' };
    }
    if (!value.active && value.generation < generation) return state();
    if (value.generation !== generation) return { ok: false, error: 'captureExpired' };
    if (!value.active) return muteCapture();
    if (!captureGranted || !view || view.webContents.isDestroyed()) return { ok: false, error: 'captureExpired' };
    cancelReservation();
    captureActive = true;
    error = null;
    view.webContents.setAudioMuted(false);
    publish();
    return state();
  });
  handle('save-settings', value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ('bookmarks' in value && (!Array.isArray(value.bookmarks) || value.bookmarks.length > 100 ||
        value.bookmarks.some(item => typeof item?.name !== 'string' || item.name.length > 120 ||
          typeof item.url !== 'string' || item.url.length > 8192))) ||
      ('startPage' in value && (typeof value.startPage !== 'string' || value.startPage.length > 8192)) ||
      ('userAgent' in value && !validUserAgent(value.userAgent)) ||
      ('openTabsExternally' in value && typeof value.openTabsExternally !== 'boolean')) return { ok: false, error: 'invalidRequest' };
    if ('urlRules' in value) {
      try { validateRules(value.urlRules); } catch { return { ok: false, error: 'invalidRules' }; }
    }
    if (value.startPage?.trim() && !normalizeBrowserURL(value.startPage)) return { ok: false, error: 'invalidURL' };
    const previous = normalizeBrowserSettings(getSettings());
    const settings = normalizeBrowserSettings({ ...previous, ...value });
    if (settings.userAgent === defaultUserAgent) settings.userAgent = '';
    if (saveSettings(settings) !== true) return { ok: false, error: 'saveFailed' };
    if (settings.userAgent !== previous.userAgent) {
      const userAgent = settings.userAgent || defaultUserAgent;
      partition?.setUserAgent(userAgent);
      for (const wc of [view?.webContents, auxiliary?.webContents]) {
        if (wc && !wc.isDestroyed()) wc.setUserAgent(userAgent);
      }
    }
    publish();
    return state();
  });
  handle('clear-site-data', async () => {
    clearing = true;
    try {
      destroyView();
      const target = partition || session.fromPartition(PARTITION);
      await target.clearStorageData();
      await target.clearCache();
      await target.clearAuthCache();
      await target.closeAllConnections();
      return state();
    } finally { clearing = false; publish(); }
  });
  listen(trusted, 'did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { presentation.visible = false; destroyView(); }
  });
  listen(trusted, 'render-process-gone', () => destroyView('captureEnded'));
  listen(mainWindow, 'resize', applyPresentation);
  listen(trusted, 'zoom-changed', applyPresentation);

  function dispose() {
    if (disposed) return;
    destroyView();
    disposed = true;
    for (const remove of listeners) remove();
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.removeListener('browser:prepare-capture', syncPrepare);
    captureSession.setDisplayMediaRequestHandler(null);
    if (partition) partition.removeListener('will-download', cancelDownload);
  }
  listen(mainWindow, 'closed', dispose);
  return { dispose, getState: state, updateTheme };
}

module.exports = { createBrowserController, normalizeBrowserURL, normalizeBrowserSettings, PARTITION };
