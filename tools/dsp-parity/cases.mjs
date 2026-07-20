import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STIMULUS_IDS } from './stimuli.mjs';

export const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_BLOCK_SIZE = 128;

const CHANNEL_MODES = Object.freeze({
  stereo: { id: 'stereo', channels: 2, channel: null },
  mono: { id: 'mono', channels: 1, channel: 'L' },
  L: { id: 'mono', channels: 1, channel: 'L' },
  all4: { id: 'all4', channels: 4, channel: 'A' },
  A: { id: 'all4', channels: 4, channel: 'A' }
});

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readPluginManifest(repoRoot = DEFAULT_REPO_ROOT) {
  const manifestPath = path.join(repoRoot, 'plugins', 'plugins.txt');
  let source;
  try {
    source = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read plugin manifest at ${manifestPath}: ${error.message}`, { cause: error });
  }

  const plugins = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const match = /^([^:]+):\s*([^|]+)\|\s*([^|]+)\|\s*([^|\s]+)(?:\s*\|.*)?$/.exec(line);
    if (!match) continue;
    plugins.push({
      path: match[1].trim(),
      displayName: match[2].trim(),
      category: match[3].trim(),
      type: match[4].trim()
    });
  }
  return plugins;
}

export async function findPluginDefinition(typeOrName, repoRoot = DEFAULT_REPO_ROOT) {
  const plugins = await readPluginManifest(repoRoot);
  const definition = plugins.find(plugin =>
    plugin.type === typeOrName || plugin.displayName === typeOrName || plugin.path === typeOrName
  );
  if (definition) return definition;

  const dspRoot = path.join(repoRoot, 'dsp', 'plugins');
  const pending = [dspRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name === 'params.json') {
        const schema = JSON.parse(await fs.readFile(entryPath, 'utf8'));
        const relative = path.relative(dspRoot, path.dirname(entryPath)).split(path.sep).join('/');
        if (schema.type === typeOrName || relative === typeOrName) {
          return {
            path: relative,
            displayName: schema.type,
            category: relative.split('/')[0] ?? 'dsp',
            type: schema.type,
            dspOnly: true
          };
        }
      }
    }
  }
  throw new Error(
    `Plugin "${typeOrName}" is not registered in ${path.join(repoRoot, 'plugins', 'plugins.txt')} ` +
    'and has no DSP parameter schema'
  );
}

export async function findParamsSchema(type, repoRoot = DEFAULT_REPO_ROOT, explicitPath = null) {
  if (explicitPath) {
    const resolved = path.resolve(repoRoot, explicitPath);
    if (!await pathExists(resolved)) throw new Error(`DSP parameter schema not found: ${resolved}`);
    return resolved;
  }

  const definition = await findPluginDefinition(type, repoRoot);
  const conventional = path.join(repoRoot, 'dsp', 'plugins', ...definition.path.split('/'), 'params.json');
  if (await pathExists(conventional)) return conventional;

  const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
  if (!await pathExists(pluginsRoot)) return null;
  const pending = [pluginsRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.name === 'params.json') {
        const schema = JSON.parse(await fs.readFile(entryPath, 'utf8'));
        if (schema.type === type) return entryPath;
      }
    }
  }
  return null;
}

export async function readParamsSchema(schemaPath) {
  let schema;
  try {
    schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse DSP parameter schema ${schemaPath}: ${error.message}`, { cause: error });
  }
  if (!schema.type || !Array.isArray(schema.fields)) {
    throw new Error(`Invalid DSP parameter schema ${schemaPath}: expected "type" and "fields"`);
  }
  return schema;
}

function fieldKeys(field) {
  const count = field.count ?? 1;
  if (Array.isArray(field.keys)) {
    if (field.keys.length !== count) throw new Error(`Field ${field.name} has ${field.keys.length} keys for count ${count}`);
    return field.keys;
  }
  const key = field.key ?? field.name;
  return count === 1 ? [key] : Array.from({ length: count }, (_, index) => `${key}${index}`);
}

