import { normalizeSfzPath } from './parser.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const legacy = new TextDecoder('windows-1252');

export function decodeSfzText(bytes) {
  try { return utf8.decode(bytes); }
  catch { return legacy.decode(bytes); }
}

function attributes(text) {
  const result = new Map();
  for (const match of text.matchAll(/\b([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (match[2] ?? match[3]).replace(/&(amp|quot|apos|lt|gt);/g,
      (_, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[entity]);
    result.set(match[1].toLowerCase(), value);
  }
  return result;
}

export async function readSfzBankDefines(selectedPath, bankPaths, readText) {
  const bankDirectory = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const candidates = bankPaths.filter(path => !bankDirectory(path) || selectedPath.startsWith(bankDirectory(path) + '/'))
    .sort((a, b) => bankDirectory(b).length - bankDirectory(a).length || a.localeCompare(b));
  for (const path of candidates) {
    const text = await readText(path);
    if (!text || !/<AriaBank\b/i.test(text)) continue;
    const directory = bankDirectory(path);
    const tags = [...text.matchAll(/<(AriaElement|Define)\b([^<>]*)>/gi)]
      .map(match => ({ name: match[1].toLowerCase(), values: attributes(match[2]) }));
    const registered = tags.some(tag => tag.name === 'ariaelement' && tag.values.has('path') &&
      normalizeSfzPath(tag.values.get('path'), directory).toLowerCase() === selectedPath.toLowerCase());
    // A bank can also ship usable SFZ programs omitted from its player menu.
    if (!registered && candidates.filter(candidate => bankDirectory(candidate) === directory).length !== 1) continue;
    const defines = new Map();
    for (const { name, values } of tags) {
      const key = values.get('name');
      let value = values.get('value');
      if (name !== 'define' || !/^\$[a-z0-9_]+$/i.test(key || '') || value === undefined) continue;
      if (key === '$sample_dir' && value.startsWith('$Banks/')) {
        // ARIA's registry points to the installed bank's sibling Samples folder.
        const sourceDirectory = selectedPath.split('/').slice(0, -1);
        const samples = normalizeSfzPath('Samples', directory).split('/');
        let common = 0;
        while (common < sourceDirectory.length && sourceDirectory[common] === samples[common]) common++;
        value = '../'.repeat(sourceDirectory.length - common) + samples.slice(common).join('/');
      }
      defines.set(key, value);
    }
    return { defines, bankPath: path };
  }
  return { defines: new Map() };
}
