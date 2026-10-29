const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');
const { normalizeEndpoint, resolveConnection, validateConnection } = require('../../electron/remote-connection.cjs');
const { isAllowedOrigin } = require('../../electron/remote-static-server.cjs');

function hostFor(env) {
  return new RemoteControlHost({
    app: { getVersion: () => 'test' }, getMainWindow: () => null,
    env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_TOKEN: 'tls-test-token', ...env }, argv: [], log: () => {}
  });
}

test('HTTPS endpoint parsing preserves exact origins and rejects downgrade, credentials and proxy paths', () => {
  assert.equal(normalizeEndpoint('https://Music.example:443/'), 'https://music.example');
  assert.equal(normalizeEndpoint('https://music.example:47443'), 'https://music.example:47443');
  for (const value of ['http://music.example', 'https://user:secret@music.example', 'https://music.example/proxy',
    'https://music.example/?url=http://other.example', 'https://*.example', 'https://music.example/#fragment', 'https://music.example:0']) {
    assert.throws(() => normalizeEndpoint(value));
  }
  assert.equal(resolveConnection({ remoteControlConnection: { endpoint: 'https://music.example' } }, {}, 47300).port, 443);
  assert.throws(() => resolveConnection({}, { EFFETUNE_REMOTE_ENDPOINT: 'https://music.example', EFFETUNE_REMOTE_PORT: '47443' }, 47300));
});

test('configured hostname and port are shared by settings, pairing and exact Host/Origin checks', async t => {
  let saved = { remoteControlConnection: { endpoint: 'https://music.example' } };
  const host = new RemoteControlHost({
    app: { getVersion: () => 'test' }, getMainWindow: () => null, env: {}, argv: [], log: () => {},
    config: { loadConfig: () => saved, saveConfig: value => { saved = value; return true; } }
  });
  t.after(() => host.dispose());
  assert.equal(host.getStatus().webUrl, `https://music.example/?t=${host.token}`);
  assert.equal(host.isAllowedHost('music.example'), true);
  assert.equal(host.isAllowedHost('music.example:443'), true);
  assert.equal(host.isAllowedHost('music.example:47443'), false);
  assert.equal(host.isAllowedHost('other.example'), false);
  assert.equal(isAllowedOrigin('https://music.example', 'music.example:443', true, host.trustedHosts()), true);
  assert.equal(isAllowedOrigin('http://music.example', 'music.example', true, host.trustedHosts()), false);
  const result = await host.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing-certificate');
  assert.equal(host.server, null);
  assert.equal('certificatePath' in host.getStatus().connection, false);
  assert.equal('keyPath' in host.getStatus().connection, false);
});

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
  try { execFileSync('openssl', ['version'], { stdio: 'ignore', windowsHide: true }); }
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
      '-config', config, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:music.example',
      '-keyout', key, '-out', cert], { stdio: 'ignore', windowsHide: true });
    host = hostFor({ EFFETUNE_REMOTE_TLS_CERT: cert, EFFETUNE_REMOTE_TLS_KEY: key });
    const connection = { secure: true, certificatePath: cert, keyPath: key, endpoint: 'https://music.example' };
    assert.ok(validateConnection(connection));
    assert.throws(() => validateConnection({ ...connection, endpoint: 'https://other.example' }), { code: 'certificate-hostname' });
    assert.throws(() => validateConnection({ ...connection, keyPath: cert }), { code: 'invalid-certificate' });
    assert.throws(() => validateConnection(connection, Date.now() + 3 * 24 * 3600 * 1000), { code: 'certificate-expired' });
    let settings = {};
    const configured = new RemoteControlHost({
      app: { getVersion: () => 'test' }, getMainWindow: () => null, env: {}, argv: [], log: () => {},
      config: { loadConfig: () => settings, saveConfig: value => { settings = value; return true; } },
      dialog: { showOpenDialog: async (_window, options) => ({ canceled: false, filePaths: [options.title.includes('private') ? key : cert] }) }
    });
    try {
      const certificateSelection = await configured.selectConnectionFile('certificate');
      const keySelection = await configured.selectConnectionFile('key');
      assert.deepEqual(Object.keys(keySelection).sort(), ['fileName', 'selectionId']);
      await assert.rejects(configured.setConnection({ endpoint: 'https://music.example', certificateSelection: 'fake' }));
      const status = await configured.setConnection({ endpoint: 'https://music.example', certificateSelection: certificateSelection.selectionId, keySelection: keySelection.selectionId });
      assert.equal(status.connection.certificateName, 'cert.pem');
      assert.equal(status.connection.keyName, 'key.pem');
      assert.equal(status.running, false);
      assert.equal((await configured.testConnection()).ok, true);
      assert.equal(settings.remoteControlConnection.keyPath, key);
      await assert.rejects(configured.setConnection({ endpoint: 'https://music.example', keySelection: keySelection.selectionId }));
      await configured.setConnection({ endpoint: '', clearTls: true });
      assert.equal(configured.secure, false);
    } finally { await configured.dispose(); }
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
