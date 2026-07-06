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

function getLastRule(css, selector) {
  const selectorIndex = css.lastIndexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing selector: ${selector}`);
  const blockStart = css.indexOf('{', selectorIndex);
  const blockEnd = css.indexOf('}', blockStart);
  assert.notEqual(blockStart, -1, `Missing rule start for: ${selector}`);
  assert.notEqual(blockEnd, -1, `Missing rule end for: ${selector}`);
  return css.slice(blockStart + 1, blockEnd);
}

function assertControlHeight(rule, selector) {
  assert.match(
    rule,
    /height:\s*(?:40px|var\(--et-mobile-control-height\));/,
    `${selector} should set 40px height on mobile`
  );
  assert.match(
    rule,
    /min-height:\s*(?:40px|var\(--et-mobile-control-height\));/,
    `${selector} should set 40px minimum height on mobile`
  );
  assert.match(rule, /box-sizing:\s*border-box;/, `${selector} should include padding and border in height`);
}

function assertFieldMinWidth(rule, selector) {
  assert.match(
    rule,
    /min-width:\s*(?:80px|var\(--et-mobile-field-min-width\));/,
    `${selector} should set 80px minimum width on mobile`
  );
  assert.match(rule, /box-sizing:\s*border-box;/, `${selector} should include padding and border in width`);
}

function assertSquareIconButton(rule, selector) {
  assert.match(
    rule,
    /width:\s*var\(--et-mobile-control-height\);/,
    `${selector} should set 40px border-box width on mobile`
  );
  assert.match(
    rule,
    /min-width:\s*var\(--et-mobile-control-height\);/,
    `${selector} should set 40px minimum width on mobile`
  );
  assertControlHeight(rule, selector);
  assert.match(rule, /padding:\s*0;/, `${selector} should center its icon without extra padding`);
  assert.match(rule, /display:\s*inline-flex;/, `${selector} should use icon-button flex layout`);
}

test('mobile controls use 40px border-box height and 80px field width', () => {
  const css = readCss('../../effetune-mobile.css');

  assert.match(getRule(css, ':root'), /--et-mobile-control-height:\s*40px;/);
  assert.match(getRule(css, ':root'), /--et-mobile-field-min-width:\s*80px;/);
  const radioCheckboxRule = getRule(css, 'body.layout-mobile input[type="radio"]');
  for (const declaration of [
    /width:\s*18px;/,
    /height:\s*18px;/,
    /margin-top:\s*11px;/,
    /margin-bottom:\s*11px;/
  ]) {
    assert.match(
      radioCheckboxRule,
      declaration,
      'radio/checkbox glyphs stay 18px with vertical margins giving a 40px footprint'
    );
  }
  assert.doesNotMatch(
    css,
    /(?:^|,)\s*body\.layout-mobile[^{,]*\sinput(?!\[|:not)/m,
    'mobile descendant input sizing selectors should specify an input type or explicit :not() filter'
  );
  assert.doesNotMatch(
    css,
    /body\.layout-mobile[^{}]*(?:auto-leveler|transient-shaper|power-amp-sag|earphone-cable-sim|multichannel-panel|modal-resonator|five-band|fifteen-band|fbdyn|multiband|channel-divider|mbs-|mbt-|exciter|dsd64)/,
    'plugin-specific mobile rules should live in the owning plugin CSS file'
  );

  for (const selector of [
    'body.layout-mobile .tab-button',
    'body.layout-mobile .preset-select',
    'body.layout-mobile select',
    'body.layout-mobile input:not([type="radio"]):not([type="checkbox"])',
    'body.layout-mobile .toggle-button'
  ]) {
    const rule = getRule(css, selector);
    assertControlHeight(rule, selector);
  }

  for (const selector of [
    'body.layout-mobile .preset-select',
    'body.layout-mobile select',
    'body.layout-mobile input:not([type="radio"]):not([type="checkbox"])',
    'body.layout-mobile .plugin-parameter-ui .parameter-row input[type="text"]',
    'body.layout-mobile .plugin-parameter-ui select'
  ]) {
    assertFieldMinWidth(getLastRule(css, selector), selector);
  }

  for (const selector of [
    'body.layout-mobile .double-blind-test .dbt-close-button',
    'body.layout-mobile .double-blind-test .dbt-testname-row .save-button',
    'body.layout-mobile .double-blind-test .dbt-testname-row .delete-preset-button'
  ]) {
    assertSquareIconButton(getRule(css, selector), selector);
  }

  const dbtIconRule = getRule(css, 'body.layout-mobile .double-blind-test .dbt-close-button svg');
  assert.match(dbtIconRule, /width:\s*16px;/, 'Double Blind Test mobile icon SVGs should stay 16px wide');
  assert.match(dbtIconRule, /height:\s*16px;/, 'Double Blind Test mobile icon SVGs should stay 16px tall');

  for (const selector of [
    'body.layout-mobile.view-player .double-blind-test',
    'body.layout-mobile.view-effects .double-blind-test'
  ]) {
    assert.match(getRule(css, selector), /display:\s*block;/, `${selector} should keep DBT visible`);
  }
});
