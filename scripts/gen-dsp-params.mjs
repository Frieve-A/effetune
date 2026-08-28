import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
const publicOverlayPath = path.join(
  repoRoot, 'dsp', 'bindings', 'common', 'effects-v1.overlay.json'
);
const cppOutputRoot = path.join(repoRoot, 'dsp', 'generated', 'cpp');
const runtimeJsOutput = path.join(repoRoot, 'js', 'audio', 'dsp-params.generated.js');
const reservedKeys = new Set([
  'nm', 'en', 'uc', 'ib', 'ob', 'ch', 'type', 'id', 'enabled', 'inputBus',
  'outputBus', 'channel', 'channelCount', 'blockSize', 'sampleRate'
]);
const kinds = new Set(['float', 'int', 'bool', 'enum']);
const policies = new Set(['per-sample', 'spectral']);
const structuredCodecs = new Set(['matrix-routes-v1']);
const publicTransformKinds = new Set([
  'naturalLog', 'log10', 'decibelsFromReference'
]);
const unsafeJsLiteralCharacters = Object.freeze({
  '<': '\\u003C',
  '>': '\\u003E',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
});

function fail(message, source = null) {
  const prefix = source ? `${source}: ` : '';
  throw new Error(`${prefix}${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireIdentifier(value, label, source) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail(`${label} must be a C++/JavaScript identifier`, source);
  }
  return value;
}

function requireFinite(value, label, source) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`, source);
  }
  return value;
}

function requirePositiveFinite(value, label, source) {
  if (requireFinite(value, label, source) <= 0) {
    fail(`${label} must be greater than zero`, source);
  }
  return value;
}

function expandDefault(field, count, source) {
  const defaults = Array.isArray(field.default)
    ? field.default
    : Array.from({ length: count }, () => field.default);
  if (defaults.length !== count) {
    fail(`field ${field.name} default array must contain ${count} values`, source);
  }
  return defaults;
}

function expandedKeys(field, count, source) {
  if (field.keys !== undefined) {
    if (!Array.isArray(field.keys) || field.keys.length !== count ||
        field.keys.some(key => typeof key !== 'string' || key.length === 0)) {
      fail(`field ${field.name} keys must contain ${count} non-empty strings`, source);
    }
    return [...field.keys];
  }
  if (typeof field.key !== 'string' || field.key.length === 0) {
    fail(`field ${field.name} must have a non-empty key`, source);
  }
  return count === 1
    ? [field.key]
    : Array.from({ length: count }, (_, index) => `${field.key}${index}`);
}

function rejectUnknownKeys(value, allowed, label, source) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length !== 0) {
    fail(`${label} contains unknown member(s): ${unknown.join(', ')}`, source);
  }
}

function humanizeIdentifier(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, character => character.toUpperCase());
}

function toPublicAutomationValue(value, transform) {
  if (!transform || transform.kind === 'identity') return value;
  if (transform.kind === 'naturalLog') return Math.exp(value);
  if (transform.kind === 'log10') return 10 ** value;
  return transform.reference * (10 ** (value / 20));
}

function loadPublicTransforms(filePath = publicOverlayPath) {
  const source = path.relative(repoRoot, filePath).replaceAll('\\', '/');
  let overlay;
  try {
    overlay = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`invalid JSON: ${error.message}`, source);
  }
  if (!isPlainObject(overlay) || overlay.version !== 1 || !Array.isArray(overlay.effects)) {
    fail('public transform overlay must contain a v1 effects array', source);
  }
  const byType = new Map();
  for (const effect of overlay.effects) {
    if (!isPlainObject(effect) || typeof effect.internalType !== 'string' ||
        (effect.parameters !== undefined && !isPlainObject(effect.parameters))) {
      fail('public transform overlay contains an invalid effect entry', source);
    }
    const fields = new Map();
    for (const [fieldName, parameter] of Object.entries(effect.parameters ?? {})) {
      if (!isPlainObject(parameter) || parameter.transform === undefined) continue;
      const transform = parameter.transform;
      if (!isPlainObject(transform) || !publicTransformKinds.has(transform.kind)) {
        fail(`${effect.internalType}.${fieldName} uses an unsupported public transform`, source);
      }
      const reference = transform.kind === 'decibelsFromReference'
        ? requireFinite(
            transform.reference,
            `${effect.internalType}.${fieldName} transform reference`, source
          )
        : 1;
      if (!(reference > 0)) {
        fail(`${effect.internalType}.${fieldName} transform reference must be positive`, source);
      }
      const unit = transform.unit;
      if (unit !== undefined && (typeof unit !== 'string' || unit.length === 0)) {
        fail(`${effect.internalType}.${fieldName} transform unit must be a non-empty string`, source);
      }
      fields.set(fieldName, Object.freeze({ kind: transform.kind, reference, unit }));
    }
    byType.set(effect.internalType, fields);
  }
  return byType;
}

function applyPublicTransforms(specs, transformsByType = loadPublicTransforms()) {
  for (const spec of specs) {
    const transforms = transformsByType.get(spec.type);
    if (!transforms) continue;
    for (const field of spec.fields) {
      const transform = transforms.get(field.name);
      if (!transform) continue;
      if (field.kind !== 'float' || field.count !== 1) {
        fail(`field ${field.name} public transform requires one float`, spec.source);
      }
      field.publicTransform = transform;
      if (transform.unit !== undefined) {
        field.unit = transform.unit;
        if (field.automation) field.automation.unit = transform.unit;
      }
      if (!field.automation) continue;
      const minimum = toPublicAutomationValue(field.min, transform);
      const maximum = toPublicAutomationValue(field.max, transform);
      if (!(minimum > 0) || !(maximum > minimum) ||
          !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
        fail(`field ${field.name} public log automation range is invalid`, spec.source);
      }
      field.automation.normalization = 'log';
    }
  }
  return specs;
}

