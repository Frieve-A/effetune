import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkRelease, chromeAccessToken, edgeOperationUrl, signExtension, uploadChrome, uploadEdge
} from '../../scripts/release-extension.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const account = JSON.stringify({
  type: 'service_account', client_email: 'release@example.iam.gserviceaccount.com',
  private_key: privateKey
});
const chromeOptions = {
  bytes: Buffer.from('crx-test-package'), filename: 'effetune-extension-2.15.0.crx',
  publisherId: 'publisher', extensionId: 'fhjhnpepnhkcdggogicifibfegpbhibp', token: 'test-token'
};
const edgeOptions = {
  bytes: Buffer.from('zip-test-package'), productId: 'd34f98f5-f9b7-42b1-bebb-98707202b21d',
  clientId: 'client-id', apiKey: 'test-api-key'
};

function apiSequence(replies) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, ...options });
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(replies.length, `Unexpected request: ${url}`);
      return replies.shift();
    }
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function accepted(id = 'operation-id') {
  return new Response(null, { status: 202, headers: { Location: id } });
}

test('extension submissions require the official repository and exact app version tag', () => {
  const env = { GITHUB_REPOSITORY: 'Frieve-A/effetune', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v2.15.0' };
  checkRelease('2.15.0', env);
  for (const changed of [
    { GITHUB_REPOSITORY: 'someone/effetune' }, { GITHUB_REF_TYPE: 'branch' },
    { GITHUB_REF_NAME: 'dsp-v2.15.0' }, { GITHUB_REF_NAME: 'mcp-v2.15.0' },
    { GITHUB_REF_NAME: 'v2.14.0' }
  ]) assert.throws(() => checkRelease('2.15.0', { ...env, ...changed }), /exact tag/);
  for (const version of ['2.15.0-beta.1', '../2.15.0', '65536.0.0', '0.0.0']) {
    assert.throws(() => checkRelease(version, env), /extension version/);
  }
});

test('manual main runs may upload drafts but cannot submit for publication', () => {
  const env = {
    GITHUB_REPOSITORY: 'Frieve-A/effetune', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main',
    GITHUB_EVENT_NAME: 'workflow_dispatch', EXTENSION_SUBMIT: 'false'
  };
  checkRelease('2.15.0', env);
  for (const changed of [
    { EXTENSION_SUBMIT: 'true' }, { EXTENSION_SUBMIT: undefined },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF_NAME: 'feature/release' },
    { GITHUB_REPOSITORY: 'someone/effetune' }
  ]) assert.throws(() => checkRelease('2.15.0', { ...env, ...changed }), /exact tag/);
});

test('Chrome authentication signs a scoped, short-lived service account assertion', async () => {
  const api = apiSequence([json({ access_token: 'access-token' })]);
  assert.equal(await chromeAccessToken(account, api.fetcher), 'access-token');
  const [call] = api.calls;
  assert.equal(call.url, 'https://oauth2.googleapis.com/token');
  assert.equal(call.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = call.body.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.iss, 'release@example.iam.gserviceaccount.com');
  assert.equal(payload.aud, call.url);
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/chromewebstore');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), keys.publicKey,
    Buffer.from(signature, 'base64url')));
});

test('Chrome waits for asynchronous upload success before submitting the signed CRX', async () => {
  const api = apiSequence([
    json({ uploadState: 'IN_PROGRESS' }),
    json({ lastAsyncUploadState: 'IN_PROGRESS' }),
    json({ lastAsyncUploadState: 'SUCCEEDED' }),
    json({ state: 'PENDING_REVIEW' })
  ]);
  let waits = 0;
  const message = await uploadChrome({
    ...chromeOptions, ...api, submit: true, wait: async () => { waits++; }
  });
  assert.equal(waits, 1);
  assert.match(message, /PENDING_REVIEW/);
  assert.match(api.calls[0].url, /\/upload\/v2\/publishers\/publisher\/items\/[^/]+:upload$/);
  assert.equal(api.calls[0].headers['X-Goog-Upload-Protocol'], 'raw');
  assert.equal(api.calls[0].headers['X-Goog-Upload-File-Name'], chromeOptions.filename);
  assert.equal(api.calls[0].body, chromeOptions.bytes);
  assert.equal(api.calls[0].headers.Authorization, 'Bearer test-token');
  assert.match(api.calls[3].url, /:publish$/);
  assert.deepEqual(JSON.parse(api.calls[3].body), {
    publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true
  });
});

test('Chrome draft uploads do not submit and rejected uploads cannot publish', async () => {
  const draft = apiSequence([json({ uploadState: 'SUCCEEDED' })]);
  assert.match(await uploadChrome({ ...chromeOptions, ...draft }), /not submitted/);
  assert.equal(draft.calls.length, 1);
  const failed = apiSequence([json({ uploadState: 'IN_PROGRESS' }), json({ lastAsyncUploadState: 'FAILED' })]);
  await assert.rejects(uploadChrome({ ...chromeOptions, ...failed, submit: true }), /Chrome upload failed/);
  assert.equal(failed.calls.length, 2);
});

