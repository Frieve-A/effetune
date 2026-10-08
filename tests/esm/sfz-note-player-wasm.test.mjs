import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TOTAL_FRAMES = SAMPLE_RATE * 2;
const PARAMETERS = { enabled: true, th: 0.5, vf: -30, vc: 3, mn: 28, mx: 91,
  pl: 32, dm: 0, wm: 100, og: 0, channel: 'A', inputBus: 0, outputBus: 0 };

class SFZNotePlayerPlugin {
  static executionCapabilities = Object.freeze({ requiresWasm: true });
  constructor(asset, parameters = PARAMETERS) {
    this.id = 7201;
    this.enabled = true;
    this.inputBus = 0;
    this.outputBus = 0;
    this.channel = 'A';
    this.asset = asset;
    this.parameters = parameters;
    this.offlineDspAssetRequired = true;
    this.offlineDspAssetErrorMessageKey = 'sfzNotePlayer.error.prepare';
  }
  getParameters() { return this.parameters; }
  getWasmAssets() { return new Map([[0, this.asset]]); }
}

test('SFZ parameter packing preserves note controls and supplies defaults for older presets', () => {
  const { pack } = DSP_PARAM_PACKERS.get('SFZNotePlayerPlugin');
  assert.deepEqual(Array.from(pack()), [0.75, -60, -10, 28, 91, 32, 20, 100, 0, 0, 1, 1, 1, 0, 40, 50]);
  assert.deepEqual(Array.from(pack(PARAMETERS).slice(-2)), [40, 50]);
  assert.deepEqual(Array.from(pack({ ...PARAMETERS, rd: 96, nh: 100 }).slice(-2)), [96, 100]);
  assert.deepEqual(Array.from(pack({ ...PARAMETERS, rd: 6, nh: 37 }).slice(-2)), [6, 37]);
});

