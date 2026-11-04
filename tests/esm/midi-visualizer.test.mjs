import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiVisualizerAdapter, inferMidiChord, drawMidiNotes } from '../../js/visualizer/visualizer-midi.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { createItem, createDefaultLayout, normalizeLayout, validateLayout, encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';
import { GuitarFretboardDisplay } from '../../js/visualizer/visualizer-guitar.js';
import { DrumsDisplay } from '../../js/visualizer/visualizer-drums.js';

const event = (seconds, status, data1, data2, order) => ({ seconds, status, data1, data2, track: 0, order });
const timeline = { duration: 4, division: 480, secondsPerTick: null,
    events: [event(0, 144, 60, 100, 0), event(.1, 153, 36, 127, 1),
        event(.2, 176, 64, 127, 2), event(.3, 128, 60, 0, 3), event(1, 176, 64, 0, 4)],
    tempoMap: [{ tick: 0, seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 }],
    timeSignatures: [{ tick: 0, seconds: 0, quarter: 0, numerator: 4, denominator: 4 }] };
const presentation = { timeline, position: .5, generation: 1, playing: true, paused: false, speed: 1, hasMidi: true };

test('MIDI display state follows sustain/rests/seek and keeps explicit MIDI identity without an instrument', () => {
    const adapter = new MidiVisualizerAdapter();
    let snapshot = adapter.snapshot(presentation);
    assert.equal(snapshot.sourceKind, 'midi');
    assert.deepEqual(snapshot.notes.map(note => note.pitch), [60]);
    assert.equal(snapshot.hits[1].band, 0);
    const identity = snapshot.source;
    snapshot = adapter.snapshot({ ...presentation, position: 1.5 });
    assert.equal(snapshot.notes.length, 0);
    assert.equal(snapshot.source, identity);
    assert.equal(snapshot.history.length, 1);
    snapshot = adapter.snapshot({ ...presentation, position: .05, generation: 2 });
    assert.notEqual(snapshot.source, identity);
    assert.equal(snapshot.hits.length, 1);
    assert.equal(adapter.snapshot({ ...presentation, position: 0, generation: 3, playing: false }).notes.length, 0);
});

test('GS/XG drum assignments drive note and drum displays and preserve the kind of already sounding notes', () => {
    const drumMode = (seconds, channel, mode) => ({ seconds, status: 0, data1: channel, data2: mode, drumMode: { channel, mode } });
    const song = { ...timeline, events: [drumMode(0, 0, 2), drumMode(0, 9, 0),
        event(.1, 0x90, 36, 127, 1), event(.1, 0x99, 60, 100, 2), drumMode(.2, 0, 0)] };
    const snapshot = new MidiVisualizerAdapter().snapshot({ ...presentation, timeline: song });
    assert.deepEqual(snapshot.notes.map(note => [note.channel, note.pitch]), [[9, 60]]);
    assert.deepEqual(snapshot.hits.map(hit => hit.band), [0, undefined]);
    const drums = new DrumsDisplay(); drums.initializeDisplayState(); drums.handleMidiSnapshot({ ...snapshot, position: .1 });
    drums.stepLevels(0);
    assert.equal(drums.levels[0], 1, 'Percussion from channel1 reaches the drum lane');
});

test('MIDI preferences migrate old layouts, persist explicit off and reject invalid supplied values', () => {
    for (const type of ['notes', 'drums', 'guitar', 'rhythm-analyzer']) {
        const item = createItem(type, type), layout = { ...createDefaultLayout(), items: [item] };
        assert.equal(item.params.preferMidi, true);
        delete item.params.preferMidi;
        assert.equal(validateLayout(layout), true);
        assert.equal(normalizeLayout(layout).items[0].params.preferMidi, true);
        item.params.preferMidi = false;
        assert.equal(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params.preferMidi, false);
        item.params.preferMidi = 'false';
        assert.equal(validateLayout(layout), false);
    }
});

