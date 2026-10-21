import { execFile } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const tokenUrl = 'https://oauth2.googleapis.com/token';
const chromeApi = 'https://chromewebstore.googleapis.com';
const edgeApi = 'https://api.addons.microsoftedge.microsoft.com';

function required(env, name) {
  if (!env[name]?.trim()) throw new Error(`Missing ${name}. See extension/RELEASING.md.`);
  return env[name].trim();
}

function checkVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      version.split('.').some(part => Number(part) > 65535) || version === '0.0.0') {
    throw new Error('The app version must be a valid three-part extension version.');
  }
}

export function checkRelease(version, env = process.env) {
  checkVersion(version);
  const releaseTag = env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME === `v${version}`;
  const mainDraft = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.EXTENSION_SUBMIT === 'false' &&
    env.GITHUB_REF_TYPE === 'branch' && env.GITHUB_REF_NAME === 'main';
  if (env.GITHUB_REPOSITORY !== 'Frieve-A/effetune' || (!releaseTag && !mainDraft)) {
    throw new Error(`Extension releases require Frieve-A/effetune at the exact tag v${version}; main permits manual drafts only.`);
  }
}

export async function signExtension({
  directory, output, privateKey, chrome = 'google-chrome', pack = execute,
  tempDirectory = os.tmpdir()
}) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('The CRX upload key must be an RSA private key.');
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(tempDirectory, 'effetune-crx-')));
  try {
    const source = path.join(temporary, 'extension');
    const keyPath = path.join(temporary, 'upload.pem');
    await fs.cp(directory, source, { recursive: true });
    await fs.writeFile(keyPath, privateKey, { mode: 0o600 });
    // The key is beside the extension, never inside the directory being packaged.
    const childEnv = { ...process.env };
    delete childEnv.CHROME_CRX_PRIVATE_KEY;
    await pack(chrome, [
      '--headless', '--no-message-box',
      `--user-data-dir=${path.join(temporary, 'profile')}`,
      `--pack-extension=${source}`, `--pack-extension-key=${keyPath}`
    ], { timeout: 60_000, windowsHide: true, env: childEnv });
    const crx = await fs.readFile(`${source}.crx`);
    if (crx.length < 12 || crx.toString('ascii', 0, 4) !== 'Cr24' || crx.readUInt32LE(4) !== 3) {
      throw new Error('Chrome did not produce a CRX3 package.');
    }
    await fs.copyFile(`${source}.crx`, output);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

async function request(fetcher, label, url, options = {}) {
  const response = await fetcher(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    // Never print authentication responses, request headers, or credential bodies.
    throw new Error(`${label} failed (HTTP ${response.status}). Check the store dashboard and API credentials.`);
  }
  return response;
}

async function poll(readState, pending, success, label, wait) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await readState();
    if (state === success) return;
    if (state !== pending) throw new Error(`${label} failed. Check the store dashboard for validation errors.`);
    if (attempt < 59) await wait(10_000);
  }
  throw new Error(`${label} timed out. Check the store dashboard before retrying; the operation may still finish.`);
}

