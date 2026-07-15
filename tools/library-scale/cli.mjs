import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === 'help' || name === 'json' || name === 'write' || name === 'keep') {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`Missing value for --${name}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return importMetaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}

export function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export function printResult(result, { json = false, output = console } = {}) {
  if (json) {
    output.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const [key, value] of Object.entries(result)) {
    output.log(`${key}: ${value}`);
  }
}
