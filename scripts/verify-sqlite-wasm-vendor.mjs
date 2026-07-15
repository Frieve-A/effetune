import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'js', 'vendor', 'sqlite');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'vendor.json'), 'utf8'));

assert.equal(manifest.version, '3.53.3');
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = fs.readFileSync(path.join(directory, name));
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, expected, `Unexpected SQLite vendor digest for ${name}`);
}

const loader = fs.readFileSync(path.join(directory, 'sqlite3.mjs'), 'utf8');
assert.match(loader, /SQLITE_VERSION "3\.53\.3"/);
await WebAssembly.compile(fs.readFileSync(path.join(directory, 'sqlite3.wasm')));
