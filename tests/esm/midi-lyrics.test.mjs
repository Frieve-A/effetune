import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { parseMusicXml } from '../../js/midi/musicxml-parser.js';
import { parseScoreAsync } from '../../js/midi/score-file.js';
import { parseWrd, wrdCharacterWidth, WRD_MAX_BYTES } from '../../js/midi/wrd-parser.js';
import { getMidiLyricsData } from '../../js/midi/lyrics-timeline.js';

const timeline = () => ({ division: 480, secondsPerTick: null, durationTicks: 5760, duration: 10,
    tempoMap: [{ quarter: 0, seconds: 0, microsecondsPerQuarter: 500000 }, { quarter: 4, seconds: 2, microsecondsPerQuarter: 1000000 }],
    timeSignatures: [{ quarter: 0, numerator: 4, denominator: 4 }, { quarter: 4, numerator: 3, denominator: 4 }] });
const wrap = (measures, extraPart = '') => `<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part>${extraPart ? '<score-part id="P2"><part-name>Second</part-name></score-part>' : ''}</part-list><part id="P1">${measures}</part>${extraPart}</score-partwise>`;
const note = lyrics => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>${lyrics}</note>`;
const lyric = (value, extra = '', attrs = '') => `<lyric ${attrs}>${extra}<text>${value}</text></lyric>`;

test('MusicXML lyric syllables, elisions, parts, verses and repeat tempo follow the performed clock', () => {
    const first = '<measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><barline><repeat direction="forward"/></barline>' +
        note(lyric('Hel', '<syllabic>begin</syllabic>', 'number="1"') + lyric('き', '', 'number="2"')) +
        note(lyric('lo', '<syllabic>end</syllabic>', 'number="1"') + lyric('み', '', 'number="2"')) + '</measure>';
    const second = '<measure><direction><sound tempo="60"/></direction>' + note('<lyric number="1"><text>my</text><elision>‿</elision><text>love</text><extend type="start"/></lyric>') +
        note('<lyric number="1"><extend type="stop"/><end-line/></lyric>') + '<barline><repeat direction="backward"/></barline></measure>';
    const secondPart = '<part id="P2"><measure>' + note(lyric('Other')) + note('') + '</measure><measure>' + note('') + note('') + '</measure></part>';
    const song = parseMusicXml(wrap(first + second, secondPart));
    assert.ok(song.events.every(event => event.type === 'midi'));
    const cues = song.lyrics.cues.filter(cue => cue.part === 'P1' && cue.verse === '1');
    assert.deepEqual(cues.map(cue => cue.seconds), [0, .5, 1, 2, 3, 3.5, 4, 5]);
    assert.equal(cues[2].text, 'my‿love');
    assert.equal(cues[2].endSeconds, 3);
    assert.equal(cues[2].segments[1].type, 'elision');
    assert.equal(song.lyrics.parts[0].name, 'Voice');
    const display = getMidiLyricsData(song);
    assert.equal(display.lines[0].text, 'Hello my‿love');
    assert.equal(display.lines[1].text, 'Hello my‿love');
    assert.equal(getMidiLyricsData(song), display, 'cached identity is stable for remote feeds');
    assert.equal(getMidiLyricsData(song, { verse: '2' }).lines[0].text, 'きみ');
    assert.equal(getMidiLyricsData(song, { part: 'P2' }).lines[0].text, 'Other');
});

test('MusicXML time-only lyrics are filtered per repeat visit and timewise lyrics retain offsets', () => {
    const repeated = '<measure><barline><repeat direction="forward"/></barline>' + note(lyric('First', '', 'time-only="1"') + lyric('Second', '', 'time-only="2"')) + '<barline><repeat direction="backward"/></barline></measure>';
    const song = parseMusicXml(wrap(repeated));
    assert.deepEqual(song.lyrics.cues.map(cue => [cue.seconds, cue.text]), [[0, 'First'], [.5, 'Second']]);
    const timewise = '<score-timewise><part-list><score-part id="P1"/></part-list><measure><part id="P1"><forward><duration>1</duration></forward>' + note(lyric('Later')) + '</part></measure></score-timewise>';
    assert.equal(parseMusicXml(timewise).lyrics.cues[0].seconds, .5);
});

test('WRD wait/rest/offset, line continuation and clear use MIDI meter and tempo', () => {
    const song = timeline();
    song.lyrics = parseWrd('@STARTUP(427);\n@WAIT(2,48);\nHello;\n world\n@WAIT(3,0);\n@TCLS()@LOCATE(1,1);\nNext\n@OFFSET(1);\n@WAIT(3,0);\nLater;', song);
    assert.deepEqual(song.lyrics.cues.map(cue => [cue.seconds, cue.text]), [[3, 'Hello world'], [5, 'Next'], [8, 'Next\nLater'], [10, '']]);
    const data = getMidiLyricsData(song);
    assert.equal(data.screen, true);
    assert.equal(data.lines[0].time, 3);
    const rest = parseWrd('@REST(1,48);\nRest;', timeline());
    assert.equal(rest.cues[0].seconds, 3);
});

test('WRD Shift-JIS, character stepping, grouped text, hidden text and inert external commands', () => {
    const japanese = parseWrd(Uint8Array.of(0x82, 0xa0, 0x82, 0xa2, 0x3b), timeline());
    assert.equal(japanese.cues[0].text, 'あい');
    const song = timeline();
    const parsed = parseWrd('@WMODE(23,1);\nA_|BC|\\_;\n@LOCATE(1,2);\nZ;\n@TON(0);\n@TON(1);\n@EXEC(do not execute);\n@MAG(do not read);', song);
    assert.deepEqual(parsed.cues.slice(0, 3).map(cue => [cue.seconds, cue.text]), [[0, 'A'], [1, 'ABC'], [1.5, 'ABC_']]);
    assert.ok(parsed.cues.some(cue => cue.text === 'ABC_\nZ'));
    assert.throws(() => parseWrd('a'.repeat(WRD_MAX_BYTES + 1), song), { code: 'wrd-corrupt' });
    assert.throws(() => parseWrd('@WAIT(9999999,0);\nBad;', song), { code: 'wrd-corrupt' });
});

test('WRD overdue waits preserve cursor write order and double-byte symbol columns', () => {
    const song = timeline();
    const parsed = parseWrd('@WMODE(23);\n@LOCATE(1,1);\nABCD;\n@LOCATE(1,1);\nA;\n@\nB;\n@\nC;\n@WAIT(1);\nD;', song);
    assert.ok(parsed.cues.filter(cue => cue.text).every(cue => cue.text === 'ABCD'), 'karaoke rewrites preserve the original page despite a past WAIT');
    assert.ok(parsed.cues.every((cue, index, cues) => !index || cue.seconds >= cues[index - 1].seconds));
    const symbols = parseWrd('@WMODE(23);\n★A;\n@LOCATE(3,1);\nB;', song);
    assert.equal(symbols.cues.at(-2).text, '★B');
    assert.deepEqual(['A', 'ｱ', 'あ', '★', 'α', 'Я'].map(wrdCharacterWidth), [1, 1, 2, 2, 2, 2]);
});

function midiWithLyrics() {
    const track = Buffer.from([0, 255, 5, 3, 72, 105, 32, 0, 144, 60, 80, 0x83, 0x60, 255, 5, 5, 116, 104, 101, 114, 101, 0, 128, 60, 0, 0x83, 0x60, 255, 47, 0]);
    const header = Buffer.from('4d546864000000060000000101e04d54726b00000000', 'hex');
    header.writeUInt32BE(track.length, 18);
    return Buffer.concat([header, track]);
}

test('SMF lyric metadata stays outside the scheduler and optional WRD overrides only readable lyrics', async t => {
    const bytes = midiWithLyrics(), embedded = parseSmf(bytes);
    assert.deepEqual(embedded.events.map(event => event.status), [144, 128]);
    assert.deepEqual(embedded.lyrics.cues.map(cue => cue.seconds), [0, .5]);
    assert.equal(getMidiLyricsData(embedded).lines[0].text, 'Hi there');
    const sidecar = await parseScoreAsync(bytes, { fileName: 'song.mid', wrdBytes: new TextEncoder().encode('Sidecar;') });
    assert.equal(sidecar.lyrics.source, 'wrd');
    const empty = await parseScoreAsync(bytes, { fileName: 'song.mid', wrdBytes: new Uint8Array() });
    assert.equal(empty.lyrics.source, 'midi');
    const warnings = t.mock.method(console, 'warn', () => {});
    const broken = await parseScoreAsync(bytes, { fileName: 'song.mid', wrdBytes: new TextEncoder().encode('@WAIT(99999999,0);') });
    assert.equal(warnings.mock.callCount(), 1);
    assert.equal(broken.lyricsWarning, 'wrd-unreadable');
    assert.equal(broken.lyrics.source, 'midi');
});

test('score worker transfers synchronized WRD lyrics with the MIDI playback timeline', async () => {
    const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        globalThis.WorkerGlobalScope = class { static [Symbol.hasInstance]() { return true; } };
        globalThis.postMessage = result => parentPort.postMessage(result);
        import(workerData.module).then(() => globalThis.onmessage({ data: workerData.input }));
    `, { eval: true, workerData: { module: new URL('../../js/midi/score-worker.js', import.meta.url).href,
        input: { buffer: midiWithLyrics(), options: { fileName: 'test.mid', wrdBytes: new TextEncoder().encode('@WAIT(1,48);\nTimed;') } } } });
    let guard;
    try {
        const reply = await new Promise((resolve, reject) => {
            guard = setTimeout(() => reject(new Error('Score worker did not return lyrics.')), 5000);
            worker.once('message', resolve); worker.once('error', reject);
        });
        assert.equal(reply.error, undefined);
        assert.equal(reply.result.lyrics.source, 'wrd');
        assert.equal(reply.result.lyrics.cues[0].seconds, .5);
        assert.deepEqual(reply.result.events.map(event => event.status), [144, 128]);
    } finally { clearTimeout(guard); await worker.terminate(); }
});
