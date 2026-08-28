import { DSP_PARAM_PACKERS } from './internal/dsp-params.generated.js';
import { getEffectDefinition, getEffectImplementation } from './catalog.js';
import {
  Effect, canonicalizeProcessingParameters, validateChannel, validateParameterValue
} from './effect.js';
import {
  AssetError,
  EffeTuneError,
  EffectError,
  ValidationError,
  withValidationDetail
} from './errors.js';

const DOCUMENT_KEYS = new Set(['version', 'chain']);
const EFFECT_KEYS = new Set(['id', 'type', 'enabled', 'channel', 'parameters', 'assets']);
const STREAM_RECONFIGURATION_PARAMETERS = new Map([
  ['FIRCrossover', new Set(['bandCount', 'latencyMode', 'filterDelaySamples'])],
  ['FiveBandFIRPEQ', new Set(['latencyMode', 'filterDelaySamples'])],
  ['GroupDelayEQ', new Set(['latencyMode', 'filterDelaySamples'])],
  ['GroupDelayPEQ', new Set(['latencyMode', 'filterDelaySamples'])],
  ['IRReverb', new Set(['channelMode', 'latency', 'convolutionRate'])],
  ['RoomEQ', new Set(['latencyMode', 'filterDelaySamples'])]
]);

// App preset envelopes are recognized here rather than in the preset parser so that
// every entry point into the semantic chain document (parsePreset, createChain and
// the AudioWorklet loader) reports the same guidance instead of a generic
// "unsupported field" complaint. The Python binding keeps the same detection in
// effetune.presets.load_preset_document.
const LEGACY_ENVELOPE_KEYS_V1 = ['pipeline', 'plugins'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectAppPresetEnvelope(input) {
  if (!isRecord(input)) return;
  const envelopes = LEGACY_ENVELOPE_KEYS_V1.filter(key => Object.hasOwn(input, key));
  if (envelopes.length === 0) return;
  throw new ValidationError(
    `Preset contains the EffeTune app preset field(s): ${envelopes.join(', ')}; ` +
    'this is an app preset rather than a semantic chain document. ' +
    'Import it with importLegacyPreset().'
  );
}

function cloneEffect(effect) {
  return {
    id: effect.id,
    type: effect.type,
    enabled: effect.enabled,
    channel: effect.channel,
    parameters: Object.fromEntries(
      Object.entries(effect.parameters).map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value
      ])
    ),
    ...(effect.assets === undefined ? {} : { assets: { ...effect.assets } })
  };
}

function fromPlainEffect(value, index, label = `Chain entry ${index}`) {
  if (!isRecord(value)) throw new ValidationError(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!EFFECT_KEYS.has(key)) {
      throw new ValidationError(`${label} has an unsupported field: ${key}`);
    }
  }
  if (typeof value.type !== 'string') {
    throw new ValidationError(`${label} requires an effect type.`);
  }
  if (!isRecord(value.parameters)) {
    throw new ValidationError(`${label} requires a parameters object.`);
  }
  let definition;
  try {
    definition = getEffectDefinition(value.type);
  } catch (error) {
    throw withValidationDetail(error, { kind: 'type' });
  }
  const id = value.id;
  if (id !== undefined &&
      (typeof id !== 'string' || id.length < 1 || id.length > 128)) {
    throw new ValidationError(`${label} has an invalid effect id.`);
  }
  const enabled = value.enabled ?? true;
  if (typeof enabled !== 'boolean') {
    throw new ValidationError(`${label} enabled must be boolean.`);
  }
  let channel;
  try {
    channel = validateChannel(value.channel ?? 'all');
  } catch (error) {
    throw withValidationDetail(error, { kind: 'channel' });
  }
  const parameterByName = new Map(definition.parameters.map(parameter => [parameter.name, parameter]));
  for (const key of Object.keys(value.parameters)) {
    if (!parameterByName.has(key)) {
      throw withValidationDetail(
        new ValidationError(`Unknown parameter ${value.type}.${key}.`),
        { kind: 'parameter', parameter: key }
      );
    }
  }
  const parameters = {};
  for (const parameter of definition.parameters) {
    const supplied = Object.hasOwn(value.parameters, parameter.name)
      ? value.parameters[parameter.name]
      : parameter.default;
    try {
      parameters[parameter.name] = validateParameterValue(value.type, parameter, supplied);
    } catch (error) {
      throw withValidationDetail(error, { kind: 'parameter', parameter: parameter.name });
    }
  }
  const declaredAssets = definition.assets ?? [];
  let assets;
  try {
    if (declaredAssets.length === 0) {
      if (value.assets !== undefined) throw new AssetError(`${value.type} does not accept external assets.`);
    } else {
      if (!isRecord(value.assets)) throw new AssetError(`${value.type} requires an assets object.`);
      const allowed = new Set(declaredAssets.map(asset => asset.name));
      for (const name of Object.keys(value.assets)) {
        if (!allowed.has(name)) throw new AssetError(`${value.type} has no asset named ${name}.`);
      }
      assets = {};
      for (const asset of declaredAssets) {
        const reference = value.assets[asset.name];
        if (asset.required && (typeof reference !== 'string' || reference.length < 1 || reference.length > 128)) {
          throw new AssetError(`${value.type}.${asset.name} requires a non-empty asset reference.`);
        }
        if (reference !== undefined) assets[asset.name] = reference;
      }
    }
  } catch (error) {
    throw withValidationDetail(error, { kind: 'assets' });
  }
  return { id, type: value.type, enabled, channel, parameters, ...(assets ? { assets } : {}) };
}

