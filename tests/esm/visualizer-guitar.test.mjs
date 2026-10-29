import assert from 'node:assert/strict';
import test from 'node:test';
import { GuitarFretboardDisplay } from '../../js/visualizer/visualizer-guitar.js';
import { normalizeParams, GUITAR_TUNINGS, createDefaultLayout, createItem,
    encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';

function confidences(notes) {
    const levels = new Float32Array(440);
    notes.forEach((midi, index) => {
        levels[(midi - 21) * 5 + 2] = 0.55 + index * 0.04;
    });
    return levels;
}

test('Guitar and Fretless keep the strongest string-count detections in every Positions mode', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { NoteSpectrogramPlugin: {
        prototype: { parseTelemetryFrame: frame => frame.snapshot },
        updateLevelReference() {}
    } };
    try {
        for (const pm of ['all', 'shape', 'shape-dim']) {
            for (const fl of [false, true]) {
                for (const tn of [[40, 45, 50, 55], [40, 45, 50, 55, 59, 64], [30, 35, 40, 45, 50, 55, 59, 64]]) {
                    const display = new GuitarFretboardDisplay();
                    display.initializeDisplayState();
                    display.setParameters(normalizeParams('guitar', { tn, pm, fl }));
                    const notes = [41, 43, 45, 47, 49, 51, 53, 55, 57, 59];
                    const revisedNotes = notes.map(midi => midi + 1);
                    const snapshot = { generation: 1, frameIndex: 0, hopSeconds: 0.02,
                        levels: confidences(notes), volumeLevels: new Float32Array(440).fill(-12), revisions: [] };
                    display.handleTelemetry({ source: 7, snapshot });
                    const strongest = notes.slice(-tn.length).reverse();
                    assert.deepEqual(display.peaks.map(peak => peak.pitch), strongest, `${pm}, fretless=${fl}, strings=${tn.length}`);
                    display.handleTelemetry({ source: 7, snapshot: { ...snapshot, frameIndex: 8,
                        revisions: [{ age: 8, levels: confidences(revisedNotes) }] } });
                    assert.deepEqual(display.revisedPeaks.map(peak => peak.pitch), revisedNotes.slice(-tn.length).reverse());
                }
            }
        }
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Guitar revisions compare with the previous correction when a note is replaced again', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { NoteSpectrogramPlugin: {
        prototype: { parseTelemetryFrame: frame => frame.snapshot },
        updateLevelReference() {}
    } };
    try {
        const display = new GuitarFretboardDisplay();
        display.initializeDisplayState();
        display.setParameters(normalizeParams('guitar', {}));
        const snapshot = { generation: 1, frameIndex: 0, hopSeconds: 0.02,
            levels: confidences([45]), volumeLevels: new Float32Array(440).fill(-12), revisions: [] };
        display.handleTelemetry({ source: 7, snapshot });
        for (const [age, note] of [[2, 47], [4, 49], [8, 51]]) {
            display.revisedPeaks = [];
            display.dropped = [];
            display.handleTelemetry({ source: 7, snapshot: { ...snapshot, frameIndex: age,
                levels: new Float32Array(440), revisions: [{ age, levels: confidences([note]) }] } });
            assert.equal(display.revisedPeaks[0].pitch, note);
            assert.deepEqual(display.dropped, [age === 2 ? 45 : age === 4 ? 47 : 49]);
        }
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Guitar chord positions and detected-scale labels survive layout sharing', () => {
    const layout = createDefaultLayout(), item = createItem('guitar', 'guitar');
    Object.assign(item.params, { pm: 'chord', lb: 'detected' });
    layout.items = [item];
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params, item.params);
});

test('Guitar voices detected major, minor, seventh and slash chords as playable standard shapes', () => {
    const display = new GuitarFretboardDisplay();
    display.initializeDisplayState();
    display.setParameters(normalizeParams('guitar', { pm: 'chord', lb: 'detected' }));
    assert.equal(display.params.pm, 'chord');
    assert.equal(display.params.lb, 'detected');
    for (const [root, quality, bass, expected] of [
        [0, 0, 0, [null, 3, 2, 0, 1, 0]],
        [9, 1, 9, [null, 0, 2, 2, 1, 0]],
        [7, 6, 7, [3, 2, 0, 0, 0, 1]],
        [0, 0, 4, [0, 3, 2, 0, 1, 0]],
        [0, 4, 0, [null, 3, 2, 0, 0, 0]],
        [9, 5, 9, [null, 0, 2, 0, 1, 0]]
    ]) {
        display.chord = { root, quality, bass };
        const shape = display.solveChordShape(0, 12);
        assert.deepEqual(display.params.tn.map((_, string) => shape.find(stop => stop.string === string)?.fret ?? null), expected);
        assert.strictEqual(display.solveChordShape(0, 12), shape, 'Unchanged chords reuse the cached voicing');
    }
});

test('Guitar chord voicings follow the tuning, capo and visible frets and omit unrepresentable chords', () => {
    const display = new GuitarFretboardDisplay();
    display.initializeDisplayState();
    const cases = [
        { tn: GUITAR_TUNINGS.standard, cp: 2, fm: 0, fx: 5, root: 2 },
        { tn: GUITAR_TUNINGS.standard, cp: 0, fm: 5, fx: 9, root: 0 },
        { tn: GUITAR_TUNINGS['open-d'], cp: 0, fm: 0, fx: 0, root: 2 },
        { tn: GUITAR_TUNINGS.ukulele, cp: 0, fm: 0, fx: 5, root: 0 }
    ];
    for (const { root, ...params } of cases) {
        display.setParameters(normalizeParams('guitar', params));
        display.chord = { root, quality: 0, bass: root };
        const shape = display.solveChordShape(Math.max(params.cp, params.fm), params.fx);
        assert.ok(shape.length >= 3);
        assert.equal(Math.min(...shape.map(stop => stop.midi)) % 12, root, 'Bass is judged by pitch, including reentrant tunings');
        assert.deepEqual([...new Set(shape.map(stop => (stop.midi - root + 120) % 12))].sort((a, b) => a - b), [0, 4, 7]);
        assert.equal(new Set(shape.map(stop => stop.string)).size, shape.length);
        for (const stop of shape) {
            assert.equal(stop.midi, params.tn[stop.string] + stop.fret);
            assert.ok(stop.fret >= Math.max(params.cp, params.fm) && stop.fret <= params.fx);
        }
    }
    display.setParameters(normalizeParams('guitar', { tn: [40], fm: 0, fx: 24 }));
    display.chord = { root: 0, quality: 0, bass: 0 };
    assert.deepEqual(display.solveChordShape(0, 24), [], 'A single string cannot represent a complete triad');
    display.chord = null;
    assert.deepEqual(display.solveChordShape(0, 24), []);
});
