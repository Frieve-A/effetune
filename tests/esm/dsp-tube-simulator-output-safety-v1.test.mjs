// Output-stage safety trim: the post-model, downward-only attenuation that keeps a tube or an
// output-stage switch (+25 dB for 12AU7 -> 12AX7, +33 dB for Line -> Power) from handing digital
// full-scale overshoot to whatever is downstream. The mechanism lives behind the amplifier model
// as a linear scalar, so these tests check its law - engage, never recover, ramp, freeze, reset -
// and check that it leaves the model and the dry path alone.
//
// What it suppresses is overshoot past full scale, not the distortion the model generates: that
// distortion is real amplifier behaviour and is left alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginSourcePath = path.join(repoRoot, 'plugins', 'saturation', 'tube_simulator.js');
const pluginSource = fs.readFileSync(pluginSourcePath, 'utf8');

const SAMPLE_RATE = 44100;
const BLOCK_SIZE = 128;
// Comfortably past the 882-frame ramp at this rate, and long enough for the model to settle so
// the peak the detector latches onto stops growing.
const SETTLE_BLOCKS = 48;
const SUPPORTED_SAMPLE_RATES = [44100, 48000, 88200, 96000, 176400, 192000];
// A full-scale 1 kHz sine through the maximum output trim. The trim is behind the model, so this
// is simply a wet path whose samples run past digital full scale - the sort of level a tube or
// output-stage switch produces, not the sort a converter can reproduce.
const LOUD_AMPLITUDE = 1;
// The overdriven line circuit, named explicitly so the case does not inherit the
// product default output stage.
const LOUD_PARAMS = Object.freeze({
  dr: -30, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10,
  og: 48, mx: 100, iv: 2.828, nf: 0, os: 'Line', sg: 0, ag: true
});

class PluginBase {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.enabled = true;
    this.id = 1;
    this._sectionEnabled = true;
    this._powerUiEnabled = true;
  }

  registerProcessor(source) {
    this.processorString = source;
  }

  parseFiniteNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return number < minimum ? minimum : (number > maximum ? maximum : number);
  }

  getSerializableParameters() {
    return this.getParameters();
  }

  getWorkletPluginData(parameters) {
    return { parameters };
  }

  updateParameters() {}
}

function createPlugin(source = pluginSource) {
  const context = vm.createContext({ PluginBase, console, performance: { now: () => 0 }, window: {} });
  vm.runInContext(source, context, { filename: 'tube_simulator.js' });
  return new context.window.TubeSimulatorPlugin();
}

// The 164-byte operating-point frame the worklet publishes. Only the trailing shared word - the
// automatic output safety reduction in dB - matters here, so the per-channel fields stay zero.
function telemetryFrame(safetyReductionDb) {
  const payload = new DataView(new ArrayBuffer(164));
  payload.setFloat32(40 * 4, safetyReductionDb, true);
  return { frameType: 19, formatVersion: 2, payload };
}

// Drives the JavaScript reference engine that ships inside the plugin, in whole 128-frame blocks
// of channel-major audio, and exposes the reference's own safety state for inspection.
function createReference(params, sampleRate = SAMPLE_RATE, overrides = {}, source = pluginSource) {
  const plugin = createPlugin(source);
  plugin.setParameters(params);
  plugin.fr = true;
  const context = {};
  const processor = new Function('context', 'data', 'parameters', plugin.processorString);

  const processBlock = block => {
    const blockFrames = block.length / 2;
    const result = processor(context, block, {
      ...plugin.getParameters(),
      enabled: true,
      sampleRate,
      channelCount: 2,
      blockSize: blockFrames,
      ...overrides
    });
    return ArrayBuffer.isView(result) ? result : block;
  };

  // The reference engine is built on its first process call, so one silent block is run here to
  // make the safety state observable before the test feeds it anything.
  processBlock(new Float32Array(BLOCK_SIZE * 2));

  return {
    plugin,
    processBlock,
    setParameters(next) {
      plugin.setParameters(next);
    },
    safety() {
      assert.ok(context.__tubeSimulatorReferenceV1, 'reference engine was never created');
      return context.__tubeSimulatorReferenceV1.outputSafety;
    },
    // The engine's own state record, which carries the Phase C speaker profile exactly as it was
    // measured (powerSpeaker) alongside the coefficients derived from it (powerOpt).
    state() {
      assert.ok(context.__tubeSimulatorReferenceV1, 'reference engine was never created');
      return context.__tubeSimulatorReferenceV1;
    },
    reset() {
      assert.ok(context.__tubeSimulatorReferenceV1, 'reference engine was never created');
      context.__tubeSimulatorReferenceV1.reset();
    }
  };
}