function validateAutomation(raw, field, source) {
  if (raw === undefined) {
    return null;
  }
  if (raw !== true && !isPlainObject(raw)) {
    fail(`field ${field.name} automation must be true or an object`, source);
  }
  if (isPlainObject(raw)) {
    rejectUnknownKeys(
      raw, new Set(['normalization']), `field ${field.name} automation`, source
    );
    if (raw.normalization !== 'log') {
      fail(`field ${field.name} automation normalization override must be log`, source);
    }
    if (field.kind !== 'float') {
      fail(`field ${field.name} log automation requires float kind`, source);
    }
  }

  const normalization = field.kind === 'float'
    ? (isPlainObject(raw) ? 'log' : 'linear')
    : (field.kind === 'int' ? 'integer' : field.kind);
  const eligibility = field.kind === 'float' ? 'continuous' : 'stepped';
  if (field.kind === 'float') {
    if (!(field.min < field.max)) {
      fail(`field ${field.name} automated float range must not be empty`, source);
    }
    if (normalization === 'log' && field.min <= 0) {
      fail(`field ${field.name} log automation requires min greater than zero`, source);
    }
  } else if (field.kind === 'int') {
    const steps = (field.max - field.min) / field.step;
    if (!Number.isSafeInteger(field.step) || !Number.isSafeInteger(steps) ||
        steps <= 0 || steps > 0xffffffff) {
      fail(`field ${field.name} integer automation step count must fit uint32`, source);
    }
    if (field.defaults.some(value => (value - field.min) % field.step !== 0)) {
      fail(`field ${field.name} integer automation defaults must align to its step`, source);
    }
  } else if (field.kind === 'enum' && field.values.length < 2) {
    fail(`field ${field.name} enum automation requires at least two values`, source);
  }

  const title = humanizeIdentifier(field.publicName);
  return {
    eligibility,
    key: field.key,
    title,
    shortTitle: title,
    unit: field.unit,
    normalization,
    safetyFlags: 0
  };
}

