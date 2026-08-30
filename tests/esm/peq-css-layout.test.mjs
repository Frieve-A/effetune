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

test('inset SVG response graphs expose shared frequency and level axis titles', () => {
  const appCss = readCss('../../effetune.css');
  assert.match(
    appCss,
    /\.plugin-parameter-ui \.graph-axis-titled::after \{\s*content:\s*attr\(data-x-axis-title\);[\s\S]*bottom:\s*2px;/
  );
  assert.match(
    appCss,
    /\.plugin-parameter-ui \.graph-axis-titled::before \{\s*content:\s*attr\(data-y-axis-title\);[\s\S]*left:\s*10px;[\s\S]*rotate\(-90deg\);/
  );
  assert.match(
    getRule(appCss, '.plugin-parameter-ui .graph-axis-titled::before'),
    /color:\s*#fff;[\s\S]*font:\s*14px\/1 Arial, sans-serif;[\s\S]*pointer-events:\s*none;/
  );
  assert.match(
    appCss,
    /\.plugin-parameter-ui \.graph-axis-titled::after,\n\.plugin-parameter-ui \.spectrum-overlay-axis-title \{[\s\S]*font:\s*14px\/1 Arial, sans-serif;/
  );
  const overlayCss = readCss('../../plugins/spectrum-overlay.css');
  assert.match(
    getRule(overlayCss, '.plugin-parameter-ui .spectrum-overlay-axis-title'),
    /right:\s*10px;[\s\S]*top:\s*50%;[\s\S]*translate\(50%, -50%\) rotate\(-90deg\);/
  );

  for (const [path, graphVariable, graphClass] of [
    ['../../plugins/eq/five_band_peq.js', 'graphContainer', 'five-band-peq-graph'],
    ['../../plugins/eq/fifteen_band_peq.js', 'graphContainer', 'fifteen-band-peq-graph'],
    ['../../plugins/eq/five_band_fir_peq.js', 'graphContainer', 'five-band-fir-peq-graph'],
    ['../../plugins/eq/earphone_cable_sim.js', 'graphContainer', 'earphone-cable-sim-graph'],
    ['../../plugins/eq/room_eq.js', 'graph', 'room-eq-additional-eq-graph']
  ]) {
    const source = readCss(path);
    assert.match(
      source,
      new RegExp(`${graphVariable}\\.className = '${graphClass} graph-axis-titled';`),
      `${graphClass} shared axis-title class`
    );
    assert.match(
      source,
      new RegExp(`${graphVariable}\\.setAttribute\\('data-x-axis-title', 'Frequency \\(Hz\\)'\\);`),
      `${graphClass} frequency title`
    );
    assert.match(
      source,
      new RegExp(`${graphVariable}\\.setAttribute\\('data-y-axis-title', 'Level \\(dB\\)'\\);`),
      `${graphClass} level title`
    );
  }
});

test('PEQ graph handles share the 15Band gradient and active colors', () => {
  const css = readCss('../../effetune.css');
  const normalRule = getRule(
    css,
    '.fifteen-band-peq-plugin-ui .fifteen-band-peq-marker'
  );
  const activeRule = getRule(
    css,
    '.fifteen-band-peq-plugin-ui .fifteen-band-peq-marker:hover'
  );

  for (const selector of [
    '.five-band-peq-plugin-ui .five-band-peq-marker',
    '.five-band-fir-peq-plugin-ui .five-band-fir-peq-marker',
    '.room-eq-additional-eq-ui .room-eq-additional-eq-marker',
    '.group-delay-peq-plugin-ui .group-delay-peq-marker'
  ]) {
    assert.ok(
      css.indexOf(selector) < css.indexOf('{', css.indexOf('.fifteen-band-peq-plugin-ui .fifteen-band-peq-marker')),
      `Missing shared handle selector: ${selector}`
    );
  }
  assert.match(
    normalRule,
    /radial-gradient\([\s\S]*linear-gradient\(180deg,\s*#585d64,\s*#41464d\);[\s\S]*border-color:\s*#777e87;/
  );
  assert.match(
    activeRule,
    /radial-gradient\([\s\S]*linear-gradient\(180deg,\s*var\(--et-accent-hover\),\s*var\(--et-accent-pressed\)\);[\s\S]*border-color:\s*#aad8ff;/
  );
});

test('Room EQ keeps Additional EQ filter types aligned with its parameter fields on desktop', () => {
  const css = readCss('../../plugins/eq/room_eq.css');

  assert.match(
    css,
    /body:not\(\.layout-mobile\) \.room-eq-additional-eq-ui \.room-eq-additional-eq-filter-type,\nbody:not\(\.layout-mobile\) \.room-eq-additional-eq-ui \.room-eq-additional-eq-q-text,\nbody:not\(\.layout-mobile\) \.room-eq-additional-eq-ui \.room-eq-additional-eq-freq-text,\nbody:not\(\.layout-mobile\) \.room-eq-additional-eq-ui \.room-eq-additional-eq-gain-text \{/
  );
  assert.match(
    getRule(css, 'body:not(.layout-mobile) .room-eq-additional-eq-ui .room-eq-additional-eq-filter-type'),
    /box-sizing:\s*border-box;[\s\S]*flex:\s*0 0 90px;[\s\S]*width:\s*90px;[\s\S]*min-width:\s*90px;[\s\S]*max-width:\s*90px;/
  );
});

test('Oscilloscope styles do not set numeric input widths in other plugins', () => {
  const css = readCss('../../plugins/analyzer/oscilloscope.css');

  assert.match(
    getRule(css, '.oscilloscope-plugin-ui input[type="number"]'),
    /width:\s*80px;[\s\S]*padding:\s*4px;/
  );
  assert.doesNotMatch(css, /^\.plugin-parameter-ui input\[type="number"\]/m);
});

test('5Band PEQ and Room EQ wrap mobile bands before their controls overflow', () => {
  const bandRules = [
    [
      readCss('../../plugins/eq/five_band_peq.css'),
      '.five-band-peq-plugin-ui .five-band-peq-controls',
      'body.layout-mobile .five-band-peq-plugin-ui .five-band-peq-band'
    ],
    [
      readCss('../../plugins/eq/room_eq.css'),
      '.room-eq-additional-eq-ui .room-eq-additional-eq-controls',
      'body.layout-mobile .room-eq-additional-eq-ui .room-eq-additional-eq-band'
    ]
  ];

  for (const [css, controlsSelector, bandSelector] of bandRules) {
    assert.match(
      getRule(css, controlsSelector),
      /display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/
    );
    assert.match(
      getRule(css, bandSelector),
      /min-width:\s*calc\(\s*var\(--et-mobile-effect-slider-min-width\)\s*\+\s*var\(--et-mobile-field-min-width\)\s*\+\s*44px\s*\);/
    );
  }
});

test('Room EQ keeps its inset plot size over the generic mobile SVG rule', () => {
  const mobileCss = readCss('../../effetune-mobile.css');
  const roomEqCss = readCss('../../plugins/eq/room_eq.css');

  assert.match(
    getRule(mobileCss, 'body.layout-mobile .graph-container svg'),
    /width:\s*100%\s*!important;[\s\S]*height:\s*auto\s*!important;/
  );
  assert.match(
    roomEqCss,
    /body\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-additional-eq-grid,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-additional-eq-response,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-phase-grid,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-phase-response,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-group-delay-grid,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-group-delay-response,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-impulse-grid,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-impulse-response,\nbody\.layout-mobile \.room-eq-additional-eq-ui \.room-eq-hover-overlay \{/
  );
  for (const selector of [
    '.room-eq-additional-eq-grid',
    '.room-eq-additional-eq-response',
    '.room-eq-phase-grid',
    '.room-eq-phase-response',
    '.room-eq-group-delay-grid',
    '.room-eq-group-delay-response',
    '.room-eq-impulse-grid',
    '.room-eq-impulse-response',
    '.room-eq-hover-overlay'
  ]) {
    assert.match(
      getRule(
        roomEqCss,
        `body.layout-mobile .room-eq-additional-eq-ui ${selector}`
      ),
      /width:\s*calc\(100%\s*-\s*40px\)\s*!important;[\s\S]*height:\s*calc\(100%\s*-\s*40px\)\s*!important;/
    );
  }
});

test('Room EQ keeps its external graph controls out of the graph overlay', () => {
  const css = readCss('../../plugins/eq/room_eq.css');

  assert.doesNotMatch(css, /\.room-eq-response-view-controls\s*\{/);
  assert.match(
    getRule(css, '.room-eq-response-legend'),
    /top:\s*5px;[\s\S]*right:\s*7px;/
  );
  assert.match(
    getRule(css, 'body.layout-mobile .room-eq-response-legend'),
    /top:\s*5px;[\s\S]*right:\s*5px;/
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

test('Channel Divider leaves frequency row layout to the shared parameter controls', () => {
  const css = readCss('../../plugins/basics/channel_divider.css');

  assert.doesNotMatch(css, /channel-divider-frequency-slider/);
  assert.doesNotMatch(css, /^\.plugin-parameter-ui/m);
  assert.doesNotMatch(css, /input\[type="(?:range|number)"\]/);
});
