import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflows = new URL('../../.github/workflows/', import.meta.url);

test('fixed-reference performance measurement remains a manual development command', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(packageJson.scripts.verify, /library-scale|fixed-reference/);
  assert.match(packageJson.scripts['test:library-scale:reference'], /run-fixed-reference-performance/);
  for (const entry of fs.readdirSync(workflows)) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const contents = fs.readFileSync(new URL(entry, workflows), 'utf8');
    assert.doesNotMatch(contents, /test:library-scale:reference|run-fixed-reference-performance/);
  }
});
