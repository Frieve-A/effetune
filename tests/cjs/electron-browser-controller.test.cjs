const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createBrowserController, normalizeBrowserURL, normalizeBrowserSettings, PARTITION } = require('../../electron/browser-controller.cjs');
const RUNTIME_USER_AGENT = 'Mozilla/5.0 EffeTune/2.15.0 Chrome/152.0.0.0 Electron/44.5.1 Safari/537.36';
const DEFAULT_USER_AGENT = RUNTIME_USER_AGENT.replace(/\sElectron\/\S+/g, '');

function harness(t, { deferInitialLoad = false, allowStartupCapture = false, components, themePreset, settings: initialSettings, saveFailure = false, runtimeUserAgent = RUNTIME_USER_AGENT, beforeMusicOpen } = {}) {
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
  const opened = [];
  const controller = createBrowserController({
    mainWindow, ipcMain: ipc, allowStartupCapture, components, themePreset,
    async openMusicFiles(paths, canOpen) {
      await beforeMusicOpen?.(paths);
      if (!canOpen()) return false;
      opened.push(...paths);
      return true;
    },
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
  return { controller, ipc, handlers, trusted, mainWindow, views, partition, mediaSession, invoke, prepare, capture, contents, externalURLs, menus, copied, opened };
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
    bookmarks: [{ name: 'Music', url: 'https://example.com/' }], startPage: '', userAgent: '', openTabsExternally: true, openMusicFilesInPlayer: false, urlRules: []
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
  assert.deepEqual(saved.settings, { ...settings, userAgent: 'Desktop Browser/1.0', openTabsExternally: true, openMusicFilesInPlayer: false, urlRules: [] });
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
    require('node:path').resolve(__dirname, '../../electron/browser-preload.js'));
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

test('Browser MIDI relays only valid messages from the live, captured view and resets on clear, capture end and teardown', async t => {
  const h = harness(t);
  await h.invoke('navigate', 'https://example.com/');
  const view = h.views[0];
  const wc = view.webContents;
  assert.equal(view.options.webPreferences.nodeIntegrationInSubFrames, true);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.contextIsolation, true);
  assert.equal(wc.open({ url: 'https://login.example.com', disposition: 'new-window' })
    .overrideBrowserWindowOptions.webPreferences.nodeIntegrationInSubFrames, false);
  for (const permission of ['midi', 'midiSysex']) {
    assert.equal(h.partition.check(wc, permission, 'https://example.com'), false);
    let granted;
    h.partition.request(wc, permission, value => { granted = value; }, { requestingUrl: 'https://example.com' });
    assert.equal(granted, false);
  }
  const sent = [];
  h.trusted.send = (channel, value) => { if (channel === 'browser:midi') sent.push(value); };
  const relay = (value, sender = wc, senderFrame = { detached: false }) => h.ipc.emit('browser:midi', { sender, senderFrame }, value);
  // Browser MIDI follows Browser audio processing: nothing is relayed before capture is active.
  relay([{ data: [0x90, 60, 100], delay: 0 }]);
  relay({ clear: true });
  assert.deepEqual(sent, []);
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  assert.equal(h.views.length, 1);
  const sysex = [0xf0, ...new Array(254).fill(0x10), 0xf7];
  relay([
    { data: [0x90, 60, 100], delay: 0 }, { data: [0xc0, 5], delay: 11 }, { data: sysex, delay: 60000, extra: true },
    { data: [0x90, 60], delay: 1 }, { data: [0x90, 60, 128], delay: 1 }, { data: [0xc0, 5, 1], delay: 1 },
    { data: [0xf8, 0], delay: 1 }, { data: [0xf1, 0], delay: 1 }, { data: [144.5, 60, 1], delay: 1 },
    { data: [0xf0, 1, 2], delay: 1 }, { data: [0xf0, 0x80, 0xf7], delay: 1 }, { data: [...sysex.slice(0, -1), 1, 0xf7], delay: 1 },
    { data: [0x80, 60, 0], delay: Infinity }, { data: [0x80, 60, 0], delay: '1' }, { data: [0x80, 60, 0], delay: -1 },
    { data: [0x80, 60, 0], delay: 60001 }, { data: '\x90<d', delay: 1 }, null
  ]);
  assert.deepEqual(sent, [{ events: [
    { data: [0x90, 60, 100], delay: 0 }, { data: [0xc0, 5], delay: 11 }, { data: sysex, delay: 60000 }
  ] }]);
  sent.length = 0;
  relay(new Array(257).fill({ data: [0x90, 60, 100], delay: 1 }));
  relay({ events: [{ data: [0x90, 60, 100], delay: 1 }] });
  relay([{ data: [0x90, 60, 100], delay: 1 }], h.trusted);
  relay([{ data: [0x90, 60, 100], delay: 1 }], h.contents());
  const child = new EventEmitter();
  child.webContents = h.contents(); child.isDestroyed = () => false;
  child.setMenu = child.setTitle = child.destroy = () => {};
  wc.emit('did-create-window', child);
  relay([{ data: [0x90, 60, 100], delay: 1 }], child.webContents);
  // An unloading document of the view cannot relay after its page was reset.
  relay([{ data: [0x80, 60, 0], delay: 0 }], wc, { detached: true });
  relay({ clear: true }, wc, { detached: true });
  relay([{ data: [0x80, 60, 0], delay: 0 }], wc, null);
  relay({ clear: true }, child.webContents);
  assert.deepEqual(sent, []);
  relay({ clear: true });
  wc.emit('did-navigate', {}, 'https://example.com/next');
  assert.deepEqual(sent, [{ reset: true }, { reset: true }]);
  // Ending capture releases the page's live MIDI input once and stops the relay.
  await h.invoke('set-capture-state', { ...token, active: false });
  await h.invoke('set-capture-state', { ...token, active: false });
  relay([{ data: [0x90, 60, 100], delay: 1 }]);
  assert.deepEqual(sent, [{ reset: true }, { reset: true }, { reset: true }]);
  wc.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(sent, [{ reset: true }, { reset: true }, { reset: true }, { reset: true }]);
  relay([{ data: [0x90, 60, 100], delay: 1 }], wc);
  assert.equal(sent.length, 4);
  await h.invoke('navigate', 'https://example.com/');
  sent.length = 0;
  h.views[1].webContents.close();
  assert.deepEqual(sent, [{ reset: true }]);
  await h.invoke('navigate', 'https://example.com/');
  sent.length = 0;
  h.controller.dispose();
  assert.deepEqual(sent, [{ reset: true }]);
  assert.equal(h.ipc.listenerCount('browser:midi'), 0);
});

test('Browser media info is normalized, follows its owning frame, is sent only during capture, and clears with the page', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const h = harness(t);
  await h.invoke('navigate', 'https://music.example.com/album');
  const wc = h.views[0].webContents;
  const sent = [];
  const fetches = [];
  h.trusted.send = (channel, value) => { if (channel === 'browser:media') sent.push(value); };
  h.partition.fetch = async (url, init) => {
    fetches.push([url, init.credentials, init.referrer]);
    return new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-type': 'image/jpeg' } });
  };
  const top = wc.mainFrame;
  const sub = { detached: false };
  const post = (value, senderFrame = top, sender = wc) => h.ipc.emit('browser:media', { sender, senderFrame }, value);
  post({
    title: '  Song  ', artist: 'A'.repeat(600), album: 7, playing: true, position: 12.5, duration: 0, rate: NaN,
    artwork: [
      null,
      { src: 'https://img.example.com/small.jpg', sizes: '96x96' },
      { src: 'data:image/png;base64,AAAA', sizes: '1024x1024' },
      { src: 'https://img.example.com/large.jpg', sizes: '128x128 512x512' },
      { src: 'blob:https://music.example.com/1', sizes: '2048x2048' }
    ]
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, []);
  // The artwork is fetched with the page's credentials and sent as a data: URL.
  assert.deepEqual(fetches, [['https://img.example.com/large.jpg', 'include', 'https://music.example.com/album']]);
  // Activation sends the info cached while capture was inactive.
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  assert.deepEqual(sent, [{
    title: 'Song', artist: 'A'.repeat(512), album: '', artworkUrl: 'data:image/jpeg;base64,AQID',
    site: 'music.example.com', playing: true, position: 12.5, duration: null, rate: 1
  }]);
  post({ title: 'Ad', playing: false }, sub);
  post(null, sub);
  post({ title: 'Other', playing: true }, top, h.contents());
  post({ title: 'Late', playing: true }, { detached: true });
  assert.equal(sent.length, 1);
  post({ title: 'Clip', playing: true, duration: 30, artwork: 'none' }, sub);
  wc.emit('did-navigate-in-page', {}, 'https://music.example.com/next');
  assert.deepEqual([sent.length, sent[1].title, sent[1].duration, sent[1].artworkUrl], [2, 'Clip', 30, '']);
  sub.detached = true;
  post({ title: 'Song', playing: false });
  assert.deepEqual([sent.length, sent[2].title, sent[2].playing], [3, 'Song', false]);
  // Ending capture clears the app's info but keeps the page's for the next capture.
  await h.invoke('set-capture-state', { ...token, active: false });
  post({ title: 'Paused', playing: false });
  assert.deepEqual(sent.slice(3), [null]);
  const next = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...next, active: true });
  assert.equal(sent.at(-1).title, 'Paused');
  wc.emit('did-navigate', {}, 'https://example.com/');
  post(null);
  assert.deepEqual(sent.slice(5), [null]);
  post({ title: 'Song', playing: true });
  h.controller.dispose();
  assert.deepEqual(sent.slice(6).map(value => value?.title ?? null), ['Song', null]);
  assert.equal(h.ipc.listenerCount('browser:media'), 0);
});

