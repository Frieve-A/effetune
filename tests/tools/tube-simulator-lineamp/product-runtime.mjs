// Reconstructed 2026-08-16. The original product-runtime.mjs (isolated out of the
// tree on 2026-08-06) is unrecoverable: neither the commit history nor the git
// object store carries a blob that defines createJavascriptReferenceSession, and
// the reference processor source it was pinned against (sha256 57d66440...) is
// equally lost. This version therefore drives the CURRENT JavaScript reference
// (plugins/saturation/tube_simulator.js) through the tracked parity host
// (tools/dsp-parity/node-host.mjs::loadReferencePlugin) and reaches the
// diagnostic hooks the reference state publishes (state.beginBreakLoopImpulse /
// state.breakLoopImpulse / state.reset / state.checkpoint / state.endDiagnostic).
//
// API contract, derived from the sole consumer
// (measure-phase-b-break-loop.mjs, restored from dangling blob 2a7ce521...):
//
//   const session = await createJavascriptReferenceSession({
//     sampleRate,          // host rate; must have a Tube Simulator rate config
//     params,              // short-key parameter record ({ dr, tp, bi, ... })
//     pluginSourcePath     // optional; must resolve to the tracked plugin file
//   });
//   session.reset();                                        // full model reset
//   session.beginBreakLoopImpulse({ amplitude, captureSamples });
//   session.processSilence(hostFrames);                     // synchronous
//   session.breakLoopImpulse();  // { amplitude, captureSamples, sample,
//                                //   detectorResponse[], outputResponse[] }
//   session.checkpoint();        // full reference checkpoint; the consumer reads
//                                //   maximumFastKclResidual,
//                                //   maximumSlowKclResidual, maximumDcResidual,
//                                //   finiteFaults, safetyLimits
//
// The processor receives the caller's parameter record as-is (plus the harness
// plumbing fields), NOT the plugin instance's getParameters() snapshot. The
// frozen tube-line-break-loop-v2 artifact was measured before the output-stage
// selector existed, and the reference decoder resolves every absent key through
// its own defaults ('os' ?? 'Line', ...), so passing the record through untouched
// keeps the measured branch the Line NFB loop the v2 contract describes.
//
// reset() is verified, not assumed. The reference implements state.reset() as a
// no-op while its runtime fault latch is engaged (runtimeEvent.latched !== 0), so
// a latched session would silently keep the previous run's state. The consumer
// takes a central difference between a +A and a -A capture and is only valid when
// both start from the same fresh state, so reset() here re-reads the checkpoint
// and throws instead of returning a session that measures residue.
//
// Provenance warning: the manifests under
// tests/fixtures/tube-simulator/lineamp-v1/manifests/ record this path with
// sha256 e278300b05177aa6a84ce34e7cc9b923410aa6932f8b561dec291824fa548db4. That
// is the ORIGINAL file's hash. This file is the 2026-08-16 reconstruction and is
// a different artifact; its hash will never match the manifest entry, and the
// manifests are frozen and must not be rewritten to match it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadReferencePlugin } from '../../../tools/dsp-parity/node-host.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '..', '..', '..');

const PLUGIN_TYPE = 'TubeSimulatorPlugin';
const CHANNELS = 2;
const DEFAULT_BLOCK_SIZE = 128;

