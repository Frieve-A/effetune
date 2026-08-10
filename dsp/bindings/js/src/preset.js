import { getEffectCatalog, getEffectImplementation } from './catalog.js';
import { normalizeChainDocument } from './semantics.js';
import { EffectError, ValidationError } from './errors.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value, label) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ValidationError(`${label} is not valid JSON.`, { cause: error });
  }
}

// App display names whose alphanumeric normalization cannot reach the semantic type
// or the internal type (leading digits instead of spelled-out numbers). Keys are the
// exact display names produced by the app's plugin constructors; the Python binding
// keeps the same table in dsp/bindings/python/src/effetune/presets.py and both are
// pinned to dsp/bindings/common/legacy-app-export-v1.fixture.json.
export const LEGACY_EFFECT_ALIASES_V1 = Object.freeze({
  '5Band PEQ': 'FiveBandPEQ',
  '15Band GEQ': 'FifteenBandGEQ',
  '15Band PEQ': 'FifteenBandPEQ',
  '5Band Dynamic EQ': 'FiveBandDynamicEQ',
  '5Band FIR PEQ': 'FiveBandFIRPEQ'
});

const SHORT_FORMAT_GUIDANCE_V1 =
  "short-format presets shared through the EffeTune app's URL or clipboard are not " +
  'supported. Export a .effetune_preset file (long format) from the app and import ' +
  'that instead.';

function rejectShortFormat(label) {
  throw new ValidationError(`${label} uses short-format keys (nm/en); ${SHORT_FORMAT_GUIDANCE_V1}`);
}

export function parsePreset(value) {
  // App preset envelopes are reported by normalizeChainDocument so that createChain
  // and the AudioWorklet loader give the same guidance from a single implementation.
  return normalizeChainDocument(parseJson(value, 'Preset'));
}

function legacyChannel(value) {
  if (value === undefined || value === null || value === '') return 'stereo';
  const mapping = {
    A: 'all',
    All: 'all',
    all: 'all',
    L: 'left',
    Left: 'left',
    left: 'left',
    R: 'right',
    Right: 'right',
    right: 'right',
    stereo: 'stereo'
  };
  const normalized = mapping[value] ?? value;
  if (['1', '2', '3', '4', '5', '6', '7', '8', '34', '56', '78'].includes(normalized)) {
    return normalized;
  }
  if (['all', 'stereo', 'left', 'right'].includes(normalized)) return normalized;
  throw new ValidationError(`Unsupported legacy channel: ${String(value)}`);
}

function reverseTransform(transform, value) {
  const kind = transform?.kind ?? 'identity';
  if (kind === 'naturalLog' || kind === 'log10' || kind === 'decibelsFromReference') {
    // These inverse transforms are arithmetic, and JavaScript coerces its way into a
    // number for values the app never wrote: null and [] become 0, true becomes 1. Some
    // of those land inside the parameter's accepted range, so without this guard the
    // import would silently invent a setting. The Python binding rejects the same values
    // in effetune.presets._legacy_parameters.
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError('A legacy parameter value is not a finite number.');
    }
  }
  switch (kind) {
    case 'identity':
      return value;
    case 'naturalLog':
      return Math.exp(value);
    case 'log10':
      return 10 ** value;
    case 'decibelsFromReference':
      return transform.reference * (10 ** (value / 20));
    case 'map': {
      const mapped = transform.values.find(entry => Object.is(entry.internal, value));
      if (!mapped) throw new ValidationError('A legacy parameter value cannot be converted.');
      return mapped.public;
    }
    default:
      throw new ValidationError(`Unsupported legacy transform: ${String(transform?.kind)}`);
  }
}

function buildTypeLookup() {
  const lookup = new Map();
  for (const effect of getEffectCatalog().effects) {
    const normalized = effect.type.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const implementation = getEffectImplementation(effect.type);
    lookup.set(effect.type, effect);
    lookup.set(implementation.internalType, effect);
    lookup.set(normalized, effect);
    lookup.set(implementation.internalType.replace(/[^a-z0-9]/gi, '').toLowerCase(), effect);
  }
  for (const [displayName, type] of Object.entries(LEGACY_EFFECT_ALIASES_V1)) {
    const effect = lookup.get(type);
    if (!effect) throw new EffectError(`Unsupported legacy effect alias target: ${type}`);
    lookup.set(displayName, effect);
  }
  return lookup;
}

