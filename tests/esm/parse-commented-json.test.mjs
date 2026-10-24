import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommentedJSON } from '../../js/utils/parse-commented-json.js';

test('locale comments are removed without changing URLs, wildcards, or escaped quotes in strings', () => {
    const expected = { url: 'https://example.com/*', text: '"quoted" // text', path: '\\folder' };
    const source = JSON.stringify(expected).replace('{', '{\n// Heading\n/* Description */\n');
    assert.deepEqual(parseCommentedJSON(source), expected);
});
