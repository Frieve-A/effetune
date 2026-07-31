import assert from 'node:assert/strict';
import { createChain, getEffectCatalog } from '@effetune/dsp';
import { ASSET_EFFECT_TYPES, assetSetup } from './asset-fixtures.mjs';

const sampleRate = 48000;
const effects = getEffectCatalog().effects.filter(effect => effect.assets.length);
assert.deepEqual(effects.map(effect => effect.type), ASSET_EFFECT_TYPES);
for (const variant of ['baseline', 'simd']) {
  for (const effect of effects) {
    const inputChannels = effect.type === 'FIRCrossover' ? 4 : 2;
    const input = Array.from({ length: inputChannels }, (_, channelIndex) => {
      const channel = new Float32Array(4096);
      if (channelIndex < 2) channel[0] = channelIndex === 0 ? 0.5 : -0.25;
      return channel;
    });
    const outputs = [];
    for (const irVariant of ['a', 'b']) {
      const {
        channels,
        parameters,
        references,
        assetResolver
      } = assetSetup(effect, sampleRate, irVariant);
      assert.equal(channels, inputChannels);
      const chain = await createChain({
        version: 1,
        chain: [{
          id: effect.type,
          type: effect.type,
          parameters,
          assets: references
        }]
      }, { variant, assetResolver });
      const output = await chain.process(input, {
        sampleRate,
        seed: 0,
        blockSize: 64
      });
      assert.equal(output.length, input.length);
      assert.ok(output.every(channel =>
        channel.length === input[0].length && channel.every(Number.isFinite)
      ));
      assert.ok(output.some(channel =>
        channel.some(sample => Math.abs(sample) > 1e-7)
      ));
      outputs.push(output);
      chain.close();
    }
    let maximumDifference = 0;
    for (let channel = 0; channel < outputs[0].length; channel += 1) {
      for (let frame = 0; frame < outputs[0][channel].length; frame += 1) {
        maximumDifference = Math.max(
          maximumDifference,
          Math.abs(outputs[0][channel][frame] - outputs[1][channel][frame])
        );
      }
    }
    assert.ok(maximumDifference > 1e-5);
  }
}
