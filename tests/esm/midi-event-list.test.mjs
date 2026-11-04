import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmf } from '../../js/midi/smf-parser.js';
import { getMidiEventList } from '../../js/midi/event-list.js';

const vlq = value => {
    const bytes = [value & 127];
    while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
    return bytes;
};
const event = (delta, ...bytes) => [...vlq(delta), ...bytes];
const u32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
function smf(tracks, division = 480) {
    return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0,
        0, tracks.length, division >> 8, division & 255,
        ...tracks.flatMap(track => [77, 84, 114, 107, ...u32(track.length), ...track])]);
}
const end = [0, 255, 47, 0];

test('event list preserves all source event rows without introducing playback messages', () => {
    const sysex = Array.from({ length: 100 }, (_, index) => index & 127);
    const timeline = parseSmf(smf([[
        ...event(0, 255, 3, 4, 83, 111, 110, 103),
        ...event(0, 255, 81, 3, 7, 161, 32), ...event(0, 255, 88, 4, 4, 2, 24, 8),
        ...event(0, 0x91, 60, 100), ...event(0, 0xa1, 60, 30),
        ...event(0, 0xb1, 64, 127), ...event(0, 0xc1, 12), ...event(0, 0xd1, 45),
        ...event(0, 0xe1, 0, 96), ...event(0, 0x91, 60, 0),
        ...event(0, 0xf0, sysex.length, ...sysex),
        ...event(0, 255, 5, 2, 72, 105), ...end
    ]]));
    const playback = structuredClone(timeline.events);
    const rows = getMidiEventList(timeline);
    assert.deepEqual(rows.map(row => row.type), ['Track Name', 'Tempo', 'Time Signature', 'Note On',
        'Poly Pressure', 'CC', 'Program Change', 'Channel Pressure', 'Pitch Bend', 'Note Off', 'SysEx', 'Lyric', 'End of Track']);
    assert.deepEqual(rows.map(row => row.channel), [null, null, null, 2, 2, 2, 2, 2, 2, 2, null, null, null]);
    assert.equal(rows[3].content, 'C4 (60), velocity 100');
    assert.equal(rows[5].content, 'Sustain (64): 127');
    assert.equal(rows[6].content, 'Program 13');
    assert.equal(rows[8].content, '4096');
    assert.match(rows[10].content, /^100 bytes: 00 01/);
    assert.ok(rows[10].content.length < 80);
    assert.equal(timeline.displayEvents.find(item => item.type === 'sysex').dataPreview.length, 16);
    assert.deepEqual(timeline.events, playback);
    assert.equal(timeline.events.length, 7);
    assert.equal(getMidiEventList(timeline), rows);
    assert.ok(Object.isFrozen(rows));
    assert.ok(rows.every(Object.isFrozen));
    assert.ok(rows.every(row => Object.isFrozen(row.contentFields) && row.contentFields.every(Object.isFrozen)));
    assert.deepEqual(rows[3].contentFields.filter(field => field.align === 'right').map(field => [field.text, field.sample]),
        [['4', '-1'], ['60', '127'], ['100', '127']]);
    assert.deepEqual(rows[5].contentFields.slice(0, 3).map(field => field.text), ['64', ': ', '127']);
});

test('positions count bars across meter changes, retain PPQ ticks and ignore tempo for musical location', () => {
    const timeline = parseSmf(smf([[
        ...event(0, 0x90, 60, 80), ...event(1920, 255, 88, 4, 3, 3, 24, 8),
        ...event(240, 255, 81, 3, 15, 66, 64), ...event(120, 0x90, 62, 90),
        ...event(360, 0x80, 62, 0), ...event(120, 255, 88, 4, 5, 2, 24, 8),
        ...event(60, 0xb0, 1, 10), ...end
    ]]));
    const rows = getMidiEventList(timeline);
    assert.deepEqual(rows.map(row => row.position), ['1:1:0', '2:1:0', '2:2:0', '2:2:120',
        '3:1:0', '4:1:0', '4:1:60', '4:1:60']);
    assert.equal(rows[3].seconds, 2.5, 'tempo changes affect seconds but not bar/beat/tick');
});

test('same-tick events retain track/order and normalized score events use the same projection', () => {
    const timeline = parseSmf(smf([
        [...event(0, 0xb0, 1, 10), ...event(0, 0xc0, 2), ...end],
        [...event(0, 0x91, 65, 100), ...end]
    ]));
    assert.deepEqual(getMidiEventList(timeline).map(row => row.type),
        ['CC', 'Program Change', 'End of Track', 'Note On', 'End of Track']);
    const normalized = { ...timeline, displayEvents: undefined, events: timeline.events,
        tempoMap: [...timeline.tempoMap, { type: 'tempo', tick: 0, seconds: 0, quarter: 0,
            microsecondsPerQuarter: 1000000, track: 0, order: -1 }] };
    assert.deepEqual(getMidiEventList(normalized).map(row => row.type), ['Tempo', 'CC', 'Program Change', 'Note On']);
});

test('SMPTE rows use tempo-derived beats with the original clock tick offset', () => {
    const timeline = parseSmf(smf([[
        ...event(0, 255, 81, 3, 7, 161, 32), ...event(1000, 255, 81, 3, 15, 66, 64),
        ...event(250, 0x90, 60, 100), ...end
    ]], 0xe728));
    const row = getMidiEventList(timeline).find(item => item.type === 'Note On');
    assert.equal(row.position, '1:3:250');
    assert.equal(row.seconds, 1.25);
});
