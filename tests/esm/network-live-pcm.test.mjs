import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkLivePcm } from '../../js/ui/audio-player/network-live-pcm.js';

test('live PCM negotiation preserves frame origin and converts interleaved samples once', async () => {
  const chunks = [new Uint8Array(4096 * 4), new Uint8Array(2048 * 4)];
  new DataView(chunks[0].buffer).setInt16(0, -32768, true);
  new DataView(chunks[0].buffer).setInt16(2, 16384, true);
  let index = 0;
  const packets = [];
  let pendingRead;
  const reader = { read: () => index < chunks.length ? Promise.resolve({ value: chunks[index++] })
    : new Promise(resolve => { pendingRead = resolve; }) };
  const context = { sampleRate: 48000, audioWorklet: { addModule: async () => {} },
    createGain: () => ({ gain: { value: 0 } }) };
  const port = { onmessage: null, close() {}, postMessage(message) {
    if (message.type !== 'pcm') return;
    packets.push({ startFrame: message.startFrame, count: message.frameCount,
      left: new Float32Array(message.planes[0])[0], right: new Float32Array(message.planes[1])[0] });
    this.onmessage({ data: { type: 'credit', generation: message.generation, accepted: true } });
    if (packets.length === 2) this.onmessage({ data: { type: 'buffered', generation: message.generation } });
  } };
  const player = { audioContext: context, resumeAudioContextForRemotePlayback: async () => true,
    contextManager: { ensurePipelineSourceConnected: () => true, releasePipelineSource() {}, audioManager: {} } };
  const live = new NetworkLivePcm(player, {}, { createNode: () => ({ port, connect() {}, disconnect() {} }),
    fetchStream: async () => ({ ok: true, body: { getReader: () => reader }, headers: { get: key =>
      key === 'Content-Type' ? 'application/vnd.effetune.live-pcm-v1' : 'connection' } }) });
  assert.equal(await live.start({ playbackUrl: 'http://127.0.0.1/live', liveSessionId: 'session' }), true);
  assert.deepEqual(packets, [{ startFrame: 0, count: 4096, left: -1, right: 0.5 },
    { startFrame: 4096, count: 2048, left: 0, right: 0 }]);
  live.stop();
  pendingRead?.({ done: true });
});

test('a live start that fails after the stream opened releases its connection and nodes', async () => {
  const signals = [];
  const released = [];
  const nodes = [];
  let resumed = false;
  let connects = false;
  const context = { sampleRate: 48000, audioWorklet: { addModule: async () => {} },
    createGain: () => ({ gain: { value: 0 } }) };
  const player = { audioContext: context, resumeAudioContextForRemotePlayback: async () => resumed,
    contextManager: { ensurePipelineSourceConnected: () => connects, releasePipelineSource: source => released.push(source),
      audioManager: {} } };
  const live = new NetworkLivePcm(player, {}, {
    createNode: () => { const node = { disconnected: false, closed: false, connect() {},
      disconnect() { this.disconnected = true; }, port: { close() { node.closed = true; } } }; nodes.push(node); return node; },
    fetchStream: async (_url, { signal }) => { signals.push(signal); return { ok: true, body: { getReader() {} },
      headers: { get: key => key === 'Content-Type' ? 'application/vnd.effetune.live-pcm-v1' : 'connection' } }; } });
  const entry = { playbackUrl: 'http://127.0.0.1/live', liveSessionId: 'session' };

  assert.equal(await live.start(entry), false, 'a context that cannot resume fails the start');
  assert.equal(signals[0].aborted, true);

  resumed = true;
  await assert.rejects(live.start(entry), /could not connect/);
  assert.equal(signals[1].aborted, true);
  assert.deepEqual([nodes[0].disconnected, nodes[0].closed, released.length], [true, true, 1]);
  assert.equal(live.node, null);
});

test('receive feedback counts the applied local delay', async () => {
  const reports = [];
  const worklet = {};
  const audioManager = { _getPrimaryWorkletNode: () => worklet,
    _appliedOutputDelayFrames: new Map([[worklet, 480]]),
    networkRoute: { receiveId: 2, revision: 3 },
    networkPaths: { revision: 3, localDelaySamples: 960, receive: { localSamples: 240 } } };
  const player = { audioManager, audioContext: { sampleRate: 48000, outputLatency: 0.01 } };
  const live = new NetworkLivePcm(player, { probeLivePlayback: async () => 'probe',
    reportLivePlayback: async report => { reports.push(report); } });
  live.node = {};
  live.sessionId = 'session';
  live.connectionId = 'connection';
  live.position = async () => ({ started: true, positionFrames: 100 });
  live.beginReporting();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reports[0].dspMs, 5);
  assert.equal(reports[0].softwareOutputMs, 30);
  clearTimeout(live.reportTimer);
});
