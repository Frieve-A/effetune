import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMain, parseArgs } from './cli.mjs';

export const PHASE0_SECTION_KEYS = Object.freeze([
  'backendArchitecture',
  'storageIdentity',
  'entitySemantics',
  'substringSearch',
  'pathGrant'
]);

const REQUIRED_REFERENCES = Object.freeze({
  'phase1-contract': PHASE0_SECTION_KEYS,
  'phase2-gate': Object.freeze(['backendArchitecture', 'storageIdentity', 'pathGrant']),
  'release-qualification': PHASE0_SECTION_KEYS
});

const OWNER_FIXED_BACKEND_APPROACH = 'Use node:sqlite in the Electron utility process and SQLite WASM with OPFS in the dedicated Web Worker; never use IndexedDB for catalog data or as a catalog fallback.';

const ARTIFACT_KEYS = Object.freeze(['schemaVersion', 'artifactId', 'qualification', 'sections']);
const QUALIFICATION_KEYS = Object.freeze([
  'status',
  'qualifiedAt',
  'fixtureSeed',
  'audioWorkletUnderrun'
]);
const UNDERRUN_KEYS = Object.freeze([
  'warmUpSeconds',
  'measurementSeconds',
  'sampleRate',
  'bufferSize',
  'counterDefinition'
]);
const DECISION_KEYS = Object.freeze([
  'decisionId',
  'decision',
  'chosenApproach',
  'alternatives',
  'oracle',
  'evidence',
  'budget'
]);
const CONSUMER_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'phase0ArtifactId',
  'phase0DecisionDigest',
  'phase0References'
]);
const EVIDENCE_KEYS = Object.freeze([
  'id',
  'kind',
  'status',
  'artifactPath',
  'artifactSha256',
  'runtime',
  'fixtureSeed',
  'measuredAt'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expectedKeys, location, errors) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    errors.push(`${location} keys must be exactly: ${expected.join(', ')}`);
    return false;
  }
  return true;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function computePhase0DecisionDigest(artifact) {
  const canonical = canonicalJson({
    schemaVersion: artifact?.schemaVersion,
    artifactId: artifact?.artifactId,
    qualificationStatus: artifact?.qualification?.status,
    sections: artifact?.sections
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function validateStringArray(value, location, errors) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => !nonEmptyString(item))) {
    errors.push(`${location} must be a non-empty array of non-empty strings`);
  }
}

