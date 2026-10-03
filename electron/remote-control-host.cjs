'use strict';

// LAN remote control ("remote-v1"). Client-neutral; see docs/remote-v1.md.
//
// The WebSocket server lives in the main process (the renderer CSP forbids
// ws:). Every client operation is forwarded to the renderer over versioned
// IPC channels (same shape as openhome-v1) and answered from there, because the
// pipeline, the preset manager and the IR library only exist in the renderer.
//
// The server is switched on and off from Settings > Remote Control... (the
// choice and a persistent token are kept in config.json). EFFETUNE_REMOTE=1 or
// --remote forces it on at startup; EFFETUNE_REMOTE_TOKEN fixes the token and
// EFFETUNE_REMOTE_PORT the first port to try (for tests). A busy port is retried
// a few times, then the next free port above it is used (47300 -> 47301..47309);
// the pairing URL and QR code carry the bound port.

const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { createStaticHandler, isAllowedHost, isAllowedOrigin } = require('./remote-static-server.cjs');

const CHANNELS = Object.freeze({
  rendererReady: 'remote-v1:renderer-ready',
  rendererUnavailable: 'remote-v1:renderer-unavailable',
  response: 'remote-v1:response',
  state: 'remote-v1:state',
  openPanel: 'remote-v1:open-panel',
  request: 'remote-v1:request',
  status: 'remote-v1:status',
  getStatus: 'remote-v1:get-status',
  presetsChanged: 'remote-v1:presets-changed'
});

const PANEL_CHANNELS = Object.freeze({
  getStatus: 'remote-panel-v1:get-status',
  setEnabled: 'remote-panel-v1:set-enabled',
  regenerateToken: 'remote-panel-v1:regenerate-token',
  copyLink: 'remote-panel-v1:copy-link',
  status: 'remote-panel-v1:status'
});

const PORT = 47300;
const PORT_FALLBACK_COUNT = 9;      // 47301..47309 when 47300 stays busy
const PORT_RETRY_ATTEMPTS = 4;      // a previous instance may still be releasing the port
const PORT_RETRY_DELAY_MS = 750;
const LISTEN_RETRY_MS = 15000;     // ports busy at boot: keep trying while the switch is on
const MAX_WS_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const IR_REQUEST_TIMEOUT_MS = 120000;
const MAX_PENDING_REQUESTS = 32;
const STATE_MIN_INTERVAL_MS = 100; // <= 10 Hz
const ORIGIN_WINDOW_MS = 300;      // late snapshots still belong to the last command
const PING_INTERVAL_MS = 15000;
const RENDERER_WAIT_MS = 20000; // hold early requests until the renderer finishes startup
const SHUTDOWN_GRACE_MS = 300;  // do not let an unresponsive client delay quit
const MAX_CLIENTS = 16;
const CLOSE_UNAUTHORIZED = 4401;
const PROTOCOL_VERSION = 1;
const IR_CHUNK_BYTES = 512 * 1024;
const IR_MAX_BYTES = 64 * 1024 * 1024;
const IR_MAX_CHUNKS = Math.ceil(IR_MAX_BYTES / IR_CHUNK_BYTES);
const MAX_UPLOADS_PER_CLIENT = 2;
const SEND_HIGH_WATER_BYTES = 8 * 1024 * 1024;
const STATE_HIGH_WATER_BYTES = 1024 * 1024; // a slower client than this misses pushes and gets the latest later
const STATE_DRAIN_BYTES = 64 * 1024;
const STATE_DIRTY_CHECK_MS = 250;
const IR_ID_PATTERN = /^[a-f0-9]{24}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
const FEATURES = Object.freeze(['origin', 'savePreset', 'irSync', 'sync1']);
const APP_NAME = 'EffeTune';
const CLIENT_INFO_MAX = 48;

// Client-supplied text shown in the Remote Control window: strip control characters, cap length.
function cleanClientText(value) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the intent
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CLIENT_INFO_MAX) || null;
}

// Names of the effects (nm) this app can load, as the renderer reports them; sorted, bounded.
function cleanEffectNames(value) {
  if (!Array.isArray(value)) return null;
  const names = [];
  for (const item of value) {
    const name = cleanClientText(item);
    if (name) names.push(name);
    if (names.length >= 1024) break;
  }
  return names.length > 0 ? [...new Set(names)].sort() : null;
}
const CLIENT_OPS = new Set([
  'hello', 'get', 'chain', 'params', 'bypass', 'listPresets', 'getPreset',
  'savePreset', 'listIRs', 'getIR', 'putIR',
  // sync1
  'edit', 'history', 'slot', 'copySlot', 'presets', 'loadPreset', 'deletePreset'
]);
// Ops whose ack carries `rev` (the host revision that contains the command).
const MUTATING_OPS = new Set([
  'chain', 'params', 'bypass', 'edit', 'history', 'slot', 'copySlot', 'loadPreset'
]);

let activeHost = null;

function isRemoteForced(env = process.env, argv = process.argv) {
  return env.EFFETUNE_REMOTE === '1' || argv.includes('--remote');
}

