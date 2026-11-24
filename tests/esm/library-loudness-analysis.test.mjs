import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareLoudnessSource, runLoudnessAnalysis } from '../../js/library/loudness/analysis-job.js';
import { createRangeAdapter, measureDecodedTrack } from '../../js/library/loudness/decode.js';
import { addLoudnessBlock, encodeHistogram, integratedFromHistograms, isValidLoudnessHistogram } from '../../js/library/loudness/histogram.js';
import { createLoudnessMeter } from '../../js/library/loudness/measurement.js';

const wasm = await WebAssembly.compile(await readFile(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url)));
const rate = 44100;
function near(actual, expected, tolerance) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
}
async function measure(plane, channels = 1, sampleRate = rate) {
  const blocks = [];
  const meter = await createLoudnessMeter(wasm, sampleRate, channels, value => blocks.push(value));
  try {
    for (let i = 0; i < plane.length; i += 997) {
      meter.push(Array(channels).fill(plane.subarray(i, i + 997)));
    }
    return { ...meter.finish(), blocks };
  } finally { meter.close(); }
}
function tone(levels, hz = rate) {
  return Float32Array.from({ length: hz * levels.length }, (_, i) =>
    10 ** (levels[Math.floor(i / hz)] / 20) * Math.sin(2 * Math.PI * 1000 * i / hz));
}

test('gated meter matches the reference tone, counts complete blocks and re-gates separate tracks', async () => {
  const a = await measure(tone([-23, -23, -23]));
  const b = await measure(tone([-42, -42, -13, -13]));
  near(a.integrated, -23, 0.1);
  near(b.integrated, -13.35, 0.25);
  assert.equal(a.blocks.length, 27);
  assert.equal(b.blocks.length, 37);
  assert.ok(a.histogram.length < 1024 && b.histogram.length < 1024);
  near(integratedFromHistograms([a.histogram]), a.integrated, 0.1);
  near(integratedFromHistograms([b.histogram]), b.integrated, 0.1);
  function mean(values) {
    return 10 * Math.log10(values.reduce((sum, lufs) => sum + 10 ** (lufs / 10), 0) / values.length);
  }
  const blocks = [...a.blocks, ...b.blocks].filter(value => value >= -70);
  const gate = mean(blocks) - 10;
  near(integratedFromHistograms([a.histogram, b.histogram]), mean(blocks.filter(v => v >= gate)), 0.1);
  const stereo = await measure(tone([-23, -23, -23]), 2);
  assert.deepEqual(stereo, a);
  const odd = await measure(tone([-23, -27], 22050), 1, 22050);
  assert.equal(odd.blocks.length, 17);
  near(integratedFromHistograms([odd.histogram]), odd.integrated, 0.1);
});

test('final peak is captured without including padded blocks in the measurement', async () => {
  const signal = new Float32Array(Math.round(rate * 0.4) - 1);
  signal[signal.length - 1] = 1;
  const result = await measure(signal);
  assert.ok(result.truePeak >= 0);
  assert.equal(result.integrated, null);
  assert.deepEqual(result.blocks, []);
  assert.equal(integratedFromHistograms([result.histogram]), null);
});

test('album gating includes the kernel bin containing a sustained level close to the relative gate', async () => {
  const levels = [...Array(5).fill(-23), ...Array(5).fill(-35.77)];
  const result = await measure(tone(levels, 48000), 1, 48000);
  near(result.integrated, -25.77994, 0.001);
  near(integratedFromHistograms([result.histogram]), result.integrated, 0.01);
  assert.ok(isValidLoudnessHistogram(result.histogram));
  const bins = new Map();
  for (let i = 0; i < 1800; i++) addLoudnessBlock(bins, -28 + 6 * Math.sin(i * 0.03) + 3 * Math.sin(i * 0.037));
  assert.ok(bins.size > 1000);
  assert.ok(encodeHistogram(bins).length < 1024);
});

test('analysis skips changed files from web and desktop range handles and closes stale sessions', async () => {
  const track = { size: 8, mtimeMs: 123 };
  const stale = { status: 'unavailable' };
  for (const file of [{ size: 9, lastModified: 123 }, { size: 8, lastModified: 124 }]) {
    assert.deepEqual(await prepareLoudnessSource(track, { file }), stale);
  }
  const file = { size: 8, lastModified: 123 };
  assert.deepEqual(await prepareLoudnessSource(track, { file }), { file });
  const closed = [];
  const api = { async openPlaybackRange() { return { token: 'range', size: 8, mtimeMs: 123.51 }; },
    closePlaybackRange: token => closed.push(token) };
  assert.deepEqual(await prepareLoudnessSource(track, { path: 'track.flac' }, undefined, api), stale);
  assert.deepEqual(closed, ['range']);
});

