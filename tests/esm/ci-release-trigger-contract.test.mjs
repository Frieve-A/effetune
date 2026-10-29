import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const android = readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const desktopRelease = readFileSync(
  new URL('../../.github/workflows/desktop-release.yml', import.meta.url),
  'utf8'
);
const dspLibraryRelease = readFileSync(
  new URL('../../.github/workflows/dsp-library-release.yml', import.meta.url),
  'utf8'
);

function jobBlock(workflow, jobName) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z0-9-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('desktop and DSP Library release tags select only their owning workflows', () => {
  assert.match(ci, /^\s+tags:\s*$/m);
  assert.match(ci, /^\s+- 'v\*'$/m);
  assert.doesNotMatch(ci, /^\s+tags-ignore:/m);

  const scope = jobBlock(ci, 'scope');
  assert.doesNotMatch(scope, /^\s+electron:/m);
  assert.doesNotMatch(scope, /^\s+dsp_library:.*refs\/tags\//m);
  assert.doesNotMatch(ci, /^  electron-(?:linux|windows|macos):$/m);
  assert.doesNotMatch(ci, /uses: \.\/\.github\/workflows\/build\.yml/);

  assert.match(desktopRelease, /^\s+- 'v\*'$/m);
  assert.match(dspLibraryRelease, /^\s+- 'dsp-v\*'$/m);
  assert.doesNotMatch(
    dspLibraryRelease,
    /Package Electron application|electron-builder|pack:win|smoke:dsp-package/
  );
});

test('Android native builds select configured ABI directories, not prefab directories', {
  skip: process.platform === 'win32' ? 'Workflow Bash runs on Linux' : false
}, () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'android-workflow-')));
  try {
    const loop = android.match(/^          for variant in Debug RelWithDebInfo; do\n[\s\S]*?^          done/m)?.[0];
    assert.ok(loop, 'native acceptance build loop is present');
    const sdk = path.join(root, 'sdk');
    const cmake = path.join(sdk, 'cmake/3.31.6/bin/cmake');
    mkdirSync(path.dirname(cmake), { recursive: true });
    writeFileSync(cmake, '#!/bin/sh\nprintf "%s\\n" "$2"\n', { mode: 0o755 });
    for (const variant of ['Debug', 'RelWithDebInfo']) {
      const build = path.join(root, 'android/app/.cxx', variant, 'configured');
      mkdirSync(path.join(build, 'prefab/x86_64'), { recursive: true });
      mkdirSync(path.join(build, 'x86_64'));
      writeFileSync(path.join(build, 'x86_64/CMakeCache.txt'), 'configured');
    }
    const run = () => spawnSync('bash', ['-e', '-c', loop], {
      cwd: root, env: { ...process.env, ANDROID_HOME: sdk }, encoding: 'utf8'
    });
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(valid.stdout.trim().split('\n'), [
      'android/app/.cxx/Debug/configured/x86_64',
      'android/app/.cxx/RelWithDebInfo/configured/x86_64'
    ]);
    const extra = path.join(root, 'android/app/.cxx/Debug/other/x86_64');
    mkdirSync(extra, { recursive: true });
    writeFileSync(path.join(extra, 'CMakeCache.txt'), 'ambiguous');
    assert.equal(run().status, 1, 'ambiguous caches must stop the build');
    rmSync(path.join(root, 'android/app/.cxx/Debug'), { recursive: true });
    assert.equal(run().status, 1, 'missing caches must stop the build');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('minimum Android acceptance requires successful package and WebView preparation', () => {
  const minimumStep = android.split('      - name: Minimum Android with supported WebView and Debug native acceptance')[1]
    ?.split('      - name:')[0];
  assert.ok(minimumStep);
  assert.doesNotMatch(minimumStep, /^\s+if:/m, 'retain the default success prerequisite');
  assert.match(minimumStep, /adb install -r out\/android\/current-webview\.apk/);
});

test('central CI changes do not select unrelated product builds', () => {
  const scope = jobBlock(ci, 'scope');
  const dspCoreFilter = scope.slice(scope.indexOf('            dsp_core:'), scope.indexOf('            dsp_library:'));
  const dspLibraryFilter = scope.slice(scope.indexOf('            dsp_library:'), scope.indexOf('            dsp_docs:'));
  const dspDocsFilter = scope.slice(scope.indexOf('            dsp_docs:'), scope.indexOf('            openhome:'));
  const openHomeFilter = scope.slice(scope.indexOf('            openhome:'));

  assert.doesNotMatch(dspCoreFilter, /\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(openHomeFilter, /\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(dspLibraryFilter, /docs\/\*\*|README\.md|examples\/dsp-library|workflows\/pages\.yml|workflows\/ci\.yml/);
  assert.doesNotMatch(dspCoreFilter, /dsp\/bindings\/\*\*/);
  assert.doesNotMatch(dspCoreFilter, /plugins\/dsp\/\*\*/);
  assert.match(dspCoreFilter, /dsp\/core\/\*\*/);
  assert.match(dspCoreFilter, /plugins\/\*\*\/\*\.js/);
  assert.match(dspLibraryFilter, /dsp\/bindings\/\*\*/);
  assert.match(dspLibraryFilter, /tools\/repair-dsp-windows-wheel\.py/);
  assert.doesNotMatch(dspCoreFilter, /repair-dsp-windows-wheel/);
  assert.doesNotMatch(openHomeFilter, /repair-dsp-windows-wheel/);
  assert.match(dspDocsFilter, /docs\/\*\*/);
  assert.match(dspDocsFilter, /examples\/dsp-library\/\*\*/);
  assert.match(dspDocsFilter, /workflows\/pages\.yml/);
  assert.match(dspDocsFilter, /workflows\/ci\.yml/);

  const preflight = jobBlock(ci, 'dsp-library-preflight');
  const pagesBuild = jobBlock(ci, 'pages-build');
  const requiredGate = jobBlock(ci, 'required-gate');
  assert.match(preflight, /outputs\.dsp_library == 'true' \|\| needs\.scope\.outputs\.dsp_docs == 'true'/);
  assert.match(pagesBuild, /verify_dsp:.*outputs\.dsp_docs != 'true'/);
  assert.match(requiredGate, /SELECT_DSP_LIBRARY_PREFLIGHT:.*outputs\.dsp_docs == 'true'/);
});
