const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createBrowserController, normalizeBrowserURL, normalizeBrowserSettings, PARTITION } = require('../../electron/browser-controller.cjs');
const RUNTIME_USER_AGENT = 'Mozilla/5.0 EffeTune/2.15.0 Chrome/152.0.0.0 Electron/44.5.1 Safari/537.36';
const DEFAULT_USER_AGENT = RUNTIME_USER_AGENT.replace(/\sElectron\/\S+/g, '');

function harness(t, { deferInitialLoad = false, allowStartupCapture = false, components, themePreset, settings: initialSettings, saveFailure = false, runtimeUserAgent = RUNTIME_USER_AGENT } = {}) {
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (name, fn) => handlers.set(name, fn);
  ipc.removeHandler = name => handlers.delete(name);
  const mediaSession = { setDisplayMediaRequestHandler(fn) { this.handler = fn; } };
  const partition = new EventEmitter();
  Object.assign(partition, {
    setUserAgent(value) { this.userAgent = value; },
    setPermissionCheckHandler(fn) { this.check = fn; },
    setPermissionRequestHandler(fn) { this.request = fn; },
    clearStorageData: async () => { partition.cleared = true; },
    clearCache: async () => {}, clearAuthCache: async () => {}, closeAllConnections: async () => {}
  });
  function contents() {
    const wc = new EventEmitter();
    Object.assign(wc, {
      mainFrame: {}, session: mediaSession, url: '', muted: false, destroyed: false,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      getZoomFactor: () => wc.zoomFactor ?? 1.5, getURL: () => wc.url, getTitle: () => 'Page',
      setZoomFactor(value) { wc.zoomFactor = value; },
      getUserAgent: () => wc.userAgent || runtimeUserAgent,
      isLoading: () => false, isDestroyed: () => wc.destroyed,
      send() {}, focus() {}, setIgnoreMenuShortcuts() {},
      setUserAgent(value) { wc.userAgent = value; },
      setAudioMuted(value) { wc.muted = value; },
      setWindowOpenHandler(fn) { wc.open = fn; },
      loads: [], styles: new Map(), nextStyle: 0,
      async insertCSS(css, options) {
        const key = String(++wc.nextStyle);
        wc.styles.set(key, { css, options });
        return key;
      },
      async removeInsertedCSS(key) { wc.styles.delete(key); },
      async loadURL(url) {
        wc.loads.push(url);
        if (deferInitialLoad && url === 'about:blank') {
          await new Promise(resolve => { wc.completeInitialLoad = resolve; });
        }
        wc.url = url;
        wc.emit('did-navigate', {}, url);
      },
      close() { wc.destroyed = true; wc.emit('destroyed'); }
    });
    return wc;
  }
  const trusted = contents();
  Object.defineProperty(trusted, 'session', {
    get() {
      if (trusted.destroyed) throw new TypeError('Object has been destroyed');
      return mediaSession;
    }
  });
  const mainWindow = new EventEmitter();
  const views = [];
  const externalURLs = [];
  const menus = [];
  const copied = [];
  Object.assign(mainWindow, {
    webContents: trusted, isDestroyed: () => false,
    getContentBounds: () => ({ width: 1000, height: 800 }),
    contentView: { addChildView() {}, removeChildView() {} }
  });
  let settings = initialSettings || { bookmarks: [], startPage: '' };
  const controller = createBrowserController({
    mainWindow, ipcMain: ipc, allowStartupCapture, components, themePreset,
    translate: key => key,
    clipboard: { writeText: text => copied.push(text) },
    Menu: { buildFromTemplate(items) { return { popup: options => menus.push({ items, options }) }; } },
    shell: { async openExternal(url) { externalURLs.push(url); } },
    session: { fromPartition(name) { assert.equal(name, PARTITION); return partition; } },
    WebContentsView: class {
      constructor(options) {
        this.options = options; this.webContents = contents();
        this.webContents.userAgent = partition.userAgent;
        this.webContents.zoomFactor = options.webPreferences.zoomFactor;
        views.push(this);
      }
      setBounds(value) { this.bounds = value; }
      setVisible(value) { this.visible = value; }
    },
    getSettings: () => settings,
    saveSettings(value) { if (saveFailure) return false; settings = value; return true; }
  });
  t.after(() => controller.dispose());
  const event = () => ({ sender: trusted, senderFrame: trusted.mainFrame });
  const invoke = (name, value, sender = event()) => handlers.get(`browser:${name}`)(sender, value);
  const prepare = () => {
    const e = event(); ipc.emit('browser:prepare-capture', e); return e.returnValue;
  };
  const capture = async (changes = {}) => {
    let streams;
    await mediaSession.handler({ frame: trusted.mainFrame, userGesture: true, videoRequested: true, audioRequested: true, ...changes }, value => { streams = value; });
    return streams;
  };
  return { controller, ipc, handlers, trusted, mainWindow, views, partition, mediaSession, invoke, prepare, capture, contents, externalURLs, menus, copied };
}

