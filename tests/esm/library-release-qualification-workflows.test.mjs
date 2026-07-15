import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  assertArtifactDigest,
  RELEASE_QUALIFICATION_AUTOMATION_VERSION,
  sealArtifact
} from '../../tools/library-scale/release-qualification-contract.mjs';

function readWorkflow(name) {
  return fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
}

test('release qualification and Pages use one exact candidate SHA without transition stages', () => {
  const qualification = readWorkflow('library-release-qualification.yml');
  const pages = readWorkflow('pages.yml');
  const workflows = `${qualification}\n${pages}`;

  assert.match(qualification, /candidate_sha:/);
  assert.match(qualification, /refs\/tags\/['"]?\+tag|refs\/tags\//);
  assert.match(qualification, /release-qualification-\$\{\{ needs\.candidate\.outputs\.sha \}\}/);
  assert.match(pages, /head_sha.*QUALIFIED_SHA/);
  assert.match(pages, /Deploy checkout differs from qualified SHA/);
  assert.doesNotMatch(workflows, /transition_stage|interim_evidence|minimumExposure|storageBoundary|Transition Guide/);
});

test('release qualification artifacts are sealed and reject tampering', () => {
  const artifact = sealArtifact({
    schemaVersion: 1,
    kind: 'release-qualification',
    commitSha: 'a'.repeat(40),
    automationVersion: RELEASE_QUALIFICATION_AUTOMATION_VERSION
  });
  assert.match(assertArtifactDigest(artifact), /^sha256:[0-9a-f]{64}$/);
  assert.throws(
    () => assertArtifactDigest({ ...artifact, commitSha: 'b'.repeat(40) }),
    /digest mismatch/
  );
});
