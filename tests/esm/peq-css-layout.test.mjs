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

test('5Band PEQ keeps band parameter fields in the established right-side column', () => {
  const css = readCss('../../plugins/eq/five_band_peq.css');

  assert.match(
    getRule(css, '.five-band-peq-plugin-ui .five-band-peq-type-label'),
    /min-width:\s*78px;/
  );
  assert.match(
    getRule(css, '.five-band-peq-plugin-ui .five-band-peq-freq-label'),
    /flex:\s*1 1 auto;[\s\S]*min-width:\s*78px;/
  );
  assert.match(
    getRule(css, '.five-band-peq-plugin-ui .five-band-peq-q-text'),
    /flex:\s*0 0 auto;[\s\S]*width:\s*40px;[\s\S]*min-width:\s*40px;/
  );
  assert.match(
    css,
    /\.five-band-peq-plugin-ui \.five-band-peq-freq-text,\n\.five-band-peq-plugin-ui \.five-band-peq-gain-text \{[\s\S]*?margin-left:\s*auto;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .five-band-peq-plugin-ui .five-band-peq-freq-label'),
    /flex:\s*1 1 auto;[\s\S]*min-width:\s*78px;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .five-band-peq-plugin-ui .five-band-peq-q-text'),
    /flex:\s*0 0 40px;[\s\S]*width:\s*40px;[\s\S]*min-width:\s*40px;[\s\S]*max-width:\s*40px;/
  );
});

test('15Band PEQ keeps band parameter controls aligned after responsive layout changes', () => {
  const css = readCss('../../plugins/eq/fifteen_band_peq.css');
  const js = readCss('../../plugins/eq/fifteen_band_peq.js');

  assert.match(
    getRule(css, '.fifteen-band-peq-plugin-ui .fifteen-band-peq-q-label'),
    /min-width:\s*80px;/
  );
  assert.match(js, /controlRow\.className = 'fifteen-band-peq-control-row';/);
  assert.doesNotMatch(js, /fifteen-band-peq-type-row/);
  assert.doesNotMatch(js, /fifteen-band-peq-freq-row/);
  assert.doesNotMatch(js, /fifteen-band-peq-gain-row/);
  assert.match(
    getRule(css, '.fifteen-band-peq-plugin-ui .fifteen-band-peq-control-row'),
    /display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .fifteen-band-peq-plugin-ui .fifteen-band-peq-control-row'),
    /display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .fifteen-band-peq-plugin-ui .fifteen-band-peq-type-label'),
    /justify-self:\s*start;[\s\S]*min-width:\s*0;[\s\S]*margin-left:\s*0;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .fifteen-band-peq-plugin-ui .fifteen-band-peq-filter-type'),
    /justify-self:\s*end;/
  );
});

test('Earphone Cable Sim keeps resonance parameter inputs in the right-side column on mobile', () => {
  const css = readCss('../../plugins/eq/earphone_cable_sim.css');

  assert.match(
    getRule(css, '.earphone-cable-sim-plugin-ui .earphone-cable-sim-row-input'),
    /width:\s*48px;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .earphone-cable-sim-plugin-ui .earphone-cable-sim-row-label'),
    /flex:\s*1 1 auto;[\s\S]*min-width:\s*0;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .earphone-cable-sim-plugin-ui .earphone-cable-sim-row-input'),
    /flex:\s*0 0 80px;[\s\S]*width:\s*80px;[\s\S]*min-width:\s*80px;[\s\S]*max-width:\s*80px;[\s\S]*margin-left:\s*auto;/
  );
});

test('Channel Divider frequency rows keep compact numeric and slope controls on mobile', () => {
  const css = readCss('../../plugins/basics/channel_divider.css');

  assert.match(
    getRule(css, '.plugin-parameter-ui .channel-divider-frequency-slider-top > label'),
    /flex:\s*1 1 auto;[\s\S]*min-width:\s*0;/
  );
  assert.match(
    getRule(css, '.plugin-parameter-ui .channel-divider-frequency-slider-top > input[type="number"]'),
    /flex:\s*0 0 70px;[\s\S]*width:\s*70px;[\s\S]*min-width:\s*70px;[\s\S]*max-width:\s*70px;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .plugin-parameter-ui .channel-divider-frequency-slider-top > input[type="number"]'),
    /flex:\s*0 0 80px;[\s\S]*width:\s*80px;[\s\S]*min-width:\s*80px;[\s\S]*max-width:\s*80px;/
  );
  assert.match(
    getRule(css, '.plugin-parameter-ui .channel-divider-frequency-slider-top > .slope-select'),
    /flex:\s*0 0 90px;[\s\S]*width:\s*90px;[\s\S]*min-width:\s*90px;[\s\S]*max-width:\s*90px;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .plugin-parameter-ui .channel-divider-frequency-slider-top > .slope-select'),
    /flex:\s*0 0 90px;[\s\S]*width:\s*90px;[\s\S]*min-width:\s*90px;[\s\S]*max-width:\s*90px;/
  );
});
