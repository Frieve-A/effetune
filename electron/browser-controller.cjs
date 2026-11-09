const { validateRules } = require('../js/browser/url-rules.js');
const { browserShortcut } = require('../js/browser/shortcuts.js');
const { PLAYBACK_AUDIO_EXTENSIONS } = require('./file-handlers.js');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PARTITION = 'persist:effetune-browser';
const CAPTURE_TIMEOUT_MS = 30000;
const MAX_MIDI_EVENTS = 256;
const MAX_MIDI_DELAY_MS = 60000;
const MAX_SYSEX_BYTES = 256;
const MAX_MIDI_FILE_BYTES = 4 * 1024 * 1024;
const MAX_MUSIC_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MUSIC_FILE_DIRS = 4;
const MIDI_FILE_PATTERN = /\.(mid|midi|kar)$/i;
// Music Player formats, except plain .xml, which downloads are rarely music.
const MUSIC_DOWNLOAD_PATTERN = new RegExp(
  `\\.(${PLAYBACK_AUDIO_EXTENSIONS.filter(extension => extension !== 'xml').join('|')})$`, 'i');
const MUSIC_FILE_DIR_PREFIX = 'effetune-browser-music-';
const MUSIC_FILE_DIR_OWNER = /^([1-9]\d*)-[A-Za-z0-9]{6}$/;
const MAX_MEDIA_TEXT = 512;
const MAX_MEDIA_ARTWORK = 32;
const MAX_MEDIA_ARTWORK_BYTES = 4 * 1024 * 1024;
const MEDIA_FRAME_CHECK_MS = 1000;
const { name: APP_NAME, version: APP_VERSION } = require('../package.json');

function staleMusicFileDir(entry) {
  if (!entry.isDirectory() || !entry.name.startsWith(MUSIC_FILE_DIR_PREFIX)) return false;
  const owner = MUSIC_FILE_DIR_OWNER.exec(entry.name.slice(MUSIC_FILE_DIR_PREFIX.length));
  const pid = Number(owner?.[1]);
  if (!Number.isInteger(pid) || pid > 0x7fffffff || pid === process.pid) return false;
  try { process.kill(pid, 0); }
  catch (failure) { return failure?.code === 'ESRCH'; }
  return false;
}

function createMusicFilePage() {
  return { lastHash: null, muted: false, pendingMidi: null, midiSequence: 0, latestOpen: 0 };
}

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

// Accepts one channel voice message or one complete SysEx message.
function validMidiData(data) {
  if (!Array.isArray(data) || data.length < 2 || !Number.isInteger(data[0])) return false;
  const [status] = data;
  const length = status >= 0x80 && status < 0xf0 ? ((status & 0xe0) === 0xc0 ? 2 : 3) : 0;
  if (length) return data.length === length && data.slice(1).every(validDataByte);
  return status === 0xf0 && data.length <= MAX_SYSEX_BYTES && data.at(-1) === 0xf7 &&
    data.slice(1, -1).every(validDataByte);
}

function validDataByte(value) {
  return Number.isInteger(value) && value >= 0 && value < 0x80;
}

function validMidiEvents(value) {
  if (!Array.isArray(value) || value.length > MAX_MIDI_EVENTS) return [];
  return value.filter(event => validMidiData(event?.data) && Number.isFinite(event.delay) &&
    event.delay >= 0 && event.delay <= MAX_MIDI_DELAY_MS)
    .map(event => ({ data: [...event.data], delay: event.delay }));
}

// Accepts a Standard MIDI File: an "MThd" chunk with its fixed 6-byte header length.
function validMidiFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 14 || bytes.length > MAX_MIDI_FILE_BYTES) return false;
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, 8);
  return header.toString('latin1', 0, 4) === 'MThd' && header.readUInt32BE(4) === 6;
}

