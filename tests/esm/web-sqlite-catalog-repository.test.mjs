import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WebSqliteCatalogRepository } from '../../js/library/repository/web-catalog-repository.js';

test('Web SQLite repository maps OPFS, full, busy, and corruption failures to stable codes', async () => {
  for (const [failure, expectedCode] of [
    [Object.assign(new Error('Missing required OPFS APIs'), { resultCode: 14 }), 'opfsUnavailable'],
    [Object.assign(new Error('database or disk is full'), { resultCode: 13 }), 'insufficientStorage'],
    [Object.assign(new Error('database is locked'), { resultCode: 5 }), 'concurrentUseUnsupported'],
    [Object.assign(new Error('database disk image is malformed'), { resultCode: 11 }), 'catalogCorrupt']
  ]) {
    const repository = new WebSqliteCatalogRepository({
      authority: 'test',
      sqliteFactory: async () => { throw failure; }
    });
    await assert.rejects(
      repository.open(),
      error => error?.code === expectedCode && !error.message.includes(failure.message)
    );
  }
});

test('shared schema-v2 is the only catalog DDL source for Electron and Web runtimes', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    assert.doesNotMatch(source, /\b(?:CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/i);
  }
});

test('Web catalog implementation does not open an IndexedDB catalog', () => {
  const source = fs.readFileSync(
    new URL('../../js/library/repository/web-catalog-repository.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /indexedDB|IDBDatabase|openDatabase/i);
  assert.match(source, /installOpfsSAHPoolVfs/);
});
