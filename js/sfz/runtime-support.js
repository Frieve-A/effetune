import { SFZ_MOD_KINDS as K } from './modulation-schema.js';
import { SFZ_EFFECT_TYPES as E } from './effects.js';

// These profile consumers have matching native preparation and audio coverage.
// Keep an explicit list so future compiler kinds do not become supported silently.
const completedKinds = new Set([K.SamplePlayback, K.Lifecycle, K.ReleaseDecaySegment,
  K.VoiceDSP, K.NoiseLayer, K.ReverseController, K.ControllerCondition,
  K.ControllerStart, K.ControllerStop, K.TempoCondition, K.TimerCondition, K.Equalizer, K.Variable]);
const completedEffects = new Set([E.apan, E.comp, E.delay, E.disto, E.eq, E.filter,
  E.fverb, E.gate, E.limiter, E.lofi, E.phaser, E.static, E.strings, E.tdfir, E.chorus, E.gain, E.rectify]);

export function sfzRuntimeLimitations(modulation, effects) {
  const limitations = new Set();
  if (effects && (effects.version !== 1 || !Array.isArray(effects.nodes) ||
      effects.nodes.some(node => !completedEffects.has(node.type)))) limitations.add('effects');
  if (!modulation || ![3, 4].includes(modulation.version)) return [...limitations];
  for (const region of modulation.regions) {
    for (const instance of region.instances) {
      if (instance.kind <= K.Oscillator || instance.kind === K.InitialController ||
          instance.kind >= K.Amplifier && instance.kind <= K.Crossfade ||
          completedKinds.has(instance.kind)) continue;
      limitations.add(`kind:${instance.kind}`);
    }
  }
  return [...limitations];
}

export function requireSfzRuntimeSupport(descriptor) {
  if (!descriptor?.unsupportedRuntime?.length) return;
  const error = new Error('This instrument uses features that are not available in this version. Choose another SoundFont.');
  error.code = 'unsupported-runtime';
  error.features = descriptor.unsupportedRuntime;
  throw error;
}