function sineBlock(startFrame, frames, amplitude, sampleRate = SAMPLE_RATE) {
  const block = new Float32Array(frames * 2);
  for (let channel = 0; channel < 2; channel++) {
    for (let frame = 0; frame < frames; frame++) {
      block[channel * frames + frame] =
        Math.sin(2 * Math.PI * 1000 * (startFrame + frame) / sampleRate) * amplitude;
    }
  }
  return block;
}

// Runs `blocks` 128-frame blocks of a continuous sine through the reference and returns the
// safety gain observed at the end of every block together with the rendered audio.
function runSine(reference, blocks, amplitude = LOUD_AMPLITUDE) {
  const gains = [];
  const outputs = [];
  for (let index = 0; index < blocks; index++) {
    const block = sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, amplitude);
    outputs.push(new Float32Array(reference.processBlock(block)));
    gains.push(reference.safety().gain);
  }
  return { gains, outputs };
}

function runSilence(reference, blocks) {
  for (let index = 0; index < blocks; index++) {
    reference.processBlock(new Float32Array(BLOCK_SIZE * 2));
  }
  return reference.safety().gain;
}

// Renders `blocks` blocks of the loud tone through a WASM artifact and returns them.
async function runShipped(artifact, params, blocks, sampleRate = SAMPLE_RATE) {
  const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', artifact));
  const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
  const binding = await instantiateDsp(wasmBytes);
  const outputs = [];
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(sampleRate, 2, BLOCK_SIZE, 32768), 0);
    const instance = binding.createInstance('TubeSimulatorPlugin');
    assert.notEqual(instance, 0);
    assert.equal(binding.instanceSetParams(instance, packer.pack(params), packer.hash), 0);
    const arena = binding.getArenaViews();
    for (let index = 0; index < blocks; index++) {
      arena.combined.set(sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, LOUD_AMPLITUDE, sampleRate));
      assert.equal(
        binding.instanceProcess(instance, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
      outputs.push(new Float32Array(arena.combined.subarray(0, BLOCK_SIZE * 2)));
    }
  } finally {
    binding.close();
  }
  return outputs;
}

// The frame at which two otherwise identical runs first differ. With the only difference being
// Auto Gain Reduction, that frame is exactly where the detector first acted.
function firstDivergentFrame(active, frozen) {
  for (let block = 0; block < active.length; block++) {
    for (let frame = 0; frame < BLOCK_SIZE; frame++) {
      for (let channel = 0; channel < 2; channel++) {
        const index = channel * BLOCK_SIZE + frame;
        if (active[block][index] !== frozen[block][index]) return block * BLOCK_SIZE + frame;
      }
    }
  }
  return -1;
}

// At mx = 100 with no fault or transition in flight, the wet chain the detector watches is exactly
// what leaves the plug-in, so a run with the detector disabled is a recording of what the detector
// saw. Returns the largest magnitude in it and how many samples reach that magnitude.
function detectionPeak(blocks, channel = null) {
  let peak = 0;
  let count = 0;
  for (const block of blocks) {
    for (let index = 0; index < block.length; index++) {
      if (channel !== null && Math.floor(index / BLOCK_SIZE) !== channel) continue;
      const magnitude = Math.abs(block[index]);
      if (magnitude > peak) {
        peak = magnitude;
        count = 1;
      } else if (magnitude === peak) {
        ++count;
      }
    }
  }
  return { peak, count };
}

function exactFloat32(left, right) {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength)
    .equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength));
}

function tailRms(blocks, count) {
  let sum = 0;
  let samples = 0;
  for (const block of blocks.slice(-count)) {
    for (const value of block) {
      sum += value * value;
      ++samples;
    }
  }
  return Math.sqrt(sum / samples);
}

test('a sample above 0 dBFS engages the reduction, which then never recovers', () => {
  const reference = createReference(LOUD_PARAMS);
  const safety = reference.safety();
  assert.equal(safety.rampFrames, Math.ceil(SAMPLE_RATE * 0.02));
  assert.equal(safety.gain, 1);
  assert.equal(safety.target, 1);

  const engagedRun = runSine(reference, SETTLE_BLOCKS);
  const gain = reference.safety().gain;
  assert.ok(gain < 1, `reduction did not engage (gain ${gain})`);
  assert.equal(gain, reference.safety().target, 'the ramp should have reached its target');

  // Nothing survives at the output above full scale once the reduction is fully in force.
  assert.ok(detectionPeak(engagedRun.outputs.slice(-8)).peak <= 1,
    'the engaged output still runs past full scale');

  // Silence for many frames: a limiter would release here, this must not.
  assert.equal(runSilence(reference, SETTLE_BLOCKS), gain,
    'the reduction recovered, which it must never do');
});