function fieldDefaults(field) {
  const count = field.count ?? 1;
  return Array.isArray(field.default)
    ? field.default
    : Array.from({ length: count }, () => field.default);
}

export function defaultParamsFromSchema(schema) {
  const params = {};
  for (const field of schema.fields) {
    const values = fieldDefaults(field);
    if (field.objectArrayKey) {
      const count = field.count ?? 1;
      params[field.objectArrayKey] ??= Array.from({ length: count }, () => ({}));
      for (let index = 0; index < count; index++) {
        params[field.objectArrayKey][index][field.memberKey] = values[index];
      }
      continue;
    }
    if (field.arrayKey) {
      params[field.arrayKey] = [...values];
      continue;
    }
    const keys = fieldKeys(field);
    for (let index = 0; index < keys.length; index++) params[keys[index]] = values[index];
  }
  if (schema.structured) params[schema.structured.key] = schema.structured.default;
  return params;
}

function midpoint(field) {
  if (field.kind === 'int') return Math.round((field.min + field.max) / 2);
  return (field.min + field.max) / 2;
}

function variantsForField(field) {
  if (field.kind === 'enum') return field.values.map(value => ({ label: String(value), value }));
  if (field.kind === 'bool') return [{ label: 'false', value: false }, { label: 'true', value: true }];
  if (Number.isFinite(field.min) && Number.isFinite(field.max)) {
    return [
      { label: 'min', value: field.min },
      { label: 'mid', value: midpoint(field) },
      { label: 'max', value: field.max }
    ];
  }
  return [];
}

function withFieldValue(defaults, field, value) {
  const params = { ...defaults };
  if (field.objectArrayKey) {
    const count = field.count ?? 1;
    const source = Array.isArray(defaults[field.objectArrayKey])
      ? defaults[field.objectArrayKey]
      : [];
    params[field.objectArrayKey] = Array.from({ length: count }, (_, index) => ({
      ...(source[index] ?? {}),
      [field.memberKey]: value
    }));
    return params;
  }
  if (field.arrayKey) {
    params[field.arrayKey] = Array(field.count ?? 1).fill(value);
    return params;
  }
  for (const key of fieldKeys(field)) params[key] = value;
  return params;
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'case';
}

export function buildDefaultCaseMatrix(schema, {
  sampleRate = 48000,
  fullFrames = sampleRate,
  shortFrames = Math.round(sampleRate * 0.25),
  stimuli = STIMULUS_IDS,
  blockSize = DEFAULT_BLOCK_SIZE
} = {}) {
  const defaults = defaultParamsFromSchema(schema);
  const cases = stimuli.map(stimulus => ({
    id: `default-${stimulus}`,
    stimulus,
    sampleRate,
    frames: fullFrames,
    channels: 2,
    channelMode: 'stereo',
    channel: null,
    blockSize,
    params: { ...defaults },
    fullLength: true
  }));

  for (const field of schema.fields) {
    for (const variant of variantsForField(field)) {
      for (const mode of [CHANNEL_MODES.stereo, CHANNEL_MODES.mono, CHANNEL_MODES.all4]) {
        cases.push({
          id: `${slug(field.name)}-${slug(variant.label)}-${mode.id}`,
          stimulus: 'noise',
          sampleRate,
          frames: shortFrames,
          channels: mode.channels,
          channelMode: mode.id,
          channel: mode.channel,
          blockSize,
          params: withFieldValue(defaults, field, variant.value),
          fullLength: false
        });
      }
    }
  }
  return cases.map((item, caseIndex) => ({ ...item, caseIndex }));
}

function resolveChannelMode(value, channels) {
  if (value && CHANNEL_MODES[value]) return CHANNEL_MODES[value];
  if (channels === 1) return CHANNEL_MODES.mono;
  if (channels === 4) return CHANNEL_MODES.all4;
  return { ...CHANNEL_MODES.stereo, channels: channels ?? 2 };
}