export async function chromeAccessToken(credentials, fetcher = fetch) {
  let account;
  try {
    account = JSON.parse(credentials);
  } catch {
    throw new Error('CHROME_WEB_STORE_SERVICE_ACCOUNT must contain valid service account JSON.');
  }
  if (account?.type !== 'service_account' || !account.client_email || !account.private_key) {
    throw new Error('CHROME_WEB_STORE_SERVICE_ACCOUNT must contain the service account JSON key.');
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: tokenUrl, iat: now, exp: now + 3600
  })}`;
  const assertion = `${claims}.${sign('RSA-SHA256', Buffer.from(claims), account.private_key).toString('base64url')}`;
  const response = await request(fetcher, 'Google authentication', tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const result = await response.json();
  if (!result.access_token) throw new Error('Google authentication did not return an access token.');
  return result.access_token;
}

export async function uploadChrome({
  bytes, filename, publisherId, extensionId, token, submit = false, fetcher = fetch, wait = delay
}) {
  const item = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request(fetcher, 'Chrome upload', `${chromeApi}/upload/v2/${item}:upload`, {
    method: 'POST',
    headers: {
      ...headers, 'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-File-Name': filename
    },
    body: bytes
  });
  let { uploadState } = await response.json();
  await poll(async () => {
    if (uploadState === 'IN_PROGRESS') {
      const status = await request(fetcher, 'Chrome upload status', `${chromeApi}/v2/${item}:fetchStatus`, { headers });
      uploadState = (await status.json()).lastAsyncUploadState;
    }
    return uploadState;
  }, 'IN_PROGRESS', 'SUCCEEDED', 'Chrome upload', wait);
  if (!submit) return 'Chrome: draft uploaded; not submitted for review.';
  const published = await request(fetcher, 'Chrome submission', `${chromeApi}/v2/${item}:publish`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true })
  });
  const { state } = await published.json();
  if (!['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(state)) {
    throw new Error('Chrome did not accept the submission. Check the Developer Dashboard.');
  }
  return `Chrome: submission accepted (${state}). Store approval and publication are separate from upload.`;
}

export function edgeOperationUrl(location, operationBase) {
  if (!location) throw new Error('Edge did not return an operation ID.');
  const prefix = `${operationBase}/operations/`;
  // The API documents an ID; also accept an absolute/relative Location on this exact endpoint.
  const candidate = /^[a-zA-Z0-9-]{1,128}$/.test(location) ? `${prefix}${location}` :
    new URL(location, edgeApi).href;
  const url = new URL(candidate);
  if (!candidate.startsWith(prefix) || url.origin !== edgeApi || url.search || url.hash ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(candidate.slice(prefix.length))) {
    throw new Error('Edge returned an unexpected operation URL.');
  }
  return candidate;
}

export async function uploadEdge({
  bytes, productId, clientId, apiKey, submit = false, fetcher = fetch, wait = delay
}) {
  const base = `${edgeApi}/v1/products/${encodeURIComponent(productId)}/submissions`;
  const headers = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
  async function operation(url, options, label) {
    const response = await request(fetcher, label, url, {
      method: 'POST', ...options, headers: { ...headers, ...options.headers }
    });
    if (response.status !== 202) throw new Error(`${label} did not return an accepted operation.`);
    const statusUrl = edgeOperationUrl(response.headers.get('location'), url);
    await poll(async () => {
      const status = await request(fetcher, `${label} status`, statusUrl, { headers });
      return (await status.json()).status;
    }, 'InProgress', 'Succeeded', label, wait);
  }
  await operation(`${base}/draft/package`, {
    headers: { 'Content-Type': 'application/zip' }, body: bytes
  }, 'Edge upload');
  if (!submit) return 'Edge: draft uploaded; not submitted for review.';
  await operation(base, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Automated release of the EffeTune browser extension.' })
  }, 'Edge submission');
  return 'Edge: submission created. Certification and publication are still handled by the store.';
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length || !['check', 'sign', 'chrome', 'edge'].includes(command)) {
    throw new Error('Usage: node scripts/release-extension.mjs check|sign|chrome|edge');
  }
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  checkVersion(version);
  if (process.env.GITHUB_ACTIONS === 'true' || command === 'check') checkRelease(version);
  if (command === 'check') return;
  const stem = path.join(root, 'out', `effetune-extension-${version}`);
  let result;
  if (command === 'sign') {
    const directory = path.join(root, 'out', 'extension');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.version !== version) throw new Error('Build the extension for the current app version before signing.');
    await signExtension({
      directory, output: `${stem}.crx`,
      privateKey: required(process.env, 'CHROME_CRX_PRIVATE_KEY'),
      chrome: process.env.CHROME_PATH || 'google-chrome'
    });
    result = `Signed CRX: ${path.basename(stem)}.crx`;
  } else {
    if (!['true', 'false', undefined].includes(process.env.EXTENSION_SUBMIT)) {
      throw new Error('EXTENSION_SUBMIT must be true or false.');
    }
    const submit = process.env.EXTENSION_SUBMIT === 'true';
    if (command === 'chrome') {
      const publisherId = required(process.env, 'CHROME_WEB_STORE_PUBLISHER_ID');
      const extensionId = required(process.env, 'CHROME_WEB_STORE_EXTENSION_ID');
      const bytes = await fs.readFile(`${stem}.crx`);
      const token = await chromeAccessToken(required(process.env, 'CHROME_WEB_STORE_SERVICE_ACCOUNT'));
      result = await uploadChrome({ bytes, filename: `${path.basename(stem)}.crx`, publisherId, extensionId, token, submit });
    } else {
      const productId = required(process.env, 'EDGE_ADDONS_PRODUCT_ID');
      const clientId = required(process.env, 'EDGE_ADDONS_CLIENT_ID');
      const apiKey = required(process.env, 'EDGE_ADDONS_API_KEY');
      const bytes = await fs.readFile(`${stem}.zip`);
      result = await uploadEdge({ bytes, productId, clientId, apiKey, submit });
    }
  }
  console.log(result);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${result}\n\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
