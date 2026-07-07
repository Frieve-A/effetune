const LEGACY_METADATA_ENCODINGS = Object.freeze([
  { label: 'utf-8', script: 'unicode', minChars: 0 },
  { label: 'shift_jis', script: 'japanese', minChars: 2 },
  { label: 'euc-jp', script: 'japanese', minChars: 2 },
  { label: 'iso-2022-jp', script: 'japanese', minChars: 2 },
  { label: 'gbk', script: 'cjk', minChars: 2 },
  { label: 'gb18030', script: 'cjk', minChars: 2 },
  { label: 'big5', script: 'cjk', minChars: 2 },
  { label: 'euc-kr', script: 'hangul', minChars: 2 }
]);

const LANGUAGE_SPECIFIC_METADATA_ENCODINGS = Object.freeze([
  { label: 'windows-1251', script: 'cyrillic', minChars: 4, languages: ['ru', 'uk', 'bg', 'sr', 'mk', 'be'] },
  { label: 'koi8-r', script: 'cyrillic', minChars: 4, languages: ['ru', 'bg', 'sr', 'mk', 'be'] },
  { label: 'koi8-u', script: 'cyrillic', minChars: 4, languages: ['uk'] },
  { label: 'iso-8859-5', script: 'cyrillic', minChars: 4, languages: ['ru', 'uk', 'bg', 'sr', 'mk', 'be'] },
  { label: 'windows-1253', script: 'greek', minChars: 4, languages: ['el'] },
  { label: 'iso-8859-7', script: 'greek', minChars: 4, languages: ['el'] },
  { label: 'windows-1255', script: 'hebrew', minChars: 4, languages: ['he', 'iw'] },
  { label: 'iso-8859-8', script: 'hebrew', minChars: 4, languages: ['he', 'iw'] },
  { label: 'windows-1256', script: 'arabic', minChars: 4, languages: ['ar', 'fa', 'ur'] },
  { label: 'iso-8859-6', script: 'arabic', minChars: 4, languages: ['ar'] },
  { label: 'windows-874', script: 'thai', minChars: 4, languages: ['th'] }
]);

const LANGUAGE_SCRIPT_BY_CODE = Object.freeze({
  ar: 'arabic',
  be: 'cyrillic',
  bg: 'cyrillic',
  el: 'greek',
  fa: 'arabic',
  he: 'hebrew',
  hi: 'devanagari',
  iw: 'hebrew',
  ja: 'japanese',
  ko: 'hangul',
  mk: 'cyrillic',
  ru: 'cyrillic',
  sr: 'cyrillic',
  th: 'thai',
  uk: 'cyrillic',
  ur: 'arabic',
  zh: 'cjk'
});

const WINDOWS_1252_BYTES = new Map([
  ['\u20AC', 0x80],
  ['\u201A', 0x82],
  ['\u0192', 0x83],
  ['\u201E', 0x84],
  ['\u2026', 0x85],
  ['\u2020', 0x86],
  ['\u2021', 0x87],
  ['\u02C6', 0x88],
  ['\u2030', 0x89],
  ['\u0160', 0x8a],
  ['\u2039', 0x8b],
  ['\u0152', 0x8c],
  ['\u017D', 0x8e],
  ['\u2018', 0x91],
  ['\u2019', 0x92],
  ['\u201C', 0x93],
  ['\u201D', 0x94],
  ['\u2022', 0x95],
  ['\u2013', 0x96],
  ['\u2014', 0x97],
  ['\u02DC', 0x98],
  ['\u2122', 0x99],
  ['\u0161', 0x9a],
  ['\u203A', 0x9b],
  ['\u0153', 0x9c],
  ['\u017E', 0x9e],
  ['\u0178', 0x9f]
]);