test('synthetic SFZ bank produces detected notes through the offline WASM pipeline', async () => {
  const parsed = await parseSfz({ selectedPath: 'piano.sfz',
    readText: async () => '<region> sample=tone.wav key=69 loop_mode=loop_continuous ampeg_release=.02',
    hasSample: () => true, onDiagnostic: null });
  const samples = Float32Array.from({ length: 4800 }, (_, frame) =>
    Math.sin(2 * Math.PI * 500 * frame / SAMPLE_RATE) * 0.4);
  const asset = packSfzAsset(parsed.regions, new Map([['tone.wav',
    { channels: [samples], sampleRate: SAMPLE_RATE }]]));
  const bytes = fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.simd.wasm', import.meta.url));
  const meta = JSON.parse(fs.readFileSync(
    new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url), 'utf8'));
  const warnings = [];
  const processor = new OfflineProcessor({}, {}, {
    async getModuleInfo() { return { bytes, meta, paramPackers: DSP_PARAM_PACKERS }; },
    getDspRolloutConfig() { return { forceOff: false, enabledTypes: ['SFZNotePlayerPlugin'] }; },
    instantiateDsp,
    warning(message) { warnings.push(message); }
  });
  await withGlobals({ window: {
    audioPreferences: { useWasmDsp: true, outputChannels: 2 },
    location: { pathname: '/effetune.html', search: '' }
  } }, async () => {
    const endings = [];
    for (const hold of [0, 100]) {
      const plugin = new SFZNotePlayerPlugin(asset, { ...PARAMETERS, nh: hold });
      const session = await processor.createOfflineDspSession([plugin], SAMPLE_RATE, 2);
      assert.ok(session, warnings.join('; '));
      try {
        const entry = session.entries.get(plugin);
        assert.equal(entry.disabled, false);
        assert.equal(session.binding.instanceAssetState(entry.instanceId, 0) & 0xff, 3);
        let outputPower = 0;
        let sampleSine = 0;
        let sampleCosine = 0;
        let measuredFrames = 0;
        let firstOutputFrame = -1;
        let lastOutputFrame = -1;
        for (let offset = 0; offset < TOTAL_FRAMES; offset += BLOCK_SIZE) {
          const inputBlock = new Float32Array(BLOCK_SIZE * 2);
          for (let frame = 0; frame < BLOCK_SIZE; frame++) {
            let value = 0;
            for (let harmonic = 1; harmonic <= 8; harmonic++) {
              const time = (offset + frame) / SAMPLE_RATE;
              if (time >= 0.1 && time < 1.5) {
                value += Math.sin(2 * Math.PI * 440 * harmonic * time + 0.37 * harmonic * harmonic) * 0.1 / harmonic;
              }
            }
            inputBlock[frame] = value;
            inputBlock[BLOCK_SIZE + frame] = value;
          }
          const result = processor.tryProcessOfflineDspPipeline({ session, pipeline: [plugin],
            inputBlock, sampleRate: SAMPLE_RATE, outputChannelCount: 2, blockSize: BLOCK_SIZE, offset });
          assert.ok(result, 'SFZ must use the native offline pipeline');
          for (const value of result) {
            assert.ok(Number.isFinite(value));
            outputPower += value * value;
          }
          for (let frame = 0; frame < BLOCK_SIZE; frame++) {
            if (firstOutputFrame < 0 && result[frame] !== 0) firstOutputFrame = offset + frame;
            if (result[frame] !== 0) lastOutputFrame = offset + frame;
            const time = (offset + frame) / SAMPLE_RATE;
            if (time >= 0.5 && time < 1) {
              sampleSine += result[frame] * Math.sin(2 * Math.PI * 500 * time);
              sampleCosine += result[frame] * Math.cos(2 * Math.PI * 500 * time);
              measuredFrames++;
            }
          }
        }
        assert.ok(outputPower > 1, 'Detected notes must play the imported synthetic sample');
        assert.equal(firstOutputFrame, SAMPLE_RATE * 0.18 + 1,
          'The revised detection must begin after 80 ms of analysis latency');
        assert.ok(Math.hypot(sampleSine, sampleCosine) / measuredFrames > 0.005,
          'The output must contain the bank’s 500 Hz sample rather than the input’s 440 Hz pitch');
        endings.push(lastOutputFrame);
      } finally { processor.destroyOfflineDspSession(session); }
    }
    assert.equal(endings[1] - endings[0], SAMPLE_RATE / 10,
      'A 100 ms hold must extend the note ending by exactly 100 ms');
  });
});

