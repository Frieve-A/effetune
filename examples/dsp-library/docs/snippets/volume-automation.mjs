import { createChain } from '@effetune/dsp';

const chain = await createChain({
  version: 1,
  chain: [{ id: 'level', type: 'Volume', parameters: { volume: 0 } }]
});
const stream = await chain.stream({ sampleRate: 48000, channels: 2, blockSize: 128 });
try {
  const audio = [new Float32Array(1024).fill(0.25), new Float32Array(1024).fill(0.25)];
  const output = await stream.process(audio, {
    events: [
      { frame: 128, effectId: 'level', parameters: { volume: -6 } },
      { frame: 608, effectId: 'level', parameters: { volume: -12 } }
    ]
  });
  // Each target change completes after 240 samples at 48 kHz.
  for (const channel of output) {
    for (let frame = 0; frame < channel.length; frame += 1) {
      const expected = frame < 128 ? 0.25
        : frame >= 367 && frame < 608 ? 0.25 * 10 ** (-6 / 20)
          : frame >= 847 ? 0.25 * 10 ** (-12 / 20) : null;
      if (expected !== null && Math.abs(channel[frame] - expected) > 1e-7) {
        throw new Error(`Unexpected gain at frame ${frame}`);
      }
    }
  }
  console.log(Object.fromEntries([127, 128, 367, 608, 847].map(
    frame => [frame, output[0][frame]]
  )));
} finally {
  stream.close();
  chain.close();
}
