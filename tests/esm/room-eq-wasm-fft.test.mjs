import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import { WasmRoomEqFftBackend } from '../../js/room-eq/wasm-fft.js';

function createBinding(size) {
  const inputPointer = 4;
  const outputPointer = inputPointer + size * 4;
  const memory = { buffer: new ArrayBuffer(outputPointer + size * 4) };
  return {
    memory,
    createDesignFft: () => 1,
    destroyDesignFft() {},
    getDesignFftInput: () => inputPointer,
    getDesignFftOutput: () => outputPointer,
    runDesignFft(handle, inverse) {
      assert.equal(handle, 1);
      const input = new Float32Array(memory.buffer, inputPointer, size);
      const output = new Float32Array(memory.buffer, outputPointer, size);
      const fft = new FFT(size);
      if (inverse) {
        const real = new Float64Array(size / 2 + 1);
        const imag = new Float64Array(size / 2 + 1);
        real[0] = input[0];
        real[size / 2] = input[1];
        for (let bin = 1; bin < size / 2; bin += 1) {
          real[bin] = input[bin * 2];
          imag[bin] = input[bin * 2 + 1];
        }
        output.set(fft.inverseRealTransform(real, imag));
      } else {
        const spectrum = fft.realTransform(input);
        output[0] = spectrum.real[0];
        output[1] = spectrum.real[size / 2];
        for (let bin = 1; bin < size / 2; bin += 1) {
          output[bin * 2] = spectrum.real[bin];
          output[bin * 2 + 1] = spectrum.imag[bin];
        }
      }
      return 0;
    },
    close() {}
  };
}

test('WASM Room EQ FFT backend maps PFFFT real spectra and round-trips samples', () => {
  const size = 64;
  const backend = new WasmRoomEqFftBackend(createBinding(size));
  const input = Float64Array.from({ length: size }, (_, index) =>
    Math.sin(index * 0.17) + 0.2 * Math.cos(index * 0.43));
  const spectrum = backend.realTransform(input);
  const output = backend.inverseRealTransform(spectrum.real, spectrum.imag, size);
  for (let index = 0; index < size; index += 1) {
    assert.ok(Math.abs(output[index] - input[index]) < 1e-5);
  }
  backend.close();
});
