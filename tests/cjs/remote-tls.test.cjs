const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');

function hostFor(env) {
  return new RemoteControlHost({
    app: { getVersion: () => 'test' }, getMainWindow: () => null,
    env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_TOKEN: 'tls-test-token', ...env }, argv: [], log: () => {}
  });
}

test('invalid or incomplete TLS configuration fails closed without opening HTTP', async () => {
  for (const env of [{ EFFETUNE_REMOTE_TLS_CERT: 'missing.pem' },
    { EFFETUNE_REMOTE_TLS_CERT: 'missing.pem', EFFETUNE_REMOTE_TLS_KEY: 'missing-key.pem' }]) {
    const host = hostFor(env);
    try {
      assert.equal(await host.start(), false);
      assert.equal(host.server, null);
      assert.equal(host.getStatus().running, false);
      assert.match(host.getStatus().url, /^wss:/);
      assert.match(host.getStatus().error, /certificate/);
    } finally { await host.dispose(); }
  }
});

test('TLS serves the client, verifies certificates and enforces secure WebSocket origins', { timeout: 15000 }, async t => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('OpenSSL is required to generate a temporary TLS certificate');
    return;
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-tls-')));
  const cert = path.join(root, 'cert.pem');
  const key = path.join(root, 'key.pem');
  const config = path.join(root, 'openssl.cnf');
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\n[dn]\n');
  let host;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-config', config, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', key, '-out', cert], { stdio: 'ignore' });
    host = hostFor({ EFFETUNE_REMOTE_TLS_CERT: cert, EFFETUNE_REMOTE_TLS_KEY: key });
    host.bindWithFallback = server => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    assert.equal(await host.start(), true);
    const ca = fs.readFileSync(cert);
    const origin = `https://127.0.0.1:${host.port}`;
    const response = await new Promise((resolve, reject) => {
      https.get(`${origin}/`, { ca }, res => {
        res.resume();
        res.on('end', () => resolve(res));
      }).on('error', reject);
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-security-policy'], `connect-src 'self' wss://127.0.0.1:${host.port}`);
    await assert.rejects(new Promise((resolve, reject) => {
      https.get(`${origin}/`, resolve).on('error', reject);
    }), /self-signed certificate/);
    for (const requestOrigin of [origin, origin.replace('https:', 'http:')]) {
      const result = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://127.0.0.1:${host.port}/?t=tls-test-token`, { ca, origin: requestOrigin });
        ws.on('open', () => { ws.close(); resolve(101); });
        ws.on('unexpected-response', (_request, res) => { res.resume(); ws.terminate(); resolve(res.statusCode); });
        ws.on('error', reject);
      });
      assert.equal(result, requestOrigin === origin ? 101 : 403);
    }
  } finally {
    await host?.dispose();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
