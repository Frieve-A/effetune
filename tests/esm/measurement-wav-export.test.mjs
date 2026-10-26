import assert from 'node:assert/strict';
import test from 'node:test';
import { exportWAV } from '../../features/measurement/audio-utils/signal-processing.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('measurement WAV export preserves the exact signed floating-point samples and selected sample rate', async () => {
  for (const [sampleRate, filename] of [[44100, 'measured-ir.wav'], [96000, undefined]]) {
    let blob, cleanup;
    const calls = [];
    const anchor = { style: {}, click() { calls.push(['click', this.href, this.download]); } };
    const input = Float32Array.from([0, -0, 0.25, -0.5, 1.5, -2]);
    const before = input.slice();
    await withGlobals({
      document: {
        createElement(tag) { assert.equal(tag, 'a'); return anchor; },
        body: { appendChild: element => calls.push(['append', element]), removeChild: element => calls.push(['remove', element]) }
      },
      URL: {
        createObjectURL(value) { blob = value; return 'blob:measurement-ir'; },
        revokeObjectURL: value => calls.push(['revoke', value])
      },
      setTimeout(callback, delay) { cleanup = callback; assert.equal(delay, 100); }
    }, async () => {
      exportWAV(input, sampleRate, filename);
      assert.deepEqual(input, before);
      assert.equal(blob.type, 'audio/wav');
      const bytes = await blob.arrayBuffer();
      const view = new DataView(bytes);
      const label = (offset, size) => new TextDecoder().decode(new Uint8Array(bytes, offset, size));
      assert.equal(label(0, 4), 'RIFF');
      assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
      assert.equal(label(8, 8), 'WAVEfmt ');
      assert.equal(view.getUint32(16, true), 16);
      assert.equal(view.getUint16(20, true), 3);
      assert.equal(view.getUint16(22, true), 1);
      assert.equal(view.getUint32(24, true), sampleRate);
      assert.equal(view.getUint32(28, true), sampleRate * 4);
      assert.equal(view.getUint16(32, true), 4);
      assert.equal(view.getUint16(34, true), 32);
      assert.equal(label(36, 4), 'data');
      assert.equal(view.getUint32(40, true), input.byteLength);
      for (let index = 0; index < input.length; index++) assert.ok(Object.is(view.getFloat32(44 + index * 4, true), input[index]));
      assert.deepEqual(calls, [['append', anchor], ['click', 'blob:measurement-ir', filename ?? 'audio.wav']]);
      cleanup();
      assert.deepEqual(calls.slice(2), [['remove', anchor], ['revoke', 'blob:measurement-ir']]);
    });
  }
});