test('Browser MIDI releases held notes, sustain and delayed events when an input subframe leaves', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness(t);
  await h.invoke('navigate', 'https://music.example.com/');
  const wc = h.views[0].webContents;
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  const sent = [];
  h.trusted.send = (channel, value) => { if (channel === 'browser:midi') sent.push(value); };
  const post = frame => h.ipc.emit('browser:midi', { sender: wc, senderFrame: frame }, [
    { data: [0x90, 60, 100], delay: 0 },
    { data: [0xb0, 64, 127], delay: 0 },
    { data: [0x90, 64, 100], delay: 60000 }
  ]);
  const removed = { detached: false, processId: 1, routingId: 2 };
  post(removed);
  removed.detached = true;
  t.mock.timers.tick(1000);
  assert.deepEqual(sent.at(-1), { reset: true });
  const afterRemoval = sent.length;
  t.mock.timers.tick(2000);
  assert.equal(sent.length, afterRemoval, 'the ended input is forgotten');

  const navigated = { detached: false, processId: 3, routingId: 4 };
  post(navigated);
  wc.emit('did-frame-navigate', {}, 'https://music.example.com/other', 200, 'OK', false, 9, 9);
  assert.equal(sent.at(-1).events.length, 3, 'another frame does not release the live input');
  wc.emit('did-frame-navigate', {}, 'https://music.example.com/next', 200, 'OK', false, 3, 4);
  assert.deepEqual(sent.at(-1), { reset: true }, 'same-process navigation releases the old document');
  const afterNavigation = sent.length;
  navigated.detached = true;
  t.mock.timers.tick(1000);
  assert.equal(sent.length, afterNavigation);

  const released = { detached: false, processId: 5, routingId: 6 };
  post(released);
  await h.invoke('set-capture-state', { ...token, active: false });
  const afterCapture = sent.length;
  released.detached = true;
  t.mock.timers.tick(1000);
  assert.equal(sent.length, afterCapture, 'capture release also clears frame ownership');
});

