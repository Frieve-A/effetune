import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { parseMusicXml, parseMusicXmlFile } from '../../js/midi/musicxml-parser.js';
import { isScoreFile, isMusicXmlFile, parseScoreAsync } from '../../js/midi/score-file.js';
import { applyMidiEvent, createMidiChannels, midiBeatAt, restoreMidiState } from '../../js/midi/smf-timeline.js';
import { validateMidiSchedule } from '../../js/midi/smf-scheduler.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';

const note = (step, duration = 4, extra = '') => `<note>${extra.includes('<chord/>') ? '<chord/>' : ''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra.replace('<chord/>', '')}</note>`;
const rest = duration => `<note><rest/><duration>${duration}</duration></note>`;
const attributes = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const header = '<work><work-title>Test &amp; Tune</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="I1"><midi-channel>2</midi-channel><midi-program>6</midi-program></midi-instrument></score-part></part-list>';
const score = measures => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0">${header}<part id="P1">${measures.map((value, index) => `<measure number="${index + 1}">${index ? '' : attributes}${value}</measure>`).join('')}</part></score-partwise>`;
const fixture = score([
    '<direction><sound tempo="120" dynamics="100"/></direction>' + rest(4) + note('C', 4, '<tie type="start"/>') + note('E', 4, '<chord/>') + '<backup><duration>8</duration></backup>' + note('G', 8, '<voice>2</voice>'),
    '<direction><sound tempo="60"/></direction>' + note('C', 4, '<tie type="stop"/>') + '<forward><duration>4</duration></forward>'
]);
const ons = timeline => timeline.events.filter(event => (event.status & 0xf0) === 0x90).map(event => [event.seconds, event.status & 15, event.data1, event.data2]);

function zip(entries, method = 8) {
    const local = [], central = [];
    let offset = 0;
    for (const [name, text] of entries) {
        const raw = Buffer.from(text), packed = method === 8 ? deflateRawSync(raw) : raw;
        let crc = 0xffffffff;
        for (const byte of raw) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const label = Buffer.from(name), prefix = Buffer.alloc(30);
        prefix.writeUInt32LE(0x04034b50); prefix.writeUInt16LE(20, 4); prefix.writeUInt16LE(method, 8);
        prefix.writeUInt32LE(crc, 14); prefix.writeUInt32LE(packed.length, 18); prefix.writeUInt32LE(raw.length, 22); prefix.writeUInt16LE(label.length, 26);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(method, 10);
        directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(raw.length, 24);
        directory.writeUInt16LE(label.length, 28); directory.writeUInt32LE(offset, 42);
        local.push(prefix, label, packed); central.push(directory, label);
        offset += prefix.length + label.length + packed.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
const container = '<container><rootfiles><rootfile full-path="Scores/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/><rootfile full-path="preview.pdf"/></rootfiles></container>';
const mxl = (source = fixture, method = 8) => zip([['decoy.xml', '<not-a-score/>'], ['META-INF/container.xml', container], ['Scores/main.musicxml', source]], method);

test('MusicXML voices, chords, rests, ties, program/channel and tempo share the MIDI timeline', () => {
    const timeline = parseMusicXml(fixture);
    assert.equal(timeline.title, 'Test & Tune');
    assert.equal(timeline.duration, 3);
    assert.deepEqual(ons(timeline), [[0, 1, 67, 90], [.5, 1, 60, 90], [.5, 1, 64, 90]]);
    const middleCOff = timeline.events.find(event => event.status === 0x81 && event.data1 === 60);
    assert.equal(middleCOff.seconds, 2, 'the tie continues across the tempo change');
    assert.ok(timeline.events.some(event => event.status === 0xc1 && event.data1 === 5));
    assert.equal(midiBeatAt(timeline, 2).bpm, 60);
    assert.equal(restoreMidiState(timeline, .75).channels[1].notes.length, 3);
    validateMidiSchedule(timeline, 48000);
});

test('all three extensions and ZIP rootfile resolution yield the same playable score', async () => {
    const expected = parseMusicXml(fixture);
    assert.deepEqual(parseMusicXml(fixture.replace('<work>', '<!-- score header --> <work>')), expected);
    for (const fileName of ['same.musicxml', 'same.XML', 'same.mxl']) {
        const bytes = new TextEncoder().encode(fixture);
        assert.deepEqual(await parseScoreAsync(bytes, { fileName }), expected);
        assert.ok(isScoreFile({ name: fileName }));
        assert.ok(isMusicXmlFile(`${fileName}?token=1`));
    }
    for (const method of [0, 8]) assert.deepEqual(await parseScoreAsync(mxl(fixture, method), { fileName: 'same.mxl' }), expected);
    assert.ok(isScoreFile('same.mid'));
    assert.ok(!isMusicXmlFile('same.mid'));
    const midi = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, 4, 0, 255, 47, 0]);
    assert.equal((await parseScoreAsync(midi, { fileName: 'same.mid' })).duration, 0);
});