test('the loudest single sample sets exactly the reduction it calls for', () => {
  // The detector is open loop, so 1 / |sample| is exactly the gain that would have brought that
  // sample back to full scale. The run with the detector disabled records what it saw.
  const observed = createReference({ ...LOUD_PARAMS, ag: false });
  const reduced = createReference(LOUD_PARAMS);
  const chain = runSine(observed, SETTLE_BLOCKS).outputs;
  runSine(reduced, SETTLE_BLOCKS);

  // Counted on the left channel alone: both channels carry the same stimulus, so the loudest
  // sample necessarily appears once in each.
  const { peak, count } = detectionPeak(chain, 0);
  assert.ok(peak > 1, 'the observation run never went past full scale, so nothing was proved');
  assert.equal(count, 1, 'more than one sample reaches the peak, so it is not a single sample');

  const expected = 1 / peak;
  const safety = reduced.safety();
  // The recording is Float32 and the detector works in double, so the two agree to the width of a
  // Float32 mantissa and no closer.
  assert.ok(Math.abs(safety.target - expected) <= 1e-6 * expected,
    `target ${safety.target} is not the reciprocal of the loudest sample (${expected})`);
  assert.equal(safety.gain, safety.target, 'the ramp reached that target');

  assert.equal(runSilence(reduced, SETTLE_BLOCKS), safety.gain,
    'the reduction that one sample called for did not survive the silence');
});

test('the ramp takes exactly 20 ms at every supported sample rate', () => {
  // A short burst and then silence. The burst rings the model, the response has a single largest
  // sample, and nothing after that can exceed it - so the ramp is armed for the last time at that
  // sample and then runs to completion undisturbed. Blocks of one frame make the count exact,
  // which a measurement inferred from the tail of a run with overlapping ramps cannot be: a
  // mutation that snapped straight to the target would pass that and fails this.
  for (const sampleRate of SUPPORTED_SAMPLE_RATES) {
    const reference = createReference(LOUD_PARAMS, sampleRate);
    const rampFrames = reference.safety().rampFrames;
    assert.equal(rampFrames, Math.ceil(sampleRate * 0.02),
      `${sampleRate} Hz ramp length is not 20 ms`);

    reference.processBlock(sineBlock(0, 64, LOUD_AMPLITUDE, sampleRate));
    const gains = [reference.safety().gain];
    const remaining = [reference.safety().remaining];
    for (let frame = 0; frame < rampFrames + 1024; frame++) {
      reference.processBlock(new Float32Array(2));
      gains.push(reference.safety().gain);
      remaining.push(reference.safety().remaining);
    }

    const target = reference.safety().target;
    assert.ok(target < 1, `${sampleRate} Hz burst never engaged the reduction`);

    // The frame the ramp was armed for the last time: one step has already been taken there, so
    // the counter reads one short of its full length.
    let armed = -1;
    for (let frame = 0; frame < remaining.length; frame++) {
      if (remaining[frame] === rampFrames - 1) armed = frame;
    }
    assert.ok(armed >= 0, `${sampleRate} Hz never armed the ramp`);
    assert.ok(armed + rampFrames - 1 < gains.length,
      `${sampleRate} Hz ran out of frames before the ramp could finish`);

    assert.ok(gains[armed] > target, `${sampleRate} Hz snapped to the target instead of ramping`);
    assert.ok(gains[armed + rampFrames - 2] > target,
      `${sampleRate} Hz reached the target early, so the ramp is shorter than 20 ms`);
    assert.equal(gains[armed + rampFrames - 1], target,
      `${sampleRate} Hz did not reach the target after exactly ${rampFrames} frames`);
    assert.equal(remaining[armed + rampFrames - 1], 0);

    // One way and amplitude linear: every step is downward and every step is the same size.
    const step = gains[armed + 1] - gains[armed];
    for (let frame = armed + 1; frame < armed + rampFrames - 1; frame++) {
      assert.ok(gains[frame] < gains[frame - 1], `${sampleRate} Hz ramp stalled or moved upward`);
      assert.ok(Math.abs((gains[frame] - gains[frame - 1]) - step) < 1e-12,
        `${sampleRate} Hz ramp is not amplitude linear`);
    }
  }
});

test('Auto Gain Reduction off freezes the mechanism at a level that would otherwise engage', () => {
  const frozen = createReference({ ...LOUD_PARAMS, ag: false });
  const active = createReference(LOUD_PARAMS);

  const frozenRun = runSine(frozen, SETTLE_BLOCKS);
  const activeRun = runSine(active, SETTLE_BLOCKS);

  assert.equal(frozen.safety().gain, 1, 'a frozen detector must not attenuate at all');
  assert.equal(frozen.safety().target, 1, 'a frozen detector must not move its target');
  assert.equal(frozen.safety().remaining, 0, 'a frozen detector must not arm a ramp');
  assert.ok(active.safety().gain < 1, 'the comparison run never engaged');
  assert.ok(
    tailRms(frozenRun.outputs, 20) > tailRms(activeRun.outputs, 20) * 1.2,
    'the frozen run was attenuated'
  );
});