test('an upload that never finishes times out without creating a submission', async () => {
  const api = apiSequence(Array.from({ length: 61 }, (_, index) =>
    json(index ? { lastAsyncUploadState: 'IN_PROGRESS' } : { uploadState: 'IN_PROGRESS' })));
  await assert.rejects(uploadChrome({
    ...chromeOptions, ...api, submit: true, wait: async () => {}
  }), /timed out/);
  assert.equal(api.calls.length, 61);
  assert.ok(api.calls.every(call => !call.url.endsWith(':publish')));
});

test('Edge waits for both upload and submission operations using v1.1 authentication', async () => {
  const api = apiSequence([
    accepted('upload-id'), json({ status: 'InProgress' }), json({ status: 'Succeeded' }),
    accepted('submit-id'), json({ status: 'InProgress' }), json({ status: 'Succeeded' })
  ]);
  let waits = 0;
  const message = await uploadEdge({
    ...edgeOptions, ...api, submit: true, wait: async () => { waits++; }
  });
  assert.equal(waits, 2);
  assert.match(message, /submission created/);
  assert.ok(api.calls.every(call => call.headers.Authorization === 'ApiKey test-api-key'));
  assert.ok(api.calls.every(call => call.headers['X-ClientID'] === 'client-id'));
  assert.match(api.calls[0].url, /\/v1\/products\/[^/]+\/submissions\/draft\/package$/);
  assert.equal(api.calls[0].headers['Content-Type'], 'application/zip');
  assert.equal(api.calls[0].body, edgeOptions.bytes);
  assert.match(api.calls[1].url, /\/draft\/package\/operations\/upload-id$/);
  assert.match(api.calls[3].url, /\/submissions$/);
  assert.match(api.calls[4].url, /\/submissions\/operations\/submit-id$/);
});

test('Edge draft uploads stop before submission and validation failures fail the release', async () => {
  const draft = apiSequence([accepted(), json({ status: 'Succeeded' })]);
  assert.match(await uploadEdge({ ...edgeOptions, ...draft }), /not submitted/);
  assert.equal(draft.calls.length, 2);
  const failed = apiSequence([accepted(), json({ status: 'Failed', errorCode: 'InvalidPackage' })]);
  await assert.rejects(uploadEdge({ ...edgeOptions, ...failed, submit: true }), /Edge upload failed/);
  assert.equal(failed.calls.length, 2);
  const submission = apiSequence([
    accepted(), json({ status: 'Succeeded' }), accepted(), json({ status: 'Failed' })
  ]);
  await assert.rejects(uploadEdge({ ...edgeOptions, ...submission, submit: true }), /Edge submission failed/);
});

test('Edge operation locations cannot send credentials to another host or product', async () => {
  const base = 'https://api.addons.microsoftedge.microsoft.com/v1/products/product/submissions/draft/package';
  const expected = `${base}/operations/upload-id`;
  assert.equal(edgeOperationUrl('upload-id', base), expected);
  assert.equal(edgeOperationUrl(expected, base), expected);
  assert.equal(edgeOperationUrl(new URL(expected).pathname, base), expected);
  for (const location of [null, 'https://example.com/upload-id', expected.replace('/product/', '/other/'), `${expected}?redirect=1`]) {
    assert.throws(() => edgeOperationUrl(location, base), /operation/);
  }
  const api = apiSequence([accepted('https://example.com/steal-key')]);
  await assert.rejects(uploadEdge({ ...edgeOptions, ...api }), /unexpected operation URL/);
  assert.equal(api.calls.length, 1);
});

test('HTTP failures do not echo credential-bearing response bodies or retry writes', async () => {
  const api = apiSequence([json({ error: 'secret-access-token' }, 401)]);
  await assert.rejects(chromeAccessToken(account, api.fetcher), error => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /secret-access-token|BEGIN PRIVATE KEY/);
    return true;
  });
  assert.equal(api.calls.length, 1);
});

test('CRX signing keeps the private key outside the package and cleans up on failure', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-sign-test-')));
  try {
    const directory = path.join(temporary, 'source');
    const output = path.join(temporary, 'release.crx');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'manifest.json'), '{"manifest_version":3,"version":"1.0.0"}');
    const crx = Buffer.alloc(16);
    crx.write('Cr24');
    crx.writeUInt32LE(3, 4);
    const pack = async (executable, args, options) => {
      assert.equal(executable, 'chrome-test');
      assert.equal(options.windowsHide, true);
      const source = args.find(arg => arg.startsWith('--pack-extension=')).split('=').slice(1).join('=');
      const key = args.find(arg => arg.startsWith('--pack-extension-key=')).split('=').slice(1).join('=');
      assert.equal(await fs.readFile(key, 'utf8'), privateKey);
      assert.deepEqual(await fs.readdir(source), ['manifest.json']);
      assert.equal(path.dirname(key), path.dirname(source));
      await fs.writeFile(`${source}.crx`, crx);
    };
    const options = { directory, output, privateKey, chrome: 'chrome-test', tempDirectory: temporary };
    await signExtension({ ...options, pack });
    assert.deepEqual(await fs.readFile(output), crx);
    assert.deepEqual((await fs.readdir(temporary)).sort(), ['release.crx', 'source']);
    await assert.rejects(signExtension({
      ...options, pack: async () => { throw new Error('Chrome packaging failed'); }
    }), /Chrome packaging failed/);
    assert.deepEqual((await fs.readdir(temporary)).sort(), ['release.crx', 'source']);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
