import assert from 'node:assert/strict';
import test from 'node:test';

import AudioUtils, {
  loadAudioWorkletModule,
  resolveAudioWorkletModuleUrl
} from '../../features/measurement/audio-utils/core.js';

test('measurement AudioWorklet URL follows the module location and development token', () => {
  const importerUrl = 'http://127.0.0.1:8000/features/measurement/audio-utils/core.js?dev=12345';
  assert.equal(
    resolveAudioWorkletModuleUrl(importerUrl),
    'http://127.0.0.1:8000/features/measurement/audioWorkletProcessors.js?dev=12345'
  );
});

test('measurement AudioWorklet loader uses the direct module URL when available', async () => {
  const calls = [];
  const audioWorklet = {
    async addModule(url) {
      calls.push(url);
    }
  };

  await loadAudioWorkletModule(audioWorklet, 'http://example.test/worklet.js');
  assert.deepEqual(calls, ['http://example.test/worklet.js']);
});

test('measurement AudioWorklet loader retries rejected modules through a Blob URL', async () => {
  const calls = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  }

  const audioWorklet = {
    async addModule(url) {
      calls.push(['addModule', url]);
      if (!url.startsWith('blob:')) {
        throw new DOMException('Unable to load a worklet module', 'AbortError');
      }
    }
  };
  const dependencies = {
    async fetchModule(url, options) {
      calls.push(['fetch', url, options]);
      return {
        ok: true,
        async text() {
          return 'registerProcessor("test", class {});';
        }
      };
    },
    BlobConstructor: FakeBlob,
    urlApi: {
      createObjectURL(blob) {
        calls.push(['createObjectURL', blob.parts, blob.options]);
        return 'blob:measurement-worklet';
      },
      revokeObjectURL(url) {
        calls.push(['revokeObjectURL', url]);
      }
    }
  };

  await loadAudioWorkletModule(
    audioWorklet,
    'http://example.test/worklet.js?dev=12345',
    dependencies
  );

  assert.deepEqual(calls, [
    ['addModule', 'http://example.test/worklet.js?dev=12345'],
    ['fetch', 'http://example.test/worklet.js?dev=12345', { cache: 'no-store' }],
    [
      'createObjectURL',
      ['registerProcessor("test", class {});'],
      { type: 'text/javascript' }
    ],
    ['addModule', 'blob:measurement-worklet'],
    ['revokeObjectURL', 'blob:measurement-worklet']
  ]);
});

test('measurement audio initialization shares one in-flight AudioWorklet registration', async t => {
  const originalWindow = globalThis.window;
  let releaseModule;
  const moduleGate = new Promise(resolve => {
    releaseModule = resolve;
  });
  let contextCount = 0;
  let moduleCount = 0;
  let enumerationCount = 0;

  class FakeAudioContext {
    constructor() {
      contextCount++;
      this.state = 'running';
      this.sampleRate = 48000;
      this.audioWorklet = {
        async addModule() {
          moduleCount++;
          await moduleGate;
        }
      };
    }

    createAnalyser() {
      return {};
    }

    async close() {}
  }

  globalThis.window = { AudioContext: FakeAudioContext };
  t.after(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  const audioUtils = new AudioUtils();
  audioUtils.enumerateDevices = async () => {
    enumerationCount++;
  };

  const firstInitialization = audioUtils.initialize();
  const secondInitialization = audioUtils.initialize();
  await Promise.resolve();

  assert.equal(contextCount, 1);
  assert.equal(moduleCount, 1);

  releaseModule();
  await Promise.all([firstInitialization, secondInitialization]);

  assert.equal(enumerationCount, 1);
  assert.equal(audioUtils.initialized, true);
  assert.equal(audioUtils.initializationPromise, null);
});