test('cancelling a pending analysis conversion requests cancellation by its own ID', async () => {
  const controller = new AbortController();
  let pending, started;
  const wait = new Promise(resolve => { started = resolve; });
  const ids = [];
  const api = {
    prepareLoudnessSource(path, id, signature) {
      assert.deepEqual(signature, { size: 8, mtimeMs: 123 });
      ids.push(id);
      return new Promise(resolve => { pending = resolve; started(); });
    },
    async cancelLoudnessSource(id) { ids.push(id); pending({ success: false, code: 'playbackSourceUnavailable' }); }
  };
  const task = prepareLoudnessSource({ size: 8, mtimeMs: 123 }, { path: 'track.m4a' }, controller.signal, api);
  await wait;
  controller.abort();
  assert.deepEqual(await task, { status: 'unavailable' });
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('concurrent media reads return ordered bytes while staying within the range session limit', async () => {
  let busy = false;
  const original = Uint8Array.from({ length: 2 ** 20 + 731 }, (_, i) => i % 251);
  const adapter = createRangeAdapter({ size: original.length, async read(offset, length) {
    assert.ok(!busy && length <= 2 ** 20);
    busy = true;
    await new Promise(resolve => setImmediate(resolve));
    busy = false;
    return original.slice(offset, offset + length);
  } });
  const [large, small] = await Promise.all([adapter.read(17, original.length), adapter.read(113, 1533)]);
  assert.deepEqual(large, original.slice(17));
  assert.deepEqual(small, original.slice(113, 1533));
});

test('CUE decoding copies exactly the samples inside the two packet boundaries', async () => {
  const values = [];
  const sample = timestamp => ({ timestamp, sampleRate: 7500, numberOfFrames: 150, numberOfChannels: 1,
    copyTo(output, { frameOffset }) {
      for (let i = 0; i < output.length; i++) output[i] = Math.round(timestamp * 7500) + frameOffset + i;
    }, close() {} });
  const track = { getNumberOfChannels: () => 1, getSampleRate: () => 7500, canDecode: () => true };
  const options = { track, samples: (start, end) => {
    assert.equal(start, 1 / 75);
    assert.equal(end, 2 / 75);
    return [sample(0), sample(150 / 7500)];
  }, region: { startFrame: 1, endFrame: 2 }, createMeter: () => ({
    push([plane]) { values.push(...plane); }, finish: () => ({}), close() {}
  }) };
  assert.equal((await measureDecodedTrack(options)).status, 'measured');
  assert.deepEqual(values, Array.from({ length: 100 }, (_, i) => 100 + i));
  track.getNumberOfChannels = () => 8;
  assert.equal((await measureDecodedTrack(options)).status, 'unsupported');
});

test('low-rate files are recorded as unsupported and the analysis proceeds to the next normal track', async () => {
  const tracks = [2000, 3200, 3300, 48000].map((hz, i) => ({ trackUid: String(i + 1), hz, relativePath: `${i}.wav` }));
  const results = [];
  await runLoudnessAnalysis({ catalog: {
    listPendingLoudness: ({ afterTrackUid }) => ({
      tracks: tracks.filter(row => row.trackUid > afterTrackUid).slice(0, 1), totalCount: tracks.length
    }),
    saveTrackLoudness: ({ measurements }) => results.push(...measurements)
  }, resolveSource: track => track, createLane: () => ({
    analyze({ hz }) {
      return measureDecodedTrack({
        track: { getSampleRate: () => hz, getNumberOfChannels: () => 1, canDecode: () => true }, region: {},
        samples() {
          assert.equal(hz, 48000);
          return [{ timestamp: 0, sampleRate: hz, numberOfChannels: 1, numberOfFrames: hz,
            copyTo: plane => plane.set(tone([-23], hz)), close() {} }];
        }, createMeter: (r, ch) => createLoudnessMeter(wasm, r, ch)
      });
    }, close() {}
  }), refreshLoudness() {} });
  assert.deepEqual(results.map(row => row.status), ['unsupported', 'unsupported', 'unsupported', 'measured']);
  near(results[3].integrated, -23, 0.1);
});

test('analysis stores format outcomes, retries unavailable files and refreshes even on cancellation or empty input', async () => {
  for (const mode of ['complete', 'empty', 'cancel']) {
    const tracks = ['ok.flac', 'unavailable.wav', 'bad.mp3', 'dsd.dsf', 'surround.opus'].map((relativePath, index) =>
      ({ relativePath, trackUid: String(index) }));
    tracks.push({ relativePath: 'scores.zip', trackUid: '5', sourceKind: 'archive-entry' });
    const saved = [];
    let finished = 0;
    const controller = new AbortController();
    const counts = await runLoudnessAnalysis({ catalog: {
      listPendingLoudness: ({ afterTrackUid }) => ({
        tracks: mode === 'empty' ? [] : tracks.filter(row => row.trackUid > afterTrackUid).slice(0, 2),
        totalCount: mode === 'empty' ? 0 : tracks.length
      }),
      saveTrackLoudness: ({ measurements }) => saved.push(...measurements)
    }, signal: controller.signal,
    resolveSource: track => {
      assert.notEqual(track.relativePath, 'scores.zip');
      return track.trackUid === '1' ? null : { path: track.relativePath };
    },
    createLane: () => ({ async analyze(track) {
      if (mode === 'cancel') controller.abort();
      assert.notEqual(track.relativePath, 'dsd.dsf');
      return { status: ({ 0: 'measured', 2: 'failed', 4: 'unsupported' })[track.trackUid] };
    }, close() {} }), refreshLoudness: () => { finished++; } });
    assert.equal(finished, 1);
    if (mode === 'complete') {
      assert.deepEqual(saved.map(row => row.trackUid).sort(), ['0', '2', '3', '4', '5']);
      assert.deepEqual(counts, { processed: 6, total: 6, measured: 1, failed: 1, unsupported: 3, unavailable: 1 });
    } else assert.deepEqual(saved, []);
  }
});
