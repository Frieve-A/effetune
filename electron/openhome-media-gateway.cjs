const crypto = require('node:crypto');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { pipeline } = require('node:stream');

const LOOPBACK_HOST = '127.0.0.1';
const MEDIA_PATH_PREFIX = '/openhome-media/';
const MAX_URI_LENGTH = 8192;
const MAX_ACTIVE_STREAMS = 4;
const MAX_REGISTERED_URIS = 4096;
const DNS_LOOKUP_TIMEOUT_MS = 5000;
const UPSTREAM_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;
const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;

const FORBIDDEN_ADDRESS_BLOCKLIST = createForbiddenAddressBlockList();

const FORWARDED_RESPONSE_HEADERS = Object.freeze([
  'accept-ranges',
  'cache-control',
  'contentfeatures.dlna.org',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'transfermode.dlna.org'
]);

const MEDIA_RENDERER_REQUEST_HEADERS = Object.freeze({
  'accept-encoding': 'identity',
  'getcontentFeatures.dlna.org': '1',
  'transferMode.dlna.org': 'Streaming',
  'User-Agent': 'EffeTune/1.0 UPnP/1.0 DLNADOC/1.50'
});

class OpenHomeMediaGateway {
  constructor({
    serverFactory = handler => http.createServer(handler),
    httpRequest = http.request,
    httpsRequest = https.request,
    dnsLookup = dns.promises.lookup,
    randomBytes = crypto.randomBytes,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onDiagnostic = () => {}
  } = {}) {
    this.serverFactory = serverFactory;
    this.httpRequest = httpRequest;
    this.httpsRequest = httpsRequest;
    this.dnsLookup = dnsLookup;
    this.randomBytes = randomBytes;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onDiagnostic = onDiagnostic;
    this.registrations = new Map();
    this.server = null;
    this.startPromise = null;
    this.port = 0;
    this.activeStreams = 0;
    this.activeRequests = new Set();
  }

  async register(uri) {
    const target = normalizeMediaUri(uri);
    if (this.registrations.size >= MAX_REGISTERED_URIS) {
      throw createGatewayError('registration-limit');
    }
    await this.ensureStarted();
    const token = this.createToken();
    this.registrations.set(token, { target });
    return Object.freeze({
      token,
      playbackUrl: `http://${LOOPBACK_HOST}:${this.port}${MEDIA_PATH_PREFIX}${token}`
    });
  }

  release(token) {
    if (typeof token !== 'string') return false;
    return this.registrations.delete(token);
  }