test('browser page shortcuts are scoped to visible pages and leave unrelated app keys alone', async t => {
  const h = harness(t);
  await h.invoke('navigate', 'https://example.com/');
  const wc = h.views[0].webContents;
  const sent = [];
  h.trusted.send = (channel, value) => { if (channel === 'browser:command') sent.push(value); };
  const press = input => {
    let prevented = false;
    wc.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', ...input });
    return prevented;
  };
  assert.equal(press({ key: 'F5' }), false);
  await h.invoke('set-presentation', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
  assert.equal(press({ key: 'r', control: true }), true);
  assert.deepEqual(sent.pop(), { action: 'reload' });
  assert.equal(press({ key: 'l', meta: true }), true);
  assert.deepEqual(sent.pop(), { action: 'address' });
  assert.equal(press({ key: 'F5', type: 'keyUp' }), false);
  for (const key of ['s', 'o', 'e', 'c', 'v', 'z', '0']) assert.equal(press({ key, control: true }), false);
  assert.equal(press({ key: 'Escape' }), false);
  wc.isLoading = () => true;
  assert.equal(press({ key: 'Escape' }), true);
  assert.deepEqual(sent.pop(), { action: 'stop' });
  wc.emit('enter-html-full-screen');
  assert.equal(press({ key: 'Escape' }), false);
});

test('browser context menus validate links and edit the browser page without invoking pipeline commands', async t => {
  const h = harness(t);
  await h.invoke('navigate', 'https://example.com/');
  await h.invoke('set-presentation', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
  const wc = h.views[0].webContents;
  const sent = [];
  h.trusted.send = (channel, value) => { if (channel === 'browser:command') sent.push(value); };
  const linkURL = 'https://example.com/music';
  wc.emit('context-menu', {}, { linkURL, isEditable: true, editFlags: { canCopy: true, canPaste: true } });
  const menu = h.menus.at(-1);
  assert.equal(menu.options.window, h.mainWindow);
  const item = label => menu.items.find(entry => entry.label === label);
  assert.equal(item('browser.back').enabled, false);
  item('browser.openLink').click();
  assert.deepEqual(sent.pop(), { action: 'navigate', url: linkURL });
  item('browser.openLinkExternal').click();
  assert.deepEqual(h.externalURLs, [linkURL]);
  item('browser.copyLink').click();
  assert.deepEqual(h.copied, [linkURL]);
  let copies = 0;
  wc.copy = () => { copies++; };
  item('menu.edit.copy').click();
  assert.equal(copies, 1);
  assert.equal(item('menu.edit.cut').enabled, false);
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:password@example.com']) {
    wc.emit('context-menu', {}, { linkURL: url });
    assert.equal(h.menus.at(-1).items.some(entry => entry.label === 'browser.openLinkExternal'), false);
  }
  wc.destroyed = true;
  item('menu.edit.copy').click();
  assert.equal(copies, 1);
});

test('Browser scrollbars follow theme changes and navigation with overridable, replaced styles', async t => {
  const { THEME_PRESETS } = await import('../../js/theme-registry.mjs');
  const h = harness(t, { themePreset: THEME_PRESETS[0] });
  await h.invoke('navigate', 'https://example.com/');
  const wc = h.views[0].webContents;
  wc.emit('dom-ready');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wc.styles.size, 1);
  assert.ok([...wc.styles.values()][0].css.includes(THEME_PRESETS[0].windowBackground));
  const child = new EventEmitter();
  child.webContents = h.contents();
  child.isDestroyed = () => false;
  child.destroy = () => {};
  child.setMenu = child.setTitle = () => {};
  wc.emit('did-create-window', child);
  for (const preset of THEME_PRESETS.slice(1)) {
    await h.controller.updateTheme(preset);
    for (const page of [wc, child.webContents]) {
      assert.equal(page.styles.size, 1);
      const { css, options } = [...page.styles.values()][0];
      assert.ok(css.includes(preset.windowBackground));
      assert.ok(css.includes(preset.windowForeground));
      assert.equal(options.cssOrigin, 'user');
      assert.doesNotMatch(css, /!important/);
    }
  }
  await Promise.all(THEME_PRESETS.map(preset => h.controller.updateTheme(preset)));
  wc.styles.clear();
  wc.emit('dom-ready');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wc.styles.size, 1);
  assert.ok([...wc.styles.values()][0].css.includes(THEME_PRESETS.at(-1).windowBackground));
  assert.deepEqual(wc.loads, ['about:blank', 'https://example.com/']);
});

