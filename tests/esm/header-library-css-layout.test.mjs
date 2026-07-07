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

test('desktop library button matches neighboring header icon button size', () => {
  const css = readCss('../../effetune.css');
  const rule = getRule(css, '.open-library-button');

  assert.match(rule, /width:\s*36px;/);
  assert.match(rule, /height:\s*36px;/);
  assert.match(rule, /padding:\s*8px;/);
});

test('mobile header keeps 10px space between library and settings buttons', () => {
  const css = readCss('../../effetune-mobile.css');

  assert.match(getRule(css, 'body.layout-mobile h1'), /padding-right:\s*146px;/);
  assert.match(getRule(css, 'body.layout-mobile .header-buttons'), /gap:\s*10px;/);
});

test('desktop library view keeps the effect layout width as its sizing basis', () => {
  const css = readCss('../../effetune-library.css');
  const desktopRule = getRule(css, 'body.view-library:not(.layout-mobile) .main-container');
  const mobileRule = getRule(css, 'body.layout-mobile.view-library .main-container');

  assert.match(desktopRule, /visibility:\s*hidden;/);
  assert.match(desktopRule, /height:\s*0;/);
  assert.match(desktopRule, /min-height:\s*0;/);
  assert.match(desktopRule, /overflow:\s*hidden;/);
  assert.doesNotMatch(desktopRule, /display:\s*none;/);
  assert.match(mobileRule, /display:\s*none;/);
});