test('a fully engaged reduction leaves the mx = 0 null path bit transparent', () => {
  // The detector watches the wet chain before the mix, so it engages even though no wet signal
  // reaches the output. The dry path is never scaled, so the bypass must stay sample exact.
  const reference = createReference({ ...LOUD_PARAMS, mx: 0 });
  const inputs = [];
  const outputs = [];
  for (let index = 0; index < SETTLE_BLOCKS; index++) {
    const block = sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, LOUD_AMPLITUDE);
    inputs.push(new Float32Array(block));
    outputs.push(new Float32Array(reference.processBlock(block)));
  }
  assert.ok(reference.safety().gain < 1, 'the reduction never engaged, so nothing was proved');

  const latency = 64;
  let compared = 0;
  for (let block = 1; block < SETTLE_BLOCKS; block++) {
    for (let channel = 0; channel < 2; channel++) {
      for (let frame = latency; frame < BLOCK_SIZE; frame++) {
        const expected = inputs[block][channel * BLOCK_SIZE + frame - latency];
        const actual = outputs[block][channel * BLOCK_SIZE + frame];
        assert.equal(actual, expected, `mx = 0 altered block ${block} frame ${frame}`);
        ++compared;
      }
    }
  }
  assert.ok(compared > 5000);
});

test('only a safety trim change clears the accumulated reduction', () => {
  const reference = createReference(LOUD_PARAMS);
  runSine(reference, SETTLE_BLOCKS);
  // Let the circuit ring down first: straight after the tone the model is still swinging past
  // full scale on its own, and a cleared reduction would re-engage inside the very next block.
  const engaged = runSilence(reference, SETTLE_BLOCKS);
  assert.ok(engaged < 1);

  const stepOneBlock = () => runSilence(reference, 1);

  // An unrelated control write recommits the whole parameter block every process call. Resetting
  // on the write, or on any changed field, would drop protection every time a knob is nudged.
  reference.setParameters({ og: 47 });
  assert.equal(stepOneBlock(), engaged, 'an output trim change cleared the reduction');
  reference.setParameters({ bi: 5 });
  assert.equal(stepOneBlock(), engaged, 'a bias change cleared the reduction');
  reference.setParameters({ ag: false });
  assert.equal(stepOneBlock(), engaged, 'toggling Auto Gain Reduction off cleared the reduction');
  reference.setParameters({ ag: true });
  assert.equal(stepOneBlock(), engaged, 'toggling Auto Gain Reduction on cleared the reduction');

  // Repeated identical commits are not edges either.
  reference.setParameters({ sg: 0 });
  assert.equal(stepOneBlock(), engaged, 'rewriting the same safety trim cleared the reduction');

  reference.setParameters({ sg: -3 });
  assert.equal(stepOneBlock(), 1, 'a safety trim change did not clear the reduction');
  const cleared = reference.safety();
  assert.equal(cleared.target, 1);
  assert.equal(cleared.remaining, 0);
});

test('a commit changing two or more values clears the reduction, one value does not', () => {
  const reference = createReference(LOUD_PARAMS);
  runSine(reference, SETTLE_BLOCKS);
  const engaged = runSilence(reference, SETTLE_BLOCKS);
  assert.ok(engaged < 1);

  // A control commits one key at a time, which is what keeps protection through a knob move.
  // Both writes below move values that sit outside the model - the output trim and the mix - so
  // the blocks that follow carry no circuit transient of their own that could re-engage the
  // detector and mask what the reset rule did.
  reference.setParameters({ og: 47 });
  assert.equal(runSilence(reference, 1), engaged, 'a single-value commit cleared the reduction');

  // A record write changes two or more at once. The safety trim it carries is the default 0 dB,
  // so the count - not the trim - is what has to catch it.
  reference.setParameters({ og: 46, mx: 99 });
  assert.equal(runSilence(reference, 1), 1, 'a multi-value commit did not clear the reduction');
});

test('applying a canonical preset lands on 0 dB of safety trim and clears the reduction', () => {
  const plugin = createPlugin();
  plugin.setParameters({ sg: -12 });
  assert.equal(plugin.sg, -12);

  const preset = plugin.constructor.getCanonicalPresets().find(
    candidate => candidate.params.sl !== '8');
  assert.ok(preset, 'no preset with a non-default assumed load to exercise');
  assert.equal(plugin.applyCanonicalPreset(preset.id), true);
  assert.equal(plugin.sg, 0, 'a preset must land on 0 dB of safety trim');
  // A preset carries the tap it was designed around, so the connected load follows it rather
  // than leaving the user with a mismatch nobody asked for.
  assert.equal(plugin.rl, Number(preset.params.sl),
    'a preset must land on a speaker matched to its assumed load');
  // Safety trim is not part of preset identity, so the dropdown still resolves to the preset.
  assert.equal(plugin._matchingCanonicalPresetId(), preset.id);

  // The engine sees a commit that differs in far more than two values, which is what clears the
  // accumulated reduction; the written sg of 0 dB would not, since 0 dB is the usual value.
  const reference = createReference(LOUD_PARAMS);
  runSine(reference, SETTLE_BLOCKS);
  assert.ok(runSilence(reference, SETTLE_BLOCKS) < 1);
  reference.setParameters({ ...preset.params, sg: 0 });
  assert.equal(runSilence(reference, 1), 1, 'a preset load did not clear the reduction');
});