test('Browser accepts HTTP and HTTPS addresses and validates stored bookmarks', () => {
  assert.equal(normalizeBrowserURL('example.com/music'), 'https://example.com/music');
  assert.equal(normalizeBrowserURL('http://example.com/music'), 'http://example.com/music');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'spotify:track:x', 'https://name:secret@example.com', 'http://name:secret@example.com']) {
    assert.equal(normalizeBrowserURL(url), null);
  }
  assert.deepEqual(normalizeBrowserSettings({ bookmarks: [{ name: ' Music ', url: 'example.com' }, { name: 'bad', url: 'file:///x' }], startPage: 'javascript:x' }), {
    bookmarks: [{ name: 'Music', url: 'https://example.com/' }], startPage: '', userAgent: '', openTabsExternally: true, urlRules: []
  });
  assert.equal(normalizeBrowserSettings(undefined).startPage, '');
});

test('Browser command responses and notifications share increasing snapshot revisions', async t => {
  const h = harness(t);
  const snapshots = [h.controller.getState()];
  h.trusted.send = (channel, value) => {
    if (channel === 'browser:state') snapshots.push(value);
  };
  const response = await h.invoke('navigate', 'https://example.com/music');
  assert.ok(snapshots.length > 1, 'navigation must publish state notifications');
  snapshots.push(response, h.controller.getState());
  for (let index = 0; index < snapshots.length; index++) {
    assert.ok(Number.isSafeInteger(snapshots[index].revision));
    if (index > 0) assert.ok(snapshots[index].revision > snapshots[index - 1].revision);
  }
});

