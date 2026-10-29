'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const fail = (code, message) => Object.assign(new Error(message), { code });

function normalizeEndpoint(value = '') {
  if (typeof value !== 'string' || value.length > 2048) throw fail('invalid-endpoint', 'Enter a valid HTTPS address.');
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw fail('invalid-endpoint', 'Enter a valid HTTPS address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.port && Number(url.port) < 1) ||
      !url.hostname || url.hostname.includes('*') || url.hostname.endsWith('.') ||
      (!net.isIP(url.hostname) && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(url.hostname))) {
    throw fail('invalid-endpoint', 'Use an HTTPS address with a hostname and optional port, without a path.');
  }
  return url.origin;
}

function resolveConnection(config, env, defaultPort) {
  const saved = config.remoteControlConnection || {};
  const environment = ['EFFETUNE_REMOTE_TLS_CERT', 'EFFETUNE_REMOTE_TLS_KEY', 'EFFETUNE_REMOTE_ENDPOINT', 'EFFETUNE_REMOTE_PORT']
    .some(key => typeof env[key] === 'string' && env[key].length > 0);
  const values = environment ? {
    certificatePath: env.EFFETUNE_REMOTE_TLS_CERT || '', keyPath: env.EFFETUNE_REMOTE_TLS_KEY || '',
    endpoint: env.EFFETUNE_REMOTE_ENDPOINT || ''
  } : saved;
  const endpoint = normalizeEndpoint(values.endpoint || '');
  const port = endpoint ? Number(new URL(endpoint).port) || 443 : Number(env.EFFETUNE_REMOTE_PORT) || defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      (endpoint && env.EFFETUNE_REMOTE_PORT && Number(env.EFFETUNE_REMOTE_PORT) !== port)) {
    throw fail('invalid-port', 'The HTTPS address and listening port must match.');
  }
  return {
    certificatePath: typeof values.certificatePath === 'string' ? values.certificatePath : '',
    keyPath: typeof values.keyPath === 'string' ? values.keyPath : '',
    endpoint, port, environment,
    secure: Boolean(values.certificatePath || values.keyPath || endpoint)
  };
}

function validateConnection(connection, now = Date.now()) {
  if (!connection.secure) return null;
  if (!connection.certificatePath || !connection.keyPath) {
    throw fail('missing-certificate', 'Choose both a certificate and a private key file.');
  }
  let cert, key, certificate;
  try {
    cert = fs.readFileSync(connection.certificatePath);
    key = fs.readFileSync(connection.keyPath);
    certificate = new crypto.X509Certificate(cert);
    tls.createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
  } catch {
    throw fail('invalid-certificate', 'The certificate and private key could not be used. Check that the files exist and belong together.');
  }
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
    throw fail('certificate-expired', 'The certificate is expired or is not valid yet. Choose a currently valid certificate.');
  }
  if (connection.endpoint) {
    const hostname = new URL(connection.endpoint).hostname;
    const matches = net.isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname, { subject: 'never' });
    if (!matches) throw fail('certificate-hostname', 'The certificate does not cover the HTTPS hostname. Choose a matching certificate or address.');
  }
  return { cert, key, minVersion: 'TLSv1.2' };
}

function connectionStatus(connection) {
  return {
    endpoint: connection.endpoint, secure: connection.secure, fromEnvironment: connection.environment,
    certificateConfigured: Boolean(connection.certificatePath), keyConfigured: Boolean(connection.keyPath),
    certificateName: path.basename(connection.certificatePath), keyName: path.basename(connection.keyPath)
  };
}

module.exports = { normalizeEndpoint, resolveConnection, validateConnection, connectionStatus };