function isPrivateIPv4(address) {
  return address.startsWith('192.168.') || address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

const VIRTUAL_ADAPTER = /vethernet|wsl|vmware|virtualbox|hyper-v|docker|vbox|loopback|tailscale|zerotier|hamachi|vpn|wireguard|npcap|bluetooth/i;
// Interface names of Linux and macOS (docker0, br-<hash>, virbr0, veth*, lxdbr0, incusbr0, cni0, wg0, tun0, utun4,
// bridge100 of Internet Sharing, vmnet8, vnic0 ...). Anchored: real LAN names (eth0, enp3s0, wlan0, wlp2s0, en0)
// never start with these.
const VIRTUAL_ADAPTER_PREFIX = /^(br-|virbr|veth|lxc|lxd|incus|nordlynx|cni|flannel|cali|kube|podman|vnic|vmnet|vmenet|utun|tun\d|tap\d|wg\d|ppp|awdl|llw|bridge\d|zt)/i;
// Adapter names are localized on Windows ("Ethernet 4"), so also match the MAC
// prefixes of VirtualBox, Hyper-V, VMware, Parallels, libvirt/KVM, LXD and Docker adapters.
const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:15:5d|00:50:56|00:0c:29|00:05:69|00:1c:14|00:1c:42|02:42|52:54:00|00:16:3e)/i;

function pickLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' && addr.family !== 4) continue;
      if (addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;
      // 100.64.0.0/10 is carrier-grade NAT, used by Tailscale.
      const cgnat = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr.address);
      let score = 0;
      if (addr.address.startsWith('192.168.')) score = 30;
      else if (addr.address.startsWith('10.')) score = 20;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr.address)) score = 10;
      if (cgnat) score -= 40;
      const virtual = VIRTUAL_ADAPTER.test(name) || VIRTUAL_ADAPTER_PREFIX.test(name) || VIRTUAL_MAC.test(addr.mac || '');
      if (virtual) score -= 25;
      candidates.push({ name, address: addr.address, score, virtual: virtual || cgnat });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  // Offer every private, non-virtual address; fall back to the best guess.
  const preferred = candidates.filter(c => !c.virtual && isPrivateIPv4(c.address));
  const offered = preferred.length ? preferred : candidates.slice(0, 1);
  return {
    best: offered[0]?.address || candidates[0]?.address || '127.0.0.1',
    offered: offered.length ? offered : [{ name: 'loopback', address: '127.0.0.1', score: 0 }],
    candidates
  };
}

// The WebSocket endpoint a client derives from the pairing link.
function pairingUrl(address, port, token) {
  return `ws://${address}:${port}/?t=${encodeURIComponent(token)}`;
}

// The pairing link (and QR code): the web client that this server itself serves.
function webPairingUrl(address, port, token) {
  return `http://${address}:${port}/?t=${encodeURIComponent(token)}`;
}