function assignIds(effects) {
  const explicit = new Set();
  for (const effect of effects) {
    if (effect.id === undefined) continue;
    if (explicit.has(effect.id)) {
      throw new ValidationError(`Duplicate effect id: ${effect.id}`);
    }
    explicit.add(effect.id);
  }
  const counters = new Map();
  return effects.map(effect => {
    if (effect.id !== undefined) return effect;
    let count = counters.get(effect.type) ?? 0;
    let id;
    do {
      count += 1;
      id = `${effect.type}#${count}`;
    } while (explicit.has(id));
    counters.set(effect.type, count);
    explicit.add(id);
    return { ...effect, id };
  });
}

export function normalizeChainDocument(input, { entryLabel } = {}) {
  let entries;
  if (Array.isArray(input)) {
    entries = input;
  } else {
    rejectAppPresetEnvelope(input);
    if (!isRecord(input)) throw new ValidationError('A chain must be an array or a v1 chain document.');
    for (const key of Object.keys(input)) {
      if (!DOCUMENT_KEYS.has(key)) throw new ValidationError(`Unsupported chain document field: ${key}`);
    }
    if (input.version !== 1) throw new ValidationError('Only chain document version 1 is supported.');
    if (!Array.isArray(input.chain)) throw new ValidationError('Chain document chain must be an array.');
    entries = input.chain;
  }
  const effects = entries.map((entry, index) =>
    fromPlainEffect(
      entry instanceof Effect ? entry.toJSON() : entry,
      index,
      entryLabel ?? `Chain entry ${index}`
    )
  );
  return {
    version: 1,
    chain: assignIds(effects).map(cloneEffect)
  };
}

export function validateSeed(seed = 0) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new ValidationError('seed must be an integer from 0 to 4294967295.');
  }
  return seed >>> 0;
}

export function validateSampleRate(sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff) {
    throw new ValidationError('sampleRate must be a positive 32-bit integer.');
  }
  return sampleRate;
}

export function validateEffectSampleRate(effect, sampleRate) {
  const definition = getEffectDefinition(effect.type);
  if (definition.sampleRates && !definition.sampleRates.includes(sampleRate)) {
    throw new ValidationError(`${effect.type} does not support a sample rate of ${sampleRate} Hz.`);
  }
}

function toInternalValue(transform, value) {
  switch (transform?.kind ?? 'identity') {
    case 'identity':
      return value;
    case 'naturalLog':
      return Math.log(value);
    case 'log10':
      return Math.log10(value);
    case 'decibelsFromReference':
      return 20 * Math.log10(value / transform.reference);
    case 'map': {
      const mapping = transform.values.find(entry => Object.is(entry.public, value));
      if (!mapping) throw new ValidationError('A semantic parameter mapping is unavailable.');
      return mapping.internal;
    }
    default:
      throw new EffectError(`Unsupported semantic transform: ${String(transform?.kind)}`);
  }
}