test('Browser media resumes at the elapsed position, forgets a removed subframe owner, and sends only image artwork', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const h = harness(t);
  await h.invoke('navigate', 'https://music.example.com/');
  const wc = h.views[0].webContents;
  const sent = [];
  h.trusted.send = (channel, value) => { if (channel === 'browser:media') sent.push(value); };
  const types = { 'https://img.example.com/cover.png': 'image/png', 'https://img.example.com/page': 'text/html' };
  let missingFetches = 0;
  h.partition.fetch = async url => {
    if (url.endsWith('/missing.png')) missingFetches++;
    if (!types[url]) throw new TypeError('fetch failed');
    return new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-type': types[url] } });
  };
  const post = (value, senderFrame = wc.mainFrame) => h.ipc.emit('browser:media', { sender: wc, senderFrame }, value);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const activate = async () => {
    const token = h.prepare(); await h.capture();
    await h.invoke('set-capture-state', { ...token, active: true });
    return token;
  };
  let token = await activate();
  post({ title: 'Song', playing: true, position: 10, duration: 100, rate: 2, artwork: [{ src: 'https://img.example.com/cover.png' }] });
  assert.equal(sent.at(-1).artworkUrl, '');
  await settle();
  assert.equal(sent.at(-1).artworkUrl, 'data:image/png;base64,AQID');
  // An unchanged picture is left out of later reports until capture resumes.
  post({ title: 'Song', playing: true, position: 11, duration: 100, rate: 2, artwork: [{ src: 'https://img.example.com/cover.png' }] });
  assert.equal('artworkUrl' in sent.at(-1), false);
  await h.invoke('set-capture-state', { ...token, active: false });
  t.mock.timers.tick(5000);
  token = await activate();
  assert.deepEqual([sent.at(-1).position, sent.at(-1).artworkUrl], [21, 'data:image/png;base64,AQID']);
  await h.invoke('set-capture-state', { ...token, active: false });
  t.mock.timers.tick(60000);
  await activate();
  assert.equal(sent.at(-1).position, 100);
  // Non-image and unavailable artwork clear the picture once.
  const count = sent.length;
  post({ title: 'Page', playing: true, artwork: [{ src: 'https://img.example.com/page' }] });
  await settle();
  post({ title: 'Missing', playing: true, artwork: [{ src: 'https://img.example.com/missing.png' }] });
  await settle();
  assert.deepEqual(sent.slice(count).map(value => value.artworkUrl), ['', undefined]);
  // A failed address is fetched again after the page navigates.
  wc.emit('did-navigate', {}, 'https://music.example.com/again');
  post({ title: 'Missing', playing: true, artwork: [{ src: 'https://img.example.com/missing.png' }] });
  await settle();
  assert.equal(missingFetches, 2);
  // A subframe owner that leaves the page is forgotten.
  const sub = { detached: false };
  post({ title: 'Embed', playing: true }, sub);
  t.mock.timers.tick(1000);
  assert.equal(sent.at(-1).title, 'Embed');
  sub.detached = true;
  t.mock.timers.tick(1000);
  assert.equal(sent.at(-1), null);
});

