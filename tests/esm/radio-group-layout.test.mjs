import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appCss = fs.readFileSync(new URL('../../css/effetune.css', import.meta.url), 'utf8');
const combFilterCss = fs.readFileSync(new URL('../../plugins/eq/comb_filter.css', import.meta.url), 'utf8');

test('radio choices wrap as intact, uniformly spaced control-height units', () => {
  assert.match(
    appCss,
    /\.radio-group\s*\{[^}]*column-gap:\s*20px;[^}]*row-gap:\s*4px;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*center;/s
  );
  assert.match(
    appCss,
    /\.radio-group\s*>\s*:has\(>\s*input\[type="radio"\]\)\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*flex:\s*0\s+0\s+auto;[^}]*min-height:\s*26px;[^}]*white-space:\s*nowrap;/s
  );
  assert.match(
    appCss,
    /\.plugin-parameter-ui\s+\.parameter-row\.radio-group\s*\{[^}]*column-gap:\s*10px;[^}]*row-gap:\s*4px;/s
  );
  assert.match(
    appCss,
    /\.plugin-parameter-ui\s+\.parameter-row\.radio-group\s*>\s*label:first-child\s*\{[^}]*margin-right:\s*0;/s
  );
  assert.match(
    appCss,
    /\.plugin-parameter-ui\s+\.parameter-row:has\(>\s*\.radio-group\)\s*\{[^}]*row-gap:\s*4px;/s
  );
  // Options after a leading caption wrap in their own box, aligned under the first option.
  assert.match(
    appCss,
    /\.radio-options\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1\s+1\s+0;[^}]*flex-wrap:\s*wrap;/s
  );
  assert.match(appCss, /\.radio-options\s*>\s*:has\(>\s*input\[type="radio"\]\),/);
  assert.match(
    combFilterCss,
    /\.comb-filter-plugin-ui\s+\.radio-group\s*\{[^}]*column-gap:\s*10px;[^}]*row-gap:\s*4px;/s
  );
});

test('shared tab panels remain overlaid so the tallest tab sets the panel height', () => {
  assert.match(
    appCss,
    /\.room-eq-tab-contents[\s\S]*?\)\s*\{\s*display:\s*grid;/
  );
  assert.match(
    appCss,
    /\.room-eq-tab-content[\s\S]*?\)\s*\{[^}]*display:\s*flex;[^}]*grid-area:\s*1\s*\/\s*1;/s
  );
  assert.match(
    appCss,
    /\.tv-audio-simulator-tab-content[\s\S]*?\)\[hidden\]\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s
  );
});
