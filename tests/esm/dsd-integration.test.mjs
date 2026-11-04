import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { RollingPcmTransport } from '../../js/ui/audio-player/rolling-pcm-transport.js';
import { createVirtualDsfReader } from '../helpers/dsd-fixture.mjs';
import { openDsdRangeSource, isDsdSource } from '../../js/ui/audio-player/dsd-source.js';
import { createDsdRangeChannel, openDsdWorkerReader } from '../../js/ui/audio-player/dsd-range-channel.js';

test('DSD source hints and Blob range transport preserve bounded reads and disposal', async () => {
  assert.equal(isDsdSource({ name: 'TRACK.DFF' }), true);
  assert.equal(isDsdSource({ mimeType: 'audio/x-dsf', path: 'https://example.test/music/123' }), true);
  assert.equal(isDsdSource({ name: 'track.flac' }), false);
  const file = new Blob([new Uint8Array([1, 2, 3, 4])]);
  file.arrayBuffer = () => { throw new Error('Whole-file read forbidden'); };
  const source = await openDsdRangeSource({ file });
  const channel = createDsdRangeChannel(source);
  const reader = openDsdWorkerReader(channel.port, source.size);
  const guard = setTimeout(() => {}, 10000);
  try {
    assert.deepEqual(await reader.read(1, 2), new Uint8Array([2, 3]));
    await assert.rejects(reader.read(0, 1024 * 1024 + 1), { code: 'DSD_RANGE' });
    await channel.dispose();
    await assert.rejects(source.read(0, 1), { code: 'DSD_DISPOSED' });
  } finally { clearTimeout(guard); reader.dispose(); await channel.dispose(); }
});

test('DSD HTTP range source rejects ignored Range without reading a whole response', async () => {
  const previous = globalThis.fetch;
  let canceled = false;
  globalThis.fetch = async () => ({ status: 200, headers: new Headers(),
    body: { async cancel() { canceled = true; } } });
  try {
    await assert.rejects(openDsdRangeSource({ path: 'https://example.test/track.dsf' }), { code: 'DSD_RANGE' });
    assert.equal(canceled, true);
  } finally { globalThis.fetch = previous; }
});

test('DSD HTTP range source verifies total size and short response', async () => {
  const previous = globalThis.fetch;
  const data = new Uint8Array([1, 2, 3, 4]);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/track.dsf?token=abc');
    const [, begin, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    return new Response(data.slice(Number(begin), Number(end) + 1), { status: 206,
      headers: { 'content-range': `bytes ${begin}-${end}/4`, etag: '"same"' } });
  };
  try {
    for (const field of ['path', 'uri', 'url']) {
      const track = { name: 'Album title', [field]: 'https://example.test/track.dsf?token=abc' };
      assert.equal(isDsdSource(track), true);
      const source = await openDsdRangeSource(track);
      assert.equal(source.size, 4);
      assert.deepEqual(await source.read(1, 2), new Uint8Array([2, 3]));
      await source.dispose();
    }
  } finally { globalThis.fetch = previous; }
});

function createWorker() {
  const thread = new Worker(new URL('../helpers/dsd-node-worker.mjs', import.meta.url));
  const worker = { onmessage: null, onerror: null,
    postMessage: (message, transfer) => thread.postMessage(message, transfer),
    terminate: () => thread.terminate() };
  thread.on('message', data => worker.onmessage?.({ data }));
  thread.on('error', error => worker.onerror?.(error));
  return worker;
}

function createContext() {
  const node = () => ({ gain: { value: 1 }, connect() {}, disconnect() {}, start() {}, stop() {} });
  return { sampleRate: 48000, currentTime: 0, createGain: node, createBufferSource: node,
    createBuffer(channels, frames, sampleRate) {
      const planes = Array.from({ length: channels }, () => new Float32Array(frames));
      return { duration: frames / sampleRate, copyToChannel: (data, channel) => planes[channel].set(data) };
    } };
}