function midiFile(track = 0) {
  return Uint8Array.of(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, track);
}

// Waits with a referenced timer so pending file I/O keeps the test alive.
async function until(condition) {
  for (let attempt = 0; attempt < 400 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition());
}

test('Browser MIDI files open in Music Player only when enabled, skip immediate repeats, and mute the page', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const off = harness(t);
  await off.invoke('navigate', 'https://example.com/');
  const offQuery = { sender: off.views[0].webContents, senderFrame: {} };
  off.ipc.emit('browser:midi-files-enabled', offQuery);
  assert.equal(offQuery.returnValue, false);
  off.ipc.emit('browser:midi-file', { sender: off.views[0].webContents, senderFrame: {} }, { bytes: midiFile(), name: 'song.mid' });

  const h = harness(t, { settings: { openMusicFilesInPlayer: true } });
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  await h.invoke('navigate', 'https://example.com/');
  const wc = h.views[0].webContents;
  assert.equal(wc.muted, false);
  // Muting the page does not silence its loopback capture, so the app is told to.
  const pageAudioMuted = [];
  const send = h.trusted.send;
  h.trusted.send = (channel, value) => {
    if (channel === 'browser:state') pageAudioMuted.push(value.pageAudioMuted);
    return send?.call(h.trusted, channel, value);
  };
  for (const [sender, expected, senderFrame = {}] of [[wc, true], [h.trusted, false], [h.contents(), false],
    [wc, false, { detached: true }], [wc, false, null]]) {
    const query = { sender, senderFrame };
    h.ipc.emit('browser:midi-files-enabled', query);
    assert.equal(query.returnValue, expected);
  }
  const post = (value, sender = wc, senderFrame = {}) => h.ipc.emit('browser:midi-file', { sender, senderFrame }, value);
  post({ bytes: midiFile(7), name: 'unloading.mid' }, wc, { detached: true });
  post({ bytes: midiFile(), name: 'song.mid' });
  post({ bytes: midiFile(), name: 'again.mid' });
  post({ bytes: midiFile(1), name: 'other.mid' }, h.contents());
  post({ bytes: Uint8Array.of(...midiFile(2).slice(0, 7), 7, 0, 0, 0, 1, 0, 96) });
  post({ bytes: midiFile(3).slice(0, 13) });
  post({ bytes: [...midiFile(4)] });
  await until(() => h.opened.length === 1);
  post({ bytes: midiFile(5), name: 'play.php?x' });
  await until(() => h.opened.length === 2);
  assert.equal(wc.muted, true);
  assert.deepEqual(pageAudioMuted, [true]);
  assert.deepEqual(h.opened.map(file => path.basename(file)), ['song.mid', 'play.php_x.mid']);
  assert.deepEqual([...fs.readFileSync(h.opened[0])], [...midiFile()]);
  assert.deepEqual(off.opened, []);

  wc.emit('did-navigate', {}, 'https://example.com/next');
  assert.equal(wc.muted, false);
  assert.equal(pageAudioMuted.at(-1), false);
  post({ bytes: midiFile() });
  await until(() => h.opened.length === 3);
  assert.equal(path.basename(h.opened[2]), 'Browser MIDI.mid');
  assert.equal(wc.muted, true);
  await h.invoke('save-settings', { openMusicFilesInPlayer: false });
  post({ bytes: midiFile(6) });
  assert.deepEqual(await h.invoke('save-settings', { openMusicFilesInPlayer: 'yes' }), { ok: false, error: 'invalidRequest' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.opened.length, 3);
  // Closing capture stops opening files, but the page hook stays installed for a later capture.
  await h.invoke('save-settings', { openMusicFilesInPlayer: true });
  await h.invoke('set-capture-state', { ...token, active: false });
  const closedQuery = { sender: wc, senderFrame: {} };
  h.ipc.emit('browser:midi-files-enabled', closedQuery);
  assert.equal(closedQuery.returnValue, true);
  post({ bytes: midiFile(8), name: 'closed.mid' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.opened.length, 3);
  h.controller.dispose();
  for (const file of h.opened) assert.equal(fs.existsSync(path.dirname(file)), false);
});

test('Browser removes music temp dirs only for owners that have exited', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-browser-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => root);
  const pids = [123, 456, 789].filter(pid => pid !== process.pid);
  const [exited, active] = pids;
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(signal, 0);
    if (pid === exited) throw Object.assign(new Error('Process exited'), { code: 'ESRCH' });
    assert.equal(pid, active);
    return true;
  });
  const stale = fs.mkdtempSync(path.join(root, `effetune-browser-music-${exited}-`));
  fs.writeFileSync(path.join(stale, 'song.mid'), midiFile());
  const live = fs.mkdtempSync(path.join(root, `effetune-browser-music-${active}-`));
  const unknown = fs.mkdtempSync(path.join(root, 'effetune-browser-music-'));
  const unrelated = fs.mkdtempSync(path.join(root, 'effetune-browser-other-'));
  const file = path.join(root, `effetune-browser-music-file-${process.pid}`);
  fs.writeFileSync(file, '');
  harness(t);
  await until(() => !fs.existsSync(stale));
  for (const entry of [live, unknown, unrelated, file]) assert.ok(fs.existsSync(entry));
});

