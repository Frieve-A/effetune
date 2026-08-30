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

test('version history records the spectrum overlay once in the current release section', async () => {
  const versionHistory = await readRepositoryFile('docs/version-history.md');
  const currentSection = versionHistory.split(/^### Version 2\.8\.0\b.*$/m)[1]
    ?.split(/^### Version 2\.7\.0\b.*$/m)[0];
  const entry = '- Added an optional three-state spectrum display to supported effect graphs, with After-only and signed Before + After comparison views.';
  const smoothingEntry = '- Added 1/12-octave smoothing to the effect-graph spectrum display for clearer high-frequency trends.';

  assert.ok(currentSection, 'Version 2.8.0 section must exist');
  assert.equal(currentSection.split(entry).length - 1, 1);
  assert.equal(currentSection.split(smoothingEntry).length - 1, 1);
});
