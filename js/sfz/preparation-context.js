import { midiMinimumPhysicalBpm } from '../midi/smf-scheduler.js';
import { sfzError } from './parser.js';
import { getPluginExecutionChannelMode } from '../audio/plugin-execution-capabilities.js';

export function sfzPlayerKind(typeName) {
  if (typeName === 'SFZNotePlayerPlugin') return 0;
  if (typeName === 'SoundFontPlayerPlugin') return 1;
  throw sfzError('prepare', 'The instrument player is unavailable. Reload the app and try again.');
}

export function sfzPluginPreparationContext(plugin, { outputChannelCount, ...context }) {
  const mode = getPluginExecutionChannelMode(plugin.channel, outputChannelCount);
  if (!mode) throw sfzError('prepare', 'The instrument channel selection is unavailable in these audio settings.');
  return sfzPreparationContext({ ...context,
    processingChannels: mode === 'all' ? outputChannelCount : mode === 'single' || mode === 'mono' ? 1 : 2 });
}

export function sfzPreparationContext({ sampleRate, processingChannels, maxFrames, timeline = null,
  minimumPhysicalBpm = null, playerKind = 0 } = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isInteger(processingChannels) || processingChannels < 1 || processingChannels > 16 ||
      !Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 0xffffffff ||
      (playerKind !== 0 && playerKind !== 1)) {
    throw sfzError('prepare', 'The instrument audio configuration is unavailable. Try again after changing audio settings.');
  }
  if (minimumPhysicalBpm === null) {
    minimumPhysicalBpm = midiMinimumPhysicalBpm(timeline);
  }
  if (!Number.isFinite(minimumPhysicalBpm) || minimumPhysicalBpm < 0) {
    throw sfzError('prepare', 'The instrument tempo configuration could not be prepared.');
  }
  return Object.freeze({ sampleRate, processingChannels, maxFrames, minimumPhysicalBpm, playerKind });
}

export function sameSfzPreparationGeometry(left, right) {
  return !!left && !!right && left.sampleRate === right.sampleRate &&
    left.processingChannels === right.processingChannels && left.maxFrames === right.maxFrames &&
    left.playerKind === right.playerKind;
}

export function sfzPreparationContextKey(context) {
  const value = sfzPreparationContext(context);
  return [value.sampleRate, value.processingChannels, value.maxFrames, value.minimumPhysicalBpm, value.playerKind].join(':');
}

// A cost query and allocation use the same native geometry. In particular the
// native helper alone resolves the standalone tempo policy and delay rounding.
export async function materializeSfzAsset(descriptor, context, maxBytes, estimateEffectBytes) {
  if (typeof estimateEffectBytes !== 'function') throw sfzError('prepare', 'Instrument effect preparation is unavailable. Reload the app and try again.');
  const prepared = sfzPreparationContext(context);
  const nativeBytes = await estimateEffectBytes(descriptor.payload, prepared, descriptor.formatTag ?? 1);
  const footprintBytes = descriptor.payload.byteLength + nativeBytes;
  if (!Number.isSafeInteger(nativeBytes) || nativeBytes < 0 ||
      !Number.isSafeInteger(footprintBytes) || footprintBytes > maxBytes) {
    throw sfzError('too-large', 'The instrument needs more memory for these audio settings. Increase the SoundFont size limit or choose another instrument.');
  }
  const covered = sameSfzPreparationGeometry(descriptor.preparationContext, prepared) &&
    nativeBytes <= (descriptor.nativePreparationBytes ?? -1) && descriptor.footprintBytes <= maxBytes;
  if (covered) return descriptor;
  return { ...descriptor, processingChannels: prepared.processingChannels,
    footprintBytes, preparationContext: prepared, nativePreparationBytes: nativeBytes };
}

export async function prepareSfzAssetForContext(descriptor, context, maxBytes, estimateEffectBytes) {
  return descriptor.materializeForContext
    ? descriptor.materializeForContext(context, maxBytes, estimateEffectBytes)
    : materializeSfzAsset(descriptor, context, maxBytes, estimateEffectBytes);
}
