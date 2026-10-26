import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'Frieve-A/effetune';
const environment = 'microsoft-store';
const storeApi = 'https://manage.devcenter.microsoft.com/v1.0/my';
const terminalStates = new Set(['success', 'failure', 'error', 'inactive']);
const activeSubmissionStates = new Set([
  'CommitStarted', 'PreProcessing', 'Certification', 'Release', 'PendingPublication', 'Publishing'
]);

function required(env, name) {
  if (!env[name]?.trim()) throw new Error(`Configure ${name} before enabling Store automation.`);
  return env[name].trim();
}

export function releaseVersion(release) {
  if (release?.draft !== false || release?.prerelease !== false ||
      !/^v(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(release.tag_name)) {
    throw new Error('Store updates require a published, stable desktop release.');
  }
  const version = release.tag_name.slice(1);
  if (version.split('.').some(part => Number(part) > 65535) || version === '0.0.0') {
    throw new Error('The desktop version cannot be represented as a Store package version.');
  }
  return version;
}

export function compareVersions(left, right) {
  const parse = value => {
    if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)) {
      throw new Error('Store returned an unrecognized package version.');
    }
    return value.split('.').map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function verifyEvidence({ metadata, identity, tag, commit, bytes }) {
  const version = releaseVersion({ tag_name: tag, draft: false, prerelease: false });
  if (!identity.name || !identity.publisher || !identity.productId || metadata.testIdentity || metadata.testOnly ||
      metadata.identity?.name !== identity.name || metadata.identity?.publisher !== identity.publisher ||
      metadata.identity?.productId !== identity.productId ||
      metadata.tag !== tag || metadata.commit !== commit ||
      metadata.packageVersion !== version || metadata.version !== `${version}.0` ||
      metadata.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new Error('Store artifact identity, version, source or hash does not match the release.');
  }
}

export function updateListing(submission, version, releaseUrl, templates) {
  const updated = structuredClone(submission);
  for (const locale of ['en-us', 'ja-jp']) {
    if (!updated.listings?.[locale]?.baseListing || typeof templates[locale] !== 'string') {
      throw new Error('Initialize the English and Japanese Store listings before automatic updates.');
    }
    updated.listings[locale].baseListing.releaseNotes = templates[locale]
      .replaceAll('{version}', version).replaceAll('{releaseUrl}', releaseUrl);
  }
  updated.targetPublishMode = 'Immediate';
  return updated;
}

export function parseStatus(status) {
  const match = /^msstore:([a-z-]+)(?:;submission=(\d+))?$/.exec(status?.description || '');
  return match ? { phase: match[1], submissionId: match[2] } : { phase: 'unknown' };
}

// Only GET requests are retried. A failed write may have reached the service.
export async function requestJson(url, options = {}, fetcher = fetch, wait = delay) {
  const method = options.method || 'GET';
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(url, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(60_000)
      });
    } catch {
      if (method === 'GET' && attempt < 2) { await wait(1000 * (attempt + 1)); continue; }
      throw new Error(`${method} request did not return a response; reconcile service state before retrying writes.`);
    }
    if (response.ok) return response.status === 204 ? null : response.json();
    if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < 2) {
      await wait(1000 * (attempt + 1));
      continue;
    }
    // Response bodies can contain SAS URLs or credentials and must not be logged.
    throw new Error(`${method} request failed (HTTP ${response.status}).`);
  }
}

