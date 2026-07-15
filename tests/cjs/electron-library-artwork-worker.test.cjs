'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { capArtworkParserAllocations } = require('../../electron/library-artwork-worker.cjs');

test('Electron artwork worker rejects oversized parser tokens before delegating allocation', async () => {
  let delegated = 0;
  const tokenizer = capArtworkParserAllocations({
    readToken: async () => { delegated += 1; },
    peekToken: async () => { delegated += 1; }
  }, 16);

  assert.throws(
    () => tokenizer.readToken({ len: 17 }),
    error => error?.code === 'artworkRawTooLarge'
  );
  assert.throws(
    () => tokenizer.peekToken({ len: 17 }),
    error => error?.code === 'artworkRawTooLarge'
  );
  assert.equal(delegated, 0);
  await tokenizer.readToken({ len: 16 });
  assert.equal(delegated, 1);
});