test('Browser drops late MIDI writes and rechecks capture before handing files to the player', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-browser-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => root);
  const resumeWrite = Promise.withResolvers();
  const resumeOpen = Promise.withResolvers();
  const writeFile = fs.promises.writeFile;
  let oldFile, pendingFile;
  t.mock.method(fs.promises, 'writeFile', async (file, bytes) => {
    if (path.basename(file) === 'old.mid') {
      oldFile = file;
      await resumeWrite.promise;
    }
    return writeFile(file, bytes);
  });
  const h = harness(t, {
    settings: { openMusicFilesInPlayer: true },
    async beforeMusicOpen([file]) {
      if (path.basename(file) !== 'pending.mid') return;
      pendingFile = file;
      await resumeOpen.promise;
    }
  });
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  await h.invoke('navigate', 'https://example.com/');
  const sender = h.views[0].webContents;
  const post = (name, track) => h.ipc.emit('browser:midi-file', { sender, senderFrame: {} }, { name, bytes: midiFile(track) });

  post('old.mid', 1);
  post('new.mid', 2);
  await until(() => h.opened.length === 1);
  resumeWrite.resolve();
  await until(() => !fs.existsSync(path.dirname(oldFile)));
  assert.deepEqual(h.opened.map(file => path.basename(file)), ['new.mid']);

  sender.emit('did-navigate', {}, 'https://example.com/next');
  post('pending.mid', 3);
  await until(() => Boolean(pendingFile));
  await h.invoke('set-capture-state', { ...token, active: false });
  resumeOpen.resolve();
  await until(() => !fs.existsSync(path.dirname(pendingFile)));
  assert.equal(h.opened.length, 1);
  assert.equal(h.controller.getState().pageAudioMuted, false);
});