test('HTTP navigation, redirects, saved pages and external links share the Web URL policy while protected permissions remain HTTPS-only', async t => {
  const h = harness(t);
  const url = 'http://example.com/music';
  assert.equal((await h.invoke('navigate', url)).url, url);
  const wc = h.views[0].webContents;
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    let prevented = false;
    wc.emit(name, { url, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
  }
  assert.equal(wc.open({ url, disposition: 'foreground-tab' }).action, 'deny');
  await h.invoke('open-external');
  assert.deepEqual(h.externalURLs, [url, url]);
  const settings = (await h.invoke('save-settings', { startPage: url, bookmarks: [{ name: 'HTTP music', url }] })).settings;
  assert.equal(settings.startPage, url);
  assert.deepEqual(settings.bookmarks, [{ name: 'HTTP music', url }]);
  for (const permission of ['mediaKeySystem', 'fullscreen', 'openExternal']) {
    assert.equal(h.partition.check(wc, permission, url), false);
    let granted;
    h.partition.request(wc, permission, value => { granted = value; }, { requestingUrl: url });
    assert.equal(granted, false);
  }
});

test('Browser User-Agent is saved independently and updates owned pages without reloading or releasing capture', async t => {
  const h = harness(t);
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  const wc = h.views[0].webContents;
  assert.equal(wc.userAgent, DEFAULT_USER_AGENT);
  assert.equal(h.partition.userAgent, DEFAULT_USER_AGENT);
  const child = new EventEmitter();
  child.webContents = h.contents();
  child.isDestroyed = () => false;
  child.destroy = () => {};
  child.setMenu = child.setTitle = () => {};
  wc.emit('did-create-window', child);
  const settings = { bookmarks: [{ name: 'Music', url: 'https://example.com/' }], startPage: 'https://example.com/' };
  await h.invoke('save-settings', settings);
  const saved = await h.invoke('save-settings', { userAgent: ' Desktop Browser/1.0 ' });
  assert.deepEqual(saved.settings, { ...settings, userAgent: 'Desktop Browser/1.0', openTabsExternally: true, urlRules: [] });
  assert.equal(h.partition.userAgent, 'Desktop Browser/1.0');
  assert.equal(wc.userAgent, 'Desktop Browser/1.0');
  assert.equal(child.webContents.userAgent, 'Desktop Browser/1.0');
  assert.equal(saved.captureActive, true);
  assert.equal(saved.captureGeneration, token.generation);
  assert.deepEqual(wc.loads, ['about:blank']);
  assert.equal(wc.muted, false);
  await h.invoke('save-settings', { bookmarks: [] });
  assert.equal(h.controller.getState().settings.userAgent, 'Desktop Browser/1.0');
  assert.equal((await h.invoke('save-settings', { userAgent: '  ' })).settings.userAgent, '');
  assert.equal(wc.userAgent, DEFAULT_USER_AGENT);
});

test('Browser validates User-Agent before saving and preserves runtime state on save failure', async t => {
  const h = harness(t, { settings: { userAgent: 'Saved Browser' }, saveFailure: true });
  h.prepare();
  assert.equal(h.views[0].webContents.userAgent, 'Saved Browser');
  for (const userAgent of ['bad\r\nHeader: value', 'bad\0value', 'bad\tvalue', '\u65e5', 'x'.repeat(1025), 42]) {
    assert.deepEqual(await h.invoke('save-settings', { userAgent }), { ok: false, error: 'invalidRequest' });
    assert.equal(normalizeBrowserSettings({ userAgent }).userAgent, '');
  }
  assert.deepEqual(await h.invoke('save-settings', { userAgent: 'New Browser' }), { ok: false, error: 'saveFailed' });
  assert.equal(h.partition.userAgent, 'Saved Browser');
  assert.equal(h.views[0].webContents.userAgent, 'Saved Browser');
});

test('Automatic Browser User-Agent follows the runtime and old EffeTune defaults remain automatic', async t => {
  for (const userAgent of [undefined, '', 'EffeTune']) {
    const runtimeUserAgent = RUNTIME_USER_AGENT.replace('152.0.0.0', '153.0.0.0');
    const h = harness(t, { runtimeUserAgent, settings: { userAgent } });
    h.prepare();
    const expected = runtimeUserAgent.replace(/\sElectron\/\S+/g, '');
    assert.equal(h.views[0].webContents.userAgent, expected);
    assert.equal(h.controller.getState().defaultUserAgent, expected);
    assert.equal(h.controller.getState().settings.userAgent, '');
    assert.equal((await h.invoke('save-settings', { userAgent: expected })).settings.userAgent, '');
  }
  const { name, version } = require('../../package.json');
  const h = harness(t, { runtimeUserAgent: 'Mozilla/5.0 Chrome/153.0.0.0 Electron/45.0.0 Safari/537.36' });
  h.prepare();
  assert.equal(h.views[0].webContents.userAgent, `Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36 ${name}/${version}`);
});

test('ECS component readiness delays only Browser navigation and is reused', async t => {
  let complete;
  let calls = 0;
  const components = { whenReady() { calls += 1; return new Promise(resolve => { complete = resolve; }); } };
  const h = harness(t, { components });
  const navigation = h.invoke('navigate', 'https://example.com/music');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(h.views.length, 0);
  assert.equal(h.prepare().ok, true);
  const capture = h.capture();
  complete();
  assert.equal((await navigation).url, 'https://example.com/music');
  assert.equal((await capture).audio, h.views[0].webContents.mainFrame);
  await h.invoke('navigate', 'https://example.com/next');
  assert.equal(calls, 1);
});

test('ECS component failure uses the Browser load error and permits a retry', async t => {
  let calls = 0;
  const components = { async whenReady() { if (++calls === 1) throw new Error('Component download failed'); } };
  const h = harness(t, { components });
  t.mock.method(console, 'error', () => {});
  assert.deepEqual(await h.invoke('navigate', 'https://example.com/'), { ok: false, error: 'loadFailed' });
  assert.equal(h.controller.getState().error, 'loadFailed');
  assert.equal(h.views.length, 0);
  assert.equal((await h.invoke('navigate', 'https://example.com/')).url, 'https://example.com/');
  assert.equal(calls, 2);
});

test('A Browser closed while ECS components initialize cannot navigate afterward', async t => {
  let complete;
  const h = harness(t, { components: { whenReady: () => new Promise(resolve => { complete = resolve; }) } });
  t.mock.method(console, 'error', () => {});
  const navigation = h.invoke('navigate', 'https://example.com/');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.views.length, 0);
  h.controller.dispose();
  complete();
  assert.equal((await navigation).ok, false);
  assert.equal(h.views.length, 0);
});