export function computeLayoutHash(fields, structured = null) {
  let hash = 0x811c9dc5;
  for (const field of fields) {
    const enumLayout = field.kind === 'enum'
      ? `:${JSON.stringify(field.values)}`
      : '';
    const layout = `${field.name}:${field.kind}:${field.count}${enumLayout};`;
    for (const byte of Buffer.from(layout, 'utf8')) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  if (structured) {
    const layout = `${structured.name}:structured:${structured.codec}:${structured.maxItems};`;
    for (const byte of Buffer.from(layout, 'utf8')) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

export function validateParamSpec(raw, source = '<params.json>') {
  if (!isPlainObject(raw)) {
    fail('root must be an object', source);
  }
  const type = requireIdentifier(raw.type, 'type', source);
  if (raw.phase0 !== undefined && typeof raw.phase0 !== 'boolean') {
    fail('phase0 must be true or false', source);
  }
  const phase0 = raw.phase0 === true;
  if (!isPlainObject(raw.tolerance)) {
    fail('tolerance must be an object', source);
  }
  const abs = requireFinite(raw.tolerance.abs, 'tolerance.abs', source);
  if (abs <= 0) {
    fail('tolerance.abs must be greater than zero', source);
  }
  const policy = raw.tolerance.policy ?? 'per-sample';
  if (!policies.has(policy)) {
    fail(`tolerance.policy must be one of: ${[...policies].join(', ')}`, source);
  }
  if (raw.tolerance.rel !== undefined &&
      requireFinite(raw.tolerance.rel, 'tolerance.rel', source) <= 0) {
    fail('tolerance.rel must be greater than zero', source);
  }
  if (!Array.isArray(raw.fields)) {
    fail('fields must be an array', source);
  }

  const fieldNames = new Set();
  const publicNames = new Set();
  const packedKeys = new Set();
  const automationKeys = new Set();
  const objectArrays = new Map();
  let floatCount = 0;
  const fields = raw.fields.map((rawField, fieldIndex) => {
    if (!isPlainObject(rawField)) {
      fail(`fields[${fieldIndex}] must be an object`, source);
    }
    const name = requireIdentifier(rawField.name, `fields[${fieldIndex}].name`, source);
    if (fieldNames.has(name)) {
      fail(`duplicate field name ${name}`, source);
    }
    fieldNames.add(name);
    const publicName = rawField.publicName === undefined
      ? name
      : requireIdentifier(rawField.publicName, `field ${name} publicName`, source);
    if (publicNames.has(publicName)) {
      fail(`duplicate public field name ${publicName}`, source);
    }
    publicNames.add(publicName);
    const unit = rawField.unit === undefined ? '' : rawField.unit;
    if (typeof unit !== 'string' || (rawField.unit !== undefined && unit.length === 0)) {
      fail(`field ${name} unit must be a non-empty string`, source);
    }
    if (!kinds.has(rawField.kind)) {
      fail(`field ${name} kind must be one of: ${[...kinds].join(', ')}`, source);
    }
    const count = rawField.count ?? 1;
    if (!Number.isSafeInteger(count) || count <= 0 || count > 4096) {
      fail(`field ${name} count must be an integer from 1 to 4096`, source);
    }
    const keys = expandedKeys(rawField, count, source);
    for (const key of keys) {
      if (reservedKeys.has(key)) {
        fail(`field ${name} uses reserved key ${key}`, source);
      }
      if (packedKeys.has(key)) {
        fail(`packed key collision: ${key}`, source);
      }
      packedKeys.add(key);
    }
    let arrayKey = null;
    if (rawField.arrayKey !== undefined) {
      if (count === 1 || typeof rawField.arrayKey !== 'string' ||
          rawField.arrayKey.length === 0 || reservedKeys.has(rawField.arrayKey)) {
        fail(`field ${name} arrayKey requires a non-reserved string and count > 1`, source);
      }
      arrayKey = rawField.arrayKey;
    }
    let objectArrayKey = null;
    let memberKey = null;
    const hasObjectArrayKey = rawField.objectArrayKey !== undefined;
    const hasMemberKey = rawField.memberKey !== undefined;
    if (hasObjectArrayKey !== hasMemberKey) {
      fail(`field ${name} objectArrayKey and memberKey must be declared together`, source);
    }
    if (hasObjectArrayKey) {
      if (arrayKey !== null) {
        fail(`field ${name} cannot combine arrayKey with objectArrayKey`, source);
      }
      if (count === 1 || typeof rawField.objectArrayKey !== 'string' ||
          rawField.objectArrayKey.length === 0 || reservedKeys.has(rawField.objectArrayKey)) {
        fail(`field ${name} objectArrayKey requires a non-reserved string and count > 1`, source);
      }
      if (typeof rawField.memberKey !== 'string' || rawField.memberKey.length === 0) {
        fail(`field ${name} memberKey must be a non-empty string`, source);
      }
      objectArrayKey = rawField.objectArrayKey;
      memberKey = rawField.memberKey;
      const group = objectArrays.get(objectArrayKey);
      if (group && group.count !== count) {
        fail(`object array ${objectArrayKey} fields must use the same count`, source);
      }
      if (group?.memberKeys.has(memberKey)) {
        fail(`object array ${objectArrayKey} member key collision: ${memberKey}`, source);
      }
      if (group) {
        group.memberKeys.add(memberKey);
      } else {
        objectArrays.set(objectArrayKey, { count, memberKeys: new Set([memberKey]) });
      }
    }

    const defaults = expandDefault(rawField, count, source);
    let minimum = null;
    let maximum = null;
    let values = null;
    let rejectInvalid = false;
    if (rawField.kind === 'float' || rawField.kind === 'int') {
      minimum = requireFinite(rawField.min, `field ${name} min`, source);
      maximum = requireFinite(rawField.max, `field ${name} max`, source);
      if (minimum > maximum) {
        fail(`field ${name} min must not exceed max`, source);
      }
      if (rawField.kind === 'int' &&
          (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum))) {
        fail(`field ${name} integer bounds must be safe integers`, source);
      }
      defaults.forEach((value, index) => {
        requireFinite(value, `field ${name} default[${index}]`, source);
        if (rawField.kind === 'int' && !Number.isSafeInteger(value)) {
          fail(`field ${name} integer defaults must be safe integers`, source);
        }
        if (value < minimum || value > maximum) {
          fail(`field ${name} default[${index}] is outside min/max`, source);
        }
      });
    } else if (rawField.kind === 'bool') {
      if (defaults.some(value => typeof value !== 'boolean')) {
        fail(`field ${name} boolean defaults must be true or false`, source);
      }
    } else {
      if (rawField.rejectInvalid !== undefined && typeof rawField.rejectInvalid !== 'boolean') {
        fail(`field ${name} rejectInvalid must be true or false`, source);
      }
      rejectInvalid = rawField.rejectInvalid === true;
      if (!Array.isArray(rawField.values) || rawField.values.length === 0 ||
          rawField.values.some(value => typeof value !== 'string' || value.length === 0) ||
          new Set(rawField.values).size !== rawField.values.length) {
        fail(`field ${name} enum values must be unique non-empty strings`, source);
      }
      values = [...rawField.values];
      if (defaults.some(value => !values.includes(value))) {
        fail(`field ${name} enum defaults must appear in values`, source);
      }
    }

    // The granularity the UI prints this parameter with. plugins/plugin-base.js
    // createParameterControl() turns it into a decimal count, and the plug-in
    // prints host-facing values with the same rule, so a host readout carries
    // the digits the EffeTune window shows rather than a generic precision.
    // It is expressed in the units the parameter is *published* in: for a field
    // carrying a public transform (dsp/bindings/common/effects-v1.overlay.json)
    // that is the transformed unit, not the packed one, because a logarithmic
    // packing has no constant step.
    let step = null;
    if (rawField.step !== undefined) {
      step = requirePositiveFinite(rawField.step, `field ${name} step`, source);
    } else if (rawField.automation !== undefined) {
      fail(`field ${name} must declare a display step because it is automatable`, source);
    }

    const automation = validateAutomation(rawField.automation, {
      name,
      publicName,
      kind: rawField.kind,
      count,
      min: minimum,
      max: maximum,
      step,
      values,
      defaults,
      keys,
      key: rawField.key,
      unit
    }, source);
    if (automation) {
      if (automationKeys.has(automation.key)) {
        fail(`duplicate automation key ${automation.key}`, source);
      }
      automationKeys.add(automation.key);
    }

    floatCount += count;
    if (!Number.isSafeInteger(floatCount) || floatCount > 65536) {
      fail('packed parameter layout exceeds 65536 floats', source);
    }
    return {
      name,
      publicName,
      key: rawField.key ?? null,
      keys,
      arrayKey,
      objectArrayKey,
      memberKey,
      kind: rawField.kind,
      count,
      min: minimum,
      max: maximum,
      step,
      values,
      rejectInvalid,
      defaults,
      unit,
      automation
    };
  });

  let structured = null;
  if (raw.structured !== undefined) {
    if (!isPlainObject(raw.structured)) {
      fail('structured must be an object', source);
    }
    const name = requireIdentifier(raw.structured.name, 'structured.name', source);
    const key = raw.structured.key;
    if (typeof key !== 'string' || key.length === 0 || reservedKeys.has(key) ||
        packedKeys.has(key)) {
      fail('structured.key must be a unique non-reserved key', source);
    }
    if (!structuredCodecs.has(raw.structured.codec)) {
      fail(`structured.codec must be one of: ${[...structuredCodecs].join(', ')}`, source);
    }
    const maxItems = raw.structured.maxItems;
    if (!Number.isSafeInteger(maxItems) || maxItems <= 0 || maxItems > 1024) {
      fail('structured.maxItems must be an integer from 1 to 1024', source);
    }
    const defaultValue = raw.structured.default ?? '';
    if (typeof defaultValue !== 'string') {
      fail('structured.default must be a string', source);
    }
    structured = {
      name,
      key,
      codec: raw.structured.codec,
      maxItems,
      defaultValue,
      byteCapacity: 4 + maxItems * 3
    };
  }

  if (raw.assets !== undefined && !Array.isArray(raw.assets)) {
    fail('assets must be an array', source);
  }
  const assetSlots = new Set();
  const assets = (raw.assets ?? []).map((rawAsset, assetIndex) => {
    if (!isPlainObject(rawAsset)) {
      fail(`assets[${assetIndex}] must be an object`, source);
    }
    const slot = rawAsset.slot;
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 31) {
      fail(`assets[${assetIndex}].slot must be an integer from 0 to 31`, source);
    }
    if (assetSlots.has(slot)) {
      fail(`duplicate asset slot ${slot}`, source);
    }
    assetSlots.add(slot);
    if (typeof rawAsset.format !== 'string' || rawAsset.format.length === 0) {
      fail(`assets[${assetIndex}].format must be a non-empty string`, source);
    }
    if (typeof rawAsset.capacity !== 'string' || rawAsset.capacity.length === 0) {
      fail(`assets[${assetIndex}].capacity must be a non-empty string`, source);
    }
    return { slot, format: rawAsset.format, capacity: rawAsset.capacity };
  });
  return {
    type,
    phase0,
    tolerance: { abs, rel: raw.tolerance.rel ?? null, policy },
    fields,
    floatCount,
    structured,
    assets,
    byteCapacity: structured?.byteCapacity ?? 0,
    hash: computeLayoutHash(fields, structured),
    source
  };
}

function walkParamFiles(directory, output = []) {
  if (!fs.existsSync(directory)) {
    return output;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkParamFiles(fullPath, output);
    } else if (entry.isFile() && entry.name === 'params.json') {
      output.push(fullPath);
    }
  }
  return output;
}