function validateEvidenceEntries(value, location, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${location} must contain at least one entry`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (!exactKeys(entry, EVIDENCE_KEYS, itemLocation, errors)) continue;
    if (!nonEmptyString(entry.id)) errors.push(`${itemLocation}.id must be non-empty`);
    if (!nonEmptyString(entry.kind)) errors.push(`${itemLocation}.kind must be non-empty`);
    if (!['specified', 'measured', 'verified'].includes(entry.status)) {
      errors.push(`${itemLocation}.status is invalid`);
    }
    if (!nonEmptyString(entry.artifactPath)) {
      errors.push(`${itemLocation}.artifactPath must be non-empty`);
    }
    if (entry.artifactSha256 !== null
        && !/^sha256:[0-9a-f]{64}$/.test(entry.artifactSha256)) {
      errors.push(`${itemLocation}.artifactSha256 must be null or a SHA-256 digest`);
    }
    if (!nonEmptyString(entry.runtime)) errors.push(`${itemLocation}.runtime must be non-empty`);
    if (!Number.isSafeInteger(entry.fixtureSeed)
        || entry.fixtureSeed < 0
        || entry.fixtureSeed > 0xffffffff) {
      errors.push(`${itemLocation}.fixtureSeed must be an unsigned 32-bit integer`);
    }
    if (entry.measuredAt !== null
        && (!nonEmptyString(entry.measuredAt) || Number.isNaN(Date.parse(entry.measuredAt)))) {
      errors.push(`${itemLocation}.measuredAt must be null or an ISO date-time`);
    }
  }
}

function validateDecision(sectionKey, decision, errors) {
  const location = `sections.${sectionKey}`;
  if (!exactKeys(decision, DECISION_KEYS, location, errors)) return;
  const idPattern = new RegExp(`^phase0:${sectionKey}:v[1-9][0-9]*$`);
  if (!idPattern.test(decision.decisionId)) {
    errors.push(`${location}.decisionId must match phase0:${sectionKey}:vN`);
  }
  if (!['pending', 'go', 'no-go'].includes(decision.decision)) {
    errors.push(`${location}.decision must be pending, go, or no-go`);
  }
  if (!nonEmptyString(decision.chosenApproach)) {
    errors.push(`${location}.chosenApproach must be non-empty`);
  }
  validateStringArray(decision.alternatives, `${location}.alternatives`, errors);

  if (exactKeys(decision.oracle, ['id', 'fixtures'], `${location}.oracle`, errors)) {
    if (!nonEmptyString(decision.oracle.id)) errors.push(`${location}.oracle.id must be non-empty`);
    validateStringArray(decision.oracle.fixtures, `${location}.oracle.fixtures`, errors);
  }
  if (exactKeys(decision.evidence, ['electron', 'web'], `${location}.evidence`, errors)) {
    validateEvidenceEntries(decision.evidence.electron, `${location}.evidence.electron`, errors);
    validateEvidenceEntries(decision.evidence.web, `${location}.evidence.web`, errors);
  }
  if (!isObject(decision.budget) || Object.keys(decision.budget).length === 0) {
    errors.push(`${location}.budget must be a non-empty object`);
  } else if (Object.values(decision.budget).some(value => !nonEmptyString(value))) {
    errors.push(`${location}.budget values must be non-empty strings`);
  }
}

export function validatePhase0Artifact(artifact) {
  const errors = [];
  if (!exactKeys(artifact, ARTIFACT_KEYS, 'artifact', errors)) {
    return { valid: false, errors, digest: computePhase0DecisionDigest(artifact) };
  }
  if (artifact.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^phase0-artifact:v[1-9][0-9]*$/.test(artifact.artifactId)) {
    errors.push('artifactId must match phase0-artifact:vN');
  }

  if (exactKeys(artifact.qualification, QUALIFICATION_KEYS, 'qualification', errors)) {
    const qualification = artifact.qualification;
    if (!['pending', 'qualified'].includes(qualification.status)) {
      errors.push('qualification.status must be pending or qualified');
    }
    if (qualification.status === 'pending' && qualification.qualifiedAt !== null) {
      errors.push('qualification.qualifiedAt must be null while pending');
    }
    if (qualification.status === 'qualified'
        && (!nonEmptyString(qualification.qualifiedAt)
          || Number.isNaN(Date.parse(qualification.qualifiedAt)))) {
      errors.push('qualification.qualifiedAt must be an ISO date-time when qualified');
    }
    if (!Number.isSafeInteger(qualification.fixtureSeed)
        || qualification.fixtureSeed < 0
        || qualification.fixtureSeed > 0xffffffff) {
      errors.push('qualification.fixtureSeed must be an unsigned 32-bit integer');
    }
    if (exactKeys(
      qualification.audioWorkletUnderrun,
      UNDERRUN_KEYS,
      'qualification.audioWorkletUnderrun',
      errors
    )) {
      for (const key of UNDERRUN_KEYS.slice(0, 4)) {
        if (!positiveInteger(qualification.audioWorkletUnderrun[key])) {
          errors.push(`qualification.audioWorkletUnderrun.${key} must be positive`);
        }
      }
      if (!nonEmptyString(qualification.audioWorkletUnderrun.counterDefinition)) {
        errors.push('qualification.audioWorkletUnderrun.counterDefinition must be non-empty');
      }
    }
  }

  if (exactKeys(artifact.sections, PHASE0_SECTION_KEYS, 'sections', errors)) {
    const decisionIds = new Set();
    for (const sectionKey of PHASE0_SECTION_KEYS) {
      const decision = artifact.sections[sectionKey];
      validateDecision(sectionKey, decision, errors);
      if (nonEmptyString(decision?.decisionId)) {
        if (decisionIds.has(decision.decisionId)) {
          errors.push(`decisionId is duplicated: ${decision.decisionId}`);
        }
        decisionIds.add(decision.decisionId);
      }
    }
    const backendArchitecture = artifact.sections.backendArchitecture;
    if (backendArchitecture?.decision !== 'go') {
      errors.push('sections.backendArchitecture.decision must remain go under Owner decision V2');
    }
    if (backendArchitecture?.chosenApproach !== OWNER_FIXED_BACKEND_APPROACH) {
      errors.push('sections.backendArchitecture.chosenApproach must match Owner decision V2');
    }
    if (backendArchitecture?.budget?.productionCatalogBackendsPerRuntime !== '1'
        || backendArchitecture?.budget?.webCatalogIndexedDbAccesses !== '0'
        || backendArchitecture?.budget?.webIndexedDbCatalogFallbacks !== '0') {
      errors.push('sections.backendArchitecture.budget must enforce one backend per runtime and zero Web catalog IndexedDB access/fallback');
    }
    if (artifact.qualification?.status === 'qualified') {
      for (const sectionKey of PHASE0_SECTION_KEYS) {
        const decision = artifact.sections[sectionKey];
        if (decision?.decision !== 'go') {
          errors.push(`sections.${sectionKey}.decision must be go when qualified`);
        }
        for (const runtime of ['electron', 'web']) {
          const entries = decision?.evidence?.[runtime];
          if (!Array.isArray(entries)
              || entries.some(entry => !['measured', 'verified'].includes(entry?.status))) {
            errors.push(
              `sections.${sectionKey}.evidence.${runtime} must be measured or verified when qualified`
            );
          }
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (!/^sha256:[0-9a-f]{64}$/.test(entry?.artifactSha256 ?? '')) {
                errors.push(
                  `sections.${sectionKey}.evidence.${runtime} requires a content-addressed artifact when qualified`
                );
              }
              if (!nonEmptyString(entry?.measuredAt)
                  || Number.isNaN(Date.parse(entry.measuredAt))) {
                errors.push(
                  `sections.${sectionKey}.evidence.${runtime} requires measuredAt when qualified`
                );
              }
              if (entry?.fixtureSeed !== artifact.qualification.fixtureSeed) {
                errors.push(
                  `sections.${sectionKey}.evidence.${runtime} fixtureSeed must match qualification.fixtureSeed`
                );
              }
            }
          }
        }
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    digest: computePhase0DecisionDigest(artifact)
  };
}

export function validateDecisionIdImmutability(currentArtifact, previousArtifact) {
  const errors = [];
  const current = validatePhase0Artifact(currentArtifact);
  const previous = validatePhase0Artifact(previousArtifact);
  if (!current.valid) errors.push(...current.errors.map(error => `current: ${error}`));
  if (!previous.valid) errors.push(...previous.errors.map(error => `previous: ${error}`));
  if (errors.length > 0) return { valid: false, errors };

  const previousById = new Map(
    PHASE0_SECTION_KEYS.map(key => [
      previousArtifact.sections[key].decisionId,
      canonicalJson({
        chosenApproach: previousArtifact.sections[key].chosenApproach,
        alternatives: previousArtifact.sections[key].alternatives,
        oracle: previousArtifact.sections[key].oracle,
        budget: previousArtifact.sections[key].budget
      })
    ])
  );
  for (const sectionKey of PHASE0_SECTION_KEYS) {
    const decision = currentArtifact.sections[sectionKey];
    const prior = previousById.get(decision.decisionId);
    const currentMeaning = canonicalJson({
      chosenApproach: decision.chosenApproach,
      alternatives: decision.alternatives,
      oracle: decision.oracle,
      budget: decision.budget
    });
    if (prior !== undefined && prior !== currentMeaning) {
      errors.push(`${decision.decisionId} changed meaning; issue a new versioned decisionId`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateConsumerJoin(consumer, phase0Artifact) {
  const phase0 = validatePhase0Artifact(phase0Artifact);
  const errors = phase0.errors.map(error => `phase0: ${error}`);
  if (phase0Artifact?.qualification?.status !== 'qualified') {
    errors.push('phase0 artifact is pending and cannot satisfy a consumer join');
  }
  if (!exactKeys(consumer, CONSUMER_KEYS, 'consumer', errors)) {
    return { valid: false, errors, digest: phase0.digest };
  }
  if (consumer.schemaVersion !== 1) errors.push('consumer.schemaVersion must be 1');
  const requiredSections = REQUIRED_REFERENCES[consumer.artifactType];
  if (!requiredSections) {
    errors.push(`consumer.artifactType is unknown: ${consumer.artifactType}`);
  }
  if (consumer.phase0ArtifactId !== phase0Artifact?.artifactId) {
    errors.push('consumer.phase0ArtifactId does not identify the current qualified artifact');
  }
  if (consumer.phase0DecisionDigest !== phase0.digest) {
    errors.push('consumer.phase0DecisionDigest is stale');
  }
  if (requiredSections
      && exactKeys(consumer.phase0References, requiredSections, 'consumer.phase0References', errors)) {
    for (const sectionKey of requiredSections) {
      const expected = phase0Artifact.sections?.[sectionKey]?.decisionId;
      if (consumer.phase0References[sectionKey] !== expected) {
        errors.push(`consumer.phase0References.${sectionKey} does not exactly join ${expected}`);
      }
    }
  }
  return { valid: errors.length === 0, errors, digest: phase0.digest };
}

function assertValid(result, label) {
  if (!result.valid) throw new Error(`${label}:\n- ${result.errors.join('\n- ')}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function usage() {
  return [
    'Usage: node tools/library-scale/validate-phase0-artifacts.mjs [options]',
    '  --phase0 <path>       qualified Phase 0 artifact (defaults to phase0-decisions.json)',
    '  --consumer <path>     Phase 1, Phase 2, or release consumer artifact to exact-join',
    '  --previous <path>     prior Phase 0 artifact used to enforce immutable decision IDs'
  ].join('\n');
}

export async function runValidatorCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const defaultArtifact = fileURLToPath(new URL('./phase0-decisions.json', import.meta.url));
  const artifactPath = path.resolve(args.phase0 ?? defaultArtifact);
  const artifact = await readJson(artifactPath);
  const phase0Result = validatePhase0Artifact(artifact);
  assertValid(phase0Result, 'Phase 0 artifact validation failed');

  if (args.previous) {
    const previous = await readJson(path.resolve(args.previous));
    assertValid(
      validateDecisionIdImmutability(artifact, previous),
      'Phase 0 decision immutability validation failed'
    );
  }
  if (args.consumer) {
    const consumer = await readJson(path.resolve(args.consumer));
    assertValid(validateConsumerJoin(consumer, artifact), 'Consumer exact-join validation failed');
  }
  io.log(`Validated ${artifact.artifactId} (${phase0Result.digest})`);
  return { artifactId: artifact.artifactId, digest: phase0Result.digest };
}

if (isMain(import.meta.url)) {
  runValidatorCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