function resolveLegacyType(value, lookup) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('Legacy effect entry is missing its name.');
  }
  const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const effect = lookup.get(value) ?? lookup.get(normalized);
  if (!effect) throw new EffectError(`Unsupported legacy effect: ${value}`);
  return effect;
}

// Reject app presets for effects the library drives from a precomputed asset. These
// effects replace the app's filter-design parameters with an impulse response supplied
// by the caller, so an app export carries nothing convertible: reporting the app's
// parameters as unsupported fields would read like a typo report instead of the
// structural limit it is. The set is derived from the generated catalog's required
// assets rather than a second hardcoded table. The Python binding keeps the same rule
// in effetune.presets._reject_asset_backed_legacy_effect_v1 -- same error type, same
// message -- and both are pinned to
// dsp/bindings/common/legacy-app-export-v1.fixture.json.
function rejectAssetBackedLegacyEffectV1(definition) {
  if (!(definition.assets ?? []).some(asset => asset.required)) return;
  throw new EffectError(
    `${definition.type} cannot be imported from an EffeTune app preset: in the DSP ` +
    'library this effect is driven by a precomputed impulse-response asset, and ' +
    "the app's filter-design parameters cannot be converted. Construct the effect " +
    'directly and supply its impulse-response asset instead.'
  );
}

// The app stores a few effects' per-band settings as an array of objects instead of
// the flat numbered keys every other effect uses. Expanding them here keeps the rest
// of the importer working on a single shape. The Python binding keeps the same table
// in effetune.presets._prepare_legacy_parameters_v1 and both are pinned to
// dsp/bindings/common/legacy-app-export-v1.fixture.json.
const LEGACY_OBJECT_ARRAYS_V1 = Object.freeze({
  MultibandCompressor: Object.freeze({
    effectLabel: 'Multiband Compressor',
    arrayKey: 'bands',
    count: 5,
    members: Object.freeze({
      t: 'threshold',
      r: 'ratio',
      a: 'attack',
      rl: 'release',
      k: 'knee',
      g: 'gain'
    }),
    // The app also persists the band meter readout; it is display state, not a
    // processing parameter, so it is accepted and discarded.
    allowMeterState: true
  }),
  MultibandExpander: Object.freeze({
    effectLabel: 'Multiband Expander',
    arrayKey: 'bands',
    count: 5,
    members: Object.freeze({
      t: 'threshold',
      r: 'ratio',
      a: 'attack',
      rl: 'release',
      k: 'knee',
      g: 'gain'
    })
  }),
  MultibandTransient: Object.freeze({
    effectLabel: 'Multiband Transient',
    arrayKey: 'bands',
    count: 3,
    members: Object.freeze({
      fa: 'fastAttack',
      fr: 'fastRelease',
      sa: 'slowAttack',
      sr: 'slowRelease',
      gt: 'transientGain',
      gs: 'sustainGain',
      sm: 'gainSmoothing'
    })
  }),
  MultibandBalance: Object.freeze({
    effectLabel: 'Multiband Balance',
    arrayKey: 'bands',
    count: 5,
    members: Object.freeze({ balance: 'balance' })
  }),
  MultibandSaturation: Object.freeze({
    effectLabel: 'Multiband Saturation',
    arrayKey: 'bands',
    count: 3,
    members: Object.freeze({ dr: 'drive', bs: 'bias', mx: 'mix', gn: 'gain' })
  }),
  FiveBandDynamicEQ: Object.freeze({
    effectLabel: '5Band Dynamic EQ',
    arrayKey: 'bs',
    count: 5,
    members: Object.freeze({
      en: 'enabledBands',
      ft: 'filterType',
      f: 'frequency',
      q: 'q',
      mg: 'maxGain',
      th: 'threshold',
      r: 'ratio',
      kn: 'knee',
      a: 'attack',
      rl: 'release',
      scf: 'sidechainFrequency',
      scq: 'sidechainQ'
    })
  }),
  ModalResonator: Object.freeze({
    effectLabel: 'Modal Resonator',
    arrayKey: 'rs',
    count: 5,
    members: Object.freeze({
      en: 'resonatorEnabled',
      fr: 'frequencyLog',
      dc: 'decay',
      lp: 'lowPassLog',
      hp: 'highPassLog',
      gn: 'gain'
    }),
    itemLabel: 'resonator'
  })
});

