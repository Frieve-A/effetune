'use strict';

// "Join another EffeTune": a window that shows another computer's EffeTune
// (its remote-v1 server serves remote.html, see remote-static-server.cjs) as a
// remote editor. It is an ordinary sandboxed browser window: no preload, no
// Node, a partition of its own, and it can only stay on the server it was
// pointed at.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
const PARTITION = 'persist:effetune-remote-client';

const windows = new Map(); // origin -> BrowserWindow

function isPrivateIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some(part => part > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ||
    // carrier-grade NAT range, used by Tailscale and similar VPNs
    (a === 100 && b >= 64 && b <= 127);
}

function isJoinableHost(host) {
  const lower = String(host || '').toLowerCase();
  return isPrivateIPv4(lower) || lower === 'localhost' || lower === '[::1]' ||
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+local$/.test(lower);
}

// Accepts the pairing link of the Remote Control window (http:// or ws://
// with ?t=<token>).
function parseJoinInput(input) {
  const text = String(input || '').trim();
  if (!text) return { ok: false, error: 'Enter the link shown in EffeTune on the other computer.' };
  let url;
  try { url = new URL(text); } catch (_) { return { ok: false, error: 'That is not a valid link.' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'ws:') {
    return { ok: false, error: 'Use the http:// or ws:// link from the other EffeTune.' };
  }
  const host = url.hostname.toLowerCase();
  const port = url.port;
  const token = url.searchParams.get('t') || '';
  if (!/^\d{1,5}$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) {
    return { ok: false, error: 'The link has no valid port.' };
  }
  if (!isJoinableHost(host)) {
    return { ok: false, error: 'Only computers on your own network can be joined.' };
  }
  if (!TOKEN_PATTERN.test(token)) return { ok: false, error: 'The link has no valid pairing code.' };
  const origin = `http://${host}:${Number(port)}`;
  return { ok: true, host, port: Number(port), token, origin, url: `${origin}/?t=${encodeURIComponent(token)}` };
}

// deps: { BrowserWindow, getMainWindow, isSelf(host, port), log }
function openRemoteClientWindow(input, deps) {
  const parsed = parseJoinInput(input);
  if (!parsed.ok) return parsed;
  const { getMainWindow, isSelf = () => false, log = () => {} } = deps;
  if (isSelf(parsed.host, parsed.port)) {
    const main = getMainWindow?.();
    if (main && !main.isDestroyed?.()) {
      if (main.isMinimized?.()) main.restore();
      main.show();
      main.focus();
    }
    return { ok: true, self: true };
  }
  const existing = windows.get(parsed.origin);
  if (existing && !existing.isDestroyed()) {
    // Same server again, perhaps with a new pairing code.
    existing.loadURL(parsed.url).catch(() => {});
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, reused: true };
  }
  const BrowserWindow = deps.BrowserWindow || require('electron').BrowserWindow;
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: `EffeTune Remote – ${parsed.host}`,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: PARTITION
    }
  });
  windows.set(parsed.origin, win);
  win.setMenuBarVisibility?.(false);
  const { webContents } = win;
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    let target = null;
    try { target = new URL(url).origin; } catch (_) { /* blocked below */ }
    if (target !== parsed.origin) event.preventDefault();
  });
  webContents.session?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
  win.on('page-title-updated', event => event.preventDefault());
  win.on('closed', () => {
    if (windows.get(parsed.origin) === win) windows.delete(parsed.origin);
  });
  win.loadURL(parsed.url).catch(error => {
    log('[remote] client window failed to load:', error?.message || error);
  });
  return { ok: true };
}

function closeAllClientWindows() {
  for (const win of windows.values()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch (_) { /* ignore */ }
  }
  windows.clear();
}

module.exports = {
  PARTITION,
  closeAllClientWindows,
  isJoinableHost,
  openRemoteClientWindow,
  parseJoinInput
};