const ISO_2022_JP_ESCAPE = String.fromCharCode(0x1b);
const WINDOWS_1252_MARKER_PATTERN = /[\u0080-\u009F\u0192\u201A\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018-\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;
const UTF8_MOJIBAKE_SEQUENCE_PATTERN = /(?:[ÃÂ][\u0080-\u00BF\u00A0-\u00BF]|â[\u0080-\u009F\u201A-\u201E\u20AC\u2122]|ã[\u0080-\u009F\u201A-\u201E])/g;
const LATIN1_SYMBOL_PATTERN = /[\u00A1-\u00BF\u00D7\u00F7]/;
const REPLACEMENT_CHAR_PATTERN = /\uFFFD/;
const TEXT_DECODERS = new Map();

export function repairLegacyMetadataMojibake(text, languageHints = null) {
  if (typeof text !== 'string' || text === '') return text;
  const originalScore = scoreDecodedText(text);
  if (!mayContainLegacyMetadataMojibake(text, originalScore)) return text;

  const bytes = recoverSingleByteText(text);
  if (!bytes) return text;

  const languageCodes = getLanguageCodes(languageHints);
  const languageScripts = getLanguageScripts(languageCodes);
  let bestText = text;
  let bestScore = originalScore;
  let bestRepairScore = 0;
  let bestEncodingScript = null;

  for (const encoding of getLegacyMetadataEncodings(languageCodes)) {
    if (bestEncodingScript === 'unicode' && encoding.script !== 'unicode'
      && bestScore.suspicious === 0 && getDominantNonLatinScriptScore(bestScore) > 0) {
      continue;
    }
    const decoded = decodeBytes(bytes, encoding.label);
    if (!decoded || decoded === text) continue;
    const decodedScore = scoreDecodedText(decoded);
    const repairScore = scoreRepairCandidate(originalScore, bestScore, decodedScore, encoding, languageScripts);
    if (repairScore > bestRepairScore) {
      bestText = decoded;
      bestScore = decodedScore;
      bestRepairScore = repairScore;
      bestEncodingScript = encoding.script;
    }
  }

  return bestText;
}

function mayContainLegacyMetadataMojibake(text, score) {
  if (text.includes(ISO_2022_JP_ESCAPE) || score.controls > 0 || score.replacements > 0) return true;
  if (score.windowsMarkers > 0 || score.utf8Markers > 0 || score.latinSymbols >= 2) return true;
  return score.highLatin >= 4 && score.highLatin / score.length >= 0.45;
}

function getLegacyMetadataEncodings(languageCodes) {
  const encodings = [...LEGACY_METADATA_ENCODINGS];
  if (!languageCodes.size) return encodings;
  const labels = new Set(encodings.map(encoding => encoding.label));
  for (const encoding of LANGUAGE_SPECIFIC_METADATA_ENCODINGS) {
    if (labels.has(encoding.label)) continue;
    if (!encoding.languages.some(language => languageCodes.has(language))) continue;
    labels.add(encoding.label);
    encodings.push(encoding);
  }
  return encodings;
}

function getLanguageCodes(languageHints) {
  const codes = new Set();
  if (typeof languageHints === 'string') {
    addLanguageCode(codes, languageHints);
    return codes;
  }
  if (!languageHints || typeof languageHints !== 'object') return codes;

  const languagePreference = normalizeLanguageCode(languageHints.languagePreference);
  if (languagePreference && languagePreference !== 'auto') {
    codes.add(languagePreference);
    return codes;
  }

  const language = normalizeLanguageCode(languageHints.language);
  if (language && language !== 'en') {
    codes.add(language);
    return codes;
  }

  const browserLanguage = normalizeLanguageCode(languageHints.browserLanguage || languageHints.locale);
  if (browserLanguage) {
    codes.add(browserLanguage);
    return codes;
  }

  for (const field of ['browserLanguages', 'languages']) {
    const languageList = Array.isArray(languageHints[field]) ? languageHints[field] : [];
    const firstLanguage = languageList.slice(0, 8).map(normalizeLanguageCode).find(Boolean);
    if (firstLanguage) {
      codes.add(firstLanguage);
      return codes;
    }
  }

  if (language) codes.add(language);
  return codes;
}

function addLanguageCode(codes, value) {
  const code = normalizeLanguageCode(value);
  if (code) codes.add(code);
}

function normalizeLanguageCode(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return '';
  const code = normalized.split('-')[0];
  return /^[a-z]{2,3}$/.test(code) ? code : '';
}

function getLanguageScripts(languageCodes) {
  const scripts = new Set();
  for (const code of languageCodes) {
    const script = LANGUAGE_SCRIPT_BY_CODE[code];
    if (script) scripts.add(script);
  }
  return scripts;
}

function recoverSingleByteText(text) {
  const bytes = [];
  for (const character of text) {
    const mapped = WINDOWS_1252_BYTES.get(character);
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    const code = character.charCodeAt(0);
    if (code > 0xff) return null;
    bytes.push(code);
  }
  return Uint8Array.from(bytes);
}

function decodeBytes(bytes, encoding) {
  const decoder = getTextDecoder(encoding);
  if (!decoder) return '';
  try {
    return decoder.decode(bytes).trim();
  } catch (_) {
    return '';
  }
}

function getTextDecoder(encoding) {
  if (TEXT_DECODERS.has(encoding)) return TEXT_DECODERS.get(encoding);
  let decoder = null;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch (_) {
    decoder = null;
  }
  TEXT_DECODERS.set(encoding, decoder);
  return decoder;
}

function scoreDecodedText(text) {
  const score = {
    length: 0,
    letters: 0,
    latin: 0,
    asciiLatin: 0,
    highLatin: 0,
    windowsMarkers: 0,
    utf8Markers: countUtf8MojibakeMarkers(text),
    latinSymbols: 0,
    controls: 0,
    replacements: 0,
    japanese: 0,
    cjk: 0,
    hangul: 0,
    cyrillic: 0,
    greek: 0,
    hebrew: 0,
    arabic: 0,
    thai: 0,
    devanagari: 0,
    suspicious: 0
  };

  for (const character of text) {
    const code = character.codePointAt(0);
    score.length += 1;
    if (code >= 0x80 && code <= 0xff) score.highLatin += 1;
    if (WINDOWS_1252_MARKER_PATTERN.test(character) || character === ISO_2022_JP_ESCAPE) score.windowsMarkers += 1;
    if (LATIN1_SYMBOL_PATTERN.test(character)) score.latinSymbols += 1;
    if (REPLACEMENT_CHAR_PATTERN.test(character)) score.replacements += 1;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)) {
      score.controls += 1;
    }

    if (isAsciiLatin(code)) {
      score.asciiLatin += 1;
      score.latin += 1;
      score.letters += 1;
    } else if (isLatinLetter(code)) {
      score.latin += 1;
      score.letters += 1;
    } else if (isJapanese(code)) {
      score.japanese += 1;
      score.letters += 1;
    } else if (isCjk(code)) {
      score.cjk += 1;
      score.letters += 1;
    } else if (isHangul(code)) {
      score.hangul += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0400, 0x052f)) {
      score.cyrillic += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0370, 0x03ff)) {
      score.greek += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0590, 0x05ff)) {
      score.hebrew += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0600, 0x06ff) || isInRange(code, 0x0750, 0x077f)) {
      score.arabic += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0e00, 0x0e7f)) {
      score.thai += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0900, 0x097f)) {
      score.devanagari += 1;
      score.letters += 1;
    }
  }

  score.suspicious = score.windowsMarkers + score.utf8Markers + score.latinSymbols + score.controls * 2 + score.replacements * 5;
  return score;
}

