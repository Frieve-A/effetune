import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { L16RtpReceiver } from '../electron/airplay-rtp.cjs';
import { LivePcmCore, LIVE_RING_FRAMES } from '../js/ui/audio-player/live-pcm-core.js';
import { verifyAirplayRuntime } from './verify-airplay-package.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.resolve(process.argv[2] || path.join(repositoryRoot, 'out', 'native',
  'airplay-receiver', `${process.platform}-${process.arch}`));
const temporaryParent = fs.realpathSync(os.tmpdir());
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(temporaryParent, 'effetune-airplay-pcm-')));

try {
  const output = path.join(temporaryRoot, 'producer.rtp');
  const packageResult = verifyAirplayRuntime(runtime, { rtpOutput: output });
  assert.equal(packageResult.nativeExecution, true, 'The audio contract check requires its matching native producer');
  const bytes = fs.readFileSync(output);
  const chunks = [];
  const receiver = new L16RtpReceiver({
    onPcm: chunk => chunks.push(chunk),
    onReset: () => assert.fail('Native RTP unexpectedly reset the receiver'),
    onDiagnostic: diagnostic => assert.fail(`Native RTP was rejected: ${diagnostic}`)
  });
  let packetCount = 0;
  for (let offset = 0; offset < bytes.length; packetCount += 1) {
    assert.ok(offset + 4 <= bytes.length);
    const length = bytes.readUInt32LE(offset);
    offset += 4;
    assert.ok(length >= 12 && offset + length <= bytes.length);
    assert.equal(receiver.push(bytes.subarray(offset, offset + length), 0), true);
    offset += length;
  }
  let frames = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.startFrame, frames);
    const left = new Float32Array(chunk.planes[0]);
    const right = new Float32Array(chunk.planes[1]);
    for (let index = 0; index < chunk.frameCount; index += 1, frames += 1) {
      const expected = ((frames % 511) * 32 - 8160) / 32768;
      assert.equal(left[index], expected);
      assert.ok(right[index] === -expected);
    }
  }
  assert.equal(frames, 8192);
  for (const rate of [44100, 48000]) {
    const core = new LivePcmCore(rate);
    for (const chunk of chunks) assert.equal(core.push(chunk), true);
    const outputs = [new Float32Array(128), new Float32Array(128)];
    let checked = 0;
    for (let block = 0; block < 32; block += 1) {
      const start = core.readPosition;
      core.render(outputs);
      const step = (core.readPosition - start) / 128;
      for (let frame = 0; frame < 128; frame += 1) {
        const position = start + frame * step;
        const cyclePosition = position % 511;
        assert.ok(outputs[1][frame] === -outputs[0][frame]);
        // A linear ramp has an exact independent interpolation reference away
        // from its discontinuities and the source's initial filter boundary.
        if (position >= 64 && cyclePosition >= 64 && cyclePosition < 447) {
          const expected = (cyclePosition * 32 - 8160) / 32768;
          assert.ok(Math.abs(outputs[0][frame] - expected) < 0.00002,
            `Native producer samples changed during ${rate} Hz live resampling`);
          checked += 1;
        }
      }
      assert.ok(core.bufferedFrames >= 0 && core.bufferedFrames <= LIVE_RING_FRAMES);
    }
    assert.ok(checked > 2000);
    assert.ok(Math.abs(core.readPosition - 4096 * 44100 / rate) < 2);
    assert.equal(core.underruns, 0);
  }
  console.log(`AirPlay producer → RTP receiver → live PCM passed (${packetCount} packets, ${frames} exact stereo frames; 44.1/48 kHz)`);
} finally {
  assert.equal(path.dirname(temporaryRoot), temporaryParent);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