// The app's serializer copies structural values into the parameters object it
// exports: plugin-base.js getSerializableParameters() re-emits the assigned channel
// and bus indexes under their short names, and a few plugins add their class name
// under `pluginType`. Every one of them duplicates a value the surrounding node
// already carries, which stays the source of truth, so they are dropped instead of
// being reported as unknown parameters. The Python binding keeps the same table in
// effetune.presets._LEGACY_ECHOED_STRUCTURAL_KEYS_V1.
const LEGACY_ECHOED_STRUCTURAL_KEYS_V1 = Object.freeze(['pluginType', 'ch', 'ib', 'ob']);

// Horn Resonator and Horn Resonator Plus additionally echo the node's enabled switch
// into their parameters. Unlike Modal Resonator's `en` -- an independent processing
// switch the importer folds into `enabled` -- it is a plain duplicate, so it is
// dropped for these two effects only.
const LEGACY_ECHOED_ENABLED_EFFECTS_V1 = Object.freeze(['HornResonator', 'HornResonatorPlus']);

// These analyzers persist their frequency-axis choice for display only. Validate
// the known values before discarding it so other unknown parameters remain strict.
const LEGACY_FREQUENCY_SCALE_EFFECTS_V1 = Object.freeze(['SpectrumAnalyzer', 'Spectrogram']);

function dropEchoedStructuralKeysV1(parameters, effectType) {
  for (const key of LEGACY_ECHOED_STRUCTURAL_KEYS_V1) delete parameters[key];
  if (LEGACY_ECHOED_ENABLED_EFFECTS_V1.includes(effectType)) delete parameters.en;
  return parameters;
}

// A few effects store a fixed-length per-channel setting as one short key holding the
// whole array instead of the numbered keys every other effect uses. The array length
// itself is checked by the shared chain-document validation. The Python binding keeps
// the same table in effetune.presets._prepare_legacy_parameters_v1.
const LEGACY_SHORT_KEY_ARRAYS_V1 = Object.freeze({
  MultiChannelPanel: Object.freeze({
    effectLabel: 'MultiChannel Panel',
    itemLabel: 'channel',
    members: Object.freeze({ m: 'mute', s: 'solo', v: 'volume', d: 'delay', l: 'link' })
  })
});

function expandLegacyShortKeyArraysV1(parameters, { effectLabel, itemLabel, members }) {
  for (const [legacyName, publicName] of Object.entries(members)) {
    if (!Object.hasOwn(parameters, legacyName)) continue;
    if (Object.hasOwn(parameters, publicName)) {
      throw new ValidationError(
        `Legacy ${effectLabel} supplies the same ${itemLabel} settings more than once.`
      );
    }
    const values = parameters[legacyName];
    delete parameters[legacyName];
    if (!Array.isArray(values)) {
      throw new ValidationError(
        `Legacy ${effectLabel} contains unsupported or incomplete ${itemLabel} settings.`
      );
    }
    parameters[publicName] = values;
  }
}

function expandLegacyObjectArrayV1(parameters, {
  effectLabel,
  arrayKey,
  count,
  members,
  itemLabel = 'band',
  allowMeterState = false
}) {
  if (!Object.hasOwn(parameters, arrayKey)) return;
  const values = parameters[arrayKey];
  delete parameters[arrayKey];
  if (!Array.isArray(values) || values.length !== count) {
    throw new ValidationError(
      `Legacy ${effectLabel} must contain exactly ${count} ${itemLabel} settings.`
    );
  }
  const publicNames = Object.values(members);
  if (publicNames.some(name => Object.hasOwn(parameters, name))) {
    throw new ValidationError(
      `Legacy ${effectLabel} supplies the same ${itemLabel} settings more than once.`
    );
  }
  const expanded = new Map(publicNames.map(name => [name, []]));
  const required = Object.keys(members);
  const allowed = new Set(allowMeterState ? [...required, 'gr'] : required);
  for (const value of values) {
    if (!isRecord(value) ||
        Object.keys(value).some(key => !allowed.has(key)) ||
        required.some(key => !Object.hasOwn(value, key))) {
      throw new ValidationError(
        `Legacy ${effectLabel} contains unsupported or incomplete ${itemLabel} settings.`
      );
    }
    for (const [legacyName, publicName] of Object.entries(members)) {
      expanded.get(publicName).push(value[legacyName]);
    }
    if (Object.hasOwn(value, 'gr') &&
        (typeof value.gr !== 'number' || !Number.isFinite(value.gr))) {
      throw new ValidationError(
        `Legacy ${effectLabel} contains invalid meter display state.`
      );
    }
  }
  for (const [name, collected] of expanded) parameters[name] = collected;
}

