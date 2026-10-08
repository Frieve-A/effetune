import assert from 'node:assert/strict';
import test from 'node:test';
import { GuitarFretboardDisplay } from '../../js/visualizer/visualizer-guitar.js';
import { normalizeParams } from '../../js/visualizer/visualizer-model.js';

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
