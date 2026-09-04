import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const languages = ['ar', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
const categories = ['eq', 'basics', 'saturation'];
const spectrumOverlayAnchor = '<!-- spectrum-overlay -->';

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('spectrum overlay guidance is present in every supported documentation category', async () => {
  const paths = [
    ...categories.map(category => `docs/plugins/${category}.md`),
    ...languages.flatMap(language => categories.map(category => `docs/i18n/${language}/plugins/${category}.md`))
  ];

  assert.equal(paths.length, 30);

  for (const relativePath of paths) {
    const content = await readRepositoryFile(relativePath);
    assert.equal(
      content.split(spectrumOverlayAnchor).length - 1,
      1,
      `${relativePath} must contain exactly one spectrum-overlay anchor`
    );
    assert.match(content, /1\/12/, `${relativePath} must describe spectrum smoothing`);
  }
});
