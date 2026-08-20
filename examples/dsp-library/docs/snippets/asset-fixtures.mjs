import { encodeEta1 } from '@effetune/dsp';

export const ASSET_EFFECT_TYPES = Object.freeze([
  'FIRCrossover',
  'FiveBandFIRPEQ',
  'GroupDelayEQ',
  'GroupDelayPEQ',
  'RoomEQ',
  'IRReverb'
]);

const COEFFICIENTS = Object.freeze({
  a: Object.freeze([
    Float32Array.of(0.75, 0.2),
    Float32Array.of(0.35, -0.1)
  ]),
  b: Object.freeze([
    Float32Array.of(0.4, -0.3, 0.1),
    Float32Array.of(0.8, 0.1, -0.05)
  ])
});

export function assetSetup(effect, sampleRate = 48000, irVariant = 'a') {
  if (!effect.assets.length) {
    return { channels: 2, references: undefined, assetResolver: undefined };
  }
  if (!ASSET_EFFECT_TYPES.includes(effect.type)) {
    throw new Error(`No canonical asset fixture for ${effect.type}.`);
  }
  const coefficients = COEFFICIENTS[irVariant];
  if (!coefficients) throw new Error(`Unknown IR variant: ${irVariant}.`);
  const crossover = effect.type === 'FIRCrossover';
  const bytes = crossover
    ? encodeEta1({
        channels: coefficients,
        sampleRate,
        topology: 'matrix',
        paths: [
          { inputSlot: 0, outputSlot: 0, irChannel: 0 },
          { inputSlot: 1, outputSlot: 1, irChannel: 0 },
          { inputSlot: 0, outputSlot: 2, irChannel: 1 },
          { inputSlot: 1, outputSlot: 3, irChannel: 1 }
        ]
      })
    : encodeEta1({
        channels: [coefficients[0]],
        sampleRate,
        topology: 'mono'
      });
  const parameters = effect.type === 'IRReverb'
    ? {
        channelMode: 'mono',
        latency: 0,
        convolutionRate: 'full',
        wetLevel: 0,
        dryLevel: -96,
        preDelay: 0
      }
    : effect.type === 'FIRCrossover'
      ? { latencyMode: '0', filterDelaySamples: 0, bandCount: 2 }
      : { latencyMode: '0', filterDelaySamples: 0 };
  return {
    channels: crossover ? 4 : 2,
    parameters,
    references: Object.fromEntries(effect.assets.map(asset => [
      asset.name,
      `memory:${effect.type}:${asset.name}`
    ])),
    assetResolver: () => bytes
  };
}
