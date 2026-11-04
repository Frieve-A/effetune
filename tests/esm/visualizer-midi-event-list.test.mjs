import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultLayout, createItem, normalizeLayout, validateLayout,
    encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { VisualizerPresetStore } from '../../js/visualizer/visualizer-preset-store.js';
import { MidiEventListDisplay, midiEventListFrame } from '../../js/visualizer/visualizer-midi-event-list.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const row = (seconds, content) => ({ seconds, channel: 1, position: '1:1:0', type: 'Note On', content });

test('event list presets import omitted scroll mode as row while validating supplied modes strictly', async () => {
    const item = createItem('midi-event-list', 'events');
    delete item.params.scrollMode;
    const layout = { ...createDefaultLayout(), items: [item] };
    const presets = new Map();
    const store = new VisualizerPresetStore();
    store.request = async (_name, _mode, action) => action({ add: (value, key) => presets.set(key, value) });
    assert.equal(validateLayout(layout), true);
    await store.appendUserPreset('Row events', layout);
    assert.equal(presets.get('Row events').items[0].params.scrollMode, 'row');
    assert.equal(Object.hasOwn(item.params, 'scrollMode'), false);
    item.params.scrollMode = 'smooth';
    assert.equal(validateLayout(layout), true);
    await store.appendUserPreset('Smooth events', layout);
    assert.equal(presets.get('Smooth events').items[0].params.scrollMode, 'smooth');
    item.params.scrollMode = 'invalid';
    assert.equal(validateLayout(layout), false);
    await assert.rejects(store.appendUserPreset('Invalid events', layout), /Invalid visualizer preset/);
});

test('MIDI Event List shares its font, row spacing, palette and effects and exposes the inspector', () => {
    const item = createItem('midi-event-list', 'events');
    assert.deepEqual(item.params, { scrollMode: 'row', fontFamily: 'monospace', fontSize: 14, rowSpacing: 1.5 });
    assert.equal(item.palette.color, '#ffffff');
    const fields = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (_key, fallback) => fallback, changed() {},
        field(_parent, label, type, value, change, options) { fields.push({ label, type, value, change, options }); }
    });
    editor.parameters({}, item);
    assert.deepEqual(fields.map(field => field.label), ['Scroll mode', 'Font', 'Text size', 'Row spacing']);
    fields[0].change('smooth'); fields[1].change('serif'); fields[2].change(20); fields[3].change(2);
    const layout = { ...createDefaultLayout(), items: [item] };
    assert.equal(validateLayout(layout), true);
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0], item);
    Object.assign(item.params, { fontSize: 100, rowSpacing: -1 });
    assert.deepEqual(normalizeLayout(layout).items[0].params, { scrollMode: 'smooth', fontFamily: 'serif', fontSize: 32, rowSpacing: 1 });
    delete item.params.scrollMode;
    item.palette.color = '#123456';
    assert.equal(normalizeLayout(layout).items[0].params.scrollMode, 'row');
    assert.equal(normalizeLayout(layout).items[0].palette.color, '#123456');
});

test('clock boundary preserves past/future direction across sparse and simultaneous events and seeks', () => {
    const rows = [row(1, 'a'), row(1, 'b'), row(1, 'c'), row(10, 'd'), row(20, 'e')];
    const frame = time => midiEventListFrame(rows, time, 20, 400, 30, 'smooth');
    for (const time of [0, .9, 1.001, 2, 5, 9.999, 10.01, 15, 20.01, 30]) {
        const state = frame(time);
        rows.forEach((event, index) => {
            const y = state.center + (index - state.cursor) * 20;
            if (event.seconds < time) assert.ok(y < state.center, `${event.content} is past at ${time}`);
            if (event.seconds > time) assert.ok(y > state.center, `${event.content} is future at ${time}`);
        });
    }
    assert.equal(frame(1).cursor, 1);
    assert.deepEqual([frame(1).current, frame(1).next], [0, 3]);
    assert.ok(frame(3).cursor < frame(6).cursor);
    assert.deepEqual(frame(15), frame(15));
    assert.equal(frame(2).cursor, 2 + 1 / 9);
    const stepped = time => midiEventListFrame(rows, time, 20, 400, 30);
    assert.equal(stepped(2).cursor, 2.5);
    assert.deepEqual(stepped(2), stepped(9));
    assert.equal(stepped(10).cursor, 3);
    assert.equal(stepped(11).cursor, 3.5);
    assert.equal(stepped(0).cursor, -.5);
    assert.equal(stepped(30).cursor, 4.5);
});

test('display paints only visible events and follows the supplied clock without retaining a song or seek', () => {
    let reads = 0;
    const rows = new Proxy(Array.from({ length: 100000 }, (_, index) => row(index, `event ${index}`)), {
        get(target, key) { if (/^\d+$/.test(String(key))) reads++; return target[key]; }
    });
    const text = [], transforms = [];
    const ctx = { clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
        translate(...args) { transforms.push(args); }, scale(...args) { transforms.push(args); },
        measureText(value) { return { width: value.length * 8 }; },
        fillText(value, x, y) { text.push({ value, x, y, color: this.fillStyle }); } };
    const canvas = { width: 1000, height: 400, getContext: () => ctx };
    let data = { rows, position: 50000.25 };
    const display = new MidiEventListDisplay(canvas, { getMidiEventList: () => data });
    const item = createItem('midi-event-list', 'events');
    display.draw(item, 123, 1000, {});
    assert.ok(reads < 100, `visible rendering read ${reads} rows`);
    assert.deepEqual(text.slice(-4).map(entry => entry.value), ['Channel', 'Bar:Beat:Tick', 'Type', 'Contents']);
    assert.ok(text.find(entry => entry.value === 'event 50000').y < 200);
    assert.ok(text.find(entry => entry.value === 'event 50001').y > 200);
    assert.ok(text.every(entry => entry.color === '#ffffff'));
    text.length = 0;
    data = { rows: [row(0, 'replacement')], position: 0 };
    item.flipX = item.flipY = true;
    display.draw(item, 124, 1000, {});
    assert.ok(text.some(entry => entry.value === 'replacement'));
    assert.equal(text.some(entry => String(entry.value).startsWith('event ')), false);
    assert.deepEqual(transforms.slice(-2), [[1000, 400], [-1, -1]]);
    text.length = 0;
    data = null;
    display.draw(item, 125, 1000, {});
    assert.deepEqual(text.map(entry => entry.value), ['Channel', 'Bar:Beat:Tick', 'Type', 'Contents']);
});

test('event list source uses the current audible MIDI clock, caches rows, and acquires no analysis taps', async () => {
    await withGlobals({ document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: {} }, () => {
        let presentation = { timeline: { duration: 10, division: 480, events: [
            { seconds: 1, tick: 960, status: 0x90, data1: 60, data2: 100, track: 0, order: 0 }
        ], tempoMap: [{ seconds: 0, tick: 0, quarter: 0, microsecondsPerQuarter: 500000 }],
        timeSignatures: [{ seconds: 0, tick: 0, quarter: 0, numerator: 4, denominator: 4 }] }, position: 2, hasMidi: true };
        const sources = new VisualizerSources({ setVisualizerSources() {} }, () => presentation);
        try {
            sources.setLayout({ items: [createItem('midi-event-list', 'events')] });
            assert.equal(sources.sources.size, 0);
            const first = sources.getMidiEventList();
            presentation.position = 5;
            assert.equal(sources.getMidiEventList().rows, first.rows);
            assert.equal(sources.getMidiEventList().position, 5);
            presentation = null;
            assert.equal(sources.getMidiEventList(), null);
        } finally { sources.dispose(); }
    });
});