function prepareLegacyParametersV1(effectType, source) {
  const parameters = dropEchoedStructuralKeysV1({ ...source }, effectType);
  if (LEGACY_FREQUENCY_SCALE_EFFECTS_V1.includes(effectType) &&
      Object.hasOwn(parameters, 'sc')) {
    if (parameters.sc !== 'log' && parameters.sc !== 'linear') {
      throw new ValidationError(`Legacy ${effectType} contains invalid frequency scale display state.`);
    }
    delete parameters.sc;
  }
  let processingEnabled = true;
  if (effectType === 'Matrix' && Object.hasOwn(parameters, 'mx')) {
    if (Object.hasOwn(parameters, 'matrixRoutes')) {
      throw new ValidationError('Legacy Matrix supplies routing settings more than once.');
    }
    parameters.matrixRoutes = parameters.mx;
    delete parameters.mx;
    return { parameters, processingEnabled };
  }
  if (Object.hasOwn(LEGACY_SHORT_KEY_ARRAYS_V1, effectType)) {
    expandLegacyShortKeyArraysV1(parameters, LEGACY_SHORT_KEY_ARRAYS_V1[effectType]);
    return { parameters, processingEnabled };
  }
  const objectArray = Object.hasOwn(LEGACY_OBJECT_ARRAYS_V1, effectType)
    ? LEGACY_OBJECT_ARRAYS_V1[effectType]
    : null;
  if (!objectArray) return { parameters, processingEnabled };
  expandLegacyObjectArrayV1(parameters, objectArray);
  if (effectType === 'ModalResonator') {
    // The app persists the whole effect's bypass switch and the editor's selected
    // resonator alongside the processing parameters.
    if (Object.hasOwn(parameters, 'en')) {
      processingEnabled = parameters.en;
      delete parameters.en;
      if (typeof processingEnabled !== 'boolean') {
        throw new ValidationError('Legacy Modal Resonator processing state must be a boolean.');
      }
    }
    if (Object.hasOwn(parameters, 'sr')) {
      const selection = parameters.sr;
      delete parameters.sr;
      if (!Number.isInteger(selection) || selection < 0 || selection >= 5) {
        throw new ValidationError(
          'Legacy Modal Resonator editor selection must be an integer from 0 to 4.'
        );
      }
    }
  }
  return { parameters, processingEnabled };
}

function legacyParameters(definition, implementation, source) {
  if (!isRecord(source)) throw new ValidationError(`${definition.type} legacy parameters must be an object.`);
  const consumed = new Set();
  const output = {};
  for (const parameter of definition.parameters) {
    if (Object.hasOwn(source, parameter.name)) {
      output[parameter.name] = source[parameter.name];
      consumed.add(parameter.name);
      continue;
    }
    const mapping = implementation.packedParameters.find(entry => entry.publicName === parameter.name);
    if (!mapping) continue;
    if (mapping.count === 1) {
      const key = [mapping.field, ...mapping.keys].find(candidate => Object.hasOwn(source, candidate));
      if (key !== undefined) {
        output[parameter.name] = reverseTransform(mapping.transform, source[key]);
        consumed.add(key);
      }
    } else {
      const field = source[mapping.field];
      if (Array.isArray(field)) {
        output[parameter.name] = field.map(value => reverseTransform(mapping.transform, value));
        consumed.add(mapping.field);
      } else if (mapping.keys.every(key => Object.hasOwn(source, key))) {
        output[parameter.name] = mapping.keys.map(key => {
          consumed.add(key);
          return reverseTransform(mapping.transform, source[key]);
        });
      }
    }
  }
  const ignored = new Set(['type', 'id', 'enabled', 'inputBus', 'outputBus', 'channel']);
  for (const key of Object.keys(source)) {
    if (!consumed.has(key) && !ignored.has(key)) {
      throw new ValidationError(`Unsupported legacy parameter ${definition.type}.${key}.`);
    }
  }
  return output;
}