function githubClient(env) {
  const token = required(env, 'GH_TOKEN');
  return (suffix, method = 'GET', body) => requestJson(
    `https://api.github.com/repos/${repository}/${suffix}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }
  );
}

async function allPages(github, suffix, field) {
  const results = [];
  for (let page = 1; ; page++) {
    const response = await github(`${suffix}${suffix.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = field ? response[field] : response;
    if (!Array.isArray(items)) throw new Error('GitHub returned an unexpected list response.');
    results.push(...items);
    if (items.length < 100) return results;
  }
}

async function recordStatus(github, deployment, phase, submissionId, state = 'in_progress', env = process.env) {
  if (submissionId && !/^\d+$/.test(submissionId)) throw new Error('Store submission ID is invalid.');
  return github(`deployments/${deployment.id}/statuses`, 'POST', {
    state, description: `msstore:${phase}${submissionId ? `;submission=${submissionId}` : ''}`,
    log_url: `https://github.com/${repository}/actions/runs/${required(env, 'GITHUB_RUN_ID')}`,
    auto_inactive: false
  });
}

async function downloadEvidence(github, { tag, commit }, env) {
  const runs = await allPages(github,
    `actions/workflows/desktop-release.yml/runs?head_sha=${encodeURIComponent(commit)}&event=push`, 'workflow_runs');
  const run = runs.filter(item => item.conclusion === 'success' && item.head_sha === commit &&
    item.head_branch === tag).sort((a, b) => b.id - a.id)[0];
  if (!run) throw new Error('No successful desktop build exists for this exact tag and commit.');
  const artifacts = await allPages(github, `actions/runs/${run.id}/artifacts`, 'artifacts');
  if (!artifacts.some(item => item.name === 'store-msix-x64' && !item.expired)) {
    throw new Error('Missing retained store-msix-x64 evidence. Rebuild the same release tag.');
  }
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-store-')));
  try {
    const packageDirectory = path.join(temporary, 'store-msix-x64');
    await execute('gh', ['run', 'download', String(run.id), '--repo', repository,
      '--name', 'store-msix-x64', '--dir', packageDirectory],
    { env, timeout: 300_000, maxBuffer: 1024 * 1024, windowsHide: true });
    const metadata = JSON.parse(await fs.readFile(path.join(packageDirectory, 'store-package.json'), 'utf8'));
    const filename = `EffeTune-${tag.slice(1)}-Store-x64.msix`;
    const packagePath = path.join(packageDirectory, filename);
    const identity = JSON.parse(await fs.readFile(path.join(root, 'build/msix/store-identity.json'), 'utf8'));
    verifyEvidence({ metadata, identity, tag, commit, bytes: await fs.readFile(packagePath) });
    return { temporary, packagePath, metadata, runId: run.id };
  } catch {
    await fs.rm(temporary, { recursive: true, force: true });
    throw new Error('Could not download and verify release MSIX evidence. Rebuild the exact tag if artifacts expired.');
  }
}

export function checkCredentialExpiry(value, now = Date.now()) {
  const expiry = Date.parse(value || '');
  if (!Number.isFinite(expiry)) throw new Error('Set MSSTORE_CREDENTIAL_EXPIRES_AT to the client secret expiry date.');
  const days = Math.floor((expiry - now) / 86_400_000);
  if (days <= 0) throw new Error('Microsoft Store credentials have expired; rotate the client secret.');
  return days;
}

async function prepare(env) {
  const days = checkCredentialExpiry(env.MSSTORE_CREDENTIAL_EXPIRES_AT);
  if (days <= 30) console.warn('::warning::Microsoft Store credentials expire within 30 days. Rotate the client secret.');
  const github = githubClient(env);
  let deployments = await allPages(github, `deployments?environment=${environment}`);
  if (env.GITHUB_EVENT_NAME === 'release' || env.MSSTORE_RELEASE_TAG) {
    const event = env.GITHUB_EVENT_NAME === 'release'
      ? JSON.parse(await fs.readFile(required(env, 'GITHUB_EVENT_PATH'), 'utf8')) : null;
    const tag = event?.release?.tag_name || env.MSSTORE_RELEASE_TAG;
    const release = await github(`releases/tags/${encodeURIComponent(tag)}`);
    const version = releaseVersion(release);
    const commit = (await github(`commits/${encodeURIComponent(tag)}`)).sha;
    const packageFile = await github(`contents/package.json?ref=${encodeURIComponent(commit)}`);
    if (JSON.parse(Buffer.from(packageFile.content, 'base64').toString('utf8')).version !== version) {
      throw new Error('The published tag does not match package.json.');
    }
    if (!deployments.some(item => item.ref === tag && item.sha === commit)) {
      const evidence = await downloadEvidence(github, { tag, commit }, env);
      try {
        const deployment = await github('deployments', 'POST', {
          ref: tag, environment, auto_merge: false, required_contexts: [],
          description: `Microsoft Store ${version}`,
          payload: { ...evidence.metadata, buildRunId: evidence.runId }
        });
        await recordStatus(github, deployment, 'queued', undefined, 'queued', env);
        deployments.unshift(deployment);
      } finally {
        await fs.rm(evidence.temporary, { recursive: true, force: true });
      }
    }
  }
  let selected;
  for (const deployment of deployments.reverse()) {
    const statuses = await github(`deployments/${deployment.id}/statuses?per_page=1`);
    if (!terminalStates.has(statuses[0]?.state)) { selected = deployment; break; }
  }
  if (selected) await fs.appendFile(required(env, 'GITHUB_OUTPUT'), `deployment_id=${selected.id}\n`);
  else console.log('No Store submissions are waiting.');
}

async function storeClient(env, productId) {
  const auth = await requestJson(
    `https://login.microsoftonline.com/${encodeURIComponent(required(env, 'MSSTORE_TENANT_ID'))}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: required(env, 'MSSTORE_CLIENT_ID'),
        client_secret: required(env, 'MSSTORE_CLIENT_SECRET'), resource: 'https://manage.devcenter.microsoft.com'
      })
    });
  if (!auth.access_token) throw new Error('Store authentication did not return an access token.');
  const application = `${storeApi}/applications/${encodeURIComponent(productId)}`;
  return (suffix = '', method = 'GET', body) => requestJson(`${application}${suffix}`, {
    method, headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function runCli(args, env) {
  try {
    // CLI output can contain an upload SAS URL. Never forward stdout/stderr or exec errors.
    await execute('msstore', args, { env, timeout: 600_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  } catch {
    throw new Error('Microsoft Store CLI did not confirm completion. The saved submission intent must be reconciled.');
  }
}

export async function advanceSubmission({ payload, previous, store, record, upload, templates }) {
  const app = await store();
  if (app.id !== payload.identity.productId || app.packageIdentityName !== payload.identity.name ||
      app.publisherName !== payload.identity.publisher) throw new Error('The Store application identity differs from the package.');
  const publishedId = app.lastPublishedApplicationSubmission?.id;
  if (!publishedId) throw new Error('Complete the initial Store publication before enabling automatic updates.');
  const published = await store(`/submissions/${publishedId}`);
  const versions = (published.applicationPackages || [])
    .filter(item => item.fileStatus !== 'PendingDelete').map(item => item.version);
  if (!versions.length) throw new Error('The published Store package version is unavailable.');
  if (versions.some(version => compareVersions(version, payload.version) >= 0)) {
    await record('published-or-newer', previous.submissionId, 'success');
    return 'published';
  }
  const pendingId = app.pendingApplicationSubmission?.id;
  let submissionId = previous.submissionId;
  if (!submissionId) {
    if (pendingId) {
      // An unknown draft may belong to Partner Center or an interrupted upload. Preserve it.
      throw new Error('An unowned pending Store submission exists; inspect it before resuming.');
    }
    if (previous.phase !== 'queued') {
      throw new Error('A previous upload has an unknown outcome. Do not repeat publish; reconcile it first.');
    }
    await record('upload-started');
    try {
      await upload();
    } catch (error) {
      const observed = await store();
      const uncertainId = observed.pendingApplicationSubmission?.id;
      await record('upload-unknown', uncertainId);
      throw error;
    }
    const refreshed = await store();
    submissionId = refreshed.pendingApplicationSubmission?.id;
    if (!submissionId) throw new Error('Upload completed but the pending submission ID is unavailable.');
    await record('uploaded', submissionId);
    previous = { phase: 'uploaded', submissionId };
  }
  const submission = await store(`/submissions/${submissionId}`);
  if (submission.id !== submissionId) throw new Error('Store returned a different submission ID.');
  if (submission.status === 'Published') {
    await record('published', submissionId, 'success');
    return 'published';
  }
  if (submission.status?.endsWith('Failed') || submission.status === 'Canceled') {
    await record('rejected', submissionId, 'failure');
    throw new Error(`Store submission ${submissionId} failed certification or publication. Inspect Partner Center.`);
  }
  if (activeSubmissionStates.has(submission.status)) {
    await record('review', submissionId);
    return 'review';
  }
  if (submission.status !== 'PendingCommit' || !['uploaded', 'metadata'].includes(previous.phase) ||
      pendingId && pendingId !== submissionId) {
    throw new Error('Submission outcome is uncertain; inspect the recorded ID without recreating the draft.');
  }
  const packages = (submission.applicationPackages || []).filter(item => item.fileStatus !== 'PendingDelete');
  if (packages.length !== 1 || packages[0].fileName !== `EffeTune-${payload.packageVersion}-Store-x64.msix`) {
    throw new Error('The pending draft package does not match the uploaded release.');
  }
  const updated = updateListing(submission, payload.packageVersion,
    `https://github.com/${repository}/releases/tag/${payload.tag}`, templates);
  await store(`/submissions/${submissionId}`, 'PUT', updated);
  await record('metadata', submissionId);
  await record('commit-started', submissionId);
  await store(`/submissions/${submissionId}/commit`, 'POST');
  await record('review', submissionId);
  return 'review';
}

async function submit(env) {
  const github = githubClient(env);
  const deploymentId = required(env, 'MSSTORE_DEPLOYMENT_ID');
  if (!/^\d+$/.test(deploymentId)) throw new Error('Invalid deployment ID.');
  const deployment = await github(`deployments/${deploymentId}`);
  const payload = deployment.payload;
  if (deployment.environment !== environment || payload?.schemaVersion !== 1 ||
      deployment.sha !== payload.commit || deployment.ref !== payload.tag) throw new Error('Invalid Store deployment.');
  const release = await github(`releases/tags/${encodeURIComponent(payload.tag)}`);
  if (releaseVersion(release) !== payload.packageVersion ||
      (await github(`commits/${encodeURIComponent(payload.tag)}`)).sha !== payload.commit) {
    throw new Error('The queued release changed.');
  }
  const status = (await github(`deployments/${deploymentId}/statuses?per_page=1`))[0];
  if (terminalStates.has(status?.state)) return;
  const previous = status ? parseStatus(status) : { phase: 'queued' };
  const identity = JSON.parse(await fs.readFile(path.join(root, 'build/msix/store-identity.json'), 'utf8'));
  if (identity.productId !== payload.identity?.productId || identity.name !== payload.identity?.name ||
      identity.publisher !== payload.identity?.publisher) throw new Error('Store identity changed after validation.');
  const store = await storeClient(env, identity.productId);
  const record = (phase, id, state) => recordStatus(github, deployment, phase, id, state, env);
  const templates = JSON.parse(await fs.readFile(path.join(root, 'build/msix/store-listing/release-notes.json'), 'utf8'));
  const result = await advanceSubmission({
    payload, previous, store, record, templates,
    upload: async () => {
      const evidence = await downloadEvidence(github, payload, env);
      try {
        if (evidence.metadata.sha256 !== payload.sha256) throw new Error('The queued package hash changed.');
        // Re-read immediately before invoking the CLI, which can delete an existing draft.
        if ((await store()).pendingApplicationSubmission?.id) throw new Error('A pending draft appeared before upload.');
        const cliHome = path.join(evidence.temporary, 'cli-home');
        await fs.mkdir(cliHome);
        const cliEnv = { ...env, HOME: cliHome, XDG_DATA_HOME: path.join(cliHome, '.local/share') };
        try {
          await runCli(['reconfigure', '--tenantId', required(env, 'MSSTORE_TENANT_ID'),
            '--sellerId', required(env, 'MSSTORE_SELLER_ID'), '--clientId', required(env, 'MSSTORE_CLIENT_ID'),
            '--clientSecret', required(env, 'MSSTORE_CLIENT_SECRET')], cliEnv);
          await runCli(['publish', evidence.packagePath, '--appId', identity.productId, '--noCommit'], cliEnv);
        } finally {
          await runCli(['reconfigure', '--reset'], cliEnv);
        }
      } finally {
        await fs.rm(evidence.temporary, { recursive: true, force: true });
      }
    }
  });
  if (env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(env.GITHUB_STEP_SUMMARY,
      `Microsoft Store ${payload.tag}: ${result === 'published' ? 'publication confirmed (or a newer version is published)' : 'submitted; Store review/publication is still pending'}.\n`);
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (env.GITHUB_REPOSITORY !== repository || env.MSSTORE_AUTOPUBLISH_ENABLED !== 'true') {
    throw new Error('Store automation is enabled only for the configured official repository.');
  }
  if (args.length !== 1 || !['--prepare', '--submit'].includes(args[0])) {
    throw new Error('Use --prepare to queue/select a published release, or --submit to advance the selected deployment.');
  }
  if (args[0] === '--prepare') await prepare(env);
  else await submit(env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
