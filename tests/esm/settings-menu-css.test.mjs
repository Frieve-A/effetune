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

test('settings install element styling preserves hidden attribute semantics', () => {
  const css = readCss('../../effetune.css');

  assert.match(
    getRule(css, '.settings-menu-install[hidden]'),
    /display:\s*none;/,
    'hidden install elements must remain hidden'
  );
  assert.match(
    getRule(css, '.settings-menu-install:not([hidden])'),
    /display:\s*block;/,
    'visible install elements should occupy a menu row'
  );
  assert.doesNotMatch(
    css,
    /\.settings-menu-install\s*\{[^}]*display\s*:\s*block\s*;/,
    'bare install element display rules would override the hidden attribute'
  );
});
