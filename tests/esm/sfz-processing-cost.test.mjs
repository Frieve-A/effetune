import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset, sfzSampleCacheFootprint } from '../../js/sfz/asset.js';
import { SfzEffectCost, samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { prepareStreamedSfzBank } from '../../js/sfz/streamed-bank.js';
import { prepareSfzAssetForContext } from '../../js/sfz/preparation-context.js';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { createSfzMemorySampleReader } from '../../js/sfz/sample-reader.js';
import { attachSfzSampleStreamWorker } from '../../js/sfz/sample-stream-worker.js';
import { prepareSfzSamples } from '../../js/sfz/service.js';


function queriedCacheBytes(payload) {
  const words = new Uint32Array(payload, 32);
  if (words[1] !== 10) return 0;
  let channels = 1;
  for (let i = 0; i < words[13]; ++i) channels = Math.max(channels, words[words[12] + i * 16 + 2]);
  return sfzSampleCacheFootprint(words[13], words[14], channels, { slots16: words[16] });
}

const context = { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 30 };
const source = () => parseSfz({ selectedPath: 'test.sfz', readText: async () => '<region> sample=tone.wav key=60', onDiagnostic: null });

test('cost worker receives compiled control metadata and declared extent, never the resident PCM pool', async () => {
  const parsed = await source(), pcm = new Float32Array(8193).fill(.125);
  const descriptor = packSfzAsset(parsed.regions, new Map([['tone.wav', { sampleRate: 48000, channels: [pcm] }]]),
    { modulation: parsed.modulation });
  const prefix = samplePlayerPreparationData(descriptor.payload);
  assert.ok(prefix.control.byteLength < descriptor.payload.byteLength - pcm.byteLength + 4);
  assert.equal(prefix.payloadBytes, descriptor.payload.byteLength);
  const requests = [];
  const worker = { terminate() {}, postMessage(data, transfer = []) {
    requests.push({ data, transfer });
    queueMicrotask(() => worker.onmessage({ data: { id: data.id, ok: true, bytes: data.type === 'estimate' ? 1234 : 0 } }));
  } };
  const cost = new SfzEffectCost({}, { workerFactory: () => worker });
  try {
    assert.equal(await cost.estimate(descriptor.payload, context), 1234);
    const { data, transfer } = requests.find(request => request.data.type === 'estimate');
    assert.equal(data.control.byteLength, prefix.control.byteLength);
    assert.equal(data.payloadBytes, descriptor.payload.byteLength);
    assert.deepEqual(new Uint8Array(data.control), new Uint8Array(prefix.control));
    assert.deepEqual(transfer, [data.control]);
    assert.ok(descriptor.payload.byteLength > pcm.byteLength, 'The source bank remains owned by its caller');
  } finally { cost.close(); }
});

function workerFactory() {
  let closed = false;
  const client = { terminate() { closed = true; }, postMessage(data) { queueMicrotask(() => { if (!closed) endpoint.onmessage({ data }); }); } };
  const endpoint = { postMessage(data) { queueMicrotask(() => { if (!closed) client.onmessage({ data }); }); } };
  attachSfzSampleStreamWorker(endpoint); return client;
}

test('streamed context changes query native storage once and reuse sufficient prepared capacity', async () => {
  const parsed = await source(), pcm = new Float32Array(8193).fill(.125);
  const bytes = new Uint8Array(await new AudioEncoder().encodeWav({ numberOfChannels: 1, length: pcm.length,
    sampleRate: 48000, getChannelData: () => pcm }, 'float32').arrayBuffer());
  let queries = 0;
  const estimate = async payload => { queries++; return queriedCacheBytes(payload) + (queries === 1 ? 1024 : 2048); };
  const { descriptor } = await prepareStreamedSfzBank({ id: 'a'.repeat(24), parsed, maxBytes: 1024 * 1024,
    createSampleReader: () => createSfzMemorySampleReader(bytes), preparationContext: context,
    estimateEffectBytes: estimate }, { workerFactory, persistentCache: null });
  assert.equal(queries, 1);
  const lower = await prepareSfzAssetForContext(descriptor, { ...context, minimumPhysicalBpm: 15 }, 1024 * 1024, estimate);
  assert.equal(queries, 2, 'One context change must not estimate once before and again during cache slot selection');
  assert.notEqual(lower, descriptor);
  assert.equal(lower.nativeNonCacheBytes - descriptor.nativeNonCacheBytes, 1024, 'The complete native query alone changes the target non-cache requirement');
  assert.equal(lower.footprintBytes, lower.payload.byteLength + lower.nativePreparationBytes);
  assert.ok(lower.footprintBytes <= 1024 * 1024);
  const covered = await prepareSfzAssetForContext(lower, context, 1024 * 1024, estimate);
  assert.equal(queries, 3); assert.equal(covered, lower, 'A covered context keeps its larger prepared capacity');
  let residentQueries = 0;
  const residentEstimate = async (_payload, geometry) => {
    residentQueries++; return queriedCacheBytes(_payload) + (geometry.minimumPhysicalBpm < 30 ? 2048 : 1024);
  };
  const resident = await prepareSfzSamples(await source(), () => bytes,
    async () => ({ sampleRate: 48000, channels: [pcm] }), 1024 * 1024, null,
    { preparationContext: context, estimateEffectBytes: residentEstimate });
  const expanded = await prepareSfzAssetForContext(resident.descriptor, { ...context, minimumPhysicalBpm: 15 }, 1024 * 1024, residentEstimate);
  assert.equal(residentQueries, 2);
  assert.equal(expanded.nativePreparationBytes, 2048);
  assert.equal(await prepareSfzAssetForContext(expanded, context, 1024 * 1024, residentEstimate), expanded,
    'A resident descriptor must compare against its current prepared capacity, not its original smaller bank');
  assert.equal(residentQueries, 3);
});
