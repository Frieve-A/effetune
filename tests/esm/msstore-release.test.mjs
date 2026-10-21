import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  advanceSubmission, checkCredentialExpiry, compareVersions, parseStatus, releaseVersion,
  requestJson, updateListing, verifyEvidence
} from '../../scripts/publish-msstore.mjs';

const identity = { name: 'Example.EffeTune', publisher: 'CN=Example', productId: '9EXAMPLE0001' };
const payload = { version: '2.15.0.0', packageVersion: '2.15.0', tag: 'v2.15.0', identity };
const templates = { 'en-us': 'Version {version}: {releaseUrl}', 'ja-jp': '{version}: {releaseUrl}' };
const listing = {
  id: '20', status: 'PendingCommit', pricing: { priceId: 'Free', marketSpecificPricings: { JP: 'Free' } },
  listings: {
    'en-us': { baseListing: { description: 'Preserved', images: [{ id: 'image1' }], releaseNotes: '' } },
    'ja-jp': { baseListing: { description: '保持する説明', releaseNotes: '' } }
  },
  applicationPackages: [{ fileName: 'EffeTune-2.15.0-Store-x64.msix', fileStatus: 'PendingUpload' }]
};

function harness({ pending, status = 'PendingCommit', publishedVersion = '2.14.0.0', uploadError } = {}) {
  let currentPending = pending;
  let submission = { ...structuredClone(listing), status };
  const calls = [];
  const records = [];
  const store = async (suffix = '', method = 'GET', body) => {
    calls.push({ suffix, method, body });
    if (!suffix) return {
      id: identity.productId, packageIdentityName: identity.name, publisherName: identity.publisher,
      lastPublishedApplicationSubmission: { id: '10' },
      ...(currentPending ? { pendingApplicationSubmission: { id: currentPending } } : {})
    };
    if (suffix === '/submissions/10') return {
      id: '10', status: 'Published', applicationPackages: [{ version: publishedVersion, fileStatus: 'Uploaded' }]
    };
    if (method === 'PUT') { submission = body; return body; }
    if (suffix === '/submissions/20/commit') { submission.status = 'CommitStarted'; return { status: 'CommitStarted' }; }
    if (suffix === '/submissions/20') return structuredClone(submission);
    throw new Error(`Unexpected fixture call: ${suffix}`);
  };
  const run = (previous = { phase: 'queued' }) => advanceSubmission({
    payload, previous, store, templates,
    record: async (phase, submissionId, state) => records.push({ phase, submissionId, state }),
    upload: async () => {
      calls.push({ upload: true });
      assert.equal(records.at(-1).phase, 'upload-started');
      currentPending = '20';
      if (uploadError) throw new Error('Unknown upload outcome');
    }
  });
  return { run, calls, records };
}

test('only stable published desktop releases have Store versions', () => {
  assert.equal(releaseVersion({ tag_name: 'v2.15.0', draft: false, prerelease: false }), '2.15.0');
  for (const tag of ['dsp-v2.15.0', 'v2.15.0-beta.1', 'v65536.1.0', 'v01.2.3', 'v0.0.0']) {
    assert.throws(() => releaseVersion({ tag_name: tag, draft: false, prerelease: false }));
  }
  assert.throws(() => releaseVersion({ tag_name: 'v2.15.0', draft: true, prerelease: false }));
  assert.throws(() => releaseVersion({ tag_name: 'v2.15.0', draft: false, prerelease: true }));
  assert.equal(compareVersions('2.15.0.0', '2.9.0.0'), 1);
});