function expandCustomCase(rawCase, defaults, configDefaults, caseIndex) {
  const sampleRate = rawCase.sampleRate ?? configDefaults.sampleRate ?? 48000;
  const mode = resolveChannelMode(rawCase.channelMode ?? rawCase.channel, rawCase.channels);
  const fullLength = rawCase.fullLength ?? false;
  const frames = rawCase.frames ?? Math.round(sampleRate * (fullLength ? 1 : 0.25));
  return {
    ...configDefaults,
    ...rawCase,
    id: rawCase.id ?? `custom-${String(caseIndex + 1).padStart(3, '0')}`,
    stimulus: rawCase.stimulus ?? configDefaults.stimulus ?? 'noise',
    sampleRate,
    frames,
    channels: rawCase.channels ?? mode.channels,
    channelMode: rawCase.channelMode ?? mode.id,
    channel: rawCase.channel ?? mode.channel,
    blockSize: rawCase.blockSize ?? configDefaults.blockSize ?? DEFAULT_BLOCK_SIZE,
    params: { ...defaults, ...(configDefaults.params ?? {}), ...(rawCase.params ?? {}) },
    caseIndex
  };
}

export async function loadCaseMatrix(schema, schemaPath, options = {}) {
  const defaultCasesPath = path.join(path.dirname(schemaPath), 'cases.json');
  const casesPath = options.casesPath ? path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT, options.casesPath) : defaultCasesPath;
  if (!await pathExists(casesPath)) return buildDefaultCaseMatrix(schema, options);

  let config;
  try {
    config = JSON.parse(await fs.readFile(casesPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse case matrix ${casesPath}: ${error.message}`, { cause: error });
  }
  const rawCases = Array.isArray(config) ? config : config.cases;
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error(`Case matrix ${casesPath} must contain a non-empty cases array`);
  }
  const configDefaults = Array.isArray(config) ? {} : (config.defaults ?? {});
  const defaults = defaultParamsFromSchema(schema);
  const expanded = [];
  for (const rawCase of rawCases) {
    const sampleRateDefaults = !Array.isArray(config) && config.sampleRateSensitive
      ? [44100, 48000, 96000, 192000]
      : [rawCase.sampleRate ?? configDefaults.sampleRate ?? 48000];
    const sampleRates = rawCase.sampleRates ?? configDefaults.sampleRates ?? sampleRateDefaults;
    for (const sampleRate of sampleRates) {
      const testCase = expandCustomCase({ ...rawCase, sampleRate }, defaults, configDefaults, expanded.length);
      const parity = rawCase.parity ?? configDefaults.parity ?? (!Array.isArray(config) ? config.parity : null);
      if (parity) {
        testCase.tolerance = { ...(schema.tolerance ?? {}), ...(testCase.tolerance ?? {}), policy: parity };
      }
      expanded.push(testCase);
    }
  }
  return expanded;
}

export function validateCase(testCase) {
  if (!STIMULUS_IDS.includes(testCase.stimulus)) throw new Error(`Case ${testCase.id} has unknown stimulus ${testCase.stimulus}`);
  for (const key of ['sampleRate', 'frames', 'channels', 'blockSize']) {
    if (!Number.isInteger(testCase[key]) || testCase[key] <= 0) throw new Error(`Case ${testCase.id} has invalid ${key}: ${testCase[key]}`);
  }
  return testCase;
}

export async function discoverCasePlan({
  type,
  repoRoot = DEFAULT_REPO_ROOT,
  schemaPath = null,
  casesPath = null,
  ...matrixOptions
}) {
  const definition = await findPluginDefinition(type, repoRoot);
  const resolvedSchemaPath = await findParamsSchema(definition.type, repoRoot, schemaPath);
  if (!resolvedSchemaPath) return { definition, schema: null, schemaPath: null, cases: [] };
  const schema = await readParamsSchema(resolvedSchemaPath);
  if (schema.type !== definition.type) {
    throw new Error(`Schema type ${schema.type} does not match registered type ${definition.type}`);
  }
  const cases = await loadCaseMatrix(schema, resolvedSchemaPath, { repoRoot, casesPath, ...matrixOptions });
  cases.forEach(validateCase);
  return { definition, schema, schemaPath: resolvedSchemaPath, cases };
}
