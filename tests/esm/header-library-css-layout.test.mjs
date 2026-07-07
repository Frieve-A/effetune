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
  const libraryButtonRule = getRule(css, '.open-library-button');
  const desktopSubtitleContainerRule = getRule(css, 'body:not(.layout-mobile) .subtitle-container');

  assert.match(libraryButtonRule, /width:\s*36px;/);
  assert.match(libraryButtonRule, /height:\s*36px;/);
  assert.match(libraryButtonRule, /padding:\s*8px;/);
  assert.match(desktopSubtitleContainerRule, /height:\s*36px;/);
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

test('desktop library view hides the plugin list toggle button', () => {
  const css = readCss('../../effetune-library.css');
  const desktopSidebarRule = getRule(css, 'body.view-library:not(.layout-mobile) .sidebar-button');

  assert.match(desktopSidebarRule, /display:\s*none;/);
});

test('desktop empty library icon has a bounded display size', () => {
  const css = readCss('../../effetune-library.css');
  const emptyIconRule = getRule(css, 'body.view-library:not(.layout-mobile) .library-empty-icon');

  assert.match(emptyIconRule, /width:\s*96px;/);
  assert.match(emptyIconRule, /max-width:\s*42%;/);
});

test('library icon buttons keep a 30px content square', () => {
  const css = readCss('../../effetune-library.css');
  const iconButtonRule = getRule(css, '.library-icon-button,\n.library-row-play {');

  assert.match(iconButtonRule, /box-sizing:\s*content-box;/);
  assert.match(iconButtonRule, /width:\s*30px;/);
  assert.match(iconButtonRule, /height:\s*30px;/);
  assert.match(iconButtonRule, /padding:\s*0;/);
});

test('library view reuses the main effect surface theme', () => {
  const css = readCss('../../effetune-library.css');
  const rootRule = getRule(css, ':root');
  const viewRule = getRule(css, '.library-view');
  const searchRule = getRule(css, '.library-search {');
  const trackTableRule = getRule(css, '.library-track-table');

  assert.match(rootRule, /--library-bg:\s*var\(--et-panel-gradient,/);
  assert.match(rootRule, /--library-panel-strong:\s*var\(--et-card-gradient,/);
  assert.match(rootRule, /--library-input:\s*var\(--et-input-gradient,/);
  assert.doesNotMatch(rootRule, /--library-bg:\s*#0/);
  assert.doesNotMatch(rootRule, /--library-panel:\s*#1/);
  assert.match(viewRule, /box-shadow:\s*var\(--library-shadow\);/);
  assert.match(searchRule, /background:\s*var\(--library-input\);/);
  assert.match(trackTableRule, /background:\s*var\(--library-table\);/);
});