test('boundary sine notes share Note Spectrogram analysis and select the matching SFZ key', async t => {
  for (const variant of ['baseline', 'simd']) {
    await t.test(variant, async () => {
      const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
      const binding = await instantiateDspBinding(fs.readFileSync(
        new URL(`../../plugins/dsp/${filename}`, import.meta.url)));
      binding.createEngine();
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, 262144), 0);
      try {
        const source = binding.createInstance('NoteSpectrogramPlugin');
        const linked = binding.createInstance('SFZNotePlayerPlugin');
        const own = binding.createInstance('SFZNotePlayerPlugin');
        assert.ok(source && linked && own);
        assert.equal(binding.instanceSetAnalysisSource(linked, source), 0);
        assert.equal(binding.instanceSetTap(source, 1), 0);
        assert.equal(binding.setTelemetryRate(50), 0);
        for (const [id, type] of [[source, 'NoteSpectrogramPlugin'],
          [linked, 'SFZNotePlayerPlugin'], [own, 'SFZNotePlayerPlugin']]) {
          const packer = DSP_PARAM_PACKERS.get(type);
          assert.equal(binding.instanceSetParams(id,
            packer.pack({ ...PARAMETERS, mn: 21, mx: 108, rd: 96 }), packer.hash), 0);
        }
        const sample = Float32Array.from({ length: 4800 }, (_, frame) =>
          .4 * Math.sin(2 * Math.PI * 500 * frame / SAMPLE_RATE));
        const telemetry = new Uint8Array(262144);
        // Each bank contains only this key, so hearing its sample also verifies key selection.
        for (const midi of [21, 27, 28, 84, 85, 91, 108]) {
          const parsed = await parseSfz({ selectedPath: 'boundary.sfz',
            readText: async () => `<region> sample=tone.wav key=${midi} loop_mode=loop_continuous amp_veltrack=0`,
            hasSample: () => true, onDiagnostic: null });
          const asset = packSfzAsset(parsed.regions, new Map([['tone.wav',
            { channels: [sample], sampleRate: SAMPLE_RATE }]]));
          for (const id of [linked, own]) {
            assert.equal(binding.instanceSetAsset(id, 0, asset.payload,
              { ...asset, frames: asset.samples, topology: 0 }), 0);
          }
          const { combined, offsets } = binding.getArenaViews();
          for (const id of [linked, own]) {
            for (let step = 0; step < 100 && (binding.instanceAssetState(id, 0) & 0xff) !== 3; step++) {
              combined.fill(0);
              assert.equal(binding.instanceProcess(id, offsets.combined, 2, BLOCK_SIZE,
                step * BLOCK_SIZE / SAMPLE_RATE), 0);
            }
            assert.equal(binding.instanceAssetState(id, 0) & 0xff, 3);
          }
          for (const id of [source, linked, own]) assert.equal(binding.resetInstance(id), 0);
          binding.telemetryRead(telemetry);
          const frequency = 440 * 2 ** ((midi - 69) / 12);
          let maxConfidence = 0, sampleSine = 0, sampleCosine = 0, measured = 0;
          for (let offset = 0; offset < SAMPLE_RATE * .6; offset += BLOCK_SIZE) {
            for (let frame = 0; frame < BLOCK_SIZE; frame++) {
              const elapsed = (offset + frame) / SAMPLE_RATE - .1;
              // Match the keyboard preview's -12 dB sine and 5 ms attack ramp.
              const gain = elapsed <= 0 ? 0 : elapsed < .005 ? elapsed / .005 : 1;
              const value = .251188643150958 * gain * Math.sin(2 * Math.PI * frequency * elapsed);
              combined[frame] = combined[BLOCK_SIZE + frame] = value;
            }
            const input = combined.slice(0, BLOCK_SIZE * 2);
            const time = offset / SAMPLE_RATE;
            assert.equal(binding.instanceProcess(source, offsets.combined, 2, BLOCK_SIZE, time), 0);
            assert.equal(binding.instanceProcess(linked, offsets.combined, 2, BLOCK_SIZE, time), 0);
            const output = combined.slice(0, BLOCK_SIZE * 2);
            combined.set(input);
            assert.equal(binding.instanceProcess(own, offsets.combined, 2, BLOCK_SIZE, time), 0);
            assert.deepEqual(output, combined.subarray(0, BLOCK_SIZE * 2),
              `MIDI ${midi}: shared and independent analysis must produce identical playback`);
            for (let frame = 0; frame < BLOCK_SIZE; frame++) {
              const time = (offset + frame) / SAMPLE_RATE;
              if (time >= .3) {
                sampleSine += output[frame] * Math.sin(2 * Math.PI * 500 * time);
                sampleCosine += output[frame] * Math.cos(2 * Math.PI * 500 * time);
                measured++;
              }
            }
            const bytes = binding.telemetryRead(telemetry);
            const view = new DataView(telemetry.buffer, 0, bytes);
            for (let at = 0; at < bytes;) {
              const length = view.getUint16(at + 12, true);
              if (view.getUint16(at, true) === 24) {
                // The 2-hop revised plane is the confidence used for synthesis.
                const confidenceOffset = at + 16 + 32 + 3 * 440 * 4 + 4;
                for (let division = 0; division < 5; division++) {
                  const confidence = view.getFloat32(
                    confidenceOffset + ((midi - 21) * 5 + division) * 4, true);
                  if (confidence > maxConfidence) maxConfidence = confidence;
                }
              }
              at += (16 + length + 3) & ~3;
            }
          }
          assert.ok(maxConfidence >= PARAMETERS.th, `MIDI ${midi}: the analysis must detect the sine`);
          assert.ok(Math.hypot(sampleSine, sampleCosine) / measured > .1,
            `MIDI ${midi}: playback must contain the SFZ's 500 Hz sample`);
        }
      } finally { binding.destroyEngine(); }
    });
  }
});