function qrSvgDataUrl(text) {
  try {
    const qrcodeModule = require('qrcode-generator');
    const qrcode = qrcodeModule.default || qrcodeModule;
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch (error) {
    return null;
  }
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

class RemoteControlHost {
  constructor({
    app,
    getMainWindow,
    config = null,
    clipboard = null,
    env = process.env,
    argv = process.argv,
    log = console.log
  }) {
    this.app = app;
    this.getMainWindow = getMainWindow;
    this.config = config;
    this.clipboard = clipboard;
    this.log = log;
    this.forced = isRemoteForced(env, argv);
    const cfg = this.loadConfig();
    this.enabled = this.forced || cfg.remoteControlEnabled === true;
    this.basePort = Number(env.EFFETUNE_REMOTE_PORT) || PORT;
    this.port = this.basePort; // the port actually bound once running
    this.tokenFromEnvironment = typeof env.EFFETUNE_REMOTE_TOKEN === 'string' &&
      env.EFFETUNE_REMOTE_TOKEN.length > 0;
    this.token = this.tokenFromEnvironment ? env.EFFETUNE_REMOTE_TOKEN : this.ensurePersistentToken(cfg);
    this.server = null;
    this.wss = null;
    this.pingTimer = null;
    this.dirtyTimer = null;
    this.startPromise = null;
    this.stopPromise = null;
    this.listenError = null;
    this.listenRetryTimer = null;
    this.portsBusy = false;
    this.lan = null;
    this.rendererReady = false;
    this.readyWaiters = new Set();
    this.pending = new Map();
    this.requestSeq = 0;
    this.dispatchChain = Promise.resolve();
    this.lastSnapshotJson = null;
    this.snapshot = null;
    this.rev = 0;
    this.lastBroadcastAt = 0;
    this.broadcastTimer = null;
    this.pendingOrigin = null;
    this.activeCause = null;
    this.lastCause = null;
    this.listening = false;
    this.panelWindow = null;
    this.disposed = false;
    this.toggleQueue = Promise.resolve();
    activeHost = this;
  }

  // ---- settings ----------------------------------------------------------

  loadConfig() {
    try {
      const cfg = this.config?.loadConfig?.();
      return cfg && typeof cfg === 'object' ? cfg : {};
    } catch (_) {
      return {};
    }
  }

  saveConfigPatch(patch) {
    if (!this.config?.saveConfig) return false;
    const next = { ...this.loadConfig(), ...patch };
    return this.config.saveConfig(next) === true;
  }

  ensurePersistentToken(cfg) {
    if (typeof cfg.remoteControlToken === 'string' && TOKEN_PATTERN.test(cfg.remoteControlToken)) {
      return cfg.remoteControlToken;
    }
    const token = generateToken();
    this.saveConfigPatch({ remoteControlToken: token });
    return token;
  }

  // Toggles run one after another: an "on" that arrived while an "off" was
  // still waiting for the listen to finish would otherwise be swallowed.
  setEnabled(enabled) {
    enabled = enabled === true;
    const run = this.toggleQueue.then(async () => {
      this.saveConfigPatch({ remoteControlEnabled: enabled });
      this.enabled = enabled;
      if (enabled) await this.start();
      else await this.stop();
      return this.getStatus();
    });
    this.toggleQueue = run.catch(() => {});
    return run;
  }

  async regenerateToken() {
    this.token = generateToken();
    this.tokenFromEnvironment = false;
    this.saveConfigPatch({ remoteControlToken: this.token });
    // Clients paired with the old token must pair again.
    if (this.wss) {
      for (const ws of this.wss.clients) {
        try { ws.close(CLOSE_UNAUTHORIZED, 'token-changed'); } catch (_) { /* ignore */ }
      }
    }
    this.emitStatus();
    return this.getStatus();
  }

  getStatus({ withQr = false } = {}) {
    const running = this.listening;
    const lan = this.lan || pickLanAddress();
    const addresses = lan.offered.map(c => {
      const url = pairingUrl(c.address, this.port, this.token);
      const webUrl = webPairingUrl(c.address, this.port, this.token);
      return {
        address: c.address,
        name: c.name,
        url,
        webUrl,
        ...(withQr ? { webQr: qrSvgDataUrl(webUrl) } : {})
      };
    });
    return {
      apiVersion: 1,
      enabled: this.enabled,
      running,
      forced: this.forced,
      port: this.port,
      requestedPort: this.basePort,
      token: this.token,
      tokenFromEnvironment: this.tokenFromEnvironment,
      addresses,
      url: addresses[0]?.url || null,
      webUrl: addresses[0]?.webUrl || null,
      error: this.listenError,
      clients: this.countClients(),
      devices: [...(this.wss?.clients || [])].filter(ws => ws.authenticated).map(ws => ({
        address: ws.remoteAddress || '',
        app: ws.clientInfo?.app ?? null,
        version: ws.clientInfo?.version ?? null,
        build: ws.clientInfo?.build ?? null
      }))
    };
  }

  // What the main-window toolbar icon needs: off / listening / N clients.
  getBriefStatus() {
    return {
      enabled: this.listening,
      wanted: this.enabled,
      port: this.port,
      clients: this.countClients(),
      error: this.listenError
    };
  }

  countClients() {
    let count = 0;
    for (const ws of this.wss?.clients || []) if (ws.authenticated) count += 1;
    return count;
  }

  emitStatus() {
    const win = this.getMainWindow();
    if (win?.webContents && !win.isDestroyed?.()) {
      try { win.webContents.send(CHANNELS.status, this.getBriefStatus()); } catch (_) { /* ignore */ }
    }
    const panel = this.panelWindow;
    if (panel && !panel.isDestroyed()) {
      try { panel.webContents.send(PANEL_CHANNELS.status, this.getStatus({ withQr: true })); } catch (_) { /* ignore */ }
    }
  }

  // ---- server lifecycle --------------------------------------------------

  start() {
    if (!this.enabled || this.disposed) return Promise.resolve(false);
    if (this.startPromise) return this.startPromise;
    const previousStop = this.stopPromise || Promise.resolve();
    this.startPromise = previousStop.then(() => this.listen());
    return this.startPromise;
  }

  listen() {
    if (!this.enabled || this.disposed) {
      this.startPromise = null;
      return false;
    }
    this.clearListenRetry();
    const lan = pickLanAddress();
    this.lan = lan;
    this.listenError = null;
    this.port = this.basePort;
    // Plain http on the same port serves the browser client (remote.html).
    const staticHandler = createStaticHandler({
      root: path.resolve(__dirname, '..'),
      log: (...args) => this.log(...args)
    });
    const server = http.createServer((req, res) => {
      try {
        staticHandler(req, res);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error\n');
      }
    });
    const wss = new WebSocketServer({
      server,
      maxPayload: MAX_WS_BYTES,
      // Browsers always attach Origin to a WebSocket handshake: for those, require a literal/local
      // Host (DNS-rebinding defence) and a same-origin page. Non-browser clients (native
      // apps, scripts) send no Origin and may use any host name (MagicDNS, NetBIOS, ...).
      verifyClient: (info, done) => {
        const { host, origin } = info.req.headers;
        const ok = origin === undefined || (isAllowedHost(host) && isAllowedOrigin(origin, host));
        if (ok) {
          done(true);
        } else {
          this.log(`[remote] refused upgrade from ${info.req.socket.remoteAddress} (host/origin)`);
          done(false, 403, 'Forbidden');
        }
      }
    });
    this.server = server;
    this.wss = wss;
    wss.on('connection', (ws, req) => this.onConnection(ws, req));
    wss.on('error', error => this.log('[remote] wss error:', error.message));
    this.pingTimer = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch (_) { /* ignore */ }
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
    this.dirtyTimer = setInterval(() => this.flushDirtyClients(), STATE_DIRTY_CHECK_MS);
    this.dirtyTimer.unref?.();
    return this.bindWithFallback(server).then(port => {
      if (this.disposed || this.server !== server) return false;
      if (port === null) {
        if (this.portsBusy) this.scheduleListenRetry();
        this.closeServer(server, wss);
        if (this.server === server) { this.server = null; this.wss = null; }
        clearInterval(this.pingTimer);
        this.pingTimer = null;
        clearInterval(this.dirtyTimer);
        this.dirtyTimer = null;
        this.startPromise = null;
        this.emitStatus();
        return false;
      }
      this.port = port;
      // Only advertise the pairing link once the port is actually bound.
      this.listening = true;
      this.log(`[remote] listening on 0.0.0.0:${this.port}`);
      if (lan.candidates.length > 1) {
        this.log('[remote] other addresses: ' +
          lan.candidates.map(c => `${c.address} (${c.name})`).join(', '));
      }
      // Make the renderer publish a fresh snapshot for the new session.
      this.lastSnapshotJson = null;
      this.emitStatus();
      return true;
    });
  }

  // Binds `server`: the requested port first (retried while a previous
  // instance releases it), then the next ports up. Resolves the bound port, or
  // null with this.listenError set.
  async bindWithFallback(server) {
    const stillWanted = () => this.enabled && !this.disposed && this.server === server;
    const tryPort = port => new Promise(resolve => {
      const onError = error => { server.removeListener('listening', onListening); resolve(error); };
      const onListening = () => { server.removeListener('error', onError); resolve(null); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '0.0.0.0');
    });
    const last = Math.min(this.basePort + PORT_FALLBACK_COUNT, 65535);
    this.portsBusy = false;
    for (let port = this.basePort; port <= last; port += 1) {
      for (let attempt = 1; attempt <= PORT_RETRY_ATTEMPTS; attempt += 1) {
        if (!stillWanted()) return null;
        const error = await tryPort(port);
        if (!error) {
          if (port !== this.basePort) {
            this.log(`[remote] port ${this.basePort} is busy; using ${port} instead`);
          }
          return port;
        }
        if (error.code !== 'EADDRINUSE') {
          this.log(`[remote] server error: ${error.code || ''} ${error.message}`);
          this.listenError = String(error.message || error);
          return null;
        }
        this.log(`[remote] port ${port} is in use (attempt ${attempt}/${PORT_RETRY_ATTEMPTS})`);
        // A fallback port is not worth waiting for: a stale instance only
        // holds the requested port.
        if (port !== this.basePort) break;
        if (attempt < PORT_RETRY_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, PORT_RETRY_DELAY_MS));
        }
      }
    }
    this.listenError = `ports ${this.basePort}-${last} are all in use`;
    this.portsBusy = true;
    return null;
  }

  // Whatever held the ports (seen right after Windows boot) usually lets go
  // later, so a busy failure is retried instead of waiting for a manual toggle.
  scheduleListenRetry() {
    this.clearListenRetry();
    if (!this.enabled || this.disposed) return;
    this.listenRetryTimer = setTimeout(() => {
      this.listenRetryTimer = null;
      if (this.enabled && !this.disposed && !this.server && !this.startPromise) void this.start();
    }, LISTEN_RETRY_MS);
    this.listenRetryTimer.unref?.();
  }

  clearListenRetry() {
    clearTimeout(this.listenRetryTimer);
    this.listenRetryTimer = null;
  }

  closeServer(server, wss, { closeCode = 1001, reason = 'shutdown' } = {}) {
    return new Promise(resolve => {
      if (!wss) { resolve(); return; }
      const clients = [...wss.clients];
      for (const ws of clients) {
        try { ws.close(closeCode, reason); } catch (_) { /* ignore */ }
      }
      // wss.close() waits for every client's close handshake (up to 30 s in
      // ws); terminate stragglers so quit is not held up by a sleeping phone.
      const graceTimer = setTimeout(() => {
        for (const ws of clients) {
          try { ws.terminate(); } catch (_) { /* ignore */ }
        }
      }, SHUTDOWN_GRACE_MS);
      graceTimer.unref?.();
      wss.close(() => {
        clearTimeout(graceTimer);
        if (server?.listening) server.close(() => resolve());
        else resolve();
        server?.closeAllConnections?.();
      });
    });
  }

  async stop({ reason = 'remote-disabled' } = {}) {
    if (this.startPromise) {
      try { await this.startPromise; } catch (_) { /* ignore */ }
    }
    this.startPromise = null;
    this.clearListenRetry();
    const server = this.server;
    const wss = this.wss;
    this.server = null;
    this.wss = null;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    clearInterval(this.dirtyTimer);
    this.dirtyTimer = null;
    clearTimeout(this.broadcastTimer);
    this.broadcastTimer = null;
    this.pendingOrigin = null;
    const wasRunning = this.listening;
    this.listening = false;
    // A failed listen is not an error once the switch is off.
    if (!this.enabled || reason === 'shutdown') this.listenError = null;
    if (wasRunning) this.log(`[remote] stopped (${reason})`);
    this.stopPromise = this.closeServer(server, wss, { closeCode: 1001, reason });
    await this.stopPromise;
    this.stopPromise = null;
    this.emitStatus();
  }

  // ---- settings panel ----------------------------------------------------

  openPanel() {
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.show();
      this.panelWindow.focus();
      return this.panelWindow;
    }
    const { BrowserWindow } = require('electron');
    const parent = this.getMainWindow();
    const panel = new BrowserWindow({
      width: 460,
      height: 700,
      minWidth: 360,
      minHeight: 480,
      title: 'Remote Control',
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'remote-control-panel-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    panel.setMenuBarVisibility(false);
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    panel.webContents.on('will-navigate', event => event.preventDefault());
    panel.once('ready-to-show', () => panel.show());
    panel.on('closed', () => {
      if (this.panelWindow === panel) this.panelWindow = null;
    });
    this.panelWindow = panel;
    panel.loadFile(path.join(__dirname, 'remote-control-panel.html')).catch(error => {
      this.log('[remote] panel failed to load:', error?.message || error);
    });
    return panel;
  }

  // Copy button: the main process puts the link of the offered address on the system clipboard
  // (navigator.clipboard needs focus and a permission the panel window does not reliably have).
  copyLink(index) {
    const address = this.getStatus().addresses[Number.isInteger(index) ? index : 0];
    if (!address) return false;
    try {
      (this.clipboard || require('electron').clipboard).writeText(address.webUrl);
      return true;
    } catch (error) {
      this.log('[remote] copy link failed:', error?.message || error);
      return false;
    }
  }

  isPanelSender(sender) {
    return !!this.panelWindow && !this.panelWindow.isDestroyed() && sender === this.panelWindow.webContents;
  }

  // ---- renderer bridge ---------------------------------------------------

  setRendererReady() {
    this.rendererReady = true;
    for (const waiter of [...this.readyWaiters]) waiter(true);
    return { apiVersion: 1, ...this.getBriefStatus() };
  }

  waitForRenderer(ms = RENDERER_WAIT_MS) {
    if (this.rendererReady) return Promise.resolve(true);
    if (this.disposed) return Promise.resolve(false);
    return new Promise(resolve => {
      const waiter = ok => {
        clearTimeout(timer);
        this.readyWaiters.delete(waiter);
        resolve(ok);
      };
      const timer = setTimeout(() => waiter(false), ms);
      this.readyWaiters.add(waiter);
    });
  }

  setRendererUnavailable() {
    this.rendererReady = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'renderer-unavailable' });
      this.pending.delete(id);
    }
    return true;
  }

  handleRendererResponse(response) {
    const pending = this.pending.get(response?.requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    pending.resolve(response);
    return true;
  }

  handleRendererState(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!this.listening) return false;
    this.ingestSnapshot(snapshot);
    return true;
  }

  async request(message, timeoutMs = REQUEST_TIMEOUT_MS) {
    // Clients that connect during startup or a window reload wait for the
    // renderer instead of failing immediately.
    if (!this.rendererReady && !(await this.waitForRenderer())) {
      return { ok: false, error: 'renderer-unavailable' };
    }
    const win = this.getMainWindow();
    if (!this.rendererReady || !win?.webContents || win.isDestroyed?.()) {
      return { ok: false, error: 'renderer-unavailable' };
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return { ok: false, error: 'busy' };
    }
    const requestId = `r${++this.requestSeq}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      this.pending.set(requestId, { resolve, timer });
      try {
        win.webContents.send(CHANNELS.request, { requestId, message });
      } catch (_) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ ok: false, error: 'renderer-unavailable' });
      }
    });
  }

  // Serialise operations so overlapping chain replacements cannot interleave.
  // `cause` ({ ws, seq }) attributes the pipeline changes of a mutating
  // command to the client that sent it.
  enqueue(message, { cause = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const run = this.dispatchChain.then(async () => {
      if (cause) this.activeCause = cause;
      try {
        const result = await this.request(message, timeoutMs);
        if (result.snapshot && this.listening) {
          this.ingestSnapshot(result.snapshot, cause || undefined);
        }
        return result;
      } finally {
        if (cause) {
          this.activeCause = null;
          this.lastCause = { ...cause, at: Date.now() };
        }
      }
    });
    this.dispatchChain = run.catch(() => {});
    return run;
  }

  // ---- state -------------------------------------------------------------

  resolveCause(cause) {
    if (cause !== undefined) return cause;
    if (this.activeCause) return this.activeCause;
    if (this.lastCause && Date.now() - this.lastCause.at <= ORIGIN_WINDOW_MS) return this.lastCause;
    return null;
  }

  mergePendingOrigin(cause) {
    const next = cause ? { local: false, ws: cause.ws, seq: cause.seq } : { local: true };
    const current = this.pendingOrigin;
    if (!current) this.pendingOrigin = next;
    else if (current.local || next.local) this.pendingOrigin = { local: true };
    else if (current.ws !== next.ws) this.pendingOrigin = { local: false, ws: null, seq: undefined };
    else this.pendingOrigin = next; // same client: the latest command covers the earlier ones
  }

  ingestSnapshot(snapshot, cause) {
    const next = {
      masterBypass: !!snapshot.masterBypass,
      pipeline: Array.isArray(snapshot.pipeline) ? snapshot.pipeline : [],
      ids: Array.isArray(snapshot.ids) ? snapshot.ids : [],
      slot: snapshot.slot === 'B' ? 'B' : 'A',
      epoch: typeof snapshot.epoch === 'string' ? snapshot.epoch : ''
    };
    // Ids, slot and epoch take part in the comparison: re-creating identical
    // content (a preset load) must still reach clients, because every id is new.
    const json = JSON.stringify(next);
    if (json === this.lastSnapshotJson) return false;
    const baseline = this.lastSnapshotJson === null;
    this.lastSnapshotJson = json;
    this.snapshot = next;
    this.rev += 1;
    // The session's first snapshot is a baseline, not anyone's change: it must not turn a client
    // command coalesced with it into a "local" one. Broadcast alone it still reads as local.
    if (!baseline) this.mergePendingOrigin(this.resolveCause(cause));
    this.scheduleBroadcast();
    return true;
  }

  stateMessage(extra = {}) {
    return {
      op: 'state',
      rev: this.rev,
      app: this.app.getVersion(),
      masterBypass: this.snapshot ? this.snapshot.masterBypass : false,
      pipeline: this.snapshot ? this.snapshot.pipeline : [],
      epoch: this.snapshot ? this.snapshot.epoch : '',
      ids: this.snapshot ? this.snapshot.ids : [],
      slot: this.snapshot ? this.snapshot.slot : 'A',
      host: os.hostname(),
      ...extra
    };
  }

  scheduleBroadcast() {
    if (this.broadcastTimer || !this.wss) return;
    const wait = Math.max(0, STATE_MIN_INTERVAL_MS - (Date.now() - this.lastBroadcastAt));
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.lastBroadcastAt = Date.now();
      this.broadcastState();
    }, wait);
  }

  broadcastState() {
    if (!this.wss) return;
    const origin = this.pendingOrigin || { local: true };
    this.pendingOrigin = null;
    const base = this.stateMessage({ origin: origin.local ? 'local' : 'remote' });
    const plain = JSON.stringify(base);
    for (const ws of this.wss.clients) {
      if (!ws.authenticated || ws.readyState !== 1) continue;
      // A client that cannot keep up skips this push and gets the latest state
      // once it has drained (flushDirtyClients); full states supersede each other.
      const own = !origin.local && origin.ws === ws && origin.seq !== undefined;
      if (ws.bufferedAmount > STATE_HIGH_WATER_BYTES) {
        // Remember whose change the coalesced state will carry: still this
        // client's own command only while every skipped push was just that.
        if (!ws.stateDirty) ws.dirtyCause = { ownSeq: own ? origin.seq : null, local: !!origin.local };
        else {
          const cause = ws.dirtyCause || { ownSeq: null, local: false };
          ws.dirtyCause = { ownSeq: own && cause.ownSeq !== null ? origin.seq : null, local: cause.local || !!origin.local };
        }
        ws.stateDirty = true;
        continue;
      }
      // seq only goes to the client that sent the command; for everyone else
      // the change is external.
      if (own) {
        ws.send(JSON.stringify({ ...base, seq: origin.seq }));
      } else {
        ws.send(plain);
      }
      ws.stateDirty = false;
      ws.dirtyCause = null;
    }
  }

  flushDirtyClients() {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      if (!ws.stateDirty || !ws.authenticated || ws.readyState !== 1) continue;
      if (ws.bufferedAmount > STATE_DRAIN_BYTES) continue;
      ws.stateDirty = false;
      const cause = ws.dirtyCause;
      ws.dirtyCause = null;
      if (cause && cause.ownSeq !== null && !cause.local) {
        // Only this client's own command was coalesced: it must see its echo as
        // such (same origin and seq as an undelayed push), not as a remote change.
        ws.send(JSON.stringify(this.stateMessage({ origin: 'remote', seq: cause.ownSeq })));
        continue;
      }
      ws.send(JSON.stringify(this.stateMessage({ origin: 'remote' })));
    }
  }

  // ---- websocket ---------------------------------------------------------

  onConnection(ws, req) {
    let supplied = '';
    try {
      supplied = new URL(req.url || '/', 'http://localhost').searchParams.get('t') || '';
    } catch (_) { /* ignore */ }
    const a = Buffer.from(supplied);
    const b = Buffer.from(this.token);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      this.log(`[remote] rejected connection from ${req.socket.remoteAddress} (bad token)`);
      ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
      return;
    }
    if (this.countClients() >= MAX_CLIENTS) {
      ws.close(1013, 'too many clients');
      return;
    }
    ws.authenticated = true;
    ws.remoteAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    ws.isAlive = true;
    ws.uploads = new Map();
    ws.sync = false;
    ws.stateDirty = false;
    this.log(`[remote] client connected: ${req.socket.remoteAddress}`);
    this.emitStatus();
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.on('close', () => {
      ws.uploads.clear();
      this.log(`[remote] client disconnected: ${req.socket.remoteAddress}`);
      this.emitStatus();
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onMessage(ws, data.toString('utf8')).catch(error => {
        this.log('[remote] message error:', error?.message || error);
      });
    });
  }

  send(ws, message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  ack(ws, seq, ok, error, extra) {
    if (seq === undefined) return;
    this.send(ws, ok
      ? { op: 'ack', seq, ok: true, ...extra }
      : { op: 'ack', seq, ok: false, error: String(error || 'error') });
  }

  async onMessage(ws, text) {
    let msg;
    try { msg = JSON.parse(text); } catch (_) {
      this.send(ws, { op: 'ack', ok: false, error: 'invalid-json' });
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      this.send(ws, { op: 'ack', ok: false, error: 'invalid-message' });
      return;
    }
    const seq = Number.isSafeInteger(msg.seq) ? msg.seq : undefined;
    const op = msg.op;
    if (!CLIENT_OPS.has(op)) {
      this.ack(ws, seq, false, `unknown-op: ${String(op).slice(0, 32)}`);
      return;
    }
    if (op === 'hello' && msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
      this.ack(ws, seq, false, `unsupported-version: ${String(msg.v).slice(0, 16)}`);
      return;
    }
    if (op === 'hello') {
      ws.clientInfo = {
        app: cleanClientText(msg.app),
        version: cleanClientText(msg.version),
        build: cleanClientText(msg.build)
      };
      // sync1 clients are also told when the stored presets change.
      ws.sync = msg.sync === 1;
      this.emitStatus();
    }
    if (op === 'putIR') {
      await this.onPutIrChunk(ws, msg, seq);
      return;
    }
    if (op === 'getIR') {
      await this.onGetIr(ws, msg, seq);
      return;
    }

    const cause = MUTATING_OPS.has(op) ? { ws, seq } : null;
    const result = await this.enqueue(msg, { cause });
    if (!result.ok) {
      this.ack(ws, seq, false, result.error);
      return;
    }
    this.ack(ws, seq, true, undefined, MUTATING_OPS.has(op)
      ? { rev: this.rev, ...(result.skipped?.length ? { skipped: result.skipped } : {}) }
      : undefined);
    const seqField = seq === undefined ? {} : { seq };
    switch (op) {
      case 'hello':
        this.send(ws, this.stateMessage({
          origin: 'remote',
          features: FEATURES,
          appName: APP_NAME,
          ...(cleanEffectNames(result.effects) ? { effects: cleanEffectNames(result.effects) } : {}),
          ...seqField
        }));
        break;
      case 'get':
        this.send(ws, this.stateMessage({ origin: 'remote', ...seqField }));
        break;
      case 'listPresets':
        this.send(ws, { op: 'presets', names: result.names || [], ...seqField });
        break;
      case 'getPreset':
        this.send(ws, {
          op: 'preset', name: result.name, pipeline: result.pipeline || [], ...seqField
        });
        break;
      case 'listIRs':
        this.send(ws, { op: 'irs', items: result.items || [], ...seqField });
        break;
      case 'presets':
        this.send(ws, { op: 'presets', presets: result.presets || {}, ...seqField });
        break;
      default:
        break;
    }
  }

  // The renderer persisted the preset list (any client or the host user did).
  handlePresetsChanged() {
    if (!this.wss) return false;
    const message = JSON.stringify({ op: 'presetsChanged' });
    for (const ws of this.wss.clients) {
      if (ws.authenticated && ws.sync && ws.readyState === 1) ws.send(message);
    }
    return true;
  }

  // ---- IR transfer -------------------------------------------------------

  async onGetIr(ws, msg, seq) {
    if (typeof msg.id !== 'string' || !IR_ID_PATTERN.test(msg.id)) {
      this.ack(ws, seq, false, 'invalid id');
      return;
    }
    const result = await this.enqueue({ op: 'getIR', id: msg.id }, { timeoutMs: IR_REQUEST_TIMEOUT_MS });
    if (!result.ok) {
      this.ack(ws, seq, false, result.error);
      return;
    }
    const data = result.data;
    if (!(data instanceof Uint8Array)) {
      this.ack(ws, seq, false, 'ir unreadable');
      return;
    }
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const total = Math.max(1, Math.ceil(buffer.length / IR_CHUNK_BYTES));
    const seqField = seq === undefined ? {} : { seq };
    for (let index = 0; index < total; index += 1) {
      if (ws.readyState !== 1) return;
      while (ws.bufferedAmount > SEND_HIGH_WATER_BYTES && ws.readyState === 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const part = buffer.subarray(index * IR_CHUNK_BYTES, (index + 1) * IR_CHUNK_BYTES);
      this.send(ws, {
        op: 'irChunk',
        id: msg.id,
        name: result.name,
        ext: result.ext,
        index,
        total,
        bytes: buffer.length,
        data: part.toString('base64'),
        ...seqField
      });
    }
    this.ack(ws, seq, true);
  }

  async onPutIrChunk(ws, msg, seq) {
    const fail = (error, id = msg.id) => {
      if (typeof id === 'string') ws.uploads.delete(id);
      this.ack(ws, seq, false, error);
    };
    const { id, index, total, bytes, data } = msg;
    if (typeof id !== 'string' || !IR_ID_PATTERN.test(id)) return fail('invalid id', null);
    if (!Number.isSafeInteger(total) || total < 1 || total > IR_MAX_CHUNKS) return fail('invalid total');
    if (!Number.isSafeInteger(index) || index < 0 || index >= total) return fail('invalid index');
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > IR_MAX_BYTES) return fail('invalid bytes');
    if (typeof data !== 'string' || data.length > Math.ceil(IR_CHUNK_BYTES / 3) * 4 + 4) {
      return fail('invalid data');
    }
    const part = Buffer.from(data, 'base64');
    if (part.length > IR_CHUNK_BYTES) return fail('chunk too large');

    if (index === 0) {
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 512) : '';
      const ext = typeof msg.ext === 'string' ? msg.ext.trim().replace(/^\./, '').toLowerCase() : '';
      if (!name) return fail('name must be a non-empty string');
      if (!/^[a-z0-9]{1,10}$/.test(ext)) return fail('invalid ext');
      if (!ws.uploads.has(id) && ws.uploads.size >= MAX_UPLOADS_PER_CLIENT) return fail('too many uploads');
      ws.uploads.set(id, { name, ext, total, bytes, parts: [], received: 0, next: 0 });
    }
    const upload = ws.uploads.get(id);
    if (!upload) return fail('upload not started (send index 0 first)');
    if (index !== upload.next || total !== upload.total || bytes !== upload.bytes) {
      return fail('chunk out of order');
    }
    if (upload.received + part.length > upload.bytes) return fail('size mismatch');
    upload.parts.push(part);
    upload.received += part.length;
    upload.next += 1;
    if (index < total - 1) {
      this.ack(ws, seq, true);
      return undefined;
    }
    ws.uploads.delete(id);
    if (upload.received !== upload.bytes) return fail('size mismatch');
    const joined = Buffer.concat(upload.parts, upload.received);
    const result = await this.enqueue({
      op: 'putIR',
      id,
      name: upload.name,
      ext: upload.ext,
      data: new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength)
    }, { timeoutMs: IR_REQUEST_TIMEOUT_MS });
    this.ack(ws, seq, result.ok === true, result.error);
    return undefined;
  }

  // ---- lifecycle ---------------------------------------------------------

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (activeHost === this) activeHost = null;
    this.setRendererUnavailable();
    for (const waiter of [...this.readyWaiters]) waiter(false);
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      try { this.panelWindow.destroy(); } catch (_) { /* ignore */ }
    }
    await this.stop({ reason: 'shutdown' });
  }
}

function openRemoteControlPanel() {
  return activeHost ? activeHost.openPanel() : null;
}

function registerRemoteControlIpc({ ipcMain, getHost, getMainWindow }) {
  const handlers = new Map([
    [CHANNELS.rendererReady, host => (host ? host.setRendererReady() : { enabled: false })],
    [CHANNELS.rendererUnavailable, host => (host ? host.setRendererUnavailable() : false)],
    [CHANNELS.response, (host, response) => (host ? host.handleRendererResponse(response) : false)],
    [CHANNELS.state, (host, snapshot) => (host ? host.handleRendererState(snapshot) : false)],
    [CHANNELS.presetsChanged, host => (host ? host.handlePresetsChanged() : false)],
    [CHANNELS.openPanel, host => { host?.openPanel(); return !!host; }],
    [CHANNELS.getStatus, host => (host ? host.getBriefStatus() : { enabled: false })]
  ]);
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getMainWindow();
      if (!window?.webContents || event.sender !== window.webContents) {
        throw new Error('invalid-sender');
      }
      return handler(getHost(), ...args);
    });
  }
  const panelHandlers = new Map([
    [PANEL_CHANNELS.getStatus, host => host.getStatus({ withQr: true })],
    [PANEL_CHANNELS.setEnabled, async (host, enabled) => {
      await host.setEnabled(enabled === true);
      return host.getStatus({ withQr: true });
    }],
    [PANEL_CHANNELS.regenerateToken, async host => {
      await host.regenerateToken();
      return host.getStatus({ withQr: true });
    }],
    [PANEL_CHANNELS.copyLink, (host, index) => host.copyLink(index)]
  ]);
  for (const [channel, handler] of panelHandlers) {
    ipcMain.handle(channel, (event, ...args) => {
      const host = getHost();
      if (!host || !host.isPanelSender(event.sender)) throw new Error('invalid-sender');
      return handler(host, ...args);
    });
  }
  return () => {
    for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
    for (const channel of panelHandlers.keys()) ipcMain.removeHandler(channel);
  };
}

module.exports = {
  CHANNELS,
  PANEL_CHANNELS,
  PORT,
  IR_CHUNK_BYTES,
  RemoteControlHost,
  isRemoteForced,
  openRemoteControlPanel,
  pairingUrl,
  pickLanAddress,
  registerRemoteControlIpc,
  webPairingUrl
};
