import fs from 'node:fs';
import { createChain, SoundFontBank } from '@effetune/dsp';

const sampleRate = 48000;
const bank = SoundFontBank.fromBytes(fs.readFileSync(process.argv[2] ?? 'piano.etsf'));
const chain = await createChain({
  version: 1,
  chain: [{ id: 'piano', type: 'SoundFontPlayer', parameters: {}, assets: { soundFont: 'piano' } }]
}, { assetResolver: () => bank });
const stream = await chain.stream({ sampleRate, channels: 2 });
try {
  // Middle C on MIDI channel 1 for half a second, then the release tail.
  const output = await stream.process(
    [new Float32Array(sampleRate), new Float32Array(sampleRate)],
    {
      events: [
        { frame: 0, effectId: 'piano', midi: [0x90, 60, 100] },
        { frame: 24000, effectId: 'piano', midi: [0x80, 60, 0] }
      ]
    }
  );
  if (!output.every(channel => channel.every(Number.isFinite))) {
    throw new Error('Non-finite output');
  }
  if (!output[0].subarray(0, 24000).some(sample => Math.abs(sample) > 1e-4)) {
    throw new Error('The note did not sound');
  }
} finally {
  stream.close();
  chain.close();
}
