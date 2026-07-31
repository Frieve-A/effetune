import * as generated from './generated-effects.js';
import { EffectError } from './errors.js';

let publicCatalog;
let publicByType;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function metadata() {
  const value = generated.EFFECT_METADATA;
  if (!value || value.version !== 1 || !Array.isArray(value.effects)) {
    throw new EffectError('The effect catalog is unavailable or incompatible.');
  }
  return value;
}

function ensureCatalog() {
  if (!publicCatalog) {
    publicCatalog = deepFreeze(cloneJson(metadata()));
    publicByType = new Map(publicCatalog.effects.map(effect => [effect.type, effect]));
  }
  return publicCatalog;
}

export function getEffectCatalog() {
  return ensureCatalog();
}

export function getEffectDefinition(type) {
  ensureCatalog();
  const effect = publicByType.get(type);
  if (!effect) throw new EffectError(`Unknown effect type: ${String(type)}`);
  return effect;
}

export function getEffectImplementation(type) {
  const implementation = generated._EFFECT_IMPLEMENTATION?.[type];
  if (!implementation) {
    throw new EffectError(`The ${String(type)} effect is unavailable in this build.`);
  }
  return implementation;
}