test('Browser MIDI files reopen earlier songs and keep only the newest four temp dirs', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const h = harness(t, { settings: { openMusicFilesInPlayer: true } });
  const token = h.prepare(); await h.capture();
  await h.invoke('set-capture-state', { ...token, active: true });
  await h.invoke('navigate', 'https://example.com/');
  const wc = h.views[0].webContents;
  // Posts one file and waits until it opens, so the open order is deterministic.
  const post = async track => {
    const count = h.opened.length;
    h.ipc.emit('browser:midi-file', { sender: wc, senderFrame: {} }, { bytes: midiFile(track), name: `${track}.mid` });
    await until(() => h.opened.length === count + 1);
  };
  for (const track of [0, 1, 0]) await post(track);
  assert.deepEqual(h.opened.map(file => path.basename(file)), ['0.mid', '1.mid', '0.mid']);
  await post(2);
  assert.ok(h.opened.every(file => fs.existsSync(file)));
  await post(3);
  assert.equal(fs.existsSync(path.dirname(h.opened[0])), false);
  assert.ok(h.opened.slice(1).every(file => fs.existsSync(file)));
  h.controller.dispose();
  assert.ok(h.opened.every(file => !fs.existsSync(path.dirname(file))));
});

test('Browser opens music downloads in Music Player when enabled and leaves other downloads to the Save dialog', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const download = (h, filename, totalBytes = 15, sender = h.views[0].webContents) => {
    const item = new EventEmitter();
    Object.assign(item, {
      getFilename: () => filename, getTotalBytes: () => totalBytes, getReceivedBytes: () => item.received || 0,
      setSavePath(value) { item.savePath = value; }, cancel() { item.cancelled = true; }
    });
    const event = { preventDefault() { event.prevented = true; } };
    h.partition.emit('will-download', event, item, sender);
    return { event, item };
  };
  const saveDialog = ({ event, item }) => {
    assert.equal(event.prevented, undefined);
    assert.equal(item.savePath, undefined);
  };
  const off = harness(t);
  await off.invoke('navigate', 'https://example.com/');
  saveDialog(download(off, 'song.flac'));

  // Downloads are user actions: they open without an active capture and leave the page unmuted.
  const h = harness(t, { settings: { openMusicFilesInPlayer: true } });
  await h.invoke('navigate', 'https://example.com/');
  const wc = h.views[0].webContents;
  for (const [name, sender] of [['archive.zip', wc], ['feed.xml', wc], ['song.flac', h.contents()]]) {
    saveDialog(download(h, name, 15, sender));
  }
  const accepted = download(h, 'Song.FLAC');
  assert.equal(accepted.event.prevented, undefined);
  assert.equal(path.basename(accepted.item.savePath), 'Song.FLAC');
  fs.writeFileSync(accepted.item.savePath, 'audio');
  accepted.item.emit('done', {}, 'completed');
  await until(() => h.opened.length === 1);
  assert.equal(h.opened[0], accepted.item.savePath);
  assert.equal(h.controller.getState().pageAudioMuted, false);

  const tooLarge = download(h, 'huge.wav', 2 * 1024 * 1024 * 1024 + 1);
  saveDialog(tooLarge);
  const oversized = download(h, 'big.wav', 0);
  oversized.item.received = 2 * 1024 * 1024 * 1024 + 1;
  oversized.item.emit('updated', {}, 'progressing');
  assert.equal(oversized.item.cancelled, true);
  fs.writeFileSync(oversized.item.savePath, 'partial');
  oversized.item.emit('done', {}, 'cancelled');
  const interrupted = download(h, 'cut.mp3');
  interrupted.item.emit('done', {}, 'interrupted');
  for (const { item } of [oversized, interrupted]) assert.equal(fs.existsSync(path.dirname(item.savePath)), false);
  assert.equal(h.opened.length, 1);

  // The newest four files are kept across navigation: the fifth overall evicts the first.
  h.views[0].webContents.emit('did-navigate', {}, 'https://example.com/next');
  const later = [];
  for (const name of ['a.flac', 'b.flac', 'c.flac', 'd.flac']) {
    const next = download(h, name);
    fs.writeFileSync(next.item.savePath, 'audio');
    next.item.emit('done', {}, 'completed');
    await until(() => h.opened.length === later.length + 2);
    later.push(next);
    if (later.length < 4) assert.equal(fs.existsSync(path.dirname(accepted.item.savePath)), true);
  }
  assert.equal(fs.existsSync(path.dirname(accepted.item.savePath)), false);
  assert.ok(later.every(({ item }) => fs.existsSync(item.savePath)));
  h.controller.dispose();
  assert.ok(later.every(({ item }) => !fs.existsSync(path.dirname(item.savePath))));
});