test('DSD moving fill targets retain full slabs until the end of the track', { timeout: 30000 }, async () => {
  const sampleRate = 2822400;
  const sampleCount = sampleRate * 7 + 123;
  const transport = new RollingPcmTransport(createContext(), { workerFactory: createWorker });
  const snapshot = { dsd: true, byteLength: createVirtualDsfReader({ sampleRate, sampleCount }).size,
    playbackSpeed: 1, preservePitch: true, canonicalIdentity: {},
    async createRangeReader() {
      const reader = createVirtualDsfReader({ sampleRate, sampleCount });
      reader.dispose = async () => {};
      return reader;
    } };
  const firstFrame = 123;
  try {
    await transport.prepare(snapshot, { startFrame: firstFrame, minimumHeadFrames: 4096 });
    const slabFrames = transport.profile.slabFrames;
    assert.equal(transport.lastReceivedFrame, firstFrame + slabFrames);
    // Several targets can be queued before a rounded-up slab arrives. Targets
    // already satisfied by that slab must remain harmless.
    const target = transport.lastReceivedFrame;
    const resident = transport.fillTo(target + 3);
    transport.requestFill(target + 4);
    transport.requestFill(target + 5);
    await resident;
    await transport.fillTo(transport.metadata.totalFrames);
    assert.equal(transport.failed, false);
    const records = transport.queue;
    let nextFrame = firstFrame;
    for (const [index, record] of records.entries()) {
      assert.equal(record.startFrame, nextFrame);
      if (index < records.length - 1) assert.equal(record.frameCount, slabFrames);
      else assert.equal(record.frameCount, transport.metadata.totalFrames - nextFrame);
      nextFrame += record.frameCount;
    }
    assert.equal(nextFrame, transport.metadata.totalFrames);
    assert.equal(records.length, Math.ceil((nextFrame - firstFrame) / slabFrames));
  } finally { await transport.dispose(); }
});

for (const playbackSpeed of [1, 1.5, 0.5]) {
  test(`DSD real Worker preserves source time and releases sessions at ${playbackSpeed} speed`,
    { timeout: 30000 }, async () => {
      const readers = [];
      let live = 0;
      const context = createContext();
      const transport = new RollingPcmTransport(context, { workerFactory: createWorker });
      const snapshot = { dsd: true, byteLength: createVirtualDsfReader({ sampleCount: 11289600 * 3600 }).size,
        playbackSpeed, preservePitch: true, canonicalIdentity: {},
        async createRangeReader() {
          const reader = createVirtualDsfReader({ sampleCount: 11289600 * 3600 });
          let disposed = false;
          live++;
          reader.dispose = async () => { if (!disposed) { disposed = true; live--; } };
          readers.push(reader);
          return reader;
        } };
      try {
        const metadata = await transport.prepare(snapshot, { minimumHeadFrames: 4096, startTimeSec: 600 });
        assert.equal(metadata.durationSec, 3600);
        assert.equal(metadata.playbackSpeed, playbackSpeed);
        assert.equal(metadata.totalFrames, Math.ceil(3600 * 48000 / playbackSpeed));
        assert.equal(transport.currentTime, 600);
        assert.equal(transport.promoteReservation(), true);
        transport.activate({ deferRefill: true });
        context.currentTime = transport.anchorContextTime + 0.01;
        assert.ok(Math.abs(transport.currentTime - (600 + playbackSpeed * 0.01)) < 0.0001);
        transport.pause();
        const target = Math.round(1800 * 48000 / playbackSpeed);
        assert.deepEqual(await transport.seek(target, { resume: false }), { adoptedFrame: target });
        assert.equal(transport.currentTime, 1800);
        await transport.dispose();
        assert.equal(live, 0);
        assert.ok(readers.every(reader => reader.maxReadLength <= 1024 * 1024));
        assert.ok(readers.reduce((total, reader) => total + reader.readBytes, 0) < 64 * 1024 * 1024);
        const diagnostics = transport.getDiagnosticSnapshot();
        for (const key of ['liveWorkers', 'liveHandlers', 'livePcmBytes', 'liveTimers', 'liveSourceNodes']) {
          assert.equal(diagnostics[key], 0, key);
        }
      } finally { await transport.dispose(); }
    });
}