export function loadParamSpecs(root = pluginsRoot) {
  const specs = [];
  const types = new Map();
  for (const filePath of walkParamFiles(root)) {
    const source = path.relative(repoRoot, filePath).replaceAll('\\', '/');
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      fail(`invalid JSON: ${error.message}`, source);
    }
    const spec = validateParamSpec(raw, source);
    if (types.has(spec.type)) {
      fail(`duplicate type ${spec.type}; first declared in ${types.get(spec.type)}`, source);
    }
    types.set(spec.type, source);
    specs.push(spec);
  }
  specs.sort((left, right) => left.type.localeCompare(right.type, 'en'));
  return applyPublicTransforms(specs);
}

function hex32(value) {
  return `0x${value.toString(16).padStart(8, '0')}`;
}

function automationRange(field) {
  if (field.kind === 'bool') return { minimum: 0, maximum: 1 };
  if (field.kind === 'enum') return { minimum: 0, maximum: field.values.length - 1 };
  return {
    minimum: toPublicAutomationValue(field.min, field.publicTransform),
    maximum: toPublicAutomationValue(field.max, field.publicTransform)
  };
}

function automationPackedDefault(field, index) {
  if (field.kind === 'bool') return field.defaults[index] ? 1 : 0;
  if (field.kind === 'enum') return field.values.indexOf(field.defaults[index]);
  return field.defaults[index];
}

function automationPublicDefault(field, index) {
  if (field.kind === 'bool' || field.kind === 'enum') return field.defaults[index];
  return toPublicAutomationValue(field.defaults[index], field.publicTransform);
}

function automationStepCount(field) {
  if (field.kind === 'bool') return 1;
  if (field.kind === 'enum') return field.values.length - 1;
  if (field.kind === 'int') return (field.max - field.min) / field.step;
  return 0;
}

export function buildAutomationCatalog(specs) {
  const effects = {};
  for (const spec of specs) {
    const parameters = [];
    let packedOffset = 0;
    for (const field of spec.fields) {
      if (field.automation) {
        const { minimum, maximum } = automationRange(field);
        for (let element = 0; element < field.count; ++element) {
          parameters.push({
            key: field.automation.key,
            publicName: field.publicName,
            element,
            field: field.keys[element],
            containerKey: field.arrayKey ?? field.objectArrayKey ?? '',
            memberKey: field.memberKey ?? '',
            packedOffset: packedOffset + element,
            kind: field.kind,
            eligibility: field.automation.eligibility,
            normalization: field.automation.normalization,
            transform: field.publicTransform?.kind ?? 'identity',
            transformReference: field.publicTransform?.reference ?? 1,
            minimum,
            maximum,
            step: field.step,
            default: automationPublicDefault(field, element),
            packedDefault: automationPackedDefault(field, element),
            stepCount: automationStepCount(field),
            title: field.automation.title,
            shortTitle: field.automation.shortTitle,
            unit: field.automation.unit,
            safetyFlags: field.automation.safetyFlags,
            ...(field.kind === 'enum' ? { values: [...field.values] } : {})
          });
        }
      }
      packedOffset += field.count;
    }
    effects[spec.type] = parameters;
  }
  return { version: 1, effects };
}