test('the JavaScript reference and the shipped WASM agree on the reduction', async () => {
  const inputs = [];
  for (let index = 0; index < SETTLE_BLOCKS; index++) {
    inputs.push(sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, LOUD_AMPLITUDE));
  }

  const reference = createReference(LOUD_PARAMS);
  const referenceOutputs = inputs.map(
    block => new Float32Array(reference.processBlock(new Float32Array(block))));
  assert.ok(reference.safety().gain < 1, 'the reference never engaged');

  const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
  const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
  const binding = await instantiateDsp(wasmBytes);
  const shippedOutputs = [];
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, 32768), 0);
    const instance = binding.createInstance('TubeSimulatorPlugin');
    assert.notEqual(instance, 0);
    assert.equal(binding.instanceSetParams(instance, packer.pack(LOUD_PARAMS), packer.hash), 0);
    const arena = binding.getArenaViews();
    // The reference primes itself with one silent block, so the shipped kernel gets the same
    // leading block; otherwise the two runs would be compared 128 frames out of alignment.
    arena.combined.fill(0);
    assert.equal(
      binding.instanceProcess(instance, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
    for (const block of inputs) {
      arena.combined.set(block);
      assert.equal(
        binding.instanceProcess(instance, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
      shippedOutputs.push(new Float32Array(arena.combined.subarray(0, BLOCK_SIZE * 2)));
    }
  } finally {
    binding.close();
  }

  let worst = 0;
  for (let block = 0; block < SETTLE_BLOCKS; block++) {
    for (let index = 0; index < BLOCK_SIZE * 2; index++) {
      worst = Math.max(worst,
        Math.abs(referenceOutputs[block][index] - shippedOutputs[block][index]));
    }
  }
  assert.ok(worst < 1e-5, `reference and shipped WASM diverged by ${worst}`);

  // Both engines must land on the same reduction, not merely on similar audio.
  const referenceTail = tailRms(referenceOutputs, 20);
  const shippedTail = tailRms(shippedOutputs, 20);
  assert.ok(
    Math.abs(20 * Math.log10(referenceTail / shippedTail)) < 0.01,
    'the two engines settled on different reductions'
  );
});

test('the scalar and SIMD artifacts stay bit identical with the detector engaged', async () => {
  // The scalar mix runs in two passes so the stereo-linked detector can see both channels of a
  // frame at once, while the SIMD mix stays one pass. Every other artifact comparison runs at a
  // level where the detector never acts, which would leave that split unguarded.
  const scalar = await runShipped('effetune-dsp.wasm', LOUD_PARAMS, SETTLE_BLOCKS);
  const simd = await runShipped('effetune-dsp.simd.wasm', LOUD_PARAMS, SETTLE_BLOCKS);
  const frozen =
    await runShipped('effetune-dsp.wasm', { ...LOUD_PARAMS, ag: false }, SETTLE_BLOCKS);

  assert.ok(firstDivergentFrame(scalar, frozen) >= 0,
    'the comparison never engaged the detector, so nothing was proved');
  for (let block = 0; block < SETTLE_BLOCKS; block++) {
    assert.ok(exactFloat32(scalar[block], simd[block]),
      `scalar and SIMD diverged in block ${block}`);
  }
  assert.ok(detectionPeak(frozen.slice(-8)).peak > 1,
    'the frozen run never went past full scale');
  assert.ok(detectionPeak(scalar.slice(-8)).peak <= 1,
    'the engaged run still runs past full scale');
});

test('a numeric zero for Auto Gain Reduction means off in both engines', async () => {
  // Unreachable from the UI, which only ever writes booleans, but a parity case event may carry
  // "ag": 0. The kernel reads it out of a packed Float32 and tests it against zero, so a
  // reference that treated 0 as true would leave the two engines running different mechanisms.
  const reference = createReference(LOUD_PARAMS, SAMPLE_RATE, { ag: 0 });
  runSine(reference, SETTLE_BLOCKS);
  assert.equal(reference.safety().gain, 1, 'the reference treated a numeric 0 as enabled');

  const shipped = await runShipped('effetune-dsp.wasm', { ...LOUD_PARAMS, ag: 0 }, SETTLE_BLOCKS);
  assert.ok(detectionPeak(shipped.slice(-8)).peak > 1,
    'the shipped kernel treated a numeric 0 as enabled');
});

test('the Output Safety Trim control shows the total attenuation in force', () => {
  const plugin = createPlugin();
  assert.equal(plugin._effectiveSafetyTrimDb(), 0);

  plugin.latestTelemetry = { left: {}, right: {}, safetyReductionDb: -6.5 };
  assert.equal(plugin._effectiveSafetyTrimDb(), -6.5, 'the reduction is not shown on the control');
  plugin.setParameters({ sg: -3 });
  assert.equal(plugin._effectiveSafetyTrimDb(), -9.5);
  assert.equal(plugin.sg, -3, 'the reduction must not be written into the stored setting');

  // Only reachable past 48 dB of reduction; the HUD line still carries the true figure.
  plugin.latestTelemetry.safetyReductionDb = -60;
  assert.equal(plugin._effectiveSafetyTrimDb(), -63);
  plugin.latestTelemetry.safetyReductionDb = 4;
  assert.equal(plugin._effectiveSafetyTrimDb(), -3, 'a positive report must never raise the trim');
});

test('taking hold of the Output Safety Trim control adopts the displayed value', () => {
  const plugin = createPlugin();
  plugin.latestTelemetry = { left: {}, right: {}, safetyReductionDb: -6.5 };
  const displayed = plugin._effectiveSafetyTrimDb();

  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, displayed,
    'the stored setting did not adopt the displayed value, so the level would jump');

  // sg changed, so the engine clears the reduction; once it reports zero the displayed value is
  // unchanged, which is the whole point of adopting it.
  plugin.latestTelemetry.safetyReductionDb = 0;
  assert.equal(plugin._effectiveSafetyTrimDb(), displayed);

  const before = plugin.sg;
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, before, 'adopting again moved the setting');
});

