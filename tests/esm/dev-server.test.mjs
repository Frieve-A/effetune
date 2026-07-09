import assert from 'node:assert/strict';
import test from 'node:test';

import { stripMarkdownSyntax } from '../../scripts/dev-server.mjs';

test('dev server markdown text stripping preserves visible text from HTML tags', () => {
  assert.equal(stripMarkdownSyntax('A <strong>safe</strong> title'), 'A safe title');
});

test('dev server markdown text stripping does not reconstruct HTML tags', () => {
  const stripped = stripMarkdownSyntax('Title <scrip<script>t>alert(1)</script> [link](https://example.test)');

  assert.equal(stripped.includes('<'), false);
  assert.equal(stripped.includes('>'), false);
  assert.equal(stripped.toLowerCase().includes('<script'), false);
  assert.equal(stripped, 'Title talert(1) link');
});
