import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { LiveStreamServer } from '../../electron/network-output-stream.cjs';
import { OpenHomeMediaGateway } from '../../electron/openhome-media-gateway.cjs';
import { LIVE_SAMPLE_RATE } from '../../js/ui/audio-player/live-pcm-core.js';
import { NetworkLivePcm } from '../../js/ui/audio-player/network-live-pcm.js';

const OUTPUT_RATE = 48000;
const BLOCK_FRAMES = 2048;

async function loadProcessor() {
  let Processor;
  let processorPort;
  // Use the real processor and MessagePort transfers with a manually advanced render clock.
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = processorPort; }
  };
  globalThis.registerProcessor = (name, constructor) => {
    assert.equal(name, 'effetune-live-pcm');
    Processor = constructor;
  };
  try {
    await import('../../js/ui/audio-player/live-pcm-worklet.js');
  } finally {
    delete globalThis.AudioWorkletProcessor;
    delete globalThis.registerProcessor;
  }
  return () => {
    const { port1, port2 } = new MessageChannel();
    processorPort = port2;
    globalThis.sampleRate = OUTPUT_RATE;
    try {
      const processor = new Processor();
      return { processor, node: { port: port1, connect() {}, disconnect() { port2.close(); } } };
    } finally {
      delete globalThis.sampleRate;
      processorPort = null;
    }
  };
}

test('gateway PCM renders in order and reports consumed frames from each connection origin', { timeout: 10000 }, async t => {
  const createProcessor = await loadProcessor();
  let now = 1000;
  const sender = new LiveStreamServer({ clockNow: () => now });
  const stream = sender.createStream();
  const upstream = http.createServer((request, response) => sender.handle(request, response));
  await once(upstream.listen(0, '127.0.0.1'), 'listening');
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const gateway = new OpenHomeMediaGateway({
    // The gateway validates a LAN target. Substitute the isolated loopback sender for the socket only.
    httpRequest: (target, options, callback) =>
      http.request(new URL(target.pathname, upstreamUrl), { ...options, lookup: undefined }, callback)
  });
  const context = {
    sampleRate: OUTPUT_RATE,
    outputLatency: 0.01,
    audioWorklet: { addModule: async () => {} },
    createGain: () => ({ gain: { value: 0 } })
  };
  const attached = new Set();
  const worklet = {};
  const audioManager = {
    _getPrimaryWorkletNode: () => worklet,
    _appliedOutputDelayFrames: new Map([[worklet, 96]]),
    networkRoute: { receiveId: 'receive', revision: 3 },
    networkPaths: { revision: 3, receive: { localSamples: 144 }, localDelaySamples: 48 }
  };
  const player = {
    audioContext: context,
    audioManager,
    resumeAudioContextForRemotePlayback: async () => true,
    contextManager: {
      audioManager,
      ensurePipelineSourceConnected(source) { attached.add(source); return true; },
      releasePipelineSource(source) { attached.delete(source); }
    }
  };
  const sendFeedback = request => gateway.requestLiveFeedback(request);
  let processor;
  const live = new NetworkLivePcm(player, { probeLivePlayback: sendFeedback, reportLivePlayback: sendFeedback }, {
    createNode() {
      const { processor: created, node } = createProcessor();
      processor = created;
      return node;
    }
  });
  t.after(async () => {
    live.stop();
    await gateway.close();
    stream.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  });
  const { token, playbackUrl } = await gateway.register(`http://192.168.1.2/live/${stream.token}`, { live: true });
  const entry = { playbackUrl, liveSessionId: token };

  async function startWithBlocks(values) {
    const feed = once(stream, 'connected', { signal: t.signal }).then(() => {
      for (const [index, value] of values.entries()) {
        const block = new Int16Array(BLOCK_FRAMES * 2);
        for (let sample = 0; sample < block.length; sample += 2) {
          block[sample] = value;
          block[sample + 1] = -value / 2;
        }
        stream.write(block, [{ offset: 0, frames: BLOCK_FRAMES, firstFrameTimeMs: now - 20,
          frameDurationMs: 1000 / LIVE_SAMPLE_RATE, revision: index + 1, delayFrames: 0, uncertaintyMs: 0 }]);
      }
    });
    const [started] = await Promise.all([live.start(entry), feed]);
    assert.equal(started, true);
    assert.equal(attached.size, 1);
    const position = await live.position();
    assert.equal(position.positionFrames, 0);
    assert.equal(position.started, false);
  }

  async function stopAndCheck() {
    const disconnected = once(stream, 'disconnected', { signal: t.signal });
    live.stop();
    await disconnected;
    assert.equal(stream.connected, false);
    assert.equal(attached.size, 0);
    assert.equal(await live.position(), null);
  }

  await startWithBlocks([4096, 8192, -16384]);
  const rendered = [new Float32Array(5000), new Float32Array(5000)];
  assert.equal(processor.process([], [rendered]), true);
  for (const [index, expected] of [[128, 0.125 * 129 / 240], [240, 0.125], [2500, 0.25], [4700, -0.5]]) {
    assert.ok(Math.abs(rendered[0][index] - expected) < 0.0001);
    assert.ok(Math.abs(rendered[1][index] + expected / 2) < 0.0001);
  }
  const position = await live.position();
  assert.ok(Math.abs(position.positionFrames - 5000 * LIVE_SAMPLE_RATE / OUTPUT_RATE) < 0.1);

  now += 50;
  const feedback = once(stream, 'feedback', { signal: t.signal });
  live.beginReporting();
  const [report] = await feedback;
  assert.equal(report.sessionId, token);
  assert.equal(report.positionFrames, position.positionFrames);
  assert.equal(report.routeRevision, 3);
  assert.equal(report.transportMs, 50);
  assert.equal(report.dspMs, 3);
  assert.equal(report.softwareOutputMs, 3);
  assert.equal(report.physicalOutputMs, 10);
  await stopAndCheck();

  await startWithBlocks([-8192, -8192, -8192]);
  const secondRender = [new Float32Array(256), new Float32Array(256)];
  processor.process([], [secondRender]);
  for (const [index, expected] of [[128, -0.25 * 129 / 240], [240, -0.25]]) {
    assert.ok(Math.abs(secondRender[0][index] - expected) < 0.0001);
    assert.ok(Math.abs(secondRender[1][index] + expected / 2) < 0.0001);
  }
  const secondFeedback = once(stream, 'feedback', { signal: t.signal });
  live.beginReporting();
  const [secondReport] = await secondFeedback;
  assert.notEqual(secondReport.connectionId, report.connectionId);
  assert.equal(secondReport.routeRevision, 1);
  assert.equal(await gateway.requestLiveFeedback({ sessionId: token, connectionId: report.connectionId }), null);
  await stopAndCheck();
});
