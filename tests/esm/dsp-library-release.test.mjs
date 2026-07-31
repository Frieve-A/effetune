import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'dsp-library-release.yml'),
  'utf8'
);
const ciWorkflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'dsp-library-ci.yml'),
  'utf8'
);

function workflowJob(source, name) {
  const start = source.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const remainder = source.slice(start + 1);
  const next = remainder.search(/\n  [a-zA-Z0-9_-]+:\n/);
  return next === -1
    ? source.slice(start)
    : source.slice(start, start + 1 + next);
}

test('release publishes a verified checksum manifest for flattened public assets', () => {
  assert.match(workflow, /mkdir public-assets/);
  assert.match(
    workflow,
    /cp python\/\*\.whl npm\/\*\.tgz SBOM\.spdx\.json public-assets\//
  );
  assert.match(
    workflow,
    /sha256sum \*\.whl \*\.tgz SBOM\.spdx\.json > SHA256SUMS/
  );
  assert.match(workflow, /sha256sum --check SHA256SUMS/);
  assert.match(workflow, /subject-path: release\/public-assets\/\*/);
  assert.match(workflow, /release\/public-assets\/\*/);
  assert.doesNotMatch(workflow, /find \. -type f[\s\S]*SHA256SUMS/);
});

test('every wheel runs export and Python golden checks with abi3 forward smoke', () => {
  for (const source of [ciWorkflow, workflow]) {
    assert.match(
      source,
      /CIBW_TEST_COMMAND:[\s\S]*audit_native_exports\.py[\s\S]*python_golden_runner\.py\s+--repo-root \{project\}/
    );
    assert.doesNotMatch(
      source,
      /--summary \{project\}\/\.tmp\/dsp-library-wheel-goldens\.json/
    );
    assert.match(source, /--summary \.tmp\/dsp-library-goldens-(?:ci|release)\.json/);
    assert.match(source, /python-version: '3\.13'/);
    assert.match(source, /verify_abi3_wheel\.py wheelhouse/);
    assert.match(source, /CIBW_SKIP: "\*-musllinux_\*"/);
  }
});

test('npm candidate jobs verify committed DSP artifacts with the pinned SDK before packaging', () => {
  for (const [source, name] of [
    [ciWorkflow, 'linux'],
    [workflow, 'linux']
  ]) {
    const job = workflowJob(source, name);
    const setup = job.indexOf('uses: emscripten-core/setup-emsdk@v16');
    const version = job.indexOf('version: 6.0.2');
    const verify = job.indexOf('npm run build:dsp -- --check');
    const packageBuild = job.indexOf('working-directory: dsp/bindings/js');
    assert.ok(setup >= 0, `${name} sets up Emscripten`);
    assert.ok(version > setup, `${name} pins Emscripten 6.0.2`);
    assert.ok(verify > version, `${name} verifies committed DSP artifacts`);
    assert.ok(packageBuild > verify, `${name} verifies before packaging`);
  }
});

test('release preflight rejects stale site inputs and generated DSP documentation', () => {
  const preflight = workflowJob(workflow, 'preflight');
  const siteInputs = preflight.indexOf(
    'node examples/dsp-library/verify-site-inputs.mjs'
  );
  const generatedDocs = preflight.indexOf(
    'node examples/dsp-library/generate-docs.mjs --check'
  );
  assert.ok(siteInputs >= 0);
  assert.ok(generatedDocs > siteInputs);
});

test('release acceptance runs published docs against clean wheel and npm candidates', () => {
  const acceptance = workflowJob(workflow, 'acceptance');
  const npmInit = acceptance.indexOf('npm init --yes');
  const candidateInstall = acceptance.indexOf(
    'npm install --ignore-scripts --no-audit --no-fund "$GITHUB_WORKSPACE/$package_file"'
  );
  const docsAcceptance = acceptance.indexOf(
    'node examples/dsp-library/verify-docs-acceptance.mjs'
  );
  assert.ok(npmInit >= 0);
  assert.ok(candidateInstall > npmInit);
  assert.ok(docsAcceptance > candidateInstall);
  assert.match(
    acceptance,
    /--npm-root "\$RUNNER_TEMP\/npm-docs-candidate"[\s\S]*--wheel "\$wheel"/
  );
});