export function validateAutomationCompatibility(previous, current) {
  if (previous?.version !== 1 || current?.version !== 1 ||
      !isPlainObject(previous.effects) || !isPlainObject(current.effects)) {
    fail('automation compatibility inputs must be v1 catalogs');
  }
  const stableMembers = [
    'publicName', 'key', 'kind', 'eligibility', 'normalization', 'transform',
    'transformReference', 'minimum', 'maximum', 'default', 'stepCount', 'unit'
  ];
  for (const [type, previousParameters] of Object.entries(previous.effects)) {
    const currentParameters = current.effects[type] ?? [];
    const currentByIdentity = new Map(
      currentParameters.map(parameter => [
        `${parameter.publicName}:${parameter.element}`, parameter
      ])
    );
    for (const parameter of previousParameters) {
      const identity = `${parameter.publicName}:${parameter.element}`;
      const replacement = currentByIdentity.get(identity);
      if (!replacement) {
        fail(`released automation parameter ${type}.${identity} was removed or renamed`);
      }
      for (const member of stableMembers) {
        if (replacement[member] !== parameter[member]) {
          fail(`released automation parameter ${type}.${identity} changed ${member}`);
        }
      }
      if (JSON.stringify(replacement.values ?? null) !==
          JSON.stringify(parameter.values ?? null)) {
        fail(`released automation parameter ${type}.${identity} changed enum values`);
      }
    }
  }
  return true;
}

function cppFloat(value) {
  return `${Number.isInteger(value) ? `${value}.0` : value}f`;
}

function cppStringLiteral(value) {
  return JSON.stringify(value);
}

function cppAutomationCatalog(specs) {
  const catalog = buildAutomationCatalog(specs);
  const parameters = [];
  const effects = [];
  for (const [type, entries] of Object.entries(catalog.effects)) {
    effects.push({ type, first: parameters.length, count: entries.length });
    parameters.push(...entries);
  }
  const enumValues = [];
  const cppParameters = parameters.map(parameter => {
    const firstEnumValue = enumValues.length;
    if (parameter.values) enumValues.push(...parameter.values);
    return {
      ...parameter,
      firstEnumValue,
      enumValueCount: parameter.values?.length ?? 0
    };
  });
  const parameterRows = cppParameters.map(parameter =>
    `  AutomationParameterDescriptor{${cppStringLiteral(parameter.key)}, ` +
    `${cppStringLiteral(parameter.publicName)}, ${parameter.element}u, ` +
    `${cppStringLiteral(parameter.field)}, ` +
    `${cppStringLiteral(parameter.containerKey)}, ${cppStringLiteral(parameter.memberKey)}, ` +
    `${parameter.packedOffset}u, ` +
    `AutomationParameterKind::${parameter.kind[0].toUpperCase()}${parameter.kind.slice(1)}, ` +
    `AutomationEligibility::${parameter.eligibility === 'continuous' ? 'Continuous' : 'Stepped'}, ` +
    `AutomationNormalization::${parameter.normalization === 'log' ? 'Logarithmic' : parameter.normalization[0].toUpperCase() + parameter.normalization.slice(1)}, ` +
    `AutomationValueTransform::${parameter.transform[0].toUpperCase()}${parameter.transform.slice(1)}, ` +
    `${cppFloat(parameter.transformReference)}, ` +
    `${cppFloat(parameter.minimum)}, ${cppFloat(parameter.maximum)}, ` +
    `${cppFloat(parameter.step)}, ` +
    `${cppFloat(parameter.kind === 'bool' || parameter.kind === 'enum'
      ? parameter.packedDefault
      : parameter.default)}, ${cppFloat(parameter.packedDefault)}, ` +
    `${parameter.stepCount}u, ` +
    `${cppStringLiteral(parameter.title)}, ${cppStringLiteral(parameter.shortTitle)}, ` +
    `${cppStringLiteral(parameter.unit)}, ${parameter.safetyFlags}u, ` +
    `${parameter.firstEnumValue}u, ${parameter.enumValueCount}u}`
  ).join(',\n');
  const enumValueRows = enumValues.map(value => `  ${cppStringLiteral(value)}`).join(',\n');
  const effectRows = effects.map(effect =>
    `  AutomationEffectDescriptor{${cppStringLiteral(effect.type)}, ${effect.first}u, ${effect.count}u}`
  ).join(',\n');
  return `// Generated by scripts/gen-dsp-params.mjs. Do not edit.\n` +
    `#ifndef EFFETUNE_GENERATED_AUTOMATION_CATALOG_H\n` +
    `#define EFFETUNE_GENERATED_AUTOMATION_CATALOG_H\n\n` +
    `#include <array>\n#include <cstdint>\n#include <string_view>\n\n` +
    `namespace effetune::generated {\n\n` +
    `enum class AutomationParameterKind : std::uint8_t { Float, Int, Bool, Enum };\n` +
    `enum class AutomationEligibility : std::uint8_t { Continuous, Stepped };\n` +
    `enum class AutomationNormalization : std::uint8_t { Linear, Logarithmic, Enum, Bool, Integer };\n\n` +
    `enum class AutomationValueTransform : std::uint8_t {\n` +
    `  Identity,\n  NaturalLog,\n  Log10,\n  DecibelsFromReference\n};\n\n` +
    `struct AutomationParameterDescriptor {\n` +
    `  std::string_view key;\n  std::string_view publicName;\n` +
    `  std::uint32_t element;\n  std::string_view field;\n` +
    `  std::string_view containerKey;\n  std::string_view memberKey;\n` +
    `  std::uint32_t packedOffset;\n  AutomationParameterKind kind;\n` +
    `  AutomationEligibility eligibility;\n  AutomationNormalization normalization;\n` +
    `  AutomationValueTransform transform;\n  float transformReference;\n` +
    `  float minimum;\n  float maximum;\n  float step;\n  float defaultValue;\n` +
    `  float packedDefaultValue;\n` +
    `  std::uint32_t stepCount;\n  std::string_view title;\n` +
    `  std::string_view shortTitle;\n  std::string_view unit;\n` +
    `  std::uint8_t safetyFlags;\n  std::uint32_t firstEnumValue;\n` +
    `  std::uint32_t enumValueCount;\n};\n\n` +
    `struct AutomationEffectDescriptor {\n  std::string_view type;\n` +
    `  std::uint32_t firstParameter;\n  std::uint32_t parameterCount;\n};\n\n` +
    `// clang-format off\n` +
    `inline constexpr std::array<AutomationParameterDescriptor, ${parameters.length}> kAutomationParameters{{\n` +
    `${parameterRows}${parameterRows ? '\n' : ''}}};\n\n` +
    `inline constexpr std::array<std::string_view, ${enumValues.length}> kAutomationEnumValues{{\n` +
    `${enumValueRows}${enumValueRows ? '\n' : ''}}};\n\n` +
    `inline constexpr std::array<AutomationEffectDescriptor, ${effects.length}> kAutomationEffects{{\n` +
    `${effectRows}${effectRows ? '\n' : ''}}};\n` +
    `// clang-format on\n\n` +
    `} // namespace effetune::generated\n\n#endif\n`;
}

