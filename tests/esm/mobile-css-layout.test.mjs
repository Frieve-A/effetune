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
  assert.match(getRule(css, ':root'), /--et-mobile-player-primary-button-size:\s*72px;/);
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

  assert.match(
    getRule(css, 'body.layout-mobile .pipeline-item-header .toggle-button'),
    /margin-right:\s*16px;/,
    'pipeline item toggles should keep the same right margin as the master toggle on mobile'
  );

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

test('mobile effect list keeps effect items at the fixed minimum column width', () => {
  const css = readCss('../../effetune-mobile.css');
  const rule = getLastRule(css, 'body.layout-mobile .plugin-category-items');

  assert.match(rule, /display:\s*grid\s*!important;/);
  assert.match(rule, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(150px,\s*150px\)\);/);
  assert.match(rule, /justify-content:\s*start;/);
  assert.doesNotMatch(rule, /1fr/, 'mobile effect items should not stretch to fill leftover row width');
});

test('mobile player keeps scrolling inside the player pane', () => {
  const css = readCss('../../effetune-mobile.css');
  const bodyRule = getRule(css, 'body.layout-mobile.view-player {');
  const playerViewRule = getLastRule(css, 'body.layout-mobile .mobile-player-view');
  const audioPlayerRule = getRule(css, 'body.layout-mobile .audio-player');

  assert.match(bodyRule, /height:\s*100svh;/);
  assert.match(bodyRule, /overflow-y:\s*hidden;/);
  assert.doesNotMatch(bodyRule, /min-height:\s*100svh;/);
  assert.match(playerViewRule, /min-height:\s*0;/);
  assert.match(playerViewRule, /overflow:\s*hidden;/);
  assert.match(audioPlayerRule, /min-height:\s*0;/);
  assert.match(audioPlayerRule, /max-height:\s*100%;/);
  assert.match(audioPlayerRule, /align-items:\s*stretch;/);
  assert.match(audioPlayerRule, /align-content:\s*start;/);
  assert.match(audioPlayerRule, /overflow-y:\s*auto;/);
});