// Keeps a page-supplied name usable as a file name the Music Player accepts.
function playerFileName(value, pattern = MIDI_FILE_PATTERN, extension = '.mid') {
  // eslint-disable-next-line no-control-regex -- replacing control characters is the intent
  const name = (typeof value === 'string' ? value : '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 120).trim().replace(/[. ]+$/, '');
  return pattern.test(name) ? name : `${name || 'Browser MIDI'}${extension}`;
}

function mediaText(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_MEDIA_TEXT) : '';
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

// Picks the largest declared artwork with a Web address; blob: and data: images are dropped.
function mediaArtworkURL(artwork) {
  let url = '';
  let bestArea = -1;
  for (const item of Array.isArray(artwork) ? artwork.slice(0, MAX_MEDIA_ARTWORK) : []) {
    let area = 0;
    for (const [, width, height] of mediaText(item?.sizes).matchAll(/(\d+)x(\d+)/gi)) {
      if (width * height > area) area = width * height;
    }
    if (area > bestArea && validNavigationURL(item?.src)) {
      url = normalizeBrowserURL(item.src);
      bestArea = area;
    }
  }
  return url;
}

// Converts a page's now-playing report into the app's payload; anything else clears it.
function normalizeMedia(value, pageURL) {
  if (!value || typeof value !== 'object') return null;
  let site = '';
  try { site = new URL(pageURL).hostname; } catch { /* The page has no address. */ }
  const duration = finiteOrNull(value.duration);
  return {
    title: mediaText(value.title), artist: mediaText(value.artist), album: mediaText(value.album),
    artworkUrl: mediaArtworkURL(value.artwork), site, playing: value.playing === true,
    position: finiteOrNull(value.position), duration: duration > 0 ? duration : null,
    rate: finiteOrNull(value.rate) ?? 1
  };
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
    openTabsExternally: value?.openTabsExternally !== false,
    openMusicFilesInPlayer: value?.openMusicFilesInPlayer === true
  };
}