function cppForSpec(spec) {
  const fields = spec.fields.map(field =>
    field.count === 1
      ? `  float ${field.name};`
      : `  float ${field.name}[${field.count}];`
  ).join('\n');
  return `// Generated by scripts/gen-dsp-params.mjs. Do not edit.\n` +
    `#ifndef EFFETUNE_GENERATED_${spec.type.toUpperCase()}_PARAMS_H\n` +
    `#define EFFETUNE_GENERATED_${spec.type.toUpperCase()}_PARAMS_H\n\n` +
    `#include <cstdint>\n\n` +
    `namespace effetune::generated {\n\n` +
    `struct ${spec.type}Params {\n${fields}${fields ? '\n' : ''}` +
    `  static constexpr std::uint32_t kHash = ${hex32(spec.hash)}u;\n` +
    `  static constexpr std::uint32_t kFloatCount = ${spec.floatCount}u;\n` +
    (spec.structured
      ? `  static constexpr std::uint32_t kParamBytesCapacity = ${spec.byteCapacity}u;\n`
      : '') +
    `};\n` +
    `static_assert(${spec.floatCount}u == 0u || sizeof(${spec.type}Params) == sizeof(float) * ${spec.floatCount}u);\n\n` +
    `} // namespace effetune::generated\n\n#endif\n`;
}

function jsStructuredPacker(spec) {
  const structured = spec.structured;
  if (!structured) return '';
  if (structured.codec !== 'matrix-routes-v1') {
    throw new Error(`Unsupported structured codec ${structured.codec}`);
  }
  return `export function pack${spec.type}ParamBytes(params = {}) {\n` +
    `  const source = typeof params[${jsLiteral(structured.key)}] === 'string' ? params[${jsLiteral(structured.key)}] : ${jsLiteral(structured.defaultValue)};\n` +
    `  const routes = [];\n` +
    `  let offset = 0;\n` +
    `  while (offset < source.length) {\n` +
    `    let phase = 0;\n` +
    `    if (source[offset] === 'p') { phase = 1; offset++; }\n` +
    `    if (offset + 1 >= source.length) break;\n` +
    `    const inputText = source[offset];\n` +
    `    const outputText = source[offset + 1];\n` +
    `    const input = /^[0-9a-f]$/.test(inputText) ? parseInt(inputText, 16) : -1;\n` +
    `    const output = /^[0-9a-f]$/.test(outputText) ? parseInt(outputText, 16) : -1;\n` +
    `    if (input >= 0 && output >= 0) {\n` +
    `      if (routes.length >= ${structured.maxItems * 3}) throw new RangeError('${spec.type} structured route capacity exceeded');\n` +
    `      routes.push(input, output, phase);\n` +
    `    }\n` +
    `    offset += 2;\n` +
    `  }\n` +
    `  const packed = new Uint8Array(4 + routes.length);\n` +
    `  packed[0] = 1;\n` +
    `  packed[1] = 0;\n` +
    `  const routeCount = routes.length / 3;\n` +
    `  packed[2] = routeCount & 0xff;\n` +
    `  packed[3] = routeCount >>> 8;\n` +
    `  packed.set(routes, 4);\n` +
    `  return packed;\n` +
    `}\n\n`;
}

function jsLiteral(value) {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    character => unsafeJsLiteralCharacters[character]
  );
}

