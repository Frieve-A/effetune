import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readCss(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function getRule(css, selector) {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing selector: ${selector}`);
  const blockStart = css.indexOf('{', selectorIndex);
  const blockEnd = css.indexOf('}', blockStart);
  assert.notEqual(blockStart, -1, `Missing rule start for: ${selector}`);
  assert.notEqual(blockEnd, -1, `Missing rule end for: ${selector}`);
  return css.slice(blockStart + 1, blockEnd);
}

test('measurement select options remain readable in the dark theme', () => {
  const css = readCss('../../features/measurement/styles.css');
  const selectStyleRule = getRule(css, 'input:not([type="range"]),\nselect {');
  const selectSchemeRule = getRule(css, 'select {\n    color-scheme: dark;');
  const optionRule = getRule(css, 'select option {');
  const hoveredOptionRule = getRule(css, 'select option:hover');
  const checkedOptionRule = getRule(css, 'select option:checked');

  assert.match(selectStyleRule, /color:\s*var\(--et-text-primary\);/);
  assert.match(selectSchemeRule, /color-scheme:\s*dark;/);
  assert.match(optionRule, /background-color:\s*#373737\s*!important;/);
  assert.match(optionRule, /color:\s*var\(--et-text-primary\)\s*!important;/);
  assert.match(optionRule, /color-scheme:\s*dark;/);
  assert.match(hoveredOptionRule, /background-color:\s*#454545\s*!important;/);
  assert.match(hoveredOptionRule, /color:\s*#ffffff\s*!important;/);
  assert.match(checkedOptionRule, /background-color:\s*var\(--et-accent-pressed\)\s*!important;/);
  assert.match(checkedOptionRule, /color:\s*#ffffff\s*!important;/);
});

test('measurement configuration clearly dims disabled settings', () => {
  const css = readCss('../../features/measurement/styles.css');
  const disabledControlRule = getRule(
    css,
    '#configForm input:disabled,\n#configForm select:disabled {'
  );
  const disabledChoiceRule = getRule(
    css,
    '#configForm input[type="checkbox"]:disabled,\n#configForm input[type="radio"]:disabled {'
  );
  const disabledCopyRule = getRule(
    css,
    '#configForm .form-group:has(input:disabled, select:disabled) > label,'
  );

  assert.match(disabledControlRule, /background:\s*linear-gradient\(180deg,\s*#2b2b2b,\s*#242424\);/);
  assert.match(disabledControlRule, /color:\s*#7c8187;/);
  assert.match(disabledControlRule, /cursor:\s*not-allowed;/);
  assert.match(disabledControlRule, /opacity:\s*1;/);
  assert.match(disabledChoiceRule, /filter:\s*grayscale\(1\)\s*brightness\(0\.65\);/);
  assert.match(disabledCopyRule, /color:\s*#747980;/);
});