  async ensureStarted() {
    if (this.server?.listening) return;
    if (this.startPromise) return this.startPromise;

    const server = this.serverFactory((request, response) => {
      void this.handleRequest(request, response);
    });
    server.maxHeadersCount = 32;
    server.requestTimeout = UPSTREAM_TIMEOUT_MS;
    server.headersTimeout = UPSTREAM_TIMEOUT_MS;
    this.server = server;
    this.startPromise = new Promise((resolve, reject) => {
      const fail = error => {
        server.removeListener('listening', ready);
        this.server = null;
        this.startPromise = null;
        reject(error);
      };
      const ready = () => {
        server.removeListener('error', fail);
        const address = server.address();
        this.port = Number(address?.port) || 0;
        this.startPromise = null;
        resolve();
      };
      server.once('error', fail);
      server.once('listening', ready);
      server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true });
    });
    return this.startPromise;
  }

  async handleRequest(request, response) {
    setCorsHeaders(response);
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Range');
      response.end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendPlainError(response, 405);
      return;
    }

    const token = readToken(request.url);
    const registration = token ? this.registrations.get(token) : null;
    if (!registration) {
      sendPlainError(response, 404);
      return;
    }
    if (this.activeStreams >= MAX_ACTIVE_STREAMS) {
      sendPlainError(response, 503);
      return;
    }

    const context = this.createRequestContext(response);
    this.activeStreams += 1;
    try {
      await this.proxy(request, response, registration.target, MAX_REDIRECTS, context);
    } catch (error) {
      if (error?.code === 'gateway-closed') {
        response.destroy?.();
      } else {
        this.onDiagnostic(String(error?.code || error?.name || 'gateway-failed').slice(0, 64));
        if (!response.headersSent) sendPlainError(response, 502);
        else response.destroy();
      }
    } finally {
      this.finishRequestContext(context);
    }
  }

  async proxy(clientRequest, clientResponse, target, redirectsRemaining, context) {
    const pinnedAddress = await this.resolveTargetAddress(target, context);
    return new Promise((resolve, reject) => {
      const requestImpl = target.protocol === 'https:' ? this.httpsRequest : this.httpRequest;
      const headers = { ...MEDIA_RENDERER_REQUEST_HEADERS };
      if (typeof clientRequest.headers?.range === 'string') {
        headers.range = clientRequest.headers.range.slice(0, 256);
      }
      if (typeof clientRequest.headers?.accept === 'string') {
        headers.accept = clientRequest.headers.accept.slice(0, 512);
      }
      const upstreamRequest = requestImpl(target, {
        method: clientRequest.method,
        headers,
        lookup: createPinnedLookup(pinnedAddress),
        maxHeaderSize: MAX_RESPONSE_HEADER_BYTES
      }, upstreamResponse => {
        context.upstreamResponse = upstreamResponse;
        const statusCode = Number(upstreamResponse.statusCode) || 502;
        const location = upstreamResponse.headers.location;
        if (isRedirectStatus(statusCode) && location) {
          upstreamRequest.removeListener('error', handleRequestError);
          discardUpstream(upstreamRequest, upstreamResponse);
          context.upstreamRequest = null;
          context.upstreamResponse = null;
          if (redirectsRemaining <= 0) {
            reject(createGatewayError('redirect-limit'));
            return;
          }
          let redirectedTarget;
          try {
            redirectedTarget = normalizeMediaUri(new URL(location, target).href);
          } catch (_) {
            reject(createGatewayError('invalid-redirect'));
            return;
          }
          this.proxy(clientRequest, clientResponse, redirectedTarget, redirectsRemaining - 1, context)
            .then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          this.onDiagnostic(`upstream-http-${statusCode}`);
        }
        clientResponse.statusCode = statusCode;
        for (const header of FORWARDED_RESPONSE_HEADERS) {
          const value = upstreamResponse.headers[header];
          if (value !== undefined) clientResponse.setHeader(header, value);
        }
        setCorsHeaders(clientResponse);
        if (clientRequest.method === 'HEAD') {
          upstreamResponse.resume();
          clientResponse.end();
          context.upstreamRequest = null;
          context.upstreamResponse = null;
          resolve();
          return;
        }
        pipeline(upstreamResponse, clientResponse, error => {
          context.upstreamRequest = null;
          context.upstreamResponse = null;
          if (error) reject(error);
          else resolve();
        });
      });
      const handleRequestError = error => {
        context.upstreamRequest = null;
        context.upstreamResponse = null;
        reject(error);
      };
      context.upstreamRequest = upstreamRequest;
      upstreamRequest.once('error', handleRequestError);
      upstreamRequest.setTimeout?.(UPSTREAM_TIMEOUT_MS, () => {
        upstreamRequest.destroy(createGatewayError('upstream-timeout'));
      });
      upstreamRequest.end();
    });
  }

  async resolveTargetAddress(target, context) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = this.setTimer(() => reject(createGatewayError('dns-timeout')), DNS_LOOKUP_TIMEOUT_MS);
      timer?.unref?.();
    });
    try {
      return await Promise.race([
        resolveTargetAddress(target, this.dnsLookup),
        timeout,
        context.cancelled
      ]);
    } finally {
      if (timer) this.clearTimer(timer);
    }
  }

  createRequestContext(clientResponse) {
    let rejectCancelled;
    let resolveDone;
    let cancelled = false;
    let listenersAttached = false;
    const detachClientResponseListeners = () => {
      if (!listenersAttached) return;
      listenersAttached = false;
      clientResponse.removeListener?.('close', handleClientResponseClose);
      clientResponse.removeListener?.('finish', detachClientResponseListeners);
    };
    const handleClientResponseClose = () => {
      detachClientResponseListeners();
      context.cancel();
    };
    const context = {
      clientResponse,
      upstreamRequest: null,
      upstreamResponse: null,
      cancelled: new Promise((_, reject) => { rejectCancelled = reject; }),
      done: new Promise(resolve => { resolveDone = resolve; }),
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        detachClientResponseListeners();
        const error = createGatewayError('gateway-closed');
        rejectCancelled(error);
        context.upstreamRequest?.destroy?.(error);
        context.upstreamResponse?.destroy?.(error);
        context.clientResponse.destroy?.();
      },
      detachClientResponseListeners,
      finish: resolveDone
    };
    clientResponse.once?.('close', handleClientResponseClose);
    clientResponse.once?.('finish', detachClientResponseListeners);
    listenersAttached = true;
    this.activeRequests.add(context);
    return context;
  }

  finishRequestContext(context) {
    if (!this.activeRequests.delete(context)) return;
    context.detachClientResponseListeners();
    context.upstreamRequest = null;
    context.upstreamResponse = null;
    this.activeStreams = Math.max(0, this.activeStreams - 1);
    context.finish();
  }

  createToken() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = this.randomBytes(24).toString('base64url');
      if (!this.registrations.has(token)) return token;
    }
    throw createGatewayError('token-generation-failed');
  }

  close() {
    this.registrations.clear();
    this.port = 0;
    const activeRequests = [...this.activeRequests];
    for (const context of activeRequests) context.cancel();
    const server = this.server;
    this.server = null;
    this.startPromise = null;
    const serverClosed = !server?.listening
      ? Promise.resolve()
      : new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
    return Promise.all([serverClosed, ...activeRequests.map(context => context.done)])
      .then(() => {});
  }
}

