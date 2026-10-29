'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { serveRemoteResource } = require('../../electron/network-music-resource.cjs');

function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } });
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true; };
  res.bytes = () => Buffer.concat(chunks).toString(); return res;
}

test('resolver resource proxy preserves Range and content metadata without accepting a redirect to another origin', async t => {
  const calls = [];
  t.mock.method(http, 'request', (url, options, callback) => {
    calls.push({ url, options });
    const req = new EventEmitter(); req.end = () => queueMicrotask(() => {
      const incoming = Readable.from(['fLaC']);
      incoming.statusCode = url.pathname === '/redirect' ? 302 : 206;
      incoming.headers = url.pathname === '/redirect' ? { location: 'http://other.example/secret' } : { 'content-type': 'audio/flac', 'content-length': '4', 'content-range': 'bytes 0-3/11', 'accept-ranges': 'bytes' };
      callback(incoming);
    }); req.destroy = () => req.emit('close'); return req;
  });
  const res = response();
  await serveRemoteResource({ method: 'GET', headers: { range: 'bytes=0-3' } }, res, { uri: 'http://source.example/stream?private-token=value' }, () => true);
  assert.equal(res.status, 206); assert.equal(res.bytes(), 'fLaC'); assert.equal(calls[0].options.headers.Range, 'bytes=0-3');
  assert.equal(res.headers['content-range'], 'bytes 0-3/11');
  await assert.rejects(serveRemoteResource({ method: 'GET', headers: {} }, response(), { uri: 'http://source.example/redirect', headers: { Authorization: 'server-only' } }, () => true), /destination changed/);
  assert.equal(calls.length, 2, 'No request or credential reaches the redirect origin');
});

test('resource proxy refuses revoked requests and non-image artwork', async t => {
  let requests = 0;
  t.mock.method(http, 'request', (_url, _options, callback) => {
    requests++;
    const req = new EventEmitter(); req.end = () => queueMicrotask(() => {
      const incoming = Readable.from(['<html>']); incoming.statusCode = 200; incoming.headers = { 'content-type': 'text/html' }; callback(incoming);
    }); req.destroy = () => req.emit('close'); return req;
  });
  const revoked = response();
  await serveRemoteResource({ method: 'GET', headers: {} }, revoked, { uri: 'http://source.example/track' }, () => false);
  assert.equal(revoked.status, 404); assert.equal(requests, 0);
  const artwork = response();
  await serveRemoteResource({ method: 'GET', headers: {} }, artwork, { uri: 'http://source.example/artwork' }, () => true, 'artwork');
  assert.equal(artwork.status, 404); assert.equal(artwork.bytes(), '');
});
