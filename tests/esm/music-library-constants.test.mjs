import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFallbackDisplayName,
  getFileExtension,
  getFileName,
  isSupportedAudioPath,
  isSupportedLibraryPath,
  isSupportedVideoPath,
  joinRelativePath,
  normalizeMusicLibraryStartupView,
  normalizeRelativePath,
  normalizeRelativePathForMatching,
  stripExtension
} from '../../js/library/constants.js';
import {
  encodeCanonicalSearchKey,
  encodeCanonicalSortKey
} from '../../js/library/repository/catalog-order-contract.js';

test('music library path helpers normalize supported files and display names', () => {
  assert.equal(normalizeMusicLibraryStartupView('albums'), 'albums');
  assert.equal(normalizeMusicLibraryStartupView('files'), 'files');
  assert.equal(normalizeMusicLibraryStartupView('invalid'), 'tracks');
  assert.equal(getFileExtension('C:\\Music\\Song.FLAC?download=1'), 'flac');
  assert.equal(getFileExtension('README'), '');
  assert.equal(getFileName('/Music/Song.flac'), 'Song.flac');
  assert.equal(stripExtension('Song.flac'), 'Song');
  assert.equal(stripExtension('.hidden'), '.hidden');
  assert.equal(isSupportedAudioPath('Song.OpUs'), true);
  assert.equal(isSupportedAudioPath('cover.jpg'), false);
  for (const extension of ['mp4', 'webm', 'm4v', 'mov', 'mkv', '3gp']) {
    const path = `Clip.${extension.toUpperCase()}?download=1`;
    assert.equal(isSupportedVideoPath(path), true);
    assert.equal(isSupportedAudioPath(path), true);
    assert.equal(isSupportedLibraryPath(path), false);
    assert.equal(isSupportedLibraryPath(path, true), true);
  }
  assert.equal(isSupportedLibraryPath('Music.m4a'), true);
  assert.equal(isSupportedVideoPath('Music.m4a'), false);
  assert.equal(isSupportedLibraryPath('cover.jpg', true), false);
  assert.equal(normalizeRelativePath('\\Album\\Disc 1//Song.flac'), 'Album/Disc 1/Song.flac');
  assert.equal(normalizeRelativePathForMatching('Cafe\u0301/Song.flac'), 'Café/Song.flac');
  assert.equal(joinRelativePath('/Album/', '', 'Song.flac'), 'Album/Song.flac');
  assert.equal(createFallbackDisplayName('/Music/Song.flac'), 'Song');
  assert.equal(createFallbackDisplayName(''), 'Untitled');
  assert.equal(encodeCanonicalSearchKey('Ａ\\B'), '612F62');
  const names = ['Track 11', 'Track 2', 'Track 10', 'Track 1'];
  names.sort((left, right) => encodeCanonicalSortKey(left).localeCompare(encodeCanonicalSortKey(right)));
  assert.deepEqual(names, ['Track 1', 'Track 2', 'Track 10', 'Track 11']);
});
