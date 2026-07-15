import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFallbackDisplayName,
  getFileExtension,
  getFileName,
  isSupportedAudioPath,
  joinRelativePath,
  normalizeMusicLibraryStartupView,
  normalizeRelativePath,
  normalizeRelativePathForMatching,
  stripExtension
} from '../../js/library/constants.js';
import { encodeCanonicalSortKey } from '../../js/library/repository/catalog-order-contract.js';

test('music library path helpers normalize supported files and display names', () => {
  assert.equal(normalizeMusicLibraryStartupView('albums'), 'albums');
  assert.equal(normalizeMusicLibraryStartupView('invalid'), 'tracks');
  assert.equal(getFileExtension('C:\\Music\\Song.FLAC?download=1'), 'flac');
  assert.equal(getFileExtension('README'), '');
  assert.equal(getFileName('/Music/Song.flac'), 'Song.flac');
  assert.equal(stripExtension('Song.flac'), 'Song');
  assert.equal(stripExtension('.hidden'), '.hidden');
  assert.equal(isSupportedAudioPath('Song.OpUs'), true);
  assert.equal(isSupportedAudioPath('cover.jpg'), false);
  assert.equal(normalizeRelativePath('\\Album\\Disc 1//Song.flac'), 'Album/Disc 1/Song.flac');
  assert.equal(normalizeRelativePathForMatching('Cafe\u0301/Song.flac'), 'Café/Song.flac');
  assert.equal(joinRelativePath('/Album/', '', 'Song.flac'), 'Album/Song.flac');
  assert.equal(createFallbackDisplayName('/Music/Song.flac'), 'Song');
  assert.equal(createFallbackDisplayName(''), 'Untitled');
  assert.equal(encodeCanonicalSortKey('Ａ\\B'), '612F62');
});