function jsReadExpression(field, index) {
  const key = field.keys[index];
  const fallback = field.defaults[index];
  const direct = `params[${jsLiteral(key)}]`;
  let raw = direct;
  if (field.arrayKey) {
    raw = `((Array.isArray(params[${jsLiteral(field.arrayKey)}]) || ArrayBuffer.isView(params[${jsLiteral(field.arrayKey)}])) ? params[${jsLiteral(field.arrayKey)}][${index}] : ${direct})`;
  } else if (field.objectArrayKey) {
    const array = `params[${jsLiteral(field.objectArrayKey)}]`;
    raw = `(Array.isArray(${array}) ? ${array}[${index}]?.[${jsLiteral(field.memberKey)}] : ${direct})`;
  }
  if (field.kind === 'bool') {
    return `(${raw} === true || ${raw} === 1 ? 1 : ${raw} === false || ${raw} === 0 ? 0 : ${fallback ? 1 : 0})`;
  }
  if (field.kind === 'enum') {
    const values = jsLiteral(field.values);
    const fallbackIndex = field.values.indexOf(fallback);
    if (field.rejectInvalid) {
      return `(() => { const value = ${raw}; if (value === undefined) return ${fallbackIndex}; const index = ${values}.indexOf(value); if (index < 0) throw new TypeError(${jsLiteral(`Invalid enum value for ${key}`)}); return index; })()`;
    }
    return `(() => { const index = ${values}.indexOf(${raw}); return index < 0 ? ${fallbackIndex} : index; })()`;
  }
  const fallbackLiteral = jsLiteral(fallback);
  const valid = field.kind === 'int'
    ? 'Number.isSafeInteger(value)'
    : "typeof value === 'number' && Number.isFinite(value)";
  return `(() => { const value = ${raw}; if (!(${valid})) return ${fallbackLiteral}; if (value < ${jsLiteral(field.min)}) return ${jsLiteral(field.min)}; if (value > ${jsLiteral(field.max)}) return ${jsLiteral(field.max)}; return value; })()`;
}

function jsAutomationCatalog(specs) {
  const catalog = buildAutomationCatalog(specs);
  const chunks = [
    'const freezeAutomationDescriptor = descriptor => {\n',
    '  if (descriptor.values) Object.freeze(descriptor.values);\n',
    '  return Object.freeze(descriptor);\n',
    '};\n\n',
    'export const DSP_AUTOMATION_CATALOG = Object.freeze({\n'
  ];
  for (const [type, parameters] of Object.entries(catalog.effects)) {
    const descriptors = parameters
      .map(parameter => `freezeAutomationDescriptor(${jsLiteral(parameter)})`)
      .join(', ');
    chunks.push(`  ${type}: Object.freeze([${descriptors}]),\n`);
  }
  chunks.push('});\n\n');
  chunks.push(
    'function clampAutomationNormalized(value) {\n',
    '  if (!Number.isFinite(value)) return 0;\n',
    '  return Math.min(1, Math.max(0, value));\n',
    '}\n\n',
    'export function unpackDSPAutomationValue(descriptor, packedValue) {\n',
    "  const value = typeof packedValue === 'number' && Number.isFinite(packedValue)\n",
    '    ? packedValue : descriptor.packedDefault;\n',
    '  switch (descriptor.transform) {\n',
    "    case 'identity': return value;\n",
    "    case 'naturalLog': return Math.exp(value);\n",
    "    case 'log10': return Math.pow(10, value);\n",
    "    case 'decibelsFromReference':\n",
    '      return descriptor.transformReference * Math.pow(10, value / 20);\n',
    "    default: throw new TypeError('Unknown DSP automation value transform');\n",
    '  }\n',
    '}\n\n',
    'export function packDSPAutomationValue(descriptor, publicValue) {\n',
    "  const value = typeof publicValue === 'number' && Number.isFinite(publicValue)\n",
    '    ? publicValue : descriptor.default;\n',
    '  switch (descriptor.transform) {\n',
    "    case 'identity': return value;\n",
    "    case 'naturalLog': return value > 0 ? Math.log(value) : descriptor.packedDefault;\n",
    "    case 'log10': return value > 0 ? Math.log10(value) : descriptor.packedDefault;\n",
    "    case 'decibelsFromReference':\n",
    '      return value > 0 && descriptor.transformReference > 0\n',
    '        ? 20 * Math.log10(value / descriptor.transformReference)\n',
    '        : descriptor.packedDefault;\n',
    "    default: throw new TypeError('Unknown DSP automation value transform');\n",
    '  }\n',
    '}\n\n',
    'export function normalizeDSPAutomationValue(descriptor, plainValue) {\n',
    '  switch (descriptor.normalization) {\n',
    "    case 'linear': {\n",
    "      const value = typeof plainValue === 'number' && Number.isFinite(plainValue)\n",
    '        ? plainValue : descriptor.default;\n',
    '      return clampAutomationNormalized(\n',
    '        (value - descriptor.minimum) / (descriptor.maximum - descriptor.minimum)\n',
    '      );\n',
    '    }\n',
    "    case 'log': {\n",
    "      const value = typeof plainValue === 'number' && Number.isFinite(plainValue)\n",
    '        ? plainValue : descriptor.default;\n',
    '      const clamped = Math.min(descriptor.maximum, Math.max(descriptor.minimum, value));\n',
    '      return Math.log(clamped / descriptor.minimum) /\n',
    '        Math.log(descriptor.maximum / descriptor.minimum);\n',
    '    }\n',
    "    case 'integer': {\n",
    "      const value = Number.isSafeInteger(plainValue) ? plainValue : descriptor.default;\n",
    '      return clampAutomationNormalized(\n',
    '        (value - descriptor.minimum) / descriptor.step / descriptor.stepCount\n',
    '      );\n',
    '    }\n',
    "    case 'bool':\n",
    '      return plainValue === true || plainValue === 1 ? 1 :\n',
    '        plainValue === false || plainValue === 0 ? 0 : descriptor.default ? 1 : 0;\n',
    "    case 'enum': {\n",
    '      const index = descriptor.values.indexOf(plainValue);\n',
    '      const fallback = descriptor.values.indexOf(descriptor.default);\n',
    '      return (index < 0 ? fallback : index) / descriptor.stepCount;\n',
    '    }\n',
    "    default: throw new TypeError('Unknown DSP automation normalization');\n",
    '  }\n',
    '}\n\n',
    'export function denormalizeDSPAutomationValue(descriptor, normalizedValue) {\n',
    '  const normalized = Number.isFinite(normalizedValue)\n',
    '    ? clampAutomationNormalized(normalizedValue)\n',
    '    : normalizeDSPAutomationValue(descriptor, descriptor.default);\n',
    '  switch (descriptor.normalization) {\n',
    "    case 'linear':\n",
    '      return descriptor.minimum + normalized * (descriptor.maximum - descriptor.minimum);\n',
    "    case 'log':\n",
    '      return descriptor.minimum *\n',
    '        Math.pow(descriptor.maximum / descriptor.minimum, normalized);\n',
    "    case 'integer':\n",
    '      return descriptor.minimum + Math.round(normalized * descriptor.stepCount) * descriptor.step;\n',
    "    case 'bool':\n",
    '      return normalized >= 0.5;\n',
    "    case 'enum':\n",
    '      return descriptor.values[Math.round(normalized * descriptor.stepCount)];\n',
    "    default: throw new TypeError('Unknown DSP automation normalization');\n",
    '  }\n',
    '}\n'
  );
  return chunks.join('');
}

