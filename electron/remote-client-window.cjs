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
  if (!['http:', 'ws:', 'https:', 'wss:'].includes(url.protocol)) {
    return { ok: false, error: 'Use the pairing link from the other EffeTune.' };
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
  const scheme = url.protocol === 'https:' || url.protocol === 'wss:' ? 'https' : 'http';
  const origin = `${scheme}://${host}:${Number(port)}`;
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

// The integrated editor is bundled locally, so it uses a native connection rather
// than weakening the server's browser Origin check. Pairing belongs to an explicit
// player identity; discovery and display names never authorize effect editing.
function registerIntegratedRemoteClientIpc({ ipcMain, getMainWindow, app, getPairingEndpoint = () => null, requestPairing = require('./remote-pairing.cjs').requestRemotePairing, getClientName = () => require('node:os').hostname(), WebSocketImpl = require('ws'), log = console.warn }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const file = path.join(app.getPath('userData'), 'remote-connections.json');
  let connections = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) connections = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') log('[remote-client] could not read saved connections', error);
  }
  let active = null;
  let pendingRequest = null;
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 512 && !['__proto__', 'constructor', 'prototype'].includes(id);
  const savedConnection = id => {
    if (!validId(id) || !Object.hasOwn(connections, id)) return null;
    const target = parseJoinInput(connections[id]);
    return target.ok ? target : null;
  };
  const disconnect = () => {
    const previous = active;
    active = null;
    previous?.socket.terminate();
  };
  const cancelRequest = () => {
    const previous = pendingRequest;
    pendingRequest = null;
    previous?.controller.abort();
  };
  const saveConnection = (id, link) => {
    if (!validId(id)) return { ok: false };
    const next = { ...connections };
    if (link === null) delete next[id];
    else {
      if (typeof link !== 'string' || link.length > 600) return { ok: false };
      const parsed = parseJoinInput(link);
      if (!parsed.ok) return { ok: false };
      next[id] = parsed.url;
    }
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      connections = next;
      return { ok: true };
    } catch (error) {
      log('[remote-client] could not save connection', error);
      return { ok: false };
    }
  };
  const handlers = {
    'get-connection': (_event, id) => ({ registered: Boolean(savedConnection(id)), requestAvailable: validId(id) && Boolean(getPairingEndpoint(id)) }),
    'save-connection': (_event, id, link) => typeof link === 'string' ? saveConnection(id, link) : { ok: false },
    'request-connection': async (event, id, requestId) => {
      if (!validId(id) || typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(requestId)) return { ok: false, status: 'error' };
      cancelRequest();
      if (savedConnection(id)) return { ok: true };
      const origin = getPairingEndpoint(id);
      if (!origin || !parseJoinInput(`${origin}/?t=validation`).ok) return { ok: false, status: 'unavailable' };
      const pending = { id, requestId, origin, controller: new AbortController() };
      pendingRequest = pending;
      const cancelForNavigation = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace && pendingRequest === pending) cancelRequest(); };
      const cancelForClose = () => { if (pendingRequest === pending) cancelRequest(); };
      event.sender.on?.('did-start-navigation', cancelForNavigation);
      event.sender.once?.('destroyed', cancelForClose);
      try {
        const result = await requestPairing({ origin, playerId: id, clientName: getClientName(), signal: pending.controller.signal });
        if (pendingRequest !== pending || pending.controller.signal.aborted) return { ok: false, status: 'cancelled' };
        if (result.status !== 'approved') return { ok: false, status: result.status };
        if (getPairingEndpoint(id) !== origin) return { ok: false, status: 'unavailable' };
        return saveConnection(id, `${origin}/?t=${encodeURIComponent(result.token)}`).ok ? { ok: true } : { ok: false, status: 'error' };
      } catch (error) {
        log('[remote-client] pairing request failed', error?.message || error);
        return { ok: false, status: pending.controller.signal.aborted ? 'cancelled' : 'error' };
      } finally {
        event.sender.removeListener?.('did-start-navigation', cancelForNavigation);
        event.sender.removeListener?.('destroyed', cancelForClose);
        if (pendingRequest === pending) pendingRequest = null;
      }
    },
    'cancel-connection-request': (_event, requestId) => {
      if (pendingRequest?.requestId !== requestId) return false;
      cancelRequest(); return true;
    },
    connect: (event, id) => {
      disconnect();
      const target = savedConnection(id);
      if (!target) return { ok: false };
      const connectionId = crypto.randomUUID();
      const socket = new WebSocketImpl(target.url.replace(/^http/, 'ws'), { maxPayload: 4 * 1024 * 1024, handshakeTimeout: 10000 });
      active = { connectionId, socket };
      const emit = (type, extra = {}) => {
        if (active?.socket !== socket || event.sender.isDestroyed?.()) return;
        event.sender.send('remote-client:event', { connectionId, type, ...extra });
      };
      socket.on('open', () => emit('open'));
      socket.on('message', (data, binary) => { if (!binary) emit('message', { data: data.toString('utf8') }); });
      socket.on('close', code => {
        if (code === 4401 && active?.socket === socket && savedConnection(id)?.url === target.url) {
          // Rejected credentials cannot be reused, even if removing them from disk fails.
          delete connections[id];
          saveConnection(id, null);
        }
        emit('close', { code });
      });
      socket.on('error', error => log('[remote-client] connection failed', error.message));
      return { ok: true, connectionId };
    },
    send: (_event, id, data) => {
      if (active?.connectionId !== id || active.socket.readyState !== 1 || typeof data !== 'string' || Buffer.byteLength(data) > 4 * 1024 * 1024) return false;
      active.socket.send(data);
      return true;
    },
    disconnect: (_event, id) => {
      if (active?.connectionId === id) disconnect();
      return true;
    }
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`remote-client:${name}`, (event, ...args) => {
      const main = getMainWindow();
      if (!main?.webContents || main.isDestroyed?.() || event.sender !== main.webContents ||
          (event.senderFrame && event.senderFrame !== main.webContents.mainFrame)) throw new Error('invalid-sender');
      return handler(event, ...args);
    });
  }
  return () => {
    cancelRequest();
    disconnect();
    for (const name of Object.keys(handlers)) ipcMain.removeHandler(`remote-client:${name}`);
  };
}

module.exports = {
  PARTITION,
  closeAllClientWindows,
  isJoinableHost,
  openRemoteClientWindow,
  parseJoinInput,
  registerIntegratedRemoteClientIpc
};