test('telemetry does not repaint the Output Safety Trim control while it is held', () => {
  const plugin = createPlugin();
  const slider = { type: 'range', value: 0 };
  const number = { type: 'number', value: 0 };
  plugin._controls.sg = {
    kind: 'linear',
    row: {
      querySelector: selector => (selector.includes('range') ? slider : number)
    }
  };

  plugin.latestTelemetry = { left: {}, right: {}, safetyReductionDb: -6.5 };
  plugin._syncSafetyTrimControl();
  assert.equal(slider.value, -6.5);
  assert.equal(number.value, -6.5);

  plugin._safetyTrimFocused = true;
  plugin.latestTelemetry.safetyReductionDb = -12;
  plugin._syncSafetyTrimControl();
  assert.equal(slider.value, -6.5, 'telemetry moved the control out from under the user');

  plugin._safetyTrimFocused = false;
  plugin._syncSafetyTrimControl();
  assert.equal(slider.value, -12);
});

test('the reduction survives a model reset and a fault recovery', () => {
  // Neither a reset nor a fault rebuild is the user asking for the protection to be given up, so
  // both have to carry the accumulated reduction across. Without this, clearing it in the reset
  // path leaves every other test green.
  const reference = createReference(LOUD_PARAMS);
  runSine(reference, SETTLE_BLOCKS);
  const engaged = runSilence(reference, SETTLE_BLOCKS);
  assert.ok(engaged < 1, 'the reduction never engaged');

  // A model reset.
  reference.reset();
  assert.equal(reference.safety().gain, engaged, 'reset() gave back the reduction');
  assert.equal(reference.safety().target, engaged, 'reset() cleared the standing target');
  assert.equal(runSilence(reference, 1), engaged,
    'the reduction did not survive the first block after reset()');

  // A non-finite input latches the processing-safety fault and rebuilds the runtime baseline.
  const poisoned = new Float32Array(BLOCK_SIZE * 2);
  poisoned[0] = Number.NaN;
  reference.processBlock(poisoned);
  assert.equal(reference.safety().gain, engaged, 'fault recovery gave back the reduction');
  assert.equal(reference.safety().target, engaged, 'fault recovery cleared the standing target');
  assert.equal(runSilence(reference, 1), engaged,
    'the reduction did not survive the block after fault recovery');
});

// The speaker network the Power plant runs is the measured Phase C profile of the assumed load,
// scaled to the load actually connected by k = actual / assumed: resistances and inductances up by
// k, capacitance down by k. The two things that have to hold are that k == 1 is the identity - so
// every A0 record stays valid exactly where it was measured - and that k != 1 applies the scaling
// the right way round. Comparing two renders of the same parameters would establish neither, so
// the assertions below go at the coefficients the plant actually integrates and compare them
// against the unscaled profile they are derived from.
const POWER_LOAD_PARAMS = Object.freeze({
  dr: -12, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 9, mx: 100,
  iv: 2.828, nf: 0, os: 'Power', pt: 'EL34', pb: 470, kr: 270, st: '20',
  zp: '8.0', sl: '8', rl: 8, sg: 0, ag: false
});
// Every nominal tap the plug-in offers, together with an actual load of exactly half of it. Half
// keeps k a power of two, so the expected products and quotients below are exact in binary64 and
// the comparisons can stay bit-exact instead of retreating to a tolerance.
const SPEAKER_TAPS = Object.freeze(['4', '8', '15', '16']);

