const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('packaged app registers MP4 files as audio', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  const association = packageJson.build.fileAssociations.find(({ ext }) => ext === 'mp4');

  assert.deepEqual(association, {
    ext: 'mp4',
    name: 'MP4 Audio',
    description: 'MP4 Audio File',
    icon: 'icon',
    role: 'None'
  });
});


test('packaged app registers Standard MIDI and KAR files', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  for (const ext of ['mid', 'midi', 'kar']) {
    const association = packageJson.build.fileAssociations.find(item => item.ext === ext);
    assert.equal(association.mimeType, 'audio/midi');
    assert.equal(association.role, 'Viewer');
  }
});

test('packaged app registers DSF and DSDIFF as audio files', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  for (const [ext, mimeType] of [['dsf', 'audio/x-dsf'], ['dff', 'audio/x-dff']]) {
    const association = packageJson.build.fileAssociations.find(item => item.ext === ext);
    assert.equal(association.mimeType, mimeType);
    assert.equal(association.role, 'None');
  }
});

test('packaged app registers dedicated MusicXML extensions while leaving generic XML associations alone', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  for (const [ext, mimeType] of [['musicxml', 'application/vnd.recordare.musicxml+xml'], ['mxl', 'application/vnd.recordare.musicxml']]) {
    const association = packageJson.build.fileAssociations.find(item => item.ext === ext);
    assert.equal(association.mimeType, mimeType);
    assert.equal(association.role, 'Viewer');
  }
  assert.equal(packageJson.build.fileAssociations.some(item => item.ext === 'xml'), false);
});
