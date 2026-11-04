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
  for (const value of ['C# minor.mid', 'C# collection/piece.mxl', 'D:\\Music\\C# collection\\piece.musicxml']) {
    assert.equal(isSupportedLibraryPath(value, false, true), true);
    assert.equal(isSupportedLibraryPath(value, false, false), false);
  }
  assert.equal(getFileExtension('C# minor.mid'), 'mid');
  assert.equal(getFileExtension('C# collection/piece.mxl'), 'mxl');
  assert.equal(getFileExtension('https://example.test/piece.mid?download=piece.xml#part'), 'mid');
  assert.equal(getFileExtension('https://example.test/piece.xml?download=piece.mid'), 'xml');
  assert.equal(getFileName('/Music/Song.flac'), 'Song.flac');
  assert.equal(stripExtension('Song.flac'), 'Song');
  assert.equal(stripExtension('.hidden'), '.hidden');
  assert.equal(isSupportedAudioPath('Song.OpUs'), true);
  for (const extension of ['DSF', 'DFF']) {
    assert.equal(isSupportedAudioPath(`Song.${extension}`), true);
    assert.equal(isSupportedLibraryPath(`Song.${extension}`), true);
    assert.equal(isSupportedVideoPath(`Song.${extension}`), false);
  }
  for (const extension of ['MID', 'MIDI', 'KAR', 'MUSICXML', 'XML', 'MXL']) {
    const path = `Song.${extension}?download=1`;
    assert.equal(isSupportedAudioPath(path), true);
    assert.equal(isSupportedVideoPath(path), false);
    assert.equal(isSupportedLibraryPath(path), false);
    for (const includeVideo of [false, true]) {
      for (const includeMidi of [false, true]) {
        assert.equal(isSupportedLibraryPath(path, includeVideo, includeMidi), includeMidi);
      }
    }
  }
  assert.equal(isSupportedAudioPath('cover.jpg'), false);
  for (const extension of ['mp4', 'webm', 'm4v', 'mov', 'mkv', '3gp']) {
    const path = `Clip.${extension.toUpperCase()}?download=1`;
    assert.equal(isSupportedVideoPath(path), true);
    assert.equal(isSupportedAudioPath(path), true);
    assert.equal(isSupportedLibraryPath(path), false);
    for (const includeVideo of [false, true]) {
      for (const includeMidi of [false, true]) {
        assert.equal(isSupportedLibraryPath(path, includeVideo, includeMidi), includeVideo);
      }
    }
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