function createBrowserController({ mainWindow, WebContentsView, session, ipcMain, shell, Menu, clipboard, translate, components, getSettings, saveSettings, openMusicFiles, themePreset, allowStartupCapture = false }) {
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
  // Music files handed to the Music Player from the current top-level page: the last
  // admitted MIDI hash and the page mute.
  let musicFilePage = createMusicFilePage();
  // Temp dirs kept for the player, oldest first; unlike the page state it survives navigation.
  const musicFileQueue = [];
  const musicFileDirs = new Set();
  // The page's latest now-playing report, the frame that owns it and when it arrived. Kept
  // while capture is inactive so that activation can send it; pages report only changes.
  // Its artworkUrl holds the page's image address until mediaPayload() resolves it.
  let media = null;
  // The latest artwork fetched through the page's session, as a data: URL ('' while pending
  // or failed), so that the app can draw it without cross-origin restrictions.
  let artwork = { src: '', url: '' };
  // The artworkUrl last sent to the app (null when none), so that reports leave the large
  // image out while it is unchanged; the app keeps the previous one.
  let sentArtwork = null;
  // Polls a subframe owner, since frame removal raises no event.
  let mediaFrameCheck = null;
  const midiFrames = new Set();
  let midiFrameCheck = null;
  // Best effort: remove files only when the owning app process has exited.
  const musicTempRoot = os.tmpdir();
  fs.promises.readdir(musicTempRoot, { withFileTypes: true }).then(entries => Promise.all(entries
    .filter(staleMusicFileDir)
    .map(entry => fs.promises.rm(path.join(musicTempRoot, entry.name), { recursive: true, force: true }))))
    .catch(failure => console.debug('Stale Browser music file cleanup failed:', failure?.code || failure?.name || 'Error'));
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
      captureGeneration: generation, captureActive, pageAudioMuted: musicFilePage.muted, error,
      auxiliaryURL: auxiliary && !auxiliary.isDestroyed() ? auxiliary.webContents.getURL() : '',
      settings: normalizeBrowserSettings(getSettings()), defaultUserAgent
    };
  }

  function publish() {
    if (!disposed && !trusted.isDestroyed()) trusted.send('browser:state', state());
  }

  // Lets the app release notes held by a page that cleared, navigated or ended.
  function resetMidi() {
    midiFrames.clear();
    if (midiFrameCheck) clearInterval(midiFrameCheck);
    midiFrameCheck = null;
    if (!disposed && !trusted.isDestroyed()) trusted.send('browser:midi', { reset: true });
  }

  function watchMidiFrame(frame) {
    if (frame === view.webContents.mainFrame) return;
    midiFrames.add(frame);
    if (midiFrameCheck) return;
    // As with media ownership, a removed iframe must release its input even without an unload message.
    midiFrameCheck = setInterval(() => {
      if ([...midiFrames].some(owner => owner.detached)) resetMidi();
    }, MEDIA_FRAME_CHECK_MS);
    midiFrameCheck.unref?.();
  }

  // Page audio is heard only through an active capture, unless a loaded MIDI file took over
  // playback. Muting does not silence the loopback capture; the app silences it from
  // the published pageAudioMuted state.
  function applyAudioMute() {
    const wc = view?.webContents;
    if (wc && !wc.isDestroyed()) wc.setAudioMuted(!captureActive || musicFilePage.muted);
  }

  // Like live MIDI, now-playing info reaches the app only while capture is active.
  // A report without artworkUrl keeps the image the app already has.
  function sendMedia(value) {
    if (!captureActive || disposed || trusted.isDestroyed()) return;
    if (value && value.artworkUrl === sentArtwork) {
      const { artworkUrl: _unchanged, ...rest } = value;
      value = rest;
    } else {
      sentArtwork = value ? value.artworkUrl : null;
    }
    trusted.send('browser:media', value);
  }

  // The cached report as of now: a playing position advances from its arrival time.
  function mediaPayload() {
    const { value, time } = media;
    let { position } = value;
    if (value.playing && position !== null) {
      position += (Date.now() - time) / 1000 * value.rate;
      if (value.duration !== null && position > value.duration) position = value.duration;
    }
    return { ...value, position, artworkUrl: value.artworkUrl && artwork.src === value.artworkUrl ? artwork.url : '' };
  }

  function forgetMedia() {
    if (media) sendMedia(null);
    media = null;
    artwork = { src: '', url: '' };
    watchMediaFrame();
  }

  function watchMediaFrame() {
    const needed = captureActive && Boolean(media) && media.frame !== view?.webContents.mainFrame;
    if (needed && !mediaFrameCheck) {
      mediaFrameCheck = setInterval(() => { if (media?.frame.detached) forgetMedia(); }, MEDIA_FRAME_CHECK_MS);
      mediaFrameCheck.unref?.();
    } else if (!needed && mediaFrameCheck) {
      clearInterval(mediaFrameCheck);
      mediaFrameCheck = null;
    }
  }

  async function readArtwork(src, pageURL) {
    const response = await partition.fetch(src, { credentials: 'include', referrer: pageURL });
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !/^image\/[\w.+-]+$/.test(type) ||
      Number(response.headers.get('content-length')) > MAX_MEDIA_ARTWORK_BYTES) {
      await response.body?.cancel();
      return '';
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > MAX_MEDIA_ARTWORK_BYTES) return '';
      chunks.push(chunk);
    }
    return size ? `data:${type};base64,${Buffer.concat(chunks).toString('base64')}` : '';
  }

  // Fetches a new artwork address once and sends the result if it is still the current one.
  function resolveArtwork(src, pageURL) {
    if (!src || artwork.src === src) return;
    const entry = { src, url: '' };
    artwork = entry;
    readArtwork(src, pageURL).then(url => {
      entry.url = url;
    }, failure => {
      console.debug('Browser media artwork could not be loaded:', failure?.name || 'Error');
    }).then(() => {
      if (entry.url && !disposed && artwork === entry && media?.value.artworkUrl === src) sendMedia(mediaPayload());
    });
  }

  function resetPage() {
    resetMidi();
    forgetMedia();
    musicFilePage = createMusicFilePage();
    applyAudioMute();
  }

  function musicFilesEnabled(wc) {
    return !disposed && !clearing && Boolean(view) && wc === view.webContents && !wc.isDestroyed() &&
      normalizeBrowserSettings(getSettings()).openMusicFilesInPlayer;
  }

  function removeMusicFileDir(dir) {
    musicFileDirs.delete(dir);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (failure) { console.error('Browser music file cleanup failed:', failure?.code || failure?.name || 'Error'); }
  }

  function createMusicFileDir() {
    const dir = fs.mkdtempSync(path.join(musicTempRoot, `${MUSIC_FILE_DIR_PREFIX}${process.pid}-`));
    musicFileDirs.add(dir);
    return dir;
  }

  // Keeps the newest files across pages; each opened file replaces the playlist, so the
  // oldest dir is no longer referenced when the limit is exceeded.
  async function openInPlayer(filePath, canOpen) {
    const dir = path.dirname(filePath);
    let opened = false;
    try {
      opened = canOpen() && await openMusicFiles([filePath], canOpen);
      if (opened) {
        musicFileQueue.push(dir);
        if (musicFileQueue.length > MAX_MUSIC_FILE_DIRS) removeMusicFileDir(musicFileQueue.shift());
      }
    } catch (failure) {
      if (canOpen()) console.error('Browser music file could not be opened:', failure?.code || failure?.name || 'Error');
    } finally {
      if (!opened) removeMusicFileDir(dir);
    }
    return opened;
  }

  async function receiveMidiFile(wc, frame, value) {
    if (!captureActive || !musicFilesEnabled(wc) || !validMidiFile(value?.bytes)) return;
    const page = musicFilePage;
    const captureGeneration = generation;
    const hash = crypto.createHash('sha256').update(value.bytes).digest('hex');
    if (hash === (page.pendingMidi?.hash ?? page.lastHash)) return;
    const request = { hash, sequence: ++page.midiSequence };
    page.pendingMidi = request;
    const canOpen = () => page === musicFilePage && captureActive && generation === captureGeneration &&
      !frame.detached && musicFilesEnabled(wc) && request.sequence >= page.latestOpen;
    let dir;
    try {
      dir = createMusicFileDir();
      const filePath = path.join(dir, playerFileName(value.name));
      await fs.promises.writeFile(filePath, value.bytes);
      // A slower write must not supersede a newer file already entering the Music Player.
      if (canOpen()) page.latestOpen = request.sequence;
      if (await openInPlayer(filePath, canOpen) && canOpen()) {
        page.lastHash = hash;
        if (!page.muted) { page.muted = true; applyAudioMute(); publish(); }
      }
    } catch (failure) {
      if (dir) removeMusicFileDir(dir);
      console.error('Browser MIDI file could not be saved:', failure?.code || failure?.name || 'Error');
    } finally {
      if (page.pendingMidi === request) page.pendingMidi = null;
    }
  }

  // Downloads use the normal Save dialog, except music files that the setting opens in the
  // Music Player. Downloads are user actions, so they neither need capture nor mute the page.
  function handleDownload(event, item, wc) {
    const filename = item?.getFilename();
    if (!musicFilesEnabled(wc) || !MUSIC_DOWNLOAD_PATTERN.test(filename)) return;
    if (item.getTotalBytes() > MAX_MUSIC_DOWNLOAD_BYTES) return;
    let dir;
    try { dir = createMusicFileDir(); }
    catch (failure) {
      console.error('Browser music download could not be prepared:', failure?.code || failure?.name || 'Error');
      return;
    }
    const filePath = path.join(dir, playerFileName(filename, MUSIC_DOWNLOAD_PATTERN, path.extname(filename)));
    item.setSavePath(filePath);
    item.on('updated', () => { if (item.getReceivedBytes() > MAX_MUSIC_DOWNLOAD_BYTES) item.cancel(); });
    item.once('done', async (_event, result) => {
      const page = musicFilePage;
      if (result === 'completed') await openInPlayer(filePath, () => page === musicFilePage && musicFilesEnabled(wc));
      else removeMusicFileDir(dir);
    });
  }

  function cancelReservation() {
    if (reservation) clearTimeout(reservation.timer);
    reservation = null;
  }

  // Browser MIDI follows Browser audio processing: ending capture releases the page's live MIDI input.
  function muteCapture(reason = null) {
    if (view && !view.webContents.isDestroyed()) view.webContents.setAudioMuted(true);
    cancelReservation();
    if (captureActive) resetMidi();
    if (media) sendMedia(null);
    captureActive = false;
    musicFilePage.pendingMidi = null;
    sentArtwork = null;
    watchMediaFrame();
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
    forgetMedia();
    muteCapture(reason);
    closeAuxiliary();
    const old = view;
    view = null;
    htmlFullscreen = false;
    resetMidi();
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
    wc.on('did-navigate', resetPage);
    wc.on('did-frame-navigate', (_event, _url, _code, _status, mainFrame, processId, routingId) => {
      if (!mainFrame && [...midiFrames].some(frame => frame.processId === processId && frame.routingId === routingId)) {
        resetMidi();
      }
    });
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
      if (view?.webContents === wc) { view = null; htmlFullscreen = false; resetMidi(); forgetMedia(); muteCapture('captureEnded'); }
    });
  }

  // Subframe preloads give embedded players the virtual MIDI output; popups are not covered.
  function remotePreferences(subFrames = false) {
    return {
      partition: PARTITION, nodeIntegration: false, nodeIntegrationInSubFrames: subFrames,
      preload: path.join(__dirname, 'browser-preload.js'),
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
      partition.on('will-download', handleDownload);
    }
    view = new WebContentsView({ webPreferences: remotePreferences(true) });
    view.webContents.setAudioMuted(true);
    guardPage(view.webContents);
    mainWindow.contentView.addChildView(view);
    applyPresentation();
    ready = view.webContents.loadURL('about:blank').catch(() => {});
    return view;
  }

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

  // Page IPC counts only from a live document of the current Browser view. After a
  // cross-site navigation the unloading document's frame is detached, so its late
  // messages cannot reach the next page after its reset.
  function pageEvent(event) {
    return Boolean(view) && event.sender === view.webContents && Boolean(event.senderFrame) &&
      !event.senderFrame.detached;
  }

  const relayMidi = (event, value) => {
    if (disposed || clearing || !captureActive || !pageEvent(event) || trusted.isDestroyed()) return;
    if (value?.clear === true && !Array.isArray(value)) { resetMidi(); return; }
    const events = validMidiEvents(value);
    if (events.length) {
      watchMidiFrame(event.senderFrame);
      trusted.send('browser:midi', { events });
    }
  };
  ipcMain.on('browser:midi', relayMidi);

  // Page preloads ask once per document whether to hand loaded MIDI files to the app.
  const syncMidiFilesEnabled = event => { event.returnValue = pageEvent(event) && musicFilesEnabled(event.sender); };
  ipcMain.on('browser:midi-files-enabled', syncMidiFilesEnabled);
  const relayMidiFile = (event, value) => {
    if (pageEvent(event)) void receiveMidiFile(event.sender, event.senderFrame, value);
  };
  ipcMain.on('browser:midi-file', relayMidiFile);

  // The frame that reported last owns the info; another frame takes over only while it is
  // playing or once the owner's document is gone.
  const relayMedia = (event, value) => {
    if (disposed || clearing || !pageEvent(event)) return;
    const frame = event.senderFrame;
    const pageURL = view.webContents.getURL();
    const next = normalizeMedia(value, pageURL);
    if (media && media.frame !== frame && !media.frame.detached && !next?.playing) return;
    if (!next) { forgetMedia(); return; }
    media = { frame, value: next, time: Date.now() };
    resolveArtwork(next.artworkUrl, pageURL);
    sendMedia(mediaPayload());
    watchMediaFrame();
  };
  ipcMain.on('browser:media', relayMedia);

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
    applyAudioMute();
    if (media?.frame.detached) media = null;
    if (media) sendMedia(mediaPayload());
    watchMediaFrame();
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
      ('openTabsExternally' in value && typeof value.openTabsExternally !== 'boolean') ||
      ('openMusicFilesInPlayer' in value && typeof value.openMusicFilesInPlayer !== 'boolean')) return { ok: false, error: 'invalidRequest' };
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
    ipcMain.removeListener('browser:midi', relayMidi);
    ipcMain.removeListener('browser:midi-files-enabled', syncMidiFilesEnabled);
    ipcMain.removeListener('browser:midi-file', relayMidiFile);
    ipcMain.removeListener('browser:media', relayMedia);
    captureSession.setDisplayMediaRequestHandler(null);
    if (partition) partition.removeListener('will-download', handleDownload);
    for (const dir of [...musicFileDirs]) removeMusicFileDir(dir);
  }
  listen(mainWindow, 'closed', dispose);
  return { dispose, getState: state, updateTheme };
}

module.exports = { createBrowserController, normalizeBrowserURL, normalizeBrowserSettings, PARTITION };
