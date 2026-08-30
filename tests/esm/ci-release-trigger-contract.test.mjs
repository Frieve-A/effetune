import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
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
