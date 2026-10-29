'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { REMOTE_CONTROL, SsdpAdvertisement, xml, isLanAddress } = require('./network-music-upnp.cjs');
const { isAllowedHost } = require('./remote-static-server.cjs');

const DESCRIPTION_PATH = '/.well-known/effetune/remote-control.xml';
const REQUEST_PATH = '/.well-known/effetune/pair';
const REQUEST_TIMEOUT_MS = 60000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

function reply(res, statusCode, result) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(result);
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

class RemotePairingHost {
  constructor({ discovery, getInfo, approve, onDiagnostic = () => {}, timeoutMs = REQUEST_TIMEOUT_MS, cooldownMs = 5000 }) {
    Object.assign(this, { getInfo, approve, onDiagnostic, timeoutMs, cooldownMs });
    this.discovery = discovery;
    this.id = `uuid:${crypto.randomUUID()}`;
    this.pending = null;
    this.nextPromptAt = 0;
    this.advertisement = discovery && new SsdpAdvertisement({
      discovery,
      getDescription: () => {
        const info = getInfo();
        return info.running && info.playerId ? { id: this.id, targets: [REMOTE_CONTROL], location: address => `${info.endpoint || `${info.secure ? 'https' : 'http'}://${address}:${info.port}`}${DESCRIPTION_PATH}` } : null;
      },
      onDiagnostic
    });
  }

  async start() {
    if (!this.discovery) return;
    await this.discovery.start();
    if (this.getInfo().running) this.advertisement.start();
  }

  stop() {
    this.advertisement?.stop();
    this.pending?.finish('unavailable');
  }

  dispose() { this.stop(); this.advertisement?.dispose(); }

  handle(req, res) {
    const route = req.url?.split('?')[0];
    if (route !== DESCRIPTION_PATH && route !== REQUEST_PATH) return false;
    const address = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    const info = this.getInfo();
    if (!info.running || !info.playerId) { reply(res, 503, { status: 'unavailable' }); return true; }
    if (!isLanAddress(address || '') || !(info.allowedHost ? info.allowedHost(req.headers.host) : isAllowedHost(req.headers.host))) { reply(res, 403, { status: 'unavailable' }); return true; }
    if (route === DESCRIPTION_PATH) {
      if (req.method !== 'GET') { reply(res, 405, { status: 'unavailable' }); return true; }
      const body = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:effetune="urn:effetune-org:remote-control"><device><deviceType>urn:effetune-org:device:RemoteControl:1</deviceType><friendlyName>${xml(info.name || 'EffeTune')}</friendlyName><manufacturer>EffeTune</manufacturer><UDN>${xml(this.id)}</UDN><effetune:playerId>${xml(info.playerId)}</effetune:playerId><serviceList><service><serviceType>${REMOTE_CONTROL}</serviceType><controlURL>${REQUEST_PATH}</controlURL></service></serviceList></device></root>`;
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
      res.end(body);
      return true;
    }
    // Browser pages cannot initiate permission prompts, including same-origin pages.
    if (req.method !== 'POST' || req.headers.origin !== undefined || Object.keys(req.headers).some(key => key.startsWith('sec-fetch-')) ||
        req.headers['x-effetune-pairing'] !== '1' || req.headers['content-type'] !== 'application/json') {
      reply(res, 403, { status: 'unavailable' }); return true;
    }
    if (this.pending || Date.now() < this.nextPromptAt) { reply(res, 409, { status: 'busy' }); return true; }
    void this.requestApproval(req, res, address, info).catch(error => {
      this.onDiagnostic(error);
      reply(res, 500, { status: 'error' });
    });
    return true;
  }

  async requestApproval(req, res, address, info) {
    const controller = new AbortController();
    let completed = false;
    let timer;
    const pending = {
      finish: (status, token) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        controller.abort();
        req.removeListener('aborted', disconnected);
        res.removeListener('close', disconnected);
        if (this.pending === pending) this.pending = null;
        reply(res, 200, { status, ...(token ? { token, playerId: info.playerId } : {}) });
        if (!req.complete && !req.readableEnded) req.destroy();
      }
    };
    const disconnected = () => pending.finish('cancelled');
    this.pending = pending;
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    timer = setTimeout(() => pending.finish('expired'), this.timeoutMs);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) { pending.finish('error'); return; }
        chunks.push(chunk);
      }
      if (completed) return;
      let request;
      try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { pending.finish('error'); return; }
      if (request?.playerId !== info.playerId) { pending.finish('unavailable'); return; }
      const clientName = typeof request.clientName === 'string' ? request.clientName.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80) : '';
      this.nextPromptAt = Date.now() + this.cooldownMs;
      const allowed = await this.approve({ address, clientName, signal: controller.signal });
      if (completed) return;
      const current = this.getInfo();
      if (!current.running || current.playerId !== info.playerId || current.token !== info.token) { pending.finish('unavailable'); return; }
      pending.finish(allowed === true ? 'approved' : 'denied', allowed === true ? info.token : null);
    } catch (error) {
      if (!completed) { this.onDiagnostic(error); pending.finish('error'); }
    }
  }
}

function requestRemotePairing({ origin, playerId, clientName, signal, timeoutMs = REQUEST_TIMEOUT_MS + 5000 }) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve({ status: 'cancelled' }); return; }
    const url = new URL(REQUEST_PATH, origin);
    const body = JSON.stringify({ playerId, clientName });
    let finished = false;
    let timer;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      resolve(result);
    };
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-EffeTune-Pairing': '1' }
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 4096) { finish({ status: 'error' }); req.destroy(); } else chunks.push(chunk);
      });
      res.on('error', () => finish({ status: 'unavailable' }));
      res.on('end', () => {
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { finish({ status: 'unavailable' }); return; }
        if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.status !== 'string') {
          finish({ status: 'unavailable' }); return;
        }
        if (res.statusCode === 200 && result.status === 'approved' && result.playerId === playerId && typeof result.token === 'string' && TOKEN_PATTERN.test(result.token)) {
          finish({ status: 'approved', token: result.token });
        } else finish({ status: ['denied', 'expired', 'busy', 'cancelled', 'unavailable'].includes(result.status) ? result.status : 'unavailable' });
      });
    });
    const cancel = () => { finish({ status: 'cancelled' }); req.destroy(); };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { finish({ status: 'expired' }); req.destroy(); }, timeoutMs);
    req.on('error', () => finish({ status: 'unavailable' }));
    req.end(body);
  });
}

module.exports = { DESCRIPTION_PATH, REQUEST_PATH, REQUEST_TIMEOUT_MS, RemotePairingHost, requestRemotePairing };
