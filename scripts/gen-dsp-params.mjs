import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
const cppOutputRoot = path.join(repoRoot, 'dsp', 'generated', 'cpp');
const canonicalJsOutput = path.join(repoRoot, 'dsp', 'generated', 'js', 'dsp-params.generated.js');
const runtimeJsOutput = path.join(repoRoot, 'js', 'audio', 'dsp-params.generated.js');
const reservedKeys = new Set([
  'nm', 'en', 'uc', 'ib', 'ob', 'ch', 'type', 'id', 'enabled', 'inputBus',
  'outputBus', 'channel', 'channelCount', 'blockSize', 'sampleRate'
]);
const kinds = new Set(['float', 'int', 'bool', 'enum']);
const policies = new Set(['per-sample', 'spectral']);
const structuredCodecs = new Set(['matrix-routes-v1']);
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
  const packedKeys = new Set();
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

    floatCount += count;
    if (!Number.isSafeInteger(floatCount) || floatCount > 65536) {
      fail('packed parameter layout exceeds 65536 floats', source);
    }
    return {
      name,
      key: rawField.key ?? null,
      keys,
      arrayKey,
      objectArrayKey,
      memberKey,
      kind: rawField.kind,
      count,
      min: minimum,
      max: maximum,
      values,
      defaults
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

  return {
    type,
    tolerance: { abs, rel: raw.tolerance.rel ?? null, policy },
    fields,
    floatCount,
    structured,
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
  return specs.sort((left, right) => left.type.localeCompare(right.type, 'en'));
}

function hex32(value) {
  return `0x${value.toString(16).padStart(8, '0')}`;
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
    `    const input = inputText >= '0' && inputText <= '8' ? inputText.charCodeAt(0) - 48 : -1;\n` +
    `    const output = outputText >= '0' && outputText <= '8' ? outputText.charCodeAt(0) - 48 : -1;\n` +
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
    return `(() => { const index = ${values}.indexOf(${raw}); return index < 0 ? ${fallbackIndex} : index; })()`;
  }
  const fallbackLiteral = jsLiteral(fallback);
  const valid = field.kind === 'int'
    ? 'Number.isSafeInteger(value)'
    : "typeof value === 'number' && Number.isFinite(value)";
  return `(() => { const value = ${raw}; if (!(${valid})) return ${fallbackLiteral}; if (value < ${jsLiteral(field.min)}) return ${jsLiteral(field.min)}; if (value > ${jsLiteral(field.max)}) return ${jsLiteral(field.max)}; return value; })()`;
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
  chunks.push(']);\n');
  return chunks.join('');
}

export function generateOutputs(specs) {
  const outputs = new Map();
  for (const spec of specs) {
    outputs.set(path.join(cppOutputRoot, `${spec.type}Params.h`), cppForSpec(spec));
  }
  const js = jsForSpecs(specs);
  outputs.set(canonicalJsOutput, js);
  outputs.set(runtimeJsOutput, js);
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
