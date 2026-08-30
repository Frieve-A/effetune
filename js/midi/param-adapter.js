import {
  DSP_AUTOMATION_CATALOG,
  normalizeDSPAutomationValue,
  packDSPAutomationValue,
  unpackDSPAutomationValue
} from '../audio/dsp-params.generated.js';

// Kept in the runtime module so persisted mappings and the dialog use the
// same assignability decision as parameter application.
export const UNASSIGNABLE_DESCRIPTORS = Object.freeze([
  // Room EQ exposes delay in milliseconds rather than the generated sample-count field.
  'RoomEqPlugin:dy:0'
]);

const unassignableKeys = new Set(UNASSIGNABLE_DESCRIPTORS);
// Keep this list explicit: descriptors without a transform field (or with a
// future/unknown transform) must remain in the plugin's native value domain.
const PUBLIC_VALUE_TRANSFORMS = new Set([
  'naturalLog',
  'log10',
  'decibelsFromReference'
]);

function descriptorId(type, key, element = 0) {
  return `${type}:${key}:${element}`;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, cloneValue(member)]));
  }
  return value;
}

function usesPublicValueTransform(descriptor) {
  return PUBLIC_VALUE_TRANSFORMS.has(descriptor.transform) &&
    (descriptor.kind === 'float' || descriptor.kind === 'int');
}

export class ParamAdapter {
  constructor({ catalog = DSP_AUTOMATION_CATALOG } = {}) {
    this.catalog = catalog;
    this.strategyCache = new Map();
  }

  resolve(type, key, element = 0) {
    const normalizedElement = Number.isSafeInteger(element) ? element : 0;
    if (!this.isAssignable(type, key, normalizedElement)) return null;
    const cacheKey = descriptorId(type, key, normalizedElement);
    const cached = this.strategyCache.get(cacheKey);
    if (cached) return cached;
    const descriptor = this.catalog[type].find(candidate =>
      candidate.key === key && candidate.element === normalizedElement
    );
    const strategy = descriptor.containerKey
      ? (descriptor.memberKey ? 'containerMember' : 'containerValue')
      : 'field';
    const resolved = Object.freeze({ descriptor, strategy });
    this.strategyCache.set(cacheKey, resolved);
    return resolved;
  }

  isAssignable(type, key, element = 0) {
    if (unassignableKeys.has(descriptorId(type, key, element))) return false;
    const descriptors = this.catalog[type];
    return Array.isArray(descriptors) && descriptors.some(descriptor =>
      descriptor.key === key && descriptor.element === element
    );
  }

  read(plugin, resolved) {
    if (!plugin || !resolved) return undefined;
    const { descriptor } = resolved;
    let packedValue;
    if (resolved.strategy === 'field') {
      packedValue = plugin.getSerializableParameters?.()?.[descriptor.field];
    } else {
      const container = plugin[descriptor.containerKey];
      if (!Array.isArray(container)) return undefined;
      const value = container[descriptor.element];
      packedValue = resolved.strategy === 'containerMember'
        ? value?.[descriptor.memberKey]
        : value;
    }
    return usesPublicValueTransform(descriptor)
      ? unpackDSPAutomationValue(descriptor, packedValue)
      : packedValue;
  }

  apply(plugin, resolved, realValue) {
    if (!plugin || !resolved || typeof plugin.setParameters !== 'function') return false;
    const { descriptor } = resolved;
    const packedValue = usesPublicValueTransform(descriptor)
      ? packDSPAutomationValue(descriptor, realValue)
      : realValue;
    if (resolved.strategy === 'field') {
      plugin.setParameters({ [descriptor.field]: packedValue });
      return true;
    }

    const current = plugin[descriptor.containerKey];
    if (!Array.isArray(current)) return false;
    const next = current.map(cloneValue);
    while (next.length <= descriptor.element) {
      const seed = next.length > 0 ? cloneValue(next[next.length - 1]) :
        (resolved.strategy === 'containerMember' ? {} : packedValue);
      next.push(seed);
    }
    if (resolved.strategy === 'containerMember') {
      const existing = next[descriptor.element];
      next[descriptor.element] = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        [descriptor.memberKey]: packedValue
      };
    } else {
      next[descriptor.element] = packedValue;
    }
    plugin.setParameters({ [descriptor.containerKey]: next });
    return true;
  }
}

