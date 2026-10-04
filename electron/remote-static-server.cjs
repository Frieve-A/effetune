'use strict';

// Serves the EffeTune web client (remote.html and the files it loads) on the
// remote-v1 port, so a phone or another computer can open it over plain http
// and connect to the WebSocket of the same origin. An HTTPS page (the hosted
// web version) cannot open ws:// to a LAN address, which is why the desktop app
// serves the page itself.
//
// Only the files the web version already precaches (sw-precache.js) are served:
// they are public application code, so no token is needed for them. The
// WebSocket still requires the token.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.effetune_preset', 'application/json; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.json5', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);
const ENTRY = 'remote.html';
// Registered by the hosted web version only; useless (and misleading) here.
const EXCLUDED = new Set(['effetune.html', 'sw.js', 'sw-precache.js', 'manifest.json']);

// DNS-rebinding defence: a page on evil.example whose name resolves to the
// LAN address would send "Host: evil.example", so only literal addresses and
// local names are accepted.
const IPV4_HOST = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/i;
const LOCAL_NAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+local$/i;

// Returns the lower-cased "host[:port]" if `header` is acceptable, else null.
function parseAllowedHost(header) {
  if (typeof header !== 'string' || header.length === 0 || header.length > 270) return null;
  let host = header;
  let port = '';
  const bracket = host.startsWith('[') ? host.indexOf(']') : -1;
  if (bracket >= 0) {
    port = host.slice(bracket + 1);
    host = host.slice(0, bracket + 1);
    if (port && !/^:\d{1,5}$/.test(port)) return null;
  } else if (host.includes(':')) {
    const at = host.lastIndexOf(':');
    port = host.slice(at);
    host = host.slice(0, at);
    if (!/^:\d{1,5}$/.test(port)) return null;
  }
  if (port && Number(port.slice(1)) > 65535) return null;
  const lower = host.toLowerCase();
  const ok = IPV4_HOST.test(lower) ? lower.split('.').every(part => Number(part) <= 255)
    : lower === 'localhost' || IPV6_HOST.test(lower) || LOCAL_NAME.test(lower);
  return ok ? lower + port : null;
}

function isAllowedHost(header) {
  return parseAllowedHost(header) !== null;
}

// An http(s) Origin must be this very server (same-origin page). A missing
// Origin is a non-browser client (native apps, tests) and is allowed; the
// literal "null" (sandboxed iframe, file:) and any other scheme are not.
function isAllowedOrigin(origin, hostHeader) {
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  const host = parseAllowedHost(hostHeader);
  return host !== null && origin.toLowerCase() === `http://${host}`;
}

function loadAllowlist(root) {
  let urls = [];
  try {
    const source = fs.readFileSync(path.join(root, 'sw-precache.js'), 'utf8');
    const sandbox = { self: {} };
    vm.runInNewContext(source, sandbox, { timeout: 1000 });
    if (Array.isArray(sandbox.self.EFFECTUNE_PRECACHE_URLS)) urls = sandbox.self.EFFECTUNE_PRECACHE_URLS;
  } catch (_) { /* no precache list: nothing is served */ }
  const allowed = new Set();
  for (const url of urls) {
    if (typeof url !== 'string') continue;
    const rel = url.replace(/^\.\//, '');
    if (!EXCLUDED.has(rel)) allowed.add(rel);
  }
  return allowed;
}

function resolveRelativePath(rawUrl) {
  const raw = String(rawUrl || '/').split(/[?#]/)[0];
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch (_) { return { status: 400 }; }
  if (decoded.includes('\\') || decoded.includes('\0')) return { status: 404 };
  const segments = decoded.split('/').filter((segment, index) => index === 0 || segment !== '');
  if (segments.some(segment => segment === '..' || segment === '.')) return { status: 404 };
  const rel = segments.join('/').replace(/^\//, '');
  return { rel: rel === '' ? ENTRY : rel };
}

function createStaticHandler({ root, log = () => {} }) {
  const allowed = loadAllowlist(root);
  if (!allowed.has(ENTRY)) log(`[remote] ${ENTRY} is missing from the precache list; the browser client is unavailable`);

  function reply(res, status, headers, body) {
    res.writeHead(status, {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...headers
    });
    res.end(body);
  }

  const handler = (req, res) => {
    const host = parseAllowedHost(req.headers.host);
    if (!host) { reply(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden\n'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply(res, 405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }, 'Method Not Allowed\n');
      return;
    }
    const resolved = resolveRelativePath(req.url);
    if (resolved.status) { reply(res, resolved.status, { 'Content-Type': 'text/plain' }, 'Not Found\n'); return; }
    const { rel } = resolved;
    if (!allowed.has(rel)) { reply(res, 404, { 'Content-Type': 'text/plain' }, 'Not Found\n'); return; }
    fs.promises.readFile(path.join(root, rel)).then(data => {
      const headers = {
        'Content-Type': MIME_TYPES.get(path.extname(rel).toLowerCase()) || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache'
      };
      if (rel === ENTRY) headers['Content-Security-Policy'] = `connect-src 'self' ws://${host}`;
      reply(res, 200, headers, req.method === 'HEAD' ? undefined : data);
    }).catch(() => {
      reply(res, 404, { 'Content-Type': 'text/plain' }, 'Not Found\n');
    });
  };
  handler.allowed = allowed;
  return handler;
}

module.exports = {
  ENTRY,
  createStaticHandler,
  isAllowedHost,
  isAllowedOrigin,
  parseAllowedHost,
  resolveRelativePath
};
