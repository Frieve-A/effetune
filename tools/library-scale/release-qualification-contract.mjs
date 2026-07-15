import { createHash } from 'node:crypto';

export const RELEASE_QUALIFICATION_AUTOMATION_VERSION = 'release-qualification-contract-v1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function computeArtifactDigest(value) {
  const payload = { ...value };
  delete payload.artifactDigest;
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')}`;
}

export function sealArtifact(value) {
  return { ...value, artifactDigest: computeArtifactDigest(value) };
}

export function assertArtifactDigest(value, label = 'artifact') {
  const expected = computeArtifactDigest(value);
  if (value?.artifactDigest !== expected) {
    throw new Error(`${label} digest mismatch`);
  }
  return expected;
}
