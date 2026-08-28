import { AssetError, ValidationError } from './errors.js';

export const EFFECT_CHANNELS = Object.freeze([
  'all', 'stereo', 'left', 'right',
  '1', '2', '3', '4', '5', '6', '7', '8',
  '34', '56', '78'
]);

const COMMON_KEYS = new Set(['id', 'enabled', 'channel', 'assets', 'parameters']);
const CHANNEL_SET = new Set(EFFECT_CHANNELS);
const ASSET_NAMES_BY_EFFECT = new Map([
  ['FIRCrossover', ['impulseResponse']],
  ['FiveBandFIRPEQ', ['impulseResponse']],
  ['GroupDelayEQ', ['impulseResponse']],
  ['GroupDelayPEQ', ['impulseResponse']],
  ['IRReverb', ['impulseResponse']],
  ['RoomEQ', ['impulseResponse']]
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateId(id) {
  if (id === undefined) return undefined;
  if (typeof id !== 'string' || id.length < 1 || id.length > 128) {
    throw new ValidationError('Effect id must contain between 1 and 128 characters.');
  }
  return id;
}

export function validateChannel(channel = 'all') {
  if (!CHANNEL_SET.has(channel)) {
    throw new ValidationError(`Unsupported effect channel: ${String(channel)}`);
  }
  return channel;
}

export function validateParameterValue(effectType, definition, value) {
  const label = `${effectType}.${definition.name}`;
  const values = definition.count > 1 ? value : [value];
  if (definition.count > 1 &&
      (!Array.isArray(value) || value.length !== definition.count)) {
    throw new ValidationError(`${label} must contain exactly ${definition.count} values.`);
  }

  for (const item of values) {
    if (definition.type === 'number' || definition.type === 'integer') {
      if (typeof item !== 'number' || !Number.isFinite(item) ||
          (definition.type === 'integer' && !Number.isInteger(item))) {
        throw new ValidationError(`${label} must be ${definition.type === 'integer' ? 'an integer' : 'a finite number'}.`);
      }
      if (definition.minimum !== undefined && item < definition.minimum) {
        throw new ValidationError(`${label} must be at least ${definition.minimum}.`);
      }
      if (definition.maximum !== undefined && item > definition.maximum) {
        throw new ValidationError(`${label} must be at most ${definition.maximum}.`);
      }
    } else if (definition.type === 'string') {
      if (typeof item !== 'string') {
        throw new ValidationError(`${label} must be a string.`);
      }
      if (definition.maximumLength !== undefined && item.length > definition.maximumLength) {
        throw new ValidationError(
          `${label} must contain at most ${definition.maximumLength} characters.`
        );
      }
      if (definition.pattern !== undefined) {
        const match = new RegExp(definition.pattern, 'u').exec(item);
        if (match?.[0] !== item) {
          const example = typeof definition.default === 'string'
            ? ` (for example '${definition.default}')`
            : '';
          throw new ValidationError(
            `${label} has an invalid format; expected a string matching ${definition.pattern}${example}.`
          );
        }
      }
    } else if (definition.type === 'boolean' && typeof item !== 'boolean') {
      throw new ValidationError(`${label} must be a boolean.`);
    }
    if (definition.values && !definition.values.some(allowed => Object.is(allowed, item))) {
      throw new ValidationError(`${label} has an unsupported value.`);
    }
  }
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

export function canonicalizeProcessingParameters(effectType, parameters) {
  const canonical = { ...parameters };
  if (effectType === 'AutoFilter' &&
      canonical.minimumFrequency > canonical.maximumFrequency) {
    [canonical.minimumFrequency, canonical.maximumFrequency] =
      [canonical.maximumFrequency, canonical.minimumFrequency];
  } else if (effectType === 'Chorus' && canonical.depth > canonical.delay) {
    canonical.depth = canonical.delay;
  } else if (effectType === 'FrequencyShifter' &&
      canonical.minimumShift > canonical.maximumShift) {
    [canonical.minimumShift, canonical.maximumShift] =
      [canonical.maximumShift, canonical.minimumShift];
  } else if (effectType === 'MultibandCompressor' || effectType === 'MultibandExpander' ||
      effectType === 'MultibandBalance' || effectType === 'MultibandTransient' ||
      effectType === 'MultibandSaturation') {
    const count = effectType === 'MultibandTransient' || effectType === 'MultibandSaturation'
      ? 2 : 4;
    for (let index = 2; index <= count; index++) {
      const key = `frequency${index}`;
      const previous = canonical[`frequency${index - 1}`];
      if (canonical[key] < previous) canonical[key] = previous;
    }
  }
  return canonical;
}

function normalizeBaseAssets(effectType, assets) {
  const assetNames = ASSET_NAMES_BY_EFFECT.get(effectType);
  if (!assetNames) {
    if (assets !== undefined) throw new AssetError(`${effectType} does not accept external assets.`);
    return undefined;
  }
  if (!isRecord(assets)) {
    throw new AssetError(`${effectType} requires an assets object.`);
  }
  const allowed = new Set(assetNames);
  for (const name of Object.keys(assets)) {
    if (!allowed.has(name)) throw new AssetError(`${effectType} has no asset named ${name}.`);
  }
  const normalized = {};
  for (const name of assetNames) {
    const reference = assets[name];
    if (typeof reference !== 'string' || reference.length < 1 || reference.length > 128) {
      throw new AssetError(`${effectType}.${name} requires a non-empty asset reference.`);
    }
    normalized[name] = reference;
  }
  return Object.freeze(normalized);
}

function collectParameters(effectType, options) {
  const nested = options.parameters;
  if (nested !== undefined && !isRecord(nested)) {
    throw new ValidationError(`${effectType}.parameters must be an object.`);
  }
  if (nested !== undefined) {
    for (const key of Object.keys(options)) {
      if (!COMMON_KEYS.has(key)) {
        throw new ValidationError(`${effectType} cannot mix parameters with top-level parameter options.`);
      }
    }
  }
  const supplied = nested ?? options;
  const parameters = {};
  for (const key of Object.keys(supplied)) {
    if (nested === undefined && COMMON_KEYS.has(key)) continue;
    const value = supplied[key];
    parameters[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(parameters);
}

export class Effect {
  constructor(type, options = {}) {
    if (!isRecord(options)) throw new ValidationError(`${String(type)} options must be an object.`);
    const id = validateId(options.id);
    const enabled = options.enabled ?? true;
    if (typeof enabled !== 'boolean') {
      throw new ValidationError(`${type}.enabled must be boolean.`);
    }

    this.type = type;
    this.id = id;
    this.enabled = enabled;
    this.channel = validateChannel(options.channel ?? 'all');
    this.parameters = collectParameters(type, options);
    this.assets = normalizeBaseAssets(type, options.assets);
    Object.freeze(this);
  }

  toJSON() {
    return {
      ...(this.id === undefined ? {} : { id: this.id }),
      type: this.type,
      enabled: this.enabled,
      channel: this.channel,
      parameters: Object.fromEntries(
        Object.entries(this.parameters).map(([name, value]) => [
          name,
          Array.isArray(value) ? [...value] : value
        ])
      ),
      ...(this.assets === undefined ? {} : { assets: { ...this.assets } })
    };
  }
}