test('sharp signs in local MusicXML names preserve score decoding for plain and compressed files', async () => {
    const expected = parseMusicXml(fixture);
    for (const extension of ['musicxml', 'xml', 'mxl']) {
        const fileName = `C# minor.${extension}`;
        assert.equal(isScoreFile({ name: fileName }), true);
        assert.equal(isMusicXmlFile(fileName), true);
        const bytes = extension === 'mxl' ? mxl(fixture) : new TextEncoder().encode(fixture);
        assert.deepEqual(await parseScoreAsync(bytes, { fileName }), expected);
    }
    assert.equal(isMusicXmlFile('https://example.test/song.xml?download=song.mid#part'), true);
    assert.equal(isMusicXmlFile('https://example.test/song.mid?download=score.xml'), false);
});

test('MusicXML changes channel programs only when the performed instrument changes', () => {
    const timeline = parseMusicXml(fixture);
    const programs = timeline.events.filter(event => (event.status & 0xf0) === 0xc0);
    assert.deepEqual(programs.map(event => [event.quarter, event.status & 15, event.data1]), [[0, 1, 5]]);
    const channels = createMidiChannels();
    for (const event of timeline.events.filter(event => event.quarter === 0)) applyMidiEvent(channels, event);
    applyMidiEvent(channels, { status: 0xc1, data1: 40, data2: 0 });
    for (const event of timeline.events.filter(event => event.quarter > 0)) applyMidiEvent(channels, event);
    assert.equal(channels[1].program, 40, 'later notes preserve the mixer patch');

    const secondInstrument = '<midi-instrument id="I2"><midi-channel>2</midi-channel><midi-program>12</midi-program></midi-instrument>';
    const switching = score([note('C', 4, '<instrument id="I1"/>') + note('D', 4, '<instrument id="I2"/>') +
        '<backup><duration>8</duration></backup>' + note('G', 4, '<instrument id="I1"/><voice>2</voice>') +
        note('A', 4, '<instrument id="I2"/><voice>2</voice>')])
        .replace('</score-part>', `${secondInstrument}</score-part>`);
    const changes = parseMusicXml(switching).events.filter(event => (event.status & 0xf0) === 0xc0);
    assert.deepEqual(changes.map(event => [event.quarter, event.data1]), [[0, 5], [1, 11]]);
});

test('partwise and timewise retain shared measure boundaries across parts and transposition', () => {
    const partList = '<part-list><score-part id="P1"/><score-part id="P2"/></part-list>';
    const first = attributes + '<attributes><transpose><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose></attributes>' + note('C');
    const second = attributes + rest(8) + note('A');
    const partwise = `<score-partwise>${partList}<part id="P1"><measure>${first}</measure><measure>${note('D')}</measure></part><part id="P2"><measure>${second}</measure><measure>${note('B')}</measure></part></score-partwise>`;
    const timewise = `<score-timewise>${partList}<measure><part id="P1">${first}</part><part id="P2">${second}</part></measure><measure><part id="P1">${note('D')}</part><part id="P2">${note('B')}</part></measure></score-timewise>`;
    const timeline = parseMusicXml(partwise);
    assert.deepEqual(parseMusicXml(timewise), timeline);
    assert.deepEqual(ons(timeline), [[0, 0, 46, 80], [1, 1, 69, 80], [1.5, 0, 48, 80], [1.5, 1, 71, 80]]);
});

