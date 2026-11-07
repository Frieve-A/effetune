import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { WebMetadataParser } from '../../js/library/scan/web-metadata-parser.js';
import { SCORE_EXTENSIONS } from '../../js/midi/score-file.js';
import { getAudioMimeType } from '../../js/audio/audio-mime.js';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import metadataWorkerPool from '../../electron/library-metadata-worker-pool.cjs';
import catalogScanRuntime from '../../electron/library-catalog-scan-runtime.cjs';
import { loadFreshModule, withModuleLoadStub } from '../helpers/cjs-module-utils.cjs';

const score = '<score-partwise version="4.0"><work><work-title>Authored score</work-title></work>' +
  '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
  '<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>' +
  '</measure></part></score-partwise>';

test('MusicXML player preparation uses the score decoder and shares catalog duration and title', async () => {
  for (const fileName of ['authored.musicxml', 'authored.XML', 'C# minor.musicxml', 'C# minor.xml']) {
    const file = new File([score], fileName);
    const owner = Object.assign({}, midiPlaybackMethods, {
      audioPlayer: { audioContext: { sampleRate: 48000 } },
      loadTrackData: () => file.arrayBuffer()
    });
    assert.equal(owner.isMidiTrack({ file }), true);
    const timeline = await owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false);
    assert.ok(timeline.events.some(event => event.status === 0x90 && event.data1 === 60));
    const parser = new WebMetadataParser({
      filesystem: { getFile: async () => file },
      parse() { assert.fail('MusicXML must bypass the audio metadata decoder'); }
    });
    const metadata = await parser.parse({ relativePath: file.name, skipCovers: true });
    assert.equal(metadata.title, 'Authored score');
    assert.equal(metadata.durationSec, timeline.duration);
    assert.equal(metadata.codec, 'MusicXML');
    assert.equal(metadata.sampleRate, null);
  }
});

test('generic XML is rejected through live and catalog score entry points', async () => {
  const file = new File(['<configuration><value>1</value></configuration>'], 'settings.xml');
  const owner = Object.assign({}, midiPlaybackMethods, {
    audioPlayer: { audioContext: { sampleRate: 48000 } }, loadTrackData: () => file.arrayBuffer()
  });
  await assert.rejects(owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false),
    { code: 'musicxml-unsupported' });
  const parser = new WebMetadataParser({ filesystem: { getFile: async () => file },
    parse() { assert.fail('Generic XML must not enter an audio decoder'); } });
  await assert.rejects(parser.parse({ relativePath: file.name, skipCovers: true }),
    { code: 'unsupported-container' });
});

test('offline XML uses score decoding and preserves the useful MusicXML error message', async () => {
  const processor = new OfflineProcessor({ audioContext: { sampleRate: 48000,
    decodeAudioData() { assert.fail('MusicXML must bypass audio decoding'); } } }, {});
  await assert.rejects(processor.processAudioFile(new File(['<configuration/>'], 'settings.xml'), []),
    { code: 'musicxml-unsupported', userMessageKey: 'musicxml.error.unsupported' });
  await assert.rejects(processor.processAudioFile(new File([score], 'authored.musicxml'), []),
    { userMessageKey: 'sfzPlayer.error.offlineInstrument' });
});

test('Electron metadata workers decode MusicXML and reject generic XML with catalog errors', { timeout: 15000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'effetune-score-metadata-')));
  const pool = new metadataWorkerPool.MetadataWorkerPool({ workerCount: 2, timeoutMs: 10000 });
  t.after(async () => {
    await pool.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  for (const extension of ['musicxml', 'xml']) {
    const relativePath = `authored.${extension}`, path = join(root, relativePath);
    await writeFile(path, score);
    const metadata = await pool.parse({ path, relativePath, skipCovers: true });
    assert.equal(metadata.title, 'Authored score');
    assert.equal(metadata.codec, 'MusicXML');
    assert.equal(metadata.durationSec, .5);
  }
  const relativePath = 'settings.xml', path = join(root, relativePath);
  await writeFile(path, '<configuration/>');
  await assert.rejects(pool.parse({ path, relativePath, skipCovers: true }), { code: 'unsupported-container' });
  await assert.rejects(pool.parse({ path: join(root, 'missing.mp3'), relativePath: 'missing.mp3', skipCovers: true }),
    { code: 'transient-io' });
});

test('Electron playback and catalog admission accept every shared score extension and preserve MIME types', async t => {
  const fileHandlers = withModuleLoadStub({ electron: {} }, () => loadFreshModule('../../electron/file-handlers.js'));
  const mainSource = await readFile(new URL('../../electron/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /fileHandlers\.isSupportedPlaybackAudioPath\(path\)/);

  const root = await realpath(await mkdtemp(join(tmpdir(), 'effetune-score-admission-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const paths = SCORE_EXTENSIONS.map(extension => {
    assert.ok(catalogScanRuntime.AUDIO_EXTENSIONS.has(`.${extension}`), extension);
    const path = join(root, `score.${extension}`);
    assert.ok(fileHandlers.isSupportedPlaybackAudioPath(path), extension);
    return path;
  });
  // Admission validates the path and extension. Score decoding is covered above.
  await Promise.all(paths.map(path => writeFile(path, 'score')));
  const descriptors = await fileHandlers.admitLocalPlaybackPaths(paths);
  assert.deepEqual(descriptors.map(descriptor => descriptor.path), paths);
  assert.equal(getAudioMimeType('score.MUSICXML'), 'application/vnd.recordare.musicxml+xml');
  assert.equal(getAudioMimeType('score.XML'), 'application/vnd.recordare.musicxml+xml');
  assert.equal(getAudioMimeType('score.MXL'), 'application/vnd.recordare.musicxml');
  assert.equal(getAudioMimeType('song.mid'), 'audio/midi');
});
