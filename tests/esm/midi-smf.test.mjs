import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmf, parseSmfAsync, isMidiFile } from '../../js/midi/smf-parser.js';
import { restoreMidiState, midiBeatAt, midiTickAt, applyMidiEvent, createMidiChannels } from '../../js/midi/smf-timeline.js';
import { midiTransportPoints } from '../../js/midi/smf-scheduler.js';

const u16 = value => [value >> 8 & 255, value & 255];
const u32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const text = value => [...new TextEncoder().encode(value)];
function vlq(value) {
    const bytes = [value & 127];
    while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
    return bytes;
}
const event = (delta, ...bytes) => [...vlq(delta), ...bytes];
const end = delta => event(delta, 255, 47, 0);
function smf(tracks, { format = tracks.length > 1 ? 1 : 0, division = 480 } = {}) {
    return new Uint8Array([...text('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division),
        ...tracks.flatMap(track => [...text('MTrk'), ...u32(track.length), ...track])]);
}

test('SMF shares tempo conversion, stable merged channel order, names and track-end duration', () => {
    const timeline = parseSmf(smf([
        [...event(0, 255, 3, 4, ...text('Song')), ...event(0, 255, 81, 3, 7, 161, 32),
            ...event(480, 255, 81, 3, 15, 66, 64), ...end(960)],
        [...event(0, 144, 60, 100), ...event(480, 60, 0), ...event(0, 145, 64, 80), ...end(480)]
    ]));
    assert.equal(timeline.title, 'Song');
    assert.equal(timeline.duration, 2.5);
    assert.deepEqual(timeline.events.map(item => [item.seconds, item.status, item.data1, item.data2]),
        [[0, 144, 60, 100], [.5, 144, 60, 0], [.5, 145, 64, 80]]);
    assert.equal(midiTickAt(timeline, 1), 720);
    assert.equal(midiBeatAt(timeline, 1).bpm, 60);
    const sameTick = parseSmf(smf([
        [...event(0, 144, 60, 100), ...end(480)],
        [...event(0, 128, 60, 0), ...end(480)]
    ]));
    assert.deepEqual(sameTick.events.map(item => item.status), [144, 128]);
});

test('SMPTE timing ignores tempo and supports 29.97 drop-frame division', () => {
    const timeline = parseSmf(smf([[...event(0, 255, 81, 3, 15, 66, 64), ...event(1000, 144, 60, 100), ...end(1000)]],
        { division: 0xe728 }));
    assert.equal(timeline.duration, 2);
    assert.equal(timeline.events[0].seconds, 1);
    const drop = parseSmf(smf([[...end(30000)]], { division: 0xe364 }));
    assert.equal(drop.duration, 10.01);
});

test('native host transport merges SMF tempo and meter changes without losing SMPTE musical position', () => {
    for (const division of [1000, 0xe728]) {
        const timeline = parseSmf(smf([[
            ...event(0, 255, 81, 3, 7, 161, 32),
            ...event(20, 255, 81, 3, 15, 66, 64),
            ...event(0, 255, 88, 4, 3, 3, 24, 8),
            ...event(20, 255, 81, 3, 7, 161, 32), ...end(20)
        ]], { division }));
        const points = midiTransportPoints(timeline);
        assert.equal(points.length, 3, 'same-time metadata is one atomic boundary');
        for (const point of points) {
            const beat = midiBeatAt(timeline, point.seconds);
            assert.equal(point.bpm, beat.bpm);
            assert.equal(point.ppq, beat.quarter);
            assert.equal(point.barStartPpq, beat.quarter - beat.meterQuarter);
            assert.equal(point.numerator, beat.numerator);
            assert.equal(point.denominator, beat.denominator);
        }
        assert.equal(points[1].numerator, 3);
        assert.equal(points[2].barStartPpq, points[1].barStartPpq,
            'a tempo change does not reset the bar phase');
    }
    assert.deepEqual(midiTransportPoints({ events: [], duration: 0 }), [], 'missing facts stay unavailable');
});

test('length-delimited meta and SysEx are skipped and running status is canceled', () => {
    const timeline = parseSmf(smf([[...event(0, 255, 0x7f, 3, 0xff, 0x90, 0),
        ...event(0, 0xf0, 3, 0x7d, 0x80, 0xf7), ...event(0, 144, 60, 100), ...end(480)]]));
    assert.equal(timeline.events.length, 1);
    assert.throws(() => parseSmf(smf([[...event(0, 144, 60, 100), ...event(0, 255, 1, 0),
        ...event(10, 60, 0), ...end(0)]])), { code: 'midi-corrupt' });
});

test('malformed, truncated, unsupported and oversized timelines fail clearly', async () => {
    assert.throws(() => parseSmf(smf([[...end(0)]], { format: 2 })), { code: 'midi-unsupported' });
    const valid = smf([[...end(0)]]);
    assert.throws(() => parseSmf(valid.subarray(0, valid.length - 1)), { code: 'midi-corrupt' });
    assert.throws(() => parseSmf(smf([[0x81, 0x81, 0x81, 0x81, 0, 0xff, 47, 0]])), { code: 'midi-corrupt' });
    assert.throws(() => parseSmf(smf([[...event(0, 144, 60, 128), ...end(0)]])), { code: 'midi-corrupt' });
    assert.throws(() => parseSmf(smf([[...event(0, 144, 60, 1)]])), { code: 'midi-corrupt' });
    assert.throws(() => parseSmf(smf([[...end(0)]], { division: 0 })), { code: 'midi-corrupt' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(parseSmfAsync(valid, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(isMidiFile({ name: 'SONG.MIDI' }), true);
    assert.equal(isMidiFile('song.mid?token=1'), true);
    assert.equal(isMidiFile('song.mid.wav'), false);
});

test('MIDI recognition preserves sharp signs in local names and ignores URL suffixes', () => {
    for (const fileName of ['C# minor.mid', 'C# minor.MIDI', 'C# minor.kar']) {
        assert.equal(isMidiFile(fileName), true);
        assert.equal(isMidiFile({ name: fileName }), true);
        assert.equal(isMidiFile({ path: `D:\\Music\\${fileName}` }), true);
    }
    assert.equal(isMidiFile('https://example.test/song.mid?download=score.xml#part'), true);
    assert.equal(isMidiFile('https://example.test/song.xml?download=song.mid'), false);
});

test('restoration preserves repeated pitch identities, sustain, controller state and target event ordering', () => {
    const timeline = parseSmf(smf([[...event(0, 144, 60, 100), ...event(120, 60, 70),
        ...event(120, 176, 64, 127), ...event(0, 128, 60, 0), ...event(120, 224, 0, 96),
        ...event(120, 128, 60, 0), ...event(120, 176, 64, 0), ...end(0)]]));
    const before = restoreMidiState(timeline, .5);
    assert.equal(before.notes.length, 2);
    assert.deepEqual(before.notes.map(note => note.down), [false, true]);
    assert.equal(before.channels[0].bend, 12288);
    assert.equal(before.eventIndex, 5);
    assert.equal(restoreMidiState(timeline, .626).notes.length, 0);
    assert.notEqual(before.notes[0].identity, before.notes[1].identity);
});

test('sostenuto captures only keys held at pedal press and reset controllers releases pedal-held notes', () => {
    const channels = createMidiChannels();
    const apply = (status, data1, data2) => applyMidiEvent(channels, { status, data1, data2, seconds: 0, track: 0, order: 0 });
    apply(144, 60, 100); apply(176, 66, 127); apply(144, 64, 90);
    apply(128, 60, 0); apply(128, 64, 0);
    assert.deepEqual(channels[0].notes.map(note => note.pitch), [60]);
    apply(176, 121, 0);
    assert.equal(channels[0].notes.length, 0);
});


test('complete GM/GS/XG reset packets retain source order and sample-time position while invalid checksums are ignored', () => {
    const gm = [0x7e, 0x7f, 9, 1, 0xf7];
    const gs = [0x41, 0x10, 0x42, 0x12, 0x40, 0, 0x7f, 0, 0x41, 0xf7];
    const xg = [0x43, 0x10, 0x4c, 0, 0, 0x7e, 0, 0xf7];
    const invalid = [...gs]; invalid[8] = 0;
    const timeline = parseSmf(smf([[
        ...event(0, 144, 60, 100), ...event(120, 0xf0, gm.length, ...gm),
        ...event(0, 192, 19), ...event(120, 0xf0, gs.length, ...gs),
        ...event(0, 0xf0, invalid.length, ...invalid), ...event(120, 0xf0, xg.length, ...xg), ...end(120)
    ]]));
    assert.deepEqual(timeline.events.filter(event => event.systemReset).map(event => [event.seconds, event.systemReset]),
        [[.125, 1], [.25, 2], [.375, 3]]);
    const before = restoreMidiState(timeline, .2);
    assert.equal(before.notes.length, 0); assert.equal(before.channels[0].program, 19);
    assert.equal(restoreMidiState(timeline, .4).channels[0].program, 0);
    assert.equal(timeline.duration, .5, 'Musical reset does not reset source time');
});
