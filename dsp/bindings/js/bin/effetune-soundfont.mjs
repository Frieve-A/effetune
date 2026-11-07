#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { prepareSoundFont } from '../dist/soundfont.js';

const usage = 'Usage: effetune-soundfont prepare <in.sf2|in.sfz> <out.etsf> [--root <folder>] [--max-bytes <bytes>]';
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args.splice(index, 2)[1] ?? '';
};
const maxBytes = option('--max-bytes'), root = option('--root');
const [command, input, output] = args;

if (command !== 'prepare' || !input || !output || args.length !== 3 || root === '') {
  console.error(usage);
  process.exit(2);
}
try {
  const bank = await prepareSoundFont(input, { maxBytes: maxBytes === undefined ? undefined : Number(maxBytes), root });
  await writeFile(output, bank.toBytes());
  console.log(`Wrote ${output} (${bank.pages.length} resident sample pages).`);
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