function scoreRepairCandidate(originalScore, bestScore, decodedScore, encoding, languageScripts) {
  if (decodedScore.replacements > 0 || decodedScore.controls > 0) return 0;
  if (encoding.script === 'unicode') {
    return scoreUnicodeRepair(originalScore, bestScore, decodedScore);
  }
  return scoreScriptRepair(originalScore, bestScore, decodedScore, encoding, languageScripts);
}

function countUtf8MojibakeMarkers(text) {
  return text.match(UTF8_MOJIBAKE_SEQUENCE_PATTERN)?.length || 0;
}

function scoreUnicodeRepair(originalScore, bestScore, decodedScore) {
  const suspiciousGain = originalScore.suspicious - decodedScore.suspicious;
  const scriptGain = getDominantNonLatinScriptScore(decodedScore) - getDominantNonLatinScriptScore(originalScore);
  if (originalScore.utf8Markers === 0 && scriptGain <= 0) return 0;
  if (suspiciousGain <= 0 && scriptGain <= 0) return 0;
  if (decodedScore.suspicious > bestScore.suspicious && scriptGain <= 0) return 0;
  return 100 + suspiciousGain * 20 + scriptGain * 8 + decodedScore.letters;
}

function scoreScriptRepair(originalScore, bestScore, decodedScore, encoding, languageScripts) {
  const target = getScriptScore(decodedScore, encoding.script);
  const originalTarget = getScriptScore(originalScore, encoding.script);
  if (target <= originalTarget || target < encoding.minChars) return 0;
  if (encoding.script === 'japanese' && decodedScore.japanese === 0) return 0;
  if (encoding.script !== 'unicode' && !hasStrongMultibyteMojibakeSignal(originalScore)) return 0;
  if (decodedScore.suspicious > 0) return 0;
  const targetRatio = target / Math.max(1, decodedScore.letters);
  if (targetRatio < 0.45) return 0;
  if (target < 4 && decodedScore.asciiLatin > 0) return 0;
  const suspiciousGain = originalScore.suspicious - decodedScore.suspicious;
  const highLatinGain = originalScore.highLatin - decodedScore.highLatin;
  const multibyteBonus = getMultibyteScriptBonus(originalScore, decodedScore, encoding.script);
  const bestTarget = getScriptScore(bestScore, encoding.script);
  if (target < bestTarget && decodedScore.suspicious >= bestScore.suspicious) return 0;
  return 80 + target * 8 + targetRatio * 20 + suspiciousGain * 10 + highLatinGain * 2
    + multibyteBonus + getScriptPriorityBonus(decodedScore, encoding.script)
    + getLanguageScriptBonus(languageScripts, encoding.script);
}

