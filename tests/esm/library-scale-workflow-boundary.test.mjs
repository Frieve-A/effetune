import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const workflows = new URL('../../.github/workflows/', import.meta.url);
const repositoryRoot = new URL('../../', import.meta.url);
const folderTreeManifestUrl = new URL(
  'tmp/dev/library-folder-tree-scale-20260721-record-manifest.json',
  repositoryRoot
);

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

test('fixed-reference performance measurement remains a manual development command', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(packageJson.scripts.verify, /library-scale|fixed-reference/);
  assert.match(packageJson.scripts['test:library-scale:reference'], /run-fixed-reference-performance/);
  for (const entry of fs.readdirSync(workflows)) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const contents = fs.readFileSync(new URL(entry, workflows), 'utf8');
    assert.doesNotMatch(contents, /test:library-scale:reference|run-fixed-reference-performance/);
  }
});

test('canonical folder-tree evidence uses the current schema-v2 measurement contract', {
  skip: !fs.existsSync(folderTreeManifestUrl) && 'local internal scale records are unavailable'
}, () => {
  const manifest = JSON.parse(fs.readFileSync(folderTreeManifestUrl, 'utf8'));
  assert.equal(manifest.canonical.authority, 'current-acceptance');
  assert.equal(manifest.canonical.recordSchemaVersion, 2);
  const canonicalUrl = new URL(manifest.canonical.path, repositoryRoot);
  const canonicalBytes = fs.readFileSync(canonicalUrl);
  assert.equal(sha256(canonicalBytes), manifest.canonical.sha256);
  const record = JSON.parse(canonicalBytes);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.fixture.preset, 'million');
  assert.equal(record.fixture.count, 1_000_000);
  assert.ok(record.fixture.productionScanClaimSample > 0);
  assert.ok(record.metrics.productionScanClaimMs > 0);
  assert.ok(record.metrics.productionScanClaimTracksPerSecond > 0);
  assert.equal(record.metrics.contexts.rootFirstPageRows, 0);
  assert.ok(record.metrics.contexts.rootFirstPageP95Ms >= 0);
  assert.ok(record.metrics.contexts.rootCountP95Ms >= 0);
  assert.equal(record.budgets.queryDecision, 'pass');
  assert.equal(
    record.budgets.productionScanClaimDecision,
    'unqualified-no-comparable-phase0-baseline-or-ceiling'
  );
  assert.equal(record.budgets.architectureSwitch, 'pending-without-a-qualified-phase0-comparator');
  assert.equal(Object.hasOwn(record.metrics, 'productionWriteMs'), false);
  assert.match(record.queryPlans.rootDirectTracks.join('\n'), /tracks_root_direct_by_folder/);

  assert.deepEqual(new Set(Object.keys(manifest.canonical.sourceSha256)), new Set([
    'tools/library-scale/benchmark-electron-sqlite.cjs',
    'tools/library-scale/catalog-fixture.mjs',
    'electron/library-catalog-host.cjs',
    'electron/library-catalog-worker.cjs',
    'js/library/repository/schema-v3.js'
  ]));
  for (const [relativePath, expectedHash] of Object.entries(manifest.canonical.sourceSha256)) {
    assert.equal(sha256(fs.readFileSync(new URL(relativePath, repositoryRoot))), expectedHash);
  }

  assert.equal(manifest.historical.length, 1);
  const historicalEntry = manifest.historical[0];
  assert.equal(historicalEntry.authority, 'historical-diagnostic-only');
  assert.match(historicalEntry.path, /schema-v1-historical\.json$/);
  const historicalBytes = fs.readFileSync(new URL(historicalEntry.path, repositoryRoot));
  assert.equal(sha256(historicalBytes), historicalEntry.sha256);
  const historical = JSON.parse(historicalBytes);
  assert.equal(historical.schemaVersion, 1);
  assert.equal(historical.fixture.preset, 'boundary');
  assert.equal(Object.hasOwn(historical.metrics, 'productionScanClaimMs'), false);
  assert.equal(Object.hasOwn(historical.metrics.contexts, 'rootFirstPageP95Ms'), false);
  assert.equal(fs.existsSync(new URL(
    'tmp/dev/library-folder-tree-scale-20260721-boundary.json', repositoryRoot
  )), false);
  assert.equal(fs.existsSync(new URL(
    'tmp/dev/library-folder-tree-scale-20260721-round4-million.json', repositoryRoot
  )), false);
});