// The state the coefficients would take if the scaling were removed altogether: k is forced to one
// at the single point where it enters, which is the value the measured profile has just before it
// is scaled. Assertions against this build cannot be satisfied by a run that simply repeats
// itself.
const UNSCALED_SPEAKER_SOURCE = pluginSource.replace(
  'const scale = state.powerSpeakerScale;', 'const scale = 1;');

function powerOptFor(params, source = pluginSource) {
  return createReference(params, SAMPLE_RATE, {}, source).state();
}

test('an actual speaker load equal to the assumed load is bit identical to the measured profile',
  () => {
    assert.notEqual(UNSCALED_SPEAKER_SOURCE, pluginSource,
      'the unscaled control build must differ from the product build');

    for (const tap of SPEAKER_TAPS) {
      const matchedParams = { ...POWER_LOAD_PARAMS, sl: tap, rl: Number(tap) };
      const matched = powerOptFor(matchedParams);
      assert.equal(matched.powerSpeakerScale, 1, `k must be one on a matched ${tap} ohm tap`);

      // Against the Phase C table entry itself, for the quantities that enter the coefficients
      // unchanged. This is what "the design point is where it was measured" means.
      const profile = matched.powerSpeaker;
      assert.equal(profile.sl, tap, 'the engine selected the wrong speaker profile');
      assert.equal(matched.powerOpt.speakerLoadOhm, Number(profile.sl));
      assert.equal(matched.powerOpt.voiceResistanceOhm, profile.voiceResistanceOhm);
      assert.equal(matched.powerOpt.resonanceResistanceOhm, profile.resonanceResistanceOhm);

      // And against the build that never scales at all, for the whole coefficient set - which is
      // the only way to reach the reactive elements, since they enter as dt / L and dt / C.
      const unscaled = powerOptFor(matchedParams, UNSCALED_SPEAKER_SOURCE);
      const keys = Object.keys(matched.powerOpt);
      assert.ok(keys.length > 20, 'the coefficient set was not read');
      for (const key of keys) {
        assert.ok(Object.is(matched.powerOpt[key], unscaled.powerOpt[key]),
          `a matched ${tap} ohm load moved ${key}: ` +
          `${matched.powerOpt[key]} against the measured ${unscaled.powerOpt[key]}`);
      }
    }
  });

test('a mismatched actual speaker load scales R and L by k and C by 1 / k', () => {
  for (const tap of SPEAKER_TAPS) {
    const nominal = Number(tap);
    const matched = powerOptFor({ ...POWER_LOAD_PARAMS, sl: tap, rl: nominal }).powerOpt;
    const k = 0.5;
    const halved = powerOptFor({ ...POWER_LOAD_PARAMS, sl: tap, rl: nominal * k }).powerOpt;

    // The steps are dt / L and dt / C, so a resistance carries k directly while an inductance
    // shows up as a step divided by k and a capacitance as a step multiplied by it. Both are read
    // here rather than inferred, because "the value changed" would also be satisfied by scaling
    // the wrong element or by inverting k.
    assert.equal(halved.speakerLoadOhm, matched.speakerLoadOhm * k, `${tap} ohm load`);
    assert.equal(halved.voiceResistanceOhm, matched.voiceResistanceOhm * k, `${tap} ohm voice R`);
    assert.equal(halved.resonanceResistanceOhm, matched.resonanceResistanceOhm * k,
      `${tap} ohm resonance R`);
    for (const opt of [matched, halved]) {
      assert.equal(opt.voiceStepLimited, false, `${tap} ohm voice step hit its clamp`);
      assert.equal(opt.resonanceStepLimited, false, `${tap} ohm resonance step hit its clamp`);
    }
    assert.equal(halved.voiceStep, matched.voiceStep / k, `${tap} ohm voice L`);
    assert.equal(halved.resonanceStep, matched.resonanceStep / k, `${tap} ohm resonance L`);
    assert.equal(halved.speakerCapacitorStep, matched.speakerCapacitorStep * k,
      `${tap} ohm resonance C`);
  }

  // And the mismatch has to reach the audio: the plant moves, and it stays finite while it does.
  const render = params => {
    const reference = createReference(params, SAMPLE_RATE);
    const blocks = [];
    for (let index = 0; index < 16; index++) {
      blocks.push(new Float32Array(
        reference.processBlock(sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, 0.6))));
    }
    return blocks;
  };
  const design = render(POWER_LOAD_PARAMS);
  const halved = render({ ...POWER_LOAD_PARAMS, rl: 4 });
  let differing = 0;
  for (let block = 0; block < design.length; block++) {
    if (!exactFloat32(design[block], halved[block])) differing++;
  }
  assert.ok(differing > 0, 'halving the actual load left the plant unchanged');
  assert.ok(halved.every(block => block.every(Number.isFinite)),
    'a mismatched load produced a non-finite output');
});

