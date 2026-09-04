import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { warmUpAudioOutput } from '../../js/audio/startup-audio-warmup.js';

class FakeAudioNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }
}

function createAudioContextClass(records, { contextSink = true, pendingOperations = false } = {}) {
  return class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.sampleRate = options.sampleRate || 44100;
      this.destination = new FakeAudioNode('destination');
      records.context = this;
      if (!contextSink) this.setSinkId = undefined;
    }

    createBuffer(channels, length, sampleRate) {
      const buffer = { channels, length, sampleRate };
      records.buffer = buffer;
      return buffer;
    }

    createBufferSource() {
      const source = new FakeAudioNode('source');
      source.start = () => {
        records.sourceStarted = true;
      };
      records.source = source;
      return source;
    }

    createScriptProcessor(bufferSize, inputChannels, outputChannels) {
      const processor = new FakeAudioNode('processor');
      processor.bufferSize = bufferSize;
      processor.inputChannels = inputChannels;
      processor.outputChannels = outputChannels;
      records.processor = processor;
      return processor;
    }

    createMediaStreamDestination() {
      const destination = new FakeAudioNode('media-stream-destination');
      destination.stream = { id: 'startup-audio-stream' };
      records.mediaStreamDestination = destination;
      return destination;
    }

    resume() {
      records.resumeCalls = (records.resumeCalls || 0) + 1;
      return pendingOperations ? new Promise(() => {}) : Promise.resolve();
    }

    setSinkId(deviceId) {
      records.contextSinkIds = [...(records.contextSinkIds || []), deviceId];
      return pendingOperations ? new Promise(() => {}) : Promise.resolve();
    }
  };
}

function createLogger(records) {
  return {
    info(...args) { records.logs.push(['info', ...args]); },
    warn(...args) { records.logs.push(['warn', ...args]); }
  };
}

test('startup warm-up opens the selected output and renders stereo silence only', async () => {
  const records = { logs: [] };
  const windowRef = {
    AudioContext: createAudioContextClass(records),
    electronAPI: {
      async loadAudioPreferences() {
        return {
          success: true,
          preferences: {
            outputDeviceId: 'device-2',
            sampleRate: 48000,
            latencyHint: 'playback'
          }
        };
      }
    }
  };

  const warmup = await warmUpAudioOutput({
    windowRef,
    logger: createLogger(records),
    operationWaitMs: 25
  });

  assert.deepEqual(records.context.options, {
    latencyHint: 'playback',
    sampleRate: 48000,
    sinkId: 'device-2'
  });
  assert.deepEqual(records.contextSinkIds, ['device-2']);
  assert.equal(records.resumeCalls, 1);
  assert.deepEqual(records.buffer, { channels: 2, length: 128, sampleRate: 48000 });
  assert.equal(records.source.loop, true);
  assert.equal(records.sourceStarted, true);
  assert.deepEqual(records.source.connections, [records.processor]);
  assert.deepEqual(records.processor.connections, [records.context.destination]);
  assert.equal(windowRef.__EFFECTUNE_STARTUP_AUDIO_WARMUP__, warmup);

  const channels = [new Float32Array([1, 1, 1]), new Float32Array([1, 1, 1])];
  records.processor.onaudioprocess({
    outputBuffer: {
      numberOfChannels: channels.length,
      getChannelData(channel) { return channels[channel]; }
    }
  });
  assert.deepEqual(Array.from(channels[0]), [0, 0, 0]);
  assert.deepEqual(Array.from(channels[1]), [0, 0, 0]);
});

test('startup warm-up uses the legacy media route without loading application features', async () => {
  const records = { logs: [] };
  class FakeAudioElement {
    constructor() {
      records.audioElement = this;
    }

    setSinkId(deviceId) {
      records.audioElementSinkId = deviceId;
      return Promise.resolve();
    }

    play() {
      records.audioElementPlayed = true;
      return Promise.resolve();
    }
  }
  const windowRef = {
    Audio: FakeAudioElement,
    AudioContext: createAudioContextClass(records, { contextSink: false }),
    electronAPI: {
      async loadAudioPreferences() {
        return { success: true, preferences: { outputDeviceId: 'legacy-output' } };
      }
    }
  };

  const warmup = await warmUpAudioOutput({
    windowRef,
    logger: createLogger(records),
    operationWaitMs: 25
  });

  assert.equal(records.audioElementSinkId, 'legacy-output');
  assert.equal(records.audioElementPlayed, true);
  assert.equal(records.audioElement.srcObject, records.mediaStreamDestination.stream);
  assert.deepEqual(records.processor.connections, [records.mediaStreamDestination]);
  assert.equal(warmup.audioElement, records.audioElement);
});

test('startup warm-up releases its startup wait while slow audio operations continue', async () => {
  const records = { logs: [] };
  const windowRef = {
    AudioContext: createAudioContextClass(records, { pendingOperations: true }),
    electronAPI: {
      async loadAudioPreferences() {
        return { success: true, preferences: { outputDeviceId: 'slow-output' } };
      }
    }
  };

  const warmup = await warmUpAudioOutput({
    windowRef,
    logger: createLogger(records),
    operationWaitMs: 1
  });

  assert.equal(records.resumeCalls, 1);
  assert.deepEqual(records.contextSinkIds, ['slow-output']);
  assert.equal(records.sourceStarted, true);
  assert.equal(windowRef.__EFFECTUNE_STARTUP_AUDIO_WARMUP__, warmup);
});

test('the packaged audio warm-up document contains only the startup dispatcher', () => {
  const html = fs.readFileSync(new URL('../../startup-audio.html', import.meta.url), 'utf8');
  const packageJson = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  );
  const mainSource = fs.readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');
  const scripts = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), match => match[1]);

  assert.deepEqual(scripts, ['js/startup.js']);
  assert.match(html, /data-effetune-startup="audio-warmup"/);
  assert.doesNotMatch(html, /effetune\.css|app\.js|plugins\/|library|jszip|jsmediatags/i);
  assert.equal(packageJson.build.files.includes('startup-audio.html'), true);
  assert.match(
    mainSource,
    /loadFile\(constants\.getIsFirstLaunch\(\) \? 'startup-audio\.html' : 'effetune\.html'\)/
  );
  assert.match(mainSource, /mainWindow\.loadFile\('effetune\.html'\)/);
  const ipcRegistrationIndex = mainSource.indexOf('ipcHandlers.registerIpcHandlers();');
  const createWindowCallIndex = mainSource.indexOf('  createWindow();', ipcRegistrationIndex);
  assert.ok(ipcRegistrationIndex >= 0);
  assert.ok(createWindowCallIndex > ipcRegistrationIndex);
});