test('SFZ octave shifts suppress folded tones in baseline and SIMD WASM', async t => {
  for (const variant of ['baseline', 'simd']) {
    await t.test(variant, async () => {
      const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
      const binding = await instantiateDspBinding(fs.readFileSync(
        new URL(`../../plugins/dsp/${filename}`, import.meta.url)));
      binding.createEngine();
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, 262144), 0);
      try {
        const id = binding.createInstance('SFZNotePlayerPlugin');
        assert.ok(id);
        const parsed = await parseSfz({ selectedPath: 'band-limit.sfz',
          readText: async () => '<region> sample=tone.wav pitch_keycenter=69 loop_mode=loop_continuous amp_veltrack=0',
          hasSample: () => true, onDiagnostic: null });
        for (const octave of [1, 2]) {
          const step = 2 ** octave;
          const sample = Float32Array.from({ length: 4800 }, (_, frame) => {
            const phase = 2 * Math.PI * frame / (SAMPLE_RATE * step);
            return .25 * (Math.sin(3000 * phase) + Math.sin(25000 * phase) + Math.sin(42000 * phase));
          });
          const asset = packSfzAsset(parsed.regions, new Map([['tone.wav',
            { channels: [sample], sampleRate: SAMPLE_RATE }]]));
          const packer = DSP_PARAM_PACKERS.get('SFZNotePlayerPlugin');
          assert.equal(binding.instanceSetParams(id,
            packer.pack({ ...PARAMETERS, mn: 69, mx: 69, os: octave, rd: 96 }), packer.hash), 0);
          assert.equal(binding.instanceSetAsset(id, 0, asset.payload,
            { ...asset, frames: asset.samples, topology: 0 }), 0);
          const { combined, offsets } = binding.getArenaViews();
          for (let block = 0; block < 100 && (binding.instanceAssetState(id, 0) & 0xff) !== 3; block++) {
            combined.fill(0);
            assert.equal(binding.instanceProcess(id, offsets.combined, 2, BLOCK_SIZE,
              block * BLOCK_SIZE / SAMPLE_RATE), 0);
          }
          assert.equal(binding.instanceAssetState(id, 0) & 0xff, 3);
          assert.equal(binding.resetInstance(id), 0);
          const frequencies = [3000, 6000, 23000];
          const sine = [0, 0, 0], cosine = [0, 0, 0];
          let measured = 0;
          for (let offset = 0; offset < SAMPLE_RATE; offset += BLOCK_SIZE) {
            for (let frame = 0; frame < BLOCK_SIZE; frame++) {
              const time = (offset + frame) / SAMPLE_RATE;
              let value = 0;
              for (let harmonic = 1; harmonic <= 8; harmonic++) {
                value += .1 / harmonic * Math.sin(2 * Math.PI * 440 * harmonic * time + .37 * harmonic * harmonic);
              }
              combined[frame] = combined[BLOCK_SIZE + frame] = value;
            }
            assert.equal(binding.instanceProcess(id, offsets.combined, 2, BLOCK_SIZE,
              offset / SAMPLE_RATE), 0);
            for (let frame = 0; frame < BLOCK_SIZE; frame++) {
              const time = (offset + frame) / SAMPLE_RATE;
              if (time < .5 || time >= 1) continue;
              assert.ok(Number.isFinite(combined[frame]));
              for (let tone = 0; tone < frequencies.length; tone++) {
                const phase = 2 * Math.PI * frequencies[tone] * time;
                sine[tone] += combined[frame] * Math.sin(phase);
                cosine[tone] += combined[frame] * Math.cos(phase);
              }
              measured++;
            }
          }
          const amplitudes = sine.map((value, tone) => 2 * Math.hypot(value, cosine[tone]) / measured);
          assert.ok(Math.abs(amplitudes[0] - .25) < .002, `Octave ${octave}: retain the 3 kHz tone`);
          for (const amplitude of amplitudes.slice(1)) {
            assert.ok(amplitude < .00025, `Octave ${octave}: suppress folded tones by at least 60 dB`);
          }
        }
      } finally { binding.destroyEngine(); }
    });
  }
});
