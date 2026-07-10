import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { isMain, parseArgs, positiveInteger } from './cli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function artifactPath(variant) {
  if (variant === 'baseline') return path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm');
  if (variant === 'simd') return path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.simd.wasm');
  throw new Error('--variant must be baseline or simd');
}

export async function runTelemetrySoak({
  variant = 'baseline',
  seconds = 600,
  sampleRate = 192000,
  channels = 2,
  instanceCount = 4,
  blockFrames = 128,
  telemetryRate = 60,
  ringBytes = 256 * 1024,
  log = console.log
} = {}) {
  const wasm = fs.readFileSync(artifactPath(variant));
  const binding = await instantiateDsp(wasm);
  const started = performance.now();
  try {
    if (!binding.createEngine()) throw new Error('engine creation failed');
    const prepareStatus = binding.prepare(sampleRate, channels, blockFrames, ringBytes);
    if (prepareStatus !== 0) throw new Error(`engine prepare failed with status ${prepareStatus}`);
    const rateStatus = binding.setTelemetryRate(telemetryRate);
    if (rateStatus !== 0) throw new Error(`telemetry rate failed with status ${rateStatus}`);

    const instanceIds = [];
    const nextSequence = new Map();
    for (let index = 0; index < instanceCount; index++) {
      const instanceId = binding.createInstance('LevelMeterPlugin');
      if (!instanceId) throw new Error(`LevelMeter instance ${index} creation failed`);
      const tapId = index + 1;
      const tapStatus = binding.instanceSetTap(instanceId, tapId);
      if (tapStatus !== 0) throw new Error(`tap ${tapId} setup failed with status ${tapStatus}`);
      instanceIds.push(instanceId);
      nextSequence.set(tapId, 0);
    }

    const arena = binding.getArenaViews();
    const sampleCount = channels * blockFrames;
    for (let index = 0; index < sampleCount; index++) {
      arena.combined[index] = index < blockFrames ? 0.5 : -0.25;
    }

    const packet = new ArrayBuffer(ringBytes);
    const quantumCount = Math.ceil(seconds * sampleRate / blockFrames);
    let frameCount = 0;
    let droppedFrames = 0;
    for (let quantum = 0; quantum < quantumCount; quantum++) {
      const timeSeconds = quantum * blockFrames / sampleRate;
      for (const instanceId of instanceIds) {
        const status = binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          channels,
          blockFrames,
          timeSeconds
        );
        if (status !== 0) throw new Error(`instance process failed with status ${status}`);
      }

      const bytes = binding.telemetryRead(packet);
      droppedFrames += binding.lastTelemetryDroppedFrames;
      if (bytes === 0) continue;
      const parsed = parseTelemetryPacket(packet, bytes, frame => {
        if (frame.frameType !== TelemetryFrameType.TAP_LEVEL || frame.formatVersion !== 1) {
          throw new Error(`unexpected telemetry frame ${frame.frameType}/v${frame.formatVersion}`);
        }
        const expectedSequence = nextSequence.get(frame.tapId);
        if (expectedSequence === undefined || frame.sequence !== expectedSequence) {
          throw new Error(
            `tap ${frame.tapId} sequence ${frame.sequence}, expected ${expectedSequence}`
          );
        }
        if (frame.payload.getUint32(0, true) !== channels) {
          throw new Error(`tap ${frame.tapId} reported the wrong channel count`);
        }
        nextSequence.set(frame.tapId, expectedSequence + 1);
        frameCount++;
      });
      if (!parsed.ok) throw new Error(`malformed telemetry packet: ${parsed.error}`);
    }

    const processedFrames = quantumCount * blockFrames;
    const expectedPerTap = Math.floor(processedFrames / (sampleRate / telemetryRate));
    const expectedFrames = expectedPerTap * instanceCount;
    if (frameCount !== expectedFrames) {
      throw new Error(`received ${frameCount} frames, expected ${expectedFrames}`);
    }
    if (droppedFrames !== 0) throw new Error(`telemetry core dropped ${droppedFrames} frames`);

    const elapsedSeconds = (performance.now() - started) / 1000;
    const result = {
      variant,
      simulatedSeconds: processedFrames / sampleRate,
      sampleRate,
      channels,
      instanceCount,
      quantumCount,
      frameCount,
      droppedFrames,
      elapsedSeconds
    };
    log(
      `${variant}: ${result.simulatedSeconds.toFixed(3)} s, ${quantumCount} quanta, ` +
      `${frameCount} frames, 0 drops in ${elapsedSeconds.toFixed(3)} s`
    );
    return result;
  } finally {
    binding.close();
  }
}

export async function runTelemetrySoakCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'Usage: node tools/dsp-parity/telemetry-soak.mjs [--variant baseline|simd] ' +
      '[--seconds 600] [--sample-rate 192000] [--channels 2] [--instances 4]'
    );
    return null;
  }
  return runTelemetrySoak({
    variant: args.variant ?? 'baseline',
    seconds: positiveInteger(args.seconds, 'seconds', 600),
    sampleRate: positiveInteger(args['sample-rate'], 'sample-rate', 192000),
    channels: positiveInteger(args.channels, 'channels', 2),
    instanceCount: positiveInteger(args.instances, 'instances', 4)
  });
}

if (isMain(import.meta.url)) {
  runTelemetrySoakCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
