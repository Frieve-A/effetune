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
const COMMON_CJK_CHARACTERS = new Set(Array.from(
  '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联认六共权收证改清美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界'
));
const TEXT_DECODERS = new Map();

export function repairLegacyMetadataMojibake(text, languageHints = null) {
  if (typeof text !== 'string' || text === '') return text;
  const originalScore = scoreDecodedText(text);
  if (!mayContainLegacyMetadataMojibake(text, originalScore)) return text;

  const bytes = recoverSingleByteText(text);
  if (!bytes) return text;

  const languageCodes = getLanguageCodes(languageHints);
  const languageScripts = getLanguageScripts(languageCodes);
  const contextTexts = getContextTexts(languageHints);
  const contextScripts = getContextScriptsFromTexts(contextTexts);
  const repairContext = { languageScripts, contextScripts, contextTexts };
  const candidates = [];
  let bestScore = originalScore;
  let bestEncodingScript = null;

  for (const encoding of getLegacyMetadataEncodings(languageCodes)) {
    if (bestEncodingScript === 'unicode' && encoding.script !== 'unicode'
      && bestScore.suspicious === 0 && getDominantNonLatinScriptScore(bestScore) > 0) {
      continue;
    }
    const decoded = decodeBytes(bytes, encoding.label);
    if (!decoded || decoded === text) continue;
    const decodedScore = scoreDecodedText(decoded);
    const repairScore = scoreRepairCandidate(originalScore, bestScore, decodedScore, encoding, repairContext, decoded);
    if (repairScore > 0) {
      candidates.push({ text: decoded, score: decodedScore, repairScore, encoding });
    }
    if (repairScore > 0 && isBetterIntermediateScore(decodedScore, bestScore, encoding, bestEncodingScript)) {
      bestScore = decodedScore;
      bestEncodingScript = encoding.script;
    }
  }

  return chooseRepairCandidate(text, candidates, repairContext);
}

export function decodeLegacyMetadataBytes(data, languageHints = null) {
  const rawBytes = normalizeByteArray(data);
  if (!rawBytes || rawBytes.length === 0) return '';

  const utf16Text = decodeLikelyUtf16Bytes(rawBytes);
  if (utf16Text) return utf16Text;

  const bytes = trimSingleByteNullTerminators(rawBytes);
  if (bytes.length === 0) return '';

  const latin1Text = bytesToLatin1String(bytes);
  const repaired = repairLegacyMetadataMojibake(latin1Text, languageHints);
  if (repaired !== latin1Text) return repaired.trim();

  const latin1Score = scoreDecodedText(latin1Text);
  const windows1252Text = decodeBytes(bytes, 'windows-1252');
  if (windows1252Text && windows1252Text !== latin1Text) {
    const windows1252Score = scoreDecodedText(windows1252Text);
    if (latin1Score.controls > 0 &&
      windows1252Score.controls === 0 &&
      windows1252Score.windowsMarkers === 0 &&
      windows1252Score.replacements === 0) {
      return windows1252Text.trim();
    }
  }

  return latin1Text.trim();
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

function getContextScriptsFromTexts(contextTexts) {
  const scripts = new Set();
  for (const text of contextTexts) {
    const score = scoreDecodedText(text);
    if (score.japanese > 0) scripts.add('japanese');
    if (score.hangul > 0) scripts.add('hangul');
    if (score.cyrillic > 0) scripts.add('cyrillic');
    if (score.greek > 0) scripts.add('greek');
    if (score.hebrew > 0) scripts.add('hebrew');
    if (score.arabic > 0) scripts.add('arabic');
    if (score.thai > 0) scripts.add('thai');
    if (score.devanagari > 0) scripts.add('devanagari');
    if (score.cjk > 0 && score.japanese === 0) scripts.add('cjk');
  }
  return scripts;
}

function getContextTexts(languageHints) {
  if (!languageHints || typeof languageHints !== 'object') return [];
  const texts = [];
  for (const field of ['referenceText', 'title', 'fileName', 'relativePath', 'path']) {
    if (typeof languageHints[field] === 'string') texts.push(languageHints[field]);
  }
  for (const field of ['referenceTexts', 'contextTexts']) {
    if (!Array.isArray(languageHints[field])) continue;
    for (const text of languageHints[field]) {
      if (typeof text === 'string') texts.push(text);
    }
  }
  return texts.map(text => text.trim()).filter(Boolean);
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

function normalizeByteArray(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  return null;
}

function trimSingleByteNullTerminators(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end -= 1;
  return bytes.subarray(0, end);
}

function bytesToLatin1String(bytes) {
  const chunks = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return chunks.join('');
}

function decodeLikelyUtf16Bytes(bytes) {
  const bomEncoding = getUtf16BomEncoding(bytes);
  if (bomEncoding) {
    return cleanupDecodedMetadataText(decodeUtf16Bytes(bytes.subarray(2), bomEncoding));
  }

  if (bytes.length < 4) return '';
  const pairs = Math.floor(bytes.length / 2);
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    if (bytes[index] === 0x00) evenZeros += 1;
    if (bytes[index + 1] === 0x00) oddZeros += 1;
  }

  const evenRatio = evenZeros / pairs;
  const oddRatio = oddZeros / pairs;
  if (oddRatio >= 0.35 && evenRatio <= 0.1) {
    return cleanupDecodedMetadataText(decodeUtf16Bytes(bytes, 'utf-16le'));
  }
  if (evenRatio >= 0.35 && oddRatio <= 0.1) {
    return cleanupDecodedMetadataText(decodeUtf16Bytes(bytes, 'utf-16be'));
  }
  return '';
}

function getUtf16BomEncoding(bytes) {
  if (bytes.length < 2) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return '';
}

function decodeUtf16Bytes(bytes, encoding) {
  const chars = [];
  const chunk = [];
  const littleEndian = encoding === 'utf-16le';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1];
    chunk.push(code);
    if (chunk.length >= 0x8000) {
      chars.push(String.fromCharCode(...chunk));
      chunk.length = 0;
    }
  }
  if (chunk.length > 0) chars.push(String.fromCharCode(...chunk));
  return chars.join('');
}