test('MSIX evidence must match the exact source, real identity, hash and installed test', () => {
  const bytes = Buffer.from('verified fixture package');
  const metadata = {
    ...payload, commit: 'a'.repeat(40),
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
  const validation = { ...metadata, passed: true };
  const evidence = { metadata, validation, identity, tag: payload.tag, commit: metadata.commit, bytes };
  verifyEvidence(evidence);
  for (const patch of [{ testIdentity: true }, { testOnly: true }, { commit: 'b'.repeat(40) },
    { sha256: '0'.repeat(64) }, { identity: { ...identity, productId: 'other' } }]) {
    assert.throws(() => verifyEvidence({ ...evidence, metadata: { ...metadata, ...patch } }));
  }
  for (const patch of [{ passed: false }, { sha256: '0'.repeat(64) }, { tag: 'v2.14.0' }]) {
    assert.throws(() => verifyEvidence({ ...evidence, validation: { ...validation, ...patch } }));
  }
});

test('fresh metadata updates preserve pricing, listings and images', () => {
  const updated = updateListing(listing, '2.15.0', 'https://example.test/release', templates);
  assert.deepEqual(updated.pricing, listing.pricing);
  assert.deepEqual(updated.listings['en-us'].baseListing.images, listing.listings['en-us'].baseListing.images);
  assert.equal(updated.listings['en-us'].baseListing.description, 'Preserved');
  assert.equal(updated.targetPublishMode, 'Immediate');
  assert.match(updated.listings['ja-jp'].baseListing.releaseNotes, /2\.15\.0/);
  assert.equal(listing.listings['en-us'].baseListing.releaseNotes, '');
});

test('new submission uploads once, records the ID, updates metadata and commits once', async () => {
  const fixture = harness();
  assert.equal(await fixture.run(), 'review');
  assert.equal(fixture.calls.filter(call => call.upload).length, 1);
  assert.equal(fixture.calls.filter(call => call.method === 'POST').length, 1);
  assert.deepEqual(fixture.records.map(item => item.phase),
    ['upload-started', 'uploaded', 'metadata', 'commit-started', 'review']);
  assert.ok(fixture.records.slice(1).every(item => item.submissionId === '20'));
  assert.ok(fixture.records.every(item => item.state !== 'success'));
});

test('same-version or older release never uploads or replaces a published version', async () => {
  for (const publishedVersion of ['2.15.0.0', '2.16.0.0']) {
    const fixture = harness({ publishedVersion });
    assert.equal(await fixture.run(), 'published');
    assert.ok(fixture.calls.every(call => !call.upload && call.method === 'GET'));
    assert.equal(fixture.records.at(-1).state, 'success');
  }
});

test('unowned draft is preserved, including before any new upload', async () => {
  const fixture = harness({ pending: '99' });
  await assert.rejects(fixture.run(), /unowned/);
  assert.ok(fixture.calls.every(call => call.method === 'GET'));
  assert.deepEqual(fixture.records, []);
});

test('an interrupted upload records an observed ID and is never blindly retried', async () => {
  const fixture = harness({ uploadError: true });
  await assert.rejects(fixture.run(), /Unknown upload/);
  assert.deepEqual(fixture.records.at(-1), { phase: 'upload-unknown', submissionId: '20', state: undefined });
  const resumed = harness({ pending: '20' });
  await assert.rejects(resumed.run({ phase: 'upload-unknown', submissionId: '20' }), /uncertain/);
  assert.ok(resumed.calls.every(call => call.method === 'GET'));
  const missing = harness();
  await assert.rejects(missing.run({ phase: 'upload-started' }), /unknown outcome/);
});

test('a recorded successful upload resumes without reuploading', async () => {
  const fixture = harness({ pending: '20' });
  assert.equal(await fixture.run({ phase: 'uploaded', submissionId: '20' }), 'review');
  assert.ok(fixture.calls.every(call => !call.upload));
  assert.equal(fixture.calls.filter(call => call.method === 'POST').length, 1);
});

test('uncertain commit checks its recorded ID and waits for publication', async () => {
  for (const status of ['CommitStarted', 'Certification', 'Publishing', 'Published']) {
    const fixture = harness({ pending: '20', status });
    assert.equal(await fixture.run({ phase: 'commit-started', submissionId: '20' }),
      status === 'Published' ? 'published' : 'review');
    assert.ok(fixture.calls.every(call => call.method === 'GET'));
    assert.equal(fixture.records.at(-1).state, status === 'Published' ? 'success' : undefined);
  }
  const fixture = harness({ pending: '20' });
  await assert.rejects(fixture.run({ phase: 'commit-started', submissionId: '20' }), /uncertain/);
});

test('certification failure is recorded as failure with its submission ID', async () => {
  const fixture = harness({ pending: '20', status: 'CertificationFailed' });
  await assert.rejects(fixture.run({ phase: 'review', submissionId: '20' }), /20.*failed/);
  assert.deepEqual(fixture.records.at(-1), { phase: 'rejected', submissionId: '20', state: 'failure' });
  assert.deepEqual(parseStatus({ description: 'msstore:review;submission=20' }),
    { phase: 'review', submissionId: '20' });
});

test('transport retries GET only and never exposes response secrets', async () => {
  let count = 0;
  const fetcher = async () => {
    count++;
    return { ok: false, status: 503, json: async () => ({ secret: 'do not expose' }) };
  };
  await assert.rejects(requestJson('https://example.test', {}, fetcher, async () => {}), /GET request failed/);
  assert.equal(count, 3);
  count = 0;
  await assert.rejects(requestJson('https://example.test', { method: 'POST' }, fetcher), /POST request failed/);
  assert.equal(count, 1);
});

test('credential expiry can be checked without authenticating to Store', () => {
  assert.equal(checkCredentialExpiry('2026-11-01T00:00:00Z', Date.parse('2026-10-20T00:00:00Z')), 12);
  assert.throws(() => checkCredentialExpiry(''), /EXPIRES_AT/);
  assert.throws(() => checkCredentialExpiry('2020-01-01'), /expired/);
});

test('workflow gates keep unprovisioned validation runners and Store credentials unused', () => {
  const read = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
  const build = read('build.yml');
  const desktop = read('desktop-release.yml');
  const store = read('store-release.yml');
  assert.match(desktop, /store_msix:.*MSSTORE_BUILD_ENABLED == 'true'/);
  assert.match(desktop, /if: vars.MSSTORE_BUILD_ENABLED == 'true' && vars.MSSTORE_VALIDATION_ENABLED == 'true'/);
  assert.match(desktop, /needs: windows/);
  assert.ok(build.indexOf('name: Package Microsoft Store MSIX') < build.indexOf('name: Package Windows release ZIPs'));
  assert.match(store, /types: \[published\]/);
  assert.match(store, /MSSTORE_AUTOPUBLISH_ENABLED == 'true'/);
  assert.match(store, /github\.event\.release\.draft == false && github\.event\.release\.prerelease == false/);
  assert.match(store, /if: needs\.prepare\.outputs\.deployment_id != ''/);
  assert.match(store, /cancel-in-progress: false/);
  assert.doesNotMatch(store.split('  submit:')[0], /MSSTORE_CLIENT_SECRET|apppublisher@/);
  assert.doesNotMatch(store, /^\s+(?:push|pull_request):/m);
});
