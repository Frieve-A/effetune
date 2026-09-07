import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  normalizeThemeId
} from '../../js/theme-registry.mjs';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const themeCss = read('../../effetune-theme.css');

const THEME_KEYS = [
  '--et-base',
  '--et-text-primary',
  '--et-accent',
  '--et-success',
  '--et-danger',
  '--et-warning',
  '--et-graph-base',
  '--et-graph-trace',
  '--et-graph-label',
  '--et-graph-bg-deep'
];

function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing CSS rule: ${selector}`);
  const bodyStart = css.indexOf('{', start) + 1;
  let depth = 1;
  for (let index = bodyStart; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(bodyStart, index);
  }
  throw new Error(`Unclosed CSS rule: ${selector}`);
}

function declarations(body) {
  return new Map(Array.from(body.matchAll(/^\s*(--[\w-]+|[\w-]+)\s*:\s*([^;]+);/gm), match => [
    match[1],
    match[2].trim()
  ]));
}

function firstStatement(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').trimStart();
}

function parseHex(value) {
  const hex = value.slice(1);
  const expanded = hex.length === 3 || hex.length === 4
    ? Array.from(hex, digit => digit + digit).join('')
    : hex;
  const channels = [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16)
  ];
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  return [...channels, alpha];
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function parseWeightedColor(value, vars, seen) {
  const match = value.match(/^(.*?)(?:\s+([\d.]+)%)?$/);
  return {
    color: resolveColor(match[1].trim(), vars, seen),
    weight: match[2] === undefined ? null : Number(match[2]) / 100
  };
}

function resolveColor(value, vars, seen = new Set()) {
  const trimmed = value.trim();
  const variable = trimmed.match(/^var\((--[\w-]+)(?:,\s*([\s\S]+))?\)$/);
  if (variable) {
    const [, name, fallback] = variable;
    if (seen.has(name)) throw new Error(`Circular CSS variable: ${name}`);
    const nextSeen = new Set(seen).add(name);
    return resolveColor(vars.get(name) ?? fallback, vars, nextSeen);
  }
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  if (trimmed === 'transparent') return [0, 0, 0, 0];
  const rgba = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  if (trimmed.startsWith('color-mix(in srgb,') && trimmed.endsWith(')')) {
    const [leftPart, rightPart] = splitTopLevel(trimmed.slice('color-mix(in srgb,'.length, -1));
    const left = parseWeightedColor(leftPart, vars, seen);
    const right = parseWeightedColor(rightPart, vars, seen);
    const leftWeight = left.weight ?? (right.weight === null ? 0.5 : 1 - right.weight);
    const rightWeight = right.weight ?? (left.weight === null ? 0.5 : 1 - left.weight);
    const alpha = left.color[3] * leftWeight + right.color[3] * rightWeight;
    const channels = [0, 1, 2].map(index => alpha === 0 ? 0 : (
      left.color[index] * left.color[3] * leftWeight + right.color[index] * right.color[3] * rightWeight
    ) / alpha);
    return [...channels, alpha];
  }
  throw new Error(`Unsupported color expression: ${trimmed}`);
}

function assertColorClose(actual, expected, label) {
  const actualColor = Array.isArray(actual) ? actual : parseHex(actual);
  const expectedColor = expected.startsWith('#') ? parseHex(expected) : resolveColor(expected, new Map());
  if (actualColor[3] === 1 && expectedColor[3] === 1) {
    for (let index = 0; index < 3; index += 1) {
      assert.ok(Math.abs(actualColor[index] - expectedColor[index]) <= 6, `${label} channel ${index}`);
    }
    return;
  }
  assert.ok(Math.abs(actualColor[3] - expectedColor[3]) <= 0.02, `${label} alpha`);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(
      Math.abs(actualColor[index] * actualColor[3] - expectedColor[index] * expectedColor[3]) <= 6,
      `${label} premultiplied channel ${index}`
    );
  }
}

function luminance(color) {
  const linear = color.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('theme definitions load before consumers and contain the complete token foundation', () => {
  assert.match(firstStatement(themeCss), /^:root\s*\{/);
  assert.match(firstStatement(read('../../effetune.css')), /^@import url\("effetune-theme\.css"\);/);
  assert.match(firstStatement(read('../../features/measurement/styles.css')), /^@import url\("\.\.\/\.\.\/effetune-theme\.css"\);/);

  const rootBody = ruleBody(themeCss, ':root');
  const root = declarations(rootBody);
  const requiredTokens = [
    ...THEME_KEYS,
    '--et-color-scheme', '--et-text-secondary', '--et-text-muted',
    '--et-border-subtle', '--et-border-strong', '--et-border-solid',
    '--et-accent-hover', '--et-accent-pressed', '--et-accent-glow', '--et-accent-soft', '--et-accent-outline',
    '--et-danger-soft', '--et-surface-veil', '--et-surface-gloss',
    '--et-inset-background', '--et-panel-gradient', '--et-card-gradient', '--et-card-hover-gradient', '--et-toggle-on-gradient',
    '--et-control-gradient', '--et-control-hover-gradient', '--et-control-active-gradient', '--et-input-gradient',
    '--et-panel-shadow', '--et-card-shadow', '--et-control-shadow', '--et-control-hover-shadow', '--et-focus-ring',
    '--et-scrim', '--et-on-accent', '--et-on-status', '--et-transition-fast', '--et-transition-medium',
    '--et-graph-base-soft', '--et-graph-grid-subtle', '--et-graph-grid', '--et-graph-grid-strong',
    '--et-graph-grid-soft', '--et-graph-label-strong', '--et-graph-label-soft', '--et-graph-axis-title',
    '--et-graph-trace-secondary', '--et-graph-trace-tertiary', '--et-graph-trace-fill', '--et-graph-trace-soft',
    '--et-graph-base-veil', '--et-graph-marker', '--et-graph-handle', '--et-graph-handle-active',
    '--et-graph-overlay-after', '--et-graph-overlay-compare', '--et-graph-overlay-positive', '--et-graph-overlay-label'
  ];
  for (const token of requiredTokens) assert.ok(root.has(token), `Missing ${token}`);
  assert.doesNotMatch(rootBody, /theme-default-override:/);

  for (const match of rootBody.matchAll(/--et-(surface|graph-tone)-(\d+)\s*:\s*([^;]+);/g)) {
    const [, family, percentage, value] = match;
    const base = family === 'surface' ? 'base' : 'graph-base';
    assert.equal(
      value.trim(),
      `color-mix(in srgb, var(--et-${base}), var(--et-text-primary) ${percentage}%)`,
      match[0]
    );
  }
});

test('preset blocks contain the ten keys, color scheme and toggle surface', () => {
  const expectedNames = new Set([...THEME_KEYS, '--et-color-scheme', '--et-toggle-on-gradient']);
  for (const preset of THEME_PRESETS.filter(({ id }) => id !== DEFAULT_THEME_ID)) {
    const actualNames = new Set(declarations(ruleBody(themeCss, `html[data-theme="${preset.id}"]`)).keys());
    assert.deepEqual(actualNames, expectedNames, preset.id);
  }

  const graphiteBody = ruleBody(themeCss, 'html:not([data-theme]),\nhtml[data-theme="graphite"]');
  const graphite = declarations(graphiteBody);
  assert.deepEqual([...graphite.keys()], [
    '--et-accent-hover',
    '--et-graph-marker',
    '--et-graph-handle',
    '--et-graph-overlay-after',
    '--et-graph-overlay-compare',
    '--et-graph-overlay-positive',
    '--et-graph-overlay-label'
  ]);
  for (const line of graphiteBody.split(/\r?\n/).filter(line => line.includes('--et-'))) {
    assert.match(line, /theme-default-override:/);
  }
  assert.deepEqual(Object.fromEntries(graphite), {
    '--et-accent-hover': '#5db3ff',
    '--et-graph-marker': '#ff3333',
    '--et-graph-handle': 'rgba(120, 220, 120, 0.8)',
    '--et-graph-overlay-after': 'rgba(140, 190, 255, 0.55)',
    '--et-graph-overlay-compare': 'rgba(190, 190, 190, 0.9)',
    '--et-graph-overlay-positive': 'rgba(255, 190, 140, 0.55)',
    '--et-graph-overlay-label': 'rgba(140, 190, 255, 0.8)'
  });
});

test('registry, CSS, manifest, and initial browser color stay aligned', () => {
  const root = declarations(ruleBody(themeCss, ':root'));
  for (const preset of THEME_PRESETS) {
    const values = preset.id === DEFAULT_THEME_ID
      ? root
      : declarations(ruleBody(themeCss, `html[data-theme="${preset.id}"]`));
    assert.equal(values.get('--et-base').toLowerCase(), preset.windowBackground.toLowerCase());
    assert.equal(values.get('--et-text-primary').toLowerCase(), preset.windowForeground.toLowerCase());
    assert.equal(values.get('--et-color-scheme'), preset.colorScheme);
  }
  const manifest = JSON.parse(read('../../manifest.json'));
  const defaultPreset = THEME_PRESETS.find(({ id }) => id === DEFAULT_THEME_ID);
  assert.equal(manifest.background_color, defaultPreset.windowBackground);
  assert.equal(manifest.theme_color, defaultPreset.windowBackground);
  assert.match(read('../../effetune.html'), new RegExp(`<meta name="theme-color" content="${defaultPreset.windowBackground}"`));
});

test('Graphite keeps control and graph colors while panel backgrounds follow the theme', () => {
  const root = declarations(ruleBody(themeCss, ':root'));
  const graphite = new Map([...root, ...declarations(ruleBody(themeCss, 'html:not([data-theme]),\nhtml[data-theme="graphite"]'))]);
  const frozen = {
    '--et-accent-pressed': '#3d8ae0',
    '--et-accent-glow': 'rgba(74, 158, 255, 0.26)',
    '--et-text-secondary': '#c3c7cc',
    '--et-text-muted': '#90959c',
    '--et-border-subtle': 'rgba(255, 255, 255, 0.075)',
    '--et-border-strong': 'rgba(255, 255, 255, 0.14)',
    '--et-surface-1': '#191919', '--et-surface-2': '#1b1b1b', '--et-surface-3': '#1e1e1e',
    '--et-surface-4': '#202020', '--et-surface-8': '#282828', '--et-surface-9': '#2c2c2c',
    '--et-surface-11': '#303030', '--et-surface-13': '#343434', '--et-surface-14': '#373737',
    '--et-surface-15': '#383838', '--et-surface-18': '#3f3f3f', '--et-surface-19': '#424242',
    '--et-surface-20': '#444444', '--et-surface-22': '#484848', '--et-surface-23': '#4a4a4a',
    '--et-surface-27': '#535353', '--et-surface-28': '#565656', '--et-surface-31': '#5c5c5c',
    '--et-surface-32': '#5f5f5f', '--et-surface-34': '#626262', '--et-surface-35': '#666666',
    '--et-surface-38': '#6c6c6c', '--et-surface-47': '#808080', '--et-surface-61': '#a0a0a0',
    '--et-graph-base-soft': '#222222', '--et-graph-grid-subtle': '#333333',
    '--et-graph-grid': '#444444', '--et-graph-grid-strong': '#555555',
    '--et-graph-grid-soft': 'rgba(246, 248, 251, 0.2)',
    '--et-graph-label-strong': '#cccccc', '--et-graph-label-soft': 'rgba(246, 248, 251, 0.5)',
    '--et-graph-trace-secondary': '#b0b0b0', '--et-graph-trace-tertiary': '#808080',
    '--et-graph-trace-fill': '#008000', '--et-graph-trace-soft': 'rgba(0, 255, 0, 0.15)',
    '--et-graph-base-veil': 'rgba(26, 26, 26, 0.88)',
    '--et-accent-soft': 'rgba(74, 158, 255, 0.1)',
    '--et-accent-outline': 'rgba(74, 158, 255, 0.5)',
    '--et-danger-soft': 'rgba(255, 107, 107, 0.1)',
    '--et-surface-veil': 'rgba(23, 23, 23, 0.35)'
  };
  for (const [name, expected] of Object.entries(frozen)) {
    assertColorClose(resolveColor(graphite.get(name), graphite), expected, name);
  }

  assert.equal(root.get('--et-panel-gradient'), 'linear-gradient(180deg, rgba(255, 255, 255, 0.042), rgba(255, 255, 255, 0) 42px), linear-gradient(145deg, color-mix(in srgb, var(--et-surface-11), var(--et-graph-bg-deep) 25%), color-mix(in srgb, var(--et-surface-8), var(--et-graph-bg-deep) 25%))');
  assert.equal(root.get('--et-card-gradient'), 'linear-gradient(180deg, color-mix(in srgb, var(--et-surface-19), var(--et-graph-bg-deep) 25%), color-mix(in srgb, var(--et-surface-15), var(--et-graph-bg-deep) 25%))');
  assert.equal(root.get('--et-card-hover-gradient'), 'linear-gradient(180deg, color-mix(in srgb, var(--et-surface-23), var(--et-graph-bg-deep) 25%), color-mix(in srgb, var(--et-surface-18), var(--et-graph-bg-deep) 25%))');
  assert.equal(root.get('--et-control-gradient'), 'linear-gradient(180deg, var(--et-surface-28), var(--et-surface-22))');
  assert.equal(root.get('--et-control-hover-gradient'), 'linear-gradient(180deg, var(--et-surface-34), var(--et-surface-27))');
  assert.equal(root.get('--et-control-active-gradient'), 'linear-gradient(180deg, var(--et-surface-38), var(--et-surface-31))');
  assert.equal(root.get('--et-input-gradient'), 'linear-gradient(180deg, var(--et-surface-18), var(--et-surface-14))');
  assert.equal(root.get('--et-scrim'), 'rgba(0, 0, 0, 0.7)');
  assert.equal(root.get('--et-on-accent'), '#fff');
  assert.equal(root.get('--et-on-status'), 'var(--et-base)');

  const measurement = new Map([...graphite, ...declarations(ruleBody(read('../../features/measurement/styles.css'), ':root'))]);
  const measurementFrozen = {
    '--bg-color': '#1e1e1e', '--text-color': '#e0e0e0', '--primary-color': '#4a9eff',
    '--secondary-color': '#5f5f5f', '--border-color': '#565656', '--warning-color': '#ff6b6b',
    '--success-color': '#4caf50', '--hover-color': '#3f3f3f'
  };
  for (const [name, expected] of Object.entries(measurementFrozen)) {
    assertColorClose(resolveColor(measurement.get(name), measurement), expected, name);
  }
});

test('theme ids normalize and presets maintain readable foregrounds', () => {
  assert.equal(normalizeThemeId('paper'), 'paper');
  assert.equal(normalizeThemeId('unknown'), DEFAULT_THEME_ID);
  assert.equal(normalizeThemeId(''), DEFAULT_THEME_ID);
  assert.equal(normalizeThemeId(null), DEFAULT_THEME_ID);
  assert.equal(normalizeThemeId(1), DEFAULT_THEME_ID);

  const root = declarations(ruleBody(themeCss, ':root'));
  for (const preset of THEME_PRESETS) {
    const vars = preset.id === DEFAULT_THEME_ID
      ? root
      : new Map([...root, ...declarations(ruleBody(themeCss, `html[data-theme="${preset.id}"]`))]);
    const color = name => resolveColor(vars.get(name), vars);
    assert.ok(contrast(color('--et-text-primary'), color('--et-base')) >= 4.5, `${preset.id}: text/base`);
    assert.ok(contrast(color('--et-on-status'), color('--et-success')) >= 4.5, `${preset.id}: on-status/success`);
    assert.ok(contrast(color('--et-on-status'), color('--et-danger')) >= 4.5, `${preset.id}: on-status/danger`);
    const toggleStops = splitTopLevel(vars.get('--et-toggle-on-gradient').slice('linear-gradient('.length, -1)).slice(1);
    for (const stop of toggleStops) {
      assert.ok(contrast(color('--et-on-accent'), resolveColor(stop, vars)) >= 4.5, `${preset.id}: toggle foreground`);
    }
    for (const [left, right] of [
      ['--et-graph-trace', '--et-graph-base'],
      ['--et-graph-trace', '--et-graph-bg-deep'],
      ['--et-graph-label', '--et-graph-base'],
      ['--et-graph-label', '--et-graph-bg-deep'],
      ['--et-accent', '--et-base'],
      ['--et-success', '--et-base'],
      ['--et-danger', '--et-base'],
      ['--et-warning', '--et-base']
    ]) {
      assert.ok(contrast(color(left), color(right)) >= 3, `${preset.id}: ${left}/${right}`);
    }
  }
});
