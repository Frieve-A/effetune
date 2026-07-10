import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const META_URL = new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url);

class VolumePlugin {
  constructor(volumeDb) {
    this.id = 17;
    this.enabled = true;
    this.volumeDb = volumeDb;
    this.jsProcessCalls = 0;
  }

  getParameters() {
    return { vl: this.volumeDb, channel: null, inputBus: 0, outputBus: 0 };
  }

  executeProcessor(context, audio) {
    this.jsProcessCalls++;
    const gain = Math.pow(10, this.volumeDb / 20);
    for (let index = 0; index < audio.length; index++) {
      audio[index] *= gain;
    }
    return audio;
  }
}

function createAudioBuffer(channels, sampleRate = 48000) {
  const channelData = channels.map(values => Float32Array.from(values));
  return {
    numberOfChannels: channelData.length,
    length: channelData[0].length,
    sampleRate,
    getChannelData(channel) {
      return channelData[channel];
    }
  };
}

function createOfflineContext() {
  let source = null;
  return {
    destination: {},
    createBuffer(channelCount, length, sampleRate) {
      return createAudioBuffer(
        Array.from({ length: channelCount }, () => new Float32Array(length)),
        sampleRate
      );
    },
    createBufferSource() {
      source = {
        buffer: null,
        connect() {},
        disconnect() {},
        start() {}
      };
      return source;
    },
    async startRendering() {
      return source.buffer;
    }
  };
}

function createProcessor(input, dspDependencies) {
  const contextManager = {
    audioContext: {
      async decodeAudioData() {
        return input;
      }
    },
    createOfflineContext() {
      return createOfflineContext();
    }
  };
  const audioEncoder = {
    encodeWAV(buffer) {
      return buffer;
    }
  };
  return new OfflineProcessor(contextManager, audioEncoder, dspDependencies);
}

async function render({ artifact, enabled, inputChannels, volumeDb }) {
  const input = createAudioBuffer(inputChannels);
  const plugin = new VolumePlugin(volumeDb);
  const meta = JSON.parse(fs.readFileSync(META_URL, 'utf8'));
  const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
  const warnings = [];
  const processor = createProcessor(input, {
    async getModuleInfo() {
      return { bytes, meta, paramPackers: DSP_PARAM_PACKERS };
    },
    warning(message) {
      warnings.push(message);
    }
  });
  const file = { async arrayBuffer() { return new ArrayBuffer(1); } };

  const output = await withGlobals({
    window: {
      audioPreferences: { useWasmDsp: enabled, outputChannels: 2 },
      location: { pathname: '/effetune.html', search: '' }
    }
  }, () => processor.processAudioFile(file, [plugin]));

  return {
    channels: Array.from({ length: output.numberOfChannels }, (_, channel) =>
      Float32Array.from(output.getChannelData(channel))
    ),
    jsProcessCalls: plugin.jsProcessCalls,
    warnings
  };
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`offline Volume export through ${artifact} matches the JS fallback`, async () => {
    const left = Array.from({ length: 257 }, (_, index) =>
      Math.sin(index * 0.071) * (index % 11 === 0 ? 1 : 0.37)
    );
    const right = Array.from({ length: 257 }, (_, index) =>
      Math.cos(index * 0.053) * (index % 7 === 0 ? -0.8 : 0.21)
    );
    const inputChannels = [left, right];

    const wasm = await render({ artifact, enabled: true, inputChannels, volumeDb: -7.25 });
    const js = await render({ artifact, enabled: false, inputChannels, volumeDb: -7.25 });

    assert.equal(wasm.jsProcessCalls, 0, 'WASM-enabled export must use descriptor execution');
    assert.ok(js.jsProcessCalls > 0, 'WASM-off export must exercise the JS reference');
    assert.deepEqual(wasm.warnings, []);
    assert.equal(wasm.channels.length, js.channels.length);
    for (let channel = 0; channel < wasm.channels.length; channel++) {
      assert.deepEqual(wasm.channels[channel], js.channels[channel]);
    }
  });
}
