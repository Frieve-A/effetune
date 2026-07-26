import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const benchmarkHtml = readFileSync(
  new URL('../../features/effetune_bench.html', import.meta.url),
  'utf8'
);

test('benchmark page is explicitly fixed to English', () => {
  assert.match(benchmarkHtml, /<html lang="en">/);
  assert.match(benchmarkHtml, /<title>EffeTune Benchmark<\/title>/);
  assert.match(benchmarkHtml, />Run Benchmarks<\/button>/);
  assert.doesNotMatch(benchmarkHtml, /benchmark-page-i18n|data-i18n="benchmark\./);
});