test('Capture released while ECS components initialize cannot be granted afterward', async t => {
  let complete;
  const h = harness(t, { components: { whenReady: () => new Promise(resolve => { complete = resolve; }) } });
  const token = h.prepare();
  const capture = h.capture();
  assert.equal(h.views.length, 0);
  await h.invoke('set-capture-state', { ...token, active: false });
  complete();
  assert.deepEqual(await capture, {});
  assert.equal(h.controller.getState().captureActive, false);
  assert.equal(h.views[0].webContents.muted, true);
});

test('Clearing site data cancels navigation waiting for ECS components', async t => {
  let complete;
  const h = harness(t, { components: { whenReady: () => new Promise(resolve => { complete = resolve; }) } });
  t.mock.method(console, 'error', () => {});
  const navigation = h.invoke('navigate', 'https://example.com/');
  await h.invoke('clear-site-data');
  complete();
  assert.equal((await navigation).ok, false);
  assert.equal(h.views.length, 0);
});

test('Window closure disposes Browser resources after the trusted WebContents is destroyed', async t => {
  const h = harness(t);
  const token = h.prepare();
  await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  h.trusted.close();
  assert.throws(() => h.trusted.session, /Object has been destroyed/);
  assert.doesNotThrow(() => h.mainWindow.emit('closed'));
  assert.equal(h.mediaSession.handler, null);
  assert.equal(h.views[0].webContents.muted, true);
  assert.equal(h.views[0].webContents.destroyed, true);
  assert.equal(h.handlers.size, 0);
  assert.equal(h.ipc.listenerCount('browser:prepare-capture'), 0);
  assert.equal(h.partition.listenerCount('will-download'), 0);
  assert.deepEqual(h.trusted.eventNames(), []);
  assert.deepEqual(h.mainWindow.eventNames(), []);
  assert.doesNotThrow(() => h.controller.dispose());
});

test('Browser lazily isolates remote pages and rejects foreign/subframe IPC and capture', async t => {
  const h = harness(t);
  assert.equal(h.views.length, 0);
  assert.equal((await h.invoke('navigate', 'example.com', { sender: {}, senderFrame: h.trusted.mainFrame })).ok, false);
  assert.equal((await h.invoke('navigate', 'example.com', { sender: h.trusted, senderFrame: {} })).ok, false);
  h.prepare();
  const wc = h.views[0].webContents;
  assert.equal(wc.muted, true);
  assert.equal(h.views[0].options.webPreferences.preload,
    require('node:path').resolve(__dirname, '../../electron/browser-fullscreen-preload.js'));
  assert.equal(h.views[0].options.webPreferences.contextIsolation, true);
  assert.equal(h.views[0].options.webPreferences.nodeIntegration, false);
  assert.equal(h.views[0].options.webPreferences.sandbox, true);
  for (const permission of ['media', 'microphone', 'display-capture', 'notifications', 'midi', 'geolocation', 'local-network', 'fileSystem']) {
    assert.equal(h.partition.check(wc, permission, 'https://example.com'), false);
  }
  assert.equal(h.partition.check(wc, 'mediaKeySystem', 'https://example.com'), true);
  assert.deepEqual(await h.capture({ frame: {} }), {});
  assert.deepEqual(await h.capture({ userGesture: false }), {});
  const streams = await h.capture();
  assert.equal(streams.audio, wc.mainFrame);
  assert.equal(streams.video, wc.mainFrame);
  assert.equal(streams.enableLocalEcho, false);
  assert.deepEqual(await h.capture(), {});
});

test('Capture commits only its generation, mutes on release, and stale cleanup cannot mute a new input', async t => {
  const h = harness(t);
  const first = h.prepare();
  await h.capture();
  assert.equal((await h.invoke('set-capture-state', { ...first, active: true })).captureActive, true);
  assert.equal(h.views[0].webContents.muted, false);
  await h.invoke('set-capture-state', { ...first, active: false });
  assert.equal(h.views[0].webContents.muted, true);
  const next = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...next, active: true });
  assert.equal((await h.invoke('set-capture-state', { ...first, active: true })).ok, false);
  assert.equal((await h.invoke('set-capture-state', { ...first, active: false })).ok, true);
  assert.equal(h.views[0].webContents.muted, false);
  h.trusted.emit('did-start-navigation', {}, 'file:///effetune.html', false, true);
  assert.equal(h.views[0].webContents.muted, true);
  assert.equal(h.views[0].webContents.destroyed, true);
});