test('mobile player places the queue list below the primary play pause control', () => {
  const css = readCss('../../effetune-mobile.css');
  const audioPlayerRule = getRule(css, 'body.layout-mobile .audio-player');
  const controlsRule = getRule(css, 'body.layout-mobile .player-controls');
  const controlsItemRule = getRule(css, 'body.layout-mobile .player-controls > *');

  assert.match(
    audioPlayerRule,
    /grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    'mobile player should provide the outer single-column layout'
  );
  assert.match(
    audioPlayerRule,
    /grid-template-rows:\s*auto\s*auto\s*auto\s*auto;/,
    'mobile player should reserve an outer row for the control cluster'
  );
  assert.match(
    audioPlayerRule,
    /"title"\s*"artwork"\s*"track"\s*"controls"/,
    'mobile player should keep the control cluster in one outer grid area'
  );
  for (const [selector, area] of [
    ['body.layout-mobile .audio-player h2', 'title'],
    ['body.layout-mobile .player-artwork', 'artwork'],
    ['body.layout-mobile .track-name-container', 'track']
  ]) {
    assert.match(getRule(css, selector), new RegExp(`grid-area:\\s*${area};`), `${selector} should use the ${area} grid area`);
  }
  const trackContainerRule = getRule(css, 'body.layout-mobile .track-name-container');
  assert.match(trackContainerRule, /display:\s*block;/);
  assert.match(trackContainerRule, /min-width:\s*0;/);
  assert.match(trackContainerRule, /max-width:\s*100%;/);
  assert.match(trackContainerRule, /min-height:\s*0;/);
  assert.match(trackContainerRule, /overflow:\s*hidden;/);
  assert.match(trackContainerRule, /margin:\s*0;/);

  const trackNameRule = getRule(css, 'body.layout-mobile .track-name {');
  assert.match(trackNameRule, /display:\s*block;/);
  assert.match(trackNameRule, /width:\s*100%;/);
  assert.match(trackNameRule, /white-space:\s*normal;/);
  assert.match(trackNameRule, /overflow-wrap:\s*anywhere;/);
  assert.match(trackNameRule, /line-height:\s*1\.35;/);

  assert.match(
    controlsRule,
    /grid-area:\s*controls;/,
    'mobile player controls should occupy the outer controls grid area'
  );
  assert.match(
    controlsRule,
    /display:\s*grid;/,
    'mobile player controls should remain a real box with measurable layout'
  );
  assert.match(
    controlsRule,
    /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/,
    'mobile player controls should own the six-column control grid'
  );
  assert.match(
    controlsRule,
    /grid-template-rows:\s*var\(--et-mobile-control-height\)\s*auto\s*48px\s*var\(--et-mobile-player-primary-button-size\)\s*auto;/,
    'mobile player controls should reserve a real row for the primary play/pause button before the playlist'
  );
  assert.match(
    controlsRule,
    /"shuffle previous stop next repeat close"\s*"play play play play play play"\s*"playlist playlist playlist playlist playlist playlist"/,
    'mobile player controls should place the playlist after the primary play/pause row in the same grid'
  );
  assert.match(
    controlsRule,
    /align-items:\s*stretch;/,
    'mobile player controls should not center oversized grid items into neighboring rows'
  );
  assert.match(controlsRule, /min-height:\s*0;/);
  assert.match(controlsRule, /width:\s*100%;/);
  assert.match(controlsRule, /max-width:\s*100%;/);
  assert.match(controlsRule, /box-sizing:\s*border-box;/);
  assert.doesNotMatch(controlsRule, /display:\s*contents;/);
  assert.match(controlsItemRule, /min-width:\s*0;/);
  assert.match(controlsItemRule, /min-height:\s*0;/);
  assert.match(controlsItemRule, /box-sizing:\s*border-box;/);

  for (const [selector, area] of [
    ['body.layout-mobile .seek-bar', 'seek'],
    ['body.layout-mobile .time-display', 'time'],
    ['body.layout-mobile .shuffle-button', 'shuffle'],
    ['body.layout-mobile .prev-button', 'previous'],
    ['body.layout-mobile .stop-button', 'stop'],
    ['body.layout-mobile .next-button', 'next'],
    ['body.layout-mobile .repeat-button', 'repeat'],
    ['body.layout-mobile .close-button', 'close']
  ]) {
    assert.match(getRule(css, selector), new RegExp(`grid-area:\\s*${area};`), `${selector} should use the ${area} grid area`);
  }
  const seekBarRule = getRule(css, 'body.layout-mobile .seek-bar');
  assert.match(seekBarRule, /align-self:\s*center;/);
  assert.match(seekBarRule, /display:\s*block;/);
  assert.match(seekBarRule, /width:\s*100%;/);
  assert.match(seekBarRule, /min-width:\s*0;/);
  assert.match(seekBarRule, /max-width:\s*100%;/);
  assert.match(seekBarRule, /margin:\s*0;/);
  assert.match(seekBarRule, /box-sizing:\s*border-box;/);

  const timeDisplayRule = getRule(css, 'body.layout-mobile .time-display');
  assert.match(timeDisplayRule, /align-self:\s*center;/);

  const playerButtonRule = getRule(css, 'body.layout-mobile .player-button');
  assert.match(playerButtonRule, /align-self:\s*center;/);

  const playPauseRule = getRule(css, 'body.layout-mobile .play-pause-button');
  assert.match(playPauseRule, /grid-area:\s*play;/);
  assert.match(playPauseRule, /justify-self:\s*center;/);
  assert.match(playPauseRule, /align-self:\s*center;/);
  assert.match(playPauseRule, /width:\s*var\(--et-mobile-player-primary-button-size\);/);
  assert.match(playPauseRule, /height:\s*var\(--et-mobile-player-primary-button-size\);/);
  assert.match(playPauseRule, /min-height:\s*var\(--et-mobile-player-primary-button-size\);/);
  assert.match(playPauseRule, /border-radius:\s*50%;/);

  const iconRule = getRule(css, 'body.layout-mobile .play-pause-button svg');
  assert.match(iconRule, /width:\s*24px;/);
  assert.match(iconRule, /height:\s*24px;/);

  const playlistRule = getRule(css, 'body.layout-mobile .player-playlist');
  assert.match(playlistRule, /grid-area:\s*playlist;/);
  assert.match(playlistRule, /align-self:\s*stretch;/);
  assert.match(playlistRule, /height:\s*100%;/);
  assert.match(playlistRule, /min-height:\s*220px;/);
  assert.match(playlistRule, /overflow-y:\s*auto;/);
  assert.match(playlistRule, /box-sizing:\s*border-box;/);
  assert.doesNotMatch(playlistRule, /margin-top:/);
});