function cleanupDecodedMetadataText(text) {
  const value = String(text || '');
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x00) end -= 1;
  const cleaned = value.slice(0, end).trim();
  if (!cleaned) return '';
  const score = scoreDecodedText(cleaned);
  return score.controls === 0 && score.replacements === 0 ? cleaned : '';
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
    privateUse: 0,
    cjkCompatibility: 0,
    commonCjk: 0,
    cjkMojibakeArtifacts: 0,
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
    } else if (isCjkCompatibility(code)) {
      score.cjk += 1;
      score.cjkCompatibility += 1;
      if (isCommonCjk(code)) score.commonCjk += 1;
      if (isCjkMojibakeArtifact(code)) score.cjkMojibakeArtifacts += 1;
      score.letters += 1;
    } else if (isCjk(code)) {
      score.cjk += 1;
      if (isCommonCjk(code)) score.commonCjk += 1;
      if (isCjkMojibakeArtifact(code)) score.cjkMojibakeArtifacts += 1;
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
    } else if (isPrivateUse(code)) {
      score.privateUse += 1;
    }
  }

  score.suspicious = score.windowsMarkers + score.utf8Markers + score.latinSymbols + score.controls * 2 +
    score.replacements * 5 + score.privateUse * 4;
  return score;
}

function scoreRepairCandidate(originalScore, bestScore, decodedScore, encoding, repairContext, decodedText = '') {
  if (decodedScore.replacements > 0 || decodedScore.controls > 0 || decodedScore.privateUse > 0) return 0;
  if (encoding.script === 'unicode') {
    return scoreUnicodeRepair(originalScore, bestScore, decodedScore);
  }
  return scoreScriptRepair(originalScore, bestScore, decodedScore, encoding, repairContext, decodedText);
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

function scoreScriptRepair(originalScore, bestScore, decodedScore, encoding, repairContext, decodedText = '') {
  const target = getScriptScore(decodedScore, encoding.script);
  const originalTarget = getScriptScore(originalScore, encoding.script);
  const contextTextBonus = getContextTextBonus(decodedText, repairContext);
  const hasStrongContextMatch = contextTextBonus >= 220;
  if (target <= originalTarget && !hasStrongContextMatch) return 0;
  if (target < encoding.minChars && contextTextBonus <= 0) return 0;
  if (encoding.script !== 'unicode' && !hasStrongMultibyteMojibakeSignal(originalScore)) return 0;
  if (getDecodedCorruptionScore(decodedScore) > 0) return 0;
  const targetRatio = getScriptRatio(decodedScore, encoding.script);
  if (targetRatio < 0.45 && !hasStrongContextMatch) return 0;
  if (target < 4 && decodedScore.asciiLatin > 0 && !hasTextScriptContext(repairContext, encoding.script) && !hasStrongContextMatch) return 0;
  const suspiciousGain = originalScore.suspicious - decodedScore.suspicious;
  const highLatinGain = originalScore.highLatin - decodedScore.highLatin;
  const multibyteBonus = getMultibyteScriptBonus(originalScore, decodedScore, encoding.script);
  const bestTarget = getScriptScore(bestScore, encoding.script);
  if (target < bestTarget && getDecodedCorruptionScore(decodedScore) >= getDecodedCorruptionScore(bestScore)) return 0;
  return 80 + target * 8 + targetRatio * 20 + suspiciousGain * 10 + highLatinGain * 2
    + multibyteBonus + getScriptPriorityBonus(decodedScore, encoding.script)
    + contextTextBonus
    + getScriptContextBonus(repairContext, encoding.script, decodedScore)
    + getEncodingPriorityBonus(encoding, repairContext)
    - getScriptArtifactPenalty(decodedScore, encoding.script);
}

function chooseRepairCandidate(originalText, candidates, repairContext) {
  if (!candidates.length) return originalText;
  const sorted = [...candidates].sort((a, b) => b.repairScore - a.repairScore);
  const best = sorted[0];
  const second = sorted[1] || null;
  if (best.repairScore < 90) return originalText;
  if (isAmbiguousEastAsianRepair(best, second, repairContext)) return originalText;
  return best.text;
}

function isBetterIntermediateScore(candidateScore, bestScore, encoding, bestEncodingScript) {
  if (getDecodedCorruptionScore(candidateScore) < getDecodedCorruptionScore(bestScore)) return true;
  if (getDominantNonLatinScriptScore(candidateScore) > getDominantNonLatinScriptScore(bestScore)) return true;
  return !bestEncodingScript && encoding.script === 'unicode';
}

function isAmbiguousEastAsianRepair(best, second, repairContext) {
  if (!second) return false;
  const bestScript = best.encoding.script;
  const secondScript = second.encoding.script;
  if (!isAmbiguousEastAsianScript(bestScript) || !isAmbiguousEastAsianScript(secondScript)) return false;
  if (bestScript === secondScript) return false;
  if (best.repairScore - second.repairScore > 50) return false;
  if (hasTextScriptContext(repairContext, bestScript)) return false;
  return !hasDistinctiveScriptEvidence(best.score, bestScript);
}

function isAmbiguousEastAsianScript(script) {
  return script === 'japanese' || script === 'cjk';
}

function hasDistinctiveScriptEvidence(score, script) {
  if (script === 'japanese') return score.japanese > 0;
  if (script === 'cjk') {
    return score.cjk >= 2 && score.cjkMojibakeArtifacts === 0 &&
      score.commonCjk / Math.max(1, score.cjk) >= 0.55;
  }
  if (script === 'hangul') return score.hangul > 0;
  return false;
}

function getDecodedCorruptionScore(score) {
  return score.controls * 2 + score.replacements * 5 + score.privateUse * 4;
}

function getScriptRatio(score, script) {
  const target = getScriptScore(score, script);
  if (isMultibyteScript(script)) {
    const nonLatinLetters = score.letters - score.latin;
    return target / Math.max(1, nonLatinLetters);
  }
  return target / Math.max(1, score.letters);
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
  if (script === 'hangul' && score.hangul > 0) return 30;
  if (script === 'japanese' && score.japanese > 0) return 30 + score.japanese * 18;
  if (script === 'cjk' && score.commonCjk > 0) return score.commonCjk * 8;
  return 0;
}

function getScriptContextBonus(repairContext, script, score) {
  let bonus = 0;
  const hasTextContext = !!repairContext?.contextScripts?.size;
  if (!hasTextContext && repairContext?.languageScripts?.has(script)) bonus += 6;
  if (repairContext?.contextScripts?.has(script)) {
    bonus += script === 'japanese' && score.japanese === 0 ? 18 : 28;
  }
  if (!hasTextContext && script === 'cjk' && repairContext?.languageScripts?.has('japanese')) bonus -= 6;
  if (script === 'cjk' && repairContext?.contextScripts?.has('japanese')) {
    bonus -= hasDistinctiveScriptEvidence(score, 'cjk') ? 6 : 30;
  }
  if (!hasTextContext && script === 'japanese' && repairContext?.languageScripts?.has('cjk')) bonus -= 6;
  if (script === 'japanese' && repairContext?.contextScripts?.has('cjk')) {
    bonus -= hasDistinctiveScriptEvidence(score, 'japanese') ? 6 : 26;
  }
  return bonus;
}

function hasScriptContext(repairContext, script) {
  return repairContext?.languageScripts?.has(script) || repairContext?.contextScripts?.has(script);
}

function hasTextScriptContext(repairContext, script) {
  return repairContext?.contextScripts?.has(script);
}

function getEncodingPriorityBonus(encoding, repairContext) {
  if (encoding.label === 'shift_jis' && hasTextScriptContext(repairContext, 'japanese')) return 6;
  if ((encoding.label === 'gbk' || encoding.label === 'gb18030') && hasTextScriptContext(repairContext, 'cjk')) return 6;
  if (encoding.label === 'euc-kr' && hasTextScriptContext(repairContext, 'hangul')) return 6;
  return 0;
}

function getContextTextBonus(text, repairContext) {
  const candidate = normalizeContextMatchText(text);
  if (candidate.length < 2) {
    return hasSingleCharacterContextTokenMatch(candidate, repairContext) ? 140 : 0;
  }
  if (candidate.length >= 4 && hasContextTokenMatch(candidate, repairContext)) return 220;
  if (hasMultibyteContextSkeletonMatch(candidate, repairContext)) return 220;
  const compactCandidate = compactContextMatchText(candidate);
  let bonus = 0;
  for (const contextText of repairContext?.contextTexts || []) {
    const context = normalizeContextMatchText(contextText);
    if (!context || context === candidate) continue;
    if (context.includes(candidate)) {
      bonus = Math.max(bonus, candidate.length >= 4 ? 160 : 120);
      continue;
    }
    if (compactCandidate.length >= 4 && compactContextMatchText(context).includes(compactCandidate)) {
      bonus = Math.max(bonus, 100);
    }
  }
  return bonus;
}

function hasContextTokenMatch(candidate, repairContext) {
  if (!candidate) return false;
  for (const contextText of repairContext?.contextTexts || []) {
    if (getContextMatchTokens(contextText).has(candidate)) return true;
  }
  return false;
}

function hasMultibyteContextSkeletonMatch(candidate, repairContext) {
  const candidateSkeleton = getMultibyteContextSkeleton(candidate);
  if ([...candidateSkeleton].length < 2) return false;
  for (const contextText of repairContext?.contextTexts || []) {
    for (const token of getContextMatchTokens(contextText)) {
      if (getMultibyteContextSkeleton(token) === candidateSkeleton) return true;
    }
  }
  return false;
}

function hasSingleCharacterContextTokenMatch(candidate, repairContext) {
  if (!candidate || !isSingleCjkLikeText(candidate)) return false;
  return hasContextTokenMatch(candidate, repairContext);
}

function isSingleCjkLikeText(text) {
  if ([...text].length !== 1) return false;
  const code = text.codePointAt(0);
  return isJapanese(code) || isCjk(code) || isCjkCompatibility(code) || isHangul(code);
}

function getContextMatchTokens(contextText) {
  const context = normalizeContextMatchText(contextText);
  const tokens = new Set();
  for (const part of context.split(/[\\/]+/)) {
    addContextTokenVariants(tokens, part);
  }
  return tokens;
}

function addContextTokenVariants(tokens, value) {
  const text = String(value || '').trim();
  if (!text) return;
  addContextToken(tokens, text);

  const extensionIndex = text.lastIndexOf('.');
  if (extensionIndex > 0) addContextToken(tokens, text.slice(0, extensionIndex));

  for (const part of text.split(/[\s._\-()[\]{}]+/)) {
    addContextToken(tokens, part);
  }

  const withoutTrackPrefix = text.replace(/^\d+\s*[\-_. ]+\s*/, '');
  if (withoutTrackPrefix !== text) addContextTokenVariants(tokens, withoutTrackPrefix);
}

function addContextToken(tokens, value) {
  const token = String(value || '').trim();
  if (token) tokens.add(token);
}

function normalizeContextMatchText(text) {
  return String(text || '').normalize('NFKC').toLowerCase().trim();
}

function compactContextMatchText(text) {
  return text.replace(/[\s._\-()[\]{}]+/g, '');
}

function getMultibyteContextSkeleton(text) {
  let skeleton = '';
  for (const character of normalizeContextMatchText(text)) {
    const code = character.codePointAt(0);
    if (isJapanese(code) || isCjk(code) || isCjkCompatibility(code) || isHangul(code)) {
      skeleton += character;
    }
  }
  return skeleton;
}

function getScriptArtifactPenalty(score, script) {
  if (script !== 'cjk') return 0;
  return score.cjkMojibakeArtifacts * 18;
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
  return isInRange(code, 0x3400, 0x4dbf) || isInRange(code, 0x4e00, 0x9fff);
}

function isCjkCompatibility(code) {
  return isInRange(code, 0xf900, 0xfaff);
}

function isCommonCjk(code) {
  return COMMON_CJK_CHARACTERS.has(String.fromCodePoint(code));
}

function isCjkMojibakeArtifact(code) {
  return code === 0x4e55 || code === 0x4e63 || code === 0x4e8a || isInRange(code, 0x50c0, 0x50ff);
}

function isHangul(code) {
  return isInRange(code, 0x1100, 0x11ff) || isInRange(code, 0x3130, 0x318f) || isInRange(code, 0xac00, 0xd7af);
}

function isPrivateUse(code) {
  return isInRange(code, 0xe000, 0xf8ff);
}

function isInRange(code, start, end) {
  return code >= start && code <= end;
}
