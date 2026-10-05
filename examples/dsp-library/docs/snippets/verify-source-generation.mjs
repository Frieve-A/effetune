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

function statistics(audio, startFrame = 0) {
  let peak = 0;
  let power = 0;
  let samples = 0;
  for (const channel of audio) {
    for (let frame = startFrame; frame < channel.length; frame++) {
      const sample = channel[frame];
      assert.ok(Number.isFinite(sample), 'Nonfinite source-generation output.');
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > peak) peak = magnitude;
      power += sample * sample;
      samples++;
    }
  }
  return { peak, rms: Math.sqrt(power / samples) };
}

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
  let stream;
  try {
    const input = Array.from(
      { length: setup.channels },
      () => new Float32Array(member?.frames ?? fixture.frames)
    );
    const options = { sampleRate, seed: 0, blockSize: 128 };
    let output;
    if (member?.warmup) {
      stream = await chain.stream({ ...options, channels: setup.channels });
      const untrained = await stream.process(input);
      assert.ok(statistics(untrained).peak <= 1e-7,
        `${effect.type} must remain silent before training.`);
      for (const [name, value] of Object.entries(member.warmup.parameters)) {
        stream.setParam(effect.type, name, value);
      }
      const training = Array.from({ length: setup.channels }, () => Float32Array.from(
        { length: member.warmup.frames },
        (_, frame) => member.warmup.amplitude *
          Math.sin(2 * Math.PI * member.warmup.frequencyHz * frame / sampleRate)
      ));
      await stream.process(training);
      for (const [name, value] of Object.entries(member.parameters)) {
        stream.setParam(effect.type, name, value);
      }
      output = await stream.process(input);
    } else {
      output = await chain.process(input, options);
    }
    const { peak } = statistics(output);
    const measured = statistics(output, member?.measureStartFrame ?? 0);
    if (member?.maximumPeak !== undefined) {
      assert.ok(peak <= member.maximumPeak, `${effect.type} exceeded its output bound.`);
    }
    if (member?.minimumRms !== undefined) {
      assert.ok(measured.rms > member.minimumRms,
        `${effect.type} did not sustain generation after training.`);
    }
    const nonzero = measured.peak > 1e-7;
    if (nonzero !== Boolean(member)) {
      mismatches.push({
        type: effect.type,
        expected: Boolean(member),
        nonzero,
        peak
      });
    }
  } finally {
    stream?.close();
    chain.close();
  }
}
assert.deepEqual(visited, installedTypes);
assert.equal(new Set(visited).size, installedTypes.length);
assert.deepEqual(mismatches, []);
