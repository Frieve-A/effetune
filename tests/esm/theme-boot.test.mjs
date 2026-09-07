import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/theme-boot.js', import.meta.url), 'utf8');

test('theme boot accepts safe ids and tolerates unavailable storage', () => {
  for (const [id, expected] of [['paper', 'paper'], ['unknown-theme', 'unknown-theme'], [null, undefined],
    ['Paper', undefined], ['paper!', undefined], ['a'.repeat(33), undefined]]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(source, { document, window: { localStorage: { getItem: () => id } } });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  for (const window of [{}, { get localStorage() { throw new Error('unavailable'); } }]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(source, { document, window });
    assert.equal(document.documentElement.dataset.theme, undefined);
  }
});

test('theme boot runs after CSP and before stylesheets on application pages', () => {
  for (const file of ['effetune.html', 'features/measurement/measurement.html', 'features/effetune_bench.html']) {
    const html = readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
    const boot = html.indexOf('theme-boot.js');
    assert.ok(boot > html.indexOf('<head>'), file);
    assert.ok(boot < html.indexOf('<link rel="stylesheet"'), file);
    assert.ok(boot < html.indexOf('</head>'), file);
    if (file === 'effetune.html') assert.ok(boot > html.indexOf('Content-Security-Policy'));
  }
  assert.match(readFileSync(new URL('../../404.html', import.meta.url), 'utf8'), /theme-boot\.js/);
});
