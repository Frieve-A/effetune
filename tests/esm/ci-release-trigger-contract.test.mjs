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
  assert.match(scope, /electron:.*startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(scope, /electron:.*refs\/heads\//);

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
  const openHomeFilter = scope.slice(scope.indexOf('            openhome:'));

  assert.doesNotMatch(dspCoreFilter, /\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(openHomeFilter, /\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(dspCoreFilter, /dsp\/bindings\/\*\*/);
  assert.doesNotMatch(dspCoreFilter, /plugins\/dsp\/\*\*/);
  assert.match(dspCoreFilter, /dsp\/core\/\*\*/);
  assert.match(dspCoreFilter, /plugins\/\*\*\/\*\.js/);
});
