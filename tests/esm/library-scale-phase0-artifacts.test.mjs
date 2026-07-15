import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  catalogBatches,
  resolveScaleSize,
  summarizeCatalog
} from '../../tools/library-scale/catalog-fixture.mjs';
import {
  createVirtualizationPlan,
  locateVirtualRow
} from '../../tools/library-scale/benchmark-virtualization.mjs';
import {
  computePhase0DecisionDigest,
  PHASE0_SECTION_KEYS,
  validateConsumerJoin,
  validateDecisionIdImmutability,
  validatePhase0Artifact
} from '../../tools/library-scale/validate-phase0-artifacts.mjs';

const artifactUrl = new URL('../../tools/library-scale/phase0-decisions.json', import.meta.url);

async function readArtifact() {
  return JSON.parse(await fs.readFile(artifactUrl, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function qualify(artifact) {
  const qualified = clone(artifact);
  qualified.qualification.status = 'qualified';
  qualified.qualification.qualifiedAt = '2026-07-13T12:00:00.000Z';
  for (const section of Object.values(qualified.sections)) {
    section.decision = 'go';
    for (const entries of Object.values(section.evidence)) {
      for (const entry of entries) {
        entry.status = 'measured';
        entry.artifactPath = `artifacts/${entry.id}.json`;
        entry.artifactSha256 = `sha256:${'a'.repeat(64)}`;
        entry.measuredAt = '2026-07-13T11:00:00.000Z';
      }
    }
  }
  return qualified;
}

function createConsumer(artifact, artifactType) {
  const required = artifactType === 'phase2-gate'
    ? ['backendArchitecture', 'storageIdentity', 'pathGrant']
    : PHASE0_SECTION_KEYS;
  return {
    schemaVersion: 1,
    artifactType,
    phase0ArtifactId: artifact.artifactId,
    phase0DecisionDigest: computePhase0DecisionDigest(artifact),
    phase0References: Object.fromEntries(
      required.map(key => [key, artifact.sections[key].decisionId])
    )
  };
}

test('pending Phase 0 decisions are valid records but cannot qualify consumers', async () => {
  const artifact = await readArtifact();
  const result = validatePhase0Artifact(artifact);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(artifact.qualification.status, 'pending');
  assert.equal(artifact.qualification.qualifiedAt, null);

  const consumer = createConsumer(artifact, 'phase1-contract');
  const join = validateConsumerJoin(consumer, artifact);
  assert.equal(join.valid, false);
  assert.ok(join.errors.some(error => error.includes('pending')));
});

test('qualification requires real dates, go decisions, and measured runtime evidence', async () => {
  const pending = await readArtifact();
  const invalid = clone(pending);
  invalid.qualification.status = 'qualified';
  assert.equal(validatePhase0Artifact(invalid).valid, false);

  const specifiedOnly = clone(pending);
  specifiedOnly.qualification.status = 'qualified';
  specifiedOnly.qualification.qualifiedAt = '2026-07-13T12:00:00.000Z';
  for (const section of Object.values(specifiedOnly.sections)) section.decision = 'go';
  const specifiedResult = validatePhase0Artifact(specifiedOnly);
  assert.equal(specifiedResult.valid, false);
  assert.ok(specifiedResult.errors.some(error => error.includes('measured or verified')));

  const qualified = qualify(pending);
  assert.equal(validatePhase0Artifact(qualified).valid, true);
});

test('consumer references exact-join the current qualified artifact and canonical digest', async () => {
  const artifact = qualify(await readArtifact());
  for (const artifactType of ['phase1-contract', 'phase2-gate', 'release-qualification']) {
    const consumer = createConsumer(artifact, artifactType);
    assert.equal(validateConsumerJoin(consumer, artifact).valid, true);

    const stale = clone(consumer);
    stale.phase0DecisionDigest = `sha256:${'0'.repeat(64)}`;
    assert.equal(validateConsumerJoin(stale, artifact).valid, false);

    const mismatched = clone(consumer);
    const [firstKey] = Object.keys(mismatched.phase0References);
    mismatched.phase0References[firstKey] = 'phase0:wrongSection:v1';
    assert.equal(validateConsumerJoin(mismatched, artifact).valid, false);
  }
});

test('decision IDs cannot change meaning without a version increment', async () => {
  const previous = await readArtifact();
  const rewritten = clone(previous);
  rewritten.sections.storageIdentity.chosenApproach = 'Different storage semantics';
  const rejected = validateDecisionIdImmutability(rewritten, previous);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => error.includes('changed meaning')));

  rewritten.sections.storageIdentity.decisionId = 'phase0:storageIdentity:v2';
  assert.equal(validateDecisionIdImmutability(rewritten, previous).valid, true);
});

test('section IDs and artifact structure fail closed on mismatches and extras', async () => {
  const artifact = await readArtifact();
  const wrongSection = clone(artifact);
  wrongSection.sections.entitySemantics.decisionId = 'phase0:storageIdentity:v1';
  const wrongSectionResult = validatePhase0Artifact(wrongSection);
  assert.equal(wrongSectionResult.valid, false);
  assert.ok(wrongSectionResult.errors.some(error => error.includes('entitySemantics')));
  assert.ok(wrongSectionResult.errors.some(error => error.includes('duplicated')));

  const extra = clone(artifact);
  extra.sections.unplannedDecision = clone(extra.sections.pathGrant);
  assert.equal(validatePhase0Artifact(extra).valid, false);
});

test('catalog generation is deterministic, unique, and bounded by batch size', () => {
  const batches = [...catalogBatches({ count: 2_503, seed: 123, batchSize: 1_000 })];
  assert.deepEqual(batches.map(batch => batch.length), [1_000, 1_000, 503]);
  const tracks = batches.flat();
  assert.equal(new Set(tracks.map(track => track.trackUid)).size, tracks.length);
  assert.equal(new Set(tracks.map(track => `${track.folderId}/${track.relativePath}`)).size, tracks.length);
  assert.deepEqual(
    summarizeCatalog({ count: 2_503, seed: 123, batchSize: 1_000 }),
    summarizeCatalog({ count: 2_503, seed: 123, batchSize: 1_000 })
  );
  assert.equal(resolveScaleSize({ preset: 'million' }), 1_000_000);
  assert.equal(resolveScaleSize({ preset: 'boundary' }), 5_000_000);
});

test('segmented virtualization keeps five million rows below the pixel ceiling', () => {
  const plan = createVirtualizationPlan({ rowCount: 5_000_000 });
  assert.ok(plan.segmentCount > 1);
  assert.ok(plan.maximumRenderedSegmentPixels <= plan.maxSegmentPixels);
  assert.equal(locateVirtualRow(plan, 0).segmentIndex, 0);
  assert.equal(locateVirtualRow(plan, 4_999_999).segmentIndex, plan.segmentCount - 1);
  assert.equal(plan.logicalHeight, '200000000');
});
