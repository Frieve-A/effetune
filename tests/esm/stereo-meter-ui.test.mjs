import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(
  new URL('../../plugins/analyzer/stereo_meter.css', import.meta.url),
  'utf8'
);

function getRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

test('Stereo Meter centers its responsive graph without changing its measured size', () => {
  const rule = getRule('.stereo-meter .graph-container');

  assert.match(rule, /margin:\s*1rem auto 0;/);
  assert.doesNotMatch(rule, /padding:/);
});

test('Stereo Meter uses smooth canvas scaling for graph text', () => {
  const rule = getRule('.stereo-meter canvas');

  assert.match(rule, /image-rendering:\s*auto;/);
  assert.doesNotMatch(css, /image-rendering:\s*pixelated;/);
});
