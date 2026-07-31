import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createChain, getEffectCatalog } from '@effetune/dsp';
import { assetSetup } from './asset-fixtures.mjs';

const [fixturePath, publicCatalogPath, overlayPath] = process.argv.slice(2);
assert.ok(
  fixturePath && publicCatalogPath && overlayPath,
  'Usage: node verify-source-generation.mjs FIXTURE PUBLIC_CATALOG OVERLAY'
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const publicCatalog = JSON.parse(fs.readFileSync(publicCatalogPath, 'utf8'));
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
const catalog = getEffectCatalog();
const members = new Map(fixture.members.map(entry => [entry.type, entry]));
assert.equal(members.size, fixture.members.length, 'Duplicate source-generation member.');

const installedTypes = catalog.effects.map(effect => effect.type);
assert.deepEqual(
  publicCatalog.effects.map(effect => effect.type),
  installedTypes,
  'The public and installed catalogs must have the same ordered effect types.'
);
const fixtureTypes = [...members.keys()].sort();
const overlayTypes = Object.entries(overlay.effects)
  .filter(([, entry]) => entry.sourceGenerating)
  .map(([type]) => type)
  .sort();
const publicTypes = publicCatalog.effects
  .filter(effect => effect.sourceGenerating)
  .map(effect => effect.type)
  .sort();
assert.deepEqual(fixtureTypes, overlayTypes);
assert.deepEqual(fixtureTypes, publicTypes);

const visited = [];
const mismatches = [];
for (const effect of catalog.effects) {
  visited.push(effect.type);
  const member = members.get(effect.type);
  const sampleRate = member?.sampleRate ?? fixture.defaultSampleRate;
  const setup = assetSetup(effect, sampleRate);
  const chain = await createChain({
    version: 1,
    chain: [{
      id: effect.type,
      type: effect.type,
      parameters: member?.parameters ?? {},
      ...(setup.references ? { assets: setup.references } : {})
    }]
  }, {
    variant: 'baseline',
    ...(setup.assetResolver ? { assetResolver: setup.assetResolver } : {})
  });
  try {
    const input = Array.from(
      { length: setup.channels },
      () => new Float32Array(fixture.frames)
    );
    const output = await chain.process(input, {
      sampleRate,
      seed: 0,
      blockSize: 128
    });
    const peak = output.reduce(
      (maximum, channel) => channel.reduce(
        (channelMaximum, sample) =>
          Math.abs(sample) > channelMaximum ? Math.abs(sample) : channelMaximum,
        maximum
      ),
      0
    );
    const nonzero = peak > 1e-7;
    if (nonzero !== Boolean(member)) {
      mismatches.push({
        type: effect.type,
        expected: Boolean(member),
        nonzero,
        peak
      });
    }
  } finally {
    chain.close();
  }
}
assert.deepEqual(visited, installedTypes);
assert.equal(new Set(visited).size, installedTypes.length);
assert.deepEqual(mismatches, []);