test('Browser permits fullscreen only for owned HTTPS pages and rejects automatic fullscreen', async t => {
  const h = harness(t);
  await h.invoke('navigate', 'https://www.youtube.com/');
  const wc = h.views[0].webContents;
  for (const [contents, permission, origin, expected] of [
    [wc, 'fullscreen', 'https://www.youtube.com/', true],
    [wc, 'automatic-fullscreen', 'https://www.youtube.com/', false],
    [wc, 'fullscreen', 'file:///private', false],
    [h.trusted, 'fullscreen', 'https://www.youtube.com/', false]
  ]) {
    assert.equal(h.partition.check(contents, permission, origin), expected);
    let granted;
    h.partition.request(contents, permission, value => { granted = value; }, { requestingUrl: origin });
    assert.equal(granted, expected);
  }
});

test('Browser zoom follows presentation for initial, existing and auxiliary pages without rescaling bounds or capture', async t => {
  const h = harness(t);
  const bounds = { x: 0, y: 100, width: 600, height: 400 };
  await h.invoke('set-presentation', { visible: true, bounds, zoomFactor: 1.2 });
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  const view = h.views[0];
  assert.equal(view.options.webPreferences.zoomMode, 'isolated');
  assert.equal(view.webContents.getZoomFactor(), 1.2);
  assert.deepEqual(view.bounds, { x: 0, y: 150, width: 900, height: 600 });
  const child = new EventEmitter();
  child.webContents = h.contents(); child.isDestroyed = () => false;
  child.setMenu = child.setTitle = child.destroy = () => {};
  assert.equal(view.webContents.open({ url: 'https://example.com/login', disposition: 'new-window' })
    .overrideBrowserWindowOptions.webPreferences.zoomMode, 'isolated');
  view.webContents.emit('did-create-window', child);
  assert.equal(child.webContents.getZoomFactor(), 1.2);
  await h.invoke('set-presentation', { visible: false, bounds, zoomFactor: 1.8 });
  assert.equal(view.webContents.getZoomFactor(), 1.8);
  assert.equal(child.webContents.getZoomFactor(), 1.8);
  assert.deepEqual(view.bounds, { x: 0, y: 150, width: 900, height: 600 });
  assert.equal(h.controller.getState().captureActive, true);
  assert.equal(h.controller.getState().captureGeneration, token.generation);
  assert.equal(view.webContents.muted, false);
  for (const zoomFactor of [0, 4, NaN]) {
    assert.deepEqual(await h.invoke('set-presentation', { visible: true, bounds, zoomFactor }), { ok: false, error: 'invalidRequest' });
  }
});

test('HTML fullscreen fills the window, follows resize, and restores Browser bounds without releasing capture', async t => {
  const h = harness(t);
  const token = h.prepare();
  await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  const view = h.views[0];
  const bounds = { x: 0, y: 100, width: 600, height: 400 };
  await h.invoke('set-presentation', { visible: true, bounds });
  view.webContents.emit('enter-html-full-screen');
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1000, height: 800 });
  h.mainWindow.getContentBounds = () => ({ width: 1200, height: 900 });
  h.mainWindow.emit('resize');
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1200, height: 900 });
  const updatedBounds = { ...bounds, y: 120, width: 700 };
  await h.invoke('set-presentation', { visible: false, bounds: updatedBounds });
  assert.equal(view.visible, false);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1200, height: 900 });
  await h.invoke('set-presentation', { visible: true, bounds: updatedBounds });
  view.webContents.emit('leave-html-full-screen');
  assert.equal(view.visible, true);
  assert.deepEqual(view.bounds, { x: 0, y: 180, width: 1050, height: 600 });
  assert.equal(h.controller.getState().captureActive, true);
  assert.equal(h.controller.getState().captureGeneration, token.generation);
  assert.equal(view.webContents.muted, false);

  view.webContents.emit('enter-html-full-screen');
  await h.invoke('clear-site-data');
  await h.invoke('navigate', 'https://example.com/');
  assert.deepEqual(h.views[1].bounds, { x: 0, y: 180, width: 1050, height: 600 });
});

