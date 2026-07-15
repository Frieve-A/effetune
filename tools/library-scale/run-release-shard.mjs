import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './cli.mjs';
import { evaluateReleasePerformanceEvidence } from './release-performance-contract.mjs';
import { validatePhase0Artifact } from './validate-phase0-artifacts.mjs';

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDirectory, '..', '..');

function runScript(script, args) {
  const result = spawnSync(process.execPath, [path.join(toolsDirectory, script), ...args], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function requireQualifiedPhase0() {
  const artifactPath = path.join(toolsDirectory, 'phase0-decisions.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const result = validatePhase0Artifact(artifact);
  if (!result.valid || artifact.qualification.status !== 'qualified') {
    throw new Error('Release scale shards require a qualified Phase 0 decision artifact');
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const backend = args.backend || process.env.LIBRARY_SCALE_BACKEND;
  const url = args.url || process.env.LIBRARY_SCALE_WEB_URL;
  const evidencePath = args.evidence || process.env.LIBRARY_SCALE_PERFORMANCE_EVIDENCE;
  if (backend !== 'electron' && backend !== 'web') {
    throw new Error('Specify --backend electron or --backend web for a release shard');
  }
  if (backend === 'web' && !url) {
    throw new Error('Web release shards require --url for a user-managed secure test origin');
  }
  if (!evidencePath) {
    throw new Error('Release shards require --evidence from the production runtime benchmark');
  }

  requireQualifiedPhase0();
  runScript('run-scale.mjs', ['--preset', 'million']);
  const absoluteEvidencePath = path.resolve(repoRoot, evidencePath);
  const evidence = JSON.parse(fs.readFileSync(absoluteEvidencePath, 'utf8'));
  const result = evaluateReleasePerformanceEvidence(evidence, {
    expectedBackend: backend,
    expectedCommitSha: process.env.LIBRARY_SCALE_CANDIDATE_SHA,
    expectedWorkflowRunId: process.env.LIBRARY_SCALE_WORKFLOW_RUN_ID
  });
  if (!result.valid || !result.passed) {
    throw new Error(`Production performance evidence failed: ${result.errors.join('; ')}`);
  }
  process.stdout.write(`${JSON.stringify({
    backend,
    artifactDigest: evidence.artifactDigest,
    productionAdapter: evidence.productionAdapter,
    fixture: evidence.fixture,
    passed: true
  })}\n`);
}

try {
  main();
} catch (error) {
  console.error(`Library release shard failed: ${error.message}`);
  process.exitCode = 1;
}