export function getAssignableDescriptors(type, adapter = new ParamAdapter()) {
  return (adapter.catalog[type] || []).filter(descriptor =>
    adapter.isAssignable(type, descriptor.key, descriptor.element)
  );
}

export function getTargetValueRange(target, adapter = new ParamAdapter()) {
  if (!target || target.type === '_global' || target.param === '_enabled') {
    return { kind: 'bool', minimum: 0, maximum: 1, step: 1, values: null };
  }
  const descriptor = adapter.resolve(target.type, target.param, target.element)?.descriptor;
  if (!descriptor) return null;
  if (descriptor.kind === 'enum') {
    return {
      kind: 'enum',
      minimum: descriptor.values[0],
      maximum: descriptor.values[descriptor.values.length - 1],
      step: 1,
      values: descriptor.values
    };
  }
  return {
    kind: descriptor.kind,
    minimum: descriptor.minimum,
    maximum: descriptor.maximum,
    step: descriptor.step,
    values: null
  };
}

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function canonicalizeTargetValue(range, value, fallback) {
  const numeric = Number.isFinite(value) ? value : fallback;
  const clamped = clamp(numeric, range.minimum, range.maximum);
  if (range.kind !== 'int' || !Number.isFinite(range.step) || range.step <= 0) return clamped;
  const stepCount = Math.round((clamped - range.minimum) / range.step);
  return clamp(range.minimum + stepCount * range.step, range.minimum, range.maximum);
}

export function isNumericTargetRange(range) {
  return range?.kind === 'float' || range?.kind === 'int';
}

export function defaultAutomationAmount(range) {
  return isNumericTargetRange(range) && Number.isFinite(range.step) && range.step > 0
    ? range.step
    : 1;
}

export function canonicalizeAutomationAmount(range, value, fallback = defaultAutomationAmount(range)) {
  const numeric = Number.isFinite(value) && value > 0 ? value : fallback;
  if (range?.kind !== 'int' || !Number.isFinite(range.step) || range.step <= 0) return numeric;
  const steps = Math.max(1, Math.round(numeric / range.step));
  return steps * range.step;
}

export function getMappedNormalizedRange(mapping, descriptor) {
  const values = descriptor.kind === 'enum' ? descriptor.values : null;
  const defaultLo = values ? values[0] : descriptor.minimum;
  const defaultHi = values ? values[values.length - 1] : descriptor.maximum;
  const range = {
    kind: descriptor.kind,
    minimum: descriptor.minimum,
    maximum: descriptor.maximum,
    step: descriptor.step
  };
  const loValue = values
    ? (values.includes(mapping?.map?.lo) ? mapping.map.lo : defaultLo)
    : canonicalizeTargetValue(range, mapping?.map?.lo, defaultLo);
  const hiValue = values
    ? (values.includes(mapping?.map?.hi) ? mapping.map.hi : defaultHi)
    : canonicalizeTargetValue(range, mapping?.map?.hi, defaultHi);
  return {
    lo: normalizeDSPAutomationValue(descriptor, loValue),
    hi: normalizeDSPAutomationValue(descriptor, hiValue)
  };
}

export function getMappedEnumRange(mapping, descriptor) {
  const values = descriptor.values;
  const rawLo = values.indexOf(mapping?.map?.lo);
  const rawHi = values.indexOf(mapping?.map?.hi);
  const lo = rawLo < 0 ? 0 : rawLo;
  const hi = rawHi < 0 ? values.length - 1 : rawHi;
  return {
    minimum: Math.min(lo, hi),
    maximum: Math.max(lo, hi),
    direction: Math.sign(hi - lo) || 1
  };
}

export function defaultMapRange(target, adapter = new ParamAdapter()) {
  const range = getTargetValueRange(target, adapter);
  return range ? { lo: range.minimum, hi: range.maximum } : { lo: 0, hi: 1 };
}
