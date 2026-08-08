import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as dsp from '@effetune/dsp';

const python = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const types = dsp.EFFECT_CATALOG.effects.map(effect => effect.type);
assert.equal(types.length, 83);
assert.deepEqual(dsp.EFFECT_CATALOG, python.catalog);
assert.deepEqual(dsp.EFFECT_CATALOG.channels, dsp.EFFECT_CHANNELS);
assert.ok(dsp.EFFECT_CATALOG.effects.every(effect =>
  !Object.hasOwn(effect, 'implementation')
));
assert.deepEqual([...dsp.EFFECT_CLASSES.keys()], types);
for (const type of types) {
  assert.equal(typeof dsp[type], 'function', `${type} class is not a root export.`);
  assert.equal(
    typeof dsp[`create${type}`],
    'function',
    `create${type} factory is not a root export.`
  );
}

const chain = await dsp.createChain([
  new dsp.BrickwallLimiter({ id: 'limiter', lookahead: 3 }),
  new dsp.BrickwallLimiter({ id: 'disabled', enabled: false, lookahead: 10 })
], { variant: 'baseline' });
const stream = await chain.stream({
  sampleRate: 48000,
  channels: 2,
  blockSize: 64,
  seed: 0
});
assert.equal(stream.latencySamples, python.latencySamples);
stream.close();
chain.close();
