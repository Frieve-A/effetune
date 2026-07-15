import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMain, parseArgs } from './cli.mjs';

const MANIFEST_KEYS = Object.freeze(['schemaVersion', 'currentPhase', 'gates', 'deferred']);
const GATE_KEYS = Object.freeze([
  'id', 'phase', 'paths', 'quickShard', 'releaseRequired', 'status'
]);
const DEFERRED_KEYS = Object.freeze(['id', 'phase', 'reason', 'owner']);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validatePhaseManifest(manifest, { mode = 'pr' } = {}) {
  const errors = [];
  if (!exactKeys(manifest, MANIFEST_KEYS)) {
    return { valid: false, errors: [`manifest keys must be exactly: ${MANIFEST_KEYS.join(', ')}`] };
  }
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Number.isSafeInteger(manifest.currentPhase) || manifest.currentPhase < 0 || manifest.currentPhase > 4) {
    errors.push('currentPhase must be an integer from 0 through 4');
  }
  if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) {
    errors.push('gates must be a non-empty array');
  }
  const ids = new Set();
  for (const [index, gate] of (manifest.gates || []).entries()) {
    if (!exactKeys(gate, GATE_KEYS)) {
      errors.push(`gates[${index}] keys are invalid`);
      continue;
    }
    if (!nonEmptyString(gate.id) || ids.has(gate.id)) errors.push(`gates[${index}].id is invalid or duplicated`);
    ids.add(gate.id);
    if (!Number.isSafeInteger(gate.phase) || gate.phase < 0 || gate.phase > 4) errors.push(`${gate.id}.phase is invalid`);
    if (!Array.isArray(gate.paths) || gate.paths.length === 0 || gate.paths.some(item => !nonEmptyString(item))) {
      errors.push(`${gate.id}.paths must be non-empty patterns`);
    }
    if (!['electron', 'web', 'common'].includes(gate.quickShard)) errors.push(`${gate.id}.quickShard is invalid`);
    if (typeof gate.releaseRequired !== 'boolean') errors.push(`${gate.id}.releaseRequired must be boolean`);
    if (gate.status !== 'active') errors.push(`${gate.id}.status must be active; use deferred[] for deferrals`);
  }
  if (!Array.isArray(manifest.deferred)) errors.push('deferred must be an array');
  for (const [index, item] of (manifest.deferred || []).entries()) {
    if (!exactKeys(item, DEFERRED_KEYS)) {
      errors.push(`deferred[${index}] keys are invalid`);
      continue;
    }
    if (!nonEmptyString(item.id) || ids.has(item.id)) errors.push(`deferred[${index}].id is invalid or duplicates a gate`);
    ids.add(item.id);
    if (!Number.isSafeInteger(item.phase) || item.phase < 0 || item.phase > 4) errors.push(`${item.id}.phase is invalid`);
    if (!nonEmptyString(item.reason) || !nonEmptyString(item.owner)) errors.push(`${item.id} requires reason and owner`);
    if (item.phase <= manifest.currentPhase) errors.push(`${item.id} defers a current or completed phase`);
  }
  if (mode === 'release') {
    if (manifest.currentPhase !== 4) errors.push('release requires currentPhase 4');
    const phase4Deferred = (manifest.deferred || []).filter(item => item.phase <= 4);
    if (phase4Deferred.length !== 0) errors.push(`release requires Phase 4 deferred count 0, found ${phase4Deferred.length}`);
  } else if (mode !== 'pr') {
    errors.push(`unknown validation mode: ${mode}`);
  }
  return { valid: errors.length === 0, errors, deferredCount: manifest.deferred?.length ?? 0 };
}

export async function runPhaseManifestCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  const defaultPath = fileURLToPath(new URL('./phase-manifest.json', import.meta.url));
  const manifest = JSON.parse(await fs.readFile(path.resolve(args.manifest ?? defaultPath), 'utf8'));
  const result = validatePhaseManifest(manifest, { mode: args.mode ?? 'pr' });
  if (!result.valid) throw new Error(`Phase manifest validation failed:\n- ${result.errors.join('\n- ')}`);
  io.log(`Validated Phase ${manifest.currentPhase} manifest (${result.deferredCount} deferred)`);
  return result;
}

if (isMain(import.meta.url)) {
  runPhaseManifestCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
