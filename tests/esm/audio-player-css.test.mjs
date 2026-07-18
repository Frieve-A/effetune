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

test('paged queue scrolling reserves the sticky pagination height', () => {
  const css = readCss('../../effetune.css');
  const playlistRule = getRule(css, '.player-playlist');
  const paginationRule = getRule(css, '.player-queue-pagination');
  const pagedItemRule = getRule(css, '.player-queue-pagination ~ .player-playlist-item');

  assert.match(playlistRule, /--player-queue-pagination-height:\s*42px;/);
  assert.match(
    paginationRule,
    /min-height:\s*var\(--player-queue-pagination-height\);/
  );
  assert.match(
    pagedItemRule,
    /scroll-margin-block-start:\s*var\(--player-queue-pagination-height\);/
  );
});

test('desktop mini player keeps controls interactive and preserves notification visibility', () => {
  const css = readCss('../../effetune.css');
  const bodyRule = getRule(css, 'body.layout-mini-player');
  const playerRule = getRule(css, 'body.layout-mini-player .audio-player[data-mini-player="true"]');
  const seekRule = getRule(css, 'body.layout-mini-player .audio-player[data-mini-player="true"] .seek-bar');
  const timeRule = getRule(css, 'body.layout-mini-player .audio-player[data-mini-player="true"] .time-display');
  const miniActionRule = getRule(
    css,
    'body.layout-mini-player .audio-player[data-mini-player="true"] .restore-button,'
  );

  assert.match(bodyRule, /zoom:\s*1\s*!important/);
  assert.match(playerRule, /position:\s*fixed/);
  assert.match(playerRule, /--mini-player-artwork-size:\s*96px/);
  assert.match(playerRule, /grid-template-rows:\s*24px 48px 24px/);
  assert.match(playerRule, /padding:\s*12px/);
  assert.match(playerRule, /row-gap:\s*0/);
  assert.match(playerRule, /-webkit-app-region:\s*drag/);
  assert.match(seekRule, /-webkit-app-region:\s*no-drag/);
  assert.match(timeRule, /flex:\s*0 0 96px/);
  assert.match(timeRule, /white-space:\s*nowrap/);
  assert.match(miniActionRule, /display:\s*inline-flex/);
  assert.match(
    css,
    /body\.layout-mini-player \.title-container\s*\{[^}]*position:\s*fixed/s
  );
});
