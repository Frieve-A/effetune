import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { parseScoreAsync } from '../../js/midi/score-file.js';
import { WebMetadataParser } from '../../js/library/scan/web-metadata-parser.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import metadataWorkerPool from '../../electron/library-metadata-worker-pool.cjs';

const hex = value => Buffer.from(value, 'hex');
const textEvent = (meta, bytes) => [0, 255, meta, bytes.length, ...bytes];
function score(title, context = null, otherTitle = null) {
    const tracks = [textEvent(3, title), [
        ...(context ? textEvent(1, context) : []), ...(otherTitle ? textEvent(3, otherTitle) : [])
    ]].map(events => {
        const data = Buffer.from([...events, 0, 255, 47, 0]);
        const header = Buffer.from('4d54726b00000000', 'hex');
        header.writeUInt32BE(data.length, 4);
        return Buffer.concat([header, data]);
    });
    return Buffer.concat([hex('4d546864000000060001000201e0'), ...tracks]);
}

test('MIDI names share text encoding evidence across tracks, with null-terminated and short names', () => {
    // Synthetic CP932 fields: full-width ABC and hiragana, unrelated to any source song.
    const context = hex('82a082a282a482a682a800');
    for (const [bytes, expected] of [
        [hex('82608261826200'), 'ＡＢＣ'], [hex('82a000'), 'あ'],
        [hex('b1b2b3b4b500'), 'ｱｲｳｴｵ'], [hex('eee0ed9500'), '髙﨑']
    ]) {
        for (const languageHints of [null, { language: 'en' }, { language: 'ja' }]) {
            const song = parseSmf(score(bytes, context), { fileName: 'test.mid', languageHints });
            assert.equal(song.title, expected);
            assert.equal(song.displayEvents.find(event => event.meta === 3).text, expected);
            assert.equal(song.lyrics, undefined, 'ordinary Text metadata is not karaoke');
        }
    }
});

test('MIDI preserves UTF-8 and international metadata and forwards language and text hints', async () => {
    const cases = [
        [Buffer.from('曲 🎵'), '曲 🎵', null],
        [hex('d6d0b9fad2f4c0d6'), '中国音乐', { language: 'ja' }],
        [hex('a4a4b0eaadb5bcd6'), '中國音樂', { language: 'zh', referenceTexts: ['中國音樂.mid'] }],
        [hex('c7d1b1b9c0bdbec7'), '한국음악', { language: 'ko', referenceTexts: ['한국음악.mid'] }],
        [hex('cff0e8e2e5f2209720ece8f0'), 'Привет — мир', { languagePreference: 'ru', referenceTexts: ['Привет — мир.mid'] }],
        [hex('c5ebebe7ede9eadc2097'), 'Ελληνικά —', { browserLanguage: 'el-GR' }],
        [hex('f9ece5ed209720f2e5eced'), 'שלום — עולם', { language: 'he' }],
        [hex('e3d1cdc8c7209720c8c7e1dac7e1e3'), 'مرحبا — بالعالم', { language: 'ar' }],
        [hex('c0d2c9d2e4b7c22097'), 'ภาษาไทย —', { language: 'th' }],
        [hex('436166e9'), 'Café', { language: 'fr' }],
        [hex('8260826182628263'), 'ＡＢＣＤ', { referenceTexts: ['ＡＢＣＤ.mid'] }]
    ];
    for (const [bytes, expected, languageHints] of cases) {
        const song = await parseScoreAsync(score(bytes), { fileName: 'test.mid', languageHints });
        assert.equal(song.title, expected);
    }
    const mixed = parseSmf(score(Buffer.from('曲 🎵'), hex('82a082a282a482a682a8'), hex('82a0')));
    assert.equal(mixed.title, '曲 🎵', 'a legacy text context does not override a UTF-8 title');
    assert.equal(mixed.displayEvents.filter(event => event.meta === 3)[1].text, 'あ',
        'UTF-8 fields do not interfere with legacy encoding detection in the remaining fields');
});

test('Player, Web catalog and Electron metadata workers share decoded MIDI titles', { timeout: 15000 }, async t => {
    const bytes = score(hex('82608261826200'), hex('82a082a282a482a682a800'));
    const file = new File([bytes], 'test.mid');
    const owner = Object.assign({}, midiPlaybackMethods, {
        audioPlayer: { audioContext: { sampleRate: 48000 } }, loadTrackData: () => file.arrayBuffer(),
        getMetadataRepairHints: () => ({ language: 'en' })
    });
    const timeline = await owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false);
    assert.equal(timeline.title, 'ＡＢＣ');
    const parser = new WebMetadataParser({ filesystem: { getFile: async () => file }, languageHints: { language: 'en' } });
    assert.equal((await parser.parse({ relativePath: file.name, skipCovers: true })).title, timeline.title);

    const root = await realpath(await mkdtemp(join(tmpdir(), 'effetune-midi-text-')));
    const pool = new metadataWorkerPool.MetadataWorkerPool({ workerCount: 2, timeoutMs: 10000 });
    t.after(async () => {
        await pool.close();
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    const path = join(root, file.name);
    await writeFile(path, bytes);
    const metadata = await pool.parse({ path, relativePath: file.name, skipCovers: true, languageHints: { language: 'en' } });
    assert.equal(metadata.title, timeline.title);
});
