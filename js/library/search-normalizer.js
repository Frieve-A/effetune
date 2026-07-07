const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;
const COMBINING_MARKS = /[\u0300-\u036f\u3099\u309a]/g;
const WHITESPACE = /\s+/g;

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

export function includesAllTokens(searchBlob, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const haystack = searchBlob || '';
  for (const token of tokens) {
    if (!haystack.includes(token)) return false;
  }
  return true;
}