function getDominantNonLatinScriptScore(score) {
  return Math.max(
    score.japanese,
    score.cjk,
    score.hangul,
    score.cyrillic,
    score.greek,
    score.hebrew,
    score.arabic,
    score.thai,
    score.devanagari
  );
}

function getScriptScore(score, script) {
  if (script === 'japanese') return score.japanese + score.cjk;
  return score[script] || 0;
}

function getMultibyteScriptBonus(originalScore, decodedScore, script) {
  if (!isMultibyteScript(script)) return 0;
  return Math.max(0, originalScore.highLatin - decodedScore.length) * 10;
}

function getScriptPriorityBonus(score, script) {
  if (script === 'hangul' && score.hangul > 0) return 6;
  if (script === 'japanese' && score.japanese > 0) return 6;
  return 0;
}

function getLanguageScriptBonus(languageScripts, script) {
  if (!languageScripts?.has(script)) return 0;
  return 18;
}

function isMultibyteScript(script) {
  return script === 'japanese' || script === 'cjk' || script === 'hangul';
}

function hasStrongMultibyteMojibakeSignal(score) {
  return score.windowsMarkers > 0 || score.utf8Markers > 0 || score.latinSymbols > 0 || score.controls > 0;
}

function isAsciiLatin(code) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isLatinLetter(code) {
  return isInRange(code, 0x00c0, 0x024f) || isInRange(code, 0x1e00, 0x1eff);
}

function isJapanese(code) {
  return isInRange(code, 0x3040, 0x30ff) || isInRange(code, 0xff66, 0xff9f);
}

function isCjk(code) {
  return isInRange(code, 0x3400, 0x4dbf) || isInRange(code, 0x4e00, 0x9fff) || isInRange(code, 0xf900, 0xfaff);
}

function isHangul(code) {
  return isInRange(code, 0x1100, 0x11ff) || isInRange(code, 0x3130, 0x318f) || isInRange(code, 0xac00, 0xd7af);
}

function isInRange(code, start, end) {
  return code >= start && code <= end;
}