function discardUpstream(request, response) {
  response.resume?.();
  response.destroy?.();
  request.destroy?.();
}

function normalizeMediaUri(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH) {
    throw createGatewayError('invalid-uri');
  }
  let target;
  try {
    target = new URL(uri);
  } catch (_) {
    throw createGatewayError('invalid-uri');
  }
  if ((target.protocol !== 'http:' && target.protocol !== 'https:') ||
      target.username || target.password || !target.hostname) {
    throw createGatewayError('invalid-uri');
  }
  target.hash = '';
  return target;
}

async function resolveTargetAddress(target, dnsLookup) {
  const hostname = unwrapHostname(target.hostname);
  const literalFamily = net.isIP(hostname);
  let addresses;
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    const result = await dnsLookup(hostname, { all: true, verbatim: true });
    addresses = Array.isArray(result) ? result : [result];
  }

  for (const entry of addresses) {
    const address = typeof entry?.address === 'string' ? entry.address : '';
    const family = net.isIP(address);
    if (family && !FORBIDDEN_ADDRESS_BLOCKLIST.check(address, family === 4 ? 'ipv4' : 'ipv6')) {
      return { address, family };
    }
  }
  throw createGatewayError('address-not-allowed');
}

function unwrapHostname(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function createPinnedLookup({ address, family }) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options?.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function createForbiddenAddressBlockList() {
  const blockList = new net.BlockList();
  for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ]) {
    blockList.addSubnet(address, prefix, 'ipv4');
  }
  for (const [address, prefix] of [
    ['::', 96],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
    ['::ffff:0.0.0.0', 104],
    ['::ffff:127.0.0.0', 104],
    ['::ffff:169.254.0.0', 112],
    ['::ffff:224.0.0.0', 100],
    ['::ffff:240.0.0.0', 100]
  ]) {
    blockList.addSubnet(address, prefix, 'ipv6');
  }
  return blockList;
}

function readToken(requestUrl) {
  if (typeof requestUrl !== 'string' || !requestUrl.startsWith(MEDIA_PATH_PREFIX)) return '';
  const token = requestUrl.slice(MEDIA_PATH_PREFIX.length);
  return /^[A-Za-z0-9_-]{32}$/.test(token) ? token : '';
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type');
}

function sendPlainError(response, statusCode) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end('Media stream unavailable.');
}

function isRedirectStatus(statusCode) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 ||
    statusCode === 307 || statusCode === 308;
}

function createGatewayError(code) {
  const error = new Error('OpenHome media gateway request failed');
  error.code = code;
  return error;
}

module.exports = {
  DNS_LOOKUP_TIMEOUT_MS,
  LOOPBACK_HOST,
  MAX_ACTIVE_STREAMS,
  MAX_REDIRECTS,
  MEDIA_PATH_PREFIX,
  OpenHomeMediaGateway,
  normalizeMediaUri
};
