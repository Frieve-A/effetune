import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSmf, isMidiFile } from '../../js/midi/smf-parser.js';
import { getMidiLyricsData } from '../../js/midi/lyrics-timeline.js';
import { parseScoreAsync } from '../../js/midi/score-file.js';
import { WebMetadataParser } from '../../js/library/scan/web-metadata-parser.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { getAudioMimeType } from '../../js/audio/audio-mime.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { createItem } from '../../js/visualizer/visualizer-model.js';
import { lyricsFrame } from '../../js/visualizer/visualizer-lyrics.js';
import { attachLyricsFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import metadataWorkerPool from '../../electron/library-metadata-worker-pool.cjs';

const vlq = number => {
    const bytes = [number & 127];
    while ((number >>>= 7)) bytes.unshift((number & 127) | 128);
    return bytes;
};
const text = (delta, value, meta = 1) => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    return [...vlq(delta), 255, meta, ...vlq(bytes.length), ...bytes];
};
function smf(lyrics, extra = []) {
    const tracks = [
        [0, 255, 81, 3, 7, 161, 32, 0, 144, 60, 100, ...vlq(960), 255, 81, 3, 15, 66, 64,
            ...vlq(960), 128, 60, 0, 0, 255, 47, 0],
        [...lyrics.flat(), 0, 255, 47, 0], ...extra
    ];
    const header = Buffer.from('4d546864000000060001000001e0', 'hex');
    header.writeUInt16BE(tracks.length, 10);
    return Buffer.concat([header, ...tracks.map(track => {
        const chunk = Buffer.from('4d54726b00000000', 'hex'); chunk.writeUInt32BE(track.length, 4);
        return Buffer.concat([chunk, Buffer.from(track)]);
    })]);
}
const karaoke = () => smf([
    text(0, '@KMIDI KARAOKE FILE'), text(0, '@V0100'), text(0, '@LENGL'),
    text(0, '@TAuthored Karaoke'), text(0, '@TAuthor'), text(0, '@IInformation'),
    text(0, '\\Hel'), text(480, 'lo '), text(480, '/Next'), text(480, '\\'), text(240, 'Final')
]);

test('KAR Text preserves timed syllables, headers, tempo, lines and paragraph clears', () => {
    const song = parseSmf(karaoke(), { fileName: 'test.KAR' });
    assert.equal(song.title, 'Authored Karaoke');
    assert.equal(song.lyrics.language, 'ENGL');
    assert.equal(song.lyrics.source, 'kar');
    assert.deepEqual(song.lyrics.cues.map(cue => cue.seconds), [0, .5, 1, 2, 2.5]);
    assert.equal(song.duration, 3);
    assert.deepEqual(song.events.map(event => event.status), [144, 128]);
    assert.ok(song.displayEvents.some(event => event.meta === 1 && event.text === '@LENGL'));
    const data = getMidiLyricsData(song);
    assert.deepEqual(data.lines.map(line => [line.time, line.text]), [
        [0, ''], [0, 'Hello '], [1, 'Next'], [2, ''], [2.5, 'Final'], [3, '']
    ]);
    assert.deepEqual(data.lines[1].words, [{ time: 0, text: 'Hel' }, { time: .5, text: 'lo ' }]);
    assert.equal(getMidiLyricsData(song), data);
    assert.equal(data.paragraphs[data.lines[3].paragraph].start, 3);
});

test('ordinary MIDI Text stays metadata, marked MIDI is recognized, and standard Lyric wins over KAR Text', async () => {
    const ordinary = smf([text(0, 'Recording information')]);
    assert.equal(parseSmf(ordinary, { fileName: 'ordinary.mid' }).lyrics, undefined);
    assert.equal(parseSmf(karaoke(), { fileName: 'marked.mid' }).lyrics.source, 'kar');
    const standard = [text(0, 'Standard ', 5), text(480, 'lyric', 5), text(480, '\r', 5),
        text(0, 'Second', 5), text(480, '\n', 5), text(240, 'Final', 5)];
    const both = smf([text(0, '@KMIDI KARAOKE FILE'), text(0, '\\Duplicate')],
        [[...standard.flat(), 0, 255, 47, 0]]);
    const song = await parseScoreAsync(both, { fileName: 'both.kar' });
    assert.equal(song.lyrics.source, 'midi');
    assert.deepEqual(getMidiLyricsData(song).lines.map(line => [line.time, line.text]), [
        [0, 'Standard lyric'], [1, 'Second'], [2, ''], [2.5, 'Final'], [3, '']
    ]);
    const sidecar = await parseScoreAsync(both, { fileName: 'both.kar', wrdBytes: Buffer.from('Sidecar;') });
    assert.equal(sidecar.lyrics.source, 'wrd');
    const empty = await parseScoreAsync(both, { fileName: 'both.kar', wrdBytes: new Uint8Array() });
    assert.equal(empty.lyrics.source, 'midi');
    assert.equal(parseSmf(smf([text(0, '@THeader only'), text(0, '\\')]), { fileName: 'empty.kar' }).lyrics, undefined);
});

