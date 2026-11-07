import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createChain } from '@effetune/dsp';

// A Bundle directory written by Bundle.pack() or `effetune bundle pack`.
const bundleRoot = path.resolve(process.argv[2] ?? 'python-bundle');
const bundle = JSON.parse(fs.readFileSync(
  path.join(bundleRoot, 'bundle.json'),
  'utf8'
));
for (const variant of ['baseline', 'simd']) {
  const chain = await createChain(bundle, {
    variant,
    // Receives each manifest reference, such as "assets/<sha256>.eta1".
    assetResolver: reference => fs.readFileSync(path.join(bundleRoot, reference))
  });
  const input = [Float32Array.of(0.5), Float32Array.of(-0.25)].map(channel => {
    const padded = new Float32Array(1024);
    padded.set(channel);
    return padded;
  });
  const output = await chain.process(input, {
    sampleRate: 48000,
    seed: 0,
    blockSize: 64
  });
  assert.ok(output.every(channel => channel.every(Number.isFinite)));
  assert.ok(output.some(channel =>
    channel.some(sample => Math.abs(sample) > 1e-7)
  ));
  chain.close();
}