test('MIDI preference releases only its audio taps and restores them for audio or preference off', () => {
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    globalThis.window = {}; globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    let current = presentation, published;
    const sources = new VisualizerSources({ telemetryHub: { subscribe: () => () => {} },
        setVisualizerSources(value) { published = value; } }, () => current);
    try {
        const notes = createItem('notes', 'notes'), meter = createItem('level-meter', 'meter');
        sources.setLayout({ items: [notes, meter] }); sources.setVisible(true);
        assert.equal(published.length, 1);
        assert.equal(sources.getFrame('notes').sourceKind, 'midi');
        current = { ...presentation, position: 2 };
        assert.equal(sources.getFrame('notes').notes.length, 0);
        assert.equal(published.length, 1);
        notes.params.preferMidi = false; sources.setLayout({ items: [notes, meter] });
        assert.equal(published.length, 2);
        current = null; sources.getFrame('notes');
        assert.equal(published.length, 2);
    } finally { sources.dispose(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('MIDI Guitar and Drums use explicit notes/velocity and clear on empty snapshots', () => {
    const guitar = new GuitarFretboardDisplay(); guitar.initializeDisplayState();
    guitar.handleMidiSnapshot({ notes: [{ pitch: 60.5, velocity: 64 }], chord: null }); guitar.stepLevels(0);
    assert.equal(guitar.voices[0].pitch, 60.5); assert.equal(guitar.voices[0].size, 64 / 127);
    guitar.handleMidiSnapshot({ notes: [], chord: null }); guitar.stepLevels(1);
    assert.equal(guitar.voices.length, 0);
    const drums = new DrumsDisplay(); drums.initializeDisplayState();
    drums.handleMidiSnapshot({ position: 1, hits: [{ time: 1, velocity: .5, band: 0, channel: 9 },
        { time: 1, velocity: 1, band: undefined, channel: 9 }] });
    assert.deepEqual([...drums.stepLevels(100)], [.5, 0, 0, 0, 0]);
    drums.handleMidiSnapshot({ position: 2, hits: [] }); assert.deepEqual([...drums.stepLevels(200)], [0, 0, 0, 0, 0]);
    assert.equal(inferMidiChord([60, 64, 67].map(pitch => ({ pitch }))).name, 'C');
});

test('MIDI Notes render structured snapshots with velocity', () => {
    const calls = [], context = new Proxy({}, { get: (target, name) => target[name] ?? ((...args) => {
        calls.push([name, ...args]);
        if (name === 'createLinearGradient') return { addColorStop() {} };
    }) });
    const snapshot = new MidiVisualizerAdapter().snapshot(presentation);
    const theme = { get: () => '#eeeeee' }, canvas = { width: 400, height: 200 };
    const notes = createItem('notes', 'notes'); notes.params.kb = true;
    drawMidiNotes(context, canvas, notes, snapshot, theme);
    assert.ok(calls.some(([name]) => name === 'fillRect'));
});

test('MIDI Rhythm keeps its signal-analysis tap and speed changes update the score clock while paused', () => {
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    globalThis.window = {}; globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    let current = { ...presentation, playing: false, paused: true }, published;
    const subscriptions = [];
    const sources = new VisualizerSources({ telemetryHub: { subscribe: (...args) => {
        subscriptions.push(args); return () => {};
    } }, setVisualizerSources(value) { published = value; } }, () => current);
    try {
        const rhythm = createItem('rhythm-analyzer', 'rhythm');
        sources.setLayout({ items: [rhythm] }); sources.setVisible(true);
        assert.equal(published.length, 1);
        assert.equal(published[0].type, 'RhythmAnalyzerPlugin');
        assert.equal(subscriptions[0][1], 28);
        assert.equal(sources.getFrame('rhythm').beat.bpm, 120);
        current = { ...current, speed: 2 };
        assert.equal(sources.getFrame('rhythm').speed, 2);
        assert.equal(sources.getFrame('rhythm').beatAt(1).quarter, 2);
        rhythm.params.preferMidi = false;
        sources.setLayout({ items: [rhythm] });
        assert.equal(published.length, 1);
        assert.equal(sources.getFrame('rhythm'), null);
    } finally { sources.dispose(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