export function packEffect(effect) {
  const parameters = canonicalizeProcessingParameters(effect.type, effect.parameters);
  const implementation = getEffectImplementation(effect.type);
  const packer = DSP_PARAM_PACKERS.get(implementation.internalType);
  if (!packer || (packer.hash >>> 0) !== (implementation.layoutHash >>> 0)) {
    throw new EffectError(`${effect.type} is incompatible with the packaged DSP artifact.`);
  }
  const internal = {};
  for (const mapping of implementation.packedParameters) {
    const value = parameters[mapping.publicName];
    if (mapping.count === 1) {
      internal[mapping.keys[0]] = toInternalValue(mapping.transform, value);
    } else {
      for (let index = 0; index < mapping.count; index++) {
        internal[mapping.keys[index]] = toInternalValue(mapping.transform, value[index]);
      }
    }
  }
  const structured = implementation.structuredParameter;
  if (structured) {
    internal[structured.key] = parameters[structured.publicName];
  }
  // The generated packer reports capacity limits with plain JavaScript errors.
  // Translating them here keeps every public entry point (process, stream, setParam)
  // inside the documented error taxonomy, matching the Python binding which already
  // raises ValidationError for the same input.
  let bytes;
  if (structured) {
    try {
      bytes = packer.packBytes?.(internal);
    } catch (error) {
      if (error instanceof EffeTuneError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new ValidationError(
        `${effect.type}.${structured.publicName} cannot be packed: ${detail}`,
        { cause: error }
      );
    }
  }
  if (structured && !(bytes instanceof Uint8Array)) {
    throw new EffectError(`${effect.type} structured parameters are unavailable.`);
  }
  return {
    internalType: implementation.internalType,
    hash: implementation.layoutHash >>> 0,
    values: packer.pack(internal),
    ...(bytes ? { bytes } : {})
  };
}

export function setEffectParameter(effect, parameterName, value) {
  const definition = getEffectDefinition(effect.type);
  const parameter = definition.parameters.find(entry => entry.name === parameterName);
  if (!parameter) {
    throw withValidationDetail(
      new ValidationError(`Unknown parameter ${effect.type}.${parameterName}.`),
      { kind: 'parameter', parameter: parameterName }
    );
  }
  let validated;
  try {
    validated = validateParameterValue(effect.type, parameter, value);
  } catch (error) {
    throw withValidationDetail(error, { kind: 'parameter', parameter: parameterName });
  }
  return {
    ...cloneEffect(effect),
    parameters: { ...effect.parameters, [parameterName]: validated }
  };
}

export function canonicalizeEffectForProcessing(effect) {
  const canonical = cloneEffect(effect);
  canonical.parameters = canonicalizeProcessingParameters(effect.type, canonical.parameters);
  return canonical;
}

export function validateStreamParameterUpdate(effect, parameterName) {
  if (STREAM_RECONFIGURATION_PARAMETERS.get(effect.type)?.has(parameterName)) {
    throw new ValidationError(
      `${effect.type}.${parameterName} cannot be updated while a stream is open; ` +
      'create a new stream with the updated effect.'
    );
  }
}

export function channelRange(channel, channelCount) {
  validateChannel(channel);
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 16) {
    throw new ValidationError('Audio must contain between 1 and 16 channels.');
  }
  if (channel === 'all') return { start: 0, count: channelCount };
  if (channel === 'stereo') return { start: 0, count: channelCount >= 2 ? 2 : 1 };
  if (channel === 'left') return { start: 0, count: 1 };
  if (channel === 'right') {
    if (channelCount < 2) throw new ValidationError('The right channel is unavailable in mono audio.');
    return { start: 1, count: 1 };
  }
  const pairStart = { '34': 2, '56': 4, '78': 6, '910': 8, '1112': 10, '1314': 12, '1516': 14 }[channel];
  if (pairStart !== undefined) {
    const start = pairStart;
    if (channelCount < start + 2) {
      throw new ValidationError(`Channel pair ${channel} is unavailable in ${channelCount}-channel audio.`);
    }
    return { start, count: 2 };
  }
  const start = Number(channel) - 1;
  if (channelCount <= start) {
    throw new ValidationError(`Channel ${channel} is unavailable in ${channelCount}-channel audio.`);
  }
  return { start, count: 1 };
}

export function channelToEngine(channel) {
  if (channel === 'all') return 'A';
  if (channel === 'stereo') return null;
  if (channel === 'left') return 'L';
  if (channel === 'right') return 'R';
  return channel;
}

export function requireResolvedAsset(effect, resolvedAssets) {
  if (effect.assets === undefined) return null;
  const asset = resolvedAssets?.get(effect.id)?.impulseResponse;
  if (!asset) throw new AssetError(`${effect.id} is missing its impulseResponse asset.`);
  return asset;
}