test('Navigation, external tabs, popups and downloads share the remote boundary', async t => {
  const h = harness(t); h.prepare();
  const wc = h.views[0].webContents;
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    let prevented = false;
    wc.emit(name, { url: 'file:///private', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  for (const disposition of ['foreground-tab', 'background-tab']) {
    assert.equal(wc.open({ url: 'https://example.com', disposition }).action, 'deny');
  }
  assert.deepEqual(h.externalURLs, ['https://example.com', 'https://example.com']);
  assert.deepEqual(wc.loads, ['about:blank']);
  for (const url of ['file:///private', 'javascript:alert(1)', 'data:text/html,x', 'spotify:track:x']) {
    assert.equal(wc.open({ url, disposition: 'foreground-tab' }).action, 'deny');
  }
  assert.equal(h.externalURLs.length, 2);
  const result = wc.open({ url: 'https://login.example.com', disposition: 'new-window', postBody: { data: [] } });
  assert.equal(result.action, 'allow');
  assert.equal(result.overrideBrowserWindowOptions.webPreferences.partition, PARTITION);
  assert.equal(wc.open({ url: 'https://other.example.com', disposition: 'new-window' }).action, 'deny');
  let downloadBlocked = false;
  h.partition.emit('will-download', { preventDefault() { downloadBlocked = true; } });
  assert.equal(downloadBlocked, true);
});

test('Disabling external tabs keeps GET tab navigation in the captured Browser and preserves login windows', async t => {
  for (const disposition of ['foreground-tab', 'background-tab', 'new-window']) {
    const h = harness(t);
    const saved = await h.invoke('save-settings', { openTabsExternally: false });
    assert.equal(saved.settings.openTabsExternally, false);
    await h.invoke('save-settings', { userAgent: 'Custom Browser', bookmarks: [] });
    assert.equal(h.controller.getState().settings.openTabsExternally, false);
    const token = h.prepare(); await h.capture();
    await h.invoke('set-capture-state', { ...token, active: true });
    const result = h.views[0].webContents.open({ url: 'https://example.com/', disposition });
    if (disposition === 'new-window') {
      assert.equal(result.action, 'allow');
      assert.equal(result.overrideBrowserWindowOptions.webPreferences.partition, PARTITION);
    } else {
      assert.equal(result.action, 'deny');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.views.length, 1);
      assert.equal(h.views[0].webContents.url, 'https://example.com/');
      assert.equal(h.controller.getState().captureActive, true);
      assert.equal(h.controller.getState().captureGeneration, token.generation);
      assert.equal(h.views[0].webContents.muted, false);
    }
    assert.deepEqual(h.externalURLs, []);
    assert.deepEqual(await h.invoke('save-settings', { openTabsExternally: 'false' }), { ok: false, error: 'invalidRequest' });
  }
  for (const openTabsExternally of [true, false]) {
    for (const details of [
      { url: 'about:blank', disposition: 'foreground-tab' },
      { url: 'https://example.com/post', disposition: 'foreground-tab', postBody: { data: [] } }
    ]) {
      const h = harness(t, { settings: { openTabsExternally } }); h.prepare();
      assert.equal(h.views[0].webContents.open(details).action, 'allow');
      assert.deepEqual(h.externalURLs, []);
    }
  }
});

test('Start page edits and reset persist independently without navigating the current page', async t => {
  const h = harness(t);
  assert.equal(h.controller.getState().settings.startPage, '');
  await h.invoke('navigate', 'https://example.com/current');
  const saved = await h.invoke('save-settings', { startPage: ' example.com/start ' });
  assert.equal(saved.settings.startPage, 'https://example.com/start');
  for (const startPage of ['javascript:alert(1)', 'file:///private']) {
    assert.deepEqual(await h.invoke('save-settings', { startPage }), { ok: false, error: 'invalidURL' });
  }
  assert.equal(h.controller.getState().settings.startPage, 'https://example.com/start');
  const reset = await h.invoke('save-settings', { startPage: '' });
  assert.equal(reset.settings.startPage, '');
  assert.equal(reset.settings.userAgent, '');
  assert.equal(reset.settings.openTabsExternally, true);
  assert.equal(reset.url, 'https://example.com/current');
  assert.deepEqual(h.views[0].webContents.loads, ['about:blank', 'https://example.com/current']);
});

test('Presentation scales and clamps without releasing capture; clearing data retains bookmarks', async t => {
  const h = harness(t); const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  await h.invoke('set-presentation', { visible: true, bounds: { x: 10, y: 100, width: 900, height: 900 } });
  assert.deepEqual(h.views[0].bounds, { x: 15, y: 150, width: 985, height: 650 });
  await h.invoke('set-presentation', { visible: false, bounds: { x: 0, y: 0, width: 10, height: 10 } });
  assert.equal(h.controller.getState().captureActive, true);
  await h.invoke('save-settings', { bookmarks: [{ name: 'Music', url: 'https://example.com' }], startPage: '' });
  const result = await h.invoke('clear-site-data');
  assert.equal(result.captureActive, false);
  assert.equal(h.partition.cleared, true);
  assert.equal(result.settings.bookmarks.length, 1);
  assert.equal(h.views[0].webContents.destroyed, true);
});

test('Navigation after clearing site data waits for the replacement view to initialize', async t => {
  const h = harness(t, { deferInitialLoad: true });
  h.prepare();
  h.views[0].webContents.completeInitialLoad();
  await h.invoke('clear-site-data');
  const navigation = h.invoke('navigate', 'https://example.com/music');
  const wc = h.views[1].webContents;
  assert.deepEqual(wc.loads, ['about:blank']);
  wc.completeInitialLoad();
  const result = await navigation;
  assert.equal(result.url, 'https://example.com/music');
  assert.deepEqual(wc.loads, ['about:blank', 'https://example.com/music']);
});

test('Pending initialization cannot navigate a view destroyed by clearing site data', async t => {
  const h = harness(t, { deferInitialLoad: true });
  const navigation = h.invoke('navigate', 'https://example.com/music');
  const old = h.views[0].webContents;
  await h.invoke('clear-site-data');
  h.prepare();
  old.completeInitialLoad();
  const result = await navigation;
  assert.equal(result.ok, false);
  assert.deepEqual(old.loads, ['about:blank']);
  assert.deepEqual(h.views[1].webContents.loads, ['about:blank']);
  h.views[1].webContents.completeInitialLoad();
});

test('Browser startup permits only its first reserved trusted capture without a gesture', async t => {
  const h = harness(t, { allowStartupCapture: true });
  const first = h.prepare();
  assert.deepEqual(await h.capture({ userGesture: false, frame: {} }), {});
  const streams = await h.capture({ userGesture: false });
  assert.equal(streams.audio, h.views[0].webContents.mainFrame);
  assert.deepEqual(await h.capture({ userGesture: false }), {});
  assert.equal((await h.invoke('set-capture-state', { ...first, active: true })).captureActive, true);
  await h.invoke('set-capture-state', { ...first, active: false });
  h.prepare();
  assert.deepEqual(await h.capture({ userGesture: false }), {});
  assert.equal((await h.capture()).audio, h.views[0].webContents.mainFrame);
});
const browserRules = [{ pattern: '*.example.com/music/*', preset: 'Music', enabled: true }];
test('Browser URL rules persist independently, reject invalid edits and retain other Browser settings', async t => {
  const h = harness(t, { settings: { startPage: 'https://example.com/', userAgent: 'Saved Browser' } });
  await h.invoke('navigate', 'https://example.com/current');
  const before = h.controller.getState();
  const saved = await h.invoke('save-settings', { urlRules: browserRules });
  assert.deepEqual(saved.settings.urlRules, browserRules);
  assert.equal(saved.settings.startPage, before.settings.startPage);
  assert.equal(saved.url, before.url);
  assert.equal(saved.captureGeneration, before.captureGeneration);
  for (const urlRules of [null, {}, [{ ...browserRules[0], pattern: 'https://example.com/*' }], [{ ...browserRules[0], enabled: 'yes' }]]) {
    assert.deepEqual(await h.invoke('save-settings', { urlRules }), { ok: false, error: 'invalidRules' });
    assert.deepEqual(h.controller.getState().settings.urlRules, browserRules);
  }
  assert.deepEqual((await h.invoke('save-settings', { userAgent: '' })).settings.urlRules, browserRules);
  assert.deepEqual(normalizeBrowserSettings({ urlRules: [{ pattern: 3 }] }).urlRules, []);
});