export function importLegacyPreset(value) {
  let preset = parseJson(value, 'Legacy preset');
  if (Array.isArray(preset)) {
    // The app still loads a preset file whose top level is a bare array of
    // long-format entries as the pipeline (js/electron/presetIntegration.js and
    // js/app.js), so files in that shape exist in the wild. A bare array of
    // short-format entries keeps the existing guidance instead. The first entry that
    // is an object decides, exactly like the Python binding.
    const first = preset.find(entry => isRecord(entry));
    if (first && Object.hasOwn(first, 'nm') && !Object.hasOwn(first, 'name')) {
      rejectShortFormat('Legacy preset');
    }
    preset = { pipeline: preset };
  }
  if (!isRecord(preset)) throw new ValidationError('Legacy preset must be an object.');
  const hasLong = Array.isArray(preset.pipeline);
  const hasShort = Array.isArray(preset.plugins);
  if (hasLong === hasShort) {
    throw new ValidationError('Legacy preset must contain exactly one pipeline or plugins array.');
  }
  const allowedTop = new Set(['name', 'timestamp', hasLong ? 'pipeline' : 'plugins']);
  for (const key of Object.keys(preset)) {
    if (!allowedTop.has(key)) throw new ValidationError(`Unsupported legacy preset field: ${key}`);
  }

  const lookup = buildTypeLookup();
  const entries = [];
  let sectionEnabled = true;
  for (const [index, entry] of (hasLong ? preset.pipeline : preset.plugins).entries()) {
    if (!isRecord(entry)) throw new ValidationError(`Legacy entry ${index} must be an object.`);
    const allowedEntry = new Set(hasLong
      ? ['id', 'name', 'enabled', 'parameters', 'inputBus', 'outputBus', 'channel']
      : ['nm', 'en', 'ib', 'ob', 'ch']);
    if (hasLong) {
      if (Object.hasOwn(entry, 'nm') && !Object.hasOwn(entry, 'name')) {
        rejectShortFormat(`Legacy pipeline[${index}]`);
      }
      for (const key of Object.keys(entry)) {
        if (!allowedEntry.has(key)) {
          throw new ValidationError(`Unsupported legacy effect field: ${key}`);
        }
      }
    }
    const name = hasLong ? entry.name : entry.nm;
    const inputBus = hasLong ? entry.inputBus : entry.ib;
    const outputBus = hasLong ? entry.outputBus : entry.ob;
    if ((inputBus !== undefined && inputBus !== 0) ||
        (outputBus !== undefined && outputBus !== 0)) {
      throw new ValidationError(`Legacy entry ${index} uses bus routing that a serial chain cannot represent.`);
    }
    // A non-string name is not a Section: leave it to resolveLegacyType so it is
    // reported as a missing name instead of escaping as a raw TypeError.
    if (typeof name === 'string' && name.replace(/[^a-z0-9]/gi, '').toLowerCase() === 'section') {
      const sectionParameters = hasLong ? entry.parameters ?? {} : entry;
      if (!isRecord(sectionParameters)) {
        throw new ValidationError('Legacy Section parameters must be an object.');
      }
      const structural = hasLong
        ? new Set()
        : new Set(['nm', 'en', 'ib', 'ob', 'ch']);
      for (const key of Object.keys(sectionParameters)) {
        if (!structural.has(key) &&
            !['cm', 'comment'].includes(key) &&
            !LEGACY_ECHOED_STRUCTURAL_KEYS_V1.includes(key)) {
          throw new ValidationError(`Unsupported legacy Section parameter: ${key}`);
        }
      }
      const enabled = (hasLong ? entry.enabled : entry.en) ?? true;
      if (typeof enabled !== 'boolean') {
        throw new ValidationError('Legacy Section enabled must be boolean.');
      }
      sectionEnabled = enabled;
      continue;
    }
    const definition = resolveLegacyType(name, lookup);
    rejectAssetBackedLegacyEffectV1(definition);
    const implementation = getEffectImplementation(definition.type);
    const source = hasLong
      ? entry.parameters ?? {}
      : Object.fromEntries(Object.entries(entry).filter(([key]) =>
          !['nm', 'en', 'ib', 'ob', 'ch'].includes(key)
        ));
    if (!isRecord(source)) {
      throw new ValidationError(`Legacy ${definition.type} parameters must be an object.`);
    }
    const { parameters, processingEnabled } = prepareLegacyParametersV1(definition.type, source);
    entries.push({
      ...(hasLong && entry.id !== undefined ? { id: entry.id } : {}),
      type: definition.type,
      enabled: ((hasLong ? entry.enabled : entry.en) ?? true) && sectionEnabled && processingEnabled,
      channel: legacyChannel(hasLong ? entry.channel : entry.ch),
      parameters: legacyParameters(definition, implementation, parameters)
    });
  }
  return normalizeChainDocument({ version: 1, chain: entries });
}