test('KAR decodes UTF-8 and legacy lyric bytes without trimming syllable spaces or truncating Text', () => {
    const song = parseSmf(smf([text(0, '@KMIDI KARAOKE FILE'), text(0, [0x5c, 0x82, 0xa0]),
        text(480, [0x20, 0x82, 0xa2, 0x20]), text(480, '/' + 'long '.repeat(60))]), { fileName: 'test.kar' });
    assert.equal(song.lyrics.cues[1].text, ' い ');
    assert.equal(song.lyrics.cues[2].text.length, 301);
    assert.equal(getMidiLyricsData(song).lines.find(line => line.text.startsWith('あ')).text, 'あ い ');
    const utf8 = parseSmf(smf([text(0, '\\あ'), text(480, ' い ')]), { fileName: 'utf8.kar' });
    assert.equal(getMidiLyricsData(utf8).lines.find(line => line.text.startsWith('あ')).text, 'あ い ');
});

test('KAR uses player, catalog and offline score routes and accepts matching WRD companions', async () => {
    const file = new File([karaoke()], 'Song.KAR');
    assert.equal(isMidiFile(file), true);
    assert.equal(getAudioMimeType(file.name), 'audio/midi');
    await withGlobals({ window: {} }, async () => {
        const owner = Object.assign({}, midiPlaybackMethods, {
            audioPlayer: { audioContext: { sampleRate: 48000 } }, loadTrackData: () => file.arrayBuffer()
        });
        assert.equal(owner.isMidiTrack({ file }), true);
        const timeline = await owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false);
        assert.equal(timeline.lyrics.source, 'kar');
        attachLyricsFiles([file], [new File(['Sidecar;'], 'Song.wrd')]);
        assert.equal((await owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false)).lyrics.source, 'wrd');
        const parser = new WebMetadataParser({ filesystem: { getFile: async () => file },
            parse() { assert.fail('KAR must bypass the audio decoder'); } });
        const metadata = await parser.parse({ relativePath: file.name, skipCovers: true });
        assert.equal(metadata.title, timeline.title);
        assert.equal(metadata.durationSec, timeline.duration);
        assert.equal(metadata.codec, 'MIDI');
        const processor = new OfflineProcessor({ audioContext: { sampleRate: 48000,
            decodeAudioData() { assert.fail('KAR must bypass audio decoding'); } } }, {});
        await assert.rejects(processor.processAudioFile(file, []), { userMessageKey: 'sfzPlayer.error.offlineInstrument' });
    });
});

test('Electron metadata workers share the KAR title and MIDI duration', { timeout: 15000 }, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'effetune-kar-metadata-')));
    const pool = new metadataWorkerPool.MetadataWorkerPool({ workerCount: 2, timeoutMs: 10000 });
    t.after(async () => {
        await pool.close();
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    const path = join(root, 'song.KAR');
    await writeFile(path, karaoke());
    const track = await pool.parse({ path, relativePath: 'song.KAR', skipCovers: true });
    assert.equal(track.title, 'Authored Karaoke');
    assert.equal(track.durationSec, 3);
    assert.equal(track.codec, 'MIDI');
});

test('KAR and MID Lyric frames follow the shared song position through seek and pause with LRC fallback', () => {
    const state = { currentTrack: {}, isStopped: false, isPlaying: true };
    const item = createItem('lyrics', 'test');
    let midi = { position: .75, timeline: parseSmf(karaoke(), { fileName: 'song.kar' }) };
    const fallback = { synced: true, lines: [{ time: 0, text: 'LRC fallback' }] };
    const view = Object.assign(Object.create(VisualizerView.prototype), { hasLyrics: true,
        sources: { getMidiPresentation: () => midi }, uiManager: { audioPlayer: { ui: { container: {} },
            stateManager: { getStateSnapshot: () => state }, trackLyrics: { get: () => fallback } } } });
    const frame = () => lyricsFrame(item, view.lyrics(), false);
    assert.equal(frame().rows[frame().current].text, 'Hello ');
    midi.position = 2.2;
    assert.equal(frame().rows[frame().current].text, '');
    assert.equal(frame().paragraph.start, frame().current);
    midi.position = 2.75;
    assert.equal(frame().rows[frame().current].text, 'Final');
    state.isPlaying = false;
    assert.equal(frame().rows[frame().current].text, 'Final');
    midi.position = .25;
    assert.equal(frame().rows[frame().current].text, 'Hello ');
    midi = { position: .75, timeline: parseSmf(smf([text(0, 'MID ', 5), text(480, 'Lyric', 5)])) };
    assert.equal(frame().rows[frame().current].text, 'MID Lyric');
    midi.timeline = parseSmf(smf([text(0, 'Metadata')]));
    assert.equal(view.lyrics().data, fallback);
});