test('repeats and alternate endings follow the performed order', () => {
    const forward = '<barline location="left"><repeat direction="forward"/></barline>';
    const ending = (number, type) => `<barline><ending number="${number}" type="${type}"/></barline>`;
    const backward = '<barline><repeat direction="backward"/></barline>';
    const timeline = parseMusicXml(score([forward + note('C'), ending(1, 'start') + note('D') + ending(1, 'stop') + backward,
        ending(2, 'start') + note('E') + ending(2, 'stop'), note('F'), note('G') + backward]));
    assert.deepEqual(ons(timeline).map(event => event[2]), [60, 62, 60, 64, 65, 67, 64, 65, 67]);
    assert.equal(timeline.duration, 4.5);
});

test('repeat jumps restore the tempo and meter inherited at the destination', () => {
    const forward = '<barline location="left"><repeat direction="forward"/></barline>';
    const backward = '<barline><repeat direction="backward"/></barline>';
    const signature = (beats, type) => `<attributes><time><beats>${beats}</beats><beat-type>${type}</beat-type></time></attributes>`;
    const timeline = parseMusicXml(score([
        '<sound tempo="90"/>' + signature(3, 4) + note('C'),
        forward + note('D'),
        '<sound tempo="60"/>' + signature(2, 4) + note('E') + backward,
        note('F')
    ]));
    const notes = ons(timeline);
    const expected = [0, 2 / 3, 4 / 3, 7 / 3, 3, 4];
    notes.forEach((event, index) => assert.ok(Math.abs(event[0] - expected[index]) < 1e-9));
    assert.ok(Math.abs(timeline.duration - 5) < 1e-9);
    for (const index of [1, 3]) {
        const beat = midiBeatAt(timeline, notes[index][0] + .01);
        assert.deepEqual([beat.bpm, beat.numerator, beat.denominator], [90, 3, 4]);
    }
    const defaults = parseMusicXml(score([forward + note('C'), '<sound tempo="60"/>' + note('D') + backward]));
    assert.deepEqual(ons(defaults).map(event => event[0]), [0, .5, 1.5, 2]);
    assert.equal(defaults.duration, 3);
});

test('metronome dotted beat and instrument selection apply to sounding pitches', () => {
    const value = score(['<direction><direction-type><metronome><beat-unit>eighth</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>' + note('A')]);
    assert.equal(parseMusicXml(value).duration, 1);
    const hidden = score([note('A').replace('<note>', '<note print-object="no" print-spacing="no">')]);
    assert.equal(ons(parseMusicXml(hidden)).length, 1, 'invisible notes still sound');
    const drum = score(['<note dynamics="50"><unpitched><display-step>C</display-step><display-octave>4</display-octave></unpitched><duration>4</duration><instrument id="I1"/></note>'])
        .replace('<midi-channel>2</midi-channel>', '<midi-channel>10</midi-channel><midi-unpitched>43</midi-unpitched>');
    assert.deepEqual(ons(parseMusicXml(drum)), [[0, 9, 42, 45]]);
});

test('malformed XML, ordinary XML, opus, jumps and damaged/oversized archives fail clearly', async () => {
    for (const value of ['<score-partwise>', '<score-partwise><part-list/></wrong>', fixture.replace('Test &amp;', 'Test &bad;')]) {
        assert.throws(() => parseMusicXml(value), { code: 'musicxml-corrupt' });
    }
    for (const value of ['<settings/>', '<opus/>', score(['<sound dacapo="yes"/>' + note('A')]),
        score(['<barline><repeat direction="forward"/></barline>' + note('C'), '<barline><repeat direction="forward"/></barline>' + note('D'), '<barline><repeat direction="backward"/></barline>' + note('E')]),
        score([note('A').replace('</step>', '</step><alter>0.5</alter>')])]) {
        assert.throws(() => parseMusicXml(value), { code: 'musicxml-unsupported' });
    }
    assert.doesNotThrow(() => parseMusicXml(score(['<sound dacapo="no"/>' + note('A')])));
    await assert.rejects(parseMusicXmlFile(zip([['anything.xml', fixture]])), { code: 'musicxml-corrupt' });
    const damaged = mxl(fixture, 0); damaged[damaged.indexOf(Buffer.from('Test &amp;'))] ^= 1;
    await assert.rejects(parseMusicXmlFile(damaged), { code: 'musicxml-corrupt' });
    const enormous = mxl();
    const directory = enormous.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); enormous.writeUInt32LE(0x40000000, directory + 24);
    // The first rootfile, rather than an unrelated entry, is bounded when extracted.
    const scoreDirectory = enormous.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); enormous.writeUInt32LE(0x40000000, scoreDirectory + 24);
    await assert.rejects(parseMusicXmlFile(enormous), { code: 'musicxml-too-large' });
});

