import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runHandshakeSmoke } from '../../scripts/build-openhome-sidecar.mjs';

const fixture = fileURLToPath(new URL('../helpers/openhome-handshake-smoke-child.mjs', import.meta.url));

test('OpenHome build handshake smoke accepts a clean provider snapshot', async () => {
  await runHandshakeSmoke(process.execPath, [fixture, 'clean']);
});

test('OpenHome build handshake smoke rejects provider diagnostics emitted before shutdown', async () => {
  await assert.rejects(
    runHandshakeSmoke(process.execPath, [fixture, 'diagnostic']),
    /handshake reported diagnostic\(s\): invalid-state/
  );
});
