import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Each README section is located by its localized heading (which must match
// the dialog label), and must contain the same four explanation elements:
// default ON, limited support, unsupported/mobile fallback, and the short gap
// when OFF. The locale list is derived from js/locales so a new locale cannot
// ship without both the dialog label and the README section.
//
// Owner decision (2026-09-04): the Audio Configuration dialog shows only the
// Gapless Playback label. The explanation lives in the README sections only;
// a `dialog.audioConfig.gaplessPlaybackHelp` string must not come back in any
// locale.
const readmeMarkers = {
  en: {
    defaultOn: ['on by default'],
    limitedSupport: ['support is limited by the file format'],
    fallback: ['Unsupported', 'mobile', 'memory-safe fallback'],
    offGap: ['Turning it off', 'short gap']
  },
  ja: {
    defaultOn: ['初期状態でオン'],
    limitedSupport: ['対応範囲は限定'],
    fallback: ['未対応', 'モバイル', '安全な再生方式'],
    offGap: ['オフ', '短い無音']
  },
  es: {
    defaultOn: ['activada de forma predeterminada'],
    limitedSupport: ['compatibilidad está limitada'],
    fallback: ['no compatibles', 'móviles', 'modo alternativo'],
    offGap: ['desactivarla', 'pausa breve']
  },
  fr: {
    defaultOn: ['activée par défaut'],
    limitedSupport: ['la prise en charge dépend du format du fichier'],
    fallback: ['non pris en charge', 'mobiles', 'mode de secours'],
    offGap: ['désactiver', 'bref silence']
  },
  pt: {
    defaultOn: ['por padrão'],
    limitedSupport: ['limitado'],
    fallback: ['não suportados', 'móveis', 'modo alternativo'],
    offGap: ['desativá-la', 'breve intervalo']
  },
  ko: {
    defaultOn: ['기본적으로 켜져'],
    limitedSupport: ['지원 범위는 제한적'],
    fallback: ['지원되지 않는', '모바일', '안전한 대체 방식'],
    offGap: ['끄면', '짧은 공백']
  },
  ru: {
    defaultOn: ['включено по умолчанию'],
    limitedSupport: ['Поддержка зависит от формата файла'],
    fallback: ['неподдерживаемых', 'мобильных', 'безопасный режим'],
    offGap: ['выключении', 'короткая пауза']
  },
  zh: {
    defaultOn: ['默认开启'],
    limitedSupport: ['支持范围有限'],
    fallback: ['不受支持', '移动环境', '安全回退方式'],
    offGap: ['关闭后', '短暂停顿']
  },
  hi: {
    defaultOn: ['डिफ़ॉल्ट रूप से चालू'],
    limitedSupport: ['समर्थन सीमित'],
    fallback: ['असमर्थित', 'मोबाइल', 'सुरक्षित विकल्प'],
    offGap: ['बंद करने', 'छोटा अंतराल']
  },
  ar: {
    defaultOn: ['افتراضيًا'],
    limitedSupport: ['الدعم يقتصر'],
    fallback: ['غير المدعومة', 'الهاتف', 'بديلًا آمنًا'],
    offGap: ['تعطيله', 'فاصل قصير']
  }
};

const REQUIRED_MARKERS = ['defaultOn', 'limitedSupport', 'fallback', 'offGap'];

async function listLocales() {
  const entries = await readdir(path.join(repoRoot, 'js', 'locales'));
  const locales = entries
    .filter(entry => entry.endsWith('.json5'))
    .map(entry => entry.slice(0, -'.json5'.length))
    .sort();
  assert.ok(locales.includes('en'), 'js/locales has no en.json5');
  return locales;
}

function readmePathOf(locale) {
  return locale === 'en' ? 'README.md' : path.posix.join('docs', 'i18n', locale, 'README.md');
}

function extractLocaleString(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return match?.[1] ?? null;
}

// Both "## " and "### " headings end a section so a section body can never
// run into the next top-level chapter.
function splitSections(markdown) {
  const sections = [];
  const lines = markdown.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^#{2,3} (.*)$/);
    if (heading) {
      current = { heading: heading[1].trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return sections.map(section => ({ heading: section.heading, body: section.body.join('\n') }));
}

async function readLocaleSource(locale) {
  return readFile(path.join(repoRoot, 'js', 'locales', `${locale}.json5`), 'utf8');
}

test('Gapless Playback label exists in every locale and the dialog help string stays removed', async () => {
  for (const locale of await listLocales()) {
    const localeSource = await readLocaleSource(locale);
    const key = 'dialog.audioConfig.gaplessPlayback';
    const value = extractLocaleString(localeSource, key);
    assert.ok(value, `${locale} ${key}`);
    assert.notEqual(value, key, `${locale} raw ${key}`);
    assert.ok(value.trim().length > 0, `${locale} empty ${key}`);
    assert.equal(
      extractLocaleString(localeSource, 'dialog.audioConfig.gaplessPlaybackHelp'),
      null,
      `${locale} must not define dialog.audioConfig.gaplessPlaybackHelp (owner decision 2026-09-04)`
    );
    assert.ok(!localeSource.includes('gaplessPlaybackHelp'), `${locale} still mentions gaplessPlaybackHelp`);
  }
});

test('Gapless Playback README sections share the same structure and explanation elements', async () => {
  for (const locale of await listLocales()) {
    const markers = readmeMarkers[locale];
    assert.ok(markers, `${locale} has no README marker contract in this test`);
    const readme = readmePathOf(locale);
    await assert.doesNotReject(
      access(path.join(repoRoot, readme)),
      `${locale} README is missing at ${readme}`
    );
    const label = extractLocaleString(
      await readLocaleSource(locale),
      'dialog.audioConfig.gaplessPlayback'
    );
    const sections = splitSections(await readFile(path.join(repoRoot, readme), 'utf8'));
    const matching = sections.filter(section => section.heading === label);
    assert.equal(matching.length, 1, `${readme} must have exactly one "${label}" section`);
    const section = matching[0];
    assert.ok(section.body.trim().length > 0, `${readme} ${label} section is empty`);
    assert.ok(
      section.body.includes(`**${label}**`),
      `${readme} ${label} section does not name the setting`
    );
    for (const marker of REQUIRED_MARKERS) {
      for (const term of markers[marker]) {
        assert.ok(
          section.body.includes(term),
          `${readme} ${label} section (${marker}) is missing ${term}`
        );
      }
    }
  }
});
