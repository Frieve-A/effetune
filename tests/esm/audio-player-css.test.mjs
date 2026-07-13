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

test('active player buttons replace the neutral face gradient with the accent surface', () => {
  const css = readCss('../../effetune.css');
  const baseSelector = '.player-button[data-active="true"]';
  const hoverSelector = `${baseSelector}:hover:not(:disabled)`;
  const activeSelector = `${baseSelector}:active:not(:disabled)`;
  const focusSelector = `${baseSelector}:focus-visible:not(:disabled)`;

  const genericHoverIndex = css.indexOf('.player-button:hover:not(:disabled)');
  const activeStateIndex = css.indexOf(baseSelector);
  assert.notEqual(genericHoverIndex, -1, 'neutral player hover styles should exist');
  assert.ok(activeStateIndex > genericHoverIndex, 'active styles should follow the neutral hover surface');

  const pressedRule = getRule(css, baseSelector);
  assert.match(pressedRule, /background:\s*linear-gradient\(/);
  assert.match(pressedRule, /#3f8fe8/);
  assert.match(pressedRule, /border-color:\s*#72b9ff;/);

  const hoverRule = getRule(css, hoverSelector);
  assert.match(hoverRule, /background:\s*linear-gradient\(/);
  assert.match(hoverRule, /var\(--et-accent\)/);

  const activeRule = getRule(css, activeSelector);
  assert.match(activeRule, /background:\s*linear-gradient\(/);
  assert.match(activeRule, /var\(--et-accent-pressed\)/);

  const focusRule = getRule(css, focusSelector);
  assert.match(focusRule, /var\(--et-focus-ring\)/);
});