test('the shipped kernel and the reference agree on a mismatched actual speaker load', async () => {
  // Measured at a modest drive. Far above it the Power plant is chaotically sensitive and the
  // two engines part company on rounding alone - at the untouched design point just as much as at
  // a mismatch - so a comparison up there would be measuring that, not the load scaling.
  const powerParams = {
    dr: -30, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 9, mx: 100,
    iv: 2.828, nf: 0, os: 'Power', pt: 'EL34', pb: 470, kr: 270, st: '20',
    zp: '8.0', sl: '8', rl: 3.5, sg: 0, ag: false
  };
  const blocks = 16;
  const reference = createReference(powerParams, SAMPLE_RATE);
  const referenceOutputs = [];
  for (let index = 0; index < blocks; index++) {
    referenceOutputs.push(new Float32Array(
      reference.processBlock(sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, 0.05))));
  }

  const wasmBytes = fs.readFileSync(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
  const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
  const binding = await instantiateDsp(wasmBytes);
  const shippedOutputs = [];
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, 32768), 0);
    const instance = binding.createInstance('TubeSimulatorPlugin');
    assert.equal(binding.instanceSetParams(instance, packer.pack(powerParams), packer.hash), 0);
    const arena = binding.getArenaViews();
    // The reference primes itself with one silent block; the shipped kernel gets the same.
    arena.combined.fill(0);
    assert.equal(binding.instanceProcess(instance, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
    for (let index = 0; index < blocks; index++) {
      arena.combined.set(sineBlock(index * BLOCK_SIZE, BLOCK_SIZE, 0.05));
      assert.equal(binding.instanceProcess(instance, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
      shippedOutputs.push(new Float32Array(arena.combined.subarray(0, BLOCK_SIZE * 2)));
    }
  } finally {
    binding.close();
  }

  let worst = 0;
  for (let block = 0; block < blocks; block++) {
    for (let index = 0; index < BLOCK_SIZE * 2; index++) {
      worst = Math.max(worst,
        Math.abs(referenceOutputs[block][index] - shippedOutputs[block][index]));
    }
  }
  assert.ok(worst < 1e-6, `reference and shipped WASM diverged by ${worst} on a mismatched load`);
});

test('adopting the effective trim twice in one interaction does not double the reduction', () => {
  // A real pointer interaction raises pointerdown and focus back to back and the worklet only
  // reports the cleared reduction a frame later, so a second adoption used to subtract the same
  // reduction again: 0 dB -> -6.5 dB -> -13 dB, dropping the level by the very amount the
  // mechanism exists to stop moving.
  const plugin = createPlugin();
  plugin.handleDspTubeTelemetry(telemetryFrame(-6.5));

  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -6.5);
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -6.5, 'the second adoption of one interaction moved the setting again');
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -6.5);

  // The commit takes a frame or two to reach the worklet, and telemetry runs at 60 Hz, so several
  // further frames still report the reduction that has already been folded in. None of them may
  // re-apply it. A gate keyed on the telemetry revision instead of on the reduction let the very
  // next frame through, so a second grab inside that window - a double click, or letting go and
  // taking hold again - landed on -13 dB.
  for (let frame = 1; frame <= 4; frame++) {
    plugin.handleDspTubeTelemetry(telemetryFrame(-6.5));
    plugin._adoptEffectiveSafetyTrim();
    assert.equal(plugin.sg, -6.5, `stale frame ${frame} re-applied the reduction`);
  }

  // Once the worklet reports the cleared reduction the block is released, so the same figure
  // accumulating again afterwards is a new reduction and is adopted rather than dropped.
  plugin.handleDspTubeTelemetry(telemetryFrame(0));
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -6.5, 'a cleared frame moved the setting on its own');
  plugin.handleDspTubeTelemetry(telemetryFrame(-6.5));
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -13,
    'a reduction that accumulated again after being cleared was not adopted');

  // A genuinely different reduction on a new frame is adopted on top of the current setting.
  plugin.handleDspTubeTelemetry(telemetryFrame(-2));
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -15);
});

test('the safety trim range reaches every reduction the detector realistically produces', () => {
  const plugin = createPlugin();
  plugin.latestTelemetry = { left: {}, right: {}, safetyReductionDb: -72 };
  plugin.latestTelemetryRevision = 1;
  // Clamping the display at -48 used to make adoption write a smaller trim than the reduction it
  // replaced, and the level jumped up by the 24 dB difference the moment the control was touched.
  assert.equal(plugin._effectiveSafetyTrimDb(), -72);
  plugin._adoptEffectiveSafetyTrim();
  assert.equal(plugin.sg, -72);

  // The clamp survives only as a last resort, and the HUD line still carries the true figure.
  plugin.latestTelemetryRevision = 2;
  plugin.latestTelemetry.safetyReductionDb = -120;
  assert.equal(plugin._effectiveSafetyTrimDb(), -96);
});