function jsForSpecs(specs) {
  const chunks = ['// Generated by scripts/gen-dsp-params.mjs. Do not edit.\n'];
  for (const spec of specs) {
    chunks.push(`export const ${spec.type}_PARAMS_HASH = ${hex32(spec.hash)};\n`);
    chunks.push(`export function pack${spec.type}Params(params = {}) {\n`);
    chunks.push(`  const packed = new Float32Array(${spec.floatCount});\n`);
    let offset = 0;
    for (const field of spec.fields) {
      for (let index = 0; index < field.count; ++index) {
        chunks.push(`  packed[${offset}] = ${jsReadExpression(field, index)};\n`);
        ++offset;
      }
    }
    chunks.push('  return packed;\n}\n\n');
    chunks.push(jsStructuredPacker(spec));
  }
  chunks.push('export const DSP_PARAM_LAYOUTS = Object.freeze({\n');
  for (const spec of specs) {
    const byteLayout = spec.structured ? `, byteCapacity: ${spec.byteCapacity}` : '';
    chunks.push(`  ${spec.type}: Object.freeze({ hash: ${spec.type}_PARAMS_HASH, floatCount: ${spec.floatCount}${byteLayout} }),\n`);
  }
  chunks.push('});\n\n');
  chunks.push('export const DSP_PARAM_PACKERS = new Map([\n');
  for (const spec of specs) {
    const bytePacker = spec.structured
      ? `, packBytes: pack${spec.type}ParamBytes, byteCapacity: ${spec.byteCapacity}`
      : '';
    chunks.push(`  [${jsLiteral(spec.type)}, Object.freeze({ pack: pack${spec.type}Params, hash: ${spec.type}_PARAMS_HASH, floatCount: ${spec.floatCount}${bytePacker} })],\n`);
  }
  chunks.push(']);\n\n');
  chunks.push(jsAutomationCatalog(specs));
  return chunks.join('');
}

export function generateOutputs(specs) {
  const outputs = new Map();
  for (const spec of specs) {
    outputs.set(path.join(cppOutputRoot, `${spec.type}Params.h`), cppForSpec(spec));
  }
  outputs.set(path.join(cppOutputRoot, 'AutomationCatalog.h'), cppAutomationCatalog(specs));
  outputs.set(runtimeJsOutput, jsForSpecs(specs.filter(spec => !spec.phase0)));
  return outputs;
}

function updateOutputs(outputs, check) {
  const stale = [];
  for (const [filePath, contents] of outputs) {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (current === contents) {
      continue;
    }
    stale.push(path.relative(repoRoot, filePath).replaceAll('\\', '/'));
    if (!check) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents, 'utf8');
    }
  }

  const desiredHeaders = new Set([...outputs.keys()].filter(file => file.endsWith('Params.h')));
  if (fs.existsSync(cppOutputRoot)) {
    for (const name of fs.readdirSync(cppOutputRoot).sort()) {
      const filePath = path.join(cppOutputRoot, name);
      if (name.endsWith('Params.h') && !desiredHeaders.has(filePath)) {
        stale.push(path.relative(repoRoot, filePath).replaceAll('\\', '/'));
        if (!check) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }
  return stale;
}

export function runGenerator({ check = false, root = pluginsRoot } = {}) {
  const specs = loadParamSpecs(root);
  const stale = updateOutputs(generateOutputs(specs), check);
  return { specs, stale };
}

function printHelp() {
  console.log('Usage: node scripts/gen-dsp-params.mjs [--check]');
  console.log('  default  validate params.json and update deterministic outputs');
  console.log('  --check  fail if generated outputs are stale; write nothing');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    printHelp();
    return;
  }
  const unknown = args.filter(arg => arg !== '--check');
  if (unknown.length !== 0) {
    fail(`unknown argument(s): ${unknown.join(', ')}`);
  }
  const check = args.includes('--check');
  const { specs, stale } = runGenerator({ check });
  if (check && stale.length !== 0) {
    console.error('DSP parameter outputs are stale:');
    stale.forEach(file => console.error(`  ${file}`));
    process.exitCode = 1;
    return;
  }
  console.log(`${check ? 'Checked' : 'Generated'} ${specs.length} DSP parameter layout(s).`);
}

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
