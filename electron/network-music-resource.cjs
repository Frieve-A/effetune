'use strict';

const http = require('node:http');
const https = require('node:https');
const { networkUrl } = require('./network-music-upnp.cjs');

// Only resolver-produced resources enter this function. Redirects remain on
// that exact origin, so server credentials cannot move to another destination.
function serveRemoteResource(req, res, resource, current, kind = 'media', streams = new Set()) {
  const source = networkUrl(resource.uri);
  const fetch = (url, redirects = 0) => new Promise((resolve, reject) => {
    if (!current()) { if (!res.headersSent) res.writeHead(404); res.end(); resolve(); return; }
    const headers = { ...(resource.headers || {}), ...(req.headers.range && kind === 'media' ? { Range: req.headers.range } : {}) };
    const upstream = (url.protocol === 'https:' ? https : http).request(url, { method: req.method, headers, timeout: 15000 }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        let next;
        try { next = networkUrl(response.headers.location, url); } catch (error) { reject(error); return; }
        if (redirects >= 3 || next.origin !== source.origin) { reject(new Error('The media destination changed')); return; }
        fetch(next, redirects + 1).then(resolve, reject); return;
      }
      const type = response.headers['content-type'] || 'application/octet-stream';
      if (!current() || ![200, 206, 416].includes(response.statusCode) || kind === 'media' && /(?:xml|json)/i.test(type) || kind === 'artwork' && (!/^image\/(jpeg|png|gif|webp)(?:;|$)/i.test(type) || Number(response.headers['content-length']) > 8 * 1024 * 1024)) {
        response.destroy(); res.writeHead(404); res.end(); resolve(); return;
      }
      const output = { 'Content-Type': type, 'Cache-Control': 'no-store' };
      for (const name of ['content-length', 'content-range', 'accept-ranges']) if (response.headers[name]) output[name] = response.headers[name];
      res.writeHead(response.statusCode, output);
      let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (!current() || kind === 'artwork' && bytes > 8 * 1024 * 1024) { response.destroy(); res.destroy(); } });
      response.on('error', reject); response.on('end', resolve); response.pipe(res);
    });
    streams.add(upstream);
    const close = () => upstream.destroy(); res.once('close', close);
    upstream.on('close', () => { streams.delete(upstream); res.removeListener('close', close); });
    upstream.on('error', reject); upstream.on('timeout', () => upstream.destroy(new Error('The music server did not respond'))); upstream.end();
  });
  return fetch(source);
}

module.exports = { serveRemoteResource };
