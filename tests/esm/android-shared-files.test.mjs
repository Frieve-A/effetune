import test from 'node:test';
import assert from 'node:assert/strict';
import { installAndroidSharedFiles } from '../../js/android/shared-files.js';

test('shared playback handles a background start refusal and reports other failures', async () => {
  for (const code of ['visible-start-required', 'document-unavailable']) {
    const errors = [];
    let options;
    const bridge = { on() {}, async request() {
      return { files: [{ uri: 'content://test/song', name: 'song.wav', size: 10 }] };
    } };
    const manager = {
      async createAudioPlayer(files, replace, value) {
        options = value;
        throw Object.assign(new Error('failed'), { code });
      },
      setError: (...args) => errors.push(args)
    };
    installAndroidSharedFiles(manager, bridge);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(options.waitForLoad, true);
    assert.equal(errors.length, code === 'visible-start-required' ? 0 : 1);
  }
});