// The reference processor is deterministic and never draws randomness, but the
// sandbox still gets a seeded generator so that any future accidental
// Math.random() use cannot silently break run-to-run determinism.
function seededRandom(seed) {
  let state = seed >>> 0 || 0x74756265;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export async function createJavascriptReferenceSession({
  sampleRate,
  params = {},
  pluginSourcePath = null,
  blockSize = DEFAULT_BLOCK_SIZE,
  repoRoot = defaultRepoRoot,
  quiet = true
} = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Reference session sample rate ${sampleRate} is invalid`);
  }
  if (!Number.isInteger(blockSize) || blockSize < 1) {
    throw new Error(`Reference session block size ${blockSize} is invalid`);
  }
  const loaded = await loadReferencePlugin(PLUGIN_TYPE, { repoRoot, quiet });
  const trackedPluginPath = path.join(
    repoRoot,
    'plugins',
    `${loaded.definition.path}.js`
  );
  if (pluginSourcePath &&
      path.resolve(pluginSourcePath) !== path.resolve(trackedPluginPath)) {
    throw new Error(
      `Reference session loads ${trackedPluginPath}; ` +
      `it cannot honour pluginSourcePath ${pluginSourcePath}`
    );
  }
  loaded.sandbox.Math.random = seededRandom(0x74756265);
  let plugin;
  try {
    plugin = new loaded.PluginClass();
    plugin.id = `tube-lineamp-${loaded.definition.type}`;
  } catch (error) {
    throw new Error(
      `Failed to construct JS reference ${loaded.definition.type}: ` +
      `${error.message}`,
      { cause: error }
    );
  }
  if (typeof plugin.executeProcessor !== 'function' ||
      !plugin.compiledFunction) {
    throw new Error(
      `JS reference ${loaded.definition.type} did not register ` +
      'an executable processor'
    );
  }
  const baseParameters = Object.freeze({ ...params });
  const context = {};
  let processedHostFrames = 0;
  const processBlock = blockFrames => {
    const parameters = {
      ...baseParameters,
      type: loaded.definition.type,
      enabled: true,
      fr: true,
      channel: null,
      channelCount: CHANNELS,
      blockSize: blockFrames,
      sampleRate
    };
    const data = new Float32Array(CHANNELS * blockFrames);
    const errorsBefore = loaded.sandbox.errors.length;
    plugin.executeProcessor(
      context,
      data,
      parameters,
      processedHostFrames / sampleRate
    );
    if (loaded.sandbox.errors.length > errorsBefore) {
      throw new Error(
        `JS reference ${loaded.definition.type} reported: ` +
        `${loaded.sandbox.errors.at(-1)}`
      );
    }
    processedHostFrames += blockFrames;
  };
  // Prime one block so the processor builds its state record and publishes the
  // diagnostic hooks; the priming frames are discarded by the reset below.
  processBlock(blockSize);
  const state = context.__tubeSimulatorReferenceV1;
  if (!state) {
    throw new Error(
      'Tube Simulator reference rejected the session configuration ' +
      `(sampleRate ${sampleRate}, params ${JSON.stringify(baseParameters)})`
    );
  }
  for (const hook of [
    'reset',
    'beginBreakLoopImpulse',
    'breakLoopImpulse',
    'checkpoint',
    'endDiagnostic'
  ]) {
    if (typeof state[hook] !== 'function') {
      throw new Error(
        `Tube Simulator reference state does not publish ${hook}()`
      );
    }
  }
  // state.reset() is a no-op while the runtime fault latch is engaged, which
  // would leave the caller measuring the previous capture's residual state.
  // checkpoint().runtimeEvent is [generation, latched, cause].
  const assertResetTookEffect = () => {
    const runtimeEvent = state.checkpoint().runtimeEvent;
    if (runtimeEvent[1] !== 0) {
      throw new Error(
        'Tube Simulator reference ignored reset(): the runtime fault latch is ' +
        `engaged (latched ${runtimeEvent[1]}, cause ${runtimeEvent[2]}, ` +
        `generation ${runtimeEvent[0]}). The model still holds the previous ` +
        'run state, so any measurement taken from it is invalid.'
      );
    }
  };
  state.reset();
  assertResetTookEffect();
  return {
    sampleRate,
    blockSize,
    pluginSourcePath: trackedPluginPath,
    jsEngineHash: loaded.jsEngineHash,
    baseSourceHash: loaded.baseSourceHash,
    reset() {
      state.reset();
      assertResetTookEffect();
    },
    beginBreakLoopImpulse({ amplitude, captureSamples }) {
      state.beginBreakLoopImpulse(amplitude, captureSamples);
    },
    processSilence(hostFrames) {
      if (!Number.isInteger(hostFrames) || hostFrames < 0) {
        throw new Error(
          `Reference session cannot process ${hostFrames} host frames`
        );
      }
      let remaining = hostFrames;
      while (remaining > 0) {
        const blockFrames = remaining < blockSize ? remaining : blockSize;
        processBlock(blockFrames);
        remaining -= blockFrames;
      }
    },
    breakLoopImpulse() {
      return state.breakLoopImpulse();
    },
    endDiagnostic() {
      state.endDiagnostic();
    },
    checkpoint() {
      return state.checkpoint();
    }
  };
}
