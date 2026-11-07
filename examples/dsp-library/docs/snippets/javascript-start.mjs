import { createChain } from '@effetune/dsp';

const frames = 512;
const mono = Float32Array.from(
  { length: frames },
  (_, frame) => 0.5 * Math.sin(2 * Math.PI * frame / 97)
);
const input = [mono.slice(), mono.slice()];
const chain = await createChain({
  version: 1,
  chain: [{
    id: 'volume',
    type: 'Volume',
    parameters: { volume: -6 }
  }]
});
const output = await chain.process(input, { sampleRate: 48000 });
const peak = output[0].reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
console.log(output.length, output[0].length, peak);
chain.close();
