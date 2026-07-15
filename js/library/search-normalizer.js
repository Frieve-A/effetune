const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;
const COMBINING_MARKS = /[\u0300-\u036f\u3099\u309a]/g;
const WHITESPACE = /\s+/g;
const TOKEN_CHARACTER = /[\p{L}\p{N}_]/u;

export function foldKana(text) {
  let output = '';
  for (const char of String(text || '')) {
    const code = char.charCodeAt(0);
    if (code >= KATAKANA_START && code <= KATAKANA_END) {
      output += String.fromCharCode(code - KATAKANA_TO_HIRAGANA_OFFSET);
    } else {
      output += char;
    }
  }
  return output;
}

export function normalizeSearchText(text = '') {
  return foldKana(String(text)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .normalize('NFC'))
    .replace(WHITESPACE, ' ')
    .trim();
}

export function tokenizeSearchQuery(query = '') {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

export function createCompactSearchText(values) {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.filter((value, index) => !unique.some((candidate, candidateIndex) => (
    candidateIndex !== index && candidate.length > value.length && containsAtTokenBoundaries(candidate, value)
  ))).join('\n');
}

function containsAtTokenBoundaries(candidate, value) {
  const first = Array.from(value)[0];
  const last = Array.from(value).at(-1);
  let offset = candidate.indexOf(value);
  while (offset !== -1) {
    const before = Array.from(candidate.slice(0, offset)).at(-1);
    const after = Array.from(candidate.slice(offset + value.length))[0];
    const startsAtBoundary = !TOKEN_CHARACTER.test(first) || !before || !TOKEN_CHARACTER.test(before);
    const endsAtBoundary = !TOKEN_CHARACTER.test(last) || !after || !TOKEN_CHARACTER.test(after);
    if (startsAtBoundary && endsAtBoundary) return true;
    offset = candidate.indexOf(value, offset + 1);
  }
  return false;
}

export function includesAllTokens(searchBlob, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const haystack = searchBlob || '';
  for (const token of tokens) {
    if (!haystack.includes(token)) return false;
  }
  return true;
}