test('malformed XML tokens reject long invalid documents promptly', async () => {
    const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        import(workerData.parser).then(({ parseMusicXml }) => {
            const inputs = ['<'.repeat(256 * 1024), '<score-partwise ' + 'a'.repeat(256 * 1024) + '>',
                '<score-partwise ' + ' '.repeat(256 * 1024) + 'invalid>'];
            parentPort.postMessage(inputs.map(input => {
                try { parseMusicXml(input); return null; }
                catch (error) { return error.code; }
            }));
        });
    `, { eval: true, workerData: { parser: new URL('../../js/midi/musicxml-parser.js', import.meta.url).href } });
    let guard;
    try {
        const codes = await new Promise((resolve, reject) => {
            guard = setTimeout(() => reject(new Error('Malformed XML rejection exceeded five seconds.')), 5000);
            worker.once('message', resolve);
            worker.once('error', reject);
            worker.once('exit', code => reject(new Error(`XML parser worker exited before returning a result (${code}).`)));
        });
        assert.deepEqual(codes, ['musicxml-corrupt', 'musicxml-corrupt', 'musicxml-corrupt']);
    } finally {
        clearTimeout(guard);
        await worker.terminate();
    }
});

test('MusicXML renders audible note timing through the actual SoundFont pipeline for every extension', async () => {
    const rate = 48000;
    const parsed = await parseSfz({ selectedPath: 'tone.sfz', readText: async () =>
        '<region> sample=tone.wav key=69 loop_mode=loop_continuous ampeg_release=.01', hasSample: () => true, onDiagnostic: null });
    const asset = packSfzAsset(parsed.regions, new Map([['tone.wav', { channels: [Float32Array.from({ length: 256 }, (_, i) => .2 * Math.sin(i * 2 * Math.PI / 64))], sampleRate: rate }]]));
    const value = score([rest(4) + note('A', 4)]);
    for (const extension of ['musicxml', 'xml', 'mxl']) {
        const data = extension === 'mxl' ? mxl(value) : new TextEncoder().encode(value);
        const timeline = await parseScoreAsync(data, { fileName: `score.${extension}` });
        const h = await createNativeSamplerWorklet();
        try {
            await h.initialize('SoundFontPlayerPlugin', asset);
            await h.waitFor(() => h.processor.transition.phase === 'open');
            await h.send({ type: 'midiTransport', timeline, generation: 1, position: 0,
                anchorFrame: 0, speed: 1, gain: 1, playing: false, preparing: true });
            await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared'));
            await h.send({ type: 'midiStart', generation: 1, anchorFrame: h.frame });
            const audio = new Float32Array(rate * 1.2);
            for (let offset = 0; offset < audio.length; offset += 128) audio.set(h.render()[0].subarray(0, Math.min(128, audio.length - offset)), offset);
            assert.ok(audio.subarray(0, rate / 2).every(sample => Math.abs(sample) < 1e-12));
            assert.ok(audio.subarray(rate / 2, rate).some(sample => Math.abs(sample) > .001));
            assert.ok(audio.subarray(Math.ceil(1.1 * rate)).every(sample => Math.abs(sample) < 1e-12));
            assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false, h.errors.join('\n'));
        } finally { await h.close(); }
    }
});
